'use strict';

/**
 * Result watcher: the web server itself checks PCSO for new results, so they appear soon after
 * PCSO posts them instead of waiting for GitHub's scheduler (which often starts late or skips).
 * GitHub Actions stays as a backup; both share the same database lock, so they never collide.
 *
 * Cost-conscious by design:
 *   - Each tick first asks the database "is any result due and missing?" (no PCSO request,
 *     no ingest log row). PCSO is contacted only when something is actually due.
 *   - Tonight's results missing: checks every 2 minutes from 9:00 to 10:30 PM (when results
 *     usually appear), then every 10 minutes until 1:00 AM.
 *   - Only older results missing (usually a draw that was never held - holidays, suspensions -
 *     or a very late PCSO posting): asks PCSO at most every 3 hours, until the 3-day
 *     look-back window passes. This keeps a cancelled draw from causing repeated requests.
 *   - Outside the evening window the database check itself runs hourly.
 *   - After a failure it waits 30 minutes before trying PCSO again.
 *
 * Turned on with AUTO_FETCH_RESULTS=true (set it on Render; leave it off on a laptop).
 */

const { createPcsoClient } = require('../fetcher/pcso-client');
const { createDailyPlanner } = require('./plan-daily');
const { runIngest: defaultRunIngest, IngestBusyError } = require('./run-ingest');
const { loadActiveGames } = require('../repositories/game-repository');
const { nowInManila } = require('../utils/ph-time');

const MINUTE_MS = 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30 * 1000;
const RUSH_INTERVAL_MS = 2 * MINUTE_MS;
const HOT_INTERVAL_MS = 10 * MINUTE_MS;
const QUIET_INTERVAL_MS = 60 * MINUTE_MS;
const FAILURE_BACKOFF_MS = 30 * MINUTE_MS;
const STALE_RETRY_MS = 3 * 60 * MINUTE_MS;
const RUSH_WINDOW_START = '21:00'; // draws are at 9:00 PM
const RUSH_WINDOW_END = '22:30';
const HOT_WINDOW_END = '01:00';

/** True between 9:00 PM and 1:00 AM Philippine time (the window crosses midnight). */
function isHotWindow(timeNow) {
  return timeNow >= RUSH_WINDOW_START || timeNow < HOT_WINDOW_END;
}

/** True between 9:00 and 10:30 PM, when results are most likely to appear. */
function isRushWindow(timeNow) {
  return timeNow >= RUSH_WINDOW_START && timeNow < RUSH_WINDOW_END;
}

function nextDelayMs(now) {
  const { time } = nowInManila(now);
  if (isRushWindow(time)) {
    return RUSH_INTERVAL_MS;
  }
  return isHotWindow(time) ? HOT_INTERVAL_MS : QUIET_INTERVAL_MS;
}

/**
 * @param {object} options
 * @param {object} options.pool - mysql2 promise pool
 * @param {Function} [options.createClient] - returns a PCSO client
 * @param {Function} [options.runIngest]
 * @param {Function} [options.loadGames]
 * @param {Function} [options.now] - returns the current Date
 * @param {Function} [options.log]
 * @param {Function} [options.setTimer] / [options.clearTimer] - tests pass fakes
 */
function createResultWatcher({
  pool,
  createClient = createPcsoClient,
  runIngest = defaultRunIngest,
  loadGames = loadActiveGames,
  now = () => new Date(),
  log = (message) => console.log(`[results] ${message}`),
  setTimer = (callback, delay) => setTimeout(callback, delay).unref(),
  clearTimer = (timer) => clearTimeout(timer),
} = {}) {
  const duePlanner = createDailyPlanner();
  let timer = null;
  let running = false;
  let stopped = true;
  let lastStaleAttemptAt = 0;

  function schedule(delayMs) {
    if (!stopped) {
      timer = setTimer(tick, delayMs);
    }
  }

  /**
   * Cheap check (database only): should PCSO be contacted now?
   * Yes for tonight's missing results; for older ones only every STALE_RETRY_MS.
   */
  async function shouldContactPcso() {
    const games = await loadGames(pool);
    const currentTime = now();
    const { date: today, time: timeNow } = nowInManila(currentTime);
    const plan = await duePlanner({ db: pool, games, today, timeNow });
    const outstanding = plan.outstanding || [];
    if (outstanding.length === 0) {
      return false;
    }
    const tonightMissing = outstanding.some((draw) => draw.drawDate === today);
    if (tonightMissing || currentTime.getTime() - lastStaleAttemptAt >= STALE_RETRY_MS) {
      // Every search covers the whole 3-day look-back, so it also re-asks about older draws.
      lastStaleAttemptAt = currentTime.getTime();
      return true;
    }
    return false;
  }

  async function tick() {
    timer = null;
    if (running || stopped) {
      return;
    }
    running = true;
    let delay = nextDelayMs(now());
    try {
      if (await shouldContactPcso()) {
        const result = await runIngest({
          pool,
          client: createClient(),
          runType: 'daily',
          triggerSource: 'server',
          planner: createDailyPlanner(),
          now: now(),
        });
        log(`checked PCSO: ${result.inserted} new result(s), status ${result.status}`);
        if (result.status === 'failed') {
          delay = FAILURE_BACKOFF_MS;
        }
      }
    } catch (error) {
      if (error instanceof IngestBusyError) {
        log('another check (GitHub Actions) is running; will try again later');
      } else {
        log(`check failed: ${error.code || ''} ${error.message}`.trim());
        delay = FAILURE_BACKOFF_MS;
      }
    } finally {
      running = false;
      schedule(delay);
    }
  }

  return {
    start() {
      if (!stopped) {
        return;
      }
      stopped = false;
      log('watching for new PCSO results');
      schedule(FIRST_CHECK_DELAY_MS);
    },
    stop() {
      stopped = true;
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
    },
    /** For tests: run one check now. */
    tick,
  };
}

module.exports = {
  createResultWatcher, isHotWindow, isRushWindow, nextDelayMs,
  RUSH_INTERVAL_MS, HOT_INTERVAL_MS, QUIET_INTERVAL_MS, FAILURE_BACKOFF_MS, STALE_RETRY_MS,
};

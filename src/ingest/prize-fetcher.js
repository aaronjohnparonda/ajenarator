'use strict';

/**
 * Fills in the 5/4/3-number prize breakdown for saved draws that do not have one yet.
 *
 * Runs right after the result watcher's PCSO step (same timer, no extra schedule), and only
 * touches the network when a saved draw is actually missing its breakdown:
 *   - Draws from the last 24 hours: the day's page is re-read at most every 15 minutes
 *     (Summit Express usually adds the breakdown within an hour or two of the 9 PM draw).
 *   - Older draws (up to LOOKBACK_DAYS back): at most every 3 hours, then given up on.
 *   - One page per day covers every game drawn that day, so a night costs one request.
 *
 * Each breakdown is saved only if checkPrizeBreakdown() passes. A rejected one is logged with
 * the reason and retried on the same timetable (the page may be corrected later).
 */

const { createPrizeSourceClient, SOURCE_NAME } = require('../fetcher/prize-source');
const { checkPrizeBreakdown } = require('./prize-check');
const prizeRepository = require('../repositories/prize-repository');
const { nowInManila, addDays } = require('../utils/ph-time');

const MINUTE_MS = 60 * 1000;
const LOOKBACK_DAYS = 7;
const RECENT_RETRY_MS = 15 * MINUTE_MS;
const STALE_RETRY_MS = 3 * 60 * MINUTE_MS;
const DELAY_BETWEEN_PAGES_MS = 2000;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function groupByDate(draws) {
  const byDate = new Map();
  draws.forEach((draw) => {
    if (!byDate.has(draw.drawDate)) {
      byDate.set(draw.drawDate, []);
    }
    byDate.get(draw.drawDate).push(draw);
  });
  return byDate;
}

/**
 * Reads one day's page and saves every breakdown on it that passes the checks.
 * Exported for the backfill script, which runs it without the timetable.
 * @returns {Promise<{ saved: number, notFound: boolean, notReady: string[], rejected: string[] }>}
 */
async function fetchPrizesForDate({ db, client, drawDate, draws, prizes = prizeRepository }) {
  const outcome = { saved: 0, notFound: false, notReady: [], rejected: [] };
  const page = await client.fetchDay(drawDate);
  if (!page.found) {
    outcome.notFound = true;
    return outcome;
  }

  const toSave = [];
  draws.forEach((draw) => {
    const fetched = page.games.get(draw.gameCode);
    if (!fetched || fetched.notReady) {
      outcome.notReady.push(`${draw.gameCode} ${drawDate}${fetched ? ` (${fetched.notReady})` : ''}`);
      return;
    }
    const check = checkPrizeBreakdown({ gameCode: draw.gameCode, storedNumbers: draw.numbers, fetched });
    if (!check.ok) {
      outcome.rejected.push(`${draw.gameCode} ${drawDate}: ${check.reason}`);
      return;
    }
    toSave.push({ drawId: draw.drawId, prizes: check.prizes, source: SOURCE_NAME, sourceUrl: page.url });
  });

  outcome.saved = await prizes.savePrizes(db, toSave);
  return outcome;
}

/**
 * @param {object} options
 * @param {object} options.pool - mysql2 promise pool
 * @param {Function} [options.createClient]
 * @param {Function} [options.now]
 * @param {Function} [options.log]
 * @param {object} [options.prizes] - tests pass a stand-in repository
 * @param {number} [options.pauseMs] - pause between day pages (tests pass 0)
 */
function createPrizeFetcher({
  pool,
  createClient = createPrizeSourceClient,
  now = () => new Date(),
  log = (message) => console.log(`[prizes] ${message}`),
  prizes = prizeRepository,
  pauseMs = DELAY_BETWEEN_PAGES_MS,
} = {}) {
  const lastAttemptByDate = new Map();

  function isDue(drawDate, currentTime) {
    const last = lastAttemptByDate.get(drawDate);
    if (last === undefined) {
      return true;
    }
    const { date: today } = nowInManila(currentTime);
    const isRecent = drawDate >= addDays(today, -1);
    return currentTime.getTime() - last >= (isRecent ? RECENT_RETRY_MS : STALE_RETRY_MS);
  }

  return {
    /** @returns {Promise<{ checkedDates: number, saved: number }>} */
    async run() {
      const currentTime = now();
      const { date: today } = nowInManila(currentTime);
      const startDate = addDays(today, -LOOKBACK_DAYS);
      const missing = await prizes.loadDrawsMissingPrizes(pool, startDate, today);

      // Forget dates that dropped out of the look-back window.
      [...lastAttemptByDate.keys()].filter((date) => date < startDate).forEach((date) => lastAttemptByDate.delete(date));

      const dueDates = [...groupByDate(missing)].filter(([drawDate]) => isDue(drawDate, currentTime));
      let saved = 0;
      let client = null;

      for (const [index, [drawDate, draws]] of dueDates.entries()) {
        if (index > 0 && pauseMs > 0) {
          await sleep(pauseMs);
        }
        lastAttemptByDate.set(drawDate, currentTime.getTime());
        client = client || createClient();
        try {
          const outcome = await fetchPrizesForDate({ db: pool, client, drawDate, draws, prizes });
          saved += outcome.saved;
          if (outcome.notFound) {
            log(`${drawDate}: Summit Express page not posted yet`);
          }
          if (outcome.saved > 0) {
            log(`${drawDate}: saved ${outcome.saved} prize breakdown(s)`);
          }
          outcome.notReady.forEach((entry) => log(`not posted yet: ${entry}`));
          outcome.rejected.forEach((entry) => log(`NOT saved, check failed: ${entry}`));
        } catch (error) {
          log(`${drawDate}: could not read Summit Express (${error.message})`);
        }
      }

      return { checkedDates: dueDates.length, saved };
    },
  };
}

module.exports = {
  createPrizeFetcher, fetchPrizesForDate, LOOKBACK_DAYS, RECENT_RETRY_MS, STALE_RETRY_MS,
};

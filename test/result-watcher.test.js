'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createResultWatcher, isHotWindow, isRushWindow, nextDelayMs,
  RUSH_INTERVAL_MS, HOT_INTERVAL_MS, QUIET_INTERVAL_MS, FAILURE_BACKOFF_MS,
} = require('../src/ingest/result-watcher');
const { IngestBusyError } = require('../src/ingest/run-ingest');

// 6/49 draws Sun/Tue/Thu, 6/58 Sun/Tue/Fri, both 9:00 PM.
const GAMES = [
  { id: 3, code: '6/49', drawTime: '21:00:00', drawDays: new Set([7, 2, 4]) },
  { id: 5, code: '6/58', drawTime: '21:00:00', drawDays: new Set([7, 2, 5]) },
];

/** Fake pool: answers the planner's "which draws are stored" query from a set of keys. */
function fakePool(storedKeys) {
  return {
    async query() {
      return [[...storedKeys].map((key) => {
        const [gameId, date] = key.split('|');
        return { game_id: Number(gameId), draw_date: date };
      })];
    },
  };
}

// Everything due up to Sat 2026-10-24 is stored; Sunday 2026-10-25's two draws are not.
const STORED_BEFORE_SUNDAY = new Set(['3|2026-10-22', '5|2026-10-23']);

function setup({ at, stored = STORED_BEFORE_SUNDAY, runIngest }) {
  const clock = { now: new Date(at) };
  const timers = [];
  const logs = [];
  const calls = [];
  const watcher = createResultWatcher({
    pool: fakePool(stored),
    createClient: () => ({ fake: true }),
    loadGames: async () => GAMES,
    runIngest: async (options) => {
      calls.push(options);
      return runIngest ? runIngest(options) : { status: 'success', inserted: 2 };
    },
    now: () => clock.now,
    log: (message) => logs.push(message),
    setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimer: () => {},
  });
  watcher.start();
  return { watcher, clock, timers, logs, calls };
}

test('time windows: 2 min until 10:30 PM, 10 min until 1 AM, hourly otherwise', () => {
  assert.equal(isHotWindow('20:59'), false);
  assert.equal(isHotWindow('21:00'), true);
  assert.equal(isHotWindow('00:59'), true);
  assert.equal(isHotWindow('01:00'), false);
  assert.equal(isRushWindow('21:00'), true);
  assert.equal(isRushWindow('22:29'), true);
  assert.equal(isRushWindow('22:30'), false);
  assert.equal(nextDelayMs(new Date('2026-10-25T21:10:00+08:00')), RUSH_INTERVAL_MS);
  assert.equal(nextDelayMs(new Date('2026-10-25T23:00:00+08:00')), HOT_INTERVAL_MS);
  assert.equal(nextDelayMs(new Date('2026-10-25T15:00:00+08:00')), QUIET_INTERVAL_MS);
});

test('before the draw nothing is due, so PCSO is not contacted', async () => {
  const { watcher, calls, timers } = setup({ at: '2026-10-25T20:30:00+08:00' });
  await watcher.tick();
  assert.equal(calls.length, 0);
  assert.equal(timers.at(-1).delay, QUIET_INTERVAL_MS);
});

test('after the draw with results missing, it runs the check as "server"', async () => {
  const { watcher, calls, timers, logs } = setup({ at: '2026-10-25T21:15:00+08:00' });
  await watcher.tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].triggerSource, 'server');
  assert.equal(calls[0].runType, 'daily');
  assert.equal(timers.at(-1).delay, RUSH_INTERVAL_MS);
  assert.match(logs.at(-1), /2 new result/);
});

test('once results are saved, later ticks cost no PCSO request', async () => {
  const stored = new Set([...STORED_BEFORE_SUNDAY, '3|2026-10-25', '5|2026-10-25']);
  const { watcher, calls } = setup({ at: '2026-10-25T21:45:00+08:00', stored });
  await watcher.tick();
  assert.equal(calls.length, 0);
});

test('if GitHub Actions holds the lock, it waits for the next tick', async () => {
  const { watcher, timers, logs } = setup({
    at: '2026-10-25T21:15:00+08:00',
    runIngest: () => { throw new IngestBusyError(); },
  });
  await watcher.tick();
  assert.equal(timers.at(-1).delay, RUSH_INTERVAL_MS);
  assert.match(logs.at(-1), /another check/);
});

test('failures back off for 30 minutes and never crash the server', async () => {
  const thrown = setup({ at: '2026-10-25T21:15:00+08:00', runIngest: () => { throw new Error('ETIMEDOUT'); } });
  await thrown.watcher.tick();
  assert.equal(thrown.timers.at(-1).delay, FAILURE_BACKOFF_MS);

  const failedRun = setup({ at: '2026-10-25T21:15:00+08:00', runIngest: () => ({ status: 'failed', inserted: 0 }) });
  await failedRun.watcher.tick();
  assert.equal(failedRun.timers.at(-1).delay, FAILURE_BACKOFF_MS);
});

test('a result missed last night is still picked up the next morning', async () => {
  const { watcher, calls, timers } = setup({ at: '2026-10-26T08:00:00+08:00' });
  await watcher.tick();
  assert.equal(calls.length, 1);
  assert.equal(timers.at(-1).delay, QUIET_INTERVAL_MS);
});

test('first check runs 30 seconds after start; stop prevents further checks', async () => {
  const { watcher, timers, calls } = setup({ at: '2026-10-25T21:15:00+08:00' });
  assert.equal(timers[0].delay, 30000);
  watcher.stop();
  await timers[0].callback();
  assert.equal(calls.length, 0);
});

test('a draw that was never held (holiday) is asked about at most every 3 hours', async () => {
  // Friday's 6/58 draw (2026-10-23) never came in; on Saturday no game here draws, so it's the only gap.
  const stored = new Set(['3|2026-10-22']);
  const { watcher, calls, clock } = setup({ at: '2026-10-24T21:30:00+08:00', stored });
  await watcher.tick();
  assert.equal(calls.length, 1); // first attempt
  clock.now = new Date('2026-10-24T21:40:00+08:00');
  await watcher.tick();
  clock.now = new Date('2026-10-24T23:50:00+08:00');
  await watcher.tick();
  assert.equal(calls.length, 1); // no repeat within 3 hours
  clock.now = new Date('2026-10-25T00:31:00+08:00');
  await watcher.tick();
  assert.equal(calls.length, 2); // 3 hours later, one more try
});

test('tonight\'s missing results are still checked every tick even if an older one is stuck', async () => {
  const stored = new Set(['3|2026-10-22']); // Friday 6/58 missing, and Sunday's draws due
  const { watcher, calls, clock } = setup({ at: '2026-10-25T21:15:00+08:00', stored });
  await watcher.tick();
  clock.now = new Date('2026-10-25T21:25:00+08:00');
  await watcher.tick();
  assert.equal(calls.length, 2);
});

test('after tonight\'s results arrive, an older missing draw is not re-asked right away', async () => {
  const stored = new Set(['3|2026-10-22']); // Friday 6/58 missing
  const { watcher, calls, clock } = setup({ at: '2026-10-25T21:15:00+08:00', stored });
  await watcher.tick(); // contacts PCSO for tonight (search also covers Friday)
  stored.add('3|2026-10-25');
  stored.add('5|2026-10-25');
  clock.now = new Date('2026-10-25T21:25:00+08:00');
  await watcher.tick();
  assert.equal(calls.length, 1);
});

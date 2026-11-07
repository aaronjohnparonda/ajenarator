'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parsePrizePage, parseTierValue, parseWinningNumbers, parseHeaderDate, prizePageUrl, createPrizeSourceClient,
} = require('../src/fetcher/prize-source');
const { checkPrizeBreakdown } = require('../src/ingest/prize-check');
const { createPrizeFetcher, fetchPrizesForDate, RECENT_RETRY_MS, STALE_RETRY_MS } = require('../src/ingest/prize-fetcher');
const { prizeForResult } = require('../src/services/pick-service');
const { mapPrizeColumns } = require('../src/repositories/prize-repository');
const { createResultWatcher } = require('../src/ingest/result-watcher');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'summitexpress-2026-11-03.html'), 'utf8');

// Official PCSO results for Nov 3, 2026 (sorted), as the draws table stores them.
const NOV3 = {
  '6/42': [8, 19, 27, 28, 35, 41],
  '6/49': [8, 19, 20, 22, 36, 44],
  '6/58': [1, 6, 14, 16, 27, 55],
};

// ---------- reading the page ----------

test('page address follows the daily pattern (no zero-padded day)', () => {
  assert.equal(prizePageUrl('2026-11-03'), 'https://www.thesummitexpress.com/2026/11/pcso-lotto-result-today-november-3-2026.html');
  assert.equal(prizePageUrl('2026-10-31'), 'https://www.thesummitexpress.com/2026/10/pcso-lotto-result-today-october-31-2026.html');
  assert.throws(() => prizePageUrl('2026-02-30'));
});

test('tier cells in every spacing seen on the site', () => {
  assert.deepEqual(parseTierValue('40 / ₱37,500.00'), { winners: 40, prizeCentavos: 3750000 });
  assert.deepEqual(parseTierValue('12/ ₱91,666.66'), { winners: 12, prizeCentavos: 9166666 });
  assert.deepEqual(parseTierValue('1400 / ₱928.57'), { winners: 1400, prizeCentavos: 92857 });
  assert.deepEqual(parseTierValue('18,567/ ₱50.00'), { winners: 18567, prizeCentavos: 5000 });
  assert.deepEqual(parseTierValue('3 / ₱1.5'), { winners: 3, prizeCentavos: 150 });
  assert.deepEqual(parseTierValue('0'), { winners: 0, prizeCentavos: null });
  assert.deepEqual(parseTierValue('0 / -'), { winners: 0, prizeCentavos: null });
  assert.deepEqual(parseTierValue('0 / ₱0.00'), { winners: 0, prizeCentavos: null });
  assert.equal(parseTierValue(''), null);
  assert.equal(parseTierValue('TBA'), null);
  assert.equal(parseTierValue('40 / ₱37,50.00'), null); // bad thousands grouping
});

test('winning numbers and header dates', () => {
  assert.deepEqual(parseWinningNumbers('16-55-01-06-27-14'), [1, 6, 14, 16, 27, 55]);
  assert.equal(parseWinningNumbers('16-55-01-06-27'), null);
  assert.equal(parseWinningNumbers(''), null);
  assert.equal(parseHeaderDate('November 3, 2026'), '2026-11-03');
  assert.equal(parseHeaderDate('Novembre 3, 2026'), null);
  assert.equal(parseHeaderDate('February 30, 2026'), null);
});

test('reads every 6-number game on the real page and ignores the other tables', () => {
  const games = parsePrizePage(FIXTURE, '2026-11-03');
  assert.deepEqual([...games.keys()].sort(), ['6/42', '6/49', '6/58']);
  const ultra = games.get('6/58');
  assert.deepEqual(ultra.numbers, NOV3['6/58']);
  assert.deepEqual(ultra.tiers, {
    5: { winners: 23, prizeCentavos: 6521739 },
    4: { winners: 1558, prizeCentavos: 89858 },
    3: { winners: 31621, prizeCentavos: 10000 },
  });
});

test('a table dated a different day is ignored', () => {
  assert.equal(parsePrizePage(FIXTURE, '2026-11-04').size, 0);
});

test('a table without the prize rows yet is "not ready", not an error', () => {
  const early = FIXTURE.replace('<td>2nd Prize (5 of 6)</td><td>23 / ₱65,217.39</td>', '<td>2nd Prize (5 of 6)</td><td></td>');
  const ultra = parsePrizePage(early, '2026-11-03').get('6/58');
  assert.match(ultra.notReady, /5-number/);
});

// ---------- the checks ----------

function fetchedFor(code) {
  return parsePrizePage(FIXTURE, '2026-11-03').get(code);
}

test('real Nov 3 breakdowns pass every check for all three games', () => {
  for (const code of ['6/42', '6/49', '6/58']) {
    const result = checkPrizeBreakdown({ gameCode: code, storedNumbers: NOV3[code], fetched: fetchedFor(code) });
    assert.equal(result.ok, true, `${code}: ${result.reason}`);
  }
  const result = checkPrizeBreakdown({ gameCode: '6/58', storedNumbers: NOV3['6/58'], fetched: fetchedFor('6/58') });
  assert.deepEqual(result.prizes.match5, { winners: 23, prizeCentavos: 6521739 });
});

test('rejected: winning numbers differ from PCSO', () => {
  const result = checkPrizeBreakdown({ gameCode: '6/58', storedNumbers: [1, 6, 14, 16, 27, 54], fetched: fetchedFor('6/58') });
  assert.equal(result.ok, false);
  assert.match(result.reason, /differ from PCSO/);
});

test('rejected: a pool that does not add up (typo in winners or amount)', () => {
  const fetched = fetchedFor('6/58');
  const typo = { ...fetched, tiers: { ...fetched.tiers, 5: { winners: 32, prizeCentavos: 6521739 } } };
  const result = checkPrizeBreakdown({ gameCode: '6/58', storedNumbers: NOV3['6/58'], fetched: typo });
  assert.equal(result.ok, false);
  assert.match(result.reason, /5 numbers/);

  // over the pool by a centavo is never allowed
  const over = { ...fetched, tiers: { ...fetched.tiers, 5: { winners: 23, prizeCentavos: 6521740 } } };
  assert.equal(checkPrizeBreakdown({ gameCode: '6/58', storedNumbers: NOV3['6/58'], fetched: over }).ok, false);
});

test('accepted: rounding down by up to 1 centavo per winner (19 x 57,894.73 of 1.1M)', () => {
  const fetched = {
    numbers: [21, 23, 25, 34, 36, 38],
    tiers: {
      5: { winners: 19, prizeCentavos: 5789473 },
      4: { winners: 549, prizeCentavos: 182149 },
      3: { winners: 10990, prizeCentavos: 2000 },
    },
  };
  assert.equal(checkPrizeBreakdown({ gameCode: '6/42', storedNumbers: [21, 23, 25, 34, 36, 38], fetched }).ok, true);
});

test('rejected: wrong fixed 3-number prize', () => {
  const fetched = fetchedFor('6/42');
  const wrong = { ...fetched, tiers: { ...fetched.tiers, 3: { winners: 17563, prizeCentavos: 2500 } } };
  const result = checkPrizeBreakdown({ gameCode: '6/42', storedNumbers: NOV3['6/42'], fetched: wrong });
  assert.equal(result.ok, false);
  assert.match(result.reason, /fixed 20.00/);
});

test('a tier nobody won is saved with no amount', () => {
  const fetched = fetchedFor('6/58');
  const none = { ...fetched, tiers: { ...fetched.tiers, 5: { winners: 0, prizeCentavos: 150000000 } } };
  const result = checkPrizeBreakdown({ gameCode: '6/58', storedNumbers: NOV3['6/58'], fetched: none });
  assert.equal(result.ok, true);
  assert.deepEqual(result.prizes.match5, { winners: 0, prizeCentavos: null });
});

// ---------- fetching and saving ----------

function fakeRepository(missing) {
  const saved = [];
  return {
    saved,
    async loadDrawsMissingPrizes() {
      const savedIds = new Set(saved.map((entry) => entry.drawId));
      return missing.filter((draw) => !savedIds.has(draw.drawId));
    },
    async savePrizes(db, entries) {
      saved.push(...entries);
      return entries.length;
    },
  };
}

const MISSING_NOV3 = [
  { drawId: 101, gameId: 1, gameCode: '6/42', drawDate: '2026-11-03', numbers: NOV3['6/42'] },
  { drawId: 102, gameId: 3, gameCode: '6/49', drawDate: '2026-11-03', numbers: NOV3['6/49'] },
  { drawId: 103, gameId: 5, gameCode: '6/58', drawDate: '2026-11-03', numbers: [1, 2, 3, 4, 5, 6] }, // wrong on purpose
];

test('saves the breakdowns that pass and logs the one that does not', async () => {
  const repository = fakeRepository(MISSING_NOV3);
  const client = { fetchDay: async (date) => ({ found: true, url: prizePageUrl(date), games: parsePrizePage(FIXTURE, date) }) };
  const outcome = await fetchPrizesForDate({
    db: null, client, drawDate: '2026-11-03', draws: MISSING_NOV3, prizes: repository,
  });
  assert.equal(outcome.saved, 2);
  assert.deepEqual(repository.saved.map((entry) => entry.drawId), [101, 102]);
  assert.equal(repository.saved[0].source, 'summitexpress');
  assert.equal(outcome.rejected.length, 1);
  assert.match(outcome.rejected[0], /6\/58 2026-11-03: winning numbers/);
});

test('timetable: one page per day, re-read every 15 min for recent draws, every 3 h for older', async () => {
  const repository = fakeRepository([
    { drawId: 1, gameId: 1, gameCode: '6/42', drawDate: '2026-11-03', numbers: NOV3['6/42'] },
    { drawId: 2, gameId: 5, gameCode: '6/58', drawDate: '2026-11-07', numbers: [1, 2, 3, 4, 5, 6] },
  ]);
  const requested = [];
  const clock = { now: new Date('2026-11-07T22:00:00+08:00') };
  const fetcher = createPrizeFetcher({
    pool: null,
    prizes: repository,
    pauseMs: 0,
    now: () => clock.now,
    log: () => {},
    createClient: () => ({ fetchDay: async (date) => { requested.push(date); return { found: false, url: prizePageUrl(date) }; } }),
  });

  await fetcher.run();
  assert.deepEqual(requested, ['2026-11-03', '2026-11-07']);

  clock.now = new Date(clock.now.getTime() + RECENT_RETRY_MS);
  await fetcher.run();
  assert.deepEqual(requested.slice(2), ['2026-11-07']); // tonight only

  clock.now = new Date(new Date('2026-11-07T22:00:00+08:00').getTime() + STALE_RETRY_MS);
  await fetcher.run();
  assert.deepEqual(requested.slice(3), ['2026-11-03', '2026-11-07']);
});

test('no request at all when every saved draw already has its breakdown', async () => {
  let created = 0;
  const fetcher = createPrizeFetcher({
    pool: null, prizes: fakeRepository([]), pauseMs: 0, log: () => {}, createClient: () => { created += 1; return {}; },
  });
  assert.deepEqual(await fetcher.run(), { checkedDates: 0, saved: 0 });
  assert.equal(created, 0);
});

test('a network failure is logged and does not throw', async () => {
  const logs = [];
  const fetcher = createPrizeFetcher({
    pool: null,
    prizes: fakeRepository(MISSING_NOV3.slice(0, 1)),
    pauseMs: 0,
    now: () => new Date('2026-11-03T23:00:00+08:00'),
    log: (message) => logs.push(message),
    createClient: () => ({ fetchDay: async () => { throw new Error('Could not reach Summit Express (ETIMEDOUT).'); } }),
  });
  await fetcher.run();
  assert.match(logs.join('\n'), /could not read Summit Express/);
});

test('HTTP client: 404 means "not posted", 403 is an error, sends our user agent', async () => {
  const seen = [];
  const make = (status, body = '') => createPrizeSourceClient({
    retryDelaysMs: [],
    fetchImpl: async (url, options) => {
      seen.push({ url, agent: options.headers['User-Agent'] });
      return { status, ok: status >= 200 && status < 300, text: async () => body };
    },
  });
  assert.deepEqual(await make(404).fetchDay('2026-11-03'), { found: false, url: prizePageUrl('2026-11-03') });
  await assert.rejects(make(403).fetchDay('2026-11-03'), /refused/);
  const mobile = createPrizeSourceClient({
    retryDelaysMs: [],
    fetchImpl: async (url) => ({ status: 200, ok: true, url: `${url}?m=1`, text: async () => FIXTURE }),
  });
  await assert.rejects(mobile.fetchDay('2026-11-03'), /robots\.txt/);
  const page = await make(200, FIXTURE).fetchDay('2026-11-03');
  assert.equal(page.games.size, 3);
  assert.match(seen[0].agent, /AJenarator/);
});

// ---------- the watcher runs prizes after results ----------

test('result watcher runs the prize fetcher after its PCSO step, and a prize failure changes nothing', async () => {
  const order = [];
  const timers = [];
  const watcher = createResultWatcher({
    pool: { query: async () => [[]] },
    loadGames: async () => [],
    runIngest: async () => { order.push('results'); return { status: 'success', inserted: 0 }; },
    prizeFetcher: { run: async () => { order.push('prizes'); throw new Error('boom'); } },
    now: () => new Date('2026-11-07T21:30:00+08:00'),
    log: () => {},
    setTimer: (callback, delay) => { timers.push(delay); return timers.length; },
    clearTimer: () => {},
  });
  watcher.start();
  await watcher.tick();
  assert.deepEqual(order, ['prizes']); // no games due, so PCSO was skipped; prizes still checked
  assert.equal(timers.at(-1), 2 * 60 * 1000); // normal rush-hour pace, not the failure backoff
  watcher.stop();
});

// ---------- what a pick won ----------

const PRIZES_NOV6_658 = mapPrizeColumns({
  p5w: 40, p5p: '37500.00', p4w: 2871, p4p: '487.63', p3w: 49957, p3p: '100.00',
});

test('maps the joined columns; null when no breakdown yet', () => {
  assert.deepEqual(PRIZES_NOV6_658[0], { matchCount: 5, winners: 40, prizeEach: '37500.00' });
  assert.equal(mapPrizeColumns({ p5w: null }), null);
});

test('prize for a pick: actual share when known, fixed 3-number amount, pending, jackpot', () => {
  assert.equal(prizeForResult('6/58', 2, PRIZES_NOV6_658), null);
  assert.deepEqual(prizeForResult('6/58', 5, PRIZES_NOV6_658), { status: 'won', amount: '37500.00', winners: 40 });
  assert.deepEqual(prizeForResult('6/58', 4, PRIZES_NOV6_658), { status: 'won', amount: '487.63', winners: 2871 });
  assert.deepEqual(prizeForResult('6/58', 3, null), { status: 'won', amount: '100.00', winners: null });
  assert.deepEqual(prizeForResult('6/42', 3, null), { status: 'won', amount: '20.00', winners: null });
  assert.deepEqual(prizeForResult('6/58', 5, null), { status: 'pending', amount: null, winners: null });
  assert.deepEqual(prizeForResult('6/58', 6, PRIZES_NOV6_658), { status: 'jackpot', amount: null, winners: null });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDrawNightService, parseDrawOrder, nightDateFor } = require('../src/services/draw-night-service');
const { createApp } = require('../src/app');

// Sunday 2026-10-25: 6/49 (Sun/Tue/Thu) and 6/58 (Sun/Tue/Fri) draw; 6/42 (Tue/Thu/Sat) does not.
const GAMES = [
  { id: 1, code: '6/42', name: 'Lotto 6/42', maxNumber: 42, drawTime: '21:00:00', drawDays: new Set([2, 4, 6]) },
  { id: 3, code: '6/49', name: 'Super Lotto 6/49', maxNumber: 49, drawTime: '21:00:00', drawDays: new Set([7, 2, 4]) },
  { id: 5, code: '6/58', name: 'Ultra Lotto 6/58', maxNumber: 58, drawTime: '21:00:00', drawDays: new Set([7, 2, 5]) },
];
const RESULT_649 = {
  drawDate: '2026-10-25', numbers: [7, 12, 33, 34, 38, 49], drawOrder: '49-38-12-07-33-34', jackpotAmount: '66732591.64', winners: 0,
};

function makeService({ at, draws = new Map(), picks = [] }) {
  const counters = { draws: 0, picks: 0 };
  const clock = { now: new Date(at) };
  const service = createDrawNightService({
    db: {},
    now: () => clock.now,
    loadGames: async () => GAMES,
    loadDraws: async () => { counters.draws += 1; return draws; },
    picks: { loadPicksFromDate: async () => { counters.picks += 1; return picks; } },
  });
  return { service, counters, clock };
}

test('draw order is parsed, and bad data falls back to the sorted numbers', () => {
  assert.deepEqual(parseDrawOrder('49-38-12-07-33-34', [7, 12, 33, 34, 38, 49]), [49, 38, 12, 7, 33, 34]);
  assert.deepEqual(parseDrawOrder('49-38-12', [7, 12, 33, 34, 38, 49]), [7, 12, 33, 34, 38, 49]);
  assert.deepEqual(parseDrawOrder('1-2-3-4-5-6', [7, 12, 33, 34, 38, 49]), [7, 12, 33, 34, 38, 49]);
});

test('the night switches at 6:00 AM Philippine time', () => {
  assert.equal(nightDateFor(new Date('2026-10-25T21:30:00+08:00')), '2026-10-25');
  assert.equal(nightDateFor(new Date('2026-10-26T01:30:00+08:00')), '2026-10-25');
  assert.equal(nightDateFor(new Date('2026-10-26T06:00:00+08:00')), '2026-10-26');
});

test('before 9 PM: tonight\'s games are upcoming; games not drawing tonight are left out', async () => {
  const { service } = makeService({ at: '2026-10-25T20:00:00+08:00' });
  const night = await service.getNight(null);
  assert.equal(night.nightDate, '2026-10-25');
  assert.deepEqual(night.games.map((game) => [game.gameCode, game.status]), [['6/49', 'upcoming'], ['6/58', 'upcoming']]);
  assert.equal(night.games[0].drawAt, '2026-10-25T13:00:00.000Z');
});

test('after 9 PM: drawing until the official result is saved, then result in draw order', async () => {
  const draws = new Map([[3, RESULT_649]]);
  const { service } = makeService({ at: '2026-10-25T21:20:00+08:00', draws });
  const night = await service.getNight(null);
  const [game649, game658] = night.games;
  assert.equal(game649.status, 'result');
  assert.deepEqual(game649.result.order, [49, 38, 12, 7, 33, 34]);
  assert.equal(game649.result.official, true);
  assert.equal(game658.status, 'drawing');
  assert.equal(game658.result, null);
});

test('picks are only looked up and returned for the signed-in owner', async () => {
  const picks = [
    { gameId: 3, drawDate: '2026-10-25', numbers: [7, 12, 20, 33, 40, 41] },
    { gameId: 1, drawDate: '2026-10-27', numbers: [1, 2, 3, 4, 5, 6] }, // later draw: ignored tonight
  ];
  const { service, counters } = makeService({ at: '2026-10-25T20:00:00+08:00', picks });
  let night = await service.getNight(null);
  assert.equal(counters.picks, 0);
  assert.equal(night.games[0].pick, null);

  night = await service.getNight({ id: 7 });
  assert.deepEqual(night.games[0].pick, { numbers: [7, 12, 20, 33, 40, 41] });
  assert.equal(night.games[1].pick, null);
});

test('tonight\'s draws are cached for 10 seconds to keep polling cheap', async () => {
  const { service, counters, clock } = makeService({ at: '2026-10-25T21:20:00+08:00' });
  await service.getNight(null);
  clock.now = new Date('2026-10-25T21:20:05+08:00');
  await service.getNight(null);
  assert.equal(counters.draws, 1);
  clock.now = new Date('2026-10-25T21:20:11+08:00');
  await service.getNight(null);
  assert.equal(counters.draws, 2);
});

test('GET /draw-night is public and not cached by browsers', async (t) => {
  const { service } = makeService({ at: '2026-10-25T20:00:00+08:00' });
  const server = createApp({ drawNightService: service }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/draw-night`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.data.signedIn, false);
  assert.equal(body.data.games.length, 2);
});

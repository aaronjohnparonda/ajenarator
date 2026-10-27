'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameService, DrawNotFoundError } = require('../src/services/game-service');
const { createApp } = require('../src/app');

// Oldest first, as the database returns them.
const DRAWS = [
  { draw_date: '2026-10-20', n1: 3, n2: 11, n3: 18, n4: 27, n5: 34, n6: 41 },
  { draw_date: '2026-10-22', n1: 3, n2: 11, n3: 18, n4: 27, n5: 35, n6: 40 }, // 4 shared with the previous draw
  { draw_date: '2026-10-24', n1: 1, n2: 2, n3: 3, n4: 4, n5: 5, n6: 6 }, // the classic sequence
  { draw_date: '2026-10-27', n1: 4, n2: 9, n3: 17, n4: 23, n5: 30, n6: 36 }, // ordinary
];

/** Stand-in database answering the three queries checkDraw needs. */
const fakeDb = {
  async query(sql) {
    if (sql.includes('GROUP_CONCAT')) {
      return [[{ id: 1, code: '6/42', name: 'Lotto 6/42', max_number: 42, pick_count: 6, draw_time: '21:00:00', draw_days: '2,4,6' }]];
    }
    if (sql.includes('MAX(draw_date)')) {
      return [[{ latest_date: DRAWS.at(-1).draw_date }]];
    }
    if (sql.includes('FROM draws WHERE game_id = ? ORDER BY draw_date')) {
      return [DRAWS];
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
};

test('an ordinary result is allowed by the default filters (latest draw by default)', async () => {
  const service = createGameService({ db: fakeDb });
  const result = await service.checkDraw({ slug: '6-42' });
  assert.equal(result.drawDate, '2026-10-27');
  assert.equal(result.allowed, true);
  assert.deepEqual(result.blockedBy, []);
});

test('1-2-3-4-5-6 is blocked, and every blocking rule is named', async () => {
  const service = createGameService({ db: fakeDb });
  const result = await service.checkDraw({ slug: '6-42', drawDate: '2026-10-24' });
  assert.equal(result.allowed, false);
  const rules = result.blockedBy.map((entry) => entry.rule);
  assert.ok(rules.includes('consecutive'));
  assert.ok(rules.includes('evenlySpaced'));
  assert.ok(result.blockedBy.every((entry) => typeof entry.label === 'string' && entry.label.length > 0));
});

test('"from the last draw" uses the draw just before; your own settings are respected', async () => {
  const service = createGameService({ db: fakeDb });
  let result = await service.checkDraw({ slug: '6-42', drawDate: '2026-10-22' });
  assert.deepEqual(result.blockedBy.map((entry) => entry.rule), ['lastDrawRepeat']);

  result = await service.checkDraw({ slug: '6-42', drawDate: '2026-10-22', filters: { lastDrawRepeat: { enabled: false } } });
  assert.equal(result.allowed, true);
});

test('a date with no draw is a clear not-found error', async () => {
  const service = createGameService({ db: fakeDb });
  await assert.rejects(service.checkDraw({ slug: '6-42', drawDate: '2026-10-21' }), DrawNotFoundError);
});

test('POST /check-draw validates input and maps errors', async (t) => {
  const service = createGameService({ db: fakeDb });
  const server = createApp({ gameService: service }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/games`;
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  let response = await post('/6-42/check-draw', { drawDate: '2026-10-24' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.allowed, false);

  response = await post('/6-42/check-draw', { drawDate: '2026-02-30' });
  assert.equal((await response.json()).error.code, 'INVALID_DATE');

  response = await post('/6-42/check-draw', { filters: 'strict' });
  assert.equal((await response.json()).error.code, 'INVALID_FILTERS');

  response = await post('/6-42/check-draw', { drawDate: '2026-10-21' });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'DRAW_NOT_FOUND');

  response = await post('/6-99/check-draw', {});
  assert.equal((await response.json()).error.code, 'GAME_NOT_FOUND');
});

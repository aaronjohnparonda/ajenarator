'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { GameNotFoundError } = require('../src/services/game-service');
const { FilterValidationError } = require('../src/engine/filters');
const { ImpossibleFiltersError } = require('../src/engine/generator');

const SAMPLE_GAME = {
  code: '6/42', slug: '6-42', name: 'Lotto 6/42', maxNumber: 42, drawDays: [2, 4, 6], drawTime: '21:00',
  defaultCoverageShare: 0.795,
  lastDraw: { drawDate: '2026-10-22', numbers: [5, 11, 24, 29, 33, 40], drawOrder: '29-05-40-11-33-24', jackpotAmount: '29935246.80', winners: 0 },
};

/** Stand-in service: records calls and lets each test decide the outcome. */
const fakeService = {
  calls: [],
  nextError: null,
  async listGames() {
    return [SAMPLE_GAME];
  },
  async getStats(slug) {
    if (slug !== '6-42') {
      throw new GameNotFoundError(slug);
    }
    return { gameCode: '6/42', totalDraws: 1612 };
  },
  async listDraws(slug, options) {
    this.calls.push({ slug, ...options });
    return { gameCode: '6/42', page: options.page, limit: options.limit, total: 1612, totalPages: 81, toDate: options.toDate, draws: [] };
  },
  async generate(request) {
    this.calls.push(request);
    if (this.nextError) {
      const error = this.nextError;
      this.nextError = null;
      throw error;
    }
    return { gameCode: '6/42', picks: [{ numbers: [3, 11, 18, 27, 34, 41], pattern: { sum: 134, oddCount: 4, lowCount: 3 } }], coverageShare: 0.795, filters: {} };
  },
};

let server;
let baseUrl;

test.before(async () => {
  server = createApp({ gameService: fakeService }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

const post = (path, body) => fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('GET /games returns the games with their last draw', async () => {
  const response = await fetch(`${baseUrl}/games`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(body, { success: true, data: { games: [SAMPLE_GAME] } });
});

test('POST generate passes slug, count and filters to the service', async () => {
  const response = await post('/games/6-42/generate', { count: 3, filters: { antiBirthday: { enabled: true } } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.picks.length, 1);
  assert.deepEqual(fakeService.calls.at(-1), { slug: '6-42', count: 3, filters: { antiBirthday: { enabled: true } } });
});

test('rejects a missing or out-of-range count before calling the service', async () => {
  const before = fakeService.calls.length;
  for (const body of [{}, { count: 0 }, { count: 11 }, { count: 2.5 }, { count: '3' }]) {
    const response = await post('/games/6-42/generate', body);
    assert.equal(response.status, 422, JSON.stringify(body));
    assert.equal((await response.json()).error.code, 'INVALID_COUNT');
  }
  assert.equal(fakeService.calls.length, before);
});

test('rejects non-object bodies and filters', async () => {
  let response = await post('/games/6-42/generate', '[1,2,3]');
  assert.equal(response.status, 422);
  response = await post('/games/6-42/generate', { count: 3, filters: 'strict' });
  assert.equal((await response.json()).error.code, 'INVALID_FILTERS');
});

test('maps service errors to clear 4xx responses', async () => {
  fakeService.nextError = new GameNotFoundError('6-99');
  let response = await post('/games/6-99/generate', { count: 1 });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'GAME_NOT_FOUND');

  fakeService.nextError = new FilterValidationError(['sumRange.min cannot be greater than sumRange.max.']);
  response = await post('/games/6-42/generate', { count: 1 });
  let body = await response.json();
  assert.equal(response.status, 422);
  assert.deepEqual(body.error.details, ['sumRange.min cannot be greater than sumRange.max.']);

  fakeService.nextError = new ImpossibleFiltersError(0, 1, 2000);
  response = await post('/games/6-42/generate', { count: 1 });
  body = await response.json();
  assert.equal(body.error.code, 'FILTERS_TOO_STRICT');
});

test('unexpected errors become a generic 500 with no internal details', async () => {
  fakeService.nextError = new Error('ECONNREFUSED 10.0.0.5:3306 secret-host');
  const originalLog = console.error;
  console.error = () => {};
  const response = await post('/games/6-42/generate', { count: 1 });
  console.error = originalLog;
  const text = await response.text();
  assert.equal(response.status, 500);
  assert.equal(text.includes('secret-host'), false);
  assert.equal(JSON.parse(text).error.code, 'SERVER_ERROR');
});

test('GET stats returns data, and 404 for an unknown game', async () => {
  let response = await fetch(`${baseUrl}/games/6-42/stats`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.totalDraws, 1612);
  response = await fetch(`${baseUrl}/games/6-99/stats`);
  assert.equal(response.status, 404);
});

test('GET draws uses defaults and passes valid paging and date', async () => {
  let response = await fetch(`${baseUrl}/games/6-42/draws`);
  assert.equal(response.status, 200);
  assert.deepEqual(fakeService.calls.at(-1), { slug: '6-42', page: 1, limit: 20, toDate: null });

  response = await fetch(`${baseUrl}/games/6-42/draws?page=3&limit=50&to=2020-03-31`);
  assert.equal(response.status, 200);
  assert.deepEqual(fakeService.calls.at(-1), { slug: '6-42', page: 3, limit: 50, toDate: '2020-03-31' });
});

test('GET draws rejects bad paging and dates', async () => {
  const cases = [
    ['page=0', 'INVALID_PAGE'], ['page=abc', 'INVALID_PAGE'], ['page=1&page=2', 'INVALID_PAGE'],
    ['limit=51', 'INVALID_LIMIT'], ['limit=-1', 'INVALID_LIMIT'],
    ['to=2025-02-30', 'INVALID_DATE'], ['to=yesterday', 'INVALID_DATE'],
  ];
  for (const [query, code] of cases) {
    const response = await fetch(`${baseUrl}/games/6-42/draws?${query}`);
    assert.equal(response.status, 422, query);
    assert.equal((await response.json()).error.code, code, query);
  }
});

test('generate is rate limited per visitor', async () => {
  let lastStatus = 200;
  for (let index = 0; index < 35 && lastStatus !== 429; index += 1) {
    lastStatus = (await post('/games/6-42/generate', { count: 1 })).status;
  }
  assert.equal(lastStatus, 429);
});

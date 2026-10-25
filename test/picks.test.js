'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { nextPickableDraw } = require('../src/picks/pick-window');
const { createPickService, validateNumbers } = require('../src/services/pick-service');
const { createAuthService } = require('../src/services/auth-service');
const { createApp } = require('../src/app');

// 6/42 draws Tue/Thu/Sat, 6/45 Mon/Wed/Fri, both at 9:00 PM Philippine time.
const GAMES = [
  { id: 1, code: '6/42', name: 'Lotto 6/42', maxNumber: 42, drawTime: '21:00:00', drawDays: new Set([2, 4, 6]) },
  { id: 2, code: '6/45', name: 'Mega Lotto 6/45', maxNumber: 45, drawTime: '21:00:00', drawDays: new Set([1, 3, 5]) },
];
const at = (isoWithOffset) => new Date(isoWithOffset);

// ---------- pick window ----------

test('next pickable draw follows the schedule and closes at 8:00 PM', () => {
  const game642 = GAMES[0];
  // Tuesday 2026-10-27
  assert.equal(nextPickableDraw(game642, at('2026-10-27T10:00:00+08:00')).drawDate, '2026-10-27');
  assert.equal(nextPickableDraw(game642, at('2026-10-27T19:59:59+08:00')).drawDate, '2026-10-27');
  assert.equal(nextPickableDraw(game642, at('2026-10-27T20:00:00+08:00')).drawDate, '2026-10-29');
  // Monday -> Tuesday; Saturday after lock -> next Tuesday
  assert.equal(nextPickableDraw(game642, at('2026-10-26T23:00:00+08:00')).drawDate, '2026-10-27');
  assert.equal(nextPickableDraw(game642, at('2026-10-31T20:30:00+08:00')).drawDate, '2026-11-03');

  const window = nextPickableDraw(game642, at('2026-10-27T10:00:00+08:00'));
  assert.equal(window.locksAt.toISOString(), '2026-10-27T12:00:00.000Z'); // 8:00 PM PH
  assert.equal(window.drawAt.toISOString(), '2026-10-27T13:00:00.000Z'); // 9:00 PM PH
});

test('the server clock time zone does not matter (UTC late evening is next PH day)', () => {
  // 2026-10-27 13:30 UTC = Tue 9:30 PM in Manila -> 6/42 Tuesday closed -> Thursday
  assert.equal(nextPickableDraw(GAMES[0], at('2026-10-27T13:30:00Z')).drawDate, '2026-10-29');
});

test('number validation', () => {
  assert.deepEqual(validateNumbers([1, 2, 3, 4, 5, 42], 42), []);
  assert.equal(validateNumbers([1, 2, 3, 4, 5], 42).length, 1);
  assert.equal(validateNumbers([1, 2, 3, 4, 5, 43], 42).length, 1);
  assert.equal(validateNumbers([1, 2, 3, 4, 5, 5], 42).length, 1);
  assert.equal(validateNumbers([1, 2, 3, 4, 5, 2.5], 42).length, 1);
  assert.equal(validateNumbers('1,2,3,4,5,6', 42).length, 1);
});

// ---------- in-memory stand-in for the pick repository ----------

function createMemoryRepository() {
  const rows = [];
  const draws = new Map(); // "gameId|date" -> numbers
  let nextId = 1;
  const withResult = (row) => ({ ...row, drawNumbers: draws.get(`${row.gameId}|${row.drawDate}`) || null });

  return {
    rows,
    draws,
    async insertPick(db, { userId, gameId, drawDate, numbers, source }) {
      if (rows.some((row) => row.userId === userId && row.gameId === gameId && row.drawDate === drawDate)) {
        const error = new Error('Duplicate entry');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      rows.push({ id: nextId, userId, gameId, drawDate, numbers, source, createdAt: '2026-10-27 10:00:00', resultSeenAt: null });
      nextId += 1;
      return nextId - 1;
    },
    async loadPickById(db, userId, id) {
      const row = rows.find((entry) => entry.userId === userId && entry.id === id);
      return row ? withResult(row) : null;
    },
    async loadPicksFromDate(db, userId, fromDate) {
      return rows.filter((row) => row.userId === userId && row.drawDate >= fromDate).map(withResult);
    },
    async loadPickHistory(db, userId, { limit, offset }) {
      const mine = rows.filter((row) => row.userId === userId)
        .sort((a, b) => b.drawDate.localeCompare(a.drawDate) || a.gameId - b.gameId);
      return { total: mine.length, picks: mine.slice(offset, offset + limit).map(withResult) };
    },
    async loadSettledPicks(db, userId) {
      return rows.filter((row) => row.userId === userId).map(withResult).filter((row) => row.drawNumbers);
    },
    async countPicks(db, userId) {
      return rows.filter((row) => row.userId === userId).length;
    },
    async markResultsSeen(db, userId, ids) {
      let count = 0;
      rows.forEach((row) => {
        if (row.userId === userId && ids.includes(row.id) && !row.resultSeenAt) {
          row.resultSeenAt = 'now';
          count += 1;
        }
      });
      return count;
    },
    async loadLatestDrawDates() {
      const latest = new Map();
      for (const key of draws.keys()) {
        const [gameId, date] = key.split('|');
        if ((latest.get(Number(gameId)) || '') < date) {
          latest.set(Number(gameId), date);
        }
      }
      return latest;
    },
  };
}

function makeService(clock, repository = createMemoryRepository()) {
  const service = createPickService({ db: {}, now: () => clock.now, picks: repository, loadGames: async () => GAMES });
  return { service, repository };
}

// ---------- service ----------

test('upcoming lists the next draw per game and the saved pick', async () => {
  const clock = { now: at('2026-10-27T10:00:00+08:00') }; // Tuesday morning
  const { service } = makeService(clock);
  let upcoming = await service.getUpcoming(7);
  assert.deepEqual(upcoming.map((entry) => [entry.gameCode, entry.drawDate, entry.pick]), [
    ['6/42', '2026-10-27', null],
    ['6/45', '2026-10-28', null],
  ]);

  await service.createPick(7, { gameCode: '6/42', drawDate: '2026-10-27', numbers: [40, 3, 18, 7, 22, 31], source: 'manual' });
  upcoming = await service.getUpcoming(7);
  assert.deepEqual(upcoming[0].pick.numbers, [3, 7, 18, 22, 31, 40]); // stored sorted
  assert.equal((await service.getUpcoming(8))[0].pick, null); // another user sees nothing
});

test('picks are final: a second pick for the same draw is refused', async () => {
  const clock = { now: at('2026-10-27T10:00:00+08:00') };
  const { service } = makeService(clock);
  const input = { gameCode: '6/42', drawDate: '2026-10-27', numbers: [1, 2, 3, 4, 5, 6], source: 'generator' };
  const saved = await service.createPick(7, input);
  assert.equal(saved.status, 'upcoming');
  await assert.rejects(service.createPick(7, { ...input, numbers: [7, 8, 9, 10, 11, 12] }), { name: 'PickExistsError' });
});

test('picks close at 8:00 PM and a stale draw date is refused, not moved', async () => {
  const clock = { now: at('2026-10-27T20:00:01+08:00') };
  const { service, repository } = makeService(clock);
  await assert.rejects(
    service.createPick(7, { gameCode: '6/42', drawDate: '2026-10-27', numbers: [1, 2, 3, 4, 5, 6], source: 'manual' }),
    (error) => error.name === 'PickClosedError' && /Thu, Oct 29/.test(error.message),
  );
  assert.equal(repository.rows.length, 0);
  // picking a later draw than the next one is refused too
  await assert.rejects(
    service.createPick(7, { gameCode: '6/42', drawDate: '2026-10-31', numbers: [1, 2, 3, 4, 5, 6], source: 'manual' }),
    { name: 'PickClosedError' },
  );
});

test('invalid input is rejected with clear details', async () => {
  const { service } = makeService({ now: at('2026-10-27T10:00:00+08:00') });
  await assert.rejects(
    service.createPick(7, { gameCode: '6/42', drawDate: '2026-10-27', numbers: [1, 2, 3, 4, 5, 50], source: 'robot' }),
    (error) => error.name === 'PickValidationError' && error.details.length === 2,
  );
  await assert.rejects(
    service.createPick(7, { gameCode: '6/99', drawDate: '2026-10-27', numbers: [1, 2, 3, 4, 5, 6], source: 'manual' }),
    { name: 'GameNotFoundError' },
  );
});

test('results: matching, waiting, no draw, record and pop-up', async () => {
  const clock = { now: at('2026-10-27T10:00:00+08:00') };
  const { service, repository } = makeService(clock);
  await service.createPick(7, { gameCode: '6/42', drawDate: '2026-10-27', numbers: [3, 7, 18, 22, 31, 40], source: 'manual' });
  await service.createPick(7, { gameCode: '6/45', drawDate: '2026-10-28', numbers: [1, 2, 3, 4, 5, 6], source: 'manual' });

  clock.now = at('2026-10-27T21:30:00+08:00'); // drawn, result not saved yet
  let history = await service.listHistory(7, { page: 1, limit: 20 });
  assert.equal(history.picks.find((pick) => pick.gameCode === '6/42').status, 'waiting');

  repository.draws.set('1|2026-10-27', [3, 9, 18, 25, 31, 41]);
  repository.draws.set('2|2026-10-30', [10, 11, 12, 13, 14, 15]); // Wed 28 was not held; Fri 30 was
  clock.now = at('2026-10-30T22:00:00+08:00');
  history = await service.listHistory(7, { page: 1, limit: 20 });
  const pick642 = history.picks.find((pick) => pick.gameCode === '6/42');
  assert.equal(pick642.status, 'result');
  assert.deepEqual(pick642.result.matched, [3, 18, 31]);
  assert.equal(pick642.result.matchCount, 3);
  assert.equal(history.picks.find((pick) => pick.gameCode === '6/45').status, 'no_draw');

  let summary = await service.getSummary(7);
  assert.deepEqual(summary.record, { totalPicks: 2, settled: 1, bestMatch: 3, threeOrMore: 1, distribution: [0, 0, 0, 1, 0, 0, 0] });
  assert.equal(summary.unseen.length, 1);

  assert.equal(await service.markSeen(7, [pick642.id]), 1);
  assert.equal(await service.markSeen(8, [pick642.id]), 0); // another user cannot touch it
  summary = await service.getSummary(7);
  assert.equal(summary.unseen.length, 0);
  await assert.rejects(service.markSeen(7, []), { name: 'PickValidationError' });
  await assert.rejects(service.markSeen(7, ['1']), { name: 'PickValidationError' });
});

test('empty record has no best match yet', async () => {
  const { service } = makeService({ now: at('2026-10-27T10:00:00+08:00') });
  const summary = await service.getSummary(7);
  assert.equal(summary.record.bestMatch, null);
  assert.deepEqual(summary.unseen, []);
});

// ---------- routes ----------

const SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';

async function startServer() {
  const authService = createAuthService({
    db: {},
    googleClientId: 'abc.apps.googleusercontent.com',
    ownerEmails: ['owner@example.com'],
    jwtSecret: SECRET,
    verifyGoogleIdToken: async () => ({ sub: 'g-1', email: 'owner@example.com', email_verified: true, name: 'Aaron' }),
    users: { upsertGoogleUser: async () => ({ id: 7, email: 'owner@example.com', name: 'Aaron', picture: null }) },
  });
  const { service } = makeService({ now: at('2026-10-27T10:00:00+08:00') });
  const server = createApp({ authService, pickService: service }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const signIn = await fetch(`${baseUrl}/auth/google`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: 'x' }),
  });
  const cookie = signIn.headers.get('set-cookie').split(';')[0];
  return { server, baseUrl, cookie };
}

test('picks API requires sign-in and enforces the rules over HTTP', async (t) => {
  const { server, baseUrl, cookie } = await startServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const call = (path, { method = 'GET', body, withCookie = true } = {}) => fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(withCookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  for (const path of ['/picks/upcoming', '/picks', '/picks/summary']) {
    const response = await call(path, { withCookie: false });
    assert.equal(response.status, 401, path);
    assert.equal((await response.json()).error.code, 'SIGN_IN_REQUIRED');
  }
  assert.equal((await call('/picks', { method: 'POST', body: {}, withCookie: false })).status, 401);

  let response = await call('/picks/upcoming');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).data.draws[0].drawDate, '2026-10-27');

  const pick = { gameCode: '6/42', drawDate: '2026-10-27', numbers: [3, 7, 18, 22, 31, 40], source: 'manual' };
  response = await call('/picks', { method: 'POST', body: pick });
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).data.pick.numbers, pick.numbers);

  response = await call('/picks', { method: 'POST', body: pick });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'PICK_EXISTS');

  response = await call('/picks', { method: 'POST', body: { ...pick, gameCode: '6/45', drawDate: '2026-10-27' } });
  assert.equal((await response.json()).error.code, 'PICK_CLOSED');

  response = await call('/picks', { method: 'POST', body: { ...pick, numbers: [1, 1, 2, 3, 4, 5] } });
  assert.equal(response.status, 422);

  response = await call('/picks', { method: 'POST', body: [1, 2] });
  assert.equal(response.status, 422);

  response = await call('/picks?page=0');
  assert.equal((await response.json()).error.code, 'INVALID_PAGE');

  response = await call('/picks?page=1&limit=5');
  assert.equal((await response.json()).data.total, 1);

  response = await call('/picks/seen', { method: 'POST', body: { ids: 'all' } });
  assert.equal(response.status, 422);
});

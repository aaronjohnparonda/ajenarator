'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPcsoClient, PcsoRequestError } = require('../src/fetcher/pcso-client');
const { PcsoPageChangedError } = require('../src/fetcher/parse-results');

const readFixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const SEARCH_FORM = readFixture('pcso-search-form.html');
const RESULTS_642 = readFixture('pcso-results-642-jan-2025.html');
const FIELD_PREFIX = 'ctl00$ctl00$cphContainer$cpContent$';

function fakeResponse(status, body, cookies = []) {
  const headers = new Headers(cookies.map((cookie) => ['set-cookie', cookie]));
  return { status, ok: status >= 200 && status < 300, headers, text: async () => body };
}

/** Fake PCSO server: GET returns the real search form, POST returns the real results page. */
function createFakePcso({ postResponses = [() => fakeResponse(200, RESULTS_642)] } = {}) {
  const calls = [];
  let postIndex = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options });
    if (options.method === 'GET') {
      return fakeResponse(200, SEARCH_FORM, ['ASP.NET_SessionId=abc123; path=/; HttpOnly']);
    }
    const respond = postResponses[Math.min(postIndex, postResponses.length - 1)];
    postIndex += 1;
    return respond();
  };
  return { fetchImpl, calls };
}

test('submits the real PCSO form fields and returns parsed rows', async () => {
  const fake = createFakePcso();
  const client = createPcsoClient({ fetchImpl: fake.fetchImpl, retryDelaysMs: [] });

  const { rows } = await client.search({ gameCode: '6/42', startDate: '2025-01-01', endDate: '2025-01-31' });
  assert.equal(rows.length, 13);

  const post = fake.calls.find((call) => call.method === 'POST');
  const fields = new URLSearchParams(post.body);
  assert.equal(fields.get(`${FIELD_PREFIX}ddlSelectGame`), '13'); // PCSO's ID for Lotto 6/42, read from the real form
  assert.equal(fields.get(`${FIELD_PREFIX}ddlStartMonth`), 'January');
  assert.equal(fields.get(`${FIELD_PREFIX}ddlStartDate`), '1');
  assert.equal(fields.get(`${FIELD_PREFIX}ddlStartYear`), '2025');
  assert.equal(fields.get(`${FIELD_PREFIX}ddlEndMonth`), 'January');
  assert.equal(fields.get(`${FIELD_PREFIX}ddlEndDay`), '31');
  assert.equal(fields.get(`${FIELD_PREFIX}ddlEndYear`), '2025');
  assert.equal(fields.get(`${FIELD_PREFIX}btnSearch`), 'Search Lotto');
  assert.ok(fields.get('__VIEWSTATE').length > 100);
  assert.equal(post.headers.Cookie, 'ASP.NET_SessionId=abc123');
});

test('uses "All Games" when no game is given', async () => {
  const fake = createFakePcso();
  const client = createPcsoClient({ fetchImpl: fake.fetchImpl, retryDelaysMs: [] });
  await client.search({ gameCode: null, startDate: '2026-10-21', endDate: '2026-10-24' });
  const fields = new URLSearchParams(fake.calls.find((call) => call.method === 'POST').body);
  assert.equal(fields.get(`${FIELD_PREFIX}ddlSelectGame`), '0');
});

test('retries a PCSO server error, then succeeds', async () => {
  const fake = createFakePcso({
    postResponses: [() => fakeResponse(503, 'Service Unavailable'), () => fakeResponse(200, RESULTS_642)],
  });
  const client = createPcsoClient({ fetchImpl: fake.fetchImpl, retryDelaysMs: [1] });
  const { rows } = await client.search({ gameCode: '6/42', startDate: '2025-01-01', endDate: '2025-01-31' });
  assert.equal(rows.length, 13);
});

test('does not retry when PCSO refuses the request (e.g. 403)', async () => {
  const fake = createFakePcso({ postResponses: [() => fakeResponse(403, 'Forbidden')] });
  const client = createPcsoClient({ fetchImpl: fake.fetchImpl, retryDelaysMs: [1, 1] });
  await assert.rejects(
    client.search({ gameCode: '6/42', startDate: '2025-01-01', endDate: '2025-01-31' }),
    (error) => error instanceof PcsoRequestError && error.retryable === false,
  );
  assert.equal(fake.calls.filter((call) => call.method === 'POST').length, 1);
});

test('refuses years PCSO does not offer, before sending the search', async () => {
  const fake = createFakePcso();
  const client = createPcsoClient({ fetchImpl: fake.fetchImpl, retryDelaysMs: [] });
  await assert.rejects(client.search({ gameCode: '6/42', startDate: '2015-01-01', endDate: '2015-12-31' }), /does not offer results for 2015/);
  assert.equal(fake.calls.filter((call) => call.method === 'POST').length, 0);
});

test('stops when the search form structure changes', async () => {
  const client = createPcsoClient({ fetchImpl: async () => fakeResponse(200, '<html>Under maintenance</html>'), retryDelaysMs: [] });
  await assert.rejects(client.search({ gameCode: '6/42', startDate: '2025-01-01', endDate: '2025-01-31' }), PcsoPageChangedError);
});

test('rejects an invalid date range', async () => {
  const client = createPcsoClient({ fetchImpl: async () => fakeResponse(200, SEARCH_FORM), retryDelaysMs: [] });
  await assert.rejects(client.search({ gameCode: '6/42', startDate: '2025-02-01', endDate: '2025-01-01' }), /Invalid search range/);
});

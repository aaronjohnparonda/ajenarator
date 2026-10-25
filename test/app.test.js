'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

let server;
let baseUrl;

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('health check returns the standard JSON shape', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: { status: 'ok' } });
});

test('unknown API endpoints return JSON 404, not the website', async () => {
  const response = await fetch(`${baseUrl}/api/v1/nope`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'NOT_FOUND');
});

test('malformed JSON gets a clear 400 without internal details', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"broken": ',
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_JSON');
  assert.equal(JSON.stringify(body).includes('SyntaxError'), false);
});

test('serves the app with strict security headers', async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>AJenarator<\/title>/);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('serves the stylesheet and scripts', async () => {
  for (const file of ['/css/main.css', '/css/tokens.css', '/js/app.js', '/js/screens/generate.js']) {
    const response = await fetch(`${baseUrl}${file}`);
    assert.equal(response.status, 200, file);
  }
});

test('ip-check is off by default and reports the proxy-resolved IP when on', async () => {
  const { createApp: build } = require('../src/app');
  const off = build().listen(0);
  await new Promise((resolve) => off.once('listening', resolve));
  let response = await fetch(`http://127.0.0.1:${off.address().port}/api/v1/ip-check`);
  assert.equal(response.status, 404);
  await new Promise((resolve) => off.close(resolve));

  const on = build({ hosting: { trustProxyHops: 2, showIpCheck: true } }).listen(0);
  await new Promise((resolve) => on.once('listening', resolve));
  response = await fetch(`http://127.0.0.1:${on.address().port}/api/v1/ip-check`, {
    headers: { 'X-Forwarded-For': '203.0.113.7, 10.0.0.2' },
  });
  const body = await response.json();
  assert.equal(body.data.seenIp, '203.0.113.7');
  assert.equal(body.data.trustProxyHops, 2);
  await new Promise((resolve) => on.close(resolve));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const { createAuthService, AuthError } = require('../src/services/auth-service');
const { readCookie } = require('../src/middleware/session');

const SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';
const OWNER = 'owner@example.com';

/** Stand-in for Google: maps fake credentials to payloads. */
const GOOGLE_TOKENS = {
  'good-owner': { sub: 'g-1', email: 'Owner@Example.com', email_verified: true, name: 'Aaron', picture: 'https://lh3.googleusercontent.com/a/photo' },
  'stranger': { sub: 'g-2', email: 'someone@example.com', email_verified: true, name: 'Someone' },
  'unverified': { sub: 'g-3', email: OWNER, email_verified: false },
};

async function fakeVerify(credential) {
  if (credential === 'google-down') {
    throw new AuthError('GOOGLE_UNAVAILABLE', "Couldn't reach Google.");
  }
  const payload = GOOGLE_TOKENS[credential];
  if (!payload) {
    throw new AuthError('INVALID_CREDENTIAL', 'Google sign-in could not be confirmed. Please try again.');
  }
  return payload;
}

const savedUsers = [];
const fakeUsers = {
  async upsertGoogleUser(db, profile) {
    savedUsers.push(profile);
    return { id: 7, email: profile.email, name: profile.name, picture: profile.picture };
  },
};

function makeService(overrides = {}) {
  return createAuthService({
    db: {},
    googleClientId: 'abc.apps.googleusercontent.com',
    ownerEmails: [OWNER],
    jwtSecret: SECRET,
    verifyGoogleIdToken: fakeVerify,
    users: fakeUsers,
    ...overrides,
  });
}

// ---------- service ----------

test('owner signs in: email lowercased, user saved, session verifies', async () => {
  const service = makeService();
  const { user, sessionToken } = await service.signInWithGoogle('good-owner');
  assert.equal(user.email, OWNER);
  assert.equal(savedUsers.at(-1).googleSub, 'g-1');
  assert.deepEqual(service.verifySession(sessionToken), { id: 7, email: OWNER, name: 'Aaron', picture: 'https://lh3.googleusercontent.com/a/photo' });
});

test('rejects strangers, unverified emails, bad and oversized credentials', async () => {
  const service = makeService();
  const codeOf = (promise) => promise.then(() => 'OK', (error) => error.code);
  assert.equal(await codeOf(service.signInWithGoogle('stranger')), 'NOT_OWNER');
  assert.equal(await codeOf(service.signInWithGoogle('unverified')), 'EMAIL_NOT_VERIFIED');
  assert.equal(await codeOf(service.signInWithGoogle('made-up')), 'INVALID_CREDENTIAL');
  assert.equal(await codeOf(service.signInWithGoogle('')), 'INVALID_CREDENTIAL');
  assert.equal(await codeOf(service.signInWithGoogle({ credential: 'x' })), 'INVALID_CREDENTIAL');
  assert.equal(await codeOf(service.signInWithGoogle('x'.repeat(5000))), 'INVALID_CREDENTIAL');
});

test('non-https pictures are dropped', async () => {
  GOOGLE_TOKENS['http-photo'] = { sub: 'g-4', email: OWNER, email_verified: true, picture: 'http://evil.example/p.png' };
  const { user } = await makeService().signInWithGoogle('http-photo');
  assert.equal(user.picture, null);
});

test('sessions fail when tampered, expired, wrongly signed, using another algorithm, or owner removed', async () => {
  const service = makeService();
  const { sessionToken } = await service.signInWithGoogle('good-owner');

  const [header, payload, signature] = sessionToken.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), sub: '1' })).toString('base64url');
  assert.equal(service.verifySession(`${header}.${forgedPayload}.${signature}`), null);

  const claims = { email: OWNER, name: 'Aaron' };
  const options = { subject: '7', issuer: 'ajenarator', audience: 'ajenarator-web' };
  assert.equal(service.verifySession(jwt.sign(claims, SECRET, { ...options, expiresIn: -10 })), null);
  assert.equal(service.verifySession(jwt.sign(claims, 'some-other-secret-of-sufficient-length!!', options)), null);
  assert.equal(service.verifySession(jwt.sign(claims, SECRET, { ...options, algorithm: 'HS512' })), null);
  assert.equal(service.verifySession(jwt.sign(claims, SECRET, { ...options, audience: 'other' })), null);
  assert.equal(service.verifySession(jwt.sign(claims, SECRET, options)).id, 7);

  assert.equal(service.verifySession(null), null);
  assert.equal(service.verifySession('garbage'), null);
  assert.equal(makeService({ ownerEmails: ['new-owner@example.com'] }).verifySession(sessionToken), null);
});

test('readCookie finds one cookie and survives junk', () => {
  assert.equal(readCookie('a=1; aj_session=xyz; b=2', 'aj_session'), 'xyz');
  assert.equal(readCookie('aj_session_old=1', 'aj_session'), null);
  assert.equal(readCookie('aj_session=%E0%A4%A', 'aj_session'), null);
  assert.equal(readCookie(undefined, 'aj_session'), null);
});

// ---------- routes ----------

async function startServer(authService) {
  const server = createApp({ authService }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test('sign-in flow over HTTP: config, sign in, me, sign out', async (t) => {
  const { server, baseUrl } = await startServer(makeService());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  let response = await fetch(`${baseUrl}/api/v1/auth/config`);
  assert.deepEqual((await response.json()).data, { enabled: true, googleClientId: 'abc.apps.googleusercontent.com' });
  assert.equal(response.headers.get('cache-control'), 'no-store');

  response = await fetch(`${baseUrl}/api/v1/auth/me`);
  assert.deepEqual((await response.json()).data, { user: null });

  response = await fetch(`${baseUrl}/api/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ credential: 'good-owner' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data.user, { email: OWNER, name: 'Aaron', picture: 'https://lh3.googleusercontent.com/a/photo' });
  assert.equal('id' in body.data.user, false);

  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /^aj_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Max-Age=2592000/);
  assert.doesNotMatch(setCookie, /Secure/); // plain HTTP in tests; Render (HTTPS) gets Secure
  const cookie = setCookie.split(';')[0];

  response = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: cookie } });
  assert.equal((await response.json()).data.user.email, OWNER);

  response = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
  assert.match(response.headers.get('set-cookie'), /aj_session=;.*Expires=Thu, 01 Jan 1970/);
});

test('sign-in errors map to clear statuses', async (t) => {
  const { server, baseUrl } = await startServer(makeService());
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const signIn = (credential) => fetch(`${baseUrl}/api/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });

  for (const [credential, status, code] of [
    ['stranger', 403, 'NOT_OWNER'],
    ['unverified', 403, 'EMAIL_NOT_VERIFIED'],
    ['made-up', 401, 'INVALID_CREDENTIAL'],
    ['google-down', 503, 'GOOGLE_UNAVAILABLE'],
  ]) {
    const response = await signIn(credential);
    assert.equal(response.status, status, credential);
    assert.equal((await response.json()).error.code, code, credential);
    assert.equal(response.headers.get('set-cookie'), null, credential);
  }
});

test('POSTs from another website are refused', async (t) => {
  const { server, baseUrl } = await startServer(makeService());
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${baseUrl}/api/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ credential: 'good-owner' }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'CROSS_SITE_REQUEST');
});

test('with sign-in not configured, the site still works and says so', async (t) => {
  const { server, baseUrl } = await startServer(null);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  let response = await fetch(`${baseUrl}/api/v1/auth/config`);
  assert.deepEqual((await response.json()).data, { enabled: false, googleClientId: null });
  response = await fetch(`${baseUrl}/api/v1/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'AUTH_DISABLED');
});

test('security headers allow Google sign-in and nothing broader', async (t) => {
  const { server, baseUrl } = await startServer(null);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${baseUrl}/api/v1/health`);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client;/);
  assert.match(csp, /frame-src https:\/\/accounts\.google\.com\/gsi\/(;|$)/);
  assert.match(csp, /connect-src 'self' https:\/\/accounts\.google\.com\/gsi\/(;|$)/);
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

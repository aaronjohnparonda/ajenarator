/**
 * Client for the AJenarator API (/api/v1). Every response is
 * { success, data } or { success: false, error: { code, message, details? } }.
 */

const BASE_URL = '/api/v1';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the message is written for people (validation, limits, sign-in) and safe to show as-is. */
  get isUserFacing() {
    return [401, 403, 404, 422, 429, 503].includes(this.status) && this.code !== 'BAD_RESPONSE';
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach AJenarator. Check your connection.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('The server sent an unexpected response.', { status: response.status, code: 'BAD_RESPONSE' });
  }

  if (!response.ok || !payload.success) {
    const error = payload && payload.error ? payload.error : {};
    throw new ApiError(error.message || 'Something went wrong.', {
      status: response.status,
      code: error.code || 'UNKNOWN',
      details: error.details || null,
    });
  }
  return payload.data;
}

function slugForCode(gameCode) {
  return gameCode.replace('/', '-');
}

/** All games with schedule, default coverage and last draw. */
export async function fetchGames() {
  const data = await request('/games');
  return data.games;
}

/** Frequency, hot/cold, gaps and distributions for one game. */
export async function fetchStats(gameCode) {
  return request(`/games/${encodeURIComponent(slugForCode(gameCode))}/stats`);
}

/** One page of draw history, newest first. toDate ("YYYY-MM-DD") limits to draws on or before it. */
export async function fetchDraws(gameCode, { page = 1, limit = 20, toDate = null } = {}) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (toDate) {
    query.set('to', toDate);
  }
  return request(`/games/${encodeURIComponent(slugForCode(gameCode))}/draws?${query}`);
}

/** Backtest filter settings against every past draw of the game. */
export async function backtestFilters(gameCode, filters) {
  return request(`/games/${encodeURIComponent(slugForCode(gameCode))}/backtest`, {
    method: 'POST',
    body: { filters },
  });
}

/** @returns {Promise<{ gameCode, picks: Array<{numbers, pattern}>, coverageShare, filters }>} */
export async function generatePicks({ gameCode, count, filters }) {
  return request(`/games/${encodeURIComponent(slugForCode(gameCode))}/generate`, {
    method: 'POST',
    body: filters === undefined ? { count } : { count, filters },
  });
}

/** { enabled, googleClientId } - whether Google sign-in is set up on this server. */
export async function fetchAuthConfig() {
  return request('/auth/config');
}

/** The signed-in owner ({ email, name, picture }) or null. */
export async function fetchCurrentUser() {
  const data = await request('/auth/me');
  return data.user;
}

/** Exchanges Google's ID token for a session cookie. Returns the user. */
export async function signInWithGoogle(credential) {
  const data = await request('/auth/google', { method: 'POST', body: { credential } });
  return data.user;
}

export async function signOut() {
  return request('/auth/logout', { method: 'POST', body: {} });
}

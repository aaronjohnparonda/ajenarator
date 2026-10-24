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

  /** True when the message is written for people (validation, limits) and safe to show as-is. */
  get isUserFacing() {
    return this.status === 404 || this.status === 422 || this.status === 429;
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

/** @returns {Promise<{ gameCode, picks: Array<{numbers, pattern}>, coverageShare, filters }>} */
export async function generatePicks({ gameCode, count, filters }) {
  return request(`/games/${encodeURIComponent(slugForCode(gameCode))}/generate`, {
    method: 'POST',
    body: filters === undefined ? { count } : { count, filters },
  });
}

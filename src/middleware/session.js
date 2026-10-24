'use strict';

/**
 * Session helpers shared by the API:
 *   - attachUser: reads the session cookie and sets req.user (or null) on every API request.
 *   - requireOwner: blocks a route unless req.user is set (used by My Picks next).
 *   - requireSameOrigin: rejects state-changing requests sent from another website (CSRF defence,
 *     on top of the SameSite=Strict cookie).
 */

const SESSION_COOKIE = 'aj_session';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sendError(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

/** Minimal cookie header parser: returns the value of one cookie, or null. */
function readCookie(cookieHeader, name) {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) {
    return null;
  }
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      const rawValue = part.slice(separator + 1).trim();
      try {
        return decodeURIComponent(rawValue);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function createAttachUser(authService) {
  return function attachUser(req, res, next) {
    req.user = authService ? authService.verifySession(readCookie(req.headers.cookie, SESSION_COOKIE)) : null;
    next();
  };
}

function requireOwner(req, res, next) {
  if (!req.user) {
    return sendError(res, 401, 'SIGN_IN_REQUIRED', 'Sign in as the owner to do this.');
  }
  return next();
}

/**
 * Browsers send an Origin header with cross-site POSTs. If it is present it must match this site.
 * Requests without one (curl, server-to-server) carry no browser cookies by accident, so they pass.
 */
function requireSameOrigin(req, res, next) {
  if (!UNSAFE_METHODS.has(req.method)) {
    return next();
  }
  const origin = req.get('origin');
  if (origin === undefined) {
    return next();
  }
  const expected = `${req.protocol}://${req.get('host')}`;
  if (origin !== expected) {
    return sendError(res, 403, 'CROSS_SITE_REQUEST', 'This request must come from the AJenarator site.');
  }
  return next();
}

/** Cookie options. secure follows the actual connection (HTTPS on Render, HTTP on localhost). */
function sessionCookieOptions(req, maxAgeMs) {
  const options = {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'strict',
    path: '/',
  };
  if (maxAgeMs !== undefined) {
    options.maxAge = maxAgeMs;
  }
  return options;
}

module.exports = {
  SESSION_COOKIE,
  readCookie,
  createAttachUser,
  requireOwner,
  requireSameOrigin,
  sessionCookieOptions,
};

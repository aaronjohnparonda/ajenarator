'use strict';

/**
 * Sign-in API (all under /api/v1):
 *   GET  /auth/config   { enabled, googleClientId } - what the browser needs to show Google's button
 *   GET  /auth/me       { user } - the signed-in owner, or null
 *   POST /auth/google   body { "credential": "<Google ID token>" } - signs in, sets the session cookie
 *   POST /auth/logout   clears the session cookie
 *
 * If sign-in isn't configured (no GOOGLE_CLIENT_ID etc.), config says enabled:false, me returns
 * null, and /auth/google answers 503 AUTH_DISABLED.
 */

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { AuthError } = require('../services/auth-service');
const { SESSION_COOKIE, sessionCookieOptions } = require('../middleware/session');

const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
const SIGN_IN_ATTEMPTS_PER_WINDOW = 20;

const AUTH_ERROR_STATUS = {
  INVALID_CREDENTIAL: 401,
  EMAIL_NOT_VERIFIED: 403,
  NOT_OWNER: 403,
  GOOGLE_UNAVAILABLE: 503,
};

function sendError(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

function publicUser(user) {
  return user ? { email: user.email, name: user.name, picture: user.picture } : null;
}

function createAuthRouter({ authService }) {
  const router = express.Router();

  const signInLimiter = rateLimit({
    windowMs: SIGN_IN_WINDOW_MS,
    limit: SIGN_IN_ATTEMPTS_PER_WINDOW,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => sendError(res, 429, 'TOO_MANY_REQUESTS', 'Too many sign-in attempts. Wait a few minutes and try again.'),
  });

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/config', (req, res) => {
    res.json({
      success: true,
      data: { enabled: Boolean(authService), googleClientId: authService ? authService.googleClientId : null },
    });
  });

  router.get('/me', (req, res) => {
    res.json({ success: true, data: { user: publicUser(req.user) } });
  });

  router.post('/google', signInLimiter, async (req, res) => {
    if (!authService) {
      return sendError(res, 503, 'AUTH_DISABLED', "Sign-in isn't set up on this server.");
    }
    const credential = req.body && typeof req.body === 'object' ? req.body.credential : undefined;
    try {
      const { user, sessionToken } = await authService.signInWithGoogle(credential);
      res.cookie(SESSION_COOKIE, sessionToken, sessionCookieOptions(req, authService.sessionMaxAgeMs));
      return res.json({ success: true, data: { user: publicUser(user) } });
    } catch (error) {
      if (error instanceof AuthError) {
        return sendError(res, AUTH_ERROR_STATUS[error.code] || 401, error.code, error.message);
      }
      throw error;
    }
  });

  router.post('/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(req));
    res.json({ success: true, data: { signedOut: true } });
  });

  return router;
}

module.exports = { createAuthRouter };

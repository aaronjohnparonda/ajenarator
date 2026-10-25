'use strict';

/**
 * Builds the Express app (separate from server.js so tests can start it on any port).
 *
 * - Serves the website from public/.
 * - JSON API under /api/v1 (more endpoints are added in the "connect to the engine" step).
 * - Security headers via Helmet, with a strict Content Security Policy: scripts, styles and
 *   data only from this site, plus Google Fonts for typography and Google's sign-in button
 *   (accounts.google.com/gsi, as Google documents for "Sign in with Google").
 * - Errors never expose stack traces or internal details to visitors.
 */

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { createApiRouter } = require('./routes/api');
const { createAuthRouter } = require('./routes/auth');
const { createPicksRouter } = require('./routes/picks');
const { createDrawNightRouter } = require('./routes/draw-night');
const { createAttachUser, requireSameOrigin } = require('./middleware/session');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const JSON_BODY_LIMIT = '10kb';
const GOOGLE_SIGN_IN = 'https://accounts.google.com/gsi/';
// Profile photos returned by Google sign-in.
const GOOGLE_PHOTOS = 'https://*.googleusercontent.com';

function sendError(res, status, code, message) {
  res.status(status).json({ success: false, error: { code, message } });
}

/**
 * @param {object} [dependencies]
 * @param {object} [dependencies.gameService] - from createGameService(); tests pass a stand-in
 * @param {object} [dependencies.authService] - from createAuthService(); omitted = sign-in off
 * @param {object} [dependencies.pickService] - from createPickService(); needs sign-in
 * @param {object} [dependencies.drawNightService] - from createDrawNightService()
 * @param {object} [dependencies.hosting] - { trustProxyHops, showIpCheck } from config
 */
function createApp({
  gameService, authService, pickService, drawNightService, hosting = {},
} = {}) {
  const { trustProxyHops = 1, showIpCheck = false } = hosting;
  const app = express();
  app.disable('x-powered-by');
  // Number of proxies in front of the app (host-specific), so req.ip is the visitor's real IP.
  app.set('trust proxy', trustProxyHops);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", `${GOOGLE_SIGN_IN}client`],
        styleSrc: ["'self'", 'https://fonts.googleapis.com', `${GOOGLE_SIGN_IN}style`],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', GOOGLE_PHOTOS],
        connectSrc: ["'self'", GOOGLE_SIGN_IN],
        frameSrc: [GOOGLE_SIGN_IN],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    // Google's sign-in popup must be able to report back to this page.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    // Google's button checks which site it is on; this sends only the origin, never full URLs.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.get('/api/v1/health', (req, res) => {
    res.json({ success: true, data: { status: 'ok' } });
  });

  // TEMPORARY measuring aid (off unless SHOW_IP_CHECK=true): shows the IP the app sees for you
  // and the proxy chain, to set TRUST_PROXY_HOPS correctly. Turn it off again afterwards.
  if (showIpCheck) {
    app.get('/api/v1/ip-check', (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json({
        success: true,
        data: { seenIp: req.ip, trustProxyHops, forwardedFor: req.get('x-forwarded-for') || null },
      });
    });
  }

  app.use('/api', requireSameOrigin, createAttachUser(authService));
  app.use('/api/v1/auth', createAuthRouter({ authService }));
  if (pickService) {
    app.use('/api/v1/picks', createPicksRouter({ pickService }));
  }
  if (drawNightService) {
    app.use('/api/v1/draw-night', createDrawNightRouter({ drawNightService }));
  }

  if (gameService) {
    app.use('/api/v1', createApiRouter({ gameService }));
  }

  app.use('/api', (req, res) => sendError(res, 404, 'NOT_FOUND', 'That endpoint does not exist.'));

  app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

  // Malformed JSON bodies and any unexpected error end here.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') {
      return sendError(res, 400, 'INVALID_JSON', 'The request body is not valid JSON.');
    }
    if (error.type === 'entity.too.large') {
      return sendError(res, 413, 'TOO_LARGE', 'The request body is too large.');
    }
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} failed:`, error);
    return sendError(res, 500, 'SERVER_ERROR', 'Something went wrong on our side. Try again in a moment.');
  });

  return app;
}

module.exports = { createApp };

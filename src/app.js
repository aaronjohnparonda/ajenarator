'use strict';

/**
 * Builds the Express app (separate from server.js so tests can start it on any port).
 *
 * - Serves the website from public/.
 * - JSON API under /api/v1 (more endpoints are added in the "connect to the engine" step).
 * - Security headers via Helmet, with a strict Content Security Policy: scripts, styles and
 *   data only from this site, plus Google Fonts for typography.
 * - Errors never expose stack traces or internal details to visitors.
 */

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const JSON_BODY_LIMIT = '10kb';

function sendError(res, status, code, message) {
  res.status(status).json({ success: false, error: { code, message } });
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Render (and most hosts) put one proxy in front of the app; needed for correct client IPs.
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));

  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.get('/api/v1/health', (req, res) => {
    res.json({ success: true, data: { status: 'ok' } });
  });

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

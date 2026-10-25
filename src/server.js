'use strict';

/**
 * AJenarator web server.
 *   npm start      run normally
 *   npm run dev    restart automatically when a file changes (for development)
 *
 * PORT comes from the environment (Render sets it); defaults to 3000 locally.
 * Database settings come from .env locally, or the host's environment variables.
 */

const { createApp } = require('./app');
const { pool, closePool } = require('./db/pool');
const { createGameService } = require('./services/game-service');
const { createAuthService } = require('./services/auth-service');
const { createPickService } = require('./services/pick-service');
const config = require('./config/env');

const DEFAULT_PORT = 3000;
const SHUTDOWN_TIMEOUT_MS = 10000;
const port = Number(process.env.PORT) || DEFAULT_PORT;

const authService = config.auth ? createAuthService({ db: pool, ...config.auth }) : null;
if (!authService) {
  console.warn('Google sign-in is off: set GOOGLE_CLIENT_ID, OWNER_EMAILS and JWT_SECRET to turn it on.');
}

// My Picks belong to a signed-in owner, so they are only available when sign-in is on.
const pickService = authService ? createPickService({ db: pool }) : null;

const app = createApp({
  gameService: createGameService({ db: pool }),
  authService,
  pickService,
  hosting: config.hosting,
});
if (config.hosting.showIpCheck) {
  console.warn('SHOW_IP_CHECK is on: /api/v1/ip-check is public. Turn it off after measuring.');
}

const server = app.listen(port, () => {
  console.log(`AJenarator is running at http://localhost:${port}`);
});

function shutDown(signal) {
  console.log(`${signal} received: shutting down.`);
  server.close(async () => {
    await closePool().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', () => shutDown('SIGTERM'));
process.on('SIGINT', () => shutDown('SIGINT'));

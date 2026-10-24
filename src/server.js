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

const DEFAULT_PORT = 3000;
const SHUTDOWN_TIMEOUT_MS = 10000;
const port = Number(process.env.PORT) || DEFAULT_PORT;

const app = createApp({ gameService: createGameService({ db: pool }) });

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

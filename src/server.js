'use strict';

/**
 * AJenarator web server.
 *   npm start      run normally
 *   npm run dev    restart automatically when a file changes (for development)
 *
 * PORT comes from the environment (Render sets it); defaults to 3000 locally.
 */

const { createApp } = require('./app');

const DEFAULT_PORT = 3000;
const port = Number(process.env.PORT) || DEFAULT_PORT;

const server = createApp().listen(port, () => {
  console.log(`AJenarator is running at http://localhost:${port}`);
});

function shutDown(signal) {
  console.log(`${signal} received: shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutDown('SIGTERM'));
process.on('SIGINT', () => shutDown('SIGINT'));

'use strict';

/**
 * Single shared MySQL connection pool for the whole app.
 *
 * - TLS is required and the server certificate is verified against Aiven's CA.
 * - Every connection uses Philippine time (+08:00) so NOW() and CURDATE() match draw dates.
 * - DATE/DATETIME values are returned as plain strings ("2026-10-24") to avoid
 *   JavaScript Date time-zone shifts turning one draw date into the previous day.
 */

const mysql = require('mysql2');
const config = require('../config/env');

const PHILIPPINE_TIME_ZONE = '+08:00';
const POOL_CONNECTION_LIMIT = 5;

function buildConnectionOptions(overrides = {}) {
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    ssl: {
      ca: config.db.caCertificate,
      rejectUnauthorized: true,
    },
    timezone: PHILIPPINE_TIME_ZONE,
    dateStrings: true,
    charset: 'utf8mb4',
    connectTimeout: 20000,
    ...overrides,
  };
}

const corePool = mysql.createPool(
  buildConnectionOptions({
    waitForConnections: true,
    connectionLimit: POOL_CONNECTION_LIMIT,
    queueLimit: 0,
    enableKeepAlive: true,
  }),
);

corePool.on('connection', (connection) => {
  connection.query(`SET time_zone = '${PHILIPPINE_TIME_ZONE}'`);
});

const pool = corePool.promise();

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  closePool,
  buildConnectionOptions,
  PHILIPPINE_TIME_ZONE,
};

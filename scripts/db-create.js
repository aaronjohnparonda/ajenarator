'use strict';

/**
 * Creates the database named in DB_NAME if it doesn't exist yet (for a brand-new host such as
 * TiDB Cloud, which starts with only system databases). Safe to run more than once.
 *
 *   npm run db:create
 */

const mysql = require('mysql2/promise');
const config = require('../src/config/env');
const { buildConnectionOptions, closePool } = require('../src/db/pool');

const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

async function main() {
  const name = config.db.database;
  if (!DATABASE_NAME_PATTERN.test(name)) {
    throw new Error('DB_NAME may only contain letters, numbers and underscores (max 64).');
  }

  // Connect without choosing a database, since it may not exist yet.
  const connection = await mysql.createConnection(buildConnectionOptions({ database: undefined }));
  try {
    const [[{ version }]] = await connection.query('SELECT VERSION() AS version');
    console.log(`Connected securely. Server version: ${version}`);
    await connection.query('CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci', [name]);
    console.log(`Database "${name}" is ready.`);
  } finally {
    await connection.end();
  }
}

main()
  .catch((error) => {
    console.error(`Could not create the database: ${error.code || ''} ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));

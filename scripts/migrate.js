'use strict';

/**
 * AJenarator - migration runner.
 *
 * Applies every file in sql/migrations/ that has not run yet, in filename order (001_, 002_, ...).
 * Each applied file is recorded in the schema_migrations table with a SHA-256 checksum.
 *
 * Safety rules:
 *   - A database lock stops two runs from applying migrations at the same time.
 *   - If an already-applied file has been edited, the runner refuses to continue.
 *     Never edit an applied migration; add a new numbered file instead.
 *   - It stops at the first failure and applies nothing after it.
 *
 * Run with:  npm run db:migrate
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'sql', 'migrations');
const MIGRATION_FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;
const LOCK_NAME = 'ajenarator_migrations';
const LOCK_TIMEOUT_SECONDS = 10;

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((fileName) => fileName.endsWith('.sql'))
    .map((fileName) => {
      if (!MIGRATION_FILE_PATTERN.test(fileName)) {
        throw new Error(`Bad migration file name "${fileName}". Use the format 003_short_description.sql`);
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, fileName), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      return { version: fileName, sql, checksum };
    })
    .sort((a, b) => a.version.localeCompare(b.version));
}

async function ensureMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(100) NOT NULL,
      checksum    CHAR(64)     NOT NULL,
      applied_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

async function acquireLock(connection) {
  const [[row]] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [LOCK_NAME, LOCK_TIMEOUT_SECONDS]);
  if (row.acquired !== 1) {
    throw new Error('Another migration run is in progress. Try again in a moment.');
  }
}

async function releaseLock(connection) {
  await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
}

async function main() {
  // Required inside main so configuration errors are printed cleanly below.
  const mysql = require('mysql2/promise');
  const { buildConnectionOptions, PHILIPPINE_TIME_ZONE } = require('../src/db/pool');

  const migrationFiles = listMigrationFiles();

  // Separate single connection: multipleStatements is allowed ONLY here, because migration
  // files are our own trusted code. The app's shared pool never enables it.
  const connection = await mysql.createConnection(buildConnectionOptions({ multipleStatements: true }));

  try {
    await connection.query(`SET time_zone = '${PHILIPPINE_TIME_ZONE}'`);
    await acquireLock(connection);

    try {
      await ensureMigrationsTable(connection);

      const [appliedRows] = await connection.query('SELECT version, checksum FROM schema_migrations');
      const appliedChecksums = new Map(appliedRows.map((row) => [row.version, row.checksum]));

      const editedFiles = migrationFiles.filter(
        (file) => appliedChecksums.has(file.version) && appliedChecksums.get(file.version) !== file.checksum,
      );
      if (editedFiles.length > 0) {
        throw new Error(
          `These applied migrations were edited afterwards: ${editedFiles.map((file) => file.version).join(', ')}. `
          + 'Restore the original files and put changes in a new numbered migration.',
        );
      }

      const pendingFiles = migrationFiles.filter((file) => !appliedChecksums.has(file.version));

      console.log('\n=== AJenarator: database migrations ===');
      if (pendingFiles.length === 0) {
        console.log('Database is up to date. Nothing to apply.\n');
        return;
      }

      for (const file of pendingFiles) {
        process.stdout.write(`Applying ${file.version} ... `);
        try {
          await connection.query(file.sql);
        } catch (error) {
          console.log('FAILED');
          throw new Error(
            `${file.version} failed (${error.code || 'error'}): ${error.message}\n`
            + '  MySQL cannot undo table changes made before the failure; send this message so we can fix it safely.',
          );
        }
        await connection.query('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [file.version, file.checksum]);
        console.log('done');
      }

      console.log(`\nApplied ${pendingFiles.length} migration(s).\n`);
    } finally {
      await releaseLock(connection);
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
});

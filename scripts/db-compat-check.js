'use strict';

/**
 * Checks that the database in .env supports every feature AJenarator relies on.
 * Use it before moving to a new MySQL-compatible host (for example TiDB Cloud).
 *
 *   npm run db:compat
 *
 * Safe: it only creates a temporary table named aj_compat_check and drops it at the end.
 * It never touches the real tables.
 */

const { pool, closePool } = require('../src/db/pool');

const TABLE = 'aj_compat_check';
const results = [];

function record(status, name, detail = '') {
  results.push({ status, name, detail });
  console.log(`  ${status.padEnd(4)}  ${name}${detail ? ` - ${detail}` : ''}`);
}

async function expectSuccess(name, action) {
  try {
    const detail = await action();
    record('PASS', name, detail || '');
    return true;
  } catch (error) {
    record('FAIL', name, `${error.code || ''} ${error.message}`.trim());
    return false;
  }
}

async function main() {
  console.log('=== AJenarator: database compatibility check ===\n');
  const connection = await pool.getConnection();

  try {
    const [[{ version }]] = await connection.query('SELECT VERSION() AS version');
    console.log(`  Server version: ${version}\n`);

    await connection.query(`DROP TABLE IF EXISTS ${TABLE}`);

    const tableCreated = await expectSuccess('Table with generated column, CHECK, JSON, DECIMAL, utf8mb4_0900_ai_ci', async () => {
      await connection.query(`
        CREATE TABLE ${TABLE} (
          id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
          code       VARCHAR(20)  NOT NULL,
          a          TINYINT UNSIGNED NOT NULL,
          b          TINYINT UNSIGNED NOT NULL,
          total      SMALLINT UNSIGNED AS (a + b) STORED,
          amount     DECIMAL(15,2) NULL,
          details    JSON NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_code (code),
          CONSTRAINT chk_sorted CHECK (a < b)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    });

    if (tableCreated) {
      await expectSuccess('Insert with JSON and DECIMAL; generated column computed', async () => {
        await connection.execute(
          `INSERT INTO ${TABLE} (code, a, b, amount, details) VALUES (?, ?, ?, ?, ?)`,
          ['x1', 3, 9, '29935246.80', JSON.stringify({ games: 5 })],
        );
        const [[row]] = await connection.query(`SELECT total, amount, details FROM ${TABLE} WHERE code = 'x1'`);
        const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
        if (Number(row.total) !== 12 || String(row.amount) !== '29935246.80' || details.games !== 5) {
          throw new Error(`unexpected values ${JSON.stringify(row)}`);
        }
        return 'total = 12, amount and JSON intact';
      });

      try {
        await connection.execute(`INSERT INTO ${TABLE} (code, a, b) VALUES ('bad', 9, 3)`);
        record('WARN', 'CHECK constraints enforced', 'NOT enforced: bad rows are accepted (the app still validates in code)');
      } catch (error) {
        record('PASS', 'CHECK constraints enforced', `rejected bad row (${error.code})`);
      }

      await expectSuccess('Upsert (INSERT ... ON DUPLICATE KEY UPDATE with placeholders)', async () => {
        await connection.execute(
          `INSERT INTO ${TABLE} (code, a, b) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE a = ?, b = ?, updated_at = CURRENT_TIMESTAMP`,
          ['x1', 4, 10, 4, 10],
        );
        const [[row]] = await connection.query(`SELECT COUNT(*) AS n, MAX(total) AS total FROM ${TABLE} WHERE code = 'x1'`);
        if (Number(row.n) !== 1 || Number(row.total) !== 14) {
          throw new Error(`expected one row with total 14, got ${JSON.stringify(row)}`);
        }
        return 'updated in place, no duplicate';
      });

      await expectSuccess('Duplicate key is rejected on plain INSERT', async () => {
        try {
          await connection.execute(`INSERT INTO ${TABLE} (code, a, b) VALUES ('x1', 1, 2)`);
        } catch (error) {
          if (error.code === 'ER_DUP_ENTRY') {
            return 'ER_DUP_ENTRY as expected';
          }
          throw error;
        }
        throw new Error('duplicate was accepted');
      });

      await expectSuccess('Transaction rollback', async () => {
        await connection.beginTransaction();
        await connection.execute(`INSERT INTO ${TABLE} (code, a, b) VALUES ('tx', 1, 2)`);
        await connection.rollback();
        const [[row]] = await connection.query(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE code = 'tx'`);
        if (Number(row.n) !== 0) {
          throw new Error('rolled-back row is still there');
        }
        return 'row discarded';
      });
    }

    await expectSuccess('Named locks (GET_LOCK / RELEASE_LOCK)', async () => {
      const [[first]] = await connection.query("SELECT GET_LOCK('ajenarator_compat', 0) AS acquired");
      const [[released]] = await connection.query("SELECT RELEASE_LOCK('ajenarator_compat') AS released");
      if (Number(first.acquired) !== 1 || Number(released.released) !== 1) {
        throw new Error(`acquired=${first.acquired} released=${released.released}`);
      }
      return 'acquired and released';
    });

    await expectSuccess('Philippine session time zone (+08:00)', async () => {
      const [[row]] = await connection.query('SELECT @@session.time_zone AS zone');
      if (row.zone !== '+08:00') {
        throw new Error(`session time zone is ${row.zone}`);
      }
      return '+08:00';
    });
  } finally {
    await connection.query(`DROP TABLE IF EXISTS ${TABLE}`).catch(() => {});
    connection.release();
  }

  const failed = results.filter((result) => result.status === 'FAIL').length;
  const warned = results.filter((result) => result.status === 'WARN').length;
  console.log(`\n  ${results.length - failed - warned} passed, ${warned} warning(s), ${failed} failed.`);
  console.log(failed === 0 ? '  This database can run AJenarator.' : '  Do NOT move to this database yet - send this output for review.');
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(`\nCould not run the check: ${error.code || ''} ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));

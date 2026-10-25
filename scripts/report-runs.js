'use strict';

/**
 * Every result check on one night, with time, who ran it and what it found.
 *   npm run report:runs                 tonight (or last night, before 6 AM)
 *   npm run report:runs -- 2026-10-25   a specific night
 *
 * A check that found 0 new results AFTER 9 PM means PCSO had not posted yet at that time;
 * the first check that found them means PCSO had posted by then.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function main() {
  const { pool, closePool } = require('../src/db/pool');
  const { nowInManila, addDays } = require('../src/utils/ph-time');

  const argument = process.argv[2];
  if (argument && !ISO_DATE.test(argument)) {
    throw new Error('Give the night as YYYY-MM-DD, for example: npm run report:runs -- 2026-10-25');
  }
  const { date, time } = nowInManila();
  const night = argument || (time < '06:00' ? addDays(date, -1) : date);

  try {
    const [rows] = await pool.query(
      `SELECT started_at, trigger_source, status, rows_inserted, rows_skipped
       FROM ingest_runs
       WHERE run_type = 'daily' AND started_at >= ? AND started_at < ?
       ORDER BY started_at`,
      [`${night} 18:00:00`, `${addDays(night, 1)} 12:00:00`],
    );

    console.log(`\n=== Result checks for the night of ${night} (Philippine time) ===\n`);
    if (rows.length === 0) {
      console.log('  No checks were recorded that night.\n');
      return;
    }
    rows.forEach((row) => {
      const found = row.rows_inserted > 0 ? `${row.rows_inserted} NEW result(s)` : 'nothing new';
      console.log(`  ${row.started_at}  ${row.trigger_source.padEnd(15)} ${row.status.padEnd(8)} ${found}`);
    });
    console.log('\n  Checks after 9 PM with "nothing new" mean PCSO had not posted yet at that time.\n');
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
});

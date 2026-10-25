'use strict';

/**
 * How long after the 9:00 PM draw did each result first reach AJenarator?
 *   npm run report:posting
 *
 * Uses draws.created_at (when a result was first saved). With the server checking every
 * 2 minutes after the draw, this shows the source's posting delay to within ~2 minutes.
 * Only draws saved within 12 hours of their draw are counted (older history loads are skipped).
 */

const DAYS_BACK = 30;
const MAX_MINUTES = 12 * 60;

async function main() {
  const { pool, closePool } = require('../src/db/pool');
  try {
    const [rows] = await pool.query(
      `SELECT g.code, d.draw_date, d.created_at, d.source,
              TIMESTAMPDIFF(MINUTE, TIMESTAMP(d.draw_date, g.draw_time), d.created_at) AS minutes_after
       FROM draws d JOIN games g ON g.id = d.game_id
       WHERE d.draw_date >= CURDATE() - INTERVAL ? DAY
       HAVING minutes_after BETWEEN 0 AND ?
       ORDER BY d.draw_date DESC, g.id`,
      [DAYS_BACK, MAX_MINUTES],
    );

    console.log(`\n=== When results reached AJenarator (last ${DAYS_BACK} days) ===\n`);
    if (rows.length === 0) {
      console.log('No results saved shortly after their draw yet. Check back after a few draw nights.\n');
      return;
    }
    rows.forEach((row) => {
      console.log(`  ${row.draw_date}  ${row.code.padEnd(5)}  saved ${row.created_at.slice(11, 16)}  (${row.minutes_after} min after the draw, via ${row.source})`);
    });
    const sorted = rows.map((row) => Number(row.minutes_after)).sort((a, b) => a - b);
    const median = sorted[Math.floor((sorted.length - 1) / 2)];
    console.log(`\n  ${rows.length} result(s). Typical delay (median): ${median} min. Fastest: ${sorted[0]} min. Slowest: ${sorted.at(-1)} min.\n`);
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(`\nCould not build the report: ${error.message}\n`);
  process.exitCode = 1;
});

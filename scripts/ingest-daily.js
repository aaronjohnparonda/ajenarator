'use strict';

/**
 * AJenarator - check PCSO for new results (last few days, all games, one search).
 * Does nothing (no PCSO request) when every result due so far is already saved.
 *
 * Usage:
 *   npm run ingest:daily
 *
 * Later, a scheduled job will run this automatically on draw nights.
 */

async function main() {
  // Required inside main so configuration errors are printed cleanly below.
  const { pool, closePool } = require('../src/db/pool');
  const { createPcsoClient } = require('../src/fetcher/pcso-client');
  const { createDailyPlanner } = require('../src/ingest/plan-daily');
  const { runIngest } = require('../src/ingest/run-ingest');
  const { formatIngestSummary } = require('../src/ingest/format-summary');

  const triggerSource = process.env.GITHUB_ACTIONS === 'true' ? 'github_actions' : 'cli';

  try {
    const result = await runIngest({
      pool,
      client: createPcsoClient(),
      runType: 'daily',
      triggerSource,
      planner: createDailyPlanner(),
      log: (message) => console.log(message),
    });
    console.log(formatIngestSummary('AJenarator: daily check finished', result));
    if (result.status === 'failed') {
      process.exitCode = 1;
    }
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
});

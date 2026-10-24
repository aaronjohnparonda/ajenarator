'use strict';

/**
 * AJenarator - check PCSO for new results (last few days, all games, one search).
 * Does nothing (no PCSO request) when every result due so far is already saved.
 *
 * Usage:
 *   npm run ingest:daily               normal check (what the nightly schedule runs)
 *   npm run ingest:daily -- --force    always contact PCSO, even if nothing is due (for testing)
 *
 * The force option can also be turned on with the environment variable INGEST_FORCE_CHECK=true
 * (used by the "Run workflow" button on GitHub). It never duplicates or overwrites data.
 */

function parseArguments(argv) {
  const options = { force: process.env.INGEST_FORCE_CHECK === 'true' };
  for (const argument of argv) {
    if (argument === '--force') {
      options.force = true;
    } else {
      throw new Error(`Unknown option "${argument}". The only option is --force.`);
    }
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  // Required inside main so configuration errors are printed cleanly below.
  const { pool, closePool } = require('../src/db/pool');
  const { createPcsoClient } = require('../src/fetcher/pcso-client');
  const { createDailyPlanner } = require('../src/ingest/plan-daily');
  const { runIngest } = require('../src/ingest/run-ingest');
  const { formatIngestSummary } = require('../src/ingest/format-summary');

  const triggerSource = process.env.GITHUB_ACTIONS === 'true' ? 'github_actions' : 'cli';
  if (options.force) {
    console.log('Force check: PCSO will be contacted even if nothing is due.');
  }

  try {
    const result = await runIngest({
      pool,
      client: createPcsoClient(),
      runType: 'daily',
      triggerSource,
      planner: createDailyPlanner({ alwaysSearch: options.force }),
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

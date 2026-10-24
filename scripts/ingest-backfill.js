'use strict';

/**
 * AJenarator - load draw history from PCSO into the database.
 *
 * Usage:
 *   npm run ingest:backfill                     load every year from 2016 that is not loaded yet
 *   npm run ingest:backfill -- --from-year=2024 only from 2024 onward
 *   npm run ingest:backfill -- --force          re-check every year (never duplicates or overwrites)
 *
 * Safe to stop (Ctrl+C) and run again: finished years stay saved and are skipped next time.
 */

const FROM_YEAR_PATTERN = /^--from-year=(\d{4})$/;

function parseArguments(argv) {
  const options = { force: false, fromYear: undefined };
  for (const argument of argv) {
    if (argument === '--force') {
      options.force = true;
    } else if (FROM_YEAR_PATTERN.test(argument)) {
      options.fromYear = Number(FROM_YEAR_PATTERN.exec(argument)[1]);
    } else {
      throw new Error(`Unknown option "${argument}". Use --from-year=YYYY and/or --force.`);
    }
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  // Required inside main so configuration errors are printed cleanly below.
  const { pool, closePool } = require('../src/db/pool');
  const { createPcsoClient } = require('../src/fetcher/pcso-client');
  const { createBackfillPlanner } = require('../src/ingest/plan-backfill');
  const { runIngest } = require('../src/ingest/run-ingest');
  const { formatIngestSummary } = require('../src/ingest/format-summary');

  try {
    console.log('\nAJenarator: loading draw history from PCSO (pauses between searches to be polite)...\n');
    const result = await runIngest({
      pool,
      client: createPcsoClient(),
      runType: 'backfill',
      triggerSource: 'cli',
      planner: createBackfillPlanner(options),
      log: (message) => console.log(message),
    });
    console.log(formatIngestSummary('AJenarator: history load finished', result));
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

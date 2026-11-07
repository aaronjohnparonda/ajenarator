'use strict';

/**
 * One-time fill of the 5/4/3-number prize breakdown for draws already saved.
 *   npm run prizes:backfill                          the last 60 days
 *   npm run prizes:backfill -- 2026-09-09 2026-11-07  a specific range
 *
 * Reads one Summit Express page per draw day (2.5 seconds apart, to be polite) and saves only
 * breakdowns that pass every check. Safe to run again: draws that already have one are skipped.
 * Summit Express pages before about September 2026 use different addresses, so older days
 * show as "page not found" and are simply left without a breakdown.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 60;
const MAX_DAYS = 400;
const PAUSE_MS = 2500;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const { pool, closePool } = require('../src/db/pool');
  const { nowInManila, addDays, isValidIsoDate } = require('../src/utils/ph-time');
  const { loadDrawsMissingPrizes } = require('../src/repositories/prize-repository');
  const { createPrizeSourceClient } = require('../src/fetcher/prize-source');
  const { fetchPrizesForDate } = require('../src/ingest/prize-fetcher');

  const [fromArgument, toArgument] = process.argv.slice(2);
  const today = nowInManila().date;
  const startDate = fromArgument || addDays(today, -DEFAULT_DAYS);
  const endDate = toArgument || today;
  for (const value of [startDate, endDate]) {
    if (!ISO_DATE.test(value) || !isValidIsoDate(value)) {
      throw new Error('Give dates as YYYY-MM-DD, for example: npm run prizes:backfill -- 2026-09-09 2026-11-07');
    }
  }
  if (startDate > endDate || addDays(startDate, MAX_DAYS) < endDate) {
    throw new Error(`The start must be before the end, and the range at most ${MAX_DAYS} days.`);
  }

  try {
    const missing = await loadDrawsMissingPrizes(pool, startDate, endDate);
    const byDate = new Map();
    missing.forEach((draw) => byDate.set(draw.drawDate, [...(byDate.get(draw.drawDate) || []), draw]));
    console.log(`\n${missing.length} draw(s) from ${startDate} to ${endDate} have no prize breakdown (${byDate.size} day pages).\n`);

    const client = createPrizeSourceClient();
    const totals = { saved: 0, notFound: 0, notReady: 0, rejected: 0, failed: 0 };
    let first = true;
    for (const [drawDate, draws] of byDate) {
      if (!first) {
        await sleep(PAUSE_MS);
      }
      first = false;
      try {
        const outcome = await fetchPrizesForDate({ db: pool, client, drawDate, draws });
        totals.saved += outcome.saved;
        totals.notReady += outcome.notReady.length;
        totals.rejected += outcome.rejected.length;
        if (outcome.notFound) {
          totals.notFound += 1;
          console.log(`  ${drawDate}  page not found`);
          continue;
        }
        console.log(`  ${drawDate}  saved ${outcome.saved} of ${draws.length}`);
        outcome.notReady.forEach((entry) => console.log(`              not on the page: ${entry}`));
        outcome.rejected.forEach((entry) => console.log(`              NOT saved, check failed: ${entry}`));
      } catch (error) {
        totals.failed += 1;
        console.log(`  ${drawDate}  could not read the page (${error.message})`);
      }
    }

    console.log(`\nSaved ${totals.saved}. Pages not found: ${totals.notFound}. Not on page: ${totals.notReady}. `
      + `Failed checks: ${totals.rejected}. Network errors: ${totals.failed}.\n`);
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
});

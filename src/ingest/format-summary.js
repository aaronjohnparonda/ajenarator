'use strict';

/** Turns a runIngest() result into a readable terminal summary. */

const MAX_LISTED_ITEMS = 15;

function listItems(items, formatItem) {
  const lines = items.slice(0, MAX_LISTED_ITEMS).map((item) => `    - ${formatItem(item)}`);
  if (items.length > MAX_LISTED_ITEMS) {
    lines.push(`    ... and ${items.length - MAX_LISTED_ITEMS} more (see ingest_runs.details)`);
  }
  return lines;
}

function formatIngestSummary(title, result) {
  const { details } = result;
  const lines = [
    '',
    `=== ${title} ===`,
    `Run ID           : ${result.runId}`,
    `Status           : ${result.status.toUpperCase()}`,
    `Searches         : ${result.searchesRun} run${result.searchesFailed ? `, ${result.searchesFailed} failed` : ''}`,
    `New draws saved  : ${result.inserted}`,
    `Already saved    : ${result.skipped}`,
  ];

  if (result.updated) {
    lines.push(`Updated          : ${result.updated} (jackpot/winners filled in)`);
  }
  if (details.message) {
    lines.push(`Note             : ${details.message}`);
  }
  if (details.abortedReason) {
    lines.push(`STOPPED          : ${details.abortedReason}`);
  }
  if (result.conflictCount) {
    lines.push(`CONFLICTS        : ${result.conflictCount} (stored results kept, nothing overwritten)`);
    lines.push(...listItems(details.conflicts, (c) => `${c.gameCode} ${c.drawDate}: stored ${c.stored.join('-')} vs PCSO ${c.fetched.join('-')}`));
  }
  if (result.invalidCount) {
    lines.push(`Invalid rows     : ${result.invalidCount} (not saved)`);
    lines.push(...listItems(details.invalidRows, (r) => `${r.row.gameName} ${r.row.drawDate} "${r.row.combination}": ${r.reason}`));
  }
  if (details.offScheduleDraws.length) {
    lines.push(`Off-schedule     : ${details.offScheduleDraws.length} draw(s) on an unusual day (saved)`);
    lines.push(...listItems(details.offScheduleDraws, (d) => `${d.gameCode} ${d.drawDate}`));
  }
  if (details.missingDraws && details.missingDraws.count) {
    lines.push(`No result found  : ${details.missingDraws.count} scheduled draw day(s) (usually holidays or suspensions)`);
    lines.push(...listItems(details.missingDraws.items, (d) => `${d.gameCode} ${d.drawDate}`));
  }
  if (details.pendingToday && details.pendingToday.length) {
    lines.push(`Waiting tonight  : ${details.pendingToday.map((d) => d.gameCode).join(', ')} (not posted by PCSO yet)`);
  }

  lines.push('');
  return lines.join('\n');
}

module.exports = { formatIngestSummary };

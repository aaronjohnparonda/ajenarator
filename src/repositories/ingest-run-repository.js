'use strict';

/** Records each fetch run in ingest_runs so every run can be checked afterwards. */

const MAX_ERROR_MESSAGE_LENGTH = 1000;

async function startIngestRun(db, { runType, triggerSource, rangeStart = null, rangeEnd = null }) {
  const [result] = await db.query(
    'INSERT INTO ingest_runs (run_type, trigger_source, range_start, range_end) VALUES (?, ?, ?, ?)',
    [runType, triggerSource, rangeStart, rangeEnd],
  );
  return result.insertId;
}

async function finishIngestRun(db, runId, {
  status,
  rowsInserted = 0,
  rowsSkipped = 0,
  rowsConflicting = 0,
  details = null,
  errorMessage = null,
}) {
  await db.query(
    `UPDATE ingest_runs
     SET status = ?, rows_inserted = ?, rows_skipped = ?, rows_conflicting = ?,
         details = ?, error_message = ?, finished_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [
      status,
      rowsInserted,
      rowsSkipped,
      rowsConflicting,
      details === null ? null : JSON.stringify(details),
      errorMessage === null ? null : String(errorMessage).slice(0, MAX_ERROR_MESSAGE_LENGTH),
      runId,
    ],
  );
}

module.exports = {
  startIngestRun,
  finishIngestRun,
};

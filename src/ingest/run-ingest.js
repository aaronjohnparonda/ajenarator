'use strict';

/**
 * Runs one fetch job (history load or daily check) from start to finish.
 *
 *   1. Takes a database lock so two runs can never overlap (e.g. a scheduled check during the history load).
 *   2. Asks a planner which PCSO searches are actually needed (skipping work already done).
 *   3. For each search: fetch -> validate -> save inside its own transaction.
 *      A failed search never leaves half-saved data, and earlier searches stay saved.
 *   4. Reports scheduled draws that have no result (holidays, or results not posted yet).
 *   5. Logs everything to ingest_runs.
 */

const { loadActiveGames } = require('../repositories/game-repository');
const { saveDraws, loadStoredDrawKeys, drawKey } = require('../repositories/draw-repository');
const { startIngestRun, finishIngestRun } = require('../repositories/ingest-run-repository');
const { createGameMatcher, normalizeRow } = require('../fetcher/normalize-draw');
const { PcsoPageChangedError } = require('../fetcher/parse-results');
const { PcsoRequestError } = require('../fetcher/pcso-client');
const { nowInManila, eachDate, isoWeekday } = require('../utils/ph-time');

const LOCK_NAME = 'ajenarator_ingest';
const DEFAULT_DELAY_BETWEEN_SEARCHES_MS = 2500;
const MAX_CONSECUTIVE_SEARCH_FAILURES = 2;
const DETAIL_LIMITS = Object.freeze({ conflicts: 100, invalidRows: 50, offSchedule: 50, missing: 300 });

class IngestBusyError extends Error {
  constructor() {
    super('Another fetch run is already in progress. Try again when it finishes.');
    this.name = 'IngestBusyError';
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function pushLimited(list, items, limit) {
  for (const item of items) {
    if (list.length >= limit) {
      return;
    }
    list.push(item);
  }
}

/** Scheduled draws with no saved result: before today = missing; today after draw time = pending. */
function findUnfilledDraws({ games, scopes, storedKeys, today, timeNow }) {
  const gamesById = new Map(games.map((game) => [game.id, game]));
  const missing = [];
  const pendingToday = [];
  const seen = new Set();

  for (const scope of scopes) {
    for (const date of eachDate(scope.startDate, scope.endDate)) {
      if (date > today) {
        break;
      }
      const weekday = isoWeekday(date);

      for (const gameId of scope.gameIds) {
        const game = gamesById.get(gameId);
        const key = drawKey(gameId, date);
        if (!game || !game.drawDays.has(weekday) || storedKeys.has(key) || seen.has(key)) {
          continue;
        }
        seen.add(key);

        if (date < today) {
          missing.push({ gameCode: game.code, drawDate: date });
        } else if (timeNow >= game.drawTime.slice(0, 5)) {
          pendingToday.push({ gameCode: game.code, drawDate: date });
        }
      }
    }
  }

  return { missing, pendingToday };
}

function decideStatus({ searchesRun, searchesFailed, aborted, conflictCount, invalidCount }) {
  if (searchesRun > 0 && searchesFailed === searchesRun) {
    return 'failed';
  }
  if (searchesFailed > 0 || aborted || conflictCount > 0 || invalidCount > 0) {
    return 'partial';
  }
  return 'success';
}

/**
 * @param {object} options
 * @param {object} options.pool - mysql2 promise pool
 * @param {object} options.client - PCSO client ({ search })
 * @param {'backfill'|'daily'} options.runType
 * @param {string} options.triggerSource - e.g. 'cli', 'github_actions'
 * @param {Function} options.planner - async ({ db, games, today, timeNow }) => { searches, expectedScopes, skipReason? }
 * @param {number} [options.delayBetweenSearchesMs]
 * @param {Function} [options.log] - progress logger
 * @param {Date} [options.now]
 */
async function runIngest({
  pool,
  client,
  runType,
  triggerSource,
  planner,
  delayBetweenSearchesMs = DEFAULT_DELAY_BETWEEN_SEARCHES_MS,
  log = () => {},
  now = new Date(),
}) {
  const connection = await pool.getConnection();

  try {
    const [[lockRow]] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME]);
    if (lockRow.acquired !== 1) {
      throw new IngestBusyError();
    }

    try {
      return await runLocked({
        connection, client, runType, triggerSource, planner, delayBetweenSearchesMs, log, now,
      });
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    }
  } finally {
    connection.release();
  }
}

async function runLocked({
  connection, client, runType, triggerSource, planner, delayBetweenSearchesMs, log, now,
}) {
  const games = await loadActiveGames(connection);
  if (games.length === 0) {
    throw new Error('No games found in the database. Run "npm run db:migrate" first.');
  }

  const { date: today, time: timeNow } = nowInManila(now);
  const plan = await planner({ db: connection, games, today, timeNow });
  const { searches, expectedScopes } = plan;

  const rangeStart = searches.length > 0 ? searches.map((s) => s.startDate).sort()[0] : today;
  const rangeEnd = searches.length > 0 ? searches.map((s) => s.endDate).sort().at(-1) : today;
  const runId = await startIngestRun(connection, { runType, triggerSource, rangeStart, rangeEnd });

  const totals = { inserted: 0, skipped: 0, updated: 0 };
  const details = {
    today,
    searchesPlanned: searches.length,
    searches: [],
    conflicts: [],
    invalidRows: [],
    offScheduleDraws: [],
  };
  let conflictCount = 0;
  let invalidCount = 0;
  let searchesFailed = 0;
  let consecutiveFailures = 0;
  let aborted = null;

  try {
    if (searches.length === 0) {
      details.message = plan.skipReason || 'Nothing to fetch.';
      log(details.message);
    }

    const matchGame = createGameMatcher(games);

    for (let index = 0; index < searches.length; index += 1) {
      const search = searches[index];
      const searchSummary = { label: search.label, rowsFound: 0, valid: 0, inserted: 0, skipped: 0, updated: 0, conflicts: 0, invalid: 0 };
      log(`[${index + 1}/${searches.length}] ${search.label} ...`);

      try {
        const { rows, statusMessage } = await client.search(search);
        searchSummary.rowsFound = rows.length;
        if (rows.length === 0 && statusMessage) {
          searchSummary.pcsoMessage = statusMessage;
        }

        const validDraws = [];
        for (const row of rows) {
          const outcome = normalizeRow(row, matchGame);
          if (outcome.status === 'ok') {
            validDraws.push(outcome.draw);
            if (outcome.draw.offSchedule) {
              pushLimited(details.offScheduleDraws, [{ gameCode: outcome.draw.gameCode, drawDate: outcome.draw.drawDate }], DETAIL_LIMITS.offSchedule);
            }
          } else if (outcome.status === 'invalid') {
            searchSummary.invalid += 1;
            invalidCount += 1;
            pushLimited(details.invalidRows, [{ reason: outcome.reason, row: outcome.row }], DETAIL_LIMITS.invalidRows);
          }
        }
        searchSummary.valid = validDraws.length;

        await connection.beginTransaction();
        let saved;
        try {
          saved = await saveDraws(connection, validDraws);
          await connection.commit();
        } catch (databaseError) {
          await connection.rollback();
          databaseError.isDatabaseError = true;
          throw databaseError;
        }

        Object.assign(searchSummary, {
          inserted: saved.inserted,
          skipped: saved.skipped,
          updated: saved.updated,
          conflicts: saved.conflicts.length,
        });
        totals.inserted += saved.inserted;
        totals.skipped += saved.skipped;
        totals.updated += saved.updated;
        conflictCount += saved.conflicts.length;
        pushLimited(details.conflicts, saved.conflicts, DETAIL_LIMITS.conflicts);
        consecutiveFailures = 0;

        log(`      ${saved.inserted} new, ${saved.skipped} already saved${saved.updated ? `, ${saved.updated} updated` : ''}${saved.conflicts.length ? `, ${saved.conflicts.length} CONFLICT(S)` : ''}`);
      } catch (error) {
        searchesFailed += 1;
        consecutiveFailures += 1;
        searchSummary.error = error.message;
        log(`      FAILED: ${error.message}`);

        if (error instanceof PcsoPageChangedError) {
          aborted = 'PCSO changed its page; stopped so no wrong data is saved. The reader needs updating.';
        } else if (error instanceof PcsoRequestError && !error.retryable) {
          aborted = `PCSO refused requests (${error.message}); stopped to avoid hammering their server.`;
        } else if (error.isDatabaseError) {
          aborted = `Database error (${error.code || error.message}); stopped.`;
        } else if (consecutiveFailures >= MAX_CONSECUTIVE_SEARCH_FAILURES) {
          aborted = `${MAX_CONSECUTIVE_SEARCH_FAILURES} searches failed in a row; stopped. PCSO or the internet connection may be down.`;
        }
      }

      details.searches.push(searchSummary);

      if (aborted) {
        log(`Stopping: ${aborted}`);
        details.abortedReason = aborted;
        break;
      }
      if (index < searches.length - 1) {
        await sleep(delayBetweenSearchesMs);
      }
    }

    const scopeStart = expectedScopes.map((scope) => scope.startDate).sort()[0];
    const scopeEnd = expectedScopes.map((scope) => scope.endDate).sort().at(-1);
    let unfilled = { missing: [], pendingToday: [] };
    if (scopeStart && scopeEnd) {
      const storedKeys = await loadStoredDrawKeys(connection, scopeStart, scopeEnd);
      unfilled = findUnfilledDraws({ games, scopes: expectedScopes, storedKeys, today, timeNow });
    }
    details.missingDraws = { count: unfilled.missing.length, items: unfilled.missing.slice(0, DETAIL_LIMITS.missing) };
    details.pendingToday = unfilled.pendingToday;

    const status = decideStatus({
      searchesRun: details.searches.length,
      searchesFailed,
      aborted,
      conflictCount,
      invalidCount,
    });

    await finishIngestRun(connection, runId, {
      status,
      rowsInserted: totals.inserted,
      rowsSkipped: totals.skipped,
      rowsConflicting: conflictCount,
      details: { ...details, rowsUpdated: totals.updated },
      errorMessage: aborted,
    });

    return {
      runId,
      status,
      ...totals,
      conflictCount,
      invalidCount,
      searchesRun: details.searches.length,
      searchesFailed,
      details,
    };
  } catch (error) {
    await finishIngestRun(connection, runId, {
      status: 'failed',
      rowsInserted: totals.inserted,
      rowsSkipped: totals.skipped,
      rowsConflicting: conflictCount,
      details,
      errorMessage: error.message,
    }).catch(() => {});
    throw error;
  }
}

module.exports = {
  runIngest,
  findUnfilledDraws,
  IngestBusyError,
};

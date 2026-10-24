'use strict';

/**
 * Saves draws efficiently and safely.
 *
 * For one batch (one PCSO search) this does a single SELECT to see what is already stored,
 * then one bulk INSERT for everything new. Run it inside a transaction (the caller does),
 * so a batch is either fully saved or not saved at all.
 *
 *   new draw                                   -> inserted
 *   same numbers already stored                -> skipped
 *   same numbers, jackpot/winners now known    -> those two fields updated
 *   DIFFERENT numbers already stored           -> conflict: reported, NEVER overwritten
 */

const INSERT_CHUNK_SIZE = 500;

function drawKey(gameId, drawDate) {
  return `${gameId}|${drawDate}`;
}

function sameNumbers(storedRow, numbers) {
  return [storedRow.n1, storedRow.n2, storedRow.n3, storedRow.n4, storedRow.n5, storedRow.n6]
    .every((value, index) => value === numbers[index]);
}

function normalizeMoney(value) {
  return value === null || value === undefined ? null : Number(value).toFixed(2);
}

/** Collapses duplicate rows inside one batch; two rows for the same game+date with different numbers is a conflict. */
function dedupeBatch(draws) {
  const byKey = new Map();
  const conflicts = [];

  draws.forEach((draw) => {
    const key = drawKey(draw.gameId, draw.drawDate);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, draw);
    } else if (existing.numbers.join('-') !== draw.numbers.join('-')) {
      conflicts.push({
        gameCode: draw.gameCode,
        drawDate: draw.drawDate,
        stored: existing.numbers,
        fetched: draw.numbers,
        note: 'PCSO listed two different results for the same game and date',
      });
    }
  });

  return { uniqueDraws: [...byKey.values()], conflicts };
}

/**
 * @param {object} connection - mysql2 promise connection inside an open transaction
 * @param {Array} draws - normalized draws from normalize-draw.js
 */
async function saveDraws(connection, draws) {
  const result = { inserted: 0, skipped: 0, updated: 0, conflicts: [] };
  if (draws.length === 0) {
    return result;
  }

  const { uniqueDraws, conflicts: batchConflicts } = dedupeBatch(draws);
  result.conflicts.push(...batchConflicts);

  const gameIds = [...new Set(uniqueDraws.map((draw) => draw.gameId))];
  const dates = uniqueDraws.map((draw) => draw.drawDate).sort();

  const [storedRows] = await connection.query(
    `SELECT game_id, draw_date, n1, n2, n3, n4, n5, n6, jackpot_amount, winners
     FROM draws
     WHERE game_id IN (?) AND draw_date BETWEEN ? AND ?`,
    [gameIds, dates[0], dates[dates.length - 1]],
  );
  const storedByKey = new Map(storedRows.map((row) => [drawKey(row.game_id, row.draw_date), row]));

  const rowsToInsert = [];

  for (const draw of uniqueDraws) {
    const stored = storedByKey.get(drawKey(draw.gameId, draw.drawDate));

    if (!stored) {
      rowsToInsert.push([
        draw.gameId,
        draw.drawDate,
        ...draw.numbers,
        draw.drawOrder,
        draw.jackpotAmount,
        draw.winners,
      ]);
      continue;
    }

    if (!sameNumbers(stored, draw.numbers)) {
      result.conflicts.push({
        gameCode: draw.gameCode,
        drawDate: draw.drawDate,
        stored: [stored.n1, stored.n2, stored.n3, stored.n4, stored.n5, stored.n6],
        fetched: draw.numbers,
        note: 'Stored result differs from PCSO; kept the stored result',
      });
      continue;
    }

    const jackpotChanged = draw.jackpotAmount !== null && normalizeMoney(stored.jackpot_amount) !== draw.jackpotAmount;
    const winnersChanged = draw.winners !== null && stored.winners !== draw.winners;

    if (jackpotChanged || winnersChanged) {
      await connection.query(
        'UPDATE draws SET jackpot_amount = ?, winners = ? WHERE game_id = ? AND draw_date = ?',
        [
          jackpotChanged ? draw.jackpotAmount : stored.jackpot_amount,
          winnersChanged ? draw.winners : stored.winners,
          draw.gameId,
          draw.drawDate,
        ],
      );
      result.updated += 1;
    } else {
      result.skipped += 1;
    }
  }

  for (let index = 0; index < rowsToInsert.length; index += INSERT_CHUNK_SIZE) {
    const chunk = rowsToInsert.slice(index, index + INSERT_CHUNK_SIZE);
    await connection.query(
      `INSERT INTO draws (game_id, draw_date, n1, n2, n3, n4, n5, n6, draw_order, jackpot_amount, winners)
       VALUES ?`,
      [chunk],
    );
    result.inserted += chunk.length;
  }

  return result;
}

/**
 * Stored draw dates per game within a range, for "which scheduled draws are missing?" checks.
 * @returns {Promise<Set<string>>} keys "gameId|YYYY-MM-DD"
 */
async function loadStoredDrawKeys(db, startDate, endDate) {
  const [rows] = await db.query(
    'SELECT game_id, draw_date FROM draws WHERE draw_date BETWEEN ? AND ?',
    [startDate, endDate],
  );
  return new Set(rows.map((row) => drawKey(row.game_id, row.draw_date)));
}

/**
 * Draw counts per game per year plus each game's latest stored date,
 * used to skip years that are already loaded.
 */
async function loadDrawCoverage(db) {
  const [rows] = await db.query(`
    SELECT game_id, YEAR(draw_date) AS draw_year, COUNT(*) AS draw_count, MAX(draw_date) AS latest_date
    FROM draws
    GROUP BY game_id, YEAR(draw_date)
  `);
  return rows.map((row) => ({
    gameId: row.game_id,
    year: Number(row.draw_year),
    count: Number(row.draw_count),
    latestDate: row.latest_date,
  }));
}

/**
 * All past draws of one game, oldest first, for statistics and the backtest.
 * @returns {Promise<Array<{ drawDate: string, numbers: number[] }>>}
 */
async function loadDrawsForGame(db, gameId) {
  const [rows] = await db.query(
    'SELECT draw_date, n1, n2, n3, n4, n5, n6 FROM draws WHERE game_id = ? ORDER BY draw_date',
    [gameId],
  );
  return rows.map((row) => ({
    drawDate: row.draw_date,
    numbers: [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6],
  }));
}

/**
 * Every past winning combination of one game as "1-2-3-4-5-6" strings, for the "no repeats" filter.
 * @returns {Promise<Set<string>>}
 */
async function loadPastWinnerKeys(db, gameId) {
  const [rows] = await db.query(
    "SELECT CONCAT_WS('-', n1, n2, n3, n4, n5, n6) AS combination FROM draws WHERE game_id = ?",
    [gameId],
  );
  return new Set(rows.map((row) => row.combination));
}

module.exports = {
  saveDraws,
  loadStoredDrawKeys,
  loadDrawCoverage,
  loadDrawsForGame,
  loadPastWinnerKeys,
  drawKey,
};

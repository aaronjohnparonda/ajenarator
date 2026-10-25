'use strict';

/**
 * Reads and writes the picks table. Every query is filtered by user_id, so one account can
 * never read or change another account's picks (even with a guessed pick ID).
 * Results come from a LEFT JOIN on draws: d_n1 is NULL until the official result is saved.
 */

const PICK_WITH_RESULT_COLUMNS = `
  p.id, p.game_id, p.draw_date, p.n1, p.n2, p.n3, p.n4, p.n5, p.n6, p.source,
  p.created_at, p.result_seen_at,
  d.n1 AS d_n1, d.n2 AS d_n2, d.n3 AS d_n3, d.n4 AS d_n4, d.n5 AS d_n5, d.n6 AS d_n6`;

const PICK_JOIN = 'FROM picks p LEFT JOIN draws d ON d.game_id = p.game_id AND d.draw_date = p.draw_date';

function mapPickRow(row) {
  const hasResult = row.d_n1 !== null && row.d_n1 !== undefined;
  return {
    id: row.id,
    gameId: row.game_id,
    drawDate: row.draw_date,
    numbers: [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6],
    source: row.source,
    createdAt: row.created_at,
    resultSeenAt: row.result_seen_at,
    drawNumbers: hasResult ? [row.d_n1, row.d_n2, row.d_n3, row.d_n4, row.d_n5, row.d_n6] : null,
  };
}

/**
 * Saves a pick. numbers must already be validated and sorted.
 * Throws the database's ER_DUP_ENTRY error if this user already picked for that game and draw.
 * @returns {Promise<number>} the new pick's ID
 */
async function insertPick(db, { userId, gameId, drawDate, numbers, source }) {
  const [result] = await db.execute(
    `INSERT INTO picks (user_id, game_id, draw_date, n1, n2, n3, n4, n5, n6, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, gameId, drawDate, ...numbers, source],
  );
  return result.insertId;
}

async function loadPickById(db, userId, pickId) {
  const [rows] = await db.execute(
    `SELECT ${PICK_WITH_RESULT_COLUMNS} ${PICK_JOIN} WHERE p.user_id = ? AND p.id = ?`,
    [userId, pickId],
  );
  return rows.length > 0 ? mapPickRow(rows[0]) : null;
}

/** The user's picks for draws on or after fromDate (used for "next draws"). */
async function loadPicksFromDate(db, userId, fromDate) {
  const [rows] = await db.execute(
    `SELECT ${PICK_WITH_RESULT_COLUMNS} ${PICK_JOIN} WHERE p.user_id = ? AND p.draw_date >= ?`,
    [userId, fromDate],
  );
  return rows.map(mapPickRow);
}

/** One page of the user's picks, newest draw first. */
async function loadPickHistory(db, userId, { limit, offset }) {
  const [[countRow]] = await db.execute('SELECT COUNT(*) AS total FROM picks WHERE user_id = ?', [userId]);
  const [rows] = await db.query(
    `SELECT ${PICK_WITH_RESULT_COLUMNS} ${PICK_JOIN}
     WHERE p.user_id = ?
     ORDER BY p.draw_date DESC, p.game_id ASC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset],
  );
  return { total: Number(countRow.total), picks: rows.map(mapPickRow) };
}

/**
 * Every pick that already has an official result (for the personal record and pop-up).
 * Small by nature: at most one pick per game per draw.
 */
async function loadSettledPicks(db, userId) {
  const [rows] = await db.execute(
    `SELECT ${PICK_WITH_RESULT_COLUMNS}
     FROM picks p JOIN draws d ON d.game_id = p.game_id AND d.draw_date = p.draw_date
     WHERE p.user_id = ?
     ORDER BY p.draw_date DESC, p.game_id ASC`,
    [userId],
  );
  return rows.map(mapPickRow);
}

async function countPicks(db, userId) {
  const [[row]] = await db.execute('SELECT COUNT(*) AS total FROM picks WHERE user_id = ?', [userId]);
  return Number(row.total);
}

/**
 * Marks results as seen (dismissed from the pop-up). Only touches the user's own picks,
 * and only picks whose official result exists.
 */
async function markResultsSeen(db, userId, pickIds) {
  if (pickIds.length === 0) {
    return 0;
  }
  const placeholders = pickIds.map(() => '?').join(', ');
  const [result] = await db.execute(
    `UPDATE picks SET result_seen_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND result_seen_at IS NULL AND id IN (${placeholders})
       AND EXISTS (SELECT 1 FROM draws d WHERE d.game_id = picks.game_id AND d.draw_date = picks.draw_date)`,
    [userId, ...pickIds],
  );
  return result.affectedRows;
}

/** Latest saved draw date per game ID, to tell "result not in yet" from "no draw was held". */
async function loadLatestDrawDates(db) {
  const [rows] = await db.query('SELECT game_id, MAX(draw_date) AS latest_date FROM draws GROUP BY game_id');
  return new Map(rows.map((row) => [row.game_id, row.latest_date]));
}

module.exports = {
  insertPick,
  loadPickById,
  loadPicksFromDate,
  loadPickHistory,
  loadSettledPicks,
  countPicks,
  markResultsSeen,
  loadLatestDrawDates,
};

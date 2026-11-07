'use strict';

/**
 * Reads and writes draw_prizes (the 5/4/3-number breakdown per draw).
 * Rows are only ever inserted (INSERT IGNORE): a saved, checked breakdown is never changed,
 * and two runs saving the same draw cannot collide.
 */

const { centavosToPesoString } = require('../config/prize-structure');

/**
 * Saved draws in a date range that have no breakdown yet.
 * @returns {Promise<Array<{ drawId, gameId, gameCode, drawDate, numbers }>>}
 */
async function loadDrawsMissingPrizes(db, startDate, endDate) {
  const [rows] = await db.query(
    `SELECT d.id, d.game_id, g.code, d.draw_date, d.n1, d.n2, d.n3, d.n4, d.n5, d.n6
     FROM draws d
     JOIN games g ON g.id = d.game_id
     LEFT JOIN draw_prizes p ON p.draw_id = d.id
     WHERE d.draw_date BETWEEN ? AND ? AND p.draw_id IS NULL
     ORDER BY d.draw_date, d.game_id`,
    [startDate, endDate],
  );
  return rows.map((row) => ({
    drawId: row.id,
    gameId: row.game_id,
    gameCode: row.code,
    drawDate: row.draw_date,
    numbers: [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6],
  }));
}

function money(centavos) {
  return centavos === null ? null : centavosToPesoString(centavos);
}

/**
 * @param {Array<{ drawId, prizes: { match5, match4, match3 }, source, sourceUrl }>} entries - already checked
 * @returns {Promise<number>} rows saved
 */
async function savePrizes(db, entries) {
  if (entries.length === 0) {
    return 0;
  }
  const rows = entries.map(({ drawId, prizes, source, sourceUrl }) => [
    drawId,
    prizes.match5.winners, money(prizes.match5.prizeCentavos),
    prizes.match4.winners, money(prizes.match4.prizeCentavos),
    prizes.match3.winners, money(prizes.match3.prizeCentavos),
    source,
    sourceUrl,
  ]);
  const [result] = await db.query(
    `INSERT IGNORE INTO draw_prizes
       (draw_id, match5_winners, match5_prize, match4_winners, match4_prize, match3_winners, match3_prize, source, source_url)
     VALUES ?`,
    [rows],
  );
  return result.affectedRows;
}

/**
 * Column list + mapper shared by every query that LEFT JOINs draw_prizes under alias `alias`.
 * Columns come back as p5w, p5p, p4w, ... so they never clash with picks/draws columns.
 */
function prizeColumns(alias) {
  return [5, 4, 3]
    .map((tier) => `${alias}.match${tier}_winners AS p${tier}w, ${alias}.match${tier}_prize AS p${tier}p`)
    .join(', ');
}

/**
 * @returns {Array<{ matchCount: 5|4|3, winners: number, prizeEach: string|null }> | null}
 *   null when the breakdown is not known yet
 */
function mapPrizeColumns(row) {
  if (row.p5w === null || row.p5w === undefined) {
    return null;
  }
  return [5, 4, 3].map((tier) => ({
    matchCount: tier,
    winners: Number(row[`p${tier}w`]),
    prizeEach: row[`p${tier}p`] === null ? null : String(row[`p${tier}p`]),
  }));
}

module.exports = { loadDrawsMissingPrizes, savePrizes, prizeColumns, mapPrizeColumns };

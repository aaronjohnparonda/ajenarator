'use strict';

/**
 * Reads the games and their weekly draw days.
 * @param {object} db - a mysql2 promise pool or connection
 * @returns {Promise<Array<{id, code, name, maxNumber, pickCount, drawTime, drawDays: Set<number>}>>}
 */
async function loadActiveGames(db) {
  const [rows] = await db.query(`
    SELECT g.id, g.code, g.name, g.max_number, g.pick_count, g.draw_time,
           GROUP_CONCAT(s.day_of_week ORDER BY s.day_of_week) AS draw_days
    FROM games g
    LEFT JOIN game_schedules s ON s.game_id = g.id
    WHERE g.is_active = 1
    GROUP BY g.id, g.code, g.name, g.max_number, g.pick_count, g.draw_time
    ORDER BY g.id
  `);

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    maxNumber: row.max_number,
    pickCount: row.pick_count,
    drawTime: row.draw_time,
    drawDays: new Set(String(row.draw_days || '').split(',').filter(Boolean).map(Number)),
  }));
}

module.exports = { loadActiveGames };

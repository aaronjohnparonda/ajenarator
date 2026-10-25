'use strict';

/**
 * Which draw can a pick be saved for right now?
 *
 * Rule: only the NEXT draw of each game, and picks close 60 minutes before the draw
 * (8:00 PM for the 9:00 PM draws). After the lock, the next pickable draw is the game's
 * following scheduled day. All times are Philippine time (+08:00, no daylight saving).
 */

const { nowInManila, addDays, isoWeekday } = require('../utils/ph-time');

const LOCK_MINUTES_BEFORE_DRAW = 60;
const SEARCH_DAYS = 14;
const MINUTE_MS = 60 * 1000;

/** "2026-10-27" + "21:00:00" -> Date of that Philippine moment. */
function manilaMoment(isoDate, drawTime) {
  return new Date(`${isoDate}T${drawTime.slice(0, 5)}:00+08:00`);
}

/**
 * @param {{ drawDays: Set<number>|number[], drawTime: string }} game - ISO weekdays, "HH:MM[:SS]"
 * @param {Date} [now]
 * @returns {{ drawDate: string, drawAt: Date, locksAt: Date } | null} null if the game has no schedule
 */
function nextPickableDraw(game, now = new Date()) {
  const drawDays = game.drawDays instanceof Set ? game.drawDays : new Set(game.drawDays);
  const { date: today } = nowInManila(now);

  for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
    const drawDate = addDays(today, offset);
    if (!drawDays.has(isoWeekday(drawDate))) {
      continue;
    }
    const drawAt = manilaMoment(drawDate, game.drawTime);
    const locksAt = new Date(drawAt.getTime() - LOCK_MINUTES_BEFORE_DRAW * MINUTE_MS);
    if (now < locksAt) {
      return { drawDate, drawAt, locksAt };
    }
  }
  return null;
}

module.exports = { nextPickableDraw, manilaMoment, LOCK_MINUTES_BEFORE_DRAW };

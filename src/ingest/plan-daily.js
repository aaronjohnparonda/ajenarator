'use strict';

/**
 * Plans the nightly check: ONE search covering all games for the last few days.
 *
 * Efficient: if every scheduled draw in that window is already saved (and tonight's draw
 * time has passed or not yet arrived), PCSO is not contacted at all. So after tonight's
 * results are in, the remaining scheduled checks cost zero requests.
 *
 * Re-checking a few days back makes a missed run fix itself on the next one.
 *
 * alwaysSearch: contact PCSO even when nothing is due. Used for manual test runs, e.g. to
 * confirm PCSO answers requests from GitHub's servers. Still never duplicates or overwrites data.
 */

const { loadStoredDrawKeys, drawKey } = require('../repositories/draw-repository');
const { addDays, eachDate, isoWeekday } = require('../utils/ph-time');

const DEFAULT_LOOKBACK_DAYS = 3;

function createDailyPlanner({ lookbackDays = DEFAULT_LOOKBACK_DAYS, alwaysSearch = false } = {}) {
  return async function planDaily({ db, games, today, timeNow }) {
    const startDate = addDays(today, -lookbackDays);
    const expectedScopes = [{ gameIds: games.map((game) => game.id), startDate, endDate: today }];

    const storedKeys = await loadStoredDrawKeys(db, startDate, today);
    const outstanding = [];

    for (const date of eachDate(startDate, today)) {
      const weekday = isoWeekday(date);
      for (const game of games) {
        const isDue = date < today || timeNow >= game.drawTime.slice(0, 5);
        if (game.drawDays.has(weekday) && isDue && !storedKeys.has(drawKey(game.id, date))) {
          outstanding.push(`${game.code} ${date}`);
        }
      }
    }

    if (outstanding.length === 0 && !alwaysSearch) {
      return {
        searches: [],
        expectedScopes,
        skipReason: 'All results due so far are already saved; PCSO was not contacted.',
      };
    }

    return {
      searches: [{ label: `All games ${startDate} to ${today}`, gameCode: null, startDate, endDate: today }],
      expectedScopes,
    };
  };
}

module.exports = { createDailyPlanner, DEFAULT_LOOKBACK_DAYS };

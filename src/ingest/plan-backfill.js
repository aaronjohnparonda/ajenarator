'use strict';

/**
 * Plans the one-time history load: one PCSO search per game per year, from 2016 to today.
 *
 * Resumable and efficient: years already loaded are skipped, so re-running after an
 * interruption only fetches what is still missing.
 *   - A past year counts as loaded when its saved draws are within COMPLETE_TOLERANCE of the
 *     number of scheduled draw days (PCSO skips a few, e.g. Holy Week). A year with a long
 *     suspension simply gets re-checked on later runs - one cheap search, nothing duplicated.
 *   - The current year only fetches from shortly before the latest saved draw.
 * Use force to re-check every year anyway (still never duplicates or overwrites data).
 */

const { loadDrawCoverage } = require('../repositories/draw-repository');
const { addDays, eachDate, isoWeekday, yearOf } = require('../utils/ph-time');

const FIRST_AVAILABLE_YEAR = 2016;
const COMPLETE_TOLERANCE = 10;
const CURRENT_YEAR_LOOKBACK_DAYS = 3;

function countScheduledDates(game, startDate, endDate) {
  if (endDate < startDate) {
    return 0;
  }
  return eachDate(startDate, endDate).filter((date) => game.drawDays.has(isoWeekday(date))).length;
}

function createBackfillPlanner({ fromYear = FIRST_AVAILABLE_YEAR, force = false } = {}) {
  return async function planBackfill({ db, games, today }) {
    const currentYear = yearOf(today);
    if (!Number.isInteger(fromYear) || fromYear < FIRST_AVAILABLE_YEAR || fromYear > currentYear) {
      throw new Error(`Start year must be between ${FIRST_AVAILABLE_YEAR} and ${currentYear}.`);
    }

    const coverage = force ? [] : await loadDrawCoverage(db);
    const coverageByKey = new Map(coverage.map((entry) => [`${entry.gameId}|${entry.year}`, entry]));

    const searches = [];
    const expectedScopes = [];

    for (const game of games) {
      for (let year = fromYear; year <= currentYear; year += 1) {
        const yearStart = `${year}-01-01`;
        const isCurrentYear = year === currentYear;
        const yearEnd = isCurrentYear ? today : `${year}-12-31`;
        expectedScopes.push({ gameIds: [game.id], startDate: yearStart, endDate: yearEnd });

        const saved = coverageByKey.get(`${game.id}|${year}`);
        let startDate = yearStart;

        if (saved) {
          if (!isCurrentYear) {
            const scheduled = countScheduledDates(game, yearStart, yearEnd);
            if (saved.count >= scheduled - COMPLETE_TOLERANCE) {
              continue;
            }
          } else {
            const resumeFrom = addDays(saved.latestDate, -CURRENT_YEAR_LOOKBACK_DAYS);
            startDate = resumeFrom > yearStart ? resumeFrom : yearStart;
          }
        }

        searches.push({ label: `${game.code} ${year}`, gameCode: game.code, startDate, endDate: yearEnd });
      }
    }

    return {
      searches,
      expectedScopes,
      skipReason: 'All years are already loaded. Nothing to fetch.',
    };
  };
}

module.exports = {
  createBackfillPlanner,
  countScheduledDates,
  FIRST_AVAILABLE_YEAR,
};

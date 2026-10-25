'use strict';

/**
 * My Picks: one combination per game for the next draw, final once saved, closing at 8:00 PM.
 * Results are matched against the official draw as soon as the nightly check saves it.
 *
 * All rules are enforced here on the server; the screens only mirror them for convenience.
 */

const { loadActiveGames } = require('../repositories/game-repository');
const pickRepository = require('../repositories/pick-repository');
const { GameNotFoundError } = require('./game-service');
const { nextPickableDraw, manilaMoment } = require('../picks/pick-window');
const { nowInManila } = require('../utils/ph-time');

const GAMES_CACHE_MS = 10 * 60 * 1000;
const PICK_SIZE = 6;
const SOURCES = new Set(['generator', 'manual']);
const MAX_SEEN_IDS = 50;
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

class PickValidationError extends Error {
  constructor(details) {
    super('That pick is not valid.');
    this.name = 'PickValidationError';
    this.details = details;
  }
}

class PickClosedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PickClosedError';
  }
}

class PickExistsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PickExistsError';
  }
}

/** "2026-10-27" -> "Tue, Oct 27" */
function shortDate(isoDate) {
  return SHORT_DATE.format(new Date(`${isoDate}T00:00:00Z`));
}

function slugForCode(code) {
  return code.replace('/', '-');
}

/** Returns a list of problems (empty when valid). */
function validateNumbers(numbers, maxNumber) {
  if (!Array.isArray(numbers) || numbers.length !== PICK_SIZE) {
    return [`Choose exactly ${PICK_SIZE} numbers.`];
  }
  const problems = [];
  if (!numbers.every((value) => Number.isInteger(value) && value >= 1 && value <= maxNumber)) {
    problems.push(`Every number must be a whole number from 1 to ${maxNumber}.`);
  }
  if (new Set(numbers).size !== numbers.length) {
    problems.push('Each number can only be used once.');
  }
  return problems;
}

function matchAgainst(numbers, drawNumbers) {
  const drawn = new Set(drawNumbers);
  const matched = numbers.filter((value) => drawn.has(value));
  return { numbers: drawNumbers, matched, matchCount: matched.length };
}

/**
 * @param {object} options
 * @param {object} options.db - mysql2 promise pool
 * @param {Function} [options.now] - returns the current Date (tests pass a fixed clock)
 * @param {object} [options.picks] - tests pass a stand-in for the pick repository
 * @param {Function} [options.loadGames] - tests pass a stand-in
 */
function createPickService({ db, now = () => new Date(), picks = pickRepository, loadGames = loadActiveGames }) {
  let gamesCache = null;

  async function getGames() {
    const currentTime = now().getTime();
    if (gamesCache && gamesCache.expiresAt > currentTime) {
      return gamesCache.games;
    }
    const games = await loadGames(db);
    gamesCache = { games, expiresAt: currentTime + GAMES_CACHE_MS };
    return games;
  }

  function describePick(pick, game, latestDrawDates, currentTime) {
    let status;
    let result = null;
    if (pick.drawNumbers) {
      status = 'result';
      result = matchAgainst(pick.numbers, pick.drawNumbers);
    } else if ((latestDrawDates.get(pick.gameId) || '') > pick.drawDate) {
      status = 'no_draw'; // a later draw exists, so this one was not held (holiday, suspension)
    } else if (currentTime < manilaMoment(pick.drawDate, game.drawTime)) {
      status = 'upcoming';
    } else {
      status = 'waiting'; // drawn, official result not saved yet
    }
    return {
      id: pick.id,
      gameCode: game.code,
      gameName: game.name,
      drawDate: pick.drawDate,
      numbers: pick.numbers,
      source: pick.source,
      createdAt: pick.createdAt,
      status,
      result,
    };
  }

  async function describeMany(rawPicks) {
    if (rawPicks.length === 0) {
      return [];
    }
    const [games, latestDrawDates] = await Promise.all([getGames(), picks.loadLatestDrawDates(db)]);
    const gamesById = new Map(games.map((game) => [game.id, game]));
    const currentTime = now();
    return rawPicks
      .filter((pick) => gamesById.has(pick.gameId))
      .map((pick) => describePick(pick, gamesById.get(pick.gameId), latestDrawDates, currentTime));
  }

  return {
    /** Next pickable draw of every game, with the pick already saved for it (if any). */
    async getUpcoming(userId) {
      const games = await getGames();
      const currentTime = now();
      const saved = await picks.loadPicksFromDate(db, userId, nowInManila(currentTime).date);
      const savedByKey = new Map(saved.map((pick) => [`${pick.gameId}|${pick.drawDate}`, pick]));

      return games
        .map((game) => {
          const window = nextPickableDraw(game, currentTime);
          if (!window) {
            return null;
          }
          const pick = savedByKey.get(`${game.id}|${window.drawDate}`);
          return {
            gameCode: game.code,
            slug: slugForCode(game.code),
            gameName: game.name,
            maxNumber: game.maxNumber,
            drawDate: window.drawDate,
            drawAt: window.drawAt.toISOString(),
            locksAt: window.locksAt.toISOString(),
            pick: pick ? { id: pick.id, numbers: pick.numbers, source: pick.source, createdAt: pick.createdAt } : null,
          };
        })
        .filter(Boolean);
    },

    /**
     * Saves a final pick for the game's next draw.
     * @param {number} userId
     * @param {{ gameCode: unknown, drawDate: unknown, numbers: unknown, source: unknown }} input
     * @throws GameNotFoundError, PickValidationError, PickClosedError, PickExistsError
     */
    async createPick(userId, { gameCode, drawDate, numbers, source }) {
      const games = await getGames();
      const game = games.find((entry) => entry.code === gameCode);
      if (!game) {
        throw new GameNotFoundError(String(gameCode));
      }

      const problems = validateNumbers(numbers, game.maxNumber);
      if (!SOURCES.has(source)) {
        problems.push('source must be "generator" or "manual".');
      }
      if (typeof drawDate !== 'string') {
        problems.push('drawDate is required.');
      }
      if (problems.length > 0) {
        throw new PickValidationError(problems);
      }

      // The browser says which draw it means; if that draw has closed since the screen loaded,
      // refuse instead of silently saving the pick for a later draw.
      const window = nextPickableDraw(game, now());
      if (!window || window.drawDate !== drawDate) {
        const next = window ? ` You can pick for ${shortDate(window.drawDate)} instead.` : '';
        throw new PickClosedError(`Picks for that ${game.code} draw are closed (they close at 8:00 PM).${next}`);
      }

      const sorted = [...numbers].sort((a, b) => a - b);
      let pickId;
      try {
        pickId = await picks.insertPick(db, { userId, gameId: game.id, drawDate, numbers: sorted, source });
      } catch (error) {
        if (error && error.code === 'ER_DUP_ENTRY') {
          throw new PickExistsError(`You already locked in a ${game.code} pick for ${shortDate(drawDate)}. Picks are final.`);
        }
        throw error;
      }

      const saved = await picks.loadPickById(db, userId, pickId);
      const [described] = await describeMany([saved]);
      return described;
    },

    /** One page of history with results, newest first. */
    async listHistory(userId, { page, limit }) {
      const { total, picks: rows } = await picks.loadPickHistory(db, userId, { limit, offset: (page - 1) * limit });
      return {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        picks: await describeMany(rows),
      };
    },

    /** Personal record plus results not yet shown in the pop-up. */
    async getSummary(userId) {
      const [settledRows, totalPicks] = await Promise.all([
        picks.loadSettledPicks(db, userId),
        picks.countPicks(db, userId),
      ]);
      const settled = await describeMany(settledRows);

      const distribution = Array.from({ length: PICK_SIZE + 1 }, () => 0);
      let bestMatch = null;
      settled.forEach((pick) => {
        distribution[pick.result.matchCount] += 1;
        bestMatch = bestMatch === null ? pick.result.matchCount : Math.max(bestMatch, pick.result.matchCount);
      });
      const seenIds = new Set(settledRows.filter((row) => row.resultSeenAt).map((row) => row.id));

      return {
        record: {
          totalPicks,
          settled: settled.length,
          bestMatch,
          threeOrMore: distribution.slice(3).reduce((sum, count) => sum + count, 0),
          distribution,
        },
        unseen: settled.filter((pick) => !seenIds.has(pick.id)),
      };
    },

    /** @param {unknown} ids */
    async markSeen(userId, ids) {
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_SEEN_IDS
        || !ids.every((id) => Number.isInteger(id) && id > 0)) {
        throw new PickValidationError([`ids must be a list of 1 to ${MAX_SEEN_IDS} pick IDs.`]);
      }
      return picks.markResultsSeen(db, userId, [...new Set(ids)]);
    },
  };
}

module.exports = {
  createPickService,
  PickValidationError,
  PickClosedError,
  PickExistsError,
  validateNumbers,
};

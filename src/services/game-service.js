'use strict';

/**
 * Game service: what the API needs about games, built from the repositories and the engine.
 *
 * Efficiency:
 *   - The game list (rarely changes) is cached for 10 minutes; latest draws are read fresh
 *     every time in ONE query, so new results appear as soon as the nightly check saves them.
 *   - Past winning combinations (for the "no repeats" filter) are cached for 10 minutes per game.
 *   - Coverage estimates are cached per game + filter settings (the defaults are computed once).
 */

const { loadActiveGames } = require('../repositories/game-repository');
const {
  loadLatestDrawPerGame, loadPastWinnerKeys, loadLatestDrawDate, loadDrawsForGame, loadDrawsPage,
} = require('../repositories/draw-repository');
const { resolveFilters } = require('../engine/filters');
const { generateCombinations } = require('../engine/generator');
const { estimateCoverage } = require('../engine/coverage');
const { describeCombination } = require('../engine/patterns');
const { computeStatistics } = require('../engine/statistics');
const { runBacktest } = require('../engine/backtest');
const { nowInManila } = require('../utils/ph-time');

const GAMES_CACHE_MS = 10 * 60 * 1000;
const PAST_WINNERS_CACHE_MS = 10 * 60 * 1000;
const COVERAGE_SAMPLE_SIZE = 100000;
const COVERAGE_CACHE_LIMIT = 100;

class GameNotFoundError extends Error {
  constructor(slug) {
    super(`No game called "${slug}". Use 6-42, 6-45, 6-49, 6-55 or 6-58.`);
    this.name = 'GameNotFoundError';
  }
}

/** "6/42" <-> "6-42" (a slash cannot sit safely inside a URL path segment). */
function slugForCode(code) {
  return code.replace('/', '-');
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function createGameService({ db, clock = () => Date.now() }) {
  let gamesCache = null;
  const pastWinnersCache = new Map();
  const coverageCache = new Map();
  const statsCache = new Map();
  const drawsCache = new Map();

  async function getGames() {
    if (gamesCache && gamesCache.expiresAt > clock()) {
      return gamesCache.games;
    }
    const games = await loadActiveGames(db);
    gamesCache = { games, expiresAt: clock() + GAMES_CACHE_MS };
    return games;
  }

  async function findGame(slug) {
    const game = (await getGames()).find((entry) => slugForCode(entry.code) === slug);
    if (!game) {
      throw new GameNotFoundError(slug);
    }
    return game;
  }

  async function getPastWinnerKeys(game) {
    const cached = pastWinnersCache.get(game.id);
    if (cached && cached.expiresAt > clock()) {
      return cached.keys;
    }
    const keys = await loadPastWinnerKeys(db, game.id);
    pastWinnersCache.set(game.id, { keys, expiresAt: clock() + PAST_WINNERS_CACHE_MS });
    return keys;
  }

  /**
   * @param {number[]|null} lastDrawNumbers - the game's latest result, for the "from the previous
   *   draw" rule. Deliberately NOT part of the cache key: which draw is the latest changes the
   *   estimate by far less than the sampling error (+/- 0.25 points), and recomputing after every
   *   draw would cost seconds on a small server.
   */
  function getCoverageShare(game, filters, lastDrawNumbers = null) {
    const key = `${game.code}|${JSON.stringify(filters)}`;
    if (coverageCache.has(key)) {
      return coverageCache.get(key);
    }
    const share = round(estimateCoverage({
      game, filters, lastDrawNumbers, sampleSize: COVERAGE_SAMPLE_SIZE,
    }).keptShare, 4);
    if (coverageCache.size >= COVERAGE_CACHE_LIMIT) {
      coverageCache.delete(coverageCache.keys().next().value); // drop the oldest entry
    }
    coverageCache.set(key, share);
    return share;
  }

  /** All games with schedule, default coverage and their most recent draw. */
  async function listGames() {
    const [games, latestDraws] = await Promise.all([getGames(), loadLatestDrawPerGame(db)]);
    return games.map((game) => ({
      code: game.code,
      slug: slugForCode(game.code),
      name: game.name,
      maxNumber: game.maxNumber,
      drawDays: [...game.drawDays].sort((a, b) => a - b),
      drawTime: game.drawTime.slice(0, 5),
      defaultFilters: resolveFilters(game),
      defaultCoverageShare: getCoverageShare(
        game, resolveFilters(game), latestDraws.has(game.id) ? latestDraws.get(game.id).numbers : null,
      ),
      lastDraw: latestDraws.get(game.id) || null,
    }));
  }

  /**
   * @param {{ slug: string, count: number, filters?: object }} request
   * @throws GameNotFoundError, FilterValidationError, ImpossibleFiltersError
   */
  async function generate({ slug, count, filters = {} }) {
    const game = await findGame(slug);
    const resolvedFilters = resolveFilters(game, filters);
    const pastWinnerKeys = resolvedFilters.pastWinners.enabled ? await getPastWinnerKeys(game) : new Set();
    const lastDrawNumbers = resolvedFilters.lastDrawRepeat.enabled ? await getLatestNumbers(game) : null;
    const { combinations } = generateCombinations({
      game, filters: resolvedFilters, count, pastWinnerKeys, lastDrawNumbers,
    });

    return {
      gameCode: game.code,
      picks: combinations.map((numbers) => {
        const pattern = describeCombination(numbers, game.maxNumber);
        return { numbers, pattern: { sum: pattern.sum, oddCount: pattern.oddCount, lowCount: pattern.lowCount } };
      }),
      coverageShare: getCoverageShare(game, resolvedFilters, lastDrawNumbers),
      filters: resolvedFilters,
    };
  }

  /**
   * A game's full draw history, cached until a new draw is saved
   * (one cheap MAX(draw_date) query decides), so fresh results show up immediately.
   */
  async function getDraws(game) {
    const latestDrawDate = await loadLatestDrawDate(db, game.id);
    const cached = drawsCache.get(game.id);
    if (cached && cached.latestDrawDate === latestDrawDate) {
      return { draws: cached.draws, latestDrawDate };
    }
    const draws = await loadDrawsForGame(db, game.id);
    drawsCache.set(game.id, { latestDrawDate, draws });
    return { draws, latestDrawDate };
  }

  /** The game's most recent winning numbers (fresh: uses the same check as getDraws). */
  async function getLatestNumbers(game) {
    const { draws, latestDrawDate } = await getDraws(game);
    const latest = draws.find((draw) => draw.drawDate === latestDrawDate);
    return latest ? latest.numbers : null;
  }

  /** Statistics for one game; recomputed only when a new draw arrives or the Philippine date changes. */
  async function getStats(slug) {
    const game = await findGame(slug);
    const today = nowInManila(new Date(clock())).date;
    const { draws, latestDrawDate } = await getDraws(game);

    const cached = statsCache.get(game.id);
    if (cached && cached.latestDrawDate === latestDrawDate && cached.today === today) {
      return cached.result;
    }

    const result = { gameCode: game.code, ...computeStatistics({ game, draws, today }) };
    statsCache.set(game.id, { latestDrawDate, today, result });
    return result;
  }

  /**
   * How many past winning combinations would these filter settings have kept,
   * compared with the share of ALL combinations they keep?
   * @throws GameNotFoundError, FilterValidationError
   */
  async function backtest({ slug, filters = {} }) {
    const game = await findGame(slug);
    const resolvedFilters = resolveFilters(game, filters);
    const { draws, latestDrawDate } = await getDraws(game);
    const latest = draws.find((draw) => draw.drawDate === latestDrawDate);
    const keptShare = getCoverageShare(game, resolvedFilters, latest ? latest.numbers : null);
    const result = runBacktest({ game, filters: resolvedFilters, draws, coverage: { keptShare } });

    return {
      gameCode: game.code,
      totalDraws: result.totalDraws,
      keptDraws: result.keptDraws,
      keptShareOfWinners: round(result.keptShareOfWinners, 4),
      keptShareRange: { low: round(result.keptShareRange.low, 4), high: round(result.keptShareRange.high, 4) },
      keptShareOfAllCombinations: keptShare,
      removedByRule: result.removedByRule,
      verdict: result.verdict,
    };
  }

  /** One page of a game's draw history, newest first. */
  async function listDraws(slug, { page, limit, toDate = null }) {
    const game = await findGame(slug);
    const { total, draws } = await loadDrawsPage(db, game.id, { limit, offset: (page - 1) * limit, toDate });
    return {
      gameCode: game.code,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      toDate,
      draws,
    };
  }

  return { listGames, generate, getStats, listDraws, backtest };
}

module.exports = { createGameService, GameNotFoundError, slugForCode };

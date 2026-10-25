'use strict';

/**
 * Draw Night: tonight's games, whether each is still upcoming, being drawn, or has its
 * official result, plus the signed-in owner's locked-in pick for each.
 *
 * The browser polls this every ~20 seconds while a result is awaited, so it is kept cheap:
 * the game list is cached for 10 minutes and tonight's draws for 10 seconds (one tiny query).
 * The owner's picks are one indexed query, only when signed in.
 *
 * "Tonight" switches at 6:00 AM Philippine time, so after midnight the screen still shows
 * the night that just happened.
 */

const { loadActiveGames } = require('../repositories/game-repository');
const { loadDrawsOnDate } = require('../repositories/draw-repository');
const pickRepository = require('../repositories/pick-repository');
const { manilaMoment } = require('../picks/pick-window');
const { nowInManila, addDays, isoWeekday } = require('../utils/ph-time');

const GAMES_CACHE_MS = 10 * 60 * 1000;
const DRAWS_CACHE_MS = 10 * 1000;
const NIGHT_STARTS_AT = '06:00';
const PICK_SIZE = 6;

/** "29-05-40-11-33-24" -> [29, 5, 40, 11, 33, 24]; falls back to sorted numbers if unreadable. */
function parseDrawOrder(drawOrder, numbers) {
  const parsed = String(drawOrder || '').split('-').map((part) => Number(part.trim()));
  const valid = parsed.length === PICK_SIZE
    && parsed.every((value) => Number.isInteger(value))
    && [...parsed].sort((a, b) => a - b).join(',') === [...numbers].sort((a, b) => a - b).join(',');
  return valid ? parsed : [...numbers];
}

function nightDateFor(now) {
  const { date, time } = nowInManila(now);
  return time < NIGHT_STARTS_AT ? addDays(date, -1) : date;
}

function createDrawNightService({
  db,
  now = () => new Date(),
  loadGames = loadActiveGames,
  loadDraws = loadDrawsOnDate,
  picks = pickRepository,
}) {
  let gamesCache = null;
  let drawsCache = null;

  async function getGames(currentTime) {
    if (gamesCache && gamesCache.expiresAt > currentTime) {
      return gamesCache.games;
    }
    const games = await loadGames(db);
    gamesCache = { games, expiresAt: currentTime + GAMES_CACHE_MS };
    return games;
  }

  async function getDraws(nightDate, currentTime) {
    if (drawsCache && drawsCache.nightDate === nightDate && drawsCache.expiresAt > currentTime) {
      return drawsCache.draws;
    }
    const draws = await loadDraws(db, nightDate);
    drawsCache = { nightDate, draws, expiresAt: currentTime + DRAWS_CACHE_MS };
    return draws;
  }

  return {
    /**
     * @param {{ id: number } | null} user - signed-in owner, or null for visitors
     */
    async getNight(user) {
      const current = now();
      const currentTime = current.getTime();
      const nightDate = nightDateFor(current);
      const weekday = isoWeekday(nightDate);

      const [games, draws, userPicks] = await Promise.all([
        getGames(currentTime),
        getDraws(nightDate, currentTime),
        user ? picks.loadPicksFromDate(db, user.id, nightDate) : Promise.resolve([]),
      ]);
      const picksByGame = new Map(
        userPicks.filter((pick) => pick.drawDate === nightDate).map((pick) => [pick.gameId, pick]),
      );

      const tonight = games
        .filter((game) => game.drawDays.has(weekday))
        .map((game) => {
          const drawAt = manilaMoment(nightDate, game.drawTime);
          const draw = draws.get(game.id);
          let status = 'upcoming';
          if (draw) {
            status = 'result';
          } else if (current >= drawAt) {
            status = 'drawing';
          }
          const pick = picksByGame.get(game.id);
          return {
            gameCode: game.code,
            gameName: game.name,
            maxNumber: game.maxNumber,
            drawDate: nightDate,
            drawAt: drawAt.toISOString(),
            status,
            result: draw ? {
              official: true,
              source: 'PCSO',
              order: parseDrawOrder(draw.drawOrder, draw.numbers),
              numbers: draw.numbers,
              jackpotAmount: draw.jackpotAmount,
              winners: draw.winners,
            } : null,
            pick: pick ? { numbers: pick.numbers } : null,
          };
        });

      return { nightDate, serverTime: current.toISOString(), signedIn: Boolean(user), games: tonight };
    },
  };
}

module.exports = { createDrawNightService, parseDrawOrder, nightDateFor };

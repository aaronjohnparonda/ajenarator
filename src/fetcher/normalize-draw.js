'use strict';

/**
 * Turns one raw PCSO table row into a validated draw, or explains why it was not used.
 * Pure functions: no network, no database.
 *
 * Results:
 *   { status: 'ok', draw }        - a valid draw for one of our five games
 *   { status: 'ignored' }         - not one of our games (3D, 2D, 4D, 6D...)
 *   { status: 'invalid', reason } - one of our games, but the row fails validation
 */

const { isValidIsoDate, isoWeekday } = require('../utils/ph-time');

const MONEY_PATTERN = /^(\d{1,3}(,\d{3})*|\d+)(\.\d{1,2})?$/;
const BALL_PATTERN = /^\d{1,2}$/;
const PCSO_DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** "Megalotto 6/45" and "Mega Lotto 6/45" both become "megalotto6/45". */
function normalizeGameName(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, '');
}

/**
 * Matches PCSO game names to our games by their number format ("6/42"),
 * ignoring spaces and capitals. Returns null for games we do not track.
 */
function createGameMatcher(games) {
  const entries = games.map((game) => ({ game, code: normalizeGameName(game.code) }));

  return function matchGame(pcsoGameName) {
    const normalized = normalizeGameName(pcsoGameName);
    const matches = entries.filter((entry) => normalized.includes(entry.code));
    return matches.length === 1 ? matches[0].game : null;
  };
}

/** PCSO's "1/2/2025" (month/day/year) -> "2025-01-02"; null if not a real date. */
function parsePcsoDate(value) {
  const match = PCSO_DATE_PATTERN.exec(String(value || '').trim());
  if (!match) {
    return null;
  }
  const isoDate = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return isValidIsoDate(isoDate) ? isoDate : null;
}

/** "430,857,884.28" -> "430857884.28" (string, so DECIMAL values keep exact cents); null if unreadable. */
function parseMoney(value) {
  const text = String(value || '').trim();
  if (!MONEY_PATTERN.test(text)) {
    return null;
  }
  return Number(text.replace(/,/g, '')).toFixed(2);
}

/** "3" -> 3; null if unreadable. */
function parseWinners(value) {
  const text = String(value || '').trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

function parseCombination(combination, game) {
  const parts = String(combination || '').trim().split('-');

  if (parts.length !== game.pickCount) {
    return { error: `expected ${game.pickCount} numbers, got ${parts.length}` };
  }
  if (!parts.every((part) => BALL_PATTERN.test(part))) {
    return { error: 'combination contains a non-number value' };
  }

  const numbers = parts.map(Number);
  if (numbers.some((number) => number < 1 || number > game.maxNumber)) {
    return { error: `a number is outside 1-${game.maxNumber}` };
  }
  if (new Set(numbers).size !== numbers.length) {
    return { error: 'a number appears more than once' };
  }

  return { numbers: [...numbers].sort((a, b) => a - b) };
}

function normalizeRow(row, matchGame) {
  const game = matchGame(row.gameName);
  if (!game) {
    return { status: 'ignored' };
  }

  const drawDate = parsePcsoDate(row.drawDate);
  if (!drawDate) {
    return { status: 'invalid', reason: `unreadable draw date "${row.drawDate}"`, row };
  }

  const combination = parseCombination(row.combination, game);
  if (combination.error) {
    return { status: 'invalid', reason: combination.error, row };
  }

  return {
    status: 'ok',
    draw: {
      gameId: game.id,
      gameCode: game.code,
      drawDate,
      numbers: combination.numbers,
      drawOrder: String(row.combination).trim(),
      jackpotAmount: parseMoney(row.jackpot),
      winners: parseWinners(row.winners),
      // Kept, but reported: PCSO occasionally moves a draw (e.g. around holidays).
      offSchedule: !game.drawDays.has(isoWeekday(drawDate)),
    },
  };
}

module.exports = {
  normalizeGameName,
  createGameMatcher,
  parsePcsoDate,
  parseMoney,
  parseWinners,
  normalizeRow,
};

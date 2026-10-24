'use strict';

/**
 * Per-game constants used by the filters.
 *
 * Sum ranges are the middle 90% of ALL possible combinations for each game, found by exact
 * enumeration of every combination (5.2 million for 6/42 up to 40.5 million for 6/58).
 * Phase 2 analysis confirmed real PCSO draws fall outside these ranges about 10% of the time,
 * matching the math.
 */

const GAME_DEFAULTS = Object.freeze({
  '6/42': Object.freeze({ sumRange: Object.freeze({ min: 83, max: 175 }) }),
  '6/45': Object.freeze({ sumRange: Object.freeze({ min: 89, max: 187 }) }),
  '6/49': Object.freeze({ sumRange: Object.freeze({ min: 96, max: 204 }) }),
  '6/55': Object.freeze({ sumRange: Object.freeze({ min: 107, max: 229 }) }),
  '6/58': Object.freeze({ sumRange: Object.freeze({ min: 112, max: 242 }) }),
});

function getGameDefaults(gameCode) {
  const defaults = GAME_DEFAULTS[gameCode];
  if (!defaults) {
    throw new Error(`No defaults defined for game ${gameCode}.`);
  }
  return defaults;
}

/** Smallest and largest possible sums for a 6-number game with numbers 1..maxNumber. */
function possibleSumRange(maxNumber) {
  return { min: 1 + 2 + 3 + 4 + 5 + 6, max: 6 * maxNumber - 15 };
}

/** How many tens-groups a game has: 6/42 -> 5 (1-9, 10s, 20s, 30s, 40s), 6/58 -> 6. */
function tensGroupCount(maxNumber) {
  return Math.floor(maxNumber / 10) + 1;
}

/** Exact number of possible combinations: C(maxNumber, 6). */
function totalCombinations(maxNumber) {
  let result = 1;
  for (let index = 0; index < 6; index += 1) {
    result = (result * (maxNumber - index)) / (index + 1);
  }
  return Math.round(result);
}

module.exports = {
  getGameDefaults,
  possibleSumRange,
  tensGroupCount,
  totalCombinations,
};

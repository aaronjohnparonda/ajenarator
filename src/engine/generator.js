'use strict';

/**
 * Generates random combinations that pass the chosen filters.
 *
 * Method: draw random combinations with a cryptographically secure random number generator,
 * keep the ones that pass every enabled filter, and stop once enough unique combinations are found.
 * Must-include numbers are always placed first; excluded numbers are never drawn.
 * With the default filters about 80% of random combinations pass, so this is fast. If the
 * filters are so strict that almost nothing passes, it stops after a fixed number of attempts
 * and explains instead of running forever.
 */

const crypto = require('node:crypto');
const { checkCombination } = require('./filters');

const MIN_COUNT = 1;
const MAX_COUNT = 10;
const DEFAULT_MAX_ATTEMPTS = 200000;

class ImpossibleFiltersError extends Error {
  constructor(found, wanted, attempts) {
    super(
      `Only found ${found} of ${wanted} combinations after ${attempts.toLocaleString('en-US')} tries. `
      + 'The filters are too strict for this game; loosen or turn off some of them.',
    );
    this.name = 'ImpossibleFiltersError';
    this.found = found;
  }
}

/** Picks `count` distinct values from `pool` (partial Fisher-Yates shuffle on a copy). */
function pickDistinct(pool, count, randomInt) {
  const values = [...pool];
  for (let index = 0; index < count; index += 1) {
    const swapWith = index + randomInt(values.length - index);
    [values[index], values[swapWith]] = [values[swapWith], values[index]];
  }
  return values.slice(0, count);
}

/**
 * @param {object} options
 * @param {object} options.game - { code, maxNumber }
 * @param {object} options.filters - output of resolveFilters()
 * @param {number} options.count - how many combinations (1-10)
 * @param {Set<string>} [options.pastWinnerKeys] - "1-2-3-4-5-6" strings
 * @param {number[]|null} [options.lastDrawNumbers] - the game's latest result
 * @param {Function} [options.randomInt] - (max) => integer in [0, max); defaults to crypto.randomInt
 * @param {number} [options.maxAttempts]
 * @returns {{ combinations: number[][], attempts: number }}
 */
function generateCombinations({
  game,
  filters,
  count,
  pastWinnerKeys = new Set(),
  lastDrawNumbers = null,
  randomInt = (max) => crypto.randomInt(max),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}) {
  if (!Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
    throw new Error(`count must be a whole number from ${MIN_COUNT} to ${MAX_COUNT}.`);
  }

  const included = filters.includeNumbers;
  const blocked = new Set([...included, ...filters.excludeNumbers]);
  const pool = [];
  for (let number = 1; number <= game.maxNumber; number += 1) {
    if (!blocked.has(number)) {
      pool.push(number);
    }
  }

  const slotsToFill = 6 - included.length;
  const found = new Map();
  let attempts = 0;

  while (found.size < count && attempts < maxAttempts) {
    attempts += 1;
    const numbers = [...included, ...pickDistinct(pool, slotsToFill, randomInt)].sort((a, b) => a - b);
    const key = numbers.join('-');
    if (!found.has(key) && checkCombination(numbers, game, filters, pastWinnerKeys, lastDrawNumbers).passed) {
      found.set(key, numbers);
    }
  }

  if (found.size < count) {
    throw new ImpossibleFiltersError(found.size, count, attempts);
  }
  return { combinations: [...found.values()], attempts };
}

module.exports = {
  generateCombinations,
  ImpossibleFiltersError,
  MAX_COUNT,
};

'use strict';

/**
 * Estimates what share of ALL possible combinations pass the chosen filters.
 *
 * Counting all 40 million 6/58 combinations on every request would be too slow, so this
 * checks a large random sample instead (Monte Carlo). With 200,000 samples the estimate is
 * within about +/- 0.2 percentage points (95% confidence).
 */

const crypto = require('node:crypto');
const { checkCombination } = require('./filters');
const { totalCombinations } = require('./game-defaults');

const DEFAULT_SAMPLE_SIZE = 200000;
const CONFIDENCE_Z = 1.96;

function randomCombination(maxNumber, randomInt) {
  const chosen = new Set();
  while (chosen.size < 6) {
    chosen.add(1 + randomInt(maxNumber));
  }
  return [...chosen].sort((a, b) => a - b);
}

/**
 * @param {object} options
 * @param {object} options.game - { code, maxNumber }
 * @param {object} options.filters - output of resolveFilters()
 * @param {number[]|null} [options.lastDrawNumbers] - the game's latest result (for that rule)
 * @param {number} [options.sampleSize]
 * @param {Function} [options.randomInt]
 * @returns {{ keptShare, marginOfError, estimatedKeptCombinations, totalCombinations, sampleSize, failedByRule }}
 *   failedByRule counts how many sampled combinations each rule rejected (one combination can fail several).
 */
function estimateCoverage({
  game,
  filters,
  lastDrawNumbers = null,
  sampleSize = DEFAULT_SAMPLE_SIZE,
  randomInt = (max) => crypto.randomInt(max),
}) {
  // Past winners are a few thousand of millions of combinations: negligible, so skipped here.
  const sampleFilters = { ...filters, pastWinners: { enabled: false } };
  const failedByRule = {};
  let kept = 0;

  for (let index = 0; index < sampleSize; index += 1) {
    const { passed, failedRules } = checkCombination(
      randomCombination(game.maxNumber, randomInt), game, sampleFilters, undefined, lastDrawNumbers,
    );
    if (passed) {
      kept += 1;
    }
    failedRules.forEach((rule) => {
      failedByRule[rule] = (failedByRule[rule] || 0) + 1;
    });
  }

  const keptShare = kept / sampleSize;
  const total = totalCombinations(game.maxNumber);
  return {
    keptShare,
    marginOfError: CONFIDENCE_Z * Math.sqrt((keptShare * (1 - keptShare)) / sampleSize),
    estimatedKeptCombinations: Math.round(keptShare * total),
    totalCombinations: total,
    sampleSize,
    failedByRule,
  };
}

module.exports = { estimateCoverage, DEFAULT_SAMPLE_SIZE };

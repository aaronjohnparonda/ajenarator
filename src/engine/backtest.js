'use strict';

/**
 * Backtest: how many PAST winning combinations would the chosen filters have kept?
 *
 * Compares that with the share of ALL combinations the filters keep. If a filter set keeps
 * 80% of all combinations and also kept about 80% of past winners, it has no predictive edge -
 * it shapes picks without changing the odds. This is shown honestly, whatever the result.
 *
 * The "no past winners" rule is applied fairly: each draw is only compared with winners
 * from BEFORE its own date (otherwise every draw would match itself).
 */

const { checkCombination } = require('./filters');

/** Wilson score interval: a 95% range for a share measured from a limited number of draws. */
function wilsonInterval(successes, total, z = 1.96) {
  if (total === 0) {
    return { low: 0, high: 0 };
  }
  const share = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (share + (z * z) / (2 * total)) / denominator;
  const spread = (z * Math.sqrt((share * (1 - share)) / total + (z * z) / (4 * total * total))) / denominator;
  return { low: Math.max(0, center - spread), high: Math.min(1, center + spread) };
}

/**
 * @param {object} options
 * @param {object} options.game - { code, maxNumber }
 * @param {object} options.filters - output of resolveFilters()
 * @param {Array<{drawDate: string, numbers: number[]}>} options.draws - past draws for this game
 * @param {{ keptShare: number }} options.coverage - output of estimateCoverage()
 */
function runBacktest({ game, filters, draws, coverage }) {
  const ordered = [...draws].sort((a, b) => (a.drawDate < b.drawDate ? -1 : 1));
  const earlierWinners = new Set();
  const removedByRule = {};
  const removedExamples = [];
  let kept = 0;

  for (const draw of ordered) {
    const key = draw.numbers.join('-');
    const { passed, failedRules } = checkCombination(draw.numbers, game, filters, earlierWinners);
    if (passed) {
      kept += 1;
    } else {
      failedRules.forEach((rule) => {
        removedByRule[rule] = (removedByRule[rule] || 0) + 1;
      });
      if (removedExamples.length < 5) {
        removedExamples.push({ drawDate: draw.drawDate, numbers: draw.numbers, failedRules });
      }
    }
    earlierWinners.add(key);
  }

  const total = ordered.length;
  const keptShareOfWinners = total === 0 ? 0 : kept / total;
  const range = wilsonInterval(kept, total);
  const allShare = coverage.keptShare;

  let verdict;
  if (total === 0) {
    verdict = 'No past draws to test against yet.';
  } else if (allShare >= range.low && allShare <= range.high) {
    verdict = 'No edge: these filters kept past winners at about the same rate as all combinations. '
      + 'They shape your picks but do not change the odds.';
  } else if (keptShareOfWinners > allShare) {
    verdict = 'Past winners were kept more often than all combinations - likely chance in a limited history, '
      + 'not a reliable edge. Each future draw is still independent.';
  } else {
    verdict = 'These filters removed past winners MORE often than all combinations. Consider loosening them.';
  }

  return {
    totalDraws: total,
    keptDraws: kept,
    removedDraws: total - kept,
    keptShareOfWinners,
    keptShareRange: range,
    keptShareOfAllCombinations: allShare,
    removedByRule,
    removedExamples,
    verdict,
  };
}

module.exports = { runBacktest, wilsonInterval };

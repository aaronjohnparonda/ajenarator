'use strict';

/**
 * Descriptive statistics for one game. Pure function: no database, no network.
 *
 * Windows agreed in Phase 2:
 *   - Number frequency and distributions: draws from the past 3 years
 *   - Hot / cold numbers: the last 100 draws (top 6 and bottom 6)
 *   - Gap since last drawn: the full history (so long absences show their real length)
 *
 * Everything here DESCRIBES past draws. Backtests on real PCSO data showed draws behave
 * randomly, so a "hot" number is not more likely to appear next - the UI must say so.
 */

const { describeCombination } = require('./patterns');
const { isValidIsoDate } = require('../utils/ph-time');

const DEFAULT_OPTIONS = Object.freeze({
  frequencyYears: 3,
  hotColdWindow: 100,
  hotColdListSize: 6,
  sumBucketSize: 10,
});

/** Same calendar day N years earlier; Feb 29 falls back to Feb 28. */
function yearsBefore(isoDate, years) {
  const candidate = `${Number(isoDate.slice(0, 4)) - years}${isoDate.slice(4)}`;
  return isValidIsoDate(candidate) ? candidate : `${candidate.slice(0, 8)}28`;
}

function countNumbers(draws, maxNumber) {
  const counts = new Array(maxNumber + 1).fill(0);
  draws.forEach((draw) => draw.numbers.forEach((number) => { counts[number] += 1; }));
  return counts;
}

function roundTo(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function buildFrequency(windowDraws, maxNumber, windowStart, windowEnd) {
  const counts = countNumbers(windowDraws, maxNumber);
  const expectedPerNumber = (windowDraws.length * 6) / maxNumber;
  const numbers = [];
  for (let number = 1; number <= maxNumber; number += 1) {
    numbers.push({ number, count: counts[number] });
  }
  return {
    windowStart,
    windowEnd,
    drawCount: windowDraws.length,
    expectedPerNumber: roundTo(expectedPerNumber, 2),
    numbers,
  };
}

/** Draws since each number last appeared (0 = in the latest draw), over the full history. */
function buildGaps(draws, maxNumber) {
  const lastSeenIndex = new Array(maxNumber + 1).fill(-1);
  draws.forEach((draw, index) => draw.numbers.forEach((number) => { lastSeenIndex[number] = index; }));

  const latestIndex = draws.length - 1;
  const gaps = [];
  for (let number = 1; number <= maxNumber; number += 1) {
    const seenAt = lastSeenIndex[number];
    gaps.push({
      number,
      drawsSinceLastSeen: seenAt === -1 ? null : latestIndex - seenAt,
      lastSeenDate: seenAt === -1 ? null : draws[seenAt].drawDate,
    });
  }
  return gaps;
}

function buildHotCold(draws, maxNumber, gapsByNumber, { hotColdWindow, hotColdListSize }) {
  const windowDraws = draws.slice(-hotColdWindow);
  const counts = countNumbers(windowDraws, maxNumber);
  const entries = [];
  for (let number = 1; number <= maxNumber; number += 1) {
    const gap = gapsByNumber.get(number);
    entries.push({ number, count: counts[number], drawsSinceLastSeen: gap === null ? Infinity : gap });
  }

  // Ties: hot prefers the most recently seen; cold prefers the longest absent.
  const hot = [...entries]
    .sort((a, b) => b.count - a.count || a.drawsSinceLastSeen - b.drawsSinceLastSeen || a.number - b.number)
    .slice(0, hotColdListSize);
  const cold = [...entries]
    .sort((a, b) => a.count - b.count || b.drawsSinceLastSeen - a.drawsSinceLastSeen || a.number - b.number)
    .slice(0, hotColdListSize);

  const strip = ({ number, count }) => ({ number, count });
  return {
    drawCount: windowDraws.length,
    expectedPerNumber: roundTo((windowDraws.length * 6) / maxNumber, 2),
    hot: hot.map(strip),
    cold: cold.map(strip),
  };
}

function buildDistributions(windowDraws, maxNumber, { sumBucketSize }) {
  const oddCounts = new Array(7).fill(0);
  const lowCounts = new Array(7).fill(0);
  const sumBuckets = new Map();
  const sums = [];
  let withConsecutivePair = 0;

  for (const draw of windowDraws) {
    const pattern = describeCombination(draw.numbers, maxNumber);
    oddCounts[pattern.oddCount] += 1;
    lowCounts[pattern.lowCount] += 1;
    sums.push(pattern.sum);
    if (pattern.longestRun >= 2) {
      withConsecutivePair += 1;
    }
    const bucketStart = Math.floor(pattern.sum / sumBucketSize) * sumBucketSize;
    sumBuckets.set(bucketStart, (sumBuckets.get(bucketStart) || 0) + 1);
  }

  sums.sort((a, b) => a - b);
  const total = windowDraws.length;
  const middle = Math.floor(total / 2);
  const median = total === 0 ? null : (total % 2 ? sums[middle] : (sums[middle - 1] + sums[middle]) / 2);

  return {
    drawCount: total,
    oddEven: oddCounts.map((count, odd) => ({ label: `${odd} odd / ${6 - odd} even`, odd, count })),
    lowHigh: lowCounts.map((count, low) => ({ label: `${low} low / ${6 - low} high`, low, count })),
    sum: {
      average: total === 0 ? null : roundTo(sums.reduce((a, b) => a + b, 0) / total, 1),
      median,
      lowest: total === 0 ? null : sums[0],
      highest: total === 0 ? null : sums[total - 1],
      buckets: [...sumBuckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([start, count]) => ({ from: start, to: start + sumBucketSize - 1, count })),
    },
    consecutivePairShare: total === 0 ? null : roundTo(withConsecutivePair / total, 4),
  };
}

/**
 * @param {object} options
 * @param {{ maxNumber: number }} options.game
 * @param {Array<{drawDate: string, numbers: number[]}>} options.draws - full history, oldest first
 * @param {string} options.today - "YYYY-MM-DD" (Philippine date)
 */
function computeStatistics({ game, draws, today, options = {} }) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const ordered = [...draws].sort((a, b) => (a.drawDate < b.drawDate ? -1 : 1));
  const windowStart = yearsBefore(today, settings.frequencyYears);
  const windowDraws = ordered.filter((draw) => draw.drawDate >= windowStart && draw.drawDate <= today);

  const gaps = buildGaps(ordered, game.maxNumber);
  const gapsByNumber = new Map(gaps.map((gap) => [gap.number, gap.drawsSinceLastSeen]));

  return {
    totalDraws: ordered.length,
    firstDrawDate: ordered.length ? ordered[0].drawDate : null,
    latestDrawDate: ordered.length ? ordered[ordered.length - 1].drawDate : null,
    frequency: buildFrequency(windowDraws, game.maxNumber, windowStart, today),
    hotCold: buildHotCold(ordered, game.maxNumber, gapsByNumber, settings),
    gaps,
    distributions: buildDistributions(windowDraws, game.maxNumber, settings),
  };
}

module.exports = { computeStatistics, yearsBefore, DEFAULT_OPTIONS };

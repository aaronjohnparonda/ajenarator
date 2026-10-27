'use strict';

/**
 * Describes the patterns in one 6-number combination. Pure function: no database, no network.
 * Shared by the statistics, the filters, the generator and the backtest, so every part of
 * AJenarator measures patterns exactly the same way.
 *
 * Definitions:
 *   oddCount                 how many numbers are odd (0-6)
 *   lowCount                 how many are in the lower half: 1 .. floor(maxNumber / 2)
 *   sum                      total of all six numbers
 *   longestRun               longest chain of consecutive numbers (1 = none, 2 = a pair like 14-15)
 *   maxSameLastDigit         most numbers sharing a last digit (e.g. 3, 13, 23 -> 3)
 *   decadeGroups             how many tens-groups are used: 1-9, 10-19, 20-29, ...
 *   maxInOneDecade           most numbers in a single tens-group (e.g. 30-33-35-38 -> 4)
 *   maxSameMultiple          most numbers that are multiples of the same 5, 6 or 7
 *                            (e.g. 5-15-25-35 -> 4); smaller bases are too common to matter
 *   hasEvenlySpacedFour      any 4 of the numbers evenly spaced (e.g. 5-10-15-20)
 *   allWithinBirthdayRange   every number is 31 or lower (typical birthday-based picks)
 */

const BIRTHDAY_MAX = 31;
const MULTIPLE_BASES = Object.freeze([5, 6, 7]);

function assertValidCombination(numbers, maxNumber) {
  if (!Array.isArray(numbers) || numbers.length !== 6) {
    throw new Error('A combination must have exactly 6 numbers.');
  }
  for (let index = 0; index < numbers.length; index += 1) {
    const number = numbers[index];
    if (!Number.isInteger(number) || number < 1 || number > maxNumber) {
      throw new Error(`Numbers must be whole numbers from 1 to ${maxNumber}.`);
    }
    if (index > 0 && number <= numbers[index - 1]) {
      throw new Error('Numbers must be unique and sorted from lowest to highest.');
    }
  }
}

function hasEvenlySpacedFour(sortedNumbers) {
  const values = new Set(sortedNumbers);
  for (let first = 0; first < sortedNumbers.length; first += 1) {
    for (let second = first + 1; second < sortedNumbers.length; second += 1) {
      const step = sortedNumbers[second] - sortedNumbers[first];
      if (values.has(sortedNumbers[second] + step) && values.has(sortedNumbers[second] + 2 * step)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * @param {number[]} numbers - 6 unique numbers sorted ascending
 * @param {number} maxNumber - the game's highest number (42, 45, 49, 55 or 58)
 */
function describeCombination(numbers, maxNumber) {
  assertValidCombination(numbers, maxNumber);

  const lowLimit = Math.floor(maxNumber / 2);
  const lastDigitCounts = new Array(10).fill(0);
  const decadeCounts = new Map();
  let oddCount = 0;
  let lowCount = 0;
  let sum = 0;
  let longestRun = 1;
  let currentRun = 1;
  let consecutivePairs = 0;

  numbers.forEach((number, index) => {
    oddCount += number % 2;
    lowCount += number <= lowLimit ? 1 : 0;
    sum += number;
    lastDigitCounts[number % 10] += 1;
    const decade = Math.floor(number / 10);
    decadeCounts.set(decade, (decadeCounts.get(decade) || 0) + 1);

    if (index > 0) {
      const followsPrevious = number === numbers[index - 1] + 1;
      currentRun = followsPrevious ? currentRun + 1 : 1;
      longestRun = Math.max(longestRun, currentRun);
      consecutivePairs += followsPrevious ? 1 : 0;
    }
  });

  return {
    oddCount,
    lowCount,
    sum,
    longestRun,
    consecutivePairs, // neighbours one apart: 1-2-33-34-41-42 has 3; 7-8-9 has 2
    maxSameLastDigit: Math.max(...lastDigitCounts),
    decadeGroups: decadeCounts.size,
    maxInOneDecade: Math.max(...decadeCounts.values()),
    maxSameMultiple: Math.max(...MULTIPLE_BASES.map((base) => numbers.filter((number) => number % base === 0).length)),
    hasEvenlySpacedFour: hasEvenlySpacedFour(numbers),
    allWithinBirthdayRange: numbers[numbers.length - 1] <= BIRTHDAY_MAX,
  };
}

/** How many numbers two combinations share (e.g. a pick and the previous draw). */
function sharedCount(numbers, otherNumbers) {
  const other = new Set(otherNumbers);
  return numbers.filter((number) => other.has(number)).length;
}

module.exports = { describeCombination, sharedCount, MULTIPLE_BASES };

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
 *   hasEvenlySpacedFour      any 4 of the numbers evenly spaced (e.g. 5-10-15-20)
 *   allWithinBirthdayRange   every number is 31 or lower (typical birthday-based picks)
 */

const BIRTHDAY_MAX = 31;

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
  const decades = new Set();
  let oddCount = 0;
  let lowCount = 0;
  let sum = 0;
  let longestRun = 1;
  let currentRun = 1;

  numbers.forEach((number, index) => {
    oddCount += number % 2;
    lowCount += number <= lowLimit ? 1 : 0;
    sum += number;
    lastDigitCounts[number % 10] += 1;
    decades.add(Math.floor(number / 10));

    if (index > 0) {
      currentRun = number === numbers[index - 1] + 1 ? currentRun + 1 : 1;
      longestRun = Math.max(longestRun, currentRun);
    }
  });

  return {
    oddCount,
    lowCount,
    sum,
    longestRun,
    maxSameLastDigit: Math.max(...lastDigitCounts),
    decadeGroups: decades.size,
    hasEvenlySpacedFour: hasEvenlySpacedFour(numbers),
    allWithinBirthdayRange: numbers[numbers.length - 1] <= BIRTHDAY_MAX,
  };
}

module.exports = { describeCombination };

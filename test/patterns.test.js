'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeCombination } = require('../src/engine/patterns');

test('describes a real 6/42 winning combination (Jan 2, 2025)', () => {
  assert.deepEqual(describeCombination([5, 33, 37, 40, 41, 42], 42), {
    oddCount: 4,
    lowCount: 1,
    sum: 198,
    longestRun: 3,
    maxSameLastDigit: 1,
    decadeGroups: 3,
    hasEvenlySpacedFour: false,
    allWithinBirthdayRange: false,
  });
});

test('detects the classic patterns', () => {
  const sequence = describeCombination([1, 2, 3, 4, 5, 6], 42);
  assert.equal(sequence.longestRun, 6);
  assert.equal(sequence.lowCount, 6);
  assert.equal(sequence.hasEvenlySpacedFour, true);
  assert.equal(sequence.decadeGroups, 1);
  assert.equal(sequence.allWithinBirthdayRange, true);

  assert.equal(describeCombination([1, 3, 5, 7, 9, 11], 42).oddCount, 6);
  assert.equal(describeCombination([3, 13, 23, 30, 40, 41], 42).maxSameLastDigit, 3);
  assert.equal(describeCombination([2, 9, 16, 23, 30, 41], 42).hasEvenlySpacedFour, true); // 9-16-23-30
});

test('low half is 1 to floor(max/2): 22 is low in 6/45, 23 is high', () => {
  assert.equal(describeCombination([1, 2, 22, 23, 44, 45], 45).lowCount, 3);
});

test('rejects invalid combinations', () => {
  assert.throws(() => describeCombination([1, 2, 3, 4, 5], 42), /exactly 6/);
  assert.throws(() => describeCombination([1, 2, 3, 4, 5, 43], 42), /1 to 42/);
  assert.throws(() => describeCombination([2, 1, 3, 4, 5, 6], 42), /sorted/);
  assert.throws(() => describeCombination([1, 1, 3, 4, 5, 6], 42), /unique/);
});

'use strict';

/**
 * AJenarator - compare patterns in REAL past draws with ALL possible combinations.
 * Read-only: changes nothing in the database.
 *
 * "All combinations" figures are exact: every possible 6-number combination of each game was
 * counted (5.2 million for 6/42 up to 40.5 million for 6/58). If a pattern shows up in real draws
 * about as often as it exists among all combinations, the draws are behaving as random draws should.
 *
 * Run with:  npm run analyze:patterns
 */

const { describeCombination } = require('../src/engine/patterns');

// Exact shares among ALL combinations (percent), from full enumeration. sumP5/sumP95 = middle-90% sum range.
const ALL_COMBINATIONS = {
  '6/42': { allOddOrEven: 2.06, allLowOrHigh: 2.06, run3: 6.43, pair: 55.68, sameDigit3: 8.32, decades2: 3.84, spaced4: 3.50, birthday: 14.04, sumP5: 83, sumP95: 175, recommendedRemoves: 20.4 },
  '6/45': { allOddOrEven: 2.16, allLowOrHigh: 2.16, run3: 5.63, pair: 52.87, sameDigit3: 8.95, decades2: 2.76, spaced4: 3.05, birthday: 9.04, sumP5: 89, sumP95: 187, recommendedRemoves: 19.5 },
  '6/49': { allOddOrEven: 2.23, allLowOrHigh: 2.23, run3: 4.77, pair: 49.52, sameDigit3: 9.22, decades2: 2.42, spaced4: 2.57, birthday: 5.27, sumP5: 96, sumP95: 204, recommendedRemoves: 18.3 },
  '6/55': { allOddOrEven: 2.32, allLowOrHigh: 2.32, run3: 3.81, pair: 45.18, sameDigit3: 10.12, decades2: 1.29, spaced4: 2.03, birthday: 2.54, sumP5: 107, sumP95: 229, recommendedRemoves: 16.8 },
  '6/58': { allOddOrEven: 2.34, allLowOrHigh: 2.34, run3: 3.43, pair: 43.28, sameDigit3: 10.29, decades2: 1.15, spaced4: 1.83, birthday: 1.82, sumP5: 112, sumP95: 242, recommendedRemoves: 16.1 },
};

const PATTERNS = [
  { key: 'allOddOrEven', label: 'All odd or all even (6-0)', test: (p) => p.oddCount === 0 || p.oddCount === 6 },
  { key: 'allLowOrHigh', label: 'All low or all high (6-0)', test: (p) => p.lowCount === 0 || p.lowCount === 6 },
  { key: 'run3', label: '3+ consecutive (e.g. 7-8-9)', test: (p) => p.longestRun >= 3 },
  { key: 'pair', label: 'Has a consecutive pair', test: (p) => p.longestRun >= 2 },
  { key: 'sameDigit3', label: '3+ share a last digit', test: (p) => p.maxSameLastDigit >= 3 },
  { key: 'decades2', label: 'Only 1-2 tens-groups used', test: (p) => p.decadeGroups <= 2 },
  { key: 'spaced4', label: '4 evenly spaced (5-10-15-20)', test: (p) => p.hasEvenlySpacedFour },
  { key: 'birthday', label: 'All numbers 31 or lower', test: (p) => p.allWithinBirthdayRange },
];

function percent(count, total) {
  return total === 0 ? '-' : `${((count / total) * 100).toFixed(2)}%`;
}

function pad(text, width) {
  return String(text).padEnd(width);
}

function isRemovedByRecommendedSet(pattern, reference) {
  return pattern.oddCount === 0 || pattern.oddCount === 6
    || pattern.lowCount === 0 || pattern.lowCount === 6
    || pattern.longestRun >= 3
    || pattern.decadeGroups <= 2
    || pattern.hasEvenlySpacedFour
    || pattern.sum < reference.sumP5 || pattern.sum > reference.sumP95;
}

async function main() {
  // Required inside main so configuration errors are printed cleanly below.
  const { pool, closePool } = require('../src/db/pool');

  try {
    const [games] = await pool.query('SELECT id, code, max_number FROM games WHERE is_active = 1 ORDER BY id');
    const [draws] = await pool.query('SELECT game_id, n1, n2, n3, n4, n5, n6 FROM draws');

    console.log('\n=== AJenarator: patterns in real draws vs all possible combinations ===');

    for (const game of games) {
      const reference = ALL_COMBINATIONS[game.code];
      const gameDraws = draws.filter((draw) => draw.game_id === game.id);
      const total = gameDraws.length;
      const counts = Object.fromEntries(PATTERNS.map((pattern) => [pattern.key, 0]));
      let sumOutside = 0;
      let removedByRecommended = 0;
      const seenCombinations = new Map();

      for (const draw of gameDraws) {
        const numbers = [draw.n1, draw.n2, draw.n3, draw.n4, draw.n5, draw.n6];
        const description = describeCombination(numbers, game.max_number);
        PATTERNS.forEach((pattern) => {
          if (pattern.test(description)) {
            counts[pattern.key] += 1;
          }
        });
        if (description.sum < reference.sumP5 || description.sum > reference.sumP95) {
          sumOutside += 1;
        }
        if (isRemovedByRecommendedSet(description, reference)) {
          removedByRecommended += 1;
        }
        const key = numbers.join('-');
        seenCombinations.set(key, (seenCombinations.get(key) || 0) + 1);
      }

      const repeatedWinners = [...seenCombinations.values()].filter((count) => count > 1).length;

      console.log(`\n${game.code}  (${total} real draws)`);
      console.log(`  ${pad('Pattern', 32)}${pad('All combos', 13)}Real draws`);
      PATTERNS.forEach((pattern) => {
        console.log(`  ${pad(pattern.label, 32)}${pad(`${reference[pattern.key].toFixed(2)}%`, 13)}${percent(counts[pattern.key], total)}  (${counts[pattern.key]})`);
      });
      console.log(`  ${pad(`Sum outside ${reference.sumP5}-${reference.sumP95}`, 32)}${pad('10.00%', 13)}${percent(sumOutside, total)}  (${sumOutside})`);
      console.log(`  ${pad('RECOMMENDED SET would remove', 32)}${pad(`${reference.recommendedRemoves.toFixed(1)}%`, 13)}${percent(removedByRecommended, total)}  (${removedByRecommended})`);
      console.log(`  ${pad('Winning combo ever repeated', 32)}${pad('-', 13)}${repeatedWinners === 0 ? 'never' : `${repeatedWinners} time(s)`}`);
    }

    console.log('\n"Recommended set" = no 6-0 odd/even, no 6-0 low/high, no 3+ consecutive,');
    console.log('at least 3 tens-groups, no 4 evenly spaced, sum inside the middle 90%.\n');
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
});

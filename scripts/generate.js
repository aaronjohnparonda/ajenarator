'use strict';

/**
 * AJenarator - generate combinations from the command line (before the website exists).
 *
 * Examples:
 *   npm run generate -- --game=6/42
 *   npm run generate -- --game=6/58 --count=10 --anti-birthday
 *   npm run generate -- --game=6/45 --relaxed --include=7,21 --exclude=13
 */

const { parseFilterOptions } = require('./lib/filter-options');

const percent = (share) => `${(share * 100).toFixed(1)}%`;

async function main() {
  const options = parseFilterOptions(process.argv.slice(2), { allowCount: true });
  if (!options.gameCode) {
    throw new Error('Choose a game, e.g. npm run generate -- --game=6/42');
  }

  // Required inside main so configuration errors are printed cleanly below.
  const { pool, closePool } = require('../src/db/pool');
  const { loadActiveGames } = require('../src/repositories/game-repository');
  const { loadPastWinnerKeys } = require('../src/repositories/draw-repository');
  const { resolveFilters, RULES } = require('../src/engine/filters');
  const { generateCombinations } = require('../src/engine/generator');
  const { estimateCoverage } = require('../src/engine/coverage');
  const { describeCombination } = require('../src/engine/patterns');

  try {
    const game = (await loadActiveGames(pool)).find((entry) => entry.code === options.gameCode);
    if (!game) {
      throw new Error(`Unknown game "${options.gameCode}". Use 6/42, 6/45, 6/49, 6/55 or 6/58.`);
    }

    const filters = resolveFilters(game, options.filterSettings);
    const pastWinnerKeys = await loadPastWinnerKeys(pool, game.id);
    const { combinations } = generateCombinations({ game, filters, count: options.count, pastWinnerKeys });
    const coverage = estimateCoverage({ game, filters });

    console.log(`\n=== AJenarator: ${game.name} picks ===`);
    combinations.forEach((numbers, index) => {
      const pattern = describeCombination(numbers, game.maxNumber);
      const display = numbers.map((number) => String(number).padStart(2, '0')).join(' - ');
      console.log(`  ${String(index + 1).padStart(2)}.  ${display}    (sum ${pattern.sum}, ${pattern.oddCount} odd/${6 - pattern.oddCount} even, ${pattern.lowCount} low/${6 - pattern.lowCount} high)`);
    });

    const activeRules = RULES.filter((rule) => {
      const setting = filters[rule.key];
      return Array.isArray(setting) ? setting.length > 0 : setting.enabled;
    }).map((rule) => rule.key);

    console.log('\nFilters on   :', activeRules.length ? activeRules.join(', ') : 'none');
    console.log(`Combinations : your filters keep ${percent(coverage.keptShare)} of all ${coverage.totalCombinations.toLocaleString('en-US')} possible combinations`);
    console.log(`Odds         : each ticket is still 1 in ${coverage.totalCombinations.toLocaleString('en-US')} for the jackpot - filters do not change that\n`);
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
});

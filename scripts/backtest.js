'use strict';

/**
 * AJenarator - backtest filter settings against every past draw.
 *
 * Examples:
 *   npm run backtest                         default filters, all games
 *   npm run backtest -- --game=6/42 --relaxed
 *   npm run backtest -- --anti-birthday --last-digit
 */

const { parseFilterOptions } = require('./lib/filter-options');

const percent = (share) => `${(share * 100).toFixed(1)}%`;

async function main() {
  const options = parseFilterOptions(process.argv.slice(2));

  // Required inside main so configuration errors are printed cleanly below.
  const { pool, closePool } = require('../src/db/pool');
  const { loadActiveGames } = require('../src/repositories/game-repository');
  const { loadDrawsForGame } = require('../src/repositories/draw-repository');
  const { resolveFilters, RULES } = require('../src/engine/filters');
  const { estimateCoverage } = require('../src/engine/coverage');
  const { runBacktest } = require('../src/engine/backtest');

  const ruleLabels = Object.fromEntries(RULES.map((rule) => [rule.key, rule.label]));

  try {
    let games = await loadActiveGames(pool);
    if (options.gameCode) {
      games = games.filter((game) => game.code === options.gameCode);
      if (games.length === 0) {
        throw new Error(`Unknown game "${options.gameCode}". Use 6/42, 6/45, 6/49, 6/55 or 6/58.`);
      }
    }

    console.log('\n=== AJenarator: backtest against past draws ===');

    for (const game of games) {
      const filters = resolveFilters(game, options.filterSettings);
      const draws = await loadDrawsForGame(pool, game.id);
      const coverage = estimateCoverage({ game, filters });
      const result = runBacktest({ game, filters, draws, coverage });

      console.log(`\n${game.name}  (${result.totalDraws} past draws)`);
      console.log(`  Kept past winners        : ${result.keptDraws} of ${result.totalDraws} = ${percent(result.keptShareOfWinners)}  (95% range ${percent(result.keptShareRange.low)}-${percent(result.keptShareRange.high)})`);
      console.log(`  Kept of ALL combinations : ${percent(result.keptShareOfAllCombinations)}`);

      const removed = Object.entries(result.removedByRule).sort((a, b) => b[1] - a[1]);
      if (removed.length) {
        console.log('  Winners removed by rule  :');
        removed.forEach(([rule, count]) => console.log(`    - ${ruleLabels[rule]}: ${count}`));
      }
      console.log(`  Verdict                  : ${result.verdict}`);
    }
    console.log('');
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
});

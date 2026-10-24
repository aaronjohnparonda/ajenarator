'use strict';

/**
 * AJenarator - show statistics for one game (preview of the future stats page).
 *
 * Usage:
 *   npm run stats -- --game=6/42
 */

const GAME_OPTION_PATTERN = /^--game=(.+)$/;
const LATEST_DRAW_COUNT = 5;
const LONGEST_GAP_COUNT = 6;

function parseGameCode(argv) {
  if (argv.length !== 1 || !GAME_OPTION_PATTERN.test(argv[0])) {
    throw new Error('Usage: npm run stats -- --game=6/42');
  }
  return GAME_OPTION_PATTERN.exec(argv[0])[1];
}

const pad2 = (number) => String(number).padStart(2, '0');
const peso = (amount) => (amount === null ? 'n/a' : `PHP ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

async function main() {
  const gameCode = parseGameCode(process.argv.slice(2));

  // Required inside main so configuration errors are printed cleanly below.
  const { pool, closePool } = require('../src/db/pool');
  const { loadActiveGames } = require('../src/repositories/game-repository');
  const { loadDrawsForGame, loadLatestDraws } = require('../src/repositories/draw-repository');
  const { computeStatistics } = require('../src/engine/statistics');
  const { nowInManila } = require('../src/utils/ph-time');

  try {
    const game = (await loadActiveGames(pool)).find((entry) => entry.code === gameCode);
    if (!game) {
      throw new Error(`Unknown game "${gameCode}". Use 6/42, 6/45, 6/49, 6/55 or 6/58.`);
    }

    const [draws, latest] = await Promise.all([
      loadDrawsForGame(pool, game.id),
      loadLatestDraws(pool, game.id, LATEST_DRAW_COUNT),
    ]);
    const stats = computeStatistics({ game, draws, today: nowInManila().date });
    const { frequency, hotCold, distributions } = stats;

    console.log(`\n=== AJenarator: ${game.name} statistics ===`);
    console.log(`History: ${stats.totalDraws} draws, ${stats.firstDrawDate} to ${stats.latestDrawDate}\n`);

    console.log('Latest results');
    latest.forEach((draw) => {
      console.log(`  ${draw.drawDate}   ${draw.numbers.map(pad2).join(' - ')}   jackpot ${peso(draw.jackpotAmount)}, winners ${draw.winners ?? 'n/a'}`);
    });

    console.log(`\nHot & cold (last ${hotCold.drawCount} draws; an average number appears ${hotCold.expectedPerNumber} times)`);
    console.log(`  Hot : ${hotCold.hot.map((entry) => `${pad2(entry.number)} (${entry.count}x)`).join('  ')}`);
    console.log(`  Cold: ${hotCold.cold.map((entry) => `${pad2(entry.number)} (${entry.count}x)`).join('  ')}`);

    console.log(`\nFrequency (${frequency.windowStart} to ${frequency.windowEnd}, ${frequency.drawCount} draws; average ${frequency.expectedPerNumber} each)`);
    if (frequency.drawCount === 0) {
      console.log('  No draws in the last 3 years.');
    } else {
      const sortedFrequency = [...frequency.numbers].sort((a, b) => b.count - a.count || a.number - b.number);
      console.log(`  Most drawn : ${sortedFrequency.slice(0, 6).map((entry) => `${pad2(entry.number)} (${entry.count}x)`).join('  ')}`);
      console.log(`  Least drawn: ${sortedFrequency.slice(-6).reverse().map((entry) => `${pad2(entry.number)} (${entry.count}x)`).join('  ')}`);
    }

    const longestGaps = [...stats.gaps]
      .filter((gap) => gap.drawsSinceLastSeen !== null)
      .sort((a, b) => b.drawsSinceLastSeen - a.drawsSinceLastSeen)
      .slice(0, LONGEST_GAP_COUNT);
    console.log('\nLongest gaps (draws since last drawn)');
    console.log(`  ${longestGaps.map((gap) => `${pad2(gap.number)}: ${gap.drawsSinceLastSeen} draws (last ${gap.lastSeenDate})`).join('\n  ')}`);

    console.log(`\nPatterns in the last 3 years (${distributions.drawCount} draws)`);
    if (distributions.drawCount === 0) {
      console.log('  No draws in the last 3 years.');
    } else {
      console.log(`  Sum: average ${distributions.sum.average}, median ${distributions.sum.median}, range ${distributions.sum.lowest}-${distributions.sum.highest}`);
      const topOddEven = [...distributions.oddEven].sort((a, b) => b.count - a.count).slice(0, 3);
      console.log(`  Most common odd/even: ${topOddEven.map((row) => `${row.label} (${row.count})`).join(', ')}`);
      console.log(`  Draws with a consecutive pair: ${(distributions.consecutivePairShare * 100).toFixed(1)}%`);
    }

    console.log('\nNote: these describe past draws only. Draws are random, so a "hot" or long-absent');
    console.log('number is not more likely to be drawn next.\n');
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
});

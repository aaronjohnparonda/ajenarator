'use strict';

/**
 * AJenarator - check the three rules added in Oct 2026 against REAL past draws.
 * Read-only: changes nothing in the database.
 *
 *   npm run analyze:new-rules
 *
 * For each game and rule it shows:
 *   - the exact share of ALL possible combinations with that pattern
 *     (counted over every combination, or exact probability for the previous-draw rule)
 *   - the share of REAL winners with that pattern, with a 95% range
 *   - a verdict: if the exact share sits inside the real 95% range, real draws behave like
 *     random draws for that pattern (expected), so the rule removes winners at the same rate
 *     it removes tickets - it shapes picks without hurting or helping the odds.
 */

const { describeCombination, sharedCount } = require('../src/engine/patterns');
const { wilsonInterval } = require('../src/engine/backtest');

// Exact shares (percent) counted over every combination of each game.
const EXACT_ALL = {
  '6/42': { sameMultiple: 1.381, crowdedDecade: 7.779 },
  '6/45': { sameMultiple: 1.483, crowdedDecade: 6.105 },
  '6/49': { sameMultiple: 1.388, crowdedDecade: 5.478 },
  '6/55': { sameMultiple: 1.758, crowdedDecade: 3.560 },
  '6/58': { sameMultiple: 1.537, crowdedDecade: 3.226 },
};

/** Exact chance that a random ticket shares 4+ numbers with one fixed earlier draw. */
function exactShareFourFromPrevious(maxNumber) {
  const choose = (n, k) => {
    let result = 1;
    for (let i = 1; i <= k; i += 1) {
      result = (result * (n - k + i)) / i;
    }
    return result;
  };
  let favourable = 0;
  for (let shared = 4; shared <= 6; shared += 1) {
    favourable += choose(6, shared) * choose(maxNumber - 6, 6 - shared);
  }
  return (favourable / choose(maxNumber, 6)) * 100;
}

const RULES = [
  { key: 'sameMultiple', label: '4+ multiples of 5, 6 or 7', defaultOn: true },
  { key: 'lastDrawRepeat', label: '4+ from the previous draw', defaultOn: true },
  { key: 'crowdedDecade', label: '4+ in one tens-group', defaultOn: false },
];

function pct(value, decimals = 2) {
  return `${value.toFixed(decimals)}%`;
}

async function main() {
  const { pool, closePool } = require('../src/db/pool');

  try {
    const [games] = await pool.query('SELECT id, code, max_number FROM games WHERE is_active = 1 ORDER BY id');
    const [draws] = await pool.query('SELECT game_id, draw_date, n1, n2, n3, n4, n5, n6 FROM draws ORDER BY game_id, draw_date');

    console.log('\n=== AJenarator: new rules vs REAL past winners ===');
    console.log('If "All tickets" sits inside the real 95% range, the rule removes real winners at the');
    console.log('same rate as tickets in general: it shapes picks without changing the odds (expected).\n');

    for (const game of games) {
      const gameDraws = draws.filter((draw) => draw.game_id === game.id);
      const counts = { sameMultiple: 0, lastDrawRepeat: 0, crowdedDecade: 0 };
      const examples = { sameMultiple: [], lastDrawRepeat: [], crowdedDecade: [] };
      let previous = null;

      for (const draw of gameDraws) {
        const numbers = [draw.n1, draw.n2, draw.n3, draw.n4, draw.n5, draw.n6];
        const pattern = describeCombination(numbers, game.max_number);
        const hits = {
          sameMultiple: pattern.maxSameMultiple >= 4,
          crowdedDecade: pattern.maxInOneDecade >= 4,
          lastDrawRepeat: previous !== null && sharedCount(numbers, previous) >= 4,
        };
        Object.entries(hits).forEach(([key, hit]) => {
          if (hit) {
            counts[key] += 1;
            if (examples[key].length < 3) {
              examples[key].push(`${draw.draw_date} ${numbers.join('-')}`);
            }
          }
        });
        previous = numbers;
      }

      const total = gameDraws.length;
      console.log(`${game.code}  (${total} real draws)`);
      console.log(`  ${'Rule'.padEnd(28)}${'All tickets'.padEnd(13)}${'Real winners'.padEnd(24)}Verdict`);

      for (const rule of RULES) {
        const allShare = rule.key === 'lastDrawRepeat'
          ? exactShareFourFromPrevious(game.max_number)
          : EXACT_ALL[game.code][rule.key];
        const range = wilsonInterval(counts[rule.key], total);
        const low = range.low * 100;
        const high = range.high * 100;
        let verdict = 'matches chance';
        if (allShare < low) {
          verdict = 'MORE common in real winners - consider turning off';
        } else if (allShare > high) {
          verdict = 'rarer in real winners than chance';
        }
        const real = `${pct((counts[rule.key] / total) * 100)} (${counts[rule.key]})`;
        console.log(`  ${rule.label.padEnd(28)}${pct(allShare, 3).padEnd(13)}${real.padEnd(24)}${verdict}  [95% ${pct(low)}-${pct(high)}]`);
        if (examples[rule.key].length) {
          console.log(`    e.g. ${examples[rule.key].join(' | ')}`);
        }
      }
      console.log('');
    }
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
});

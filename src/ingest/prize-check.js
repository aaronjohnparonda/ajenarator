'use strict';

/**
 * Decides whether a fetched prize breakdown is trustworthy enough to save. Pure function.
 *
 * Every rule must pass:
 *   1. The winning numbers equal the official PCSO result already saved for that draw
 *      (so a table for the wrong day or wrong game can never be attached).
 *   2. 5- and 4-number prizes: winners x prize each = the game's fixed pool. PCSO cuts each
 *      share to the centavo, so up to 1 centavo per winner may be missing (19 x 57,894.73
 *      = 1,099,999.87 of 1,100,000), never more, never over.
 *   3. 3-number prize: exactly the game's fixed amount.
 *   4. Counts are whole numbers in a believable range.
 */

const { prizeStructureFor } = require('../config/prize-structure');

const MAX_WINNERS = 50000000;

function checkPool(tierName, tier, poolCentavos) {
  if (tier.winners === 0) {
    return null;
  }
  if (tier.prizeCentavos === null || tier.prizeCentavos <= 0) {
    return `${tierName}: ${tier.winners} winners but no prize amount`;
  }
  const total = tier.winners * tier.prizeCentavos;
  const shortBy = poolCentavos - total;
  if (shortBy < 0 || shortBy > tier.winners) {
    return `${tierName}: ${tier.winners} x ${(tier.prizeCentavos / 100).toFixed(2)} = ${(total / 100).toFixed(2)}, expected the ${(poolCentavos / 100).toFixed(2)} pool`;
  }
  return null;
}

/**
 * @param {object} input
 * @param {string} input.gameCode - "6/58"
 * @param {number[]} input.storedNumbers - official PCSO numbers, sorted
 * @param {{ numbers: number[], tiers: object }} input.fetched - from parsePrizePage
 * @returns {{ ok: true, prizes: object } | { ok: false, reason: string }}
 *   prizes: { match5: { winners, prizeCentavos|null }, match4: ..., match3: ... }
 */
function checkPrizeBreakdown({ gameCode, storedNumbers, fetched }) {
  const structure = prizeStructureFor(gameCode);
  if (!structure) {
    return { ok: false, reason: `no prize rules for ${gameCode}` };
  }
  if (!fetched || !Array.isArray(fetched.numbers) || !fetched.tiers) {
    return { ok: false, reason: 'breakdown incomplete' };
  }
  if (fetched.numbers.join('-') !== storedNumbers.join('-')) {
    return { ok: false, reason: `winning numbers ${fetched.numbers.join('-')} differ from PCSO ${storedNumbers.join('-')}` };
  }

  const { 5: match5, 4: match4, 3: match3 } = fetched.tiers;
  for (const [name, tier] of [['5 numbers', match5], ['4 numbers', match4], ['3 numbers', match3]]) {
    if (!tier || !Number.isInteger(tier.winners) || tier.winners < 0 || tier.winners > MAX_WINNERS) {
      return { ok: false, reason: `${name}: winner count unreadable` };
    }
  }

  const problem = checkPool('5 numbers', match5, structure.match5Pool)
    || checkPool('4 numbers', match4, structure.match4Pool)
    || (match3.winners > 0 && match3.prizeCentavos !== structure.match3Prize
      ? `3 numbers: prize ${((match3.prizeCentavos || 0) / 100).toFixed(2)}, expected the fixed ${(structure.match3Prize / 100).toFixed(2)}`
      : null);
  if (problem) {
    return { ok: false, reason: problem };
  }

  const keep = (tier) => ({ winners: tier.winners, prizeCentavos: tier.winners === 0 ? null : tier.prizeCentavos });
  return { ok: true, prizes: { match5: keep(match5), match4: keep(match4), match3: keep(match3) } };
}

module.exports = { checkPrizeBreakdown };

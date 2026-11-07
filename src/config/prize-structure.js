'use strict';

/**
 * PCSO lower-prize rules per game, in centavos (whole numbers, so the checks never hit
 * floating-point rounding).
 *
 *   match5Pool / match4Pool: a fixed pool shared equally by everyone who matched 5 (or 4).
 *     e.g. 6/58: 40 winners share PHP 1,500,000 -> PHP 37,500 each.
 *   match3Prize: a fixed amount per winner.
 *
 * Sources: pcsodraw.com game guides and the PCSO Lotto prize table (Wikipedia), confirmed
 * against real draws (6/58 Nov 6, 2026: 40 x 37,500 = 1.5M; 2,871 x 487.63 = 1.4M; 3-match 100).
 * If PCSO ever changes these, the breakdown checks fail and nothing wrong gets saved:
 * the server log says which number disagreed, and this file is the one place to update.
 */

const PESO = 100;

const PRIZE_STRUCTURE = Object.freeze({
  '6/42': Object.freeze({ match5Pool: 1100000 * PESO, match4Pool: 1000000 * PESO, match3Prize: 20 * PESO }),
  '6/45': Object.freeze({ match5Pool: 1200000 * PESO, match4Pool: 1100000 * PESO, match3Prize: 30 * PESO }),
  '6/49': Object.freeze({ match5Pool: 1300000 * PESO, match4Pool: 1200000 * PESO, match3Prize: 50 * PESO }),
  '6/55': Object.freeze({ match5Pool: 1400000 * PESO, match4Pool: 1300000 * PESO, match3Prize: 60 * PESO }),
  '6/58': Object.freeze({ match5Pool: 1500000 * PESO, match4Pool: 1400000 * PESO, match3Prize: 100 * PESO }),
});

/** @returns {{ match5Pool: number, match4Pool: number, match3Prize: number } | null} centavos */
function prizeStructureFor(gameCode) {
  return PRIZE_STRUCTURE[gameCode] || null;
}

/** 2000 -> "20.00" (the same string shape mysql2 returns for DECIMAL columns). */
function centavosToPesoString(centavos) {
  return (centavos / PESO).toFixed(2);
}

module.exports = { PRIZE_STRUCTURE, prizeStructureFor, centavosToPesoString };

/**
 * SAMPLE DATA - used only while the screens are being built.
 * Same function names and response shapes as the real API client that replaces this file
 * in the "connect to the engine" step, so the screens will not need to change.
 *
 * The jackpots are sample values from real past PCSO results; coverage shares are the real
 * default-filter figures from the Phase 2 backtest. Sample picks pass a simplified version of
 * the default filters (balance, consecutive, sum range) so their "Passes all filters" badge
 * is true; the real engine applies the complete filter set.
 */

const SAMPLE_GAMES = [
  { code: '6/42', name: 'Lotto 6/42', maxNumber: 42, drawDays: [2, 4, 6], drawTime: '21:00', jackpotAmount: '29935246.80', coverageShare: 0.795, sumRange: [83, 175] },
  { code: '6/45', name: 'Mega Lotto 6/45', maxNumber: 45, drawDays: [1, 3, 5], drawTime: '21:00', jackpotAmount: '15000000.00', coverageShare: 0.805, sumRange: [89, 187] },
  { code: '6/49', name: 'Super Lotto 6/49', maxNumber: 49, drawDays: [2, 4, 7], drawTime: '21:00', jackpotAmount: '49497917.20', coverageShare: 0.818, sumRange: [96, 204] },
  { code: '6/55', name: 'Grand Lotto 6/55', maxNumber: 55, drawDays: [1, 3, 6], drawTime: '21:00', jackpotAmount: '190686140.80', coverageShare: 0.831, sumRange: [107, 229] },
  { code: '6/58', name: 'Ultra Lotto 6/58', maxNumber: 58, drawDays: [2, 5, 7], drawTime: '21:00', jackpotAmount: '430857884.28', coverageShare: 0.839, sumRange: [112, 242] },
];

function passesSampleFilters({ numbers, pattern }, game) {
  const hasRunOfThree = numbers.some((number, index) => index >= 2
    && numbers[index - 1] === number - 1 && numbers[index - 2] === number - 2);
  return pattern.oddCount > 0 && pattern.oddCount < 6
    && pattern.lowCount > 0 && pattern.lowCount < 6
    && !hasRunOfThree
    && pattern.sum >= game.sumRange[0] && pattern.sum <= game.sumRange[1];
}

const SIMULATED_DELAY_MS = 300;

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function randomInt(maxExclusive) {
  const values = new Uint32Array(1);
  window.crypto.getRandomValues(values);
  return values[0] % maxExclusive;
}

function randomPick(maxNumber) {
  const chosen = new Set();
  while (chosen.size < 6) {
    chosen.add(1 + randomInt(maxNumber));
  }
  const numbers = [...chosen].sort((a, b) => a - b);
  return {
    numbers,
    pattern: {
      sum: numbers.reduce((total, number) => total + number, 0),
      oddCount: numbers.filter((number) => number % 2 === 1).length,
      lowCount: numbers.filter((number) => number <= Math.floor(maxNumber / 2)).length,
    },
  };
}

export async function fetchGames() {
  await wait(SIMULATED_DELAY_MS);
  return SAMPLE_GAMES.map(({ sumRange, ...game }) => ({ ...game, drawDays: [...game.drawDays] }));
}

export async function generatePicks({ gameCode, count }) {
  await wait(SIMULATED_DELAY_MS);
  const game = SAMPLE_GAMES.find((entry) => entry.code === gameCode);
  if (!game) {
    throw new Error(`Unknown game ${gameCode}`);
  }
  const picks = [];
  const seen = new Set();
  while (picks.length < count) {
    const pick = randomPick(game.maxNumber);
    const key = pick.numbers.join('-');
    if (!seen.has(key) && passesSampleFilters(pick, game)) {
      seen.add(key);
      picks.push(pick);
    }
  }
  return { gameCode, picks, coverageShare: game.coverageShare };
}

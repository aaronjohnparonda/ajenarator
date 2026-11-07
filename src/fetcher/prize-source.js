'use strict';

/**
 * Lower-prize breakdown source: The Summit Express daily "PCSO Lotto Result Today" page.
 *
 * Why this site: PCSO's own results page lists only the jackpot. Summit Express republishes
 * PCSO's official per-draw breakdown (winners and prize for 5, 4 and 3 matches) on one page
 * per day, at a predictable address, as plain HTML tables. Its robots.txt allows these pages
 * (it only blocks /search, /feeds/, /comments/ and ?m=1 / ?m=0).
 *
 * Nothing read here is trusted on its own: src/ingest/prize-check.js compares every value
 * with the PCSO result and the prize rules before anything is saved.
 *
 * One table per game looks like:
 *   <th>Ultra Lotto 6/58</th><th>November 6, 2026</th>
 *   Winning Numbers     | 09-26-10-04-02-47
 *   Jackpot Prize       | ₱489,846,673.65       (sometimes "Estimated Jackpot")
 *   Jackpot Winner(s)   | 0
 *   2nd Prize (5 of 6)  | 40 / ₱37,500.00       (spacing around "/" varies: "12/ ₱", "1400 / ₱")
 *   3rd Prize (4 of 6)  | 2,871 / ₱487.63
 *   4th Prize (3 of 6)  | 49,957 / ₱100.00
 */

const cheerio = require('cheerio');
const { isValidIsoDate } = require('../utils/ph-time');

const SOURCE_NAME = 'summitexpress';
const SITE_ORIGIN = 'https://www.thesummitexpress.com';
const DEFAULT_USER_AGENT = 'AJenarator/0.1 (personal lotto analytics project)';
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RETRY_DELAYS_MS = [3000];
const MAX_PAGE_BYTES = 3 * 1024 * 1024;

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const GAME_CODE_PATTERN = /\b6\s*\/\s*(\d{2})\b/;
const HEADER_DATE_PATTERN = /^([a-z]+)\s+(\d{1,2}),\s*(\d{4})$/i;
const NUMBERS_PATTERN = /^\d{1,2}(\s*-\s*\d{1,2}){5}$/;
const TIER_LABEL_PATTERN = /\(\s*([345])\s*of\s*6\s*\)/i;
// "40 / ₱37,500.00", "12/ ₱91,666.66", "1400 / ₱928.57", "40 / P37,500.00", "40 / 37,500"
const TIER_VALUE_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d+)\s*\/\s*(?:₱|PHP|P)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/i;
// "0", "0 / -", "0 / ₱0.00": nobody won this tier
const ZERO_WINNERS_PATTERN = /^0\s*(?:\/\s*(?:-|—|(?:₱|PHP|P)?\s*0(?:\.0{1,2})?)?)?$/i;

class PrizeSourceError extends Error {
  constructor(message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = 'PrizeSourceError';
    this.retryable = retryable;
    this.status = status;
  }
}

/** "2026-11-03" -> "https://www.thesummitexpress.com/2026/11/pcso-lotto-result-today-november-3-2026.html" */
function prizePageUrl(isoDate) {
  if (!isValidIsoDate(isoDate)) {
    throw new Error(`Invalid date "${isoDate}". Expected YYYY-MM-DD.`);
  }
  const [year, month, day] = isoDate.split('-').map(Number);
  const monthPath = String(month).padStart(2, '0');
  return `${SITE_ORIGIN}/${year}/${monthPath}/pcso-lotto-result-today-${MONTHS[month - 1]}-${day}-${year}.html`;
}

/** "November 3, 2026" -> "2026-11-03"; null if unreadable. */
function parseHeaderDate(text) {
  const match = HEADER_DATE_PATTERN.exec(String(text || '').trim());
  if (!match) {
    return null;
  }
  const monthIndex = MONTHS.indexOf(match[1].toLowerCase());
  if (monthIndex === -1) {
    return null;
  }
  const isoDate = `${match[3]}-${String(monthIndex + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return isValidIsoDate(isoDate) ? isoDate : null;
}

function toWholeNumber(text) {
  return Number(text.replace(/,/g, ''));
}

/**
 * One tier cell -> { winners, prizeCentavos } (prizeCentavos null when nobody won);
 * null when the cell is blank or not in a known shape (e.g. results not posted yet).
 */
function parseTierValue(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (ZERO_WINNERS_PATTERN.test(value)) {
    return { winners: 0, prizeCentavos: null };
  }
  const match = TIER_VALUE_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const cents = match[3] ? Number(match[3].padEnd(2, '0')) : 0;
  return { winners: toWholeNumber(match[1]), prizeCentavos: toWholeNumber(match[2]) * 100 + cents };
}

/** "16-55-01-06-27-14" -> [1, 6, 14, 16, 27, 55]; null if not six numbers. */
function parseWinningNumbers(text) {
  const value = String(text || '').trim();
  if (!NUMBERS_PATTERN.test(value)) {
    return null;
  }
  return value.split('-').map((part) => Number(part.trim())).sort((a, b) => a - b);
}

/**
 * Reads every 6-number game table on one daily page.
 * @param {string} html
 * @param {string} expectedDate - "YYYY-MM-DD"; tables dated differently are ignored
 * @returns {Map<string, { gameCode, numbers, tiers } | { gameCode, notReady: string }>}
 *   keyed by game code ("6/58"). tiers: { 5: {winners, prizeCentavos}, 4: ..., 3: ... }
 */
function parsePrizePage(html, expectedDate) {
  const $ = cheerio.load(html);
  const games = new Map();

  $('.post-body table, article table').each((_, table) => {
    const headers = $(table).find('thead th, tr:first-child th').map((__, cell) => $(cell).text().trim()).get();
    if (headers.length < 2) {
      return;
    }
    const codeMatch = GAME_CODE_PATTERN.exec(headers[0]);
    if (!codeMatch || !/lotto/i.test(headers[0])) {
      return; // schedule table, jackpot history, 2D/3D/6D tables
    }
    const gameCode = `6/${codeMatch[1]}`;
    if (parseHeaderDate(headers[1]) !== expectedDate || games.has(gameCode)) {
      return;
    }

    let numbers = null;
    const tiers = {};
    $(table).find('tbody tr').each((__, row) => {
      const cells = $(row).find('td').map((___, cell) => $(cell).text().trim()).get();
      if (cells.length < 2) {
        return;
      }
      const [label, value] = cells;
      if (/winning\s*numbers?/i.test(label)) {
        numbers = parseWinningNumbers(value);
        return;
      }
      const tierMatch = TIER_LABEL_PATTERN.exec(label);
      if (tierMatch) {
        tiers[tierMatch[1]] = parseTierValue(value);
      }
    });

    const missing = ['5', '4', '3'].filter((tier) => !tiers[tier]);
    if (!numbers) {
      games.set(gameCode, { gameCode, notReady: 'winning numbers not posted yet' });
    } else if (missing.length > 0) {
      games.set(gameCode, { gameCode, notReady: `${missing.map((tier) => `${tier}-number`).join(', ')} prize not posted yet` });
    } else {
      games.set(gameCode, { gameCode, numbers, tiers: { 5: tiers['5'], 4: tiers['4'], 3: tiers['3'] } });
    }
  });

  return games;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createPrizeSourceClient({
  fetchImpl = globalThis.fetch,
  userAgent = DEFAULT_USER_AGENT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
} = {}) {
  async function getOnce(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-PH,en;q=0.9' },
      });
      if (response.status === 404) {
        return { status: 404, body: null };
      }
      // robots.txt disallows the mobile "?m=" pages; never read one even if redirected there.
      if (typeof response.url === 'string' && /[?&]m=/.test(response.url)) {
        throw new PrizeSourceError('Summit Express redirected to a page robots.txt disallows; not reading it.');
      }
      if (response.status >= 500) {
        throw new PrizeSourceError(`Summit Express server error (HTTP ${response.status}).`, { retryable: true, status: response.status });
      }
      if (!response.ok) {
        throw new PrizeSourceError(`Summit Express refused the request (HTTP ${response.status}).`, { status: response.status });
      }
      const body = await response.text();
      if (body.length > MAX_PAGE_BYTES) {
        throw new PrizeSourceError('Summit Express page is unexpectedly large; not reading it.');
      }
      return { status: response.status, body };
    } catch (error) {
      if (error instanceof PrizeSourceError) {
        throw error;
      }
      const reason = error.name === 'AbortError'
        ? `no response within ${timeoutMs / 1000} seconds`
        : (error.cause && error.cause.code) || error.message;
      throw new PrizeSourceError(`Could not reach Summit Express (${reason}).`, { retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /**
     * @param {string} isoDate
     * @returns {Promise<{ found: false, url } | { found: true, url, games: Map }>}
     */
    async fetchDay(isoDate) {
      const url = prizePageUrl(isoDate);
      for (let attempt = 0; ; attempt += 1) {
        try {
          const { status, body } = await getOnce(url);
          if (status === 404) {
            return { found: false, url };
          }
          return { found: true, url, games: parsePrizePage(body, isoDate) };
        } catch (error) {
          if (!error.retryable || attempt >= retryDelaysMs.length) {
            throw error;
          }
          await sleep(retryDelaysMs[attempt]);
        }
      }
    },
  };
}

module.exports = {
  SOURCE_NAME,
  createPrizeSourceClient,
  parsePrizePage,
  parseTierValue,
  parseWinningNumbers,
  parseHeaderDate,
  prizePageUrl,
  PrizeSourceError,
};

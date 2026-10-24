'use strict';

/**
 * PCSO results client.
 *
 * PCSO has no public API. Its results page is an ASP.NET form, so one search is:
 *   1. GET the page: read its hidden security fields, session cookie, game list and year list.
 *   2. POST the form back with the date range and game.
 *   3. Parse the results table.
 *
 * Field names and behaviour were confirmed against the live page in Phase 0.
 * Network errors and PCSO server errors (5xx) are retried with a growing pause.
 */

const cheerio = require('cheerio');
const { parseResultsPage, PcsoPageChangedError } = require('./parse-results');
const { normalizeGameName } = require('./normalize-draw');
const { isValidIsoDate } = require('../utils/ph-time');

const PAGE_URL = 'https://www.pcso.gov.ph/SearchLottoResult.aspx';
const PAGE_ORIGIN = 'https://www.pcso.gov.ph';
const DEFAULT_USER_AGENT = 'AJenarator/0.1 (personal lotto analytics project)';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRY_DELAYS_MS = [2000, 5000];
const ALL_GAMES_VALUE = '0';

// Note: start day is "ddlStartDate" but end day is "ddlEndDay" - PCSO's own naming.
const FIELD = Object.freeze({
  startMonth: 'ctl00$ctl00$cphContainer$cpContent$ddlStartMonth',
  startDay: 'ctl00$ctl00$cphContainer$cpContent$ddlStartDate',
  startYear: 'ctl00$ctl00$cphContainer$cpContent$ddlStartYear',
  endMonth: 'ctl00$ctl00$cphContainer$cpContent$ddlEndMonth',
  endDay: 'ctl00$ctl00$cphContainer$cpContent$ddlEndDay',
  endYear: 'ctl00$ctl00$cphContainer$cpContent$ddlEndYear',
  game: 'ctl00$ctl00$cphContainer$cpContent$ddlSelectGame',
  searchButton: 'ctl00$ctl00$cphContainer$cpContent$btnSearch',
});
const SEARCH_BUTTON_LABEL = 'Search Lotto';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

class PcsoRequestError extends Error {
  constructor(message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = 'PcsoRequestError';
    this.retryable = retryable;
    this.status = status;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function splitIsoDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year, month, day };
}

function extractCookieHeader(response) {
  const setCookieValues = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];
  return setCookieValues.map((cookie) => cookie.split(';')[0]).join('; ');
}

function createPcsoClient({
  fetchImpl = globalThis.fetch,
  userAgent = DEFAULT_USER_AGENT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available. Node.js 22 or newer is required.');
  }

  async function sendOnce(options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(PAGE_URL, {
        ...options,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-PH,en;q=0.9',
          ...(options.headers || {}),
        },
      });
      const body = await response.text();

      if (response.status >= 500) {
        throw new PcsoRequestError(`PCSO server error (HTTP ${response.status}).`, { retryable: true, status: response.status });
      }
      if (!response.ok) {
        throw new PcsoRequestError(`PCSO refused the request (HTTP ${response.status}).`, { status: response.status });
      }
      return { response, body };
    } catch (error) {
      if (error instanceof PcsoRequestError) {
        throw error;
      }
      const reason = error.name === 'AbortError'
        ? `no response within ${timeoutMs / 1000} seconds`
        : (error.cause && error.cause.code) || error.message;
      throw new PcsoRequestError(`Could not reach PCSO (${reason}).`, { retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }

  async function sendWithRetry(options) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await sendOnce(options);
      } catch (error) {
        const canRetry = error.retryable && attempt < retryDelaysMs.length;
        if (!canRetry) {
          throw error;
        }
        await sleep(retryDelaysMs[attempt]);
      }
    }
  }

  async function loadSearchForm() {
    const { response, body } = await sendWithRetry({ method: 'GET' });
    const $ = cheerio.load(body);

    const hiddenFields = {};
    $('input[type="hidden"]').each((_, input) => {
      const name = $(input).attr('name');
      if (name) {
        hiddenFields[name] = $(input).attr('value') || '';
      }
    });

    const gameOptions = $(`select[name="${FIELD.game}"] option`)
      .map((_, option) => ({ value: $(option).attr('value') ?? '', text: $(option).text().trim() }))
      .get();

    const yearOptions = new Set(
      $(`select[name="${FIELD.startYear}"] option`)
        .map((_, option) => Number($(option).attr('value')))
        .get(),
    );

    if (!hiddenFields.__VIEWSTATE || gameOptions.length === 0 || yearOptions.size === 0) {
      throw new PcsoPageChangedError('PCSO search form changed: security fields, game list or year list not found.');
    }

    return { cookieHeader: extractCookieHeader(response), hiddenFields, gameOptions, yearOptions };
  }

  function resolveGameValue(gameOptions, gameCode) {
    if (gameCode === null) {
      return ALL_GAMES_VALUE;
    }
    const wanted = normalizeGameName(gameCode);
    const matches = gameOptions.filter((option) => normalizeGameName(option.text).includes(wanted));
    if (matches.length !== 1) {
      throw new PcsoPageChangedError(`PCSO game list has ${matches.length} entries for "${gameCode}" (expected exactly 1).`);
    }
    return matches[0].value;
  }

  /**
   * Search PCSO results.
   * @param {{ gameCode: string|null, startDate: string, endDate: string }} search
   *   gameCode "6/42" for one game, or null for all games.
   * @returns {Promise<{ rows: Array, statusMessage: string|null }>}
   */
  async function search({ gameCode, startDate, endDate }) {
    if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) {
      throw new Error(`Invalid search range ${startDate} to ${endDate}.`);
    }

    const form = await loadSearchForm();
    const start = splitIsoDate(startDate);
    const end = splitIsoDate(endDate);

    [start.year, end.year].forEach((year) => {
      if (!form.yearOptions.has(year)) {
        throw new Error(`PCSO does not offer results for ${year}. Available years: ${[...form.yearOptions].sort().join(', ')}.`);
      }
    });

    const params = new URLSearchParams();
    Object.entries(form.hiddenFields).forEach(([name, value]) => params.append(name, value));
    params.append(FIELD.startMonth, MONTH_NAMES[start.month - 1]);
    params.append(FIELD.startDay, String(start.day));
    params.append(FIELD.startYear, String(start.year));
    params.append(FIELD.endMonth, MONTH_NAMES[end.month - 1]);
    params.append(FIELD.endDay, String(end.day));
    params.append(FIELD.endYear, String(end.year));
    params.append(FIELD.game, resolveGameValue(form.gameOptions, gameCode));
    params.append(FIELD.searchButton, SEARCH_BUTTON_LABEL);

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: PAGE_ORIGIN,
      Referer: PAGE_URL,
    };
    if (form.cookieHeader) {
      headers.Cookie = form.cookieHeader;
    }

    const { body } = await sendWithRetry({ method: 'POST', headers, body: params.toString() });
    return parseResultsPage(body);
  }

  return { search };
}

module.exports = {
  createPcsoClient,
  PcsoRequestError,
  PAGE_URL,
};

/**
 * Filter settings per game, remembered on this device.
 *
 * Only the CHANGES from the game's defaults are saved, so if a default is ever improved,
 * everyone who never touched that rule gets the new default automatically.
 * Defaults come from the server (GET /games -> defaultFilters), never hard-coded here.
 */

import { readSetting, writeSetting } from '../core/storage.js';

const RULE_KEYS = [
  'oddEvenBalance', 'lowHighBalance', 'consecutive', 'tensGroups', 'evenlySpaced',
  'sumRange', 'lastDigit', 'antiBirthday', 'pastWinners',
];
const LIST_KEYS = ['includeNumbers', 'excludeNumbers'];

function storageKey(game) {
  return `filters.${game.code}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Full settings for a game: its defaults with this device's saved changes on top. */
export function loadFilters(game) {
  const settings = clone(game.defaultFilters);
  let saved = {};
  try {
    saved = JSON.parse(readSetting(storageKey(game), '{}')) || {};
  } catch {
    saved = {};
  }

  RULE_KEYS.forEach((key) => {
    if (saved[key] && typeof saved[key] === 'object') {
      Object.keys(settings[key]).forEach((field) => {
        if (field in saved[key] && typeof saved[key][field] === typeof settings[key][field]) {
          settings[key][field] = saved[key][field];
        }
      });
    }
  });
  LIST_KEYS.forEach((key) => {
    if (Array.isArray(saved[key])) {
      settings[key] = saved[key].filter((number) => Number.isInteger(number) && number >= 1 && number <= game.maxNumber);
    }
  });
  return settings;
}

/** Saves only what differs from the defaults. */
export function saveFilters(game, settings) {
  const changes = {};
  RULE_KEYS.forEach((key) => {
    Object.keys(settings[key]).forEach((field) => {
      if (!sameValue(settings[key][field], game.defaultFilters[key][field])) {
        changes[key] = changes[key] || {};
        changes[key][field] = settings[key][field];
      }
    });
  });
  LIST_KEYS.forEach((key) => {
    if (settings[key].length > 0) {
      changes[key] = [...settings[key]].sort((a, b) => a - b);
    }
  });
  writeSetting(storageKey(game), JSON.stringify(changes));
}

/** How many rules or number choices differ from the defaults (for the "Custom · 2 changes" label). */
export function countChanges(game, settings) {
  let changes = RULE_KEYS.filter((key) => !sameValue(settings[key], game.defaultFilters[key])).length;
  changes += LIST_KEYS.filter((key) => settings[key].length > 0).length;
  return changes;
}

export function defaultFiltersFor(game) {
  return clone(game.defaultFilters);
}

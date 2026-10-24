/**
 * Small per-device settings (theme, sound, last game). Browser storage can be blocked or
 * cleared, so every read has a fallback and failures are ignored - the app works without it.
 */

const PREFIX = 'ajenarator.';

export function readSetting(key, fallback) {
  try {
    const value = window.localStorage.getItem(PREFIX + key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function writeSetting(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, String(value));
  } catch {
    // Not saved; the setting still applies for this visit.
  }
}

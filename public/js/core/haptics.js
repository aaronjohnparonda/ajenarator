/**
 * A light vibration on supported phones (Android browsers). iPhones do not allow web
 * vibration, so this simply does nothing there.
 */
export function vibrate(durationMs = 10) {
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(durationMs);
  }
}

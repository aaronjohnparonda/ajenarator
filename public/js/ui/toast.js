/** Short messages at the bottom of the screen (errors, confirmations). */

const DEFAULT_DURATION_MS = 3500;
const LEAVE_ANIMATION_MS = 250;

export function showToast(message, durationMs = DEFAULT_DURATION_MS) {
  const region = document.getElementById('toast-region');
  if (!region) {
    return;
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  region.append(toast);

  window.setTimeout(() => {
    toast.classList.add('toast--leaving');
    window.setTimeout(() => toast.remove(), LEAVE_ANIMATION_MS);
  }, durationMs);
}

/** Read-out for screen readers without showing anything on screen. */
export function announce(message) {
  const announcer = document.getElementById('announcer');
  if (announcer) {
    announcer.textContent = '';
    window.setTimeout(() => {
      announcer.textContent = message;
    }, 50);
  }
}

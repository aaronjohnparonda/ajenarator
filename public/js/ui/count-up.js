/** Animates a number counting up (e.g. the jackpot), from its previous value to the new one. */

import { prefersReducedMotion } from './dom.js';

const DEFAULT_DURATION_MS = 900;
const runningAnimations = new WeakMap();

function easeOutCubic(progress) {
  return 1 - (1 - progress) ** 3;
}

export function countUp(element, target, { format, durationMs = DEFAULT_DURATION_MS } = {}) {
  const previousFrame = runningAnimations.get(element);
  if (previousFrame) {
    cancelAnimationFrame(previousFrame);
  }

  const from = Number(element.dataset.value || 0);
  element.dataset.value = String(target);

  if (prefersReducedMotion() || from === target) {
    element.textContent = format(target);
    return;
  }

  const startedAt = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / durationMs);
    element.textContent = format(from + (target - from) * easeOutCubic(progress));
    if (progress < 1) {
      runningAnimations.set(element, requestAnimationFrame(step));
    } else {
      runningAnimations.delete(element);
    }
  };
  runningAnimations.set(element, requestAnimationFrame(step));
}

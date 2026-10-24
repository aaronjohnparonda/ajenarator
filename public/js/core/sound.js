/**
 * Subtle sound effects, OFF by default.
 *
 * Sounds are synthesized with the Web Audio API (no audio files to download) and scheduled on
 * the audio clock, so each click lines up exactly with a ball landing. Browsers only allow
 * audio after a tap, so the audio engine starts on the first toggle or Generate tap.
 */

import { readSetting, writeSetting } from './storage.js';

let enabled = readSetting('sound', 'off') === 'on';
let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

export function isSoundOn() {
  return enabled;
}

/** A short, soft "tick" - played as each ball lands. */
export function playClick(delayMs = 0) {
  if (!enabled) {
    return;
  }
  const context = getAudioContext();
  if (!context) {
    return;
  }
  const start = context.currentTime + Math.max(0, delayMs) / 1000;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(1600, start);
  oscillator.frequency.exponentialRampToValueAtTime(700, start + 0.05);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.08, start + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.08);

  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.1);
}

/** A gentle two-note chime - played when all picks have landed. */
export function playChime(delayMs = 0) {
  if (!enabled) {
    return;
  }
  const context = getAudioContext();
  if (!context) {
    return;
  }
  [880, 1318.5].forEach((frequency, index) => {
    const start = context.currentTime + Math.max(0, delayMs) / 1000 + index * 0.12;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.06, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.5);
  });
}

export function initSoundToggle(button) {
  const render = () => {
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', enabled ? 'Turn off sound effects' : 'Turn on sound effects');
  };
  render();
  button.addEventListener('click', () => {
    enabled = !enabled;
    writeSetting('sound', enabled ? 'on' : 'off');
    render();
    playClick();
  });
}

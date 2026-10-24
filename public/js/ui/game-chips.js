/**
 * The row of game chips (6/42 ... 6/58), shared by Generate, Stats and Results.
 * The chosen game is remembered, so switching screens keeps the same game selected.
 */

import { createElement } from './dom.js';
import { readSetting, writeSetting } from '../core/storage.js';

const DEFAULT_GAME = '6/58';

export function rememberedGameCode(games) {
  const saved = readSetting('game', DEFAULT_GAME);
  return games.some((game) => game.code === saved) ? saved : games[0].code;
}

/**
 * @param {HTMLElement} container
 * @param {Array<{code: string, name: string}>} games
 * @param {{ selectedCode: string, onSelect: (code: string) => void }} options
 * @returns {{ setSelected: (code: string) => void }}
 */
export function renderGameChips(container, games, { selectedCode, onSelect }) {
  const chips = games.map((game) => {
    const chip = createElement('button', 'game-chip', game.code);
    chip.type = 'button';
    chip.dataset.code = game.code;
    chip.setAttribute('aria-label', game.name);
    chip.setAttribute('aria-pressed', String(game.code === selectedCode));
    chip.addEventListener('click', () => onSelect(game.code));
    return chip;
  });
  container.replaceChildren(...chips);

  return {
    setSelected(code) {
      writeSetting('game', code);
      chips.forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.code === code)));
    },
  };
}

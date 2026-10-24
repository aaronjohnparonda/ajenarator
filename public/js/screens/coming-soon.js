/**
 * TEMPORARY: stands in for screens built in the next steps (Home, Stats, Results, Me),
 * so navigation works end to end. Each one is replaced by its real screen file.
 */

import { cloneTemplate } from '../ui/dom.js';

export function mountComingSoon(root, { title, text }) {
  const { fragment, refs } = cloneTemplate('tpl-coming-soon');
  refs.title.textContent = title;
  refs.text.textContent = text;
  root.append(fragment);
  return null;
}

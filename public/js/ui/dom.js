/**
 * Clones a <template> from index.html and collects its [data-ref] elements by name.
 * Screens fill data in with textContent only (never innerHTML), so data can't inject markup.
 */
export function cloneTemplate(templateId) {
  const template = document.getElementById(templateId);
  if (!template) {
    throw new Error(`Template #${templateId} not found.`);
  }
  const fragment = template.content.cloneNode(true);
  const refs = {};
  fragment.querySelectorAll('[data-ref]').forEach((element) => {
    refs[element.dataset.ref] = element;
  });
  return { fragment, refs, root: fragment.firstElementChild };
}

export function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

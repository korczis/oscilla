// The Synth view's two faces below xl (V636): the module cards or the patch bay, one at a time,
// switched by a Panel and a Patch bay chip in the sticky chip bar, so on a phone the bay takes
// the whole width under the bar instead of following every card. At xl both faces show side by
// side, the Panel chip is hidden and Patch bay scrolls to the bay. Markup and class toggles
// only; ui.js owns the state and re-lays the bay out after a switch.
//
//   faceChips(face) -> the two chips' markup;  faceClass(face, of) -> '' | 'max-xl:hidden'
//   applyFace(el, face) -> toggles the shown face and replaces the chips without a re-render
//   scrollToSection(el, moduleId) -> a section chip's jump: the plate (or the bay) under the bar

import { CHIP } from './engines.js';

const ON = 'border-primary-600 bg-primary-600 text-white dark:border-primary-500 '
  + 'dark:bg-primary-600';
const OFF = 'border-primary-600 bg-white text-primary-700 dark:border-primary-500 '
  + 'dark:bg-gray-800 dark:text-primary-400';

export const faceClass = (face, of) => (face === of ? '' : 'max-xl:hidden');

export function faceChips(face) {
  return `<button type="button" data-face="panel" aria-pressed="${face === 'panel'}" `
    + `class="${CHIP} xl:hidden ${face === 'panel' ? ON : OFF}">PANEL</button>`
    + `<button type="button" data-face="bay" aria-pressed="${face === 'bay'}" `
    + `class="${CHIP} ${face === 'bay' ? ON : OFF} xl:border-primary-600 xl:bg-white `
    + 'xl:text-primary-700 xl:dark:bg-gray-800 xl:dark:text-primary-400">PATCH BAY</button>';
}

export function applyFace(el, face) {
  for (const x of el.querySelectorAll('[data-face-of]')) {
    x.classList.toggle('max-xl:hidden', x.dataset.faceOf !== face);
  }
  const fresh = el.ownerDocument.createElement('div');
  fresh.innerHTML = faceChips(face);
  for (const b of el.querySelectorAll('nav [data-face]')) {
    b.replaceWith(fresh.querySelector(`[data-face="${b.dataset.face}"]`));
  }
}

/**
 * A section chip: the module's plate scrolled to the top of the view and then down past the
 * sticky chip bar, so its heading is not under the bar; focus moves to the plate.
 */
export function scrollToSection(el, mid) {
  const target = el && el.querySelector(`[data-module="${mid}"]`);
  if (!target) return;
  target.scrollIntoView({ block: 'start', behavior: 'auto' });
  const bar = el.querySelector('nav[aria-label="Synth sections"]');
  const r = bar ? bar.getBoundingClientRect() : null;
  const over = r && r.height ? r.bottom + 8 - target.getBoundingClientRect().top : 0;
  let s = target.parentElement;
  while (s && s !== document.body && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) {
    s = s.parentElement;
  }
  if (over > 0) (s && s !== document.body ? s : window).scrollBy(0, -over);
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

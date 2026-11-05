// The synth-theme layer's readout window (plan F013, W1): a module's derived values in a recessed
// display, as an old-school modular shows a frequency or a time (project.visual-identity-lock
// v4). It never implies a measurement (project.no-fake-science): the window says that its values
// are computed from the settings, and a value that is measured never comes through here. Text
// stays 12 px or more and tabular, in Pro greys on a darker inset, both themes from tokens.
//
//   displayHtml({ id, text, source = 'computed' }) -> markup: one window, data-display="id"

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;',
  '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const WINDOW = 'relative mx-3 mb-3 rounded border border-solid border-gray-300 bg-gray-100 '
  + 'px-2 py-1.5 shadow-inner dark:border-gray-600 dark:bg-gray-900';
const TAG = 'block text-xs font-semibold uppercase tracking-wide text-gray-600 '
  + 'dark:text-gray-400';
const READING = 'block font-mono text-xs leading-snug tabular-nums text-gray-900 '
  + 'dark:text-gray-100';

export function displayHtml({ id, text, source = 'computed' }) {
  if (source !== 'computed') throw new TypeError('displayHtml shows computed values only.');
  return `<p class="${WINDOW}" data-display="${esc(id)}" data-facts="${esc(id)}">`
    + `<span class="${TAG}">Computed from the settings</span>`
    + `<span class="${READING}">${esc(text)}</span></p>`;
}

// The synth-theme layer's readout window (plan F013, W1): a module's derived values in a recessed
// display, as an old-school modular shows a frequency or a time (project.visual-identity-lock
// v4). It never implies a measurement (project.no-fake-science): the window says that its values
// are computed from the settings, and a value that is measured never comes through here. Text
// stays 12 px or more and tabular, light on the LCD surface (one dark display, both themes).
//
//   displayHtml({ id, text, source = 'computed' }) -> markup: one window, data-display="id"

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;',
  '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// LXK-11 (the Synth look audit): the window is a dark display in both themes, D-PAL's LCD
// surface with the reading in the cap ink, never a light code block; its frame is set into the
// plate (darker top lip, lit bottom edge) and it is no wider than a line of 36 characters.
const WINDOW = 'relative mx-3 mb-3 max-w-[36ch] rounded border-0 border-t-2 border-b '
  + 'border-solid border-t-gray-950 border-b-gray-600 bg-[var(--osc-hw-lcd)] px-2 py-1.5 '
  + 'shadow-inner';
const TAG = 'block text-xs font-semibold uppercase tracking-wide text-gray-400';
const READING = 'block font-mono text-xs leading-snug tabular-nums '
  + 'text-[var(--osc-text-on-accent)]';

export function displayHtml({ id, text, source = 'computed' }) {
  if (source !== 'computed') throw new TypeError('displayHtml shows computed values only.');
  return `<p class="${WINDOW}" data-display="${esc(id)}" data-facts="${esc(id)}">`
    + `<span class="${TAG}">Computed from the settings</span>`
    + `<span class="${READING}">${esc(text)}</span></p>`;
}

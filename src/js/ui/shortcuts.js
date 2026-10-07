// The keyboard model of the whole page (ledger W5, ADR 0050): what Space means in each
// workspace, and the ONE list the Keyboard shortcuts dialog shows. Pure: no DOM, no audio.
//
// Space has one owner in each workspace, the same at every width:
//   'instrument'  the workspaces that play, load or analyse the instrument's signal:
//                 Playground, Analyzer, Filter Lab, Compare, Synthesis, Sequencer and Presets
//                 (Load readies the instrument and says "Press TRIGGER (or Space)"). Space is
//                 Hold to Play (V1, frozen): held, it plays; released, it stops; a programmed
//                 pattern triggers once. It is so whether or not a Play control is on screen:
//                 Hold and Trigger are laid out by width, the owner is not.
//   'studio'      Studio. Space plays or stops the Studio transport, as its Play button does.
//   null          Measure, Experiments, Learn and About. Space starts nothing there (it used
//                 to start the instrument, which none of them plays or loads).
// Wherever it is pressed, a focused text field, native button, link, slider, tab or an open
// dialog keeps Space first: dialogs.js keyGuard for the instrument, Studio's own control check.
// A focused Studio timeline item (clip, marker, point, loop handle) is not such a control: its
// activation is Enter and Space plays or stops Studio there (transport-view.js KEY_HELP).
// The compact Studio panel of the Playground and the Sequencer has no Space of its own: every
// focus target in it is a button. Its Play button is its control.

import { STUDIO_SHORTCUTS } from './studio/graph-keys.js';
import { KEY_HELP } from './studio/transport-view.js';

/** Who owns Space in each workspace (the keys are exactly app.js WORKSPACES). */
export const SPACE_OWNER = Object.freeze({
  playground: 'instrument',
  measure: null,
  experiments: null,
  analyzer: 'instrument',
  filter: 'instrument',
  compare: 'instrument',
  synthesis: 'instrument',
  sequencer: 'instrument',
  presets: 'instrument',
  learn: null,
  studio: 'studio',
  about: null,
});

/** The names the navigation shows. */
export const WORKSPACE_LABELS = Object.freeze({
  playground: 'Playground',
  measure: 'Measure',
  experiments: 'Experiments',
  analyzer: 'Analyzer',
  filter: 'Filter Lab',
  compare: 'Compare',
  synthesis: 'Synthesis',
  sequencer: 'Sequencer',
  presets: 'Presets',
  learn: 'Learn',
  studio: 'Studio',
  about: 'About',
});

/**
 * What Space does, by owner ('none' for a workspace that neither is Studio nor plays, loads or
 * analyses the instrument). `keys` is what a kbd shows, `where` the words beside it.
 */
export const SPACE_MEANING = Object.freeze({
  instrument: Object.freeze({ id: 'space', keys: 'Space', where: '(hold)',
    text: 'Hold to play: sounds while held, stops on release (a programmed pattern: trigger '
      + 'once)' }),
  studio: Object.freeze({ id: 'space', keys: 'Space', text: 'Play / stop the Studio transport' }),
  none: Object.freeze({ id: 'space', keys: 'Space',
    text: 'Nothing: Space starts no sound in this workspace' }),
});

/** A row: `keys` (shown in a kbd), what it does, and optionally `where` it applies. */
const row = (id, keys, text, where) => Object.freeze(where ? { id, keys, where, text }
  : { id, keys, text });

/** The keys that work in every workspace. */
export const GLOBAL_SHORTCUTS = Object.freeze([
  row('escape', 'Esc', 'Stop immediately; close menus and dialogs'),
  row('roving', '← →', 'Move and select', 'on tabs and segments'),
  row('tab', 'Tab', 'Move focus (never taken by a shortcut)'),
]);

// Hold, Trigger and the frequency slider are laid out by width and are not on screen in every
// instrument workspace: the rows say so instead of implying the control is there.
const INSTRUMENT_ROWS = Object.freeze([
  row('trigger', 'Enter', 'Trigger once', 'on Hold or Trigger, where shown'),
  row('octave', 'PgUp / PgDn', 'One octave up / down', 'on the frequency slider, where shown'),
]);
const SEQUENCER_ROWS = Object.freeze([
  row('sequencer-timeline', 'Arrows, Alt + arrows, Del, Ctrl/⌘ D',
    'Select, move, delete, duplicate blocks', 'on the Sequencer timeline'),
]);
// Measure's Esc is the global one and more: it replaces that row instead of repeating the key.
const MEASURE_ROWS = Object.freeze([
  row('measure-abort', 'Esc',
    'Stop immediately and abort a running measurement; close menus and dialogs'),
]);
// Studio's table without its Space row, which the dialog shows as the Space meaning. It has
// its own Esc and Tab rows, so the global ones are not repeated beside it.
const STUDIO_ROWS = Object.freeze(STUDIO_SHORTCUTS.filter((s) => s.id !== 'play-toggle'));
const STUDIO_NOTE = 'They apply while Studio has focus and no text field is being edited. Every '
  + 'drag has a keyboard path: arrows move nodes, C lists the inputs a node can connect to, and '
  + 'the Inspector edits positions and clip times. A focused timeline item is activated by '
  + 'Enter; Space plays or stops there too.';

/** How a row is keyed on screen: its keys and where they apply. */
const shown = (r) => (r.where ? `${r.keys} ${r.where}` : r.keys);

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The owner of Space in `workspace`: 'instrument' | 'studio' | null. */
export function spaceOwner(workspace) {
  return has(SPACE_OWNER, workspace) ? SPACE_OWNER[workspace] : null;
}

/** True when the instrument's Hold to Play may answer Space in `workspace`. */
export function instrumentTakesSpace(workspace) {
  return spaceOwner(workspace) === 'instrument';
}

/** A Space key event, by character or by physical key. */
export function isSpace(e) {
  return !!e && (e.key === ' ' || e.code === 'Space');
}

/**
 * What the Keyboard shortcuts dialog shows in `workspace`:
 * { workspace, title, space, rows, timeline, note, global }. `space` is the Space meaning
 * there, `rows` the workspace's other keys, `timeline` Studio's timeline keys (else null),
 * `note` Studio's note on keyboard paths (else null) and `global` the keys that work
 * everywhere, less any the workspace's own rows already state: each key is listed once.
 */
export function shortcutHelp(workspace) {
  const owner = spaceOwner(workspace);
  let rows = [];
  if (owner === 'instrument') {
    rows = [...INSTRUMENT_ROWS];
    if (workspace === 'sequencer') rows.push(...SEQUENCER_ROWS);
  } else if (owner === 'studio') {
    rows = [...STUDIO_ROWS];
  } else if (workspace === 'measure') {
    rows = [...MEASURE_ROWS];
  }
  const own = new Set(rows.map(shown));
  return {
    workspace,
    title: has(WORKSPACE_LABELS, workspace) ? WORKSPACE_LABELS[workspace] : '',
    space: SPACE_MEANING[owner || 'none'],
    rows,
    timeline: owner === 'studio' ? KEY_HELP : null,
    note: owner === 'studio' ? STUDIO_NOTE : null,
    global: GLOBAL_SHORTCUTS.filter((g) => !own.has(shown(g))),
  };
}

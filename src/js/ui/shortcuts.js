// The keyboard model of the whole page (ledger W5, ADR 0050): what Space means in each
// workspace, and the ONE list the Keyboard shortcuts dialog shows. Pure: no DOM, no audio.
//
// Space is the keyboard for the Play control of the workspace in view, and nothing else:
//   'instrument'  the workspaces that show the Playground instrument or one of its labs. Space
//                 is Hold to Play (V1, frozen): held, it plays; released, it stops; a
//                 programmed pattern triggers once.
//   'studio'      Studio. Space plays or stops the Studio transport, as its Play button does.
//   null          Measure, Experiments, Learn, Presets and About have no transport of their
//                 own. Space starts nothing there (it used to start the hidden instrument).
// Wherever it is pressed, a focused text field, button, link, slider, tab or an open dialog
// keeps Space first: dialogs.js keyGuard for the instrument, Studio's own control check.
// Inside the compact Studio panel (Playground, Sequencer) Space is the Studio transport's,
// because that panel is Studio.

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
  presets: null,
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

/** What Space does, by owner ('none' for a workspace without a transport). */
export const SPACE_MEANING = Object.freeze({
  instrument: Object.freeze({ id: 'space', keys: 'Space (hold)',
    text: 'Hold to play: sounds while held, stops on release (a programmed pattern: trigger '
      + 'once)' }),
  studio: Object.freeze({ id: 'space', keys: 'Space', text: 'Play / stop the Studio transport' }),
  none: Object.freeze({ id: 'space', keys: 'Space',
    text: 'Nothing: this workspace has no transport of its own' }),
});

const row = (id, keys, text) => Object.freeze({ id, keys, text });

/** The keys that work in every workspace. */
export const GLOBAL_SHORTCUTS = Object.freeze([
  row('escape', 'Esc', 'Stop immediately; close menus and dialogs'),
  row('roving', '← → on tabs and segments', 'Move and select'),
  row('tab', 'Tab', 'Move focus (never taken by a shortcut)'),
]);

const INSTRUMENT_ROWS = Object.freeze([
  row('trigger', 'Enter on Hold / Trigger', 'Trigger once'),
  row('octave', 'PgUp / PgDn on the frequency slider', 'One octave up / down'),
]);
const SEQUENCER_ROWS = Object.freeze([
  row('sequencer-timeline', 'Sequencer timeline: arrows, Alt + arrows, Del, Ctrl/⌘ D',
    'Select, move, delete, duplicate blocks'),
]);
const STUDIO_PANEL_ROWS = Object.freeze([
  row('studio-panel-space', 'Space in the Studio panel', 'Play / stop the Studio transport'),
]);
const MEASURE_ROWS = Object.freeze([
  row('measure-abort', 'Esc', 'Abort a running measurement'),
]);
// Studio's table without its Space row, which the dialog shows as the Space meaning.
const STUDIO_ROWS = Object.freeze(STUDIO_SHORTCUTS.filter((s) => s.id !== 'play-toggle'));

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
 * { workspace, title, space, rows, timeline, global }. `space` is the Space meaning there,
 * `rows` the workspace's other keys, `timeline` Studio's timeline keys (else null).
 */
export function shortcutHelp(workspace) {
  const owner = spaceOwner(workspace);
  let rows = [];
  if (owner === 'instrument') {
    rows = [...INSTRUMENT_ROWS];
    if (workspace === 'sequencer') rows.push(...SEQUENCER_ROWS);
    if (workspace === 'playground' || workspace === 'sequencer') rows.push(...STUDIO_PANEL_ROWS);
  } else if (owner === 'studio') {
    rows = [...STUDIO_ROWS];
  } else if (workspace === 'measure') {
    rows = [...MEASURE_ROWS];
  }
  return {
    workspace,
    title: has(WORKSPACE_LABELS, workspace) ? WORKSPACE_LABELS[workspace] : '',
    space: SPACE_MEANING[owner || 'none'],
    rows,
    timeline: owner === 'studio' ? KEY_HELP : null,
    global: GLOBAL_SHORTCUTS,
  };
}

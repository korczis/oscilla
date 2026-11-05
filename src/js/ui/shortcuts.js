// The keyboard model of the whole page (ledger W5, ADR 0050): what Space means in each
// workspace, and the ONE list the Keyboard shortcuts dialog shows. Pure: no DOM, no audio.
//
// Space has one owner in each workspace, the same at every width:
//   'instrument'  the workspaces that play, load or analyse the instrument's signal:
//                 Playground, Analyzer, Filter Lab, Compare, Synthesis, Sequencer and Presets
//                 (Load readies the instrument and its notice names the Play shown there,
//                 playPrompt: the status-bar Play in Presets). Space is
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
// The focused Sequencer timeline is a listbox, so it keeps Space from the instrument too; there
// Space plays or stops the sequence (K003; sequencer/editor.js onKeydown), as Studio's timeline
// plays Studio. With nothing focused, Space in the Sequencer is still the instrument's.
// The compact Studio panel of the Playground and the Sequencer has no Space of its own: every
// focus target in it is a button. Its Play button is its control.

import { STUDIO_SHORTCUTS } from './studio/graph-keys.js';
import { KEY_HELP } from './studio/transport-view.js';
import { KEYBOARD_VIEWS } from '../midi/keyboard.js';

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
  synth: null, // the Synth plays from its keys; Space starts nothing there (ADR 0050)
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
  synth: 'Synth',
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
  row('sequencer-space', 'Space', 'Play / stop the sequence', 'on the Sequencer timeline'),
  row('sequencer-timeline', 'Arrows, Alt + arrows, Del, Ctrl/⌘ D',
    'Select, move, delete, duplicate blocks', 'on the Sequencer timeline'),
  row('sequencer-history', 'Ctrl/⌘ Z, Shift + Ctrl/⌘ Z', 'Undo, redo',
    'on the Sequencer timeline'),
  row('sequencer-clipboard', 'Ctrl/⌘ C, Ctrl/⌘ V', 'Copy the selected block, paste it after the '
    + 'selection', 'on the Sequencer timeline'),
]);
// The keyboard (K026, src/js/midi/keyboard.js) in the views it is armed in, by physical key
// (the same places on QWERTZ and AZERTY). It never takes Space, nor a key with Ctrl, Meta or
// Alt. Armed in Studio, these letters play instead of Studio's A, C, F and T.
const KEYBOARD_WHERE = 'with the keyboard armed (Arm keys, or a link with kbd=1)';
const KEYBOARD_ROWS = Object.freeze([
  row('keyboard-notes', 'A W S E D F T G Y H U J K O L P ; \'',
    'Play notes, C to the next F: a note sounds while its key is held', KEYBOARD_WHERE),
  row('keyboard-octave', 'Z / X', 'Octave down / up', KEYBOARD_WHERE),
  row('keyboard-velocity', 'C / V', 'Velocity down / up (steps of 20)', KEYBOARD_WHERE),
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

/**
 * The workspaces whose Source & Pattern panel, with Hold to Play and Trigger, is on screen at
 * every width: the panel's data-osc-modes in src/index.html (tests/unit/workspace-play-visible
 * reads both).
 */
export const SOURCE_PANEL_WORKSPACES = Object.freeze(['playground', 'sequencer', 'synthesis']);

/**
 * The workspaces that show no instrument panel at any width (instrument.css and responsive.css
 * hide every instrument panel there); of them only Presets plays the instrument.
 */
export const PANELLESS_WORKSPACES = Object.freeze(['learn', 'presets', 'about']);

/**
 * The width from which the desktop focus layouts hide every panel a workspace does not list
 * (src/styles/integration.css), so Analyzer, Filter Lab and Compare lose Source & Pattern. It
 * is Tailwind's `xl` screen, the prefix the status-bar Play is shown with there (C030); the
 * unit test holds the three equal.
 */
export const FOCUS_LAYOUT_QUERY = '(min-width: 1280px)';

/**
 * The Play control `workspace` shows (C030), from its Space owner and the layout: 'source'
 * (Hold to Play and Trigger of Source & Pattern), 'status' (the status-bar Play, the
 * instrument's own statusPlay), 'studio' (the Studio transport's Play) or null (nothing there
 * plays the instrument or Studio; the Synth plays from its keys). `wide` is the focus layout
 * (FOCUS_LAYOUT_QUERY matches); below 768 px responsive.css also shows the status-bar Play in
 * every workspace, the phone's compact transport.
 */
export function playControl(workspace, wide = true) {
  const owner = spaceOwner(workspace);
  if (owner === 'studio') return 'studio';
  if (owner !== 'instrument') return null;
  if (SOURCE_PANEL_WORKSPACES.includes(workspace)) return 'source';
  if (PANELLESS_WORKSPACES.includes(workspace)) return 'status';
  return wide ? 'status' : 'source';
}

/**
 * The utilities that show the status-bar Play where it is `workspace`'s Play: at every width
 * in Presets, from Tailwind's `xl` (FOCUS_LAYOUT_QUERY) where Source & Pattern is shown only
 * below it, and nowhere else from 768 px. Tailwind compiles these literals (content globs).
 */
export function statusPlayClass(workspace) {
  if (playControl(workspace, false) === 'status') return '!inline-flex md:ml-3';
  if (playControl(workspace, true) === 'status') return 'xl:!inline-flex xl:ml-3';
  return '';
}

/** The words that name `kind`'s control in a sentence, or '' when there is none. */
export function playControlName(kind) {
  if (kind === 'status') return 'Play in the status bar';
  if (kind === 'source') return 'Hold to Play';
  return '';
}

/**
 * The words a ready notice ends with: how to play what was loaded, naming the control
 * `workspace` shows at that width (playControl). `programmed` is a pattern that triggers once.
 * A workspace that shows no instrument Play keeps the Source & Pattern words: its notice is
 * raised on the way to a workspace that does (Learn opens the Playground or Synthesis).
 */
export function playPrompt(workspace, programmed, verb = 'play it', wide = true) {
  if (playControl(workspace, wide) === 'status') {
    return programmed ? `Press Play in the status bar (or Space) to ${verb}.`
      : `Press Play in the status bar, or hold Space, to ${verb}.`;
  }
  return programmed ? `Press TRIGGER (or Space) to ${verb}.` : 'Press and hold HOLD TO PLAY.';
}

/**
 * What the Audio is suspended notice says to press again, for `kind` (playControl). Where no
 * instrument Play is shown, any tap or key retries (instrument.js arms those listeners).
 */
export function suspendedPlayPrompt(kind) {
  if (kind === 'source') return 'Press HOLD TO PLAY again.';
  if (kind === 'status') return 'Press Play in the status bar again.';
  return 'Tap or press a key to start it.';
}

/**
 * The sentence a link restore ends with (url-state.js): V1's words where Source & Pattern is
 * shown, the status-bar Play where that is the Play, and no control named where the workspace
 * the link opens plays no instrument.
 */
export function linkPlayPrompt(workspace, wide = true) {
  const kind = playControl(workspace, wide);
  if (kind === 'source') return 'Nothing plays until you press HOLD TO PLAY or TRIGGER.';
  if (kind === 'status') return 'Nothing plays until you press Play in the status bar.';
  return 'Nothing plays until you start it.';
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
  }
  if (KEYBOARD_VIEWS.includes(workspace)) rows.push(...KEYBOARD_ROWS); else if (workspace === 'measure') {
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

// The keyboard model of the whole page (ledger W5, ADR 0050): what Space means in each
// workspace, and the ONE list the Keyboard shortcuts dialog shows. Pure: no DOM, no audio.
//
// Space has one owner in each workspace, the same at every width:
//   'instrument'  the workspaces that play, load or analyse the instrument's signal:
//                 Playground, Analyzer, Filter Lab, Compare, Synthesis, Sequencer and Presets
//                 (Load readies the instrument and says "Press Space to play it here"). Space is
//                 Hold to Play (V1, frozen): held, it plays; released, it stops; a programmed
//                 pattern triggers once. A Play is on screen beside it at every width (C030):
//                 Hold and Trigger where the Source & Pattern panel is laid out, the status
//                 bar's Play in the others (SOURCE_PANEL_WORKSPACES, STATUS_PLAY_WORKSPACES).
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
import { modesOf, WORKSPACE_LABELS } from './shell.js';
import { KEYBOARD_VIEWS } from '../midi/keyboard.js';
import { OWNER } from './output-owner.js';
import { STATUS_PLAY_WORKSPACES } from '../core/play-hints.js';
import { createKeyRegistry, helpRows } from './keys/registry.js';

/**
 * Who owns Space in each workspace (the keys are exactly app.js WORKSPACES); each owner is a
 * row of the one output-owner table (ui/output-owner.js OWNER, C036).
 */
export const SPACE_OWNER = Object.freeze({
  playground: OWNER.instrument,
  measure: null,
  experiments: null,
  analyzer: OWNER.instrument,
  filter: OWNER.instrument,
  compare: OWNER.instrument,
  synthesis: OWNER.instrument,
  sequencer: OWNER.instrument,
  presets: OWNER.instrument,
  learn: null,
  studio: OWNER.studio,
  synth: null, // the Synth plays from its keys; Space starts nothing there (ADR 0050)
  about: null,
});

/**
 * The instrument workspaces whose Source & Pattern panel lays out Hold to Play and Trigger: the
 * workspaces the shell registry shows the panel in (ui/shell.js), which its data-osc-modes in
 * src/index.html says too (tests/unit/workspace-play-visible.test.mjs holds them equal).
 */
export const SOURCE_PANEL_WORKSPACES = Object.freeze(modesOf('source'));

/**
 * The instrument workspaces without that panel (C030): Analyzer, Filter Lab, Compare and
 * Presets. The status bar's Play is their Play at every width, not on a phone only, so Space is
 * never the only way to sound them; elsewhere it stays a phone's control. The one list is
 * core/play-hints.js's, whose prompts name that Play there; the test holds it equal to the
 * workspaces SPACE_OWNER gives the instrument outside SOURCE_PANEL_WORKSPACES.
 */
export { STATUS_PLAY_WORKSPACES };

/** The names the navigation shows: the one registry's (shell.js WORKSPACE_REGISTRY). */
export { WORKSPACE_LABELS };

// The dialog's rows are declarations on one key registry (ui/keys/registry.js, K153, D05):
// a key bound through it (the page keys below, ui/keys/clients.js binds them) is listed from its
// own declaration, and a key whose listener is still elsewhere (the keyboard's notes, the
// Sequencer timeline, the step grid, Studio) is declared help-only. Nothing is listed that is
// not declared there. The dialog keeps the order of the declarations; helpRows lists a group
// together, so the declarations of one group stay next to each other.

/** The workspaces whose Space owner is `owner` (SPACE_OWNER). */
const ownedBy = (owner) => Object.freeze(Object.keys(SPACE_OWNER)
  .filter((w) => SPACE_OWNER[w] === owner));
const INSTRUMENT_VIEWS = ownedBy(OWNER.instrument);
const NO_SPACE_VIEWS = ownedBy(null);
const STUDIO_VIEWS = ownedBy(OWNER.studio);
/** Where the step grid is mounted (W008): the Studio Inspector and the Synth's Drums tab. */
const STEP_GRID_VIEWS = Object.freeze(['studio', 'synth']);

/**
 * The page keys (ui/keys/clients.js bindPageKeys spreads each and adds its run): one
 * declaration is the binding and its help row. Escape is the playback bus's stopAll (C050).
 */
export const PAGE_KEYS = Object.freeze({
  escape: Object.freeze({ id: 'page.escape', row: 'escape', keys: ['Escape'], shown: 'Esc',
    scope: { workspace: '*', focus: '*' }, prevent: false, group: 'Page',
    label: 'Stop immediately; close menus and dialogs' }),
  space: Object.freeze({ id: 'instrument.space', row: 'space', keys: ['Space'], place: '(hold)',
    scope: { workspace: '*' }, shownIn: INSTRUMENT_VIEWS, section: 'space', group: 'Instrument',
    label: 'Hold to play: sounds while held, stops on release (a programmed pattern: trigger '
      + 'once)' }),
  // K223: R presses the Record switch wherever one is shown (the Drums tab, a notes clip's
  // step grid in the Studio).
  record: Object.freeze({ id: 'notes.record', row: 'step-grid-record', keys: ['KeyR'],
    place: 'u přepínače Nahrávat', scope: { workspace: '*' }, shownIn: STEP_GRID_VIEWS,
    group: 'Kroková mřížka',
    label: 'Nahrávání živých úderů do notového klipu: zapnout nebo vypnout' }),
});

/** A help-only declaration: `shown` keys, `label`, optional `place`, listed per `scope`. */
const help = (id, shown, label, place, more = {}) => Object.freeze({ id, shown, label,
  ...(place ? { place } : {}), scope: { workspace: '*' }, ...more });

// Studio's table (graph-keys.js STUDIO_SHORTCUTS, its own listener reads it too), in order; its
// Space row is the Space meaning. It has its own Esc and Tab rows, so the global ones are not
// repeated beside it.
const STUDIO_DECLARATIONS = STUDIO_SHORTCUTS.map((s) => help(`studio.${s.id}`, s.keys, s.text,
  null, { row: s.id, shownIn: STUDIO_VIEWS, group: 'Studio',
    ...(s.id === 'play-toggle' ? { row: 'space', section: 'space' } : {}) }));

// Podržet a hrát, Spustit and the frequency slider are laid out by width and are not on screen
// in every instrument workspace: the rows say so instead of implying the control is there. The
// controls by their Czech labels (U114, c3 under Q090).
const INSTRUMENT_DECLARATIONS = [
  PAGE_KEYS.space,
  help('trigger', 'Enter', 'Spustit jednou', 'na Podržet a hrát nebo Spustit, kde jsou',
    { shownIn: INSTRUMENT_VIEWS, group: 'Instrument' }),
  help('octave', 'PgUp / PgDn', 'O oktávu výš / níž', 'na posuvníku frekvence, kde je',
    { shownIn: INSTRUMENT_VIEWS, group: 'Instrument' }),
];
// The Sequencer's timeline rows are Czech (U106, Q104) and name it as the navigation does.
const SEQUENCER_WHERE = 'na časové ose Sekvenceru';
const sequencer = (id, shown, label) => help(id, shown, label, SEQUENCER_WHERE,
  { scope: { workspace: 'sequencer' }, group: 'Sekvencer' });
const SEQUENCER_DECLARATIONS = [
  sequencer('sequencer-space', 'Space', 'Přehrání / zastavení sekvence'),
  sequencer('sequencer-timeline', 'Šipky, Alt + šipky, Del, Ctrl/⌘ D',
    'Výběr, posun, smazání a duplikace bloků'),
  sequencer('sequencer-history', 'Ctrl/⌘ Z, Shift + Ctrl/⌘ Z', 'Zpět, znovu'),
  sequencer('sequencer-clipboard', 'Ctrl/⌘ C, Ctrl/⌘ V', 'Kopírování vybraného bloku a vložení '
    + 'za výběr'),
];
// Measure's Esc is the global one and more: it replaces that row instead of repeating the key.
const MEASURE_DECLARATIONS = [
  help('measure-abort', 'Esc',
    'Stop immediately and abort a running measurement; close menus and dialogs', null,
    { scope: { workspace: 'measure' }, group: 'Měření' }),
];
// The step grid (W008, the step-grid kind of src/js/ui/catalog/kinds/step-grid.js), in the
// Studio, whose Inspector mounts it for a selected notes clip, and in the Synth, whose Drums
// tab mounts it (K222) with a pad per row; Czech (Q104). It never takes Space or a bare letter.
const STEP_GRID_WHERE = 've zaměřené krokové mřížce';
const grid = (id, shown, label) => help(id, shown, label, STEP_GRID_WHERE,
  { shownIn: STEP_GRID_VIEWS, group: 'Kroková mřížka' });
const STEP_GRID_DECLARATIONS = [
  grid('step-grid-move', 'Šipky', 'Posun po krocích a řadách'),
  grid('step-grid-select', 'Shift + šipky', 'Rozšíření výběru kroků v řadě'),
  grid('step-grid-toggle', 'Enter', 'Zapnutí nebo vypnutí kroku či výběru'),
  grid('step-grid-clipboard', 'Ctrl/⌘ C, X, V', 'Kopírování, vyjmutí a vložení kroků'),
  grid('step-grid-clear', 'Delete', 'Vypnutí vybraných kroků'),
  grid('step-grid-transpose', 'PageUp / PageDown', 'Posun noty o půltón, se Shiftem o oktávu'),
  grid('step-grid-page', '[ / ]', 'Předchozí a další stránka kroků'),
  grid('step-grid-menu', 'Shift + F10, klávesa nabídky',
    'Nabídka kroku: přízvuk, ratchet, pravděpodobnost, slide'),
  help('drum-pads', 'Enter, mezerník', 'Zaměřený pad zahraje úder své řady', 'na kartě Drums',
    { scope: { workspace: 'synth' }, group: 'Kroková mřížka' }),
  PAGE_KEYS.record,
];
// The keyboard (K026, src/js/midi/keyboard.js) in the views it is armed in, by physical key
// (the same places on QWERTZ and AZERTY). It never takes Space, nor a key with Ctrl, Meta or
// Alt. Armed in Studio, these letters play instead of Studio's A, C, F and T. The one keyboard
// plays in every workspace (K247): its rows are in every view.
const KEYBOARD_WHERE = 'with the keyboard armed (Připravit klávesy, or a link with kbd=1)';
const keyboard = (id, shown, label) => help(id, shown, label, KEYBOARD_WHERE,
  { shownIn: KEYBOARD_VIEWS, group: 'Klávesnice' });
const KEYBOARD_DECLARATIONS = [
  keyboard('keyboard-notes', 'A W S E D F T G Y H U J K O L P ; \'',
    'Play notes, C to the next F: a note sounds while its key is held'),
  keyboard('keyboard-octave', 'Z / X', 'Octave down / up'),
  keyboard('keyboard-velocity', 'C / V', 'Velocity down / up (steps of 20)'),
];
/** The keys that work in every workspace. */
const GLOBAL_DECLARATIONS = [
  PAGE_KEYS.escape,
  help('roving', '← →', 'Move and select', 'on tabs and segments', { group: 'Page' }),
  help('tab', 'Tab', 'Move focus (never taken by a shortcut)', null, { group: 'Page' }),
];
const NO_SPACE_DECLARATION = help('space.none', 'Space',
  'Nothing: Space starts no sound in this workspace', null,
  { row: 'space', shownIn: NO_SPACE_VIEWS, section: 'space', group: 'Page' });

/**
 * The one registry the Keyboard shortcuts dialog reads (helpRows): every row it shows is a
 * declaration here, in the dialog's order.
 */
export const SHORTCUT_KEYS = createKeyRegistry();
for (const d of [...INSTRUMENT_DECLARATIONS, ...SEQUENCER_DECLARATIONS, ...STUDIO_DECLARATIONS,
  ...MEASURE_DECLARATIONS, ...STEP_GRID_DECLARATIONS, ...KEYBOARD_DECLARATIONS,
  ...GLOBAL_DECLARATIONS, NO_SPACE_DECLARATION]) SHORTCUT_KEYS.declare(d);

/** A help row as the dialog shows it: { id, keys, where?, text }. */
const dialogRows = new Map();
const dialogRow = (r) => {
  const k = `${r.id}\u0000${r.shown}\u0000${r.place}\u0000${r.label}`;
  if (!dialogRows.has(k)) {
    dialogRows.set(k, Object.freeze(r.place ? { id: r.id, keys: r.shown, where: r.place,
      text: r.label } : { id: r.id, keys: r.shown, text: r.label }));
  }
  return dialogRows.get(k);
};

/** The rows the dialog lists in `workspace`, in order (helpRows of SHORTCUT_KEYS). */
const listed = (workspace) => helpRows(SHORTCUT_KEYS, undefined, { workspace })
  .flatMap((g) => g.rows).map((r) => ({ section: r.section, row: dialogRow(r) }));

/**
 * What Space does, by owner ('none' for a workspace that neither is Studio nor plays, loads or
 * analyses the instrument). `keys` is what a kbd shows, `where` the words beside it.
 */
const spaceRow = (workspace) => {
  const r = listed(workspace).find((x) => x.section === 'space');
  return r ? r.row : null;
};
export const SPACE_MEANING = Object.freeze({ instrument: spaceRow(INSTRUMENT_VIEWS[0]),
  studio: spaceRow(STUDIO_VIEWS[0]), none: spaceRow(NO_SPACE_VIEWS[0]) });

/** The keys that work in every workspace. */
export const GLOBAL_SHORTCUTS = Object.freeze(helpRows(SHORTCUT_KEYS).flatMap((g) => g.rows)
  .filter((r) => r.section === 'everywhere').map(dialogRow));

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
  return spaceOwner(workspace) === OWNER.instrument;
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
 * everywhere, less any the workspace's own rows already state: each key is listed once. Every
 * row is a declaration of SHORTCUT_KEYS listed in `workspace`.
 */
export function shortcutHelp(workspace) {
  const owner = spaceOwner(workspace);
  const all = listed(workspace);
  const rows = all.filter((r) => r.section === 'workspace').map((r) => r.row);
  const own = new Set(rows.map(shown));
  return {
    workspace,
    title: has(WORKSPACE_LABELS, workspace) ? WORKSPACE_LABELS[workspace] : '',
    space: spaceRow(workspace) || SPACE_MEANING.none,
    rows,
    timeline: owner === OWNER.studio ? KEY_HELP : null,
    note: owner === OWNER.studio ? STUDIO_NOTE : null,
    global: all.filter((r) => r.section === 'everywhere').map((r) => r.row)
      .filter((g) => !own.has(shown(g))),
  };
}

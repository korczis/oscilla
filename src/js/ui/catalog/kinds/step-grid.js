// The step-grid kind (plan issues W001 and W008, ADR 0086): lanes of steps over one notes clip.
// The grid is a projection of the clip's notes array: a lane is a note number (its name from the
// target's key map, else the note name), and a step that is on is a note at
// at = i x stepBeats of the clip's grid. Accent is vel >= ACCENT_VEL; ratchet is the note's r,
// probability its p, slide its slide. One gesture builds one CLIP_UPDATE of the notes array;
// a list-parameter lane builds one NODE_PARAM_SET per gesture. There is no steps clip.
// Its view and model are W008's (src/js/ui/kinds/), first mounted by K222's Drums view.
//
// Not declared yet: the grid change (NOTES_GRID_SET of ADR 0086 decision 2), because the Studio
// does not export that action type; it joins with a version bump in the slice that adds it.

import { defineKind, prop } from '../kind.js';

/** The velocity at or above which a step is accented (ADR 0086 decision 3). */
const ACCENT_VEL = 0.8;

const NOTE_OR_PARAM = ['CLIP_UPDATE', 'NODE_PARAM_SET'];
const STEP_MENU = ['Shift+F10'];

const key = (chord, event, row) => ({ chord, event, row });

export default defineKind({
  kind: 'step-grid',
  version: 1,
  label: 'Step grid',
  docs: 'Edits a notes clip as lanes of steps: a lane is a note number and a step that is on is '
    + 'a note at i x stepBeats; a list-parameter lane edits one list parameter of a node.',
  props: [
    prop.enum('mode', 'Lanes', [['notes', 'Notes clip lanes'],
      ['param-list', 'List parameter lane']], 'notes'),
    prop.ref('clipId', 'Notes clip'),
    prop.ref('nodeId', 'Node of the list parameter'),
    prop.ref('paramKey', 'List parameter'),
    prop.list('lanes', 'Lane note numbers', { min: 0, max: 127, minLength: 1, maxLength: 16,
      default: [60] }),
    prop.integer('steps', 'Steps', { min: 1, max: 64, default: 16 }),
    prop.number('stepBeats', 'Beats per step', { min: 0.015625, max: 4, unit: 'beats',
      default: 0.25 }),
    prop.integer('page', 'Page', { min: 0, max: 63, default: 0 }),
    prop.list('selection', 'Selected steps', { min: 0, max: 63, minLength: 0, maxLength: 2,
      default: [] }),
    prop.bool('disabled', 'Disabled', false),
  ],
  io: ['value', 'commit', 'transport.playhead', 'frame-loop', 'live-region', 'key-map'],
  events: [
    { name: 'move', emits: ['view'],
      does: 'Moves the focused step along its lane or to the next lane.' },
    { name: 'select', emits: ['view'],
      does: 'Extends the range of selected steps; the owner keeps the selection.' },
    { name: 'toggle', emits: NOTE_OR_PARAM,
      does: 'Turns the focused step, or every selected step, on or off in one action.' },
    { name: 'paint', emits: NOTE_OR_PARAM, keyPath: ['Shift+ArrowRight', 'Enter'],
      does: 'Sets every step a drag passes along one lane to the first one\'s new state.' },
    { name: 'value', emits: NOTE_OR_PARAM, keyPath: ['PageUp', 'PageDown'],
      does: 'Drags a step\'s value vertically: a velocity, or a list parameter\'s value.' },
    { name: 'transpose', emits: NOTE_OR_PARAM,
      does: 'Moves the step a semitone, or an octave with Shift; a value lane by its step.' },
    { name: 'copy', emits: ['view'],
      does: 'Copies the selected steps into the view\'s clipboard without any edit.' },
    { name: 'cut', emits: NOTE_OR_PARAM,
      does: 'Copies the selected steps and turns them off in one action.' },
    { name: 'paste', emits: NOTE_OR_PARAM,
      does: 'Pastes from the focused step, cut at the lane\'s end so its length is kept.' },
    { name: 'clear', emits: NOTE_OR_PARAM,
      does: 'Turns the selected steps off; on an empty step it builds no action.' },
    { name: 'page', emits: ['view'],
      does: 'Shows the previous or the next page of steps; the owner keeps the page.' },
    { name: 'menu', emits: ['view'],
      does: 'Opens the focused step\'s menu of accent, ratchet, probability and slide.' },
    { name: 'accent', emits: ['CLIP_UPDATE'], keyPath: STEP_MENU,
      does: `Accents the step by writing its velocity at or above ${ACCENT_VEL}, or below it.` },
    { name: 'ratchet', emits: ['CLIP_UPDATE'], keyPath: STEP_MENU,
      does: 'Sets the note\'s ratchet r, from one to eight equal onsets in its length.' },
    { name: 'probability', emits: ['CLIP_UPDATE'], keyPath: STEP_MENU,
      does: 'Sets the note\'s probability p, above zero and at most one.' },
    { name: 'slide', emits: ['CLIP_UPDATE'], keyPath: STEP_MENU,
      does: 'Turns the note\'s slide on or off, a glide from the note before it.' },
  ],
  keys: [
    key('ArrowLeft', 'move', 'step-grid-move'), key('ArrowRight', 'move', 'step-grid-move'),
    key('ArrowUp', 'move', 'step-grid-move'), key('ArrowDown', 'move', 'step-grid-move'),
    key('Shift+ArrowLeft', 'select', 'step-grid-select'),
    key('Shift+ArrowRight', 'select', 'step-grid-select'),
    key('Shift+ArrowUp', 'select', 'step-grid-select'),
    key('Shift+ArrowDown', 'select', 'step-grid-select'),
    key('Enter', 'toggle', 'step-grid-toggle'),
    key('Mod+C', 'copy', 'step-grid-clipboard'), key('Mod+X', 'cut', 'step-grid-clipboard'),
    key('Mod+V', 'paste', 'step-grid-clipboard'),
    key('Delete', 'clear', 'step-grid-clear'),
    key('PageUp', 'transpose', 'step-grid-transpose'),
    key('PageDown', 'transpose', 'step-grid-transpose'),
    key('Shift+PageUp', 'transpose', 'step-grid-transpose'),
    key('Shift+PageDown', 'transpose', 'step-grid-transpose'),
    key('[', 'page', 'step-grid-page'), key(']', 'page', 'step-grid-page'),
    key('Shift+F10', 'menu', 'step-grid-menu'), key('ContextMenu', 'menu', 'step-grid-menu'),
  ],
  pointer: {
    events: ['toggle', 'select', 'paint', 'value', 'menu', 'accent', 'ratchet', 'probability',
      'slide'],
    rule: 'A click toggles a step, Shift and a click extend the selection, a drag along a lane '
      + 'paints, a vertical drag on a value lane sets it, a secondary click opens the menu.',
  },
  touch: {
    events: ['toggle', 'paint', 'value', 'menu', 'accent', 'ratchet', 'probability', 'slide'],
    rule: 'A tap toggles a step, a horizontal drag along a lane paints, a vertical drag on a '
      + 'value lane sets it, and a long press opens the step menu.',
  },
  state: ['studio.clip', 'notes'],
  links: { opens: ['route:studio'], openedBy: ['route:synth'] },
  aria: {
    role: 'grid',
    parts: { lane: 'row', laneName: 'rowheader', step: 'gridcell' },
    name: 'Each gridcell is named by its lane, its step number and its state, as in '
      + '\'Kick, step 5, on\' or \'Step 5, 0.50, on\'; aria-selected marks the selection and '
      + 'aria-current=step the playing step.',
  },
  target: { min: 44 },
  layout: {
    '390x844': 'Eight 44 px steps per page, paged with [ and ] or the page buttons; each lane '
      + 'name sits above its row, since no name column fits beside eight steps.',
    '1536x1024': 'Sixteen steps per page with the lane names beside them.',
  },
  live: true,
  reducedMotion: 'With reduced motion the playing step changes only its aria-current outline: '
    + 'no transition, trail or pulse.',
  truth: { none: 'it draws model notes and the transport step, never a measured value' },
  impl: { modules: ['src/js/ui/kinds/step-grid.js', 'src/js/ui/kinds/step-grid-model.js'],
    issue: 'W008' },
  workspaces: ['synth'],
  transient: ['focus', 'drag-preview', 'open-entry'],
  mount: { extras: [] },
  constants: { accentVel: ACCENT_VEL },
});

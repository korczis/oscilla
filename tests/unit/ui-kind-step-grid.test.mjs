// The step-grid kind's model and view (plan issue W008, ADR 0086): every key maps to exactly
// one action of the expected payload, recorded through a fake commit; a paste keeps the
// target's length; Space builds nothing; the playhead writes only on a step change and keeps
// its state across ticks; a list-parameter grid builds one NODE_PARAM_SET per gesture. The
// four negative cases of W008: a paste longer than the target (its length kept), Delete on an
// empty step (no action), Space (the transport's), a value step past the parameter's range
// (held at its end, no action; K221's review of the spliced English sentence).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCENT_VEL, NEW_GRID, PAGE_STEPS, STEP_VEL, applyEdits, cellName, chordOf,
  createPlayhead, createStepGrid, pageStepsFor, projectNotes, stepOf }
  from '../../src/js/ui/kinds/step-grid-model.js';
import { ACTION_TYPES } from '../../src/js/studio/actions.js';
import { notesRules } from '../../src/js/studio/notes.js';
import stepGrid from '../../src/js/ui/catalog/kinds/step-grid.js';

const KICK = 36;
const SNARE = 38;
const SB = NEW_GRID.stepBeats;
const note = (step, n, extra = {}) => ({ at: step * SB, note: n, len: SB, vel: STEP_VEL,
  ...extra });

/** A notes grid over two lanes with a recording owner that keeps selection and page. */
function notesGrid(notes = [], more = {}) {
  const log = { actions: [], said: [], view: [] };
  const owner = { selection: [], page: 0 };
  const grid = createStepGrid({
    mode: 'notes', lanes: [KICK, SNARE], clipId: 'clip-1', payload: { notes },
    steps: 16, stepBeats: SB, pageSteps: 16,
    commit: (a) => {
      log.actions.push(a);
      if (a.type === 'CLIP_UPDATE') grid.set({ payload: a.payload });
      return more.refuse ? { refused: more.refuse } : true;
    },
    onView: (v) => {
      log.view.push(v);
      if (v.selection) owner.selection = v.selection;
      if (v.page != null) owner.page = v.page;
      grid.set({ selection: owner.selection, page: owner.page });
    },
    say: (s) => log.said.push(s),
    ...more,
  });
  return { grid, log };
}
const notesOf = (log) => log.actions.at(-1).payload.notes;

test('the grid is a projection: on-grid steps, off-grid notes kept and reported', () => {
  const notes = [note(0, KICK), note(4, SNARE, { vel: 0.9 }), { at: 0.1, note: KICK, len: SB,
    vel: 0.5 }, note(20, KICK), note(2, 60)];
  const { cells, offGrid } = projectNotes(notes, { lanes: [KICK, SNARE], steps: 16,
    stepBeats: SB });
  assert.equal(cells[0][0].vel, STEP_VEL);
  assert.equal(cells[1][4].vel, 0.9);
  assert.deepEqual(offGrid.map((o) => [o.lane, o.at]), [[0, 0.1], [0, 5]]);
  assert.equal(stepOf(0.75, SB), 3);
  assert.equal(stepOf(0.8, SB), null);
  // An edit never moves or drops an off-grid note.
  const out = applyEdits(notes, [{ lane: 0, step: 1, set: { vel: STEP_VEL } }],
    { lanes: [KICK, SNARE], stepBeats: SB });
  for (const n of notes) assert.ok(out.some((m) => m.at === n.at && m.note === n.note), n.at);
  assert.equal(out.length, notes.length + 1);
});

test('every key maps to exactly one action of the expected payload', () => {
  // Enter: one CLIP_UPDATE with the focused step on, at 0 beats, a step long.
  let { grid, log } = notesGrid();
  assert.equal(grid.key('Enter'), true);
  assert.equal(log.actions.length, 1);
  assert.equal(log.actions[0].type, 'CLIP_UPDATE');
  assert.equal(log.actions[0].clipId, 'clip-1');
  assert.deepEqual(notesOf(log), [note(0, KICK)]);
  assert.deepEqual(notesRules({ kind: 'notes', start: 0, duration: 4, musical: { beats: 4 },
    payload: log.actions[0].payload }).filter((r) => r.code !== 'notes-absolute'), []);
  // Enter again switches it off: one more action.
  grid.key('Enter');
  assert.deepEqual(notesOf(log), []);
  // Arrows move the focus and build nothing.
  ({ grid, log } = notesGrid());
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) grid.key(k);
  assert.deepEqual(grid.focus, { lane: 0, step: 1 });
  assert.equal(log.actions.length, 0);
  // Shift+arrows select a range the owner keeps; Enter then switches the range on, one action.
  grid.key('Shift+ArrowRight');
  grid.key('Shift+ArrowRight');
  assert.deepEqual(log.view.at(-1), { selection: [1, 3] });
  grid.key('Enter');
  assert.equal(log.actions.length, 1);
  assert.deepEqual(notesOf(log), [note(1, KICK), note(2, KICK), note(3, KICK)]);
  // Mod+C copies (no action), Mod+X cuts the range (one action), Mod+V pastes it (one action).
  grid.key('Mod+C');
  assert.equal(log.actions.length, 1);
  grid.key('Mod+X');
  assert.equal(log.actions.length, 2);
  assert.deepEqual(notesOf(log), []);
  grid.set({ selection: [] });
  grid.key('ArrowRight'); // focus step 4
  grid.key('Mod+V');
  assert.equal(log.actions.length, 3);
  assert.deepEqual(notesOf(log), [note(4, KICK), note(5, KICK), note(6, KICK)]);
  // PageUp a semitone, Shift+PageUp an octave, PageDown back: one action each.
  ({ grid, log } = notesGrid([note(0, KICK)]));
  grid.key('PageUp');
  assert.deepEqual(notesOf(log), [note(0, KICK + 1)]);
  grid.set({ lanes: [KICK + 1, SNARE] });
  grid.key('Shift+PageUp');
  assert.deepEqual(notesOf(log), [note(0, KICK + 13)]);
  assert.equal(log.actions.length, 2);
  // Delete switches the focused step off; [ and ] page; the menu keys open the menu.
  ({ grid, log } = notesGrid([note(0, KICK)], { pageSteps: 8 }));
  grid.key('Delete');
  assert.deepEqual(notesOf(log), []);
  grid.key(']');
  assert.deepEqual(log.view.at(-1), { page: 1 });
  grid.key('[');
  assert.deepEqual(log.view.at(-1), { page: 0 });
  grid.key('Shift+F10');
  assert.deepEqual(log.view.at(-1), { menu: { lane: 0, step: 0 } });
  grid.key('ContextMenu');
  assert.deepEqual(log.view.at(-1), { menu: { lane: 0, step: 0 } });
  assert.equal(log.actions.length, 1);
});

test('the declared keys are the keys the model handles, and each emits what it declares', () => {
  const handled = (chord) => notesGrid([note(0, KICK), note(1, KICK)]).grid.key(chord);
  for (const k of stepGrid.keys) assert.equal(handled(k.chord), true, k.chord);
  for (const e of stepGrid.events) {
    for (const t of e.emits) {
      assert.ok(t === 'view' || ACTION_TYPES.includes(t), `${e.name}: ${t}`);
    }
  }
});

test('Space builds nothing: it is the transport\'s (negative case)', () => {
  const { grid, log } = notesGrid([note(0, KICK)]);
  assert.equal(grid.key('Space'), false);
  assert.equal(chordOf({ key: ' ' }), 'Space');
  assert.equal(log.actions.length, 0);
  assert.equal(log.view.length, 0);
});

test('Delete on an empty step builds no action (negative case)', () => {
  const { grid, log } = notesGrid();
  assert.equal(grid.key('Delete'), true);
  assert.equal(log.actions.length, 0);
});

test('a paste longer than the target keeps the target\'s length (negative case)', () => {
  const four = [0, 1, 2, 3].map((s) => note(s, KICK));
  const { grid, log } = notesGrid(four);
  grid.key('Shift+ArrowRight');
  grid.key('Shift+ArrowRight');
  grid.key('Shift+ArrowRight');
  grid.key('Mod+C');
  grid.set({ selection: [] });
  while (grid.focus.step < 14) grid.key('ArrowRight'); // the focus: step 14 of 16
  assert.equal(grid.focus.step, 14);
  grid.key('Mod+V');
  const notes = notesOf(log);
  assert.ok(notes.every((n) => n.at < 16 * SB), 'nothing past the last step');
  assert.deepEqual(notes.filter((n) => n.at >= 14 * SB), [note(14, KICK), note(15, KICK)]);
  assert.equal(notes.length, 6);
});

test('a list-parameter grid builds one NODE_PARAM_SET per gesture', () => {
  const param = { key: 'steps', label: 'Kroky', type: 'list', min: -1, max: 1, minLength: 1,
    maxLength: 16, step: 0.01 };
  const log = { actions: [], said: [] };
  // K221 review: a bipolar list is off at 0 (no modulation), not at its minimum -1.
  const grid = createStepGrid({ mode: 'param-list', nodeId: 'stepmod-1', param,
    values: [0, 0, 0.5, 0], pageSteps: 16,
    commit: (a) => { log.actions.push(a); grid.set({ values: a.value }); return true; },
    say: (s) => log.said.push(s) });
  // A drag along the lane paints three steps on: one action.
  grid.down(0, 1);
  grid.over(0, 2);
  grid.over(0, 3);
  grid.up();
  assert.equal(log.actions.length, 1);
  assert.deepEqual(log.actions[0], { type: 'NODE_PARAM_SET', nodeId: 'stepmod-1', key: 'steps',
    value: [0, 1, 0.5, 1] });
  // A vertical drag sets one value: one action.
  grid.valueAt(0, 0, 0.75);
  assert.equal(log.actions.length, 2);
  assert.equal(log.actions[1].value[0], 0.5);
  // Delete switches a step off to 0, the neutral value of the bipolar range, never to -1; on a
  // step already off it builds nothing.
  grid.key('ArrowRight');
  grid.key('Delete');
  assert.equal(log.actions.length, 3);
  const changed = log.actions[2].value.filter((v, i) => v !== log.actions[1].value[i]);
  assert.deepEqual(changed, [0], 'the step Delete switched off reads 0');
  grid.key('Delete');
  assert.equal(log.actions.length, 3);
  // The step's name says what it plays: 0 is off, -1 (full negative modulation) is on.
  assert.match(cellName('', 1, 0, 'param-list', false), /vypnuto$/);
  assert.match(cellName('', 1, -1, 'param-list', true), /zapnuto$/);
});

test('K221 review: a value step past the range end is held there, with no action and no word',
  () => {
    const param = { key: 'steps', label: 'Kroky', type: 'list', min: -1, max: 1, minLength: 1,
      maxLength: 16, step: 0.01 };
    const log = { actions: [], said: [] };
    const grid = createStepGrid({ mode: 'param-list', nodeId: 'n', param, values: [1, 0.995],
      commit: (a) => { log.actions.push(a); grid.set({ values: a.value }); return true; },
      say: (s) => log.said.push(s) });
    grid.key('PageUp'); // 1 + 0.01 past max: held at 1, nothing to do
    assert.deepEqual([log.actions.length, log.said.length], [0, 0]);
    grid.key('ArrowRight');
    grid.key('PageUp'); // 0.995 + 0.01 -> held at 1, one action
    assert.equal(log.actions.length, 1);
    assert.equal(log.actions[0].value[1], 1);
    grid.valueAt(0, 0, 0.4321); // a pointer value is rounded to the parameter's step
    assert.equal(log.actions[1].value[0], -0.14);
  });

test('a value at the range end is not stepped past it (negative case)', () => {
  // W008's negative case as restated by K221's review: a step past the end of the range is held
  // there and refused silently, instead of a sentence spliced from the store's English reason.
  const param = { key: 'steps', label: 'Kroky', type: 'list', min: 0, max: 1, minLength: 1,
    maxLength: 16, step: 0.1 };
  const log = { actions: [], said: [] };
  const grid = createStepGrid({ mode: 'param-list', nodeId: 'n', param, values: [1, 0],
    commit: (a) => { log.actions.push(a); return true; }, say: (s) => log.said.push(s) });
  grid.key('PageUp'); // 1 + 0.1 > max
  assert.equal(log.actions.length, 0);
  assert.equal(log.said.length, 0);
});

test('a refusal says the store\'s sentence once and leaves the grid as it was', () => {
  const { grid, log } = notesGrid([], { refuse: 'Klip je zamčený.' });
  grid.key('Enter');
  assert.deepEqual(log.said, ['Klip je zamčený.']);
});

test('a pointer drag paints along one lane in one action; another lane does not join', () => {
  const { grid, log } = notesGrid([note(2, KICK)]);
  grid.down(0, 0);
  grid.over(0, 1);
  grid.over(1, 2); // another lane: ignored
  grid.over(0, 3);
  assert.deepEqual(grid.drag, { lane: 0, from: 0, to: 3, state: true });
  grid.up();
  assert.equal(log.actions.length, 1);
  assert.deepEqual(notesOf(log), [0, 1, 2, 3].map((s) => note(s, KICK)));
});

test('the step menu: accent is velocity, ratchet, probability and slide in their ranges', () => {
  const { grid, log } = notesGrid([note(0, KICK)]);
  grid.menu('accent');
  assert.equal(notesOf(log)[0].vel, 1);
  assert.ok(notesOf(log)[0].vel >= ACCENT_VEL);
  grid.menu('accent');
  assert.equal(notesOf(log)[0].vel, STEP_VEL);
  grid.menu('ratchet', 3);
  assert.equal(notesOf(log)[0].r, 3);
  grid.menu('probability', 0.5);
  assert.equal(notesOf(log)[0].p, 0.5);
  grid.menu('slide');
  assert.equal(notesOf(log)[0].slide, true);
  assert.equal(log.actions.length, 5);
  assert.equal(grid.menu('ratchet', 9), false);
  assert.equal(grid.menu('probability', 0), false);
  assert.equal(log.actions.length, 5);
  assert.equal(log.said.length, 2);
  grid.key('ArrowRight');
  assert.equal(grid.menu('accent'), false); // an empty step has no menu edits
});

test('the playhead writes only on a step change and keeps its state across ticks', () => {
  const writes = [];
  const ph = createPlayhead((s) => writes.push(s));
  for (let i = 0; i < 1000; i += 1) ph.tick(Math.floor(i / 250));
  ph.tick(null);
  ph.tick(null);
  ph.tick(undefined);
  assert.deepEqual(writes, [0, 1, 2, 3, null]);
});

test('pages and names: 8 steps at 390 px, 16 at 1536 px; a cell names lane, step and state', () => {
  assert.equal(pageStepsFor(390), PAGE_STEPS.narrow);
  assert.equal(pageStepsFor(1536), PAGE_STEPS.wide);
  assert.equal(PAGE_STEPS.narrow, 8);
  assert.equal(PAGE_STEPS.wide, 16);
  assert.equal(cellName('Kopák', 4, { vel: 0.7 }), 'Kopák, krok 5, zapnuto');
  assert.equal(cellName('Kopák', 4, { vel: 0.9 }), 'Kopák, krok 5, zapnuto, přízvuk');
  assert.equal(cellName('Kopák', 0, null), 'Kopák, krok 1, vypnuto');
  assert.equal(cellName('', 4, 0.5, 'param-list'), 'Krok 5, 0,50, zapnuto');
  assert.equal(stepGrid.constants.accentVel, ACCENT_VEL);
  assert.equal(stepGrid.kind, 'step-grid');
});

test('the grid change is one NOTES_GRID_SET, keep unless the gesture names a mode', () => {
  const { grid, log } = notesGrid([note(0, KICK)]);
  grid.setGrid({ stepBeats: 0.5 });
  grid.setGrid({ stepBeats: 0.125 }, 'map');
  assert.deepEqual(log.actions, [
    { type: 'NOTES_GRID_SET', clipId: 'clip-1', grid: { stepBeats: 0.5 }, mode: 'keep' },
    { type: 'NOTES_GRID_SET', clipId: 'clip-1', grid: { stepBeats: 0.125 }, mode: 'map' }]);
  assert.ok(ACTION_TYPES.includes('NOTES_GRID_SET'));
});

// ------------------------------------------------------------------------------ the view
/** A minimal element: attributes, classes, listeners; querySelector answers stubs by selector. */
function fakeEl() {
  const on = new Map();
  const kids = new Map();
  const cls = new Set();
  const e = {
    dataset: {}, textContent: '', disabled: false, className: '', value: '', clientWidth: 0,
    ownerDocument: { activeElement: null },
    classList: {
      add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
      toggle(c, f) { if (f ?? !cls.has(c)) cls.add(c); else cls.delete(c); },
    },
    attrs: new Map(),
    setAttribute(k, v) { e.attrs.set(k, String(v)); },
    removeAttribute(k) { e.attrs.delete(k); },
    addEventListener(t, fn) { if (!on.has(t)) on.set(t, new Set()); on.get(t).add(fn); },
    removeEventListener(t, fn) { if (on.has(t)) on.get(t).delete(fn); },
    fire(t, ev = {}) {
      let prevented = false;
      for (const fn of [...(on.get(t) || [])]) {
        fn({ target: e, preventDefault() { prevented = true; }, stopPropagation() {}, ...ev });
      }
      return prevented;
    },
    listeners: () => [...on.values()].reduce((n, s) => n + s.size, 0),
    querySelector(sel) { if (!kids.has(sel)) kids.set(sel, fakeEl()); return kids.get(sel); },
    querySelectorAll: () => [],
    contains: () => true,
    focus() {},
  };
  return e;
}

test('the view: one frame subscriber, freed at destroy; keys reach it, Space not', async () => {
  const { mountStepGrid } = await import('../../src/js/ui/kinds/step-grid.js');
  const { frameSubscriberCount } = await import('../../src/js/charts/frame-loop.js');
  const host = fakeEl();
  const root = fakeEl();
  Object.defineProperty(host, 'firstElementChild', { get: () => root });
  const actions = [];
  const before = frameSubscriberCount();
  const view = mountStepGrid(host, { mode: 'notes', lanes: [KICK, SNARE],
    laneNames: ['Kopák', 'Virbl'], clipId: 'clip-1', payload: { notes: [] }, steps: 16,
    stepBeats: SB, pageSteps: 16, label: 'Bicí', playStep: () => null,
    commit: (a) => { actions.push(a); return true; } });
  for (const k of ['element', 'set', 'setDisabled', 'destroy']) assert.ok(k in view, k);
  assert.equal(frameSubscriberCount(), before + 1);
  const surface = root.querySelector('[data-step-grid-surface]');
  assert.equal(surface.fire('keydown', { key: ' ' }), false, 'Space is not taken');
  assert.equal(actions.length, 0);
  assert.equal(surface.fire('keydown', { key: 'Enter' }), true);
  assert.deepEqual(actions.map((a) => a.type), ['CLIP_UPDATE']);
  view.setDisabled('Klip je jen ke čtení.');
  surface.fire('keydown', { key: 'Enter' });
  assert.equal(actions.length, 1, 'a disabled grid builds nothing');
  view.destroy();
  assert.equal(frameSubscriberCount(), before);
  assert.equal(surface.listeners(), 0);
});

// ------------------------------------------------------------------------------ the Inspector
test('the Inspector grid: the clip\'s notes as lanes, its grid\'s steps, the playing step',
  async () => {
  const { DEFAULT_LANE, clipStepsView, playingStep } =
    await import('../../src/js/ui/studio/inspector-steps.js');
  const model = { transport: { tempo: 120 } };
  const clip = (notes, extra = {}) => ({ id: 'c1', kind: 'notes', start: 1, duration: 2,
    musical: { durationBeats: 4 }, payload: { notes }, ...extra });
  // An empty clip shows C4; a clip's notes are its lanes, highest first, named.
  const empty = clipStepsView(model, clip([]), true);
  assert.deepEqual(empty.lanes, [DEFAULT_LANE]);
  assert.deepEqual(empty.laneNames, ['C4']);
  assert.equal(empty.steps, 16);
  const v = clipStepsView(model, clip([note(0, 36), note(1, 38), note(2, 36)]), true);
  assert.deepEqual(v.lanes, [38, 36]);
  assert.deepEqual(v.laneNames, ['D2', 'C2']);
  // The clip's own grid sets the steps: 4 beats of 0.5 are 8 steps.
  const half = clipStepsView(model, clip([], { payload: { notes: [],
    grid: { stepBeats: 0.5, swing: 0, seed: 0 } } }), true);
  assert.equal(half.steps, 8);
  // The playing step: the playhead's seconds from the clip start in steps (120 bpm: 0.125 s a
  // step), null when stopped, outside the clip or on a target that does not play notes.
  assert.equal(playingStep(model, empty, { playing: true, position: 1 }), 0);
  assert.equal(playingStep(model, empty, { playing: true, position: 1.3 }), 2);
  assert.equal(playingStep(model, empty, { playing: false, position: 1.3 }), null);
  assert.equal(playingStep(model, empty, { playing: true, position: 0.5 }), null);
  assert.equal(playingStep(model, empty, { playing: true, position: 3.1 }), null);
  const held = clipStepsView(model, clip([]), false);
  assert.equal(playingStep(model, held, { playing: true, position: 1 }), null);
});

// ------------------------------------------------------------------------------ review R2-W8
test('R2-W8-1: a page holds only the steps its width fits (4 in the 268 px Inspector)', () => {
  // The Studio Inspector's card is 268 px wide at 1536 px: eight 44 px steps were cut off.
  assert.equal(pageStepsFor(242), PAGE_STEPS.panel);
  assert.equal(PAGE_STEPS.panel, 4);
  // Neighbours share a border: eight 44 px steps take 345 px, inside a phone's 350 px Inspector.
  assert.equal(pageStepsFor(350), PAGE_STEPS.narrow);
  assert.equal(pageStepsFor(8 * 44 - 7), PAGE_STEPS.narrow);
  assert.equal(pageStepsFor(8 * 44 - 8), PAGE_STEPS.panel);
});

test('R2-W8-1: the view fits its pages to the width it is laid out in', async () => {
  const { mountStepGrid } = await import('../../src/js/ui/kinds/step-grid.js');
  const host = fakeEl();
  const root = fakeEl();
  Object.defineProperty(host, 'firstElementChild', { get: () => root });
  root.querySelector('[data-step-grid-surface]').clientWidth = 242;
  const pages = [];
  const view = mountStepGrid(host, { mode: 'notes', lanes: [60], clipId: 'c',
    payload: { notes: [] }, steps: 16, stepBeats: SB, commit: () => true,
    onView: (v) => { if (v.page != null) pages.push(v.page); } });
  assert.equal(view.model.state().pageSteps, 4);
  assert.equal(view.model.state().pages, 4);
  root.querySelector('[data-step-grid-surface]').clientWidth = 400;
  view.set({});
  assert.equal(view.model.state().pageSteps, 8);
  assert.deepEqual(pages, [0], 'the owner hears the page once, when the size changed');
  view.destroy();
});

test('R2-W8-2: [ and ] keep the focused column on the new page', () => {
  const { grid, log } = notesGrid([], { pageSteps: 4 });
  grid.key('ArrowRight');
  grid.key('ArrowRight'); // step 2, column 2 of page 0
  grid.key(']');
  assert.deepEqual(grid.focus, { lane: 0, step: 6 });
  assert.deepEqual(log.view.at(-1), { page: 1 });
  grid.key(']');
  grid.key(']');
  assert.deepEqual(grid.focus, { lane: 0, step: 14 });
  grid.key(']'); // no page after the last: nothing moves
  assert.deepEqual(grid.focus, { lane: 0, step: 14 });
  grid.key('[');
  assert.deepEqual(grid.focus, { lane: 0, step: 10 });
});

test('R2-W8-3: the Studio\'s shortcuts dialog, where the grid is mounted, lists its keys',
  async () => {
  const { shortcutHelp } = await import('../../src/js/ui/shortcuts.js');
  const ids = new Set(shortcutHelp('studio').rows.map((r) => r.id));
  for (const k of stepGrid.keys) assert.ok(ids.has(k.row), k.row);
  assert.deepEqual([...stepGrid.workspaces], ['studio', 'synth']); // K222: the Drums tab
});

test('a re-render waits for a held drag; the Inspector skips an unchanged clip', async () => {
  const { mountStepGrid } = await import('../../src/js/ui/kinds/step-grid.js');
  const host = fakeEl();
  const root = fakeEl();
  Object.defineProperty(host, 'firstElementChild', { get: () => root });
  const actions = [];
  const view = mountStepGrid(host, { mode: 'notes', lanes: [60], clipId: 'c',
    payload: { notes: [] }, steps: 16, stepBeats: SB, pageSteps: 8,
    commit: (a) => { actions.push(a); return true; } });
  const label = root.querySelector('[data-step-page-label]');
  view.model.down(0, 0);
  label.textContent = 'held';
  view.set({ page: 1 }); // mid-drag: no render
  assert.equal(label.textContent, 'held');
  view.model.over(0, 2);
  view.model.up();
  assert.equal(actions.length, 1);
  view.set({});
  assert.notEqual(label.textContent, 'held');
  view.destroy();
});

test('R2-K221-8: a render mid value-drag never turns the release into the minimum', async () => {
  // oscilla-c3 with oscilla-c1: a cell replaced while held measures 0 high once detached, and
  // the release read 0, the range's minimum: -1 on the bipolar Step Modulator, full negative
  // modulation. The drag keeps the box it started on; a 0-high box keeps the last value.
  const { mountStepGrid } = await import('../../src/js/ui/kinds/step-grid.js');
  const param = { key: 'steps', label: 'Kroky', type: 'list', min: -1, max: 1, minLength: 1,
    maxLength: 16, step: 0.01 };
  const host = fakeEl();
  const root = fakeEl();
  const find = root.querySelector;
  root.querySelector = (sel) => (sel === '[data-step-detail]' ? null : find(sel)); // list: none
  Object.defineProperty(host, 'firstElementChild', { get: () => root });
  const actions = [];
  const view = mountStepGrid(host, { mode: 'param-list', nodeId: 'n', param,
    values: [0, 0, 0, 0], label: 'Kroky', laneNames: ['Kroky'],
    commit: (a) => { actions.push(a); return true; } });
  const surface = root.querySelector('[data-step-grid-surface]');
  let box = { top: 100, height: 40 };
  const cell = fakeEl();
  cell.dataset = { lane: '0', step: '2' };
  cell.getBoundingClientRect = () => box;
  cell.closest = () => cell;
  surface.setPointerCapture = () => {};
  surface.fire('pointerdown', { target: cell, button: 0, pointerId: 1, clientY: 138 });
  surface.fire('pointermove', { target: cell, clientY: 102 }); // near the top
  view.set({ values: [0, 0, 0, 0] }); // a model change arrives mid-drag
  box = { top: 0, height: 0 }; // the held cell is gone from the page
  surface.fire('pointerup', { target: cell, clientY: 101 });
  assert.equal(actions.length, 1, 'one action for the gesture');
  assert.ok(actions[0].value[2] >= 0.9, `the release keeps the dragged value, got ${
    actions[0].value[2]}`);
  view.destroy();
});

test('R2-W8-7: a grid narrower than its clip follows the playing step to its page', () => {
  const { grid, log } = notesGrid([], { pageSteps: 4 });
  assert.equal(grid.followPage(2), null, 'on the page shown');
  assert.equal(grid.followPage(5), 1);
  grid.set({ page: 1 });
  assert.equal(grid.followPage(5), null);
  assert.equal(grid.followPage(15), 3);
  assert.equal(grid.followPage(null), null);
  assert.equal(grid.followPage(16), null, 'past the last step');
  assert.equal(log.actions.length, 0, 'following builds no action');
});

// ------------------------------------------------------------------------------ T3 view fixes
/** A host whose surface holds real cells: innerHTML's gridcells become elements with
 *  attributes, so the playhead's writes can be read back per lane and step. */
function cellHost(surfaceWidth = 0) {
  const host = fakeEl();
  const root = fakeEl();
  Object.defineProperty(host, 'firstElementChild', { get: () => root });
  const surface = root.querySelector('[data-step-grid-surface]');
  surface.clientWidth = surfaceWidth;
  let cells = [];
  Object.defineProperty(surface, 'innerHTML', {
    set(html) {
      cells = [...String(html).matchAll(/data-lane="(\d+)" data-step="(\d+)"/g)].map((m) => {
        const c = fakeEl();
        c.dataset = { lane: m[1], step: m[2] };
        c.getAttribute = (k) => (c.attrs.has(k) ? c.attrs.get(k) : null);
        return c;
      });
    },
    get: () => '',
  });
  surface.querySelectorAll = (sel) => (sel === '[role="gridcell"]' ? cells : []);
  return { host, cells: () => cells };
}
/** The frame loop's requestAnimationFrame, driven by hand. */
function frames() {
  let next = null;
  globalThis.requestAnimationFrame = (fn) => { next = fn; return 1; };
  globalThis.cancelAnimationFrame = () => { next = null; };
  return { tick: (t = 0) => { const f = next; next = null; if (f) f(t); },
    done: () => {
      delete globalThis.requestAnimationFrame;
      delete globalThis.cancelAnimationFrame;
    } };
}

test('T3 fix: the playing step leaves no stale aria-current on any lane', async () => {
  const { mountStepGrid } = await import('../../src/js/ui/kinds/step-grid.js');
  const clock = frames();
  const { host, cells } = cellHost();
  let step = 0;
  const view = mountStepGrid(host, { mode: 'notes', lanes: [KICK, SNARE], clipId: 'c',
    payload: { notes: [] }, steps: 16, stepBeats: SB, pageSteps: 8, playStep: () => step,
    commit: () => true });
  const current = () => cells().filter((c) => c.getAttribute('aria-current') === 'step')
    .map((c) => `${c.dataset.lane}:${c.dataset.step}`).sort();
  clock.tick();
  assert.deepEqual(current(), ['0:0', '1:0']);
  step = 1;
  clock.tick();
  assert.deepEqual(current(), ['0:1', '1:1'], 'the second lane\'s step 0 is cleared too');
  step = null;
  clock.tick();
  assert.deepEqual(current(), []);
  view.destroy();
  clock.done();
});

test('T3 fix: the first fit reaches the owner without a ReferenceError', async () => {
  const { mountClipSteps } = await import('../../src/js/ui/studio/inspector-steps.js');
  const { host } = cellHost(400); // laid out wider than the panel's four steps: a re-fit
  const store = { dispatch: () => ({ ok: true }), getModel: () => ({ transport: { tempo: 120 } }) };
  const view = { clipId: 'c', payload: { notes: [] }, stepBeats: SB, steps: 16, lanes: [60],
    laneNames: ['C4'], start: 0, plays: false };
  let steps;
  assert.doesNotThrow(() => { steps = mountClipSteps(host, { store }, view); });
  assert.equal(steps.grid.model.state().pageSteps, 8);
  steps.destroy();
});

test('T3 fix: sixteen steps need the 80 px name column the view draws, not 128 px', () => {
  // Sixteen 44 px steps sharing borders (689 px), the w-20 name column and its gap-2.
  assert.equal(pageStepsFor(16 * 44 - 15 + 80 + 8), PAGE_STEPS.wide);
  assert.equal(pageStepsFor(800), PAGE_STEPS.wide, 'the Synth card at 1536 px is about 800 px');
  assert.equal(pageStepsFor(16 * 44 - 15 + 80 + 7), PAGE_STEPS.narrow);
});

test('R2-K222-1: a page the user turns holds until the playhead enters it or a stop', () => {
  const { grid } = notesGrid([], { pageSteps: 4 });
  assert.equal(grid.followPage(5), 1, 'untouched: it follows');
  grid.set({ page: 1 }); // the owner showed the playing page
  grid.key('['); // the user turns back to page 0 while step 6 plays
  assert.equal(grid.state().page, 0);
  assert.equal(grid.followPage(6), null, 'the turned page holds');
  assert.equal(grid.followPage(9), null, 'still held while the playhead is elsewhere');
  assert.equal(grid.followPage(1), null, 'the playhead enters the page shown');
  assert.equal(grid.followPage(5), 1, 'and following resumes');
  grid.set({ page: 1 });
  grid.key(']');
  assert.equal(grid.followPage(6), null);
  assert.equal(grid.followPage(null), null, 'a stop releases the hold');
  assert.equal(grid.followPage(13), 3, 'the next run follows');
});

// ------------------------------------------------------------------------------ K019 bars
test('K019: a list parameter is drawn as bars; a drag across bars is one entry; keys reach all',
  async () => {
    const { mountStepGrid, stepBar } = await import('../../src/js/ui/kinds/step-grid.js');
    const bipolar = { key: 'steps', label: 'Kroky', type: 'list', min: -1, max: 1, minLength: 1,
      maxLength: 16, step: 0.01 };
    // The bar is the value's share of the range: up or down from the middle on a bipolar range.
    assert.deepEqual(stepBar(bipolar, 1), { dir: 'up', tenths: 10 });
    assert.deepEqual(stepBar(bipolar, 0.5), { dir: 'up', tenths: 5 });
    assert.deepEqual(stepBar(bipolar, 0), { dir: 'up', tenths: 0 });
    assert.deepEqual(stepBar(bipolar, -0.3), { dir: 'down', tenths: 3 });
    const unipolar = { ...bipolar, min: 0, max: 8 };
    assert.deepEqual(stepBar(unipolar, 6), { dir: 'bottom', tenths: 8 });
    // The view writes one bar per step, from the values.
    const host = fakeEl();
    const root = fakeEl();
    const find = root.querySelector;
    root.querySelector = (sel) => (sel === '[data-step-detail]' ? null : find(sel)); // list: none
    Object.defineProperty(host, 'firstElementChild', { get: () => root });
    const surface = root.querySelector('[data-step-grid-surface]');
    let html = '';
    Object.defineProperty(surface, 'innerHTML', { set(v) { html = String(v); }, get: () => html });
    const actions = [];
    const view = mountStepGrid(host, { mode: 'param-list', nodeId: 'n', param: bipolar,
      values: [1, -0.5, 0, 0.25], steps: 4, pageSteps: 16, label: 'Kroky', laneNames: ['Kroky'],
      commit: (a) => { actions.push(a); view.set({ values: a.value }); return true; } });
    const bars = [...html.matchAll(/data-step-bar="([a-z]+:\d+)"/g)].map((m) => m[1]);
    assert.deepEqual(bars, ['up:10', 'down:5', 'up:0', 'up:3'], 'one bar per step, from its value');
    // A drag across three bars is one NODE_PARAM_SET, one history entry.
    const grid = view.model;
    grid.down(0, 0);
    grid.over(0, 1);
    grid.over(0, 2);
    grid.up();
    assert.equal(actions.length, 1, 'one action for the drag');
    assert.equal(actions[0].type, 'NODE_PARAM_SET');
    // The keyboard reaches every step from the first.
    grid.set({ focus: { lane: 0, step: 0 } });
    const reached = new Set([grid.focus.step]);
    for (let i = 0; i < 3; i += 1) { grid.key('ArrowRight'); reached.add(grid.focus.step); }
    assert.deepEqual([...reached].sort(), [0, 1, 2, 3], 'arrows reach every step');
    view.destroy();
  });

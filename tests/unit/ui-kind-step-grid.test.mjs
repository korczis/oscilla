// The step-grid kind's model and view (plan issue W008, ADR 0086): every key maps to exactly
// one action of the expected payload, recorded through a fake commit; a paste keeps the
// target's length; Space builds nothing; the playhead writes only on a step change and keeps
// its state across ticks; a list-parameter grid builds one NODE_PARAM_SET per gesture. The
// four negative cases of W008: a paste longer than the target (its length kept), Delete on an
// empty step (no action), Space (the transport's), a value out of the parameter's range
// (refused with its sentence).

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
  const grid = createStepGrid({ mode: 'param-list', nodeId: 'stepmod-1', param,
    values: [0, -1, 0.5, -1], pageSteps: 16,
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
  // Delete on the lane's minimum builds nothing.
  grid.key('ArrowRight');
  grid.key('Delete');
  assert.equal(log.actions.length, 3);
  grid.key('Delete');
  assert.equal(log.actions.length, 3);
});

test('a value out of the parameter\'s range is refused with its sentence (negative case)', () => {
  const param = { key: 'steps', label: 'Kroky', type: 'list', min: 0, max: 1, minLength: 1,
    maxLength: 16, step: 0.1 };
  const log = { actions: [], said: [] };
  const grid = createStepGrid({ mode: 'param-list', nodeId: 'n', param, values: [1, 0],
    commit: (a) => { log.actions.push(a); return true; }, say: (s) => log.said.push(s) });
  grid.key('PageUp'); // 1 + 0.1 > max
  assert.equal(log.actions.length, 0);
  assert.equal(log.said.length, 1);
  assert.match(log.said[0], /^Kroky: hodnota values must be numbers between 0 and 1\.$/);
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
    dataset: {}, textContent: '', disabled: false, className: '', value: '',
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
        fn({ target: e, preventDefault() { prevented = true; }, ...ev });
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

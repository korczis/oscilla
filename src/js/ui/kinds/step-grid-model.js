// The step-grid model (plan issue W008, ADR 0086): pure. A notes clip seen as lanes of steps,
// or one list parameter seen as one lane of values, and every gesture of the step-grid kind
// (src/js/ui/catalog/kinds/step-grid.js) turned into one plain Studio action the owner commits.
// No DOM, no store, no audio, no timer; the view (step-grid.js) draws it and the owner
// dispatches what it builds.
//
// Notes mode: a lane is a note number and a step that is on is the note of that number at
// at = i x stepBeats (ADR 0086 decisions 2 and 5). A note of a lane that sits between steps or
// past the last one is off-grid: it is reported, drawn as such by the view, and never moved or
// dropped by an edit. Accent is vel >= ACCENT_VEL (decision 3); a step switched on gets
// STEP_VEL and the length of one step. One gesture builds one CLIP_UPDATE of the whole notes
// array, or nothing when it changes nothing.
// List mode: the one lane is a node's list parameter (section 79's list descriptor); one
// gesture builds one NODE_PARAM_SET, and a value outside the parameter's range is refused with
// the parameter's own sentence (studio/registry.js validateParamValue) before any action.
//
//   ACCENT_VEL, STEP_VEL, NEW_GRID, PAGE_STEPS, WIDE_MIN_PX, STEP_GRID_TEXT
//   pageStepsFor(widthPx) -> 8 | 16           the steps a page shows at that width
//   stepOf(at, stepBeats) -> step | null      the step a note's onset sits on, else null
//   projectNotes(notes, { lanes, steps, stepBeats }) -> { cells, offGrid }
//     cells[lane][step]: null or { index, vel, len, p, r, slide } (index in `notes`)
//   applyEdits(notes, edits, { lanes, stepBeats }) -> notes   edits [{ lane, step, set }]:
//     set null switches the step off, an object { vel, p?, r?, slide? } switches it on or
//     changes it (its len kept, one step when new); the result is sorted by (at, note)
//   chordOf(event) -> 'Mod+Shift+C' style chord of a keyboard event (Mod: Ctrl or Cmd)
//   cellName(laneName, step, cell, mode) -> the gridcell's accessible name (Czech)
//   createPlayhead(write) -> { tick(step), reset() }  write(step | null) only on a change
//   createStepGrid(opts) -> grid      the controller; opts:
//     mode 'notes' | 'param-list'; lanes [note numbers] (notes) ; laneNames [text]
//     clipId, payload (notes)  |  nodeId, param (descriptor), values (param-list)
//     steps, stepBeats, pageSteps
//     commit(action) -> true | { refused: sentence }   the owner dispatches
//     onView({ selection } | { page } | { menu })      the owner keeps selection and page
//     say(sentence)                                    the polite live region
//   grid.set({ payload | values, selection, page, steps, pageSteps, disabled })
//   grid.key(chord) -> handled (Space is never handled: it is the transport's)
//   grid.down(lane, step, { shift }), grid.over(lane, step), grid.up() -> a painted gesture
//   grid.valueAt(lane, step, fraction) -> the vertical drag of a value lane, one action
//   grid.menu(item, arg)  accent | ratchet n | probability p | slide, on the focused step
//   grid.focus, grid.state() -> { cells, offGrid, values, focus, selection, page, pages }

import { validateParamValue } from '../../studio/registry.js';

/** The velocity at or above which a step is accented (ADR 0086 decision 3). */
export const ACCENT_VEL = 0.8;
/** The velocity of a step switched on, and of an accent removed. */
export const STEP_VEL = 0.7;
/** A new step clip's grid: one 4/4 bar of sixteenths (ADR 0086 decision 2). */
export const NEW_GRID = Object.freeze({ steps: 16, stepBeats: 0.25 });
/** Steps per page: eight 44 px steps at a phone's width, sixteen beside the names wider. */
export const PAGE_STEPS = Object.freeze({ narrow: 8, wide: 16 });
/** Sixteen 44 px steps and a name column need this width. */
export const WIDE_MIN_PX = 16 * 44 + 128;

const EPS = 1e-9;
const RATCHET = [1, 8];
const NOTE = [0, 127];

/** The sentences the grid says (the polite live region) or refuses with. Czech (Q104). */
export const STEP_GRID_TEXT = Object.freeze({
  on: 'zapnuto',
  off: 'vypnuto',
  accent: 'přízvuk',
  step: (n) => `krok ${n}`,
  Step: (n) => `Krok ${n}`,
  noteRange: (note) => `Nota ${note} by vyšla mimo rozsah MIDI ${NOTE[0]} až ${NOTE[1]}; `
    + 'krok zůstává, kde je.',
  noteTaken: (note, step) => `Krok ${step + 1} už má notu ${note}; posun by ji zdvojil.`,
  ratchet: `Ratchet je celé číslo od ${RATCHET[0]} do ${RATCHET[1]}.`,
  probability: 'Pravděpodobnost je číslo větší než 0 a nejvýš 1.',
  empty: 'Zaměřený krok je vypnutý; jeho nabídka upravuje jen zapnutý krok.',
  param: (label, why) => `${label}: hodnota ${why}.`,
  clipboard: 'Schránka mřížky je prázdná.',
  copied: (n) => `Zkopírováno kroků: ${n}.`,
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmt = (v) => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',');

export function pageStepsFor(widthPx) {
  return widthPx >= WIDE_MIN_PX ? PAGE_STEPS.wide : PAGE_STEPS.narrow;
}

export function stepOf(at, stepBeats) {
  const q = at / stepBeats;
  const i = Math.round(q);
  return Math.abs(q - i) < EPS * Math.max(1, Math.abs(q)) ? i : null;
}

export function projectNotes(notes, { lanes, steps, stepBeats }) {
  const cells = lanes.map(() => new Array(steps).fill(null));
  const offGrid = [];
  notes.forEach((n, index) => {
    const lane = lanes.indexOf(n.note);
    if (lane < 0) return;
    const step = stepOf(n.at, stepBeats);
    if (step === null || step < 0 || step >= steps) {
      offGrid.push({ index, lane, at: n.at, note: n.note });
      return;
    }
    cells[lane][step] = { index, vel: n.vel, len: n.len, p: n.p, r: n.r, slide: n.slide };
  });
  return { cells, offGrid };
}

/** A note with only the optional fields that differ from their defaults (ADR 0086). */
function noteOf(base, set) {
  const n = { at: base.at, note: base.note, len: base.len, vel: set.vel ?? base.vel };
  const p = 'p' in set ? set.p : base.p;
  const r = 'r' in set ? set.r : base.r;
  const slide = 'slide' in set ? set.slide : base.slide;
  if (p != null && p < 1) n.p = p;
  if (r != null && r > 1) n.r = r;
  if (slide) n.slide = true;
  return n;
}

const byAtNote = (a, b) => a.at - b.at || a.note - b.note;

export function applyEdits(notes, edits, { lanes, stepBeats }) {
  const at = (step) => step * stepBeats;
  const key = (note, step) => `${note}@${step}`;
  const want = new Map(edits.map((e) => [key(lanes[e.lane], e.step), e.set]));
  const out = [];
  const seen = new Set();
  for (const n of notes) {
    const step = stepOf(n.at, stepBeats);
    const k = step === null ? null : key(n.note, step);
    if (k === null || !want.has(k)) {
      out.push(n);
      continue;
    }
    seen.add(k);
    const set = want.get(k);
    if (set) out.push(noteOf(n, set));
  }
  for (const e of edits) {
    const note = lanes[e.lane];
    const k = key(note, e.step);
    if (seen.has(k) || !e.set) continue;
    seen.add(k);
    out.push(noteOf({ at: at(e.step), note, len: stepBeats, vel: STEP_VEL }, e.set));
  }
  return out.sort(byAtNote);
}

export function chordOf(e) {
  const k = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (k === 'Shift' || k === 'Control' || k === 'Meta' || k === 'Alt') return '';
  const mod = e.ctrlKey || e.metaKey;
  // A bracket typed with Shift is another key on most layouts: only Mod and Shift prefix keys.
  return `${mod ? 'Mod+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey && k.length > 1 ? 'Shift+'
    : ''}${k}`;
}

export function cellName(laneName, step, cell, mode = 'notes') {
  const state = cell ? STEP_GRID_TEXT.on : STEP_GRID_TEXT.off;
  if (mode === 'param-list') return `${STEP_GRID_TEXT.Step(step + 1)}, ${fmt(cell)}, ${state}`;
  const accent = cell && cell.vel >= ACCENT_VEL ? `, ${STEP_GRID_TEXT.accent}` : '';
  return `${laneName}, ${STEP_GRID_TEXT.step(step + 1)}, ${state}${accent}`;
}

export function createPlayhead(write) {
  let last = -2;
  return {
    tick(step) {
      const s = Number.isInteger(step) ? step : -1;
      if (s === last) return false;
      last = s;
      write(s < 0 ? null : s);
      return true;
    },
    reset() { last = -2; },
  };
}

export function createStepGrid(opts) {
  const { mode = 'notes', commit, onView = () => {}, say = () => {} } = opts;
  const list = mode === 'param-list';
  const param = opts.param || null;
  let lanes = list ? [0] : [...opts.lanes];
  let steps = opts.steps ?? (list ? (opts.values || []).length : NEW_GRID.steps);
  const stepBeats = opts.stepBeats ?? NEW_GRID.stepBeats;
  let pageSteps = opts.pageSteps ?? PAGE_STEPS.wide;
  let payload = opts.payload || { notes: [] };
  let values = list ? [...(opts.values || [])] : null;
  let selection = [];
  let page = 0;
  let disabled = false;
  let clipboard = null;
  let drag = null;
  const focus = { lane: 0, step: 0 };

  const project = () => (list ? null : projectNotes(payload.notes, { lanes, steps, stepBeats }));
  let grid = project();
  const pages = () => Math.max(1, Math.ceil(steps / pageSteps));
  const on = (lane, step) => (list ? values[step] !== param.min : !!grid.cells[lane][step]);

  /** The steps a gesture acts on: the selected range of the focused lane, else the focus. */
  function targets() {
    if (selection.length === 2) {
      const [a, b] = [Math.min(...selection), Math.max(...selection)];
      return Array.from({ length: b - a + 1 }, (_, i) => ({ lane: focus.lane, step: a + i }));
    }
    return [{ lane: focus.lane, step: focus.step }];
  }

  /** Commits `action` (null: nothing to do) and says the store's sentence on a refusal. */
  function send(action) {
    if (!action || disabled) return false;
    const r = commit(action);
    if (r && r !== true && r.refused) {
      say(r.refused);
      return false;
    }
    return true;
  }
  function notesAction(edits) {
    if (!edits.length) return null;
    const notes = applyEdits(payload.notes, edits, { lanes, stepBeats });
    if (JSON.stringify(notes) === JSON.stringify(payload.notes)) return null;
    return { type: 'CLIP_UPDATE', clipId: opts.clipId, payload: { ...payload, notes } };
  }
  function listAction(next) {
    if (next.every((v, i) => v === values[i])) return null;
    const why = validateParamValue(param, next);
    if (why) {
      say(STEP_GRID_TEXT.param(param.label, why));
      return null;
    }
    return { type: 'NODE_PARAM_SET', nodeId: opts.nodeId, key: param.key, value: next };
  }
  /** One action setting every target to `state` (true on, false off). */
  function setAll(ts, state) {
    if (list) {
      const next = [...values];
      for (const t of ts) next[t.step] = state ? (values[t.step] !== param.min
        ? values[t.step] : param.max) : param.min;
      return listAction(next);
    }
    return notesAction(ts.filter((t) => on(t.lane, t.step) !== state)
      .map((t) => ({ ...t, set: state ? { vel: STEP_VEL } : null })));
  }
  /** One action changing every target that is on through `fn(cell) -> set | null`. */
  function editOn(ts, fn) {
    const edits = ts.filter((t) => on(t.lane, t.step))
      .map((t) => ({ ...t, set: fn(grid.cells[t.lane][t.step]) })).filter((e) => e.set);
    return notesAction(edits);
  }

  function move(dl, ds) {
    focus.lane = clamp(focus.lane + dl, 0, lanes.length - 1);
    focus.step = clamp(focus.step + ds, 0, steps - 1);
    const p = Math.floor(focus.step / pageSteps);
    if (p !== page) onView({ page: p });
    return true;
  }
  function select(ds) {
    const anchor = selection.length === 2 ? selection[0] : focus.step;
    move(0, ds);
    onView({ selection: [anchor, focus.step] });
    return true;
  }
  function copy() {
    const ts = targets();
    clipboard = ts.map((t) => (list ? values[t.step]
      : grid.cells[t.lane][t.step] && { ...grid.cells[t.lane][t.step] }));
    say(STEP_GRID_TEXT.copied(ts.length));
    return true;
  }
  function paste() {
    if (!clipboard) {
      say(STEP_GRID_TEXT.clipboard);
      return true;
    }
    // From the focused step, cut at the lane's end: the lane keeps its length.
    const room = clipboard.slice(0, steps - focus.step);
    if (list) {
      const next = [...values];
      room.forEach((v, i) => { next[focus.step + i] = v; });
      send(listAction(next));
      return true;
    }
    send(notesAction(room.map((c, i) => ({ lane: focus.lane, step: focus.step + i,
      set: c ? { vel: c.vel, p: c.p ?? 1, r: c.r ?? 1, slide: !!c.slide } : null }))));
    return true;
  }
  function transpose(semis) {
    const ts = targets();
    if (list) {
      const unit = param.step || (param.max - param.min) / 100;
      const next = [...values];
      for (const t of ts) next[t.step] = values[t.step] + Math.sign(semis) * unit
        * (Math.abs(semis) > 1 ? 10 : 1);
      send(listAction(next));
      return true;
    }
    const live = ts.filter((t) => on(t.lane, t.step));
    if (!live.length) return true;
    const notes = payload.notes.map((n) => ({ ...n }));
    const moving = new Set(live.map((t) => grid.cells[t.lane][t.step].index));
    for (const i of moving) {
      const to = notes[i].note + semis;
      if (to < NOTE[0] || to > NOTE[1]) {
        say(STEP_GRID_TEXT.noteRange(to));
        return true;
      }
      const clash = notes.some((n, j) => !moving.has(j) && n.note === to
        && Math.abs(n.at - notes[i].at) < EPS);
      if (clash) {
        say(STEP_GRID_TEXT.noteTaken(to, stepOf(notes[i].at, stepBeats)));
        return true;
      }
      notes[i].note = to;
    }
    send({ type: 'CLIP_UPDATE', clipId: opts.clipId,
      payload: { ...payload, notes: notes.sort(byAtNote) } });
    return true;
  }

  const KEYS = {
    ArrowLeft: () => move(0, -1), ArrowRight: () => move(0, 1),
    ArrowUp: () => move(-1, 0), ArrowDown: () => move(1, 0),
    'Shift+ArrowLeft': () => select(-1), 'Shift+ArrowRight': () => select(1),
    'Shift+ArrowUp': () => select(0), 'Shift+ArrowDown': () => select(0),
    Enter: () => {
      const ts = targets();
      send(setAll(ts, !on(ts[0].lane, ts[0].step)));
      return true;
    },
    'Mod+C': copy,
    'Mod+X': () => {
      copy();
      send(setAll(targets(), false));
      return true;
    },
    'Mod+V': paste,
    Delete: () => {
      send(setAll(targets(), false));
      return true;
    },
    PageUp: () => transpose(1), PageDown: () => transpose(-1),
    'Shift+PageUp': () => transpose(12), 'Shift+PageDown': () => transpose(-12),
    '[': () => {
      if (page > 0) onView({ page: page - 1 });
      return true;
    },
    ']': () => {
      if (page < pages() - 1) onView({ page: page + 1 });
      return true;
    },
    'Shift+F10': () => {
      onView({ menu: { ...focus } });
      return true;
    },
    ContextMenu: () => {
      onView({ menu: { ...focus } });
      return true;
    },
  };

  return {
    get focus() { return { ...focus }; },
    set(next = {}) {
      if (next.payload) payload = next.payload;
      if (next.values) values = [...next.values];
      if (next.lanes && !list) lanes = [...next.lanes];
      if (next.steps != null) steps = next.steps;
      if (list && next.values) steps = values.length;
      if (next.pageSteps) pageSteps = next.pageSteps;
      if (next.selection) selection = [...next.selection];
      if (next.page != null) page = clamp(next.page, 0, pages() - 1);
      if (next.disabled != null) disabled = !!next.disabled;
      grid = project();
      focus.lane = clamp(focus.lane, 0, lanes.length - 1);
      focus.step = clamp(focus.step, 0, steps - 1);
    },
    key(chord) {
      if (disabled || !Object.hasOwn(KEYS, chord)) return false;
      return KEYS[chord]();
    },
    down(lane, step, { shift = false } = {}) {
      if (disabled) return false;
      if (shift) {
        onView({ selection: [selection.length === 2 ? selection[0] : focus.step, step] });
        focus.lane = lane;
        focus.step = step;
        return true;
      }
      focus.lane = lane;
      focus.step = step;
      drag = { lane, from: step, to: step, state: !on(lane, step) };
      return true;
    },
    over(lane, step) {
      if (!drag || lane !== drag.lane) return false;
      drag.to = step;
      return true;
    },
    /** The painted range of the drag, for the view's preview (transient state). */
    get drag() { return drag && { ...drag }; },
    up() {
      if (!drag) return false;
      const { lane, from, to, state } = drag;
      drag = null;
      const [a, b] = [Math.min(from, to), Math.max(from, to)];
      const ts = Array.from({ length: b - a + 1 }, (_, i) => ({ lane, step: a + i }));
      return send(setAll(ts, state));
    },
    cancel() { drag = null; },
    valueAt(lane, step, fraction) {
      if (disabled) return false;
      const f = clamp(fraction, 0, 1);
      if (list) {
        const next = [...values];
        next[step] = param.min + f * (param.max - param.min);
        if (param.step) next[step] = Math.round(next[step] / param.step) * param.step;
        return send(listAction(next));
      }
      const vel = Math.max(0.01, Math.round(f * 100) / 100);
      return send(editOn([{ lane, step }], () => ({ vel })));
    },
    menu(item, arg) {
      if (disabled || list) return false;
      const t = { ...focus };
      if (!on(t.lane, t.step)) {
        say(STEP_GRID_TEXT.empty);
        return false;
      }
      const cell = grid.cells[t.lane][t.step];
      if (item === 'accent') {
        return send(editOn([t], () => ({ vel: cell.vel >= ACCENT_VEL ? STEP_VEL : 1 })));
      }
      if (item === 'ratchet') {
        if (!Number.isInteger(arg) || arg < RATCHET[0] || arg > RATCHET[1]) {
          say(STEP_GRID_TEXT.ratchet);
          return false;
        }
        return send(editOn([t], () => ({ r: arg })));
      }
      if (item === 'probability') {
        if (!(typeof arg === 'number' && arg > 0 && arg <= 1)) {
          say(STEP_GRID_TEXT.probability);
          return false;
        }
        return send(editOn([t], () => ({ p: arg })));
      }
      if (item === 'slide') return send(editOn([t], () => ({ slide: !cell.slide })));
      return false;
    },
    state() {
      return { cells: grid && grid.cells, offGrid: grid ? grid.offGrid : [], values,
        focus: { ...focus }, selection: [...selection], page, pages: pages(), steps, pageSteps,
        lanes: [...lanes] };
    },
  };
}

// V631 (P04 slice A): seeded edit sequences hold the Studio model invariants after every step.
//   node --test tests/unit/studio-model-invariants.test.mjs
//   OSC_STUDIO_SEED=0x1234abcd node --test tests/unit/studio-model-invariants.test.mjs
//
// Extends tests/unit/v31-studio-model.test.mjs, which proves the round trip, undo-all, the
// deletion cascade, refusal at every entry point and gesture coalescing on hand-written cases.
// Here one store (actions.js createStudioStore) is driven by SEQUENCES seeded sequences of
// STEPS steps (fixtures/studio-actions.mjs: mulberry32, every action the store accepts, valid
// and deliberately invalid, plus undo, redo and gestures), and after every step:
//   - no-dangling-edge     every edge names an existing node and a port of its direction;
//   - targets-exist        every lane, clip and track names an existing node, param and track;
//   - model-validates      validateStudioCommit (validateStudioModel and the import's rules);
//   - round-trip           serialize, importStudio, serialize again is byte-identical;
//   - selection-exists     the selection names only what the model holds;
//   - hash-tracks-execution  studioHash changes exactly when the execution state does, and
//                          never on a presentation or view action;
//   - refusal-changes-nothing  a refused action leaves model, history, selection and revision;
//   - invalid-refused      an action built invalid is refused (wrong type, missing port, stale
//                          node id, cycle, second Master Output, ...);
//   - no-silent-coercion   an accepted EDGE_ADD adds exactly the edge asked for;
//   - no-silent-feedback   an EDGE_ADD that closes a loop is refused for the loop, and no
//                          accepted EDGE_ADD removes an edge;
//   - revision / history   +1 per committed change, undo and redo; one entry per edit or gesture;
//   - undo-oracle          undo returns the model before the edit it undoes, redo the one after;
// and at the end undo-all returns the initial model and redo-all the final one (undo-all,
// redo-all; the view is not undoable and stays).
//
// Seed rule: the base seed is BASE_SEED unless OSC_STUDIO_SEED overrides it; sequence 0 runs the
// base seed itself and sequence i the seed sequenceSeed(base, i). The base seed is printed, and a
// violation prints its sequence's seed, the invariant, and the shortest failing prefix of the
// recorded steps; OSC_STUDIO_SEED=<that seed> reproduces it as sequence 0. A seed that found a
// defect stays in REGRESSION_SEEDS. Tolerances: none, every comparison is exact.

import test from 'node:test';
import assert from 'node:assert';

import { ACTION_TYPES, createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { STUDIO_HISTORY_LIMIT } from '../../src/js/studio/history.js';
import { importStudio } from '../../src/js/studio/migrate.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { collectIds, serializeStudio, studioHash } from '../../src/js/studio/schema.js';
import { validateStudioCommit } from '../../src/js/studio/validate.js';
import { canonicalJson } from '../../src/js/experiments/canonical-json.js';
import {
  GENERATED_TYPES, INITIAL_CHOICES, MUTANTS, createMemory, createRng, hex, initialModel,
  mutantStore, nextStep, remember, sequenceSeed,
} from './fixtures/studio-actions.mjs';

const R = NODE_REGISTRY;
const THIS_FILE = 'tests/unit/studio-model-invariants.test.mjs';
const BASE_SEED = 0x5eed0631;
/** At least 200; OSC_STUDIO_SEQUENCES may ask for more (exploration, never fewer). */
const SEQUENCES = Math.max(200, Math.floor(Number(process.env.OSC_STUDIO_SEQUENCES)) || 0);
const STEPS = 50;
/** Seeds that once found a defect; each runs before the seeded sequences. */
const REGRESSION_SEEDS = [];

const envSeed = process.env.OSC_STUDIO_SEED;
const base = envSeed ? Number(envSeed) >>> 0 : BASE_SEED;
if (envSeed && !Number.isFinite(Number(envSeed))) {
  throw new RangeError(`OSC_STUDIO_SEED must be a number (0x... or decimal), not "${envSeed}"`);
}
const seedOf = (i) => (i === 0 ? base : sequenceSeed(base, i));

/** Actions that change no execution state: the hash must not move. */
const PRESENTATION_TYPES = new Set(['NODE_MOVE', 'NODE_RENAME', 'MARKER_ADD', 'MARKER_REMOVE',
  'MARKER_MOVE', 'METADATA_SET', 'SELECTION_CHANGE', 'VIEW_SET']);
const VIEW_TYPES = new Set(['SELECTION_CHANGE', 'VIEW_SET']);
const CYCLE_CODES = new Set(['audio-feedback', 'control-cycle', 'analysis-cycle']);

// ---------------------------------------------------------------- per-model texts (cached)

const cache = new WeakMap();
const byId = (xs) => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * The execution state as §163 defines it, written here independently of schema.js
 * executionState: what sounds and measures (node types and parameters, edges, track kinds and
 * targets, clips, lanes, loop, transport), not positions, names, markers, metadata, view or the
 * order of identified records.
 */
function executionOf(m) {
  const t = m.timeline;
  return canonicalJson({
    schemaVersion: m.schemaVersion,
    nodes: byId(m.graph.nodes).map(({ id, type, params }) => ({ id, type, params })),
    edges: byId(m.graph.edges),
    tracks: byId(t.tracks).map(({ id, kind, target }) => ({ id, kind, target })),
    clips: byId(t.clips), automation: byId(t.automation), loop: t.loop, transport: m.transport,
  });
}

function texts(m) {
  let c = cache.get(m);
  if (!c) {
    c = { hash: studioHash(m), exec: executionOf(m), sem: canonicalJson({ ...m, view: null }) };
    cache.set(m, c);
  }
  return c;
}

// ---------------------------------------------------------------- invariants

const broken = (invariant, detail) => ({ invariant, detail });

function snapshot(store) {
  const d = store.debugInfo();
  return { model: store.getModel(), selection: store.getSelection(),
    revision: store.getRevision(), undo: d.undoDepth, redo: d.redoDepth,
    undoLabel: store.undoLabel(), redoLabel: store.redoLabel() };
}

/** What a refusal changed, or null. */
function changedBy(b, a) {
  for (const k of ['model', 'selection', 'revision', 'undo', 'redo', 'undoLabel', 'redoLabel']) {
    if (b[k] !== a[k]) return k;
  }
  return null;
}

/** The model-wide invariants, in the order a defect is best named by. */
function checkModel(m, selection) {
  const nodes = new Map(m.graph.nodes.map((n) => [n.id, n]));
  for (const e of m.graph.edges) {
    const a = nodes.get(e.from.node);
    const b = nodes.get(e.to.node);
    if (!a || !b) {
      return broken('no-dangling-edge', `${e.id} names missing node ${a ? e.to.node
        : e.from.node}`);
    }
    if (!R.port(a.type, e.from.port, 'out') || !R.port(b.type, e.to.port, 'in')) {
      return broken('no-dangling-edge', `${e.id} names a missing port ${e.from.port} -> `
        + `${e.to.port}`);
    }
  }
  const t = m.timeline;
  const tracks = new Set(t.tracks.map((x) => x.id));
  for (const l of t.automation) {
    const n = nodes.get(l.target.node);
    if (!n || !R.param(n.type, l.target.param)) {
      return broken('targets-exist', `lane ${l.id} targets ${l.target.node}.${l.target.param}`);
    }
  }
  for (const c of t.clips) {
    if (!tracks.has(c.trackId)) return broken('targets-exist', `clip ${c.id} on ${c.trackId}`);
    if (c.target != null && !nodes.has(c.target)) {
      return broken('targets-exist', `clip ${c.id} targets ${c.target}`);
    }
  }
  for (const x of t.tracks) {
    if (x.target != null && !nodes.has(x.target)) {
      return broken('targets-exist', `track ${x.id} targets ${x.target}`);
    }
  }
  const report = validateStudioCommit(m);
  if (!report.ok) return broken('model-validates', report.errors[0].message);
  const text = serializeStudio(m);
  const imported = importStudio(text);
  if (!imported.ok) return broken('round-trip', `import refused: ${imported.errors[0].message}`);
  if (serializeStudio(imported.model) !== text) {
    return broken('round-trip', 'serialize -> import -> serialize differs');
  }
  const live = collectIds(m);
  for (const [k, list] of Object.entries(selection)) {
    const gone = list.find((id) => !live.has(id));
    if (gone) return broken('selection-exists', `selection.${k} names ${gone}`);
  }
  return null;
}

function checkHash(type, before, after) {
  const b = texts(before);
  const a = texts(after);
  const hashMoved = b.hash !== a.hash;
  if (hashMoved !== (b.exec !== a.exec)) {
    return broken('hash-tracks-execution', `${type}: hash ${hashMoved ? 'changed' : 'kept'} `
      + `while the execution state ${b.exec !== a.exec ? 'changed' : 'did not'}`);
  }
  if (hashMoved && PRESENTATION_TYPES.has(type)) {
    return broken('hash-tracks-execution', `${type} is presentation only and moved the hash`);
  }
  return null;
}

const sameEdge = (e, a) => e.from.node === a.from.node && e.from.port === a.from.port
  && e.to.node === a.to.node && e.to.port === a.to.port;

/** One dispatch and the invariants of its result. `run` tracks history and statistics. */
function dispatchChecked(store, step, run, inGesture) {
  const b = snapshot(store);
  const action = step.action;
  const type = action && typeof action === 'object' && typeof action.type === 'string'
    ? action.type : '(no type)';
  let r;
  try {
    r = store.dispatch(action);
  } catch (err) {
    return broken('dispatch-throws', `${type}: ${err && err.message}`);
  }
  const a = snapshot(store);
  const tally = run.stats[type] || (run.stats[type] = { accepted: 0, unchanged: 0, refused: 0 });
  if (!r || typeof r.ok !== 'boolean') return broken('result-shape', `${type} returned ${r}`);
  if (!r.ok) {
    tally.refused++;
    if (step.why) run.refusedWhy.set(step.why, (run.refusedWhy.get(step.why) || 0) + 1);
    const what = changedBy(b, a);
    if (what) return broken('refusal-changes-nothing', `${type} was refused and changed ${what}`);
    if (typeof r.reason !== 'string' || !r.reason) {
      return broken('refusal-changes-nothing', `${type} was refused without a reason`);
    }
    if (step.why === 'cycle' && !(r.diagnostics || []).some((d) => CYCLE_CODES.has(d.code))) {
      return broken('no-silent-feedback', `a loop was refused without naming it: ${r.reason}`);
    }
    return null;
  }
  if (type === 'EDGE_ADD') {
    const had = new Set(b.model.graph.edges.map((e) => e.id));
    const has = new Set(a.model.graph.edges.map((e) => e.id));
    const removed = b.model.graph.edges.filter((e) => !has.has(e.id));
    const added = a.model.graph.edges.filter((e) => !had.has(e.id));
    if (step.why === 'cycle' || removed.length) {
      return broken('no-silent-feedback', `EDGE_ADD ${JSON.stringify(action.from)} -> `
        + `${JSON.stringify(action.to)} was accepted${removed.length ? ` and removed `
          + `${removed.map((e) => e.id).join(', ')}` : ' although it closes a loop'}`);
    }
    if (added.length !== 1 || !sameEdge(added[0], action)) {
      return broken('no-silent-coercion', `EDGE_ADD asked ${action.to.node}.${action.to.port} `
        + `and committed ${added.map((e) => `${e.to.node}.${e.to.port}`).join(', ') || 'none'}`);
    }
  }
  if (step.intent === 'invalid') {
    return broken('invalid-refused', `${type} built invalid (${step.why}) was accepted`);
  }
  if (VIEW_TYPES.has(type) || !r.changed) {
    if (r.changed !== false) return broken('revision', `${type} is view state yet changed`);
    if (VIEW_TYPES.has(type)) tally.accepted++;
    else tally.unchanged++;
    const what = changedBy({ ...b, model: null, selection: null },
      { ...a, model: null, selection: null });
    if (what) return broken('revision', `${type} changed ${what} without a change`);
    if (type !== 'VIEW_SET' && a.model !== b.model) {
      return broken('revision', `${type} reported no change but replaced the model`);
    }
  } else {
    tally.accepted++;
    if (a.revision !== b.revision + 1) {
      return broken('revision', `${type}: revision ${b.revision} -> ${a.revision}`);
    }
    if (inGesture) {
      run.gestureChanged = true;
      if (a.undo !== b.undo) return broken('history', `${type} inside a gesture added an entry`);
    } else {
      if (a.undo !== Math.min(b.undo + 1, STUDIO_HISTORY_LIMIT) || a.redo !== 0) {
        return broken('history', `${type}: undo ${b.undo} -> ${a.undo}, redo ${a.redo}`);
      }
      run.past.push(b.model);
      run.future = [];
    }
  }
  return checkHash(type, b.model, a.model);
}

function undoRedo(store, op, run) {
  const b = snapshot(store);
  const from = op === 'undo' ? run.past : run.future;
  const to = op === 'undo' ? run.future : run.past;
  const r = store[op]();
  const a = snapshot(store);
  if (!r.ok) {
    if (from.length) return broken('undo-oracle', `${op} refused with ${from.length} entries`);
    const what = changedBy(b, a);
    return what ? broken('refusal-changes-nothing', `a refused ${op} changed ${what}`) : null;
  }
  const expected = from.pop();
  if (!expected) return broken('undo-oracle', `${op} succeeded with nothing to ${op}`);
  to.push(b.model);
  if (texts(a.model).sem !== texts(expected).sem) {
    return broken('undo-oracle', `${op} did not return the model ${op === 'undo' ? 'before'
      : 'after'} its entry`);
  }
  if (canonicalJson(a.model.view) !== canonicalJson(b.model.view)) {
    return broken('undo-oracle', `${op} changed the view`);
  }
  if (a.revision !== b.revision + 1) {
    return broken('revision', `${op}: revision ${b.revision} -> ${a.revision}`);
  }
  return checkHash(op, b.model, a.model);
}

function gesture(store, step, run) {
  const b = snapshot(store);
  store.beginGesture(step.label);
  run.gestureChanged = false;
  for (const s of step.steps) {
    const v = dispatchChecked(store, s, run, true);
    if (v) return v;
  }
  if (step.end === 'cancel') {
    store.cancelGesture();
    const a = snapshot(store);
    if (texts(a.model).sem !== texts(b.model).sem) {
      return broken('undo-oracle', 'a cancelled gesture did not return to its start');
    }
    if (a.undo !== b.undo || a.redo !== b.redo) {
      return broken('history', `a cancelled gesture left undo ${a.undo}, redo ${a.redo}`);
    }
    return null;
  }
  store.endGesture();
  const a = snapshot(store);
  if (run.gestureChanged) {
    if (a.undo !== Math.min(b.undo + 1, STUDIO_HISTORY_LIMIT) || a.redo !== 0) {
      return broken('history', `a gesture left undo ${b.undo} -> ${a.undo}, redo ${a.redo}`);
    }
    run.past.push(b.model);
    run.future = [];
  } else if (a.undo !== b.undo) {
    return broken('history', 'a gesture without a change added an entry');
  }
  return null;
}

function applyStep(store, step, run) {
  let v;
  if (step.op === 'undo' || step.op === 'redo') v = undoRedo(store, step.op, run);
  else if (step.op === 'gesture') v = gesture(store, step, run);
  else v = dispatchChecked(store, step, run, false);
  return v || checkModel(store.getModel(), store.getSelection());
}

/** Undo all to the initial model, redo all to the final one. */
function checkEnd(store, run) {
  const final = store.getModel();
  let undone = 0;
  while (store.canUndo()) {
    if (!store.undo().ok) return broken('undo-all', `undo ${undone + 1} was refused`);
    undone++;
  }
  if (undone !== run.past.length) {
    return broken('undo-all', `${undone} undo entries for ${run.past.length} edits`);
  }
  const first = store.getModel();
  if (texts(first).sem !== texts(run.initial).sem) {
    return broken('undo-all', 'undo-all did not return the initial model');
  }
  if (canonicalJson(first.view) !== canonicalJson(final.view)) {
    return broken('undo-all', 'undo-all changed the view');
  }
  const v = checkModel(first, store.getSelection());
  if (v) return v;
  // Redo as many entries as were undone: a redo stack left by the sequence stays beyond them.
  for (let i = 0; i < undone; i++) {
    if (!store.redo().ok) return broken('redo-all', `redo ${i + 1} was refused`);
  }
  if (texts(store.getModel()).sem !== texts(final).sem) {
    return broken('redo-all', 'redo-all did not return the final model');
  }
  return checkModel(store.getModel(), store.getSelection());
}

// ---------------------------------------------------------------- sequences

/**
 * Run one sequence: generated from `seed`, or replayed from `replay` ({ initial, steps }).
 * Returns { ok, initial, log, at?, violation?, stats, refusedWhy }.
 */
function runSequence(seed, { steps = STEPS, mutant = null, replay = null, stats = {},
  refusedWhy = new Map() } = {}) {
  const rng = createRng(seed);
  const initial = replay ? replay.initial : rng.pick(INITIAL_CHOICES);
  const start = initialModel(initial);
  const real = createStudioStore(start, { idGenerator: createIdGenerator(start) });
  const store = mutant ? mutantStore(mutant, real) : real;
  const memory = createMemory();
  remember(memory, store.getModel());
  const run = { initial: store.getModel(), past: [], future: [], stats, refusedWhy,
    gestureChanged: false };
  const log = [];
  const n = replay ? replay.steps.length : steps;
  for (let i = 0; i < n; i++) {
    const step = replay ? replay.steps[i] : nextStep(store.getModel(), rng, memory);
    log.push(step);
    const violation = applyStep(store, step, run);
    if (violation) return { ok: false, initial, log, at: i, violation, stats, refusedWhy };
    remember(memory, store.getModel());
  }
  const violation = checkEnd(store, run);
  if (violation) return { ok: false, initial, log, at: n, violation, stats, refusedWhy };
  return { ok: true, initial, log, stats, refusedWhy };
}

/** The shortest prefix of a failing sequence's steps that still fails (a replay of each). */
function shortestFailingPrefix(seed, failed, mutant) {
  for (let k = 1; k <= failed.log.length; k++) {
    const r = runSequence(seed, { mutant, replay: { initial: failed.initial,
      steps: failed.log.slice(0, k) } });
    if (!r.ok) return r;
  }
  return failed;
}

const short = (v) => {
  const s = JSON.stringify(v);
  return s.length > 150 ? `${s.slice(0, 147)}...` : s;
};

function describeStep(step) {
  if (step.op === 'undo' || step.op === 'redo') return step.op;
  if (step.op === 'gesture') {
    return `gesture (${step.end}): ${step.steps.map((s) => short(s.action)).join(' ; ')}`;
  }
  return `${short(step.action)} [${step.intent}${step.why ? `: ${step.why}` : ''}]`;
}

/** The violation report: the invariant, the seed and the shortest failing prefix. */
function report(seed, failed, mutant = null) {
  const min = shortestFailingPrefix(seed, failed, mutant);
  const lines = min.log.map((s, i) => `  ${String(i + 1).padStart(2)}. ${describeStep(s)}`);
  return [
    `Studio model invariant "${min.violation.invariant}" broken ${min.at < min.log.length
      ? `at step ${min.at + 1}` : 'at the end (undo-all / redo-all)'} of seed ${hex(seed)}`
      + `${mutant ? ` (mutant ${mutant})` : ''}: ${min.violation.detail}`,
    `shortest failing prefix: ${min.log.length} of ${failed.log.length} steps, from `
      + `${min.initial == null ? 'an empty Studio' : `template ${min.initial}`}:`,
    ...lines,
    `reproduce: OSC_STUDIO_SEED=${hex(seed)} node --test ${THIS_FILE}`,
  ].join('\n');
}

// ---------------------------------------------------------------- tests

test('the generator builds every action the store accepts (ACTION_TYPES), and only those', () => {
  assert.deepStrictEqual([...GENERATED_TYPES].sort(), [...ACTION_TYPES].sort(),
    'a slice that adds a store action adds its maker to tests/unit/fixtures/studio-actions.mjs');
});

test('a seed determines its sequence (mulberry32): the same seed replays the same steps', () => {
  const a = runSequence(base);
  const b = runSequence(base);
  assert.strictEqual(JSON.stringify(a.log), JSON.stringify(b.log));
  assert.strictEqual(a.initial, b.initial);
  assert.notStrictEqual(JSON.stringify(runSequence(seedOf(1)).log), JSON.stringify(a.log));
  const replayed = runSequence(base, { replay: { initial: a.initial, steps: a.log } });
  assert.strictEqual(replayed.ok, a.ok);
});

test(`${SEQUENCES} seeded sequences of ${STEPS} steps hold the Studio model invariants after `
  + 'every step', (t) => {
  t.diagnostic(`base seed ${hex(base)}${envSeed ? ' (OSC_STUDIO_SEED)' : ''}; sequence i runs `
    + `sequenceSeed(${hex(base)}, i), sequence 0 the base seed`);
  const started = Date.now();
  const stats = {};
  const refusedWhy = new Map();
  const seeds = [...REGRESSION_SEEDS, ...Array.from({ length: SEQUENCES }, (_, i) => seedOf(i))];
  let steps = 0;
  for (const seed of seeds) {
    const r = runSequence(seed, { stats, refusedWhy });
    if (!r.ok) assert.fail(report(seed, r));
    steps += r.log.length;
  }
  assert.ok(steps >= SEQUENCES * STEPS);
  t.diagnostic(`${seeds.length} sequences, ${steps} steps in ${Date.now() - started} ms`);
  // Every action was both committed and refused somewhere in the run (a selection is never
  // refused: its unknown names are pruned, which selection-exists checks).
  for (const type of ACTION_TYPES) {
    const s = stats[type] || { accepted: 0, refused: 0 };
    assert.ok(s.accepted > 0, `${type} was never committed`);
    if (type !== 'SELECTION_CHANGE') assert.ok(s.refused > 0, `${type} was never refused`);
  }
  // The negative cases the issue names were each built and refused.
  for (const why of ['wrong-type', 'missing-port', 'stale-node', 'cycle', 'second-master',
    'no-type']) {
    assert.ok((refusedWhy.get(why) || 0) > 0, `no ${why} action was refused`);
  }
  t.diagnostic(`committed/unchanged/refused by type: ${Object.keys(stats).sort().map((k) =>
    `${k} ${stats[k].accepted}/${stats[k].unchanged}/${stats[k].refused}`).join(', ')}`);
  t.diagnostic(`refused by kind: ${[...refusedWhy].sort().map(([k, v]) => `${k} ${v}`)
    .join(', ')}`);
});

const EXPECTED = {
  'drop-cascade': 'no-dangling-edge',
  'coerce-edge': 'no-silent-coercion',
  'repair-cycle': 'no-silent-feedback',
};

for (const mutant of MUTANTS) {
  test(`mutation ${mutant}: the invariants fail with "${EXPECTED[mutant]}", and the report `
    + 'prints the seed and the shortest failing prefix', (t) => {
    let found = null;
    for (let i = 0; i < SEQUENCES && !found; i++) {
      const r = runSequence(seedOf(i), { mutant });
      if (!r.ok) found = { seed: seedOf(i), r };
    }
    assert.ok(found, `no sequence caught the ${mutant} mutant`);
    const text = report(found.seed, found.r, mutant);
    t.diagnostic(text.split('\n')[0]);
    assert.match(text, new RegExp(`^Studio model invariant "${EXPECTED[mutant]}"`));
    assert.ok(text.includes(`of seed ${hex(found.seed)}`), 'the seed is printed');
    assert.ok(text.includes(`OSC_STUDIO_SEED=${hex(found.seed)}`), 'and how to reproduce it');
    const k = Number(/shortest failing prefix: (\d+) of/.exec(text)[1]);
    const prefix = found.r.log.slice(0, k);
    assert.ok(k <= found.r.log.length);
    assert.strictEqual(text.split('\n').filter((l) => /^ +\d+\. /.test(l)).length, k);
    // Shortest: the prefix fails, one step less does not.
    const replay = (steps) => runSequence(found.seed, { mutant,
      replay: { initial: found.r.initial, steps } });
    assert.strictEqual(replay(prefix).ok, false);
    assert.strictEqual(replay(prefix.slice(0, -1)).ok, true);
    // The real store passes the same steps.
    assert.strictEqual(runSequence(found.seed, { replay: { initial: found.r.initial,
      steps: prefix } }).ok, true);
  });
}

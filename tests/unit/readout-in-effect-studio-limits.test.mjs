// T023 (truth-table row LAB-15): the Studio says when it plays a lower frequency than the one
// stored. The runtime keeps a frequency at or below 0.95 x Nyquist of the running context
// (project.audio-engine-discipline; compiler.js computeBases). Each parameter it lowers and each
// modulation edge it scales is a structured `frequency-limited` diagnostic (ADR 0039 shape:
// owner runtime, the node or edge as entity, details { param, unit, stored, played,
// safeMaximum, sampleRate }), returned from apply and kept in debugInfo().diagnostics; the
// Inspector field reads "30.00 kHz, plays 22.80 kHz" with a note, and the Runtime section no
// longer says the revision "plays as edited".
//   node --test tests/unit/readout-in-effect-studio-limits.test.mjs
// Wiring: the real AudioEngine over the fake AudioContext of sequencer-fake-audio.mjs, the
// runtime as the workspace builds it, the Inspector's pure view models. Namespace imports: each
// test fails on its own assertion on the code before this change.
// Tolerances: 1e-9 relative for the played values (computed from the same sample rate); text
// is exact.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { formatFrequency } from '../../src/js/core/frequency.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import * as runtimeMod from '../../src/js/studio/runtime.js';
import * as inspector from '../../src/js/ui/studio/inspector.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const CODE = 'frequency-limited';
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
/** The value an AudioParam was last scheduled to (the fake records, it does not render). */
const target = (param) => (param.events.length ? param.events[param.events.length - 1].value
  : param.value);

function ok(r) {
  assert.ok(r && r.ok, (r && (r.reason || JSON.stringify(r.errors))) || 'no result');
  return r;
}

/** An Oscillator into Master Output on a running runtime at `sampleRate`. */
function rig(sampleRate, params = {}, lfo = null) {
  const fx = createFakeAudioEnv({ sampleRate });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = runtimeMod.createStudioRuntime({ engine });
  const store = createStudioStore(null, { idGenerator: createIdGenerator(null) });
  const add = (nodeType, extra = {}) => ok(store.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y: 0 }, ...extra })).created.nodes[0];
  const connect = (from, fromPort, to, toPort, props) => ok(store.dispatch({ type: 'EDGE_ADD',
    from: { node: from, port: fromPort }, to: { node: to, port: toPort }, props }))
    .created.edges[0];
  const osc = add('oscillator', { params });
  const master = add('master');
  connect(osc, 'audio', master, 'audio');
  let edge = null;
  if (lfo) edge = connect(add('lfo'), 'control', osc, lfo.port, lfo.props);
  const s = { fx, engine, runtime, store, osc, edge,
    safe: (sampleRate / 2) * 0.95,
    apply() { return ok(runtime.apply(store.getModel(), { revision: store.getRevision() })); },
    set(key, value) {
      ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: osc, key, value }));
      return this.apply();
    },
  };
  s.apply();
  s.started = ok(runtime.start());
  return s;
}

/** What the workspace passes the Inspector (workspace.js svc.truth), without a transport. */
const truthOf = (s) => ({
  verdict: runtimeMod.studioDivergence({ model: s.store.getModel(),
    revision: s.store.getRevision() }, s.runtime),
  runtime: s.runtime.debugInfo(),
  transport: null,
});

const limits = (list) => (list || []).filter((d) => d && d.code === CODE);
const fieldOf = (s, key) => inspector.inspectorView(s.store.getModel(), { nodes: [s.osc] },
  { truth: truthOf(s) }).fields.find((f) => f.key === key);

test('T023: an Oscillator stored at 30 kHz says it plays 0.95 x Nyquist, at 44.1 and 48 kHz',
  () => {
    for (const sr of [44100, 48000]) {
      const s = rig(sr, { frequency: 1000 });
      const r = s.set('frequency', 30000);
      // Returned from apply ...
      const got = limits(r.warnings);
      assert.equal(got.length, 1, `${sr}: from apply: ${JSON.stringify(r.warnings)}`);
      const d = got[0];
      assert.equal(d.owner, 'runtime');
      assert.equal(d.severity, 'warning');
      assert.deepEqual(d.entity, { kind: 'node', id: s.osc });
      assert.equal(d.details.param, 'frequency');
      assert.equal(d.details.unit, 'Hz');
      assert.equal(d.details.stored, 30000);
      assert.equal(d.details.sampleRate, sr);
      assert.ok(close(d.details.safeMaximum, (sr / 2) * 0.95), `${sr}: safeMaximum`);
      assert.ok(close(d.details.played, (sr / 2) * 0.95), `${sr}: played ${d.details.played}`);
      assert.match(d.message, /30\.00 kHz/);
      assert.ok(d.message.includes(formatFrequency(s.safe)), d.message);
      assert.match(d.message, /0\.95 × Nyquist/);
      // ... and kept in debugInfo().diagnostics while it is in effect
      const dbg = s.runtime.debugInfo();
      assert.deepEqual(limits(dbg.diagnostics).map((x) => x.details), [d.details]);
      assert.ok(dbg.warnings.includes(d.message));
      // the limitedParams record is unchanged in shape
      assert.deepEqual(dbg.limitedParams, [{ node: s.osc, param: 'frequency' }]);
      // the audio value is the one the clamp always gave
      const o = s.runtime.nodes.get(s.osc).info.oscillator;
      assert.ok(close(target(o.frequency), s.safe), `${sr}: AudioParam ${target(o.frequency)}`);

      // The Runtime section: no "plays as edited", a diagnostic naming the node.
      const rv = inspector.runtimeView(s.store.getModel(), truthOf(s));
      assert.equal(rv.state, 'in-sync');
      assert.ok(!rv.text.includes('plays as edited'), rv.text);
      assert.match(rv.text,
        /plays with 1 value lowered to keep frequencies at or below 0\.95 × Nyquist/);
      const named = rv.diagnostics.filter((x) => x.code === CODE);
      assert.equal(named.length, 1);
      assert.equal(named[0].entity.kind, 'node');
      assert.equal(named[0].entity.id, s.osc);
      assert.equal(named[0].entity.label, 'Oscillator 1');
      assert.deepEqual(named[0].entity.selection, { nodes: [s.osc] });

      // The Inspector field reads the stored value and what plays, with a note.
      const f = fieldOf(s, 'frequency');
      const played = formatFrequency(s.safe);
      assert.equal(f.readout, `30.00 kHz, plays ${played}`);
      assert.equal(f.valueText, `30.00 kHz, plays ${played}`);
      assert.ok(f.limitNote && f.limitNote.startsWith(`Plays ${played}:`), f.limitNote);
      assert.match(f.limitNote, /0\.95 × Nyquist/);
      if (sr === 48000) assert.equal(f.readout, '30.00 kHz, plays 22.80 kHz');
      // the rebuild key changes with the note, so a mounted Inspector shows it
      const view = inspector.inspectorView(s.store.getModel(), { nodes: [s.osc] },
        { truth: truthOf(s) });
      s.set('frequency', 1000);
      const plain = inspector.inspectorView(s.store.getModel(), { nodes: [s.osc] },
        { truth: truthOf(s) });
      assert.notEqual(inspector.inspectorRebuildKey(view), inspector.inspectorRebuildKey(plain));
    }
  });

test('T023: no diagnostic below or exactly at the safe maximum, or once stopped', async () => {
  for (const sr of [44100, 48000]) {
    const s = rig(sr, { frequency: 1000 });
    assert.deepEqual(limits(s.started.warnings), [], `${sr}: 1 kHz at start`);
    assert.deepEqual(limits(s.runtime.debugInfo().diagnostics), []);
    const rv = inspector.runtimeView(s.store.getModel(), truthOf(s));
    assert.equal(rv.text, `Revision ${rv.applied.revision} plays as edited.`);
    assert.equal(fieldOf(s, 'frequency').readout, '1.00 kHz');
    assert.equal(fieldOf(s, 'frequency').limitNote, null);
    // exactly at the safe maximum: nothing is lowered
    const at = s.set('frequency', s.safe);
    assert.deepEqual(limits(at.warnings), [], `${sr}: at safeMaximum`);
    assert.deepEqual(limits(s.runtime.debugInfo().diagnostics), []);
    assert.equal(fieldOf(s, 'frequency').readout, formatFrequency(s.safe));
    // above it, then stopped: nothing plays, nothing is claimed
    assert.equal(limits(s.set('frequency', 30000).warnings).length, 1);
    const stopped = s.runtime.stop({ fast: true });
    s.fx.advance(1);
    await stopped;
    assert.deepEqual(limits(s.runtime.debugInfo().diagnostics), []);
    assert.equal(fieldOf(s, 'frequency').readout, '30.00 kHz');
  }
});

test('T023: a limited LFO edge is a diagnostic naming the edge', () => {
  const s = rig(48000, { frequency: 12000 },
    { port: 'frequency', props: { depth: 20000 } });
  const got = limits(s.started.warnings);
  assert.equal(got.length, 1, JSON.stringify(s.started.warnings));
  const d = got[0];
  assert.deepEqual(d.entity, { kind: 'edge', id: s.edge });
  assert.equal(d.details.node, s.osc);
  assert.equal(d.details.param, 'frequency');
  assert.equal(d.details.stored, 20000);
  assert.ok(d.details.scale > 0 && d.details.scale < 1, `scale ${d.details.scale}`);
  assert.ok(close(d.details.played, 20000 * d.details.scale));
  // the scaled depth is what the edge gain carries: 12 kHz + played = 22.8 kHz
  assert.ok(close(12000 + d.details.played, 22800), `played ${d.details.played}`);
  assert.ok(s.runtime.debugInfo().limitedEdges.includes(s.edge));
  assert.deepEqual(limits(s.runtime.debugInfo().diagnostics).map((x) => x.entity),
    [{ kind: 'edge', id: s.edge }]);
  const rv = inspector.runtimeView(s.store.getModel(), truthOf(s));
  assert.ok(!rv.text.includes('plays as edited'), rv.text);
  const named = rv.diagnostics.filter((x) => x.code === CODE);
  assert.equal(named.length, 1);
  assert.equal(named[0].entity.kind, 'edge');
  assert.deepEqual(named[0].entity.selection, { edges: [s.edge] });
  // the edge's own view lists it on its status line
  const ev = inspector.inspectorView(s.store.getModel(), { edges: [s.edge] },
    { truth: truthOf(s) });
  assert.ok(ev.statusText.includes(`(${CODE})`), ev.statusText);
  // the frequency field itself is not lowered (the edge is), so it reads as stored
  assert.equal(fieldOf(s, 'frequency').readout, '12.00 kHz');
});

test('T023: a static detune lowered into the headroom says what it plays', () => {
  const s = rig(48000, { frequency: 12000, detune: 1200 });
  const got = limits(s.started.warnings);
  assert.equal(got.length, 1, JSON.stringify(s.started.warnings));
  const d = got[0];
  assert.deepEqual(d.entity, { kind: 'node', id: s.osc });
  assert.equal(d.details.param, 'detune');
  assert.equal(d.details.unit, 'cents');
  assert.equal(d.details.stored, 1200);
  const room = 1200 * Math.log2(22800 / 12000);
  assert.ok(close(d.details.played, room), `played ${d.details.played}`);
  // the audio value is the one the clamp always gave
  const o = s.runtime.nodes.get(s.osc).info.oscillator;
  assert.ok(close(target(o.detune), room), `detune AudioParam ${target(o.detune)}`);
  const f = fieldOf(s, 'detune');
  assert.equal(f.readout, '1200 cents, plays 1111 cents');
  assert.ok(f.limitNote && f.limitNote.startsWith('Plays 1111 cents:'), f.limitNote);
  assert.equal(fieldOf(s, 'frequency').readout, '12.00 kHz');
});

// Review of #342 (P2): a cable's constant part (an offset, a unipolar centre) is part of the
// base the clamp lowers. 20 kHz plus a +5 kHz offset plays 22.8 kHz, the AudioParam value; the
// readout must not say 17.8 kHz (stored minus the amount lowered), which nothing plays. And the
// Runtime section counts values, not frequencies: a clamped base and its cable are 2 values.
test('T023 review: a cable offset is included in what plays, and the count is of values', () => {
  const s = rig(48000, { frequency: 20000 },
    { port: 'frequency', props: { depth: 100, offset: 5000 } });
  const o = s.runtime.nodes.get(s.osc).info.oscillator;
  assert.ok(close(target(o.frequency), 22800), `AudioParam ${target(o.frequency)}`);
  const node = limits(s.runtime.debugInfo().diagnostics).find((d) => d.entity.kind === 'node');
  assert.ok(node, 'the clamped base is a diagnostic');
  assert.equal(node.details.stored, 20000);
  assert.ok(close(node.details.offset, 5000), `offset ${node.details.offset}`);
  assert.ok(close(node.details.played, target(o.frequency)), `played ${node.details.played}`);
  assert.match(node.message,
    /is 20\.00 kHz, 25\.00 kHz with its cables' constant offset, but plays 22\.80 kHz/);
  const f = fieldOf(s, 'frequency');
  // Review R2 of the second round: the asked sum stands beside the stored value, so that a cap
  // below it does not read as a raise of 20 kHz.
  assert.equal(f.readout, '20.00 kHz (25.00 kHz with cables), plays 22.80 kHz');
  assert.ok(f.limitNote.startsWith('Plays 22.80 kHz, its cables\' constant 5.00 kHz included:'),
    f.limitNote);
  const rv = inspector.runtimeView(s.store.getModel(), truthOf(s));
  assert.match(rv.text, /plays with 2 values lowered to keep frequencies at or below/);
});

// Review of #342 (P2): a base an automation lane owns plays its lane, so neither the runtime
// nor the field claims its static value is lowered; a field whose stored value changed since
// the running graph was built reads the stored value, not a stale played one.
test('T023 review: a lane-owned base and a not-yet-applied edit claim no lowered value', () => {
  const s = rig(48000, { frequency: 1000 });
  ok(s.store.dispatch({ type: 'AUTOMATION_POINT_ADD',
    target: { node: s.osc, param: 'frequency' }, time: 0, value: 440, curve: 'step' }));
  s.runtime.setOwnedParams([{ node: s.osc, param: 'frequency' }]);
  const r = s.set('frequency', 30000);
  assert.deepEqual(s.runtime.debugInfo().limitedParams, [{ node: s.osc, param: 'frequency' }],
    'the static base is still clamped inside the runtime');
  assert.deepEqual(limits(r.warnings), [], JSON.stringify(r.warnings));
  assert.deepEqual(limits(s.runtime.debugInfo().diagnostics), []);
  const f = fieldOf(s, 'frequency');
  assert.equal(f.readout, 'Base 30.00 kHz');
  assert.equal(f.limitNote, null);

  const b = rig(48000, { frequency: 30000 });
  assert.equal(fieldOf(b, 'frequency').readout, '30.00 kHz, plays 22.80 kHz');
  ok(b.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: b.osc, key: 'frequency', value: 1000 }));
  assert.equal(truthOf(b).verdict.state, 'behind');
  const g = fieldOf(b, 'frequency');
  assert.equal(g.readout, '1.00 kHz');
  assert.equal(g.limitNote, null);
});

// ---------------------------------------------------------------- review of #342, round 2

/**
 * Oscillator -> Master, Random 1 into its frequency, LFO 1 into Random 1's Rate (`props`).
 * Random's Rate keeps the 100 Hz range; the LFO's reaches audio rate since K010 (its cap is
 * 0.95 x Nyquist), so the rate held by its own range is a Random's here.
 */
function rateRig(sampleRate, rate, props) {
  const fx = createFakeAudioEnv({ sampleRate });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = runtimeMod.createStudioRuntime({ engine });
  const store = createStudioStore(null, { idGenerator: createIdGenerator(null) });
  const add = (nodeType, extra = {}) => ok(store.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y: 0 }, ...extra })).created.nodes[0];
  const connect = (from, fromPort, to, toPort, p) => ok(store.dispatch({ type: 'EDGE_ADD',
    from: { node: from, port: fromPort }, to: { node: to, port: toPort }, props: p }))
    .created.edges[0];
  const osc = add('oscillator', { params: { frequency: 440 } });
  const master = add('master');
  connect(osc, 'audio', master, 'audio');
  const rnd = add('random', { params: { rate } });
  connect(rnd, 'control', osc, 'frequency', { depth: 10 });
  const lfo = add('lfo', { params: { rate: 1 } });
  const edge = connect(lfo, 'control', rnd, 'rate', props);
  const s = { fx, engine, runtime, store, osc: rnd, rnd, lfo, edge };
  ok(runtime.apply(store.getModel(), { revision: store.getRevision() }));
  s.started = ok(runtime.start());
  return s;
}

// R1 (P1): a Random's Rate is capped by its own range (100 Hz), not by 0.95 x Nyquist; the
// reason, the bound and the parameter named must say so.
test('T023 review R1: a Rate capped by its range names the range, not 0.95 x Nyquist', () => {
  const s = rateRig(48000, 80, { depth: 1, offset: 50 });
  const got = limits(s.runtime.debugInfo().diagnostics).filter((d) => d.entity.kind === 'node');
  assert.equal(got.length, 1, JSON.stringify(s.runtime.debugInfo().diagnostics));
  const d = got[0];
  assert.deepEqual(d.entity, { kind: 'node', id: s.rnd });
  assert.equal(d.message, 'Random 1 Rate is 80 Hz, 130 Hz with its cables\' constant offset, '
    + 'but plays 100 Hz: the Studio keeps Random 1 Rate at or below 100 Hz, the top of its '
    + 'range.');
  assert.equal(d.details.param, 'rate');
  assert.equal(d.details.target, 'rate');
  assert.equal(d.details.bound, 'range');
  assert.equal(d.details.cap, 100);
  assert.ok(close(d.details.played, 100), `played ${d.details.played}`);
  const f = inspector.inspectorView(s.store.getModel(), { nodes: [s.rnd] },
    { truth: truthOf(s) }).fields.find((x) => x.key === 'rate');
  assert.equal(f.readout, '80 Hz (130 Hz with cables), plays 100 Hz');
  assert.equal(f.limitNote, 'Plays 100 Hz, its cables\' constant 50 Hz included: the Studio '
    + 'keeps this rate at or below 100 Hz, the top of its range.');
  const rv = inspector.runtimeView(s.store.getModel(), truthOf(s));
  assert.ok(!/Nyquist/.test(rv.text), rv.text);
  assert.match(rv.text, /lowered to keep them within their parameters' ranges; see/);
});

test('T023 review R1: a cable into a Rate names the Rate and its range', () => {
  const s = rateRig(48000, 50, { depth: 80 });
  const got = limits(s.started.warnings);
  assert.equal(got.length, 1, JSON.stringify(s.started.warnings));
  const d = got[0];
  assert.deepEqual(d.entity, { kind: 'edge', id: s.edge });
  assert.equal(d.message, 'The cable LFO 1 → Random 1 Rate plays 63% of its depth (50 Hz of '
    + '80 Hz): the Studio keeps Random 1 Rate at or below 100 Hz, the top of its range.');
  assert.equal(d.details.param, 'rate');
  assert.equal(d.details.target, 'rate');
  assert.equal(d.details.bound, 'range');
  assert.ok(close(d.details.scale, 50 / 80), `scale ${d.details.scale}`);
  // the frequency case keeps its Nyquist reason, and names the frequency
  const o = rig(48000, { frequency: 12000 }, { port: 'frequency', props: { depth: 20000 } });
  const e = limits(o.started.warnings)[0];
  assert.equal(e.details.bound, 'nyquist');
  assert.ok(e.message.endsWith(': the Studio keeps Oscillator 1 Frequency at or below '
    + '22.80 kHz, 0.95 × Nyquist at 48 kHz.'), e.message);
  const both = inspector.runtimeView(o.store.getModel(), truthOf(o));
  assert.match(both.text, /lowered to keep frequencies at or below 0\.95 × Nyquist; see/);
});

// R2 (P2): "plays" is what sounds, the AudioParam base shifted by the log cables' constant
// cents: 30 kHz with a -1 octave log offset sounds at 11.4 kHz (22.8 kHz, then down an octave).
test('T023 review R2: what plays includes a log offset, below and above the stored value', () => {
  const s = rig(48000, { frequency: 30000 },
    { port: 'frequency', props: { depth: 0.1, mapping: 'log', offset: -1 } });
  const o = s.runtime.nodes.get(s.osc).info.oscillator;
  const sounding = target(o.frequency) * 2 ** (target(o.detune) / 1200);
  assert.ok(close(sounding, 11400), `sounding ${sounding}`);
  const d = limits(s.runtime.debugInfo().diagnostics).find((x) => x.entity.kind === 'node');
  assert.ok(d, 'the clamped base is a diagnostic');
  assert.ok(close(d.details.played, sounding), `played ${d.details.played}`);
  assert.ok(close(d.details.asked, 15000), `asked ${d.details.asked}`);
  assert.ok(close(d.details.base, 22800), `base ${d.details.base}`);
  assert.ok(close(d.details.cents, -1200), `cents ${d.details.cents}`);
  assert.equal(d.message, 'Oscillator 1 Frequency is 30.00 kHz, 15.00 kHz with its cables\' '
    + 'constant offset, but plays 11.40 kHz: the Studio keeps Oscillator 1 Frequency at or '
    + 'below 22.80 kHz, 0.95 × Nyquist at 48 kHz. Its log cables\' constant -1 octave applies '
    + 'after that.');
  const f = fieldOf(s, 'frequency');
  assert.equal(f.readout, '30.00 kHz (15.00 kHz with cables), plays 11.40 kHz');
  assert.match(f.limitNote, /^Plays 11\.40 kHz, its cables' constant -1 octave included: /);
  assert.match(f.limitNote, /The log cables' offset applies after that\.$/);

  // above: 20 kHz and a +1 octave log offset ask 40 kHz and sound at the cap, 22.8 kHz
  const u = rig(48000, { frequency: 20000 },
    { port: 'frequency', props: { depth: 0, mapping: 'log', offset: 1 } });
  const ou = u.runtime.nodes.get(u.osc).info.oscillator;
  const up = target(ou.frequency) * 2 ** (target(ou.detune) / 1200);
  assert.ok(close(up, 22800), `sounding ${up}`);
  const n = limits(u.runtime.debugInfo().diagnostics).find((x) => x.entity.kind === 'node');
  assert.ok(n, 'a base its log offset lowers is a diagnostic');
  assert.ok(close(n.details.played, 22800), `played ${n.details.played}`);
  assert.ok(close(n.details.asked, 40000), `asked ${n.details.asked}`);
  assert.ok(n.message.startsWith('Oscillator 1 Frequency is 20.00 kHz, 40.00 kHz with its '
    + 'cables\' constant offset, but plays 22.80 kHz: '), n.message);
  assert.equal(fieldOf(u, 'frequency').readout,
    '20.00 kHz (40.00 kHz with cables), plays 22.80 kHz');
});

// R3 (P3): the text names the node and the cable's source as they are now.
test('T023 review R3: a rename while playing renames the diagnostics', () => {
  const s = rig(48000, { frequency: 12000 }, { port: 'frequency', props: { depth: 20000 } });
  ok(s.store.dispatch({ type: 'NODE_RENAME', nodeId: s.osc, name: 'Lead' }));
  s.apply();
  const lfo = s.store.getModel().graph.edges.find((e) => e.id === s.edge).from.node;
  ok(s.store.dispatch({ type: 'NODE_RENAME', nodeId: lfo, name: 'Wobble' }));
  s.apply();
  const d = limits(s.runtime.debugInfo().diagnostics)[0];
  assert.match(d.message, /^The cable Wobble → Lead Frequency plays /);
  assert.match(d.message, /keeps Lead Frequency at or below/);
});

// R4 (P3): a negative offset reads in kHz, and a log offset lowered alone records its amount.
test('T023 review R4: a negative offset in kHz, a lowered log offset with its amount', () => {
  const s = rig(48000, { frequency: 30000 },
    { port: 'frequency', props: { depth: 100, offset: -5000 } });
  const f = fieldOf(s, 'frequency');
  assert.ok(f.limitNote.startsWith('Plays 22.80 kHz, its cables\' constant -5.00 kHz included:'),
    f.limitNote);
  assert.equal(f.readout, '30.00 kHz (25.00 kHz with cables), plays 22.80 kHz');

  const u = rig(48000, { frequency: 20000 },
    { port: 'frequency', props: { depth: 0, mapping: 'log', offset: 1 } });
  const e = limits(u.runtime.debugInfo().diagnostics).find((x) => x.entity.kind === 'edge');
  assert.ok(e, 'the edge whose constant offset was lowered is a diagnostic');
  assert.equal(e.details.mapping, 'log');
  assert.ok(close(e.details.offsetStored, 1), `offsetStored ${e.details.offsetStored}`);
  const room = Math.log2(22800 / 20000);
  assert.ok(close(e.details.offsetPlayed, room), `offsetPlayed ${e.details.offsetPlayed}`);
  assert.equal(e.message, 'The cable LFO 1 → Oscillator 1 Frequency plays a lower constant '
    + 'offset (the log cables into Frequency add 0.189 octaves of 1 octave): the Studio keeps '
    + 'Oscillator 1 Frequency at or below 22.80 kHz, 0.95 × Nyquist at 48 kHz.');
});

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
      assert.match(rv.text, /1 frequency lowered/);
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

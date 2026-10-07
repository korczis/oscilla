// R7 (docs/v4/completion-ledger.md, P2): the clip-target policy (which node, or node parameter,
// a timeline clip or automation lane may target, and how it plays there) is one pure function,
// studio/clip-targets.js `clipTarget`. Before it, the answer was decided in three places that
// disagreed:
//   store / registry  timeline.js clipRules and canHostClip (def.clipKinds, MEASUREMENT_TARGETS),
//                     validate.js and actions.js lanes (param.automatable)
//   timeline UI       timeline-view.js trackTargetOptions / clipTargetOptions / addClipAction
//                     (def.clipKinds), automation-view.js automatableTargets, automation.js
//                     automateParameter and the Inspector's Automate button (param.automatable)
//   transport         transport.js clipPlayReason (PATTERN_TARGETS, Envelope gates) and paramFor
//                     (the adapter's modTarget)
// The disagreements this test found on main at 3a9f762 (each is an assertion below):
//   1. the UI offered Oscillator, Noise and Sweep as event-clip and event-track targets, and
//      "add clip" on a track targeting Noise or Sweep created a gate event, but the transport
//      plays event clips only as gates on an Envelope: those clips never sounded;
//   2. the UI offered every measurement-capable node for any measurement action (Sweep as a
//      capture target), which the store then refused;
//   3. the UI offered Automate on Stereo Split pan/level and on low-/high-pass Q; the store kept
//      the lane and the transport never played it (no AudioParam carries a stereo pan law; a
//      low-/high-pass Q AudioParam is in dB);
//   4. (lesser) "add clip" on a track targeting a node that plays no clip (an LFO, a Gain)
//      proposed an event clip that the store then refused with its own sentence.
// The store still HOLDS what it held (a saved file keeps loading); the UI offers exactly what
// the transport PLAYS; the transport plays nothing the store refuses; and all three report the
// policy's own verdict and reason.
//   node --test tests/unit/v4-clip-target-policy.test.mjs
// Wiring: the real AudioEngine over the fake AudioContext of sequencer-fake-audio.mjs for the
// lanes (the transport's verdict; the adapter's modTarget must agree with it). Namespace imports: each test
// fails on its own assertion, not on a missing export.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { FILTER_TYPES } from '../../src/js/audio/filters.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import * as automation from '../../src/js/studio/automation.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { MEASUREMENT_ACTIONS, TRACK_CLIP_KINDS } from '../../src/js/studio/schema.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import * as transportModule from '../../src/js/studio/transport.js';
import * as automationView from '../../src/js/ui/studio/automation-view.js';
import * as inspector from '../../src/js/ui/studio/inspector.js';
import * as timelineView from '../../src/js/ui/studio/timeline-view.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

// Loaded this way so that the test fails on its own assertions while the module is missing.
const policyModule = await import('../../src/js/studio/clip-targets.js').catch(() => ({}));

const SR = 48000;
/** Every clip use: kind × action (pattern clips have no action). */
const CLIP_USES = [{ kind: 'pattern' }, { kind: 'event', action: 'gate' },
  { kind: 'event', action: 'trigger' },
  ...MEASUREMENT_ACTIONS.map((action) => ({ kind: 'measurement', action }))];
const DURATION = { pattern: 0.5, event: 0.5, 'noise-check': 1, 'pre-roll': 0.5, stimulus: 2,
  capture: 2, tail: 0.5, analysis: 1 };
const policyOf = () => policyModule.clipTarget;

const storeOf = (m) => createStudioStore(m, { idGenerator: createIdGenerator(m) });
const tag = (type, use) => `${type} ${use.kind}${use.action ? `/${use.action}` : ''}`;

/** The reference template plus one node of `type` (or its existing one): { model, id }. */
function withNode(type, params = null) {
  const base = templateModel(REFERENCE_TEMPLATE_ID);
  const store = storeOf(base);
  let id = base.graph.nodes.find((n) => n.type === type)?.id;
  if (!id) {
    const r = store.dispatch({ type: 'NODE_ADD', nodeType: type, position: { x: 0, y: 0 } });
    assert.ok(r.ok, `add ${type}: ${r.reason}`);
    id = r.created.nodes[0];
  }
  if (params) {
    const r = store.dispatch({ type: 'NODE_PARAM_SET', nodeId: id, params });
    assert.ok(r.ok, `params ${type}: ${r.reason}`);
  }
  return { model: store.getModel(), id };
}

/** The store's verdict on a clip of `use` targeting node `id`: { holds, model, clip }. */
function storeClip(model, id, use) {
  const store = storeOf(model);
  const track = store.dispatch({ type: 'TRACK_ADD',
    kind: use.kind === 'measurement' ? 'measurement' : 'event' });
  assert.ok(track.ok, track.reason);
  const payload = use.kind === 'pattern' ? { blockType: 'tone' } : { action: use.action };
  const duration = DURATION[use.kind === 'measurement' ? use.action : use.kind];
  const r = store.dispatch({ type: 'CLIP_ADD', trackId: track.created.tracks[0], kind: use.kind,
    start: 0, duration, payload, target: id });
  if (!r.ok) return { holds: false, reason: r.reason };
  const m = store.getModel();
  return { holds: true, model: m, clip: m.timeline.clips.find((c) => c.id === r.created.clips[0]) };
}

function audio() {
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  return { fx, engine, runtime: createStudioRuntime({ engine }) };
}

/** The transport's verdict on a lane: PLAY, then is the lane listed unplayed? */
function transportLane(model, id, key) {
  const store = storeOf(model);
  const r = store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: id, param: key },
    time: 0, value: model.graph.nodes.find((n) => n.id === id).params[key], curve: 'step' });
  if (!r.ok) return { holds: false, plays: false };
  const lane = store.getModel().timeline.automation.find((l) => l.target.node === id
    && l.target.param === key);
  const a = audio();
  const transport = transportModule.createStudioTransport({ runtime: a.runtime, engine: a.engine,
    store });
  const started = transport.start();
  assert.ok(started.ok, `PLAY with a ${key} lane: ${JSON.stringify(started)}`);
  const un = transport.debugInfo().unplayed.find((u) => u.id === lane.id);
  // What the node's adapter offers a linear owner (adapters/nodes.js modTarget).
  const h = a.runtime.nodes.get(id);
  let t = null;
  try { t = h ? h.modTarget(key, 'linear') : null; } catch (e) { t = null; }
  transport.stop({ fast: true });
  return { holds: true, plays: !un, code: un ? un.code : null, reason: un ? un.reason : null,
    adapter: !!(t && t.param) };
}

/** Every node type with its parameter variants that change the verdict (filter type). */
function nodeCases() {
  const out = [];
  for (const def of NODE_REGISTRY.list()) {
    if (def.type === 'filter') {
      for (const t of FILTER_TYPES) out.push({ def, params: { type: t }, label: `filter(${t})` });
    } else out.push({ def, params: null, label: def.type });
  }
  return out;
}

// ---------------------------------------------------------------- clips

test('R7 clips: the timeline UI offers a target exactly where the transport plays the clip',
  () => {
    const wrong = [];
    for (const def of NODE_REGISTRY.list()) {
      const { model, id } = withNode(def.type);
      for (const use of CLIP_USES) {
        const s = storeClip(model, id, use);
        const plays = s.holds && transportModule.clipPlayReason(s.model, s.clip) === null;
        const offered = timelineView.clipTargetOptions(model, use.kind, NODE_REGISTRY,
          use.action).some((n) => n.id === id);
        if (offered !== plays) {
          wrong.push(`${tag(def.type, use)}: UI ${offered ? 'offers' : 'hides'} it, store `
            + `${s.holds ? 'holds' : 'refuses'} it, transport ${plays ? 'plays' : 'does not play'}`
            + ' it');
        }
      }
    }
    assert.deepEqual(wrong, []);
  });

test('R7 clips: a track target is offered only when a clip of that track kind plays on it',
  () => {
    const wrong = [];
    for (const def of NODE_REGISTRY.list()) {
      const { model, id } = withNode(def.type);
      for (const [trackKind, kinds] of Object.entries(TRACK_CLIP_KINDS)) {
        const plays = CLIP_USES.filter((u) => kinds.includes(u.kind)).some((use) => {
          const s = storeClip(model, id, use);
          return s.holds && transportModule.clipPlayReason(s.model, s.clip) === null;
        });
        const offered = timelineView.trackTargetOptions(model, trackKind)
          .some((n) => n.id === id);
        if (offered !== plays) {
          wrong.push(`${def.type} as a ${trackKind} track target: UI `
            + `${offered ? 'offers' : 'hides'} it, transport plays ${plays ? 'some' : 'none'} of`
            + ' its clips');
        }
      }
    }
    assert.deepEqual(wrong, []);
  });

test('R7 clips: "add clip" on a track creates a clip that plays, or says why it cannot', () => {
  const wrong = [];
  for (const def of NODE_REGISTRY.list()) {
    const { model, id } = withNode(def.type);
    const store = storeOf(model);
    const t = store.dispatch({ type: 'TRACK_ADD', kind: 'event', target: id });
    if (!t.ok) continue; // the store refuses the track target: nothing to add to
    const m = store.getModel();
    const res = timelineView.addClipAction(m, t.created.tracks[0], 1);
    if (res.reason) {
      if (timelineView.trackTargetOptions(model, 'event').some((n) => n.id === id)) {
        wrong.push(`${def.type}: refused (${res.reason}) although it is offered as a target`);
      }
      continue;
    }
    const r = store.dispatch(res.action);
    if (!r.ok) {
      wrong.push(`${def.type}: proposed a ${res.action.kind} clip the store refuses (${r.reason})`);
      continue;
    }
    const clip = store.getModel().timeline.clips.find((c) => c.id === r.created.clips[0]);
    const why = transportModule.clipPlayReason(store.getModel(), clip);
    if (why) wrong.push(`${def.type}: added a ${res.action.kind} clip that does not play (${why})`);
  }
  assert.deepEqual(wrong, []);
});

// ---------------------------------------------------------------- automation lanes

test('R7 lanes: Automate is offered exactly where the transport plays the lane', () => {
  const wrong = [];
  for (const { def, params, label } of nodeCases()) {
    const { model, id } = withNode(def.type, params);
    for (const p of def.params) {
      const t = transportLane(model, id, p.key);
      const listed = automationView.automatableTargets(model).some((n) => n.id === id
        && n.params.some((x) => x.key === p.key));
      const res = automation.automateParameter(model, id, p.key, 0);
      const view = inspector.inspectorView(model, { nodes: [id] });
      const field = view.fields.find((f) => f.key === p.key);
      const offers = { picker: listed, automate: !!(res.action || res.reveal),
        inspector: !!field.automatable };
      for (const [where, offered] of Object.entries(offers)) {
        if (offered !== t.plays) {
          wrong.push(`${label}.${p.key}: ${where} ${offered ? 'offers' : 'hides'} it, store `
            + `${t.holds ? 'holds' : 'refuses'} it, transport `
            + `${t.plays ? 'plays' : `does not play it (${t.reason})`}`);
        }
      }
      if (t.plays && !t.holds) wrong.push(`${label}.${p.key}: played but not held`);
    }
  }
  assert.deepEqual(wrong, []);
});

// ---------------------------------------------------------------- the one policy

test('R7 policy: clipTarget is the verdict of the store, the transport and the UI for clips',
  () => {
    const clipTarget = policyOf();
    assert.equal(typeof clipTarget, 'function', 'clip-targets.js exports clipTarget');
    for (const def of NODE_REGISTRY.list()) {
      const { model, id } = withNode(def.type);
      const node = model.graph.nodes.find((n) => n.id === id);
      for (const use of CLIP_USES) {
        const v = clipTarget(node, use);
        const s = storeClip(model, id, use);
        assert.equal(v.holds, s.holds, `${tag(def.type, use)} holds`);
        if (!s.holds) {
          assert.equal(v.reason, s.reason, `${tag(def.type, use)}: the store's reason`);
          continue;
        }
        const why = transportModule.clipPlayReason(s.model, s.clip);
        assert.equal(v.plays, why === null, `${tag(def.type, use)} plays`);
        assert.equal(v.reason, why, `${tag(def.type, use)}: the transport's reason`);
        assert.ok(!v.plays || typeof v.how === 'string', `${tag(def.type, use)} says how`);
      }
    }
    // No target: a pattern or event clip is held and not played; a measurement step that needs
    // no particular target plays as data.
    assert.deepEqual(clipTarget(null, { kind: 'pattern' }).plays, false);
    assert.equal(clipTarget(null, { kind: 'pattern' }).holds, true);
    assert.equal(clipTarget(null, { kind: 'measurement', action: 'pre-roll' }).plays, true);
    assert.equal(clipTarget(null, { kind: 'measurement', action: 'capture' }).holds, false);
  });

test('R7 policy: clipTarget is the verdict of the store and the transport for lanes', () => {
  const clipTarget = policyOf();
  assert.equal(typeof clipTarget, 'function', 'clip-targets.js exports clipTarget');
  for (const { def, params, label } of nodeCases()) {
    const { model, id } = withNode(def.type, params);
    const node = model.graph.nodes.find((n) => n.id === id);
    for (const p of def.params) {
      const v = clipTarget(node, { kind: 'automation', param: p.key });
      const t = transportLane(model, id, p.key);
      assert.equal(v.holds, t.holds, `${label}.${p.key} holds`);
      if (!t.holds) continue;
      assert.equal(v.plays, t.plays, `${label}.${p.key} plays`);
      assert.equal(v.plays, t.adapter, `${label}.${p.key}: the adapter has an AudioParam for it`);
      if (!t.plays) {
        assert.equal(v.code, t.code, `${label}.${p.key}: the transport's code`);
        assert.equal(v.reason, t.reason, `${label}.${p.key}: the transport's reason`);
      }
    }
  }
});

test('R7 policy: the store still holds what it held, so saved files keep loading', () => {
  const clipTarget = policyOf();
  assert.equal(typeof clipTarget, 'function');
  const { model, id } = withNode('noise');
  const s = storeClip(model, id, { kind: 'event', action: 'gate' });
  assert.equal(s.holds, true, 'an event clip on Noise is still a valid model');
  const v = clipTarget(model.graph.nodes.find((n) => n.id === id),
    { kind: 'event', action: 'gate' });
  assert.deepEqual([v.holds, v.plays, v.code], [true, false, 'event-target']);
  const split = withNode('stereo-split');
  const lane = clipTarget(split.model.graph.nodes.find((n) => n.id === split.id),
    { kind: 'automation', param: 'panA' });
  assert.deepEqual([lane.holds, lane.plays, lane.code], [true, false, 'no-parameter']);
  // The Inspector says why it offers no Automate on a parameter the registry calls automatable.
  const lp = withNode('filter');
  const q = inspector.inspectorView(lp.model, { nodes: [lp.id] }).fields.find((f) => f.key === 'Q');
  assert.equal(q.automatable, false);
  assert.equal(q.automateReason, policyModule.CLIP_TARGET_TEXT.filterQ);
  const cutoff = inspector.inspectorView(lp.model, { nodes: [lp.id] }).fields
    .find((f) => f.key === 'frequency');
  assert.deepEqual([cutoff.automatable, cutoff.automateReason], [true, null]);
});

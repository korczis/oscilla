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
import * as offline from '../../src/js/studio/offline.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { MEASUREMENT_ACTIONS, TRACK_CLIP_KINDS } from '../../src/js/studio/schema.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import * as timeline from '../../src/js/studio/timeline.js';
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

// ---------------------------------------------------------------- round 1 of the #154 review
// B1 the offline render plan, B2 the move/nudge track choices and the Action options, B3 the
// transport's own clip ownership, P2 filter gain, the clip form's options and the Inspector's
// rebuild key. Each compares a surface with the transport or with the policy's verdict.

/** The reference template without its clips and lanes, plus a node of `type`: { model, id }. */
function bareWithNode(type, params = null) {
  const t = templateModel(REFERENCE_TEMPLATE_ID);
  const store = storeOf({ ...t, timeline: { ...t.timeline, clips: [], automation: [] } });
  let id = store.getModel().graph.nodes.find((n) => n.type === type)?.id;
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

/**
 * The transport's own record of a clip after PLAY: is it listed unplayed (code, reason), which
 * parameters of its node does the runtime hand to an owner, is the node a gated envelope, a
 * claimed pattern oscillator?
 */
function transportClip(model, clipId, nodeId) {
  const store = storeOf(model);
  const a = audio();
  const transport = transportModule.createStudioTransport({ runtime: a.runtime, engine: a.engine,
    store });
  const started = transport.start();
  assert.ok(started.ok, `PLAY with clip ${clipId}: ${JSON.stringify(started)}`);
  const d = transport.debugInfo();
  transport.stop({ fast: true });
  const un = d.unplayed.find((u) => u.id === clipId) || null;
  return { unplayed: un, owned: d.ownedParams.filter((p) => p.node === nodeId).map((p) => p.param),
    gated: d.gatedEnvelopes.includes(nodeId), claimed: d.claims.includes(nodeId) };
}

test('R7 clips (B3): PLAY lists, owns and gates exactly what clipTarget says plays', () => {
  const clipTarget = policyOf();
  assert.equal(typeof clipTarget, 'function', 'clip-targets.js exports clipTarget');
  const wrong = [];
  let checked = 0;
  for (const def of NODE_REGISTRY.list()) {
    const { model, id } = bareWithNode(def.type);
    const node = model.graph.nodes.find((n) => n.id === id);
    for (const use of CLIP_USES) {
      const s = storeClip(model, id, use);
      if (!s.holds) continue;
      checked++;
      const v = clipTarget(node, use);
      const t = transportClip(s.model, s.clip.id, id);
      const at = tag(def.type, use);
      if (v.plays === !!t.unplayed) {
        wrong.push(`${at}: policy ${v.plays ? 'plays' : 'does not play'} it, PLAY lists it `
          + `${t.unplayed ? `unplayed (${t.unplayed.code})` : 'as played'}`);
      } else if (t.unplayed && (t.unplayed.code !== v.code || t.unplayed.reason !== v.reason)) {
        wrong.push(`${at}: unplayed ${t.unplayed.code} "${t.unplayed.reason}", policy ${v.code} `
          + `"${v.reason}"`);
      }
      const pattern = v.how === 'pattern-played';
      if (t.claimed !== pattern || t.owned.includes('level') !== pattern) {
        wrong.push(`${at}: ${pattern ? 'pattern-played' : 'not pattern-played'}, but claimed `
          + `${t.claimed}, owned [${t.owned.join(', ')}]`);
      }
      if (t.owned.some((p) => p !== 'level')) {
        wrong.push(`${at}: owns [${t.owned.join(', ')}] with no lane`);
      }
      if (t.gated !== (v.how === 'gate')) {
        wrong.push(`${at}: ${v.how === 'gate' ? 'gate' : 'no gate'}, but the envelope is `
          + `${t.gated ? '' : 'not '}gated by the timeline`);
      }
    }
  }
  // A clip with no target at all (track and clip without one): held, listed, owns nothing.
  const bare = bareWithNode('oscillator');
  const store = storeOf(bare.model);
  const track = store.dispatch({ type: 'TRACK_ADD', kind: 'event' });
  const clip = store.dispatch({ type: 'CLIP_ADD', trackId: track.created.tracks[0],
    kind: 'pattern', start: 0, duration: 0.5, payload: { blockType: 'tone' } });
  assert.ok(clip.ok, clip.reason);
  const t = transportClip(store.getModel(), clip.created.clips[0], bare.id);
  assert.deepEqual(t.unplayed && [t.unplayed.code, t.unplayed.reason],
    ['no-target', clipTarget(null, { kind: 'pattern' }).reason]);
  assert.deepEqual([t.claimed, t.owned], [false, []]);
  assert.ok(checked > 20, `checked ${checked} held clip uses`);
  assert.deepEqual(wrong, []);
});

/** `model` with one automation lane on node `id`, parameter `key`: { model, laneId } | null. */
function withLane(model, id, key) {
  const store = storeOf(model);
  const r = store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: id, param: key },
    time: 0, value: model.graph.nodes.find((n) => n.id === id).params[key], curve: 'step' });
  if (!r.ok) return null;
  const m = store.getModel();
  return { model: m, laneId: m.timeline.automation.find((l) => l.target.node === id
    && l.target.param === key).id };
}

test('R7 lanes (B1): the offline render plan renders a lane exactly where the transport plays it',
  () => {
    const wrong = [];
    for (const { def, params, label } of nodeCases()) {
      const { model, id } = withNode(def.type, params);
      for (const p of def.params) {
        const l = withLane(model, id, p.key);
        if (!l) continue;
        const t = transportLane(model, id, p.key);
        const plan = offline.planOfflineRender(l.model);
        const role = plan.nodes.find((n) => n.id === id).role;
        const row = plan.automation.find((a) => a.id === l.laneId);
        const want = t.plays && role === 'rendered';
        if (row.rendered !== want) {
          wrong.push(`${label}.${p.key}: plan ${row.rendered ? 'renders' : 'skips'} it, node `
            + `${role}, transport ${t.plays ? 'plays' : `does not play it (${t.reason})`}`);
        }
        if (!t.plays && role === 'rendered') {
          if (row.reason !== t.reason) {
            wrong.push(`${label}.${p.key}: plan reason "${row.reason}", transport "${t.reason}"`);
          }
          if (!plan.limitations.includes(`Automation ${l.laneId}: ${t.reason}`)) {
            wrong.push(`${label}.${p.key}: not listed as a limitation of the render`);
          }
        }
      }
    }
    assert.deepEqual(wrong, []);
  });

test('R7 lanes (B1): a band-pass Q lane after low-pass and a Stereo Split pan lane are not '
  + 'rendered, with the reason', () => {
  const text = policyModule.CLIP_TARGET_TEXT || {};
  // Q lane added while the filter is band-pass (it plays), then the type changes to low-pass.
  const bp = withNode('filter', { type: 'bandpass' });
  const q = withLane(bp.model, bp.id, 'Q');
  assert.ok(q, 'a band-pass Q lane is held');
  const store = storeOf(q.model);
  const r = store.dispatch({ type: 'NODE_PARAM_SET', nodeId: bp.id, params: { type: 'lowpass' } });
  assert.ok(r.ok, r.reason);
  const plan = offline.planOfflineRender(store.getModel());
  const row = plan.automation.find((a) => a.id === q.laneId);
  assert.deepEqual([row.rendered, row.reason], [false, text.filterQ]);
  assert.ok(plan.limitations.includes(`Automation ${q.laneId}: ${text.filterQ}`),
    plan.limitations.join(' | '));
  const split = withNode('stereo-split');
  const pan = withLane(split.model, split.id, 'panA');
  assert.ok(pan, 'a Stereo Split panA lane is held');
  const sp = offline.planOfflineRender(pan.model);
  const prow = sp.automation.find((a) => a.id === pan.laneId);
  const node = pan.model.graph.nodes.find((n) => n.id === split.id);
  const why = policyOf() && policyOf()(node, { kind: 'automation', param: 'panA' }).reason;
  assert.equal(prow.rendered, false);
  assert.ok(why && prow.reason === why, `reason ${prow.reason}`);
  assert.ok(sp.limitations.includes(`Automation ${pan.laneId}: ${why}`));
});

test('R7 lanes (P2): a filter gain lane plays only where Web Audio uses the gain (peaking)',
  () => {
    const wrong = [];
    for (const type of FILTER_TYPES) {
      const { model, id } = withNode('filter', { type });
      const t = transportLane(model, id, 'gain');
      const v = policyOf()(model.graph.nodes.find((n) => n.id === id),
        { kind: 'automation', param: 'gain' });
      const want = type === 'peaking';
      if (t.plays !== want || v.plays !== want || t.adapter !== want) {
        wrong.push(`${type}: transport ${t.plays}, policy ${v.plays}, adapter ${t.adapter}`);
      }
      if (!want && !(v.reason && v.reason === t.reason)) {
        wrong.push(`${type}: reason "${v.reason}" / "${t.reason}"`);
      }
      const field = inspector.inspectorView(model, { nodes: [id] }).fields
        .find((f) => f.key === 'gain');
      if (field.automatable !== want || (!want && field.automateReason !== v.reason)) {
        wrong.push(`${type}: Inspector Automate ${field.automatable}, note ${field.automateReason}`);
      }
    }
    assert.deepEqual(wrong, []);
  });

// ---------------------------------------------------------------- B2: moving a clip

/**
 * The reference template (Oscillator track first) plus an Envelope track holding a gate clip
 * without its own target, a second Envelope track, and a Noise track.
 */
function moveFixture() {
  const t = templateModel(REFERENCE_TEMPLATE_ID);
  const store = storeOf(t);
  const env2 = store.dispatch({ type: 'NODE_ADD', nodeType: 'envelope', position: { x: 0, y: 0 } });
  const noise = store.dispatch({ type: 'NODE_ADD', nodeType: 'noise', position: { x: 0, y: 0 } });
  const add = (target) => store.dispatch({ type: 'TRACK_ADD', kind: 'event', target })
    .created.tracks[0];
  const envTrack = add('env-1');
  const env2Track = add(env2.created.nodes[0]);
  const noiseTrack = add(noise.created.nodes[0]);
  const gate = store.dispatch({ type: 'CLIP_ADD', trackId: envTrack, kind: 'event', start: 1,
    duration: 0.5, payload: { action: 'gate' } });
  assert.ok(gate.ok, gate.reason);
  const held = store.dispatch({ type: 'CLIP_ADD', trackId: noiseTrack, kind: 'event', start: 1,
    duration: 0.5, payload: { action: 'gate' } });
  assert.ok(held.ok, held.reason);
  const oscTrack = t.timeline.tracks[0].id;
  return { model: store.getModel(), oscTrack, envTrack, env2Track, noiseTrack,
    gate: gate.created.clips[0], held: held.created.clips[0] };
}

test('R7 clips (B2): a clip is offered, moved and nudged only onto tracks where it plays', () => {
  const f = moveFixture();
  const clip = timeline.findClip(f.model, f.gate);
  const ids = timelineView.compatibleTracks(f.model, clip).map((t) => t.id);
  assert.deepEqual(ids, [f.envTrack, f.env2Track],
    'a gate clip on an Envelope track is offered the Envelope tracks only');
  const moved = timeline.moveClipResult(f.model, f.gate, { trackId: f.oscTrack });
  assert.equal(moved.ok, false, 'moving the gate clip onto the Oscillator track is refused');
  assert.equal(moved.reason, policyOf()(f.model.graph.nodes.find((n) => n.id === 'osc-1'),
    { kind: 'event', action: 'gate' }).reason);
  assert.equal(timeline.moveClipResult(f.model, f.gate, { trackId: f.env2Track }).ok, true);
  // Keyboard: the previous track that would play it does not exist, the next one does.
  const up = timeline.nudgeClipResult(f.model, f.gate, { direction: 0, trackDelta: -1 });
  assert.notEqual(up.trackId, f.oscTrack, 'nudge up skips the Oscillator track');
  const down = timeline.nudgeClipResult(f.model, f.gate, { direction: 0, trackDelta: 1 });
  assert.equal(down.trackId, f.env2Track);
  // A clip that does not play where it is (a file from an earlier build) keeps its own track in
  // the list, and is offered the tracks where it would play.
  const held = timeline.findClip(f.model, f.held);
  assert.deepEqual(timelineView.compatibleTracks(f.model, held).map((t) => t.id),
    [f.envTrack, f.env2Track, f.noiseTrack]);
});

test('R7 clips (B2): the Action select offers Trigger only to a clip that already has it', () => {
  const ids = (o) => o.map((x) => x.id);
  assert.deepEqual(ids(timelineView.eventActionOptions()), ['gate'],
    'a new choice never offers an action the transport does not play');
  assert.deepEqual(ids(timelineView.eventActionOptions('gate')), ['gate']);
  assert.deepEqual(ids(timelineView.eventActionOptions('trigger')), ['gate', 'trigger'],
    'a held trigger clip still shows its own action');
});

test('R7 clips (P2): the clip form\'s target and track options follow the clip\'s action', () => {
  assert.equal(typeof timelineView.clipFormOptions, 'function',
    'timeline-view.js exports clipFormOptions');
  const f = moveFixture();
  const store = storeOf(f.model);
  const r = store.dispatch({ type: 'CLIP_UPDATE', clipId: f.gate, payload: { action: 'trigger' } });
  assert.ok(r.ok, r.reason);
  const ids = (o) => o.map((x) => x.id);
  const trig = timelineView.clipFormOptions(store.getModel(),
    timeline.findClip(store.getModel(), f.gate));
  assert.deepEqual(ids(trig.targets), [''], 'a trigger clip plays nowhere: only "Track target"');
  assert.deepEqual(ids(trig.tracks), [f.envTrack], 'and stays on its own track');
  assert.deepEqual(ids(trig.actions), ['gate', 'trigger']);
  const back = store.dispatch({ type: 'CLIP_UPDATE', clipId: f.gate, payload: { action: 'gate' } });
  assert.ok(back.ok, back.reason);
  const gate = timelineView.clipFormOptions(store.getModel(),
    timeline.findClip(store.getModel(), f.gate));
  const envs = store.getModel().graph.nodes.filter((n) => n.type === 'envelope').map((n) => n.id);
  assert.deepEqual(ids(gate.targets), ['', ...envs]);
  assert.deepEqual(ids(gate.tracks), [f.envTrack, f.env2Track]);
  assert.deepEqual(ids(gate.actions), ['gate']);
});

// ---------------------------------------------------------------- P2: the Inspector rebuild

test('R7 Inspector (P2): a filter type change rebuilds the Inspector, so the Q note follows',
  () => {
    assert.equal(typeof inspector.inspectorRebuildKey, 'function',
      'inspector.js exports inspectorRebuildKey');
    const bp = withNode('filter', { type: 'bandpass' });
    const store = storeOf(bp.model);
    const before = inspector.inspectorView(store.getModel(), { nodes: [bp.id] });
    const qBefore = before.fields.find((f) => f.key === 'Q');
    assert.deepEqual([qBefore.automatable, qBefore.automateReason], [true, null]);
    assert.ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: bp.id,
      params: { type: 'lowpass' } }).ok);
    const after = inspector.inspectorView(store.getModel(), { nodes: [bp.id] });
    const qAfter = after.fields.find((f) => f.key === 'Q');
    assert.deepEqual([qAfter.automatable, qAfter.automateReason],
      [false, policyModule.CLIP_TARGET_TEXT.filterQ], 'the note appears, Automate goes');
    // The view keeps its key (same node), so only the rebuild key can make the panel rebuild.
    assert.equal(after.key, before.key);
    assert.notEqual(inspector.inspectorRebuildKey(after), inspector.inspectorRebuildKey(before),
      'band-pass -> low-pass changes the rebuild key');
    // The reverse direction too (the browser check covers low-pass -> band-pass).
    assert.ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: bp.id,
      params: { type: 'bandpass' } }).ok);
    const again = inspector.inspectorView(store.getModel(), { nodes: [bp.id] });
    assert.equal(inspector.inspectorRebuildKey(again), inspector.inspectorRebuildKey(before));
  });

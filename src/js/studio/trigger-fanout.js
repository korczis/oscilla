// The Studio transport's TRIGGER fan-out and clock ticks (V272 A2, K023), split from
// transport.js (the source-size budget; no behaviour change). Composed by transport.js; pure apart
// from the handles it is given, which are the runtime's own (a clocked node's clock and
// clockFrom, adapters/modulation.js clockedControl). No audio node is created and no timer runs
// here: every call lands at an audio-clock time the timeline compiler computed. K103's shared
// fan-out (keys gates, the live note router) is meant to grow from this module.
//
//   createTriggerFanout({ getModel, ready, nodes, gate }) -> fan
//     getModel()   the model the transport plays
//     ready(id)    the runtime handle of node `id` when it is ready, else null
//     nodes        runtime.nodes: a clocked target is a handle with clock()
//     gate(key, it, envId, start, end, deferred)   the transport's gate records (addGate)
//   fan.fanOut(it, sourceId, prefix, deferred)   one trigger of item `it` from `sourceId` (a
//                pattern clip's target, a Clock, a clocked Step Modulator): a gate from the
//                item's start to its end on every Envelope its unmuted TRIGGER edges reach, a
//                clock tick on every clocked node; a Step Modulator relays the tick on its own
//                Trigger output while it takes a step, so the chain continues from it
//   fan.trigger(it, deferred)   a trigger event clip on Random or a Step Modulator: one tick on
//                its target, relayed by a Step as fanOut does
//   fan.tick(key, it, id) -> k | null   a clock tick at the item's start on clocked node `id`
//                (its index since PLAY), or null when `id` has no ready clock
//   fan.rebuild(id, horizon)   re-render a clocked node's steps from `horizon` (rebuildClock)
//   fan.cancel(itemKey, touched)   forget a cancelled item's ticks; their nodes join `touched`
//   fan.stale()  clocked node ids whose ticks name a handle the runtime replaced
//   fan.prune(now, keepS), fan.clear(), fan.size
//   reachedEnvelopes(model, sourceId)   Envelope ids `sourceId`'s TRIGGER edges gate, directly
//                or through Step relays (the transport's gate ownership, gatedEnvelopes)

import { NODE_REGISTRY } from './registry.js';
import { clipTarget, clipUse } from './clip-targets.js';
import { effectiveTarget } from './timeline.js';

const nodeOf = (m, id) => (m && id ? m.graph.nodes.find((n) => n.id === id) || null : null);

/**
 * Whether edge `e` leaves a TRIGGER output of its source (K103: any of them, a Keys or XY pad
 * Gate, a Clock, Sequence or Step Modulator Trigger) and is not muted (V272 A3).
 */
function triggerOut(m, e) {
  if (e.props && e.props.muted) return false;
  const n = nodeOf(m, e.from.node);
  const def = n && n.type ? NODE_REGISTRY.get(n.type) : null;
  // A node of no known type (a partial model) is read by its port names, as before K103.
  if (!def) return e.from.port === 'gate' || e.from.port === 'trigger';
  return def.outputs.some((p) => p.id === e.from.port && p.type === 'TRIGGER');
}

/**
 * One hop of the fan-out from `sourceId` (K103): the Envelopes whose Gate its unmuted TRIGGER
 * edges reach, and every other node a TRIGGER edge of it reaches (a Random's or Step
 * Modulator's clock). -> { envelopes, clocks }
 */
export function triggerHop(m, sourceId) {
  const envelopes = [];
  const clocks = [];
  for (const e of m.graph.edges) {
    if (e.from.node !== sourceId || !triggerOut(m, e)) continue;
    const n = nodeOf(m, e.to.node);
    if (!n) continue;
    if (n.type === 'envelope' && e.to.port === 'gate') envelopes.push(n.id);
    else clocks.push(n.id);
  }
  return { envelopes, clocks };
}

/**
 * Whether the k-th clock tick (from 0) of node `n` is a step a Step Modulator takes, which its
 * own Trigger then relays (K023): every tick, but none after the last step of a 'once' run.
 */
export function stepRelays(n, k) {
  if (!n || n.type !== 'step-modulator' || k === null || k === undefined) return false;
  return n.params.playback !== 'once' || k < n.params.steps.length;
}

/**
 * Envelope ids a pattern clip on `sourceId` gates through its TRIGGER edges. A muted edge
 * carries nothing (ports.js: every edge can be muted), so it gates nothing (V272 A3).
 */
function triggerEnvelopes(m, sourceId) {
  const out = [];
  for (const e of m.graph.edges) {
    if (e.from.node !== sourceId || e.to.port !== 'gate' || !triggerOut(m, e)) continue;
    const n = nodeOf(m, e.to.node);
    if (n && n.type === 'envelope') out.push(n.id);
  }
  return out;
}

/** Clocked nodes (plan `clocked`: Random, Step Modulator) a pattern clip on `sourceId` clocks. */
function triggerClocks(m, sourceId, nodes) {
  const out = [];
  for (const e of m.graph.edges) {
    if (e.from.node !== sourceId || !triggerOut(m, e)) continue;
    const n = nodeOf(m, e.to.node);
    const a = n ? nodes.get(n.id) : null;
    if (a && typeof a.clock === 'function') out.push(n.id);
  }
  return out;
}

/**
 * Step Modulators the unmuted TRIGGER edges of `sourceId` clock: each relays the steps it
 * takes on its own Trigger output (K023).
 */
function relayedSteps(m, sourceId) {
  const out = [];
  for (const e of m.graph.edges) {
    if (e.from.node !== sourceId || e.to.port !== 'clock' || !triggerOut(m, e)) continue;
    const n = nodeOf(m, e.to.node);
    if (n && n.type === 'step-modulator') out.push(n.id);
  }
  return out;
}

/** Envelope ids `sourceId`'s TRIGGER edges gate, directly or through Step relays (K023). */
export function reachedEnvelopes(m, sourceId, seen = new Set()) {
  if (seen.has(sourceId)) return [];
  seen.add(sourceId);
  const out = triggerEnvelopes(m, sourceId);
  for (const id of relayedSteps(m, sourceId)) out.push(...reachedEnvelopes(m, id, seen));
  return out;
}

/** Every TRIGGER input `sourceId` reaches, through Step relays: Set of node ids. */
function reachedInputs(m, sourceId, out = new Set(), seen = new Set()) {
  if (seen.has(sourceId)) return out;
  seen.add(sourceId);
  const { envelopes, clocks } = triggerHop(m, sourceId);
  for (const id of [...envelopes, ...clocks]) out.add(id);
  for (const id of relayedSteps(m, sourceId)) reachedInputs(m, id, out, seen);
  return out;
}

/** How a clip plays whose target's TRIGGER outputs (or the target itself) the timeline drives. */
const DRIVES = new Set(['sequence', 'clock', 'keys-gate', 'keys-notes']);

/**
 * The TRIGGER inputs the timeline drives in `m` (K103's one ownership rule): an Envelope a gate
 * clip plays on, a node a trigger clip clocks, and every input reached from a clip-driven
 * source (a Sequence's pattern clips, a Keys node's notes and gate clips, a clocked Step's
 * relay) or from a Clock. While the transport plays the timeline these are its own, and a
 * live gate on one is refused (live-notes.js). -> Set of node ids
 */
export function timelineGateInputs(m, registry = NODE_REGISTRY) {
  const out = new Set();
  for (const c of m.timeline.clips) {
    const id = effectiveTarget(m, c);
    const n = nodeOf(m, id);
    const how = n ? clipTarget(n, clipUse(c), registry).how : null;
    // A Keys node a notes clip plays is the timeline's too (C1-K103-1): its pitch is the
    // clip's, so a live key may not move it.
    if (how === 'gate' || how === 'clock' || how === 'keys-notes') out.add(id);
    if (DRIVES.has(how)) reachedInputs(m, id, out);
  }
  for (const n of m.graph.nodes) if (n.type === 'clock') reachedInputs(m, n.id, out);
  return out;
}

/**
 * The ownership test the transport hands the live router (K103): (id) -> whether `id` is a
 * TRIGGER input the timeline drives in getModel(), memoized per model.
 */
export function createTimelineOwner(getModel, registry = NODE_REGISTRY) {
  let memo = { m: null, set: null };
  return (id) => {
    const m = getModel();
    if (!m) return false;
    if (memo.m !== m) memo = { m, set: timelineGateInputs(m, registry) };
    return memo.set.has(id);
  };
}

export function createTriggerFanout({ getModel, ready, nodes, gate }) {
  const ticks = new Map(); // tick key → { key, itemKey, nodeId, handle, time }: clock triggers
  const ticksPassed = new Map(); // clocked node id → triggers pruned from `ticks` (still counted)

  /**
   * One trigger of item `it` from `sourceId` (a pattern clip's target, a Clock, a clocked Step
   * Modulator): a gate from the item's start to its end on every Envelope its TRIGGER edges
   * reach, and a clock tick on every clocked node. A Step Modulator relays the tick on its own
   * Trigger output while it takes a step (a 'once' run takes none after its last), so the chain
   * continues from it (K023). `seen` stops a TRIGGER loop.
   */
  function fanOut(it, sourceId, prefix, deferred = null, seen = new Set([sourceId])) {
    const model = getModel();
    for (const env of triggerEnvelopes(model, sourceId)) {
      gate(`${prefix}>${env}`, it, env, it.startTime, it.endTime, deferred);
    }
    for (const id of triggerClocks(model, sourceId, nodes)) {
      const k = addTick(`${prefix}>${id}`, it, id);
      if (seen.has(id) || !stepTaken(id, k)) continue;
      seen.add(id);
      fanOut(it, id, `${prefix}>${id}`, deferred, seen);
    }
  }

  /** Whether clock tick `k` of node `id` is a step a Step Modulator takes (and relays). */
  const stepTaken = (id, k) => stepRelays(nodeOf(getModel(), id), k);

  /** Index of a trigger at `time` on clocked node `id`: the triggers before it since PLAY. */
  const tickIndex = (id, time) => (ticksPassed.get(id) || 0)
    + [...ticks.values()].filter((k) => k.nodeId === id && k.time < time).length;

  /** A clock trigger at the item's start on clocked node `id` (V272 A2). */
  function addTick(key, it, id) {
    const h = ready(id);
    if (!h || typeof h.clock !== 'function') return null;
    const later = [...ticks.values()].some((k) => k.nodeId === id && k.time > it.startTime);
    ticks.set(key, { key, itemKey: it.key, nodeId: id, handle: h, time: it.startTime });
    const k = tickIndex(id, it.startTime);
    if (later) rebuildClock(id, it.startTime); // out of order: the later steps move up one
    else h.clock(it.startTime, k);
    return k;
  }

  /**
   * Re-render a clocked node's steps from `horizon` from the trigger records (after an edit or
   * a STOP removed one, or its node was replaced): hold the step it has there, then every
   * later trigger again with its index.
   */
  function rebuildClock(id, horizon) {
    const h = ready(id);
    if (!h || typeof h.clockFrom !== 'function') return;
    const list = [...ticks.values()].filter((k) => k.nodeId === id && k.time >= horizon)
      .sort((a, b) => a.time - b.time);
    const before = tickIndex(id, horizon);
    h.clockFrom(horizon, Math.max(0, before - 1));
    list.forEach((k, i) => {
      k.handle = h;
      h.clock(k.time, before + i);
    });
  }

  return {
    fanOut,
    /** A trigger on Random or a Step Modulator: one clock tick, relayed by a Step (K023). */
    trigger(it, deferred = null) {
      const k = addTick(it.key, it, it.target);
      if (stepTaken(it.target, k)) {
        fanOut(it, it.target, it.key, deferred);
      }
    },
    tick: addTick,
    rebuild: rebuildClock,
    cancel(itemKey, touched) {
      for (const k of [...ticks.values()]) {
        if (k.itemKey !== itemKey) continue;
        ticks.delete(k.key);
        touched.add(k.nodeId);
      }
    },
    /** A clocked node rebuilt by the runtime continues its steps on the new node. */
    stale() {
      return new Set([...ticks.values()].filter((k) => k.handle !== ready(k.nodeId))
        .map((k) => k.nodeId));
    },
    prune(now, keepS) {
      for (const [key, k] of ticks) {
        if (k.time + keepS >= now) continue;
        ticks.delete(key);
        ticksPassed.set(k.nodeId, (ticksPassed.get(k.nodeId) || 0) + 1);
      }
    },
    /** Clock triggers are instants with nothing to release: the next PLAY counts from 0. */
    clear() {
      ticks.clear();
      ticksPassed.clear();
    },
    get size() { return ticks.size; },
  };
}

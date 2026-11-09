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
//   relayOf(node, k) -> null | { ports }   whether the k-th step a clocked node takes relays, and
//                along which of its TRIGGER outputs (ports null: all of them)
//
// K226: the step-voltage sequencer relays on its Gate every step and on trigN on step N only
// (step-voltage.js svsRelayPorts), and its reset input is not a clock: a trigger into it sends
// the step count back to 0 at the trigger's time, so the next tick (or a tick at that same
// instant) plays step 1. Within one fan-out the edges into a reset go first; across items at one
// instant the timeline compiler puts the items that drive a reset first (timeline-compiler.js).

import { NODE_REGISTRY } from './registry.js';
import { clipTarget, clipUse } from './clip-targets.js';
import { effectiveTarget } from './timeline.js';
import { svsGateFraction, svsRelayPorts, svsStep } from './step-voltage.js';
import { MIN_SEGMENT_S } from '../audio/envelope.js';

/** The node types whose own TRIGGER outputs relay the steps they take (K023, K226). */
const RELAYS = new Set(['step-modulator', 'step-voltage-sequencer']);
/** Whether edge `e` enters a step-voltage sequencer's reset (K226): a reset, not a clock tick. */
const isReset = (m, e) => e.to.port === 'reset' && (nodeOf(m, e.to.node) || {}).type
  === 'step-voltage-sequencer';

const nodeOf = (m, id) => (m && id ? m.graph.nodes.find((n) => n.id === id) || null : null);
/** The node types a Gate opens and closes: the Envelope and the Contour (K207). */
export const GATED_TYPES = Object.freeze(['envelope', 'contour']);
const gatedType = (n) => !!n && GATED_TYPES.includes(n.type);

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

/** Whether edge `e` leaves `sourceId` on one of `ports` (null: any) as an unmuted TRIGGER. */
const leaves = (m, e, sourceId, ports) => e.from.node === sourceId && triggerOut(m, e)
  && (!ports || ports.includes(e.from.port));

/**
 * One hop of the fan-out from `sourceId` (K103), along its TRIGGER outputs `ports` (null: all):
 * the Envelopes whose Gate its unmuted TRIGGER edges reach, every other node a TRIGGER edge of it
 * clocks (a Random's or Step Modulator's clock), and the step-voltage sequencers whose reset it
 * reaches (K226). -> { envelopes, clocks, resets }
 */
export function triggerHop(m, sourceId, ports = null) {
  const envelopes = [];
  const clocks = [];
  const resets = [];
  for (const e of m.graph.edges) {
    if (!leaves(m, e, sourceId, ports)) continue;
    const n = nodeOf(m, e.to.node);
    if (!n) continue;
    if (gatedType(n) && e.to.port === 'gate') envelopes.push(n.id);
    else if (isReset(m, e)) resets.push(n.id);
    else clocks.push(n.id);
  }
  return { envelopes, clocks, resets };
}

/**
 * Whether the k-th step (from 0) a clocked node `n` takes relays on its own TRIGGER outputs, and
 * on which: a Step Modulator relays every step on its Trigger, none after the last of a 'once'
 * run (K023); a step-voltage sequencer on its Gate and on the trigger of that step (K226).
 * -> null (no relay) | { ports } (ports null: every TRIGGER output)
 */
export function relayOf(n, k) {
  if (!n || !RELAYS.has(n.type) || k === null || k === undefined) return null;
  if (n.type === 'step-voltage-sequencer') {
    const ports = svsRelayPorts(n.params, k);
    return ports.length ? { ports } : null;
  }
  return n.params.playback !== 'once' || k < n.params.steps.length ? { ports: null } : null;
}

/** Whether the k-th step of node `n` relays (relayOf, as a boolean; K023's name). */
export const stepRelays = (n, k) => relayOf(n, k) !== null;

/**
 * The item a relay of the k-th step of node `n` passes on (K226): a step-voltage sequencer with
 * a gate-length row holds its Gate and step trigger for that fraction of the step period (a
 * Clock's period, else the trigger's own length), at least MIN_SEGMENT_S; any other relay passes
 * `it` as it is.
 */
export function relayItem(n, k, it) {
  if (!n || n.type !== 'step-voltage-sequencer') return it;
  const frac = svsGateFraction(n.params, svsStep(n.params, k));
  if (frac === null) return it;
  const period = Number.isFinite(it.period) && it.period > 0 ? it.period
    : it.endTime - it.startTime;
  const endTime = it.startTime + Math.max(MIN_SEGMENT_S, frac * period);
  return { ...it, endTime, duration: endTime - it.startTime };
}

/**
 * Envelope ids a pattern clip on `sourceId` gates through its TRIGGER edges (on `ports`, null:
 * all). A muted edge carries nothing (ports.js: every edge can be muted), so it gates nothing
 * (V272 A3).
 */
function triggerEnvelopes(m, sourceId, ports = null) {
  const out = [];
  for (const e of m.graph.edges) {
    if (e.to.port !== 'gate' || !leaves(m, e, sourceId, ports)) continue;
    const n = nodeOf(m, e.to.node);
    if (gatedType(n)) out.push(n.id);
  }
  return out;
}

/**
 * Clocked nodes (plan `clocked`: Random, Step Modulator, the step-voltage sequencer) a pattern
 * clip on `sourceId` reaches along `ports` (null: all), each with the input it reaches:
 * [{ id, reset }], the resets first (K226: a reset at a tick's instant restarts on that tick).
 */
function triggerClocks(m, sourceId, nodes, ports = null) {
  const out = [];
  for (const e of m.graph.edges) {
    if (!leaves(m, e, sourceId, ports)) continue;
    const n = nodeOf(m, e.to.node);
    const a = n ? nodes.get(n.id) : null;
    if (a && typeof a.clock === 'function') out.push({ id: n.id, reset: isReset(m, e) });
  }
  return [...out.filter((t) => t.reset), ...out.filter((t) => !t.reset)];
}

/**
 * Relaying nodes the unmuted TRIGGER edges of `sourceId` clock: each relays the steps it takes
 * on its own TRIGGER outputs (K023 Step Modulator, K226 step-voltage sequencer).
 */
function relayedSteps(m, sourceId) {
  const out = [];
  for (const e of m.graph.edges) {
    if (e.from.node !== sourceId || e.to.port !== 'clock' || !triggerOut(m, e)) continue;
    const n = nodeOf(m, e.to.node);
    if (n && RELAYS.has(n.type)) out.push(n.id);
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
  // K226: node id → its resets [{ key, itemKey, time, raw }] by time; `raw`, once a reset is
  // older than what prune keeps, freezes the trigger count before it.
  const resets = new Map();

  /**
   * One trigger of item `it` from `sourceId` (a pattern clip's target, a Clock, a clocked Step
   * Modulator): a gate from the item's start to its end on every Envelope its TRIGGER edges
   * reach, and a clock tick on every clocked node. A Step Modulator relays the tick on its own
   * Trigger output while it takes a step (a 'once' run takes none after its last), so the chain
   * continues from it (K023). `seen` stops a TRIGGER loop.
   */
  function fanOut(it, sourceId, prefix, deferred = null, seen = new Set([sourceId]),
    ports = null) {
    const model = getModel();
    for (const env of triggerEnvelopes(model, sourceId, ports)) {
      gate(`${prefix}>${env}`, it, env, it.startTime, it.endTime, deferred);
    }
    for (const { id, reset } of triggerClocks(model, sourceId, nodes, ports)) {
      if (reset) {
        addReset(`${prefix}>${id}!reset`, it, id);
        continue;
      }
      const k = addTick(`${prefix}>${id}`, it, id);
      const n = nodeOf(model, id);
      const relay = relayOf(n, k);
      if (seen.has(id) || !relay) continue;
      seen.add(id);
      fanOut(relayItem(n, k, it), id, `${prefix}>${id}`, deferred, seen, relay.ports);
    }
  }

  /** Raw index of a trigger at `time` on clocked node `id`: the triggers before it since PLAY. */
  const rawIndex = (id, time) => (ticksPassed.get(id) || 0)
    + [...ticks.values()].filter((k) => k.nodeId === id && k.time < time).length;

  /**
   * Index of a trigger at `time` on clocked node `id`: the triggers before it since PLAY, or
   * since its last reset at or before `time` (K226: a tick at a reset's instant is step 1).
   */
  function tickIndex(id, time) {
    const list = resets.get(id);
    const r = list ? list.filter((x) => x.time <= time).at(-1) : null;
    if (!r) return rawIndex(id, time);
    return rawIndex(id, time) - (r.raw !== undefined ? r.raw : rawIndex(id, r.time));
  }

  /**
   * A reset of item `it` on step-voltage sequencer `id` at its start (K226). Ticks already
   * planned at or after it are rendered again from it (an edit or an out-of-order item); the
   * gates they relayed stay, so the transport orders resets first at one instant.
   */
  function addReset(key, it, id) {
    const h = ready(id);
    if (!h || typeof h.clock !== 'function') return;
    const list = (resets.get(id) || []).filter((x) => x.key !== key);
    list.push({ key, itemKey: it.key, time: it.startTime });
    list.sort((a, b) => a.time - b.time);
    resets.set(id, list);
    if ([...ticks.values()].some((k) => k.nodeId === id && k.time >= it.startTime)) {
      rebuildClock(id, it.startTime);
    }
  }

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
    for (const k of list) {
      k.handle = h;
      h.clock(k.time, tickIndex(id, k.time));
    }
  }

  return {
    fanOut,
    /** A trigger on Random or a Step Modulator: one clock tick, relayed by a Step (K023). */
    trigger(it, deferred = null) {
      const k = addTick(it.key, it, it.target);
      const n = nodeOf(getModel(), it.target);
      const relay = relayOf(n, k);
      if (relay) {
        fanOut(relayItem(n, k, it), it.target, it.key, deferred, new Set([it.target]),
          relay.ports);
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
      for (const [id, list] of resets) {
        const kept = list.filter((x) => x.itemKey !== itemKey);
        if (kept.length === list.length) continue;
        resets.set(id, kept);
        touched.add(id);
      }
    },
    /** A clocked node rebuilt by the runtime continues its steps on the new node. */
    stale() {
      return new Set([...ticks.values()].filter((k) => k.handle !== ready(k.nodeId))
        .map((k) => k.nodeId));
    },
    prune(now, keepS) {
      // K226: a reset older than what is kept freezes the count before it, then only the last
      // such reset stays (it still decides the ticks after it).
      for (const [id, list] of resets) {
        const old = list.filter((x) => x.time + keepS < now);
        for (const x of old) if (x.raw === undefined) x.raw = rawIndex(id, x.time);
        if (old.length > 1) resets.set(id, list.filter((x) => !old.slice(0, -1).includes(x)));
      }
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
      resets.clear();
    },
    get size() { return ticks.size; },
  };
}

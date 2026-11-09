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

const nodeOf = (m, id) => (m && id ? m.graph.nodes.find((n) => n.id === id) || null : null);

/**
 * Envelope ids a pattern clip on `sourceId` gates through its TRIGGER edges. A muted edge
 * carries nothing (ports.js: every edge can be muted), so it gates nothing (V272 A3).
 */
function triggerEnvelopes(m, sourceId) {
  const out = [];
  for (const e of m.graph.edges) {
    if (e.from.node !== sourceId || e.from.port !== 'trigger' || e.to.port !== 'gate') continue;
    if (e.props && e.props.muted) continue;
    const n = nodeOf(m, e.to.node);
    if (n && n.type === 'envelope') out.push(n.id);
  }
  return out;
}

/** Clocked nodes (plan `clocked`: Random, Step Modulator) a pattern clip on `sourceId` clocks. */
function triggerClocks(m, sourceId, nodes) {
  const out = [];
  for (const e of m.graph.edges) {
    if (e.from.node !== sourceId || e.from.port !== 'trigger') continue;
    if (e.props && e.props.muted) continue;
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
    if (e.from.node !== sourceId || e.from.port !== 'trigger' || e.to.port !== 'clock') continue;
    if (e.props && e.props.muted) continue;
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
  function stepTaken(id, k) {
    const n = nodeOf(getModel(), id);
    if (!n || n.type !== 'step-modulator' || k === null) return false;
    return n.params.playback !== 'once' || k < n.params.steps.length;
  }

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

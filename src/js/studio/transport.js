// The OSCILLA Studio transport (spec §93-§104, §180-§185; V3.1): live timeline playback on the
// Studio runtime. It plays the store's model — graph and timeline — on the ONE AudioEngine:
//
//   createStudioTransport({ runtime, engine, store, onClaimOutput, onMeasurement, registry,
//                           lookAheadS, trace })   lookAheadS: the scheduler's window (default
//                                           TIMELINE_LOOKAHEAD_S); offline.js passes the render
//                                           length, so one start() schedules the whole render
//   clipPlayReason(model, clip) -> reason | null   what the transport plays, from the model
//   transport.start({ position }) -> result     PLAY from `position` (default: the return point)
//   transport.stop({ fast }) -> Promise<counts>  STOP (§184): release, cancel, hold automation,
//                                                stop the Studio output; resolves once released
//   transport.returnToStart() -> playhead       RETURN: the return point becomes 0 (relocates
//                                                while playing)
//   transport.locate(position) -> playhead      the same for any position
//   transport.setLoop({ enabled, start, end })  LOOP_SET through the store, then sync()
//   transport.sync() -> result                  apply the store's model now (the UI's store
//                                                onChange calls it; every wake-up checks too)
//   transport.admit(next, { revision }) -> null | { ok: false, phase, reason }   the store's
//                                                commit gate (actions.js `gate`): while playing,
//                                                apply `next` to the running graph BEFORE the
//                                                store commits it; a refused runtime transaction
//                                                refuses the edit (ADR 0035, V431 review #15)
//   transport.escape({ gesture, popup, selectionMode }) -> action   resolveEscape (§185);
//                                                'stop-audio' stops fast (8 ms)
//   transport.playhead() -> { position, pass, playing }   from AudioContext.currentTime (§94)
//   transport.debugInfo(), transport.on(fn) -> off ('state' | 'ended' | 'warning': a
//                                                Diagnostic), transport.dispose(), .playing
// Diagnostics (validate.js studioDiagnostic, owner 'transport'): debugInfo().diagnostics, and
// debugInfo().warnings as their message text, are those of the current playback: PLAY starts an
// empty list, and a refusal leaves it once a later model is applied. Codes: edit-refused,
// sync-refused (the runtime refused a model: the transport keeps the last applied one; entity:
// the runtime diagnostic's), automation-failed (entity: the lane), measurement-callback-failed,
// timeline (a timeline-compiler warning, its prose as the message). debugInfo().unplayed =
// [{ id, code, reason }], code: no-target, pattern-target, event-target, target-unavailable,
// no-parameter.
//
// Operation trace (ADR 0042; `trace`: the core/trace.js port, default NO_TRACE). start, stop,
// sync and admit are one operation each, or join the caller's. Steps, owner 'transport': `play`
// (playing from `position` at `baseTime` | refused with the failed phase), `stop` (stopped |
// aborted: the context closed or the runtime stopped elsewhere), `admit`
// (admitted | refused, code edit-refused | not-applied: stopped, PLAY applies the model) and
// `sync` (applied | refused, code sync-refused). The timeline's wake-ups schedule clips and
// lanes outside any operation and are not traced.
//
// Timing (§180-§181). createTimelineScheduler (timeline-compiler.js) compiles the timeline with
// the sequencer compiler; this module only applies what it returns, at the audio-clock times it
// returns. The one timer is a bookkeeping wake-up, like the sequencer's top-up
// (scheduler.nextWakeMs: half a look-ahead before the scheduled horizon, at most
// TOP_UP_EVERY_MS): it decides when to compile the next window and never times a sound. The
// graph is started by runtime.start(); its crossfade time is the transport's baseTime, so a clip
// at position p sounds at baseTime + p on whole frames. When the clock has already reached that
// time at the first window (a starved PLAY), the scheduler re-anchors at the first schedulable
// time instead of skipping the first clips (decision 'reanchor'; start() returns that baseTime).
//
// What plays where (docs/v31/timeline.md "Transport integration"):
//   pattern clip on a Sequence   compileSequence(item.sequence, ctx, handle.info.destination,
//                                item.startTime) with the node's accounting; the Sequence's
//                                TRIGGER edges gate their Envelopes at the clip start
//   pattern clip on an Oscillator  the oscillator is pattern-played: its free-running carrier
//                                is held at ROUTE_FLOOR (its `level` AudioParam is owned by the
//                                transport) and the voices play into a pattern bus (gain = the
//                                oscillator's level + runtime.baseOffset) connected to every
//                                AUDIO route leaving the oscillator, so they pass its routes and
//                                everything downstream (OSC → ADSR → FILTER → MASTER in the
//                                Basic Synth). Modulation edges into its `level` are re-routed
//                                onto the pattern bus gain (levelMods), so they modulate the
//                                voices, not the silenced carrier
//   gate event clip on an Envelope  handle.gate(startTime, duration); an Envelope the timeline
//                                gates is closed at PLAY (the timeline owns its gate)
//   automation lane              applyAutomation on handle.modTarget(key, 'linear').param, the
//                                lane's parameter owned by the transport (runtime.setOwnedParams:
//                                the runtime does not glide it); linear modulation offsets are
//                                added (runtime.baseOffset)
//   measurement clip             data: onMeasurement({ type: 'schedule', ... }); the Studio
//                                workspace's hook (measurement-run.js) runs the pass through
//                                the MEASURE MeasurementEngine (docs/v31/timeline.md)
// Anything else (an event clip on a source, a trigger event, a node that is not ready) is not
// played and listed with its reason in debugInfo().unplayed.
//
// Offline rendering (offline.js renderStudioOffline) runs THIS transport on the offline context,
// so a render is what live playback plays: same routing, ownership, gates, lanes and offsets.
//
// Exclusivity (decision "Studio output and the Playground voice are exclusive",
// docs/v31/compiler.md): start() calls onClaimOutput({ owner: 'studio' }) first; the UI stops
// the Playground voice there through its normal release path. A hook returning false refuses
// PLAY. When the Playground starts, the UI calls transport.stop().

import { STOP_PAD_S, compileSequence } from '../sequencer/compiler.js';
import { NODE_REGISTRY } from './registry.js';
import { createEngineHooks } from './adapters/engine-hooks.js';
import { PARAM_TAU_S } from './adapters/nodes.js';
import { createRamp } from './adapters/ramp.js';
import { CLEANUP_MARGIN_S, ROUTE_FLOOR, STUDIO_XFADE_S } from './compiler.js';
import { applyAutomation, paramBounds, scheduledValueAt } from './automation.js';
import {
  anchorEndTime, createTimelineScheduler, resolveEscape, safeHorizon,
} from './timeline-compiler.js';
import { effectiveTarget } from './timeline.js';
import { studioDiagnostic } from './validate.js';
import { NO_TRACE } from '../core/trace.js';

/** Reasons shown for what the transport does not play. */
export const TRANSPORT_TEXT = Object.freeze({
  noTarget: 'The clip has no target node.',
  patternTarget: (name) => `Pattern clips play on a Sequence or an Oscillator; this clip on `
    + `${name} is not played.`,
  eventTarget: (name) => `Only gate events on an Envelope are played; this clip on ${name} is `
    + 'not.',
  unavailable: (name, reason) => `${name} is not available${reason ? `: ${reason}` : '.'}`,
  noParameter: (name, param) => `${name} has no ${param} parameter to automate.`,
  claimRefused: 'The audio output is in use by another program.',
  editRefused: (message) => `Edit refused: the running Studio graph could not take it `
    + `(${message}). The last working graph keeps playing.`,
});

/** Gate records are kept this long after their release starts (bookkeeping only). */
const GATE_KEEP_S = 10;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** A linear segment { t0, v0, t1, v1 } at time t: v0 before t0, v1 from t1. */
const segValue = (g, t) => (t >= g.t1 || !(g.t1 > g.t0) ? g.v1
  : g.v0 + (g.v1 - g.v0) * clamp((t - g.t0) / (g.t1 - g.t0), 0, 1));
const LINEAR = 'linearRampToValueAtTime';
/**
 * The ramp a hold at t cuts on a param whose last transport segment is `g`: the segment itself
 * while it runs (or ends at t), or the ramp re-ended at t when `g` starts there from a hold.
 */
const segRamp = (g, t) => (g.t0 < t && t <= g.t1 ? LINEAR : (g.t0 === t && g.reEnd) || null);
/** The ramp a hold at t cuts on compiled automation `events` (timeline-compiler holdEvents). */
function rampAcross(events, t) {
  let next = null;
  for (const e of events) if (e.time >= t && (!next || e.time < next.time)) next = e;
  return next && next.method !== 'setValueAtTime' ? next.method : null;
}
const messageOf = (e) => (e && e.message) || String(e);
/** The message of a failed runtime result's first diagnostic, or `fallback`. */
const errorOf = (r, fallback) => (r.errors && r.errors[0] && r.errors[0].message) || fallback;

const PATTERN_TARGETS = Object.freeze(['sequence', 'oscillator']);
const REFUSALS = Object.freeze(['edit-refused', 'sync-refused']);

/**
 * Why the transport does not play a timeline clip, from the model alone (pure): null when it
 * plays it (a pattern clip on a Sequence or an Oscillator, a gate event on an Envelope, a
 * measurement clip as data), else the TRANSPORT_TEXT reason. At play time a target that is not
 * ready is reported too (debugInfo().unplayed). Offline rendering (offline.js) plans with it.
 */
export function clipPlayReason(model, clip) {
  if (clip.kind === 'measurement') return null;
  const id = effectiveTarget(model, clip);
  const n = id ? model.graph.nodes.find((x) => x.id === id) || null : null;
  if (!n) return TRANSPORT_TEXT.noTarget;
  if (clip.kind === 'pattern') {
    return PATTERN_TARGETS.includes(n.type) ? null : TRANSPORT_TEXT.patternTarget(n.metadata.name);
  }
  if (clip.kind === 'event') {
    return n.type === 'envelope' && (clip.payload.action || 'gate') === 'gate' ? null
      : TRANSPORT_TEXT.eventTarget(n.metadata.name);
  }
  return null;
}

export function createStudioTransport({
  runtime, engine, store, onClaimOutput = null, onMeasurement = null,
  registry = NODE_REGISTRY, lookAheadS = null, trace = NO_TRACE,
} = {}) {
  if (!runtime || typeof runtime.apply !== 'function') {
    throw new TypeError('createStudioTransport: a Studio runtime is required');
  }
  if (!store || typeof store.getModel !== 'function') {
    throw new TypeError('createStudioTransport: a Studio store is required');
  }
  const hooks = createEngineHooks(engine);
  const listeners = new Set();
  const voices = new Map(); // item key → { key, item, voice, nodeId, handle }
  const gates = new Map(); // gate key → { key, itemKey, clipId, nodeId, handle, start, end }
  const measures = new Map(); // item key → measurement data
  const lanes = new Map(); // lane id → { laneId, target, param, handle, events (as applied) }
  // oscillator id → { id, handle, bus, param, level, fadeAt (null: fresh), routes }
  const claims = new Map();
  // Carrier level AudioParam → the transport's last segment on it { t0, v0, t1, v1, reEnd }
  // (claim fade or release ramp), so the next claim or release holds its value instead of
  // stepping; after it ends, a level lane that drives the carrier (levelLane) has the value.
  const levelSegs = new WeakMap();
  // Modulation edge gain → { id, handle, toBus, toCarrier, retiredAt }: a CONTROL edge into a
  // pattern-played oscillator's level, re-routed onto its pattern bus (levelMods).
  const levelTaps = new Map();
  const gateOwned = new Map(); // envelope id → handle (closed at PLAY, gated by the timeline)
  const unplayed = new Map(); // clip or lane id → { code, reason }
  const decisions = [];
  const warnings = []; // Diagnostics, owner 'transport'
  let scheduler = null;
  let model = null;
  let playing = false;
  let startPosition = 0;
  let lastRevision = null;
  let timer = null;
  let lastError = null;
  let skippedLate = 0;
  let disposed = false;

  const emit = (type, detail) => {
    for (const fn of listeners) {
      try { fn(type, detail); } catch (e) { /* a listener's error is its own */ }
    }
  };
  const warn = (code, msg, entity = null) => {
    if (warnings.some((w) => w.message === msg)) return;
    const d = studioDiagnostic('transport', code, msg, entity);
    warnings.push(d);
    if (warnings.length > 50) warnings.shift();
    emit('warning', d);
  };
  /** A later model was applied: the refusals before it are no longer current. */
  const settled = () => {
    for (let i = warnings.length; i-- > 0;) {
      if (REFUSALS.includes(warnings[i].code)) warnings.splice(i, 1);
    }
  };
  const laneWarn = (id, e) => warn('automation-failed', `Automation ${id}: ${messageOf(e)}`,
    { kind: 'lane', id });
  const record = (d) => {
    decisions.push(d);
    if (decisions.length > 500) decisions.splice(0, decisions.length - 500);
  };
  const fail = (phase, error) => {
    lastError = { phase, message: messageOf(error) };
    trace.record('transport', 'play', { outcome: 'refused', detail: { phase,
      reason: lastError.message } });
    return { ok: false, phase, reason: lastError.message };
  };
  /** A step of this transport under the current operation. */
  const note = (kind, revision, outcome, r = null, code = null) => trace.record('transport',
    kind, { revision, outcome, code, entity: r && r.errors && r.errors[0] && r.errors[0].entity,
      detail: r && !r.ok ? { reason: errorOf(r, '') } : null });
  const ctxNow = () => hooks.ctx.currentTime;
  const nodeOf = (m, id) => (m && id ? m.graph.nodes.find((n) => n.id === id) || null : null);
  const nameOf = (id) => {
    const n = nodeOf(model, id);
    return n ? n.metadata.name : (id || 'no target');
  };
  const ready = (id) => {
    const h = id ? runtime.nodes.get(id) : null;
    return h && h.status === 'ready' ? h : null;
  };
  const measure = (event) => {
    if (typeof onMeasurement !== 'function') return;
    try { onMeasurement(event); } catch (e) {
      warn('measurement-callback-failed', `Measurement callback: ${messageOf(e)}`);
    }
  };
  const clearTimer = () => {
    if (timer != null) hooks.timers.clearTimeout(timer);
    timer = null;
  };
  const arm = (ms) => {
    clearTimer();
    timer = hooks.timers.setTimeout(tick, Math.max(1, Math.round(ms)));
  };

  // ------------------------------------------------------------ ownership

  function patternOscillators(m) {
    const out = new Set();
    for (const c of m.timeline.clips) {
      if (c.kind !== 'pattern') continue;
      const n = nodeOf(m, effectiveTarget(m, c));
      if (n && n.type === 'oscillator') out.add(n.id);
    }
    return out;
  }

  /** Envelope ids whose envelope node is gated from the timeline / a pattern TRIGGER edge. */
  function triggerEnvelopes(m, sourceId) {
    const out = [];
    for (const e of m.graph.edges) {
      if (e.from.node !== sourceId || e.from.port !== 'trigger' || e.to.port !== 'gate') continue;
      const n = nodeOf(m, e.to.node);
      if (n && n.type === 'envelope') out.push(n.id);
    }
    return out;
  }

  function gatedEnvelopes(m) {
    const out = new Set();
    for (const c of m.timeline.clips) {
      const id = effectiveTarget(m, c);
      if (c.kind === 'event' && (c.payload.action || 'gate') === 'gate') {
        const n = nodeOf(m, id);
        if (n && n.type === 'envelope') out.add(id);
      } else if (c.kind === 'pattern') {
        for (const env of triggerEnvelopes(m, id)) out.add(env);
      }
    }
    return out;
  }

  function ownedFor(m) {
    // `peak`: the lane's highest point, so the runtime sizes a frequency's Nyquist headroom from
    // what the lane plays, not from the static value it overrides (V431 review X1).
    const list = m.timeline.automation.map((l) => ({ node: l.target.node, param: l.target.param,
      peak: l.points.reduce((top, pt) => (finite(pt.value) && pt.value > top ? pt.value : top),
        -Infinity) }));
    for (const id of patternOscillators(m)) list.push({ node: id, param: 'level' });
    return list;
  }

  const laneOn = (id, param) => model.timeline.automation.some((l) => l.target.node === id
    && l.target.param === param);

  /** Route the pattern bus into every AUDIO route leaving the oscillator (and prune old ones). */
  function connectRoutes(claim) {
    const now = ctxNow();
    const live = new Set();
    for (const eh of runtime.edges.values()) {
      if (eh.fromNode !== claim.id || eh.kind !== 'audio' || eh.status !== 'active' || !eh.gain) {
        continue;
      }
      live.add(eh.gain);
      if (!claim.routes.has(eh.gain)) {
        claim.bus.connect(eh.gain);
        claim.routes.set(eh.gain, null);
      }
    }
    for (const [g, retiredAt] of claim.routes) {
      if (live.has(g)) continue;
      // A retired route fades out with the runtime's crossfade; the bus leaves it afterwards.
      if (retiredAt === null) claim.routes.set(g, now);
      else if (now - retiredAt > STUDIO_XFADE_S + CLEANUP_MARGIN_S) {
        try { claim.bus.disconnect(g); } catch (e) { /* already gone */ }
        claim.routes.delete(g);
      }
    }
  }

  /**
   * The base level of a pattern-played oscillator: its `level` plus the constant part its
   * modulation edges add (runtime.baseOffset), as the runtime would apply it to the carrier.
   */
  function patternLevel(id) {
    const n = nodeOf(model, id);
    const level = n ? n.params.level : 1;
    const off = typeof runtime.baseOffset === 'function' ? runtime.baseOffset(id, 'level') : 0;
    return level + off;
  }

  /**
   * A path gain with a click-free ramp (adapters/ramp.js): at `from`, ramped to `to` over the
   * runtime crossfade from `at`; with `at` null (nothing sounds yet) it starts at `to`.
   */
  function pathGain(acct, from, to, at) {
    const ctx = hooks.ctx;
    const node = acct.track(ctx.createGain());
    const ramp = createRamp(node.gain, at === null ? to : from, ctx.currentTime, ctx.sampleRate);
    if (at !== null && from !== to) ramp.to(to, at, STUDIO_XFADE_S);
    return { node, ramp };
  }

  /**
   * Modulation into a pattern-played oscillator's level (docs/v31/timeline.md "Transport
   * integration"): every active CONTROL edge into its `level` is re-routed from the carrier's
   * level AudioParam (held at ROUTE_FLOOR) onto the pattern bus gain, so it modulates the voices.
   * The edge's depth gain feeds two path gains: toBus → bus.gain (1) and toCarrier → the
   * carrier's level (0). `fadeAt` (a sounding oscillator claimed now): toCarrier ramps 1 → 0 with
   * the carrier's own fade, so the move is click-free; edges built in this transaction are silent
   * (their ramp starts at the crossfade time) and move at once. Taps of retired edges leave
   * after the runtime's crossfade, like the bus routes.
   */
  function levelMods(claim, fadeAt = null) {
    const now = ctxNow();
    const live = new Set();
    for (const eh of runtime.edges.values()) {
      if (eh.toNode !== claim.id || eh.kind !== 'control' || eh.toPort !== 'level'
        || eh.status !== 'active' || !eh.gain) continue;
      live.add(eh.gain);
      let tap = levelTaps.get(eh.gain);
      if (tap && tap.handle !== claim.handle) tap = null;
      if (!tap) {
        const toCarrier = pathGain(claim.handle.acct, 1, 0, fadeAt);
        const toBus = pathGain(claim.handle.acct, 1, 1, null);
        eh.gain.connect(toCarrier.node);
        toCarrier.node.connect(claim.param);
        try { eh.gain.disconnect(claim.param); } catch (e) { /* not connected directly */ }
        eh.gain.connect(toBus.node);
        toBus.node.connect(claim.bus.gain);
        tap = { id: claim.id, handle: claim.handle, toBus, toCarrier, bus: claim.bus,
          retiredAt: null };
        levelTaps.set(eh.gain, tap);
      } else if (tap.bus !== claim.bus) {
        // Claimed again: the voices play into a new bus; the carrier path fades out again.
        try { tap.toBus.node.disconnect(); } catch (e) { /* already disconnected */ }
        tap.toBus.node.connect(claim.bus.gain);
        tap.bus = claim.bus;
        tap.toCarrier.ramp.to(0, fadeAt === null ? hooks.soon() : fadeAt, STUDIO_XFADE_S);
      }
      tap.retiredAt = null;
    }
    for (const [g, tap] of levelTaps) {
      if (tap.id !== claim.id || live.has(g)) continue;
      if (tap.handle !== claim.handle) {
        levelTaps.delete(g); // the replaced node's taps are disposed with it
      } else if (tap.retiredAt === null) {
        tap.retiredAt = now; // the runtime fades the retired edge out, then disposes it
      } else if (now - tap.retiredAt > STUDIO_XFADE_S + CLEANUP_MARGIN_S) {
        for (const x of [tap.toBus.node, tap.toCarrier.node]) {
          try { x.disconnect(); } catch (e) { /* already disconnected */ }
          tap.handle.acct.untrack(x);
        }
        levelTaps.delete(g);
      }
    }
  }

  /**
   * Hold a carrier level at t without a step (envelope.js holdAt): v is the value its schedule
   * has at t, `ramp` the ramp method in progress across t (segRamp, rampAcross) or null.
   * cancelAndHoldAtTime when available; else cancelScheduledValues, which would drop that ramp
   * (the param would jump back to its start), so it is re-ended at t with v. Either way anchored
   * with setValueAtTime(v, t), as cancelAndHoldAtTime inserts nothing after the last event.
   * Returns the method re-ended at t, or null.
   */
  function holdLevel(param, t, v, ramp) {
    let reEnd = null;
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(t);
    else {
      param.cancelScheduledValues(t);
      if (ramp && (ramp === LINEAR || v > 0)) {
        param[ramp](v, t);
        reEnd = ramp;
      }
    }
    param.setValueAtTime(v, t);
    return reEnd;
  }

  /** The record of a lane on oscillator `id`'s level that drives `param` (or null). */
  function levelLane(id, param) {
    for (const rec of lanes.values()) {
      if (rec.target.node === id && rec.target.param === 'level' && rec.param === param) {
        return rec;
      }
    }
    return null;
  }

  function claimOscillator(id, fresh) {
    const h = ready(id);
    const n = nodeOf(model, id);
    if (!h || !h.acct || !n) return null;
    const t = h.modTarget('level', 'linear');
    if (!t || !t.param) return null;
    const ctx = hooks.ctx;
    const now = ctx.currentTime;
    const level = patternLevel(id);
    const bus = h.acct.track(ctx.createGain());
    bus.gain.value = level;
    bus.gain.setValueAtTime(level, now);
    const param = t.param;
    let fadeAt = null;
    let seg;
    if (fresh) {
      // Built in this transaction: its source starts at the crossfade time, nothing rendered.
      param.setValueAtTime(ROUTE_FLOOR, now);
      seg = { t0: now, v0: ROUTE_FLOOR, t1: now, v1: ROUTE_FLOOR };
    } else {
      const s = hooks.soon();
      fadeAt = s;
      // The fade starts from the value the carrier's schedule has at s: the release ramp's while
      // it runs; after it, the level lane's that drives the carrier (releaseClaim hands it
      // over); otherwise its level (the runtime's base while it was not owned).
      const prev = levelSegs.get(param);
      const lane = levelLane(id, param);
      let from = level;
      let ramp = null;
      if (prev && s <= prev.t1) {
        from = segValue(prev, s);
        ramp = segRamp(prev, s);
      } else if (lane) {
        from = scheduledValueAt(lane.events, s, level);
        ramp = rampAcross(lane.events, s);
      }
      const reEnd = holdLevel(param, s, from, ramp);
      param.linearRampToValueAtTime(ROUTE_FLOOR, s + STUDIO_XFADE_S);
      seg = { t0: s, v0: from, t1: s + STUDIO_XFADE_S, v1: ROUTE_FLOOR, reEnd };
    }
    levelSegs.set(param, seg);
    const claim = { id, handle: h, bus, param, level, fadeAt, routes: new Map() };
    claims.set(id, claim);
    connectRoutes(claim);
    levelMods(claim, fadeAt);
    return claim;
  }

  function releaseClaim(id) {
    const c = claims.get(id);
    claims.delete(id);
    if (!c || ready(id) !== c.handle) return; // replaced or gone: its bus went with it
    const s = hooks.soon();
    // Released while the claim's own fade runs (or right after a fresh claim): continue from
    // the value that fade has at s, not from the floor.
    const seg = levelSegs.get(c.param);
    const held = seg ? segValue(seg, s) : ROUTE_FLOOR;
    const end = s + STUDIO_XFADE_S;
    // A level lane (on the pattern bus while claimed) drives the carrier again: the crossfade
    // ends on the lane's value at its end and the lane continues on the carrier from there,
    // so rebindLanes (which would re-anchor it at the earlier horizon) leaves it.
    const lane = levelLane(id, c.bus.gain);
    const to = lane ? scheduledValueAt(lane.events, end, patternLevel(id)) : patternLevel(id);
    const reEnd = holdLevel(c.param, s, held, seg ? segRamp(seg, s) : null);
    c.param.linearRampToValueAtTime(to, end);
    levelSegs.set(c.param, { t0: s, v0: held, t1: end, v1: to, reEnd });
    if (lane) {
      try {
        applyAutomation(c.param, lane.events.filter((e) => e.time > end));
        lane.param = c.param;
      } catch (e) {
        laneWarn(lane.laneId, e);
      }
    }
    // The modulation returns to the carrier with its level.
    for (const tap of levelTaps.values()) {
      if (tap.id === id && tap.handle === c.handle) tap.toCarrier.ramp.to(1, s, STUDIO_XFADE_S);
    }
  }

  function ownEnvelope(id, fresh) {
    const h = ready(id);
    if (!h || typeof h.release !== 'function') return;
    h.release(fresh ? ctxNow() : hooks.soon());
    gateOwned.set(id, h);
  }

  function disownEnvelope(id) {
    const h = gateOwned.get(id);
    gateOwned.delete(id);
    if (h && ready(id) === h) h.gate(hooks.soon(), null); // open again, as without a timeline
  }

  // ------------------------------------------------------------ playing items

  function skip(it, code, reason) {
    unplayed.set(it.clipId, { code, reason });
  }

  function playPattern(it) {
    const n = nodeOf(model, it.target);
    if (!n) return skip(it, 'no-target', TRANSPORT_TEXT.noTarget);
    const h = ready(it.target);
    if (!h) {
      const raw = runtime.nodes.get(it.target);
      return skip(it, 'target-unavailable', TRANSPORT_TEXT.unavailable(n.metadata.name,
        raw && raw.reason));
    }
    let dest = null;
    if (n.type === 'sequence') dest = h.info && h.info.destination;
    else if (n.type === 'oscillator') {
      const c = claims.get(it.target);
      dest = c && c.handle === h ? c.bus : null;
    }
    if (!dest || !h.acct) {
      return skip(it, 'pattern-target', TRANSPORT_TEXT.patternTarget(n.metadata.name));
    }
    const acct = h.acct;
    const own = [];
    const voice = compileSequence(it.sequence, hooks.ctx, dest, it.startTime, {
      timers: hooks.timers,
      track: (node) => {
        own.push(node);
        return acct.track(node);
      },
      source: (node) => acct.source(node),
      // A finished voice leaves the engine accounting at once (long loops never accumulate).
      onEnded: () => {
        for (const x of own) acct.untrack(x);
        own.length = 0;
      },
    });
    voices.set(it.key, { key: it.key, item: it, voice, nodeId: it.target, handle: h });
    unplayed.delete(it.clipId);
    for (const env of triggerEnvelopes(model, it.target)) {
      addGate(`${it.key}>${env}`, it, env, it.startTime, it.endTime);
    }
    return null;
  }

  function addGate(key, it, envId, start, end, deferred = null) {
    const h = ready(envId);
    if (!h || typeof h.gate !== 'function') {
      return skip(it, 'target-unavailable', TRANSPORT_TEXT.unavailable(nameOf(envId)));
    }
    gates.set(key, { key, itemKey: it.key, clipId: it.clipId, nodeId: envId, handle: h, start,
      end });
    if (deferred && deferred.has(envId)) return null; // rebuilt below
    h.gate(start, end - start);
    return null;
  }

  function playEvent(it, deferred) {
    const n = nodeOf(model, it.target);
    if (!n) return skip(it, 'no-target', TRANSPORT_TEXT.noTarget);
    if (n.type !== 'envelope' || it.action !== 'gate') {
      return skip(it, 'event-target', TRANSPORT_TEXT.eventTarget(n.metadata.name));
    }
    unplayed.delete(it.clipId);
    return addGate(it.key, it, it.target, it.startTime, it.endTime, deferred);
  }

  function measurementData(it) {
    return { key: it.key, clipId: it.clipId, action: it.action, target: it.target,
      trackId: it.trackId, pass: it.pass, position: it.position, startTime: it.startTime,
      endTime: it.endTime, duration: it.duration, truncated: it.truncated };
  }

  function playItem(it, deferred = null) {
    if (it.type === 'pattern') playPattern(it);
    else if (it.type === 'event') playEvent(it, deferred);
    else if (it.type === 'measurement') {
      const data = measurementData(it);
      measures.set(it.key, data);
      unplayed.delete(it.clipId);
      measure({ type: 'schedule', ...data });
    }
  }

  const gatesOf = (itemKey) => [...gates.values()].filter((g) => g.itemKey === itemKey);

  /**
   * Re-render an Envelope's contour from `horizon` from the gate records (after an edit or a
   * STOP touched one of them): hold (or close) at the horizon, then the sounding gate's release
   * and every later gate again. A gate whose envelope node was replaced re-attacks at the
   * horizon on the new node.
   */
  function rebuildEnvelope(envId, horizon) {
    const h = ready(envId);
    if (!h || typeof h.hold !== 'function') return;
    const list = [...gates.values()].filter((g) => g.nodeId === envId && g.end > horizon)
      .sort((a, b) => a.start - b.start);
    const sounding = list.filter((g) => g.start < horizon && g.handle === h);
    if (sounding.length) h.hold(horizon);
    else h.release(horizon);
    for (const g of list) {
      if (g.start < horizon && g.handle === h) h.release(g.end);
      else {
        if (g.start < horizon) g.start = horizon; // re-attack on a replaced node
        g.handle = h;
        h.gate(g.start, g.end - g.start);
      }
    }
  }

  // ------------------------------------------------------------ automation

  function paramFor(target, reasonKey) {
    const n = nodeOf(model, target.node);
    const h = ready(target.node);
    if (!n || !h) {
      unplayed.set(reasonKey, { code: 'target-unavailable',
        reason: TRANSPORT_TEXT.unavailable(n ? n.metadata.name : target.node) });
      return null;
    }
    const def = registry.param(n.type, target.param);
    const offset = typeof runtime.baseOffset === 'function'
      ? runtime.baseOffset(target.node, target.param) : 0;
    const bounds = def ? paramBounds(def, hooks.ctx.sampleRate) : null;
    const c = claims.get(target.node);
    if (c && c.handle === h && target.param === 'level') {
      // A pattern-played oscillator: its level is the pattern bus (the voices).
      return { param: c.bus.gain, handle: h, offset, bounds };
    }
    let t = null;
    try { t = h.modTarget(target.param, 'linear'); } catch (e) { t = null; }
    if (!t || !t.param) {
      unplayed.set(reasonKey, { code: 'no-parameter', reason: (t && t.reason)
        || TRANSPORT_TEXT.noParameter(n.metadata.name, target.param) });
      return null;
    }
    return { param: t.param, handle: h, offset, bounds };
  }

  /** Lane values + the modulation edges' constant offset (exact when there is none). */
  function shift(events, dest) {
    if (!dest.offset) return events;
    return events.map((e) => {
      let v = e.value + dest.offset;
      if (dest.bounds) v = clamp(v, dest.bounds.min, dest.bounds.max);
      if (e.method === 'exponentialRampToValueAtTime' && !(v > 0)) {
        return { ...e, method: 'linearRampToValueAtTime', value: v };
      }
      return { ...e, value: v };
    });
  }

  function applyLane(laneId, target, events, cancelFrom = null) {
    const dest = paramFor(target, laneId);
    if (!dest) return;
    const evs = shift(events, dest);
    try {
      applyAutomation(dest.param, evs, { cancelFrom });
    } catch (e) {
      laneWarn(laneId, e);
      return;
    }
    let rec = lanes.get(laneId);
    if (!rec || rec.param !== dest.param) {
      rec = { laneId, target: { ...target }, param: dest.param, handle: dest.handle, events: [] };
    }
    if (finite(cancelFrom)) rec.events = rec.events.filter((e) => e.time < cancelFrom);
    rec.events.push(...evs);
    lanes.set(laneId, rec);
    unplayed.delete(laneId);
  }

  /** A lane whose node was rebuilt continues on the new AudioParam from the horizon. */
  function rebindLanes(horizon) {
    for (const rec of [...lanes.values()]) {
      const dest = paramFor(rec.target, rec.laneId);
      if (!dest || dest.param === rec.param) continue;
      const v = scheduledValueAt(rec.events, horizon, null);
      const evs = [...(v === null ? [] : [{ method: 'setValueAtTime', value: v, time: horizon }]),
        ...rec.events.filter((e) => e.time > horizon)];
      try {
        applyAutomation(dest.param, evs, { cancelFrom: horizon });
      } catch (e) {
        laneWarn(rec.laneId, e);
        continue;
      }
      rec.events = rec.events.filter((e) => e.time < horizon).concat(evs);
      rec.param = dest.param;
      rec.handle = dest.handle;
      record({ key: rec.laneId, decision: 'rebind', at: horizon, reason: 'node-replaced' });
    }
  }

  function applyLaneEdit(a) {
    if (!a.removed) {
      applyLane(a.laneId, a.target, a.events, a.cancelFrom);
      return;
    }
    // The lane is gone: hold its exact value at the horizon, then glide back to the base value
    // the runtime owns again (setTargetAtTime τ PARAM_TAU_S, as the runtime's own glides).
    lanes.delete(a.laneId);
    const dest = paramFor(a.target, a.laneId);
    unplayed.delete(a.laneId); // the lane no longer exists, whether or not its node does
    if (!dest) return;
    try {
      applyAutomation(dest.param, shift(a.events, dest), { cancelFrom: a.cancelFrom });
      const n = nodeOf(model, a.target.node);
      const base = n && n.params[a.target.param];
      if (finite(base)) {
        let v = base + dest.offset;
        if (dest.bounds) v = clamp(v, dest.bounds.min, dest.bounds.max);
        dest.param.setTargetAtTime(v, a.cancelFrom, PARAM_TAU_S);
      }
    } catch (e) {
      laneWarn(a.laneId, e);
    }
  }

  // ------------------------------------------------------------ plans

  function releaseItem(key, at, touched) {
    const v = voices.get(key);
    if (v) v.voice.stop(at);
    for (const g of gatesOf(key)) {
      g.end = Math.min(g.end, at);
      touched.add(g.nodeId);
    }
  }

  function cancelItem(key, touched) {
    const v = voices.get(key);
    if (v) {
      v.voice.dispose(); // never started: never heard
      voices.delete(key);
    }
    for (const g of gatesOf(key)) {
      gates.delete(g.key);
      touched.add(g.nodeId);
    }
    const m = measures.get(key);
    if (m) {
      measures.delete(key);
      measure({ type: 'cancel', key, clipId: m.clipId });
    }
  }

  /** Apply a scheduler.edit() plan (EDIT_POLICY, docs/v31/timeline.md). */
  function applyEdit(plan) {
    const touched = new Set();
    for (const key of plan.cancel) cancelItem(key, touched);
    for (const { key, at } of plan.release) {
      releaseItem(key, at, touched);
      if (measures.has(key)) measure({ type: 'release', key, at });
    }
    for (const { key, at } of plan.retime) {
      const v = voices.get(key);
      if (v) v.voice.stop(at);
      for (const g of gatesOf(key)) {
        g.end = at;
        touched.add(g.nodeId);
      }
      const m = measures.get(key);
      if (m) {
        m.endTime = at;
        measure({ type: 'retime', key, at });
      }
    }
    // New gates on an envelope that is rebuilt anyway are applied by the rebuild.
    const deferred = new Set(touched);
    for (const it of plan.schedule) {
      if (it.type === 'event' && touched.has(it.target)) deferred.add(it.target);
    }
    for (const it of plan.schedule) playItem(it, deferred);
    for (const env of touched) rebuildEnvelope(env, plan.horizon);
    for (const a of plan.automation) applyLaneEdit(a);
    for (const d of plan.decisions) record(d);
  }

  /** Apply a scheduler.stop() plan (STOP_POLICY): release, cancel, hold every lane. */
  function applyStop(plan) {
    const touched = new Set();
    for (const key of plan.cancel) cancelItem(key, touched);
    for (const { key, at } of plan.release) releaseItem(key, at, touched);
    for (const env of touched) rebuildEnvelope(env, plan.at);
    for (const a of plan.automation) {
      if (!a.target) continue;
      const dest = paramFor(a.target, a.laneId);
      if (!dest) continue;
      try {
        applyAutomation(dest.param, shift(a.events, dest), { cancelFrom: a.cancelFrom });
      } catch (e) {
        laneWarn(a.laneId, e);
      }
    }
    if (measures.size) measure({ type: 'stop', at: plan.at });
    measures.clear();
    record({ key: null, decision: 'stop', at: plan.at, released: plan.release.length,
      cancelled: plan.cancel.length });
  }

  // ------------------------------------------------------------ runtime changes

  const freshOf = (r) => new Set(r && r.ok && r.applied ? r.ops.filter((o) => o.op === 'node-add'
    || o.op === 'node-replace').map((o) => o.id) : []);

  /** Bring claims, envelope ownership and lanes in line with the runtime after an apply. */
  function afterApply(fresh) {
    const horizon = safeHorizon(ctxNow(), hooks.ctx.sampleRate);
    const wantOsc = patternOscillators(model);
    for (const [id, c] of [...claims]) {
      const h = ready(id);
      if (!wantOsc.has(id)) releaseClaim(id);
      else if (h !== c.handle) {
        claims.delete(id);
        if (h) claimOscillator(id, fresh.has(id));
      } else {
        connectRoutes(c);
        levelMods(c);
        const level = patternLevel(id);
        if (level !== c.level && !laneOn(id, 'level')) {
          c.bus.gain.setTargetAtTime(level, ctxNow(), PARAM_TAU_S);
          c.level = level;
        }
      }
    }
    for (const id of wantOsc) if (!claims.has(id)) claimOscillator(id, fresh.has(id));
    const wantEnv = gatedEnvelopes(model);
    for (const [id, h] of [...gateOwned]) {
      if (!wantEnv.has(id)) disownEnvelope(id);
      else if (ready(id) !== h) {
        gateOwned.delete(id);
        if (ready(id)) {
          ownEnvelope(id, fresh.has(id));
          rebuildEnvelope(id, horizon);
        }
      }
    }
    for (const id of wantEnv) if (!gateOwned.has(id)) ownEnvelope(id, fresh.has(id));
    for (const v of voices.values()) {
      if (v.handle !== ready(v.nodeId) && !v.replacedNoted) {
        // A sounding voice fades out with the node it plays into (the runtime's crossfade);
        // future voices are rebuilt by scheduler.edit (they are always rescheduled).
        v.replacedNoted = true;
        record({ key: v.key, clipId: v.item.clipId, decision: 'release', at: horizon,
          reason: 'node-replaced' });
      }
    }
    rebindLanes(horizon);
  }

  // ------------------------------------------------------------ the wake-up

  function prune(now) {
    for (const [key, v] of voices) if (v.voice.ended) voices.delete(key);
    for (const [key, g] of gates) if (g.end + GATE_KEEP_S < now) gates.delete(key);
    for (const [key, m] of measures) if (m.endTime + STOP_PAD_S < now) measures.delete(key);
    for (const rec of lanes.values()) {
      let i = 0;
      while (i + 1 < rec.events.length && rec.events[i + 1].time <= now) i++;
      if (i > 0) rec.events = rec.events.slice(i);
    }
  }

  function tick() {
    timer = null;
    if (!playing) return;
    const ctx = hooks.ctx;
    if (!ctx || ctx.state === 'closed') {
      abort('context');
      return;
    }
    if (store.getRevision() !== lastRevision) trace.run(syncNow);
    if (!playing) return;
    const now = ctx.currentTime;
    const r = scheduler.advance(now);
    if (r.reanchored) {
      // The clock reached the anchor before the first window (starved PLAY / locate): the
      // playback starts at the first schedulable time instead of skipping its first clips.
      record({ key: null, decision: 'reanchor', from: r.reanchored.from, to: r.reanchored.to,
        at: now });
    }
    for (const it of r.items) playItem(it);
    for (const a of r.automation) applyLane(a.laneId, a.target, a.events);
    for (const it of r.skipped) {
      skippedLate++;
      record({ key: it.key, clipId: it.clipId, decision: 'skipped-late', at: now });
    }
    for (const w of r.warnings) warn('timeline', w);
    prune(now);
    for (const c of claims.values()) {
      if (ready(c.id) !== c.handle) continue;
      connectRoutes(c);
      levelMods(c);
    }
    const wake = scheduler.nextWakeMs(now);
    if (wake !== null) {
      arm(wake);
      return;
    }
    const end = anchorEndTime(scheduler.getState().anchor) + STOP_PAD_S;
    if (now >= end) {
      record({ key: null, decision: 'end', at: now });
      stop({ reason: 'end' });
      emit('ended', { at: now });
    } else {
      arm((end - now) * 1000 + 1);
    }
  }

  // ------------------------------------------------------------ public API

  /**
   * The runtime refused `r` (validate or prepare): it keeps its last good graph, so the transport
   * keeps the model, ownership and schedule of that graph; the refusal becomes lastError and a
   * diagnostic. -> the refusal text.
   */
  function refusedBy(r, code, revision) {
    runtime.setOwnedParams(ownedFor(model));
    note(code === 'sync-refused' ? 'sync' : 'admit', revision, 'refused', r, code);
    const message = errorOf(r, 'unknown error');
    lastError = { phase: r.phase, code, message };
    const text = TRANSPORT_TEXT.editRefused(message);
    warn(code, text, (r.errors && r.errors[0] && r.errors[0].entity) || null);
    return text;
  }

  function syncNow() {
    const rev = store.getRevision();
    lastRevision = rev; // not retried every wake-up; the next store change tries again
    const next = store.getModel();
    runtime.setOwnedParams(ownedFor(next));
    const r = runtime.apply(next, { revision: rev });
    if (!r.ok) {
      refusedBy(r, 'sync-refused', rev);
      return { ok: false, synced: false, revision: rev, applied: r };
    }
    note('sync', rev, 'applied');
    settled();
    model = next;
    afterApply(freshOf(r));
    const plan = scheduler.edit(next, ctxNow());
    applyEdit(plan);
    return { ok: true, synced: true, revision: rev, applied: r, plan };
  }

  /**
   * The store's commit gate (ADR 0035 "the model change is refused"). While playing, `next` is
   * applied to the running graph before the store commits it, as revision `revision`: on success
   * the transport follows it (the store's onChange then finds nothing left to sync); when the
   * runtime refuses (validate or prepare), the owned parameters go back to the current model,
   * nothing else changed, and the refusal is returned for the store to refuse the edit with.
   * While stopped every change is admitted: PLAY applies the model then.
   */
  function admit(next, info) {
    return trace.run(() => admitNow(next, info));
  }

  function admitNow(next, { revision } = {}) {
    if (!playing || disposed || !next) {
      trace.record('transport', 'admit', { revision, outcome: 'not-applied',
        detail: { playing, disposed } });
      return null;
    }
    runtime.setOwnedParams(ownedFor(next));
    const r = runtime.apply(next, { revision });
    if (!r.ok) {
      return { ok: false, phase: r.phase, reason: refusedBy(r, 'edit-refused', revision) };
    }
    note('admit', revision, 'admitted');
    lastRevision = revision;
    settled();
    model = next;
    afterApply(freshOf(r));
    applyEdit(scheduler.edit(next, ctxNow()));
    if (playing && timer == null) arm(1);
    return null;
  }

  function sync() {
    if (!playing) return { ok: true, synced: false };
    if (store.getRevision() === lastRevision) return { ok: true, synced: false };
    const result = trace.run(syncNow);
    if (playing && timer == null) arm(1);
    return result;
  }

  function clampPosition(p) {
    return finite(p) ? Math.max(0, p) : startPosition;
  }

  function start(args) {
    return trace.run(() => startNow(args));
  }

  function startNow({ position } = {}) {
    if (disposed) return fail('start', 'The Studio transport is disposed.');
    if (playing) return { ok: true, playing: true, already: true };
    const pos = clampPosition(position);
    if (typeof onClaimOutput === 'function') {
      let claimed;
      try {
        claimed = onClaimOutput({ owner: 'studio', position: pos });
      } catch (e) {
        return fail('claim', e);
      }
      if (claimed === false) return fail('claim', TRANSPORT_TEXT.claimRefused);
    }
    const m = store.getModel();
    const rev = store.getRevision();
    runtime.setOwnedParams(ownedFor(m));
    const applied = runtime.apply(m, { revision: rev });
    if (!applied.ok) {
      runtime.setOwnedParams([]);
      return fail('apply', errorOf(applied, 'The Studio graph is invalid.'));
    }
    let baseTime;
    let fresh;
    if (runtime.state !== 'running') {
      const s = runtime.start();
      if (!s.ok) {
        runtime.setOwnedParams([]);
        return fail('start', errorOf(s, 'Audio could not start.'));
      }
      baseTime = s.at;
      fresh = new Set(runtime.nodes.keys());
    } else {
      baseTime = hooks.soon();
      fresh = freshOf(applied);
    }
    model = m;
    lastRevision = rev;
    startPosition = pos;
    lastError = null;
    unplayed.clear();
    warnings.length = 0;
    playing = true;
    scheduler = createTimelineScheduler(m, { sampleRate: hooks.ctx.sampleRate, baseTime,
      startPosition: pos, registry, lookAheadS });
    afterApply(fresh);
    emit('state', { playing: true });
    tick();
    trace.record('transport', 'play', { revision: rev, outcome: 'playing',
      detail: { position: pos, baseTime: scheduler.getState().anchor.baseTime } });
    return { ok: true, playing: true, baseTime: scheduler.getState().anchor.baseTime,
      startPosition: pos, revision: rev };
  }

  /** Forget the playback without touching audio (context closed, runtime stopped elsewhere). */
  function abort(reason) {
    clearTimer();
    playing = false;
    trace.record('transport', 'stop', { outcome: 'aborted', detail: { reason } });
    for (const v of voices.values()) {
      try { v.voice.dispose(); } catch (e) { /* the context is gone */ }
    }
    voices.clear();
    gates.clear();
    measures.clear();
    lanes.clear();
    claims.clear();
    levelTaps.clear();
    gateOwned.clear();
    try { runtime.setOwnedParams([]); } catch (e) { /* disposed */ }
    record({ key: null, decision: 'abort', reason });
    emit('state', { playing: false, reason });
  }

  const counts = (c) => ({ ...c, voices: voices.size });

  function stop(args) {
    return trace.run(() => stopNow(args));
  }

  function stopNow({ fast = false, reason = 'stop' } = {}) {
    if (!playing) return runtime.stop({ fast }).then(counts);
    trace.record('transport', 'stop', { revision: lastRevision, outcome: 'stopped',
      detail: { reason, fast } });
    clearTimer();
    const ctx = hooks.ctx;
    if (ctx && ctx.state !== 'closed') applyStop(scheduler.stop(ctx.currentTime));
    playing = false;
    lanes.clear();
    claims.clear();
    levelTaps.clear();
    gateOwned.clear();
    runtime.setOwnedParams([]);
    emit('state', { playing: false, reason });
    return runtime.stop({ fast }).then((c) => {
      // Everything is silent and released by now; end the voices' own bookkeeping too.
      for (const v of voices.values()) {
        try { v.voice.dispose(); } catch (e) { /* already ended */ }
      }
      voices.clear();
      gates.clear();
      return counts(c);
    });
  }

  function locate(position) {
    const pos = clampPosition(position);
    startPosition = pos;
    if (!playing) return playhead();
    clearTimer();
    applyStop(scheduler.stop(ctxNow()));
    scheduler = createTimelineScheduler(model, { sampleRate: hooks.ctx.sampleRate,
      baseTime: hooks.soon(), startPosition: pos, registry, lookAheadS });
    record({ key: null, decision: 'locate', position: pos });
    tick();
    return playhead();
  }

  function setLoop(patch = {}) {
    const r = store.dispatch({ type: 'LOOP_SET', ...patch });
    if (r.ok) sync();
    return r;
  }

  function escape(state = {}) {
    const action = resolveEscape({ gesture: !!state.gesture, popup: !!state.popup,
      selectionMode: !!state.selectionMode,
      audioActive: playing || runtime.state === 'running' });
    if (action === 'stop-audio') stop({ fast: true, reason: 'escape' });
    return action;
  }

  function playhead() {
    if (!playing || !scheduler) return { position: startPosition, pass: 0, playing: false };
    const p = scheduler.playhead(ctxNow());
    if (!p) {
      return { position: scheduler.getState().anchor.end, pass: 0, playing: false, ended: true };
    }
    return p;
  }

  const offRuntime = runtime.on((type, detail) => {
    if (type === 'state' && detail !== 'running' && playing) abort('runtime-stopped');
  });

  function dispose() {
    if (disposed) return Promise.resolve(counts({}));
    const p = stop();
    disposed = true;
    offRuntime();
    return p.then((c) => {
      listeners.clear();
      return c;
    });
  }

  function debugInfo() {
    const st = scheduler ? scheduler.getState() : null;
    return {
      playing,
      startPosition,
      playhead: playhead(),
      scheduledUntil: st ? st.scheduledUntil : null,
      baseTime: st ? st.anchor.baseTime : null,
      loop: st ? st.anchor.loop : null,
      voiceCount: voices.size,
      liveVoices: [...voices.values()].filter((v) => !v.voice.ended).length,
      gateCount: gates.size,
      measurementCount: measures.size,
      lanes: [...lanes.values()].map((l) => ({ laneId: l.laneId, target: { ...l.target },
        scheduled: l.events.length })),
      claims: [...claims.keys()],
      gatedEnvelopes: [...gateOwned.keys()],
      ownedParams: typeof runtime.ownedParams === 'function' ? runtime.ownedParams() : [],
      unplayed: [...unplayed].map(([id, u]) => ({ id, ...u })),
      skippedLate,
      decisions: [...decisions],
      warnings: warnings.map((w) => w.message),
      diagnostics: [...warnings],
      lastError,
    };
  }

  return Object.freeze({
    start,
    stop,
    locate,
    returnToStart: () => locate(0),
    setLoop,
    sync,
    admit,
    escape,
    playhead,
    debugInfo,
    dispose,
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get playing() { return playing; },
  });
}

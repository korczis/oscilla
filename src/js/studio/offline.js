// Offline rendering of a Studio (spec §105, §175-§176; plan issue V427). The plan is pure;
// the renderer runs the SAME Studio compiler, runtime, node adapters AND transport
// (transport.js) on an OfflineAudioContext through the existing audio/offline-renderer.js path,
// so a WAV export is what live playback plays, rendered — never a second engine (§42) and never
// a second copy of the timeline routing.
//
//   planOfflineRender(model, { duration, registry }) -> plan
//     plan = { ok, refused, duration, render: { sampleRate, channels }, errors: [Diagnostic],
//              limitations: [text], warnings: [text],
//              nodes: [{ id, name, type, role: 'rendered' | 'skipped' | 'refused', reason }],
//              clips: [{ id, kind, target, rendered, reason }],
//              automation: [{ id, target, rendered, reason }] }
//     Registry capabilities decide (§176): `offline` nodes render; live-only SOURCES that need
//     input permission (Microphone) REFUSE the render with an explicit limitation (§105, §175):
//     a render without them would not be the graph the user built. Analysis views and
//     measurement data nodes are skipped (they observe, they do not sound). The Recorder sets
//     the render format (its sample rate and channels; DEFAULT_RENDER otherwise).
//     Timeline: exactly what the live transport plays (transport.js clipPlayReason): pattern
//     clips on a Sequence (into its bus) or on an Oscillator (pattern-played: carrier held at
//     ROUTE_FLOOR, voices into a pattern bus feeding the oscillator's AUDIO routes), gate events
//     on Envelopes, automation lanes on their AudioParam with the parameter owned by the lane and
//     the modulation edges' constant offsets added. Everything else is listed as a limitation
//     with the transport's reason; measurement clips run live through the measurement engine.
//   renderStudioOffline(model, { duration, sampleRate, channels, OfflineAudioContext, wav,
//                                signal, onProgress })
//     -> Promise<{ ok: true, plan, buffer, stats, wav, warnings, startTime,
//                  debug: { transport, runtime } (their debugInfo() after scheduling) }>
//        | { ok: false, plan, errors, limitations, aborted? }
//     Progress and abort (plan V427, the Studio "Render WAV"): onProgress({ stage, fraction })
//     reports 'render' at PROGRESS_STEPS points of the render (OfflineAudioContext.suspend(t)
//     then resume(); where suspend is not supported only 0 and 1) and 'encode' before the WAV
//     is encoded. An AbortSignal `signal` resolves the call at once with { ok: false,
//     aborted: true }; the context then finishes in the background and its buffer is dropped.
//     Neither changes a sample: the same model renders the same bytes.
//     Playback: createStudioTransport on the offline engine with a fixed store and
//     lookAheadS = the render duration, then transport.start(): the one start schedules every
//     item and automation event that begins inside the render, in one pass, with the times the
//     live transport schedules them at (the anchor is the runtime's start time in both).
//     Level: the Master Output level is the render's output gain (as the sequencer export uses
//     the master gain, sequencer/compiler.js renderSequenceOffline); the live limiter and
//     ceiling are not in the offline chain, so `stats` reports peak and clipping instead
//     (offline-renderer.js bufferStats). The graph starts at the runtime's click-free start time
//     (one scheduling lead plus a render-quantum boundary, ~21 ms at 48 kHz) and fades in over
//     STUDIO_XFADE_S; the output fades out over STUDIO_STOP_S before the end.

import { DEFAULT_RENDER, bufferStats, normalizeRenderOptions, render } from
  '../audio/offline-renderer.js';
import { encodeWav } from '../audio/wav.js';
import { MAX_OUTPUT_GAIN } from '../core/constants.js';
import { NODE_REGISTRY } from './registry.js';
import { validateStudioModel } from './validate.js';
import { createStudioRuntime } from './runtime.js';
import { STUDIO_STOP_S } from './compiler.js';
import { TRANSPORT_TEXT, clipPlayReason, createStudioTransport } from './transport.js';
import { effectiveTarget, timelineEnd } from './timeline.js';

/** Reasons, as shown to the user. */
export const OFFLINE_TEXT = Object.freeze({
  liveInput: (name) => `${name} is a live input and cannot be rendered offline. Remove it to `
    + 'export audio, or record the Studio while it plays.',
  analysis: 'Analysis view: it observes the signal and is not part of the rendered audio.',
  measurement: 'Measurement data: measurements run live through the measurement engine.',
  format: 'Sets the format of the rendered file.',
  noDuration: 'Give a render duration: the Studio has no timeline to measure it from.',
  tooLong: (max) => `A render is limited to ${max} s.`,
  // The transport's own reasons: a render plays what live playback plays.
  noTarget: TRANSPORT_TEXT.noTarget,
  patternTarget: TRANSPORT_TEXT.patternTarget,
  eventTarget: TRANSPORT_TEXT.eventTarget,
  measurementClip: 'Measurement clips run live through the measurement engine; not rendered.',
  afterEnd: 'Starts after the end of the render.',
  nodeNotRendered: (name) => `${name} is not rendered.`,
  silent: 'Nothing reaches the Master Output: the render will be silent.',
  aborted: 'The render was aborted; nothing was exported.',
});

/** Progress points of a render (suspend/resume of the OfflineAudioContext). */
export const PROGRESS_STEPS = 10;
const ABORTED = Symbol('aborted');

function nodeRole(def, node) {
  const c = def.capabilities;
  if (c.requiresInputPermission) return { role: 'refused', reason: OFFLINE_TEXT.liveInput(
    node.metadata.name) };
  if (node.type === 'recorder') return { role: 'rendered', reason: OFFLINE_TEXT.format };
  if (c.offline) return { role: 'rendered', reason: null };
  if (def.category === 'MEASUREMENT') return { role: 'skipped', reason: OFFLINE_TEXT.measurement };
  return { role: 'skipped', reason: OFFLINE_TEXT.analysis };
}

/** What an offline render of `model` would contain (see the header). Never throws. */
export function planOfflineRender(model, { duration = null, registry = NODE_REGISTRY } = {}) {
  const plan = { ok: false, refused: false, duration: null,
    render: { sampleRate: DEFAULT_RENDER.sampleRate, channels: DEFAULT_RENDER.channels },
    errors: [], limitations: [], warnings: [], nodes: [], clips: [], automation: [] };
  let report;
  try {
    report = validateStudioModel(model, { registry });
  } catch (e) {
    plan.errors.push({ code: 'invalid-structure', severity: 'error', path: '',
      message: `The Studio model has an invalid structure: ${e && e.message}` });
    return plan;
  }
  if (!report.ok) {
    plan.errors = report.errors;
    return plan;
  }
  plan.warnings = report.warnings.map((w) => w.message);
  const d = duration != null ? duration : timelineEnd(model);
  if (!(typeof d === 'number' && Number.isFinite(d) && d > 0)) {
    plan.errors.push({ code: 'no-duration', severity: 'error', path: 'duration',
      message: OFFLINE_TEXT.noDuration });
  } else if (d > DEFAULT_RENDER.maxDuration) {
    plan.errors.push({ code: 'too-long', severity: 'error', path: 'duration',
      message: OFFLINE_TEXT.tooLong(DEFAULT_RENDER.maxDuration) });
  } else {
    plan.duration = d;
  }
  const byId = new Map(model.graph.nodes.map((n) => [n.id, n]));
  const rendered = new Set();
  for (const n of model.graph.nodes) {
    const def = registry.get(n.type);
    const r = nodeRole(def, n);
    plan.nodes.push({ id: n.id, name: n.metadata.name, type: n.type, ...r });
    if (r.role === 'rendered') rendered.add(n.id);
    if (r.role === 'refused') {
      plan.refused = true;
      plan.limitations.push(r.reason);
    }
    if (n.type === 'recorder') {
      plan.render = { sampleRate: n.params.sampleRate, channels: n.params.channels };
    }
  }
  const master = model.graph.nodes.find((n) => n.type === 'master');
  if (!master || !model.graph.edges.some((e) => e.to.node === master.id)) {
    plan.warnings.push(OFFLINE_TEXT.silent);
  }
  for (const c of model.timeline.clips) {
    const targetId = effectiveTarget(model, c);
    const target = targetId ? byId.get(targetId) : null;
    const name = target ? target.metadata.name : 'no target';
    // What the live transport does not play is not rendered either, with the same reason.
    let reason = c.kind === 'measurement' ? OFFLINE_TEXT.measurementClip
      : clipPlayReason(model, c);
    if (!reason && !rendered.has(targetId)) reason = OFFLINE_TEXT.nodeNotRendered(name);
    if (!reason && plan.duration != null && c.start >= plan.duration) {
      reason = OFFLINE_TEXT.afterEnd;
    }
    plan.clips.push({ id: c.id, kind: c.kind, target: targetId, rendered: !reason, reason });
    if (reason && reason !== OFFLINE_TEXT.afterEnd) {
      plan.limitations.push(`Clip ${c.id}: ${reason}`);
    }
  }
  for (const lane of model.timeline.automation) {
    const ok = rendered.has(lane.target.node);
    const reason = ok ? null : OFFLINE_TEXT.nodeNotRendered(byId.get(lane.target.node)
      .metadata.name);
    plan.automation.push({ id: lane.id, target: { ...lane.target }, rendered: ok, reason });
    if (!ok) plan.limitations.push(`Automation ${lane.id}: ${reason}`);
  }
  plan.ok = !plan.refused && plan.errors.length === 0;
  return plan;
}

// ---------------------------------------------------------------- renderer

/**
 * The AudioEngine surface the Studio runtime uses (adapters/engine-hooks.js), backed by an
 * OfflineAudioContext and the offline renderer's master gain. Timers run nothing: offline,
 * deferred disposal is unnecessary (the context is discarded after rendering), and the
 * transport's bookkeeping wake-up is never needed (its first window covers the render).
 */
export function offlineEngine(ctx, master) {
  const nodes = new Set();
  const sources = new Set();
  return {
    ctx,
    master,
    nodes,
    sources,
    _env: { navigator: null },
    _timers: { setTimeout: () => 0, clearTimeout() {} },
    isSupported: () => true,
    init: () => true,
    on: () => () => {},
    lastError: null,
    get safeMaximum() { return (ctx.sampleRate / 2) * 0.95; },
    setMasterGain(g) {
      master.gain.value = Math.min(MAX_OUTPUT_GAIN, Math.max(0, g));
    },
    get activeNodeCount() { return nodes.size; },
    get activeSourceCount() { return sources.size; },
  };
}

/** A read-only Studio store holding one model (the transport's store surface). */
function fixedStore(model) {
  return Object.freeze({
    getModel: () => model,
    getRevision: () => 0,
    dispatch: () => ({ ok: false, errors: [{ code: 'read-only', severity: 'error', path: '',
      message: 'An offline render does not change the model.' }] }),
  });
}

/**
 * Report render progress at PROGRESS_STEPS points: suspend the offline context at whole render
 * quanta, report, resume. Browsers without OfflineAudioContext.suspend report 0 and 1 only.
 */
function trackProgress(ctx, duration, onProgress, aborted) {
  const report = (fraction) => {
    if (aborted()) return;
    try { onProgress({ stage: 'render', fraction }); } catch (e) { /* the caller's own */ }
  };
  report(0);
  if (typeof ctx.suspend !== 'function') return;
  const quantum = 128 / ctx.sampleRate;
  const seen = new Set();
  for (let k = 1; k < PROGRESS_STEPS; k += 1) {
    const t = Math.round((k * duration) / PROGRESS_STEPS / quantum) * quantum;
    const key = t.toFixed(9);
    if (!(t > 0 && t < duration) || seen.has(key)) continue;
    seen.add(key);
    try {
      const p = ctx.suspend(t);
      if (p && typeof p.then === 'function') {
        p.then(() => {
          report(t / duration);
          return ctx.resume();
        }, () => {});
      }
    } catch (e) {
      return; // not supported for offline contexts here: start and end only
    }
  }
}

/** Render `model` offline (see the header). Rejects only on a browser/render failure. */
export async function renderStudioOffline(model, opts = {}) {
  const plan = planOfflineRender(model, { duration: opts.duration ?? null,
    registry: opts.registry });
  if (!plan.ok) {
    return { ok: false, plan, errors: plan.errors.map((e) => e.message),
      limitations: plan.limitations };
  }
  const signal = opts.signal || null;
  const aborted = () => !!(signal && signal.aborted);
  const abortResult = () => ({ ok: false, aborted: true, plan, errors: [OFFLINE_TEXT.aborted],
    limitations: plan.limitations });
  if (aborted()) return abortResult();
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const o = normalizeRenderOptions({ duration: plan.duration,
    sampleRate: opts.sampleRate ?? plan.render.sampleRate,
    channels: opts.channels ?? plan.render.channels });
  const warnings = [...plan.warnings];
  const planned = new Set(plan.limitations);
  let startTime = null;
  let debug = null;
  const build = (ctx, master, { duration }) => {
    const engine = offlineEngine(ctx, master);
    const runtime = createStudioRuntime({ engine, registry: opts.registry });
    // The live transport, on the offline context: one start schedules the whole render.
    const transport = createStudioTransport({ runtime, engine, store: fixedStore(model),
      registry: opts.registry, lookAheadS: duration });
    transport.on((type, d) => { if (type === 'warning') warnings.push(d.message); });
    const started = transport.start();
    if (!started.ok) throw new Error(started.reason);
    const t0 = started.baseTime;
    startTime = t0;
    const rd = runtime.debugInfo();
    warnings.push(...rd.warnings);
    const td = transport.debugInfo();
    for (const { id, reason } of td.unplayed) {
      const line = model.timeline.automation.some((l) => l.id === id)
        ? `Automation ${id}: ${reason}` : `Clip ${id}: ${reason}`;
      if (!planned.has(line)) warnings.push(line);
    }
    debug = { transport: td, runtime: rd };
    // Fade the output out before the end of the buffer (no truncation click).
    const level = master.gain.value;
    const fadeAt = Math.max(t0, duration - STUDIO_STOP_S);
    master.gain.setValueAtTime(level, fadeAt);
    master.gain.linearRampToValueAtTime(0, duration);
    if (onProgress) trackProgress(ctx, duration, onProgress, aborted);
  };
  const rendering = render(build, { duration: o.duration, sampleRate: o.sampleRate,
    channels: o.channels, OfflineAudioContext: opts.OfflineAudioContext });
  let buffer;
  if (signal) {
    let off = null;
    const stop = new Promise((resolve) => {
      const on = () => resolve(ABORTED);
      signal.addEventListener('abort', on, { once: true });
      off = () => signal.removeEventListener('abort', on);
    });
    try {
      buffer = await Promise.race([rendering, stop]);
    } finally {
      off();
    }
    if (buffer === ABORTED) {
      rendering.catch(() => {}); // finishes in the background; its buffer is dropped
      return abortResult();
    }
  } else {
    buffer = await rendering;
  }
  if (aborted()) return abortResult();
  if (onProgress) {
    try { onProgress({ stage: 'render', fraction: 1 }); } catch (e) { /* the caller's own */ }
    if (opts.wav) {
      try { onProgress({ stage: 'encode', fraction: 1 }); } catch (e) { /* the caller's own */ }
    }
  }
  return { ok: true, plan, buffer, stats: bufferStats(buffer),
    wav: opts.wav ? encodeWav(buffer) : null, warnings: [...new Set(warnings)], startTime,
    debug };
}

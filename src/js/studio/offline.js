// Offline rendering of a Studio (spec §105, §175-§176; plan issue V427). The plan is pure;
// the renderer runs the SAME Studio compiler, runtime and node adapters on an
// OfflineAudioContext through the existing audio/offline-renderer.js path, so a WAV export is
// the compiled graph, rendered — never a second engine (§42).
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
//     Timeline: pattern clips render on Sequence nodes (sequencer/compiler.js compileSequence),
//     gate events on Envelopes (adapter gate), automation lanes on their AudioParam
//     (automation.js applyAutomation). Pattern clips on other targets and measurement clips are
//     listed as limitations: the runtime does not play them either.
//   renderStudioOffline(model, { duration, sampleRate, channels, OfflineAudioContext, wav })
//     -> Promise<{ ok: true, plan, buffer, stats, wav, warnings, startTime }>
//        | { ok: false, plan, errors, limitations }
//     Level: the Master Output level is the render's output gain (as the sequencer export uses
//     the master gain, sequencer/compiler.js renderSequenceOffline); the live limiter and
//     ceiling are not in the offline chain, so `stats` reports peak and clipping instead
//     (offline-renderer.js bufferStats). The graph starts at the runtime's click-free start time
//     (one scheduling lead plus a render-quantum boundary, ~21 ms at 48 kHz) and fades in over
//     STUDIO_XFADE_S; the output fades out over STUDIO_STOP_S before the end.

import { DEFAULT_RENDER, bufferStats, normalizeRenderOptions, render } from
  '../audio/offline-renderer.js';
import { encodeWav } from '../audio/wav.js';
import { compileSequence } from '../sequencer/compiler.js';
import { MAX_OUTPUT_GAIN } from '../core/constants.js';
import { NODE_REGISTRY } from './registry.js';
import { validateStudioModel } from './validate.js';
import { createStudioRuntime } from './runtime.js';
import { STUDIO_STOP_S } from './compiler.js';
import { compileTimeline } from './timeline-compiler.js';
import { applyAutomation } from './automation.js';
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
  patternTarget: (name) => `Pattern clips play through a Sequence node; this clip on ${name} is `
    + 'not rendered.',
  eventTarget: (name) => `Only gate events on an Envelope are rendered; this clip on ${name} is `
    + 'not.',
  measurementClip: 'Measurement clips run live through the measurement engine; not rendered.',
  afterEnd: 'Starts after the end of the render.',
  nodeNotRendered: (name) => `${name} is not rendered.`,
  silent: 'Nothing reaches the Master Output: the render will be silent.',
});

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
    let reason = null;
    if (c.kind === 'measurement') reason = OFFLINE_TEXT.measurementClip;
    else if (c.kind === 'pattern' && (!target || target.type !== 'sequence')) {
      reason = OFFLINE_TEXT.patternTarget(name);
    } else if (c.kind === 'event' && (!target || target.type !== 'envelope'
      || (c.payload.action || 'gate') !== 'gate')) {
      reason = OFFLINE_TEXT.eventTarget(name);
    } else if (!rendered.has(targetId)) reason = OFFLINE_TEXT.nodeNotRendered(name);
    else if (plan.duration != null && c.start >= plan.duration) reason = OFFLINE_TEXT.afterEnd;
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
 * deferred disposal is unnecessary (the context is discarded after rendering).
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

/** Render `model` offline (see the header). Rejects only on a browser/render failure. */
export async function renderStudioOffline(model, opts = {}) {
  const plan = planOfflineRender(model, { duration: opts.duration ?? null,
    registry: opts.registry });
  if (!plan.ok) {
    return { ok: false, plan, errors: plan.errors.map((e) => e.message),
      limitations: plan.limitations };
  }
  const o = normalizeRenderOptions({ duration: plan.duration,
    sampleRate: opts.sampleRate ?? plan.render.sampleRate,
    channels: opts.channels ?? plan.render.channels });
  const renderedClips = new Set(plan.clips.filter((c) => c.rendered).map((c) => c.id));
  const renderedLanes = new Set(plan.automation.filter((a) => a.rendered).map((a) => a.id));
  const warnings = [...plan.warnings];
  let startTime = null;
  const build = (ctx, master, { duration }) => {
    const engine = offlineEngine(ctx, master);
    const runtime = createStudioRuntime({ engine, registry: opts.registry });
    const applied = runtime.apply(model);
    if (!applied.ok) throw new Error(applied.errors[0].message);
    const started = runtime.start();
    if (!started.ok) throw new Error(started.errors[0].message);
    warnings.push(...(started.warnings || []));
    const t0 = started.at;
    startTime = t0;
    const tl = compileTimeline(model, { sampleRate: ctx.sampleRate, baseTime: t0 });
    warnings.push(...tl.warnings);
    for (const item of tl.items) {
      if (!renderedClips.has(item.clipId) || item.startTime >= duration) continue;
      const h = runtime.nodes.get(item.target);
      if (!h || h.status !== 'ready') continue;
      if (item.type === 'pattern' && h.info && h.info.destination) {
        compileSequence(item.sequence, ctx, h.info.destination, item.startTime,
          { timers: null, waveform: h.info.waveform });
      } else if (item.type === 'event' && typeof h.gate === 'function') {
        h.gate(item.startTime, item.duration);
      }
    }
    for (const lane of tl.automation) {
      if (!renderedLanes.has(lane.laneId)) continue;
      const h = runtime.nodes.get(lane.target.node);
      const t = h && h.status === 'ready' ? h.modTarget(lane.target.param, 'linear') : null;
      if (!t || !t.param) {
        warnings.push(`Automation ${lane.laneId}: ${t && t.reason ? t.reason
          : 'no parameter to automate'}`);
        continue;
      }
      applyAutomation(t.param, lane.events.filter((e) => e.time < duration), { cancelFrom: t0 });
    }
    // Fade the output out before the end of the buffer (no truncation click).
    const level = master.gain.value;
    const fadeAt = Math.max(t0, duration - STUDIO_STOP_S);
    master.gain.setValueAtTime(level, fadeAt);
    master.gain.linearRampToValueAtTime(0, duration);
  };
  const buffer = await render(build, { duration: o.duration, sampleRate: o.sampleRate,
    channels: o.channels, OfflineAudioContext: opts.OfflineAudioContext });
  return { ok: true, plan, buffer, stats: bufferStats(buffer),
    wav: opts.wav ? encodeWav(buffer) : null, warnings: [...new Set(warnings)], startTime };
}

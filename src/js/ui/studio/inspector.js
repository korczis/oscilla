// Studio Inspector (spec §73, §78-§80, §102-§104, §140-§141, §170-§176). The contextual editor of
// the primary selection, generated from the registry's parameter schemas (key, label, type,
// range, step, unit, scale, options, automatable, modulatable). Every edit is a store action
// (NODE_PARAM_SET, NODE_RENAME, NODE_MOVE, EDGE_UPDATE, CLIP_MOVE, CLIP_RESIZE,
// AUTOMATION_POINT_ADD, METADATA_SET): model → runtime → every projection (§80); nothing here
// touches an AudioParam. A slider drag is one history entry (store gesture, §50).
//
//   inspectorView(model, selection, opts) -> view           pure (unit-tested)
//     kind 'studio' (nothing selected) | 'node' | 'multi' | 'edge' | 'clip' | 'point'
//   runtimeView(model, truth, opts) -> runtime              pure: the 'studio' view's Runtime
//     section (ADR 0039): truth = { verdict: runtime.js studioDivergence, runtime: runtime
//     debugInfo(), transport: transport debugInfo() }; opts: { registry, status, edgeStatus }.
//     -> { state: runtimeState(verdict), label, text, code, desired: { revision, hash },
//          applied: { revision, planHash, at } | null, nodes: { ready, degraded, offline },
//          edges: { live, inactive, 'no-effect' }, lanes: [text], owned: [text],
//          diagnostics: [{ code, severity, owner, message, entity: { kind, id, label,
//          selection | null } | null }] }
//   traceView(model, steps, { registry, nodeId }) -> { ops: [{ op, title, outcome, steps:
//     [{ text, outcome, code }] }], shown, total }   pure: the Trace section (ADR 0042), the
//     operations of core/trace.js steps newest first (at most TRACE_OPS_SHOWN), only those with
//     a step naming node `nodeId` when given; every outcome and code is text
//   runtimeDiagnostics(truth) -> [Diagnostic]   the verdict's reason, then, while a graph runs,
//     the runtime's and the transport's debugInfo().diagnostics (node and edge views list the
//     ones naming them on their status line, with the code)
//   studioSettingsView(model) -> settings                   pure: what the 'studio' view shows
//     of the transport and the document (§78 "nothing → Studio/transport properties"): time
//     mode, tempo, time signature, loop, length, notes; edited through TRANSPORT_SET, LOOP_SET
//     and METADATA_SET like every other field (the store validates; a refusal is announced)
//   formatParamValue(p, v), parseParamInput(p, text), sliderRange(p), valueToSlider(p, v),
//   sliderToValue(p, pos)                                   pure helpers of the fields
//   mountInspector(host, svc) -> { render(), renderTrace(), focusFirst(), focusHeading(),
//                                  focusKey(key), destroy() } DOM (graph-dom.js, no innerHTML);
//                                  renderTrace refreshes only the Trace section
//     svc: { store, registry, announce(text, { assertive }), status() -> Map, warnings() -> Map,
//            edgeStatus() -> Map edge id -> plan { status, reason }, truth() -> truth (above;
//            a changed runtime state is announced politely), trace() -> [step], onConnect(nodeId),
//            onSavePatch(nodeIds), onDelete(), onDuplicate(), onShowLane(laneId, label) }
//   Focus (§142; V431 U2): a rebuilt Inspector puts focus back on the control with the same
//   data-key; when the action replaced the view (a connection link, Select source, Delete)
//   and that control is gone, focus goes to the new view's heading, never to <body>.

import { NODE_REGISTRY, validateParamValue } from '../../studio/registry.js';
import {
  MIN_CLIP_S, NOTES_MAX_CHARS, TEMPO_RANGE, TIME_SIGNATURE_DENOMINATORS,
} from '../../studio/schema.js';
import { secondsPerBar, timelineEnd } from '../../studio/timeline.js';
import { PORT_VISUALS } from '../../studio/ports.js';
import { describeEdge, summarizeGraph, announceAction } from '../../studio/a11y.js';
import { formatFrequency, parseFrequency } from '../../core/frequency.js';
import { sig } from '../../core/math.js';
import { CATEGORY_LABELS, STATUS_LABELS, edgeRoute, nodeConnections } from './graph-view.js';
import { formatSecondsText } from './timeline-view.js';
import { h, replaceChildren, setAttr, setText } from './graph-dom.js';
import { sliderFill } from '../app.js';

export const SLIDER_STEPS = 1000;

/** Runtime states whose change Play and Stop already announce. */
const QUIET = ['not-applied', 'in-sync'];

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The display text of a parameter value with its unit ("2.40 kHz", "0.707", "Low-pass"). */
export function formatParamValue(p, v) {
  switch (p.type) {
    case 'boolean': return v ? 'On' : 'Off';
    case 'enum': {
      const o = (p.options || []).find((x) => x[0] === v);
      return o ? o[1] : String(v);
    }
    case 'list': return Array.isArray(v) ? v.map((x) => sig(x, 4)).join(', ') : '';
    case 'id': return v === null || v === undefined ? 'None' : `${String(v).slice(0, 12)}…`;
    default:
      if (!finite(v)) return '—';
      if (p.unit === 'Hz') return formatFrequency(v);
      return p.unit ? `${sig(v, 4)} ${p.unit}` : sig(v, 4);
  }
}

/**
 * Parse what was typed into a parameter field. Frequencies accept "2400", "2.4k", "2.4 kHz";
 * other numbers may carry their unit ("120 ms" is not converted: the unit must match). Returns
 * { ok: true, value } or { ok: false, error } with the registry's own range text.
 */
export function parseParamInput(p, text) {
  const raw = String(text ?? '').trim();
  const fail = (why) => ({ ok: false, error: `${p.label} ${why}.` });
  let value;
  if (p.type === 'number' || p.type === 'integer') {
    if (p.unit === 'Hz') {
      const r = parseFrequency(raw);
      if (!r.ok) return { ok: false, error: r.error };
      value = r.value;
    } else {
      const unit = p.unit ? p.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
      const stripped = unit ? raw.replace(new RegExp(`\\s*${unit}$`, 'i'), '') : raw;
      if (!/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(stripped.replace(',', '.'))) {
        return fail('must be a number');
      }
      value = Number(stripped.replace(',', '.'));
    }
  } else if (p.type === 'list') {
    const parts = raw.split(/[,;\s]+/).filter(Boolean);
    value = parts.map((x) => Number(x.replace(',', '.')));
    if (value.some((x) => !finite(x))) return fail('must be numbers separated by commas');
  } else {
    return fail('cannot be typed');
  }
  const why = validateParamValue(p, value);
  return why ? fail(why) : { ok: true, value };
}

/** The slider's range: the parameter's soft (display) range, else its full range. */
export function sliderRange(p) {
  const lo = p.softRange ? p.softRange[0] : p.min;
  const hi = p.softRange ? p.softRange[1] : p.max;
  return { lo, hi, log: p.scale === 'log' && lo > 0 };
}

/** Slider position 0..SLIDER_STEPS of a value (clamped to the slider range). */
export function valueToSlider(p, v) {
  const { lo, hi, log } = sliderRange(p);
  if (!finite(v) || !(hi > lo)) return 0;
  const x = Math.min(hi, Math.max(lo, v));
  const t = log ? Math.log(x / lo) / Math.log(hi / lo) : (x - lo) / (hi - lo);
  return Math.round(t * SLIDER_STEPS);
}

/** The value of a slider position, rounded to the parameter's step (4 significant digits). */
export function sliderToValue(p, pos) {
  const { lo, hi, log } = sliderRange(p);
  const t = Math.min(1, Math.max(0, pos / SLIDER_STEPS));
  let v = log ? lo * (hi / lo) ** t : lo + (hi - lo) * t;
  if (p.type === 'integer') v = Math.round(v);
  else if (p.step) v = Math.round(v / p.step) * p.step;
  v = Number(v.toPrecision(4));
  return Math.min(p.max, Math.max(p.min, v)) + 0;
}

function nodeOf(model, id) {
  return model.graph.nodes.find((n) => n.id === id) || null;
}

function fieldOf(model, node, p, registry, edgeStatus) {
  const value = node.params[p.key];
  const lane = model.timeline.automation.find((l) => l.target.node === node.id
    && l.target.param === p.key);
  const mods = model.graph.edges.filter((e) => e.to.node === node.id && e.to.port === p.key)
    .map((e) => {
      const r = edgeRoute(model, e, { registry, status: edgeStatus ? edgeStatus.get(e.id) : null });
      const text = describeEdge(model, e.id, { registry });
      return r.short ? `${text} (${r.short})` : text;
    });
  const control = p.type === 'enum' ? 'select' : p.type === 'boolean' ? 'toggle'
    : p.type === 'id' ? 'readonly' : p.type === 'list' ? 'list' : 'number';
  return {
    key: p.key,
    label: p.label,
    type: p.type,
    control,
    value,
    text: formatParamValue(p, value),
    input: p.type === 'list' ? (value || []).join(', ')
      : finite(value) ? String(Number(value.toPrecision(6))) : '',
    unit: p.unit || '',
    min: p.min,
    max: p.max,
    slider: control === 'number' ? valueToSlider(p, value) : null,
    options: (p.options || []).map(([v, l]) => ({ value: v, label: l })),
    automatable: !!p.automatable,
    modulatable: !!p.modulatable,
    automated: !!lane,
    laneId: lane ? lane.id : null,
    modulatedBy: mods,
    param: p,
  };
}

/** Time modes as the Inspector offers them (the model's TIME_MODES). */
export const TIME_MODE_CHOICES = Object.freeze([
  Object.freeze({ value: 'seconds', label: 'Seconds' }),
  Object.freeze({ value: 'musical', label: 'Bars and beats' }),
]);

/**
 * What the Inspector shows of the Studio itself when nothing is selected (§78): the transport
 * and document settings, plain data. `length` is the end of the last clip or automation point
 * (timeline.js timelineEnd); in musical mode it is also given in bars at the current tempo.
 */
export function studioSettingsView(model) {
  const t = model.transport;
  const loop = model.timeline.loop;
  const [beats, unit] = t.timeSignature;
  const length = timelineEnd(model);
  const bars = length / secondsPerBar(t);
  const barsText = `${Number(bars.toFixed(2))} bar${Math.abs(bars - 1) < 1e-9 ? '' : 's'}`;
  return {
    timeMode: t.timeMode,
    timeModes: TIME_MODE_CHOICES.map((c) => ({ ...c })),
    tempo: t.tempo,
    tempoRange: [...TEMPO_RANGE],
    beats,
    unit,
    units: [...TIME_SIGNATURE_DENOMINATORS],
    signatureText: `${beats}/${unit}`,
    loop: { enabled: !!loop.enabled, start: loop.start, end: loop.end },
    loopText: `Loop ${loop.enabled ? 'on' : 'off'}, ${formatSecondsText(loop.start)} to `
      + `${formatSecondsText(loop.end)}`,
    length,
    lengthText: length > 0 ? `${formatSecondsText(length)}${t.timeMode === 'musical'
      ? ` · ${barsText}` : ''}` : 'Empty timeline',
    notes: model.metadata.notes,
    notesMax: NOTES_MAX_CHARS,
  };
}

/** What the Runtime section calls each divergence state ('failed': PLAY was refused). */
export const RUNTIME_LABELS = Object.freeze({
  'in-sync': 'Running',
  'not-applied': 'Not applied',
  behind: 'Previous configuration still running',
  refused: 'Refused',
  failed: 'Failed',
});

/** The divergence state, with a stopped runtime that refused PLAY as 'failed'. */
export const runtimeState = (v) => (!v ? 'not-applied'
  : v.state === 'not-applied' && v.reason ? 'failed' : v.state);

/** The first 8 hex digits of a hash, '—' for none. */
export const shortHash = (h) => (h ? h.slice(0, 8) : '—');

export function runtimeDiagnostics(truth) {
  const v = truth && truth.verdict;
  if (!v) return [];
  const of = (x) => (v.applied && x && x.diagnostics) || [];
  return [...(v.reason ? [v.reason] : []), ...of(truth.runtime), ...of(truth.transport)];
}

/** A diagnostic's entity as the Inspector links it: its name and the selection showing it. */
function entityRef(model, ent, registry) {
  if (!ent) return null;
  const { kind, id } = ent;
  let label = null;
  let selection = null;
  if (kind === 'node') {
    const n = nodeOf(model, id);
    if (n) [label, selection] = [n.metadata.name, { nodes: [id] }];
  } else if (kind === 'edge') {
    if (model.graph.edges.some((e) => e.id === id)) {
      const d = describeEdge(model, id, { registry });
      [label, selection] = [`${d[0].toLowerCase()}${d.slice(1)}`, { edges: [id] }];
    }
  } else if (kind === 'clip') {
    const c = model.timeline.clips.find((x) => x.id === id);
    if (c) [label, selection] = [`${c.kind} clip`, { clips: [id] }];
  } else if (kind === 'lane') {
    const l = model.timeline.automation.find((x) => x.id === id);
    if (l) {
      label = `${paramText(model, l.target, registry)} lane`;
      selection = { nodes: [l.target.node], points: l.points.map((p) => p.id) };
    }
  }
  return { kind, id, label: label || id, selection };
}

/** "Filter Cutoff": a { node, param } target by name. */
function paramText(model, t, registry) {
  const n = nodeOf(model, t.node);
  const p = n && registry.param(n.type, t.param);
  return `${n ? n.metadata.name : t.node} ${p ? p.label : t.param}`;
}

export function runtimeView(model, truth, opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const v = (truth && truth.verdict) || null;
  const state = runtimeState(v);
  const a = v && v.applied;
  const d = v ? v.desired : { revision: null, studioHash: null };
  const why = v && v.reason ? v.reason.message : '';
  const text = state === 'in-sync' ? `Revision ${a.revision} plays as edited.`
    : state === 'behind' ? `Revision ${a.revision} plays; revision ${d.revision} is not `
      + 'applied yet.'
      : state === 'refused' ? `Revision ${d.revision} was refused (${why}). Revision `
        + `${a.revision} keeps playing.`
        : state === 'failed' ? `Play failed: ${why}`
          : 'Nothing runs. Press Play to apply this Studio.';
  const nodes = { ready: 0, degraded: 0, offline: 0 };
  for (const n of model.graph.nodes) {
    const s = ((opts.status && opts.status.get(n.id)) || {}).status;
    if (s) nodes[s === 'offline-only' ? 'offline' : s === 'ready' || s === 'data' ? 'ready'
      : 'degraded']++;
  }
  const edges = { live: 0, inactive: 0, 'no-effect': 0 };
  for (const e of model.graph.edges) {
    const r = edgeRoute(model, e, { registry,
      status: opts.edgeStatus ? opts.edgeStatus.get(e.id) : null }).state;
    edges[r === 'no-route' ? 'inactive' : r]++;
  }
  const targets = (x, key) => (a && x ? x[key].map((l) => paramText(model, l.target || l,
    registry)) : []);
  return {
    state,
    label: RUNTIME_LABELS[state],
    text,
    code: v && v.reason ? v.reason.code : null,
    desired: { revision: d.revision, hash: shortHash(d.studioHash) },
    applied: a ? { revision: a.revision, planHash: shortHash(a.planHash),
      at: new Date(a.at).toLocaleTimeString() } : null,
    nodes,
    edges,
    lanes: targets(truth && truth.transport, 'lanes'),
    owned: targets(truth && truth.runtime, 'ownedParams'),
    diagnostics: runtimeDiagnostics(truth).map((x) => ({ code: x.code, severity: x.severity,
      owner: x.owner, message: x.message, entity: entityRef(model, x.entity, registry) })),
  };
}

/** Operations the Trace section lists. */
export const TRACE_OPS_SHOWN = 12;
const TRACE_SECONDS = ['at', 'end', 'baseTime', 'fade', 'position'];
const BAD = ['refused', 'failed', 'rejected'];

export function traceView(model, steps, opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const byOp = new Map();
  for (const st of steps || []) {
    if (!byOp.has(st.op)) byOp.set(st.op, []);
    byOp.get(st.op).push(st);
  }
  const all = [...byOp].reverse().filter(([, list]) => !opts.nodeId || list.some((x) =>
    x.entity && x.entity.kind === 'node' && x.entity.id === opts.nodeId));
  const ops = all.slice(0, TRACE_OPS_SHOWN).map(([op, list]) => {
    const first = list.find((x) => x.owner === 'store') || list.find((x) => x.owner
      === 'transport') || list[0];
    const commit = list.find((x) => x.kind === 'commit');
    // The headline is the store's verdict (else the first refusal, else the last step); a
    // committed edit lists the steps that failed after it separately.
    const bad = list.filter((x) => BAD.includes(x.outcome));
    const end = commit || bad[0] || list[list.length - 1];
    const ill = BAD.includes(end.outcome);
    const code = end.code || (ill && bad[0] ? bad[0].code : null);
    const failed = ill ? [] : bad.map((x) => x.code || x.kind);
    const label = commit && commit.detail.label;
    const title = first.owner === 'store' ? label || (first.detail && first.detail.type)
      || first.kind : `${first.owner} ${first.kind}`;
    return {
      op,
      title: first.kind === 'undo' || first.kind === 'redo' ? `${first.kind} ${label || ''}`.trim()
        : title,
      outcome: `${end.outcome}${code ? ` (${code})` : ''}${commit && commit.revision != null
        ? `, revision ${commit.revision}` : ''}${failed.length ? ` · failed: ${failed.join(', ')}`
        : ''}`,
      steps: list.map((x) => ({ text: traceText(model, x, registry), outcome: x.outcome,
        code: x.code })),
    };
  });
  return { ops, shown: ops.length, total: all.length };
}

/** One step in words: owner, kind, outcome (code), what it names and its detail. */
function traceText(model, x, registry) {
  const n = x.entity && x.entity.kind === 'node' ? nodeOf(model, x.entity.id) : null;
  const d = { ...x.detail };
  const p = n && d.param ? registry.param(n.type, d.param) : null;
  const what = [x.entity ? `${n ? n.metadata.name : `${x.entity.kind} ${x.entity.id}`}${d.param
    ? ` ${p ? p.label : d.param}` : ''}` : ''];
  if (p && typeof d.value === 'number') what[0] += ` ${formatParamValue(p, d.value)}`;
  else if (d.param) what[0] += ` ${d.value} ${d.unit || ''}`.trimEnd();
  if (d.param) for (const k of ['param', 'value', 'unit']) delete d[k];
  if (!d.cents) delete d.cents;
  what.push(...Object.entries(d).filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
    k === 'planHash' ? `plan ${shortHash(v)}` : typeof v === 'number' ? `${k} ${sig(v, 4)}${
      TRACE_SECONDS.includes(k) ? ' s' : ''}` : `${k} ${v}`)));
  return `${x.owner} ${x.kind}: ${x.outcome}${x.code ? ` (${x.code})` : ''}${x.revision != null
    ? ` · rev ${x.revision}` : ''} · ${what.filter(Boolean).join(', ')}`.replace(/ · $/, '');
}

/** The diagnostics naming one entity, as status-line text with their code. */
const entityNotes = (truth, kind, id, skip = []) => runtimeDiagnostics(truth)
  .filter((x) => x.entity && x.entity.kind === kind && x.entity.id === id
    && !skip.includes(x.message)).map((x) => `${x.message} (${x.code})`);

/** The store action of a Studio settings field edit, or { error } (pure, unit-tested). */
export function settingsAction(model, key, raw) {
  const t = model.transport;
  const loop = model.timeline.loop;
  const num = (v) => Number(String(v ?? '').trim().replace(',', '.'));
  switch (key) {
    case 'timeMode':
      return TIME_MODE_CHOICES.some((c) => c.value === raw) ? { type: 'TRANSPORT_SET',
        timeMode: raw } : { error: 'Unknown time mode.' };
    case 'tempo': {
      const v = num(raw);
      if (!finite(v) || v < TEMPO_RANGE[0] || v > TEMPO_RANGE[1]) {
        return { error: `Tempo must be ${TEMPO_RANGE[0]}-${TEMPO_RANGE[1]} BPM.` };
      }
      return { type: 'TRANSPORT_SET', tempo: v };
    }
    case 'beats': {
      const v = num(raw);
      if (!Number.isInteger(v) || v < 1 || v > 32) {
        return { error: 'Beats per bar must be a whole number from 1 to 32.' };
      }
      return { type: 'TRANSPORT_SET', timeSignature: [v, t.timeSignature[1]] };
    }
    case 'unit': {
      const v = num(raw);
      if (!TIME_SIGNATURE_DENOMINATORS.includes(v)) {
        return { error: `The beat unit must be one of ${TIME_SIGNATURE_DENOMINATORS.join(', ')}.` };
      }
      return { type: 'TRANSPORT_SET', timeSignature: [t.timeSignature[0], v] };
    }
    case 'loop':
      return { type: 'LOOP_SET', enabled: raw === true || raw === 'true' };
    case 'loopStart':
    case 'loopEnd': {
      const v = num(raw);
      const start = key === 'loopStart' ? v : loop.start;
      const end = key === 'loopEnd' ? v : loop.end;
      if (!finite(v) || v < 0) return { error: 'Loop times must be 0 s or later.' };
      if (!(end > start)) return { error: 'The loop end must be after its start.' };
      if (loop.enabled && end - start < MIN_CLIP_S) {
        return { error: `An active loop must be at least ${MIN_CLIP_S} s long.` };
      }
      return { type: 'LOOP_SET', start, end };
    }
    case 'notes': {
      const v = String(raw ?? '');
      if (v.length > NOTES_MAX_CHARS) {
        return { error: `Notes must be at most ${NOTES_MAX_CHARS} characters.` };
      }
      return { type: 'METADATA_SET', notes: v };
    }
    default:
      return { error: `Unknown Studio setting ${key}.` };
  }
}

/**
 * The Inspector view of the selection (§78): the primary node (the last selected), a
 * connection, a clip or automation point, several nodes, or the Studio itself.
 * opts: { registry, status: Map id -> { status, code, reason }, warnings: Map id -> [text],
 *         edgeStatus: Map edge id -> plan { status, code, reason }, truth (runtimeView),
 *         trace: [step] (traceView) }.
 * A connection that carries nothing (graph-view.js edgeRoute) has route 'no-route' or
 * 'no-effect' and its reason (§237).
 */
export function inspectorView(model, selection, opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const sel = selection || {};
  const nodes = (sel.nodes || []).filter((id) => nodeOf(model, id));
  const edges = sel.edges || [];
  const clips = sel.clips || [];
  if (nodes.length > 1) {
    return { kind: 'multi', key: `multi:${nodes.join(',')}`, ids: nodes,
      count: nodes.length, names: nodes.map((id) => nodeOf(model, id).metadata.name),
      title: `${nodes.length} nodes` };
  }
  if (nodes.length === 1) {
    const node = nodeOf(model, nodes[0]);
    const def = registry.get(node.type);
    const st = opts.status && opts.status.get(node.id);
    const warn = (opts.warnings && opts.warnings.get(node.id)) || [];
    const fields = def ? def.params.map((p) => fieldOf(model, node, p, registry,
      opts.edgeStatus)) : [];
    const label = st ? STATUS_LABELS[st.status] || null : null;
    const reason = st && st.reason ? st.reason : null;
    const notes = entityNotes(opts.truth, 'node', node.id, warn);
    return {
      kind: 'node',
      key: `node:${node.id}:${fields.map((f) => f.key).join(',')}`,
      id: node.id,
      title: node.metadata.name,
      name: node.metadata.name,
      typeLabel: def ? def.displayName : node.type,
      categoryLabel: def ? CATEGORY_LABELS[def.category] : 'Unknown',
      help: def ? def.help : null,
      status: st ? st.status : null,
      statusLabel: label,
      code: st ? st.code || null : null,
      reason,
      warnings: warn,
      // The status line: label (code), the structured reason, validator warnings, then the
      // runtime and transport diagnostics naming this node, each with its code.
      statusText: [label && st.code ? `${label} (${st.code})` : label, reason,
        ...warn.filter((w) => w !== reason), ...notes].filter(Boolean).join(' · '),
      statusError: (st && st.status === 'degraded') || notes.length > 0,
      position: { x: node.position.x, y: node.position.y },
      fields,
      connections: nodeConnections(model, node.id, registry, opts.edgeStatus || null),
      hasOutputs: !!(def && def.outputs.length),
      trace: traceView(model, opts.trace, { registry, nodeId: node.id }),
    };
  }
  if (edges.length) {
    const e = model.graph.edges.find((x) => x.id === edges[edges.length - 1]);
    if (e) {
      const a = nodeOf(model, e.from.node);
      const b = nodeOf(model, e.to.node);
      const src = registry.port(a.type, e.from.port, 'out');
      const tgt = registry.port(b.type, e.to.port, 'in');
      const control = src.type === 'CONTROL';
      const unit = tgt.param ? (e.props.mapping === 'log' ? 'octaves' : tgt.param.unit) : '';
      const est = opts.edgeStatus ? opts.edgeStatus.get(e.id) : null;
      const route = edgeRoute(model, e, { registry, status: est });
      const code = route.state === 'no-route' && est ? est.code : null;
      const statusText = [code ? `${route.text} (${code})` : route.text,
        ...entityNotes(opts.truth, 'edge', e.id)].filter(Boolean).join(' · ');
      return {
        kind: 'edge',
        key: `edge:${e.id}:${control ? 'c' : 'a'}:${route.state}:${statusText}`,
        route: route.state,
        routeReason: route.reason,
        routeText: route.text,
        routeCode: code,
        statusText,
        id: e.id,
        title: 'Connection',
        text: describeEdge(model, e.id, { registry }),
        fromNode: a.id,
        toNode: b.id,
        fromText: `${a.metadata.name} / ${src.label}`,
        toText: `${b.metadata.name} / ${tgt.label}`,
        signalType: src.type,
        signalNoun: PORT_VISUALS[src.type].noun,
        cable: PORT_VISUALS[src.type].cable,
        role: tgt.role,
        muted: !!e.props.muted,
        control,
        props: { ...e.props },
        unit,
        logAllowed: !!(tgt.param && tgt.param.mapping === 'log'),
        linearDepth: (() => {
          const pd = tgt.param ? registry.param(b.type, tgt.param.key) : null;
          return pd && finite(pd.modDepth) ? pd.modDepth : 1;
        })(),
      };
    }
  }
  if (clips.length) {
    const c = model.timeline.clips.find((x) => x.id === clips[clips.length - 1]);
    if (c) {
      const track = model.timeline.tracks.find((t) => t.id === c.trackId);
      const target = nodeOf(model, c.target || (track && track.target));
      return {
        kind: 'clip',
        key: `clip:${c.id}`,
        id: c.id,
        title: `${c.kind[0].toUpperCase()}${c.kind.slice(1)} clip`,
        clipKind: c.kind,
        start: c.start,
        duration: c.duration,
        trackId: c.trackId,
        tracks: model.timeline.tracks.map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
        targetName: target ? target.metadata.name : 'No target',
        detail: c.kind === 'pattern' ? c.payload.blockType : c.kind === 'measurement'
          ? c.payload.action : (c.payload && c.payload.action) || 'gate',
      };
    }
  }
  if ((sel.points || []).length) {
    const pid = sel.points[sel.points.length - 1];
    for (const lane of model.timeline.automation) {
      const pt = lane.points.find((x) => x.id === pid);
      if (!pt) continue;
      const node = nodeOf(model, lane.target.node);
      const p = node ? registry.param(node.type, lane.target.param) : null;
      return {
        kind: 'point',
        key: `point:${pt.id}`,
        id: pt.id,
        laneId: lane.id,
        title: 'Automation point',
        laneText: `${node ? node.metadata.name : lane.target.node} ${p ? p.label : ''}`.trim(),
        time: pt.time,
        valueText: p ? formatParamValue(p, pt.value) : String(pt.value),
        curve: pt.curve,
      };
    }
  }
  return {
    kind: 'studio',
    key: 'studio',
    title: model.metadata.title,
    summary: summarizeGraph(model, { registry }),
    counts: { nodes: model.graph.nodes.length, edges: model.graph.edges.length,
      clips: model.timeline.clips.length, lanes: model.timeline.automation.length },
    settings: studioSettingsView(model),
    runtime: runtimeView(model, opts.truth, opts),
    trace: traceView(model, opts.trace, { registry }),
  };
}

// ---------------------------------------------------------------- DOM

/** Mount the Inspector into `host`. */
export function mountInspector(host, svc) {
  const registry = svc.registry || NODE_REGISTRY;
  let current = null; // the rendered view key
  let builtSig = ''; // textSig of the rendered node view
  let refs = new Map(); // field key -> { input, slider, readout, error, field }
  let gestureOpen = false;

  const dispatch = (action) => {
    const r = svc.store.dispatch(action);
    const text = announceAction(r);
    if (text) svc.announce(text, { assertive: !r.ok });
    return r;
  };

  function endSliderGesture() {
    if (!gestureOpen) return;
    gestureOpen = false;
    const r = svc.store.endGesture();
    if (r && r.label) svc.announce(`${r.label.replace(/^Change /, 'Changed ')}`);
  }

  function showError(ref, text) {
    if (!ref || !ref.error) return;
    setText(ref.error, text || '');
    ref.error.hidden = !text;
    if (ref.input) setAttr(ref.input, 'aria-invalid', text ? 'true' : null);
  }

  // ---------------------------------------------------------------- field builders
  function numberField(view, f) {
    const id = `osc-si-${view.id}-${f.key}`;
    const input = h('input', { class: 'osc-number osc-si-input osc-num', id, type: 'text',
      inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'data-key': f.key,
      'data-osc': 'studio.inspector.param', value: f.input,
      'aria-describedby': `${id}-err` });
    const slider = h('input', { class: 'osc-slider osc-si-slider', type: 'range',
      min: 0, max: SLIDER_STEPS, step: 1, value: f.slider, 'data-key': f.key,
      'aria-label': `${f.label} slider`, 'aria-valuetext': f.text });
    slider.style.setProperty('--osc-fill', sliderFill(slider));
    const readout = h('span', { class: 'osc-si-readout osc-num', text: f.text });
    const error = h('p', { class: 'osc-si-error', id: `${id}-err`, hidden: true });
    const ref = { input, slider, readout, error, field: f };
    input.addEventListener('change', () => {
      const r = parseParamInput(f.param, input.value);
      if (!r.ok) {
        showError(ref, r.error);
        svc.announce(r.error, { assertive: true });
        return;
      }
      const res = dispatch({ type: 'NODE_PARAM_SET', nodeId: view.id, key: f.key,
        value: r.value });
      showError(ref, res.ok ? '' : res.reason);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = ref.field.input;
        showError(ref, '');
      }
    });
    slider.addEventListener('input', () => {
      if (!gestureOpen) {
        svc.store.beginGesture();
        gestureOpen = true;
      }
      const value = sliderToValue(f.param, Number(slider.value));
      const res = svc.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: view.id, key: f.key,
        value });
      if (!res.ok) showError(ref, res.reason);
    });
    slider.addEventListener('change', endSliderGesture);
    slider.addEventListener('pointerup', endSliderGesture);
    slider.addEventListener('blur', endSliderGesture);
    refs.set(f.key, ref);
    return h('div', { class: 'osc-si-field', 'data-field': f.key }, [
      h('div', { class: 'osc-si-row' }, [
        h('label', { class: 'osc-label osc-si-label', for: id, text: f.label }),
        readout,
      ]),
      h('div', { class: 'osc-si-row osc-si-row--edit' }, [input,
        f.unit ? h('span', { class: 'osc-si-unit', text: f.unit }) : null]),
      slider,
      error,
      fieldNotes(view, f),
    ]);
  }

  function fieldNotes(view, f) {
    const notes = [];
    if (f.modulatedBy.length) {
      notes.push(h('p', { class: 'osc-si-note', text: `Modulated: ${f.modulatedBy.join('; ')}` }));
    }
    if (f.automatable) {
      notes.push(h('button', { type: 'button', class: 'osc-btn osc-btn-secondary osc-si-auto',
        'data-osc': 'studio.inspector.automate', 'data-key': f.key,
        'aria-pressed': f.automated ? 'true' : 'false',
        text: f.automated ? 'Automated · show lane' : 'Automate',
        onClick: () => automate(view, ref(f.key)) }));
    }
    return notes.length ? h('div', { class: 'osc-si-notes' }, notes) : null;
  }

  const ref = (key) => refs.get(key);

  function automate(view, r) {
    const f = r ? r.field : null;
    if (!f) return;
    const model = svc.store.getModel();
    const lane = model.timeline.automation.find((l) => l.target.node === view.id
      && l.target.param === f.key);
    if (lane) {
      svc.store.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [view.id],
        points: lane.points.map((p) => p.id) } });
      // The workspace reveals it (and opens the Timeline subview when it is not on screen,
      // V431 U8) and says where it is.
      if (svc.onShowLane) svc.onShowLane(lane.id, `${view.name} ${f.label}`);
      else svc.announce(`${view.name} ${f.label} automation lane shown`);
      return;
    }
    dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: view.id, param: f.key }, time: 0,
      value: f.value, curve: 'linear' });
  }

  function selectField(view, f) {
    const id = `osc-si-${view.id}-${f.key}`;
    const sel = h('select', { id, 'data-key': f.key, 'data-osc': 'studio.inspector.param' },
      f.options.map((o) => h('option', { value: o.value, text: o.label })));
    sel.value = f.value;
    sel.addEventListener('change', () => {
      dispatch({ type: 'NODE_PARAM_SET', nodeId: view.id, key: f.key, value: sel.value });
    });
    refs.set(f.key, { input: sel, field: f });
    return h('div', { class: 'osc-si-field', 'data-field': f.key }, [
      h('label', { class: 'osc-label osc-si-label', for: id, text: f.label }),
      h('div', { class: 'osc-select' }, [sel]),
    ]);
  }

  function toggleField(view, f) {
    const btn = h('button', { type: 'button', class: 'osc-toggle osc-si-toggle', role: 'switch',
      'aria-checked': f.value ? 'true' : 'false', 'data-key': f.key,
      'data-osc': 'studio.inspector.param' }, [
      h('span', { class: 'osc-toggle-track', 'aria-hidden': 'true' }),
      h('span', { class: 'osc-toggle-label', text: f.label }),
    ]);
    btn.addEventListener('click', () => {
      dispatch({ type: 'NODE_PARAM_SET', nodeId: view.id, key: f.key,
        value: btn.getAttribute('aria-checked') !== 'true' });
    });
    refs.set(f.key, { input: btn, field: f, toggle: true });
    return h('div', { class: 'osc-si-field', 'data-field': f.key }, [btn]);
  }

  function listField(view, f) {
    const id = `osc-si-${view.id}-${f.key}`;
    const input = h('input', { class: 'osc-number osc-si-input osc-num', id, type: 'text',
      autocomplete: 'off', 'data-key': f.key, 'data-osc': 'studio.inspector.param',
      value: f.input, 'aria-describedby': `${id}-err` });
    const error = h('p', { class: 'osc-si-error', id: `${id}-err`, hidden: true });
    const r = { input, error, field: f };
    input.addEventListener('change', () => {
      const p = parseParamInput(f.param, input.value);
      if (!p.ok) {
        showError(r, p.error);
        svc.announce(p.error, { assertive: true });
        return;
      }
      const res = dispatch({ type: 'NODE_PARAM_SET', nodeId: view.id, key: f.key,
        value: p.value });
      showError(r, res.ok ? '' : res.reason);
    });
    refs.set(f.key, r);
    return h('div', { class: 'osc-si-field', 'data-field': f.key }, [
      h('label', { class: 'osc-label osc-si-label', for: id, text: f.label }), input, error]);
  }

  function readonlyField(f) {
    refs.set(f.key, { field: f, readout: h('span', { class: 'osc-num', text: f.text }) });
    return h('div', { class: 'osc-si-field osc-si-row' }, [
      h('span', { class: 'osc-label osc-si-label', text: f.label }), refs.get(f.key).readout]);
  }

  function textInput(id, label, value, onChange, dataOsc) {
    const input = h('input', { class: 'osc-number osc-si-input', id, type: 'text',
      autocomplete: 'off', spellcheck: 'false', value, 'data-osc': dataOsc,
      'data-key': dataOsc });
    input.addEventListener('change', () => onChange(input.value, input));
    refs.set(dataOsc, { input, field: { input: value } });
    return h('div', { class: 'osc-si-field' }, [
      h('label', { class: 'osc-label osc-si-label', for: id, text: label }), input]);
  }

  function numberInput(id, label, value, unit, onChange, dataOsc) {
    const input = h('input', { class: 'osc-number osc-si-input osc-num', id, type: 'text',
      inputmode: 'decimal', autocomplete: 'off', value: String(value), 'data-osc': dataOsc,
      'data-key': dataOsc });
    input.addEventListener('change', () => {
      const v = Number(String(input.value).trim().replace(',', '.'));
      if (!finite(v)) {
        svc.announce(`${label} must be a number.`, { assertive: true });
        input.value = String(refs.get(dataOsc).field.input);
        return;
      }
      onChange(v, input);
    });
    refs.set(dataOsc, { input, field: { input: String(value) } });
    return h('div', { class: 'osc-si-field osc-si-field--half' }, [
      h('label', { class: 'osc-label osc-si-label', for: id, text: label }),
      h('div', { class: 'osc-si-row osc-si-row--edit' }, [input,
        unit ? h('span', { class: 'osc-si-unit', text: unit }) : null]),
    ]);
  }

  // data-key: a rebuilt view that has the same action (Duplicate on the copy) keeps focus on it.
  function actionButton(text, dataOsc, onClick, cls = 'osc-btn-secondary') {
    return h('button', { type: 'button', class: `osc-btn ${cls}`, 'data-osc': dataOsc,
      'data-key': dataOsc, text, onClick });
  }

  // ---------------------------------------------------------------- views
  // The heading takes programmatic focus (tabindex -1) when an action replaced the view.
  function header(title, sub) {
    return h('div', { class: 'osc-si-head' }, [
      h('h4', { class: 'osc-si-title', 'data-osc': 'studio.inspector.title', tabindex: '-1',
        text: title }),
      sub ? h('p', { class: 'osc-si-sub', text: sub }) : null,
    ]);
  }

  function buildNode(view) {
    const parts = [header(view.name, `${view.typeLabel} · ${view.categoryLabel}`)];
    if (view.statusText) {
      parts.push(h('p', { class: `osc-si-status${view.statusError ? ' is-error' : ''}`,
        role: 'note', 'data-osc': 'studio.inspector.status', text: view.statusText }));
    }
    parts.push(textInput(`osc-si-${view.id}-name`, 'Name', view.name, (v, input) => {
      const r = dispatch({ type: 'NODE_RENAME', nodeId: view.id, name: v });
      if (!r.ok) input.value = view.name;
    }, 'studio.inspector.name'));
    for (const f of view.fields) {
      if (f.control === 'number') parts.push(numberField(view, f));
      else if (f.control === 'select') parts.push(selectField(view, f));
      else if (f.control === 'toggle') parts.push(toggleField(view, f));
      else if (f.control === 'list') parts.push(listField(view, f));
      else parts.push(readonlyField(f));
    }
    parts.push(h('div', { class: 'osc-si-pos' }, [
      numberInput(`osc-si-${view.id}-x`, 'Position X', view.position.x, '', (v) => {
        const m = svc.store.getModel().graph.nodes.find((n) => n.id === view.id);
        if (m) dispatch({ type: 'NODE_MOVE', nodeId: view.id, position: { x: v, y: m.position.y } });
      }, 'studio.inspector.x'),
      numberInput(`osc-si-${view.id}-y`, 'Position Y', view.position.y, '', (v) => {
        const m = svc.store.getModel().graph.nodes.find((n) => n.id === view.id);
        if (m) dispatch({ type: 'NODE_MOVE', nodeId: view.id, position: { x: m.position.x, y: v } });
      }, 'studio.inspector.y'),
    ]));
    const conns = h('ul', { class: 'osc-si-conns', 'aria-label': 'Connections',
      'data-osc': 'studio.inspector.connections' }, view.connections.map((c) => h('li', {}, [
      h('button', { type: 'button', class: 'osc-si-link', 'data-edge': c.edgeId, text: c.text,
        onClick: () => svc.store.dispatch({ type: 'SELECTION_CHANGE',
          selection: { edges: [c.edgeId] } }) }),
    ])));
    parts.push(h('div', { class: 'osc-si-section' }, [
      h('h5', { class: 'osc-si-h5', text: `Connections (${view.connections.length})` }),
      view.connections.length ? conns : h('p', { class: 'osc-si-note', text: 'None yet.' }),
    ]));
    parts.push(h('div', { class: 'osc-si-actions' }, [
      view.hasOutputs ? actionButton('Connect…', 'studio.inspector.connect',
        () => svc.onConnect(view.id)) : null,
      actionButton('Duplicate', 'studio.inspector.duplicate', () => svc.onDuplicate()),
      actionButton('Save as patch…', 'studio.inspector.savePatch',
        () => svc.onSavePatch([view.id])),
      actionButton('Delete', 'studio.inspector.delete', () => svc.onDelete(),
        'osc-btn-secondary osc-si-danger'),
    ]));
    parts.push(buildTrace(view.trace, 'Operations that touched this node, newest first.',
      view.id));
    if (view.help) {
      parts.push(h('details', { class: 'osc-si-help' }, [
        h('summary', { text: `About ${view.typeLabel}` }),
        h('p', { text: view.help.what }),
        h('p', { text: `Inputs: ${view.help.inputs}` }),
        h('p', { text: `Outputs: ${view.help.outputs}` }),
        h('p', { text: view.help.constraints }),
      ]));
    }
    return parts;
  }

  function buildEdge(view) {
    const parts = [header('Connection', `${view.signalNoun[0].toUpperCase()}${
      view.signalNoun.slice(1)} · ${view.cable}`)];
    if (view.statusText) {
      parts.push(h('p', { class: 'osc-si-status is-inactive', role: 'note',
        'data-osc': 'studio.inspector.edgeStatus', 'data-route': view.route,
        text: view.statusText }));
    }
    parts.push(h('dl', { class: 'osc-si-dl', 'data-osc': 'studio.inspector.edge' }, [
      h('div', {}, [h('dt', { text: 'From' }), h('dd', { text: view.fromText })]),
      h('div', {}, [h('dt', { text: 'To' }), h('dd', { text: view.toText })]),
      h('div', {}, [h('dt', { text: 'Signal' }), h('dd', { text: `${view.signalType}${
        view.role && view.role !== 'SIGNAL' ? ` · ${view.role}` : ''}` })]),
    ]));
    const mute = h('button', { type: 'button', class: 'osc-toggle osc-si-toggle', role: 'switch',
      'aria-checked': view.muted ? 'true' : 'false', 'data-osc': 'studio.inspector.mute',
      'data-key': 'muted' }, [h('span', { class: 'osc-toggle-track', 'aria-hidden': 'true' }),
      h('span', { class: 'osc-toggle-label', text: 'Muted' })]);
    mute.addEventListener('click', () => dispatch({ type: 'EDGE_UPDATE', edgeId: view.id,
      props: { muted: mute.getAttribute('aria-checked') !== 'true' } }));
    refs.set('muted', { input: mute, toggle: true, field: { value: view.muted } });
    parts.push(h('div', { class: 'osc-si-field' }, [mute]));
    if (view.control) {
      const unit = view.unit;
      parts.push(h('div', { class: 'osc-si-pos' }, [
        numberInput(`osc-si-${view.id}-depth`, 'Depth', view.props.depth, unit,
          (v) => dispatch({ type: 'EDGE_UPDATE', edgeId: view.id, props: { depth: v } }),
          'studio.inspector.depth'),
        numberInput(`osc-si-${view.id}-offset`, 'Offset', view.props.offset, unit,
          (v) => dispatch({ type: 'EDGE_UPDATE', edgeId: view.id, props: { offset: v } }),
          'studio.inspector.offset'),
      ]));
      const polarity = h('select', { id: `osc-si-${view.id}-pol`,
        'data-osc': 'studio.inspector.polarity', 'data-key': 'studio.inspector.polarity' }, [
        h('option', { value: 'bipolar', text: 'Bipolar (±depth)' }),
        h('option', { value: 'unipolar', text: 'Unipolar (0…depth)' })]);
      polarity.value = view.props.polarity;
      polarity.addEventListener('change', () => dispatch({ type: 'EDGE_UPDATE', edgeId: view.id,
        props: { polarity: polarity.value } }));
      refs.set('studio.inspector.polarity', { input: polarity, field: { value: view.props.polarity } });
      const mapping = h('select', { id: `osc-si-${view.id}-map`,
        'data-osc': 'studio.inspector.mapping', 'data-key': 'studio.inspector.mapping' }, [
        h('option', { value: 'linear', text: `Linear (${view.props.mapping === 'log' ? 'unit'
          : view.unit || 'unit'})` }),
        view.logAllowed ? h('option', { value: 'log', text: 'Logarithmic (octaves)' }) : null]);
      mapping.value = view.props.mapping;
      mapping.addEventListener('change', () => {
        // Depth units differ between the mappings: start the new one at its default depth.
        dispatch({ type: 'EDGE_UPDATE', edgeId: view.id, props: { mapping: mapping.value,
          depth: mapping.value === 'log' ? 1 : view.linearDepth, offset: 0 } });
      });
      refs.set('studio.inspector.mapping', { input: mapping, field: { value: view.props.mapping } });
      parts.push(h('div', { class: 'osc-si-field' }, [
        h('label', { class: 'osc-label osc-si-label', for: `osc-si-${view.id}-pol`,
          text: 'Polarity' }), h('div', { class: 'osc-select' }, [polarity])]));
      parts.push(h('div', { class: 'osc-si-field' }, [
        h('label', { class: 'osc-label osc-si-label', for: `osc-si-${view.id}-map`,
          text: 'Mapping' }), h('div', { class: 'osc-select' }, [mapping])]));
      parts.push(h('p', { class: 'osc-si-note', text: 'Modulation adds to the parameter’s '
        + 'automated or set value; depth belongs to this connection.' }));
    }
    parts.push(h('div', { class: 'osc-si-actions' }, [
      actionButton('Select source', 'studio.inspector.selectFrom', () => svc.store.dispatch({
        type: 'SELECTION_CHANGE', selection: { nodes: [view.fromNode] } })),
      actionButton('Select target', 'studio.inspector.selectTo', () => svc.store.dispatch({
        type: 'SELECTION_CHANGE', selection: { nodes: [view.toNode] } })),
      actionButton('Delete connection', 'studio.inspector.deleteEdge', () => svc.onDelete(),
        'osc-btn-secondary osc-si-danger'),
    ]));
    return parts;
  }

  function buildClip(view) {
    const parts = [header(view.title, `${view.detail} · ${view.targetName}`)];
    parts.push(h('div', { class: 'osc-si-pos' }, [
      numberInput(`osc-si-${view.id}-start`, 'Start', view.start, 's',
        (v) => dispatch({ type: 'CLIP_MOVE', clipId: view.id, start: v }), 'studio.inspector.start'),
      numberInput(`osc-si-${view.id}-dur`, 'Duration', view.duration, 's',
        (v) => dispatch({ type: 'CLIP_RESIZE', clipId: view.id, duration: v }),
        'studio.inspector.duration'),
    ]));
    const track = h('select', { id: `osc-si-${view.id}-track`, 'data-osc': 'studio.inspector.track',
      'data-key': 'studio.inspector.track' },
    view.tracks.map((t) => h('option', { value: t.id, text: `${t.name} (${t.kind})` })));
    track.value = view.trackId;
    track.addEventListener('change', () => dispatch({ type: 'CLIP_MOVE', clipId: view.id,
      trackId: track.value }));
    refs.set('studio.inspector.track', { input: track, field: { value: view.trackId } });
    parts.push(h('div', { class: 'osc-si-field' }, [
      h('label', { class: 'osc-label osc-si-label', for: `osc-si-${view.id}-track`,
        text: 'Track' }), h('div', { class: 'osc-select' }, [track])]));
    return parts;
  }

  function buildPoint(view) {
    return [header(view.title, view.laneText), h('dl', { class: 'osc-si-dl' }, [
      h('div', {}, [h('dt', { text: 'Time' }), h('dd', { class: 'osc-num',
        text: `${sig(view.time, 4)} s` })]),
      h('div', {}, [h('dt', { text: 'Value' }), h('dd', { class: 'osc-num',
        text: view.valueText })]),
      h('div', {}, [h('dt', { text: 'Curve' }), h('dd', { text: view.curve })]),
    ]), h('p', { class: 'osc-si-note', text: 'Edit the point on its lane in the timeline.' })];
  }

  function buildMulti(view) {
    return [header(view.title, view.names.slice(0, 6).join(', ')
      + (view.names.length > 6 ? ` and ${view.names.length - 6} more` : '')),
    h('div', { class: 'osc-si-actions' }, [
      actionButton('Duplicate', 'studio.inspector.duplicate', () => svc.onDuplicate()),
      actionButton('Save as patch…', 'studio.inspector.savePatch',
        () => svc.onSavePatch(view.ids)),
      actionButton('Delete', 'studio.inspector.delete', () => svc.onDelete(),
        'osc-btn-secondary osc-si-danger'),
    ])];
  }

  /** Apply a Studio settings edit (settingsAction): refused text is announced and reverted. */
  function applySetting(key, raw, revert) {
    const a = settingsAction(svc.store.getModel(), key, raw);
    if (a.error) {
      svc.announce(a.error, { assertive: true });
      if (revert) revert();
      return null;
    }
    const r = dispatch(a);
    if (!r.ok && revert) revert();
    return r;
  }

  function settingInput(key, label, value, unit, cls = 'osc-si-field osc-si-field--half') {
    const id = `osc-si-studio-${key}`;
    const dataOsc = `studio.inspector.${key}`;
    const input = h('input', { class: 'osc-number osc-si-input osc-num', id, type: 'text',
      inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', value: String(value),
      'data-osc': dataOsc, 'data-key': dataOsc });
    const ref = { input, field: { input: String(value) } };
    input.addEventListener('change', () => applySetting(key, input.value, () => {
      input.value = ref.field.input;
    }));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') input.value = ref.field.input;
    });
    refs.set(dataOsc, ref);
    return h('div', { class: cls }, [
      h('label', { class: 'osc-label osc-si-label', for: id, text: label }),
      h('div', { class: 'osc-si-row osc-si-row--edit' }, [input,
        unit ? h('span', { class: 'osc-si-unit', text: unit }) : null]),
    ]);
  }

  function settingSelect(key, label, options, value, cls = 'osc-si-field') {
    const id = `osc-si-studio-${key}`;
    const dataOsc = `studio.inspector.${key}`;
    const sel = h('select', { id, 'data-osc': dataOsc, 'data-key': dataOsc },
      options.map((o) => h('option', { value: String(o.value), text: o.label })));
    sel.value = String(value);
    const ref = { input: sel, field: { value } };
    sel.addEventListener('change', () => applySetting(key, sel.value, () => {
      sel.value = String(ref.field.value);
    }));
    refs.set(dataOsc, ref);
    return h('div', { class: cls }, [
      h('label', { class: 'osc-label osc-si-label', for: id, text: label }),
      h('div', { class: 'osc-select' }, [sel])]);
  }

  function buildStudio(view) {
    const st = view.settings;
    const loopBtn = h('button', { type: 'button', class: 'osc-toggle osc-si-toggle',
      role: 'switch', 'aria-checked': st.loop.enabled ? 'true' : 'false',
      'data-osc': 'studio.inspector.loop', 'data-key': 'studio.inspector.loop' }, [
      h('span', { class: 'osc-toggle-track', 'aria-hidden': 'true' }),
      h('span', { class: 'osc-toggle-label', text: 'Loop' })]);
    loopBtn.addEventListener('click', () => applySetting('loop',
      loopBtn.getAttribute('aria-checked') !== 'true'));
    refs.set('studio.inspector.loop', { input: loopBtn, toggle: true });
    const notesId = 'osc-si-studio-notes';
    const notes = h('textarea', { class: 'osc-number osc-si-input osc-si-textarea', id: notesId,
      rows: '2', maxlength: String(st.notesMax), spellcheck: 'true',
      'data-osc': 'studio.inspector.notes', 'data-key': 'studio.inspector.notes' });
    notes.value = st.notes;
    const notesRef = { input: notes, field: { input: st.notes } };
    notes.addEventListener('change', () => applySetting('notes', notes.value, () => {
      notes.value = notesRef.field.input;
    }));
    refs.set('studio.inspector.notes', notesRef);
    const length = h('span', { class: 'osc-num', 'data-osc': 'studio.inspector.length',
      text: st.lengthText });
    refs.set('studio.inspector.lengthText', { readout: length });
    return [header('Studio', `${view.counts.nodes} nodes · ${view.counts.edges} connections · `
      + `${view.counts.clips} clips · ${view.counts.lanes} automation lanes`),
    buildRuntime(view.runtime),
    buildTrace(view.trace, 'What each recent operation did, newest first.'),
    textInput('osc-si-studio-title', 'Title', view.title, (v, input) => {
      const r = dispatch({ type: 'METADATA_SET', title: v.trim() || view.title });
      if (!r.ok) input.value = view.title;
    }, 'studio.inspector.studioTitle'),
    h('section', { class: 'osc-si-section', 'aria-label': 'Transport',
      'data-osc': 'studio.inspector.transport' }, [
      h('h5', { class: 'osc-si-h5', text: 'Transport' }),
      settingSelect('timeMode', 'Time', st.timeModes, st.timeMode),
      h('div', { class: 'osc-si-pos' }, [
        settingInput('tempo', 'Tempo', st.tempo, 'BPM'),
        settingInput('beats', 'Beats per bar', st.beats, ''),
      ]),
      settingSelect('unit', 'Beat unit', st.units.map((u) => ({ value: u,
        label: `1/${u} note` })), st.unit),
      h('div', { class: 'osc-si-field' }, [loopBtn]),
      h('div', { class: 'osc-si-pos' }, [
        settingInput('loopStart', 'Loop start', st.loop.start, 's'),
        settingInput('loopEnd', 'Loop end', st.loop.end, 's'),
      ]),
      h('div', { class: 'osc-si-row' }, [
        h('span', { class: 'osc-label osc-si-label', text: 'Length' }), length]),
    ]),
    h('div', { class: 'osc-si-field' }, [
      h('label', { class: 'osc-label osc-si-label', for: notesId, text: 'Notes' }), notes]),
    h('p', { class: 'osc-si-summary', 'data-osc': 'studio.inspector.summary',
      text: view.summary }),
    h('p', { class: 'osc-si-note', text: 'Select a node or a connection to edit it. Press N '
      + 'to add a node, C to connect the selected node, / to find a node.' })];
  }

  // The Runtime section (ADR 0039): the state in words for everyone, the diagnostics with a
  // button selecting the entity each names, and the identities and counts behind a disclosure.
  // Rebuilt in place when it changes; the disclosure keeps its open state, a focused entity
  // button its focus (data-key).
  let rt = null;
  function buildRuntime(rv) {
    rt = { sig: '', status: h('p', { role: 'note', 'data-osc': 'studio.inspector.runtimeState' }),
      list: h('ul', { class: 'osc-si-conns osc-si-diags', 'aria-label': 'Diagnostics',
        'data-osc': 'studio.inspector.diagnostics' }),
      dl: h('dl', { class: 'osc-si-dl' }) };
    fillRuntime(rv);
    return h('section', { class: 'osc-si-section', 'aria-label': 'Runtime',
      'data-osc': 'studio.inspector.runtime' }, [
      h('h5', { class: 'osc-si-h5', text: 'Runtime' }), rt.status, rt.list,
      h('details', { class: 'osc-si-help' }, [h('summary', { text: 'Runtime details' }), rt.dl]),
    ]);
  }

  function fillRuntime(rv) {
    const sig = JSON.stringify(rv);
    if (!rt || rt.sig === sig) return;
    rt.sig = sig;
    const bad = rv.state === 'refused' || rv.state === 'failed';
    setAttr(rt.status, 'class', `osc-si-status${bad ? ' is-error' : ''}`);
    setAttr(rt.status, 'data-state', rv.state);
    replaceChildren(rt.status, [h('strong', { text: rv.label }),
      ` · ${rv.text}${rv.code ? ` (${rv.code})` : ''}`]);
    const active = document.activeElement;
    const key = rt.list.contains(active) ? active.getAttribute('data-key') : null;
    replaceChildren(rt.list, rv.diagnostics.map((d) => {
      const e = d.entity;
      return h('li', {}, [
        h('p', { class: 'osc-si-note', text: `${d.message} (${d.code}, ${d.owner})` }),
        e && e.selection ? h('button', { type: 'button', class: 'osc-si-link',
          'data-key': `diag:${e.kind}:${e.id}`, text: `Select ${e.label}`,
          onClick: () => svc.store.dispatch({ type: 'SELECTION_CHANGE',
            selection: e.selection }) }) : null,
      ]);
    }));
    rt.list.hidden = !rv.diagnostics.length;
    const el = key && rt.list.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (el) el.focus();
    const a = rv.applied;
    const list = (x) => x.join(', ') || 'None';
    replaceChildren(rt.dl, [
      ['Desired', `rev ${rv.desired.revision ?? '—'} · studio ${rv.desired.hash}`],
      ['Applied', a ? `rev ${a.revision} · plan ${a.planHash} · ${a.at}` : 'Nothing'],
      ['Nodes', `${rv.nodes.ready} ready · ${rv.nodes.degraded} degraded · `
        + `${rv.nodes.offline} offline`],
      ['Cables', `${rv.edges.live} live · ${rv.edges.inactive} inactive · `
        + `${rv.edges['no-effect']} no effect`],
      ['Lanes', list(rv.lanes)],
      ['Owned', list(rv.owned)],
    ].map(([k, v]) => h('div', {}, [h('dt', { text: k }),
      h('dd', { class: 'osc-num', text: v })])));
  }

  // The Trace section (ADR 0042): one disclosure per operation, its steps in words. Built with
  // the view from the settled operations, then refilled only by renderTrace once an operation
  // has ended; an open disclosure stays open and a focused one keeps focus (data-key), or
  // focus goes to the heading when that operation is no longer listed.
  let tr = null;
  const traceOpen = new Set();
  function buildTrace(tv, intro, nodeId = null) {
    tr = { sig: '', note: h('p', { class: 'osc-si-note' }), list: h('ol', {
      class: 'osc-si-conns osc-si-trace', 'aria-label': 'Operations',
      'data-osc': 'studio.inspector.traceOps' }), intro, nodeId };
    fillTrace(tv);
    return h('section', { class: 'osc-si-section', 'aria-label': 'Trace',
      'data-osc': 'studio.inspector.trace' }, [h('h5', { class: 'osc-si-h5', text: 'Trace' }),
      tr.note, tr.list]);
  }

  function fillTrace(tv) {
    const sig = JSON.stringify(tv);
    if (!tr || tr.sig === sig) return;
    tr.sig = sig;
    setText(tr.note, tv.total ? `${tr.intro} ${tv.shown} of ${tv.total} shown; kept in memory `
      + 'only, never saved.' : 'Nothing traced yet: edit, play or stop to see what happens.');
    const active = document.activeElement;
    const key = tr.list.contains(active) ? active.getAttribute('data-key') : null;
    replaceChildren(tr.list, tv.ops.map((o) => {
      const d = h('details', { class: 'osc-si-help', 'data-op': o.op }, [
        h('summary', { 'data-key': `trace:${o.op}`, text: `${o.op} · ${o.title} · ${o.outcome}` }),
        h('ol', { class: 'osc-si-trace-steps' }, o.steps.map((x) => h('li', {
          class: BAD.includes(x.outcome) ? 'is-error' : null, text: x.text })))]);
      d.open = traceOpen.has(o.op);
      d.addEventListener('toggle', () => (d.open ? traceOpen.add(o.op)
        : traceOpen.delete(o.op)));
      return h('li', {}, [d]);
    }));
    const el = key && tr.list.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (el) el.focus();
    else if (key) focusHeading(); // the focused operation is no longer shown
  }

  /** Refresh the Studio view's settings in place (a focused field keeps what is typed). */
  function updateStudio(view) {
    const st = view.settings;
    const active = document.activeElement;
    const put = (key, v) => {
      const r = refs.get(`studio.inspector.${key}`);
      if (!r) return;
      if ('input' in r.field) r.field.input = String(v);
      else r.field.value = v;
      if (r.input !== active) r.input.value = String(v);
    };
    put('timeMode', st.timeMode);
    put('tempo', st.tempo);
    put('beats', st.beats);
    put('unit', st.unit);
    put('loopStart', st.loop.start);
    put('loopEnd', st.loop.end);
    put('notes', st.notes);
    const loop = refs.get('studio.inspector.loop');
    if (loop) setAttr(loop.input, 'aria-checked', st.loop.enabled ? 'true' : 'false');
    const len = refs.get('studio.inspector.lengthText');
    if (len) setText(len.readout, st.lengthText);
    fillRuntime(view.runtime);
  }

  // ---------------------------------------------------------------- render
  /** The texts of a node view that update() does not refresh in place. */
  function textSig(view) {
    if (view.kind !== 'node') return '';
    return [!!view.statusText, ...view.connections.map((c) => c.text), ...view.fields.map((f) =>
      f.modulatedBy.join('|'))].join('\n');
  }

  function update(view) {
    const active = document.activeElement;
    if (view.kind === 'node') {
      for (const f of view.fields) {
        const r = refs.get(f.key);
        if (!r) continue;
        r.field = f;
        if (r.readout) setText(r.readout, f.text);
        if (r.toggle) setAttr(r.input, 'aria-checked', f.value ? 'true' : 'false');
        else if (r.input && r.input !== active) {
          if (r.input.tagName === 'SELECT') r.input.value = f.value;
          else r.input.value = f.input;
        }
        if (r.slider && r.slider !== active) {
          r.slider.value = String(f.slider);
          r.slider.style.setProperty('--osc-fill', sliderFill(r.slider));
        }
        if (r.slider) setAttr(r.slider, 'aria-valuetext', f.text);
      }
      const name = refs.get('studio.inspector.name');
      if (name && name.input !== active) name.input.value = view.name;
      const head = host.querySelector('[data-osc="studio.inspector.title"]');
      if (head) setText(head, view.name);
      for (const [k, v] of [['studio.inspector.x', view.position.x],
        ['studio.inspector.y', view.position.y]]) {
        const r = refs.get(k);
        if (r && r.input !== active) r.input.value = String(v);
        if (r) r.field.input = String(v);
      }
      return true;
    }
    if (view.kind === 'edge') {
      const m = refs.get('muted');
      if (m) setAttr(m.input, 'aria-checked', view.muted ? 'true' : 'false');
      for (const [k, v] of [['studio.inspector.depth', view.props.depth],
        ['studio.inspector.offset', view.props.offset]]) {
        const r = refs.get(k);
        if (r && r.input !== active) r.input.value = String(v);
        if (r) r.field.input = String(v);
      }
      const pol = refs.get('studio.inspector.polarity');
      if (pol && pol.input !== active) pol.input.value = view.props.polarity;
      const map = refs.get('studio.inspector.mapping');
      if (map && map.input !== active) map.input.value = view.props.mapping;
      return true;
    }
    if (view.kind === 'clip') {
      for (const [k, v] of [['studio.inspector.start', view.start],
        ['studio.inspector.duration', view.duration]]) {
        const r = refs.get(k);
        if (r && r.input !== active) r.input.value = String(v);
        if (r) r.field.input = String(v);
      }
      const t = refs.get('studio.inspector.track');
      if (t && t.input !== active) t.input.value = view.trackId;
      return true;
    }
    return false;
  }

  let said = null; // the runtime state last rendered
  function render() {
    const model = svc.store.getModel();
    const truth = svc.truth ? svc.truth() : null;
    const view = inspectorView(model, svc.store.getSelection(), { registry,
      status: svc.status ? svc.status() : null, warnings: svc.warnings ? svc.warnings() : null,
      edgeStatus: svc.edgeStatus ? svc.edgeStatus() : null, truth,
      trace: svc.trace ? svc.trace() : null });
    // A changed runtime state is announced politely; Play and Stop say their own.
    const state = runtimeState(truth && truth.verdict);
    if (said && state !== said && !(QUIET.includes(state) && QUIET.includes(said))) {
      svc.announce(`Runtime: ${RUNTIME_LABELS[state]}`);
    }
    said = state;
    // Same target and same fields: update values in place (the focused field keeps focus and
    // what is being typed); the summary and status lines are rebuilt below.
    const sameTarget = current === view.key && view.kind !== 'studio' && view.kind !== 'multi'
      && view.kind !== 'point';
    if (sameTarget && update(view)) {
      const status = host.querySelector('[data-osc="studio.inspector.status"]');
      if (view.kind === 'node' && status) {
        setText(status, view.statusText);
        status.classList.toggle('is-error', view.statusError);
      }
      // The connection list and the "Modulated" notes are text built with the view: rebuild
      // when they change (a connection added or removed, or one that stopped carrying anything
      // after a filter type change, §237). Focus is kept by data-key.
      if (view.kind === 'node' && textSig(view) !== builtSig) {
        current = null;
        return render();
      }
      return;
    }
    if (current === view.key && view.kind === 'studio') {
      updateStudio(view);
      const sum = host.querySelector('[data-osc="studio.inspector.summary"]');
      if (sum) setText(sum, view.summary);
      const t = refs.get('studio.inspector.studioTitle');
      if (t && t.input !== document.activeElement) t.input.value = view.title;
      const sub = host.querySelector('.osc-si-sub');
      if (sub) setText(sub, `${view.counts.nodes} nodes · ${view.counts.edges} connections · `
        + `${view.counts.clips} clips · ${view.counts.lanes} automation lanes`);
      return;
    }
    endSliderGesture();
    const hadFocus = host.contains(document.activeElement);
    const focusedKey = hadFocus ? document.activeElement.getAttribute('data-key') : null;
    refs = new Map();
    rt = null;
    tr = null;
    current = view.key;
    builtSig = textSig(view);
    const builders = { node: buildNode, edge: buildEdge, clip: buildClip, point: buildPoint,
      multi: buildMulti, studio: buildStudio };
    replaceChildren(host, h('div', { class: `osc-si osc-si--${view.kind}`,
      'data-kind': view.kind }, builders[view.kind](view)));
    const el = focusedKey ? host.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`) : null;
    if (el) el.focus();
    else if (hadFocus) focusHeading();
  }

  function focusHeading() {
    const head = host.querySelector('[data-osc="studio.inspector.title"]');
    if (!head || !head.getClientRects().length) return false;
    head.focus({ preventScroll: false });
    return true;
  }

  return {
    render,
    renderTrace() {
      if (tr && svc.trace) {
        fillTrace(traceView(svc.store.getModel(), svc.trace(), { registry, nodeId: tr.nodeId }));
      }
    },
    /** Focus the first editable field (Enter on a node, §142). */
    focusFirst() {
      const el = host.querySelector('input, select, button');
      if (el) el.focus();
      return !!el;
    },
    focusHeading,
    /** Focus the shown control with this data-key; false when there is none. */
    focusKey(key) {
      const el = host.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (!el || !el.getClientRects().length) return false;
      el.focus();
      return true;
    },
    destroy() {
      endSliderGesture();
      replaceChildren(host, []);
    },
  };
}

// The Studio Inspector's runtime and trace view models, split from inspector.js (its source-size
// cap; no behaviour change): the runtime state, the diagnostics in effect with the entity, cause
// and parameter each names, and the Trace section of a node's steps. inspector.js imports them,
// re-exports the public ones where their callers and tests read them, and keeps the Runtime
// summary (runtimeView) and its labels, whose sentences are still English (the Czech-prose
// ratchet counts them per file, and a new file may hold none).

import { NODE_REGISTRY } from '../../studio/registry.js';
import { describeEdge } from '../../studio/a11y.js';
import { sig } from '../../core/math.js';
import { formatParamValue } from './inspector-fields.js';

export function nodeOf(model, id) {
  return model.graph.nodes.find((n) => n.id === id) || null;
}

/** The divergence state, with a stopped runtime that refused PLAY as 'failed'. */
export const runtimeState = (v) => (!v ? 'not-applied'
  : v.state === 'not-applied' && v.reason ? 'failed' : v.state);

/** The first 8 hex digits of a hash, '—' for none. */
export const shortHash = (h) => (h ? h.slice(0, 8) : '—');

export function runtimeDiagnostics(truth) {
  const v = truth && truth.verdict;
  if (!v) return [];
  const of = (x) => (v.applied && x && x.diagnostics) || [];
  // Once each: a degraded verdict's reason is also one of the runtime's diagnostics.
  return [...new Set([...(v.reason ? [v.reason] : []), ...of(truth.runtime),
    ...of(truth.transport)])];
}

/** "Filter Cutoff": a { node, param } target by name. */
export function paramText(model, t, registry) {
  const n = nodeOf(model, t.node);
  const p = n && registry.param(n.type, t.param);
  return `${n ? n.metadata.name : t.node} ${p ? p.label : t.param}`;
}

/** A diagnostic's entity as the Inspector links it: its name and the selection showing it. */
export function entityRef(model, ent, registry) {
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

/**
 * The entity a status's `cause` names (graph-view.js divergenceCause) as entityRef links it, or
 * null when there is none to select or it is `self`, the entity shown.
 */
export function causeRef(model, cause, self, registry) {
  if (!cause) return null;
  const kind = ['node', 'edge', 'clip', 'lane'].find((k) => cause[k]);
  if (!kind || (kind === self.kind && cause[kind] === self.id)) return null;
  const ref = entityRef(model, { kind, id: cause[kind] }, registry);
  return ref && ref.selection ? ref : null;
}

/** Operations the Trace section lists. */
export const TRACE_OPS_SHOWN = 12;
const TRACE_SECONDS = ['at', 'end', 'baseTime', 'fade', 'position'];
export const BAD = ['refused', 'failed', 'rejected'];

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
      // A step with no outcome (a bus leave, a plain stop) leaves it out instead of reading
      // "null" (live visual audit 2026-11-11, finding 6).
      outcome: [end.outcome != null ? `${end.outcome}${code ? ` (${code})` : ''}`
        : code ? `(${code})` : '', commit && commit.revision != null
        ? `revision ${commit.revision}` : ''].filter(Boolean).join(', ')
        + (failed.length ? ` · failed: ${failed.join(', ')}` : ''),
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
  return `${x.owner} ${x.kind}${x.outcome != null ? `: ${x.outcome}` : ''}${x.code
    ? ` (${x.code})` : ''}${x.revision != null
    ? ` · rev ${x.revision}` : ''} · ${what.filter(Boolean).join(', ')}`.replace(/ · $/, '');
}

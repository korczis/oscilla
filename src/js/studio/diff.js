// Studio comparator (ADR 0041; the layers of schema.js, ADR 0030). Pure: plain data in, plain
// data out; no DOM, no Web Audio, no clock.
//
//   studioChanges(a, b, { registry }) -> [Change]   (experiments/semantic-diff.js Change shape,
//     domain 'studio', kinds added|removed|changed — unchanged items are not listed)
// a and b are StudioModels or execution states (schema.js executionState: what an experiment
// records as studio.execution). EXECUTION changes: the schema version; nodes added, removed or
// of another type; each parameter changed, labelled and unitised by the node registry's
// parameter schema; connections, tracks and clips added, removed or changed; automation lanes
// (unit of the parameter they drive); loop; transport (tempo in BPM). PRESENTATION changes
// (two full models only): node positions and names, track names, markers, document metadata
// and the view (pan, zoom, timeline scale and scroll). A layout or view difference is never
// reported as an execution change; an experiment records only the execution state, so two runs
// can differ in execution only. Ids and keys are sorted by code unit; values are kept as they
// are (full precision).

import { canonicalJson } from '../experiments/canonical-json.js';
import { NODE_REGISTRY } from './registry.js';
import { executionState, presentationState } from './schema.js';

const byCode = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const same = (x, y) => canonicalJson(x ?? null) === canonicalJson(y ?? null);
const index = (list) => new Map((Array.isArray(list) ? list : []).map((x) => [x.id, x]));
const keysOf = (p, q) => [...new Set([...Object.keys(p || {}), ...Object.keys(q || {})])]
  .sort(byCode);
/** fn(id, a's record, b's record) for every id of two id-keyed lists, sorted. */
function both(p, q, fn) {
  const ma = index(p);
  const mb = index(q);
  for (const id of [...new Set([...ma.keys(), ...mb.keys()])].sort(byCode)) {
    fn(id, ma.get(id), mb.get(id));
  }
}

const layers = (m) => (m && m.graph
  ? { x: executionState(m), p: presentationState(m), v: m.view || {} } : { x: m || {} });

/** The changes between two Studio models or execution states (see the header). */
export function studioChanges(a, b, { registry = NODE_REGISTRY } = {}) {
  const A = layers(a);
  const B = layers(b);
  const out = [];
  const push = (cls, path, label, before, after, unit) => {
    if (same(before, after)) return;
    const kind = before == null ? 'added' : after == null ? 'removed' : 'changed';
    out.push({ domain: 'studio', path: `studio.${path}`, kind, class: cls,
      before: before ?? null, after: after ?? null, ...(unit ? { unit } : {}), label });
  };
  const exe = (...r) => push('execution', ...r);
  const pre = (...r) => push('presentation', ...r);
  const nodes = new Map([...index(A.x.nodes), ...index(B.x.nodes)]);
  const def = (id) => nodes.has(id) && registry.get(nodes.get(id).type);
  const name = (id) => `${def(id) ? def(id).displayName : (nodes.get(id) || {}).type || 'Node'} ${
    id}`;
  const param = (id, k) => (def(id) ? registry.param(nodes.get(id).type, k) : null);
  const tl = (L) => L.x.timeline || {};
  exe('schemaVersion', 'Studio schema version', A.x.schemaVersion, B.x.schemaVersion);
  both(A.x.nodes, B.x.nodes, (id, p, q) => {
    if (!p || !q || p.type !== q.type) {
      exe(`nodes.${id}`, `Node ${name(id)}`, p && p.type, q && q.type);
    } else {
      for (const k of keysOf(p.params, q.params)) {
        const d = param(id, k);
        exe(`nodes.${id}.params.${k}`, `${name(id)} · ${d ? d.label : k}`, p.params[k],
          q.params[k], d && d.unit);
      }
    }
  });
  both(A.x.edges, B.x.edges, (id, p, q) => exe(`edges.${id}`, `Connection ${id}`, p, q));
  both(tl(A).tracks, tl(B).tracks, (id, p, q) => exe(`tracks.${id}`, `Track ${id}`, p, q));
  both(tl(A).clips, tl(B).clips, (id, p, q) => exe(`clips.${id}`, `Clip ${id}`, p, q));
  both(tl(A).automation, tl(B).automation, (id, p, q) => {
    const t = (q || p).target || {};
    const d = param(t.node, t.param);
    exe(`automation.${id}`, `Automation ${id} · ${name(t.node)} · ${d ? d.label : t.param}`, p,
      q, d && d.unit);
  });
  exe('loop', 'Loop', tl(A).loop, tl(B).loop);
  const [ta, tb] = [A.x.transport || {}, B.x.transport || {}];
  for (const k of keysOf(ta, tb)) {
    exe(`transport.${k}`, `Transport ${k}`, ta[k], tb[k], k === 'tempo' ? 'BPM' : null);
  }
  if (!A.p || !B.p) return out;
  both(A.p.nodes, B.p.nodes, (id, p, q) => {
    if (!p || !q) return; // added or removed: an execution change
    pre(`nodes.${id}.position`, `${name(id)} · position`, p.position, q.position);
    pre(`nodes.${id}.name`, `${name(id)} · name`, p.metadata.name, q.metadata.name);
  });
  both(A.p.tracks, B.p.tracks, (id, p, q) => p && q
    && pre(`tracks.${id}.name`, `Track ${id} · name`, p.name, q.name));
  both(A.p.markers, B.p.markers, (id, p, q) => pre(`markers.${id}`, `Marker ${id}`, p, q));
  for (const [k, x, y] of [['metadata', A.p.metadata, B.p.metadata], ['view', A.v, B.v]]) {
    for (const j of keysOf(x, y)) pre(`${k}.${j}`, `${k} ${j}`, (x || {})[j], (y || {})[j]);
  }
  return out;
}

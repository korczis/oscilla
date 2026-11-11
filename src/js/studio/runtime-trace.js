// What the Studio runtime reports of a running graph (runtime.js "Operation trace", ADR 0042;
// T023): the trace steps of a live update and of a base glide, and the limit diagnostics in
// effect. Composed by runtime.js inside its transaction; pure apart from the adapter calls and
// the `note` and `guard` it is given, which are the transaction's own. No audio node is
// created here, and nothing here is exported by runtime.js.
//
//   traceNote(trace, rev, fresh) -> note(kind, id, outcome, detail?, code?)   one step of the
//                                running transaction (detail only for a live apply, not a
//                                fresh start: a failure is recorded either way)
//   paramUnit(registry) -> unit(type, key)   a parameter's unit, null without one
//   liveUpdate(op, planNode, handle, ctx) -> boolean   a node-params op's live keys go to the
//                                adapter's update and their param steps are classified; true
//                                when the op also names a modulatable key (its bases recompute)
//   noteBaseWrites(id, planNode, base, prev, was, w, own, ctx)   the param steps of applyBase
//   limitDiagnostics(bases, plan, owned) -> [Diagnostic]   the limits in effect, node by node
//                                (frequency-limited, performance-limited for a fit cable and
//                                q-limited for a log cable held at a Q knob's top)
//   qLimits(planNode, cb, { edges, nodes }) -> [Diagnostic]   pure: the `q-limited` ones (K235)

import { fitLimits } from './performance-fit.js';
import { frequencyLimits } from './compiler.js';
import { studioDiagnostic } from './validate.js';
import { CENTS_PER_OCTAVE } from '../core/music.js';
import { sig } from '../core/math.js';

export const traceNote = (trace, rev, fresh) => (kind, id, outcome, detail = null,
  code = null) => (fresh && !code ? null
  : trace.record('runtime', kind, { revision: rev, entity: { kind: kind === 'route'
    ? 'edge' : 'node', id }, outcome, code, detail }));

export const paramUnit = (registry) => (type, k) => (registry.param(type, k) || {}).unit || null;

/**
 * ctx: { registry, ownedKeys(h), tracing, guard(step, id, fn), note, unit, now }. A modulatable
 * key is not live: its base is recomputed with the node's modulation (runtime.js `affected`).
 */
export function liveUpdate(o, pn, h, { registry, ownedKeys, tracing, guard, note, unit, now }) {
  const live = o.keys.filter((k) => !(registry.param(pn.type, k) || {}).modulatable);
  if (live.length && h) {
    const changed = {};
    for (const k of live) changed[k] = pn.params[k];
    const own = ownedKeys(h);
    const w = tracing ? {} : null;
    // What the adapter reports it did (w[key] = how): only 'set' and 'glide' act now; a
    // key it did not act on, or keeps for the next gate or note, is only stored (the
    // plan, a rebuild, a view, the next voice).
    if (guard('update', o.id, () => h.update(changed, own, w)) && w) {
      for (const k of live) {
        const how = w[k] || null;
        const later = how === 'next-gate' || how === 'next-note'; // kept, not written
        note('param', o.id, how && !later ? 'scheduled' : own.has(k) ? 'owned'
          : 'stored', { param: k, value: pn.params[k], unit: unit(pn.type, k),
          at: how === 'set' || how === 'glide' ? now : null, via: how });
      }
    }
  }
  return live.length < o.keys.length;
}

/**
 * Each AudioParam value the adapter reports it wrote (`w`) that differs from its last write
 * (`was`): a glide from now; then each key whose base changed from `prev` but was not written.
 */
export function noteBaseWrites(id, pn, base, prev, was, w, own, { note, unit, now }) {
  for (const [k, v] of Object.entries(w)) {
    if (was[k] !== v) {
      note('param', id, 'scheduled', { param: k, value: v, unit: unit(pn.type, k),
        at: now, via: 'glide' });
    }
  }
  for (const [k, b] of Object.entries(base)) {
    const p = prev && prev.base[k];
    if (k in w || (p && p.value === b.value && p.cents === b.cents)) continue;
    note('param', id, own.has(k) ? 'owned' : 'stored', { param: k, value: b.value,
      unit: unit(pn.type, k) });
  }
}

/**
 * The `frequency-limited` (frequencyLimits) and `performance-limited` (fitLimits)
 * diagnostics in effect, node by node; a base an automation lane drives is left out: its
 * static value does not play. Built when read, from the plan in effect, so a rename names
 * the node and the cable's source as they are now (T023 review R3).
 */
export function limitDiagnostics(bases, plan, owned) {
  const out = [];
  for (const [id, cb] of bases) {
    const pn = plan.nodes.get(id);
    if (!pn || !cb.limits) continue;
    // The values as computed (a node not ready keeps its last bases), the names as now.
    const at = { ...pn, params: cb.limits.params };
    for (const d of frequencyLimits(at, cb, { sampleRate: cb.limits.sampleRate,
      safeMaximum: cb.limits.safeMaximum, edges: plan.edges, nodes: plan.nodes })) {
      const own = d.entity.kind === 'node' && owned.get(d.details.node);
      if (!own || !own.has(d.details.param)) out.push(d);
    }
    out.push(...fitLimits(at, cb, { edges: plan.edges, nodes: plan.nodes }));
    out.push(...qLimits(at, cb, { edges: plan.edges, nodes: plan.nodes }));
  }
  return out;
}

/** A number as Czech prose writes it: three significant digits, a decimal comma. */
const cz = (v) => sig(v, 3).replace('.', ',');

/**
 * The `q-limited` diagnostics of one node (K235, review C1-K232-1 of oscilla-c1): computeBases
 * holds the log cables into a low- or high-pass Q (the only log CV target that is not a
 * frequency, K232) at or below the top of the Q knob's soft range, the ceiling, and marks each
 * one it holds in `limited` (its factor in `scaled`). One warning per held cable, entity the
 * cable, in Czech and in Q terms (project.no-silent-feedback): the ceiling, and what of its
 * depth it plays, or that it has no room when the base already reaches the ceiling. Owner
 * runtime. details = { node, param, unit: 'octaves', mapping: 'log', stored, played, scale,
 * ceiling, base }, plus `offsetStored` and `offsetPlayed` (octaves of Q) when the log cables'
 * constant offset into Q was lowered too. A linear cable into such a Q never plays
 * (clip-targets.js filterQ), so it is never held here.
 */
export function qLimits(planNode, cb, { edges, nodes } = {}) {
  const out = [];
  const p = planNode && planNode.def.params.find((x) => x.key === 'Q');
  const b = p && cb && cb.base && cb.base.Q;
  if (!b || p.scale !== 'log' || !cb.limited) return out;
  const ceiling = p.softRange ? p.softRange[1] : p.max;
  const q = `${planNode.name} ${p.label}`;
  const top = `${p.label} nepřekročí ${cz(ceiling)} (horní mez knoflíku)`;
  const lc = (cb.loweredCents && cb.loweredCents.Q) || 0;
  for (const id of cb.limited) {
    const e = edges && edges.get(id);
    if (!e || e.to.node !== planNode.id || e.to.port !== 'Q' || e.props.mapping !== 'log') {
      continue;
    }
    const from = nodes && nodes.get(e.from.node);
    const src = `${from ? from.name : e.from.node} ${e.from.port.toUpperCase()}`;
    const scale = cb.scaled && cb.scaled.has(id) ? cb.scaled.get(id) : 1;
    const stored = e.props.depth;
    const played = stored * scale;
    const off = {};
    if (lc > 0) {
      off.offsetPlayed = (b.cents || 0) / CENTS_PER_OCTAVE;
      off.offsetStored = off.offsetPlayed + lc / CENTS_PER_OCTAVE;
    }
    const offText = lc > 0 ? `; konstantní posun kabelů do ${p.label} hraje `
      + `${cz(off.offsetPlayed)} z ${cz(off.offsetStored)} oktáv ${p.label}` : '';
    let text;
    if (scale > 0) {
      text = `je omezen: ${top}; hraje ${Math.round(scale * 100)} % své hloubky `
        + `(${cz(played)} z ${cz(stored)} oktáv ${p.label})${offText}`;
    } else {
      text = `nemá místo: ${top} a ${b.value >= ceiling ? `${q} už je ${cz(b.value)}`
        : 'základ s konstantním posunem kabelů na ni už dosahuje'}${offText}`;
    }
    out.push({ ...studioDiagnostic('runtime', 'q-limited', `Kabel ${src} → ${q} ${text}.`,
      { kind: 'edge', id }),
    details: { node: planNode.id, param: 'Q', unit: 'octaves', mapping: 'log', stored, played,
      scale, ceiling, base: b.value, ...off } });
  }
  return out;
}

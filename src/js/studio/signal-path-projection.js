// The Signal Path projection of a StudioModel (spec §1, §9, §127-§128, §164-§165, §197; plan
// V421; rule project.studio-model-is-canonical). Pure: plain model data in, plain stage data
// out; no DOM, no p5, no Web Audio, no clock. docs/v31/signal-path.md records the decision.
//
//   signalInputs(model, { registry }) -> Map(nodeId -> [{ from, edge, rank }])
//       AUDIO edges into SIGNAL inputs (taps observe, they are not on the path), per target in
//       input-port order. The one reading of "the signal path" of a graph: the screen-reader
//       summary (a11y.js) and this projection both walk it.
//   projectSignalPath(model, { registry, annotations }) -> { stages, sources }
//       stages   [{ title, sub, mod, enabled? }]: the stage list the Playground's Signal Path
//                canvas draws (visualization/signal-path.js), in the V1 shape and wording
//       sources  [{ nodes: [nodeId], edge: id | null, lane: id | null }]: per stage, the model
//                records it was projected from (empty for the bypass placeholder)
//
// How a graph becomes stages. The chain is the first signal path back from the Master Output,
// one input at a time; a node with two or more connected signal inputs (Mixer, Stereo Split) is
// a junction, and its branches are walked back to their roots.
//   1. Source stage: the root (title = its name), or every branch root merged
//      ("OSC A + OSC B"; sub = their frequencies).
//   2. Modulation stage (mod: true), the slot V1 always draws after the source:
//      - the junction itself (dual oscillator: mix, stereo panners, stereo router);
//      - a Gain right after the source whose gain a CONTROL edge modulates (AM);
//      - a CONTROL edge into a parameter of the source (LFO, FM modulator), titled by the
//        modulator's name; the depth reads ±d (bipolar) or +d (unipolar), and a muted edge
//        (an unmuted one is preferred) is drawn bypassed (enabled: false, "· muted");
//      - an automation lane on a parameter of the source ("FREQUENCY STEPS" when every point is
//        a step, else "FREQUENCY RAMP");
//      - otherwise the bypassed placeholder "MODULATION / none · fixed frequency"
//        (enabled: false; the canvas draws the bypass arc over it).
//   3. Every further chain node, in order (titled by name: ENVELOPE, FILTER, ...).
//   4. The Master Output, expanded into the engine's safe output chain it compiles to
//      (MASTER GAIN, LIMITER, ANALYSER, DEVICE OUTPUT; ADR 0035, audio-engine.js).
// Titles are node names in capitals (presentation state, §163), as the compact widget's chips
// are; subs are formatted from parameters, edge properties and lanes only.
//
// `annotations` ({ [nodeId]: { partials, phaseDeg } }) carry the two Playground facts Studio
// schema 1 has no field for: the partial count of an additive (PeriodicWave) oscillator and the
// start phase of a dual oscillator's B side. They only add sub text to the stage of their node;
// they never add, remove or reorder a stage. A schema that gains those fields retires them.

import { LIMITER_THRESHOLD_DB, WAVEFORM_LABELS } from '../core/constants.js';
import { sig } from '../core/math.js';
import { formatFrequency } from '../core/frequency.js';
import { NODE_REGISTRY } from './registry.js';

/** Filter type words of the Signal Path (V2 wording, lower case). */
export const SIGNAL_PATH_FILTER_NAMES = Object.freeze({
  lowpass: 'low-pass', highpass: 'high-pass', bandpass: 'band-pass', notch: 'notch',
  peaking: 'peaking', lowshelf: 'low shelf', highshelf: 'high shelf', allpass: 'all-pass',
});

/** The bypassed modulation stage of a source nothing modulates (V1). */
export const UNMODULATED_STAGE = Object.freeze({ title: 'MODULATION',
  sub: 'none · fixed frequency', mod: true, enabled: false });

/** The engine's safe output chain behind the Master Output (titles and fixed subs). */
export const OUTPUT_CHAIN_STAGES = Object.freeze([
  Object.freeze({ title: 'LIMITER', sub: `${LIMITER_THRESHOLD_DB} dBFS threshold` }),
  Object.freeze({ title: 'ANALYSER', sub: 'FFT 8192 · visualizer' }),
  Object.freeze({ title: 'DEVICE OUTPUT', sub: 'speaker output unknown' }),
]);

// ---------------------------------------------------------------- the signal path of a graph

/** AUDIO edges into SIGNAL inputs, per target node, in input-port order (see the header). */
export function signalInputs(model, { registry = NODE_REGISTRY } = {}) {
  const byId = new Map(model.graph.nodes.map((n) => [n.id, n]));
  const incoming = new Map();
  for (const e of model.graph.edges) {
    const a = byId.get(e.from.node);
    const b = byId.get(e.to.node);
    if (!a || !b) continue;
    const from = registry.port(a.type, e.from.port, 'out');
    const to = registry.port(b.type, e.to.port, 'in');
    if (!from || !to || from.type !== 'AUDIO' || to.role !== 'SIGNAL') continue;
    const rank = registry.get(b.type).inputs.findIndex((p) => p.id === e.to.port);
    if (!incoming.has(e.to.node)) incoming.set(e.to.node, []);
    incoming.get(e.to.node).push({ from: e.from.node, edge: e.id, rank });
  }
  for (const list of incoming.values()) list.sort((x, y) => x.rank - y.rank);
  return incoming;
}

// ---------------------------------------------------------------- text helpers

const upper = (node) => String(node.metadata.name || node.type).toUpperCase();
/** "Osc B" → "B": the last word of a node name, how V1 names a side of the dual oscillator. */
const sideOf = (node) => String(node.metadata.name || '').trim().split(/\s+/).pop();
const secs = (s) => (s < 1 ? `${sig(s * 1000, 3)} ms` : `${sig(s, 3)} s`);
/** A ratio cleaned of float residue before it is rounded for display. */
const clean = (v) => Number(v.toPrecision(12));

function panWord(pan) {
  if (pan === -1) return 'left';
  if (pan === 1) return 'right';
  if (pan === 0) return 'centre';
  return `pan ${sig(pan, 2)}`;
}

/**
 * Depth of a modulation edge in the target parameter's terms: "±40 Hz", "±1 oct" (bipolar,
 * [−depth, depth]); "+40 Hz" (unipolar, [0, depth]; "−" for a negative depth); "· muted".
 */
function depthText(props, paramDef) {
  const v = Number(props.depth) || 0;
  const d = Math.abs(v);
  const sign = props.polarity === 'unipolar' ? (v < 0 ? '−' : '+') : '±';
  const muted = props.muted ? ' · muted' : '';
  if (props.mapping === 'log') return `${sign}${sig(d, 3)} oct${muted}`;
  if (paramDef && paramDef.unit === 'Hz') return `${sign}${formatFrequency(d)}${muted}`;
  return `${sign}${sig(d, 3)}${paramDef && paramDef.unit ? ` ${paramDef.unit}` : ''}${muted}`;
}

/** "5 Hz" for a modulator with a rate, else its card summary. */
function rateText(node, registry) {
  const r = node.params && node.params.rate;
  return typeof r === 'number' ? `${sig(r, 3)} Hz` : registry.summarize(node);
}

// ---------------------------------------------------------------- the projection

/** The Signal Path stages of `model` (see the header). Never throws on a normalized model. */
export function projectSignalPath(model, { registry = NODE_REGISTRY, annotations = {} } = {}) {
  const nodes = model.graph.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const notes = (id) => (annotations && annotations[id]) || {};
  const stages = [];
  const sources = [];
  const push = (stage, src = {}) => {
    stages.push(stage);
    sources.push({ nodes: src.nodes || [], edge: src.edge || null, lane: src.lane || null });
  };
  const master = nodes.find((n) => n.type === 'master');
  if (!master) return { stages, sources };
  const incoming = signalInputs(model, { registry });
  const inputsOf = (id) => incoming.get(id) || [];

  // The chain back from the Master Output (one input at a time) up to a root or a junction.
  const chain = [];
  const seen = new Set([master.id]);
  let cur = master.id;
  let junction = null;
  for (;;) {
    const ins = inputsOf(cur);
    if (ins.length > 1 && cur !== master.id) { junction = cur; break; }
    if (!ins.length || seen.has(ins[0].from)) break;
    cur = ins[0].from;
    seen.add(cur);
    chain.unshift(cur);
  }
  // A junction's branches, each walked back to its root: [root, ..., node before the junction].
  const branches = junction ? inputsOf(junction).map((x) => {
    const branch = [x.from];
    const visited = new Set([junction, x.from]);
    let id = x.from;
    for (let ins = inputsOf(id); ins.length === 1 && !visited.has(ins[0].from);
      ins = inputsOf(id)) {
      id = ins[0].from;
      visited.add(id);
      branch.unshift(id);
    }
    return branch;
  }) : [];

  // CONTROL edges into a node's parameters, in model order.
  const controlInto = (id) => model.graph.edges.filter((e) => {
    if (e.to.node !== id || !byId.has(e.from.node)) return false;
    const port = registry.port(byId.get(e.from.node).type, e.from.port, 'out');
    return port && port.type === 'CONTROL';
  });

  // 1. Source stage.
  let rest = chain;
  if (junction) {
    const roots = branches.map((b) => byId.get(b[0]));
    const freqs = roots.map((r) => (r.type === 'oscillator' ? formatFrequency(r.params.frequency)
      : registry.summarize(r)));
    const phases = roots.filter((r) => notes(r.id).phaseDeg)
      .map((r) => `${sideOf(r)} +${sig(notes(r.id).phaseDeg, 3)}°`);
    push({ title: roots.map(upper).join(' + '), sub: [...freqs, ...phases].join(' · '),
      mod: false }, { nodes: roots.map((r) => r.id) });
    // 2. The junction is the modulation stage.
    const j = byId.get(junction);
    const between = branches.flatMap((b) => b.slice(1));
    push({ title: upper(j), sub: junctionSub(j, branches, byId, registry), mod: true,
      enabled: true }, { nodes: [j.id, ...between] });
    rest = chain.slice(1);
  } else if (chain.length) {
    const src = byId.get(chain[0]);
    push({ title: upper(src), sub: sourceSub(src, notes(src.id), registry), mod: false },
      { nodes: [src.id] });
    // 2. Modulation stage.
    const next = chain.length > 1 ? byId.get(chain[1]) : null;
    const pick = (list) => list.find((e) => !e.props.muted) || list[0];
    const am = next && next.type === 'gain'
      ? pick(controlInto(next.id).filter((e) => e.to.port === 'gain')) : null;
    const ctl = pick(controlInto(src.id));
    const lane = model.timeline.automation.find((l) => l.target.node === src.id
      && l.points.length);
    if (am) {
      const m = byId.get(am.from.node);
      const g = Number(next.params.gain) || 0;
      const d = Math.abs(Number(am.props.depth) || 0);
      const depth = g + d > 0 ? clean((2 * d) / (g + d)) : 0;
      push({ title: upper(next), sub: `${rateText(m, registry)} · ${Math.round(depth * 100)} %${
        am.props.muted ? ' · muted' : ''}`, mod: true, enabled: !am.props.muted },
      { nodes: [next.id, m.id], edge: am.id });
      rest = chain.slice(2);
    } else {
      if (ctl) {
        const m = byId.get(ctl.from.node);
        push({ title: upper(m), sub: `${rateText(m, registry)} · ${depthText(ctl.props,
          registry.param(src.type, ctl.to.port))}`, mod: true, enabled: !ctl.props.muted },
        { nodes: [m.id], edge: ctl.id });
      } else if (lane) {
        const p = registry.param(src.type, lane.target.param);
        const label = String(p ? p.label : lane.target.param).toUpperCase();
        const ramp = lane.points.find((x) => x.curve !== 'step');
        push(ramp
          ? { title: `${label} RAMP`, sub: ramp.curve === 'exponential' ? 'exponential ramp'
            : 'linear ramp', mod: true, enabled: true }
          : { title: `${label} STEPS`, sub: `${lane.points.length} scheduled steps`, mod: true,
            enabled: true },
        { nodes: [src.id], lane: lane.id });
      } else {
        // "fixed frequency" only where there is a frequency to keep fixed.
        push(registry.param(src.type, 'frequency') ? { ...UNMODULATED_STAGE }
          : { ...UNMODULATED_STAGE, sub: 'none' });
      }
      rest = chain.slice(1);
    }
  }
  // 3. Every further chain node.
  for (const id of rest) {
    const n = byId.get(id);
    push({ title: upper(n), sub: chainSub(n, registry), mod: false }, { nodes: [id] });
  }
  // 4. The Master Output and the safe output chain it compiles to.
  push({ title: 'MASTER GAIN', sub: `logical ${Number(master.params.level).toFixed(3)}`,
    mod: false }, { nodes: [master.id] });
  for (const s of OUTPUT_CHAIN_STAGES) push({ ...s, mod: false }, { nodes: [master.id] });
  return { stages, sources };
}

function sourceSub(node, note, registry) {
  if (node.type !== 'oscillator') return registry.summarize(node);
  const f = formatFrequency(node.params.frequency);
  if (note.partials != null) {
    const n = note.partials;
    return `PeriodicWave · ${n} partial${n === 1 ? '' : 's'} · ${f}`;
  }
  return `${WAVEFORM_LABELS[node.params.waveform] || 'Sine'} · ${f}`;
}

function junctionSub(j, branches, byId, registry) {
  const p = j.params;
  if (j.type === 'stereo-split') {
    if (p.mode === 'split') return 'split · A → L · B → R';
    if (p.mode === 'pan') return `mix · pan ${sig(p.panA, 2)}`;
    return 'mono';
  }
  if (j.type === 'mixer') {
    const sides = branches.map((b) => sideOf(byId.get(b[0])));
    const pans = branches.map((b) => byId.get(b[b.length - 1]))
      .map((n) => (n.type === 'pan' ? n : null));
    if (pans.every(Boolean)) {
      return sides.map((s, i) => `${s} → ${panWord(pans[i].params.pan)}`).join(' · ');
    }
    return `${sides.join(' + ')} summed`;
  }
  return registry.summarize(j);
}

function chainSub(n, registry) {
  const p = n.params;
  if (n.type === 'envelope') {
    // At full sustain the decay changes nothing: the envelope is attack and release only.
    if (p.sustain === 1) return `A ${secs(p.attack)} · R ${secs(p.release)}`;
    return `A ${secs(p.attack)} · D ${secs(p.decay)} · S ${sig(p.sustain, 2)} · R ${
      secs(p.release)}`;
  }
  if (n.type === 'filter') {
    return `${SIGNAL_PATH_FILTER_NAMES[p.type] || p.type} · ${formatFrequency(p.frequency)} · Q ${
      sig(p.Q, 3)}${p.enabled ? '' : ' · bypassed'}`;
  }
  return registry.summarize(n);
}

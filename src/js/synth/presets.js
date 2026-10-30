// Synth panel presets (plan K066 part): data only. A preset is the panel's initial values with a
// few changes (`values`, keyed 'module.param') and amount depths (`amounts`, keyed by amount
// id). Applying one sets every knob of every module and every amount, as ONE BATCH; the cables
// stay as they are. presetAction(model, panel, id) -> { action } | { reason }.

import { amountEdges } from './normals.js';

export const PRESETS = Object.freeze([
  { id: 'init', title: 'Init: both filters open', values: {},
    amounts: { 'lpf-eg2': 2 } },
  { id: 'bass', title: "Bass: 16' saw, low-pass swept by EG 2",
    values: { 'vco1.scale': '16', 'vco2.scale': '16', 'vco2.waveform': 'sawtooth',
      'vco2.tune': 7, 'lpf.frequency': 180, 'lpf.Q': 6, 'eg2.decay': 0.25, 'eg2.sustain': 0.4 },
    amounts: { 'lpf-eg2': 3 } },
  { id: 'lead', title: 'Lead: VCO 2 a fifth up, vibrato from MG',
    values: { 'vco1.scale': '8', 'vco2.scale': '8', 'vco2.waveform': 'sawtooth',
      'vco2.tune': 702, 'mix.level2': 0.6, 'lpf.frequency': 2400, 'lpf.Q': 3, 'mg.rate': 5.5,
      'keys.glide': 0.06 },
    amounts: { 'vco-mg': 0.03, 'lpf-eg2': 1.5 } },
  { id: 'sweep', title: 'Sweep: both filters resonant, MG on the low-pass',
    values: { 'hpf.frequency': 200, 'hpf.Q': 8, 'lpf.frequency': 900, 'lpf.Q': 12,
      'mg.rate': 0.4, 'mix.level3': 0.15 },
    amounts: { 'lpf-mg': 2, 'lpf-eg2': 0 } },
  { id: 'ring-bell', title: "Ring bell: ring modulator at 4', short EG 2",
    values: { 'vco1.scale': '4', 'vco1.waveform': 'triangle', 'vco2.scale': '8',
      'vco2.waveform': 'sine', 'vco2.tune': 386, 'mix.level1': 0.1, 'mix.level2': 0,
      'mix.level4': 0.8, 'lpf.frequency': 6000, 'eg2.decay': 0.6, 'eg2.sustain': 0,
      'eg2.release': 0.8 },
    amounts: { 'lpf-eg2': 0 } },
]);

export const presetOf = (id) => PRESETS.find((p) => p.id === id) || null;

/** Every module's values for preset `p`: the panel's init (and fixed) values, then the preset. */
export function presetValues(panel, p) {
  const out = {};
  for (const m of panel.modules) {
    const v = {};
    for (const param of m.params) v[param.key] = param.key in m.values ? m.values[param.key]
      : param.default;
    out[m.id] = v;
  }
  for (const [k, value] of Object.entries(p.values)) {
    const [mid, key] = k.split('.');
    out[mid][key] = value;
  }
  return out;
}

export function presetAction(model, panel, id) {
  const p = presetOf(id);
  if (!p) return { reason: `There is no preset "${id}".` };
  const values = presetValues(panel, p);
  const nodes = panel.resolve(model);
  const steps = [];
  for (const m of panel.modules) {
    const node = nodes.get(m.id);
    if (!node || m.def.maxInstances === 1) continue; // Master Output keeps the Studio's level
    steps.push({ type: 'NODE_PARAM_SET', nodeId: node.id, params: values[m.id] });
  }
  for (const a of panel.amounts) {
    const depth = p.amounts[a.id] ?? 0;
    for (const e of amountEdges(model, panel, a)) {
      steps.push({ type: 'EDGE_UPDATE', edgeId: e.id, props: { depth } });
    }
  }
  return { action: { type: 'BATCH', label: `Preset ${p.title.split(':')[0]}`, steps } };
}

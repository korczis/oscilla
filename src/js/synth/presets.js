// Synth panel presets (plan K066 part): data only. A preset is the panel's initial values with a
// few changes (`values`, keyed 'module.param') and amount depths (`amounts`, keyed by amount
// id). Applying one sets every knob of every module and every amount, as ONE BATCH; the cables
// stay as they are. presetAction(model, panel, id, { all }) -> { action } | { reason }.
//
// A preset belongs to one tab (`tab`, default 'panel') and sets only that tab's modules, so a
// panel preset leaves the engines as they are and an engine preset (`engine`: the module the
// keys then play) leaves the panel; { all: true } resets every module (a link reopens the whole
// instrument from its preset, synth/link.js).

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
  // Engines tab (plan K090-K092, K121, K123): each sets its engine's module only.
  { id: 'organ', tab: 'engines', engine: 'additive', title: 'Organ: drawbars 16, 8, 4, 2',
    values: { 'additive.h1': 1, 'additive.h2': 0.8, 'additive.h3': 0, 'additive.h4': 0.6,
      'additive.h5': 0, 'additive.h6': 0, 'additive.h8': 0.4, 'additive.attack': 0.005,
      'additive.sustain': 1, 'additive.release': 0.08 }, amounts: {} },
  { id: 'fm-bell', tab: 'engines', engine: 'fm', title: 'FM bell: 2 → 1 at ratio 3.5',
    values: { 'fm.algorithm': '2-op', 'fm.ratio2': 3.5, 'fm.index2': 3, 'fm.modDecay': 1.5,
      'fm.modSustain': 0.1, 'fm.decay': 2.5, 'fm.sustain': 0, 'fm.release': 1.5 }, amounts: {} },
  { id: 'fm-keys', tab: 'engines', engine: 'fm', title: 'FM keys: two pairs, ratio 1 and 14',
    values: { 'fm.algorithm': '4-pairs', 'fm.ratio2': 1, 'fm.index2': 1.8, 'fm.ratio3': 1,
      'fm.ratio4': 14, 'fm.index4': 0.6, 'fm.level3': 0.4, 'fm.modDecay': 0.8,
      'fm.modSustain': 0.2, 'fm.decay': 1.6, 'fm.sustain': 0.2, 'fm.release': 0.5 },
    amounts: {} },
  { id: 'ring-metal', tab: 'engines', engine: 'am', title: 'Ring metal: ratio 1.41',
    values: { 'am.mode': 'ring', 'am.ratio': 1.41, 'am.decay': 1.2, 'am.sustain': 0,
      'am.release': 0.9 }, amounts: {} },
  { id: 'formant-pad', tab: 'engines', engine: 'wavetable', title: 'Formant pad: slow attack',
    values: { 'wavetable.bank': 'formant', 'wavetable.morph': 1.5, 'wavetable.attack': 0.6,
      'wavetable.sustain': 0.8, 'wavetable.release': 1.2 }, amounts: {} },
  { id: 'sync-lead', tab: 'engines', engine: 'sync', title: 'Sync lead: ratio 3',
    values: { 'sync.morph': 2, 'sync.attack': 0.005, 'sync.sustain': 0.9,
      'sync.release': 0.2 }, amounts: {} },
  { id: 'kit', tab: 'engines', engine: 'perc', title: 'Kit: the percussion on the keys',
    values: { 'perc.tune': 0, 'perc.decay': 1, 'perc.tone': 0.5 }, amounts: {} },
].map((p) => Object.freeze({ tab: 'panel', engine: null, ...p })));

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

export function presetAction(model, panel, id, { all = false } = {}) {
  const p = presetOf(id);
  if (!p) return { reason: `There is no preset "${id}".` };
  const values = presetValues(panel, p);
  const nodes = panel.resolve(model);
  const steps = [];
  for (const m of panel.modules) {
    const node = nodes.get(m.id);
    if (!node || m.def.maxInstances === 1) continue; // Master Output keeps the Studio's level
    if (!all && m.tab !== p.tab) continue;
    steps.push({ type: 'NODE_PARAM_SET', nodeId: node.id, params: values[m.id] });
  }
  for (const a of panel.amounts) {
    if (!all && (panel.module(a.module) || {}).tab !== p.tab) continue;
    const depth = p.amounts[a.id] ?? 0;
    for (const e of amountEdges(model, panel, a)) {
      steps.push({ type: 'EDGE_UPDATE', edgeId: e.id, props: { depth } });
    }
  }
  return { action: { type: 'BATCH', label: `Preset ${p.title.split(':')[0]}`, steps } };
}

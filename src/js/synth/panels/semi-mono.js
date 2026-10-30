// The semi-modular mono voice (plan K059-K063): two oscillators, a ring modulator and noise into
// a mixer, two 12 dB/oct filters in series (high-pass, then low-pass), two envelopes (EG 1 a
// contour, EG 2 the amplifier's), a modulation generator, a sample-and-hold of a seeded random
// source and the output. The whole panel is this one declaration (synth/panel.js): every knob,
// switch and jack comes from the registry's node descriptors.

import { definePanel } from '../panel.js';

const FILTER_FIXED = { gain: 0, enabled: true };
const FILTER_NOTE = 'A 12 dB/oct biquad: the peak rings but does not self-oscillate.';
// Peak (Q) has a knob and no jack: a low- or high-pass Q is a dB AudioParam in Web Audio, so the
// runtime refuses a linear Q modulation (clip-targets.js filterQ), and a jack that takes a cable
// and does nothing is an inert surface (project.no-inert-surfaces).
const FILTER_JACKS = { hide: ['gain', 'Q'] };

export default definePanel({
  id: 'semi-mono',
  version: 1,
  title: 'Semi-modular mono voice',
  description: 'Two oscillators and noise through two 12 dB/oct filters in series, high-pass '
    + 'then low-pass, into an envelope-driven amplifier. Every jack is normalled: it sounds '
    + 'with no cable, and a cable into a jack replaces what was normalled there.',
  modules: [
    { id: 'keys', label: 'KEYBOARD', node: 'keys' },
    { id: 'vco1', label: 'VCO 1', node: 'vco', fixed: { pitch: 0, fm: 0 },
      init: { waveform: 'sawtooth', scale: '16' } },
    { id: 'vco2', label: 'VCO 2', node: 'vco', fixed: { pitch: 0, fm: 0 },
      init: { waveform: 'square', scale: '8' } },
    { id: 'ring', label: 'RING', node: 'ring' },
    { id: 'noise', label: 'NOISE', node: 'noise', init: { level: 0.5 } },
    { id: 'mix', label: 'MIXER', node: 'mixer',
      init: { level1: 0.7, level2: 0.5, level3: 0, level4: 0 },
      labels: { level1: 'VCO 1', level2: 'VCO 2', level3: 'Noise', level4: 'Ring' } },
    { id: 'hpf', label: 'HPF', node: 'filter', note: FILTER_NOTE, fixed: { type: 'highpass', ...FILTER_FIXED },
      jacks: FILTER_JACKS,
      init: { frequency: 20, Q: 0.7 }, labels: { frequency: 'Cutoff', Q: 'Peak' },
      ranges: { frequency: [10, 20000], Q: [0.5, 30] } },
    { id: 'lpf', label: 'LPF', node: 'filter', note: FILTER_NOTE, fixed: { type: 'lowpass', ...FILTER_FIXED },
      jacks: FILTER_JACKS,
      init: { frequency: 1200, Q: 1 }, labels: { frequency: 'Cutoff', Q: 'Peak' },
      ranges: { frequency: [10, 20000], Q: [0.5, 30] } },
    { id: 'eg1', label: 'EG 1', node: 'envelope', jacks: { hide: ['audio'] },
      init: { attack: 0.005, decay: 0.3, sustain: 0.2, release: 0.3 } },
    { id: 'eg2', label: 'EG 2', node: 'envelope', jacks: { hide: ['audio'] },
      init: { attack: 0.005, decay: 0.2, sustain: 0.8, release: 0.25 } },
    { id: 'vca', label: 'VCA', node: 'gain', init: { gain: 0 }, labels: { gain: 'Initial gain' },
      ranges: { gain: [0, 1] } },
    { id: 'mg', label: 'MG / LFO', node: 'lfo', options: { shape: ['triangle', 'square'] },
      ranges: { rate: [0.01, 100] }, init: { shape: 'triangle', rate: 5 } },
    { id: 'sh', label: 'S&H', node: 'random', note: 'Seeded random steps, one per gate; it '
      + 'samples no input.' },
    { id: 'out', label: 'OUTPUT', node: 'master' },
  ],
  // [id, from jack, to jack, edge props]. A cable into a `to` jack breaks every normal of that
  // jack; removing the last cable restores them, with the same ids (synth/normals.js).
  normals: [
    ['n1', 'keys.pitch', 'vco1.pitch', { depth: 6, polarity: 'bipolar', mapping: 'linear' }],
    ['n2', 'keys.pitch', 'vco2.pitch', { depth: 6, polarity: 'bipolar', mapping: 'linear' }],
    ['n3', 'keys.gate', 'eg1.gate'],
    ['n4', 'keys.gate', 'eg2.gate'],
    ['n5', 'vco1.audio', 'mix.in1'],
    ['n6', 'vco2.audio', 'mix.in2'],
    ['n7', 'noise.audio', 'mix.in3'],
    ['n8', 'ring.audio', 'mix.in4'],
    ['n9', 'vco1.audio', 'ring.carrier'],
    ['n10', 'vco2.audio', 'ring.modulator'],
    ['n11', 'mix.audio', 'hpf.audio'],
    ['n12', 'hpf.audio', 'lpf.audio'],
    ['n13', 'lpf.audio', 'vca.audio'],
    ['n14', 'vca.audio', 'out.audio'],
    ['n24', 'eg2.control', 'vca.gain', { depth: 1, polarity: 'unipolar', mapping: 'linear' }],
    ['n15', 'mg.control', 'vco1.fm', { depth: 0 }],
    ['n16', 'mg.control', 'vco2.fm', { depth: 0 }],
    ['n17', 'eg1.control', 'vco1.fm', { depth: 0, polarity: 'unipolar' }],
    ['n18', 'eg1.control', 'vco2.fm', { depth: 0, polarity: 'unipolar' }],
    ['n19', 'mg.control', 'hpf.frequency', { depth: 0, mapping: 'log' }],
    ['n20', 'eg2.control', 'hpf.frequency', { depth: 0, mapping: 'log', polarity: 'unipolar' }],
    ['n21', 'mg.control', 'lpf.frequency', { depth: 0, mapping: 'log' }],
    ['n22', 'eg2.control', 'lpf.frequency', { depth: 2, mapping: 'log', polarity: 'unipolar' }],
    ['n23', 'keys.gate', 'sh.trigger'],
  ],
  // An amount knob is the depth of every edge from `source` into its `to` jacks, normalled or
  // patched; with none it is disabled and says why. One knob, one BATCH of EDGE_UPDATEs.
  amounts: [
    { id: 'vco-mg', module: 'vco1', label: 'MG → pitch', source: 'mg.control',
      to: ['vco1.fm', 'vco2.fm'], range: [0, 2] },
    { id: 'vco-eg1', module: 'vco1', label: 'EG 1 → pitch', source: 'eg1.control',
      to: ['vco1.fm', 'vco2.fm'], range: [-2, 2] },
    { id: 'hpf-mg', module: 'hpf', label: 'MG → cutoff', source: 'mg.control',
      to: ['hpf.frequency'], range: [0, 4] },
    { id: 'hpf-eg2', module: 'hpf', label: 'EG 2 → cutoff', source: 'eg2.control',
      to: ['hpf.frequency'], range: [-4, 4] },
    { id: 'lpf-mg', module: 'lpf', label: 'MG → cutoff', source: 'mg.control',
      to: ['lpf.frequency'], range: [0, 4] },
    { id: 'lpf-eg2', module: 'lpf', label: 'EG 2 → cutoff', source: 'eg2.control',
      to: ['lpf.frequency'], range: [-4, 4] },
  ],
  layout: { desktop: [['vco1', 'vco2', 'ring', 'noise', 'mix', 'hpf', 'lpf'],
    ['keys', 'eg1', 'eg2', 'vca', 'mg', 'sh', 'out']] },
});

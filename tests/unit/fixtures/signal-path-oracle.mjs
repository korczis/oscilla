// TEST ORACLE ONLY, never imported by src/. The Signal Path stage derivation as it stood before
// plan V421: src/js/visualization/signal-path.js pathNodesFor at origin/main 150c70e (V1
// pathNodesFor, index.html@a7b7a23, plus its V2 lab stages), kept verbatim except for the import
// paths and the export name, so tests/unit/v31-studio-signal-path.test.mjs can show that the
// Studio projection (src/js/studio/playground-voice.js + signal-path-projection.js) draws the
// same stages over a matrix of Playground configurations. The product no longer derives a
// Signal Path topology of its own (docs/v31/signal-path.md); this copy is frozen evidence, like
// the golden vectors in tests/freeze/.

import { WAVEFORM_LABELS, LIMITER_THRESHOLD_DB } from '../../../src/js/core/constants.js';
import { sig } from '../../../src/js/core/math.js';
import { formatFrequency } from '../../../src/js/core/frequency.js';

const FILTER_NAMES = {
  lowpass: 'low-pass', highpass: 'high-pass', bandpass: 'band-pass', notch: 'notch',
  peaking: 'peaking', lowshelf: 'low shelf', highshelf: 'high shelf', allpass: 'all-pass',
};

function secondsLabel(s) {
  return s >= 1 ? `${sig(s, 3)} s` : `${sig(s * 1000, 3)} ms`;
}

// V1: pathNodesFor (index.html@a7b7a23). st: bridge state (waveform, labels).
// V2: lab (optional, main.js labVizInputs) = { additive (coefficients) | null, adsr | null,
//   filter (enabled config) | null, router (stereo router config) | null, phaseDeg }: the
//   stages the V2 labs add to the sounding graph (osc → env → [filter] → rel → [router] …).
//   Without lab the V1 node list is returned unchanged.
export function legacyPathNodes(plan, st, lab = null) {
  const nodes = v1PathNodes(plan, st);
  if (!lab) return nodes;
  const t = plan ? plan.type : 'const';
  if (t === 'dual') {
    if (lab.router) {
      const split = lab.router.mode === 'split';
      nodes[1] = { ...nodes[1], title: 'STEREO ROUTER', sub: split ? 'split · A → L · B → R'
        : `mix · pan ${sig(lab.router.panA, 2)}` };
    }
    if (lab.phaseDeg) {
      nodes[0] = { ...nodes[0], sub: `${nodes[0].sub} · B +${sig(lab.phaseDeg, 3)}°` };
    }
  } else if (lab.additive) {
    const n = lab.additive.filter((b) => b.gain > 0).length;
    nodes[0] = { ...nodes[0], title: 'ADDITIVE OSC',
      sub: `PeriodicWave · ${n} partial${n === 1 ? '' : 's'} · ${st.labels.freq}` };
  }
  if (lab.adsr) {
    const a = lab.adsr;
    nodes[2] = { ...nodes[2], title: 'ADSR ENVELOPE', sub: `A ${secondsLabel(a.a)} · D ${
      secondsLabel(a.d)} · S ${sig(a.s, 2)} · R ${secondsLabel(a.r)}` };
  }
  if (lab.filter) {
    const f = lab.filter;
    nodes.splice(3, 0, { title: 'FILTER', sub: `${FILTER_NAMES[f.type] || f.type} · ${
      formatFrequency(f.frequency)} · Q ${sig(f.Q, 3)}`, mod: false });
  }
  return nodes;
}

function v1PathNodes(plan, st) {
  const t = plan ? plan.type : 'const';
  const modulated = !!(plan && plan.modulated) || t === 'dual';
  let mod = { title: 'MODULATION', sub: 'none · fixed frequency' };
  if (t === 'steps') mod = { title: 'FREQUENCY STEPS', sub: `${plan.steps.length} scheduled steps` };
  if (t === 'ramps') mod = { title: 'FREQUENCY RAMP', sub: plan.segments[0].curve === 'log' ? 'exponential ramp' : 'linear ramp' };
  if (t === 'lfo') mod = { title: 'LFO → FREQUENCY', sub: `${sig(plan.rate, 3)} Hz · ±${formatFrequency(plan.depth)}` };
  if (t === 'am') mod = { title: 'LFO → GAIN (AM)', sub: `${sig(plan.modFreq, 3)} Hz · ${Math.round(plan.depth * 100)} %` };
  if (t === 'fm') mod = { title: 'MODULATOR → FREQ', sub: `${sig(plan.modFreq, 3)} Hz · ±${formatFrequency(plan.depth)}` };
  if (t === 'dual') mod = { title: plan.stereo ? 'STEREO PANNERS' : 'MIX (MONO)', sub: plan.stereo ? 'A → left · B → right' : 'A + B summed' };
  const osc = t === 'dual'
    ? { title: 'OSC A + OSC B', sub: `${formatFrequency(plan.a.freq)} · ${formatFrequency(plan.b.freq)}` }
    : { title: 'OSCILLATOR', sub: `${WAVEFORM_LABELS[st.waveform] || 'Sine'} · ${st.labels.freq}` };
  return [
    { ...osc, mod: false },
    { ...mod, mod: true, enabled: modulated },
    { title: 'ENVELOPE', sub: `A ${st.labels.attack} · R ${st.labels.release}`, mod: false },
    { title: 'MASTER GAIN', sub: `logical ${st.labels.gain}`, mod: false },
    { title: 'LIMITER', sub: `${LIMITER_THRESHOLD_DB} dBFS threshold`, mod: false },
    { title: 'ANALYSER', sub: 'FFT 8192 · visualizer', mod: false },
    { title: 'DEVICE OUTPUT', sub: 'speaker output unknown', mod: false },
  ];
}

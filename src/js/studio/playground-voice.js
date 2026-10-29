// The Playground voice as a StudioModel (spec §1, §2, §164-§165; plan V421). Pure: plain
// Playground values in, a normalized schema-1 StudioModel out; no DOM, no Web Audio, no clock.
// docs/v31/signal-path.md records why the Playground's Signal Path projects this model.
//
//   playgroundVoiceModel(input) -> { model, annotations }
//     input: { plan (audio/patterns.js buildPlan, null when invalid), waveform, frequency (Hz),
//              gain (logical master gain), attackMs, releaseMs,
//              lab: main.js labVizInputs() or null — { additive (bar coefficients) | null,
//                   adsr { a, d, s, r } | null, envelope { attack, release } (seconds) | null,
//                   nextNote { adsr | null, attack?, release? } | null,
//                   filter (enabled config) | null, router (stereo router config) | null,
//                   phaseDeg } }
//
// The graph is the voice the AudioEngine builds for that plan with those V2 options
// (audio-engine.js play, modulation.js, scheduler.js), node for node where Studio has the node:
//   const    Oscillator → Envelope → [Filter] → Master Output
//   lfo      + LFO → Oscillator.frequency (edge depth = the plan's depth in Hz, edge offset = the
//            plan's centre minus the frequency control, so the sounding centre is the plan's)
//   fm       + modulator (LFO node at modFreq) → Oscillator.frequency, depth in Hz
//   am       Oscillator → Gain (1 − depth/2) → Envelope, LFO → Gain.gain with depth depth/2
//            (buildAm's amGain and lfoGain)
//   steps    an automation lane on Oscillator.frequency, one step point per scheduled tone
//   ramps    an automation lane on Oscillator.frequency: a step point at each segment start
//            (unless the previous segment ends there) and a linear or exponential point at its end
//   dual     Osc A, Osc B (level = side gain · level · 0.5, buildDual's g) into a Mixer (mono),
//            through Pan nodes at −1 / +1 into a Mixer (V1 stereo panners), or into a Stereo
//            Split (the V2 stereo router) → Envelope → ...
// The Oscillator's frequency parameter is the Playground's frequency control (what V1 shows on
// the OSCILLATOR stage); lanes and edge offsets carry what a pattern does to it.
// The envelope is the V1 attack/release envelope (sustain 1) or the Envelope Lab's ADSR. It is
// the note's (C008): while a voice sounds, main.js passes that voice's (lab.adsr, or lab.envelope
// for its attack and release without the ADSR; attackMs and releaseMs otherwise) and, in
// lab.nextNote, a different setting the next note will get.
// Node names are the Signal Path's stage titles (presentation state, §163).
//
// Studio schema 1 has no field for three Playground facts, returned as `annotations` keyed by
// node id (see signal-path-projection.js): an additive oscillator's partial count, the dual B
// side's start phase and the envelope the next note gets (nextNote, in envelope params; see
// soundingEnvelope). Values outside a Studio parameter range (an AM or FM modulator above the
// LFO's 100 Hz) are kept as they are, so the derived model shows what sounds; such a model does
// not pass validateStudioModel and is never compiled, saved or entered into provenance.

import { WAVEFORMS } from '../core/constants.js';
import { createStudioModel } from './schema.js';

export const PLAYGROUND_VOICE_TITLE = 'Playground voice';

/** Stable ids of the derived model's records. */
export const PLAYGROUND_VOICE_IDS = Object.freeze({
  osc: 'osc-1', oscB: 'osc-2', lfo: 'lfo-1', am: 'gain-1', panA: 'pan-1', panB: 'pan-2',
  mixer: 'mix-1', router: 'stereo-1', envelope: 'env-1', filter: 'filter-1', master: 'master-1',
  lane: 'lane-1',
});

const finite = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const envelopeParams = (adsr) => ({ attack: adsr.a, decay: adsr.d, sustain: adsr.s,
  release: adsr.r });

const sameTime = (x, y) => Math.abs(Number(x) - Number(y)) < 1e-9;
const sameAdsr = (x, y) => (!x || !y ? x === y
  : ['a', 'd', 's', 'r'].every((k) => sameTime(x[k], y[k])));

/**
 * soundingEnvelope(input) -> { adsr, envelope, nextNote } for labVizInputs (C008), plain values.
 *   input: { voice: the sounding voice's { adsr | null, attack, release } (seconds) or null,
 *            labAdsr: the Envelope Lab's ADSR when it is on, else null,
 *            attackS, releaseS: the Playground's attack and release (the V1 envelope) }
 * The envelope belongs to the note: a held note keeps its attack, decay and release, and only
 * its sustain level and the power switch reach it (engine.setEnvelopeSustain). While a voice
 * sounds, `adsr` / `envelope` are the voice's, and `nextNote` is what the next note gets
 * ({ adsr } or { adsr: null, attack, release }, the engine's floors applied) when it differs.
 * Idle, `adsr` is the lab's and nothing is pending.
 */
export function soundingEnvelope({ voice = null, labAdsr = null, attackS = 0.01,
  releaseS = 0.03 } = {}) {
  const next = labAdsr ? { adsr: { ...labAdsr } } : { adsr: null,
    attack: Math.max(0.001, finite(attackS, 0.01)),
    release: Math.max(0.005, finite(releaseS, 0.03)) };
  if (!voice) return { adsr: next.adsr, envelope: null, nextNote: null };
  const adsr = voice.adsr ? { ...voice.adsr } : null;
  const differs = adsr ? !sameAdsr(adsr, next.adsr) : !!next.adsr
    || !sameTime(voice.attack, next.attack) || !sameTime(voice.release, next.release);
  return { adsr, envelope: adsr ? null : { attack: voice.attack, release: voice.release },
    nextNote: differs ? next : null };
}

/** The Playground voice as { model, annotations } (see the header). */
export function playgroundVoiceModel(input = {}) {
  const { plan = null, lab = null } = input;
  const ID = PLAYGROUND_VOICE_IDS;
  const nodes = [];
  const edges = [];
  const automation = [];
  const annotations = {};
  const node = (id, type, name, params, x, y = 0) => {
    nodes.push({ id, type, position: { x, y }, params, metadata: { name } });
  };
  const connect = (from, fromPort, to, toPort, props = null) => {
    const e = { id: `edge-${edges.length + 1}`, from: { node: from, port: fromPort },
      to: { node: to, port: toPort } };
    if (props) e.props = props;
    edges.push(e);
  };
  const t = plan ? plan.type : 'const';
  const frequency = finite(input.frequency, 440);
  const waveform = WAVEFORMS.includes(input.waveform) ? input.waveform : 'sine';
  let x = 0;
  let tail;

  if (t === 'dual') {
    const side = (o, level) => ({ waveform: o.wave, frequency: o.freq,
      level: finite(o.gain, 1) * finite(level, 1) * 0.5 });
    node(ID.osc, 'oscillator', 'Osc A', side(plan.a, plan.levelA), x, -60);
    node(ID.oscB, 'oscillator', 'Osc B', side(plan.b, plan.levelB), x, 60);
    x += 200;
    if (lab && lab.phaseDeg) annotations[ID.oscB] = { phaseDeg: lab.phaseDeg };
    if (lab && lab.router) {
      const r = lab.router;
      node(ID.router, 'stereo-split', 'Stereo Router', { mode: r.mode === 'split' ? 'split'
        : 'pan', panA: finite(r.panA, -1), panB: finite(r.panB, 1),
      levelA: finite(r.levelA, 1), levelB: finite(r.levelB, 1) }, x);
      connect(ID.osc, 'audio', ID.router, 'a');
      connect(ID.oscB, 'audio', ID.router, 'b');
      tail = ID.router;
    } else if (plan.stereo) {
      node(ID.panA, 'pan', 'Pan A', { pan: -1 }, x, -60);
      node(ID.panB, 'pan', 'Pan B', { pan: 1 }, x, 60);
      x += 200;
      node(ID.mixer, 'mixer', 'Stereo Panners', { level1: 1, level2: 1 }, x);
      connect(ID.osc, 'audio', ID.panA, 'audio');
      connect(ID.oscB, 'audio', ID.panB, 'audio');
      connect(ID.panA, 'audio', ID.mixer, 'in1');
      connect(ID.panB, 'audio', ID.mixer, 'in2');
      tail = ID.mixer;
    } else {
      node(ID.mixer, 'mixer', 'Mix (mono)', { level1: 1, level2: 1 }, x);
      connect(ID.osc, 'audio', ID.mixer, 'in1');
      connect(ID.oscB, 'audio', ID.mixer, 'in2');
      tail = ID.mixer;
    }
  } else {
    const additive = lab && Array.isArray(lab.additive) ? lab.additive : null;
    node(ID.osc, 'oscillator', additive ? 'Additive Osc' : 'Oscillator',
      { waveform, frequency, level: 1 }, x);
    if (additive) annotations[ID.osc] = { partials: additive.filter((b) => b.gain > 0).length };
    tail = ID.osc;
    if (t === 'lfo' || t === 'fm') {
      const lfo = t === 'lfo';
      node(ID.lfo, 'lfo', lfo ? 'LFO → frequency' : 'Modulator → freq',
        { shape: lfo ? plan.shape : 'sine', rate: lfo ? plan.rate : plan.modFreq }, x, -140);
      connect(ID.lfo, 'control', ID.osc, 'frequency', { depth: plan.depth,
        offset: (lfo ? plan.center : plan.freq) - frequency, polarity: 'bipolar',
        mapping: 'linear' });
    } else if (t === 'am') {
      x += 200;
      node(ID.am, 'gain', 'LFO → gain (AM)', { gain: 1 - plan.depth / 2 }, x);
      node(ID.lfo, 'lfo', 'LFO', { shape: 'sine', rate: plan.modFreq }, x, -140);
      connect(ID.osc, 'audio', ID.am, 'audio');
      connect(ID.lfo, 'control', ID.am, 'gain', { depth: plan.depth / 2, offset: 0,
        polarity: 'bipolar', mapping: 'linear' });
      tail = ID.am;
    } else if (t === 'steps') {
      automation.push({ id: ID.lane, target: { node: ID.osc, param: 'frequency' },
        points: plan.steps.map((s, i) => ({ id: `pt-${i + 1}`, time: s.t, value: s.f,
          curve: 'step' })) });
    } else if (t === 'ramps') {
      const points = [];
      for (const s of plan.segments) {
        const last = points[points.length - 1];
        if (!last || last.time !== s.t || last.value !== s.f0) {
          points.push({ time: s.t, value: s.f0, curve: 'step' });
        }
        points.push({ time: s.t + s.dur, value: s.f1,
          curve: s.curve === 'log' ? 'exponential' : 'linear' });
      }
      automation.push({ id: ID.lane, target: { node: ID.osc, param: 'frequency' },
        points: points.map((p, i) => ({ id: `pt-${i + 1}`, ...p })) });
    }
  }

  x += 200;
  const adsr = lab && lab.adsr;
  const times = lab && lab.envelope;
  node(ID.envelope, 'envelope', adsr ? 'ADSR Envelope' : 'Envelope', adsr
    ? envelopeParams(adsr)
    : times ? { attack: finite(times.attack, 0.01), sustain: 1,
      release: finite(times.release, 0.03) }
      : { attack: finite(input.attackMs, 10) / 1000, sustain: 1,
        release: finite(input.releaseMs, 30) / 1000 }, x);
  const next = lab && lab.nextNote;
  if (next) {
    annotations[ID.envelope] = { nextNote: next.adsr ? envelopeParams(next.adsr)
      : { attack: finite(next.attack, 0.01), sustain: 1, release: finite(next.release, 0.03) } };
  }
  connect(tail, 'audio', ID.envelope, 'audio');
  tail = ID.envelope;
  const f = lab && lab.filter;
  if (f) {
    x += 200;
    node(ID.filter, 'filter', 'Filter', { type: f.type, frequency: f.frequency, Q: f.Q,
      gain: finite(f.gain, 0), enabled: true }, x);
    connect(tail, 'audio', ID.filter, 'audio');
    tail = ID.filter;
  }
  x += 200;
  node(ID.master, 'master', 'Master Output', { level: finite(input.gain, 0) }, x);
  connect(tail, 'audio', ID.master, 'audio');

  const model = createStudioModel({
    graph: { nodes, edges },
    timeline: { tracks: [], clips: [], automation, markers: [] },
    metadata: { title: PLAYGROUND_VOICE_TITLE, notes: '' },
  });
  return { model, annotations };
}

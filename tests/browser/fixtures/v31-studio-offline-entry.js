// Fixture for tests/browser/v31-studio-offline.cjs: bundled with esbuild (IIFE) into one classic
// <script> of a single file:// page. It renders the shipped Studio templates (§256) through
// src/js/studio/offline.js (the Studio runtime on an OfflineAudioContext through
// audio/offline-renderer.js) and returns plain numbers; the runner asserts. T.voice renders the
// K010-K013 voice-node graphs below the same way, and T.response reads a filter stage's own
// response probe (the browser's getFrequencyResponse).

import { templateModel } from '../../../src/js/studio/templates/index.js';
import { renderStudioOffline } from '../../../src/js/studio/offline.js';
import { STUDIO_KIND, normalizeStudio } from '../../../src/js/studio/schema.js';
import { createFilterStage } from '../../../src/js/audio/filters.js';
import { MAX_OUTPUT_GAIN } from '../../../src/js/core/constants.js';

/** Amplitude of the f component of data (Goertzel, Hann window, amplitude-normalized). */
function amplitudeAt(data, f, sr) {
  const n = data.length;
  const w = (2 * Math.PI * f) / sr;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    wsum += h;
    const s = data[i] * h + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  const re = s1 - s2 * Math.cos(w);
  const im = s2 * Math.sin(w);
  return (2 * Math.sqrt(re * re + im * im)) / wsum;
}

function rms(data) {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, data.length));
}

const slice = (buf, t0, t1) => buf.getChannelData(0).subarray(Math.round(t0 * buf.sampleRate),
  Math.round(t1 * buf.sampleRate));

window.T = {
  async render(id, opts = {}) {
    const r = await renderStudioOffline(templateModel(id), opts);
    if (!r.ok) return { ok: false, limitations: r.limitations, errors: r.errors };
    const b = r.buffer;
    const ch0 = b.getChannelData(0);
    let first = -1;
    for (let i = 0; i < ch0.length; i++) if (Math.abs(ch0[i]) > 1e-4) { first = i; break; }
    let tailMax = 0;
    for (let i = ch0.length - 8; i < ch0.length; i++) {
      tailMax = Math.max(tailMax, Math.abs(ch0[i]));
    }
    const out = { ok: true, length: b.length, sampleRate: b.sampleRate,
      channels: b.numberOfChannels, stats: r.stats, startTime: r.startTime, firstSample: first,
      tailMax, limitations: r.plan.limitations, wavBytes: r.wav ? r.wav.byteLength : null };
    if (opts.probe === 'tone') out.a440 = amplitudeAt(slice(b, 0.2, 0.8), 440, b.sampleRate);
    if (opts.probe === 'synth') {
      // Subtractive Synth: Tone 220 Hz at 0-1 s, then the log Sweep 220 → 880 Hz at 1-3 s
      // (f(p) = 220·4^((p − 1)/2): 311 Hz at 1.5 s, 440 Hz at 2.0 s), positions from the
      // render's start time. 50 ms windows inside the sweep (its frequency moves ±11 Hz there).
      const st = r.startTime;
      const sr = b.sampleRate;
      const tone = slice(b, st + 0.2, st + 0.8);
      const s15 = slice(b, st + 1.475, st + 1.525);
      const s20 = slice(b, st + 1.975, st + 2.025);
      out.synth = {
        tone220: amplitudeAt(tone, 220, sr), tone311: amplitudeAt(tone, 311, sr),
        s15f311: amplitudeAt(s15, 311, sr), s15f220: amplitudeAt(s15, 220, sr),
        s20f440: amplitudeAt(s20, 440, sr), s20f220: amplitudeAt(s20, 220, sr),
      };
    }
    if (opts.probe === 'gap') {
      out.rmsSweep = rms(slice(b, 0.5, 1.5));
      out.rmsGap = rms(slice(b, 2.15, 2.35));
    }
    return out;
  },

  /**
   * A K010-K013 voice graph (VOICES below), rendered offline (at opts.sampleRate, else the
   * renderer's own rate): plain numbers per probe.
   */
  async voice(name, opts = {}) {
    const v = VOICES[name](opts);
    const model = normalizeStudio({ kind: STUDIO_KIND, schemaVersion: 1,
      graph: { nodes: v.nodes.map(([id, type, params]) => ({ id, type,
        position: { x: 0, y: 0 }, params })),
      edges: v.edges.map(([id, from, fp, to, tp, props]) => ({ id, from: { node: from, port: fp },
        to: { node: to, port: tp }, ...(props ? { props } : {}) })) } });
    const r = await renderStudioOffline(model, { duration: 1, channels: 1,
      ...(opts.sampleRate ? { sampleRate: opts.sampleRate } : {}) });
    if (!r.ok) return { ok: false, errors: r.errors, limitations: r.limitations };
    const b = r.buffer;
    const sr = b.sampleRate;
    const win = slice(b, r.startTime + 0.2, r.startTime + 0.8);
    const amp = {};
    for (const f of v.probe || []) amp[f] = amplitudeAt(win, f, sr);
    return { ok: true, sampleRate: sr, stats: r.stats, amp, ceiling: MAX_OUTPUT_GAIN };
  },
  /** A filter stage's response (dB) at freqs, on an OfflineAudioContext at its default rate. */
  response(cfg, freqs) {
    const ctx = new OfflineAudioContext(1, 128, 48000);
    const stage = createFilterStage(ctx, cfg);
    const { magDb } = stage.getResponse(Float32Array.from(freqs));
    stage.dispose();
    return Array.from(magDb);
  },
};

// The voice graphs (ids, types, params; edges [id, from, port, to, port, props]).
const VOICES = {
  // K010: a 1 kHz sine whose frequency a 440 Hz LFO moves by ±0.1 octave (log mapping).
  fm: () => ({
    nodes: [['osc', 'oscillator', { frequency: 1000 }], ['lfo', 'lfo', { rate: 440 }],
      ['out', 'master', {}]],
    edges: [['e1', 'osc', 'audio', 'out', 'audio'],
      ['e2', 'lfo', 'control', 'osc', 'frequency', { mapping: 'log', depth: 0.1 }]],
    probe: [1000, 560, 1440, 1220],
  }),
  // K012: a full-scale source through Drive at 100 %, trim 1, into a Master Output at its
  // highest level (MAX_OUTPUT_GAIN, the engine's hard ceiling). `source` is an oscillator
  // ({ waveform, frequency }) or, with { noise: color }, Noise at level 1.
  drive: ({ waveform = 'sawtooth', frequency = 110, noise = null } = {}) => ({
    nodes: [noise ? ['src', 'noise', { color: noise, level: 1 }]
      : ['src', 'oscillator', { waveform, frequency }],
    ['drive', 'drive', { drive: 1, trim: 1 }], ['out', 'master', { level: MAX_OUTPUT_GAIN }]],
    edges: [['e1', 'src', 'audio', 'drive', 'audio'], ['e2', 'drive', 'audio', 'out', 'audio']],
  }),
  // K011: a sine at `tone` Hz through a Studio Filter of `type` (a shelf) at 1 kHz, `gain` dB.
  shelf: ({ type, gain, tone }) => ({
    nodes: [['osc', 'oscillator', { frequency: tone }],
      ['f', 'filter', { type, frequency: 1000, gain }], ['out', 'master', {}]],
    edges: [['e1', 'osc', 'audio', 'f', 'audio'], ['e2', 'f', 'audio', 'out', 'audio']],
    probe: [tone],
  }),
  // K013: a Macro at `value` opens a 300 Hz low-pass by up to 4 kHz (unipolar edge).
  macro: ({ value }) => ({
    nodes: [['osc', 'oscillator', { waveform: 'sawtooth', frequency: 220 }],
      ['f', 'filter', { frequency: 300 }], ['m', 'macro', { value }], ['out', 'master', {}]],
    edges: [['e1', 'osc', 'audio', 'f', 'audio'], ['e2', 'f', 'audio', 'out', 'audio'],
      ['e3', 'm', 'control', 'f', 'frequency', { depth: 4000, polarity: 'unipolar' }]],
    probe: [2200],
  }),
};

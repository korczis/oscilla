// Fixture for tests/browser/v31-studio-offline.cjs: bundled with esbuild (IIFE) into one classic
// <script> of a single file:// page. It renders the shipped Studio templates (§256) through
// src/js/studio/offline.js (the Studio runtime on an OfflineAudioContext through
// audio/offline-renderer.js) and returns plain numbers; the runner asserts.

import { templateModel } from '../../../src/js/studio/templates/index.js';
import { renderStudioOffline } from '../../../src/js/studio/offline.js';

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
};

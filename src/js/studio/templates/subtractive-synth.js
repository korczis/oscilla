// Template: Subtractive Synth (spec §195, §257) — the Basic Synth reference fixture:
// OSC → ADSR → FILTER → MASTER; LFO → FILTER cutoff; timeline Tone then Sweep; cutoff
// automation 500 Hz → 8 kHz. A Spectrum taps the filter output (side-chain, §190), which makes
// its screen-reader summary the §249 example.
import { clip, edge, lane, node, studioDoc, track } from './data.js';

export default {
  id: 'subtractive-synth',
  version: 1,
  title: 'Subtractive Synth',
  category: 'synthesis',
  learn: {
    summary: 'A bright sawtooth shaped by an envelope, then darkened by a low-pass filter whose '
      + 'cutoff an LFO and an automation lane move.',
    points: [
      'Subtractive synthesis starts from a tone rich in harmonics and removes some of them.',
      'The automation lane sets the cutoff along the timeline (500 Hz to 8 kHz); the LFO adds '
        + 'one octave up and down around it, continuously.',
      'The Spectrum listens to the filter output on a side chain: it observes the signal and '
        + 'does not change it.',
    ],
  },
  studioHash: '3982a31f8fe6f92f9206bca48ab19b7cfe091105fdb841143e7d1f1e892ec424',
  model: studioDoc({
    title: 'Subtractive Synth',
    nodes: [
      node('osc-1', 'oscillator', 40, 160, { waveform: 'sawtooth', frequency: 220, level: 1 }),
      node('env-1', 'envelope', 240, 160, {}),
      node('filter-1', 'filter', 430, 160, { type: 'lowpass', frequency: 500 }),
      node('master-1', 'master', 640, 160, {}, 'Master'),
      node('lfo-1', 'lfo', 430, 340, { shape: 'sine', rate: 0.5 }),
      node('spectrum-1', 'spectrum', 640, 340, {}),
    ],
    edges: [
      edge('edge-1', 'osc-1', 'audio', 'env-1', 'audio'),
      edge('edge-2', 'env-1', 'audio', 'filter-1', 'audio'),
      edge('edge-3', 'filter-1', 'audio', 'master-1', 'audio'),
      edge('edge-4', 'lfo-1', 'control', 'filter-1', 'frequency',
        { depth: 1, mapping: 'log', polarity: 'bipolar' }),
      edge('edge-5', 'filter-1', 'audio', 'spectrum-1', 'audio'),
    ],
    tracks: [track('track-1', 'event', 'Source', 'osc-1')],
    clips: [
      clip('clip-1', 'track-1', 'pattern', 0, 1, { blockType: 'tone', params: { freq: 220 } }),
      clip('clip-2', 'track-1', 'pattern', 1, 2, { blockType: 'sweep',
        params: { start: 220, end: 880, curve: 'log' } }),
    ],
    automation: [lane('lane-1', 'filter-1', 'frequency', [
      ['pt-1', 0, 500, 'linear'],
      ['pt-2', 3, 8000, 'exponential'],
    ])],
  }),
};

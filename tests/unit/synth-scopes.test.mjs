// K152: every VCO, filter, envelope and LFO plate of the Synth draws what it does from its own
// parameters (src/js/synth/view/scopes.js), and a knob drag redraws it in place. The filter
// curve is the Web Audio biquad of the specification for the linear Q the Studio stores, so it
// is checked against the definitions it must meet: a Butterworth low-pass or high-pass is
// -3.01 dB at its cutoff, a band-pass 0 dB at its centre, a peaking filter its gain at its
// centre, a notch far below at its centre, shelves their gain far into the shelf, an all-pass
// flat. Nothing on a plate names a curve by colour alone: each scope is an image with a label.
//
//   node --test tests/unit/synth-scopes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { plateHtml } from '../../src/js/synth/view/face.js';
import { panelTokens } from '../../src/js/synth/view/tokens.js';
import { panelStore } from './synth-fixture.mjs';

const sc = await import('../../src/js/synth/view/scopes.js').catch(() => ({}));
const tokens = panelTokens(null);
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

test('the filter curve is the Web Audio biquad for the linear Q', () => {
  const db = sc.biquadDb;
  assert.equal(typeof db, 'function');
  near(db('lowpass', 1000, Math.SQRT1_2, 0, 1000), -3.0103, 0.01, 'lowpass at cutoff');
  near(db('highpass', 1000, Math.SQRT1_2, 0, 1000), -3.0103, 0.01, 'highpass at cutoff');
  near(db('lowpass', 1000, Math.SQRT1_2, 0, 20), 0, 0.01, 'lowpass passband');
  assert.ok(db('lowpass', 1000, Math.SQRT1_2, 0, 10000) < -38, 'lowpass 12 dB/oct stopband');
  near(db('bandpass', 1000, 2, 0, 1000), 0, 0.01, 'bandpass at centre');
  near(db('peaking', 1000, 1, 6, 1000), 6, 0.01, 'peaking at centre');
  assert.ok(db('notch', 1000, 1, 0, 1000) < -60, 'notch at centre');
  near(db('lowshelf', 1000, 1, 6, 20), 6, 0.1, 'low shelf far below');
  near(db('highshelf', 1000, 1, -6, 19000), -6, 0.2, 'high shelf far above');
  for (const f of [50, 1000, 15000]) near(db('allpass', 1000, 1, 0, f), 0, 1e-6, `allpass ${f}`);
  // A resonant low-pass peaks near its cutoff by about 20·log10(Q).
  near(db('lowpass', 1000, 4, 0, 1000), 20 * Math.log10(4), 0.05, 'resonant lowpass at cutoff');
});

test('each scope is a labelled image of the parameters it draws', () => {
  const vco = sc.scopeOf('vco', { waveform: 'pulse', width: 25 }, tokens);
  assert.match(vco.label, /Pulse 25 %, one cycle/);
  assert.match(vco.svg, /role="img" aria-label="Pulse 25 %, one cycle"/);
  const lfo = sc.scopeOf('lfo', { shape: 'triangle', rate: 0.5 }, tokens);
  assert.match(lfo.label, /triangle, two cycles at 0\.5 Hz/);
  const env = sc.scopeOf('envelope', { attack: 0.01, decay: 0.25, sustain: 0.5, release: 1.5 },
    tokens);
  assert.equal(env.label, 'Envelope: attack 10 ms, decay 250 ms, sustain 50 %, release 1.5 s');
  const lpf = sc.scopeOf('filter', { type: 'lowpass', frequency: 1200, Q: 0.7071, gain: 0,
    enabled: true }, tokens);
  assert.match(lpf.label, /^lowpass response, 1\.2 kHz, Q 0\.71, 20 Hz to 20 kHz$/);
  assert.equal(sc.scopeOf('mixer', {}, tokens), null, 'a module without a curve has none');
  for (const s of [vco, lfo, env, lpf]) {
    const shapes = s.svg.match(/<(line|polyline)\b[^>]*>/g);
    assert.ok(shapes.every((x) => /\bstroke="/.test(x)), 'every shape sets its own stroke');
    assert.ok(!/NaN/.test(s.svg), 'no NaN in the drawing');
  }
});

test('the plates of the panel carry their scopes, and a knob drag redraws them', () => {
  const m = panelStore().getModel();
  const res = PANEL.resolve(m);
  const want = { vco1: 'vco', vco2: 'vco', hpf: 'filter', lpf: 'filter', eg1: 'envelope',
    eg2: 'envelope', mg: 'lfo' };
  for (const [mid, type] of Object.entries(want)) {
    const html = plateHtml({ panel: PANEL, module: PANEL.module(mid), node: res.get(mid),
      model: m, tokens });
    assert.match(html, new RegExp(`data-scope="${mid}"`), `${mid} has a scope`);
    assert.equal(PANEL.module(mid).node, type);
  }
  const ui = readFileSync(new URL('../../src/js/synth/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /function updateKnob[\s\S]*?refreshScope\(el, x\.mid,/);
});

// C013 (findings vis-divergence-1): the Waveform scope, its canvas label and the bridge's loop
// follow the output owner. While the sequencer or the Studio sounds through the one output
// analyser the scope draws the live trace at full scale and names the owner; it never says
// "not playing" over a computed instrument wave. Fails on the merge base, where all three
// follow the instrument's playing flag only.
//   node --test tests/unit/scope-follows-owner.test.mjs

import test from 'node:test';
import assert from 'node:assert';

import { createScopeView } from '../../src/js/ui/p5-views.js';
import { VisualizationBridge } from '../../src/js/visualization/visualization-bridge.js';
import { createWorkbench } from '../../src/js/ui/workbench.js';

const SR = 48000;

/** A p5 stand-in for the scope: records the label text and the trace's vertices. */
function scopeHost() {
  const drawn = [];
  const vertices = [];
  const ctx = {
    font: '', fillStyle: '', textAlign: '', textBaseline: '',
    save() {}, restore() {},
    fillText: (t) => { drawn.push(String(t)); },
    measureText: (t) => ({ width: String(t).length * 5 }),
  };
  const base = {
    LEFT: 'left', RIGHT: 'right', CENTER: 'center', CLOSE: 'close', drawingContext: ctx,
    color: () => ({ setAlpha() {}, toString: () => 'rgb(0,0,0)' }),
    vertex: (x, y) => { vertices.push(y); },
  };
  const p = new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const pal = { gridSoft: 'g', muted: 'm', accent: 'a', dim: 'd', accentFaint: 'f',
    accentSoft: 's' };
  const W = 600;
  const H = 200;
  return { h: { p, W, H, pal, bandMin: new Float32Array(W), bandMax: new Float32Array(W) },
    drawn, vertices, H };
}

/** A sine of amplitude `amp` at `f` Hz in an 8192-sample analyser buffer. */
function sine(f, amp) {
  const d = new Float32Array(8192);
  for (let i = 0; i < d.length; i++) d[i] = amp * Math.sin((2 * Math.PI * f * i) / SR);
  return d;
}

function scopeState({ owner, playing = false, amp = 0.5 }) {
  return {
    live: { timeData: sine(440, amp), sampleRate: SR, inst: playing ? 250 : NaN, refFreq: 250,
      hasCtx: true },
    playing, outputOwner: owner, gain: 0.08, frequency: 250, waveform: 'sine', plan: null,
  };
}

function drawScope(st) {
  const host = scopeHost();
  createScopeView({ getWindowMs: () => 5 }).draw(host.h, st);
  return host;
}

test('scope: the sequencer owns the output: live trace, named, at full scale', () => {
  const { drawn, vertices, H } = drawScope(scopeState({ owner: 'sequencer' }));
  const label = drawn.find((t) => t.startsWith('output analyser'));
  assert.ok(label, `a live label is drawn (drawn: ${JSON.stringify(drawn)})`);
  assert.match(label, /^output analyser · sequencer/);
  assert.match(label, /relative to full scale/);
  assert.ok(!drawn.some((t) => /not playing/.test(t)), 'never "not playing"');
  // full scale: a 0.5 sine fills half the ±1 lanes (not clamped against the instrument's gain)
  const ymid = (16 + (H - 14)) / 2;
  const hh = (H - 14 - 16) / 2 - 2;
  let dev = 0;
  for (const y of vertices) dev = Math.max(dev, Math.abs(y - ymid));
  assert.ok(dev > 0.4 * hh && dev < 0.6 * hh, `trace at full scale (deviation ${dev}, hh ${hh})`);
});

test('scope: the Studio owns the output: live trace named Studio', () => {
  const { drawn } = drawScope(scopeState({ owner: 'studio' }));
  const label = drawn.find((t) => t.startsWith('output analyser'));
  assert.ok(label, `a live label is drawn (drawn: ${JSON.stringify(drawn)})`);
  assert.match(label, /^output analyser · Studio/);
  assert.ok(!drawn.some((t) => /not playing/.test(t)));
});

test('scope: the instrument keeps its own label (relative to set gain); idle stays computed', () => {
  const inst = drawScope(scopeState({ owner: 'instrument', playing: true, amp: 0.08 })).drawn;
  const label = inst.find((t) => t.startsWith('output analyser'));
  assert.ok(label);
  assert.match(label, /relative to set gain/);
  assert.ok(!/sequencer|Studio/.test(label));
  const idle = drawScope(scopeState({ owner: null })).drawn;
  assert.ok(idle.some((t) => t.startsWith('not playing · computed')), JSON.stringify(idle));
  assert.ok(!idle.some((t) => t.startsWith('output analyser')));
});

function stubEnv() {
  return {
    document: { hidden: false, documentElement: {}, addEventListener() {},
      removeEventListener() {} },
    requestAnimationFrame: () => 1, setTimeout: () => 1, setInterval: () => 1,
    clearInterval() {},
  };
}

test('bridge.setOutputOwner keeps the loop running under reduced motion while a source sounds', () => {
  const bridge = new VisualizationBridge({ env: stubEnv() });
  const calls = [];
  bridge.attachP5({ canvas: {}, loop: () => calls.push('loop'), noLoop: () => calls.push('noLoop'),
    redraw() {} });
  bridge.state.reducedMotion = true;
  bridge.updateLoop();
  assert.strictEqual(bridge.looping, false, 'idle under reduced motion: no loop');
  bridge.setOutputOwner('sequencer');
  assert.strictEqual(bridge.state.outputOwner, 'sequencer');
  assert.strictEqual(bridge.looping, true, 'the sequencer sounds: the scope keeps updating');
  bridge.setOutputOwner('studio');
  assert.strictEqual(bridge.looping, true);
  bridge.setOutputOwner(null);
  assert.strictEqual(bridge.looping, false);
  assert.deepStrictEqual(calls, ['noLoop', 'loop', 'noLoop']);
  assert.throws(() => bridge.setOutputOwner('Studio'), TypeError);
  assert.throws(() => bridge.setOutputOwner(undefined), TypeError);
  assert.strictEqual(bridge.state.outputOwner, null, 'a refused owner changes nothing');
});

function workbenchCmp(fields) {
  const wb = createWorkbench({ engine: { analyser: { fftSize: 8192 } } });
  const cmp = {};
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(wb));
  Object.assign(cmp, {
    tabs: { analysis: 'waveform' }, timeWindowMs: 5, source: 'single', metricFrequency: 250,
    effectiveSampleRate: SR, waveform: 'sine', playing: false, seqPlaying: false,
    studio: { playing: false }, studioOwnsOutput() { return this.studio.playing; },
  }, fields);
  return cmp;
}

test('workbench: outputOwner and the canvas label name the source that sounds', () => {
  const seq = workbenchCmp({ seqPlaying: true });
  assert.strictEqual(seq.outputOwner, 'sequencer');
  assert.match(seq.analysisCanvasLabel, /^Live output analyser waveform \(sequencer\)/);
  assert.match(seq.analysisCanvasLabel, /relative to full scale/);
  assert.doesNotMatch(seq.analysisCanvasLabel, /not playing/);

  const studio = workbenchCmp({ studio: { playing: true } });
  assert.strictEqual(studio.outputOwner, 'studio');
  assert.match(studio.analysisCanvasLabel, /^Live output analyser waveform \(Studio\)/);

  const inst = workbenchCmp({ playing: true, seqPlaying: true });
  assert.strictEqual(inst.outputOwner, 'instrument');
  assert.match(inst.analysisCanvasLabel, /scaled to the set gain/);

  const idle = workbenchCmp({});
  assert.strictEqual(idle.outputOwner, null);
  assert.match(idle.analysisCanvasLabel, /^Waveform, not playing: computed sine/);
});

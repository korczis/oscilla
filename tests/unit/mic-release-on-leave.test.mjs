// C040: the lab microphone is released when its panel leaves the screen, and the panel says why.
//
// Before C040 the mic lab stopped its stream only from its own toggle, a track's 'ended' or the
// engine's detach, so a microphone opened in Analyzer stayed open in Measure, Studio or Synth,
// where no surface shows it (and Measure's "the microphone opens only for ... its own steps"
// was false). The lab's mount return now carries release(reason): every track stopped, the
// nodes released, the toggle unpressed, and the panel note set to MIC_RELEASED_HIDDEN. The
// shell's workspace watcher (src/js/main.js) calls it when #osc-panel-mic has no client rects.
// Fake adapter and fake DOM, as tests/unit/mic-detach-on-close.test.mjs.
//   node --test tests/unit/mic-release-on-leave.test.mjs
// The browser half is `mic-released-when-hidden` in tests/browser/app.cjs.

import test from 'node:test';
import assert from 'node:assert/strict';

// A namespace import, so the base (no release, no MIC_RELEASED_HIDDEN) fails on an assertion.
import * as micLab from '../../src/js/labs/mic-analyzer.js';

const { mount, MIC_NOTE, MIC_OFF } = micLab;

// ----------------------------------------------------------------------------- fakes

function fakeStream(n = 2) {
  const tracks = [];
  for (let i = 0; i < n; i += 1) {
    const t = { readyState: 'live', onended: null, stops: 0 };
    t.stop = () => { t.stops += 1; t.readyState = 'ended'; };
    tracks.push(t);
  }
  return { tracks, getTracks: () => tracks, getAudioTracks: () => tracks };
}

function fakeEl() {
  const attrs = new Map();
  const listeners = new Map();
  return {
    textContent: '',
    style: {},
    classList: { toggle() {}, contains: () => false },
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => { attrs.set(k, String(v)); },
    hasAttribute: (k) => attrs.has(k),
    addEventListener: (t, fn) => { listeners.set(t, fn); },
    removeEventListener: (t) => { listeners.delete(t); },
    click: () => { const fn = listeners.get('click'); if (fn) fn({ type: 'click' }); },
  };
}

/** The mic panel's elements the lab binds, with its note; no chart host, so no chart. */
function fakeRoot() {
  const els = {
    '#osc-mic-toggle': fakeEl(),
    '#osc-mic-requested': fakeEl(),
    '#osc-mic-detected': fakeEl(),
    '.osc-mic-note': fakeEl(),
  };
  const root = fakeEl();
  root.querySelector = (sel) => els[sel] || null;
  root.querySelectorAll = () => [];
  return { root, els };
}

/** The labs/index.js adapter with one engine-owned mic graph (as audio-engine.js holds). */
function fakeAdapter() {
  const listeners = new Set();
  const ctx = { state: 'running', sampleRate: 48000, resume: () => Promise.resolve() };
  let current = null;
  const a = {
    attachCalls: 0,
    detachCalls: 0,
    getContext: () => ctx,
    getAnalyser: () => null,
    requestedFrequency: () => null,
    attachMicrophone(stream) {
      a.attachCalls += 1;
      current = { analyser: { context: ctx, fftSize: 8192 }, stream };
      return current.analyser;
    },
    detachMicrophone() {
      a.detachCalls += 1;
      const m = current;
      current = null;
      const d = m ? { attached: false, reason: 'user', analyser: m.analyser } : null;
      if (d) for (const fn of [...listeners]) fn(d);
      return !!m;
    },
    onMicDetached(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get attachedAnalyser() { return current ? current.analyser : null; },
  };
  return a;
}

/** Run fn with navigator.mediaDevices.getUserMedia answering gum(). */
function withMediaDevices(gum, fn) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: gum } },
  });
  const restore = () => {
    if (desc) Object.defineProperty(globalThis, 'navigator', desc);
    else delete globalThis.navigator;
  };
  return Promise.resolve().then(fn).finally(restore);
}

async function liveLab() {
  const { root, els } = fakeRoot();
  const adapter = fakeAdapter();
  const stream = fakeStream();
  const lab = mount(root, adapter);
  await withMediaDevices(() => Promise.resolve(stream), () => lab.start());
  assert.equal(lab.active, true, 'setup: the lab is live');
  assert.ok(adapter.attachedAnalyser, 'setup: the engine holds the lab graph');
  return { lab, adapter, stream, root, els };
}

// ----------------------------------------------------------------------------- tests

test('the module states the released note', () => {
  assert.equal(typeof micLab.MIC_RELEASED_HIDDEN, 'string', 'MIC_RELEASED_HIDDEN is exported');
  assert.match(micLab.MIC_RELEASED_HIDDEN, /released/i);
  assert.match(micLab.MIC_RELEASED_HIDDEN, /panel left the screen/);
  assert.notEqual(micLab.MIC_RELEASED_HIDDEN, MIC_NOTE);
});

test('release(\'workspace\') stops every track, releases the nodes, resets toggle and note',
  async () => {
    const { lab, adapter, stream, els } = await liveLab();
    assert.equal(typeof lab.release, 'function', 'the mount return carries release(reason)');
    const toggle = els['#osc-mic-toggle'];
    assert.equal(toggle.textContent, 'Stop microphone', 'setup: the toggle shows it live');
    assert.equal(lab.release('workspace'), true, 'it held a microphone');
    assert.deepEqual(stream.tracks.map((t) => t.readyState), ['ended', 'ended'],
      'every track is stopped');
    assert.equal(lab.active, false);
    assert.equal(lab.stream, null);
    assert.equal(lab.analyser, null, 'no node is attached in the lab');
    assert.equal(adapter.attachedAnalyser, null, 'nor in the engine');
    assert.equal(adapter.detachCalls, 1);
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(toggle.textContent, 'Use microphone');
    assert.equal(els['.osc-mic-note'].textContent, micLab.MIC_RELEASED_HIDDEN,
      'the panel note says why');
    assert.equal(lab.error, '', 'a release is not an error');
    assert.equal(els['#osc-mic-detected'].textContent, MIC_OFF);
    assert.equal(lab.releasedFor, 'workspace');
    lab.dispose();
  });

test('release with no microphone held changes nothing', async () => {
  const { root, els } = fakeRoot();
  const adapter = fakeAdapter();
  const lab = mount(root, adapter);
  assert.equal(typeof lab.release, 'function', 'the mount return carries release(reason)');
  assert.equal(lab.release('workspace'), false);
  assert.equal(els['.osc-mic-note'].textContent, MIC_NOTE, 'the note keeps its caveat');
  assert.equal(adapter.detachCalls, 0);
  lab.dispose();
});

test('the next start opens it again and restores the caveat note', async () => {
  const { lab, adapter, els } = await liveLab();
  assert.equal(typeof lab.release, 'function', 'the mount return carries release(reason)');
  lab.release('workspace');
  const again = fakeStream(1);
  await withMediaDevices(() => Promise.resolve(again), () => lab.start());
  assert.equal(lab.active, true);
  assert.equal(adapter.attachCalls, 2);
  assert.equal(els['#osc-mic-toggle'].getAttribute('aria-pressed'), 'true');
  assert.equal(els['.osc-mic-note'].textContent, MIC_NOTE);
  assert.equal(lab.releasedFor, null);
  lab.dispose();
});

test('a release while permission is pending leaves the late stream unused', async () => {
  const { root, els } = fakeRoot();
  const adapter = fakeAdapter();
  const lab = mount(root, adapter);
  assert.equal(typeof lab.release, 'function', 'the mount return carries release(reason)');
  const late = fakeStream(1);
  let grant;
  const gum = () => new Promise((resolve) => { grant = () => resolve(late); });
  await withMediaDevices(gum, async () => {
    const pending = lab.start();
    // The start reaches getUserMedia after its context step.
    for (let i = 0; i < 10 && !grant; i += 1) await Promise.resolve();
    assert.equal(typeof grant, 'function', 'setup: getUserMedia was asked');
    assert.equal(lab.release('workspace'), true, 'a pending start counts as held');
    grant();
    await pending;
  });
  assert.equal(lab.active, false, 'the released start does not go live');
  assert.equal(late.tracks[0].readyState, 'ended', 'the late stream is stopped');
  assert.equal(adapter.attachCalls, 0, 'and never attached');
  assert.equal(lab.error, '');
  assert.equal(els['#osc-mic-toggle'].getAttribute('aria-pressed'), 'false');
  assert.equal(els['#osc-mic-toggle'].getAttribute('aria-disabled'), 'false');
  assert.equal(els['.osc-mic-note'].textContent, micLab.MIC_RELEASED_HIDDEN);
  lab.dispose();
});

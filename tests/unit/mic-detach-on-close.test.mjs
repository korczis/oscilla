// C015: the mic lab stops honestly when the engine discards its audio context.
//
// When a context closes from outside, the engine's _discardContext() detaches the microphone
// graph ('micAttachment' { attached: false, reason: 'closed' }) and stops its tracks. A stopped
// track dispatches no 'ended', so before C015 the lab kept its stream, kept showing
// "Stop microphone" and read the analyser of the dead context (finding engine-sync-3).
//
// Engine half: the detach event names the analyser it detached, so a listener can tell its own
// graph from another. Lab half, on a fake adapter and a fake DOM: the lab reacts to a detach of
// its own analyser (any reason but 'replaced'), clears the stream, resets the button and says
// why; a detach of another analyser, or a 'replaced', leaves it alone.
//   node --test tests/unit/mic-detach-on-close.test.mjs
// The browser half is `mic-detach-on-close` in tests/browser/app.cjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
// A namespace import, so the base (without MIC_CONTEXT_CLOSED) fails on an assertion, not a link.
import * as micLab from '../../src/js/labs/mic-analyzer.js';

const { mount, MIC_OFF } = micLab;

const here = path.dirname(fileURLToPath(import.meta.url));
const FREEZE_DIR = path.resolve(process.env.OSCILLA_FREEZE_DIR || path.join(here, '../freeze'));
const hasMock = fs.existsSync(path.join(FREEZE_DIR, 'extract.cjs'));
const skip = hasMock ? false : `mock AudioContext not found in ${FREEZE_DIR}`;
const require = createRequire(import.meta.url);
const { makeMockAudio } = hasMock ? require(path.join(FREEZE_DIR, 'extract.cjs')) : {};

// ----------------------------------------------------------------------------- fakes

function fakeTracks() {
  const tracks = [{ readyState: 'live', onended: null }];
  tracks[0].stop = () => { tracks[0].readyState = 'ended'; };
  return tracks;
}

function fakeStream() {
  const tracks = fakeTracks();
  return { tracks, getTracks: () => tracks, getAudioTracks: () => tracks };
}

/** A minimal element: attributes, textContent and click listeners. */
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
  };
}

/** The mic panel's elements the lab binds; no chart host, so no chart is drawn. */
function fakeRoot() {
  const els = {
    '#osc-mic-toggle': fakeEl(),
    '#osc-mic-requested': fakeEl(),
    '#osc-mic-detected': fakeEl(),
  };
  const root = fakeEl();
  root.querySelector = (sel) => els[sel] || null;
  root.querySelectorAll = () => [];
  return { root, els };
}

/** The adapter of labs/index.js, with an engine-owned mic graph and a detach notification. */
function fakeAdapter() {
  const listeners = new Set();
  const analysers = [];
  const ctx = { state: 'running', sampleRate: 48000, resume: () => Promise.resolve() };
  const a = {
    detachCalls: 0,
    analysers,
    getContext: () => ctx,
    getAnalyser: () => null,
    requestedFrequency: () => null,
    attachMicrophone() {
      const an = { context: ctx, fftSize: 8192, id: analysers.length + 1 };
      analysers.push(an);
      return an;
    },
    detachMicrophone() { a.detachCalls += 1; return true; },
    onMicDetached(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** What main.js feeds from engine.on('micAttachment', { attached: false, ... }). */
    emitDetached(d) {
      for (const fn of listeners) fn({ attached: false, ...d });
    },
    get listenerCount() { return listeners.size; },
  };
  return a;
}

function withMediaDevices(stream, fn) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => Promise.resolve(stream) } },
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
  await withMediaDevices(stream, () => lab.start());
  const toggle = els['#osc-mic-toggle'];
  assert.equal(lab.active, true, 'setup: the lab is live');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true', 'setup: the button shows it');
  assert.equal(adapter.analysers.length, 1, 'setup: the engine attached one graph');
  return { lab, adapter, stream, toggle, detected: els['#osc-mic-detected'] };
}

// ----------------------------------------------------------------------------- engine half

test('engine: a context closed from outside detaches the mic graph and names its analyser',
  { skip }, () => {
    const audio = makeMockAudio({});
    const env = { AudioContext: audio.AudioContext, setTimeout: () => 0, clearTimeout() {} };
    const eng = new AudioEngine({ env });
    audio.AudioContext.prototype.createMediaStreamSource = function createMSS() {
      const n = this.createGain();
      n.kind = 'mediaStreamSource';
      return n;
    };
    const events = [];
    eng.on((type, d) => { if (type === 'micAttachment') events.push(d); });
    const stream = fakeStream();
    const an = eng.attachMicrophone(stream, { fftSize: 4096 });
    assert.ok(an);
    eng.ctx.externalState('closed');
    assert.equal(eng.ctx, null, 'the engine discarded the closed context');
    assert.equal(eng.micNodeCount, 0);
    assert.equal(stream.tracks[0].readyState, 'ended');
    assert.equal(events.length, 1);
    assert.equal(events[0].attached, false);
    assert.equal(events[0].reason, 'closed');
    assert.equal(events[0].analyser, an, 'the event carries the detached analyser');
  });

test('engine: an attachment that replaces another names the replaced analyser', { skip }, () => {
  const audio = makeMockAudio({});
  const env = { AudioContext: audio.AudioContext, setTimeout: () => 0, clearTimeout() {} };
  const eng = new AudioEngine({ env });
  audio.AudioContext.prototype.createMediaStreamSource = function createMSS() {
    return this.createGain();
  };
  const events = [];
  eng.on((type, d) => { if (type === 'micAttachment') events.push(d); });
  const first = eng.attachMicrophone(fakeStream());
  const second = eng.attachMicrophone(fakeStream());
  assert.notEqual(first, second);
  assert.deepEqual(events.map((d) => [d.reason, d.analyser]), [['replaced', first]]);
  eng.detachMicrophone();
  assert.deepEqual(events.map((d) => [d.reason, d.analyser]),
    [['replaced', first], ['user', second]]);
});

// ----------------------------------------------------------------------------- lab half

test('lab: subscribes to the adapter detach notification while mounted', async () => {
  const { lab, adapter } = await liveLab();
  assert.equal(adapter.listenerCount, 1, 'the lab listens through adapter.onMicDetached');
  lab.dispose();
  assert.equal(adapter.listenerCount, 0, 'dispose() unsubscribes');
});

test('lab: the engine detaching its analyser on close stops it and says why', async () => {
  const { lab, adapter, stream, toggle, detected } = await liveLab();
  const own = adapter.analysers[0];
  adapter.emitDetached({ reason: 'closed', analyser: own });
  assert.equal(lab.active, false, 'the lab no longer reports a live microphone');
  assert.equal(lab.analyser, null, 'and reads no analyser of the dead context');
  assert.equal(lab.stream, null);
  assert.equal(lab.estimate, null, 'no detected frequency is kept from the closed graph');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(toggle.textContent, 'Use microphone');
  assert.match(String(micLab.MIC_CONTEXT_CLOSED), /audio context was closed/);
  assert.equal(lab.error, micLab.MIC_CONTEXT_CLOSED);
  assert.equal(detected.textContent, micLab.MIC_CONTEXT_CLOSED, 'the readout states the reason');
  assert.equal(stream.tracks[0].readyState, 'ended', 'its tracks are stopped');
  assert.equal(adapter.detachCalls, 0, 'the engine already detached; the lab does not again');
  lab.dispose();
});

test('lab: a detach of another analyser, or a replacement, leaves the live lab alone',
  async () => {
    const { lab, adapter, toggle } = await liveLab();
    adapter.emitDetached({ reason: 'closed', analyser: { id: 'someone-else' } });
    adapter.emitDetached({ reason: 'closed' }); // no analyser named: not provably ours
    adapter.emitDetached({ reason: 'replaced', analyser: adapter.analysers[0] });
    assert.equal(lab.active, true);
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(lab.error, '');
    lab.dispose();
  });

test('lab: its own stop is not reported as an engine detach; a restart works', async () => {
  const { lab, adapter, toggle, detected } = await liveLab();
  const own = adapter.analysers[0];
  lab.stop();
  // The engine emits the user's own detach; the lab has already let the analyser go.
  adapter.emitDetached({ reason: 'user', analyser: own });
  assert.equal(adapter.detachCalls, 1);
  assert.equal(lab.error, '');
  assert.equal(detected.textContent, MIC_OFF);
  // After a closed-context stop the next start is a fresh stream on a fresh analyser.
  await withMediaDevices(fakeStream(), () => lab.start());
  assert.equal(lab.active, true);
  adapter.emitDetached({ reason: 'closed', analyser: adapter.analysers[1] });
  assert.equal(lab.active, false);
  await withMediaDevices(fakeStream(), () => lab.start());
  assert.equal(lab.active, true, 'a start after the close opens the microphone again');
  assert.equal(lab.error, '', 'and clears the close reason');
  assert.equal(lab.analyser, adapter.analysers[2]);
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  lab.dispose();
});

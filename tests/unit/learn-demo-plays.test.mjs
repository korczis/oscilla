// C031: a Learn demo plays on its press. runDemo (core/instrument.js) applies the demo's config
// and then plays it through the instrument's own TRIGGER path (play -> ensureAudio ->
// engine.play, whose main.js wrapper claims the output), once, inside the press; V1 only
// applied it and asked for a second press. When audio does not start, or the output claim
// refuses the voice, nothing plays and the notice says the demo is not playing.
import test from 'node:test';
import assert from 'node:assert';
import { createInstrument } from '../../src/js/core/instrument.js';
import { LEARN_TOPICS } from '../../src/js/data/learn.js';

const noTimer = { setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
  clearInterval() {} };
const memStore = () => {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v); return true; },
    remove: (k) => { m.delete(k); return true; } };
};

/** An engine stand-in that records every engine.play; `supported` and `accept` refuse. */
function fakeEngine({ supported = true, accept = true } = {}) {
  const plays = [];
  return {
    plays,
    ctx: null, sampleRate: 48000, state: 'not started', lastError: null, voice: null,
    activeNodeCount: 0, activeSourceCount: 0, running: false, mic: null,
    isSupported: () => supported,
    init() {
      if (!supported) return false;
      this.ctx = this.ctx || {};
      this.state = 'running';
      this.running = true;
      return true;
    },
    resume: () => Promise.resolve(true),
    play(plan, o) {
      plays.push({ plan, mode: o.mode });
      return accept ? { id: plays.length, kind: plan.kind, start: 0, end: 1 } : null;
    },
    release: () => false, stopAll() {}, setMasterGain() {}, updateLive: () => false,
    instantaneousFrequency: () => null, on: () => () => {}, revokeContinuous: () => 0,
    tightenLimit: () => 0,
  };
}

function app(engine) {
  const a = createInstrument({ engine, timers: noTimer, localStore: memStore(),
    sessionStore: memStore(), env: { document: null, navigator: null, location: { hash: '' } },
    location: { hash: '', href: '', search: '' } });
  a.sampleRate = 48000;
  return a;
}

const topic = (id) => LEARN_TOPICS.find((t) => t.id === id);

test('C031: a programmed demo plays its applied config once, by TRIGGER, on its press', () => {
  const engine = fakeEngine();
  const a = app(engine);
  a.pp.octave.text = '440, 880'; // a stale edit the demo must replace before it plays
  const played = a.runDemo(topic('hearing'));
  assert.strictEqual(played, true);
  assert.strictEqual(engine.plays.length, 1, 'one press, one voice');
  assert.strictEqual(engine.plays[0].mode, 'trigger');
  assert.deepStrictEqual(engine.plays[0].plan.freqs,
    [125, 250, 500, 1000, 2000, 4000, 8000, 16000], 'it plays the demo, not what came before');
  const n = a.alerts.find((x) => x.title.startsWith('Demo playing: '));
  assert.ok(n && n.level === 'success', JSON.stringify(a.alerts));
  assert.match(n.message, /^Escape or the status bar's stop button ends it; TRIGGER/);
});

test('C031: an open demo (a tone) plays for the set duration through the same path', () => {
  const engine = fakeEngine();
  const a = app(engine);
  a.frequency = 1234;
  assert.strictEqual(a.runDemo(topic('period')), true);
  assert.strictEqual(engine.plays.length, 1);
  assert.strictEqual(engine.plays[0].mode, 'trigger');
  assert.deepStrictEqual(engine.plays[0].plan.freqs, [440]);
});

test('C031: a two-tone demo plays the dual source it sets', () => {
  const engine = fakeEngine();
  const a = app(engine);
  assert.strictEqual(a.runDemo(topic('beating')), true);
  assert.strictEqual(engine.plays.length, 1);
  assert.strictEqual(a.source, 'dual');
  assert.deepStrictEqual([...engine.plays[0].plan.freqs].sort((x, y) => x - y), [440, 442]);
});

test('C031: no audio, no play, and the notice says the demo is not playing', () => {
  const engine = fakeEngine({ supported: false });
  const a = app(engine);
  assert.strictEqual(a.runDemo(topic('hearing')), false);
  assert.strictEqual(engine.plays.length, 0);
  assert.strictEqual(a.loadedLabel, topic('hearing').demo.label, 'the demo is still applied');
  const n = a.alerts.find((x) => x.title === `Demo ready: ${topic('hearing').demo.label}`);
  assert.ok(n && n.level === 'warning', JSON.stringify(a.alerts));
  assert.match(n.message, /^Audio did not start, so it is not playing\. Press TRIGGER/);
  assert.ok(!a.alerts.some((x) => x.title.startsWith('Demo playing')));
});

test('C031: a voice the output claim refuses is not called playing', () => {
  const engine = fakeEngine({ accept: false });
  const a = app(engine);
  assert.strictEqual(a.runDemo(topic('period')), false);
  assert.strictEqual(engine.plays.length, 1, 'the one attempt went through the engine path');
  assert.ok(a.alerts.some((x) => x.level === 'warning'
    && x.message.startsWith('Audio did not start')), JSON.stringify(a.alerts));
  assert.ok(!a.alerts.some((x) => x.title.startsWith('Demo playing')));
});

test('C031: the demo plays from the press itself, not a second handler (runLearnDemo)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../src/js/core/instrument.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('    runDemo(topic'), src.indexOf('// ====', src
    .indexOf('    runDemo(topic')));
  assert.ok(body.indexOf('this.applyConfig(') < body.indexOf('this.trigger()'),
    'the config is applied before it plays');
  assert.strictEqual((body.match(/this\.trigger\(\)/g) || []).length, 1, 'one play call');
  assert.doesNotMatch(body, /engine\.play|new AudioContext|setTimeout/,
    'no own player and no deferred play: the instrument path, inside the gesture');
});

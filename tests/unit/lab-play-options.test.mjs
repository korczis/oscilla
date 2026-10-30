// C007: the labs' V2 play options are built in one place (src/js/audio/lab-play-options.js),
// with every key present, and the current lab state always wins.
//   - A restarted voice (engine._restart copies the old voice's options) follows the labs as
//     they are now: Additive or Envelope switched off while it sounded stay off (engine-sync-1).
//   - A dual voice gets no additive wave, at play or live (engine-sync-6).
//   - With the Envelope on, notes of known length (finite tone, steps, ramps) take the whole
//     ADSR through o.stepEnvelope, shrunk to fit the step (engine-sync-7), statelessly.
// Runs on the recording mock AudioContext of the V1 freeze harness (freeze/extract.cjs).
//   node --test tests/unit/lab-play-options.test.mjs

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { valueAt } from '../../src/js/audio/voice.js';
import { buildPlan } from '../../src/js/audio/patterns.js';
import { defaultInstrumentState } from '../../src/js/core/config.js';
import {
  LAB_PLAY_KEYS, adsrStepEnvelope, labPlayOptions,
} from '../../src/js/audio/lab-play-options.js';
import * as envelopeJs from '../../src/js/audio/envelope.js';
// The exports added by review round 1 through the namespace, so a missing one fails its own
// tests and not the whole file.
import * as labOpts from '../../src/js/audio/lab-play-options.js';
import { makeAdsrEnvelope } from '../../src/js/audio/voice.js';
import { renderPlanToWav } from '../../src/js/ui/exporters.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FREEZE_DIR = path.resolve(process.env.OSCILLA_FREEZE_DIR || path.join(here, '../freeze'));
const hasMock = fs.existsSync(path.join(FREEZE_DIR, 'extract.cjs'));
const skip = hasMock ? false : `mock AudioContext not found in ${FREEZE_DIR}`;
const require = createRequire(import.meta.url);
const { makeMockAudio } = hasMock ? require(path.join(FREEZE_DIR, 'extract.cjs')) : {};

const SR = 48000;
const ENV_S = { safeMax: (SR / 2) * 0.95, continuous: true };
const FLOOR = 1e-4;

function plan(cfg) {
  const st = defaultInstrumentState();
  const r = buildPlan({ ...st, ...cfg, pp: { ...st.pp, ...(cfg.pp || {}) } }, ENV_S);
  if (!r.ok) throw new Error(r.error);
  return r.plan;
}

const opt = (o = {}) => ({
  mode: 'hold', continuous: true, limitS: 30, durationS: 0.5, attackS: 0.01, releaseS: 0.03, ...o,
});

/** Engine on a fresh mock whose oscillators accept a PeriodicWave (type becomes 'custom'). */
function setup() {
  const audio = makeMockAudio({});
  const proto = audio.AudioContext.prototype;
  const create = proto.createOscillator;
  proto.createOscillator = function () {
    const o = create.call(this);
    o.setPeriodicWave = (w) => { o.type = 'custom'; o.wave = w; };
    return o;
  };
  const timers = new Map();
  let seq = 0;
  const env = {
    AudioContext: audio.AudioContext,
    setTimeout: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; },
    clearTimeout: (id) => { timers.delete(id); },
  };
  const eng = new AudioEngine({ env });
  eng.init(); // the app's ensureAudio builds the context before the first play
  const flush = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
  return { eng, flush, advance: (t) => eng.ctx.advance(t) };
}

/** Plain lab stand-ins, switched by the test the way the panels switch the real labs. */
function makeLabs() {
  const state = {
    envelope: { enabled: false, adsr: { a: 0.01, d: 0.1, s: 0.6, r: 0.3 } },
    additive: { enabled: false, wave: () => ({ id: 'additive' }) },
    phaseDeg: 0,
  };
  return state;
}

/** The main.js wrapper: every play, a _restart included, takes the labs' options. */
function wrap(eng, labs) {
  const base = eng.play.bind(eng);
  const seen = [];
  eng.play = (p, o = {}) => {
    const merged = { ...o, ...labPlayOptions(p, eng.ctx, labs) };
    seen.push(merged);
    return base(p, merged);
  };
  return seen;
}

test('labPlayOptions names every V2 key, a value or null', () => {
  const tone = plan({ pattern: 'tone' });
  const off = labPlayOptions(tone, {}, makeLabs());
  assert.deepStrictEqual(Object.keys(off).sort(), [...LAB_PLAY_KEYS].sort());
  for (const k of LAB_PLAY_KEYS) assert.strictEqual(off[k], null, `${k} is null with every lab off`);
  const none = labPlayOptions(tone, null, {});
  assert.deepStrictEqual(Object.keys(none).sort(), [...LAB_PLAY_KEYS].sort());
  const labs = makeLabs();
  labs.envelope.enabled = true;
  labs.additive.enabled = true;
  const on = labPlayOptions(tone, {}, labs);
  assert.deepStrictEqual(on.adsr, labs.envelope.adsr);
  assert.notStrictEqual(on.adsr, labs.envelope.adsr, 'a copy: the voice keeps what it scheduled');
  assert.strictEqual(on.stepEnvelope, adsrStepEnvelope);
  assert.deepStrictEqual(on.periodicWave, { id: 'additive' });
  assert.strictEqual(on.dualPhaseDeg, null, 'no phase for a single voice');
});

test('a dual plan gets no additive wave; its router and phase come from the labs', () => {
  const dual = plan({ source: 'dual' });
  assert.strictEqual(dual.type, 'dual');
  const labs = makeLabs();
  labs.additive.enabled = true;
  labs.phaseDeg = 90;
  const router = () => ({});
  labs.dualRouter = (p) => (p.type === 'dual' ? router : null);
  const o = labPlayOptions(dual, {}, labs);
  assert.strictEqual(o.periodicWave, null);
  assert.strictEqual(o.dualRouter, router);
  assert.strictEqual(o.dualPhaseDeg, 90);
  labs.dualRouter = () => null;
  assert.strictEqual(labPlayOptions(dual, {}, labs).dualRouter, null,
    'a stale router factory is not reused when the plan needs none');
});

test('restart after Additive is switched off: the new voice plays its plain wave', { skip }, () => {
  const { eng, advance, flush } = setup();
  const labs = makeLabs();
  const seen = wrap(eng, labs);
  labs.additive.enabled = true;
  eng.play(plan({ pattern: 'tone', frequency: 440 }), opt());
  assert.strictEqual(eng.voice.carrier.type, 'custom');
  advance(0.2);
  labs.additive.enabled = false;              // the user switches Additive off while it sounds
  assert.strictEqual(eng.clearPeriodicWave(), true);
  advance(0.3);
  flush();
  assert.strictEqual(eng.voice.carrier.type, 'sine', 'the live voice is back to sine');
  const first = eng.voice;
  assert.strictEqual(eng.updateLive(plan({ pattern: 'finite', frequency: 440 })), 'restarted');
  assert.notStrictEqual(eng.voice, first);
  assert.strictEqual(seen.length, 2, 'the restart went through the wrapper');
  assert.strictEqual(seen[1].periodicWave, null, 'the copied wave is overwritten');
  assert.strictEqual(eng.voice.periodicWave, null);
  assert.strictEqual(eng.voice.carrier.type, 'sine');
  eng.stopAll();
  advance(3);
  assert.strictEqual(eng.activeNodeCount, 0);
});

test('restart after the Envelope is switched off: no ADSR, the level of a fresh voice', { skip },
  () => {
    const { eng, advance } = setup();
    const labs = makeLabs();
    const seen = wrap(eng, labs);
    labs.envelope.enabled = true;
    eng.play(plan({ pattern: 'tone', frequency: 440 }), opt());
    assert.deepStrictEqual(eng.voice.adsr, labs.envelope.adsr);
    advance(0.5);
    labs.envelope.enabled = false;            // the user switches the Envelope off while it sounds
    assert.strictEqual(eng.updateLive(plan({ pattern: 'finite', frequency: 440 })), 'restarted');
    assert.strictEqual(seen[1].adsr, null);
    assert.strictEqual(seen[1].stepEnvelope, null);
    const v = eng.voice;
    assert.strictEqual(v.adsr, null);
    assert.strictEqual(v.attack, 0.01, 'attack from the instrument, not from the old ADSR');
    assert.strictEqual(v.release, 0.03, 'release from the instrument, not from the old ADSR');
    // The finite tone holds at 1 mid-note, as a fresh voice with the Envelope off does.
    const mid = v.t0 + 0.25;
    assert.ok(Math.abs(valueAt(v.env, mid) - 1) < 1e-9, `level ${valueAt(v.env, mid)}`);
    eng.stopAll();
    advance(3);
    assert.strictEqual(eng.activeNodeCount, 0);
  });

test('Envelope on: a finite tone and a steps pattern hold at the sustain mid-note', { skip },
  () => {
    const { eng, advance } = setup();
    const labs = makeLabs();
    wrap(eng, labs);
    labs.envelope.enabled = true;
    labs.envelope.adsr = { a: 0.01, d: 0.1, s: 0.1, r: 0.3 };
    for (const pattern of ['finite', 'sequence']) {
      const p = plan({ pattern, frequency: 440 });
      eng.play(p, opt({ mode: 'trigger' }));
      const v = eng.voice;
      assert.ok(v.adsr, pattern);
      const notes = p.type === 'steps' ? p.steps.map((s) => [s.t, s.dur]) : [[0, p.dur]];
      for (const [t, dur] of notes) {
        // after attack + decay, before the release (the shrunk release is at most dur / 2)
        const at = v.t0 + t + 0.01 + 0.1 + 0.01;
        if (at >= v.t0 + t + dur / 2) continue;
        const level = valueAt(v.env, at);
        assert.ok(Math.abs(level - 0.1) < 0.005, `${pattern} step at ${t}: level ${level}`);
      }
      eng.stopAll();
      advance(v.t0 + p.dur + 1);
    }
    assert.strictEqual(eng.activeNodeCount, 0);
  });

test('Envelope off: programmed patterns keep the V1 step envelope', { skip }, () => {
  const { eng, advance } = setup();
  const labs = makeLabs();
  const seen = wrap(eng, labs);
  const p = plan({ pattern: 'sequence', frequency: 440 });
  eng.play(p, opt({ mode: 'trigger' }));
  assert.strictEqual(seen[0].stepEnvelope, null);
  const v = eng.voice;
  const s = p.steps[0];
  assert.ok(Math.abs(valueAt(v.env, v.t0 + s.t + s.dur * 0.45) - 1) < 1e-9, 'V1 holds at 1');
  eng.stopAll();
  advance(5);
});

test('scheduleAdsrStep: the ADSR shrinks into the step and never clicks', () => {
  const calls = [];
  const rec = {
    setValueAtTime: (v, t) => calls.push(['set', v, t]),
    linearRampToValueAtTime: (v, t) => calls.push(['linear', v, t]),
    exponentialRampToValueAtTime: (v, t) => calls.push(['exp', v, t]),
  };
  const adsr = { a: 0.01, d: 0.1, s: 0.1, r: 0.3 };
  for (const dur of [0.01, 0.02, 0.05, 0.2, 1]) {
    calls.length = 0;
    const r = envelopeJs.scheduleAdsrStep(rec, 2, dur, adsr);
    assert.ok(r.endTime <= 2 + dur + 1e-12, `${dur}: ends inside the step`);
    assert.ok(r.attackEnd - 2 <= dur * 0.4 + 1e-12, `${dur}: attack within 40 %`);
    assert.ok(r.decayEnd <= r.releaseStart + 1e-12, `${dur}: decay ends before the release`);
    assert.deepStrictEqual(calls[0], ['set', FLOOR, 2], 'starts on the floor');
    assert.deepStrictEqual(calls[calls.length - 1], ['exp', FLOOR, 2 + dur], 'ends on the floor');
    for (let i = 1; i < calls.length; i++) {
      assert.ok(calls[i][2] >= calls[i - 1][2] - 1e-12, `${dur}: events in time order`);
      assert.ok(calls[i][1] > 0, `${dur}: no ramp to 0`);
      if (calls[i][0] === 'set') {
        assert.ok(Math.abs(calls[i][1] - calls[i - 1][1]) < 1e-12, `${dur}: a set never steps`);
      }
    }
  }
  // A long note reaches the sustain; nothing is kept in envelope.js's own log.
  calls.length = 0;
  envelopeJs.scheduleAdsrStep(rec, 0, 1, adsr);
  assert.deepStrictEqual(calls.map((c) => c[0]), ['set', 'linear', 'exp', 'set', 'exp']);
  assert.strictEqual(calls[2][1], 0.1);
  assert.deepStrictEqual(envelopeJs.getSchedule(rec), [], 'stateless: no event log');
});

test('adsrStepEnvelope keeps the attack and release the engine hands over (chirp)', () => {
  const calls = [];
  const rec = {
    setValueAtTime: (v, t) => calls.push(['set', v, t]),
    linearRampToValueAtTime: (v, t) => calls.push(['linear', v, t]),
    exponentialRampToValueAtTime: (v, t) => calls.push(['exp', v, t]),
  };
  adsrStepEnvelope(rec, 0, 0.3, 0.003, 0.3, { a: 0.01, d: 0.05, s: 0.5, r: 0.3 });
  assert.deepStrictEqual(calls[1], ['linear', 1, 0.003], 'the shortened chirp attack');
  assert.ok(Math.abs(calls[2][2] - 0.053) < 1e-12 && calls[2][1] === 0.5, 'decay to sustain');
});

// ---- review round 1 of #296 (dev-68, .ai/repo/reviews/296.yaml)

/**
 * The engine as main.js sets it up: the DSP ADSR installed as the open-pattern envelope.
 * advance(s) here moves the mock clock s seconds FORWARD (setup's advance sets it absolutely).
 */
function setupApp() {
  const s = setup();
  s.eng.setEnvelope(makeAdsrEnvelope({ applyAdsr: envelopeJs.applyAdsr,
    releaseAt: envelopeJs.releaseAt }));
  return { ...s, advance: (t) => s.eng.ctx.advance(s.eng.ctx.currentTime + t) };
}

const sweep = (o) => plan({ source: 'sweep', sweep: { ...defaultInstrumentState().sweep,
  start: 100, end: 1000, durationMs: 1000, curve: 'log', ...o } });
const LOW_SUSTAIN = { a: 0.01, d: 0.1, s: 0.1, r: 0.3 };

test('R-1: Envelope on, a continuous ping-pong sweep holds at the sustain like every sweep',
  { skip }, () => {
    const { eng, advance } = setupApp();
    const labs = makeLabs();
    labs.envelope.enabled = true;
    labs.envelope.adsr = { ...LOW_SUSTAIN };
    wrap(eng, labs);
    const cases = [
      ['ping-pong, continuous', sweep({ direction: 'pingpong', repeat: 'continuous' }), 'whole'],
      ['ping-pong, once', sweep({ direction: 'pingpong', repeat: 'once' }), 'whole'],
      ['up, continuous', sweep({ direction: 'up', repeat: 'continuous' }), 'segment'],
    ];
    for (const [name, p, envelope] of cases) {
      assert.strictEqual(p.envelope, envelope, name);
      eng.play(p, opt());
      const v = eng.voice;
      assert.deepStrictEqual(v.adsr, LOW_SUSTAIN, `${name}: the voice carries the ADSR`);
      const level = valueAt(v.env, v.t0 + 0.5);
      assert.ok(Math.abs(level - 0.1) < 0.005, `${name}: level ${level} at t0 + 0.5 s`);
      eng.stopAll();
      advance(3);
    }
    assert.strictEqual(eng.activeNodeCount, 0);
  });

test('R-1: Envelope off, the continuous ping-pong sweep keeps V1\'s attack and hold at 1',
  { skip }, () => {
    const { eng, advance } = setupApp();
    const labs = makeLabs();
    wrap(eng, labs);
    eng.play(sweep({ direction: 'pingpong', repeat: 'continuous' }), opt());
    const v = eng.voice;
    assert.strictEqual(v.adsr, null);
    assert.ok(Math.abs(valueAt(v.env, v.t0 + 0.5) - 1) < 1e-9);
    assert.ok(valueAt(v.env, v.t0 + 0.005) < 1, 'still attacking at 5 ms (a 10 ms attack)');
    eng.stopAll();
    advance(3);
    assert.strictEqual(eng.activeNodeCount, 0);
  });

test('R-1: the WAV render of a continuous ping-pong sweep holds at the sustain', { skip },
  async () => {
    const audio = makeMockAudio({});
    let ctxMade = null;
    function OfflineAudioContext() {
      const ctx = new audio.AudioContext();
      ctxMade = ctx;
      ctx.startRendering = async () => ({
        numberOfChannels: 2, sampleRate: SR, length: 4, duration: 4 / SR,
        getChannelData: () => new Float32Array(4),
      });
      return ctx;
    }
    const labs = makeLabs();
    labs.envelope.enabled = true;
    labs.envelope.adsr = { ...LOW_SUSTAIN };
    const p = sweep({ direction: 'pingpong', repeat: 'continuous' });
    let offline = null;
    await renderPlanToWav({
      plan: p, gain: 0.5, sampleRate: SR, OfflineAudioContext,
      playOptions: opt({ durationS: 2 }),
      extraOptions: (ctx) => labPlayOptions(p, ctx, labs),
      decorate: (e) => {
        offline = e;
        e.setEnvelope(makeAdsrEnvelope({ applyAdsr: envelopeJs.applyAdsr,
          releaseAt: envelopeJs.releaseAt }));
      },
    });
    assert.ok(ctxMade && offline && offline.voice, 'rendered through an engine voice');
    const v = offline.voice;
    const level = valueAt(v.env, v.t0 + 0.5);
    assert.ok(Math.abs(level - 0.1) < 0.005, `rendered level ${level} at t0 + 0.5 s`);
  });

test('R-2: Envelope edits reach a held voice on the engine', { skip }, () => {
  const { eng, advance } = setupApp();
  const labs = makeLabs();
  labs.envelope.enabled = true;
  labs.envelope.adsr = { a: 0.01, d: 0.1, s: 0.6, r: 0.3 };
  const seen = [];
  labOpts.withLabOptions(eng, (p) => {
    const o = labPlayOptions(p, eng.ctx, labs);
    seen.push(o);
    return o;
  });
  const tone = plan({ pattern: 'tone', frequency: 440 });
  eng.play(tone, opt());
  const v1 = eng.voice;
  advance(1);

  // Release only: the release is read at note-off, so the same voice takes it in place.
  labs.envelope.adsr = { ...labs.envelope.adsr, r: 0.05 };
  assert.strictEqual(labOpts.followEnvelopeLab(eng, labs.envelope), 'live');
  assert.strictEqual(eng.voice, v1, 'no restart for a release change');
  assert.strictEqual(v1.release, 0.05);
  assert.strictEqual(v1.adsr.r, 0.05);
  assert.strictEqual(v1.opts.adsr.r, 0.05, 'a later restart keeps it');
  assert.strictEqual(labOpts.followEnvelopeLab(eng, labs.envelope), 'same');

  // Sustain: the scheduled shape changes, so the voice is replaced click-free (same plan).
  labs.envelope.adsr = { ...labs.envelope.adsr, s: 0.1 };
  assert.strictEqual(labOpts.followEnvelopeLab(eng, labs.envelope), 'restarted');
  const v2 = eng.voice;
  assert.notStrictEqual(v2, v1);
  assert.strictEqual(v2.plan, v1.plan);
  assert.strictEqual(v2.adsr.s, 0.1);
  assert.ok(Math.abs(valueAt(v2.env, v2.t0 + 0.5) - 0.1) < 0.005, 'sounds at the new sustain');
  assert.strictEqual(v2.endTime, Infinity, 'still held');
  advance(1);

  // Off: the held voice loses the ADSR at once, without a pattern change or a new note.
  labs.envelope.enabled = false;
  assert.strictEqual(labOpts.followEnvelopeLab(eng, labs.envelope), 'restarted');
  const v3 = eng.voice;
  assert.notStrictEqual(v3, v2);
  assert.strictEqual(v3.adsr, null);
  assert.strictEqual(v3.opts.stepEnvelope, null);
  assert.strictEqual(v3.release, 0.03, 'the instrument release again');
  assert.ok(Math.abs(valueAt(v3.env, v3.t0 + 0.5) - 1) < 1e-9, 'level 1 with the lab off');
  assert.strictEqual(seen[seen.length - 1].adsr, null, 'the restart went through the wrapper');
  advance(1);

  // On again: the ADSR comes back to the held voice.
  labs.envelope.enabled = true;
  assert.strictEqual(labOpts.followEnvelopeLab(eng, labs.envelope), 'restarted');
  assert.strictEqual(eng.voice.adsr.s, 0.1);
  eng.stopAll();
  advance(3);
  assert.strictEqual(eng.activeNodeCount, 0);
  assert.strictEqual(labOpts.followEnvelopeLab(eng, labs.envelope), false, 'nothing sounds');
});

test('R-2: on the engine alone, setAdsr updates the voice options a restart copies', { skip },
  () => {
    const { eng, advance } = setupApp();
    const adsr = { a: 0.01, d: 0.1, s: 0.6, r: 0.3 };
    eng.play(plan({ pattern: 'tone', frequency: 440 }), opt({ adsr,
      stepEnvelope: adsrStepEnvelope }));
    advance(0.5);
    assert.strictEqual(eng.setAdsr(null, null), 'restarted');
    assert.strictEqual(eng.voice.adsr, null);
    assert.strictEqual(eng.voice.opts.stepEnvelope, null, 'no step hook without an ADSR');
    assert.strictEqual(eng.voice.release, 0.03);
    // a programmed note has its release scheduled: a release change restarts it
    eng.play(plan({ pattern: 'finite', frequency: 440 }), opt({ mode: 'trigger', adsr,
      stepEnvelope: adsrStepEnvelope }));
    const v = eng.voice;
    advance(0.2);
    assert.strictEqual(eng.setAdsr({ ...adsr, r: 0.05 }, adsrStepEnvelope), 'restarted');
    assert.notStrictEqual(eng.voice, v);
    assert.strictEqual(eng.voice.release, 0.05);
    eng.stopAll();
    advance(3);
    assert.strictEqual(eng.setAdsr(adsr, adsrStepEnvelope), false, 'no voice');
    assert.strictEqual(eng.activeNodeCount, 0);
  });

test('R-3: withLabOptions spreads the labs over the caller\'s options, a restart included',
  { skip }, () => {
    const { eng, advance } = setupApp();
    const labs = makeLabs();
    labs.additive.enabled = true;
    labOpts.withLabOptions(eng, (p) => labPlayOptions(p, eng.ctx, labs));
    // a stale wave in the caller's options (what _restart copies) loses to the lab's current one
    eng.play(plan({ pattern: 'tone', frequency: 440 }), opt({ periodicWave: { id: 'stale' } }));
    assert.deepStrictEqual(eng.voice.periodicWave, { id: 'additive' });
    labs.additive.enabled = false;
    assert.strictEqual(eng.updateLive(plan({ pattern: 'finite', frequency: 440 })), 'restarted');
    assert.strictEqual(eng.voice.periodicWave, null, 'the copied wave is overwritten');
    assert.strictEqual(eng.voice.opts.attackS, 0.01, 'the caller\'s own options are kept');
    eng.stopAll();
    advance(3);
    assert.strictEqual(eng.activeNodeCount, 0);
  });

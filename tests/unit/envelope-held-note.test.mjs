// C008: the Envelope Lab's sustain level and power switch reach a held note, and the Signal Path
// draws the envelope that sounds (findings dead-controls-3, control-census-3, vis-divergence-5).
//   - envelope.js retargetSustain against valueAtTime: during sustain, decay and attack, with a
//     release scheduled ahead, never above 1, and the real param calls replay to the recorded
//     schedule;
//   - engine.setEnvelopeSustain on the recording mock AudioContext: the tracked envelope glides
//     to the new sustain (or 1 when off), voice.adsr / voice.opts.adsr follow, an edit during
//     the decay waits for its end, attack/decay edits and voices without the ADSR are next-note;
//   - the Playground voice model and the Signal Path projection: the sounding envelope with a
//     "next note" annotation.
//   node --test tests/unit/envelope-held-note.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import * as envelopeJs from '../../src/js/audio/envelope.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { makeAdsrEnvelope, valueAt } from '../../src/js/audio/voice.js';
import { buildPlan } from '../../src/js/audio/patterns.js';
import { defaultInstrumentState } from '../../src/js/core/config.js';
import * as playgroundVoice from '../../src/js/studio/playground-voice.js';
import { projectSignalPath } from '../../src/js/studio/signal-path-projection.js';

const { playgroundVoiceModel } = playgroundVoice;

const {
  applyAdsr, releaseAt, getSchedule, valueAtTime, ENVELOPE_FLOOR, MIN_SEGMENT_S, retargetSustain,
} = envelopeJs;

const here = path.dirname(fileURLToPath(import.meta.url));
const FREEZE_DIR = path.resolve(process.env.OSCILLA_FREEZE_DIR || path.join(here, '../freeze'));
const hasMock = fs.existsSync(path.join(FREEZE_DIR, 'extract.cjs'));
const skip = hasMock ? false : `mock AudioContext not found in ${FREEZE_DIR}`;
const require = createRequire(import.meta.url);
const { makeMockAudio } = hasMock ? require(path.join(FREEZE_DIR, 'extract.cjs')) : {};

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const KIND = { set: 'set', linear: 'linear', exp: 'exp', setValueAtTime: 'set',
  linearRampToValueAtTime: 'linear', exponentialRampToValueAtTime: 'exp' };

/**
 * The timeline a real AudioParam holds after `calls` ([kind, value, time] or ['cancel', t]):
 * events inserted in time order (after equal times), cancelScheduledValues(t) removing every
 * event at or after t. Evaluated with valueAtTime, it is what would sound.
 */
function replay(calls) {
  const ev = [];
  for (const c of calls) {
    if (c[0] === 'cancel') {
      const t = c.length === 2 ? c[1] : c[2];
      for (let i = ev.length - 1; i >= 0; i--) if (ev[i].time >= t) ev.splice(i, 1);
      continue;
    }
    const e = { kind: KIND[c[0]], value: c[1], time: c[2] };
    let i = ev.length;
    while (i > 0 && ev[i - 1].time > e.time) i--;
    ev.splice(i, 0, e);
  }
  return ev;
}

function mockParam({ cancel = true } = {}) {
  const calls = [];
  const p = {
    calls,
    setValueAtTime: (v, t) => calls.push(['set', v, t]),
    linearRampToValueAtTime: (v, t) => calls.push(['linear', v, t]),
    exponentialRampToValueAtTime: (v, t) => calls.push(['exp', v, t]),
  };
  if (cancel) p.cancelScheduledValues = (t) => calls.push(['cancel', t]);
  return p;
}

/** Samples of a timeline on [from, to]. */
function samples(ev, from, to, n = 400) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(valueAtTime(ev, from + ((to - from) * i) / n));
  return out;
}

/** The largest step between neighbouring samples 1 ms apart: a click is a jump, a glide is not. */
function maxStep(ev, from, to) {
  const n = Math.round((to - from) / 0.0001);
  const v = samples(ev, from, to, n);
  let m = 0;
  for (let i = 1; i < v.length; i++) m = Math.max(m, Math.abs(v[i] - v[i - 1]));
  return m;
}

const ADSR = { a: 0.01, d: 0.1, s: 0.6, r: 0.3 };

test('retargetSustain exists (C008)', () => {
  assert.equal(typeof retargetSustain, 'function', 'envelope.js exports retargetSustain');
  assert.equal(typeof envelopeJs.sustainSteadyFrom, 'function');
  assert.ok(envelopeJs.SUSTAIN_GLIDE_S >= MIN_SEGMENT_S);
});

test('retargetSustain in sustain: a glide of at least SUSTAIN_GLIDE_S to the new level',
  () => {
  const p = mockParam();
  applyAdsr(p, 0, ADSR, 1);
  const t = 0.5;
  const r = retargetSustain(p, t, 0.1);
  assert.ok(r, 'retargeted');
  close(r.value, 0.6);
  close(r.target, 0.1);
  assert.ok(r.end - t >= envelopeJs.SUSTAIN_GLIDE_S - 1e-12, `glide ${r.end - t}`);
  const ev = getSchedule(p);
  close(valueAtTime(ev, t), 0.6);
  close(valueAtTime(ev, r.end), 0.1);
  close(valueAtTime(ev, 5), 0.1);
  const mid = valueAtTime(ev, t + (r.end - t) / 2);
  assert.ok(mid < 0.6 && mid > 0.1, `mid-glide ${mid}`);
  // What the param was told is what the module recorded.
  assert.deepEqual(replay(p.calls), ev);
  assert.ok(maxStep(ev, t - 0.01, r.end + 0.01) < 0.01, 'no step at the change');
  // Back up, and off (s = 1): never above 1.
  const up = retargetSustain(p, 1, 2);
  close(up.target, 1);
  const ev2 = getSchedule(p);
  assert.ok(samples(ev2, 0, 3).every((v) => v <= 1 + 1e-12), 'never above 1');
  close(valueAtTime(ev2, 2), 1);
  assert.deepEqual(replay(p.calls), ev2);
});

test('retargetSustain in the decay: the decay ends on the new level, from the value at t', () => {
  const p = mockParam();
  applyAdsr(p, 0, ADSR, 1); // attack 0 .. 0.01, decay to 0.6 at 0.11
  const t = 0.05;
  const before = valueAtTime(getSchedule(p), t);
  const r = retargetSustain(p, t, 0.1);
  const ev = getSchedule(p);
  close(r.value, before);
  close(valueAtTime(ev, t), before);
  assert.ok(r.end >= 0.11 - 1e-12 && r.end - t >= MIN_SEGMENT_S, `ends ${r.end}`);
  close(valueAtTime(ev, r.end), 0.1);
  close(valueAtTime(ev, 1), 0.1);
  assert.ok(samples(ev, 0, 1).every((v) => v <= 1 + 1e-12));
  assert.deepEqual(replay(p.calls), ev, 'the old decay end is cancelled, the curve re-ended at t');
  assert.ok(maxStep(ev, t - 0.005, t + 0.005) < 0.02, 'continuous at t');
});

test('retargetSustain in the attack: the attack runs to its peak, the decay ends on the new level',
  () => {
  const p = mockParam();
  applyAdsr(p, 0, { a: 0.1, d: 0.2, s: 0.6, r: 0.3 }, 1);
  const r = retargetSustain(p, 0.04, 0.2);
  const ev = getSchedule(p);
  close(valueAtTime(ev, 0.1), 1);
  close(valueAtTime(ev, 0.04), 0.04 / 0.1 * (1 - ENVELOPE_FLOOR) + ENVELOPE_FLOOR, 1e-9);
  close(r.end, 0.3);
  close(valueAtTime(ev, 0.3), 0.2);
  assert.deepEqual(replay(p.calls), ev);
});

test('retargetSustain keeps a release scheduled ahead, starting from the new level', () => {
  const p = mockParam();
  applyAdsr(p, 0, ADSR, 1);
  const { endTime } = releaseAt(p, 1.7, 0.3); // a finite note: hold at 1.7, floor at 2.0
  const r = retargetSustain(p, 0.5, 0.1, { releaseEnd: endTime });
  assert.ok(r);
  const ev = getSchedule(p);
  close(valueAtTime(ev, 1), 0.1);
  close(valueAtTime(ev, 1.7), 0.1);
  close(valueAtTime(ev, 2), ENVELOPE_FLOOR);
  assert.equal(ev[ev.length - 1].time, endTime, 'the note still ends when it did');
  assert.deepEqual(replay(p.calls), ev, 'the old release is cancelled and rescheduled');
  assert.ok(maxStep(ev, 1.69, 1.71) < 0.01, 'the release starts without a step');
  // A release that has begun is left alone; an unknown end is refused.
  const n = p.calls.length;
  assert.equal(retargetSustain(p, 1.8, 0.5, { releaseEnd: endTime }), null);
  assert.equal(retargetSustain(p, 1.0, 0.5, { releaseEnd: endTime + 1 }), null);
  assert.equal(p.calls.length, n, 'nothing scheduled');
});

test('retargetSustain without a cancel never leaves the old future scheduled', () => {
  const p = mockParam({ cancel: false });
  applyAdsr(p, 0, ADSR, 1);
  const n = p.calls.length;
  // In the decay there is an event to remove: refused.
  assert.equal(retargetSustain(p, 0.05, 0.1), null);
  assert.equal(p.calls.length, n);
  // A caller's cancel is used instead.
  const cancelled = [];
  const cancel = (t) => { cancelled.push(t); p.calls.push(['cancel', t]); };
  const r = retargetSustain(p, 0.05, 0.1, { cancel });
  assert.ok(r);
  assert.equal(cancelled.length, 1);
  assert.deepEqual(replay(p.calls), getSchedule(p));
  // In the sustain with nothing ahead, no cancel is needed.
  assert.ok(retargetSustain(p, 1, 0.3));
  assert.deepEqual(replay(p.calls), getSchedule(p));
});

// ---------------------------------------------------------------- the engine

const SR = 48000;
const ENV_S = { safeMax: (SR / 2) * 0.95, continuous: true };
function plan(cfg) {
  const st = defaultInstrumentState();
  const r = buildPlan({ ...st, ...cfg, pp: { ...st.pp, ...(cfg.pp || {}) } }, ENV_S);
  if (!r.ok) throw new Error(r.error);
  return r.plan;
}
const opt = (o = {}) => ({
  mode: 'hold', continuous: true, limitS: 2, durationS: 0.5, attackS: 0.01, releaseS: 0.03, ...o,
});
function setup() {
  const audio = makeMockAudio({ cancelAndHold: false });
  const timers = new Map();
  let seq = 0;
  const env = {
    AudioContext: audio.AudioContext,
    setTimeout: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; },
    clearTimeout: (id) => { timers.delete(id); },
  };
  const eng = new AudioEngine({ env });
  eng.setEnvelope(makeAdsrEnvelope(envelopeJs));
  const events = [];
  eng.on((type, d) => events.push([type, d]));
  const flush = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
  return { eng, timers, flush, events, advance: (t) => eng.ctx.advance(t) };
}
/** The envelope gain's real timeline (mock events replayed). */
const realEnv = (v) => replay(v.nodes[0].gain.events);

test('engine.setEnvelopeSustain: a held ADSR note glides to the new sustain, then to 1 when off',
  { skip }, () => {
  const { eng, advance, events } = setup();
  eng.play(plan({ pattern: 'tone' }), opt({ adsr: { ...ADSR } }));
  const v = eng.voice;
  advance(0.5); // past attack + decay (t0 0.02 .. 0.13)
  assert.equal(typeof eng.setEnvelopeSustain, 'function');
  assert.equal(eng.setEnvelopeSustain({ ...ADSR, s: 0.1, a: 0.5 }), 'applied');
  close(v.adsr.s, 0.1);
  assert.equal(v.adsr.a, ADSR.a, 'attack stays the note\'s');
  assert.equal(v.opts.adsr, v.adsr, 'restarts and top-ups take the new sustain');
  assert.ok(events.some(([type, d]) => type === 'envelope' && d.id === v.id));
  const t = v.env.ev[v.env.ev.length - 2].time;
  assert.ok(t >= 0.5, 'scheduled ahead of the clock');
  close(valueAt(v.env, t), 0.6, 1e-9);
  close(valueAt(v.env, t + envelopeJs.SUSTAIN_GLIDE_S), 0.1, 1e-9);
  // The recorded log is the param's real schedule.
  const real = realEnv(v);
  for (const x of [0.2, t, t + 0.01, t + 0.02, 3]) {
    close(valueAtTime(real, x, 1), valueAt(v.env, x), 1e-9);
  }
  assert.equal(eng.setEnvelopeSustain({ ...ADSR, s: 0.1 }), 'same');
  advance(1);
  assert.equal(eng.setEnvelopeSustain(null), 'applied');
  assert.equal(v.adsr, null);
  assert.equal(v.opts.adsr, null);
  const t2 = v.env.ev[v.env.ev.length - 2].time;
  close(valueAt(v.env, t2 + envelopeJs.SUSTAIN_GLIDE_S), 1, 1e-9);
  const real2 = realEnv(v);
  assert.ok(samples(real2, 0, 5, 2000).every((x) => x <= 1 + 1e-12), 'never above 1');
  // Switched off, the note has no ADSR: switching it on again is for the next note.
  assert.equal(eng.setEnvelopeSustain({ ...ADSR }), 'next-note');
  eng.stopAll();
  advance(3);
  assert.equal(eng.activeNodeCount, 0);
});

test('engine.setEnvelopeSustain during the decay waits for its end; the latest edit wins',
  { skip }, () => {
  const { eng, advance, flush } = setup();
  eng.play(plan({ pattern: 'tone' }), opt({ adsr: { a: 0.01, d: 0.3, s: 0.6, r: 0.3 } }));
  const v = eng.voice;
  advance(0.1); // in the decay (ends at 0.33)
  const n = v.env.ev.length;
  assert.equal(eng.setEnvelopeSustain({ a: 0.01, d: 0.3, s: 0.3, r: 0.3 }), 'deferred');
  assert.equal(eng.setEnvelopeSustain({ a: 0.01, d: 0.3, s: 0.2, r: 0.3 }), 'deferred');
  assert.equal(v.env.ev.length, n, 'the sounding decay is not edited');
  close(v.adsr.s, 0.6);
  advance(0.4);
  flush();
  close(v.adsr.s, 0.2);
  close(valueAt(v.env, 5), 0.2, 1e-9);
  eng.stopAll();
  advance(3);
  assert.equal(eng.activeNodeCount, 0);
});

test('engine.setEnvelopeSustain keeps a finite note\'s release (safety limit)', { skip }, () => {
  const { eng, advance } = setup();
  eng.play(plan({ pattern: 'tone' }), opt({ continuous: false, limitS: 2, adsr: { ...ADSR } }));
  const v = eng.voice;
  const end = v.deadline;
  assert.ok(Number.isFinite(end));
  advance(0.5);
  assert.equal(eng.setEnvelopeSustain({ ...ADSR, s: 0.1 }), 'applied');
  const real = realEnv(v);
  close(valueAtTime(real, 1, 1), 0.1, 1e-9);
  close(valueAtTime(real, end, 1), ENVELOPE_FLOOR, 1e-12);
  assert.equal(v.deadline, end, 'the note ends when it did');
  advance(3);
  assert.equal(eng.activeNodeCount, 0);
});

test('engine.setEnvelopeSustain: voices without the ADSR and programmed patterns are next-note',
  { skip }, () => {
  const { eng, advance } = setup();
  assert.equal(eng.setEnvelopeSustain({ ...ADSR }), false, 'nothing sounding');
  eng.play(plan({ pattern: 'tone' }), opt());
  advance(0.5);
  const v = eng.voice;
  const before = JSON.stringify(v.env.ev);
  assert.equal(eng.setEnvelopeSustain({ ...ADSR, s: 0.1 }), 'next-note');
  assert.equal(JSON.stringify(v.env.ev), before);
  assert.equal(v.adsr, null);
  eng.stopAll();
  advance(2);
  // A programmed pattern with the ADSR handed to its step envelope: scheduled ahead.
  eng.play(plan({ pattern: 'pulse' }), opt({ adsr: { ...ADSR } }));
  advance(2.5);
  const w = eng.voice;
  assert.ok(w && !w.ended && w.plan.type === 'steps', 'a programmed voice sounds');
  const b2 = JSON.stringify(w.env.ev);
  assert.equal(eng.setEnvelopeSustain({ ...ADSR, s: 0.1 }), 'next-note');
  assert.equal(JSON.stringify(w.env.ev), b2);
  close(w.adsr.s, 0.6);
  eng.stopAll();
  advance(6);
  assert.equal(eng.activeNodeCount, 0);
});

// ---------------------------------------------------------------- the Signal Path

const VOICE = { plan: { type: 'const', kind: 'open', freqs: [440] }, waveform: 'sine',
  frequency: 440, gain: 0.08, attackMs: 10, releaseMs: 30 };
const envStage = (m) => projectSignalPath(m.model, { annotations: m.annotations }).stages
  .find((s) => /ENVELOPE/.test(s.title));

test('Signal Path: the sounding envelope, and a different next-note setting annotated', () => {
  // Sounding without the ADSR, the Envelope Lab switched on meanwhile (vis-divergence-5).
  let m = playgroundVoiceModel({ ...VOICE, attackMs: 50, lab: { adsr: null,
    envelope: { attack: 0.01, release: 0.03 }, nextNote: { adsr: { ...ADSR } } } });
  let st = envStage(m);
  assert.equal(st.title, 'ENVELOPE');
  assert.equal(st.sub, 'A 10 ms · R 30 ms · next note: A 10 ms · D 100 ms · S 0.6 · R 300 ms');
  // Sounding with the ADSR, the attack edited: the stage is the note's.
  m = playgroundVoiceModel({ ...VOICE, lab: { adsr: { ...ADSR, s: 0.1 }, envelope: null,
    nextNote: { adsr: { ...ADSR, a: 0.05, s: 0.1 } } } });
  st = envStage(m);
  assert.equal(st.title, 'ADSR ENVELOPE');
  assert.equal(st.sub, 'A 10 ms · D 100 ms · S 0.1 · R 300 ms'
    + ' · next note: A 50 ms · D 100 ms · S 0.1 · R 300 ms');
  // Next note without the envelope.
  m = playgroundVoiceModel({ ...VOICE, lab: { adsr: { ...ADSR }, envelope: null,
    nextNote: { adsr: null, attack: 0.01, release: 0.03 } } });
  assert.match(envStage(m).sub, / · next note: A 10 ms · R 30 ms$/);
  // Nothing pending: no annotation, the stage as before C008.
  m = playgroundVoiceModel({ ...VOICE,
    lab: { adsr: { ...ADSR }, envelope: null, nextNote: null } });
  assert.equal(envStage(m).sub, 'A 10 ms · D 100 ms · S 0.6 · R 300 ms');
  assert.deepEqual(m.annotations, {});
});

test('soundingEnvelope: the sounding voice\'s envelope, the lab\'s for the next note', () => {
  const { soundingEnvelope } = playgroundVoice;
  assert.equal(typeof soundingEnvelope, 'function');
  // Idle: the lab's, nothing pending.
  assert.deepEqual(soundingEnvelope({ voice: null, labAdsr: ADSR, attackS: 0.01, releaseS: 0.03 }),
    { adsr: ADSR, envelope: null, nextNote: null });
  // Sounding without the ADSR, lab switched on: the voice's times, the ADSR pending.
  const plain = { adsr: null, attack: 0.01, release: 0.03 };
  assert.deepEqual(soundingEnvelope({ voice: plain, labAdsr: ADSR, attackS: 0.01, releaseS: 0.03 }),
    { adsr: null, envelope: { attack: 0.01, release: 0.03 }, nextNote: { adsr: ADSR } });
  // ... and the same V1 envelope next: nothing pending.
  assert.equal(soundingEnvelope({ voice: plain, labAdsr: null, attackS: 0.01, releaseS: 0.03 })
    .nextNote, null);
  // Sounding with the ADSR, the attack edited: the voice's ADSR drawn, the edit pending.
  const voice = { adsr: { ...ADSR }, attack: 0.01, release: 0.3 };
  const out = soundingEnvelope({ voice, labAdsr: { ...ADSR, a: 0.05 } });
  assert.deepEqual(out.adsr, ADSR);
  assert.deepEqual(out.nextNote, { adsr: { ...ADSR, a: 0.05 } });
  // A switched-off voice (adsr null, its release kept) against the lab off.
  assert.deepEqual(soundingEnvelope({ voice: { adsr: null, attack: 0.01, release: 0.3 },
    labAdsr: null, attackS: 0.01, releaseS: 0.03 }).nextNote,
  { adsr: null, attack: 0.01, release: 0.03 });
  // Plain copies: the voice's object never enters the bridge state.
  assert.notEqual(out.adsr, voice.adsr);
});

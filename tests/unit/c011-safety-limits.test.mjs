// C011: safety limits reach what sounds (findings dead-controls-4 and coupling-4).
//   - engine.tightenLimit(limitS): a lower hard limit shortens the voices it governs to
//     t0 + limit (the release inside it, as for a fresh note) on the audio clock, on the
//     output-stage gain, and never lengthens anything;
//   - instrument.setSafetyLimit reaches the engine when the limit drops (continuous off);
//   - the sequencer's loop stops at LOOP_CAP_S (30 s, ADR 0005) without the continuous
//     permission, with a stated reason, and the model's loop flag is never rewritten.
// Fake clocks only: the recording mock AudioContext of the freeze harness for the engine, the
// sequencer's FakeContext with manual timers for the editor. No real time passes.
//   node --test tests/unit/c011-safety-limits.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { AudioEngine, FAST_RELEASE_S } from '../../src/js/audio/audio-engine.js';
import { buildPlan } from '../../src/js/audio/patterns.js';
import { defaultInstrumentState } from '../../src/js/core/config.js';
import { createInstrument } from '../../src/js/core/instrument.js';
import * as editorModule from '../../src/js/sequencer/editor.js';
import { serializeSequence } from '../../src/js/sequencer/model.js';
import { FakeContext, fakeTimers } from './sequencer-fake-audio.mjs';

const { createSequencerEditor } = editorModule;
// The cap is ADR 0005's MAX_PROGRAMMED_S; the test states it rather than reading the constant
// under test (a broken constant must not loosen its own check).
const CAP_S = 30;
const REASON = /Loop capped at 30 s: allow continuous playback/;

const here = path.dirname(fileURLToPath(import.meta.url));
const FREEZE_DIR = path.resolve(process.env.OSCILLA_FREEZE_DIR || path.join(here, '../freeze'));
const hasMock = fs.existsSync(path.join(FREEZE_DIR, 'extract.cjs'));
const skip = hasMock ? false : `mock AudioContext not found in ${FREEZE_DIR}`;
const require = createRequire(import.meta.url);
const { makeMockAudio } = hasMock ? require(path.join(FREEZE_DIR, 'extract.cjs')) : {};

const SR = 48000;

function plan(cfg, continuous = false) {
  const st = defaultInstrumentState();
  const r = buildPlan({ ...st, ...cfg }, { safeMax: (SR / 2) * 0.95, continuous });
  if (!r.ok) throw new Error(r.error);
  return r.plan;
}

const opt = (o = {}) => ({
  mode: 'trigger', continuous: false, limitS: 5, durationS: 5, attackS: 0.01, releaseS: 0.03,
  ...o,
});

function engineSetup() {
  const audio = makeMockAudio({});
  const timers = new Map();
  let seq = 0;
  const env = {
    AudioContext: audio.AudioContext,
    setTimeout: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; },
    clearTimeout: (id) => { timers.delete(id); },
  };
  const eng = new AudioEngine({ env });
  return { eng, timers, advance: (t) => eng.ctx.advance(t) };
}

const lastStop = (v) => Math.max(...v.sources.map((s) => s.stops[s.stops.length - 1]));
const events = (pt) => JSON.stringify(pt.param.events);

// ---------------------------------------------------------------- engine.tightenLimit

test('C011 tightenLimit: a 5 s trigger lowered to 0.5 s ends at t0 + 0.5 s, its release inside '
  + 'the limit, on the output stage; a higher limit does not extend it', { skip }, () => {
  const { eng, advance } = engineSetup();
  eng.play(plan({ source: 'single', pattern: 'tone' }), opt());
  const v = eng.voice;
  assert.ok(v.endTime > v.t0 + 4.9, 'started under the 5 s limit');
  const envBefore = events(v.env);
  advance(v.t0 + 0.1);
  assert.equal(eng.tightenLimit(0.5), 1, 'one voice shortened');
  const rel = v.release;
  const end = v.t0 + 0.5;
  const q = 128 / eng.ctx.sampleRate;
  const stop = lastStop(v);
  assert.ok(stop <= end + 0.01 + 1e-9 && stop > end + 0.01 - q, `sources stop at ${stop - v.t0}`);
  assert.equal(v.endTime, stop);
  assert.equal(events(v.env), envBefore, 'the sounding envelope is not edited (V249)');
  assert.deepEqual(v.fade.param.events.map((e) => e[0]), ['set', 'linear']);
  const at = v.fade.param.events[0][2];
  assert.ok(at <= end - rel + 1e-9 && at > end - rel - q, 'release starts at t0 + limit - release');
  assert.ok(Math.abs(v.fade.param.events[1][2] - (at + rel)) < 1e-9, 'and ends inside the limit');
  assert.equal(v.opts.limitS, 0.5, 'a restart inherits the lower cap');
  assert.ok(v.deadline <= end + 1e-9);
  assert.equal(eng.tightenLimit(2), 0, 'a higher limit changes nothing that sounds');
  assert.equal(lastStop(v), stop, 'never extended');
  advance(end + 0.02);
  assert.equal(eng.activeNodeCount, 0);
  assert.equal(eng.voices.size, 0);
});

test('C011 tightenLimit: a hold, a twice-lowered limit and a stop during the pending release',
  { skip }, () => {
    const { eng, advance } = engineSetup();
    eng.play(plan({ source: 'single', pattern: 'tone' }), opt({ mode: 'hold' }));
    const v = eng.voice;
    advance(v.t0 + 0.05);
    assert.equal(eng.tightenLimit(2), 1);
    assert.equal(eng.tightenLimit(1), 1, 'the pending 2 s release is replaced by the 1 s one');
    assert.deepEqual(v.fade.param.events.map((e) => e[0]), ['set', 'linear', 'cancel', 'set',
      'linear']);
    const q = 128 / eng.ctx.sampleRate;
    assert.ok(lastStop(v) <= v.t0 + 1.01 + 1e-9 && lastStop(v) > v.t0 + 1.01 - q);
    // A stop before the limit's release begins takes `fade` (still exactly 1) as on any voice,
    // so Escape keeps its fast `cut` stage.
    advance(v.t0 + 0.3);
    assert.equal(eng.release(), true);
    assert.equal(v.cut.param.events.length, 0, 'cut kept for Escape');
    eng.stopAll();
    assert.ok(v.cut.param.events.length > 0, 'Escape still fades');
    advance(v.t0 + 2);
    assert.equal(eng.activeNodeCount, 0);
  });

test('C011 tightenLimit: a new end already due fades now; programmed patterns and extended '
  + 'voices are not governed; the finite tone is', { skip }, () => {
  const { eng, advance } = engineSetup();
  eng.play(plan({ source: 'single', pattern: 'tone' }), opt({ mode: 'hold' }));
  let v = eng.voice;
  advance(v.t0 + 1.2);
  assert.equal(eng.tightenLimit(0.5), 1, 'past t0 + 0.5 s: released now');
  assert.ok(lastStop(v) <= eng.ctx.currentTime + 0.05 + FAST_RELEASE_S + 0.011);
  advance(v.t0 + 2);
  // A programmed pattern keeps its own end (ADR 0005).
  eng.play(plan({ source: 'single', pattern: 'pulse' }), opt());
  v = eng.voice;
  const programmedEnd = v.endTime;
  advance(v.t0 + 0.05);
  assert.equal(eng.tightenLimit(0.5), 0);
  assert.equal(v.endTime, programmedEnd);
  eng.stopAll();
  advance(eng.ctx.currentTime + 1);
  // A voice the continuous permission lengthened is revokeContinuous's, not the limit's.
  eng.play(plan({ source: 'single', pattern: 'tone' }, true), opt({ mode: 'latch', continuous: true }));
  v = eng.voice;
  assert.equal(v.extended, true);
  advance(v.t0 + 0.05);
  assert.equal(eng.tightenLimit(0.5), 0);
  assert.equal(v.endTime, Infinity);
  eng.stopAll();
  advance(eng.ctx.currentTime + 1);
  // The finite tone (limitable) is capped like the open patterns.
  const finite = plan({ source: 'single', pattern: 'finite', duration: 4000 });
  assert.equal(finite.limitable, true);
  eng.play(finite, opt());
  v = eng.voice;
  advance(v.t0 + 0.05);
  assert.equal(eng.tightenLimit(1), 1);
  const q = 128 / eng.ctx.sampleRate;
  assert.ok(lastStop(v) <= v.t0 + 1.01 + 1e-9 && lastStop(v) > v.t0 + 1.01 - q);
  advance(v.t0 + 2);
  assert.equal(eng.activeNodeCount, 0);
});

// ---------------------------------------------------------------- instrument.setSafetyLimit

test('C011 setSafetyLimit: a lower limit reaches the engine while continuous playback is off',
  () => {
    const calls = [];
    const engine = { tightenLimit: (s) => { calls.push(s); return 1; }, on: () => () => {} };
    const timers = {
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    };
    const app = createInstrument({ engine, env: { document: {} }, timers });
    assert.equal(app.setSafetyLimit('5'), true);
    assert.deepEqual(calls, [], 'raising the limit never touches what sounds');
    assert.equal(app.setSafetyLimit('0.5'), true);
    assert.equal(app.safetyLimit, 0.5);
    assert.deepEqual(calls, [0.5]);
    assert.equal(app.setSafetyLimit('7'), false, 'not an option');
    assert.equal(app.safetyLimit, 0.5);
    app.setSafetyLimit('5');
    app.continuousAllowed = true;
    app.setSafetyLimit('1');
    assert.deepEqual(calls, [0.5], 'no limit applies while continuous playback is allowed');
  });

// ---------------------------------------------------------------- sequencer loop cap

function seqSetup(allowed) {
  const ctx = new FakeContext({ sampleRate: 48000, currentTime: 5 });
  const timers = fakeTimers();
  const perm = { allowed };
  const log = [];
  const engine = {
    getContext: () => ctx,
    getDestination: () => ctx.destination,
    onEnded: (i) => log.push(['ended', i]),
    continuousAllowed: () => perm.allowed,
  };
  const ed = createSequencerEditor({ engine, timers });
  const t0Ctx = ctx.currentTime;
  // One virtual clock: the timers' milliseconds follow the audio clock.
  const run = (until) => {
    let maxEnd = -Infinity;
    while (ctx.currentTime < until - 1e-12) {
      const t = Math.min(until, ctx.currentTime + 0.05);
      ctx.advance(t);
      timers.runUntil((t - t0Ctx) * 1000);
      const s = ed.loopSchedule ? ed.loopSchedule() : null;
      const ends = ctx.oscillators.map((o) => o.stopAt).filter((x) => x !== null);
      if (ends.length) maxEnd = Math.max(maxEnd, ...ends);
      if (s && s.lastScheduledEnd !== null) maxEnd = Math.max(maxEnd, s.lastScheduledEnd);
    }
    return maxEnd;
  };
  return { ctx, timers, perm, log, ed, run };
}

test('C011 loop cap: without the permission the loop schedules no pass ending past 30 s and '
  + 'stops with the reason; the loop flag is kept', () => {
  const { ctx, timers, ed, log, run } = seqSetup(false);
  ed.setLoop(true);
  assert.equal(ed.play(), true);
  const t0 = ed.currentPassTiming().t0;
  const passS = ed.totalDurationS;
  const maxEnd = run(t0 + CAP_S + 5);
  const fits = Math.floor(CAP_S / passS);
  assert.ok(maxEnd <= t0 + fits * passS + 0.1, `last scheduled end ${maxEnd - t0} s after t0`);
  assert.ok(maxEnd <= t0 + CAP_S + 0.1, 'nothing scheduled past the cap (plus the stop pad)');
  assert.equal(ed.playing, false, 'the loop ended at its last pass that fits');
  assert.match(ed.loopNotice, REASON);
  assert.equal(ed.model.loop, true, 'the model is not rewritten');
  assert.deepEqual(ed.stats(), { voices: 0, activeSourceCount: 0, activeNodeCount: 0 });
  assert.equal(ctx.liveSources, 0);
  assert.equal(timers.size, 0);
  assert.deepEqual(log.at(-1), ['ended', { stopped: false }], 'a natural, click-free end');
  // Play again: the notice clears and the cap counts from the new start.
  assert.equal(ed.play(), true);
  assert.equal(ed.loopNotice, '');
  ed.stop();
  run(ctx.currentTime + 0.2);
});

test('C011 loop cap: with the permission the loop continues past 30 s', () => {
  const { ed, run } = seqSetup(true);
  ed.setLoop(true);
  ed.play();
  const t0 = ed.currentPassTiming().t0;
  const maxEnd = run(t0 + CAP_S + 5);
  assert.equal(ed.playing, true);
  assert.ok(maxEnd > t0 + CAP_S + 2, 'scheduled beyond the cap');
  assert.equal(ed.loopNotice, '');
  ed.stop();
  run(t0 + CAP_S + 6);
  assert.deepEqual(ed.stats(), { voices: 0, activeSourceCount: 0, activeNodeCount: 0 });
});

test('C011 loop cap: an imported loop:true sequence is capped the same way and round-trips',
  () => {
    const { ed, run } = seqSetup(false);
    const json = { ...serializeSequence(ed.model), loop: true };
    const issues = ed.load(json);
    assert.deepEqual(issues, []);
    assert.equal(ed.model.loop, true);
    ed.play();
    const t0 = ed.currentPassTiming().t0;
    const maxEnd = run(t0 + CAP_S + 5);
    assert.ok(maxEnd <= t0 + CAP_S + 0.1);
    assert.equal(ed.playing, false);
    assert.match(ed.loopNotice, REASON);
    assert.equal(serializeSequence(ed.model).loop, true, 'exported unchanged');
  });

test('C011 loop cap: withdrawing the permission stops a loop already past the cap', () => {
  const { ctx, ed, perm, run } = seqSetup(true);
  ed.setLoop(true);
  ed.play();
  const t0 = ed.currentPassTiming().t0;
  run(t0 + CAP_S + 3);
  assert.equal(ed.playing, true);
  perm.allowed = false;
  assert.equal(ed.followPermission(), true);
  assert.equal(ed.playing, false);
  assert.match(ed.loopNotice, REASON);
  run(ctx.currentTime + 0.2);
  assert.deepEqual(ed.stats(), { voices: 0, activeSourceCount: 0, activeNodeCount: 0 });
  assert.equal(ctx.liveSources, 0);
});

test('C011 loop cap: withdrawn before the cap, the loop goes on up to it', () => {
  const { ed, perm, run } = seqSetup(true);
  ed.setLoop(true);
  ed.play();
  const t0 = ed.currentPassTiming().t0;
  run(t0 + 10);
  perm.allowed = false;
  assert.equal(ed.followPermission(), false, 'nothing scheduled past the cap yet');
  assert.equal(ed.playing, true);
  const sched = ed.loopSchedule();
  assert.equal(sched.capped, true);
  assert.ok(sched.endsAt <= t0 + CAP_S + 1e-6 && sched.endsAt + ed.totalDurationS > t0 + CAP_S,
    `the loop's last pass that fits ends at ${sched.endsAt - t0} s`);
  const maxEnd = run(t0 + CAP_S + 5);
  assert.ok(maxEnd <= t0 + CAP_S + 0.1);
  assert.equal(ed.playing, false);
});

// ---------------------------------------------------------------- review of #303 (R-1 to R-9)

const RQ = 128; // frames per render quantum (constants.js RENDER_QUANTUM), stated, not imported
const onQuantum = (t, sr) => Math.abs(t * sr / RQ - Math.round(t * sr / RQ)) < 1e-6;

/** Where a fresh voice under limit L ends, relative to its start (voice.js envelopes). */
function freshEnd(releaseS, limitS) {
  const { eng, advance } = engineSetup();
  eng.play(plan({ source: 'single', pattern: 'tone' }), opt({ releaseS, limitS }));
  const v = eng.voice;
  const end = lastStop(v) - v.t0;
  advance(v.t0 + 10);
  return end;
}

test('C011 R-1: a lowered limit ends the sounding note where a fresh note at that limit ends, '
  + 'its release inside the limit, also when the release is longer than the drop', { skip },
() => {
  for (const [rel, lim] of [[0.03, 0.5], [0.3, 0.5], [3, 0.5], [3, 2], [3, 3]]) {
    const fresh = freshEnd(rel, lim);
    const { eng, advance } = engineSetup();
    eng.play(plan({ source: 'single', pattern: 'tone' }), opt({ releaseS: rel }));
    const v = eng.voice;
    const sr = eng.ctx.sampleRate;
    const q = RQ / sr;
    const envBefore = events(v.env);
    advance(v.t0 + 0.1);
    const soon = eng.ctx.currentTime;
    const label = `release ${rel} s, 5 -> ${lim} s`;
    assert.equal(eng.tightenLimit(lim), 1, `${label}: shortened`);
    const live = lastStop(v) - v.t0;
    assert.ok(live <= fresh + 1e-9 && live >= fresh - q - 1e-9,
      `${label}: ends ${live.toFixed(4)} s after t0, a fresh voice ${fresh.toFixed(4)} s`);
    assert.ok(v.endTime <= v.t0 + lim + 0.01 + 1e-9, `${label}: endTime inside t0 + limit`);
    assert.ok(v.deadline <= v.t0 + lim + 1e-9, `${label}: a restart inherits t0 + limit`);
    const [set, lin] = v.fade.param.events;
    assert.equal(set[0], 'set');
    assert.equal(lin[0], 'linear');
    assert.ok(set[2] >= soon, `${label}: the fade is not scheduled in the past`);
    assert.ok(lin[2] <= v.t0 + lim + 1e-9, `${label}: the fade ends inside the limit`);
    assert.ok(onQuantum(set[2], sr), `${label}: the fade starts on a render quantum (R-9)`);
    assert.equal(events(v.env), envBefore, `${label}: the envelope is not edited (V249)`);
    advance(v.t0 + lim + 1);
    assert.equal(eng.activeNodeCount, 0, `${label}: nothing left`);
  }
});

test('C011 R-5: a limit lowered below the time already sounded fades from _soon, never in the '
  + 'past (no hard cut)', { skip }, () => {
  for (const rel of [0.03, 3]) {
    const { eng, advance } = engineSetup();
    eng.play(plan({ source: 'single', pattern: 'tone' }), opt({ mode: 'hold', releaseS: rel }));
    const v = eng.voice;
    advance(v.t0 + 1.2);
    const now = eng.ctx.currentTime;
    const soon = eng._soon(eng.ctx);
    assert.equal(eng.tightenLimit(0.5), 1, `release ${rel} s: released now`);
    const [set, lin] = v.fade.param.events;
    assert.equal(set[0], 'set');
    assert.ok(set[2] >= soon - 1e-9, `release ${rel} s: fade starts at ${set[2] - now} s from now`);
    assert.ok(lin[2] > set[2], 'a ramp, not a step');
    assert.ok(lastStop(v) >= lin[2], 'the sources stop after the fade');
    assert.ok(lastStop(v) <= soon + FAST_RELEASE_S + 0.011, 'and soon');
    advance(v.t0 + 2);
    assert.equal(eng.activeNodeCount, 0);
  }
});

test('C011 R-6 (M11): the shortened voice re-arms its RELEASING notice and cleanup fallback for '
  + 'its new end', { skip }, () => {
  const { eng, timers, advance } = engineSetup();
  eng.play(plan({ source: 'single', pattern: 'tone' }), opt());
  const v = eng.voice;
  advance(v.t0 + 0.1);
  assert.equal(eng.tightenLimit(0.5), 1);
  const ms = [...timers.values()].map((x) => x.ms);
  const left = (v.endTime - eng.ctx.currentTime) * 1000;
  assert.ok(ms.length >= 2, `notice and fallback armed (${ms.length} timer(s))`);
  assert.ok(Math.max(...ms) <= left + 300, `every timer keyed on the new end (${ms})`);
  advance(v.t0 + 1);
});

test('C011 R-7: a voice replaced by a live restart is limited from the note\'s start, not the '
  + 'restart', { skip }, () => {
  const { eng, advance } = engineSetup();
  eng.play(plan({ source: 'single', pattern: 'tone' }), opt({ mode: 'hold' }));
  const noteT0 = eng.voice.t0;
  advance(noteT0 + 3);
  assert.equal(eng._restart(eng.voice, plan({ source: 'single', pattern: 'tone', waveform: 'square' })),
    'restarted');
  const v = eng.voice;
  assert.ok(v.t0 > noteT0 + 2.9, 'a new voice');
  advance(v.t0 + 0.2);
  const soon = eng._soon(eng.ctx);
  assert.equal(eng.tightenLimit(0.5), 1);
  assert.ok(lastStop(v) <= soon + FAST_RELEASE_S + 0.011,
    `ends now: ${(lastStop(v) - eng.ctx.currentTime).toFixed(3)} s from now`);
  advance(v.t0 + 2);
  assert.equal(eng.activeNodeCount, 0);
});

test('C011 R-7: every change of the continuous permission reaches the sequencer, Reset included',
  () => {
    const seen = [];
    const timers = {
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    };
    const app = createInstrument({ env: { document: {} }, timers,
      onContinuousChange: (allowed) => seen.push(allowed) });
    app.notify = () => {};
    app.setContinuous(true);
    app.setContinuous(false);
    app.continuousAllowed = true;
    app.resetDefaults();
    assert.equal(app.continuousAllowed, false);
    assert.deepEqual(seen, [true, false, false]);
  });

function longLoop(ed, blockMs) {
  const json = {
    ...serializeSequence(ed.model),
    loop: true,
    blocks: blockMs.map((ms, i) => ({ id: `b${i}`, type: 'tone', durationMs: ms,
      params: { freq: 440 + 110 * i } })),
  };
  assert.deepEqual(ed.load(json), []);
}

test('C011 R-2: a looped first pass longer than 30 s is cut at the cap without the permission, '
  + 'and the notice is true', () => {
  const { ctx, ed, log, run } = seqSetup(false);
  longLoop(ed, [30000, 30000]);
  assert.equal(ed.totalDurationS, 60);
  assert.equal(ed.play(), true);
  const t0 = ed.currentPassTiming().t0;
  assert.match(ed.loopNotice, REASON);
  const sched = ed.loopSchedule();
  assert.ok(sched.endsAt <= t0 + CAP_S + 1e-6, `endsAt ${sched.endsAt - t0} s after t0`);
  const maxEnd = run(t0 + 65);
  assert.ok(maxEnd <= t0 + CAP_S + 0.011, `last source stops ${maxEnd - t0} s after t0`);
  assert.equal(ed.playing, false);
  assert.match(ed.loopNotice, REASON);
  assert.equal(ed.model.loop, true);
  assert.equal(ctx.liveSources, 0);
  assert.equal(log.at(-1)[0], 'ended');
});

test('C011 R-2: the permission withdrawn during a long first pass cuts it at the cap, not now',
  () => {
    const { ed, perm, run } = seqSetup(true);
    longLoop(ed, [30000, 30000]);
    ed.play();
    const t0 = ed.currentPassTiming().t0;
    assert.equal(ed.loopNotice, '');
    run(t0 + 10);
    perm.allowed = false;
    assert.equal(ed.followPermission(), true);
    run(t0 + 20);
    assert.equal(ed.playing, true, 'still sounding before the cap');
    const maxEnd = run(t0 + 65);
    assert.ok(maxEnd <= t0 + CAP_S + 0.011, `ends ${maxEnd - t0} s after t0`);
    assert.equal(ed.playing, false);
    assert.match(ed.loopNotice, REASON);
  });

test('C011 R-6 (M17): a queued pass that would end past the cap is dropped when the permission '
  + 'is withdrawn', () => {
  const { ctx, ed, perm, run } = seqSetup(true);
  ed.setLoop(true);
  ed.play();
  const t0 = ed.currentPassTiming().t0;
  const passS = ed.totalDurationS;
  const fits = Math.floor(CAP_S / passS);
  // Just before the last pass that fits ends, the next one (past the cap) is already queued.
  run(t0 + fits * passS - 0.3);
  const queuedPast = ctx.oscillators.filter((o) => o.startAt >= t0 + fits * passS - 1e-6);
  assert.ok(queuedPast.length >= 1, 'the pass past the cap is queued');
  perm.allowed = false;
  assert.equal(ed.followPermission(), true);
  for (const o of queuedPast) {
    assert.ok(o.stopAt <= t0 + fits * passS + 0.05, `a queued source stops at ${o.stopAt - t0}`);
  }
  run(t0 + CAP_S + 5);
  assert.equal(ed.playing, false);
  assert.match(ed.loopNotice, REASON);
  assert.equal(ctx.liveSources, 0);
});

test('C011 R-6 (M20): after play() again the cap counts from the new start', () => {
  const { ctx, ed, run } = seqSetup(false);
  ed.setLoop(true);
  ed.play();
  const t0 = ed.currentPassTiming().t0;
  const passS = ed.totalDurationS;
  const fits = Math.floor(CAP_S / passS);
  run(t0 + CAP_S - passS / 2);
  const t1 = ctx.currentTime; // the second play's first pass starts just after this
  assert.equal(ed.play(), true);
  run(t1 + (fits - 0.5) * passS);
  assert.equal(ed.playing, true, 'the second play is not ended by the first start\'s cap');
  const maxEnd = run(t1 + CAP_S + 5);
  assert.ok(maxEnd > t1 + (fits - 0.5) * passS && maxEnd <= t1 + CAP_S + 0.2,
    `ends ${maxEnd - t1} s after the second play`);
  assert.equal(ed.playing, false);
});

test('C011 R-2: Stop still ends a pass that is cut ahead at the cap, now and click-free', () => {
  const { ctx, ed, run } = seqSetup(false);
  longLoop(ed, [30000, 30000]);
  ed.play();
  const t0 = ed.currentPassTiming().t0;
  run(t0 + 5);
  assert.equal(ed.playing, true);
  const now = ctx.currentTime;
  assert.equal(ed.stop(), true);
  const stops = ctx.oscillators.filter((o) => o.startAt !== null).map((o) => o.stopAt);
  assert.ok(Math.max(...stops) < now + 0.1, `sources stop ${Math.max(...stops) - now} s from now`);
  // The cap's fade is withdrawn while the output gain is still 1, and the stop fades from 1.
  const out = ctx.created.filter((n) => n.kind === 'gain' && n.gain.calls
    .some((c) => c[0] === 'cancelScheduledValues' && c[1] > now && c[1] < now + 0.1));
  assert.equal(out.length, 1, 'one output gain gave up the cap fade');
  const all = out[0].gain.calls;
  const cancel = all.findIndex((c) => c[0] === 'cancelScheduledValues' && c[1] > now);
  assert.ok(all.slice(0, cancel).some((c) => c[0] === 'linearRampToValueAtTime'
    && c[2] > t0 + 29 && c[2] <= t0 + CAP_S), 'the cap fade was scheduled first');
  const calls = all.slice(cancel + 1);
  assert.deepEqual(calls.map((c) => c[0]), ['setValueAtTime', 'linearRampToValueAtTime']);
  assert.equal(calls[0][1], 1);
  run(now + 0.5);
  assert.equal(ed.playing, false);
  assert.equal(ctx.liveSources, 0);
  assert.deepEqual(ed.stats(), { voices: 0, activeSourceCount: 0, activeNodeCount: 0 });
});

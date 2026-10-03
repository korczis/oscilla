// Frequency and envelope automation of the single-oscillator plan types const, steps and ramps,
// the continuous-repeat scheduler, and the engine's timing constants. Extracted from V1
// AudioEngine.play, switch cases 'const' / 'steps' / 'ramps' (index.html@36f4b47), ported to
// index.html@a7b7a23 (limitable finite tone, clamped frequencies, _rampSegments,
// _scheduleCycles, _armTopUp). Each builder runs with the engine as `this` (engine.play calls
// scheduleX.call(this, v, plan, b)) so the case bodies are unchanged except for these tokens:
//   programmedEnd = X; break;      ->  return X;      (null for an open const plan)
//   this._stepEnv(v.env, …)        ->  b.stepEnv(b.eg, …) / v.stepEnv(v.eg, …) (V1 _stepEnv,
//                                      or options.stepEnvelope, via the tracked wrapper)
//   this._osc(plan.wave, …)        ->  this._carrier(v, plan.wave, …) (options.periodicWave)
//   osc.connect(envNode)           ->  osc.connect(env)
// b = { ctx, t0, track, source, env (the envelope GainNode), eg, a, r, stepEnv, o }. Every node
// goes through track() or source() (inventory K5), so the engine's node accounting stays exact.
//
// V250: a continuous segment sweep writes its segment envelopes into gain lanes instead of the
// envelope gain. Chromium and WebKit render a param from the value of the previous render quantum
// while the main thread holds its timeline (one quantum flattened; at the end of it a ramping gain
// steps: a click), and a top-up mutates the timeline of a param that is sounding. Each block of
// cycles therefore goes into a lane whose value is constant when it is written (envelopeLanes).
// Frequency stays on the carrier: a flattened quantum of the frequency keeps the phase continuous.

import { GAIN_FLOOR } from '../core/constants.js';
import { trackedParam } from './voice.js';

// V1: SCHEDULE_LEAD_S, FAST_RELEASE_S, ESCAPE_RELEASE_S, WAVE_DIP_S, SCHEDULE_AHEAD_S,
// TOP_UP_EVERY_MS (index.html@a7b7a23)
// Engine timing. Every change to a sounding voice is scheduled SCHEDULE_LEAD_S ahead of the
// main thread's currentTime, which can trail the render position (measured in Firefox under
// load: up to ~15 ms): an event that lands in the past applies as a step (a click).
export const SCHEDULE_LEAD_S = 0.02;
export const FAST_RELEASE_S = 0.015;    // a new voice fades every earlier one out this fast
export const ESCAPE_RELEASE_S = 0.008;  // Escape / STOP: everything fades within a few milliseconds
export const WAVE_DIP_S = 0.005;        // waveform change: fade to the floor, switch, fade back in
export const SCHEDULE_AHEAD_S = 10;     // continuous repeat: audio scheduled this far ahead …
export const TOP_UP_EVERY_MS = 1000;    // … and topped up by this UI bookkeeping timer
// V250: gain lanes of a continuous segment sweep. A block of whole cycles of at least
// LANE_BLOCK_S goes into the next lane in turn, so a lane is written about one block after its
// previous block ended: LANES - 1 blocks cover the SCHEDULE_AHEAD_S horizon.
export const LANES = 3;
export const LANE_BLOCK_S = SCHEDULE_AHEAD_S / (LANES - 1);

/** V1: AudioEngine.play case 'const' (index.html@a7b7a23). Returns the programmed end or null. */
export function scheduleConst(v, plan, b) {
  const { t0, source, env, eg, a, r, o } = b;
  const osc = source(this._carrier(v, plan.wave, plan.freq, t0));
  osc.connect(env);
  v.carrier = osc;
  v.freqParams.push(osc.frequency);
  if (plan.kind === 'finite') {
    // The finite tone obeys the hard limit unless continuous playback is allowed.
    let dur = plan.dur;
    if (plan.limitable && dur > o.limitS) {
      if (o.continuous) v.extended = true; else { dur = o.limitS; v.limited = true; }
    }
    b.stepEnv(eg, t0, dur, a, r);
    return t0 + dur;
  }
  return null;
}

/** V1: AudioEngine.play case 'steps' (index.html@a7b7a23). Returns the programmed end. */
export function scheduleSteps(v, plan, b) {
  const { t0, source, env, eg, a, r } = b;
  const osc = source(this._carrier(v, plan.wave, plan.steps[0].f, t0));
  osc.connect(env);
  v.carrier = osc;
  v.freqParams.push(osc.frequency);
  for (const s of plan.steps) {
    osc.frequency.setValueAtTime(this._f(s.f), t0 + s.t);
    b.stepEnv(eg, t0 + s.t, s.dur, a, r);
  }
  return t0 + plan.dur;
}

/** V1: AudioEngine.play case 'ramps' (index.html@a7b7a23). Returns the programmed end. */
export function scheduleRamps(v, plan, b) {
  const { t0, source, env, eg, a, r } = b;
  const osc = source(this._carrier(v, plan.wave, plan.segments[0].f0, t0));
  const lanes = plan.kind === 'continuous' && plan.envelope === 'segment'
    && typeof b.ctx.createConstantSource === 'function';
  osc.connect(lanes ? envelopeLanes.call(this, v, b) : env);
  v.carrier = osc;
  v.freqParams.push(osc.frequency);
  if (plan.kind === 'continuous') {
    v.extended = true;
    if (plan.envelope !== 'segment') {
      eg.setValueAtTime(GAIN_FLOOR, t0);
      eg.linearRampToValueAtTime(1, t0 + a);
    }
    this._scheduleCycles(v);
    return Infinity;
  }
  this._rampSegments(v, t0);
  if (plan.envelope !== 'segment') b.stepEnv(eg, t0, plan.dur, a, r);
  return t0 + plan.dur;
}

/**
 * V250: the gain lanes of a continuous segment sweep. The carrier feeds a gain that only the
 * lanes drive (intrinsic 0); each lane is a ConstantSourceNode on that gain, 0 while idle. The
 * envelope gain passes the result through at 1. Returns the node the carrier connects to.
 * Without ConstantSourceNode (old WebKit, the recording mock) the envelope stays on env (V1).
 */
function envelopeLanes(v, b) {
  const { ctx, t0, track, source, env, eg } = b;
  const vca = track(ctx.createGain());
  vca.gain.value = 0;
  vca.connect(env);
  eg.setValueAtTime(1, t0);
  v.lanes = [];
  for (let i = 0; i < LANES; i++) {
    const node = source(ctx.createConstantSource());
    node.offset.value = 0;
    node.connect(vca.gain);
    node.start(t0);
    const pt = this._track(node.offset, 0);
    v.lanes.push({ pt, eg: trackedParam(pt), end: -Infinity });
  }
  v.laneNext = 0;
  return vca;
}

/**
 * Frequency ramps (and per-segment envelopes) of one pass of a ramps plan, from `at`.
 * V1: AudioEngine._rampSegments (index.html@a7b7a23). v.stepEnv / v.eg are the voice's step
 * envelope and tracked wrapper (set by engine.play), so top-ups use the same envelope; `eg` is
 * the gain lane of the block instead (V250).
 */
export function rampSegments(v, at, eg = v.eg) {
  const plan = v.plan;
  const f = v.carrier.frequency;
  const short = plan.chirp ? Math.min(v.attack, plan.dur * 0.1) : v.attack;
  for (const s of plan.segments) {
    f.setValueAtTime(this._f(s.f0), at + s.t);
    if (s.curve === 'log') f.exponentialRampToValueAtTime(this._f(s.f1), at + s.t + s.dur);
    else f.linearRampToValueAtTime(this._f(s.f1), at + s.t + s.dur);
    if (plan.envelope === 'segment') v.stepEnv(eg, at + s.t, s.dur, short, v.release);
  }
}

/**
 * Continuous repeat: schedule whole cycles up to SCHEDULE_AHEAD_S ahead on the audio clock.
 * After a stall (throttled timer) cycles already in the past are skipped, keeping the grid.
 * V1: AudioEngine._scheduleCycles (index.html@a7b7a23)
 * V253: only a top-up skips. At play the first cycle starts at t0, before the voice sounds;
 * V1's _soon was exactly t0 there, while the quantum-aligned _soon of V2 lies up to a quantum
 * after it, which skipped cycle 0 (one period of silence, or of a held tone).
 */
export function scheduleCycles(v) {
  const ctx = v.ctx;
  const period = v.plan.period;
  const now = ctx.currentTime;
  if (v.cycle > 0) {
    const first = Math.max(0, Math.ceil((this._soon(ctx) - v.t0) / period));
    if (v.cycle < first) v.cycle = first;
  }
  if (v.lanes) {
    scheduleLaneBlocks.call(this, v, now);
  } else {
    while (v.t0 + v.cycle * period < now + SCHEDULE_AHEAD_S) {
      this._rampSegments(v, v.t0 + v.cycle * period);
      v.cycle++;
    }
  }
  this._prune(v.env, now);
}

/**
 * V250: whole cycles in blocks of at least LANE_BLOCK_S, each into the next gain lane in turn,
 * ending with that lane back at 0 where the next block starts. A lane is written only when the
 * end of its previous block is behind the clock (the render position is never behind
 * currentTime), so the param is constant while its timeline changes.
 */
function scheduleLaneBlocks(v, now) {
  const period = v.plan.period;
  const n = Math.max(1, Math.ceil(LANE_BLOCK_S / period));
  for (const lane of v.lanes) this._prune(lane.pt, now);
  while (v.t0 + v.cycle * period < now + SCHEDULE_AHEAD_S) {
    const lane = v.lanes[v.laneNext];
    if (lane.end > now) break;
    for (let k = 0; k < n; k++) this._rampSegments(v, v.t0 + (v.cycle + k) * period, lane.eg);
    v.cycle += n;
    lane.end = v.t0 + v.cycle * period;
    this._ev(lane.pt, 'setValueAtTime', 0, lane.end);
    v.laneNext = (v.laneNext + 1) % v.lanes.length;
  }
}

/** The top-up timer of a continuous voice. V1: AudioEngine._armTopUp (index.html@a7b7a23) */
export function armTopUp(v) {
  const { setTimeout } = this._timers;
  const tick = () => {
    if (v.ended || v.releasing) return;
    if (v.ctx.state === 'running') {
      try { this._scheduleCycles(v); } catch (e) { this._fail(e, 'schedule'); }
    }
    v.topUp = setTimeout(tick, TOP_UP_EVERY_MS);
  };
  v.topUp = setTimeout(tick, TOP_UP_EVERY_MS);
}

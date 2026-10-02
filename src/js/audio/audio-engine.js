// The Web Audio engine: one AudioContext, the shared output chain (master -> limiter -> trim ->
// ceiling -> analyser -> destination), voices built from plans (patterns.js buildPlan),
// release/stop semantics, live updates and the microphone. Extracted from V1 class AudioEngine
// (index.html@36f4b47, section 6) and ported to index.html@a7b7a23: one voice at a time (a new
// voice starts after a FAST_RELEASE_S fade of every earlier one), a WaveShaper ceiling, recorded
// envelopes frozen at their computed value, releases on a render-quantum boundary
// SCHEDULE_LEAD_S ahead, live plan-type changes restart the voice with the old deadline,
// waveform changes dip, closed contexts are rebuilt, continuous sweeps are scheduled ahead in
// slices and topped up, and the microphone stops its tracks on failure and reports a track that
// ends by itself. Behaviour with default options is V1's (frozen by the engine.stop golden
// vectors on a recording mock AudioContext).
//
// Split (cohesive parts only): voice.js (recorded automation, step envelope, open-pattern
// envelope), scheduler.js (const/steps/ramps automation, continuous cycles, timing constants),
// modulation.js (lfo/am/fm/dual graphs), microphone.js. Release, cleanup, timers and live
// updates stay here because they own the engine's voice and node bookkeeping.
//
// INVARIANTS (inventory K4/K5, risks 4/5):
//   - every node of a voice goes through track() (sources through source()), so
//     activeNodeCount/activeSourceCount stay exact and stop/cleanup leaves zero nodes;
//   - every automation of the envelope and release gains goes through the recorded params
//     (v.env / v.rel, envelope functions through the `eg` wrapper), so _freeze holds them at
//     their scheduled value in every browser.
//
// V2 EXTENSION POINTS (no DSP here; src/js/audio/{envelope,filters,additive,stereo}.js plug in):
//   play(plan, o) options, all optional (absent = V1 behaviour, identical graph and schedule):
//     o.inserts      [(ctx, track, source) => { input, output, update(cfg), dispose() }]
//                    per-voice chain env -> [inserts…] -> rel (filter stage). Factories must
//                    create nodes through track/source. engine.updateInserts(cfgs) updates the
//                    sounding voice; dispose() runs at voice cleanup.
//     o.periodicWave a PeriodicWave for the carrier of const/steps/ramps/lfo/am/fm plans
//                    (additive synthesis); engine.setPeriodicWave(wave) changes it live and
//                    engine.clearPeriodicWave() returns to plan.wave with a click-free dip.
//     o.adsr         { a, d, s, r } (seconds, sustain 0..1): attack/release times come from it
//                    and it is handed to the envelope function (see voice.js v1OpenEnvelope);
//                    the default envelope uses only a and r. Install the DSP ADSR with
//                    engine.setEnvelope(makeAdsrEnvelope(envelopeModule)).
//     o.envelope     per-play envelope function (overrides engine.setEnvelope).
//     o.stepEnvelope (eg, t, dur, a, r, adsr) => void, replaces the V1 step envelope of
//                    programmed patterns (must schedule through eg).
//     o.output       (ctx, track, source) => { input, output, update?, dispose() } between the
//                    voice's rel gain and the master (stereo/dual output stage).
//     o.dualRouter   (ctx, track, plan, source) => { inputA, inputB, output, update(plan),
//                    dispose() } replaces the dual plan's panners (Phase & Stereo routing).
//     o.dualPhaseDeg phase of the dual plan's B against A at the voice start (degrees; B starts
//                    later by less than one period, modulation.js phaseStartDelay).
//                    engine.setDualPhase(deg) applies a change by a click-free restart.
//   attachMicrophone(stream, opts) / detachMicrophone(): the analysis graph of a stream the
//   caller opened (mic lab), built through the engine's mic accounting (micNodeCount).
//   A replacement voice (_restart) is started through this.play with the voice's own options,
//   so a wrapper installed on the instance (main.js) re-applies the V2 options.
//   snapshot(out?)   plain read-only engine state for the visualization (risk 3).

import {
  DEFAULT_GAIN, GAIN_FLOOR, LIMITER_RATIO, LIMITER_THRESHOLD_DB, MAX_OUTPUT_GAIN,
  SAFE_NYQUIST_FACTOR, START_OFFSET_S,
} from '../core/constants.js';
import { clamp, toNumber } from '../core/math.js';
import { planFreqAt } from './patterns.js';
import {
  freezeParam, pruneParam, recordEvent, stepEnv, trackParam, trackedParam, v1OpenEnvelope,
  valueAt,
} from './voice.js';
import {
  ESCAPE_RELEASE_S, FAST_RELEASE_S, SCHEDULE_LEAD_S, WAVE_DIP_S, armTopUp, rampSegments,
  scheduleConst, scheduleCycles, scheduleRamps, scheduleSteps,
} from './scheduler.js';
import {
  buildAm, buildDual, buildFm, buildLfo, normalizePhaseDeg,
} from './modulation.js';
import {
  MIC_UNAVAILABLE_TEXT, buildMicrophoneGraph, closeMicrophone, hasMicrophoneApi,
  requestMicrophoneStream, stopStreamTracks,
} from './microphone.js';

export {
  ESCAPE_RELEASE_S, FAST_RELEASE_S, SCHEDULE_AHEAD_S, SCHEDULE_LEAD_S, TOP_UP_EVERY_MS,
  WAVE_DIP_S,
} from './scheduler.js';

const defaultEnv = () => (typeof window !== 'undefined' ? window : globalThis);

/** Plan identity for live updates; the label is presentation, and waveforms can be ignored. */
export function planKey(plan, ignoreWave = false) {
  // V1: planKey (index.html@a7b7a23)
  return JSON.stringify(plan, (k, v) => (k === 'label' || (ignoreWave && k === 'wave') ? undefined : v));
}

/** Waveshaper curve: identity up to ±cap, flat beyond (exact under linear interpolation). */
export function ceilingCurve(cap) {
  // V1: ceilingCurve (index.html@a7b7a23)
  const n = 4097;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = clamp((2 * i) / (n - 1) - 1, -cap, cap);
  return curve;
}

export class AudioEngine {
  /**
   * options.env: the window-like object that provides AudioContext/webkitAudioContext,
   * setTimeout/clearTimeout and navigator (default: window). Read lazily (at init / when used).
   */
  constructor(options = {}) {
    // V1: AudioEngine constructor (index.html@a7b7a23)
    this.ctx = null;
    this.master = null;
    this.limiter = null;
    this.trim = null;
    this.ceiling = null;
    this.analyser = null;
    this.timeData = null;
    this.freqData = null;
    this.gainLevel = DEFAULT_GAIN; // requested master level, applied when a context is built
    this.voice = null;           // the current voice
    // current + every earlier voice not freed yet: releasing ones, and released ones that are
    // already silent but wait for their sources' onended (or the fallback timer). During rapid
    // retriggers this briefly holds 4–9 voices while at most one or two are audible; read
    // audibleVoiceCount for what can be heard.
    this.voices = new Set();
    this.nodes = new Set();      // every node owned by a voice
    this.sources = new Set();    // every scheduled source owned by a voice
    this.lastError = null;
    this.mic = null;
    this.micAttachment = null;   // a caller-opened stream's analysis graph (attachMicrophone)
    this.micNodes = new Set();   // nodes of micAttachment (accounted apart from voice nodes)
    this._listeners = new Set();
    this._seq = 0;
    this._env = options.env || defaultEnv();
    const env = this._env;
    this._timers = {
      setTimeout: (fn, ms) => env.setTimeout(fn, ms),
      clearTimeout: (id) => env.clearTimeout(id),
    };
    this._envelope = v1OpenEnvelope;
  }

  /** V1: AudioEngine.isSupported (index.html@a7b7a23); env defaults to window. */
  static isSupported(env = typeof window !== 'undefined' ? window : undefined) {
    return !!env && !!(env.AudioContext || env.webkitAudioContext);
  }

  /** Whether this engine's environment provides Web Audio. */
  isSupported() { return AudioEngine.isSupported(this._env); }

  // V1: AudioEngine: get sampleRate, get nyquist, get safeMaximum, get state, get running,
  //   get activeNodeCount, get activeSourceCount, on, _emit, _fail (index.html@a7b7a23)
  get sampleRate() { return this.ctx ? this.ctx.sampleRate : null; }
  get nyquist() { return this.ctx ? this.ctx.sampleRate / 2 : null; }
  get safeMaximum() { return this.ctx ? (this.ctx.sampleRate / 2) * SAFE_NYQUIST_FACTOR : null; }
  get state() { return this.ctx ? this.ctx.state : 'not started'; }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }
  get activeNodeCount() { return this.nodes.size; }
  get activeSourceCount() { return this.sources.size; }
  /** Nodes of an attached microphone stream (attachMicrophone); 0 once detached. */
  get micNodeCount() { return this.micNodes.size; }

  /**
   * Voices that are sounding or scheduled to sound (V2 accounting): not freed, and the audio
   * clock is before the end of their fade (endTime carries a 10 ms stop margin). voices.size
   * also counts released voices that are already silent and only wait to be freed.
   */
  get audibleVoiceCount() {
    if (!this.ctx) return 0;
    const now = this.ctx.currentTime;
    let n = 0;
    for (const v of this.voices) if (!v.ended && now < v.endTime - 0.01) n++;
    return n;
  }

  on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(type, detail) {
    for (const fn of this._listeners) {
      try { fn(type, detail); } catch (e) { this.lastError = { message: String(e && e.message), context: 'listener' }; }
    }
  }

  _fail(err, context) {
    const message = typeof err === 'string' ? err : (err && err.message) || 'Unknown audio error';
    this.lastError = { message, context, at: Date.now() };
    this._emit('error', this.lastError);
    return false;
  }

  // V1: AudioEngine.init (index.html@a7b7a23)
  /**
   * Create the context and the shared output chain. Synchronous so it runs inside the gesture.
   * A context closed from outside is discarded and rebuilt.
   */
  init() {
    if (this.ctx && this.ctx.state !== 'closed') return true;
    if (this.ctx) this._discardContext();
    if (!AudioEngine.isSupported(this._env)) return this._fail('The Web Audio API is not available in this browser.', 'init');
    let ctx;
    try {
      const Ctor = this._env.AudioContext || this._env.webkitAudioContext;
      try { ctx = new Ctor({ latencyHint: 'interactive' }); } catch (e) { ctx = new Ctor(); }
    } catch (e) {
      return this._fail(e, 'init');
    }
    try {
      this.master = ctx.createGain();
      this.master.gain.value = this.gainLevel; // the requested level from the first sample
      // Conservative limiter. DynamicsCompressorNode applies automatic makeup gain
      // ((1 / fullRangeGain) ^ 0.6 per the Web Audio spec); `trim` removes it so the
      // logical gain shown in the UI is the level that reaches the output.
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = LIMITER_THRESHOLD_DB;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = LIMITER_RATIO;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.12;
      const fullRangeDb = LIMITER_THRESHOLD_DB - LIMITER_THRESHOLD_DB / LIMITER_RATIO;
      const makeup = Math.pow(1 / Math.pow(10, fullRangeDb / 20), 0.6);
      this.trim = ctx.createGain();
      this.trim.gain.value = 1 / makeup;
      // Hard ceiling at MAX_OUTPUT_GAIN: transparent for one voice at UI 100 %, it bounds any
      // momentary sum (a replaced voice fading under its successor, waveform overshoot).
      this.ceiling = ctx.createWaveShaper();
      this.ceiling.curve = ceilingCurve(MAX_OUTPUT_GAIN);
      this.ceiling.oversample = 'none';
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 8192;
      this.analyser.smoothingTimeConstant = 0.55;
      this.analyser.minDecibels = -140;
      this.analyser.maxDecibels = 0;
      this.master.connect(this.limiter);
      this.limiter.connect(this.trim);
      this.trim.connect(this.ceiling);
      this.ceiling.connect(this.analyser);
      this.analyser.connect(ctx.destination);
      this.timeData = new Float32Array(this.analyser.fftSize);
      this.freqData = new Float32Array(this.analyser.frequencyBinCount);
      this.ctx = ctx;
      ctx.onstatechange = () => {
        this._emit('context', ctx.state);
        if (ctx.state === 'closed' && this.ctx === ctx) this._discardContext();
      };
      this._emit('context', ctx.state);
      return true;
    } catch (e) {
      try { ctx.close(); } catch (e2) { /* ignore */ }
      this.ctx = null;
      return this._fail(e, 'init');
    }
  }

  // V1: AudioEngine._discardContext (index.html@a7b7a23)
  /** Drop a context (closed from outside, or failed): free every voice and the microphone. */
  _discardContext() {
    const ctx = this.ctx;
    for (const v of [...this.voices]) this._cleanup(v);
    this.stopMic('closed');
    this.detachMicrophone('closed');
    this.ctx = null;
    this.master = this.limiter = this.trim = this.ceiling = this.analyser = null;
    if (ctx) {
      ctx.onstatechange = null;
      if (ctx.state !== 'closed') { try { ctx.close(); } catch (e) { /* ignore */ } }
    }
    this._emit('context', 'closed');
  }

  // V1: AudioEngine: resume, setMasterGain, _soon, _f, _osc (index.html@a7b7a23)
  resume() {
    if (!this.ctx || this.ctx.state === 'closed') return Promise.resolve(false);
    if (this.ctx.state === 'running') return Promise.resolve(true);
    try {
      const ctx = this.ctx;
      return ctx.resume().then(() => ctx.state === 'running', (e) => this._fail(e, 'resume'));
    } catch (e) {
      return Promise.resolve(this._fail(e, 'resume'));
    }
  }

  setMasterGain(g) {
    this.gainLevel = clamp(toNumber(g, DEFAULT_GAIN), 0, MAX_OUTPUT_GAIN);
    if (this.master) this.master.gain.setTargetAtTime(this.gainLevel, this.ctx.currentTime, 0.02);
  }

  /** The earliest time a change to a sounding voice can be scheduled without a step. */
  _soon(ctx) {
    // On a render-quantum boundary: Firefox starts a ramp anchored mid-quantum at the quantum's
    // edge, which steps by up to 128 frames' worth of the ramp.
    const q = 128 / ctx.sampleRate;
    return Math.ceil((ctx.currentTime + Math.max(SCHEDULE_LEAD_S, 2 * q)) / q) * q;
  }

  /** Frequencies are clamped once more here, against the running context. */
  _f(freq) { return clamp(freq, 0.01, this.safeMaximum); }

  _osc(type, freq, startAt) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(this._f(freq), this.ctx.currentTime);
    o.start(startAt);
    return o;
  }

  /** V1 _osc plus the V2 additive hook: the voice's PeriodicWave, when it has one. */
  _carrier(v, type, freq, startAt) {
    const o = this._osc(type, freq, startAt);
    if (v.periodicWave) o.setPeriodicWave(v.periodicWave);
    return o;
  }

  // ---- recorded automation (bodies in voice.js)
  // V1: AudioEngine: _track, _ev, _valueAt, _freeze, _prune, _stepEnv (index.html@a7b7a23)
  _track(param, initial) { return trackParam(param, initial); }
  _ev(pt, kind, value, time) { recordEvent(pt, kind, value, time); }
  _valueAt(pt, t) { return valueAt(pt, t); }
  _freeze(pt, t) { return freezeParam(pt, t); }
  _prune(pt, t) { pruneParam(pt, t); }
  /** V1 _stepEnv; `param` is a tracked wrapper (voice.js trackedParam), see voice.js stepEnv. */
  _stepEnv(param, t, dur, attack, release) { stepEnv(param, t, dur, attack, release); }

  // V1: AudioEngine: _rampSegments, _scheduleCycles, _armTopUp (index.html@a7b7a23), see
  // scheduler.js
  _rampSegments(v, at) { rampSegments.call(this, v, at); }
  _scheduleCycles(v) { scheduleCycles.call(this, v); }
  _armTopUp(v) { armTopUp.call(this, v); }

  /** Default open-pattern envelope for later plays (V2 ADSR hook); null restores V1's. */
  setEnvelope(fn) { this._envelope = typeof fn === 'function' ? fn : v1OpenEnvelope; }

  // V1: AudioEngine.play (index.html@a7b7a23): replacement, voice record, env -> rel chain, the
  // plan switch (bodies in scheduler.js / modulation.js), open-pattern limit and inherited
  // deadline, stops, 'play', timers, top-up.
  /**
   * Start a plan. Every earlier voice — sounding or still in a long release — fades out within
   * FAST_RELEASE_S and the new voice starts after that fade, so voices never sum audibly (at
   * most one is heard, the ceiling is a backstop). Faded voices stay in `voices` (silent) until
   * their sources end and _cleanup frees them, so voices.size can briefly exceed the audible
   * count (audibleVoiceCount) during rapid retriggers; oscillators never accumulate beyond that.
   * o = { mode: 'hold' | 'trigger' | 'latch', continuous, limitS, durationS, attackS, releaseS,
   *       until?: absolute deadline inherited by a replacement voice }
   * plus the optional V2 extension options listed at the top of this file.
   */
  play(plan, o) {
    if (!this.init()) return null;
    const ctx = this.ctx;
    // The replaced voice stops being current before it is released, so its end (immediate on a
    // suspended context) is not reported as the end of playback.
    const prev = this.voice;
    this.voice = null;
    const replacing = this.voices.size > 0;
    this._releaseAll(FAST_RELEASE_S, true);
    // A replacement starts once its predecessors have faded: no overlap, so no momentary sum
    // above the single-voice level (the output ceiling is only a backstop).
    const startAt = replacing ? this._soon(ctx) + FAST_RELEASE_S : ctx.currentTime + START_OFFSET_S;
    const adsr = o.adsr || null;
    const v = {
      id: ++this._seq, ctx, plan, opts: o, t0: startAt, nodes: [], sources: [],
      freqParams: [], env: null, rel: null, carrier: null, live: {}, cycle: 0, topUp: null,
      endTime: Infinity, deadline: Infinity, releasing: false, ended: false, timers: [], dipping: false,
      attack: Math.max(0.001, adsr ? adsr.a : o.attackS), release: Math.max(0.005, adsr ? adsr.r : o.releaseS),
      limited: !!o.limited, extended: false,
      inserts: [], periodicWave: o.periodicWave || null, adsr, eg: null, stepEnv: null,
    };
    const t0 = v.t0;
    const track = (n) => { v.nodes.push(n); this.nodes.add(n); return n; };
    const source = (n) => { track(n); v.sources.push(n); this.sources.add(n); return n; };
    try {
      // env (programmed envelope) → [inserts] → rel (release and waveform dips only) →
      // [output stage] → master
      const envNode = track(ctx.createGain());
      v.env = this._track(envNode.gain, 1);
      const eg = trackedParam(v.env);
      v.eg = eg;
      this._ev(v.env, 'setValueAtTime', GAIN_FLOOR, ctx.currentTime);
      const relNode = track(ctx.createGain());
      v.rel = this._track(relNode.gain, 1);
      let tail = envNode;
      for (const make of o.inserts || []) {
        const stage = make(ctx, track, source);
        v.inserts.push(stage);
        tail.connect(stage.input);
        tail = stage.output;
      }
      tail.connect(relNode);
      if (typeof o.output === 'function') {
        const out = o.output(ctx, track, source);
        v.inserts.push(out);
        relNode.connect(out.input);
        out.output.connect(this.master);
      } else {
        relNode.connect(this.master);
      }
      const a = v.attack;
      const r = v.release;
      v.stepEnv = typeof o.stepEnvelope === 'function'
        ? (p, t, dur, at, rt) => o.stepEnvelope(p, t, dur, at, rt, adsr)
        : (p, t, dur, at, rt) => this._stepEnv(p, t, dur, at, rt);
      const b = { ctx, t0, track, source, env: envNode, eg, a, r, stepEnv: v.stepEnv, o };
      let programmedEnd = null;
      switch (plan.type) {
        case 'const': programmedEnd = scheduleConst.call(this, v, plan, b); break;
        case 'steps': programmedEnd = scheduleSteps.call(this, v, plan, b); break;
        case 'ramps': programmedEnd = scheduleRamps.call(this, v, plan, b); break;
        case 'lfo': buildLfo.call(this, v, plan, b); break;
        case 'am': buildAm.call(this, v, plan, b); break;
        case 'fm': buildFm.call(this, v, plan, b); break;
        case 'dual':
          this._buildDual(v, plan, t0, track, source, envNode, o.dualRouter || null);
          break;
        default:
          throw new Error(`Unknown signal type “${plan.type}”.`);
      }

      let end = Infinity;
      if (programmedEnd != null) {
        end = programmedEnd;
      } else {
        // Open patterns: TRIGGER plays the set duration, HOLD / latch until released; without the
        // continuous permission both are capped by the hard safety limit. A replacement voice
        // keeps its predecessor's deadline, so changing the pattern never extends playback.
        let len = o.mode === 'trigger' ? o.durationS : Infinity;
        if (o.until != null) len = Math.min(len, o.until - t0);
        if (!(len <= o.limitS)) {
          if (o.continuous) v.extended = true; else { len = o.limitS; v.limited = true; }
        }
        // The envelope (V1: linear attack, hold, release inside a finite length) — voice.js.
        end = (o.envelope || this._envelope)(eg, t0, len, a, r, adsr);
        if (Number.isFinite(end)) v.deadline = end;
      }
      if (Number.isFinite(end)) {
        v.endTime = end + 0.01;
        for (const s of v.sources) s.stop(v.endTime);
      }
      v.sources[0].onended = () => this._cleanup(v);
      this.voice = v;
      this.voices.add(v);
      const info = { id: v.id, kind: plan.kind, start: t0, end: v.endTime, limited: v.limited, running: this.running };
      this._emit('play', info);
      this._armTimers(v);
      if (plan.kind === 'continuous') this._armTopUp(v);
      return info;
    } catch (e) {
      this._cleanup(v);
      if (prev) this._emit('ended', { id: prev.id });
      this._fail(e, 'play');
      return null;
    }
  }

  /** V1: AudioEngine._buildDual (index.html@a7b7a23), see modulation.js buildDual. */
  _buildDual(v, plan, t0, track, source, env, router = null) {
    buildDual.call(this, v, plan, t0, track, source, env, router);
  }

  // V1: AudioEngine: _armTimers (index.html@a7b7a23)
  /**
   * UI bookkeeping only: a RELEASING notice before a programmed end, and a cleanup fallback.
   * The notice is keyed on the audio clock, so a suspended context never shows RELEASING.
   */
  _armTimers(v) {
    if (!Number.isFinite(v.endTime)) return;
    const { setTimeout } = this._timers;
    const ctx = v.ctx;
    const relAt = v.endTime - 0.01 - Math.min(v.release, 0.25);
    const notice = () => {
      if (v.ended || v.releasing || this.voice !== v) return;
      const left = relAt - ctx.currentTime;
      if (ctx.state === 'running' && left <= 0.005) {
        this._emit('release', { id: v.id, natural: true });
        return;
      }
      v.timers.push(setTimeout(notice, ctx.state === 'running' ? Math.max(10, left * 1000) : 250));
    };
    v.timers.push(setTimeout(notice, Math.max(10, (relAt - ctx.currentTime) * 1000)));
    this._armFallback(v);
  }

  // V1: AudioEngine: _armFallback (index.html@a7b7a23)
  _armFallback(v) {
    const { setTimeout } = this._timers;
    const ctx = v.ctx;
    const check = () => {
      if (v.ended) return;
      if (ctx.state === 'running' && ctx.currentTime >= v.endTime + 0.05) { this._cleanup(v); return; }
      if (ctx.state === 'closed' || (v.releasing && ctx.state !== 'running')) { this._cleanup(v); return; }
      const wait = ctx.state === 'running' ? Math.max(100, (v.endTime - ctx.currentTime) * 1000 + 200) : 500;
      v.timers.push(setTimeout(check, wait));
    };
    v.timers.push(setTimeout(check, Math.max(100, (v.endTime - ctx.currentTime) * 1000 + 250)));
  }

  // V1: AudioEngine: _releaseVoice, _releaseAll, release, stopAll, revokeContinuous
  //   (index.html@a7b7a23)
  /**
   * Fade a voice out over releaseS, starting slightly ahead (see SCHEDULE_LEAD_S). A voice that
   * is already releasing is re-released when the new fade ends earlier (Escape during a long
   * release): both gains are frozen at their scheduled values and fade from there.
   */
  _releaseVoice(v, releaseS, silent = false) {
    if (!v || v.ended) return false;
    const ctx = v.ctx;
    if (ctx.state === 'closed') { this._cleanup(v); return true; }
    const t = this._soon(ctx);
    const rel = Math.max(0.005, releaseS);
    const stopAt = Math.max(t + rel + 0.01, v.t0 + 0.005);
    if (t >= v.endTime - 0.002 || stopAt >= v.endTime) return false; // ends sooner on its own
    v.releasing = true;
    this._timers.clearTimeout(v.topUp);
    try {
      // Freeze the envelope where it will be (no step, no later attack), then fade on the
      // release gain from its own current value.
      this._freeze(v.env, t);
      this._freeze(v.rel, t);
      this._ev(v.rel, 'linearRampToValueAtTime', GAIN_FLOOR, t + rel);
      for (const s of v.sources) {
        try { s.stop(stopAt); } catch (e) { /* already stopped */ }
      }
      // Automation after the stop can never sound: cancel it.
      for (const p of v.freqParams) {
        try { p.cancelScheduledValues(stopAt); } catch (e) { /* ignore */ }
      }
      v.endTime = stopAt;
    } catch (e) {
      this._fail(e, 'release');
      this._cleanup(v);
      return false;
    }
    if (this.voice === v && !silent) this._emit('release', { id: v.id, natural: false });
    // A suspended context renders nothing, so its scheduled stops would never fire: free now.
    if (ctx.state !== 'running') { this._cleanup(v); return true; }
    this._armFallback(v);
    return true;
  }

  _releaseAll(releaseS, silent = false) {
    for (const v of [...this.voices]) this._releaseVoice(v, releaseS, silent);
  }

  /** Graceful stop of the current voice with its own release time (or a fast one). */
  release(fast = false) {
    const v = this.voice;
    if (!v) return false;
    return this._releaseVoice(v, fast ? 0.008 : v.release);
  }

  /** Escape: ramp everything down within a few milliseconds, long releases included. */
  stopAll() {
    this._releaseAll(ESCAPE_RELEASE_S);
  }

  /** Continuous permission withdrawn: every voice it lengthened fades out now. */
  revokeContinuous() {
    let n = 0;
    for (const v of [...this.voices]) {
      if (v.extended && this._releaseVoice(v, FAST_RELEASE_S)) n++;
    }
    return n;
  }

  // V1: AudioEngine: _cleanup (index.html@a7b7a23), plus disposal of the V2 insert stages
  _cleanup(v) {
    if (!v || v.ended) return;
    const { clearTimeout } = this._timers;
    v.ended = true;
    for (const id of v.timers) clearTimeout(id);
    clearTimeout(v.topUp);
    v.timers.length = 0;
    for (const stage of v.inserts || []) {
      try { stage.dispose(); } catch (e) { /* already disposed */ }
    }
    if (v.inserts) v.inserts.length = 0;
    for (const s of v.sources) {
      s.onended = null;
      try { s.stop(); } catch (e) { /* never started or already stopped */ }
      this.sources.delete(s);
    }
    for (const n of v.nodes) {
      try { n.disconnect(); } catch (e) { /* already disconnected */ }
      this.nodes.delete(n);
    }
    v.nodes.length = 0;
    v.sources.length = 0;
    v.freqParams.length = 0;
    v.live = {};
    v.carrier = null;
    v.env = null;
    v.rel = null;
    v.eg = null;
    this.voices.delete(v);
    if (this.voice === v) {
      this.voice = null;
      this._emit('ended', { id: v.id });
    }
  }

  // V1: AudioEngine: updateLive (index.html@a7b7a23)
  /**
   * Bring the sounding voice in line with a re-built plan (called on every UI change while
   * playing). Same open signal type: parameters glide. Only waveforms differ: a short dip
   * around the switch. Anything else (another pattern or source, a changed programmed
   * pattern): a seamless restart with the new plan. Returns 'same' | 'live' | 'restarted' | false.
   */
  updateLive(np) {
    const v = this.voice;
    if (!v || v.releasing || v.ended || !np || v.ctx !== this.ctx) return false;
    const p = v.plan;
    if (planKey(np) === planKey(p)) return 'same';
    const sameShape = planKey(np, true) === planKey(p, true);
    // Glide in place: open signals of the same type, or a finite tone whose length is unchanged.
    // V2: a dual router (o.dualRouter) re-routes stereo/mono live, like the StereoPanners.
    const liveTopology = np.type === p.type && np.kind === p.kind
      && (np.kind === 'open' || (np.type === 'const' && np.dur === p.dur))
      && !(np.type === 'dual' && !v.live.A.panner && !v.live.router && np.stereo !== p.stereo);
    if (!sameShape && !liveTopology) return this._restart(v, np);
    const now = v.ctx.currentTime;
    const T = (param, value) => param.setTargetAtTime(value, now, 0.015);
    try {
      if (!sameShape) {
        switch (np.type) {
          case 'const': T(v.carrier.frequency, this._f(np.freq)); break;
          case 'lfo':
            T(v.carrier.frequency, this._f(np.center));
            T(v.live.depth.gain, np.depth);
            T(v.live.lfo.frequency, np.rate);
            if (np.shape !== p.shape) v.live.lfo.type = np.shape;
            break;
          case 'am':
            T(v.carrier.frequency, this._f(np.freq));
            T(v.live.amGain.gain, 1 - np.depth / 2);
            T(v.live.lfoGain.gain, np.depth / 2);
            T(v.live.lfo.frequency, np.modFreq);
            break;
          case 'fm':
            T(v.carrier.frequency, this._f(np.freq));
            T(v.live.modGain.gain, np.depth);
            T(v.live.mod.frequency, np.modFreq);
            break;
          case 'dual': {
            // One glide per oscillator to the sounding frequency (detune is folded in): no
            // intermediate value can pass the clamp.
            const set = (side, o, level, pan) => {
              T(side.osc.frequency, this._f(o.freq));
              T(side.g.gain, o.gain * level * 0.5);
              if (side.panner) T(side.panner.pan, pan);
            };
            set(v.live.A, np.a, np.levelA, np.stereo ? -1 : 0);
            set(v.live.B, np.b, np.levelB, np.stereo ? 1 : 0);
            if (v.live.router) v.live.router.update(np);
            break;
          }
          default: return this._restart(v, np);
        }
      }
      v.plan = np;
      this._switchWaves(v);
      return 'live';
    } catch (e) {
      this._fail(e, 'live update');
      return false;
    }
  }

  // V1: AudioEngine._restart (index.html@a7b7a23)
  /** Replace the current voice with a new plan, keeping its play options and deadline. */
  _restart(v, np) {
    const o = { ...v.opts, limited: v.limited };
    delete o.until;
    if (Number.isFinite(v.deadline)) {
      if (v.deadline - v.ctx.currentTime < 0.03) return false; // about to end anyway
      o.until = v.deadline;
    }
    return this.play(np, o) ? 'restarted' : false;
  }

  // V1: AudioEngine._switchWaves (index.html@a7b7a23)
  /**
   * Waveform change without a click: OscillatorNode.type cannot be scheduled, so the voice dips
   * to the floor on its release gain (audio clock), the type is switched once the main thread
   * sees the dip complete, and the level comes back. Waves are read from v.plan when switching.
   * V2: a carrier playing a PeriodicWave (additive) keeps it; clearPeriodicWave() releases it.
   */
  _switchWaves(v) {
    const want = (o) => (v.plan.type === 'dual' ? [[v.live.A.osc, v.plan.a.wave], [v.live.B.osc, v.plan.b.wave]] : v.periodicWave ? [] : [[o, v.plan.wave]]);
    if (v.dipping || want(v.carrier).every(([osc, w]) => osc.type === w)) return;
    const { setTimeout } = this._timers;
    const ctx = v.ctx;
    v.dipping = true;
    const t = this._soon(ctx);
    this._prune(v.rel, ctx.currentTime);
    this._freeze(v.rel, t);
    this._ev(v.rel, 'linearRampToValueAtTime', GAIN_FLOOR, t + WAVE_DIP_S);
    const swap = () => {
      if (v.ended || v.releasing) return;
      if (ctx.state === 'running' && ctx.currentTime < t + WAVE_DIP_S) {
        v.timers.push(setTimeout(swap, 2));
        return;
      }
      for (const [osc, w] of want(v.carrier)) if (osc.type !== w) osc.type = w;
      const t2 = this._soon(ctx);
      this._freeze(v.rel, t2);
      this._ev(v.rel, 'linearRampToValueAtTime', 1, t2 + WAVE_DIP_S);
      v.dipping = false;
    };
    v.timers.push(setTimeout(swap, Math.max(1, (t + WAVE_DIP_S - ctx.currentTime) * 1000 + 1)));
  }

  // V1: AudioEngine: instantaneousFrequency (index.html@a7b7a23)
  instantaneousFrequency() {
    const v = this.voice;
    if (!v || !this.ctx) return null;
    return planFreqAt(v.plan, Math.max(0, this.ctx.currentTime - v.t0));
  }

  // V1: AudioEngine: startMic, stopMic (index.html@a7b7a23); graph and texts in microphone.js
  /**
   * Microphone analysis (opt-in). If building the graph fails, every track is stopped before
   * the error propagates; a track that ends by itself (permission revoked, device unplugged)
   * stops the microphone and emits 'mic' so the UI clears its indicator.
   */
  async startMic() {
    if (this.mic) return true;
    const navigator = this._env.navigator;
    if (!hasMicrophoneApi(navigator)) {
      throw new Error(MIC_UNAVAILABLE_TEXT);
    }
    if (!this.init()) throw new Error('Audio could not start.');
    const stream = await requestMicrophoneStream(navigator.mediaDevices);
    try {
      if (!this.init()) throw new Error('Audio could not start.');
      const mic = buildMicrophoneGraph(this.ctx, stream);
      for (const t of stream.getTracks()) t.onended = () => { if (this.mic === mic) this.stopMic('ended'); };
      this.mic = mic;
    } catch (e) {
      stopStreamTracks(stream);
      throw e;
    }
    this.resume();
    return true;
  }

  /** reason: 'user' | 'ended' (track ended by itself) | 'closed' (context discarded). */
  stopMic(reason = 'user') {
    const m = this.mic;
    if (!m) return;
    this.mic = null;
    closeMicrophone(m);
    this._emit('mic', { active: false, reason });
  }

  // ---------------------------------------------------------------- V2 additions

  /**
   * Change the dual voice's phase offset of B (degrees). The offset is a start time, so a
   * sounding dual voice is replaced (FAST_RELEASE_S fade, then the new voice: click-free) with
   * the same plan, options and deadline. Returns 'same' | 'restarted' | false (no dual voice).
   */
  setDualPhase(deg) {
    const v = this.voice;
    if (!v || v.ended || v.releasing || !v.plan || v.plan.type !== 'dual') return false;
    const want = normalizePhaseDeg(deg);
    if (Math.abs(normalizePhaseDeg(v.opts.dualPhaseDeg) - want) < 1e-9) return 'same';
    v.opts = { ...v.opts, dualPhaseDeg: want };
    return this._restart(v, v.plan);
  }

  /**
   * Analysis graph for a microphone stream the caller opened (the mic lab asks for the stream
   * itself): MediaStreamSource → Analyser, never connected to the output. Every node is tracked
   * in micNodes. Replaces an earlier attachment. Returns the AnalyserNode, or null without a
   * context. The caller keeps the stream: detachMicrophone() disconnects, and stops the tracks.
   */
  attachMicrophone(stream, opts = {}) {
    if (!stream || !this.init()) return null;
    this.detachMicrophone('replaced');
    const track = (n) => { this.micNodes.add(n); return n; };
    let mic;
    try {
      mic = buildMicrophoneGraph(this.ctx, stream, { ...opts, track });
    } catch (e) {
      for (const n of this.micNodes) { try { n.disconnect(); } catch (e2) { /* ignore */ } }
      this.micNodes.clear();
      throw e;
    }
    this.micAttachment = mic;
    this.resume();
    return mic.analyser;
  }

  /** Disconnect the attached microphone graph and stop its tracks (idempotent). */
  detachMicrophone(reason = 'user') {
    const m = this.micAttachment;
    if (!m) return false;
    this.micAttachment = null;
    closeMicrophone(m);
    this.micNodes.clear();
    this._emit('micAttachment', { attached: false, reason });
    return true;
  }

  /** Update the sounding voice's insert stages: cfgs[i] goes to inserts[i].update (if given). */
  updateInserts(cfgs) {
    const v = this.voice;
    if (!v || v.ended || !Array.isArray(cfgs)) return false;
    cfgs.forEach((cfg, i) => {
      const stage = v.inserts[i];
      if (cfg !== undefined && stage && typeof stage.update === 'function') stage.update(cfg);
    });
    return true;
  }

  /** Swap the carrier's PeriodicWave of the sounding voice (additive synthesis, live). */
  setPeriodicWave(wave) {
    const v = this.voice;
    if (!v || v.ended || !v.carrier || !wave) return false;
    v.periodicWave = wave;
    v.carrier.setPeriodicWave(wave);
    return true;
  }

  /**
   * Return the sounding voice's carrier from a PeriodicWave to plan.wave (additive off) with
   * the same click-free dip as a waveform change. False when there is nothing to clear.
   */
  clearPeriodicWave() {
    const v = this.voice;
    if (!v || v.ended || v.releasing || !v.carrier || !v.periodicWave) return false;
    v.periodicWave = null;
    this._switchWaves(v);
    return true;
  }

  /**
   * Plain engine state for the visualization bridge, so it never reads engine internals
   * (inventory K3 / risk 3). With `out`, fills and returns that object (allocation-free per
   * frame); without, returns a new frozen object. The analyser and buffers are references:
   * read them, never reconnect or resize them.
   *   { hasCtx, state, running, time, sampleRate, voice, voiceId, t0, plan, kind, playing,
   *     releasing, endTime, limited, extended, analyser, timeData, freqData, mic, micAnalyser,
   *     micFreqData, activeNodes, activeSources, voices, audibleVoices }
   * voices counts every voice not freed yet (silent released ones included); audibleVoices
   * only those sounding or scheduled to sound — show that one in the UI.
   */
  snapshot(out) {
    const o = out || {};
    const ctx = this.ctx;
    const v = this.voice;
    o.hasCtx = !!ctx;
    o.state = this.state;
    o.running = this.running;
    o.time = ctx ? ctx.currentTime : 0;
    o.sampleRate = ctx ? ctx.sampleRate : 0;
    o.voice = !!(v && ctx);
    o.voiceId = v ? v.id : 0;
    o.t0 = v ? v.t0 : 0;
    o.plan = v ? v.plan : null;
    o.kind = v ? v.plan.kind : null;
    o.playing = !!(v && !v.ended);
    o.releasing = !!(v && v.releasing);
    o.endTime = v ? v.endTime : Infinity;
    o.limited = !!(v && v.limited);
    o.extended = !!(v && v.extended);
    o.analyser = this.analyser;
    o.timeData = this.timeData;
    o.freqData = this.freqData;
    o.mic = !!this.mic;
    o.micAnalyser = this.mic ? this.mic.analyser : null;
    o.micFreqData = this.mic ? this.mic.freqData : null;
    o.activeNodes = this.nodes.size;
    o.activeSources = this.sources.size;
    o.voices = this.voices.size;
    o.audibleVoices = this.audibleVoiceCount;
    return out ? o : Object.freeze(o);
  }
}

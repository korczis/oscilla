// Minimal fake Web Audio context for node:test (no dependencies). It records every scheduling
// call so the compiler's automation, source lifetimes and cleanup can be asserted without a
// browser. Real rendering is covered by tests/browser/sequencer.cjs.
//
// FakeContext (gain + oscillator) is what the sequencer tests use. StudioFakeContext extends it
// with every node type the Studio adapters and the real AudioEngine build (biquad, constant
// source, buffer source, analyser, compressor, wave shaper, panner, ...), and
// createFakeAudioEnv() gives the AudioEngine an `env` whose timers share one virtual clock with
// the context (tests/unit/v31-studio-transport.test.mjs). Everything added is additive: the
// FakeContext surface and its recordings are unchanged.

export class FakeParam {
  constructor(value, { holdSupported = false } = {}) {
    this.value = value;
    this.defaultValue = value;
    this.events = []; // { t, value, ramp }
    this.calls = [];
    if (holdSupported) {
      this.cancelAndHoldAtTime = (t) => {
        this.calls.push(['cancelAndHoldAtTime', t]);
        this.events = this.events.filter((e) => e.t < t);
      };
    }
  }

  setValueAtTime(v, t) {
    this._check(v, t);
    this.calls.push(['setValueAtTime', v, t]);
    this.events.push({ t, value: v, ramp: 'set' });
  }

  linearRampToValueAtTime(v, t) {
    this._check(v, t);
    this.calls.push(['linearRampToValueAtTime', v, t]);
    this.events.push({ t, value: v, ramp: 'linear' });
  }

  exponentialRampToValueAtTime(v, t) {
    this._check(v, t);
    if (!(v > 0)) throw new RangeError(`exponential ramp to ${v}`);
    this.calls.push(['exponentialRampToValueAtTime', v, t]);
    this.events.push({ t, value: v, ramp: 'exponential' });
  }

  setTargetAtTime(v, t, tau) {
    this._check(v, t);
    if (!(tau > 0)) throw new RangeError(`time constant ${tau}`);
    this.calls.push(['setTargetAtTime', v, t, tau]);
    this.events.push({ t, value: v, ramp: 'target', tau });
  }

  cancelScheduledValues(t) {
    this.calls.push(['cancelScheduledValues', t]);
    this.events = this.events.filter((e) => e.t < t);
  }

  /**
   * The schedule as written, before a sequencer voice's post-end cleanup: compileSequence cancels
   * every automation it wrote (cancelScheduledValues(0)) once all of the voice's sources have
   * ended, which can no longer sound. `events` replayed from `calls` without that trailing cancel;
   * a param that was not cleaned up returns `events` itself.
   */
  get scheduled() {
    const last = this.calls[this.calls.length - 1];
    if (!last || last[0] !== 'cancelScheduledValues' || last[1] !== 0) return this.events;
    const ramps = { setValueAtTime: 'set', linearRampToValueAtTime: 'linear',
      exponentialRampToValueAtTime: 'exponential', setTargetAtTime: 'target' };
    let events = [];
    for (const [m, a, b, c] of this.calls.slice(0, -1)) {
      if (m === 'cancelScheduledValues' || m === 'cancelAndHoldAtTime') {
        events = events.filter((e) => e.t < a);
      } else if (m === 'setTargetAtTime') {
        events.push({ t: b, value: a, ramp: 'target', tau: c });
      } else {
        events.push({ t: b, value: a, ramp: ramps[m] });
      }
    }
    return events;
  }

  _check(v, t) {
    if (!Number.isFinite(v) || !Number.isFinite(t) || t < 0) {
      throw new TypeError(`bad automation value ${v} at ${t}`);
    }
  }
}

class FakeNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.context = ctx;
    this.kind = kind;
    this.outputs = [];
    this.disconnected = false;
    this.channelCount = 2;
    this.channelCountMode = 'max';
    this.channelInterpretation = 'speakers';
    this.createdAt = ctx.currentTime; // the context clock when the node was built
    ctx.created.push(this);
  }

  connect(dest) {
    if (!dest) throw new TypeError('connect to nothing');
    this.outputs.push(dest);
    return dest;
  }

  /** disconnect() drops every output; disconnect(dest) only that one (Web Audio semantics). */
  disconnect(dest) {
    if (dest === undefined) {
      this.disconnected = true;
      this.outputs = [];
      return;
    }
    const i = this.outputs.indexOf(dest);
    if (i < 0) throw new Error('InvalidAccessError: not connected');
    this.outputs = this.outputs.filter((d) => d !== dest);
    if (!this.outputs.length) this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  constructor(ctx) {
    super(ctx, 'gain');
    this.gain = new FakeParam(1, { holdSupported: ctx.holdSupported });
  }
}

/** A scheduled source: start/stop once, `ended` fired by the context clock. */
export class FakeSource extends FakeNode {
  constructor(ctx, kind) {
    super(ctx, kind);
    this.startAt = null;
    this.stopAt = null;
    this.endedFired = false;
    this.listeners = [];
  }

  start(t = 0) {
    if (this.startAt !== null) throw new Error('InvalidStateError: start twice');
    this.startAt = t;
  }

  stop(t = 0) {
    if (this.startAt === null) throw new Error('InvalidStateError: stop before start');
    this.stopAt = t;
  }

  addEventListener(type, fn) {
    if (type === 'ended') this.listeners.push(fn);
  }

  removeEventListener(type, fn) {
    this.listeners = this.listeners.filter((f) => f !== fn);
  }

  fireEnded() {
    if (this.endedFired) return;
    this.endedFired = true;
    for (const fn of [...this.listeners]) fn({ type: 'ended', target: this });
  }
}

export class FakeOscillator extends FakeSource {
  constructor(ctx) {
    super(ctx, 'oscillator');
    this.type = 'sine';
    this.frequency = new FakeParam(440, { holdSupported: ctx.holdSupported });
    this.detune = new FakeParam(0, { holdSupported: ctx.holdSupported });
  }

  setPeriodicWave(w) {
    this.wave = w;
  }
}

export class FakeContext {
  constructor({
    sampleRate = 48000,
    currentTime = 0,
    state = 'running',
    holdSupported = false,
  } = {}) {
    this.sampleRate = sampleRate;
    this.currentTime = currentTime;
    this.state = state;
    this.holdSupported = holdSupported;
    this.created = [];
    this.destination = new FakeNode(this, 'destination');
  }

  createGain() {
    return new FakeGain(this);
  }

  createOscillator() {
    return new FakeOscillator(this);
  }

  get oscillators() {
    return this.created.filter((n) => n.kind === 'oscillator');
  }

  /** Live = started and not ended. */
  get liveSources() {
    return this.oscillators.filter((o) => o.startAt !== null && !o.endedFired).length;
  }

  /** Advance the clock and fire `ended` for every source whose stop time has passed. */
  advance(toTime) {
    this.currentTime = toTime;
    for (const o of this.oscillators) {
      if (!o.endedFired && o.stopAt !== null && o.stopAt <= toTime) o.fireEnded();
    }
  }
}

/** Every node type the Studio adapters and the AudioEngine's output chain create. */
export class StudioFakeContext extends FakeContext {
  constructor(opts = {}) {
    super(opts);
    this.onstatechange = null;
  }

  _param(value) {
    return new FakeParam(value, { holdSupported: this.holdSupported });
  }

  createBiquadFilter() {
    const n = new FakeNode(this, 'biquad');
    n.type = 'lowpass';
    n.frequency = this._param(350);
    n.Q = this._param(1);
    n.gain = this._param(0);
    n.detune = this._param(0);
    n.getFrequencyResponse = (f, mag, ph) => {
      mag.fill(1);
      ph.fill(0);
    };
    return n;
  }

  createConstantSource() {
    const n = new FakeSource(this, 'constant-source');
    n.offset = this._param(1);
    return n;
  }

  createBufferSource() {
    const n = new FakeSource(this, 'buffer-source');
    n.buffer = null;
    n.loop = false;
    n.loopStart = 0;
    n.loopEnd = 0;
    n.playbackRate = this._param(1);
    n.detune = this._param(0);
    return n;
  }

  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
      getChannelData: (c) => data[c], copyToChannel: (src, c) => data[c].set(src) };
  }

  createAnalyser() {
    const n = new FakeNode(this, 'analyser');
    n.fftSize = 2048;
    Object.defineProperty(n, 'frequencyBinCount', { get: () => n.fftSize / 2 });
    n.smoothingTimeConstant = 0.8;
    n.minDecibels = -100;
    n.maxDecibels = -30;
    n.getFloatFrequencyData = (a) => a.fill(-100);
    n.getFloatTimeDomainData = (a) => a.fill(0);
    return n;
  }

  createDynamicsCompressor() {
    const n = new FakeNode(this, 'compressor');
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = this._param(0);
    return n;
  }

  createWaveShaper() {
    const n = new FakeNode(this, 'waveshaper');
    n.curve = null;
    n.oversample = 'none';
    return n;
  }

  createStereoPanner() {
    const n = new FakeNode(this, 'panner');
    n.pan = this._param(0);
    return n;
  }

  createChannelMerger() {
    return new FakeNode(this, 'merger');
  }

  createChannelSplitter() {
    return new FakeNode(this, 'splitter');
  }

  createPeriodicWave(real, imag) {
    return { real, imag };
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  close() {
    this.state = 'closed';
    if (this.onstatechange) this.onstatechange();
    return Promise.resolve();
  }

  /** Every scheduled source (oscillators, constant and buffer sources). */
  get sources() {
    return this.created.filter((n) => n instanceof FakeSource);
  }

  get liveAllSources() {
    return this.sources.filter((s) => s.startAt !== null && !s.endedFired).length;
  }

  of(kind) {
    return this.created.filter((n) => n.kind === kind);
  }

  advance(toTime) {
    this.currentTime = toTime;
    for (const s of this.sources) {
      if (!s.endedFired && s.stopAt !== null && s.stopAt <= toTime) s.fireEnded();
    }
  }
}

/** Manual timers: run() fires everything due at or before a virtual millisecond clock. */
export function fakeTimers() {
  let id = 0;
  const pending = new Map();
  let now = 0;
  return {
    setTimeout(fn, ms) {
      id += 1;
      pending.set(id, { fn, at: now + Math.max(0, ms) });
      return id;
    },
    clearTimeout(i) {
      pending.delete(i);
    },
    get size() {
      return pending.size;
    },
    runUntil(ms) {
      now = ms;
      let fired = true;
      while (fired) {
        fired = false;
        for (const [i, p] of [...pending]) {
          if (p.at <= now) {
            pending.delete(i);
            p.fn();
            fired = true;
          }
        }
      }
    },
  };
}

/**
 * An AudioEngine environment on a StudioFakeContext with ONE virtual clock: timers (ms) are due
 * against the context's currentTime (s). advance(seconds) moves the clock in `step` increments,
 * firing `ended` and every due timer at each step, in time order — no real time passes.
 *   createFakeAudioEnv({ sampleRate, holdSupported, step = 0.005, navigator })
 *   -> { env, advance(seconds), advanceTo(time), ctx, timers: Map }
 */
export function createFakeAudioEnv(opts = {}) {
  let id = 0;
  const pending = new Map();
  let ctx = null;
  const step = opts.step || 0.005;
  const env = {
    AudioContext: class extends StudioFakeContext {
      constructor() {
        super({ sampleRate: opts.sampleRate || 48000, holdSupported: !!opts.holdSupported });
        ctx = this; // eslint-disable-line consistent-this
      }
    },
    setTimeout(fn, ms) {
      id += 1;
      pending.set(id, { fn, at: (ctx ? ctx.currentTime * 1000 : 0) + Math.max(0, ms) });
      return id;
    },
    clearTimeout(i) {
      pending.delete(i);
    },
    navigator: opts.navigator || {},
  };
  const runDue = () => {
    let fired = true;
    while (fired) {
      fired = false;
      const due = [...pending].filter(([, p]) => p.at <= ctx.currentTime * 1000 + 1e-6)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      for (const [i, p] of due) {
        if (!pending.has(i)) continue;
        pending.delete(i);
        p.fn();
        fired = true;
      }
    }
  };
  const advanceTo = (end) => {
    while (ctx.currentTime < end - 1e-12) {
      ctx.advance(Math.min(end, ctx.currentTime + step));
      runDue();
    }
  };
  return {
    env,
    advance: (seconds) => advanceTo(ctx.currentTime + seconds),
    advanceTo,
    get ctx() { return ctx; },
    timers: pending,
  };
}

// Minimal fake Web Audio context for node:test (no dependencies). It records every scheduling
// call so the compiler's automation, source lifetimes and cleanup can be asserted without a
// browser. Real rendering is covered by tests/browser/sequencer.cjs.

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

  cancelScheduledValues(t) {
    this.calls.push(['cancelScheduledValues', t]);
    this.events = this.events.filter((e) => e.t < t);
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
    this.kind = kind;
    this.outputs = [];
    this.disconnected = false;
    ctx.created.push(this);
  }

  connect(dest) {
    this.outputs.push(dest);
    return dest;
  }

  disconnect() {
    this.disconnected = true;
    this.outputs = [];
  }
}

export class FakeGain extends FakeNode {
  constructor(ctx) {
    super(ctx, 'gain');
    this.gain = new FakeParam(1, { holdSupported: ctx.holdSupported });
  }
}

export class FakeOscillator extends FakeNode {
  constructor(ctx) {
    super(ctx, 'oscillator');
    this.type = 'sine';
    this.frequency = new FakeParam(440, { holdSupported: ctx.holdSupported });
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
      if (!o.endedFired && o.stopAt !== null && o.stopAt <= toTime) {
        o.endedFired = true;
        for (const fn of [...o.listeners]) fn({ type: 'ended', target: o });
      }
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

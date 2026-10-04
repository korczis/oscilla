// Studio ↔ AudioEngine hooks (spec §41-§42, §186, §240). The Studio runtime never owns an
// AudioContext or an output chain: everything here reads or registers into the ONE existing
// AudioEngine instance. Where the engine has no public hook yet, the adapter uses the engine's
// own internal helper on the instance (documented in docs/v31/compiler.md "Engine hooks"),
// exactly as measurement/capture.js already registers its nodes in engine.nodes/engine.sources.
//
//   createEngineHooks(engine) -> hooks
//     hooks.ctx                  engine.ctx (null before init)
//     hooks.ensure()             engine.init(): the context and the master safety chain
//     hooks.masterInput()        engine.master: the ONLY node Studio audio may connect to on its
//                                way out (master → limiter → trim → ceiling → analyser → dest.)
//     hooks.soon()               engine._soon(ctx): the earliest click-free schedule time (lead
//                                + render-quantum boundary, ADR 0001)
//     hooks.clampFrequency(f)    engine._f(f): 0.01 Hz … 0.95 × Nyquist of the running context
//     hooks.safeMaximum          engine.safeMaximum
//     hooks.oscillator(t, f, at) engine._osc(type, f, at): an OscillatorNode, frequency clamped,
//                                started at `at` (the engine's own oscillator factory)
//     hooks.setMasterLevel(g)    engine.setMasterGain(g) (clamped to MAX_OUTPUT_GAIN, smoothed)
//     hooks.masterLevel          engine.gainLevel: the engine's requested master level
//     hooks.restoreMasterLevel(g, at)  engine.setMasterGain(g), its glide held until `at` (audio
//                                clock) so a level restored after STOP waits for the fade-out
//     hooks.timers               engine._timers (UI bookkeeping only: cleanup after a fade)
//     hooks.navigator            engine._env.navigator (capability checks: microphone)
//     hooks.on(fn)               engine.on(fn): 'context' closed → the runtime drops its graph
//   createAccounting(hooks, owners) -> { track(node), source(node), untrack(node) }
//     Every node goes into engine.nodes AND each owner's `nodes` Set; every scheduled source also
//     into engine.sources and each owner's `sources` Set (rule audio-engine-discipline). A source
//     that ends by itself is disconnected and untracked from its `ended` event, so finished
//     sweeps and noise buffers never accumulate across edits.
//
// INVARIANT: no function here connects anything to ctx.destination.

const QUANTUM = 128;
const LEAD_S = 0.02; // scheduler.js SCHEDULE_LEAD_S, used only when the engine lacks _soon
const MASTER_TAU_S = 0.02; // engine.setMasterGain's own time constant

export function createEngineHooks(engine) {
  if (!engine || typeof engine.init !== 'function') {
    throw new TypeError('createEngineHooks: an AudioEngine instance is required');
  }
  const env = engine._env || {};
  let held = null; // a restoreMasterLevel glide scheduled for later: { at }
  return Object.freeze({
    engine,
    get ctx() { return engine.ctx; },
    ensure: () => engine.init(),
    masterInput: () => engine.master,
    soon() {
      const ctx = engine.ctx;
      if (typeof engine._soon === 'function') return engine._soon(ctx);
      const q = QUANTUM / ctx.sampleRate;
      return Math.ceil((ctx.currentTime + Math.max(LEAD_S, 2 * q)) / q) * q;
    },
    clampFrequency(f) {
      if (typeof engine._f === 'function') return engine._f(f);
      const max = (engine.ctx.sampleRate / 2) * 0.95;
      return Math.min(max, Math.max(0.01, f));
    },
    get safeMaximum() {
      return engine.safeMaximum != null ? engine.safeMaximum
        : (engine.ctx.sampleRate / 2) * 0.95;
    },
    oscillator(type, freq, at) {
      if (typeof engine._osc === 'function') return engine._osc(type, freq, at);
      const o = engine.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(this.clampFrequency(freq), engine.ctx.currentTime);
      o.start(at);
      return o;
    },
    setMasterLevel(g) {
      // A restart during a held restore: drop the restore's later glide first.
      if (held && engine.ctx && engine.master && engine.ctx.currentTime < held.at) {
        engine.master.gain.cancelScheduledValues(engine.ctx.currentTime);
      }
      held = null;
      engine.setMasterGain(g);
    },
    get masterLevel() { return engine.gainLevel; },
    restoreMasterLevel(g, at) {
      held = null;
      engine.setMasterGain(g);
      const p = engine.master && engine.master.gain;
      const ctx = engine.ctx;
      if (!p || !ctx || !(at > ctx.currentTime)) return;
      // Drop the glide setMasterGain just scheduled (at currentTime) and start it at `at`.
      p.cancelScheduledValues(ctx.currentTime);
      p.setTargetAtTime(engine.gainLevel, at, MASTER_TAU_S);
      held = { at };
    },
    timers: engine._timers || {
      setTimeout: (fn, ms) => (env.setTimeout || globalThis.setTimeout)(fn, ms),
      clearTimeout: (id) => (env.clearTimeout || globalThis.clearTimeout)(id),
    },
    get navigator() { return env.navigator || null; },
    on: (fn) => engine.on(fn),
  });
}

/**
 * Accounting closures that register into engine.nodes / engine.sources and every Set of
 * `owners` ({ nodes, sources } records: the handle and the runtime totals).
 */
export function createAccounting(hooks, owners) {
  const { engine } = hooks;
  const untrack = (n) => {
    engine.nodes.delete(n);
    engine.sources.delete(n);
    for (const o of owners) {
      o.nodes.delete(n);
      o.sources.delete(n);
    }
  };
  const track = (n) => {
    engine.nodes.add(n);
    for (const o of owners) o.nodes.add(n);
    return n;
  };
  const source = (n) => {
    track(n);
    engine.sources.add(n);
    for (const o of owners) o.sources.add(n);
    if (typeof n.addEventListener === 'function') {
      n.addEventListener('ended', () => {
        try { n.disconnect(); } catch (e) { /* already disconnected */ }
        untrack(n);
      });
    }
    return n;
  };
  return { track, source, untrack };
}

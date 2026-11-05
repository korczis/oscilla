// A microphone capture io on a stub Web Audio context (C033), shared by
// measure-stimulus-emits.test.mjs and measure-audio-session-paths.test.mjs; not a test file
// itself. The stub records the graph (every node's connections, every buffer source started),
// renders the input from what is sounding, and exposes the window, document and engine
// listeners the io registers, so a test can raise pagehide, a hidden document or a context
// state change at a point it names by a condition, never by a count of ticks.
import assert from 'node:assert/strict';

import { createCaptureIo } from '../../../src/js/measurement/capture.js';

export const SR = 48000;
export const BLOCK = 2048;
export const RECIPE = { stimulus: { kind: 'log-sweep', duration: 2, level: 0.25, f1: 20,
  f2: 20000, fade: 0.01 }, repeats: 1, analysis: { noiseCheckS: 0, preRollS: 0.1,
  postRollS: 0.2, gapS: 0.2 } };

/** Wall-clock deadline of one drive or wait: a stalled io fails by name, not by hanging. */
export const DRIVE_DEADLINE_MS = 20000;

const macrotask = () => new Promise((r) => { setImmediate(r); });

/**
 * Polls `cond` once per macrotask until it holds; fails naming `what` after `ms` of wall clock.
 */
export async function until(cond, what, ms = DRIVE_DEADLINE_MS) {
  const deadline = Date.now() + ms;
  while (!cond()) {
    assert.ok(Date.now() < deadline, `${what} within ${ms} ms of wall clock`);
    await macrotask();
  }
}

/**
 * navigator.audioSession as WebKit has it: a `type` the page reads and sets. `sets` records
 * every assignment; `refuse(v)` makes the setter throw for that value.
 */
export function audioSession(initial = 'playback', { refuse = null } = {}) {
  const sets = [];
  let type = initial;
  return {
    sets,
    get type() { return type; },
    set type(v) {
      sets.push(v);
      if (refuse && refuse(v)) throw new Error(`refused ${v}`);
      type = v;
    },
  };
}

/**
 * The rig. engine.master → engine.analyser → ctx.destination, as the AudioEngine's chain ends.
 * The input renders `background` while no started source sounds and `heard` while one does
 * (heard: null = the input never hears the output). Options:
 *   session        the navigator.audioSession stand-in (null: the API is absent)
 *   refuse         an error getUserMedia throws
 *   gum(stream)    replaces getUserMedia's answer (a pending prompt: a promise held open)
 *   abortOnHidden  passed to createCaptureIo
 *   timeout(ms)    maps the io's setTimeout delays (the watchdog test shortens them)
 */
export function rig({ background = 0.001, heard = 0.1, session = null, refuse = null,
  gum = null, abortOnHidden = false, timeout = (ms) => ms } = {}) {
  const listeners = { engine: [], win: {}, doc: {} };
  const ctl = { stall: false, gumCalls: 0 };
  let sp = null;
  const started = [];
  const node = (kind, extra = {}) => {
    // `out`: every connection the node was ever given (cleanup disconnects them later).
    const n = { kind, out: new Set(), live: new Set(),
      connect(to) { n.out.add(to); n.live.add(to); return to; },
      disconnect(to) { if (to) n.live.delete(to); else n.live.clear(); }, ...extra };
    return n;
  };
  const ctx = {
    state: 'running', sampleRate: SR, currentTime: 1, destination: node('destination'),
    createGain: () => node('gain', { gain: { value: 1, setValueAtTime() {},
      linearRampToValueAtTime() {} } }),
    createScriptProcessor: () => { sp = node('scriptprocessor', { onaudioprocess: null });
      return sp; },
    createMediaStreamSource: () => node('mic'),
    createBuffer: (ch, length, rate) => {
      const data = new Float32Array(length);
      return { length, sampleRate: rate, duration: length / rate,
        copyToChannel: (x) => data.set(x), getChannelData: () => data };
    },
    createBufferSource: () => {
      const src = node('buffersource', { buffer: null, onended: null, when: null, stopped: null,
        start(when = 0) { src.when = when; started.push(src); },
        stop(when = 0) { src.stopped = when; } });
      return src;
    },
  };
  const analyser = node('analyser');
  analyser.connect(ctx.destination);
  const master = node('master', { gain: { value: 0.08 } });
  master.connect(analyser);
  const engine = { ctx, master, analyser, voices: new Set(), nodes: new Set(),
    sources: new Set(), gainLevel: 0.08, init: () => true, isSupported: () => true,
    resume: async () => {}, stops: 0, stopAll() { engine.stops += 1; },
    on: (fn) => { listeners.engine.push(fn); return () => {}; },
    audibleVoiceCountAt: () => 0, audibleVoiceCount: 0 };
  const track = { label: 'Stub mic', readyState: 'live', onended: null, stop() {
    track.readyState = 'ended'; }, getSettings: () => ({ echoCancellation: false,
    noiseSuppression: false, autoGainControl: false, sampleRate: SR, channelCount: 1 }) };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const seen = { sessionAtOpen: null };
  const env = {
    navigator: {
      audioSession: session,
      mediaDevices: { getUserMedia: async () => {
        ctl.gumCalls += 1;
        seen.sessionAtOpen = session ? session.type : null;
        if (gum) return gum(stream);
        if (refuse) throw refuse;
        return stream;
      } },
      permissions: { query: async () => ({ state: 'granted' }) },
    },
    addEventListener: (t, fn) => { listeners.win[t] = fn; },
    removeEventListener: () => {},
    document: { hidden: false, addEventListener: (t, fn) => { listeners.doc[t] = fn; },
      removeEventListener: () => {} },
    setTimeout: (fn, ms) => setTimeout(fn, timeout(ms)),
    clearTimeout: (id) => clearTimeout(id),
  };
  const io = createCaptureIo({ engine, env, mode: 'scriptprocessor', abortOnHidden });
  const sounding = (t) => started.some((s) => s.buffer && t >= s.when
    && t < s.when + s.buffer.duration && s.stopped === null);
  /**
   * Runs `p` while the audio clock advances one block per macrotask and the input renders
   * (none while ctl.stall). `poke` is called once, the first time `at()` holds.
   */
  async function drive(p, { at = null, poke = null } = {}) {
    let settled = false;
    let poked = !at;
    p.then(() => { settled = true; }, () => { settled = true; });
    let frame = Math.round(ctx.currentTime * SR);
    const deadline = Date.now() + DRIVE_DEADLINE_MS;
    while (!settled && Date.now() < deadline) {
      await macrotask();
      if (!poked && at()) { poked = true; poke(); }
      frame += BLOCK;
      ctx.currentTime = frame / SR;
      if (sp && sp.onaudioprocess && !ctl.stall) {
        const t0 = (frame - BLOCK) / SR;
        const level = heard !== null && sounding(t0) ? heard : background;
        const data = new Float32Array(BLOCK).fill(level);
        sp.onaudioprocess({ inputBuffer: { getChannelData: () => data },
          playbackTime: frame / SR });
      }
    }
    assert.ok(settled, `the io settled within ${DRIVE_DEADLINE_MS} ms of wall clock`);
    if (at) assert.ok(poked, 'the drive reached the point it was asked to poke at');
    return p;
  }
  /** Did `from` reach the context's destination through the connections it was given? */
  function reachesDestination(from) {
    const seenNodes = new Set();
    const stack = [from];
    while (stack.length) {
      const n = stack.pop();
      if (n === ctx.destination) return true;
      if (!n || seenNodes.has(n)) continue;
      seenNodes.add(n);
      for (const m of n.out || []) stack.push(m);
    }
    return false;
  }
  const path = (from) => {
    const names = [];
    let n = from;
    while (n && names.length < 8) {
      names.push(n.kind);
      n = [...(n.out || [])][0];
    }
    return names.join(' -> ');
  };
  return { io, engine, ctx, env, drive, started, reachesDestination, path, seen, listeners,
    track, stream, ctl };
}

/** A promise's outcome as a value: { ok, v } or { ok: false, e }. */
export const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

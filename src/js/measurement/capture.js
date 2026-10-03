// Browser capture and playback for the MeasurementEngine: the `io` adapter of engine.js on top
// of the existing AudioEngine (spec §11-§13, §52, §87, §111, §169, §207-§213; ADR 0018, 0026).
//
// Playback (PlaybackSession): the rendered stimulus is one AudioBufferSourceNode started at a
// scheduled AudioContext time, through a gain stage that is constant 1 except for a click-free
// abort fade, into engine.master. It passes the whole master safety chain:
//
//   stimulus → fade gain → master (engine.gainLevel ≤ MAX_OUTPUT_GAIN = 0.25)
//            → limiter (DynamicsCompressor, threshold −3 dBFS, ratio 20, knee 0)
//            → trim (cancels the compressor's automatic makeup gain)
//            → ceiling (WaveShaper: identity up to ±0.25, flat beyond) → analyser → destination
//
// Effect of the chain on a measurement (§207, gap G12) — decided: the chain is PART of the
// measured system and is not compensated; it is never bypassed. The stimulus peak is `level`
// ≤ 1 (digital, MEASUREMENT_LEVELS, never SPL, §208) times the master gain ≤ 0.25, so it never
// exceeds the ceiling (identity below ±0.25, exact under linear curve interpolation) and stays
// ≥ 9 dB below the limiter threshold. Measured with the loopback taps (tests/browser/
// v3-measure.cjs, post-chain minus pre-limiter, 2 s sweep): Chromium 153 and WebKit 26.6 are
// transparent (≤ 0.0002 dB, 20 Hz-20 kHz) at peaks 0.02 and 0.25. Firefox 155's
// DynamicsCompressor is transparent over 20 Hz-20 kHz (≤ 0.0002 dB) up to a 0.1 peak (−20 dBFS)
// since the engine feeds it a constant 0 (audio-engine.js feedLimiter): without that feed Gecko
// skips the compressor's look-ahead line on silent input, so a sound's last 6 ms were cut off
// and replayed at the start of the next sound (the earlier "+5.8 dB at 19.9 kHz" here was the
// previous run's 20 kHz fade-out tail replayed at each run's onset, and an aborted run's fade
// tail made the next run INVALID with a DISCONTINUITY at the scheduled onset). At a 0.25 peak
// it still compresses ≥ 8 kHz by up to 4.8 dB although the signal is below its threshold (its
// detector apparently sees pre-emphasized highs). Hence the engine warns (LIMITER_RANGE) when
// level × master gain exceeds PREFLIGHT_THRESHOLDS.limiterTransparentPeak = 0.1; the default
// (0.25 × 0.08 = 0.02) is well inside. The compressor adds its look-ahead delay (288 frames =
// 6 ms at 48 kHz in all three engines), which alignment absorbs. The measured transfer includes the master gain:
// 20·log10(engine.gainLevel) dB on top of the acoustic path.
//
// Capture (CaptureSession): mono PCM from a MediaStreamAudioSourceNode (getUserMedia with
// echoCancellation, noiseSuppression and autoGainControl requested false, §209) recorded by an
// AudioWorklet loaded from a data: URL (inline source CAPTURE_WORKLET_SOURCE; a data: URL loads
// on file:// in every target browser where a blob: worklet does not in Chromium, ADR 0012;
// verify-dist rejects any worklet loaded from a path). The processor is frame-indexed (its own
// quantum count anchored at currentFrame, see CAPTURE_WORKLET_SOURCE), zero-fills quanta whose
// input is empty (Firefox delivers no channels while upstream is silent), records only inside an armed [startFrame, endFrame) window and posts
// transferable chunks; the main thread writes each chunk at its frame offset into ONE
// preallocated Float32Array per capture, so memory is bounded by the capture length and a lost
// or late chunk shows up as missing frames (integrity) instead of shifted audio. Capture start
// and stop are therefore sample-exact on the audio clock: pre-roll before the stimulus and
// post-roll after it (§216) are frame counts, not timers.
//
// Fallback (documented, ADR 0026): if AudioWorklet is unavailable or its module fails to load,
// a ScriptProcessorNode records instead. Its input block is placed on the timeline at
// round(playbackTime · sr) − bufferSize (the block that ends where the next output block
// starts). Measured in loopback: exact in Firefox 155; Chromium 153 and WebKit 26.6 deliver the
// block one buffer earlier (the stimulus appears 2048 frames late in the capture), which the
// ≥ 50 ms pre-roll covers and the cross-correlation alignment absorbs (§212). ScriptProcessor
// is deprecated and loses blocks (WebKit on file:// lost 256 frames in 4 discontinuities over
// 20 s): the integrity count reports such losses and the engine marks the run INVALID.
//
// Applied constraints are read back with track.getSettings() (null for anything the browser
// does not report, §210), so a result can say "Input processing may have been applied by
// browser/device." The device label is the track's label only when the browser exposes one,
// else null (§52); nothing is invented.
//
// Cleanup (§111, §169): cancel() (engine abort, error, completion), Escape (engine.stopAll is
// wrapped on the instance while this io is attached), pagehide / hidden document and a closed
// or suspended context stop the stimulus with a 10 ms linear fade (rule
// audio-engine-discipline: no hard gain switch), reject the pending capture, disarm and close
// the worklet port, disconnect every node, and stop every track. All nodes are registered in
// this io's counters AND in engine.nodes / engine.sources, so the engine's own node accounting
// sees them; after cleanup both are zero (sources once their fade has ended).
//
// Live input tap (spec §44-§45, §123; docs/v3/ui-integration.md "Live RTA"): openLiveTap()
// opens the SAME input as a measurement (getUserMedia through this io's permission path and
// constraints, or the TEST CONTEXT loopback) into one AnalyserNode, configured as the V2
// microphone analysis does (audio/microphone.js configureAnalyser), never connected to the
// destination. The caller reads its time-domain samples (analysis/analyser.js reader) and
// computes the spectrum itself (measurement/live-rta.js), so the analyser's own dB scaling and
// smoothing are never used. The tap is EXCLUSIVE with a measurement: it is refused (BUSY) while
// a capture or stimulus runs, and preflight()/captureNoise()/runStimulus() close it before they
// start. Every release path (cancel, dispose, Escape through the app, pagehide / hidden
// document, a track that ends, a closed context) closes it too and calls its onClosed(reason);
// closeLiveTap() also releases the input, so after it the io owns no node and no live track.
//
// Timers: none drives audio or progress. One watchdog setTimeout per capture detects a stalled
// or suspended audio thread (CAPTURE_TIMEOUT / CONTEXT_SUSPENDED); it reads the audio clock and
// only ever fails a capture. yield() uses a MessageChannel task between analysis steps.
//
// TEST CONTEXT: createLoopbackIo() replaces the microphone with a known synthetic system fed
// from the end of the master chain (engine.analyser → system → recorder). It exists for
// automated tests and the V307 spike only (§146, §249): its captures are flagged with
// testContext = { kind: 'digital-loopback', ... } and must never be presented as a measurement
// of a physical system.

import { MAX_OUTPUT_GAIN } from '../core/constants.js';
import {
  MIC_ANALYSER_FFT_SIZE, MIC_UNAVAILABLE_TEXT, configureAnalyser, hasMicrophoneApi,
  stopStreamTracks,
} from '../audio/microphone.js';
import { MeasurementError, mapError } from './engine.js';

export const CAPTURE_PROCESSOR_NAME = 'oscilla-capture-v1';
/** Frames per posted chunk (≈ 43 ms at 48 kHz): progress cadence and message overhead. */
export const CAPTURE_CHUNK_FRAMES = 2048;
/** ScriptProcessor block size of the fallback. */
export const SCRIPT_PROCESSOR_FRAMES = 2048;
/** A capture starts at least this far ahead of the audio clock (worklet arm latency). */
export const SCHEDULE_LEAD_S = 0.1;
/** Stimulus fade on abort (linear, from the constant 1 of the fade gain). */
export const ABORT_FADE_S = 0.01;
/** Input level read during preflight. */
export const PREFLIGHT_LEVEL_S = 0.3;
/** Extra wall-clock allowance before a capture is declared stalled. */
export const WATCHDOG_SLACK_MS = 2500;

/** Requested input constraints (§209); the applied ones are read back per track. */
export const REQUESTED_AUDIO_CONSTRAINTS = Object.freeze({
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: Object.freeze({ ideal: 1 }),
});

/** Clock corrections a processor reports at most (diagnostics; the correction never stops). */
export const CLOCK_NOTE_LIMIT = 32;

/**
 * The capture processor (AudioWorkletGlobalScope source). Messages in: { type: 'arm', id,
 * start, end } (frames), { type: 'disarm' }, { type: 'stop' }. Messages out: { type: 'chunk',
 * id, frame, data: Float32Array (transferred) }, { type: 'done', id, frame }, { type: 'armed',
 * id, frame } (the frame at which the arm arrived) and { type: 'clock', id, reported, expected,
 * frame } (a corrected currentFrame reading; id -1 while unarmed).
 *
 * Frame index: the processor's OWN count of the quanta it processed, anchored at the first
 * currentFrame it sees, and moved forward to currentFrame only when the clock is ahead of the
 * count: frame = max(currentFrame, previous frame + quantum). Chromium 153 under CPU load
 * reports a stale currentFrame for one quantum (the sequence F, F, F + 256 over three process()
 * calls, each with fresh input: measured, tests/browser/v3-measure.cjs); labelling chunks with
 * the raw value wrote the second quantum over the first and left a 128-frame hole, which the
 * integrity check rightly called FRAMES_MISSING. A lagging reading leaves the count, i.e. the
 * true index, unchanged; a reading ahead of the count is a quantum this node did not process and
 * stays a real gap, reported as missing frames (never silently relabelled audio).
 */
export const CAPTURE_WORKLET_SOURCE = `
class OscillaCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.size = o.chunkFrames || ${CAPTURE_CHUNK_FRAMES};
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.f0 = 0;
    this.id = -1;
    this.start = 0;
    this.end = 0;
    this.armed = false;
    this.alive = true;
    this.next = null; // the frame index of the next quantum (own count)
    this.notes = 0;
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'arm') {
        this.id = m.id; this.start = m.start; this.end = m.end; this.n = 0; this.armed = true;
        this.port.postMessage({ type: 'armed', id: m.id,
          frame: this.next === null ? currentFrame : this.next });
      } else if (m.type === 'disarm') {
        this.armed = false; this.n = 0;
      } else if (m.type === 'stop') {
        this.armed = false; this.alive = false; this.port.onmessage = null; this.port.close();
      }
    };
  }
  flush() {
    if (this.n > 0) {
      const data = this.buf.slice(0, this.n);
      this.port.postMessage({ type: 'chunk', id: this.id, frame: this.f0, data }, [data.buffer]);
      this.f0 += this.n;
      this.n = 0;
    }
  }
  process(inputs) {
    if (!this.alive) return false;
    const input = inputs[0];
    const ch = input && input.length ? input[0] : null;
    const len = ch ? ch.length : 128;
    const reported = currentFrame;
    const expected = this.next;
    const frame = expected === null || reported > expected ? reported : expected;
    if (expected !== null && reported !== expected && this.notes < ${CLOCK_NOTE_LIMIT}) {
      this.notes += 1;
      this.port.postMessage({ type: 'clock', id: this.armed ? this.id : -1, reported, expected,
        frame });
    }
    this.next = frame + len;
    if (!this.armed) return true;
    const a = Math.max(frame, this.start);
    const b = Math.min(frame + len, this.end);
    if (b > a) {
      if (this.n > 0 && a !== this.f0 + this.n) this.flush();
      if (this.n === 0) this.f0 = a;
      let off = a - frame;
      let cnt = b - a;
      while (cnt > 0) {
        const k = Math.min(cnt, this.size - this.n);
        if (ch) this.buf.set(ch.subarray(off, off + k), this.n);
        else this.buf.fill(0, this.n, this.n + k);
        this.n += k; off += k; cnt -= k;
        if (this.n === this.size) this.flush();
      }
    }
    if (frame + len >= this.end) {
      this.flush();
      this.port.postMessage({ type: 'done', id: this.id, frame: frame + len });
      this.armed = false;
    }
    return true;
  }
}
registerProcessor('${CAPTURE_PROCESSOR_NAME}', OscillaCapture);
`;

/** data: URL of the processor (never a path or blob: — ADR 0012, single-file-deliverable). */
export function workletDataUrl(source = CAPTURE_WORKLET_SOURCE) {
  return `data:application/javascript;charset=utf-8,${encodeURIComponent(source)}`;
}

const workletLoads = new WeakMap(); // AudioContext → Promise of addModule

/** Load the capture processor into ctx once; resolves true or rejects with the load error. */
export function loadCaptureWorklet(ctx) {
  if (!ctx || !ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function')
    return Promise.reject(new Error('AudioWorklet is not available in this context'));
  let p = workletLoads.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(workletDataUrl()).then(() => true);
    workletLoads.set(ctx, p);
    p.catch(() => workletLoads.delete(ctx));
  }
  return p;
}

/**
 * readAppliedConstraints(track) → { echoCancellation, noiseSuppression, autoGainControl,
 *   sampleRate, channelCount, latency, deviceId } with null for anything not reported.
 */
export function readAppliedConstraints(track) {
  let s = {};
  try { s = (track && typeof track.getSettings === 'function' && track.getSettings()) || {}; }
  catch (e) { s = {}; }
  const bool = (k) => (typeof s[k] === 'boolean' ? s[k] : null);
  const num = (k) => (typeof s[k] === 'number' && Number.isFinite(s[k]) ? s[k] : null);
  return {
    echoCancellation: bool('echoCancellation'),
    noiseSuppression: bool('noiseSuppression'),
    autoGainControl: bool('autoGainControl'),
    sampleRate: num('sampleRate'),
    channelCount: num('channelCount'),
    latency: num('latency'),
    deviceId: typeof s.deviceId === 'string' && s.deviceId ? s.deviceId : null,
  };
}

function plainRequested(deviceId) {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 1 },
    deviceId: deviceId ? { exact: deviceId } : null,
  };
}

const defaultEnv = () => (typeof window !== 'undefined' ? window : globalThis);

function makeYield(env) {
  const MC = env.MessageChannel || globalThis.MessageChannel;
  if (typeof MC === 'function') {
    return () => new Promise((resolve) => {
      const ch = new MC();
      ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
      ch.port2.postMessage(0);
    });
  }
  return () => new Promise((resolve) => env.setTimeout(resolve, 0));
}

// ------------------------------------------------------------------------------- core

/**
 * Shared implementation of the microphone io and the loopback io.
 * `openInput(ctx, { register, unregister })` returns { node, device, constraints, close(),
 * liveTracks(), testContext? }; close() must unregister every node it registered.
 */
function createIoCore({ engine, env = defaultEnv(), mode = 'auto', openInput, kind,
  testContext = null, abortOnHidden = true }) {
  if (!engine || typeof engine.init !== 'function')
    throw new TypeError('capture io needs the AudioEngine');
  const nodes = new Set();
  const sources = new Set();
  const windows = new Map(); // capture id → window
  const stims = new Set();
  let input = null;
  let inputPending = null;
  let recorder = null;
  let recorderMode = null;
  let workletError = null;
  let epoch = 0;
  let nextId = 1;
  let disposed = false;
  let origStopAll = null;
  let stopAllWrapper = null;
  let live = null; // the live input tap: { analyser, sampleRate, onClosed }

  const io = {};

  // ---- accounting (also visible in the engine's counters)
  const register = (n) => { nodes.add(n); engine.nodes.add(n); return n; };
  const registerSource = (n) => {
    register(n); sources.add(n); engine.sources.add(n); return n;
  };
  const unregister = (n) => {
    try { n.disconnect(); } catch (e) { /* already disconnected */ }
    nodes.delete(n); engine.nodes.delete(n);
    if (sources.delete(n)) engine.sources.delete(n);
  };

  const busy = () => windows.size > 0 || stims.size > 0;

  // ---- live input tap (see the header): drop it, keeping the input for a measurement.
  function dropLive(reason) {
    if (!live) return;
    const l = live;
    live = null;
    unregister(l.analyser);
    if (typeof l.onClosed === 'function') {
      try { l.onClosed(reason); } catch (e) { /* the caller's cleanup must not break ours */ }
    }
  }

  function interrupt(info) {
    if (!busy() && !input) return;
    const was = busy();
    if (typeof io.onInterrupt === 'function' && was) {
      try { io.onInterrupt(info); } catch (e) { /* engine handles it */ }
    }
    const err = info.code === 'ABORTED'
      ? new MeasurementError('ABORTED', undefined, { detail: info })
      : new MeasurementError(info.code, info.message, { detail: info });
    release(err);
  }

  // ---- Escape: the app's existing STOP/Escape calls engine.stopAll(); while this io is
  // attached that also aborts a running capture (instance wrapper, removed by dispose()).
  function wrapStopAll() {
    if (stopAllWrapper) return;
    origStopAll = engine.stopAll;
    stopAllWrapper = function stopAllWithMeasurement(...args) {
      if (busy()) interrupt({ code: 'ABORTED', reason: 'escape' });
      return origStopAll.apply(this, args);
    };
    engine.stopAll = stopAllWrapper;
  }
  function unwrapStopAll() {
    if (stopAllWrapper && engine.stopAll === stopAllWrapper) engine.stopAll = origStopAll;
    stopAllWrapper = null;
  }
  const silenceVoices = () => {
    const fn = origStopAll || engine.stopAll;
    try { fn.call(engine); } catch (e) { /* nothing playing */ }
  };

  // ---- page leave and context state (§169)
  const onPageHide = () => interrupt({ code: 'ABORTED', reason: 'pagehide' });
  const onVisibility = () => {
    const doc = env.document;
    if (abortOnHidden && doc && doc.hidden) interrupt({ code: 'ABORTED', reason: 'hidden' });
  };
  if (typeof env.addEventListener === 'function') {
    env.addEventListener('pagehide', onPageHide);
    if (env.document && typeof env.document.addEventListener === 'function')
      env.document.addEventListener('visibilitychange', onVisibility);
  }
  const offEngine = typeof engine.on === 'function' ? engine.on((type, detail) => {
    if (type !== 'context') return;
    if (detail === 'closed') {
      interrupt({ code: 'CONTEXT_SUSPENDED', reason: 'closed',
        message: 'The audio context was closed.' });
      recorder = null;
      recorderMode = null;
    } else if ((detail === 'suspended' || detail === 'interrupted') && busy()) {
      interrupt({ code: 'CONTEXT_SUSPENDED', reason: detail });
    }
  }) : () => {};

  // ---- context
  async function ensureContext({ requireRunning }) {
    if (disposed) throw new MeasurementError('INTERNAL', 'The capture io is disposed.');
    if (typeof engine.isSupported === 'function' && !engine.isSupported())
      throw new MeasurementError('UNSUPPORTED');
    if (!engine.init()) {
      throw new MeasurementError('UNSUPPORTED', engine.lastError && engine.lastError.message);
    }
    if (engine.ctx.state !== 'running') {
      try { await engine.resume(); } catch (e) { /* reported below */ }
    }
    const ctx = engine.ctx;
    if (requireRunning && ctx.state !== 'running') throw new MeasurementError('CONTEXT_SUSPENDED');
    return ctx;
  }

  // ---- recorder
  async function ensureRecorderMode(ctx) {
    if (recorderMode) return recorderMode;
    if (mode !== 'scriptprocessor') {
      try {
        await loadCaptureWorklet(ctx);
        recorderMode = 'audioworklet';
        return recorderMode;
      } catch (e) {
        workletError = e;
        if (mode === 'worklet')
          throw new MeasurementError('UNSUPPORTED_WORKLET', `AudioWorklet failed: ${e.message}`);
      }
    }
    if (typeof ctx.createScriptProcessor === 'function') {
      recorderMode = 'scriptprocessor';
      return recorderMode;
    }
    throw new MeasurementError('UNSUPPORTED_WORKLET');
  }

  function buildRecorder(ctx, source) {
    const sr = ctx.sampleRate;
    const sink = register(ctx.createGain());
    sink.gain.value = 0; // pulls the recorder; carries silence only
    let node;
    let port = null;
    const deliver = (id, frame, data) => {
      const w = windows.get(id);
      if (w) writeWindow(w, frame, data);
    };
    const finish = (id) => {
      const w = windows.get(id);
      if (w) completeWindow(w);
    };
    let armed = null; // scriptprocessor window
    if (recorderMode === 'audioworklet') {
      node = register(new AudioWorkletNode(ctx, CAPTURE_PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1,
        channelCountMode: 'explicit', channelInterpretation: 'speakers',
        processorOptions: { chunkFrames: CAPTURE_CHUNK_FRAMES },
      }));
      port = node.port;
      port.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'chunk') deliver(m.id, m.frame, m.data);
        else if (m.type === 'done') finish(m.id);
        else if (m.type === 'clock') {
          clockNotes.push({ id: m.id, reported: m.reported, expected: m.expected,
            frame: m.frame });
          if (clockNotes.length > CLOCK_NOTE_LIMIT) clockNotes.shift();
          const w = windows.get(m.id);
          if (w) w.clockCorrections += 1;
        } else if (m.type === 'armed') {
          const w = windows.get(m.id);
          if (w) w.armedAtFrame = m.frame;
        }
      };
    } else {
      node = register(ctx.createScriptProcessor(SCRIPT_PROCESSOR_FRAMES, 1, 1));
      node.onaudioprocess = (e) => {
        if (!armed) return;
        const data = e.inputBuffer.getChannelData(0);
        const frame = Math.round(e.playbackTime * sr) - data.length;
        const w = armed;
        deliver(w.id, frame, data);
        if (frame + data.length >= w.endFrame && windows.get(w.id)) finish(w.id);
      };
    }
    source.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);
    return {
      mode: recorderMode,
      source,
      get portOpen() { return !!port; },
      arm(w) {
        if (port) port.postMessage({ type: 'arm', id: w.id, start: w.startFrame,
          end: w.endFrame });
        else armed = w;
      },
      disarm() {
        if (port) port.postMessage({ type: 'disarm' });
        armed = null;
      },
      dispose() {
        if (port) {
          try { port.postMessage({ type: 'stop' }); } catch (e) { /* closed */ }
          port.onmessage = null;
          try { port.close(); } catch (e) { /* closed */ }
          port = null;
        } else {
          node.onaudioprocess = null;
        }
        armed = null;
        try { source.disconnect(node); } catch (e) { /* gone */ }
        unregister(node);
        unregister(sink);
      },
    };
  }

  // ---- capture windows
  function writeWindow(w, frame, data) {
    const a = Math.max(frame, w.startFrame);
    const b = Math.min(frame + data.length, w.endFrame);
    if (b <= a) return;
    if (w.firstFrame === null) w.firstFrame = a;
    if (a !== w.next) {
      w.discontinuities += 1;
      if (w.gaps.length < 8) w.gaps.push({ at: a, expected: w.next });
      if (a < w.next) w.received -= Math.min(w.next, b) - a; // overlap: rewritten frames
    }
    w.samples.set(data.subarray(a - frame, b - frame), a - w.startFrame);
    w.received += b - a;
    w.next = b;
    if (w.onChunk) {
      try { w.onChunk({ frames: w.received, framesTotal: w.frames }); }
      catch (e) { /* progress is feedback only */ }
    }
  }

  // Bounded record of the last capture windows (diagnostics(): frame timing per window).
  const recent = [];
  const clockNotes = [];
  function remember(w, outcome) {
    recent.push({ id: w.id, outcome, startFrame: w.startFrame, frames: w.frames,
      scheduledAtFrame: w.scheduledAtFrame, armedAtFrame: w.armedAtFrame,
      firstFrame: w.firstFrame, received: w.received, discontinuities: w.discontinuities,
      clockCorrections: w.clockCorrections, gaps: w.gaps.slice() });
    if (recent.length > 8) recent.shift();
  }

  function completeWindow(w) {
    remember(w, 'complete');
    windows.delete(w.id);
    if (w.watchdog) env.clearTimeout(w.watchdog);
    w.resolve(w);
  }

  function failWindow(w, err) {
    remember(w, err && err.code ? err.code : 'failed');
    windows.delete(w.id);
    if (w.watchdog) env.clearTimeout(w.watchdog);
    w.reject(err);
  }

  function armWatchdog(w, ctx) {
    const endS = w.endFrame / ctx.sampleRate;
    const started = Date.now();
    const limitMs = (endS - ctx.currentTime) * 2000 + 4 * WATCHDOG_SLACK_MS;
    const check = () => {
      w.watchdog = null;
      if (!windows.has(w.id)) return;
      if (ctx.state !== 'running') {
        release(new MeasurementError('CONTEXT_SUSPENDED'));
        return;
      }
      if (ctx.currentTime < endS + 0.5 && Date.now() - started < limitMs) {
        w.watchdog = env.setTimeout(check, Math.max(250,
          (endS - ctx.currentTime) * 1000 + WATCHDOG_SLACK_MS));
        return;
      }
      release(new MeasurementError('CAPTURE_TIMEOUT', `Capture ended at ${w.received} of `
        + `${w.frames} frames.`));
    };
    w.watchdog = env.setTimeout(check, Math.max(250, (endS - ctx.currentTime) * 1000
      + WATCHDOG_SLACK_MS));
  }

  function openWindow(ctx, startFrame, frames, onChunk) {
    let samples;
    try {
      samples = new Float32Array(frames);
    } catch (e) {
      throw mapError(e, 'MEMORY_LIMIT');
    }
    const w = { id: nextId++, startFrame, endFrame: startFrame + frames, frames, samples,
      received: 0, next: startFrame, discontinuities: 0, onChunk, watchdog: null,
      scheduledAtFrame: Math.round(ctx.currentTime * ctx.sampleRate), armedAtFrame: null,
      firstFrame: null, clockCorrections: 0, gaps: [] };
    const promise = new Promise((resolve, reject) => { w.resolve = resolve; w.reject = reject; });
    windows.set(w.id, w);
    recorder.arm(w);
    armWatchdog(w, ctx);
    return promise;
  }

  // ---- input
  // `since` is the session epoch the caller started in: a cancel() (release) while the caller
  // was awaiting the context or the worklet module bumps the epoch, and nothing may be opened
  // for a session that was already released (the input and the recorder would leak).
  const abortedSince = (since) => since !== epoch || disposed;
  async function ensureInput(ctx, since = epoch) {
    if (abortedSince(since)) throw new MeasurementError('ABORTED');
    if (input) return input;
    if (inputPending) return inputPending;
    const my = since;
    inputPending = (async () => {
      const opened = await openInput(ctx, { register, unregister });
      if (my !== epoch || disposed) {
        try { opened.close(); } catch (e) { /* ignore */ }
        throw new MeasurementError('ABORTED');
      }
      opened.onEnded = (info) => interrupt(info);
      input = opened;
      return input;
    })();
    try {
      return await inputPending;
    } finally {
      inputPending = null;
    }
  }

  async function ensureReady({ requireRunning = true, since = epoch } = {}) {
    dropLive('measurement'); // exclusive: a capture never runs beside the live tap
    const ctx = await ensureContext({ requireRunning });
    if (abortedSince(since)) throw new MeasurementError('ABORTED');
    await ensureRecorderMode(ctx);
    const inp = await ensureInput(ctx, since);
    if (abortedSince(since)) throw new MeasurementError('ABORTED');
    if (!recorder) recorder = buildRecorder(ctx, inp.node);
    wrapStopAll();
    return ctx;
  }

  // Firefox 155 freezes AudioContext.currentTime for the whole task, microtasks included
  // (measured: after 50/150/300 ms of synchronous work in one task it still reads the value
  // from the task's start; Chromium and WebKit read the live clock). A window scheduled at
  // currentTime + SCHEDULE_LEAD_S after more than ~0.1 s of work in the same task (the noise
  // summary, UI updates, the previous run's checks) starts in the past: the worklet is armed
  // after its start frame and the run is INVALID with FRAMES_MISSING (200 ms of work: 4864
  // frames missing, 1 discontinuity, the worklet armed 4864 frames late). So every window is
  // scheduled from the clock read at the start of a NEW task.
  const nextTask = makeYield(env);
  async function freshClock(since) {
    await nextTask();
    if (abortedSince(since)) throw new MeasurementError('ABORTED');
  }

  const quantum = (sr) => 128 / sr;
  const ceilFrame = (t, sr) => Math.ceil((t * sr) / 128 - 1e-9) * 128;

  function captureObject(ctx, w, extra) {
    return {
      sampleRate: ctx.sampleRate,
      samples: w.samples,
      startedAt: w.startFrame / ctx.sampleRate,
      constraints: input ? input.constraints : { requested: null, applied: null },
      device: input ? input.device : { label: null, id: null },
      integrity: { expectedFrames: w.frames, receivedFrames: w.received,
        discontinuities: w.discontinuities, timing: { scheduledAtFrame: w.scheduledAtFrame,
          startFrame: w.startFrame, armedAtFrame: w.armedAtFrame, firstFrame: w.firstFrame,
          clockCorrections: w.clockCorrections, gaps: w.gaps.slice() } },
      mode: recorderMode,
      testContext: input && input.testContext ? input.testContext : testContext,
      ...extra,
    };
  }

  // ---- stimulus
  function stopStim(st, ctx, { fade }) {
    if (st.done || st.stopping) return;
    st.stopping = true;
    const now = ctx.currentTime;
    if (!fade || ctx.state !== 'running' || now < st.startAt - 0.002) {
      // Not started (or nothing renders): it never sounds, free it now.
      try { st.src.stop(); } catch (e) { /* not started / stopped */ }
      cleanupStim(st);
      return;
    }
    const t = Math.ceil((now + 2 * quantum(ctx.sampleRate)) * ctx.sampleRate / 128) * 128
      / ctx.sampleRate;
    try {
      st.fade.gain.setValueAtTime(1, t); // constant 1 until now: holding it is exact
      st.fade.gain.linearRampToValueAtTime(0, t + ABORT_FADE_S);
      st.src.stop(t + ABORT_FADE_S + 0.002);
    } catch (e) {
      cleanupStim(st);
      return;
    }
    // Normally freed by onended; this bookkeeping fallback frees it if an engine never fires it.
    env.setTimeout(() => cleanupStim(st), Math.max(100, (t - now + ABORT_FADE_S) * 1000 + 250));
  }

  function cleanupStim(st) {
    if (st.done) return;
    st.done = true;
    st.src.onended = null;
    unregister(st.src);
    unregister(st.fade);
    stims.delete(st);
  }

  // ---- release everything of the current session
  function release(err) {
    epoch += 1;
    const info = err && err.detail;
    dropLive(info && info.reason ? info.reason : (err && err.code) || 'released');
    const ctx = engine.ctx;
    for (const w of [...windows.values()]) failWindow(w, err || new MeasurementError('ABORTED'));
    if (recorder) {
      try { recorder.disarm(); } catch (e) { /* closed */ }
      recorder.dispose();
      recorder = null;
    }
    if (input) {
      const inp = input;
      input = null;
      try { inp.close(); } catch (e) { /* ignore */ }
    }
    for (const st of [...stims]) {
      if (ctx) stopStim(st, ctx, { fade: true });
      else cleanupStim(st);
    }
  }

  // ---- the io (defineProperties, not Object.assign: the getters must stay live)
  Object.defineProperties(io, Object.getOwnPropertyDescriptors({
    kind,
    onInterrupt: null,
    get sampleRate() { return engine.ctx ? engine.ctx.sampleRate : null; },
    get mode() { return recorderMode; },
    get workletError() { return workletError ? String(workletError.message || workletError)
      : null; },
    /** Nodes this io currently owns (also counted in engine.nodes). */
    get activeNodeCount() { return nodes.size; },
    get activeSourceCount() { return sources.size; },
    get activeCaptureCount() { return windows.size; },
    get openPortCount() { return recorder && recorder.portOpen ? 1 : 0; },
    get openTrackCount() { return input && input.liveTracks ? input.liveTracks() : 0; },
    get liveTapOpen() { return !!live; },
    now() { return engine.ctx ? engine.ctx.currentTime : 0; },
    yield: makeYield(env),
    /** Frame timing of the last (≤ 8) capture windows, for test diagnostics. */
    diagnostics() { return { mode: recorderMode, windows: recent.map((x) => ({ ...x })),
      clock: clockNotes.slice() }; },

    /**
     * openLiveTap({ fftSize, onClosed(reason) }) → { analyser, sampleRate, close() }
     * The live input tap (see the header). Opens the context and the input like preflight()
     * (in the user gesture: engine.init() first) and connects one AnalyserNode of fftSize
     * (default MIC_ANALYSER_FFT_SIZE) to it. BUSY while a capture or stimulus runs; ABORTED
     * when cancel() ran while the input was opening. A second call returns the open tap.
     * close() = closeLiveTap().
     */
    async openLiveTap({ fftSize = MIC_ANALYSER_FFT_SIZE, onClosed = null } = {}) {
      if (busy()) throw new MeasurementError('BUSY');
      const handle = () => ({ analyser: live.analyser, sampleRate: live.sampleRate,
        close: () => io.closeLiveTap() });
      if (live) return handle();
      const since = epoch;
      const ctx = await ensureContext({ requireRunning: true });
      if (abortedSince(since)) throw new MeasurementError('ABORTED');
      const inp = await ensureInput(ctx, since);
      if (abortedSince(since)) throw new MeasurementError('ABORTED');
      if (busy()) throw new MeasurementError('BUSY');
      if (live) return handle();
      const analyser = register(configureAnalyser(ctx.createAnalyser(), { fftSize }));
      inp.node.connect(analyser); // analysis only: never connected to the destination
      live = { analyser, sampleRate: ctx.sampleRate, onClosed };
      return handle();
    },

    /** Close the live tap and release the input (idempotent; no-op during a capture). */
    closeLiveTap() {
      if (!live) return false;
      if (busy()) {
        dropLive('stopped');
        return true;
      }
      release(new MeasurementError('ABORTED', undefined, { detail: { reason: 'stopped' } }));
      return true;
    },

    async preflight() {
      dropLive('measurement');
      const since = epoch;
      const facts = {
        audioContext: { available: true, state: null },
        sampleRate: null,
        permission: kind === 'loopback' ? 'not-required' : 'unknown',
        input: null,
        inputLevel: null,
        output: { gain: engine.gainLevel, maxGain: MAX_OUTPUT_GAIN,
          audibleVoices: engine.audibleVoiceCount || 0 },
        worklet: null,
        testContext,
      };
      let ctx;
      try {
        ctx = await ensureContext({ requireRunning: false });
      } catch (e) {
        facts.audioContext = { available: false, state: null };
        return facts;
      }
      facts.audioContext.state = ctx.state;
      facts.sampleRate = ctx.sampleRate;
      if (kind !== 'loopback') facts.permission = await queryMicPermission(env);
      try {
        const m = await ensureRecorderMode(ctx);
        facts.worklet = { supported: true, mode: m, error: workletError ? String(workletError
          .message || workletError) : null, loader: m === 'audioworklet' ? 'data:' : null };
      } catch (e) {
        facts.worklet = { supported: false, mode: null, error: e.message };
        return facts;
      }
      try {
        const inp = await ensureInput(ctx, since);
        facts.input = { ok: true, device: inp.device, constraints: inp.constraints };
      } catch (e) {
        const me = mapError(e, 'NO_INPUT');
        if (me.code === 'ABORTED') throw me;
        facts.input = { ok: false, error: { name: e && e.name, code: me.code,
          message: me.message } };
        return facts;
      }
      if (ctx.state === 'running') {
        try {
          await ensureReady({ since });
          await freshClock(since);
          const sr = ctx.sampleRate;
          const start = ceilFrame(ctx.currentTime + SCHEDULE_LEAD_S, sr);
          const w = await openWindow(ctx, start, Math.round(PREFLIGHT_LEVEL_S * sr), null);
          let s = 0;
          let peak = 0;
          for (let i = 0; i < w.samples.length; i++) {
            const v = w.samples[i];
            s += v * v;
            if (Math.abs(v) > peak) peak = Math.abs(v);
          }
          const rms = Math.sqrt(s / w.samples.length);
          facts.inputLevel = { peak, rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity };
        } catch (e) {
          const me = mapError(e);
          if (me.code === 'ABORTED') throw me;
          facts.inputLevel = null;
        }
      }
      return facts;
    },

    async captureNoise(seconds, { onScheduled, onChunk } = {}) {
      const since = epoch;
      const ctx = await ensureReady({ since });
      await freshClock(since);
      const sr = ctx.sampleRate;
      const startFrame = ceilFrame(ctx.currentTime + SCHEDULE_LEAD_S, sr);
      const frames = Math.round(seconds * sr);
      const t = { captureStartAt: startFrame / sr, captureEndAt: (startFrame + frames) / sr };
      const p = openWindow(ctx, startFrame, frames, onChunk);
      if (onScheduled) onScheduled(t);
      const w = await p;
      return captureObject(ctx, w, { preRoll: 0, postRoll: 0 });
    },

    async runStimulus(stimulus, { preRollS, postRollS, notBefore = null, onScheduled,
      onChunk } = {}) {
      const since = epoch;
      const ctx = await ensureReady({ since });
      await freshClock(since);
      const sr = ctx.sampleRate;
      const samples = stimulus && stimulus.samples;
      if (!(samples instanceof Float32Array) || !samples.length)
        throw new MeasurementError('INTERNAL', 'runStimulus needs rendered samples');
      if (stimulus.spec && stimulus.spec.sampleRate !== sr)
        throw new MeasurementError('INTERNAL', `Stimulus rendered at ${stimulus.spec.sampleRate}`
          + ` Hz, the context runs at ${sr} Hz.`);
      if (windows.size || stims.size)
        throw new MeasurementError('INTERNAL', 'A capture is already running (no overlap).');
      silenceVoices(); // the measurement owns the output; earlier voices fade out (Escape fade)
      const csF = ceilFrame(Math.max(ctx.currentTime + SCHEDULE_LEAD_S, notBefore || 0), sr);
      const preF = ceilFrame(preRollS, sr);
      const ssF = csF + preF;
      const ceF = ssF + samples.length + Math.round(postRollS * sr);
      const buffer = ctx.createBuffer(1, samples.length, sr);
      if (typeof buffer.copyToChannel === 'function') buffer.copyToChannel(samples, 0);
      else buffer.getChannelData(0).set(samples);
      const src = registerSource(ctx.createBufferSource());
      src.buffer = buffer;
      const fade = register(ctx.createGain());
      fade.gain.value = 1;
      src.connect(fade);
      fade.connect(engine.master); // through the master safety chain, never around it
      const st = { src, fade, startAt: ssF / sr, done: false, stopping: false };
      src.onended = () => cleanupStim(st);
      stims.add(st);
      const p = openWindow(ctx, csF, ceF - csF, onChunk);
      src.start(ssF / sr);
      const t = { captureStartAt: csF / sr, stimulusStartAt: ssF / sr,
        stimulusEndAt: (ssF + samples.length) / sr, captureEndAt: ceF / sr };
      if (onScheduled) onScheduled(t);
      let w;
      try {
        w = await p;
      } finally {
        if (!st.done && ctx.currentTime >= t.stimulusEndAt) cleanupStim(st);
        else if (!st.done) stopStim(st, ctx, { fade: true });
      }
      return captureObject(ctx, w, { preRoll: preF / sr, postRoll: (ceF - ssF - samples.length)
        / sr, stimulusStartAt: t.stimulusStartAt });
    },

    /** Stop everything in flight and release input, recorder and stimulus (idempotent). */
    cancel() {
      release(new MeasurementError('ABORTED'));
    },

    /** cancel() plus removal of every listener and of the Escape wrapper. */
    dispose() {
      if (disposed) return;
      release(new MeasurementError('ABORTED'));
      disposed = true;
      unwrapStopAll();
      offEngine();
      if (typeof env.removeEventListener === 'function') {
        env.removeEventListener('pagehide', onPageHide);
        if (env.document && typeof env.document.removeEventListener === 'function')
          env.document.removeEventListener('visibilitychange', onVisibility);
      }
    },
  }));
  return io;
}

async function queryMicPermission(env) {
  const nav = env.navigator;
  try {
    if (!nav || !nav.permissions || typeof nav.permissions.query !== 'function') return 'unknown';
    const st = await nav.permissions.query({ name: 'microphone' });
    return st && typeof st.state === 'string' ? st.state : 'unknown';
  } catch (e) {
    return 'unknown'; // Firefox before 2024 and others reject the 'microphone' name
  }
}

// ------------------------------------------------------------------------------- microphone

/**
 * createCaptureIo({ engine, env, deviceId, mode, abortOnHidden }) → io (engine.js contract)
 *   engine         the application's AudioEngine (its context, master chain and accounting)
 *   env            window-like object (default window)
 *   deviceId       optional input device (getUserMedia deviceId: { exact })
 *   mode           'auto' (AudioWorklet, else ScriptProcessor) | 'worklet' | 'scriptprocessor'
 *   abortOnHidden  abort a running capture when the document becomes hidden (default true)
 * Call engine.init() inside the user gesture that starts the measurement (autoplay policy);
 * preflight() resumes the context and opens the microphone.
 */
export function createCaptureIo({ engine, env = defaultEnv(), deviceId = null, mode = 'auto',
  abortOnHidden = true } = {}) {
  const requested = plainRequested(deviceId);
  async function openInput(ctx, { register, unregister }) {
    const nav = env.navigator;
    if (!hasMicrophoneApi(nav)) throw new MeasurementError('NO_INPUT', MIC_UNAVAILABLE_TEXT);
    const audio = { ...REQUESTED_AUDIO_CONSTRAINTS };
    if (deviceId) audio.deviceId = { exact: deviceId };
    const stream = await nav.mediaDevices.getUserMedia({ audio });
    try {
      const track = stream.getAudioTracks()[0];
      if (!track) throw new MeasurementError('NO_INPUT');
      const applied = readAppliedConstraints(track);
      const node = register(ctx.createMediaStreamSource(stream));
      const opened = {
        node,
        device: { label: track.label ? track.label : null, id: applied.deviceId },
        constraints: { requested, applied },
        liveTracks: () => stream.getTracks().filter((x) => x.readyState === 'live').length,
        onEnded: null,
        close() {
          for (const x of stream.getTracks()) x.onended = null;
          stopStreamTracks(stream);
          unregister(node);
        },
      };
      // A track that ends by itself: unplugged, permission revoked, device taken over.
      track.onended = () => {
        if (opened.onEnded) opened.onEnded({ code: 'MIC_DISCONNECTED', reason: 'track-ended' });
      };
      return opened;
    } catch (e) {
      stopStreamTracks(stream);
      throw e;
    }
  }
  return createIoCore({ engine, env, mode, openInput, kind: 'microphone', abortOnHidden });
}

// ------------------------------------------------------------------------------- loopback

/** Describe and build a synthetic loopback system on ctx (TEST CONTEXT). */
function buildLoopbackSystem(ctx, system, reg) {
  const made = [];
  const register = (n) => { made.push(n); return reg(n); };
  const out = buildSystemNodes(ctx, system, register);
  return { ...out, nodes: made };
}

function buildSystemNodes(ctx, system, register) {
  const s = system || { type: 'biquad' };
  if (s.type === 'biquad') {
    const f = register(ctx.createBiquadFilter());
    f.type = s.filter || 'lowpass';
    f.frequency.value = s.frequency != null ? s.frequency : 1000;
    f.Q.value = s.Q != null ? s.Q : Math.SQRT1_2;
    f.gain.value = s.gain != null ? s.gain : 0;
    return { input: f, output: f, node: f, describe: { type: 'biquad', filter: f.type,
      frequency: f.frequency.value, Q: f.Q.value, gain: f.gain.value } };
  }
  if (s.type === 'gain') {
    const g = register(ctx.createGain());
    g.gain.value = s.gain != null ? s.gain : 1;
    return { input: g, output: g, node: g, describe: { type: 'gain', gain: g.gain.value } };
  }
  if (s.type === 'delay') {
    const d = register(ctx.createDelay(Math.max(1, (s.delayS || 0) * 2)));
    d.delayTime.value = s.delayS || 0;
    const g = register(ctx.createGain());
    g.gain.value = s.gain != null ? s.gain : 1;
    d.connect(g);
    return { input: d, output: g, node: d, describe: { type: 'delay', delayS: s.delayS || 0,
      gain: g.gain.value } };
  }
  if (s.type === 'custom' && typeof s.build === 'function') {
    const b = s.build(ctx, register);
    return { input: b.input, output: b.output, node: b.node || null,
      describe: { type: 'custom', ...(b.describe || {}) } };
  }
  throw new TypeError(`unknown loopback system type ${s.type}`);
}

export const LOOPBACK_LABEL = 'TEST CONTEXT: digital loopback through a synthetic system '
  + '(no microphone, no acoustic path)';

/** Loopback tap points: after the whole safety chain, or after the master gain only. */
export const LOOPBACK_TAPS = Object.freeze(['post-chain', 'pre-limiter']);

/**
 * createLoopbackIo({ engine, env, system, tap, mode }) → io  — TEST CONTEXT ONLY (§146, §249)
 * The stimulus always plays through the full master chain to the destination. The recorder
 * input is a tap passed through `system`:
 *   tap 'post-chain'  (default) engine.analyser, the end of the chain (master gain, limiter,
 *                     trim, ceiling): what reaches the output device
 *   tap 'pre-limiter' engine.master, after the master gain and before the limiter: used to
 *                     measure what the limiter/ceiling do to the measured response (spec §207)
 *   system { type: 'biquad', filter = 'lowpass', frequency = 1000, Q = √½, gain = 0 }
 *        | { type: 'gain', gain } | { type: 'delay', delayS, gain }
 *        | { type: 'custom', build(ctx, register) → { input, output, describe } }
 * The expected transfer is 20·log10(engine.gainLevel) + |H_system| (dB). io.lastSystemNode
 * exposes the live node (e.g. for BiquadFilterNode.getFrequencyResponse) while a session is
 * open. Captures carry testContext = { kind: 'digital-loopback', label, tap, system,
 * chainGain }.
 */
export function createLoopbackIo({ engine, env = defaultEnv(), system = { type: 'biquad' },
  tap = 'post-chain', mode = 'auto' } = {}) {
  if (!LOOPBACK_TAPS.includes(tap)) throw new TypeError(`unknown loopback tap ${tap}`);
  const testContext = { kind: 'digital-loopback', label: LOOPBACK_LABEL, tap, system: null,
    chainGain: null };
  let io = null;
  async function openInput(ctx, { register, unregister }) {
    const from = tap === 'pre-limiter' ? engine.master : engine.analyser;
    if (!from) throw new MeasurementError('UNSUPPORTED', 'The engine has no output chain.');
    const built = buildLoopbackSystem(ctx, system, register);
    from.connect(built.input);
    testContext.system = built.describe;
    testContext.chainGain = engine.gainLevel;
    if (io) io.lastSystemNode = built.node;
    return {
      node: built.output,
      device: { label: null, id: null },
      constraints: { requested: null, applied: null },
      testContext: { ...testContext },
      liveTracks: () => 0,
      onEnded: null,
      close() {
        try { from.disconnect(built.input); } catch (e) { /* already gone */ }
        for (const n of built.nodes) unregister(n);
        if (io) io.lastSystemNode = null;
      },
    };
  }
  io = createIoCore({ engine, env, mode, openInput, kind: 'loopback', testContext });
  io.lastSystemNode = null;
  return io;
}

// T034 (hardening S7, first and third findings): the microphone capture io's failure paths,
// decided in a unit test rather than only in the browser.
// - Device loss: a microphone track that ends by itself (unplugged, permission revoked, device
//   taken over) reports MIC_DISCONNECTED through track.onended, and the io interrupts and
//   releases (capture.js ensureInput: opened.onEnded = interrupt). The live tap closes, the io
//   owns no node and no open track, and a pending capture rejects with MIC_DISCONNECTED.
// - Track release: the microphone input's close() stops every track of its stream
//   (stopStreamTracks), so after cancel() and after an abort while a capture is pending every
//   fake track is readyState 'ended'. openTrackCount alone cannot decide this: it reads 0 as soon
//   as the input is dropped, stopped or not.
// The rig is the microphone capture io on a fake context, as preflight-own-output.test.mjs
// builds it, with fake tracks that end the way a browser's do: stop() sets readyState 'ended'
// and fires nothing; a lost device sets it and fires onended.
import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createCaptureIo } from '../../src/js/measurement/capture.js';

const SR = 48000;
const BLOCK = 2048;
const SETTLE_MS = 5000; // wall clock: a pending promise that never settles fails by name

function fakeTrack(label) {
  return {
    label, readyState: 'live', onended: null,
    stop() { this.readyState = 'ended'; }, // a browser fires no 'ended' on stop()
    getSettings: () => ({ echoCancellation: false, noiseSuppression: false,
      autoGainControl: false, sampleRate: SR, channelCount: 1, deviceId: 'fake' }),
  };
}

/**
 * A microphone capture io on a fake context (ScriptProcessor recorder). Every getUserMedia
 * call opens a fresh stream of two audio tracks; `streams` keeps them all, so a test can ask
 * whether any track the io ever opened is still live.
 */
function captureRig({ level = 0.1 } = {}) {
  let sp = null;
  const node = (extra = {}) => ({ connect() {}, disconnect() {}, ...extra });
  const ctx = {
    state: 'running', sampleRate: SR, currentTime: 1, destination: node(),
    createGain: () => node({ gain: { value: 1 } }),
    createScriptProcessor: () => { sp = node({ onaudioprocess: null }); return sp; },
    createMediaStreamSource: () => node(),
    createAnalyser: () => node({ frequencyBinCount: 1024 }),
  };
  const proto = AudioEngine.prototype;
  const engine = {
    ctx, voices: new Set(), nodes: new Set(), sources: new Set(), gainLevel: 0.1,
    init: () => true, isSupported: () => true, resume: async () => {}, stopAll() {},
    on: () => () => {}, audibleVoiceCountAt: proto.audibleVoiceCountAt,
  };
  Object.defineProperty(engine, 'audibleVoiceCount',
    Object.getOwnPropertyDescriptor(proto, 'audibleVoiceCount'));
  const streams = [];
  const env = {
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          const tracks = [fakeTrack('Fake mic'), fakeTrack('Fake mic, second channel')];
          const stream = { getAudioTracks: () => tracks.slice(), getTracks: () => tracks.slice() };
          streams.push(stream);
          return stream;
        },
      },
      permissions: { query: async () => ({ state: 'granted' }) },
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const io = createCaptureIo({ engine, env, mode: 'scriptprocessor', abortOnHidden: false });
  const interrupts = [];
  io.onInterrupt = (info) => { interrupts.push(info); };

  const allTracks = () => streams.flatMap((s) => s.getTracks());
  const liveTracks = () => allTracks().filter((t) => t.readyState === 'live');

  /** The device goes away: its track ends by itself and fires 'ended'. */
  function loseDevice() {
    const s = streams[streams.length - 1];
    assert.ok(s, 'a stream was opened');
    const track = s.getAudioTracks()[0];
    track.readyState = 'ended';
    assert.equal(typeof track.onended, 'function', 'the io listens for the track ending');
    track.onended();
  }

  /** Advances the audio clock one block per macrotask, rendering input, until `cond()`. */
  async function advanceUntil(cond, label, ms = SETTLE_MS) {
    const data = new Float32Array(BLOCK).fill(level);
    let frame = Math.round(ctx.currentTime * SR);
    const deadline = Date.now() + ms;
    while (!cond() && Date.now() < deadline) {
      await new Promise((r) => { setImmediate(r); });
      frame += BLOCK;
      ctx.currentTime = frame / SR;
      if (sp && sp.onaudioprocess) {
        sp.onaudioprocess({ inputBuffer: { getChannelData: () => data },
          playbackTime: frame / SR });
      }
    }
    assert.ok(cond(), `${label} within ${ms} ms of wall clock`);
  }

  /** A capture of `seconds`, scheduled and recording when this resolves to { capture }. */
  async function pendingCapture(seconds = 30) {
    let t = null;
    const p = io.captureNoise(seconds, { onScheduled: (x) => { t = x; } });
    let settled = false;
    p.then(() => { settled = true; }, () => { settled = true; });
    await advanceUntil(() => settled || (t && ctx.currentTime > t.captureStartAt),
      'the capture was scheduled and its window opened');
    assert.equal(settled, false, 'the capture is still pending');
    assert.equal(io.activeCaptureCount, 1, 'one capture window is open');
    return { capture: p }; // wrapped: an async function returning p would wait for it
  }

  return { io, engine, ctx, streams, allTracks, liveTracks, interrupts, loseDevice,
    advanceUntil, pendingCapture };
}

/** Resolves to the rejection of `p`; fails by name when `p` resolves or stays pending. */
async function rejectionWithin(p, label, ms = SETTLE_MS) {
  let timer = null;
  const pending = Symbol('pending');
  const deadline = new Promise((r) => { timer = setTimeout(() => r(pending), ms); });
  try {
    const out = await Promise.race([
      p.then(() => ({ resolved: true }), (err) => ({ err })),
      deadline,
    ]);
    assert.notEqual(out, pending, `${label}: still pending after ${ms} ms of wall clock`);
    assert.ok(!out.resolved, `${label}: resolved, expected a rejection`);
    return out.err;
  } finally {
    clearTimeout(timer);
  }
}

/** Nothing of the io is left open: no node, no track, no live tap, no window, no port. */
function assertNothingOpen(rig, label) {
  const { io, engine } = rig;
  assert.equal(io.activeNodeCount, 0, `${label}: activeNodeCount`);
  assert.equal(engine.nodes.size, 0, `${label}: engine.nodes`);
  assert.equal(io.openTrackCount, 0, `${label}: openTrackCount`);
  assert.equal(io.liveTapOpen, false, `${label}: liveTapOpen`);
  assert.equal(io.activeCaptureCount, 0, `${label}: activeCaptureCount`);
  assert.equal(io.openPortCount, 0, `${label}: openPortCount`);
}

/** Every track the io ever opened is ended (stopped by the io or ended by the device). */
function assertEveryTrackEnded(rig, label) {
  assert.ok(rig.allTracks().length > 0, `${label}: the io opened tracks`);
  assert.deepEqual(rig.liveTracks().map((t) => t.label), [],
    `${label}: every fake track is readyState 'ended'`);
}

// ------------------------------------------------------------------ device loss

test('T034: a lost microphone closes the live tap and leaves nothing open', async () => {
  const rig = captureRig();
  try {
    const closed = [];
    const tap = await rig.io.openLiveTap({ onClosed: (reason) => closed.push(reason) });
    assert.ok(tap && tap.analyser, 'the live tap opened');
    assert.equal(rig.io.liveTapOpen, true);
    assert.ok(rig.io.activeNodeCount > 0, 'the tap owns its source and analyser');
    assert.equal(rig.io.openTrackCount, 2, 'both tracks of the stream are live');

    rig.loseDevice();

    assertNothingOpen(rig, 'after the device was lost');
    assertEveryTrackEnded(rig, 'after the device was lost');
    assert.deepEqual(closed, ['track-ended'], 'the tap owner learns why it closed');
    assert.deepEqual(rig.interrupts, [], 'no capture was running, so no interrupt is reported');
  } finally {
    rig.io.dispose();
  }
});

test('T034: a lost microphone rejects a pending capture with MIC_DISCONNECTED', async () => {
  const rig = captureRig();
  try {
    // The tap is open first; the capture takes the input over and drops the tap.
    await rig.io.openLiveTap();
    const { capture } = await rig.pendingCapture();
    assert.equal(rig.io.liveTapOpen, false, 'a capture never runs beside the live tap');
    assert.equal(rig.io.openTrackCount, 2, 'the capture records from the open input');

    rig.loseDevice();

    const err = await rejectionWithin(capture, 'the pending capture');
    assert.equal(err && err.code, 'MIC_DISCONNECTED', String(err && err.message));
    assert.equal(err.detail && err.detail.reason, 'track-ended');
    assert.deepEqual(rig.interrupts.map((x) => x.code), ['MIC_DISCONNECTED'],
      'the running capture is reported as interrupted');
    assertNothingOpen(rig, 'after the device was lost during a capture');
    assertEveryTrackEnded(rig, 'after the device was lost during a capture');
  } finally {
    rig.io.dispose();
  }
});

// ------------------------------------------------------------------ track release

test('T034: cancel() stops every track of the microphone stream', async () => {
  const rig = captureRig();
  try {
    await rig.io.openLiveTap();
    assert.equal(rig.liveTracks().length, 2, 'both tracks are live before the cancel');

    rig.io.cancel();

    assertEveryTrackEnded(rig, 'after cancel()');
    assertNothingOpen(rig, 'after cancel()');
  } finally {
    rig.io.dispose();
  }
});

for (const [how, abort] of [
  ['cancel()', (rig) => rig.io.cancel()],
  ['Escape (engine.stopAll)', (rig) => rig.engine.stopAll()],
]) {
  test(`T034: an abort by ${how} while a capture is pending stops every track`, async () => {
    const rig = captureRig();
    try {
      const { capture } = await rig.pendingCapture();
      assert.equal(rig.liveTracks().length, 2, 'both tracks are live during the capture');

      abort(rig);

      const err = await rejectionWithin(capture, 'the aborted capture');
      assert.equal(err && err.code, 'ABORTED', String(err && err.message));
      assertEveryTrackEnded(rig, `after an abort by ${how}`);
      assertNothingOpen(rig, `after an abort by ${how}`);
    } finally {
      rig.io.dispose();
    }
  });
}

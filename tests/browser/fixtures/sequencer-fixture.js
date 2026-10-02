// Fixture for tests/browser/sequencer.cjs. Bundled with esbuild (IIFE) and injected into a blank
// page; it exposes window.seqFixture so the test drives the real modules in a real browser.

import { referenceSequence, createSequence, addBlock } from '../../../src/js/sequencer/model.js';
import {
  renderSequenceOffline,
  buildTimeline,
  compileSequence,
  automationValueAt,
  STOP_RAMP_S,
  STOP_PAD_S,
  EDGE_S,
} from '../../../src/js/sequencer/compiler.js';
import { createSequencerEditor } from '../../../src/js/sequencer/editor.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Deadline poll: wait until cond() holds or ms pass; returns the wall time waited (ms). */
async function until(cond, ms) {
  const t0 = performance.now();
  while (!cond() && performance.now() - t0 < ms) await sleep(5);
  return Math.round(performance.now() - t0);
}

// ---------------------------------------------------------------- source instrumentation
// Wrap OscillatorNode start/stop and count `ended`: a source is live from start() until ended.
const probe = { started: 0, ended: 0, stopCalls: 0, live: new Set(), maxLive: 0 };
const origStart = OscillatorNode.prototype.start;
const origStop = OscillatorNode.prototype.stop;
OscillatorNode.prototype.start = function start(...args) {
  probe.started += 1;
  probe.live.add(this);
  probe.maxLive = Math.max(probe.maxLive, probe.live.size);
  this.addEventListener('ended', () => {
    probe.ended += 1;
    probe.live.delete(this);
  });
  return origStart.apply(this, args);
};
OscillatorNode.prototype.stop = function stop(...args) {
  probe.stopCalls += 1;
  return origStop.apply(this, args);
};

function probeSnapshot() {
  return {
    started: probe.started,
    ended: probe.ended,
    live: probe.live.size,
    maxLive: probe.maxLive,
    stopCalls: probe.stopCalls,
  };
}

function resetProbe() {
  probe.started = 0;
  probe.ended = 0;
  probe.stopCalls = 0;
  probe.maxLive = probe.live.size;
}

function timelineSummary(tl) {
  return {
    duration: tl.duration,
    sampleRate: tl.sampleRate,
    blocks: tl.blocks.map((b) => ({
      id: b.id,
      type: b.type,
      kind: b.kind,
      start: b.start,
      end: b.end,
      freq: b.freq ?? null,
      f0: b.f0 ?? null,
      f1: b.f1 ?? null,
      curve: b.curve ?? null,
      steps: b.steps ? b.steps.map((s) => ({ start: s.start, end: s.end, f: s.f })) : null,
      windows: b.windows,
    })),
  };
}

function modulatedSequence(sampleRate) {
  let m = referenceSequence({ sampleRate });
  m = addBlock(m, 'siren', { durationMs: 300, sampleRate });
  m = addBlock(m, 'am', { durationMs: 300, sampleRate });
  m = addBlock(m, 'fm', { durationMs: 300, sampleRate });
  m = addBlock(m, 'random', { durationMs: 300, sampleRate });
  m = addBlock(m, 'burst', { durationMs: 300, sampleRate });
  return m;
}

// ---------------------------------------------------------------- offline rendering

async function renderReference(sampleRate) {
  const model = referenceSequence({ sampleRate });
  const { buffer } = await renderSequenceOffline(model, OfflineAudioContext, { sampleRate });
  return {
    samples: Array.from(buffer.getChannelData(0)),
    timeline: timelineSummary(buildTimeline(model, { sampleRate })),
    edgeS: EDGE_S,
  };
}

async function renderModulated(sampleRate) {
  const model = modulatedSequence(sampleRate);
  const { buffer } = await renderSequenceOffline(model, OfflineAudioContext, { sampleRate });
  return {
    samples: Array.from(buffer.getChannelData(0)),
    timeline: timelineSummary(buildTimeline(model, { sampleRate })),
    edgeS: EDGE_S,
  };
}

/**
 * Render offline and stop the voice at `stopAt`, optionally with the cancelAndHoldAtTime path
 * disabled (the Firefox path). Where OfflineAudioContext.suspend exists (Chromium) the context
 * is suspended at the render quantum containing stopAt and stop() runs mid-render, exactly like
 * a realtime stop in the middle of a ramp. Elsewhere (Firefox) stop() is scheduled before
 * rendering ("pre-scheduled"); the realtime capture test covers the mid-render case there.
 */
async function renderStopped(sampleRate, stopAt, { forceFallback = false } = {}) {
  const model = modulatedSequence(sampleRate);
  const tl = buildTimeline(model, { sampleRate });
  const length = Math.ceil((tl.duration + 0.2) * sampleRate);
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length, sampleRate });
  const saved = AudioParam.prototype.cancelAndHoldAtTime;
  const native = typeof saved === 'function';
  const doStop = (voice, t) => {
    if (forceFallback && native) AudioParam.prototype.cancelAndHoldAtTime = undefined;
    try {
      voice.stop(t);
    } finally {
      if (forceFallback && native) AudioParam.prototype.cancelAndHoldAtTime = saved;
    }
  };
  const voice = compileSequence(model, ctx, ctx.destination, 0, { timers: null });
  const midRender = typeof ctx.suspend === 'function';
  let actual = stopAt;
  if (midRender) {
    const tq = (Math.floor((stopAt * sampleRate) / 128) * 128) / sampleRate;
    ctx.suspend(tq).then(() => {
      actual = ctx.currentTime;
      doStop(voice, actual);
      ctx.resume();
    });
  } else {
    doStop(voice, stopAt);
  }
  const buffer = await ctx.startRendering();
  await sleep(0);
  const env = voice.events.filter((e) => e.kind === 'gain');
  return {
    samples: Array.from(buffer.getChannelData(0)),
    timeline: timelineSummary(tl),
    stopAt: actual,
    midRender,
    envAtStop: automationValueAt(env, actual, 1),
    nativeHold: native,
    usedFallback: forceFallback || !native,
    stopRampS: STOP_RAMP_S,
    stopPadS: STOP_PAD_S,
    voiceEnded: voice.ended,
    nodes: voice.activeNodeCount,
  };
}

// ---------------------------------------------------------------- realtime

let rt = null;

async function realtimeSetup() {
  if (rt) return true;
  const ctx = new AudioContext();
  await ctx.resume();
  const master = ctx.createGain();
  master.gain.value = 0.05;
  master.connect(ctx.destination);
  const editor = createSequencerEditor({
    model: modulatedSequence(ctx.sampleRate),
    engine: { ctx, destination: master, resume: () => ctx.resume() },
  });
  rt = { ctx, master, editor };
  return { state: ctx.state, sampleRate: ctx.sampleRate };
}

/** Everything the editor started is gone: no live source, no voice, no node, not playing. */
function torn(editor) {
  const st = editor.stats();
  return probe.live.size === 0 && st.voices === 0 && st.activeNodeCount === 0 && !editor.playing;
}

async function stopMidPlay(playMs) {
  const { editor, ctx } = rt;
  resetProbe();
  editor.setLoop(false);
  const t0 = ctx.currentTime;
  editor.play();
  await sleep(playMs);
  const during = { ...probeSnapshot(), stats: editor.stats(), ctxAdvanced: ctx.currentTime - t0 };
  editor.stop();
  const waitedMs = await until(() => torn(editor), 400);
  return { during, after: { ...probeSnapshot(), stats: editor.stats(), playing: editor.playing, waitedMs } };
}

async function restartMany(n, gapMs) {
  const { editor } = rt;
  resetProbe();
  const perRestart = [];
  for (let i = 0; i < n; i++) {
    editor.restart();
    await sleep(gapMs);
    perRestart.push({ live: probe.live.size, voices: editor.stats().voices });
  }
  const beforeStop = probeSnapshot();
  editor.stop();
  const waitedMs = await until(() => torn(editor), 400);
  return { perRestart, beforeStop, after: { ...probeSnapshot(), stats: editor.stats(), waitedMs } };
}

async function loopThenStop(waitMs) {
  const { editor, ctx } = rt;
  resetProbe();
  const saved = editor.serialize();
  editor.load(
    createSequence(
      {
        loop: true,
        blocks: [
          { type: 'tone', durationMs: 100, params: { freq: 500 } },
          { type: 'am', durationMs: 100, params: { freq: 700, modFreq: 20 } },
          { type: 'sweep', durationMs: 100, params: { start: 300, end: 900 } },
        ],
      },
      { sampleRate: ctx.sampleRate },
    ),
  );
  editor.play();
  await sleep(waitMs);
  const during = { ...probeSnapshot(), stats: editor.stats(), playing: editor.playing };
  editor.stop();
  const waitedMs = await until(() => torn(editor), 400);
  const after = { ...probeSnapshot(), stats: editor.stats(), playing: editor.playing, waitedMs };
  editor.load(saved);
  return { during, after };
}

const RECORDER = `
class SeqRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage({ frame: currentFrame, data: ch.slice(0) });
    return true;
  }
}
registerProcessor('seq-recorder', SeqRecorder);
`;

/**
 * Realtime stop capture: a dense 200 Hz pulse train (8 ms pulses, no pause, so the envelope is
 * ramping about half of the time) is stopped `runs` times at varying moments; an AudioWorklet
 * records every rendered quantum. Returns, per run, the largest one-sample step over the whole
 * contiguous capture (pulse edges + the stop fade) and the envelope value at the stop time.
 */
async function realtimeStopCapture(runs, { forceFallback = false } = {}) {
  const ctx = rt.ctx;
  if (!rt.recorder) {
    const url = URL.createObjectURL(new Blob([RECORDER], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    const rec = new AudioWorkletNode(ctx, 'seq-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    rec.connect(mute);
    mute.connect(ctx.destination);
    rt.recorder = { rec, mute, chunks: [] };
    rec.port.onmessage = (e) => rt.recorder.chunks.push(e.data);
  }
  const { rec } = rt.recorder;
  const model = createSequence(
    {
      blocks: [{ type: 'pulse', durationMs: 3000, params: { freq: 200, pulseMs: 8, pauseMs: 0 } }],
    },
    { sampleRate: ctx.sampleRate },
  );
  const saved = AudioParam.prototype.cancelAndHoldAtTime;
  const native = typeof saved === 'function';
  const out = [];
  for (let i = 0; i < runs; i++) {
    rt.recorder.chunks = [];
    const voice = compileSequence(model, ctx, rec, ctx.currentTime + 0.05, {});
    await sleep(160 + i * 13);
    if (forceFallback && native) AudioParam.prototype.cancelAndHoldAtTime = undefined;
    try {
      voice.stop();
    } finally {
      if (forceFallback && native) AudioParam.prototype.cancelAndHoldAtTime = saved;
    }
    const env = voice.events.filter((e) => e.kind === 'gain');
    const envAtStop = automationValueAt(env, voice.stopTime - voice.t0, 1);
    // Deadline poll instead of a fixed sleep: wait until the voice has ended, its nodes are
    // gone and the capture covers 100 ms past the stop (1 s deadline). endedAfter is the audio
    // time from the stop to the moment the end was observed.
    let endedAudio = null;
    await until(() => {
      if (voice.ended && endedAudio === null) endedAudio = ctx.currentTime;
      const last = rt.recorder.chunks[rt.recorder.chunks.length - 1];
      // Also wait for at least 100 ms of captured audio: on a busy runner worklet chunks can
      // arrive late, and the check needs a meaningful capture, not just the last chunk.
      const total = rt.recorder.chunks.reduce((n, c) => n + c.data.length, 0);
      return voice.ended && voice.activeNodeCount === 0 && last
        && (last.frame + last.data.length) / ctx.sampleRate >= voice.stopTime + 0.1
        && total > 0.1 * ctx.sampleRate;
    }, 2000);
    const chunks = rt.recorder.chunks;
    let maxStep = 0;
    let gaps = 0;
    let frames = 0;
    let prev = null;
    let prevFrame = null;
    for (const c of chunks) {
      const contiguous = prevFrame !== null && c.frame === prevFrame;
      if (prevFrame !== null && !contiguous) gaps += 1;
      for (let k = 0; k < c.data.length; k++) {
        const x = c.data[k];
        if (prev !== null && (k > 0 || contiguous)) maxStep = Math.max(maxStep, Math.abs(x - prev));
        prev = x;
      }
      frames += c.data.length;
      prevFrame = c.frame + c.data.length;
    }
    out.push({
      maxStep,
      gaps,
      frames,
      envAtStop,
      ended: voice.ended,
      endedAfter: endedAudio === null ? null : endedAudio - voice.stopTime,
      nodes: voice.activeNodeCount,
      usedFallback: forceFallback || !native,
    });
  }
  return { sampleRate: ctx.sampleRate, runs: out };
}

async function realtimeTeardown() {
  if (!rt) return null;
  rt.editor.dispose();
  rt.master.disconnect();
  if (rt.recorder) {
    rt.recorder.rec.port.onmessage = null;
    rt.recorder.rec.disconnect();
    rt.recorder.mute.disconnect();
  }
  await rt.ctx.close();
  rt = null;
  return probeSnapshot();
}

window.seqFixture = {
  renderReference,
  renderModulated,
  renderStopped,
  realtimeSetup,
  stopMidPlay,
  restartMany,
  loopThenStop,
  realtimeStopCapture,
  realtimeTeardown,
  probeSnapshot,
  hasCancelAndHold: () => typeof AudioParam.prototype.cancelAndHoldAtTime === 'function',
};
window.seqFixtureReady = true;

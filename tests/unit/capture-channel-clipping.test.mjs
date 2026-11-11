// T039 (307.yaml#R5, audit-2026-11-10-p3; oscilla-43's rule): a clip on ANY input channel
// counts against the take and the report names the channel. The capture worklet used to take
// one input channel (channelCountMode 'explicit', channelInterpretation 'speakers'), so a
// stereo input was downmixed to 0.5 * (L + R) before the rail check: a left channel clipping
// at full scale reached 0.5 and the take read CLIPPING NONE.
//   node --test tests/unit/capture-channel-clipping.test.mjs
// Fail-first: on 2aa5883a checkCapture ignores capture.channels (clipping ratio 0, peak 0.5),
// the worklet posts the downmix alone, and writeCaptureChannels does not exist.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as checks from '../../src/js/measurement/capture-checks.js';
import * as capture from '../../src/js/measurement/capture.js';
import { BLOCK, rig } from './fixtures/capture-rig.mjs';

const SR = 48000;
const N = SR / 2;

/** A 1 kHz tone at 1.2 clipped to the rail (flat tops), and a silent right channel. */
function stereoLeftClips() {
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    L[i] = Math.max(-1, Math.min(1, 1.2 * Math.sin((2 * Math.PI * 1000 * i) / SR)));
  }
  const R = new Float32Array(N);
  const mono = Float32Array.from(L, (x, i) => 0.5 * (x + R[i])); // the Web Audio speakers downmix
  return { L, R, mono };
}

test('T039: a stereo take whose left channel clips is clipping, named by channel', () => {
  const { L, R, mono } = stereoLeftClips();
  // The downmix alone stays under the rail: what the check used to see.
  const alone = checks.checkCapture({ sampleRate: SR, samples: mono });
  assert.equal(alone.clipping.regions.length, 0);
  assert.ok(alone.peak < checks.CLIP_THRESHOLD);
  const c = checks.checkCapture({ sampleRate: SR, samples: mono, channels: [L, R] });
  assert.ok(c.clipping.regions.length > 0, 'the left channel clips');
  assert.ok(c.clipping.ratio > 0);
  assert.equal(c.clipping.channel, 0, 'the worst channel is the left');
  assert.deepEqual(c.clipping.channels.map((x) => x.regions.length > 0), [true, false]);
  assert.ok(c.peak >= checks.CLIP_THRESHOLD, 'the peak is over every channel (the bar: AT RAIL)');
  const r = c.reasons.find((x) => x.code === 'CLIPPING');
  assert.ok(r, JSON.stringify(c.reasons));
  assert.match(r.text, /kanál 1 \(levý\)/);
  // A right-only clip names the right channel; a take where nothing clips stays clean.
  const right = checks.checkCapture({ sampleRate: SR, samples: mono, channels: [R, L] });
  assert.equal(right.clipping.channel, 1);
  assert.match(right.reasons.find((x) => x.code === 'CLIPPING').text, /kanál 2 \(pravý\)/);
  const quiet = Float32Array.from(L, (x) => 0.4 * x);
  const clean = checks.checkCapture({ sampleRate: SR, samples: quiet, channels: [quiet, R] });
  assert.equal(clean.clipping.regions.length, 0);
  assert.equal(clean.clipping.channel, null);
  assert.equal(clean.reasons.some((x) => x.code === 'CLIPPING'), false);
});

test('T039: a mono take, or channels that do not fit the capture, are judged as before', () => {
  const { L, mono } = stereoLeftClips();
  const one = checks.checkCapture({ sampleRate: SR, samples: L });
  assert.ok(one.clipping.regions.length > 0);
  assert.equal('channel' in one.clipping, false, 'a mono capture: the golden output, no channel');
  assert.match(one.reasons.find((x) => x.code === 'CLIPPING').text, /at the rail in/);
  const misfit = checks.checkCapture({ sampleRate: SR, samples: mono,
    channels: [L.subarray(0, 100), L.subarray(0, 100)] });
  assert.equal('channels' in misfit.clipping, false, 'a misfit is not judged per channel');
});

/** The capture worklet's processor, run on fake AudioWorkletGlobalScope globals. */
function processor(chunkFrames = 256) {
  const posted = [];
  class AudioWorkletProcessor {
    constructor() {
      this.port = { postMessage: (m) => posted.push(m), onmessage: null, close() {} };
    }
  }
  let Proc = null;
  const scope = { currentFrame: 0 };
  // eslint-disable-next-line no-new-func
  new Function('AudioWorkletProcessor', 'registerProcessor', 'scope',
    `with (scope) { ${capture.CAPTURE_WORKLET_SOURCE} }`)(AudioWorkletProcessor,
    (name, C) => { Proc = C; }, scope);
  const p = new Proc({ processorOptions: { chunkFrames } });
  p.port.onmessage({ data: { type: 'arm', id: 7, start: 0, end: chunkFrames } });
  return { p, posted, scope };
}

test('T039: the worklet takes every input channel, posts them, and keeps the speakers downmix',
  () => {
    const q = 128;
    const L = Float32Array.from({ length: q }, (_, i) => (i % 2 ? 1 : -1));
    const R = Float32Array.from({ length: q }, (_, i) => i / q);
    const { p, posted, scope } = processor(2 * q);
    scope.currentFrame = 0;
    p.process([[L, R]]);
    scope.currentFrame = q;
    p.process([[L, R]]);
    const chunk = posted.find((m) => m.type === 'chunk');
    assert.ok(chunk, JSON.stringify(posted.map((m) => m.type)));
    assert.equal(chunk.data.length, 2 * q);
    for (let i = 0; i < q; i++) {
      assert.equal(chunk.data[i], Math.fround(0.5 * (L[i] + R[i])), `mono ${i}`);
    }
    assert.equal(chunk.channels.length, 2);
    assert.deepEqual(Array.from(chunk.channels[0].subarray(0, q)), Array.from(L));
    assert.deepEqual(Array.from(chunk.channels[1].subarray(q)), Array.from(R));
    // A mono input posts the samples as they are, and no channels.
    const mono = processor(q);
    mono.p.process([[L]]);
    const m = mono.posted.find((x) => x.type === 'chunk');
    assert.deepEqual(Array.from(m.data), Array.from(L));
    assert.equal(m.channels, undefined);
    // The node is built to receive every channel of the input.
    assert.equal(capture.CAPTURE_NODE_OPTIONS && capture.CAPTURE_NODE_OPTIONS.channelCountMode,
      'max', 'the recorder node takes every channel');
  });

test('T039: a capture window keeps each channel where its frames land', () => {
  assert.equal(typeof capture.writeCaptureChannels, 'function');
  const w = { startFrame: 100, endFrame: 108, frames: 8, channels: undefined };
  capture.writeCaptureChannels(w, 96, [Float32Array.of(9, 9, 9, 9, 1, 2, 3, 4),
    Float32Array.of(9, 9, 9, 9, 5, 6, 7, 8)]);
  capture.writeCaptureChannels(w, 104, [Float32Array.of(1, 1, 1, 1),
    Float32Array.of(2, 2, 2, 2)]);
  assert.deepEqual(w.channels.map((c) => Array.from(c)), [[1, 2, 3, 4, 1, 1, 1, 1],
    [5, 6, 7, 8, 2, 2, 2, 2]]);
  // A chunk with another channel count drops the per-channel record (the downmix is judged).
  capture.writeCaptureChannels(w, 104, [Float32Array.of(1, 1, 1, 1)]);
  assert.equal(w.channels, null);
});

// oscilla-43: the ScriptProcessor fallback has every channel of its inputBuffer, so it judges
// them by the same rule and the same downmix (speakersMono). Driven through the capture io on
// the shared stub context (tests/unit/fixtures/capture-rig.mjs).
test('T039: the ScriptProcessor fallback keeps every channel, so a left-only clip is caught',
  async () => {
    // A left channel of flat tops at the rail (runs of four samples at ±1), a silent right.
    const left = Float32Array.from({ length: BLOCK }, (_, i) => (Math.floor(i / 4) % 2 ? 1 : -1));
    const right = new Float32Array(BLOCK);
    const r = rig({ channels: () => [left, right] });
    const cap = await r.drive(r.io.captureNoise(0.2));
    assert.ok(Array.isArray(cap.channels) && cap.channels.length === 2, 'the capture has both');
    assert.ok(Math.max(...cap.samples.map(Math.abs)) <= 0.5, 'the downmix is 0.5 (L + R)');
    const c = checks.checkCapture(cap);
    assert.equal(c.clipping.channel, 0);
    assert.ok(c.clipping.regions.length > 0 && c.peak >= checks.CLIP_THRESHOLD);
    assert.match(c.reasons.find((x) => x.code === 'CLIPPING').text, /kanál 1 \(levý\)/);
    // A mono microphone upmixed to L = R: the exact downmix, and no channel named.
    const m = Float32Array.from({ length: BLOCK }, (_, i) => 0.3 * Math.sin(i / 7));
    const mono = rig({ channels: () => [m, m] });
    const mc = await mono.drive(mono.io.captureNoise(0.2));
    const filled = mc.samples.findIndex((x) => x !== 0);
    assert.ok(filled >= 0);
    assert.equal(mc.samples[filled], mc.channels[0][filled], 'the downmix of L = R is L');
    const check = checks.checkCapture(mc);
    assert.equal(check.clipping.channel, null);
    assert.equal(check.reasons.some((x) => x.code === 'CLIPPING'), false);
  });

test('T039: the worklet and the fallback share one downmix (speakersMono)', () => {
  assert.ok(capture.CAPTURE_WORKLET_SOURCE.includes(capture.speakersMono.toString()),
    'the worklet embeds the source of the function the fallback calls');
  const L = Float32Array.of(1, -1, 0.5);
  const R = Float32Array.of(0, 1, 0.5);
  assert.deepEqual(Array.from(capture.speakersMono([L, R], 3, new Float32Array(3))), [0.5, 0, 0.5]);
});

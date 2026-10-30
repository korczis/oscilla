// C016 review of #297: when the setup check says the app's own output is in its input reading.
// - R-2: Measure stops the instrument and runs a fresh preflight in the same task, while the
//   stopped voice is still in its fast fade (about 28 ms). The capture io counted that voice, so
//   OTHER_AUDIO and NOISE_HIGH blamed the room's noise on the app. The io now counts the voices
//   that still sound when the level window opens (AudioEngine#audibleVoiceCountAt) or after it.
// - R-5: the caller's fact is a probe, read at the level read too, not once before the awaits.
// - R-1: the quality bar's Noise item no longer calls such a reading the background.
// - R-3: the io's OR and the MEASURE adapter's probe are checked by behaviour, not by regex.
// - R-4: the status-bar play key reads the sequencer live, not the 150 ms seqPlaying copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { buildPlan } from '../../src/js/audio/patterns.js';
import { defaultInstrumentState } from '../../src/js/core/config.js';
import { createCaptureIo, SCHEDULE_LEAD_S } from '../../src/js/measurement/capture.js';
import { createMeasurementEngine } from '../../src/js/measurement/engine.js';
import {
  initialQualityBar, reduceQualityBar, qualityBarView,
} from '../../src/js/measurement/views/quality-bar.js';
import { createMeasureUi } from '../../src/js/ui/measure.js';
import { createWorkbench } from '../../src/js/ui/workbench.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FREEZE_DIR = path.resolve(process.env.OSCILLA_FREEZE_DIR || path.join(here, '../freeze'));
const hasMock = fs.existsSync(path.join(FREEZE_DIR, 'extract.cjs'));
const skip = hasMock ? false : `mock AudioContext not found in ${FREEZE_DIR}`;
const { makeMockAudio } = hasMock
  ? createRequire(import.meta.url)(path.join(FREEZE_DIR, 'extract.cjs')) : {};

const SR = 48000;
const BLOCK = 2048;
const FAST_FADE_END_S = 0.038; // stopAll: _soon (>= now) + 0.008 fade + 0.01 stop margin + 2 q

// ------------------------------------------------------------------ the real engine's voices

test('C016 R-2: a voice stopped now still counts now, but not when the level window opens',
  { skip }, () => {
    const audio = makeMockAudio({});
    const env = { AudioContext: audio.AudioContext, setTimeout: () => 0, clearTimeout() {} };
    const eng = new AudioEngine({ env });
    const st = defaultInstrumentState();
    const r = buildPlan({ ...st }, { safeMax: (SR / 2) * 0.95, continuous: true });
    assert.ok(r.ok, r.error);
    eng.play(r.plan, { mode: 'hold', continuous: true, limitS: 2, durationS: 0.5,
      attackS: 0.01, releaseS: 0.03 });
    eng.ctx.advance(0.2);
    const lead = () => eng.ctx.currentTime + SCHEDULE_LEAD_S;
    assert.equal(eng.audibleVoiceCount, 1, 'a held voice sounds');
    assert.equal(eng.audibleVoiceCountAt(lead()), 1, 'and still sounds a lead later');
    eng.stopAll(); // Measure's stopPlayback -> stopNow
    assert.equal(eng.audibleVoiceCount, 1, 'in its fade: counted at this instant');
    assert.equal(eng.audibleVoiceCountAt(lead()), 0, 'silent before a window opens');
    eng.ctx.advance(1);
    assert.equal(eng.audibleVoiceCount, 0);
  });

// ------------------------------------------------------------------ the capture io

/**
 * A microphone capture io on a fake context (ScriptProcessor recorder). The fake engine counts
 * its voices with AudioEngine's own getter and method, so the io sees the engine's accounting.
 */
function captureRig({ voices = [], onOpen = null, level = 0.1 } = {}) {
  let sp = null;
  const node = (extra = {}) => ({ connect() {}, disconnect() {}, ...extra });
  const ctx = {
    state: 'running', sampleRate: SR, currentTime: 1, destination: node(),
    createGain: () => node({ gain: { value: 1 } }),
    createScriptProcessor: () => { sp = node({ onaudioprocess: null }); return sp; },
    createMediaStreamSource: () => node(),
  };
  const proto = AudioEngine.prototype;
  const engine = {
    ctx, voices: new Set(voices), nodes: new Set(), sources: new Set(), gainLevel: 0.1,
    init: () => true, isSupported: () => true, resume: async () => {}, stopAll() {},
    on: () => () => {}, audibleVoiceCountAt: proto.audibleVoiceCountAt,
  };
  Object.defineProperty(engine, 'audibleVoiceCount',
    Object.getOwnPropertyDescriptor(proto, 'audibleVoiceCount'));
  const track = { label: 'Fake mic', readyState: 'live', onended: null, stop() {},
    getSettings: () => ({ echoCancellation: false, noiseSuppression: false,
      autoGainControl: false, sampleRate: SR, channelCount: 1, deviceId: 'fake' }) };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const env = {
    navigator: {
      mediaDevices: { getUserMedia: async () => { if (onOpen) onOpen(ctx); return stream; } },
      permissions: { query: async () => ({ state: 'granted' }) },
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const io = createCaptureIo({ engine, env, mode: 'scriptprocessor', abortOnHidden: false });
  /** Runs `p` while the audio clock advances one block per macrotask and the input renders. */
  async function drive(p) {
    let settled = false;
    p.then(() => { settled = true; }, () => { settled = true; });
    const data = new Float32Array(BLOCK).fill(level);
    let frame = Math.round(ctx.currentTime * SR);
    const deadline = Date.now() + 10000; // wall clock: a stalled io fails by name below
    while (!settled && Date.now() < deadline) {
      await new Promise((r) => { setImmediate(r); });
      frame += BLOCK;
      ctx.currentTime = frame / SR;
      if (sp && sp.onaudioprocess) {
        sp.onaudioprocess({ inputBuffer: { getChannelData: () => data },
          playbackTime: frame / SR });
      }
    }
    assert.ok(settled, 'the io preflight settled within 10 s of wall clock');
    return p;
  }
  return { io, engine, ctx, drive };
}

const stoppedVoice = () => ({ ended: false, endTime: 1 + FAST_FADE_END_S });
const heldVoice = () => ({ ended: false, endTime: Infinity });

test('C016 R-2: the io does not count a voice Measure has just stopped', async () => {
  const rig = captureRig({ voices: [stoppedVoice()] });
  assert.equal(rig.engine.audibleVoiceCount, 1, 'the fade is still running at the start');
  const facts = await rig.drive(rig.io.preflight({ otherAudio: false }));
  assert.ok(facts.inputLevel && Number.isFinite(facts.inputLevel.rmsDb), 'the level was read');
  assert.equal(facts.output.audibleVoices, 0, JSON.stringify(facts.output));
  assert.equal(facts.output.otherAudio, false);
  rig.io.dispose();
});

test('C016 R-2: a voice that sounds through the level window is counted', async () => {
  const rig = captureRig({ voices: [heldVoice()] });
  const facts = await rig.drive(rig.io.preflight({ otherAudio: false }));
  assert.equal(facts.output.audibleVoices, 1);
  assert.equal(facts.output.otherAudio, true);
  rig.io.dispose();
});

test('C016 R-3: the caller\'s fact reaches output.otherAudio with no engine voice', async () => {
  for (const given of [true, () => true]) {
    const rig = captureRig();
    const facts = await rig.drive(rig.io.preflight({ otherAudio: given }));
    assert.equal(facts.output.audibleVoices, 0);
    assert.equal(facts.output.otherAudio, true, String(given));
    rig.io.dispose();
  }
  const quiet = captureRig();
  const none = await quiet.drive(quiet.io.preflight());
  assert.equal(none.output.otherAudio, false, 'no caller fact, no voice');
  quiet.io.dispose();
});

test('C016 R-5: the caller\'s probe is read at the level read, not only before the awaits',
  async () => {
    // A sequence that ends while the input opens (a permission prompt) is not in the reading.
    let playing = true;
    const ended = captureRig({ onOpen: () => { playing = false; } });
    const a = await ended.drive(ended.io.preflight({ otherAudio: () => playing }));
    assert.equal(a.output.otherAudio, false, 'ended before the window opened');
    ended.io.dispose();
    // A source started while the input opens is.
    playing = false;
    const started = captureRig({ onOpen: () => { playing = true; } });
    const b = await started.drive(started.io.preflight({ otherAudio: () => playing }));
    assert.equal(b.output.otherAudio, true, 'started before the window opened');
    started.io.dispose();
  });

test('C016 R-2: the report of a check after a stop blames neither the app nor the room wrongly',
  async () => {
    const recipe = { stimulus: { kind: 'log-sweep', duration: 1, level: 0.25, f1: 20, f2: 20000,
      fade: 0.01 }, repeats: 1, analysis: { noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5,
      gapS: 0.2 } };
    // level 0.1 is -20 dB relative: above the noisy threshold, so NOISE_HIGH is raised.
    const rig = captureRig({ voices: [stoppedVoice()] });
    const me = createMeasurementEngine({ io: rig.io });
    const rep = await rig.drive(me.preflight(recipe));
    const by = Object.fromEntries(rep.warnings.map((w) => [w.code, w.text]));
    assert.ok(!('OTHER_AUDIO' in by), JSON.stringify(Object.keys(by)));
    assert.match(by.NOISE_HIGH || '', /^Background level -20\.0 dB relative/);
    assert.doesNotMatch(by.NOISE_HIGH || '', /own output/);
    me.dispose();
  });

// ------------------------------------------------------------------ the quality bar (R-1)

const preflightEvent = (output) => ({ type: 'preflight', ready: true, warnings: [],
  blockers: [], facts: { input: { ok: true, device: { label: 'Mic' } },
    inputLevel: { peak: 0.2, rmsDb: -20 }, output } });
const noiseItem = (output) => qualityBarView(reduceQualityBar(initialQualityBar(),
  preflightEvent(output))).items.find((i) => i.id === 'noise');

test('C016 R-1: the Noise item does not call a reading with the app\'s output the background',
  () => {
    for (const output of [{ gain: 0.08, audibleVoices: 0, otherAudio: true },
      { gain: 0.08, audibleVoices: 1 }]) {
      const it = noiseItem(output);
      assert.match(it.detail, /includes the app's own output/, JSON.stringify(output));
      assert.doesNotMatch(it.detail, /background [-\u2212]20/i, it.detail);
      assert.match(it.detail, /^Preflight input [-\u2212]20\.0 dB relative/);
    }
    const room = noiseItem({ gain: 0.08, audibleVoices: 0, otherAudio: false });
    assert.match(room.detail, /^Preflight background [-\u2212]20\.0 dB relative/);
    assert.doesNotMatch(room.detail, /own output/);
    assert.equal(room.status, 'warn', 'a high background is still a warning');
  });

// ------------------------------------------------------------------ the MEASURE adapter (R-3)

function measureUi(svcOver = {}) {
  const calls = [];
  const svc = { engine: { init() {}, activeNodeCount: 0 }, loopback: true, build: null,
    stopPlayback() { calls.push('stopPlayback'); }, ...svcOver };
  const cmp = {};
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(createMeasureUi(svc)));
  Object.assign(cmp, { notify() {}, $nextTick: (f) => f && f(), openModal() {},
    closeModal() {}, setWorkspace() {} });
  cmp.measureInit();
  return { cmp, calls, seam: cmp.measureTestSeam() };
}

test('C016 R-3: the setup check hands the engine a live probe of outputBusy, stops nothing',
  async () => {
    let busy = true;
    const { cmp, calls, seam } = measureUi({ outputBusy: () => busy });
    await cmp.measureCheck(); // makes the engine
    calls.length = 0;
    let seen = null;
    seam.engine.preflight = (recipe, opts) => { seen = opts; return Promise.resolve(); };
    await cmp.measureCheck();
    assert.ok(seen, 'preflight was called');
    assert.equal(typeof seen.otherAudio, 'function', 'a probe, read by the io at the level read');
    assert.equal(seen.otherAudio(), true, 'an owner sounds');
    busy = false;
    assert.equal(seen.otherAudio(), false, 'read live');
    assert.deepEqual(calls, [], 'the setup check stops nothing');
  });

test('C016 R-2: Measure stops the owners before its preflight and hands it no own-output fact',
  async () => {
    let busy = true;
    const order = [];
    const { cmp, seam } = measureUi({ outputBusy: () => busy,
      stopPlayback() { order.push('stopPlayback'); busy = false; } });
    await cmp.measureCheck();
    order.length = 0;
    let seen = null;
    seam.engine.measure = (recipe, opts) => { order.push('measure'); seen = opts;
      return Promise.resolve(null); };
    await cmp.measureStart();
    assert.deepEqual(order, ['stopPlayback', 'measure']);
    assert.ok(seen && !seen.otherAudio, JSON.stringify(seen));
  });

// ------------------------------------------------------------------ the status-bar play key (R-4)

test('C016 R-4: the status-bar play key stops a sequence started under 150 ms ago', () => {
  const log = [];
  const editor = { playing: true, stop() { log.push('sequencer'); this.playing = false; } };
  const cmp = {};
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(createWorkbench({
    labs: { sequencer: { editor } } })));
  Object.assign(cmp, { seqPlaying: false, playing: false, continuousAllowed: false,
    isProgrammed: false, trigger() { log.push('trigger'); }, stopNow() { log.push('stopNow'); },
    toggleLatch() { log.push('latch'); } });
  cmp.statusPlay();
  assert.equal(log[0], 'sequencer', JSON.stringify(log));
});

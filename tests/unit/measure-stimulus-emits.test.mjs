// C033: MEASURE emits its stimulus on Check setup and on a run, and when it cannot it says why,
// truthfully. The audit (af, origin/main 6d5efa89, three engines) found Check setup silent,
// WebKit's input refused under the page's own `playback` audio session and announced as "no
// input signal", Firefox's check silent while its permission prompt waits, and the "not
// available here" sentence in the page beside a granted microphone.
// - the run path and the setup check schedule an AudioBufferSourceNode whose graph reaches the
//   stub context's destination through engine.master (capture.js prepareStim);
// - the check reports whether the input heard its stimulus (STIMULUS_NOT_HEARD) or why it could
//   not play it (STIMULUS_NOT_PLAYED); it stops nothing (C016);
// - the capture holds a `play-and-record` audio session while its input is open and puts the
//   page's `playback` back after it;
// - a refusal is announced with its true reason; the wait for a permission prompt is announced;
// - the RTA tab carries the "not available here" sentence only without a microphone API.
import test from 'node:test';
import assert from 'node:assert/strict';

// Namespace imports for what C033 adds, so that on a tree without it every case fails on its
// assertion (fail-first), not the whole file on a missing export.
import * as capture from '../../src/js/measurement/capture.js';
import * as engineModule from '../../src/js/measurement/engine.js';
import { announce, ANNOUNCEMENTS } from '../../src/js/measurement/views/announcements.js';
import { REASON_STEP } from '../../src/js/measurement/views/measure-flow.js';
import { MIC_UNAVAILABLE_TEXT } from '../../src/js/audio/microphone.js';
import * as measureConstants from '../../src/js/ui/measure/constants.js';
import { createMeasureUi } from '../../src/js/ui/measure.js';
import { rig, RECIPE, SR } from './fixtures/capture-rig.mjs';

const { createMeasurementEngine, MEASUREMENT_ERRORS } = engineModule;
const CAPTURE_AUDIO_SESSION = capture.CAPTURE_AUDIO_SESSION ?? 'play-and-record';
const PREFLIGHT_PROBE_S = engineModule.PREFLIGHT_PROBE_S ?? 1;
const captureAudioSession = (nav) => {
  assert.equal(typeof capture.captureAudioSession, 'function', 'capture.js captureAudioSession');
  return capture.captureAudioSession(nav);
};
const rtaLiveAvailability = (available) => {
  assert.equal(typeof measureConstants.rtaLiveAvailability, 'function',
    'ui/measure/constants.js rtaLiveAvailability');
  return measureConstants.rtaLiveAvailability(available);
};

// ------------------------------------------------------------------ the stimulus reaches out

test('C033: Check setup plays the stimulus into the destination, through engine.master',
  async () => {
    const r = rig();
    const me = createMeasurementEngine({ io: r.io });
    const rep = await r.drive(me.preflight(RECIPE));
    assert.equal(me.state, 'READY', JSON.stringify(rep.blockers));
    assert.equal(r.started.length, 1, 'the check started one buffer source');
    const src = r.started[0];
    assert.ok(r.reachesDestination(src), `the probe reaches the destination: ${r.path(src)}`);
    assert.ok([...[...src.out][0].out].includes(r.engine.master),
      'through the fade gain into engine.master (the safety chain), never around it');
    assert.equal(src.buffer.length, Math.round(PREFLIGHT_PROBE_S * SR),
      'the recipe\'s stimulus, shortened to PREFLIGHT_PROBE_S');
    const p = rep.facts.probe;
    assert.equal(p.played, true, JSON.stringify(p));
    assert.ok(p.startAt >= 1, 'after the background reading, on the audio clock');
    assert.ok(p.inputLevel.rmsDb > rep.facts.inputLevel.rmsDb + 3, JSON.stringify(p));
    assert.equal(r.engine.stops, 0, 'the check stops no other output owner (C016)');
    const codes = rep.warnings.map((w) => w.code);
    assert.ok(!codes.includes('STIMULUS_NOT_HEARD'), codes.join(','));
    assert.ok(!codes.includes('STIMULUS_NOT_PLAYED'), codes.join(','));
    me.dispose();
    assert.equal(r.io.activeNodeCount, 0, 'every node released');
  });

test('C033: the run path schedules the stimulus on the destination (one source per run)',
  async () => {
    const r = rig();
    const me = createMeasurementEngine({ io: r.io });
    await r.drive(me.measure(RECIPE));
    assert.equal(r.started.length, 1, 'measure()\'s own preflight plays no probe; the run does');
    const src = r.started[0];
    assert.ok(r.reachesDestination(src), `the run's sweep reaches the destination: ${r.path(src)}`);
    assert.equal(src.buffer.length, RECIPE.stimulus.duration * SR, 'the whole stimulus');
    assert.ok(r.engine.stops >= 1, 'the run owns the output: earlier voices are stopped');
    me.dispose();
  });

test('C033: an input that does not hear the check\'s stimulus is said, not passed as READY '
  + 'silently', async () => {
    const r = rig({ heard: null });
    const me = createMeasurementEngine({ io: r.io });
    const rep = await r.drive(me.preflight(RECIPE));
    const w = rep.warnings.find((x) => x.code === 'STIMULUS_NOT_HEARD');
    assert.ok(w, JSON.stringify(rep.warnings.map((x) => x.code)));
    assert.match(w.text, /^The input level did not rise while the check played the stimulus/);
    assert.match(w.text, /output reaches the input/);
    assert.equal(REASON_STEP.STIMULUS_NOT_HEARD, 'stimulus');
    assert.equal(REASON_STEP.STIMULUS_NOT_PLAYED, 'stimulus');
    assert.equal(rep.ready, true, 'a warning never blocks (§30)');
    me.dispose();
  });

test('C033: a digitally silent input during the check is said, not passed as READY (98 F1)',
  async () => {
    // Exact zeros read -Infinity dB both before and during the probe: no rise is a rise of NaN,
    // and NaN is not heard.
    const r = rig({ background: 0, heard: 0 });
    const me = createMeasurementEngine({ io: r.io });
    const rep = await r.drive(me.preflight(RECIPE));
    assert.equal(rep.facts.inputLevel.rmsDb, -Infinity);
    assert.equal(rep.facts.probe.played, true);
    assert.equal(rep.facts.probe.inputLevel.rmsDb, -Infinity);
    const w = rep.warnings.find((x) => x.code === 'STIMULUS_NOT_HEARD');
    assert.ok(w, JSON.stringify(rep.warnings.map((x) => x.code)));
    assert.match(w.text, /digitally silent/);
    assert.equal(w.value, null, 'no number is invented for a rise that has none');
    me.dispose();
  });

test('C033: the heard judgement is the rise, whatever the levels are (98 F1)', async () => {
  const facts = (bg, probe) => ({ audioContext: { available: true, state: 'running' },
    sampleRate: SR, permission: 'granted', input: { ok: true, device: { label: null, id: null },
      constraints: { requested: null, applied: null } },
    inputLevel: { peak: 0.01, rmsDb: bg },
    output: { gain: 0.08, maxGain: 0.25, audibleVoices: 0, otherAudio: false },
    worklet: { supported: true, mode: 'audioworklet' },
    probe: { played: true, seconds: 1, startAt: 1, inputLevel: { peak: 0.1, rmsDb: probe } } });
  const heard = async (bg, probe) => {
    const f = facts(bg, probe);
    const io = { sampleRate: SR, now: () => 0, preflight: async () => f,
      captureNoise: async () => null, runStimulus: async () => null, cancel() {}, dispose() {} };
    const me = createMeasurementEngine({ io });
    const rep = await me.preflight(RECIPE);
    me.dispose();
    return !rep.warnings.some((x) => x.code === 'STIMULUS_NOT_HEARD');
  };
  assert.equal(await heard(-60, -20), true, 'a 40 dB rise is heard');
  assert.equal(await heard(-60, -59), false, 'a 1 dB rise is not');
  assert.equal(await heard(-Infinity, -Infinity), false, 'silence before and during');
  assert.equal(await heard(-40, -Infinity), false, 'silence during the probe');
  assert.equal(await heard(-Infinity, -40), true, 'a signal out of digital silence is heard');
  assert.equal(await heard(null, null), false, 'levels lost on the way (JSON null)');
  assert.equal(await heard(-40, NaN), false, 'a level that is no number');
});

test('C033: a probe that cannot play says why', async () => {
  const facts = { audioContext: { available: true, state: 'running' }, sampleRate: SR,
    permission: 'granted', input: { ok: true, device: { label: null, id: null },
      constraints: { requested: null, applied: null } }, inputLevel: { peak: 0.01, rmsDb: -40 },
    output: { gain: 0.08, maxGain: 0.25, audibleVoices: 0, otherAudio: false },
    worklet: { supported: true, mode: 'audioworklet' },
    probe: { played: false, reason: 'The audio context is closed.' } };
  let given = null;
  const io = { sampleRate: SR, now: () => 0, preflight: async (o) => { given = o; return facts; },
    captureNoise: async () => null, runStimulus: async () => null, cancel() {}, dispose() {} };
  const me = createMeasurementEngine({ io });
  const rep = await me.preflight(RECIPE);
  assert.equal(typeof given.probe, 'function', 'the setup check hands the io its stimulus');
  const samples = given.probe(SR);
  assert.ok(samples instanceof Float32Array && samples.length === PREFLIGHT_PROBE_S * SR);
  const w = rep.warnings.find((x) => x.code === 'STIMULUS_NOT_PLAYED');
  assert.ok(w, JSON.stringify(rep.warnings.map((x) => x.code)));
  assert.equal(w.text, 'The setup check could not play the stimulus (The audio context is '
    + 'closed); the measurement plays it.');
  me.dispose();
});

// ------------------------------------------------------------------ the audio session (WebKit)

test('C033: the capture holds play-and-record while its input is open, then puts playback back',
  async () => {
    const session = { type: 'playback' };
    const r = rig({ session });
    const me = createMeasurementEngine({ io: r.io });
    await r.drive(me.preflight(RECIPE));
    assert.equal(r.seen.sessionAtOpen, CAPTURE_AUDIO_SESSION,
      'getUserMedia is asked in a session that may capture');
    assert.equal(session.type, CAPTURE_AUDIO_SESSION, 'held while the checked input is open');
    me.reset(); // READY -> IDLE releases the input
    assert.equal(session.type, 'playback', 'the page\'s playback session is back');
    me.dispose();
  });

test('C033: a refused input puts the session back and is reported as refused', async () => {
  const session = { type: 'playback' };
  const denied = Object.assign(new Error('The request is not allowed'),
    { name: 'NotAllowedError' });
  const r = rig({ session, refuse: denied });
  const me = createMeasurementEngine({ io: r.io });
  const rep = await r.drive(me.preflight(RECIPE));
  assert.equal(session.type, 'playback');
  assert.deepEqual(rep.blockers.map((b) => b.code), ['MIC_DENIED']);
  me.dispose();
});

test('C033: captureAudioSession leaves other sessions and absent APIs alone', () => {
  const auto = { type: 'auto' };
  captureAudioSession({ audioSession: auto })();
  assert.equal(auto.type, 'auto', 'only the page\'s playback session is switched');
  assert.doesNotThrow(() => captureAudioSession({})());
  assert.doesNotThrow(() => captureAudioSession(null)());
  const refusing = { get type() { return 'playback'; }, set type(v) { throw new Error('no'); } };
  assert.doesNotThrow(() => captureAudioSession({ audioSession: refusing })());
});

// ------------------------------------------------------------------ announcements

const check = (to, blockers) => [
  { type: 'state', from: 'IDLE', to: 'PREFLIGHT' },
  { type: 'preflight', ready: false, warnings: [], blockers },
  { type: 'state', from: 'PREFLIGHT', to: 'INVALID',
    info: { reasons: blockers.map((b) => b.code) } },
];

test('C033: a refused input or context is announced with its true reason', () => {
  const said = (blockers) => announce(check('INVALID', blockers)).map((m) => m.text);
  assert.deepEqual(said([{ code: 'NO_INPUT', text: MIC_UNAVAILABLE_TEXT }]),
    [`${ANNOUNCEMENTS.setupFailed}: ${MIC_UNAVAILABLE_TEXT.replace(/\.$/, '')}`]);
  assert.deepEqual(said([{ code: 'NO_INPUT', text: 'AudioSession category is not compatible '
    + 'with audio capture.' }]), ['Setup check failed: AudioSession category is not compatible '
    + 'with audio capture']);
  assert.deepEqual(said([{ code: 'UNSUPPORTED', text: 'The audio context is closed.' }]),
    ['Setup check failed: The audio context is closed']);
  // The generic sentence keeps its short words.
  assert.deepEqual(said([{ code: 'NO_INPUT', text: MEASUREMENT_ERRORS.NO_INPUT }]),
    ['Setup check failed: no input signal']);
  assert.deepEqual(said([{ code: 'MIC_DENIED', text: MEASUREMENT_ERRORS.MIC_DENIED }]),
    ['Setup check failed: microphone permission denied']);
});

test('C033: a check that waits for the microphone prompt says so, once', () => {
  const msgs = announce([{ type: 'state', from: 'IDLE', to: 'PREFLIGHT' },
    { type: 'waiting', what: 'permission' }, { type: 'waiting', what: 'permission' }]);
  assert.deepEqual(msgs.map((m) => [m.text, m.politeness]),
    [['Setup check: allow the microphone if the browser asks', 'polite']]);
});

test('C033: the engine tells the caller while the browser asks for the microphone', async () => {
  const events = [];
  let waiting = null;
  const io = { sampleRate: SR, now: () => 0, cancel() {}, dispose() {},
    captureNoise: async () => null, runStimulus: async () => null,
    preflight: async (o) => { waiting = o.onWaiting; o.onWaiting({ what: 'permission' });
      return { audioContext: { available: true, state: 'running' }, sampleRate: SR,
        input: { ok: false, error: { name: 'NotAllowedError', code: 'MIC_DENIED' } } }; } };
  const me = createMeasurementEngine({ io, onEvent: (e) => events.push(e) });
  await me.preflight(RECIPE);
  assert.equal(typeof waiting, 'function');
  assert.ok(events.some((e) => e.type === 'waiting' && e.what === 'permission'),
    JSON.stringify(events.map((e) => e.type)));
  me.dispose();
});

// ------------------------------------------------------------------ the file:// sentence

function withNavigator(nav, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true,
    writable: true });
  try { return fn(); } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
    else delete globalThis.navigator;
  }
}
function measureMeas() {
  const svc = { engine: { init() {}, activeNodeCount: 0 }, loopback: false, build: null,
    stopPlayback() {} };
  return createMeasureUi(svc).meas;
}

test('C033: a granted microphone (file:// included) is never called unavailable', () => {
  const granted = withNavigator({ mediaDevices: { getUserMedia: async () => null } },
    measureMeas);
  assert.equal(granted.rtaLive.available, true);
  assert.equal(granted.rtaLive.unavailableText, null,
    'the "not available here" sentence is not in the page beside a microphone');
  const none = withNavigator({}, measureMeas);
  assert.equal(none.rtaLive.available, false);
  assert.equal(none.rtaLive.unavailableText, MIC_UNAVAILABLE_TEXT, 'said where it is true');
  assert.deepEqual(rtaLiveAvailability(true), { available: true, unavailableText: null });
  assert.deepEqual(rtaLiveAvailability(false),
    { available: false, unavailableText: MIC_UNAVAILABLE_TEXT });
});

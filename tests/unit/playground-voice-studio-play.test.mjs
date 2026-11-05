// Plan V605 review F1, F2 and F8: how long Studio Play plays the Playground voice it opened.
//
// The Studio transport ends a playback at the timeline's end plus STOP_PAD_S
// (studio/transport.js, anchorEndTime of studio/timeline-compiler.js). A document whose timeline
// is 0 s long therefore stops within a few milliseconds of Play, silent. The Playground holds an
// open voice (a held tone, AM, a dual voice, wobble at depth 0) for its safety limit unless
// continuous playback is allowed (audio-engine.js play, "Open patterns"), and plays a limitable
// finite tone for at most that limit (scheduler.js scheduleConst). The opened document plays
// the same length: a gate from 0 to the limit minus the release, the release inside the limit.
// A held voice with continuous playback allowed has no end, so it is refused with its reason.
//
// The live check of the same behaviour (Play, still sounding after 1 s, Stop to 0 nodes) is
// tests/browser/qa-regressions.cjs signal-path-open-in-studio.
//
// The opener is loaded inside the tests, so that a tree without it fails each of them on its
// assertion (no opener, or a document Studio Play ends at once) rather than on the import.
//   node --test tests/unit/playground-voice-studio-play.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createAnchor, anchorEndTime } from '../../src/js/studio/timeline-compiler.js';
import { STOP_PAD_S } from '../../src/js/sequencer/compiler.js';
import { DEFAULT_SAFETY_LIMIT_S } from '../../src/js/core/safety.js';
import { VOICE_CONFIGS, voiceSetup } from './fixtures/playground-voice-configs.mjs';

const OPENER = '../../src/js/studio/playground-voice-open.js';
const RATE = 48000;

/** The opener module, or null where this tree has none. */
async function opener() {
  try {
    return await import(OPENER);
  } catch {
    return null;
  }
}

async function open(input) {
  const mod = await opener();
  assert.ok(mod && typeof mod.playgroundVoiceDocument === 'function',
    'the Studio opens the Playground voice (playgroundVoiceDocument)');
  return mod.playgroundVoiceDocument(input);
}

/** Seconds after Play at which the Studio transport ends this document. */
function playEnds(model) {
  return anchorEndTime(createAnchor(model, { baseTime: 0, sampleRate: RATE })) + STOP_PAD_S;
}

const setup = (id, extra = {}) => {
  const s = voiceSetup(VOICE_CONFIGS.find((c) => c.id === id), { sampleRate: RATE });
  return { ...s, input: { ...s.input, ...extra } };
};
const releaseOf = (model) => model.graph.nodes.find((n) => n.type === 'envelope').params.release;

const OPEN = ['single-tone', 'single-tone-filter-adsr', 'am', 'am-audio-rate', 'wobble-still',
  'dual-mono', 'dual-stereo', 'dual-panned'];

test('V605 F1: Studio Play of the Playground default held tone plays for the safety limit',
  async () => {
    const s = setup('single-tone');
    assert.equal(s.input.limitS, DEFAULT_SAFETY_LIMIT_S);
    const r = await open(s.input);
    assert.equal(r.ok, true, r.reason);
    const rel = releaseOf(r.model);
    assert.deepEqual(r.model.timeline.clips.map((c) => [c.start, c.duration, c.payload.action]),
      [[0, Math.round((DEFAULT_SAFETY_LIMIT_S - rel) * 1e9) / 1e9, 'gate']],
      'one gate from 0 to the limit minus the release');
    const end = playEnds(r.model);
    assert.ok(end > 1, `Studio Play still plays after 1 s (it ends at ${end} s)`);
    assert.ok(Math.abs(end - (DEFAULT_SAFETY_LIMIT_S - rel + STOP_PAD_S)) < 1e-6,
      `Studio Play ends where the gate does (${end} s)`);
  });

for (const id of OPEN) {
  test(`V605 F1: an open voice (${id}) is gated for the limit, not 0 s long`, async () => {
    for (const limitS of [0.5, 2, 5]) {
      const r = await open(setup(id, { limitS }).input);
      assert.equal(r.ok, true, `${id}, limit ${limitS} s: ${r.reason}`);
      const rel = releaseOf(r.model);
      assert.equal(r.model.timeline.clips.length, 1, `${id}: one gate`);
      const g = r.model.timeline.clips[0];
      assert.ok(Math.abs(g.start) < 1e-9 && Math.abs(g.duration - (limitS - rel)) < 1e-9,
        `${id}, limit ${limitS} s: the gate is 0 to ${limitS - rel} s, not ${g.duration}`);
    }
  });
}

test('V605 F1: a held voice with continuous playback allowed is refused, not given an end',
  async () => {
    const mod = await opener();
    assert.ok(mod, 'the Studio opens the Playground voice');
    for (const id of ['single-tone', 'am', 'dual-mono']) {
      const r = await open(setup(id, { continuous: true }).input);
      assert.equal(r.ok, false, `${id} with continuous playback is refused`);
      assert.equal(r.code, 'held');
      assert.equal(r.reason, mod.VOICE_OPEN_TEXT.held);
      assert.match(r.reason, /continuous playback off/);
    }
  });

test('V605 F2: a finite tone over the limit opens for the limit, as the Playground plays it',
  async () => {
    const s = setup('finite-over-limit');
    assert.equal(s.plan.dur, 5);
    assert.equal(s.plan.limitable, true);
    const r = await open(s.input);
    assert.equal(r.ok, true, r.reason);
    const rel = releaseOf(r.model);
    assert.ok(Math.abs(r.model.timeline.clips[0].duration - (2 - rel)) < 1e-9,
      `gated to the 2 s limit minus the release, not ${r.model.timeline.clips[0].duration} s`);
    // Continuous playback allowed: the Playground plays the programmed 5 s (v.extended).
    const c = await open({ ...s.input, continuous: true });
    assert.equal(c.ok, true, c.reason);
    assert.ok(Math.abs(c.model.timeline.clips[0].duration - (5 - rel)) < 1e-9,
      'continuous: the programmed length');
    // A tone inside the limit keeps its own length.
    const f = await open(setup('finite-tone').input);
    assert.ok(Math.abs(f.model.timeline.clips[0].duration - (0.5 - releaseOf(f.model))) < 1e-9);
  });

test('V605 F2: the input Open in Studio reads carries the limit and the permission', async () => {
  const mod = await opener();
  assert.ok(mod && typeof mod.voiceInputFrom === 'function',
    'the input is built by voiceInputFrom (main.js playgroundVoiceInput)');
  const plan = { type: 'const', kind: 'open', wave: 'sine', freq: 440 };
  const cmp = { currentPlan: () => ({ ok: true, plan }), waveform: 'sine', frequency: 440,
    gainLevel: 0.3, attack: 10, release: 30, safetyLimit: 3, continuousAllowed: false };
  const labs = (p) => ({ adsr: null, filter: null, additive: null, router: null, phaseDeg: 0,
    of: p.type });
  const input = mod.voiceInputFrom(cmp, labs);
  assert.deepEqual(input, { plan, waveform: 'sine', frequency: 440, gain: 0.3, attackMs: 10,
    releaseMs: 30, lab: labs(plan), limitS: 3, continuous: false });
  assert.equal(mod.voiceInputFrom({ ...cmp, continuousAllowed: true }, labs).continuous, true);
  assert.equal(mod.voiceInputFrom(null, labs), null);
});

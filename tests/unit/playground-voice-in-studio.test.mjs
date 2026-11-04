// Plan V605 (intent studio-completion, voice-opens-in-studio): the Playground voice opens from
// the Signal Path as an editable Studio document built from the graph that view draws
// (src/js/studio/playground-voice-open.js over playground-voice.js), and a configuration the
// Studio cannot sound the same is refused with its reason.
//
// The configurations are tests/unit/fixtures/playground-voice-configs.mjs: COVERED below lists
// the ones that open and REFUSED the ones refused, each with its reason. For each covered one,
// at 44.1 and 48 kHz: the document is a valid Studio model whose graph holds every node of the
// drawn graph unchanged (a mono dual voice adds the engine's two centred panners), its timeline
// gates the Envelope where the Playground voice's tones are (one gate per tone, ending where the
// Playground's release starts; an open voice and a finite tone over the limit for the safety
// limit), the offline render plan renders all of it (no limitation, every clip and lane
// rendered), and the Playground's input is left unchanged.
//
// The sample residual: node has no OfflineAudioContext, and the repository's mock contexts
// record the calls made on them, not samples, so the render itself runs in real browsers:
// tests/browser/v31-studio-offline.cjs renders each configuration listed here through
// OfflineAudioContext in Chromium, Firefox and WebKit, at each browser's own rate, the
// Playground voice through the AudioEngine and the opened document through the Studio runtime,
// and requires a residual RMS at least 60 dB below the Playground render's RMS, judged from the
// end of the Studio's 20 ms start crossfade (the start is K177's; from the first sample it is
// printed, not judged), with both voices ending together
// (tests/browser/fixtures/playground-voice-in-studio-entry.js). The last test here holds that
// suite to this list and that bound.
//   node --test tests/unit/playground-voice-in-studio.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VOICE_OPEN_TEXT, playgroundVoiceDocument,
} from '../../src/js/studio/playground-voice-open.js';
import { PLAYGROUND_VOICE_IDS as ID, PLAYGROUND_VOICE_TITLE, playgroundVoiceModel }
  from '../../src/js/studio/playground-voice.js';
import { validateStudioModel } from '../../src/js/studio/validate.js';
import { planOfflineRender } from '../../src/js/studio/offline.js';
import { VOICE_CONFIGS, voiceSetup } from './fixtures/playground-voice-configs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const RATES = [44100, 48000];

/** The covered configurations: they open, and their Studio render matches the Playground's. */
const COVERED = [
  'single-tone', 'single-tone-filter-adsr', 'finite-tone', 'finite-over-limit',
  'finite-tone-adsr', 'am',
  'am-audio-rate', 'wobble-still', 'sequence', 'sequence-adsr', 'pulse', 'octave', 'chirp',
  'pingpong', 'sweep-once', 'sweep-linear-down', 'sweep-pingpong', 'dual-mono', 'dual-stereo',
  'dual-panned',
];
/** The refused configurations and the reason each one gives. */
const REFUSED = {
  additive: VOICE_OPEN_TEXT.additive,
  siren: VOICE_OPEN_TEXT.modulation,
  'siren-triangle': VOICE_OPEN_TEXT.modulation,
  wobble: VOICE_OPEN_TEXT.modulation,
  fm: VOICE_OPEN_TEXT.modulation,
  'dual-phase': VOICE_OPEN_TEXT.phase(90),
  'sweep-continuous': VOICE_OPEN_TEXT.continuous,
  'held-continuous': VOICE_OPEN_TEXT.held,
  'short-tone': VOICE_OPEN_TEXT.short(20),
  'finite-adsr-fast-release': VOICE_OPEN_TEXT.release(2),
};

const byId = (id) => VOICE_CONFIGS.find((c) => c.id === id);

/** Seconds the Playground plays `plan` as one tone (audio-engine.js play, HOLD). */
const playedFor = (plan, input) => (plan.kind !== 'finite' ? input.limitS
  : plan.limitable && plan.dur > input.limitS && !input.continuous ? input.limitS : plan.dur);

test('V605 lists every configuration once: the covered and the refused', () => {
  const ids = VOICE_CONFIGS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'configuration ids are unique');
  assert.deepEqual(VOICE_CONFIGS.filter((c) => c.opens).map((c) => c.id), COVERED);
  assert.deepEqual(VOICE_CONFIGS.filter((c) => !c.opens).map((c) => c.id).sort(),
    Object.keys(REFUSED).sort());
  // The sources V605 names: single, sweep and dual (B phase 0); the V1 patterns of presets.js.
  const covered = (pred) => COVERED.map(byId).some(pred);
  assert.ok(covered((c) => c.cfg.source === 'single'), 'a single source is covered');
  assert.ok(covered((c) => c.cfg.source === 'sweep'), 'the sweep source is covered');
  assert.ok(covered((c) => c.cfg.source === 'dual' && !(c.labs && c.labs.phaseDeg)),
    'a dual source with B phase 0 is covered');
  const patterns = new Set(VOICE_CONFIGS.map((c) => c.cfg.pattern).filter(Boolean));
  for (const p of ['siren', 'wobble', 'am', 'fm', 'sequence', 'pulse', 'octave', 'chirp']) {
    assert.ok(patterns.has(p), `the V1 pattern ${p} is listed (covered or refused)`);
  }
});

for (const id of COVERED) {
  test(`V605 covered: ${id} opens as the drawn graph, gated where the Playground plays`, () => {
    for (const sampleRate of RATES) {
      const s = voiceSetup(byId(id), { sampleRate });
      assert.ok(s.plan, `${id}: a valid Playground plan`);
      const before = JSON.stringify(s.input);
      const r = playgroundVoiceDocument(s.input);
      assert.equal(JSON.stringify(s.input), before, `${id}: the Playground input is unchanged`);
      assert.equal(r.ok, true, `${id} at ${sampleRate} Hz: ${r.reason}`);
      const m = r.model;
      assert.equal(m.metadata.title, PLAYGROUND_VOICE_TITLE);
      assert.equal(validateStudioModel(m).ok, true, `${id}: a valid Studio model`);
      // The drawn graph, node for node and edge for edge into the same nodes.
      const drawn = playgroundVoiceModel(s.input).model;
      const nodes = new Map(m.graph.nodes.map((n) => [n.id, n]));
      for (const n of drawn.graph.nodes) {
        const o = nodes.get(n.id);
        assert.ok(o, `${id}: ${n.id} is in the document`);
        assert.equal(o.type, n.type);
        assert.deepEqual(o.params, n.params, `${id}: ${n.id} keeps its parameters`);
      }
      const extra = m.graph.nodes.filter((n) => !drawn.graph.nodes.some((d) => d.id === n.id));
      const mono = s.plan.type === 'dual' && !s.input.lab.router && !s.plan.stereo;
      assert.deepEqual(extra.map((n) => [n.id, n.type, n.params.pan]),
        mono ? [[ID.panA, 'pan', 0], [ID.panB, 'pan', 0]] : [],
        `${id}: only a mono dual voice adds the engine's centred panners`);
      assert.equal(m.graph.edges.length, drawn.graph.edges.length + extra.length);
      assert.deepEqual(m.timeline.automation, drawn.timeline.automation,
        `${id}: the drawn automation lanes`);
      // The timeline: a gate per tone; an open voice and a limited finite tone are one tone
      // as long as the Playground plays it (the safety limit).
      const played = playedFor(s.plan, s.input);
      const env = m.graph.nodes.find((n) => n.id === ID.envelope).params;
      const tones = s.plan.type === 'steps' ? s.plan.steps
        : s.plan.type === 'ramps' && s.plan.envelope === 'segment' ? s.plan.segments
          : [{ t: 0, dur: played }];
      assert.deepEqual(m.timeline.tracks.map((t) => [t.kind, t.target]),
        [['event', ID.envelope]]);
      assert.equal(m.timeline.clips.length, tones.length, `${id}: one gate per tone`);
      tones.forEach((t, i) => {
        const c = m.timeline.clips[i];
        assert.equal(c.kind, 'event');
        assert.equal(c.payload.action, 'gate');
        assert.ok(Math.abs(c.start - t.t) < 1e-9, `${id}: gate ${i} starts with its tone`);
        assert.ok(Math.abs(c.duration - (t.dur - env.release)) < 1e-9,
          `${id}: gate ${i} ends where the Playground's release starts`);
      });
      // Everything of it renders offline (what the browser check renders).
      const duration = played + 0.1;
      const plan = planOfflineRender(m, { duration, sampleRate });
      assert.equal(plan.ok, true, `${id}: renders offline`);
      assert.deepEqual(plan.limitations, [], `${id}: no limitation`);
      assert.ok(plan.clips.every((c) => c.rendered) && plan.automation.every((a) => a.rendered),
        `${id}: every clip and lane is rendered`);
    }
  });
}

for (const [id, reason] of Object.entries(REFUSED)) {
  test(`V605 refused: ${id}, with its reason`, () => {
    for (const sampleRate of RATES) {
      const s = voiceSetup(byId(id), { sampleRate });
      const r = playgroundVoiceDocument(s.input);
      assert.equal(r.ok, false, `${id} is refused`);
      assert.equal(r.code, byId(id).code);
      assert.equal(r.reason, reason);
      assert.equal(r.model, undefined, `${id}: nothing to open approximately`);
    }
  });
}

test('V605 refused: no valid Playground plan, and a value outside a Studio range', () => {
  assert.deepEqual(playgroundVoiceDocument({ plan: null }),
    { ok: false, code: 'invalid', reason: VOICE_OPEN_TEXT.invalid });
  const s = voiceSetup(byId('single-tone'), { sampleRate: 48000 });
  const r = playgroundVoiceDocument({ ...s.input, attackMs: 20000 }); // a 20 s attack
  assert.equal(r.ok, false);
  assert.equal(r.code, 'range');
  assert.match(r.reason, /^The voice has a value the Studio cannot hold: .*attack/i);
});

test('V605 the reasons name what the Studio cannot represent', () => {
  assert.match(VOICE_OPEN_TEXT.additive, /no field/);
  assert.match(VOICE_OPEN_TEXT.phase(90), /90° .*no field for a start phase.*offset to 0° /);
  assert.match(VOICE_OPEN_TEXT.held, /Turn continuous playback off/);
  assert.match(VOICE_OPEN_TEXT.modulation, /20 ms/);
});

test('V605 the browser check renders this list and judges it at 60 dB', () => {
  const suite = read('tests/browser/v31-studio-offline.cjs');
  const entry = read('tests/browser/fixtures/playground-voice-in-studio-entry.js');
  assert.match(suite, /playground-voice-in-studio-entry\.js/);
  assert.match(suite, /PV\.render\(/);
  assert.match(suite, /VOICE_RESIDUAL_DB = -60\b/);
  assert.match(suite, /VOICE_END_TOL_S = 0\.002\b/);
  assert.match(entry, /from the end of the Studio's 20 ms start crossfade/);
  assert.match(entry, /from '\.\.\/\.\.\/unit\/fixtures\/playground-voice-configs\.mjs'/);
  assert.match(entry, /renderStudioOffline\(doc\.model/);
  assert.match(entry, /engine\.play\(plan/);
});

test('V605 the Signal Path offers the action, the Studio workspace performs it', () => {
  const html = read('src/index.html');
  const btn = html.match(/<button[^>]*data-osc="analysis\.openInStudio"[\s\S]*?<\/button>/);
  assert.ok(btn, 'the Signal Path has an Open in Studio button');
  assert.match(btn[0], /:hidden="tabs\.analysis !== 'signalPath'"/);
  assert.match(btn[0], /@click="studioOpenVoice\(\)"/);
  assert.doesNotMatch(btn[0], /\bosc-|style=/, 'Flowbite Pro classes, no legacy token or style');
  assert.match(read('src/js/ui/studio/workspace.js'), /createWorkspaceVoice\]/);
  assert.match(read('src/js/main.js'), /playgroundVoice: playgroundVoiceInput/);
  assert.match(read('src/js/main.js'), /return voiceInputFrom\(app, labVizInputs\);/);
});

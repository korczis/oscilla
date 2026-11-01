// C010: the Phase & Stereo pan reaches a sounding dual voice. A mono dual voice started centred
// has no stereo router (main.js needsRouter: stereo, or |pan| > 0), so the first pan away from
// centre must replace it click-free with one (engine.setDualRouter -> _restart through play,
// the path main.js's wrapper re-applies its V2 options on), and once the voice has its router a
// later pan, back to centre included, only updates it in place: one restart per voice, never a
// second one. Runs on the recording mock AudioContext of the V1 freeze harness.
//   node --test tests/unit/dual-router-live.test.mjs

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { buildPlan } from '../../src/js/audio/patterns.js';
import { defaultInstrumentState } from '../../src/js/core/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FREEZE_DIR = path.resolve(
  process.env.OSCILLA_FREEZE_DIR || path.join(here, '../freeze'));
const hasMock = fs.existsSync(path.join(FREEZE_DIR, 'extract.cjs'));
const skip = hasMock ? false : `mock AudioContext not found in ${FREEZE_DIR}`;
const require = createRequire(import.meta.url);
const { makeMockAudio } = hasMock ? require(path.join(FREEZE_DIR, 'extract.cjs')) : {};

const SR = 48000;
const ENV_S = { safeMax: (SR / 2) * 0.95, continuous: true };

function plan(cfg) {
  const st = defaultInstrumentState();
  const r = buildPlan({ ...st, ...cfg, pp: { ...st.pp, ...(cfg.pp || {}) } }, ENV_S);
  if (!r.ok) throw new Error(r.error);
  return r.plan;
}

const opt = (o = {}) => ({
  mode: 'hold', continuous: true, limitS: 30, durationS: 0.5, attackS: 0.01, releaseS: 0.03, ...o,
});

/** Engine on a fresh mock whose play() calls are counted (what a restart goes through). */
function setup() {
  const audio = makeMockAudio({});
  const env = { AudioContext: audio.AudioContext, setTimeout: () => 0, clearTimeout: () => {} };
  const eng = new AudioEngine({ env });
  const plays = [];
  const basePlay = eng.play.bind(eng);
  eng.play = (p, o) => {
    plays.push(o);
    return basePlay(p, o);
  };
  return { eng, plays, advance: (t) => eng.ctx.advance(t) };
}

/** The lab's pan as main.js reads it, and a router factory like main.js dualRouterFactory. */
function lab() {
  const state = { pan: 0, built: 0, updates: [] };
  const factory = (ctx, track, p) => {
    state.built += 1;
    const inputA = track(ctx.createGain());
    const inputB = track(ctx.createGain());
    const output = track(ctx.createGain());
    inputA.connect(output);
    inputB.connect(output);
    return {
      inputA, inputB, output,
      update: (np) => state.updates.push({ stereo: !!np.stereo, pan: state.pan }),
      dispose() {},
      plan: p,
    };
  };
  // main.js: a dual voice needs the router in Stereo output or when panned off centre.
  const want = (p) => (p.stereo || Math.abs(state.pan) > 1e-3 ? factory : null);
  return { state, factory, want };
}

test('setDualRouter: a centred mono dual voice gains its router by one click-free restart',
  { skip }, () => {
    const { eng, plays, advance } = setup();
    const L = lab();
    const p = plan({ source: 'dual' });
    eng.play(p, opt());
    advance(0.2);
    const v1 = eng.voice;
    assert.ok(!v1.live.router, 'centred mono dual voice starts without the router');
    assert.equal(plays.length, 1);

    // Pan still centred: nothing to engage, nothing restarts.
    assert.equal(eng.setDualRouter(L.want(v1.plan)), 'same');
    assert.equal(plays.length, 1);
    assert.equal(eng.voice, v1);

    // Pan to hard left while it sounds: one restart, which builds the router.
    L.state.pan = -1;
    assert.equal(eng.setDualRouter(L.want(eng.voice.plan)), 'restarted');
    assert.equal(plays.length, 2, 'exactly one restart');
    const v2 = eng.voice;
    assert.notEqual(v2, v1);
    assert.equal(v1.releasing, true, 'the old voice fades out (FAST_RELEASE_S), no hard cut');
    assert.ok(v2.t0 >= v1.endTime - 0.011, 'the new voice starts after the old one has faded');
    assert.equal(v2.plan, v1.plan, 'same plan');
    assert.equal(plays[1].dualRouter, L.factory, 'the restart carries the router');
    assert.equal(L.state.built, 1);
    assert.ok(v2.live.router, 'the sounding voice now has its router');

    // Further pan moves, back to centre included, update the router in place: no restart.
    for (const pan of [0.5, 0, -0.25]) {
      L.state.pan = pan;
      assert.equal(eng.setDualRouter(L.want(eng.voice.plan)), 'live', `pan ${pan}`);
    }
    assert.equal(plays.length, 2, 'the router is kept: pan back to 0 does not restart again');
    assert.equal(eng.voice, v2);
    assert.equal(L.state.built, 1);
    assert.deepStrictEqual(L.state.updates.map((u) => u.pan), [0.5, 0, -0.25]);

    eng.stopAll();
    advance(1);
    assert.equal(eng.activeNodeCount, 0);
    assert.equal(eng.activeSourceCount, 0);
  });

test('setDualRouter: no sounding dual voice, a releasing voice or a near deadline is left alone',
  { skip }, () => {
    const { eng, plays, advance } = setup();
    const L = lab();
    L.state.pan = 1;
    assert.equal(eng.setDualRouter(L.factory), false, 'no voice');
    eng.play(plan({ pattern: 'tone' }), opt());
    assert.equal(eng.setDualRouter(L.factory), false, 'a single source has no dual router');
    eng.stopAll();
    advance(1);
    eng.play(plan({ source: 'dual' }), opt());
    advance(1.2); // the mock's advance(t) sets the audio clock to t
    eng.release();
    assert.equal(eng.setDualRouter(L.factory), false, 'a releasing voice is not revived');
    advance(3);
    // A trigger voice about to end is not restarted (it keeps its deadline).
    eng.play(plan({ source: 'dual' }), opt({ mode: 'trigger', durationS: 0.25 }));
    advance(eng.voice.deadline - 0.01);
    const n = plays.length;
    assert.equal(eng.setDualRouter(L.factory), false);
    assert.equal(plays.length, n);
    assert.equal(L.state.built, 0);
    eng.stopAll();
    advance(5);
    assert.equal(eng.activeNodeCount, 0);
  });

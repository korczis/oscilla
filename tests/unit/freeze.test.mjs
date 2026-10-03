// V1 behaviour freeze, run against the V2 modules (src/js/core, audio, data, visualization).
//
// The vectors (freeze/vectors.cjs) and golden outputs (freeze/golden-a7b7a23.json, generated
// from V1 index.html@a7b7a23; golden-36f4b47.json is the previous baseline, kept for reference)
// are the ones the V1 harness uses. vectors.cjs calls V1 names
// through `E.g.<name>`, `E.newApp()` and `loadOscilla(...)`; this file replaces extract.cjs's
// loadOscilla with an adapter over the V2 modules BEFORE vectors.cjs is loaded, so every case
// runs unchanged against the new code:
//   E.g        name map: V1 top-level name -> V2 export (plus per-load AudioEngine/engine/viz/
//              localStore/sessionStore bound to the load's environment)
//   E.newApp   createInstrument(...) (core/instrument.js), the V1 component without its DOM
//   E.ctx      the load's window-like environment (AudioContext mock, location, storage,
//              recorded timers that never fire unless a case flushes them, a recording
//              `document` stub for event listeners)
// Like the V1 vm context, each load has its own seeded Math.random and Date.now is fixed while a
// case runs.
//
// Freeze files: OSCILLA_FREEZE_DIR, default ../freeze (tests/freeze). Regenerate a golden from
// V1 with: git show v1.0.0:index.html > /tmp/v1.html; OSCILLA_HTML=/tmp/v1.html node extract.cjs --golden
//   node --test 'tests/unit/*.test.mjs'

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import * as constants from '../../src/js/core/constants.js';
import * as math from '../../src/js/core/math.js';
import * as frequency from '../../src/js/core/frequency.js';
import * as music from '../../src/js/core/music.js';
import * as config from '../../src/js/core/config.js';
import * as storage from '../../src/js/core/storage.js';
import { createInstrument } from '../../src/js/core/instrument.js';
import * as patterns from '../../src/js/audio/patterns.js';
import { AudioEngine, ceilingCurve, planKey } from '../../src/js/audio/audio-engine.js';
import { freezeParam, recordEvent } from '../../src/js/audio/voice.js';
import * as presets from '../../src/js/data/presets.js';
import * as learn from '../../src/js/data/learn.js';
import * as harmonics from '../../src/js/visualization/harmonics.js';
import { waveSample } from '../../src/js/visualization/waveform.js';
import { VisualizationBridge } from '../../src/js/visualization/visualization-bridge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FREEZE_DIR = path.resolve(
  process.env.OSCILLA_FREEZE_DIR || path.join(here, '../freeze'));
const BASELINE = 'a7b7a23';
const GOLDEN = path.join(FREEZE_DIR, `golden-${BASELINE}.json`);
const available = fs.existsSync(path.join(FREEZE_DIR, 'vectors.cjs')) && fs.existsSync(GOLDEN);

/** Group -> category, as freeze-plan.txt counts them (838 pure, 208 component, 37 engine), plus
 *  the a7b7a23 groups (15 pure, 6 component, 13 engine). */
const CATEGORY = {
  helpers: 'pure', 'frequency.parse': 'pure', 'frequency.format': 'pure',
  'frequency.wavelength': 'pure', 'frequency.period': 'pure', 'frequency.logmap': 'pure',
  music: 'pure', region: 'pure', 'plan.build': 'pure', 'plan.progression': 'pure',
  harmonics: 'pure', 'presets.data': 'pure', 'engine.stop': 'engine',
  'plan.a7b7a23': 'pure', 'engine.a7b7a23': 'engine',
};
const categoryOf = (group) => CATEGORY[group] || 'component';

// ---------------------------------------------------------------- deliberate V2 deviations
// V2 fixes over the frozen V1 behaviour. Each maps the V2 output of one case back to the V1
// shape (and throws if the V2 fix is not there), so the rest of the case is still compared with
// the golden file. Tested positively in tests/unit/core.test.mjs.
const OCTAVE_TEXT = constants.OCTAVE_STEP_FREQUENCIES.join(', ');
const DEVIATIONS = {
  // pt-octaves sets pp.octave.text (V1 leaves it out: a stale Steps field changed the preset)
  'presets.data/BUILTIN_PRESETS': (out) => out.map((p) => {
    if (p.id !== 'pt-octaves') return p;
    const q = structuredClone(p);
    assert.strictEqual(q.cfg.pp.octave.text, OCTAVE_TEXT, 'V2 fix: pt-octaves steps text');
    delete q.cfg.pp.octave.text;
    return q;
  }),
  // the 'hearing' demo sets pp.octave (V1's cfg has no pp)
  'presets.data/LEARN_TOPICS': (out) => out.map((t) => {
    if (t.id !== 'hearing') return t;
    const q = structuredClone(t);
    assert.deepStrictEqual(q.demo.cfg.pp,
      { octave: { text: OCTAVE_TEXT, toneMs: 400, gapMs: 100 } }, 'V2 fix: hearing demo steps');
    delete q.demo.cfg.pp;
    return q;
  }),
};

// ------------------------------------------------- V249: releases on the output stage
// V1 released a voice by freezing its envelope gain (v.env) and its dip gain (v.rel) at the
// release time t, fading v.rel to the floor, and cancelling the frequency schedules at the stop
// time. Chromium can render one quantum of a param at a stale value while the main thread edits
// that param's timeline, so V2 (issue V249) edits no sounding param: it fades a gain of the
// voice's output stage that nothing else automates, `fade` for the first release and `cut` for
// a shorter one overriding it (two more GainNodes per voice, between rel and the master).
// Engine schedules recorded by the cases below change accordingly. v249View maps the V2 output
// back to V1's, so the whole golden output is still compared:
//   - graph: the two gains are removed, node ids renumbered, rel feeds the master again, and
//     env, rel and the frequency params get exactly the events V1's release would have added:
//     computed during the run by V1's algorithm (freezeParam on a copy of the voice's recorded
//     schedule, the rel ramp, the cancels at the stop time; see BoundAudioEngine._releaseVoice);
//   - node counts: two fewer per voice not freed yet (activeNodeCount, so every count read by
//     a case: snapshots, maxima, the invariants).
// On the way it asserts the V2 behaviour: a release adds no event to env, rel or a frequency
// param; each release is exactly [set 1 at t, linear to the floor at t + releaseS] on `fade`,
// or on `cut` for an override, at V1's release time and length; every voice owns the two
// gains; and the case makes the declared number of releases on each.
const V249_REASON = {
  T: 'voice built: +2 gains (fade, cut) per voice in the graph and the node counts; no release',
  R: 'released (each voice once): the fade runs on `fade`; V1 froze env and rel, faded rel and '
    + 'cancelled the frequency schedules at the stop time',
  O: 'released, and a release overridden by a shorter fade (Escape / retrigger during a '
    + 'release): the override runs on `cut`; V1 froze env and rel again and re-faded rel',
};
// id -> [releases on fade, releases on cut, what the case does]; the reason is the class of
// the counts (V249_REASON) plus the note.
const V249_CASES = {
  'engine.stop/const-hold-release-running': [1, 0, 'release() of a held tone'],
  'engine.stop/const-hold-release-in-attack-no-cancelAndHold': [1, 0,
    'release() inside the attack ramp; V1 re-ended the ramp at t, V2 leaves it running under the '
      + 'fade'],
  'engine.stop/const-hold-release-in-release-ramp-no-cancelAndHold': [0, 0,
    'release() inside the programmed release ends later: declined as in V1'],
  'engine.stop/finite-tone-natural-end': [0, 0,
    'programmed end only; the late release() is a no-op as in V1'],
  'engine.stop/release-after-programmed-end-is-noop': [0, 0,
    'release() after the programmed end: declined as in V1'],
  'engine.stop/release-on-suspended-context-frees-now': [1, 0,
    'release() on a suspended context, freed at once'],
  'engine.stop/play-stop-play-x20': [20, 0,
    '20 plays, each released (fast or own release time); maxNodes without the gains'],
  'engine.stop/play-while-playing-releases-previous': [2, 0,
    'a new play fast-releases the tone (retrigger), stopAll() fades the pulse'],
  'engine.stop/hold-limited-by-safety': [0, 0,
    'hold ended by the safety limit (scheduled at play, no release call)'],
  'engine.stop/hold-limit-shorter-than-attack': [0, 0,
    'limit shorter than the attack: scheduled end only'],
  'engine.stop/hold-continuous-unlimited': [1, 0, 'stopAll() of an unlimited hold'],
  'engine.stop/trigger-open-duration': [0, 0, 'trigger with a set duration: scheduled end only'],
  'engine.stop/trigger-open-duration-capped-by-limit': [0, 0,
    'trigger capped by the limit: scheduled end only'],
  'engine.stop/topology:steps-pulse': [1, 0,
    'stopAll() of a steps plan; V1 cancelled the carrier frequency'],
  'engine.stop/topology:ramps-sweepUp-log': [1, 0,
    'stopAll() of a ramps plan; V1 cancelled the carrier frequency'],
  'engine.stop/topology:ramps-pingpong-whole': [1, 0,
    'stopAll() of a whole-envelope ramps plan; V1 cancelled the carrier frequency'],
  'engine.stop/topology:ramps-chirp-short-attack': [1, 0,
    'stopAll() of a chirp; V1 cancelled the carrier frequency'],
  'engine.stop/topology:ramps-sweep-mode-n2': [1, 0,
    'stopAll() of a repeated sweep; V1 cancelled the carrier frequency'],
  'engine.stop/topology:lfo-siren': [1, 0,
    'stopAll() of an LFO plan (no frequency schedules to cancel)'],
  'engine.stop/topology:lfo-wobble': [1, 0,
    'stopAll() of an LFO plan (no frequency schedules to cancel)'],
  'engine.stop/topology:am': [1, 0, 'stopAll() of an AM plan (no frequency schedules to cancel)'],
  'engine.stop/topology:fm': [1, 0, 'stopAll() of an FM plan (no frequency schedules to cancel)'],
  'engine.stop/topology:dual-mono': [1, 0,
    'stopAll() of a dual plan; V1 cancelled both oscillator frequencies'],
  'engine.stop/topology:dual-mono:no-StereoPanner': [1, 0,
    'stopAll() of a dual plan without StereoPanner; V1 cancelled both frequencies'],
  'engine.stop/topology:dual-stereo': [1, 0,
    'stopAll() of a stereo dual plan; V1 cancelled both frequencies'],
  'engine.stop/topology:dual-stereo:no-StereoPanner': [1, 0,
    'stopAll() of a stereo dual plan (merger); V1 cancelled both frequencies'],
  'engine.stop/updateLive:const': [1, 0, 'live glide, then stopAll()'],
  'engine.stop/updateLive:lfo': [1, 0, 'live glide, then stopAll()'],
  'engine.stop/updateLive:am': [1, 0, 'live glide, then stopAll()'],
  'engine.stop/updateLive:fm': [1, 0, 'live glide, then stopAll()'],
  'engine.stop/updateLive:dual': [1, 0, 'live glide, then stopAll()'],
  'engine.stop/updateLive:type-mismatch': [2, 1,
    'restart (old voice fast-released), then stopAll() fades the new voice and overrides the old '
      + 'fade'],
  'engine.stop/updateLive:finite-not-live': [1, 0,
    'restart of a finite tone: the old voice is fast-released'],
  'engine.stop/instantaneous-frequency': [0, 0, 'trigger sweep to its scheduled end'],
  'app.transport/trigger-open-tone-500ms': [0, 0,
    'trigger to the scheduled end; snapshot node counts'],
  'app.transport/trigger-programmed-pattern': [0, 0,
    'programmed pattern to its end; snapshot node counts'],
  'app.transport/latch-requires-permission': [1, 0,
    'latch, then the permission withdrawn (revokeContinuous)'],
  'app.transport/key-hold-release': [1, 0, 'key hold, then key up (release())'],
  'app.transport/escape-stops-now': [1, 0, 'Escape (stopAll()) of a key hold'],
  'app.transport/resetDefaults-while-playing': [1, 0, 'reset while holding releases the voice'],
  'engine.a7b7a23/finite-tone-limited-by-safety': [0, 0,
    'finite tone capped by the limit: scheduled end only'],
  'engine.a7b7a23/finite-tone-extended-with-permission': [1, 0,
    'revokeContinuous() fades the extended tone'],
  'engine.a7b7a23/revokeContinuous-only-extended-voices': [2, 0,
    'revokeContinuous() fades the extended voice only, then stopAll()'],
  'engine.a7b7a23/replace-during-long-release': [1, 1,
    'a new play during a long release overrides it with the fast fade'],
  'engine.a7b7a23/escape-during-long-release': [1, 1,
    'Escape during a long release cuts it (the guarantee kept: on `cut`)'],
  'engine.a7b7a23/continuous-sweep-schedule-and-top-up': [1, 0,
    'stopAll() of a continuous sweep; V1 cancelled the scheduled-ahead frequency ramps'],
  'engine.a7b7a23/updateLive:same': [1, 0, 'unchanged plan, then stopAll()'],
  'engine.a7b7a23/updateLive:waveform-dip': [1, 0,
    'waveform dip on rel, then stopAll(); V1 froze rel again'],
  'engine.a7b7a23/updateLive:restart-keeps-deadline': [2, 0,
    'restart with the old deadline (fast release), then stopAll()'],
  'engine.a7b7a23/updateLive:dual-stereo-change-without-panner': [2, 1,
    'restart, then stopAll() fades the new voice and overrides the old fade'],
  'engine.a7b7a23/closed-context-rebuilt': [1, 0,
    'context closed from outside (freed, no release), new voice stopped; oldNodes without the '
      + 'gains'],
  'engine.a7b7a23/suspended-play-not-running': [1, 0,
    'replacement on a suspended context: the old voice is freed at once'],
  'app.a7b7a23/finite-tone-limited-play': [0, 0,
    'finite tone to its capped end; snapshot node counts'],
  'app.a7b7a23/suspended-status': [0, 0, 'play on a suspended context; snapshot node counts'],
  'app.a7b7a23/revoke-stops-hold-and-sweep': [2, 0,
    'permission withdrawn: the hold and the sweep fade'],
  'app.a7b7a23/closed-context-rebuilt-on-play': [1, 0, 'play rebuilds a closed context, then stop'],
};
let v249Scope = null; // { engines: [] } while a V249 case runs

const r9 = (v) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v);

/** The tracked param V1's release would have frozen: a copy whose calls go to the ledger. */
function v249Shadow(pt, ledger, ctx) {
  const p = pt.param;
  const rec = (kind) => (value, time) => {
    ledger.push({ ctx, owner: p.owner, name: p.name, e: [kind, value, time] });
  };
  return {
    param: {
      setValueAtTime: rec('set'),
      linearRampToValueAtTime: rec('linear'),
      exponentialRampToValueAtTime: rec('exp'),
      cancelScheduledValues: (time) => rec('cancel')(null, time),
    },
    ev: pt.ev.map((e) => ({ ...e })),
    initial: pt.initial,
  };
}

// ------------------------------------------------- V253: a continuous repeat plays cycle 0
// V1 aligned _soon to the render quantum and then skipped every cycle starting before it, so at
// play (t0 = currentTime + START_OFFSET_S, off the quantum grid) cycle 0 too: a continuous
// repeat began with one period of silence (a segment sweep) or of a held tone (ping-pong). V2
// (issue V253) schedules cycle 0 at t0. v253View asserts its events (one step envelope on the
// envelope gain, one sweep on the carrier) and removes them, so the rest of the case is still
// compared with the golden file.
const V253_CASES = new Set(['engine.a7b7a23/continuous-sweep-schedule-and-top-up']);

function v253View(out) {
  const q = structuredClone(out);
  const t0 = q.info.start;
  const env = q.graph.find((n) => n.kind === 'gain' && n.params
    && n.params.gain.events.some((e) => e[0] === 'exp'));
  const osc = q.graph.find((n) => n.kind === 'oscillator');
  const starts = env.params.gain.events.filter((e) => e[0] === 'set' && e[1] < 1e-3
    && e[2] >= t0 - 1e-9).map((e) => e[2]);
  assert.ok(Math.abs(starts[0] - t0) < 1e-9, 'V253: the first step envelope starts at t0');
  const end = starts[1];
  const inCycle0 = (e) => e[2] >= t0 - 1e-9 && e[2] < end - 1e-9;
  assert.deepStrictEqual(env.params.gain.events.filter(inCycle0).map((e) => e[0]),
    ['set', 'linear', 'set', 'exp'], 'V253: cycle 0 carries one step envelope');
  assert.deepStrictEqual(osc.params.frequency.events.filter(inCycle0).map((e) => e[0]),
    ['set', 'exp'], 'V253: cycle 0 carries one sweep');
  env.params.gain.events = env.params.gain.events.filter((e) => !inCycle0(e));
  osc.params.frequency.events = osc.params.frequency.events.filter((e) => !inCycle0(e));
  return q;
}

/** Map the V2 output of a V249 case to V1's (see above). */
function v249View(out, id) {
  const [fades, cuts, note] = V249_CASES[id];
  const scope = v249Scope;
  const releases = scope.engines.flatMap((e) => e._v249.releases);
  const count = (x) => releases.filter((y) => y === x).length;
  const reason = `${V249_REASON[!fades ? 'T' : !cuts ? 'R' : 'O']}; ${note}`;
  assert.deepStrictEqual({ fade: count('fade'), cut: count('cut') }, { fade: fades, cut: cuts },
    `V249 ${id}: ${reason}`);
  if (!out || !out.graph) return out;
  const withCtx = scope.engines.filter((e) => e.ctx);
  assert.strictEqual(withCtx.length, 1, 'V249: one engine with a context per engine case');
  const eng = withCtx[0];
  const q = structuredClone(out);
  const byId = new Map(q.graph.map((n) => [n.id, n]));
  const masterId = eng.master.id;
  const toMaster = `node:${masterId}`;
  const cutIds = q.graph.filter((n) => n.kind === 'gain' && n.out.length === 1
    && n.out[0] === toMaster).map((n) => n.id);
  const fadeIds = cutIds.map((c) => {
    const f = q.graph.filter((n) => n.out.length === 1 && n.out[0] === `node:${c}`);
    assert.strictEqual(f.length, 1, `V249: one fade gain feeds cut ${c}`);
    return f[0].id;
  });
  // fade and cut: never automated before a release; a release is [set 1 t, linear floor t + r]
  for (const [fid, cid] of fadeIds.map((f, i) => [f, cutIds[i]])) {
    assert.strictEqual(cid, fid + 1, 'V249: cut is created right after fade');
    for (const n of [byId.get(fid), byId.get(cid)]) {
      const ev = n.params.gain.events;
      assert.ok(ev.length === 0 || (ev.length === 2 && ev[0][0] === 'set' && ev[0][1] === 1
        && ev[1][0] === 'linear' && ev[1][1] === constants.GAIN_FLOOR && ev[1][2] > ev[0][2]),
      `V249: gain ${n.id} carries one release only: ${JSON.stringify(ev)}`);
    }
    assert.ok(byId.get(cid).params.gain.events.length === 0
      || byId.get(fid).params.gain.events.length === 2, 'V249: cut only after fade');
  }
  // V1's release events, appended where V1 scheduled them
  for (const x of eng._v249.ledger) {
    if (x.ctx !== eng.ctx) continue; // a context discarded earlier in the case
    byId.get(x.owner).params[x.name].events.push(x.e.map(r9));
  }
  const removed = new Set([...fadeIds, ...cutIds]);
  const fadeSet = new Set(fadeIds);
  const ids = [...byId.keys()].sort((a, b) => a - b);
  const remap = new Map();
  let k = 0;
  for (const i of ids) if (!removed.has(i)) remap.set(i, k++);
  const ref = (s) => s.replace(/^(node|param):(\d+)/, (m, kind, n) => {
    const i = Number(n);
    if (kind === 'node' && fadeSet.has(i)) return `node:${remap.get(masterId)}`;
    assert.ok(remap.has(i), `V249: reference to a removed node ${s}`);
    return `${kind}:${remap.get(i)}`;
  });
  q.graph = q.graph.filter((n) => !removed.has(n.id)).map((n) => ({
    ...n, id: remap.get(n.id), out: n.out.map(ref),
  }));
  // closed-context-rebuilt reads the discarded context's node total: two gains per voice built
  // there
  for (const sn of q.snaps || []) {
    if (typeof sn.oldNodes === 'number') {
      sn.oldNodes -= 2 * eng._v249.voiceCtx.filter((c) => c !== eng.ctx).length;
    }
  }
  const inv = q.invariants;
  if (inv && Array.isArray(inv.undisconnectedVoiceNodes)) {
    inv.undisconnectedVoiceNodes = inv.undisconnectedVoiceNodes.filter((i) => !removed.has(i))
      .map((i) => remap.get(i));
  }
  return q;
}

// ---------------------------------------------------------------- per-load randomness and clock

/** The V1 harness's seeded Math.random (same constants as extract.cjs). */
function seededRandom() {
  let a = 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let currentRandom = seededRandom();

/** Recorded timers that never fire on their own (the V1 harness's makeTimers). */
function makeTimers() {
  let seq = 0;
  const pending = new Map();
  const add = (fn, ms, repeat) => {
    const id = ++seq;
    pending.set(id, { fn, ms, repeat });
    return id;
  };
  return {
    setTimeout: (fn, ms) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: (id) => { pending.delete(id); },
    clearInterval: (id) => { pending.delete(id); },
    requestAnimationFrame: (fn) => add(fn, 16, false),
    pendingCount: () => pending.size,
    /** Run every pending one-shot timer once (intervals stay pending). Returns how many ran. */
    flushOnce() {
      let ran = 0;
      for (const [id, t] of [...pending]) {
        if (t.repeat) continue;
        pending.delete(id);
        t.fn();
        ran++;
      }
      return ran;
    },
  };
}

// ---------------------------------------------------------------- the adapter

/** V1 top-level names -> V2 exports (pure, shared by every load). */
const NAMES = {
  ...constants, ...math, ...frequency, ...music, ...patterns, ...presets, ...learn, ...harmonics,
  defaultInstrumentState: config.defaultInstrumentState,
  coerceLike: config.coerceLike,
  paramDescriptor: config.paramDescriptor,
  presetRecord: storage.presetRecord,
  newPresetId: storage.newPresetId,
  readJSON: storage.readJSON,
  safeStorage: storage.safeStorage,
  ceilingCurve,
  planKey,
  waveSample,
};

let loads = 0;

/** Drop-in for extract.cjs loadOscilla({ audio, local, session, hash, search }). */
function loadV2(opts = {}, MemoryStorage, makeDocument) {
  loads++;
  const local = opts.local || new MemoryStorage();
  const session = opts.session || new MemoryStorage();
  const timers = makeTimers();
  const search = opts.search || '';
  const hash = opts.hash || '';
  const env = {
    ...timers,
    location: { hash, search, href: `file:///oscilla/index.html${search}${hash}` },
    navigator: { userAgent: 'oscilla-freeze/1.0', platform: 'node' },
    localStorage: local,
    sessionStorage: session,
    document: opts.document || makeDocument(),
  };
  if (opts.audio) env.AudioContext = opts.audio.AudioContext;
  const random = seededRandom();
  currentRandom = random; // a fresh load is used on its own by the case that created it
  class BoundAudioEngine extends AudioEngine {
    constructor() {
      super({ env });
      this._v249 = { releases: [], ledger: [], shadows: new WeakMap(), voiceCtx: [] };
      if (v249Scope) v249Scope.engines.push(this);
    }
    static isSupported() { return AudioEngine.isSupported(env); }

    play(plan, o) {
      const info = super.play(plan, o);
      if (v249Scope && info) this._v249.voiceCtx.push(this.ctx);
      return info;
    }

    /** V249 view: V1 counted no fade / cut gains (two per voice not freed yet). */
    get activeNodeCount() {
      const n = super.activeNodeCount;
      if (!v249Scope) return n;
      for (const v of this.voices) {
        assert.ok(v.nodes[2].gain === v.fade.param && v.nodes[3].gain === v.cut.param,
          'V249: every voice owns its fade and cut gains');
      }
      return n - 2 * this.voices.size;
    }

    /**
     * V249 view: run V2's release, check it edits no sounding param, and record the events
     * V1's release (index.html@a7b7a23 _releaseVoice) would have added at the same time:
     *   _freeze(v.env, t); _freeze(v.rel, t); _ev(v.rel, linear, GAIN_FLOOR, t + rel);
     *   for (p of v.freqParams) p.cancelScheduledValues(stopAt)
     * on copies of the voice's recorded schedules that follow V1's state across releases.
     */
    _releaseVoice(v, releaseS, silent) {
      if (!v249Scope || !v || v.ended || !v.fade) return super._releaseVoice(v, releaseS, silent);
      const { ledger, shadows } = this._v249;
      const ctx = v.ctx;
      if (!shadows.has(v)) {
        shadows.set(v, {
          env: v249Shadow(v.env, ledger, ctx), rel: v249Shadow(v.rel, ledger, ctx),
          freq: v.freqParams.slice(),
        });
      }
      const sh = shadows.get(v);
      const sounding = [v.env.param, v.rel.param, ...v.freqParams];
      const before = sounding.map((p) => p.events.length);
      const stages = [v.fade, v.cut];
      const n0 = stages.map((st) => st.ev.length);
      const result = super._releaseVoice(v, releaseS, silent);
      assert.deepStrictEqual(sounding.map((p) => p.events.length), before,
        'V249: a release adds no event to env, rel or a frequency param');
      const k = stages.findIndex((st, i) => st.ev.length !== n0[i]);
      if (k < 0) return result; // not applied: ends sooner on its own, or declined
      const added = stages[k].ev.slice(n0[k]);
      assert.strictEqual(added.length, 2, 'V249: a release is two events');
      const [set, lin] = added;
      const t = set.time;
      freezeParam(sh.env, t);
      freezeParam(sh.rel, t);
      recordEvent(sh.rel, 'linearRampToValueAtTime', constants.GAIN_FLOOR, lin.time);
      for (const p of sh.freq) {
        ledger.push({ ctx, owner: p.owner, name: p.name, e: ['cancel', null, v.endTime] });
      }
      this._v249.releases.push(k ? 'cut' : 'fade');
      return result;
    }
  }
  const engine = new BoundAudioEngine();
  const viz = new VisualizationBridge({ engine, env });
  const localStore = storage.safeStorage('localStorage', () => env.localStorage);
  const sessionStore = storage.safeStorage('sessionStorage', () => env.sessionStorage);
  const g = { ...NAMES, AudioEngine: BoundAudioEngine, engine, viz, localStore, sessionStore };
  const newApp = (patch = {}) => {
    const app = createInstrument({
      engine, bridge: viz, localStore, sessionStore, location: env.location, timers: env, env,
    });
    app.$watch = () => {};
    app.$nextTick = (fn) => fn && fn();
    app.$refs = {};
    Object.assign(app, patch);
    return app;
  };
  return {
    g, ctx: env, timers, newApp, local, session, random, document: env.document,
    htmlPath: '(V2 modules)',
  };
}

// ---------------------------------------------------------------- comparison (freeze.test.cjs)

function diff(a, b, at = '$') {
  if (typeof a === 'number' && typeof b === 'number') {
    const tol = Math.max(1e-12, 1e-9 * Math.max(Math.abs(a), Math.abs(b)));
    return Math.abs(a - b) <= tol ? null : `${at}: ${a} !== ${b}`;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return a === b ? null : `${at}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array/object mismatch`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${at}: length ${a.length} !== ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.join('\u0000') !== kb.join('\u0000')) return `${at}: keys [${ka}] !== [${kb}]`;
  for (const k of ka) {
    const d = diff(a[k], b[k], `${at}.${k}`);
    if (d) return d;
  }
  return null;
}

// ---------------------------------------------------------------- run

if (!available) {
  test('V1 freeze vectors', { skip: `freeze files not found in ${FREEZE_DIR}` }, () => {});
} else {
  const require = createRequire(import.meta.url);
  const extract = require(path.join(FREEZE_DIR, 'extract.cjs'));
  const { MemoryStorage, FIXED_NOW, makeDocument } = extract;
  // before vectors.cjs destructures it
  extract.loadOscilla = (opts) => loadV2(opts, MemoryStorage, makeDocument);
  const { defineCases, enc } = require(path.join(FREEZE_DIR, 'vectors.cjs'));
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const byId = new Map(golden.cases.map((c) => [c.id, c]));
  const cases = defineCases();
  const E = loadV2({}, MemoryStorage, makeDocument);
  const sharedRandom = E.random;
  const realRandom = Math.random;
  const realNow = Date.now;
  const tally = {};

  /** Run one case like the V1 harness: shared load's PRNG current, fixed clock. */
  const runCase = (c) => {
    currentRandom = sharedRandom;
    Math.random = () => currentRandom();
    Date.now = () => FIXED_NOW;
    v249Scope = V249_CASES[c.id] ? { engines: [] } : null;
    try {
      const out = c.run(E);
      const v2 = V253_CASES.has(c.id) ? v253View(out) : out;
      if (V249_CASES[c.id]) return enc(v249View(v2, c.id));
      return enc(DEVIATIONS[c.id] ? DEVIATIONS[c.id](v2) : v2);
    } finally {
      v249Scope = null;
      Math.random = realRandom;
      Date.now = realNow;
    }
  };

  test(`golden-${BASELINE}.json and vectors.cjs define the same case set`, () => {
    const ids = cases.map((c) => c.id);
    const missing = golden.cases.filter((c) => !ids.includes(c.id)).map((c) => c.id);
    const extra = ids.filter((id) => !byId.has(id));
    assert.deepStrictEqual({ missing, extra }, { missing: [], extra: [] });
    assert.strictEqual(golden.meta.baseline, BASELINE);
  });

  // Cases run in definition order (the order the golden file was generated in), grouped.
  const groups = [...new Set(cases.map((c) => c.group))];
  for (const group of groups) {
    test(`freeze [${categoryOf(group)}] ${group}`, async (t) => {
      for (const c of cases.filter((x) => x.group === group)) {
        await t.test(c.id, () => {
          const cat = categoryOf(group);
          tally[cat] = tally[cat] || { pass: 0, fail: 0 };
          const g = byId.get(c.id);
          let d;
          try {
            assert.ok(g, `case present in golden-${BASELINE}.json`);
            const inDiff = diff(enc(c.input), g.input);
            assert.strictEqual(inDiff, null, `input drifted: ${inDiff}`);
            d = diff(runCase(c), g.output);
          } catch (err) {
            tally[cat].fail++;
            throw err;
          }
          if (d) tally[cat].fail++; else tally[cat].pass++;
          assert.strictEqual(d, null, d || '');
        });
      }
    });
  }

  test('freeze summary', (t) => {
    for (const [cat, n] of Object.entries(tally)) {
      t.diagnostic(`${cat}: ${n.pass} pass, ${n.fail} fail`);
    }
    assert.ok(loads > 1);
  });
}

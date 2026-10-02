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
import * as presets from '../../src/js/data/presets.js';
import * as learn from '../../src/js/data/learn.js';
import * as harmonics from '../../src/js/visualization/harmonics.js';
import { waveSample } from '../../src/js/visualization/waveform.js';
import { pathNodesFor } from '../../src/js/visualization/signal-path.js';
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
  pathNodesFor,
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
    constructor() { super({ env }); }
    static isSupported() { return AudioEngine.isSupported(env); }
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
    try {
      const out = c.run(E);
      return enc(DEVIATIONS[c.id] ? DEVIATIONS[c.id](out) : out);
    } finally {
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

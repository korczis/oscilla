// Core modules: template helpers, pure applyConfig / URL restore, storage migration hook, safety
// rules, platform names and composing the instrument into another component.
//   node --test 'tests/unit/*.test.mjs'

import test from 'node:test';
import assert from 'node:assert';

import { TEMPLATE_HELPERS, V1_TEMPLATE_GLOBALS } from '../../src/js/core/template-helpers.js';
import {
  applyConfig, defaultEditorFields, defaultInstrumentState, gainLevelDb, gainLevelForPct,
  gainPctFor, pickInstrumentState,
} from '../../src/js/core/config.js';
import { limitsFor, rangeBounds, fitRangeMode } from '../../src/js/core/frequency.js';
import {
  decodeHash, restoreFromHash, serializeConfig, serializeHash,
} from '../../src/js/core/url-state.js';
import {
  migratePreset, loadCustomPresets, persistPresets, safeStorage, PRESET_MIGRATIONS,
  registerPresetMigration,
} from '../../src/js/core/storage.js';
import {
  binauralNeedsDefaultPair, canLatch, openDurationText, presetDisabled, sweepRepeatChoice,
  triggerMs,
} from '../../src/js/core/safety.js';
import { browserName, platformName } from '../../src/js/core/platform.js';
import { createInstrument } from '../../src/js/core/instrument.js';
import { BUILTIN_PRESETS } from '../../src/js/data/presets.js';
import { LEARN_TOPICS, LEARN_VIZ_TARGETS } from '../../src/js/data/learn.js';

const fresh = () => ({ ...defaultInstrumentState(), ...defaultEditorFields() });

test('TEMPLATE_HELPERS exposes every helper V1 templates called as a global', () => {
  for (const name of V1_TEMPLATE_GLOBALS) {
    assert.strictEqual(typeof TEMPLATE_HELPERS[name], 'function', name);
  }
  assert.ok(Object.isFrozen(TEMPLATE_HELPERS));
  assert.strictEqual(TEMPLATE_HELPERS.formatFrequency(15500), '15.50 kHz');
  assert.strictEqual(TEMPLATE_HELPERS.sig(2.2727, 3), '2.27');
});

test('applyConfig is pure and depends on the sample rate (provisional vs 48 kHz)', () => {
  const state = fresh();
  const before = JSON.stringify(state);
  const cfg = { source: 'single', pattern: 'tone', frequency: 23000, range: { mode: 'advanced' } };
  const prov = applyConfig(state, cfg, { sampleRate: null, origin: 'hash' });
  const real = applyConfig(state, cfg, { sampleRate: 48000, origin: 'hash' });
  assert.strictEqual(JSON.stringify(state), before, 'input untouched');
  assert.strictEqual(prov.state.frequency, limitsFor(null).safeMax);
  assert.strictEqual(real.state.frequency, 22800);
  assert.strictEqual(prov.issues, 0);
});

test('applyConfig: continuous repeat needs the permission; binaural never restored', () => {
  const cfg = { source: 'sweep', sweep: { repeat: 'continuous' } };
  assert.strictEqual(applyConfig(null, cfg).state.sweep.repeat, 'once');
  const allowed = applyConfig(null, cfg, { continuousAllowed: true });
  assert.strictEqual(allowed.state.sweep.repeat, 'continuous');
  const r = applyConfig(null, { dual: { binaural: true, stereo: true } }, { origin: 'hash' });
  assert.strictEqual(r.state.dual.binaural, false);
  assert.deepStrictEqual(r.notices.map((n) => n.title), ['Binaural mode not restored']);
});

test('URL state: serialize -> decode -> restore round trip; gain capped; mode returned', () => {
  const s = fresh();
  s.pattern = 'fm';
  s.pp.fm.modFreq = 7;
  s.gainLevel = 0.2;
  const hash = serializeHash(s, 'playground');
  const decoded = decodeHash(`#${hash}`);
  assert.strictEqual(decoded.gainCapped, true);
  assert.strictEqual(decoded.mode, 'playground');
  const r = restoreFromHash(null, hash, { sampleRate: 48000 });
  assert.strictEqual(r.handled, true);
  assert.strictEqual(r.state.pp.fm.modFreq, 7);
  assert.strictEqual(r.state.gainLevel, 0.08);
  assert.strictEqual(r.mode, 'playground');
  assert.deepStrictEqual(serializeConfig(r.state).pp, { fm: { modFreq: 7, depthHz: 60 } });
  assert.strictEqual(restoreFromHash(null, '#m=dual').handled, false);
  const bad = restoreFromHash(null, '#v=1&x=%%%');
  assert.strictEqual(bad.notices[0].title, 'Link could not be read');
});

test('pickInstrumentState copies only instrument + editor fields', () => {
  const app = createInstrument({ engine: null });
  const s = pickInstrumentState(app);
  assert.deepStrictEqual(Object.keys(s).sort(), Object.keys(fresh()).sort());
  s.pp.fm.modFreq = 99;
  assert.notStrictEqual(app.pp.fm.modFreq, 99);
});

test('storage: v1 kept, newer rejected, v2 migration hook upgrades step by step', () => {
  const cfg = { source: 'single', frequency: 880 };
  const v1 = { version: 1, id: 'k', name: 'Kept', created: 1, cfg };
  assert.strictEqual(migratePreset(v1).version, 1);
  assert.strictEqual(migratePreset({ ...v1, version: 2 }), null);
  const migrations = { 1: (cfg) => ({ ...cfg, version: 2, envelope: { a: 0.01 } }) };
  const up = migratePreset(v1, { targetVersion: 2, migrations });
  assert.strictEqual(up.version, 2);
  assert.deepStrictEqual(up.cfg.envelope, { a: 0.01 });
  assert.strictEqual(migratePreset(v1, { targetVersion: 2, migrations: {} }), null, 'missing step');
  assert.throws(() => registerPresetMigration(0, () => ({})), TypeError);
  assert.deepStrictEqual(Object.keys(PRESET_MIGRATIONS), [], 'defaults register nothing');
});

test('storage: blocked storage never throws; load/persist report notices', () => {
  const blocked = safeStorage('localStorage', () => { throw new Error('SecurityError'); });
  assert.strictEqual(blocked.available(), false);
  assert.strictEqual(blocked.get('x'), null);
  assert.strictEqual(blocked.set('x', '1'), false);
  assert.deepStrictEqual(loadCustomPresets(blocked), { presets: [], notices: [] });
  const r = persistPresets(blocked, []);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.notices[0].level, 'error');
  const map = new Map([['oscilla.presets', '42']]); // valid JSON, not a preset list
  const mem = safeStorage('localStorage', () => ({ getItem: (k) => map.get(k) ?? null }));
  assert.strictEqual(loadCustomPresets(mem).notices[0].title, 'Saved presets unreadable');
});

test('safety rules', () => {
  assert.deepStrictEqual(sweepRepeatChoice('continuous', false, 'n'),
    { repeat: 'n', locked: true });
  assert.deepStrictEqual(sweepRepeatChoice('continuous', true, 'n'),
    { repeat: 'continuous', locked: false });
  assert.deepStrictEqual(sweepRepeatChoice('bogus', false, 'n'), { repeat: 'once', locked: false });
  assert.strictEqual(canLatch(false), false);
  assert.strictEqual(triggerMs(5000, 2, false), 2000);
  assert.strictEqual(triggerMs(5000, 2, true), 5000);
  assert.strictEqual(openDurationText(500, 2, false), 'trigger 500 ms · hold ≤ 2 s');
  assert.strictEqual(binauralNeedsDefaultPair(0.4), true);
  assert.strictEqual(binauralNeedsDefaultPair(6), false);
  const hf24 = BUILTIN_PRESETS.find((p) => p.id === 'hf-24000');
  assert.strictEqual(presetDisabled(hf24, limitsFor(null).safeMax), true);
  assert.strictEqual(presetDisabled(hf24, limitsFor(96000).safeMax), false);
});

test('frequency limits and range bounds', () => {
  assert.deepStrictEqual(limitsFor(48000), {
    provisional: false, effectiveSampleRate: 48000, nyquist: 24000, safeMax: 22800,
  });
  assert.deepStrictEqual(rangeBounds({ rangeMode: 'high' }, 22800), { min: 8000, max: 22800 });
  const custom = { rangeMode: 'custom', customMin: 200, customMax: 300 };
  assert.deepStrictEqual(rangeBounds(custom, 22800), { min: 200, max: 400 });
  assert.strictEqual(fitRangeMode(440, 440, { min: 20, max: 20000 }, 22800), null);
  assert.strictEqual(fitRangeMode(10, 10, { min: 20, max: 20000 }, 22800), 'advanced');
});

test('gain mapping: sqrt curve, dB readout', () => {
  assert.strictEqual(gainLevelForPct(100), 0.25);
  assert.strictEqual(gainPctFor(0.08), 57);
  assert.ok(Math.abs(gainLevelDb(0.08) - -21.938) < 1e-3);
  assert.strictEqual(gainLevelDb(0), -Infinity);
});

test('platform names never invent a device', () => {
  assert.strictEqual(browserName({ userAgent: 'Mozilla/5.0 Firefox/131.0' }), 'Firefox 131');
  assert.strictEqual(browserName({ userAgent: '' }), 'Not identified');
  assert.strictEqual(platformName({}), 'Not reported');
  assert.strictEqual(platformName({ userAgentData: { platform: 'macOS' } }), 'macOS');
});

test('the instrument composes into another component without losing its getters', () => {
  const inst = createInstrument({ engine: null });
  const target = { uiOnly: true };
  Object.defineProperties(target, Object.getOwnPropertyDescriptors(inst));
  target.sampleRate = 96000;
  assert.strictEqual(target.nyquist, 48000);
  target.setFrequency(30000);
  assert.strictEqual(target.frequency, 20000, 'human range caps at 20 kHz');
  target.setRangeMode('advanced');
  target.setFrequency(30000);
  assert.strictEqual(target.frequency, 30000);
  assert.strictEqual(target.uiOnly, true);
});

test('instrument keyGuard and dialog hooks are injectable', () => {
  const opened = [];
  const inst = createInstrument({
    engine: null, keyGuard: () => true, openModal: (id) => opened.push(id),
  });
  inst.onKeyDown({ key: ' ', code: 'Space', preventDefault() { throw new Error('not guarded'); } });
  inst.requestBinaural(true);
  assert.deepStrictEqual(opened, ['headphonesModal']);
});

test('learn data keeps V1 viz ids; every id has a V2 target', () => {
  for (const t of LEARN_TOPICS) assert.ok(LEARN_VIZ_TARGETS[t.demo.viz], t.id);
});

test('instrument at a7b7a23: SUSPENDED status, resume retry, revoke, mic events, latch key', () => {
  const listeners = [];
  const document = {
    addEventListener: (type) => listeners.push(type),
    removeEventListener: (type) => listeners.splice(listeners.indexOf(type), 1),
  };
  let revoked = 0;
  let stoppedMic = null;
  const handlers = new Set();
  const engine = {
    ctx: null, state: 'not started', sampleRate: null, running: false, mic: null, voice: null,
    isSupported: () => true,
    init() { this.ctx = {}; this.state = 'suspended'; this.sampleRate = 44100; return true; },
    resume: () => Promise.resolve(false),
    setMasterGain(g) { this.gain = g; },
    play: () => ({ id: 1 }), release: () => true, stopAll() {}, updateLive: () => 'same',
    instantaneousFrequency: () => null, revokeContinuous: () => { revoked++; return 1; },
    stopMic(reason) { stoppedMic = reason; },
    on: (fn) => { handlers.add(fn); return () => handlers.delete(fn); },
  };
  const timers = {
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  };
  const app = createInstrument({ engine, env: { document }, timers });
  engine.on((t, d) => app.onEngine(t, d));
  assert.strictEqual(app.play('trigger'), true);
  assert.strictEqual(engine.gain, app.gainLevel, 'gain set before the context is built');
  assert.deepStrictEqual(listeners, ['pointerup', 'touchend', 'click', 'keyup']);
  app.onEngine('play', { id: 1 });
  assert.strictEqual(app.status, 'SUSPENDED');
  assert.strictEqual(app.statusIcon, '‖');
  engine.running = true;
  app.onEngine('context', 'running');
  assert.strictEqual(app.status, 'PLAYING');
  app.setContinuous(true);
  app.latched = true;
  app.sweep.repeat = 'continuous';
  app.setContinuous(false);
  assert.deepStrictEqual([revoked, app.latched, app.sweep.repeat], [1, false, 'once']);
  let prevented = 0;
  app.latchKey({ repeat: true, preventDefault: () => prevented++ });
  app.latchKey({ repeat: false, preventDefault: () => prevented++ });
  assert.strictEqual(prevented, 1);
  app.micActive = true;
  app.onEngine('mic', { active: false, reason: 'ended' });
  assert.strictEqual(app.micActive, false);
  assert.strictEqual(app.alerts.at(-1).title, 'Microphone stopped');
  engine.mic = {};
  app.toggleMic();
  assert.strictEqual(stoppedMic, 'user', 'an engine mic is stopped even if the flag is off');
  assert.strictEqual(app.vizInputs().paused, false);
});

test('V2 fix: the octave preset and the hearing demo play their labelled steps', () => {
  const steps = (app) => app.currentPlan().plan.freqs;
  const want = [125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const preset = BUILTIN_PRESETS.find((p) => p.id === 'pt-octaves');
  const app = createInstrument({ engine: null });
  app.sampleRate = 48000;
  app.pp.octave.text = '440, 880';   // a stale user edit of the Steps (Hz) field
  app.pp.octave.toneMs = 50;
  app.applyPreset(preset);
  assert.deepStrictEqual(steps(app), want);
  assert.strictEqual(app.pp.octave.toneMs, 400);
  const demo = createInstrument({ engine: null });
  demo.sampleRate = 48000;
  demo.pp.octave.text = '440, 880';
  demo.pp.octave.gapMs = 900;
  demo.runDemo(LEARN_TOPICS.find((t) => t.id === 'hearing'));
  assert.deepStrictEqual(steps(demo), want);
  assert.strictEqual(demo.pp.octave.gapMs, 100);
});

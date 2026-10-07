// The V3 MEASURE gaps the evidence audit recorded (plan V315, V322, V353, V355, V356), each
// against its pure layer: calibration profile export (CSV / JSON round trip through the
// existing parser), the input device choice and its hashed provenance, the recipe in the URL
// hash, the IR overlay of the compare view, and the experiment store's independence from the
// rest of the application.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { parseCalibrationText } from '../../src/js/calibration/parse.js';
import { createFrequencyProfile } from '../../src/js/calibration/profile.js';
import {
  profileCsvText, profileJsonText, profileFileName, exportProfileFile, PROFILE_CSV_HEADERS,
} from '../../src/js/calibration/export.js';
import { hashDeviceId, isHashedDeviceId } from '../../src/js/calibration/device-id.js';
import {
  inputDeviceList, inputDeviceView, DEFAULT_INPUT_LABEL,
} from '../../src/js/measurement/views/input-devices.js';
import {
  inputOpenError, INPUT_DEVICE_UNAVAILABLE_TEXT,
} from '../../src/js/measurement/capture.js';
import { MeasurementError } from '../../src/js/measurement/engine.js';
import {
  normalizeInput, sanitizeForExport, experimentToJson, hashedDeviceConstraint, formatErrors,
} from '../../src/js/experiments/schema.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import { KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';
import {
  encodeRecipeLink, decodeRecipeLink, recipeParamOf, withRecipeParam, RECIPE_HASH_KEY,
  RECIPE_LINK_MAX_CHARS, RECIPE_WIRE_KEYS,
} from '../../src/js/core/url-state-measure.js';
import { decodeHash, restoreFromHash, serializeHash } from '../../src/js/core/url-state.js';
import { base64UrlEncode } from '../../src/js/core/math.js';
import { defaultInstrumentState, defaultEditorFields } from '../../src/js/core/config.js';
import { CHARACTERIZE_PLAYBACK_CHAIN } from '../../src/js/measurement/views/measure-flow.js';
import { buildCompareView } from '../../src/js/measurement/views/compare-view.js';
import { buildIrOverlayView } from '../../src/js/measurement/views/ir-chart.js';
import { pageIndexedDb, exportableExperiment } from '../../src/js/ui/experiments.js';
import { resultHash, withResultHash } from '../../src/js/experiments/hash.js';
import { buildFixtures } from '../browser/fixtures/v3-experiments.mjs';

const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
const ROOT = new URL('../../', import.meta.url).pathname;

// ---------------------------------------------------------------------------- V315 export

const DEV = createFrequencyProfile({ name: 'UMIK-1 (serial 700-1234)', source: 'maker sheet',
  notes: 'axis 0°', importedAt: '2026-10-01T08:00:00.000Z',
  points: [[20, -1.25], [1000, 0], [10000, 2.1], [20000, -3.5e-7]] });
const COR = createFrequencyProfile({ name: 'EQ curve', convention: 'correction',
  importedAt: '2026-10-01T08:00:00.000Z', points: [[31.5, 4], [1000, 0], [16000, -2.5]] });

test('V315: the CSV and JSON exports are deterministic in content and file name', () => {
  for (const p of [DEV, COR]) {
    assert.equal(profileCsvText(p), profileCsvText({ ...p }));
    assert.equal(profileJsonText(p), profileJsonText(JSON.parse(JSON.stringify(p))));
    assert.equal(profileFileName(p, 'csv'), profileFileName({ ...p }, 'csv'));
  }
  assert.equal(profileFileName(DEV, 'csv'), `umik-1-serial-700-1234-${DEV.id.slice(0, 8)}`
    + '.calibration.csv');
  assert.equal(profileFileName(COR, 'json'), `eq-curve-${COR.id.slice(0, 8)}.calibration.json`);
  assert.throws(() => profileFileName(DEV, 'xml'), /csv or json/);
  const csv = profileCsvText(DEV).split('\n');
  assert.deepEqual(csv.slice(0, 6), [
    '# OSCILLA frequency calibration profile (oscilla.calibration, schema 2)',
    '# name: UMIK-1 (serial 700-1234)', `# id: ${DEV.id}`, '# convention: deviation',
    "# the file states the microphone's deviation (corrected = observed − value)",
    PROFILE_CSV_HEADERS.deviation]);
  assert.deepEqual(csv.slice(6), ['20,-1.25', '1000,0', '10000,2.1', '20000,-3.5e-7', '']);
  const f = exportProfileFile(COR, 'csv');
  assert.equal(f.type, 'text/csv');
  assert.match(f.text, /^frequency_hz,correction_db$/m);
  assert.equal(exportProfileFile(COR, 'json').type, 'application/json');
});

test('V315: both exports round-trip through parseCalibrationText (id, convention, points)', () => {
  for (const p of [DEV, COR]) {
    // The file name the UI would pass never replaces the name stated in the file.
    const opts = { name: 'downloaded-file', importedAt: '2026-10-03T00:00:00.000Z' };
    const fromCsv = parseCalibrationText(profileCsvText(p), opts);
    assert.ok(fromCsv.ok && fromCsv.profile, JSON.stringify(fromCsv.errors));
    assert.equal(fromCsv.needsConvention, undefined, 'no sign-convention question on re-import');
    assert.equal(fromCsv.profile.id, p.id);
    assert.equal(fromCsv.profile.convention, p.convention);
    assert.equal(fromCsv.profile.name, p.name);
    assert.deepEqual(fromCsv.profile.points, p.points);
    assert.deepEqual(fromCsv.warnings, []);
    assert.equal(fromCsv.convention.source, 'file');
    const fromJson = parseCalibrationText(profileJsonText(p), opts);
    assert.ok(fromJson.ok && fromJson.profile);
    for (const k of ['id', 'convention', 'name', 'source', 'notes']) {
      assert.deepEqual(fromJson.profile[k], p[k], k);
    }
    assert.deepEqual(fromJson.profile.points, p.points);
    assert.deepEqual(fromJson.warnings, []);
    // A second export of the re-imported profile is the same CSV (importedAt is not in it).
    assert.equal(profileCsvText(fromCsv.profile), profileCsvText(p));
  }
});

test('V315: the CSV directives are checked, never guessed', () => {
  const body = '20,1\n1000,0\n';
  const conflict = parseCalibrationText(`# convention: correction\nHz,SPL\n${body}`);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.errors[0].line, 1);
  assert.match(conflict.errors[0].text, /says "correction" but the header "SPL"/);
  const twice = parseCalibrationText(`# convention: deviation\n# convention: correction\n${body}`);
  assert.equal(twice.ok, false);
  assert.equal(twice.errors[0].line, 2);
  assert.match(twice.errors[0].text, /stated twice/);
  const unknown = parseCalibrationText(`# convention: inverse\n${body}`);
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors[0].text, /deviation" or "correction/);
  // An ambiguous header with a stated convention needs no choice; without one it still does.
  const stated = parseCalibrationText(`# convention: correction\nHz,Gain\n${body}`);
  assert.equal(stated.profile.convention, 'correction');
  assert.equal(parseCalibrationText(`Hz,Gain\n${body}`).needsConvention, true);
  // A stated id that does not match the points is a warning; the id is recomputed.
  const wrongId = parseCalibrationText(`# id: ${'0'.repeat(64)}\n${body}`);
  assert.ok(wrongId.ok);
  assert.deepEqual(wrongId.warnings.map((w) => w.line), [1]);
  assert.match(wrongId.warnings[0].text, /does not match its points/);
  // A hand-edited point changes the id, and the stale id line says so.
  const edited = profileCsvText(DEV).replace('1000,0', '1000,0.5');
  const r = parseCalibrationText(edited);
  assert.notEqual(r.profile.id, DEV.id);
  assert.equal(r.warnings.length, 1);
});

// ---------------------------------------------------------------------------- V322 device

test('V322: the input list holds real inputs with the browser labels, nothing invented', () => {
  const list = inputDeviceList([
    { kind: 'audioinput', deviceId: 'default', label: 'Default - USB mic' },
    { kind: 'audioinput', deviceId: 'communications', label: 'Communications - USB mic' },
    { kind: 'audioinput', deviceId: 'a1', label: 'USB mic\n(2-channel)' },
    { kind: 'audioinput', deviceId: '', label: '' },
    { kind: 'videoinput', deviceId: 'cam', label: 'Camera' },
    { kind: 'audiooutput', deviceId: 'spk', label: 'Speakers' },
    { kind: 'audioinput', deviceId: 'b2', label: '' },
    { kind: 'audioinput', deviceId: 'a1', label: 'USB mic again' },
  ]);
  assert.deepEqual(list, [
    { id: 'a1', label: 'USB mic (2-channel)', labelExposed: true },
    { id: 'b2', label: 'Input 2 (label not exposed by the browser)', labelExposed: false },
  ]);
  assert.deepEqual(inputDeviceList(null), []);
});

test('V322: the default stays the default; a vanished choice stays selected and says so', () => {
  const devices = [{ kind: 'audioinput', deviceId: 'a1', label: 'USB mic' }];
  const before = inputDeviceView({ devices: [], enumerated: false });
  // The list ends with the TEST CONTEXT choice (ledger W7b, v4-test-context-choice.test.mjs).
  assert.deepEqual(before.options.filter((o) => !o.testContext),
    [{ value: '', label: DEFAULT_INPUT_LABEL, missing: false }]);
  assert.equal(before.selected, '');
  assert.match(before.status, /Run the setup check to list the inputs/);
  const listed = inputDeviceView({ devices, enumerated: true });
  assert.deepEqual(listed.options.filter((o) => !o.testContext).map((o) => o.value), ['', 'a1']);
  assert.equal(listed.missing, false);
  assert.equal(listed.message, null);
  const chosen = inputDeviceView({ devices, selectedId: 'a1', selectedLabel: 'USB mic',
    enumerated: true });
  assert.equal(chosen.selected, 'a1');
  const gone = inputDeviceView({ devices: [], selectedId: 'a1', selectedLabel: 'USB mic',
    enumerated: true });
  assert.equal(gone.missing, true);
  assert.equal(gone.selected, 'a1', 'nothing switches to another input silently');
  assert.deepEqual(gone.options.at(-2), { value: 'a1', label: 'USB mic — not available',
    missing: true });
  assert.match(gone.message, /^"USB mic" is no longer available .*nothing is switched for you/);
  const unnamed = inputDeviceView({ devices: [], selectedId: 'zz', enumerated: true });
  assert.match(unnamed.message, /^The selected input is no longer available/);
});

test('V322: a chosen input that cannot be opened is a readable NO_INPUT', () => {
  for (const name of ['OverconstrainedError', 'NotFoundError']) {
    const e = inputOpenError(Object.assign(new Error(''), { name }), 'raw-id');
    assert.ok(e instanceof MeasurementError);
    assert.equal(e.code, 'NO_INPUT');
    assert.equal(e.message, INPUT_DEVICE_UNAVAILABLE_TEXT);
    assert.equal(e.detail.reason, 'device-unavailable');
  }
  // The default input keeps the browser's own error (mapped as before).
  const plain = Object.assign(new Error('x'), { name: 'NotFoundError' });
  assert.equal(inputOpenError(plain, null), plain);
  const denied = Object.assign(new Error('x'), { name: 'NotAllowedError' });
  assert.equal(inputOpenError(denied, 'raw-id'), denied);
});

test('V322: the chosen input is provenance, hashed; the default input records none', () => {
  const raw = 'f3a0c0ffee-raw-device-id';
  const chosen = normalizeInput({ device: { label: 'USB mic', id: raw },
    constraints: { requested: { echoCancellation: false, deviceId: { exact: raw } },
      applied: { echoCancellation: false, deviceId: raw } } });
  assert.deepEqual(chosen.constraints.requested, { echoCancellation: false,
    deviceId: { exact: hashDeviceId(raw) } });
  assert.equal(chosen.device.id, hashDeviceId(raw));
  assert.equal('deviceId' in chosen.constraints.applied, false);
  assert.doesNotMatch(JSON.stringify(chosen), /raw-device-id/);
  assert.equal(normalizeInput(chosen).constraints.requested.deviceId.exact, hashDeviceId(raw),
    'idempotent');
  // The default input: requested deviceId null, so nothing is recorded (unchanged form).
  const def = normalizeInput({ constraints: { requested: { echoCancellation: false,
    deviceId: null }, applied: null } });
  assert.deepEqual(def.constraints.requested, { echoCancellation: false });
  assert.deepEqual(hashedDeviceConstraint(raw), hashDeviceId(raw));
  assert.deepEqual(hashedDeviceConstraint({ ideal: raw, max: 3 }), { ideal: hashDeviceId(raw) });
  assert.equal(hashedDeviceConstraint({ exact: '' }), undefined);
  assert.equal(hashedDeviceConstraint(42), undefined);
});

test('V322: an experiment with a chosen input validates and exports no raw id', async () => {
  const { a } = await buildFixtures();
  const raw = 'chosen-raw-device-id-0042';
  const stamp = (x) => withResultHash(x, resultHash(x, { version: 2 }), 2);
  const e = stamp({ ...a.experiment, input: normalizeInput({ device: { label: null, id: raw },
    constraints: { requested: { deviceId: { exact: raw } }, applied: { deviceId: raw } } }) });
  assert.ok(isHashedDeviceId(e.input.constraints.requested.deviceId.exact));
  assert.equal(sanitizeForExport(e).changed, false, 'already clean');
  const v = validateExperiment(experimentToJson(e), OPTS);
  assert.ok(v.ok, v.ok ? '' : formatErrors(v.errors));
  assert.deepEqual(v.experiment.input.constraints.requested.deviceId,
    { exact: hashDeviceId(raw) });
  // A record with a raw requested id (written by hand or by an older build) is sanitized on
  // export and its version-2 result hash, which covers the input, re-stamped.
  const dirty = stamp({ ...e, input: { ...e.input, constraints: { requested: { deviceId:
    { exact: raw } }, applied: null } } });
  assert.equal(sanitizeForExport(dirty).changed, true);
  const out = exportableExperiment(dirty);
  assert.deepEqual(out.input.constraints.requested.deviceId, { exact: hashDeviceId(raw) });
  const json = experimentToJson(out);
  assert.doesNotMatch(json, /chosen-raw-device-id/);
  const w = validateExperiment(json, OPTS);
  assert.ok(w.ok, w.ok ? '' : formatErrors(w.errors));
});

// ---------------------------------------------------------------------------- V355 URL recipe

const PRESET = (() => {
  const r = CHARACTERIZE_PLAYBACK_CHAIN.recipe;
  return { f1: r.stimulus.f1, f2: r.stimulus.f2, duration: r.stimulus.duration,
    level: r.stimulus.level, repeats: r.repeats, aggregation: r.analysis.aggregation,
    noiseCheckS: r.analysis.noiseCheckS, preRollS: r.analysis.preRollS,
    postRollS: r.analysis.postRollS, gapS: r.analysis.gapS, phase: r.analysis.phase };
})();
const link = (doc) => base64UrlEncode(JSON.stringify(doc));

test('V355: a recipe round-trips through the hash and carries nothing else', () => {
  const values = { ...PRESET, f1: 50, f2: 16000, duration: 4, level: 'medium', repeats: 5,
    aggregation: 'median', noiseCheckS: 1, phase: true,
    // Not recipe fields: never written into a link.
    name: 'Kitchen', notes: 'secret', rtaMode: 'fft', result: { magnitudeDb: [1, 2] } };
  const param = encodeRecipeLink(values);
  assert.ok(param.length < 300, `${param.length} characters`);
  assert.match(param, /^[A-Za-z0-9_-]+$/);
  const r = decodeRecipeLink(param, { defaults: PRESET });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepEqual(Object.keys(r.values).sort(), Object.values(RECIPE_WIRE_KEYS).sort());
  for (const k of Object.values(RECIPE_WIRE_KEYS)) assert.deepEqual(r.values[k], values[k], k);
  assert.equal(encodeRecipeLink(values), param, 'deterministic');
  // A partial link takes the preset for what it does not say.
  const partial = decodeRecipeLink(link({ v: 1, d: 3 }), { defaults: PRESET });
  assert.deepEqual(partial.values, { ...PRESET, duration: 3 });
});

test('V355: a link is validated like every import and refused whole', () => {
  const refuse = (param, re) => {
    const r = decodeRecipeLink(param, { defaults: PRESET });
    assert.equal(r.ok, false, String(param).slice(0, 60));
    assert.ok(r.errors.some((t) => re.test(t)), `${r.errors.join(' | ')} !~ ${re}`);
    assert.equal(r.values, undefined, 'nothing partly applied');
  };
  refuse('', /no recipe/);
  refuse('A'.repeat(RECIPE_LINK_MAX_CHARS + 1), /longer than/);
  refuse('not base64!', /base64url/);
  refuse(base64UrlEncode('{"v":1,'), /not valid JSON/);
  refuse(link([1, 2]), /must be an object/);
  refuse(link({ f1: 20 }), /unsupported recipe version none/);
  refuse(link({ v: 2 }), /unsupported recipe version 2/);
  refuse(link({ v: 1, results: { transfer: [] } }), /unknown key "results".*never results/);
  refuse(link({ v: 1, f1: -5 }), /Start frequency: must be/);
  refuse(link({ v: 1, f1: '20' }), /must be a number/);
  refuse(link({ v: 1, d: 9999 }), /Sweep duration: must be/);
  refuse(link({ v: 1, n: 2.5 }), /whole number/);
  refuse(link({ v: 1, l: 'loud' }), /Output level: must be one of low, medium, high/);
  refuse(link({ v: 1, ph: 'yes' }), /true or false/);
  refuse(link({ v: 1, f1: 5000, f2: 1000 }), /below the end frequency/);
  refuse(link({ v: 1, ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`,
    i])) }), /too many keys/);
});

test('V355: the recipe coexists with the instrument state in one hash', () => {
  const state = { ...defaultInstrumentState(), ...defaultEditorFields(), frequency: 523.25 };
  const instrument = serializeHash(state, 'playground');
  const param = encodeRecipeLink(PRESET);
  const both = withRecipeParam(`#${instrument}`, param);
  assert.equal(recipeParamOf(both), param);
  assert.equal(recipeParamOf(`#${both}`), param);
  // The instrument codec reads the same hash as before; the recipe codec reads only `mr`.
  assert.deepEqual(decodeHash(both), decodeHash(instrument));
  assert.equal(restoreFromHash(null, both).state.frequency, 523.25);
  // A hash with only a recipe is no instrument link (nothing restored, no notice).
  const only = withRecipeParam('', param);
  assert.equal(only, `${RECIPE_HASH_KEY}=${param}`);
  const r = restoreFromHash(null, only);
  assert.equal(r.handled, false);
  assert.deepEqual(r.notices, []);
  // Removing the recipe keeps the instrument keys.
  assert.equal(withRecipeParam(both, null), new URLSearchParams(instrument).toString());
  assert.equal(recipeParamOf('#v=1&f=440'), null);
  assert.equal(recipeParamOf(''), null);
});

// ---------------------------------------------------------------------------- V356 IR overlay

test('V356: equivalent experiments get an IR overlay on their original scale', async () => {
  const { a, b, c } = await buildFixtures();
  const v = buildCompareView([a.experiment, b.experiment]);
  assert.equal(v.compatible, true);
  assert.equal(v.irOverlay.ok, true);
  const view = v.irOverlay.view;
  assert.deepEqual(view.series.map((s) => s.role), ['observed', 'requested']);
  assert.deepEqual(v.irOverlay.labels, ['A', 'B']);
  assert.equal(view.axes.x.unit, 'ms');
  assert.deepEqual(view.axes.x.range, [-5, 200]);
  assert.match(view.axes.y.label, /original scale/);
  assert.ok(view.series.every((s) => s.values.length === view.x.length));
  // Original scale: the drawn maximum is each IR's own peak sample (no normalization).
  for (const [s, e] of [[view.series[0], a.experiment], [view.series[1], b.experiment]]) {
    const ir = e.results.ir;
    const peak = Math.max(...s.values.filter((x) => x !== null));
    assert.equal(peak, ir.samples[ir.peakIndex]);
  }
  assert.ok(v.irOverlay.notes.some((n) => /nothing is normalized/.test(n)));
  assert.equal(v.irDelta.ok, false);
  assert.match(v.irDelta.reason, /not defined for impulse responses/);
  // Not equivalent: refused with the reason (same rule as A − B).
  const vc = buildCompareView([a.experiment, c.experiment]);
  assert.equal(vc.irOverlay.ok, false);
  assert.match(vc.irOverlay.reason, /not shown for non-equivalent experiments: .*different stim/);
  // An experiment without an IR is named.
  const noIr = { ...b.experiment, results: { ...b.experiment.results, ir: null } };
  const vn = buildCompareView([a.experiment, noIr]);
  assert.equal(vn.irOverlay.ok, false);
  assert.match(vn.irOverlay.reason, /needs two or more impulse responses \(B has none\)/);
});

test('V356: the IR overlay keeps time re each peak and decimates by min/max only', () => {
  const ir = (peakIndex, peak, sampleRate = 1000) => {
    const samples = new Float32Array(400);
    samples[peakIndex] = peak;
    samples[peakIndex + 50] = -0.25; // a reflection 50 ms after the peak
    return { samples, sampleRate, peakIndex, peakTimeS: peakIndex / sampleRate,
      captureOffsetS: 0.1, algorithm: 'oscilla.ir.log-sweep.v2' };
  };
  const entries = [{ ir: ir(20, 0.5), label: 'A', name: 'a', role: 'observed' },
    { ir: ir(70, -0.75), label: 'B', name: 'b', role: 'requested' }];
  const v = buildIrOverlayView(entries, { range: [-5, 100] });
  assert.equal(v.decimation.factor, 1);
  assert.equal(v.x.length, 106);
  const at0 = Array.from(v.x).indexOf(0);
  assert.equal(v.series[0].values[at0], 0.5);
  assert.equal(v.series[1].values[at0], -0.75, 'sign kept: B is inverted');
  const at50 = Array.from(v.x).indexOf(50);
  assert.equal(v.series[0].values[at50], -0.25);
  assert.equal(v.series[1].values[at50], -0.25);
  // Outside an IR's samples: no value (A starts 20 samples before its peak).
  const d = buildIrOverlayView(entries, { range: [-60, 100], maxColumns: 8 });
  assert.ok(d.decimation.factor > 1);
  assert.equal(d.x.length, 2 * d.decimation.columns);
  assert.equal(Math.max(...d.series[0].values.filter((x) => x !== null)), 0.5);
  assert.equal(Math.min(...d.series[1].values.filter((x) => x !== null)), -0.75);
  assert.equal(d.series[0].values[0], null, 'before the first sample of A');
  assert.throws(() => buildIrOverlayView([entries[0]]), /two or more/);
  assert.throws(() => buildIrOverlayView([entries[0], { ...entries[1], ir: ir(70, 1, 2000) }]),
    /one sample rate/);
});

// ---------------------------------------------------------------------------- V353 independence

test('V353: reading the IndexedDB factory never throws into the app', () => {
  const factory = { open() {} };
  assert.equal(pageIndexedDb({ indexedDB: factory }), factory);
  assert.equal(pageIndexedDb({}), null);
  assert.equal(pageIndexedDb({ indexedDB: {} }), null);
  const hostile = {};
  Object.defineProperty(hostile, 'indexedDB', { get() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  } });
  assert.equal(pageIndexedDb(hostile), null);
});

test('V353: only the experiment and Studio adapters import the experiment store', () => {
  const files = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(p);
    }
  };
  walk(join(ROOT, 'src/js'));
  const importers = files.filter((f) => /from\s+'[^']*experiments\/store\.js'/
    .test(readFileSync(f, 'utf8'))).map((f) => f.slice(ROOT.length)).sort();
  // The Playground (core, audio, instrument, labs, visualization, app shell, main) never does:
  // a store that fails leaves it untouched (spec §227).
  assert.deepEqual(importers, ['src/js/studio/library.js', 'src/js/ui/experiments.js',
    'src/js/ui/studio/workspace.js']);
  const main = readFileSync(join(ROOT, 'src/js/main.js'), 'utf8');
  assert.doesNotMatch(main, /indexedDB/);
  // The Experiments store opens lazily: only on its workspace or a save, never at start-up.
  assert.match(main, /ws === 'experiments' && !cmp\.exps\.loaded/);
});

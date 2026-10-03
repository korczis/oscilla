// OSCILLA V3 calibration layer: profile normalization and identity, import parsing,
// log-frequency interpolation with coverage, and absolute level calibration
// (spec §17-§25, §142, §158, §200, §222).
//
// Tolerances: interpolation results are compared with 1e-9 dB. The inputs are O(1) dB values
// combined through log10 differences of O(1); IEEE-754 double rounding contributes ~1e-15, so
// 1e-9 can only fail on a wrong formula, never on floating-point noise. Exact profile points and
// level offsets built from exactly representable decimals are compared with strict equality.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex, utf8Bytes } from '../../src/js/calibration/sha256.js';
import {
  createFrequencyProfile,
  profileId,
  exportProfile,
  normalizePoints,
  CalibrationError,
  PROFILE_FORMAT,
  UNNAMED_PROFILE,
} from '../../src/js/calibration/profile.js';
import { parseCalibrationText, MAX_IMPORT_BYTES } from '../../src/js/calibration/parse.js';
import {
  correctionAt,
  correctionCurve,
  coverage,
  applyFrequencyCorrection,
  CORRECTION_SIGN,
  CALIBRATION_ALGORITHM,
} from '../../src/js/calibration/interpolate.js';
import {
  createLevelCalibration,
  isValidLevelCalibration,
  levelLabel,
  toDisplayLevel,
  SPL_UNIT,
  RELATIVE_UNIT,
} from '../../src/js/calibration/level.js';

const EPS = 1e-9;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < EPS, `${msg ?? ''} got ${a}, want ${b}`);

// The example profile of spec §18.
const SPEC_POINTS = [[20, 4.2], [50, 1.7], [100, 0.5], [1000, 0], [10000, 2.1], [20000, 6.8]];
const specProfile = () => createFrequencyProfile({ name: 'Spec §18 example', points: SPEC_POINTS });

const deepFreeze = (o) => {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

// --- SHA-256 -----------------------------------------------------------------------------------

test('sha256: NIST FIPS 180-4 vectors ("", "abc", 448-bit message)', () => {
  assert.equal(sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('sha256: block-boundary lengths, UTF-8 and byte input agree with node:crypto', () => {
  const inputs = ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000),
    'Hz ±60 dB §200 \u{1F3B5}'];
  for (const s of inputs) {
    const want = createHash('sha256').update(s, 'utf8').digest('hex');
    assert.equal(sha256Hex(s), want, `length ${s.length}`);
    assert.equal(sha256Hex(utf8Bytes(s)), want);
  }
  assert.deepEqual([...utf8Bytes('\uD800')], [0xef, 0xbf, 0xbd]); // lone surrogate -> U+FFFD
  assert.throws(() => sha256Hex(42), TypeError);
});

// --- profile normalization and identity ----------------------------------------------------------

test('profile: normalized shape with units, schema, sorted points and null provenance', () => {
  const p = createFrequencyProfile({ name: '  My mic  ', points: [[1000, 0], [20, 4.2]] });
  assert.equal(p.schemaVersion, 2);
  assert.equal(p.convention, 'deviation');
  assert.equal(p.kind, 'frequency');
  assert.deepEqual(p.units, { frequency: 'Hz', correction: 'dB' });
  assert.deepEqual(p.points, [[20, 4.2], [1000, 0]]);
  assert.equal(p.name, 'My mic');
  assert.equal(p.source, null);
  assert.equal(p.notes, null);
  assert.equal(p.importedAt, null);
  assert.match(p.id, /^[0-9a-f]{64}$/);
  assert.equal(p.id, profileId(p));
  assert.equal(createFrequencyProfile({ points: [[20, 1]] }).name, UNNAMED_PROFILE);
});

test('profile: object points accepted; inputs never mutated', () => {
  const input = deepFreeze({ name: 'x', points: [{ hz: 50, db: 1 }, { hz: 20, db: 2 }] });
  const p = createFrequencyProfile(input);
  assert.deepEqual(p.points, [[20, 2], [50, 1]]);
});

test('profileId: independent of name, source, notes, importedAt and input order', () => {
  const a = createFrequencyProfile({ name: 'A', points: SPEC_POINTS });
  const b = createFrequencyProfile({
    name: 'renamed.csv', source: 'user lab', notes: 'n', importedAt: '2026-10-02T10:00:00Z',
    points: SPEC_POINTS.slice().reverse(),
  });
  assert.equal(a.id, b.id);
  assert.equal(profileId({ points: SPEC_POINTS.slice().reverse() }), a.id);
  const changed = SPEC_POINTS.map(([f, d]) => [f, f === 1000 ? 0.01 : d]);
  assert.notEqual(profileId({ points: changed }), a.id);
  assert.equal(profileId({ points: [[20, -0]] }), profileId({ points: [[20, 0]] }));
});

test('profile: exact duplicates merged, conflicting duplicates rejected', () => {
  const n = normalizePoints([[20, 1], [40, 2], [20, 1]]);
  assert.deepEqual(n.errors, []);
  assert.deepEqual(n.points, [[20, 1], [40, 2]]);
  assert.ok(n.warnings.some((w) => /duplicate/.test(w.text)));
  assert.throws(() => createFrequencyProfile({ points: [[20, 1], [20, 1.5]] }),
    (e) => e instanceof CalibrationError && /conflicting/.test(e.message));
});

test('profile: range, finiteness and size limits', () => {
  const bad = [
    [[0.5, 0]], [[200001, 0]], [[20, 60.5]], [[20, -61]], [[NaN, 0]], [[20, Infinity]],
    [['20', 1]], [], 'nope',
  ];
  for (const points of bad) {
    assert.throws(() => createFrequencyProfile({ points }), CalibrationError,
      JSON.stringify(points));
  }
  assert.doesNotThrow(() => createFrequencyProfile({ points: [[1, 60], [200000, -60]] }));
  const many = (n) => Array.from({ length: n }, (_, i) => [10 + i, 0]);
  assert.equal(createFrequencyProfile({ points: many(2000) }).points.length, 2000);
  assert.throws(() => createFrequencyProfile({ points: many(2001) }), /2001 points exceed/);
});

test('exportProfile: normalized OSCILLA object; source only when given; no invented fields', () => {
  const plain = exportProfile(specProfile());
  assert.equal(plain.format, PROFILE_FORMAT);
  assert.equal(plain.schemaVersion, 2);
  assert.equal(plain.convention, 'deviation');
  assert.equal('source' in plain, false);
  assert.equal(plain.notes, null);
  assert.equal(plain.importedAt, null);
  assert.deepEqual(plain.units, { frequency: 'Hz', correction: 'dB' });
  assert.deepEqual(plain.points, SPEC_POINTS);
  const withSource = exportProfile(createFrequencyProfile({
    name: 'n', source: 'Calibrated by me', points: SPEC_POINTS, importedAt: '2026-10-02',
  }));
  assert.equal(withSource.source, 'Calibrated by me');
  assert.equal(withSource.importedAt, '2026-10-02');
  assert.throws(() => exportProfile({ kind: 'level', points: SPEC_POINTS }), CalibrationError);
});

// --- parsing -----------------------------------------------------------------------------------

test('parse: CSV with frequency_hz, correction_db header', () => {
  const r = parseCalibrationText('frequency_hz, correction_db\n20, 4.2\n50, 1.7\n1000, 0\n',
    { name: 'mic.csv', convention: 'deviation' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.profile.points, [[20, 4.2], [50, 1.7], [1000, 0]]);
  assert.equal(r.profile.name, 'mic.csv');
  assert.deepEqual(r.warnings, []);
});

test('parse: tab-separated, header variants, semicolons, comments and blank lines', () => {
  const variants = [
    'Freq(Hz)\tSPL(dB)\n20\t1\n40\t2\n',
    'Frequency (Hz)  Magnitude (dB)\n20  1\n40  2\n',
    'frequency;correction;\n20;1;\n40;2;\n',
    'hz,db\r\n20,1\r\n40,2\r\n',
    '"Freq","dB"\n"20","1"\n"40","2"\n',
    '# comment\n; another\n* third\n\n20\t1\n\n40\t2\n',
    '﻿20 1\n40 2',
  ];
  for (const text of variants) {
    // "correction" headers state no sign: those variants need the explicit choice (M4).
    const r = parseCalibrationText(text, { convention: 'deviation' });
    assert.equal(r.ok, true, `${JSON.stringify(text)}: ${JSON.stringify(r.errors)}`);
    assert.deepEqual(r.profile.points, [[20, 1], [40, 2]], JSON.stringify(text));
  }
});

test('parse: extra columns selected by header names; commented header used with a warning', () => {
  const r = parseCalibrationText('Freq(Hz)\tSPL(dB)\tPhase(degrees)\n20\t1\t-3\n40\t2\t-5\n');
  assert.equal(r.ok, true);
  assert.deepEqual(r.profile.points, [[20, 1], [40, 2]]);
  assert.ok(r.warnings.some((w) => /ignored column/.test(w.text)));
  const c = parseCalibrationText('* Freq dB Phase\n20 1 0\n40 2 5\n');
  assert.equal(c.ok, true);
  assert.deepEqual(c.profile.points, [[20, 1], [40, 2]]);
  assert.ok(c.warnings.some((w) => /comment line/.test(w.text)));
});

test('parse: sensitivity line recorded in notes and warnings, never applied', () => {
  const r = parseCalibrationText('"Sens Factor =-1.23dB, SERNO: 7000001"\n20\t0.5\n1000\t0\n');
  assert.equal(r.ok, true);
  assert.deepEqual(r.profile.points, [[20, 0.5], [1000, 0]]);
  assert.match(r.profile.notes, /Sens Factor =-1\.23dB/);
  assert.match(r.profile.notes, /not applied/);
  assert.ok(r.warnings.some((w) => w.line === 1 && /never applied as SPL/.test(w.text)));
  assert.equal(r.profile.source, null, 'a serial number in the file is not user-given provenance');
});

test('parse: malformed text rows are rejected with their line numbers', () => {
  const r = parseCalibrationText('20 1\nhello there\n40 2\n');
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.line), [2]);
  const pre = parseCalibrationText('My calibration file\nfrequency,db\n20,1\n');
  assert.equal(pre.ok, false);
  assert.equal(pre.errors[0].line, 1);
  assert.equal(parseCalibrationText('').ok, false);
  assert.equal(parseCalibrationText('just words\n').ok, false);
  assert.equal(parseCalibrationText(null).ok, false);
});

test('parse: three unlabeled numeric columns rejected', () => {
  const r = parseCalibrationText('20\t1\t0\n40\t2\t0\n');
  assert.equal(r.ok, false);
  assert.match(r.errors[0].text, /no header naming/);
});

test('parse: decimal-comma ambiguity rejected; unambiguous decimal commas accepted', () => {
  const mixedSep = parseCalibrationText('20,4.2\n50,1,7\n');
  assert.equal(mixedSep.ok, false);
  assert.equal(mixedSep.errors[0].line, 2);
  assert.match(mixedSep.errors[0].text, /decimal commas cannot be told apart/);
  const mixedStyle = parseCalibrationText('20\t4,2\n50\t1.7\n');
  assert.equal(mixedStyle.ok, false);
  assert.match(mixedStyle.errors[0].text, /mixed/);
  const grouping = parseCalibrationText('1,000\t0,5\n');
  assert.equal(grouping.ok, false);
  assert.match(grouping.errors[0].text, /thousands grouping/);
  const semi = parseCalibrationText('20;4,2\n50;1,7\n');
  assert.equal(semi.ok, true);
  assert.deepEqual(semi.profile.points, [[20, 4.2], [50, 1.7]]);
  assert.ok(semi.warnings.some((w) => /decimal commas/.test(w.text)));
});

test('parse: NaN, Infinity and overflowing numbers rejected', () => {
  for (const text of ['20 NaN\n', '20 nan\n', '20 Infinity\n', '20 -inf\n', '1e999 1\n']) {
    const r = parseCalibrationText(text);
    assert.equal(r.ok, false, text);
    assert.equal(r.errors[0].line, 1);
  }
  const json = parseCalibrationText('[[20, 1e999]]');
  assert.equal(json.ok, false);
  assert.match(json.errors[0].text, /non-finite/);
});

test('parse: duplicates — identical merged with warning, conflicting rejected on its line', () => {
  const ok = parseCalibrationText('20 1\n20 1\n40 2\n');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.profile.points, [[20, 1], [40, 2]]);
  assert.ok(ok.warnings.some((w) => w.line === 2 && /duplicate of line 1/.test(w.text)));
  const bad = parseCalibrationText('20 1\n40 2\n20 1.5\n');
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].line, 3);
  assert.match(bad.errors[0].text, /conflicting/);
});

test('parse: unsorted input accepted, sorted, with a warning; same id as sorted', () => {
  const r = parseCalibrationText('1000 0\n20 4.2\n100 0.5\n');
  assert.equal(r.ok, true);
  assert.deepEqual(r.profile.points, [[20, 4.2], [100, 0.5], [1000, 0]]);
  assert.ok(r.warnings.some((w) => /sorted/.test(w.text)));
  assert.equal(r.profile.id, parseCalibrationText('20 4.2\n100 0.5\n1000 0\n').profile.id);
});

test('parse: out-of-range values rejected with line numbers', () => {
  const r = parseCalibrationText('20 1\n0.5 1\n40 61\n');
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.line), [2, 3]);
});

test('parse: huge profiles rejected (2001 points, more than 1 MiB)', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => `${20 + i}\t0`).join('\n');
  assert.equal(parseCalibrationText(rows(2000)).ok, true);
  const r = parseCalibrationText(rows(2001));
  assert.equal(r.ok, false);
  assert.match(r.errors[0].text, /2001 points exceed the limit of 2000/);
  const big = `# ${'x'.repeat(MAX_IMPORT_BYTES)}\n20 1\n`;
  const b = parseCalibrationText(big);
  assert.equal(b.ok, false);
  assert.match(b.errors[0].text, /1 MiB/);
  // Multi-byte characters count as bytes, not UTF-16 units.
  const wide = `# ${'é'.repeat(MAX_IMPORT_BYTES / 2)}\n20 1\n`;
  assert.ok(wide.length < MAX_IMPORT_BYTES);
  assert.equal(parseCalibrationText(wide).ok, false);
});

test('parse: JSON arrays of pairs and of { hz, db } objects', () => {
  const pairs = parseCalibrationText('[[40, 2], [20, 1]]', { name: 'p' });
  assert.equal(pairs.ok, true);
  assert.deepEqual(pairs.profile.points, [[20, 1], [40, 2]]);
  const objs = parseCalibrationText('[{"hz": 20, "db": 1}, {"hz": 40, "db": 2}]');
  assert.equal(objs.ok, true);
  assert.equal(objs.profile.id, pairs.profile.id);
  assert.equal(parseCalibrationText('[["20", 1]]').ok, false);
  assert.equal(parseCalibrationText('{"points": 3}').ok, false);
  assert.equal(parseCalibrationText('{"kind": "level", "points": [[20, 1]]}').ok, false);
  assert.equal(parseCalibrationText('{"schemaVersion": 2, "points": [[20, 1]]}').ok, false);
  assert.equal(parseCalibrationText('[[20, 1]').ok, false);
});

test('parse: JSON round trip export -> parse keeps profileId and user metadata', () => {
  const original = createFrequencyProfile({
    name: 'Round trip', source: 'my bench', notes: 'measured at 1 m',
    importedAt: '2026-10-02T09:00:00Z', points: SPEC_POINTS,
  });
  const text = JSON.stringify(exportProfile(original));
  const r = parseCalibrationText(text, { name: 'file-name.json' });
  assert.equal(r.ok, true);
  assert.equal(r.profile.id, original.id);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.profile, original);
  const tampered = JSON.parse(text);
  tampered.points[0][1] = 4.3;
  const t = parseCalibrationText(JSON.stringify(tampered));
  assert.equal(t.ok, true);
  assert.notEqual(t.profile.id, original.id);
  assert.ok(t.warnings.some((w) => /recomputed/.test(w.text)));
});

// --- interpolation and coverage ----------------------------------------------------------------

test('correctionAt: exact at every profile point', () => {
  const p = specProfile();
  for (const [hz, db] of SPEC_POINTS) {
    assert.deepEqual(correctionAt(p, hz), { correctionDb: db, covered: true, held: false });
  }
});

test('correctionAt: between points is linear in dB over log10(frequency)', () => {
  const p = createFrequencyProfile({ points: [[100, 0], [1000, 6]] });
  // Hand computation: t = log10(f / 100) / log10(1000 / 100) = log10(f / 100).
  close(correctionAt(p, Math.sqrt(10) * 100).correctionDb, 3, 'geometric mean');
  close(correctionAt(p, 200).correctionDb, 6 * Math.log10(2), '200 Hz'); // 1.80618 dB
  assert.ok(Math.abs(correctionAt(p, 200).correctionDb - 6 * (100 / 900)) > 1,
    'differs from linear-Hz interpolation (0.667 dB)');
  const s = specProfile();
  // 1 kHz..10 kHz: 0 -> 2.1 dB; 2 kHz has t = log10(2).
  close(correctionAt(s, 2000).correctionDb, 2.1 * Math.log10(2), '2 kHz');
  // 20..50 Hz: 4.2 -> 1.7 dB; 30 Hz has t = log10(1.5) / log10(2.5).
  const t30 = Math.log10(1.5) / Math.log10(2.5);
  close(correctionAt(s, 30).correctionDb, 4.2 - 2.5 * t30, '30 Hz');
});

test('correctionAt: below and above range under both extrapolation policies', () => {
  const p = specProfile();
  assert.deepEqual(coverage(p), [20, 20000]);
  assert.equal(correctionAt(p, 10), null);
  assert.equal(correctionAt(p, 24000), null);
  assert.equal(correctionAt(p, 0), null);
  assert.equal(correctionAt(p, 10, { extrapolate: 'none' }), null);
  assert.deepEqual(correctionAt(p, 10, { extrapolate: 'hold' }),
    { correctionDb: 4.2, covered: false, held: true });
  assert.deepEqual(correctionAt(p, 24000, { extrapolate: 'hold' }),
    { correctionDb: 6.8, covered: false, held: true });
  assert.throws(() => correctionAt(p, 100, { extrapolate: 'linear' }), RangeError);
  assert.throws(() => correctionAt(p, NaN), TypeError);
});

test('correctionCurve: covered mask and NaN outside coverage', () => {
  const p = createFrequencyProfile({ points: [[100, 1], [15000, 2]] });
  const f = new Float64Array([0, 50, 100, 1000, 15000, 20000]);
  const { correctionDb, covered } = correctionCurve(p, f);
  assert.deepEqual([...covered], [0, 0, 1, 1, 1, 0]);
  assert.ok(Number.isNaN(correctionDb[0]) && Number.isNaN(correctionDb[5]));
  assert.equal(correctionDb[2], 1);
  assert.equal(correctionDb[4], 2);
  const held = correctionCurve(p, f, { extrapolate: 'hold' });
  assert.deepEqual([...held.covered], [0, 0, 1, 1, 1, 0]);
  assert.equal(held.correctionDb[5], 2);
});

test('applyFrequencyCorrection: corrected = observed − correction; uncovered bins kept', () => {
  assert.equal(CORRECTION_SIGN, -1);
  // "Calibrated to 15 kHz" with a measurement to 20 kHz (spec §158).
  const p = createFrequencyProfile({ points: [[100, 1], [15000, 2]] });
  const freqs = deepFreeze([50, 100, 15000, 20000]);
  const mag = new Float64Array([-10, -10, -10, -10]);
  const before = [...mag];
  const r = applyFrequencyCorrection(mag, freqs, p);
  assert.deepEqual([...mag], before, 'input not mutated');
  assert.notEqual(r.correctedDb, mag);
  assert.deepEqual([...r.correctedDb], [-10, -11, -12, -10]);
  assert.deepEqual([...r.covered], [0, 1, 1, 0]);
  assert.deepEqual(r.coverage, [100, 15000]);
  assert.equal(r.algorithm, CALIBRATION_ALGORITHM);
  assert.equal(r.profileId, p.id);
  assert.equal(r.extrapolate, 'none');
  const held = applyFrequencyCorrection(mag, freqs, p, { extrapolate: 'hold' });
  assert.deepEqual([...held.correctedDb], [-11, -11, -12, -12]);
  assert.deepEqual([...held.covered], [0, 1, 1, 0], 'held bins stay flagged uncovered');
  assert.throws(() => applyFrequencyCorrection(mag, [1, 2], p), RangeError);
  assert.throws(() => applyFrequencyCorrection(mag, freqs, null), TypeError);
});

// --- absolute level calibration ----------------------------------------------------------------

const LEVEL = {
  referenceHz: 1000, referenceDbSpl: 94, observedDbRelative: -30.5,
  conditions: 'calibrator on mic capsule, input gain 50 %', createdAt: '2026-10-02T09:30:00Z',
};

test('level: offset = referenceDbSpl − observedDbRelative; shape per contract', () => {
  const cal = createLevelCalibration(LEVEL);
  assert.deepEqual(cal, {
    schemaVersion: 2, kind: 'level', referenceHz: 1000, referenceDbSpl: 94,
    observedDbRelative: -30.5, offsetDb: 124.5, scale: 'band-mean-square', method: 'manual',
    input: null, conditions: LEVEL.conditions, createdAt: LEVEL.createdAt,
  });
  assert.equal(isValidLevelCalibration(cal), true);
  assert.deepEqual(toDisplayLevel(-40, cal), { value: 84.5, unit: SPL_UNIT, calibrated: true });
  assert.equal(createLevelCalibration({ ...LEVEL, conditions: undefined }).conditions, null);
});

test('level: SPL label only with a valid calibration; no default SPL', () => {
  const uncal = { unit: RELATIVE_UNIT, calibrated: false, indicator: 'UNCALIBRATED' };
  assert.equal(RELATIVE_UNIT, 'dB relative (dBFS-like)');
  assert.deepEqual(levelLabel(null), uncal);
  assert.deepEqual(levelLabel(undefined), uncal);
  assert.deepEqual(levelLabel({}), uncal);
  const cal = createLevelCalibration(LEVEL);
  assert.deepEqual(levelLabel(cal), { unit: 'dB SPL', calibrated: true, indicator: 'CALIBRATED' });
  // A tampered offset, a wrong kind or an out-of-range reference is not a calibration.
  assert.equal(levelLabel({ ...cal, offsetDb: 120 }).calibrated, false);
  assert.equal(levelLabel({ ...cal, kind: 'frequency' }).calibrated, false);
  assert.equal(levelLabel({ ...cal, referenceDbSpl: 200, offsetDb: 230.5 }).calibrated, false);
  assert.deepEqual(toDisplayLevel(-40, null),
    { value: -40, unit: RELATIVE_UNIT, calibrated: false });
  assert.deepEqual(toDisplayLevel(-40, { ...cal, offsetDb: 0 }),
    { value: -40, unit: RELATIVE_UNIT, calibrated: false });
  // A frequency profile is never a level calibration (spec §17).
  assert.equal(levelLabel(specProfile()).calibrated, false);
});

test('level: invalid references rejected', () => {
  const bad = [
    { referenceHz: 19 }, { referenceHz: 20001 }, { referenceHz: NaN }, { referenceHz: '1000' },
    { referenceDbSpl: 39 }, { referenceDbSpl: 141 }, { referenceDbSpl: Infinity },
    { observedDbRelative: NaN }, { observedDbRelative: -Infinity }, { observedDbRelative: null },
  ];
  for (const patch of bad) {
    assert.throws(() => createLevelCalibration({ ...LEVEL, ...patch }), RangeError,
      JSON.stringify(patch));
  }
  assert.throws(() => createLevelCalibration({ ...LEVEL, createdAt: undefined }), TypeError);
  assert.throws(() => createLevelCalibration({ ...LEVEL, conditions: 5 }), TypeError);
  assert.throws(() => createLevelCalibration(), RangeError);
  for (const [referenceHz, referenceDbSpl] of [[20, 140], [20000, 40]]) {
    assert.doesNotThrow(() => createLevelCalibration({ ...LEVEL, referenceHz, referenceDbSpl }));
  }
});

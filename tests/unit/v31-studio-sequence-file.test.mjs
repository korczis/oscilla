// Studio Import of V2 sequence and configuration files, and the V2 sequence file of one track
// (plan K004; src/js/studio/library.js importStudioFile and exportSequenceFile,
// src/js/studio/sequence-import.js importSequenceDocument). A V2 sequence file (the sequencer's
// serializeSequence shape) or an OSCILLA configuration file holding one opens as a Sequence
// node with one event track of pattern clips. Strict: a file whose sequence the sequencer's
// parser would not reproduce exactly (a clamped, coerced, defaulted, renumbered or dropped
// value, an unknown field) is refused with the first field that differs, so the export of that
// track gives the file back exactly (review of #264).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SEED, addBlock, createSequence, moveBlock, parseSequence, referenceSequence,
  serializeSequence, setDurationUnit, setTempo, updateBlock,
} from '../../src/js/sequencer/model.js';
import {
  CONFIG_FILE_KIND, CONFIG_FILE_VERSION, buildConfigExport,
} from '../../src/js/ui/config-file.js';
import {
  SEQUENCE_FILE_EXTENSION, exportProjectFile, exportSequenceFile, importStudioFile,
} from '../../src/js/studio/library.js';
import {
  CONFIG_KIND, CONFIG_VERSION, exportSequence, importSequence, importSequenceDocument,
  isSequenceDocument,
} from '../../src/js/studio/sequence-import.js';
import { STUDIO_IMPORT_LIMITS, validateStudioCommit } from '../../src/js/studio/validate.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel } from '../../src/js/studio/templates/index.js';

function fixtures() {
  let all = createSequence({ tempoBpm: 96, waveform: 'square' });
  for (const type of ['tone', 'silence', 'sweep', 'pulse', 'chirp', 'burst', 'siren', 'am', 'fm',
    'random']) all = addBlock(all, type);
  let locked = updateBlock(referenceSequence(), 'b2', { beats: 1.5 });
  locked = setTempo(updateBlock(locked, 'b4', { beats: 0.75 }), 137);
  return {
    reference: referenceSequence(),
    allTypes: all,
    tempoLocked: locked,
    looped: { ...referenceSequence(), loop: true, waveform: 'triangle' },
    reordered: moveBlock(moveBlock(referenceSequence(), 0, 4), 1, 3),
  };
}

const fileText = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

function configText(sequencer, sampleRate = 48000) {
  return fileText(buildConfigExport({ oscillaVersion: 'test', sampleRate,
    mode: 'playground', workspace: 'sequencer', instrument: {}, sequencer,
    now: new Date(Date.UTC(2026, 9, 29)) }));
}

/** One event track targeting the Sequence node, every clip a pattern clip on it. */
function assertOneTrack(model, n, name) {
  const tracks = model.timeline.tracks;
  assert.equal(tracks.length, 1, `${name}: one track`);
  assert.equal(tracks[0].kind, 'event', name);
  const target = model.graph.nodes.find((x) => x.id === tracks[0].target);
  assert.equal(target && target.type, 'sequence', `${name}: the track plays a Sequence node`);
  assert.equal(model.timeline.clips.length, n, `${name}: one clip per block`);
  assert.ok(model.timeline.clips.every((c) => c.kind === 'pattern' && c.trackId === tracks[0].id),
    `${name}: pattern clips on that track`);
  assert.ok(validateStudioCommit(model).ok, `${name}: the model validates`);
}

test('exportSequence(importSequence(x).model) deep-equals x for every fixture', () => {
  for (const [name, seq] of Object.entries(fixtures())) {
    const x = serializeSequence(seq);
    const imp = importSequence(x);
    assert.ok(imp.ok, name);
    const ex = exportSequence(imp.model);
    assert.deepEqual(ex.sequence, x, name);
    assert.deepEqual(ex.issues, [], name);
    assert.equal(ex.trackId, imp.ids.track, name);
  }
});

// The V2 sequence fields the StudioModel does not carry, with the value the export writes: the
// seed (it only seeds blocks added later in the V2 editor and is never heard; a file with another
// seed is refused, below). One more is carried only in its canonical form: a tempo-locked block's
// durationMs, derived from its beats. A Sequencer save off that form (beats typed at an end of
// their rounding) opens and exports at the duration the beats derive, also after a save and
// reload (the tempo-locked test below). Every other field is carried by the model.
const NOT_CARRIED = Object.freeze({ seed: DEFAULT_SEED });

test('a saved and reloaded imported track exports the imported file (K004)', () => {
  for (const [name, seq] of Object.entries(fixtures())) {
    const x = serializeSequence(seq);
    const opened = importStudioFile(fileText(x));
    assert.equal(opened.ok, true, `${name}: ${JSON.stringify(opened.errors)}`);
    // Save (the project file) and reload: only the StudioModel survives, nothing beside it.
    const saved = exportProjectFile(opened.model).text;
    const reloaded = importStudioFile(saved);
    assert.equal(reloaded.ok, true, `${name}: ${JSON.stringify(reloaded.errors)}`);
    assert.equal(reloaded.kind, 'project', name);
    const out = JSON.parse(exportSequenceFile(reloaded.model).text);
    for (const [field, written] of Object.entries(NOT_CARRIED)) {
      assert.equal(out[field], written, `${name}: ${field} is written as its default`);
    }
    assert.deepEqual(out, x, `${name}: export(import(file)) after a save and reload is the file`);
  }
});

test('a seed other than the V2 default is refused: Studio keeps no seed outside its model', () => {
  // The app never writes another seed (it only seeds blocks added in the V2 editor and is
  // never heard), so a file carrying one is hand-made; it is refused rather than dropped.
  const x = serializeSequence(createSequence({ ...referenceSequence(), seed: 4242 }));
  const r = importStudioFile(fileText(x));
  assert.equal(r.ok, false);
  assert.equal(r.model, undefined);
  assert.equal(r.errors[0].path, 'seed');
  assert.match(r.errors[0].message, new RegExp(`^The sequence seed is 4242; Studio opens only `
    + `the V2 default seed ${DEFAULT_SEED}.*; the file is refused\\.$`));
  // The pure functions (V416) still carry it explicitly.
  const imp = importSequence(x);
  assert.equal(imp.extras.seed, 4242);
  assert.deepEqual(exportSequence(imp.model, { seed: imp.extras.seed }).sequence, x);
});

test('Studio Import opens a V2 sequence file as N pattern clips on one track; export gives '
  + 'the file back', () => {
  for (const [name, seq] of Object.entries(fixtures())) {
    const x = serializeSequence(seq);
    const r = importStudioFile(fileText(x));
    assert.equal(r.ok, true, `${name}: ${JSON.stringify(r.errors)}`);
    assert.equal(r.kind, 'sequence', name);
    assert.equal(r.source, 'sequence', name);
    assert.equal(r.seed, undefined, `${name}: no seed beside the model`);
    assert.deepEqual(r.warnings, [], name);
    assertOneTrack(r.model, x.blocks.length, name);
    assert.equal(r.model.transport.tempo, x.tempoBpm, name);
    const f = exportSequenceFile(r.model);
    assert.ok(f.name.endsWith(SEQUENCE_FILE_EXTENSION), f.name);
    assert.equal(f.type, 'application/json');
    assert.deepEqual(f.issues, [], name);
    assert.deepEqual(JSON.parse(f.text), x, `${name}: the exported file is the imported one`);
    assert.deepEqual(importStudioFile(f.text).model, r.model, `${name}: re-import is identical`);
    // The parsed object reads the same as its text.
    assert.deepEqual(importStudioFile(x).model, r.model, name);
  }
});

test('Studio Import opens the sequence a configuration file holds', () => {
  assert.equal(CONFIG_KIND, CONFIG_FILE_KIND);
  const seq = serializeSequence(fixtures().tempoLocked);
  const text = configText(seq);
  assert.ok(isSequenceDocument(JSON.parse(text)));
  const r = importStudioFile(text);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.kind, 'sequence');
  assert.equal(r.source, 'config');
  assert.equal(r.model.metadata.title, 'Configuration sequence');
  assertOneTrack(r.model, seq.blocks.length, 'config');
  assert.deepEqual(r.model.timeline.clips.filter((c) => c.musical)
    .map((c) => c.musical.durationBeats), [1.5, 0.75]);
  assert.deepEqual(JSON.parse(exportSequenceFile(r.model).text), seq);
});

test('a sequence saved at 48 kHz opens at the rate it was saved at, and exports back', () => {
  // A 22 kHz tone is valid at 48 kHz (safe maximum 22.8 kHz), not at 44.1 kHz (20.9 kHz).
  const seq = serializeSequence(createSequence({ blocks: [
    { id: 'b1', type: 'tone', durationMs: 500, params: { freq: 22000 } },
    { id: 'b2', type: 'sweep', durationMs: 500, params: { start: 440, end: 22500, curve: 'log' } },
  ] }, { sampleRate: 48000 }));
  assert.equal(seq.blocks[0].params.freq, 22000);
  // A configuration file names its rate (sampleRateRequested): it opens on any machine.
  const cfg = importStudioFile(configText(seq, 48000));
  assert.equal(cfg.ok, true, JSON.stringify(cfg.errors));
  assert.equal(importStudioFile(configText(seq, 48000), { sampleRate: 44100 }).ok, true);
  assert.deepEqual(JSON.parse(exportSequenceFile(cfg.model, { sampleRate: 48000 }).text), seq);
  // A bare V2 sequence file is read at the Studio's rate.
  const at48 = importStudioFile(fileText(seq), { sampleRate: 48000 });
  assert.equal(at48.ok, true, JSON.stringify(at48.errors));
  assert.deepEqual(JSON.parse(exportSequenceFile(at48.model, { sampleRate: 48000 }).text), seq);
  const at44 = importStudioFile(fileText(seq));
  assert.equal(at44.ok, false);
  assert.equal(at44.errors[0].path, 'blocks[0].params.freq');
  assert.equal(at44.errors[0].message, 'Block 1: freq 22 kHz is above the 20.9 kHz limit at '
    + '44.1 kHz; the file is refused.');
  // A configuration saved before audio started (no rate) is read at the Studio's rate.
  assert.equal(importStudioFile(configText(seq, null), { sampleRate: 48000 }).ok, true);
  assert.equal(importStudioFile(configText(seq, null)).ok, false);
});

test('a malformed or oversized file is refused with a readable reason and no model', () => {
  const ref = serializeSequence(referenceSequence());
  const withBlocks = (blocks) => fileText({ ...ref, blocks });
  const tooMany = Array.from({ length: 65 }, (_, i) => ({ id: `b${i + 1}`, type: 'silence',
    durationMs: 100, beats: null, params: {} }));
  const huge = fileText({ ...ref, note: 'x'.repeat(STUDIO_IMPORT_LIMITS.maxBytes) });
  const cases = [
    ['config without a sequence', configText(null), /holds no Sequencer sequence/,
      'sequencer'],
    ['blocks not a list', fileText({ ...ref, blocks: { b1: ref.blocks[0] } }),
      /blocks are not a list/, 'blocks'],
    ['another sequence version', fileText({ ...ref, version: 2 }),
      /^Sequence version 2 is not 1; the file is refused\.$/, 'version'],
    ['no blocks', withBlocks([]), /no blocks, so there is nothing to open/, 'blocks'],
    ['too many blocks', withBlocks(tooMany), /65 blocks; a V2 sequence holds at most 64/,
      'blocks'],
    ['an unknown block type', withBlocks([ref.blocks[0], { ...ref.blocks[1], type: 'laser' }]),
      /^Block 2: “laser” is not a V2 block type; the file is refused\.$/, 'blocks[1].type'],
    ['a duration out of range', withBlocks([{ ...ref.blocks[0], durationMs: 1 }]),
      /^Block 1: durationMs is 1 in the file but would open as 10; the file is refused\.$/,
      'blocks[0].durationMs'],
    ['a config sequence with damage', configText({ ...ref, blocks: 'none' }),
      /blocks are not a list/, 'sequencer.blocks'],
    ['another configuration version', fileText({ ...JSON.parse(configText(ref)), version: 99 }),
      /^Configuration file version 99 is not 1; the file is refused\.$/, 'version'],
    ['a prototype key', fileText(ref).replace('"params": {', '"params": {"__proto__": {},'),
      /^forbidden field name$/, 'blocks[0].params.__proto__'],
    ['oversized', huge, /larger than the 4194304-byte import limit/, ''],
  ];
  for (const [name, text, why, path] of cases) {
    const r = importStudioFile(text);
    assert.equal(r.ok, false, `${name}: refused`);
    assert.equal(r.model, undefined, `${name}: no model`);
    const e = r.errors && r.errors[0];
    assert.ok(e && typeof e.message === 'string' && e.message.length > 10, name);
    assert.match(e.message, why, name);
    if (path !== null) assert.equal(e.path, path, `${name}: path`);
  }
});

test('what the sequencer would silently repair is refused, naming the first field', () => {
  // Each of these opened "repaired" before (review of #264, P1): parseSequence's normalizeModel
  // changes them without reporting an issue.
  const ref = serializeSequence(referenceSequence());
  const b = ref.blocks;
  const top = (patch) => ({ ...ref, ...patch });
  const block = (i, patch) => ({ ...ref, blocks: b.map((x, k) => (k === i ? { ...x, ...patch }
    : x)) });
  const params = (i, patch) => block(i, { params: { ...b[i].params, ...patch } });
  const without = (i, key) => {
    const { [key]: _drop, ...rest } = b[i];
    return { ...ref, blocks: b.map((x, k) => (k === i ? rest : x)) };
  };
  const burst = { id: 'b1', type: 'burst', durationMs: 500, beats: null,
    params: { freq: 1000, burstMs: 30, intervalMs: 20 } };
  const fm = { id: 'b1', type: 'fm', durationMs: 500, beats: null,
    params: { freq: 100, modFreq: 5, depthHz: 500 } };
  const cases = [
    ['tempo 9999', top({ tempoBpm: 9999 }), 'tempoBpm',
      'The sequence: tempoBpm is 9999 in the file but would open as 300'],
    ['tempo "fast"', top({ tempoBpm: 'fast' }), 'tempoBpm',
      'The sequence: tempoBpm is “fast” in the file but would open as 120'],
    ['tempo as text', top({ tempoBpm: '120' }), 'tempoBpm',
      'The sequence: tempoBpm is “120” in the file but would open as 120'],
    ['waveform "laser"', top({ waveform: 'laser' }), 'waveform',
      'The sequence: waveform is “laser” in the file but would open as “sine”'],
    ['loop "yes"', top({ loop: 'yes' }), 'loop',
      'The sequence: loop is “yes” in the file but would open as false'],
    ['seed -5', top({ seed: -5 }), 'seed',
      'The sequence: seed is -5 in the file but would open as 0'],
    ['tempo missing', (() => { const { tempoBpm: _t, ...r } = ref; return r; })(), 'tempoBpm',
      'The sequence: tempoBpm is missing'],
    ['an unknown field', top({ selected: 'b1' }), 'selected',
      'The sequence: selected is not a V2 sequence field'],
    ['duplicate block ids', block(2, { id: 'b1' }), 'blocks[2].id',
      'Block 3: id “b1” is already used by block 1'],
    ['beats -3', block(0, { beats: -3 }), 'blocks[0].beats',
      'Block 1: beats is -3 in the file but would open as null'],
    ['params "x"', block(0, { params: 'x' }), 'blocks[0].params',
      'Block 1: params is “x”, not an object'],
    ['params missing', without(0, 'params'), 'blocks[0].params', 'Block 1: params is missing'],
    ['durationMs missing', without(0, 'durationMs'), 'blocks[0].durationMs',
      'Block 1: durationMs is missing'],
    ['a parameter missing', params(1, { curve: undefined }), 'blocks[1].params.curve',
      'Block 2: params.curve is missing'],
    ['an unknown parameter', params(0, { gain: 1 }), 'blocks[0].params.gain',
      'Block 1: params.gain is not a parameter of a tone block'],
    ['an unknown block field', block(0, { colour: 'red' }), 'blocks[0].colour',
      'Block 1: colour is not a V2 block field'],
    ['freq 440.00049', params(0, { freq: 440.00049 }), 'blocks[0].params.freq',
      'Block 1: params.freq is 440.00049 in the file but would open as 440'],
    ['a block that is not an object', top({ blocks: [null, ...b.slice(1)] }), 'blocks[0]',
      'Block 1 is not an object'],
    ['burst interval below the burst', top({ blocks: [burst] }), 'blocks[0].params.intervalMs',
      'Block 1: params.intervalMs is 20 in the file but would open as 30'],
    ['fm depth past the floor', top({ blocks: [fm] }), 'blocks[0].params.depthHz',
      'Block 1: params.depthHz is 500 in the file but would open as 80'],
  ];
  for (const [name, doc, path, message] of cases) {
    const text = JSON.stringify(doc);
    const r = importStudioFile(text);
    assert.equal(r.ok, false, `${name}: refused`);
    assert.equal(r.model, undefined, `${name}: no model`);
    assert.equal(r.errors[0].path, path, `${name}: path`);
    assert.equal(r.errors[0].message, `${message}; the file is refused.`, name);
    // The same sequence inside a configuration file names its path under `sequencer`.
    const c = importStudioFile(configText(JSON.parse(text)));
    assert.equal(c.ok, false, `${name}: refused in a configuration file`);
    assert.equal(c.errors[0].path, `sequencer.${path}`, `${name}: config path`);
    // The pure entry point refuses it too.
    assert.equal(importSequenceDocument(JSON.parse(text)).ok, false, name);
  }
});

// A tempo-locked block's durationMs is derived from its beats, and the V2 Sequencer stores the
// beats rounded to 6 decimals and the milliseconds derived from the unrounded beats, so its own
// save is not always a fixed point of parseSequence (review of #264, F1).
function v2Save(tempoBpm, block, beats) {
  const seq = createSequence({ tempoBpm, blocks: [{ id: 'b1', ...block }] });
  return serializeSequence(beats === undefined ? setDurationUnit(seq, 'b1', 'beats')
    : updateBlock(seq, 'b1', { beats }));
}

test('the V2 Sequencer\'s own save of a tempo-locked block opens, as the Sequencer opens it',
  () => {
  const cases = [
    // 100 ms at 20 BPM switched to beats: 0.033333 beats, which re-derive 99.999 ms.
    ['20 BPM', v2Save(20, { type: 'tone', durationMs: 100, params: { freq: 440 } }),
      [100, 0.033333], 99.999],
    // Beats typed with more than 6 decimals.
    ['beats typed at 120 BPM', v2Save(120, { type: 'tone', durationMs: 100 }, 1.00000103),
      [500.001, 1.000001], 500],
    ['beats typed at 30 BPM', v2Save(30, { type: 'tone', durationMs: 100 }, 0.0123456789),
      [24.691, 0.012346], 24.692],
    // The lowest beats that round to 0.033333 (round adds Number.EPSILON before rounding), typed
    // at 20 BPM: they derive 99.997 ms (review of #264, F6).
    ['the low end of the beats rounding at 20 BPM',
      v2Save(20, { type: 'tone', durationMs: 100 }, 0.03333249999999999), [99.997, 0.033333],
      99.999],
    ['the low end of the beats rounding at 60 BPM',
      v2Save(60, { type: 'tone', durationMs: 100 }, 0.0999995 - Number.EPSILON),
      [99.999, 0.1], 100],
    // At a bound: the rounded beats re-derive past it, and the sequencer clamps them back.
    ['at the 5 s chirp maximum', v2Save(20, { type: 'chirp', durationMs: 5000 }),
      [5000, 1.666667], 5000],
    ['at the 10 ms minimum', v2Save(50, { type: 'tone', durationMs: 10 }), [10, 0.008333], 10],
  ];
  for (const [name, x, saved, opens] of cases) {
    const b = x.blocks[0];
    assert.deepEqual([b.durationMs, b.beats], saved, `${name}: what the Sequencer saves`);
    const canon = serializeSequence(parseSequence(x).model);
    assert.equal(canon.blocks[0].durationMs, opens, `${name}: what the Sequencer opens`);
    const r = importStudioFile(fileText(x));
    assert.equal(r.ok, true, `${name}: ${JSON.stringify(r.errors)}`);
    assertOneTrack(r.model, 1, name);
    const clip = r.model.timeline.clips[0];
    assert.equal(clip.duration, opens / 1000, `${name}: opens as the Sequencer opens it`);
    assert.equal(clip.musical.durationBeats, saved[1], `${name}: the beats are the file's`);
    assert.ok(importStudioFile(configText(x)).ok, `${name}: inside a configuration file`);
    // The export is the Sequencer's canonical form, a fixed point that re-imports identically.
    const f = exportSequenceFile(r.model);
    assert.deepEqual(JSON.parse(f.text), canon, name);
    assert.deepEqual(importStudioFile(f.text).model, r.model, `${name}: re-import is identical`);
    // The durationMs the model does not carry stays canonical after a save and reload.
    const reloaded = importStudioFile(exportProjectFile(r.model).text);
    assert.equal(reloaded.ok, true, `${name}: ${JSON.stringify(reloaded.errors)}`);
    assert.deepEqual(JSON.parse(exportSequenceFile(reloaded.model).text), canon,
      `${name}: after a save and reload`);
  }
});

test('a tempo-locked durationMs outside the rounding of its beats is still refused', () => {
  const at = (tempoBpm, durationMs, beats, type = 'tone') => fileText(createSequence({
    tempoBpm, blocks: [{ id: 'b1', type, durationMs: 100 }] }))
    .replace(/"durationMs": [^,]+,\s*"beats": null/,
      `"durationMs": ${durationMs}, "beats": ${beats}`);
  const cases = [
    // 1 beat at 120 BPM is 500 ms exactly: no rounding of the beats reaches 500.001.
    [at(120, 501, 1), 'Block 1: durationMs is 501 in the file but would open as 500'],
    [at(120, 500.001, 1), 'Block 1: durationMs is 500.001 in the file but would open as 500'],
    // 1.000001 beats at 120 BPM can be 500 or 500.001 ms, not 500.002.
    [at(120, 500.002, 1.000001),
      'Block 1: durationMs is 500.002 in the file but would open as 500'],
    // The beats that round to 0.033333 lie in [0.0333325, 0.0333335) less the rounding's
    // Number.EPSILON, so at 20 BPM they derive 99.997 to 100 ms (review of #264, F6 and F7).
    [at(20, 100.002, 0.033333),
      'Block 1: durationMs is 100.002 in the file but would open as 99.999'],
    [at(20, 100.001, 0.033333),
      'Block 1: durationMs is 100.001 in the file but would open as 99.999'],
    [at(20, 99.996, 0.033333),
      'Block 1: durationMs is 99.996 in the file but would open as 99.999'],
    // 0.1 beats at 60 BPM derive 99.999 to 100 ms, never 100.001 (the upper end is open).
    [at(60, 100.001, 0.1), 'Block 1: durationMs is 100.001 in the file but would open as 100'],
    [at(20, 100.01, 0.033333),
      'Block 1: durationMs is 100.01 in the file but would open as 99.999'],
    // The Sequencer stores milliseconds to 3 decimals.
    [at(20, 100.0004, 0.033333),
      'Block 1: durationMs is 100.0004 in the file but would open as 99.999'],
    // Each end of a rounding range is one double: 1.000501 beats at 60 BPM open 1000.501 ms
    // and refuse the next millisecond step either way (review of #355, V1).
    [at(60, 1000.502, 1.000501),
      'Block 1: durationMs is 1000.502 in the file but would open as 1000.501'],
    [at(60, 1001.4, 1.001401),
      'Block 1: durationMs is 1001.4 in the file but would open as 1001.401'],
    // A derived duration past a bound is clamped to it, so a millisecond past the clamp is
    // refused: a chirp's 5000 ms ceiling and a block's 10 ms floor (review of #355, V2).
    [at(20, 5000.001, 1.666667, 'chirp'),
      'Block 1: durationMs is 5000.001 in the file but would open as 5000'],
    [at(20, 5000.002, 1.666667, 'chirp'),
      'Block 1: durationMs is 5000.002 in the file but would open as 5000'],
    [at(20, 9.999, 0.003333),
      'Block 1: durationMs is 9.999 in the file but would open as 10'],
    // Beats past a bound by more than their rounding are clamped, which changes them.
    [at(20, 5000, 1.666668, 'chirp'),
      'Block 1: beats is 1.666668 in the file but would open as 1.666667'],
  ];
  for (const [text, message] of cases) {
    assert.ok(text.includes('"beats": '), 'the fixture is tempo-locked');
    const r = importStudioFile(text);
    assert.equal(r.ok, false, message);
    assert.equal(r.model, undefined, message);
    assert.equal(r.errors[0].path, message.includes('beats is') ? 'blocks[0].beats'
      : 'blocks[0].durationMs', message);
    assert.equal(r.errors[0].message, `${message}; the file is refused.`);
  }
});

test('a block type naming an Object.prototype member is refused, not thrown (F2)', () => {
  const ref = serializeSequence(referenceSequence());
  for (const type of ['toString', 'constructor', '__proto__', 'valueOf', 'hasOwnProperty']) {
    const doc = { ...ref, blocks: [ref.blocks[0], { ...ref.blocks[1], type }] };
    let r;
    assert.doesNotThrow(() => { r = importStudioFile(JSON.stringify(doc)); }, type);
    assert.equal(r.ok, false, type);
    assert.equal(r.model, undefined, type);
    assert.equal(r.errors[0].path, 'blocks[1].type', type);
    assert.equal(r.errors[0].message,
      `Block 2: “${type}” is not a V2 block type; the file is refused.`, type);
    assert.doesNotThrow(() => importSequenceDocument(JSON.parse(JSON.stringify(doc))), type);
    const c = importStudioFile(configText(doc));
    assert.equal(c.ok, false, type);
    assert.equal(c.errors[0].path, 'sequencer.blocks[1].type', type);
  }
});

test('a block type that is not a string is refused as such, not coerced to a key (F8)', () => {
  const ref = serializeSequence(referenceSequence());
  for (const [type, said] of [[['tone'], 'a list'], [{ tone: 1 }, 'an object'], [7, '7']]) {
    const doc = { ...ref, blocks: [ref.blocks[0], { ...ref.blocks[1], type }] };
    const r = importStudioFile(JSON.stringify(doc));
    assert.equal(r.ok, false, said);
    assert.equal(r.model, undefined, said);
    assert.equal(r.errors[0].path, 'blocks[1].type', said);
    assert.equal(r.errors[0].message,
      `Block 2: ${said} is not a V2 block type; the file is refused.`, said);
  }
});

test('a V2 block id that cannot name a Studio clip is refused, not renumbered (F3)', () => {
  const ref = serializeSequence(referenceSequence());
  for (const id of ['kick drum', 'é1', `b${'1'.repeat(130)}`, 'b1/2']) {
    const doc = { ...ref, blocks: [ref.blocks[0], { ...ref.blocks[1], id }] };
    assert.equal(serializeSequence(parseSequence(doc).model).blocks[1].id, id,
      'the V2 Sequencer keeps the id');
    const r = importStudioFile(JSON.stringify(doc));
    assert.equal(r.ok, false, id);
    assert.equal(r.model, undefined, id);
    assert.equal(r.errors[0].path, 'blocks[1].id', id);
    assert.match(r.errors[0].message,
      /^Block 2: id “.+” cannot name a Studio clip \(letters, digits, /, id);
  }
  // The longest id is the clip id pattern's (ID_PATTERN) less the `clip-` prefix (F9).
  const longest = `b${'1'.repeat(122)}`;
  const opens = importStudioFile(JSON.stringify({ ...ref, blocks: [ref.blocks[0],
    { ...ref.blocks[1], id: longest }] }));
  assert.equal(opens.ok, true, JSON.stringify(opens.errors));
  assert.equal(opens.model.timeline.clips[1].id, `clip-${longest}`);
  const over = importStudioFile(JSON.stringify({ ...ref, blocks: [ref.blocks[0],
    { ...ref.blocks[1], id: `${longest}1` }] }));
  assert.equal(over.ok, false);
  assert.match(over.errors[0].message, /at most 123 characters\); the file is refused\.$/);
});

test('the configuration version Studio reads is the one config-file.js writes', () => {
  assert.equal(CONFIG_VERSION, CONFIG_FILE_VERSION);
});

test('track export: a document without a pattern track is refused; what V2 cannot hold is '
  + 'stated', () => {
  assert.throws(() => exportSequenceFile(templateModel('basic-tone')),
    /no event track with pattern clips/);
  const imp = importSequence(serializeSequence(referenceSequence()));
  const store = createStudioStore(imp.model, { idGenerator: createIdGenerator(imp.model) });
  assert.ok(store.dispatch({ type: 'CLIP_MOVE', clipId: imp.ids.clips[1], start: 0.25 }).ok);
  const f = exportSequenceFile(store.getModel());
  assert.ok(f.issues.some((i) => i.includes('overlaps')), JSON.stringify(f.issues));
  assert.equal(JSON.parse(f.text).seed, DEFAULT_SEED);
  for (const clipId of imp.ids.clips) {
    assert.ok(store.dispatch({ type: 'CLIP_REMOVE', clipId }).ok, clipId);
  }
  assert.throws(() => exportSequenceFile(store.getModel(), { trackId: imp.ids.track }),
    /holds no pattern clip/);
});

test('project and patch files still import through their own pipelines', () => {
  const model = templateModel('sweep-sequence');
  const r = importStudioFile(exportProjectFile(model).text);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'project');
  assert.equal(isSequenceDocument(JSON.parse(exportProjectFile(model).text)), false);
  const bad = importStudioFile('{not json');
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0].message, /^Not valid JSON/);
});

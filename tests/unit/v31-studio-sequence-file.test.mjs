// Studio Import of V2 sequence and configuration files, and the V2 sequence file of one track
// (plan K004; src/js/studio/library.js importStudioFile and exportSequenceFile,
// src/js/studio/sequence-import.js importSequenceDocument). A V2 sequence file (the sequencer's
// serializeSequence shape) or an OSCILLA configuration file holding one opens as a Sequence
// node with one event track of pattern clips; what the sequencer's parser would repair is
// refused instead, readably, and the export of that track gives the file back exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SEED, addBlock, createSequence, moveBlock, referenceSequence, serializeSequence,
  setTempo, updateBlock,
} from '../../src/js/sequencer/model.js';
import { CONFIG_FILE_KIND, buildConfigExport } from '../../src/js/ui/config-file.js';
import {
  SEQUENCE_FILE_EXTENSION, exportProjectFile, exportSequenceFile, importStudioFile,
} from '../../src/js/studio/library.js';
import {
  CONFIG_KIND, exportSequence, importSequence, isSequenceDocument,
} from '../../src/js/studio/sequence-import.js';
import { STUDIO_IMPORT_LIMITS, validateStudioCommit } from '../../src/js/studio/validate.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel } from '../../src/js/studio/templates/index.js';

function fixtures() {
  let all = createSequence({ tempoBpm: 96, waveform: 'square', seed: 4242 });
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

function configText(sequencer) {
  return fileText(buildConfigExport({ oscillaVersion: 'test', sampleRate: 48000,
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

test('exportSequence(importSequence(x)) deep-equals x for every fixture', () => {
  for (const [name, seq] of Object.entries(fixtures())) {
    const x = serializeSequence(seq);
    const imp = importSequence(x);
    assert.ok(imp.ok, name);
    const ex = exportSequence(imp.model, { seed: imp.extras.seed });
    assert.deepEqual(ex.sequence, x, name);
    assert.deepEqual(ex.issues, [], name);
    assert.equal(ex.trackId, imp.ids.track, name);
  }
});

test('Studio Import opens a V2 sequence file as N pattern clips on one track; export gives '
  + 'the file back', () => {
  for (const [name, seq] of Object.entries(fixtures())) {
    const x = serializeSequence(seq);
    const r = importStudioFile(fileText(x));
    assert.equal(r.ok, true, `${name}: ${JSON.stringify(r.errors)}`);
    assert.equal(r.kind, 'sequence', name);
    assert.equal(r.source, 'sequence', name);
    assert.equal(r.seed, x.seed, name);
    assert.deepEqual(r.warnings, [], name);
    assertOneTrack(r.model, x.blocks.length, name);
    assert.equal(r.model.transport.tempo, x.tempoBpm, name);
    const f = exportSequenceFile(r.model, { seed: r.seed });
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
  assert.deepEqual(JSON.parse(exportSequenceFile(r.model, { seed: r.seed }).text), seq);
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
      /^Sequence version 2 is not 1\.$/, 'version'],
    ['no blocks', withBlocks([]), /no blocks, so there is nothing to open/, 'blocks'],
    ['too many blocks', withBlocks(tooMany), /65 blocks; a V2 sequence holds at most 64/,
      'blocks'],
    ['an unknown block type', withBlocks([ref.blocks[0], { ...ref.blocks[1], type: 'laser' }]),
      /^Block 2: unknown type .*laser.*refused, not repaired\.$/, 'blocks'],
    ['a duration out of range', withBlocks([{ ...ref.blocks[0], durationMs: 1 }]),
      /^Block 1: duration limited to .*refused, not repaired\.$/, 'blocks'],
    ['a config sequence with damage', configText({ ...ref, blocks: 'none' }),
      /blocks are not a list/, 'sequencer.blocks'],
    ['a prototype key', fileText(ref).replace('"params": {', '"params": {"__proto__": {},'),
      /./, null],
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

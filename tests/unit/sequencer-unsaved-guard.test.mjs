// C019 (finding persist-7, the sequencer half): an unsaved sequence arms the unsaved-work guard.
// The editor names every change of its model (onChange); sequenceDigest is the content the
// guard compares, so every edit changes it and a no-op, a selection or the waveform mirrored
// from the instrument (configuration, not sequence work) does not. The workbench reports
// 'Unsaved sequence' while the digest differs from the one at the last load, import or export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// A namespace import: on a tree without the digest the tests fail by assertion, not at load.
import * as editorModule from '../../src/js/sequencer/editor.js';
import { createWorkbench } from '../../src/js/ui/workbench.js';
import { collectUnsaved } from '../../src/js/ui/unsaved.js';

const { createSequencerEditor } = editorModule;
const sequenceDigest = (model) => {
  assert.equal(typeof editorModule.sequenceDigest, 'function',
    'sequencer/editor.js exports sequenceDigest');
  return editorModule.sequenceDigest(model);
};

function editorWithLog() {
  const ed = createSequencerEditor({ timers: null, sampleRate: 48000 });
  assert.equal(typeof ed.onChange, 'function', 'the editor names its changes (onChange)');
  const seen = [];
  ed.onChange((model) => seen.push(sequenceDigest(model)));
  return { ed, seen };
}

test('sequenceDigest changes on every editor mutation and the editor names each one', () => {
  const { ed, seen } = editorWithLog();
  const mutations = [
    ['addBlock', () => ed.addBlock('tone')],
    ['updateParam', () => ed.updateParam('durationMs', 750)],
    ['duplicateSelected', () => ed.duplicateSelected()],
    ['moveSelected', () => ed.moveSelected(-1)],
    ['moveBlockTo', () => ed.moveBlockTo(0, 2)],
    ['deleteSelected', () => ed.deleteSelected()],
    ['setTempo', () => ed.setTempo(90)],
    ['setLoop', () => ed.setLoop(!ed.model.loop)],
    ['load', () => ed.load({ version: 1, tempoBpm: 140, loop: false, blocks: [
      { type: 'tone', durationMs: 300, params: { frequency: 220 } }] })],
    ['clear', () => ed.clear()],
  ];
  let before = sequenceDigest(ed.model);
  for (const [name, run] of mutations) {
    const n = seen.length;
    run();
    const after = sequenceDigest(ed.model);
    assert.notEqual(after, before, `${name} changes the digest`);
    assert.ok(seen.length > n, `${name} is named through onChange`);
    assert.equal(seen[seen.length - 1], after, `${name}: onChange carries the new model`);
    before = after;
  }
});

test('sequenceDigest does not change on a no-op, a selection or the mirrored waveform', () => {
  const { ed } = editorWithLog();
  const d0 = sequenceDigest(ed.model);
  ed.setTempo(ed.model.tempoBpm);
  ed.setLoop(ed.model.loop);
  ed.selectRelative(1);
  ed.selectBlock(ed.model.blocks[0].id);
  for (const w of ['square', 'sawtooth', 'triangle', 'sine']) ed.setWaveform(w);
  assert.equal(sequenceDigest(ed.model), d0);
  // An edit undone by hand is the saved sequence again.
  ed.setTempo(90);
  assert.notEqual(sequenceDigest(ed.model), d0);
  ed.setTempo(120);
  assert.equal(sequenceDigest(ed.model), d0);
  // Key order inside params is not content.
  const a = { version: 1, tempoBpm: 120, blocks: [{ id: 'b1', type: 'tone', durationMs: 100,
    params: { frequency: 440, level: 1 } }] };
  const b = { blocks: [{ params: { level: 1, frequency: 440 }, durationMs: 100, type: 'tone',
    id: 'b1' }], tempoBpm: 120, version: 1 };
  assert.equal(sequenceDigest(a), sequenceDigest(b));
});

test('onChange returns its unsubscribe and refuses a non-function', () => {
  const ed = createSequencerEditor({ timers: null, sampleRate: 48000 });
  assert.equal(typeof ed.onChange, 'function', 'the editor names its changes (onChange)');
  let calls = 0;
  const off = ed.onChange(() => { calls += 1; });
  ed.setTempo(90);
  off();
  ed.setTempo(100);
  assert.equal(calls, 1);
  assert.throws(() => ed.onChange(null), TypeError);
});

test('the workbench reports Unsaved sequence until the sequence is marked saved', () => {
  const ed = createSequencerEditor({ timers: null, sampleRate: 48000 });
  const wb = createWorkbench({ labs: { sequencer: { editor: ed } } });
  assert.equal(typeof wb.sequencerWhatWouldBeLost, 'function',
    'the workbench is a source of the unsaved-work guard');
  // No sequencer mounted yet, or nothing changed: nothing to lose.
  assert.deepEqual(wb.sequencerWhatWouldBeLost(), []);
  wb.markSequenceSaved();
  assert.equal(wb.seqUnsaved, false);
  ed.onChange((m) => { wb.seqDigest = sequenceDigest(m); });
  ed.addBlock('tone');
  assert.equal(wb.seqUnsaved, true);
  assert.deepEqual(collectUnsaved([() => wb.sequencerWhatWouldBeLost()]),
    [{ domain: 'sequencer', label: 'Unsaved sequence' }]);
  wb.markSequenceSaved(); // an import or a successful Export configuration
  assert.equal(wb.seqUnsaved, false);
  assert.deepEqual(wb.sequencerWhatWouldBeLost(), []);
  ed.setWaveform('square'); // the instrument's waveform, mirrored in: configuration
  assert.deepEqual(wb.sequencerWhatWouldBeLost(), []);
});

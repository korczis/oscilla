// C016 (finding coupling-5): one list of the output owners. main.js stopPlayback (MEASURE and
// Studio PLAY take the output) and outputBusy (MEASURE's setup check reports OTHER_AUDIO) are
// read off the same OUTPUT_OWNERS table, so a source that one of them knows and the other does
// not (the sequencer and the Studio transport were unknown to engine.audibleVoiceCount) cannot
// come back. main.js is the composition root and does not load under node, so its table is
// read from the source text and evaluated against fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MAIN = read('src/js/main.js');

/** The source of `function <name>(...) { ... }` at the top level of main.js. */
function topFunction(src, name) {
  const at = src.indexOf(`\nfunction ${name}(`);
  assert.ok(at >= 0, `main.js defines function ${name}`);
  const end = src.indexOf('\n}\n', at);
  return src.slice(at + 1, end + 2);
}

/** OUTPUT_OWNERS, stopPlayback and outputBusy of main.js, bound to the given `labs`. */
function ownersOf(labs) {
  const at = MAIN.indexOf('\nconst OUTPUT_OWNERS = ');
  assert.ok(at >= 0, 'main.js declares const OUTPUT_OWNERS');
  const end = MAIN.indexOf('\n]);\n', at);
  const table = MAIN.slice(at + 1, end + 5);
  const body = `${table}\n${topFunction(MAIN, 'stopPlayback')}\n${topFunction(MAIN, 'outputBusy')}`
    + '\nreturn { OUTPUT_OWNERS, stopPlayback, outputBusy };';
  // eslint-disable-next-line no-new-func
  return new Function('labs', body)(labs);
}

function fakes() {
  const log = [];
  const editor = { playing: false, stop() { log.push('sequencer'); this.playing = false; } };
  const labs = { sequencer: { editor } };
  let studio = false;
  const cmp = {
    playing: false, seqPlaying: false,
    stopNow() { log.push('instrument'); this.playing = false; },
    studioOwnsOutput: () => studio,
    studioStop() { log.push('studio'); studio = false; },
  };
  return { log, editor, labs, cmp, setStudio: (v) => { studio = v; } };
}

test('C016: the output owners are the sequencer, the instrument and the Studio transport', () => {
  const { OUTPUT_OWNERS } = ownersOf(fakes().labs);
  assert.deepEqual(OUTPUT_OWNERS.map((o) => o.id), ['sequencer', 'instrument', 'studio']);
  for (const o of OUTPUT_OWNERS) {
    assert.equal(typeof o.busy, 'function', `${o.id}.busy`);
    assert.equal(typeof o.stop, 'function', `${o.id}.stop`);
  }
});

test('C016: stopPlayback and outputBusy name the same owners (one table, nothing inline)', () => {
  for (const name of ['stopPlayback', 'outputBusy']) {
    const fn = topFunction(MAIN, name);
    assert.match(fn, /OUTPUT_OWNERS/, `${name} reads OUTPUT_OWNERS`);
    for (const inline of [/seqPlaying/, /\.editor\b/, /studioOwnsOutput/, /stopNow/,
      /studioStop/, /cmp\.playing/]) {
      assert.doesNotMatch(fn, inline, `${name} names no owner of its own (${inline})`);
    }
  }
});

test('C016: each owner is busy exactly while it sounds, and stopPlayback stops only those', () => {
  const each = [
    ['sequencer', (f) => { f.editor.playing = true; }],
    ['instrument', (f) => { f.cmp.playing = true; }],
    ['studio', (f) => f.setStudio(true)],
  ];
  for (const [id, start] of each) {
    const f = fakes();
    const o = ownersOf(f.labs);
    assert.equal(o.outputBusy(f.cmp), false, 'nothing sounding');
    start(f);
    assert.equal(o.outputBusy(f.cmp), true, `${id} sounding`);
    o.stopPlayback(f.cmp);
    assert.deepEqual(f.log, [id], `stopPlayback stops ${id} and nothing else`);
    assert.equal(o.outputBusy(f.cmp), false, `${id} stopped`);
  }
});

test('C016: the sequencer is read live, not through the 150 ms seqPlaying copy', () => {
  const f = fakes();
  const o = ownersOf(f.labs);
  f.editor.playing = true; // editor.play() has just scheduled; the poll has not run yet
  f.cmp.seqPlaying = false;
  assert.equal(o.outputBusy(f.cmp), true);
  o.stopPlayback(f.cmp);
  assert.deepEqual(f.log, ['sequencer']);
  // No sequencer lab: never busy, nothing to stop.
  const none = ownersOf({});
  assert.equal(none.outputBusy(f.cmp), false);
});

test('C016: MEASURE receives outputBusy and the setup check hands it to the preflight', () => {
  assert.match(MAIN, /createMeasureUi\(\{[^}]*\boutputBusy\b/, 'main.js passes outputBusy');
  const measure = read('src/js/ui/measure.js');
  const at = measure.indexOf('async function runPreflight(cmp)');
  assert.ok(at >= 0, 'measure.js runPreflight');
  const body = measure.slice(at, measure.indexOf('\n  }\n', at));
  assert.match(body, /me\.preflight\([^;]*otherAudio:\s*otherAudioNow\(cmp\)/,
    'runPreflight passes otherAudio from svc.outputBusy');
  assert.doesNotMatch(body, /stopPlayback/, 'the setup check stops nothing');
  assert.match(measure, /function otherAudioNow\(cmp\)\s*\{[^}]*svc\.outputBusy\(cmp\)/);
  const capture = read('src/js/measurement/capture.js');
  assert.match(capture, /otherAudio:\s*!!\(opts\s*&&\s*opts\.otherAudio\)\s*\|\|\s*voices > 0/,
    'the io reports the caller\'s fact OR-ed with the engine voices');
});

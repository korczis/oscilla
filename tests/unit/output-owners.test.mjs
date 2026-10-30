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

/**
 * OUTPUT_OWNERS, stopPlayback, outputBusy and (where main.js defines it, R-4) stopSequencer of
 * main.js, bound to the given `labs`.
 */
function ownersOf(labs) {
  const at = MAIN.indexOf('\nconst OUTPUT_OWNERS = ');
  assert.ok(at >= 0, 'main.js declares const OUTPUT_OWNERS');
  const end = MAIN.indexOf('\n]);\n', at);
  const table = MAIN.slice(at + 1, end + 5);
  const body = `${table}\n${topFunction(MAIN, 'stopPlayback')}\n${topFunction(MAIN, 'outputBusy')}`
    + (MAIN.includes('\nfunction stopSequencer(') ? `\n${topFunction(MAIN, 'stopSequencer')}`
      : '\nconst stopSequencer = undefined;')
    + '\nreturn { OUTPUT_OWNERS, stopPlayback, outputBusy, stopSequencer };';
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
  const names = ['stopPlayback', 'outputBusy'];
  if (MAIN.includes('\nfunction stopSequencer(')) names.push('stopSequencer'); // R-4, below
  for (const name of names) {
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
  assert.match(body, /me\.preflight\([^;]*otherAudio:\s*\(\)\s*=>\s*otherAudioNow\(cmp\)/,
    'runPreflight passes a probe of svc.outputBusy (behaviour: preflight-own-output.test.mjs)');
  assert.doesNotMatch(body, /stopPlayback/, 'the setup check stops nothing');
  assert.match(measure, /function otherAudioNow\(cmp\)\s*\{[^}]*svc\.outputBusy\(cmp\)/);
  // The capture io's OR of the caller's fact and the voices is checked by behaviour in
  // tests/unit/preflight-own-output.test.mjs (C016 review R-3).
});

test('C016 R-4: Escape and pagehide stop a sequence started under 150 ms ago', () => {
  const f = fakes();
  const o = ownersOf(f.labs);
  assert.equal(typeof o.stopSequencer, 'function', 'main.js defines stopSequencer(cmp)');
  f.editor.playing = true; // the 150 ms poll has not set seqPlaying yet
  f.cmp.seqPlaying = false;
  f.cmp.playing = true;
  o.stopSequencer(f.cmp);
  assert.deepEqual(f.log, ['sequencer'], 'the sequencer only, read live');
  o.stopSequencer(f.cmp);
  assert.deepEqual(f.log, ['sequencer'], 'nothing to stop once it is stopped');
  assert.equal(ownersOf({}).stopSequencer(f.cmp), undefined, 'no sequencer lab: no-op');
  assert.match(MAIN, /e\.key === 'Escape'\) \{\s*stopSequencer\(cmp\);/, 'Escape uses it');
  assert.match(MAIN, /const hide = \(\) => \{[^}]*stopSequencer\(cmp\);/, 'pagehide uses it');
});

// U144 (docs/reconstruction/05-accessibility-audit.md, problem 14): a place change announces
// only a change, once. After U133 an armed Synth said its leave sentence on every place change,
// and the same sentence written into the status bar's live region again changed nothing a
// screen reader hears. The playback bus (core/output-bus.js leave) now says the leave sentences
// only when what sounds changed since the last leave or a stop came between; Escape or the
// status-bar Stop that ended such a sound says STOP_SENTENCE once; and a sentence equal to the
// one the region holds is re-armed (core/live-region.js say: emptied, then filled in the next
// frame), the bus's one way into the region.
// The bus tests fail on the merge base: it wrote the sentence on every switch and said nothing
// on Escape.
//   node --test tests/unit/leave-announcement.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as bus from '../../src/js/ui/output-owner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUS_FILE = path.join(ROOT, 'src', 'js', 'core', 'output-bus.js');
const sentence = (owner) => bus.LEAVE_POLICY.find((r) => r.owner === owner).sentence;
const STOP = 'Přehrávání se zastavilo; nic nehraje.';

/** The one status announcer, imported late: the merge base has no core/live-region.js. */
async function liveRegion() {
  return import(pathToFileURL(path.join(ROOT, 'src', 'js', 'core', 'live-region.js')).href);
}

/**
 * A component with an armed Synth and nothing else sounding, whose live-region text records
 * every write (`writes`, '' included), on a bus whose next frame is under the test's control
 * (`frame()` runs what waits for it).
 */
function armedSynth(createBus = bus.createOutputBus) {
  const writes = [];
  const frames = [];
  let text = '';
  const cmp = {
    playing: false, notesSounding: false, micActive: false, synth: { armed: true },
    notify() {}, measureOwnsOutput: () => false, measureReferenceOwnsOutput: () => false,
    studioOwnsOutput: () => false, stopNow() {}, measureAbort() { return false; },
    midiAllOff() {},
    get announceText() { return text; },
    set announceText(v) { text = v; writes.push(v); },
  };
  const b = createBus({ app: () => cmp, sequencer: () => null, defer: (fn) => frames.push(fn) });
  const frame = () => { for (const fn of frames.splice(0)) fn(); };
  const said = () => writes.filter(Boolean);
  return { b, cmp, writes, said, frame };
}

/** Synth -> Analyzátor -> Studio -> Analyzátor with the same armed Synth: what was said. */
function threeSwitches({ b, said, frame }) {
  b.leave('synth', 'analyzer');
  frame();
  b.leave('analyzer', 'studio');
  frame();
  b.leave('studio', 'analyzer');
  frame();
  return said();
}

test('U144: two switches in a row with the same armed Synth announce once', async () => {
  const s = armedSynth();
  assert.deepEqual(threeSwitches(s), [sentence('synth')],
    'the leave sentence is said on the first switch only');
});

test('U144: a change of what sounds announces again, once per switch', async () => {
  const s = armedSynth();
  s.b.leave('synth', 'analyzer');
  s.cmp.notesSounding = true; // a key held: the notes sound too
  s.b.leave('analyzer', 'studio');
  s.b.leave('studio', 'filter'); // the same two: nothing new
  s.cmp.notesSounding = false; // the key let go: only the Synth again
  s.b.leave('filter', 'analyzer');
  assert.deepEqual(s.said(), [
    sentence('synth'),
    `${sentence('synth')} ${sentence('notes')}`,
    sentence('synth'),
  ]);
});

test('U144: Escape with the armed Synth says the stop once, and the next leave is news', async () => {
  const s = armedSynth();
  s.b.leave('synth', 'analyzer');
  s.b.stopAll('escape');
  s.cmp.synth.armed = false; // the Synth's own stop reaction (synthStopped) disarms
  s.b.stopAll('escape'); // nothing sounds any more: nothing to say
  s.frame();
  assert.deepEqual(s.said(), [sentence('synth'), STOP]);
  s.cmp.synth.armed = true; // armed again
  s.b.leave('analyzer', 'studio');
  s.frame();
  assert.deepEqual(s.said(), [sentence('synth'), STOP, sentence('synth')],
    'the same sentence after a different one is said again');
});

test('U144: a stopped tone is named by its own status announcement, a page hide by none', async () => {
  const s = armedSynth();
  s.cmp.playing = true; // the instrument's tone also sounds: main.js says "Playback STOPPED"
  s.b.stopAll('escape');
  s.cmp.playing = false;
  s.b.stopAll('pagehide');
  assert.deepEqual(s.said(), []);
});

test('U144: an identical sentence after a stop is re-armed: the region empties, then fills', async () => {
  const s = armedSynth();
  s.b.leave('synth', 'analyzer');
  s.b.stopAll('pagehide'); // a stop that says nothing: the region still holds the sentence
  s.b.leave('analyzer', 'studio');
  assert.deepEqual(s.writes, [sentence('synth'), ''], 'emptied in this event');
  s.frame();
  assert.deepEqual(s.writes, [sentence('synth'), '', sentence('synth')],
    'filled again in the next frame, so a screen reader speaks it');
});

test('U144: say() writes a new sentence at once and a newer write wins over a pending fill',
  async () => {
    const { say } = await liveRegion();
    const frames = [];
    const t = { announceText: '' };
    const defer = (fn) => frames.push(fn);
    assert.equal(say(t, '', { defer }), false);
    assert.equal(say(t, 'A', { defer }), true);
    assert.equal(t.announceText, 'A');
    assert.equal(frames.length, 0);
    say(t, 'A', { defer });
    assert.equal(t.announceText, '');
    t.announceText = 'B'; // another announcement before the frame
    for (const fn of frames.splice(0)) fn();
    assert.equal(t.announceText, 'B', 'the pending fill does not overwrite a newer sentence');
    say(t, 'C', { key: 'other', defer });
    assert.equal(t.other, 'C', 'the bound key is the caller\'s');
  });

test('U144: the bus writes the live region only through say()', () => {
  const src = readFileSync(BUS_FILE, 'utf8');
  assert.match(src, /^import \{ nextFrame, say \} from '\.\/live-region\.js';$/m);
  assert.deepEqual(src.match(/\.announceText\s*=/g), null, 'no direct write of the region');
});

// Mutation: the checks above see the two defects. A say() that writes the same sentence again
// never empties the region; a bus whose leave forgets what it said repeats the sentence.
test('U144 mutation: a write-again announcer and a leave without memory are caught', async () => {
  const regionWrites = (sayImpl) => {
    const log = [];
    let v = '';
    const t = { get announceText() { return v; }, set announceText(x) { v = x; log.push(x); } };
    const frames = [];
    sayImpl(t, 'A', { defer: (fn) => frames.push(fn) });
    sayImpl(t, 'A', { defer: (fn) => frames.push(fn) });
    for (const fn of frames.splice(0)) fn();
    return log;
  };
  const { say } = await liveRegion();
  assert.deepEqual(regionWrites(say), ['A', '', 'A']);
  assert.deepEqual(regionWrites((t, x) => { t.announceText = x; }), ['A', 'A'],
    'the mutant writes the same text twice, which a screen reader hears once');

  const src = readFileSync(BUS_FILE, 'utf8');
  const cut = 'if (met.length && key !== leaveSaid)';
  assert.ok(src.includes(cut), 'the leave says its sentences only on a change');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'u144-bus-'));
  try {
    const file = path.join(dir, 'output-bus.js');
    writeFileSync(file, src.replace(cut, 'if (met.length)'));
    copyFileSync(path.join(ROOT, 'src', 'js', 'core', 'live-region.js'),
      path.join(dir, 'live-region.js'));
    const mutant = await import(pathToFileURL(file).href);
    const s = armedSynth(mutant.createOutputBus);
    assert.equal(threeSwitches(s).length, 3, 'the mutant says the sentence on every switch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

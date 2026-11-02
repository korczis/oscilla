// C001: the status-bar transport key (workbench statusPlay) stops whenever something sounds and
// then starts nothing. It reads the sequencer's live state (the editor, through
// svc.sequencerPlaying) rather than the 150 ms `seqPlaying` copy, and it stops through the one
// stop authority main.js hands it (svc.stopPlayback), never by a path of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbench } from '../../src/js/ui/workbench.js';

// The workbench members over a fake instrument and a fake sequencer editor. The fake
// stopPlayback does what main.js's does for these two sources: stop the sequence when its
// editor plays (and clear the copy), stop the instrument when it plays.
function rig({ editorPlaying = false, seqPlaying = false, playing = false,
  continuousAllowed = false, isProgrammed = false } = {}) {
  const calls = { stopPlayback: 0, editorStop: 0, stopNow: 0, trigger: 0, toggleLatch: 0 };
  const editor = {
    playing: editorPlaying,
    stop() { calls.editorStop += 1; const was = this.playing; this.playing = false; return was; },
  };
  const labs = { sequencer: { editor } };
  const sequencerPlaying = () => !!(labs.sequencer && labs.sequencer.editor.playing);
  let wb = null;
  const svc = {
    labs,
    sequencerPlaying,
    stopPlayback(cmp) {
      calls.stopPlayback += 1;
      assert.equal(cmp, wb, 'stopPlayback is handed the component');
      if (sequencerPlaying()) { labs.sequencer.editor.stop(); cmp.seqPlaying = false; }
      if (cmp.playing) cmp.stopNow();
    },
  };
  wb = createWorkbench(svc);
  Object.assign(wb, {
    seqPlaying, playing, continuousAllowed, isProgrammed,
    stopNow() { calls.stopNow += 1; this.playing = false; },
    trigger() { calls.trigger += 1; this.playing = true; },
    toggleLatch() { calls.toggleLatch += 1; this.playing = true; },
  });
  return { wb, editor, calls };
}

const started = (calls) => calls.trigger + calls.toggleLatch;

test('statusPlay: a sequence started inside the poll window is stopped and nothing starts', () => {
  // editor.play() ran, the 150 ms copy has not caught up: the key must still stop it.
  const { wb, editor, calls } = rig({ editorPlaying: true, seqPlaying: false });
  wb.statusPlay();
  assert.equal(editor.playing, false, 'the sequencer stopped');
  assert.equal(calls.stopPlayback, 1, 'through the one stop authority');
  assert.equal(started(calls), 0, 'no instrument voice starts under the stop');
  assert.equal(wb.playing, false);
  assert.equal(wb.seqPlaying, false);
});

test('statusPlay: while only the sequence plays ("Stop playback") it stops, starts nothing', () => {
  const { wb, editor, calls } = rig({ editorPlaying: true, seqPlaying: true });
  assert.equal(wb.isSounding, true, 'the key reads Stop playback');
  wb.statusPlay();
  assert.equal(editor.playing, false);
  assert.equal(started(calls), 0, 'a stop never triggers or latches the instrument');
  assert.equal(wb.seqPlaying, false, 'the copy is cleared at the stop, not on the next poll');
  assert.equal(wb.isSounding, false, 'the key reads Play again at once');
});

test('statusPlay: a press while the label still reads Stop (stale copy) starts nothing', () => {
  // The sequence ended on its own a moment ago; the copy still says playing, so does the label.
  const { wb, calls } = rig({ editorPlaying: false, seqPlaying: true });
  wb.statusPlay();
  assert.equal(calls.stopPlayback, 1);
  assert.equal(started(calls), 0);
});

test('statusPlay: the playing instrument is stopped through stopPlayback and not restarted', () => {
  const { wb, calls } = rig({ playing: true, continuousAllowed: true });
  wb.statusPlay();
  assert.equal(calls.stopPlayback, 1);
  assert.equal(calls.stopNow, 1);
  assert.equal(started(calls), 0, 'a stop never arms the latch');
  assert.equal(wb.playing, false);
});

test('statusPlay: nothing sounding starts the instrument (trigger, or latch if continuous)', () => {
  const a = rig();
  a.wb.statusPlay();
  assert.deepEqual([a.calls.stopPlayback, a.calls.trigger, a.calls.toggleLatch], [0, 1, 0]);
  const b = rig({ continuousAllowed: true });
  b.wb.statusPlay();
  assert.deepEqual([b.calls.stopPlayback, b.calls.trigger, b.calls.toggleLatch], [0, 0, 1]);
  const c = rig({ continuousAllowed: true, isProgrammed: true });
  c.wb.statusPlay();
  assert.deepEqual([c.calls.stopPlayback, c.calls.trigger, c.calls.toggleLatch], [0, 1, 0]);
});

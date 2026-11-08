// 98 R1 (P2, a regression from 68ad36a5): a microphone capture cancelled while its permission
// prompt is unanswered settles at once. Before the fix capture.js ensureInput waited for
// getUserMedia even after cancel(), so a level-reference capture closed during the prompt
// could not settle captureNoise, ctx.refCapture stayed set (ui/measure/calibration.js clears
// it in its finally) and every output owner was refused until the prompt was answered. The
// prompt may still answer later: a stream it grants then is closed at once, a refusal is
// swallowed, and the page's audio session is put back exactly once either way.
//
// Each wait is a condition poll with a wall-clock deadline (fixtures/capture-rig.mjs `until`);
// "settles at once" is a race against a named deadline the unanswered prompt cannot meet.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CAPTURE_AUDIO_SESSION as PAR } from '../../src/js/measurement/capture.js';
import { MEASUREMENT_STATES as S } from '../../src/js/measurement/state-machine.js';
import { createCalibration } from '../../src/js/ui/measure/calibration.js';
import { audioSession, rig, settle, until } from './fixtures/capture-rig.mjs';

const ONCE = [PAR, 'playback'];
const ORDERS = ['granted', 'refused'];

/** Settles `p`, or fails naming `what` after `ms` of wall clock (the prompt stays open). */
const SETTLE_DEADLINE_MS = 2000;
async function within(p, what, ms = SETTLE_DEADLINE_MS) {
  let timer = null;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ late: true }), ms);
  });
  const res = await Promise.race([settle(p), late]);
  clearTimeout(timer);
  assert.ok(!res.late, `${what} within ${ms} ms of wall clock, the prompt unanswered`);
  return res;
}

/** A rig whose getUserMedia is a prompt nobody has answered: `prompt.answer(outcome)`. */
function promptRig() {
  const s = audioSession();
  const prompt = { asked: false, answer: null };
  const r = rig({ session: s, gum: (stream) => new Promise((ok, no) => {
    prompt.asked = true;
    prompt.answer = (outcome) => (outcome === 'granted' ? ok(stream)
      : no(Object.assign(new Error('no'), { name: 'NotAllowedError' })));
  }) });
  return { s, r, prompt };
}

test('R1: cancel() while the prompt is open settles captureNoise at once', async () => {
  for (const outcome of ORDERS) {
    const { s, r, prompt } = promptRig();
    const p = r.io.captureNoise(1);
    await until(() => prompt.asked, `${outcome}: getUserMedia asked`);
    r.io.cancel();
    const res = await within(p, `${outcome}: captureNoise settles after cancel()`);
    assert.equal(res.ok, false, `${outcome}: the cancelled capture does not resolve`);
    assert.equal(res.e && res.e.code, 'ABORTED', `${outcome}: it rejects ABORTED`);
    assert.equal(r.track.readyState, 'live', `${outcome}: no stream exists before the answer`);
    // The prompt answers after the capture settled.
    prompt.answer(outcome);
    await until(() => s.sets.length >= 2, `${outcome}: the session put back`);
    assert.deepEqual(s.sets, ONCE, `${outcome}: the session is put back exactly once`);
    if (outcome === 'granted') {
      assert.equal(r.track.readyState, 'ended', 'a stream granted after cancel() is closed');
    }
    assert.equal(r.engine.nodes.size, 0, `${outcome}: the io owns no node`);
    r.io.dispose();
    assert.deepEqual(s.sets, ONCE, `${outcome}: dispose does not put it back again`);
  }
});

test('R1: after a cancel during the prompt the next capture opens its own input', async () => {
  const { s, r, prompt } = promptRig();
  const first = r.io.captureNoise(1);
  await until(() => prompt.asked, 'getUserMedia asked');
  const stale = prompt.answer;
  prompt.asked = false;
  r.io.cancel();
  await within(first, 'the first capture settles');
  // A second capture while the first prompt is still unanswered asks again; granting it runs.
  const second = settle(r.drive(r.io.captureNoise(0.1)));
  await until(() => prompt.asked, 'getUserMedia asked again');
  prompt.answer('granted');
  const res = await second;
  assert.equal(res.ok, true, `the second capture completes: ${res.e && res.e.message}`);
  assert.equal(r.ctl.gumCalls, 2, 'the second capture did not wait on the first prompt');
  r.io.cancel();
  stale('refused'); // the first prompt answers last: swallowed, nothing reopened
  await until(() => s.sets.length >= 2, 'the session put back');
  r.io.dispose();
  assert.equal(r.engine.nodes.size, 0, 'the io owns no node');
});

test('R1: a reference capture closed during the prompt releases the output refusal',
  async () => {
    for (const outcome of ORDERS) {
      const { s, r, prompt } = promptRig();
      const ctx = { refCapture: null, reference: null, io: r.io, ioKind: 'microphone',
        me: { state: S.IDLE, reset() {} } };
      const stops = [];
      const svc = { engine: r.engine, stopPlayback: () => stops.push('stop') };
      const ops = { stopLive() {}, ensureEngine() {}, refresh() {}, nameInput() {},
        inputOpened() {} };
      const cal = createCalibration(ctx, svc, ops);
      const cmp = { meas: { levelForm: { referenceHz: 1000, capturing: false, error: '',
        reading: null } } };
      // The refusal member 1 derives (measureReferenceOwnsOutput): a reference capture runs.
      const refused = () => !!ctx.refCapture;
      const play = () => (refused() ? 'stop the capture before playing' : 'plays');
      const p = cal.captureReference(cmp);
      await until(() => prompt.asked, `${outcome}: getUserMedia asked`);
      assert.equal(play(), 'stop the capture before playing', `${outcome}: refused meanwhile`);
      assert.equal(cal.abortReference(), true, `${outcome}: the reference capture is aborted`);
      const res = await within(p, `${outcome}: captureReference settles after abortReference`);
      assert.deepEqual(res, { ok: true, v: false }, `${outcome}: nothing is stored`);
      assert.equal(ctx.refCapture, null, `${outcome}: the refusal is released`);
      assert.equal(cmp.meas.levelForm.capturing, false, `${outcome}: not capturing`);
      assert.match(cmp.meas.levelForm.error, /stopped; nothing was stored/, outcome);
      assert.equal(play(), 'plays', `${outcome}: play plays with the prompt still open`);
      prompt.answer(outcome);
      await until(() => s.sets.length >= 2, `${outcome}: the session put back`);
      assert.deepEqual(s.sets, ONCE, outcome);
      if (outcome === 'granted') {
        assert.equal(r.track.readyState, 'ended', 'the late stream is closed on the answer');
      }
      assert.equal(ctx.refCapture, null, `${outcome}: the late answer claims nothing`);
      assert.equal(ctx.reference, null, `${outcome}: the late answer stores nothing`);
      r.io.dispose();
    }
  });

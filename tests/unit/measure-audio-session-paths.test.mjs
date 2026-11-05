// C033 review (98, CHANGES REQUESTED on 5fdf8d13, F2-F5): every path that opens or closes the
// microphone input holds the page's audio session at `play-and-record` exactly while the input
// is open, and puts `playback` back exactly once when it closes, whoever closes it: the run's
// normal end, the user's abort, a context closed, suspended or interrupted, pagehide, a hidden
// document, dispose, the capture watchdog, an abort or a pagehide while the permission prompt
// is open (the prompt then granted or refused), the track ending, a failure after
// getUserMedia answered, and a restore the browser refuses. Two capture ios share one session:
// the last to close puts it back (F3). A setup check level is the mean over the frames the
// input delivered, not the zeros a lost block leaves (F5).
//
// Adopted from 98's probe tests (rb4-probe/paths.test.mjs). Each point in a run is named by a
// condition the drive polls (the run's source started, getUserMedia asked), never by a count
// of ticks; every wait has a wall-clock deadline (fixtures/capture-rig.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMeasurementEngine } from '../../src/js/measurement/engine.js';
import { captureAudioSession, CAPTURE_AUDIO_SESSION as PAR }
  from '../../src/js/measurement/capture.js';
import { audioSession, rig, settle, until, RECIPE } from './fixtures/capture-rig.mjs';

const ONCE = [PAR, 'playback'];
const running = (r) => () => r.started.length > 0; // the run's sweep is scheduled

/** measure() with `poke` called once the run's sweep is scheduled. */
async function interruptedRun(opts, poke) {
  const s = audioSession();
  const r = rig({ session: s, ...opts });
  const me = createMeasurementEngine({ io: r.io });
  const res = await settle(r.drive(me.measure(RECIPE),
    { at: running(r), poke: () => poke(r, me) }));
  return { s, r, me, res };
}

// ------------------------------------------------------------------ a run that ends

test('C033 paths: a run that completes puts playback back exactly once', async () => {
  const s = audioSession();
  const r = rig({ session: s });
  const me = createMeasurementEngine({ io: r.io });
  const res = await settle(r.drive(me.measure(RECIPE)));
  assert.ok(res.ok, res.e && res.e.message);
  // The stub's flat input makes no valid response; INVALID is the run's normal end all the same.
  assert.ok(['COMPLETE', 'INVALID'].includes(me.state), me.state);
  assert.equal(r.seen.sessionAtOpen, PAR, 'the input was asked for in play-and-record');
  assert.equal(s.type, 'playback');
  assert.deepEqual(s.sets, ONCE);
  me.dispose();
  assert.deepEqual(s.sets, ONCE, 'dispose after the end sets nothing again');
});

test('C033 paths: the user\'s abort mid-run puts playback back', async () => {
  const { s, me, res, r } = await interruptedRun({}, (_, m) => m.abort('user'));
  assert.equal(res.ok, false);
  assert.equal(me.state, 'ABORTED');
  assert.deepEqual(s.sets, ONCE);
  assert.equal(r.track.readyState, 'ended', 'the input is closed');
  me.dispose();
  assert.deepEqual(s.sets, ONCE);
});

test('C033 paths: a context closed, suspended or interrupted mid-run puts playback back',
  async () => {
    for (const detail of ['closed', 'suspended', 'interrupted']) {
      const { s, me, res } = await interruptedRun({},
        (r) => r.listeners.engine.forEach((f) => f('context', detail)));
      assert.equal(res.ok, false, detail);
      assert.equal(me.state, 'ERROR', `${detail}: ${me.state}`);
      assert.deepEqual(s.sets, ONCE, detail);
      me.dispose();
      assert.deepEqual(s.sets, ONCE, detail);
    }
  });

test('C033 paths: pagehide mid-run puts playback back', async () => {
  const { s, me, res } = await interruptedRun({}, (r) => r.listeners.win.pagehide());
  assert.equal(res.ok, false);
  assert.equal(me.state, 'ABORTED');
  assert.deepEqual(s.sets, ONCE);
  me.dispose();
});

test('C033 paths: a hidden document mid-run puts playback back', async () => {
  const { s, me, res } = await interruptedRun({ abortOnHidden: true }, (r) => {
    r.env.document.hidden = true;
    r.listeners.doc.visibilitychange();
  });
  assert.equal(res.ok, false);
  assert.equal(me.state, 'ABORTED');
  assert.deepEqual(s.sets, ONCE);
  me.dispose();
});

test('C033 paths: dispose in READY and mid-run puts playback back', async () => {
  const s = audioSession();
  const r = rig({ session: s });
  const me = createMeasurementEngine({ io: r.io });
  await r.drive(me.preflight(RECIPE));
  assert.equal(me.state, 'READY');
  assert.equal(s.type, PAR, 'held while the checked input stays open (READY)');
  me.dispose();
  assert.deepEqual(s.sets, ONCE);

  const { s: s2 } = await interruptedRun({}, (_, m) => m.dispose());
  assert.deepEqual(s2.sets, ONCE);
});

test('C033 paths: the capture watchdog puts playback back', async () => {
  // The input stops delivering once the sweep is scheduled while the audio clock runs on; the
  // watchdog's delays are shortened so that it judges the stall within the drive's deadline.
  const { s, me, res } = await interruptedRun({ timeout: (ms) => Math.min(ms, 20) },
    (r) => { r.ctl.stall = true; });
  assert.equal(res.ok, false);
  assert.equal(res.e && res.e.code, 'CAPTURE_TIMEOUT', res.e && res.e.message);
  assert.deepEqual(s.sets, ONCE);
  me.dispose();
  assert.deepEqual(s.sets, ONCE);
});

test('C033 paths: the track ending in READY puts playback back', async () => {
  const s = audioSession();
  const r = rig({ session: s });
  const me = createMeasurementEngine({ io: r.io });
  await r.drive(me.preflight(RECIPE));
  assert.equal(s.type, PAR);
  r.track.onended();
  assert.deepEqual(s.sets, ONCE);
  me.dispose();
  assert.deepEqual(s.sets, ONCE);
});

// ------------------------------------------------------------------ opening the input

test('C033 paths: a refused input puts playback back exactly once', async () => {
  const s = audioSession();
  const denied = Object.assign(new Error('no'), { name: 'NotAllowedError' });
  const r = rig({ session: s, refuse: denied });
  const me = createMeasurementEngine({ io: r.io });
  const rep = await r.drive(me.preflight(RECIPE));
  assert.deepEqual(rep.blockers.map((b) => b.code), ['MIC_DENIED']);
  assert.deepEqual(s.sets, ONCE);
  me.dispose();
  assert.deepEqual(s.sets, ONCE);
});

test('C033 paths: a failure after getUserMedia answered puts playback back', async () => {
  // A stream without an audio track: the io refuses it after the session was switched.
  const s = audioSession();
  const r = rig({ session: s });
  r.stream.getAudioTracks = () => [];
  const me = createMeasurementEngine({ io: r.io });
  const rep = await r.drive(me.preflight(RECIPE));
  assert.deepEqual(rep.blockers.map((b) => b.code), ['NO_INPUT']);
  assert.deepEqual(s.sets, ONCE);
  me.dispose();
  assert.deepEqual(s.sets, ONCE);
});

test('C033 paths: an abort while the permission prompt is open, then granted or refused',
  async () => {
    for (const outcome of ['granted', 'refused']) {
      const s = audioSession();
      let answer = null;
      const r = rig({ session: s, gum: (stream) => new Promise((ok, no) => {
        answer = () => (outcome === 'granted' ? ok(stream)
          : no(Object.assign(new Error('no'), { name: 'NotAllowedError' })));
      }) });
      const me = createMeasurementEngine({ io: r.io });
      const p = settle(me.preflight(RECIPE));
      await until(() => answer !== null, `${outcome}: getUserMedia asked`);
      assert.equal(s.type, PAR, `${outcome}: switched before the prompt`);
      me.abort('user');
      answer();
      await p;
      await until(() => s.sets.length >= 2, `${outcome}: the session put back`);
      assert.deepEqual(s.sets, ONCE, outcome);
      assert.equal(r.track.readyState, outcome === 'granted' ? 'ended' : 'live',
        `${outcome}: a stream granted after the abort is closed at once`);
      me.dispose();
      assert.deepEqual(s.sets, ONCE, outcome);
    }
  });

test('C033 paths: pagehide while the permission prompt is open closes the late input (F4)',
  async () => {
    const s = audioSession();
    let answer = null;
    const r = rig({ session: s, gum: (stream) => new Promise((ok) => {
      answer = () => ok(stream);
    }) });
    const me = createMeasurementEngine({ io: r.io });
    const p = settle(r.drive(me.preflight(RECIPE)));
    await until(() => answer !== null, 'getUserMedia asked');
    r.listeners.win.pagehide();
    answer();
    const res = await p;
    assert.equal(res.ok, false, `the check does not finish READY: ${me.state}`);
    assert.equal(r.track.readyState, 'ended', 'the input granted after the page left is closed');
    assert.deepEqual(s.sets, ONCE);
    me.dispose();
    assert.deepEqual(s.sets, ONCE);
  });

// ------------------------------------------------------------------ the restore itself

test('C033 paths: a restore the browser refuses is swallowed and attempted once', async () => {
  const s = audioSession('playback', { refuse: (v) => v === 'playback' });
  const r = rig({ session: s });
  const me = createMeasurementEngine({ io: r.io });
  await r.drive(me.preflight(RECIPE));
  assert.doesNotThrow(() => me.reset());
  me.dispose();
  assert.deepEqual(s.sets, ONCE);
  // Directly, and on the refused-input path, whose real reason must survive the refusal.
  const t = audioSession('playback', { refuse: (v) => v === 'playback' });
  assert.doesNotThrow(captureAudioSession({ audioSession: t }));
  const u = audioSession('playback', { refuse: (v) => v === 'playback' });
  const denied = Object.assign(new Error('no'), { name: 'NotAllowedError' });
  const r2 = rig({ session: u, refuse: denied });
  const me2 = createMeasurementEngine({ io: r2.io });
  const rep = await r2.drive(me2.preflight(RECIPE));
  assert.deepEqual(rep.blockers.map((b) => b.code), ['MIC_DENIED']);
  me2.dispose();
});

test('C033 paths: restore is idempotent and puts back only its own type', () => {
  const s = audioSession();
  const a = captureAudioSession({ audioSession: s });
  const b = captureAudioSession({ audioSession: s });
  a();
  a();
  assert.equal(s.type, PAR, 'a second restore by one holder does not release another\'s');
  b();
  assert.deepEqual(s.sets, ONCE);
  b();
  assert.deepEqual(s.sets, ONCE, 'nor sets anything once released');

  const other = audioSession();
  const restore = captureAudioSession({ audioSession: other });
  other.type = 'auto'; // the page (or the browser) chose another type meanwhile
  restore();
  assert.equal(other.type, 'auto', 'a type someone else set is theirs');
  assert.deepEqual(other.sets, [PAR, 'auto']);
});

test('C033 paths: two capture ios share one session; the last to close puts it back (F3)',
  async () => {
    const s = audioSession();
    const a = rig({ session: s });
    const b = rig({ session: s });
    const ma = createMeasurementEngine({ io: a.io });
    const mb = createMeasurementEngine({ io: b.io });
    await a.drive(ma.preflight(RECIPE));
    await b.drive(mb.preflight(RECIPE));
    assert.equal(ma.state, 'READY');
    assert.equal(mb.state, 'READY');
    assert.equal(b.seen.sessionAtOpen, PAR);
    ma.reset();
    assert.equal(s.type, PAR, 'B still holds its input open');
    mb.reset();
    assert.equal(s.type, 'playback');
    assert.deepEqual(s.sets, ONCE);
    ma.dispose();
    mb.dispose();
    assert.deepEqual(s.sets, ONCE);
  });

// ------------------------------------------------------------------ the level of a window (F5)

test('C033 paths: a check level is the mean over the frames received, not lost blocks (F5)',
  async () => {
    const r = rig({ background: 0.01, heard: 0.1 });
    r.ctl.drop = (n) => n % 3 === 1; // every third block is lost
    const me = createMeasurementEngine({ io: r.io });
    const rep = await r.drive(me.preflight(RECIPE));
    const want = 20 * Math.log10(0.01);
    assert.ok(Math.abs(rep.facts.inputLevel.rmsDb - want) < 0.01,
      `background ${rep.facts.inputLevel.rmsDb} dB, the input rendered ${want} dB`);
    const f = rep.facts.probe.frames;
    assert.ok(f.received < f.expected && f.discontinuities > 0, JSON.stringify(f));
    me.dispose();
  });

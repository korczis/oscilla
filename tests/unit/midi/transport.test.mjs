// V508: a controller's transport and clock (src/js/midi/transport.js, src/js/midi/ui.js).
//
// What it proves:
//   - transportAction: realtime Start, Continue and Stop from any port; the DAW port's Mackie
//     Control Play, Stop, Rewind and Cycle (a Note On with velocity > 0) and nothing for Record,
//     Fast forward, a release or the same note on a play port;
//   - transportTarget: the Sequencer's own transport in the Sequencer, the Studio's elsewhere;
//   - the clock meter: BPM over the last whole beat (24 ticks), null before it and after a gap;
//   - midi/ui.js midiTransport on stand-in transports: Start plays from the start, Continue
//     plays on, Stop stops (keeping the keys' armed run), Rewind, Cycle; nothing when there is
//     nothing to do; the monitor row says what the message did; the clock's tempo is published
//     and cleared after the clock stops.
//   node --test tests/unit/midi/transport.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { MCU_BUTTONS, CLOCK_GAP_MS, CLOCK_PPQ, createClockMeter, transportAction,
  transportTarget } from '../../../src/js/midi/transport.js';
import { decodeMidi } from '../../../src/js/midi/message.js';
import { createMidiUi, CLOCK_SHOW_MS } from '../../../src/js/midi/ui.js';
import { MONITOR_FLUSH_MS } from '../../../src/js/midi/monitor.js';

test('transportAction: realtime from any port, Mackie Control buttons from the DAW port', () => {
  const at = (bytes, role) => transportAction(decodeMidi(bytes), role);
  assert.equal(at([0xfa], 'play'), 'start');
  assert.equal(at([0xfb], 'daw'), 'continue');
  assert.equal(at([0xfc], 'editor'), 'stop');
  assert.equal(at([0x90, 94, 127], 'daw'), 'start');
  assert.equal(at([0x90, 93, 127], 'daw'), 'stop');
  assert.equal(at([0x90, 91, 127], 'daw'), 'rewind');
  assert.equal(at([0x90, 86, 127], 'daw'), 'loop');
  assert.equal(at([0x90, 95, 127], 'daw'), null, 'Record acts on nothing');
  assert.equal(at([0x90, 92, 127], 'daw'), null, 'Fast forward acts on nothing');
  assert.equal(at([0x90, 94, 0], 'daw'), null, 'a release is no press');
  assert.equal(at([0x80, 94, 0], 'daw'), null);
  assert.equal(at([0x90, 94, 127], 'play'), null, 'note 94 on a play port is a note');
  assert.equal(at([0xf8], 'play'), null, 'the clock is measured, not an action');
  assert.equal(transportAction(null, 'daw'), null);
  assert.deepEqual(Object.keys(MCU_BUTTONS).map(Number).sort(), [86, 91, 93, 94]);
});

test('transportTarget: the Sequencer\'s own transport there, the Studio\'s elsewhere', () => {
  assert.equal(transportTarget('sequencer'), 'sequencer');
  for (const ws of ['playground', 'studio', 'synth', 'measure', 'about']) {
    assert.equal(transportTarget(ws), 'studio', ws);
  }
});

test('the clock meter reads BPM over the last whole beat, null before it and after a gap', () => {
  const c = createClockMeter();
  const beat = 500; // 120 BPM
  for (let i = 0; i < CLOCK_PPQ; i += 1) c.tick(i * beat / CLOCK_PPQ);
  assert.equal(c.bpm(beat), null, 'not a whole beat yet (24 ticks, 23 intervals)');
  c.tick(beat);
  assert.equal(c.bpm(beat), 120);
  for (let i = 1; i <= CLOCK_PPQ; i += 1) c.tick(beat + i * (60000 / 93.7) / CLOCK_PPQ);
  assert.equal(c.bpm(beat + 60000 / 93.7), 93.7, 'follows a new tempo within one beat');
  assert.equal(c.bpm(beat + 60000 / 93.7 + CLOCK_GAP_MS + 1), null, 'the clock stopped');
  c.tick(5000);
  assert.equal(c.bpm(5000), null, 'a tick after a gap starts again');
  c.reset();
  assert.equal(c.bpm(0), null);
});

function rig({ workspace = 'playground' } = {}) {
  const calls = [];
  let seqPlaying = false;
  const seq = { play: () => { calls.push('seq.play'); seqPlaying = true; return true; },
    stop: () => { calls.push('seq.stop'); seqPlaying = false; return true; },
    loop: () => { calls.push('seq.loop'); return true; }, playing: () => seqPlaying };
  const ui = createMidiUi({ win: { navigator: {}, addEventListener() {} },
    sequencerTransport: seq });
  Object.assign(ui, { workspace, studio: { playing: false, armed: false },
    studioPlay() { calls.push('studio.play'); this.studio.playing = true; return true; },
    studioStop(o) { calls.push(`studio.stop${o && o.keepArmed ? ':keepArmed' : ''}`);
      this.studio.playing = false; },
    studioReturn() { calls.push('studio.return'); },
    studioToggleLoop() { calls.push('studio.loop'); } });
  return { ui, calls };
}

test('midiTransport drives the Studio\'s transport outside the Sequencer', () => {
  const { ui, calls } = rig();
  assert.deepEqual(ui.midiTransport('start'), { target: 'studio' });
  assert.deepEqual(calls, ['studio.return', 'studio.play'], 'Start plays from the start');
  calls.length = 0;
  ui.midiTransport('start');
  assert.deepEqual(calls, ['studio.return'], 'Start while playing returns to the start');
  calls.length = 0;
  assert.equal(ui.midiTransport('continue'), null, 'Continue while playing does nothing');
  ui.midiTransport('stop');
  assert.deepEqual(calls, ['studio.stop:keepArmed'], 'Stop keeps the keys\' armed run');
  calls.length = 0;
  assert.equal(ui.midiTransport('stop'), null, 'Stop when stopped does nothing');
  ui.midiTransport('continue');
  ui.midiTransport('rewind');
  ui.midiTransport('loop');
  assert.deepEqual(calls, ['studio.play', 'studio.return', 'studio.loop']);
});

test('C3-555-1: a refused Start or Continue moves nothing and says nothing', () => {
  const { ui, calls } = rig();
  ui.measureOwnsOutput = () => true; // a measurement holds the output
  assert.equal(ui.midiTransport('start'), null);
  assert.equal(ui.midiTransport('continue'), null);
  assert.deepEqual(calls, [], 'no rewind, no play');
  ui.measureOwnsOutput = () => false;
  ui.studioPlay = function refuse() { calls.push('studio.play:refused'); return false; };
  assert.equal(ui.midiTransport('continue'), null, 'the transport refused: nothing is said');
  assert.deepEqual(calls, ['studio.play:refused']);
});

test('midiTransport drives the Sequencer\'s own transport in the Sequencer', () => {
  const { ui, calls } = rig({ workspace: 'sequencer' });
  assert.deepEqual(ui.midiTransport('start'), { target: 'sequencer' });
  assert.equal(ui.midiTransport('continue'), null, 'already playing');
  ui.midiTransport('loop');
  ui.midiTransport('stop');
  assert.equal(ui.midiTransport('rewind'), null, 'the Sequencer has no locate');
  assert.deepEqual(calls, ['seq.play', 'seq.loop', 'seq.stop']);
});

test('a DAW port\'s Play button starts the Studio, the monitor says so; the clock is shown',
  async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const ports = new Map();
    const port = (name) => {
      const ls = new Set();
      const p = { name, state: 'connected', type: 'input', open: () => Promise.resolve(),
        addEventListener: (k, fn) => { if (k === 'midimessage') ls.add(fn); },
        removeEventListener: (k, fn) => ls.delete(fn),
        send: (b) => { for (const fn of ls) fn({ data: Uint8Array.from(b) }); } };
      ports.set(name, p);
      return p;
    };
    ['KeyLab mkII 61 DAW', 'Arturia BeatStep Pro Arturia BeatStepPro'].forEach(port);
    const access = { inputs: { forEach: (fn) => ports.forEach((p) => fn(p)) },
      addEventListener() {}, removeEventListener() {} };
    const win = { navigator: { requestMIDIAccess: () => Promise.resolve(access),
      permissions: { query: () => Promise.resolve({ state: 'granted', addEventListener() {} }) } },
    isSecureContext: true, location: { protocol: 'https:', host: 'x' }, addEventListener() {} };
    const engine = { noteOn: () => ({ ok: true }), noteOff: () => true, notesOff: () => 0 };
    const calls = [];
    const ui = createMidiUi({ win, engine, now: () => Date.now() });
    Object.assign(ui, { workspace: 'synth', notify() {}, studio: { playing: false },
      studioPlay() { calls.push('play'); this.studio.playing = true; return true; },
      studioStop() { calls.push('stop'); this.studio.playing = false; },
      studioReturn() { calls.push('return'); }, studioToggleLoop() {} });
    await ui.midiInit();
    ui.midiConnect();
    await t.mock.timers.runAll();
    await new Promise((r) => setImmediate(r));
    ports.get('KeyLab mkII 61 DAW').send([0x90, 94, 127]);
    assert.deepEqual(calls, ['return', 'play']);
    assert.match(ui.midiLog[0].text, / → Studio: přehrát od začátku$/);
    ports.get('Arturia BeatStep Pro Arturia BeatStepPro').send([0xfc]);
    assert.deepEqual(calls, ['return', 'play', 'stop'], 'a realtime Stop from the play port');
    t.mock.timers.tick(MONITOR_FLUSH_MS); // the monitor redraws at most this often
    assert.match(ui.midiLog[0].text, /^Zastavení → Studio: zastavit$/);
    // A clock at 125 BPM: shown once a beat has arrived, cleared after it stops.
    const step = 60000 / 125 / 24;
    for (let i = 0; i < 25; i += 1) {
      ports.get('Arturia BeatStep Pro Arturia BeatStepPro').send([0xf8]);
      t.mock.timers.tick(step);
    }
    assert.equal(ui.midiClockBpm, '125.0', 'the clock\'s tempo is shown once a beat arrived');
    assert.ok(CLOCK_SHOW_MS > 0);
    assert.equal(ui.midiLog.some((r) => r.kind === 'clock'), false, 'clock ticks are not listed');
    t.mock.timers.tick(CLOCK_GAP_MS + 1);
    assert.equal(ui.midiClockBpm, null, 'cleared once the clock stops');
  });

// K184 (project.a-phone-sounds): a tap whose press and release are handled in the same task
// opened and closed its gate at the same audio time and was silent. Every note path now defers
// an ordinary note-off to its on plus MIN_GATE_S (src/js/audio/gate.js); a longer note is
// unchanged, a forced stop (Escape, all-off) is never deferred, and the constant is defined
// once and imported by every path.
//
//   node --test tests/unit/min-gate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createLiveNotes } from '../../src/js/studio/live-notes.js';
import { ESCAPE_RELEASE_S } from '../../src/js/audio/scheduler.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gate = await import('../../src/js/audio/gate.js').catch(() => ({}));
const NOTE = { freq: 440, level: 1, wave: 'sine', attackS: 0.005, releaseS: 0.05, limitS: 2,
  continuous: false, held: true };

test('one constant: MIN_GATE_S and gateCloseAt', () => {
  assert.equal(gate.MIN_GATE_S, 0.03);
  assert.equal(gate.gateCloseAt(1, 1), 1.03, 'an off at its on waits the minimum');
  assert.equal(gate.gateCloseAt(1, 0.5), 1.03, 'an off before its on too');
  assert.equal(gate.gateCloseAt(1, 2), 2, 'a longer note is unchanged');
  assert.equal(gate.gateCloseAt(undefined, 2), 2, 'an off with no known on is unchanged');
});

test('the engine: a note released in the task it began still sounds the minimum', () => {
  const fake = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fake.env });
  const res = engine.noteOn('k:0:69', NOTE);
  assert.equal(res.ok, true);
  engine.noteOff('k:0:69'); // the same task: no audio time has passed
  const osc = fake.ctx.oscillators[0];
  assert.ok(osc.stopAt >= res.start + gate.MIN_GATE_S,
    `stopped at ${osc.stopAt}, began at ${res.start}`);
  fake.advance(1);
  assert.equal(engine.noteCount, 0, 'and frees');
  const res2 = engine.noteOn('k:0:70', NOTE);
  fake.advance(0.5);
  const t = fake.ctx.currentTime;
  engine.noteOff('k:0:70');
  const osc2 = fake.ctx.oscillators.at(-1);
  assert.ok(osc2.stopAt < t + 0.2 && osc2.stopAt > res2.start + 0.4,
    `a 0.5 s note stops on its own release (${osc2.stopAt})`);
});

test('the Studio live notes: a poly note, a pad and a mono gate defer an off, never an all-off',
  () => {
    const log = [];
    const poly = { noteOn: (at, n) => { log.push(['on', at, n]); return { slot: 0 }; },
      noteOff: (at, n) => log.push(['off', at, n]), allOff: (at) => log.push(['all-off', at]) };
    const live = createLiveNotes({ getModel: () => ({ graph: { nodes: [], edges: [] } }),
      handleOf: () => poly });
    live.event('fm', { kind: 'on', note: 60, at: 1 });
    live.event('fm', { kind: 'off', note: 60, at: 1 });
    live.event('fm', { kind: 'on', note: 62, at: 2 });
    live.event('fm', { kind: 'off', note: 62, at: 3 });
    live.event('fm', { kind: 'on', note: 64, at: 4 });
    live.event('fm', { kind: 'all-off', at: 4 });
    assert.deepEqual(log, [['on', 1, 60], ['off', 1.03, 60], ['on', 2, 62], ['off', 3, 62],
      ['on', 4, 64], ['all-off', 4]]);
  });

test('no note path defines its own minimum gate', () => {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src/js'));
  const own = path.join(ROOT, 'src/js/audio/gate.js');
  const defines = files.filter((f) => f !== own
    && /\b(MIN_GATE|minGate)\w*\s*=/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(defines.map((f) => path.relative(ROOT, f)), []);
  for (const f of ['src/js/audio/audio-engine.js', 'src/js/studio/live-notes.js']) {
    assert.match(readFileSync(path.join(ROOT, f), 'utf8'), /gateCloseAt/, `${f} uses it`);
  }
});

// af's rule, 98's F5 on K183: a forced stop (blur, hide, Escape, panic, a switch) is never
// deferred: forcedOff names it, the engine releases at once, and the live notes close at `at`.
test('a forced stop is never deferred by the minimum gate', () => {
  assert.equal(gate.forcedOff({ forced: true }), true);
  for (const r of ['blur', 'hide', 'escape', 'switch', 'disarm', 'unplug', 'all-off', 'silence']) {
    assert.equal(gate.forcedOff({ reason: r }), true, r);
  }
  for (const r of ['note-off', 're-press', 'legato']) {
    assert.equal(gate.forcedOff({ reason: r }), false, r);
  }
  assert.equal(gate.forcedOff(undefined), false);
  const fake = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fake.env });
  engine.noteOn('k:0:69', NOTE);
  engine.noteOn('k:0:70', NOTE);
  engine.noteOff('k:0:69', { forced: true }); // the same instant: one forced, one ordinary
  engine.noteOff('k:0:70');
  const [forcedOsc, ordinary] = fake.ctx.oscillators;
  // The forced release starts at the engine's next scheduling point (a few ms of lead), the
  // ordinary one at the note's start plus the minimum: the difference is the minimum less it.
  assert.ok(ordinary.stopAt - forcedOsc.stopAt >= gate.MIN_GATE_S - 0.005,
    `the forced stop is not deferred: ${forcedOsc.stopAt} against ${ordinary.stopAt}`);
  const log = [];
  const poly = { noteOn: (at, n) => { log.push(['on', at, n]); return { slot: 0 }; },
    noteOff: (at, n) => log.push(['off', at, n]), allOff() {} };
  const live = createLiveNotes({ getModel: () => ({ graph: { nodes: [], edges: [] } }),
    handleOf: () => poly });
  live.event('fm', { kind: 'on', note: 60, at: 1 });
  live.event('fm', { kind: 'off', note: 60, at: 1, forced: true });
  assert.deepEqual(log, [['on', 1, 60], ['off', 1, 60]]);
});

// 21's T1 on K184: the mono keys path (a Keys node's note stack) and the XY pad path both close
// their envelope's gate at on + the minimum on an ordinary off, and at once on an all-off.
function gateRig(sourceHandle, sourceId) {
  const log = [];
  const env = { gate: (at) => log.push(['gate', at]), release: (at) => log.push(['release', at]) };
  const model = { graph: { nodes: [{ id: sourceId }, { id: 'env', type: 'envelope' }],
    edges: [{ id: 'e', from: { node: sourceId, port: 'gate' }, to: { node: 'env', port: 'gate' },
      props: {} }] } };
  const live = createLiveNotes({ getModel: () => model,
    handleOf: (id) => (id === 'env' ? env : sourceHandle) });
  return { live, log };
}

test('a mono Keys tap and a pad tap close the gate at on + the minimum; their all-off at once',
  () => {
    const keys = { play() {}, priority: () => 'last' };
    const k = gateRig(keys, 'keys');
    k.live.event('keys', { kind: 'on', note: 60, at: 1 });
    k.live.event('keys', { kind: 'off', note: 60, at: 1 });
    k.live.event('keys', { kind: 'on', note: 62, at: 2 });
    k.live.event('keys', { kind: 'all-off', at: 2 });
    assert.deepEqual(k.log, [['gate', 1], ['release', 1.03], ['gate', 2], ['release', 2]],
      'mono keys');
    const pad = { move: () => ({ note: 60 }) };
    const p = gateRig(pad, 'pad');
    p.live.event('pad', { kind: 'on', x: 0.5, y: 0.5, at: 1 });
    p.live.event('pad', { kind: 'off', at: 1 });
    p.live.event('pad', { kind: 'on', x: 0.5, y: 0.5, at: 2 });
    p.live.event('pad', { kind: 'all-off', at: 2 });
    assert.deepEqual(p.log, [['gate', 1], ['release', 1.03], ['gate', 2], ['release', 2]],
      'pad');
  });

// 21's T2 on K184: Escape (notesOff, fast) stops a note begun in the same task at once, within
// the escape release of now, never at its start plus the minimum.
test('Escape stops a note begun in the same task without the minimum gate', () => {
  const fake = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fake.env });
  const { start } = engine.noteOn('k:0:69', NOTE);
  engine.noteOn('k:0:70', NOTE);
  engine.notesOff(true);
  // The escape fade from the engine's next scheduling point (the note's own start, the same
  // task, a scheduling lead at most later) plus the 10 ms stop margin: never start + minimum.
  const escaped = start + ESCAPE_RELEASE_S + 0.01;
  for (const osc of fake.ctx.oscillators) {
    assert.ok(osc.stopAt <= escaped + 0.005, `stopped at ${osc.stopAt}, started ${start}`);
    assert.ok(osc.stopAt < start + gate.MIN_GATE_S, 'not deferred to the minimum');
  }
  const ordinary = engine.noteOn('k:0:71', NOTE);
  engine.noteOff('k:0:71'); // an ordinary off in the same task: deferred, for contrast
  assert.ok(fake.ctx.oscillators.at(-1).stopAt >= ordinary.start + gate.MIN_GATE_S,
    'an ordinary off waits the minimum');
});

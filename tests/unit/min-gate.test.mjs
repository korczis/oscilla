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

// K178 (one keyboard), the held notes: src/js/midi/held-notes.js keeps which key holds which
// note on which sink, and every release goes to the sink the note started on.
//
// - hold, releaseKey, held, sinkOf, releaseAll (with its sink and input filters), on;
// - a re-press of a held key releases it on its old sink first;
// - the bound: never more than 128 keys per input (so 128 x inputs), the oldest released;
// - no entry outlives releaseAll for any reason (blur, hide, Escape, switch, disarm, unplug,
//   all-off), and an unplugged MIDI input leaves the pointer and QWERTY holds in place;
// - a seeded property run of random hold / release / switch / unplug / forced-release
//   sequences: held() always agrees with what was held, and every hold is released exactly
//   once, through the sink it started on;
// - midi/notes.js on it: a note-off, a re-press and All Notes Off reach the player the note
//   started on, whatever route() answers by then.
//
//   node --test tests/unit/held-notes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { createHeldNotes, HELD_PER_INPUT, RELEASE_REASONS, sameSink }
  from '../../src/js/midi/held-notes.js';
import { createMidiNotes } from '../../src/js/midi/notes.js';

/** A sink that records every note-off it is sent: [name, note, info]. */
function recordingSink(name, log) {
  return { name, noteOff: (note, info) => { log.push([name, note, info]); return true; } };
}

function rig() {
  const log = [];
  const events = [];
  const held = createHeldNotes();
  held.on((e) => events.push(e));
  return { log, events, held, a: recordingSink('a', log), b: recordingSink('b', log) };
}

test('hold, held, sinkOf: a copy in hold order; an unknown key has no sink', () => {
  const { held, a, b, events } = rig();
  held.hold('1:0:60', { sink: a, note: 60, velocity: 100, input: 'midi' });
  held.hold('kbd-key:0:64', { sink: b, note: 64, velocity: 90, input: 'qwerty' });
  const list = held.held();
  assert.deepEqual(list, [
    { key: '1:0:60', note: 60, velocity: 100, input: 'midi', sink: a },
    { key: 'kbd-key:0:64', note: 64, velocity: 90, input: 'qwerty', sink: b },
  ]);
  list.pop();
  list[0].note = 1;
  assert.equal(held.held().length, 2, 'held() is a copy');
  assert.equal(held.held()[0].note, 60, 'its entries are copies');
  assert.equal(held.sinkOf('1:0:60'), a);
  assert.equal(held.sinkOf('kbd-key:0:64'), b);
  assert.equal(held.sinkOf('9:0:1'), null);
  assert.deepEqual(events, [{ type: 'hold', key: '1:0:60', reason: 'hold' },
    { type: 'hold', key: 'kbd-key:0:64', reason: 'hold' }]);
});

test('hold refuses a key that is not a string and a sink without noteOff', () => {
  const { held, a } = rig();
  assert.throws(() => held.hold(60, { sink: a, note: 60 }), TypeError);
  assert.throws(() => held.hold('1:0:60', { sink: {}, note: 60 }), TypeError);
  assert.throws(() => held.hold('1:0:60', { note: 60 }), TypeError);
  assert.equal(held.held().length, 0);
  assert.throws(() => createHeldNotes({ perInput: 0 }), TypeError);
});

test('releaseKey removes the key and returns its sink without calling it', () => {
  const { held, a, log, events } = rig();
  held.hold('1:0:60', { sink: a, note: 60, velocity: 100, input: 'midi' });
  events.length = 0;
  assert.equal(held.releaseKey('1:0:60'), a);
  assert.deepEqual(log, [], 'the caller sends the note-off');
  assert.equal(held.sinkOf('1:0:60'), null);
  assert.deepEqual(held.held(), []);
  assert.deepEqual(events, [{ type: 'release', key: '1:0:60', reason: 'note-off' }]);
  assert.equal(held.releaseKey('1:0:60'), null, 'a key not held: null, no event');
  assert.equal(events.length, 1);
});

test('a re-press of a held key releases it on its old sink before recording the new one', () => {
  const { held, a, b, log, events } = rig();
  held.hold('1:0:60', { sink: a, note: 60, velocity: 100, input: 'midi' });
  events.length = 0;
  held.hold('1:0:60', { sink: b, note: 60, velocity: 70, input: 'midi' });
  assert.deepEqual(log, [['a', 60, { key: '1:0:60', reason: 're-press', velocity: 100,
    input: 'midi' }]]);
  assert.equal(held.sinkOf('1:0:60'), b);
  assert.deepEqual(held.held().map((e) => [e.key, e.velocity]), [['1:0:60', 70]]);
  assert.deepEqual(events, [{ type: 'release', key: '1:0:60', reason: 're-press' },
    { type: 'hold', key: '1:0:60', reason: 'hold' }]);
});

test('releaseAll releases every key through its own sink and returns the count', () => {
  const { held, a, b, log } = rig();
  held.hold('1:0:60', { sink: a, note: 60, velocity: 100, input: 'midi' });
  held.hold('kbd-key:0:62', { sink: b, note: 62, velocity: 90, input: 'key' });
  assert.equal(held.releaseAll('blur'), 2);
  assert.deepEqual(log.map(([name, note, info]) => [name, note, info.reason]),
    [['a', 60, 'blur'], ['b', 62, 'blur']]);
  assert.deepEqual(held.held(), []);
  assert.equal(held.releaseAll('blur'), 0);
  assert.throws(() => held.releaseAll(), TypeError, 'a reason is required');
});

test('releaseAll with a sink filter releases only the notes on that sink', () => {
  const { held, a, b, log } = rig();
  held.hold('1:0:60', { sink: a, note: 60, input: 'midi' });
  held.hold('1:0:62', { sink: b, note: 62, input: 'midi' });
  held.hold('kbd-key:0:64', { sink: a, note: 64, input: 'key' });
  assert.equal(held.releaseAll('switch', { sink: a }), 2);
  assert.deepEqual(log.map(([name, note]) => [name, note]), [['a', 60], ['a', 64]]);
  assert.deepEqual(held.held().map((e) => e.key), ['1:0:62']);
});

test('the sink filter matches the same player handed out as a fresh object', () => {
  const { held, log } = rig();
  const noteOff = (note, info) => { log.push(['synth', note, info.reason]); return true; };
  const synthSink = () => ({ noteOn: () => ({ ok: true }), noteOff });
  held.hold('1:0:60', { sink: synthSink(), note: 60, input: 'midi' });
  assert.ok(sameSink(synthSink(), synthSink()));
  assert.ok(!sameSink(synthSink(), recordingSink('x', [])));
  assert.equal(held.releaseAll('switch', { sink: synthSink() }), 1);
  assert.deepEqual(log, [['synth', 60, 'switch']]);
});

test('releaseAll unplug of the MIDI input leaves the pointer and QWERTY holds in place', () => {
  const { held, a, b, log } = rig();
  held.hold('1:0:60', { sink: a, note: 60, input: 'midi' });
  held.hold('kbd-pointer:0:62', { sink: a, note: 62, input: 'pointer' });
  held.hold('2:3:63', { sink: b, note: 63, input: 'midi' });
  held.hold('kbd-key:0:64', { sink: b, note: 64, input: 'key' });
  held.hold('kbd-qwerty:0:65', { sink: b, note: 65, input: 'qwerty' });
  assert.equal(held.releaseAll('unplug', { input: 'midi' }), 2);
  assert.deepEqual(log.map(([name, note, info]) => [name, note, info.reason]),
    [['a', 60, 'unplug'], ['b', 63, 'unplug']]);
  assert.deepEqual(held.held().map((e) => [e.key, e.input]), [['kbd-pointer:0:62', 'pointer'],
    ['kbd-key:0:64', 'key'], ['kbd-qwerty:0:65', 'qwerty']]);
  assert.equal(held.releaseAll('switch', { sink: b, input: 'key' }), 1, 'both filters apply');
  assert.deepEqual(held.held().map((e) => e.key), ['kbd-pointer:0:62', 'kbd-qwerty:0:65']);
});

test('the input defaults to the source part of the key', () => {
  const { held, a } = rig();
  held.hold('kbd-key:0:60', { sink: a, note: 60 });
  assert.equal(held.held()[0].input, 'kbd-key');
});

for (const reason of ['blur', 'hide', 'escape', 'switch', 'disarm', 'unplug', 'all-off']) {
  test(`no entry outlives releaseAll('${reason}')`, () => {
    assert.ok(RELEASE_REASONS.includes(reason));
    const { held, a, b, log, events } = rig();
    const inputs = ['midi', 'pointer', 'key'];
    for (let n = 0; n < 30; n++) {
      held.hold(`s${n % 3}:0:${n}`, { sink: n % 2 ? a : b, note: n, velocity: n + 1,
        input: inputs[n % 3] });
    }
    events.length = 0;
    assert.equal(held.releaseAll(reason), 30);
    assert.deepEqual(held.held(), []);
    for (let n = 0; n < 30; n++) assert.equal(held.sinkOf(`s${n % 3}:0:${n}`), null);
    assert.equal(log.length, 30, 'each released once');
    assert.ok(log.every(([name, note, info]) => name === (note % 2 ? 'a' : 'b')
      && info.reason === reason), 'each on its own sink, with the reason');
    assert.ok(events.every((e) => e.type === 'release' && e.reason === reason));
    assert.equal(events.length, 30);
  });
}

test('a sink that throws in releaseAll leaves no entry and every other note released', () => {
  const { held, a, log } = rig();
  const bad = { noteOff: () => { throw new Error('boom'); } };
  held.hold('1:0:60', { sink: bad, note: 60, input: 'midi' });
  held.hold('1:0:61', { sink: a, note: 61, input: 'midi' });
  assert.throws(() => held.releaseAll('escape'), /boom/);
  assert.deepEqual(held.held(), []);
  assert.deepEqual(log.map(([, note]) => note), [61]);
});

test('the bound: at most 128 keys per input; a hold beyond it releases that input\'s oldest',
  () => {
    const { held, a, b, log, events } = rig();
    assert.equal(HELD_PER_INPUT, 128);
    for (let n = 0; n < 128; n++) held.hold(`1:0:${n}`, { sink: a, note: n, input: 'midi' });
    for (let n = 0; n < 128; n++) {
      held.hold(`kbd-key:0:${n}`, { sink: b, note: n, input: 'key' });
    }
    assert.equal(held.held().length, 256, '128 x 2 inputs');
    assert.deepEqual(log, []);
    events.length = 0;
    held.hold('1:1:0', { sink: b, note: 0, input: 'midi' }); // channel 2: one key too many
    assert.equal(held.held().length, 256);
    assert.deepEqual(log.map(([name, note, info]) => [name, note, info.key, info.reason]),
      [['a', 0, '1:0:0', 'bound']], 'the oldest MIDI key, on its own sink');
    assert.equal(held.sinkOf('1:0:0'), null);
    assert.equal(held.sinkOf('kbd-key:0:0'), b, 'another input keeps its keys');
    assert.deepEqual(events, [{ type: 'release', key: '1:0:0', reason: 'bound' },
      { type: 'hold', key: '1:1:0', reason: 'hold' }]);
    const small = createHeldNotes({ perInput: 2 });
    for (let n = 0; n < 5; n++) small.hold(`k:0:${n}`, { sink: a, note: n, input: 'midi' });
    assert.deepEqual(small.held().map((e) => e.note), [3, 4]);
  });

test('on() returns its off; a listener that throws never stops a release', () => {
  const failures = [];
  const held = createHeldNotes({ onError: (e) => failures.push(e.message) });
  const log = [];
  const a = recordingSink('a', log);
  const seen = [];
  const off = held.on((e) => seen.push(e.type));
  held.on(() => { throw new Error('listener'); });
  held.hold('1:0:60', { sink: a, note: 60, input: 'midi' });
  off();
  held.hold('1:0:61', { sink: a, note: 61, input: 'midi' });
  assert.equal(held.releaseAll('hide'), 2);
  assert.deepEqual(seen, ['hold'], 'off() stops the events');
  assert.equal(log.length, 2);
  assert.deepEqual(held.held(), []);
  assert.deepEqual(failures, ['listener', 'listener', 'listener', 'listener'],
    'the listener\'s error goes to onError, once per event');
  assert.throws(() => held.on(null), TypeError);
});

/** mulberry32: a seeded, reproducible random sequence in [0, 1). */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('property: random hold / release / switch sequences keep held() consistent and release '
  + 'every hold exactly once, on the sink it started on', () => {
  const REASONS = ['blur', 'hide', 'escape', 'switch', 'disarm', 'unplug', 'all-off'];
  const INPUTS = ['midi', 'pointer', 'key'];
  for (const seed of [1, 7, 42, 1789, 20261104]) {
    const rnd = seeded(seed);
    const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
    const perInput = 1 + Math.floor(rnd() * 6);
    const held = createHeldNotes({ perInput });
    const startedOn = new Map(); // token -> sink name
    const released = new Map(); // token -> how many times
    const live = new Map(); // key -> token, what the test believes is held
    const sinks = ['x', 'y', 'z'].map((name) => ({ name, noteOff(note, info) {
      const token = info.velocity;
      assert.equal(startedOn.get(token), name, `seed ${seed}: token ${token} on its sink`);
      released.set(token, (released.get(token) || 0) + 1);
      return true;
    } }));
    let events = { hold: 0, release: 0 };
    held.on((e) => { events[e.type] += 1; });
    let token = 0;
    const forget = () => {
      const keys = new Set(held.held().map((e) => e.key));
      for (const key of [...live.keys()]) if (!keys.has(key)) live.delete(key);
    };
    for (let step = 0; step < 600; step++) {
      const r = rnd();
      if (r < 0.5) {
        const input = pick(INPUTS);
        const key = `${input}:0:${Math.floor(rnd() * 12)}`;
        const sink = pick(sinks);
        token += 1;
        startedOn.set(token, sink.name);
        held.hold(key, { sink, note: Number(key.split(':')[2]), velocity: token, input });
        live.set(key, token);
        forget(); // a re-press or the bound released some
      } else if (r < 0.8) {
        const key = pick([...live.keys(), 'none:0:0']);
        const entry = held.held().find((e) => e.key === key);
        const sink = held.releaseKey(key);
        if (entry) {
          assert.equal(sink, entry.sink);
          sink.noteOff(entry.note, { key, reason: 'note-off', velocity: entry.velocity });
          live.delete(key);
        } else {
          assert.equal(sink, null);
        }
      } else if (r < 0.9) {
        const sink = pick(sinks);
        const n = held.releaseAll('switch', { sink });
        const expect = [...live.keys()].filter((k) => startedOn.get(live.get(k)) === sink.name);
        assert.equal(n, expect.length);
        for (const k of expect) live.delete(k);
      } else if (r < 0.95) {
        const input = pick(INPUTS);
        const n = held.releaseAll('unplug', { input });
        const expect = [...live.keys()].filter((k) => k.startsWith(`${input}:`));
        assert.equal(n, expect.length);
        for (const k of expect) live.delete(k);
      } else {
        held.releaseAll(pick(REASONS));
        assert.deepEqual(held.held(), []);
        live.clear();
      }
      // Consistent: held() is exactly what is live, each key once, within the bound.
      const list = held.held();
      assert.equal(new Set(list.map((e) => e.key)).size, list.length);
      assert.deepEqual(new Map(list.map((e) => [e.key, e.velocity])), live,
        `seed ${seed} step ${step}`);
      for (const e of list) {
        assert.equal(held.sinkOf(e.key), e.sink);
        assert.equal(e.sink.name, startedOn.get(e.velocity));
        assert.ok(!released.has(e.velocity), 'a held token was never released');
      }
      for (const input of INPUTS) {
        assert.ok(list.filter((e) => e.input === input).length <= perInput);
      }
    }
    held.releaseAll(pick(REASONS));
    assert.deepEqual(held.held(), []);
    for (let t = 1; t <= token; t++) {
      assert.equal(released.get(t), 1, `seed ${seed}: token ${t} released exactly once`);
    }
    assert.equal(events.hold, token);
    assert.equal(events.release, token);
    events = null;
  }
});

// ---------------------------------------------------------------- midi/notes.js on it

function notesRig() {
  const calls = [];
  const engine = {
    noteOn: (key) => { calls.push(['engine', 'on', key]); return { ok: true }; },
    noteOff: (key) => { calls.push(['engine', 'off', key]); return true; },
    notesOff: () => { calls.push(['engine', 'notesOff']); return 0; },
    resume() {},
  };
  // A fresh object per call, as synth/ui.js synthSink() hands out.
  const noteOn = (note) => { calls.push(['synth', 'on', note]); return { ok: true }; };
  const noteOff = (note) => { calls.push(['synth', 'off', note]); return true; };
  const allOff = () => { calls.push(['synth', 'allOff']); return 0; };
  const app = { workspace: 'playground' };
  const notes = createMidiNotes({ engine, settings: () => ({ a4: 440, continuous: true }),
    route: () => (app.workspace === 'synth' ? { noteOn, noteOff, allOff } : null) });
  return { calls, app, notes };
}

test('notes.js: a re-press on the same player retriggers there, with no note-off between', () => {
  const { calls, app, notes } = notesRig();
  notes.handle([0x90, 60, 100], 1);
  notes.handle([0x90, 60, 90], 1);
  app.workspace = 'synth';
  notes.noteOn(62, 90, 'kbd-key');
  notes.noteOn(62, 80, 'kbd-key');
  assert.deepEqual(calls, [['engine', 'on', '1:0:60'], ['engine', 'on', '1:0:60'],
    ['synth', 'on', 62], ['synth', 'on', 62]]);
});

test('notes.js: a re-press after a switch releases the key on the player it sounded on', () => {
  const { calls, app, notes } = notesRig();
  notes.handle([0x90, 60, 100], 1);
  app.workspace = 'synth';
  notes.handle([0x90, 60, 100], 1);
  notes.handle([0x80, 60, 0], 1);
  assert.deepEqual(calls, [['engine', 'on', '1:0:60'], ['engine', 'off', '1:0:60'],
    ['synth', 'on', 60], ['synth', 'off', 60]]);
});

test('notes.js: silence and All Notes Off release a key held on a player left behind', () => {
  const { calls, app, notes } = notesRig();
  app.workspace = 'synth';
  notes.noteOn(64, 90, 'kbd-key');
  app.workspace = 'playground';
  calls.length = 0;
  notes.silence();
  assert.deepEqual(calls, [['engine', 'notesOff'], ['synth', 'off', 64]]);
  calls.length = 0;
  notes.noteOff(64, 'kbd-key'); // released already: where it would sound now
  assert.deepEqual(calls, [['engine', 'off', 'kbd-key:0:64']]);
  app.workspace = 'synth';
  notes.handle([0x90, 50, 100], 2);
  app.workspace = 'playground';
  calls.length = 0;
  notes.handle([0xb0, 123, 0], 2);
  assert.deepEqual(calls, [['engine', 'notesOff'], ['synth', 'off', 50]]);
});

// K183 (option B, af 2026-11-05): the XY pad slides its one held note between scale cells
// without a new gate, so a held key moves to a new key on the same sink and input, and the
// caller sends the sink's legato (or a note-off and a note-on).
function legatoRig() {
  const offs = [];
  const sink = { noteOff: (note, info) => offs.push([note, info.reason]) };
  const other = { noteOff: (note, info) => offs.push(['other', note, info.reason]) };
  const held = createHeldNotes();
  const events = [];
  held.on((e) => events.push([e.type, e.key, e.reason]));
  return { held, sink, other, offs, events };
}

test('legato moves a held key to a new key on its sink and input, with no note-off', () => {
  const { held, sink, offs, events } = legatoRig();
  held.hold('xy:0:60', { sink, note: 60, velocity: 100, input: 'xy' });
  assert.equal(held.legato('xy:0:60', 'xy:0:63', { note: 63 }), sink);
  assert.deepEqual(held.held(), [{ key: 'xy:0:63', note: 63, velocity: 100, input: 'xy', sink }]);
  assert.deepEqual(offs, []);
  assert.deepEqual(events.slice(1), [['release', 'xy:0:60', 'legato'],
    ['hold', 'xy:0:63', 'legato']]);
  assert.ok(RELEASE_REASONS.includes('legato'));
});

test('legato of a key that is not held changes nothing and returns null', () => {
  const { held, offs, events } = legatoRig();
  assert.equal(held.legato('xy:0:60', 'xy:0:63', { note: 63 }), null);
  assert.deepEqual(held.held(), []);
  assert.deepEqual(offs, []);
  assert.deepEqual(events, []);
});

test('legato onto a key held elsewhere first releases that key on its own sink', () => {
  const { held, sink, other, offs } = legatoRig();
  held.hold('xy:0:60', { sink, note: 60, input: 'xy' });
  held.hold('xy:0:63', { sink: other, note: 63, input: 'xy' });
  held.legato('xy:0:60', 'xy:0:63', { note: 63, velocity: 70 });
  assert.deepEqual(offs, [['other', 63, 're-press']]);
  assert.deepEqual(held.held().map((e) => [e.key, e.velocity, e.sink === sink]),
    [['xy:0:63', 70, true]]);
});

test('a slid key is released by releaseAll like any other (no entry outlives it)', () => {
  const { held, sink, offs } = legatoRig();
  held.hold('xy:0:60', { sink, note: 60, input: 'xy' });
  held.legato('xy:0:60', 'xy:0:62', { note: 62 });
  held.legato('xy:0:62', 'xy:0:65', { note: 65 });
  assert.equal(held.releaseAll('hide', { input: 'xy' }), 1);
  assert.deepEqual(offs, [[65, 'hide']]);
  assert.equal(held.size, 0);
});

test('legato to the same key is a no-op that returns the sink', () => {
  const { held, sink, events } = legatoRig();
  held.hold('xy:0:60', { sink, note: 60, input: 'xy' });
  assert.equal(held.legato('xy:0:60', 'xy:0:60', { note: 60 }), sink);
  assert.equal(events.length, 1);
});

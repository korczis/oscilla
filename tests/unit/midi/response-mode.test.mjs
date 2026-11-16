// V503: the call-and-response mode's wiring (src/js/midi/response-mode.js) on a fake clock.
//
// What it proves:
//   - off, it hears nothing and wakes nothing; on, a phrase is answered PHRASE_GAP_MS after its
//     last key up, each note planned at its own context time through the note layer's noteOn /
//     noteOff with the answer's source (the one instrument, A5), within ANSWER_LOOKAHEAD_S;
//   - the start is the phrase end + PHRASE_GAP_MS mapped through the clock offset (error 0); a
//     start already past begins at now + START_OFFSET_S and keeps the relative onsets (A3);
//   - the player always wins: a Note On while the answer plays cuts it (nothing more planned,
//     what was planned released no earlier than its own start);
//   - a note the layer refuses (an owner holds the output, no instrument) leaves the answer
//     silent and planned no further; switching the mode off cuts and cancels its wake-up;
//   - the wake-ups are the transport clock's (wake/cancel), never a timer of this module's own.
//   node --test tests/unit/midi/response-mode.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { ANSWER_LOOKAHEAD_S, RESPONSE_TICK_MS, createResponseMode } from '../../../src/js/midi/response-mode.js';
import { ANSWER_SOURCE, PHRASE_GAP_MS } from '../../../src/js/midi/response.js';
import { START_OFFSET_S } from '../../../src/js/core/constants.js';

/** A page on a fake clock: perf ms and context s advance together, offset ctx - perf/1000. */
function rig({ offset = 10, refuse = false } = {}) {
  let perf = 0;
  const log = [];
  const wakes = new Map();
  const notes = {
    noteOn: (note, velocity, source, channel, o) => {
      log.push({ k: 'on', note, velocity, source, at: o && o.at });
      return refuse ? { ok: false, reason: 'measurement' } : { ok: true };
    },
    noteOff: (note, source, channel, o) => {
      log.push({ k: 'off', note, source, at: o && o.at, forced: !!(o && o.forced) });
      return true;
    },
  };
  const clock = { wake: (key, ms, fn) => wakes.set(key, { at: perf + ms, fn }),
    cancel: (key) => wakes.delete(key) };
  const said = [];
  const mode = createResponseMode({ notes, clock, offsetS: () => offset,
    ctxNow: () => perf / 1000 + offset, perfNow: () => perf, safeMax: () => 20000,
    polyphony: 8, say: (reason) => said.push(reason) });
  /** Advance the fake clock to `ms`, firing every wake-up that falls due on the way. */
  const run = (ms) => {
    for (;;) {
      const due = [...wakes.entries()].filter(([, w]) => w.at <= ms)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      perf = Math.max(perf, due[1].at);
      wakes.delete(due[0]);
      due[1].fn();
    }
    perf = ms;
  };
  const at = (ms) => { perf = ms; };
  return { mode, log, wakes, run, at, said, now: () => perf };
}

const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);

test('off: it hears nothing and wakes nothing', () => {
  const { mode, log, wakes } = rig();
  assert.equal(mode.on, false);
  assert.equal(mode.player('on', 60, 100, 0), false);
  assert.equal(wakes.size, 0);
  assert.deepEqual(log, []);
});

test('a phrase is answered PHRASE_GAP_MS after its last key up, at the fifth, on the clock', () => {
  const { mode, log, run, at } = rig({ offset: 10 });
  mode.setOn(true);
  at(1000); mode.player('on', 60, 100, 1000);
  at(1200); mode.player('off', 60, 0, 1200);
  at(1250); mode.player('on', 64, 90, 1250);
  at(1450); mode.player('off', 64, 0, 1450);
  run(1450 + PHRASE_GAP_MS - 1);
  assert.deepEqual(log, [], 'not before the gap');
  run(5000);
  const ons = log.filter((e) => e.k === 'on');
  const offs = log.filter((e) => e.k === 'off');
  assert.deepEqual(ons.map((e) => [e.note, e.source]), [[67, ANSWER_SOURCE], [71, ANSWER_SOURCE]]);
  // The phrase end + the gap, mapped (error 0): the end is heard at that moment, so the answer
  // begins START_OFFSET_S after it at the earliest, within the ADR's budget of START_OFFSET_S
  // plus one tick (A3).
  const t0 = (1450 + PHRASE_GAP_MS) / 1000 + 10;
  const late = ons[0].at - t0;
  assert.ok(late >= 0 && late <= START_OFFSET_S + RESPONSE_TICK_MS / 1000 + 1e-9,
    `the first onset ${late * 1000} ms after the mapped start`);
  near(ons[1].at, ons[0].at + 0.25, 'the second keeps its onset');
  near(offs[0].at, ons[0].at + 0.2, 'the first length');
  near(offs[1].at, ons[0].at + 0.45, 'the second length');
  assert.equal(mode.answering(), false, 'done');
});

test('each note is planned no more than ANSWER_LOOKAHEAD_S ahead', () => {
  const { mode, log, run, at, now } = rig({ offset: 0 });
  mode.setOn(true);
  at(0); mode.player('on', 60, 100, 0);
  at(100); mode.player('off', 60, 0, 100);
  at(500); mode.player('on', 62, 100, 500);
  at(600); mode.player('off', 62, 0, 600);
  const planned = [];
  const orig = log.push.bind(log);
  log.push = (e) => { planned.push({ ...e, ctxNow: now() / 1000 }); return orig(e); };
  run(5000);
  assert.ok(planned.length >= 4);
  for (const e of planned) {
    assert.ok(e.at - e.ctxNow <= ANSWER_LOOKAHEAD_S + 1e-9, `${e.k} ${e.note} planned in time`);
  }
});

test('a start already past begins at now + START_OFFSET_S and keeps the relative onsets', () => {
  const { mode, log, at } = rig({ offset: 0 });
  mode.setOn(true);
  at(0); mode.player('on', 60, 100, 0);
  at(100); mode.player('off', 60, 0, 100);
  at(150); mode.player('on', 62, 100, 150);
  at(250); mode.player('off', 62, 0, 250);
  at(3000); // the tick came late: the mapped start (0.85 s) is long past
  mode.tick();
  const ons = log.filter((e) => e.k === 'on');
  near(ons[0].at, 3 + START_OFFSET_S, 'begins now + the engine\'s lead');
  assert.equal(ons.length, 1, 'the second is not due yet');
  mode.tick();
  at(3200); mode.tick();
  const all = log.filter((e) => e.k === 'on');
  near(all[1].at - all[0].at, 0.15, 'the relative onset is kept');
});

test('the player always wins: a Note On cuts the answer, its planned notes released in time', () => {
  const { mode, log, run, at } = rig({ offset: 0 });
  mode.setOn(true);
  const long = [[60, 0, 400], [62, 400, 800], [64, 800, 1200], [65, 1200, 1600]];
  for (const [n, on, off] of long) {
    at(on); mode.player('on', n, 100, on);
    at(off); mode.player('off', n, 0, off);
  }
  run(1600 + PHRASE_GAP_MS + 50); // the answer started
  assert.equal(mode.answering(), true);
  const onsBefore = log.filter((e) => e.k === 'on').length;
  at(1600 + PHRASE_GAP_MS + 60);
  mode.player('on', 72, 100, 1600 + PHRASE_GAP_MS + 60);
  assert.equal(mode.answering(), false, 'cut');
  const cuts = log.filter((e) => e.k === 'off' && e.forced);
  assert.ok(cuts.length >= 1, 'what sounded is released');
  for (const c of cuts) {
    const on = log.find((e) => e.k === 'on' && e.note === c.note);
    assert.ok(c.at >= on.at, 'never before its own planned start');
  }
  run(20000);
  assert.equal(log.filter((e) => e.k === 'on' && e.source === ANSWER_SOURCE).length, onsBefore,
    'nothing more of that answer is planned');
});

test('a refused note leaves the answer silent; switching off cuts and cancels the wake-up', () => {
  const r = rig({ refuse: true });
  r.mode.setOn(true);
  r.at(0); r.mode.player('on', 60, 100, 0);
  r.at(100); r.mode.player('off', 60, 0, 100);
  r.at(200); r.mode.player('on', 62, 100, 200);
  r.at(300); r.mode.player('off', 62, 0, 300);
  r.run(5000);
  assert.equal(r.log.filter((e) => e.k === 'off').length, 0, 'refused: nothing to release');
  assert.equal(r.log.filter((e) => e.k === 'on').length, 1, 'the rest of the answer not tried');
  assert.deepEqual(r.said, ['measurement'], 'said once for the answer');
  // A next phrase is refused again and said again: once per phrase.
  r.at(6000); r.mode.player('on', 64, 100, 6000);
  r.at(6100); r.mode.player('off', 64, 0, 6100);
  r.run(9000);
  assert.deepEqual(r.said, ['measurement', 'measurement']);
  assert.equal(r.mode.answering(), false);
  const s = rig();
  s.mode.setOn(true);
  s.at(0); s.mode.player('on', 60, 100, 0);
  assert.equal(s.wakes.size, 1, 'the transport clock wakes it');
  s.mode.setOn(false);
  assert.equal(s.wakes.size, 0, 'off: the wake-up is cancelled');
});

test('the note layer plans an answer note on the one instrument, never on the engine voice', async () => {
  const { createMidiNotes } = await import('../../../src/js/midi/notes.js');
  const calls = [];
  const sink = { noteOn: (n, v, o) => { calls.push(['on', n, o && o.at]); return { ok: true }; },
    noteOff: (n, i) => { calls.push(['off', n, i && i.at]); return true; },
    allOff: () => 0 };
  const engine = { noteOn: () => { calls.push(['engine']); return { ok: true }; },
    noteOff: () => true, notesOff: () => 0 };
  const routed = createMidiNotes({ engine, route: () => sink });
  assert.equal(routed.noteOn(67, 80, ANSWER_SOURCE, 0, { at: 12.5 }).ok, true);
  routed.noteOff(67, ANSWER_SOURCE, 0, { at: 12.7 });
  assert.deepEqual(calls, [['on', 67, 12.5], ['off', 67, 12.7]], 'the context times pass through');
  calls.length = 0;
  const bare = createMidiNotes({ engine, route: () => null });
  assert.deepEqual(bare.noteOn(67, 80, ANSWER_SOURCE, 0, { at: 12.5 }),
    { ok: false, reason: 'no-instrument' });
  assert.deepEqual(calls, [], 'the engine voice starts now or never: a planned note is refused');
  assert.notEqual(bare.noteOn(60, 80, 'kbd-a').reason, 'no-instrument', 'a key still plays it');
});

test('midi/ui.js: on the engine fallback with the switch on, one refusal line and no answer note',
  async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const { createMidiUi, RESPONSE_TEXT } = await import('../../../src/js/midi/ui.js');
    const ls = new Set();
    const port = { name: 'KeyLab mkII 61 MIDI', state: 'connected', type: 'input',
      open: () => Promise.resolve(),
      addEventListener: (k, fn) => { if (k === 'midimessage') ls.add(fn); },
      removeEventListener: (k, fn) => ls.delete(fn),
      send: (b, stamp) => { for (const fn of ls) fn({ data: Uint8Array.from(b), timeStamp: stamp }); } };
    const access = { inputs: { forEach: (fn) => fn(port) }, addEventListener() {},
      removeEventListener() {} };
    const win = { navigator: { requestMIDIAccess: () => Promise.resolve(access),
      permissions: { query: () => Promise.resolve({ state: 'granted', addEventListener() {} }) } },
    isSecureContext: true, location: { protocol: 'https:', host: 'x' }, addEventListener() {} };
    const engineCalls = [];
    const engine = { ctx: { get currentTime() { return Date.now() / 1000; }, sampleRate: 48000,
      getOutputTimestamp: () => ({ contextTime: Date.now() / 1000, performanceTime: Date.now() }) },
    safeMaximum: 22800,
    _timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
    noteOn: (key, o) => { engineCalls.push(['on', key, o.freq]); return { ok: true }; },
    noteOff: () => true, notesOff: () => 0 };
    const notified = [];
    const ui = createMidiUi({ win, engine, now: () => Date.now() });
    // A workspace whose row plays the one instrument, here with none (a document of the user's
    // that cannot take the panel): the keys fall back to the page's own voice (K247).
    Object.assign(ui, { workspace: 'measure', keysInstrument: () => null,
      notify: (kind, title, text) => notified.push({ title, text }), a4: 440, waveform: 'sine',
      attack: 10, release: 30, safetyLimit: 2, continuousAllowed: false });
    await ui.midiInit();
    ui.midiConnect();
    await t.mock.timers.runAll();
    await new Promise((r) => setImmediate(r));
    assert.equal(ui.midiResponseToggle(true), true);
    t.mock.timers.tick(1000);
    port.send([0x90, 60, 100], Date.now());
    t.mock.timers.tick(200);
    port.send([0x80, 60, 0], Date.now());
    for (let i = 0; i < 40; i += 1) t.mock.timers.tick(50); // the gap and the answer's ticks
    const mine = notified.filter((n) => n.title === RESPONSE_TEXT.title);
    assert.deepEqual(mine.map((n) => n.text), [RESPONSE_TEXT.refused(RESPONSE_TEXT.noInstrument)],
      'one refusal line, in Czech');
    assert.equal(engineCalls.filter((c) => c[0] === 'on').length, 1, 'only the player\'s note sounded');
    assert.equal(ui.midiResponseToggle(false), false);
  });

test('an owner taking the output mid-answer cuts it through midiAllOff; nothing hangs', () => {
  const { mode, log, run, at } = rig({ offset: 0 });
  mode.setOn(true);
  for (const [n, on, off] of [[60, 0, 400], [62, 400, 800], [64, 800, 1200]]) {
    at(on); mode.player('on', n, 100, on);
    at(off); mode.player('off', n, 0, off);
  }
  run(1200 + PHRASE_GAP_MS + 50);
  assert.equal(mode.answering(), true);
  const before = log.length;
  mode.cut(); // what midi/ui.js midiAllOff does when Measure, Studio PLAY or the sequencer starts
  assert.equal(mode.answering(), false);
  const sounding = log.slice(0, before).filter((e) => e.k === 'on').map((e) => e.note);
  const released = log.slice(before).filter((e) => e.k === 'off').map((e) => e.note);
  assert.deepEqual(released.sort(), sounding.filter((n) => !log.slice(0, before)
    .some((e) => e.k === 'off' && e.note === n)).sort(), 'every sounding answer note released');
  run(20000);
  assert.equal(log.filter((e) => e.k === 'on').length, sounding.length, 'nothing more is planned');
});

/** midi/ui.js on a stub window, port and engine; the keys' route is `sink` (or the fallback). */
async function uiRig(t, { sink = null, panelMissing = false } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { createMidiUi, RESPONSE_TEXT } = await import('../../../src/js/midi/ui.js');
  const ls = new Set();
  const winLs = new Map();
  const port = { name: 'KeyLab mkII 61 MIDI', state: 'connected', type: 'input',
    open: () => Promise.resolve(),
    addEventListener: (k, fn) => { if (k === 'midimessage') ls.add(fn); },
    removeEventListener: (k, fn) => ls.delete(fn),
    send: (b) => { for (const fn of ls) fn({ data: Uint8Array.from(b), timeStamp: Date.now() }); } };
  const access = { inputs: { forEach: (fn) => fn(port) }, addEventListener() {},
    removeEventListener() {} };
  const win = { navigator: { requestMIDIAccess: () => Promise.resolve(access),
    permissions: { query: () => Promise.resolve({ state: 'granted', addEventListener() {} }) } },
  isSecureContext: true, location: { protocol: 'https:', host: 'x' },
  addEventListener: (k, fn) => winLs.set(k, [...(winLs.get(k) || []), fn]) };
  const engine = { ctx: { get currentTime() { return Date.now() / 1000; }, sampleRate: 48000,
    getOutputTimestamp: () => ({ contextTime: Date.now() / 1000, performanceTime: Date.now() }) },
  safeMaximum: 22800,
  _timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
  noteOn: () => ({ ok: true }), noteOff: () => true, notesOff: () => 0 };
  const notified = [];
  const ui = createMidiUi({ win, engine, now: () => Date.now() });
  Object.assign(ui, { workspace: 'playground', keysInstrument: () => sink,
    keysPanelMissing: () => panelMissing,
    notify: (kind, title, text) => notified.push({ title, text }), a4: 440, waveform: 'sine',
    attack: 10, release: 30, safetyLimit: 2, continuousAllowed: false });
  await ui.midiInit();
  ui.midiConnect();
  await t.mock.timers.runAll();
  await new Promise((r) => setImmediate(r));
  const key = (code) => {
    for (const fn of winLs.get('keydown') || []) {
      fn({ code, key: code.slice(-1).toLowerCase(), repeat: false, target: null,
        preventDefault() {}, stopImmediatePropagation() {} });
    }
  };
  const phrase = () => {
    port.send([0x90, 60, 100]);
    t.mock.timers.tick(400);
    port.send([0x80, 60, 0]);
  };
  return { ui, port, notified, key, phrase, RESPONSE_TEXT, tick: (ms) => t.mock.timers.tick(ms) };
}

function sinkLog() {
  const log = [];
  return { log, sink: { noteOn: (n, v, o) => { log.push(['on', n, o && o.at]); return { ok: true }; },
    noteOff: (n, i) => { log.push(['off', n, i && i.at]); return true; }, allOff: () => 0 } };
}

test('item 8 (i): an answer never brings the Synth panel back; it says why instead', async (t) => {
  const { log, sink } = sinkLog();
  let missing = false;
  const r = await uiRig(t, { sink });
  r.ui.keysPanelMissing = () => missing;
  r.ui.midiResponseToggle(true);
  r.phrase(); // the player's key took the instrument (the panel is in)
  missing = true; // a Zpět in the gap took the panel out again
  for (let i = 0; i < 30; i += 1) r.tick(50);
  const answers = log.filter((e) => e[0] === 'on' && e[2] !== undefined);
  assert.deepEqual(answers, [], 'no answer note reached the instrument: nothing inserted');
  assert.deepEqual(r.notified.filter((n) => n.title === r.RESPONSE_TEXT.title).map((n) => n.text),
    [r.RESPONSE_TEXT.refused(r.RESPONSE_TEXT.noInstrument)]);
});

test('item 8 (iii): a computer key or the pad during an answer cuts it', async (t) => {
  for (const by of ['keys', 'pad']) {
    const { log, sink } = sinkLog();
    const r = await uiRig(t, { sink });
    r.ui.midiResponseToggle(true);
    r.phrase();
    for (let i = 0; i < 14; i += 1) r.tick(50); // the gap, then the answer begins
    assert.equal(r.ui.midiAnswering(), true, `${by}: the answer plays`);
    assert.ok(log.some((e) => e[0] === 'on' && e[1] === 67), `${by}: G4 planned`);
    if (by === 'keys') r.key('KeyJ');
    else r.ui.kbdPad(() => {}).noteOn(72, 100, 'xy');
    assert.equal(r.ui.midiAnswering(), false, `${by}: the answer is cut`);
    assert.ok(log.some((e) => e[0] === 'off' && e[1] === 67), `${by}: its note released`);
    t.mock.timers.reset();
  }
});

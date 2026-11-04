// The Studio's note sink (src/js/synth/studio-sink.js; M086, the owner's report of 2026-11-03):
// the keys play the Studio document through its transport (arm, then live on the node the keys
// play), never inserting anything, and step aside (active() null) while the document holds
// nothing that plays notes, so the Playground voice keeps sounding there.
//
//   node --test tests/unit/studio-sink.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../../src/js/synth/studio-sink.js').catch(() => ({}));

const node = (id, type) => ({ id, type, params: {}, metadata: {} });
const fixture = (nodes, { noteTarget = null, playing = false, armOk = true } = {}) => {
  const log = [];
  const model = { graph: { nodes, edges: [] }, metadata: noteTarget ? { noteTarget } : {} };
  const transport = {
    playing,
    arm() { log.push(['arm']); this.playing = armOk; return armOk ? { ok: true }
      : { ok: false, code: 'claim-refused', reason: 'x' }; },
    live(id, ev) { log.push(['live', id, ev.kind, ev.note]); return { ok: true, released: 1 }; },
  };
  const said = [];
  const sink = mod.createStudioSink({ get: () => ({ handle: { getModel: () => model }, transport }),
    say: (t) => said.push(t) });
  return { sink, log, said, transport };
};

test('a document with nothing that plays notes: the sink steps aside', () => {
  assert.equal(typeof mod.createStudioSink, 'function');
  const { sink, log, said } = fixture([node('osc-1', 'oscillator'), node('master', 'master')]);
  assert.equal(sink.active(), null, 'the Playground voice keeps the keys');
  assert.deepEqual(sink.noteOn(60, 100), { ok: false, reason: 'no-target' });
  assert.deepEqual(log, [], 'nothing armed, nothing inserted');
  assert.match(said[0], /Nothing in this Studio plays notes/);
});

test('the first note arms the transport, plays the Keys node live; off and all-off follow', () => {
  const { sink, log } = fixture([node('osc-1', 'oscillator'), node('keys-1', 'keys')]);
  assert.equal(sink.active(), sink);
  assert.equal(sink.noteOn(60, 100).ok, true);
  sink.noteOn(64, 100);
  assert.equal(sink.noteOff(60), true);
  assert.equal(sink.allOff(), 1);
  assert.deepEqual(log, [['arm'], ['live', 'keys-1', 'on', 60], ['live', 'keys-1', 'on', 64],
    ['live', 'keys-1', 'off', 60], ['live', 'keys-1', 'all-off', undefined]],
  'armed once, then live on the Keys node');
});

test('the routed note target wins; a playing transport is not armed again', () => {
  const { sink, log } = fixture([node('keys-1', 'keys'), node('fm-1', 'fm-voice')],
    { noteTarget: 'fm-1', playing: true });
  sink.noteOn(62, 90);
  assert.deepEqual(log, [['live', 'fm-1', 'on', 62]]);
});

test('a held note is released on the node it went to, even if the target changed', () => {
  const nodes = [node('keys-1', 'keys')];
  const { sink, log } = fixture(nodes, { playing: true });
  sink.noteOn(60, 100);
  nodes.unshift(node('fm-1', 'fm-voice'));
  sink.noteOn(62, 100);
  assert.equal(sink.noteOff(60), true);
  assert.deepEqual(log.at(-1), ['live', 'keys-1', 'off', 60], 'the original node gets the off');
  sink.noteOff(62);
  assert.deepEqual(log.at(-1), ['live', 'fm-1', 'off', 62]);
});

test('an arm refused for another reason says its own code, not a measurement', () => {
  const { sink, transport } = fixture([node('keys-1', 'keys')]);
  transport.arm = () => ({ ok: false, code: 'disposed', reason: 'The Studio was closed.' });
  assert.deepEqual(sink.noteOn(60, 100), { ok: false, reason: 'disposed' });
});

test('a measurement owning the output refuses the arm, said', () => {
  const { sink, log, said } = fixture([node('keys-1', 'keys')], { armOk: false });
  assert.deepEqual(sink.noteOn(60, 100), { ok: false, reason: 'measurement' });
  assert.deepEqual(log, [['arm']]);
  assert.match(said[0], /measurement owns the output/);
});

// 21's R2: leaving the Studio disarms an armed-only run (the keys armed it), so the transport no
// longer owns the output; a run the user started with PLAY is left alone.
test('leaving the Studio disarms an armed-only run and leaves a PLAYed one', () => {
  const { sink, transport, log } = fixture([node('keys-1', 'keys')]);
  transport.armed = false;
  const arm = transport.arm.bind(transport);
  transport.arm = () => { const r = arm(); transport.armed = true; return r; };
  transport.disarm = () => { log.push(['disarm']); transport.armed = false;
    transport.playing = false; return Promise.resolve(); };
  sink.noteOn(60, 100);
  assert.equal(sink.leave(), true);
  assert.deepEqual(log.slice(-2), [['live', 'keys-1', 'all-off', undefined], ['disarm']]);
  assert.equal(transport.armed, false);
  transport.playing = true; // PLAY: playing, not armed
  assert.equal(sink.leave(), false, 'a PLAYed run is the user\'s');
});

// 98's R6: the same note pressed again after a re-route releases it on the first node first.
test('a note pressed again on another node releases it on the first one', () => {
  const nodes = [node('keys-1', 'keys')];
  const { sink, log } = fixture(nodes, { playing: true });
  sink.noteOn(60, 100);
  nodes.unshift(node('fm-1', 'fm-voice'));
  sink.noteOn(60, 100);
  assert.deepEqual(log.slice(-2), [['live', 'keys-1', 'off', 60], ['live', 'fm-1', 'on', 60]]);
  sink.noteOff(60);
  assert.deepEqual(log.at(-1), ['live', 'fm-1', 'off', 60]);
});

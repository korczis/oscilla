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

test('a measurement owning the output refuses the arm, said', () => {
  const { sink, log, said } = fixture([node('keys-1', 'keys')], { armOk: false });
  assert.deepEqual(sink.noteOn(60, 100), { ok: false, reason: 'measurement' });
  assert.deepEqual(log, [['arm']]);
  assert.match(said[0], /measurement owns the output/);
});

// K060, K103 (part), K104: the note stack (src/js/synth/note-stack.js) and the live notes on the
// transport (src/js/studio/live-notes.js) with fake handles: last-note priority and the legato
// return, the gate fan-out to gate(t, null) / release(t) and Random clock(t, k), the armed model
// (the Keys component only) and the envelopes a Keys gate closes at arm and PLAY.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoteStack } from '../../src/js/synth/note-stack.js';
import {
  createLiveNotes, gateTargets, keysGatedEnvelopes, liveModel,
} from '../../src/js/studio/live-notes.js';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { panelStore } from './synth-fixture.mjs';

test('last-note priority, the legato return and low / high priority', () => {
  const s = createNoteStack();
  assert.equal(s.press(60, 100).retrigger, true);
  const b = s.press(64, 90);
  assert.deepEqual([b.top.note, b.retrigger], [64, true]);
  const c = s.release(64);
  assert.deepEqual([c.top.note, c.legato, c.retrigger], [60, true, false]);
  assert.equal(s.release(60).empty, true);
  s.press(60, 1, 'low');
  assert.equal(s.press(67, 1, 'low').retrigger, false, 'a higher key under low priority');
  assert.equal(s.top('high').note, 67);
  assert.equal(s.clear(), 2);
});

function fakeRun(model) {
  const log = [];
  const handles = new Map();
  for (const n of model.graph.nodes) {
    if (n.type === 'keys') {
      handles.set(n.id, { play: (t, note, vel, o) => log.push(['play', t, note, o.legato]),
        priority: () => 'last' });
    } else if (n.type === 'envelope') {
      handles.set(n.id, { gate: (t, d) => log.push(['gate', n.id, t, d]),
        release: (t) => log.push(['release', n.id, t]) });
    } else if (n.type === 'random') {
      handles.set(n.id, { clock: (t, k) => log.push(['clock', n.id, t, k]) });
    }
  }
  const live = createLiveNotes({ getModel: () => model, handleOf: (id) => handles.get(id) });
  return { live, log };
}

test('gate fan-out: a new top note gates EG 1 and EG 2 and clocks S&H; the last key releases', () => {
  const st = panelStore();
  const m = st.getModel();
  const keys = PANEL.resolve(m).get('keys').id;
  const t = gateTargets(m, keys);
  assert.equal(t.envelopes.length, 2);
  assert.equal(t.clocks.length, 1);
  const { live, log } = fakeRun(m);
  live.event(keys, { kind: 'on', note: 60, velocity: 100, at: 1 });
  live.event(keys, { kind: 'on', note: 64, velocity: 100, at: 2 });
  live.event(keys, { kind: 'off', note: 64, at: 3 });
  live.event(keys, { kind: 'off', note: 60, at: 4 });
  assert.equal(log.filter((x) => x[0] === 'gate').length, 4, 'two notes x two envelopes');
  assert.deepEqual(log.filter((x) => x[0] === 'gate')[0].slice(2), [1, null]);
  assert.deepEqual(log.filter((x) => x[0] === 'clock').map((x) => x[3]), [0, 1]);
  assert.deepEqual(log.find((x) => x[0] === 'play' && x[1] === 3).slice(2), [60, true],
    'legato return, no new gate at 3');
  assert.equal(log.filter((x) => x[0] === 'release' && x[2] === 4).length, 2);
  assert.deepEqual(live.held(), []);
});

test('all-off releases every held key; a muted gate edge gates nothing', () => {
  const st = panelStore();
  const m = st.getModel();
  const keys = PANEL.resolve(m).get('keys').id;
  const { live, log } = fakeRun(m);
  live.event(keys, { kind: 'on', note: 60, at: 1 });
  live.event(keys, { kind: 'on', note: 62, at: 1 });
  assert.equal(live.allOff(5), 2);
  assert.equal(log.filter((x) => x[0] === 'release').length, 2);
  const gate = m.graph.edges.find((e) => e.from.node === keys && e.from.port === 'gate');
  st.dispatch({ type: 'EDGE_UPDATE', edgeId: gate.id, props: { muted: true } });
  assert.equal(gateTargets(st.getModel(), keys).envelopes.length
    + gateTargets(st.getModel(), keys).clocks.length, 2);
});

test('the armed model is the Keys component plus Master, with no timeline', () => {
  const st = panelStore();
  const m = st.getModel();
  const live = liveModel(m);
  const ids = new Set(PANEL.modules.map((x) => PANEL.resolve(m).get(x.id).id));
  assert.deepEqual(new Set(live.graph.nodes.map((n) => n.id)), ids);
  assert.equal(live.timeline.clips.length + live.timeline.automation.length, 0);
  assert.deepEqual([...keysGatedEnvelopes(m)].sort(),
    [PANEL.resolve(m).get('eg1').id, PANEL.resolve(m).get('eg2').id].sort());
});

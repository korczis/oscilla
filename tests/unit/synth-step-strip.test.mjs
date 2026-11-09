// K221: the Synth's step-sequencer strip (synth/step-strip.js) is a notes clip on the panel's Keys,
// edited through the one step-grid kind (W008: ui/kinds/step-grid-model.js createStepGrid, as the
// Studio Inspector's clip steps mount it) and played by the transport's notes path (K068).
//   - one BATCH adds the strip: an event track on the panel's Keys and a 16-step notes clip of
//     1/16 steps; a second one is refused, and so is a document without the panel's Keys
//   - toggling step 5 adds the grid note of the strip's clip at 4 x 1/16 beat (one CLIP_UPDATE),
//     toggling it again removes it
//   - the transport plays it: the panel's EG 1 (the Keys Gate's Envelope) attacks at step 5's
//     onset on the audio clock, baseTime + 1 beat at the document's tempo, on a whole frame
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { STRIP_TEXT, stripCreateAction, stripOf } from '../../src/js/synth/step-strip.js';
import { createStepGrid } from '../../src/js/ui/kinds/step-grid-model.js';
import { clipStepsView } from '../../src/js/ui/studio/inspector-steps.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { panelStore } from './synth-fixture.mjs';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 44100;

/** The panel's document with its strip, and the step grid over the strip's clip. */
function withStrip() {
  const st = panelStore();
  assert.equal(stripOf(st.getModel(), PANEL), null, 'no strip yet');
  const r = stripCreateAction(st.getModel(), PANEL);
  assert.ok(r.action, r.reason);
  const depth = st.debugInfo().undoDepth;
  assert.equal(st.dispatch(r.action).ok, true);
  assert.equal(st.debugInfo().undoDepth, depth + 1, 'one history entry');
  const strip = stripOf(st.getModel(), PANEL);
  const view = () => clipStepsView(st.getModel(), stripOf(st.getModel(), PANEL).clip);
  const v = view();
  const grid = createStepGrid({ mode: 'notes', clipId: v.clipId, payload: v.payload,
    lanes: v.lanes, laneNames: v.laneNames, steps: v.steps, stepBeats: v.stepBeats,
    commit: (action) => {
      const done = st.dispatch(action);
      return done.ok ? true : { refused: done.reason };
    },
    onView() {}, say() {} });
  const sync = () => grid.set({ payload: view().payload });
  return { st, strip, view, grid, sync };
}

test('one BATCH adds the strip on the panel\'s Keys: 16 steps of 1/16, refused twice', () => {
  const { st, strip, view } = withStrip();
  assert.equal(strip.track.kind, 'event');
  assert.equal(strip.track.target, strip.keys.id, 'the track plays the panel\'s Keys');
  assert.equal(strip.clip.kind, 'notes');
  const v = view();
  assert.deepEqual([v.steps, v.stepBeats], [16, 0.25]);
  assert.equal(stripCreateAction(st.getModel(), PANEL).reason, STRIP_TEXT.exists);
  const noKeys = panelStore();
  const keysId = PANEL.resolve(noKeys.getModel()).get('keys').id;
  assert.equal(noKeys.dispatch({ type: 'NODE_REMOVE', nodeIds: [keysId] }).ok, true);
  assert.equal(stripCreateAction(noKeys.getModel(), PANEL).reason, STRIP_TEXT.noKeys);
});

test('toggling step 5 adds and removes the grid note of the strip\'s clip, one entry each', () => {
  const { st, grid, view, sync } = withStrip();
  const depth = st.debugInfo().undoDepth;
  grid.down(0, 4);
  grid.up();
  sync();
  assert.deepEqual(view().payload.notes.map((n) => [n.at, n.note]), [[1, 60]],
    'step 5 is the note at 4 x 1/16 beat');
  assert.equal(st.debugInfo().undoDepth, depth + 1);
  grid.down(0, 4);
  grid.up();
  sync();
  assert.deepEqual(view().payload.notes, [], 'toggled again: off');
  assert.equal(st.debugInfo().undoDepth, depth + 2);
});

test('the transport plays step 5 at its onset: EG 1 attacks at baseTime + 1 beat', () => {
  const { st, strip, grid } = withStrip();
  grid.down(0, 4);
  grid.up();
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const transport = createStudioTransport({ runtime, engine, store: st });
  const started = transport.start({ position: 0 });
  assert.equal(started.ok, true, started.reason);
  fx.advance(1);
  assert.deepEqual(transport.debugInfo().unplayed.filter((u) => u.id === strip.clip.id), [],
    'the strip\'s clip plays');
  const eg1 = PANEL.resolve(st.getModel()).get('eg1').id;
  const contour = runtime.nodes.get(eg1).outputs.control.offset;
  const attack = st.getModel().graph.nodes.find((n) => n.id === eg1).params.attack;
  const onsets = contour.events.filter((e) => e.ramp === 'linear' && e.value === 1)
    .map((e) => e.t - attack);
  const beat = 60 / st.getModel().transport.tempo;
  const want = (Math.round(started.baseTime * SR) + Math.round(beat * SR)) / SR;
  assert.ok(onsets.some((t) => Math.abs(t - want) < 1e-6),
    `an attack at ${want} s (step 5), got ${onsets.map((t) => t.toFixed(6)).join(', ')}`);
  assert.ok(!onsets.some((t) => t < want - 1e-6), 'no attack before step 5');
});

// The Studio store handle's hold (docs/v31/performance.md editMs; plan K009): a command of many
// store actions (L tidies every node, M mutes every selected cable) reaches the projections
// once, at its end, with the last model change; outside a hold every change is one event.
//   src/js/ui/studio/workspace.js createStoreHandle hold(fn)
//   node --test tests/unit/studio-store-handle-batch.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createStoreHandle } from '../../src/js/ui/studio/workspace.js';

test('K009 hold sends one model event for many actions, after the last of them', () => {
  const handle = createStoreHandle(templateModel(REFERENCE_TEMPLATE_ID));
  const seen = [];
  handle.subscribe((ev) => seen.push({ type: ev.type, revision: ev.revision,
    now: handle.getRevision() }));
  const r0 = handle.getRevision();
  const out = handle.hold(() => {
    handle.beginGesture('Mute 3 connections');
    for (const edgeId of ['edge-1', 'edge-2', 'edge-4']) {
      handle.dispatch({ type: 'EDGE_UPDATE', edgeId, props: { muted: true } });
    }
    handle.dispatch({ type: 'SELECTION_CHANGE', selection: { edges: ['edge-1'] } });
    handle.endGesture();
    assert.deepEqual(seen, [], 'nothing reaches the listeners inside the hold');
    return 'done';
  });
  assert.equal(out, 'done', 'hold returns what fn returns');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, 'model', 'the model change wins over a later selection');
  assert.equal(seen[0].revision, r0 + 3);
  assert.equal(seen[0].now, r0 + 3);
  // Outside a hold: one event per change, as before.
  handle.dispatch({ type: 'EDGE_UPDATE', edgeId: 'edge-1', props: { muted: false } });
  handle.dispatch({ type: 'SELECTION_CHANGE', selection: {} });
  assert.deepEqual(seen.slice(1).map((e) => e.type), ['model', 'selection']);
});

test('K009 a hold whose fn throws still delivers what changed, and nests', () => {
  const handle = createStoreHandle(templateModel(REFERENCE_TEMPLATE_ID));
  const seen = [];
  handle.subscribe((ev) => seen.push(ev.type));
  assert.throws(() => handle.hold(() => {
    handle.hold(() => handle.dispatch({ type: 'EDGE_UPDATE', edgeId: 'edge-1',
      props: { muted: true } }));
    assert.deepEqual(seen, [], 'an inner hold waits for the outer one');
    throw new Error('boom');
  }), /boom/);
  assert.deepEqual(seen, ['model']);
  // A hold with no change sends nothing.
  handle.hold(() => null);
  assert.deepEqual(seen, ['model']);
});

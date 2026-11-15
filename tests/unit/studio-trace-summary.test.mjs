// The Studio Inspector's Trace texts (src/js/ui/studio/trace-summary.js): an operation's summary
// joins only the fields it has, so an absent outcome never reads "null" (the live visual audit
// of 2026-11-11, finding 6: "op-1 · bus leave · null"), and the closed Trace disclosure names
// how many operations it holds (oscilla-c3's amendment).
import test from 'node:test';
import assert from 'node:assert/strict';
import { opSummary, traceCount } from '../../src/js/ui/studio/trace-summary.js';

test('an absent outcome is left out, never written as null or undefined', () => {
  assert.equal(opSummary({ op: 'op-1', title: 'bus leave', outcome: null }), 'op-1 · bus leave');
  assert.equal(opSummary({ op: 'op-2', title: 'transport stop' }), 'op-2 · transport stop');
  assert.equal(opSummary({ op: 'op-3', title: 'Change Detune', outcome: 'committed, revision 4' }),
    'op-3 · Change Detune · committed, revision 4');
  for (const o of [{ op: 'op-4', title: '', outcome: null }, {}, null]) {
    assert.doesNotMatch(opSummary(o), /null|undefined/);
  }
});

test('the Trace disclosure names how many operations it holds', () => {
  assert.equal(traceCount({ total: 3, shown: 3 }), 'Operace (3)');
  assert.equal(traceCount({ total: 0 }), 'Operace (0)');
  assert.equal(traceCount(null), 'Operace (0)');
});

test('traceView: an operation or step with no outcome never reads null (visual audit finding 6)',
  async () => {
    const { traceView } = await import('../../src/js/ui/studio/inspector-runtime.js');
    const model = { graph: { nodes: [], edges: [] } };
    const steps = [
      { op: 'op-1', seq: 1, owner: 'transport', kind: 'stop', outcome: null, entity: null },
      { op: 'op-2', seq: 2, owner: 'bus', kind: 'leave', outcome: null, entity: null,
        detail: { reason: 'stop' } },
    ];
    const v = traceView(model, steps);
    assert.equal(v.ops.length, 2);
    for (const o of v.ops) {
      assert.doesNotMatch(o.outcome, /null|undefined/, o.outcome);
      for (const st of o.steps) assert.doesNotMatch(st.text, /null|undefined/, st.text);
    }
  });

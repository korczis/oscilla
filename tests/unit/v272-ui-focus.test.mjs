// V272 final review, reviewer C: the pure half of C5 (keyboard selection of a subset of
// nodes). The browser half, and C1 and C4, are checks of tests/browser/v31-studio-graph.cjs
// (v272-c1-timeline-focus, v272-c4-dialog-live, v272-c5-keyboard-multiselect).
import test from 'node:test';
import assert from 'node:assert';

import {
  STUDIO_SHORTCUTS, focusSelection, resolveStudioKey, toggleFocusedSelection,
} from '../../src/js/ui/studio/graph-keys.js';

const key = (k, extra = {}) => ({ key: k, code: '', ctrlKey: false, metaKey: false,
  shiftKey: false, altKey: false, ...extra });

test('V272 C5: T is the listed key that toggles the focused node, and plays nothing', () => {
  assert.deepEqual(resolveStudioKey(key('t')), { id: 'select-toggle' });
  assert.deepEqual(resolveStudioKey(key('T')), { id: 'select-toggle' });
  assert.equal(resolveStudioKey(key('T', { shiftKey: true })), null);
  assert.equal(resolveStudioKey(key('t', { ctrlKey: true })), null);
  const row = STUDIO_SHORTCUTS.find((s) => s.id === 'select-toggle');
  assert.ok(row && row.keys === 'T' && /selection/.test(row.text));
  // No other Studio row uses the key.
  assert.equal(STUDIO_SHORTCUTS.filter((s) => s.keys === 'T').length, 1);
});

test('V272 C5: focus on a member of a multi-selection keeps it; elsewhere it selects alone',
  () => {
    assert.equal(focusSelection(['osc-1', 'env-1'], 'env-1'), null);
    assert.equal(focusSelection(['osc-1'], 'osc-1'), null);
    assert.deepEqual(focusSelection(['osc-1', 'env-1'], 'filter-1'), ['filter-1']);
    assert.deepEqual(focusSelection(['osc-1'], 'env-1'), ['env-1']);
    assert.deepEqual(focusSelection([], 'env-1'), ['env-1']);
  });

test('V272 C5: T adds the focused node to the selection focus replaced, or takes it out', () => {
  // Tab from Oscillator 1 to Envelope 1 replaced [osc-1] with [env-1]: T joins them.
  assert.deepEqual(toggleFocusedSelection(['env-1'], 'env-1', ['osc-1']), ['osc-1', 'env-1']);
  // ...and a third the same way.
  assert.deepEqual(toggleFocusedSelection(['lfo-1'], 'lfo-1', ['osc-1', 'env-1']),
    ['osc-1', 'env-1', 'lfo-1']);
  // T on a selected member takes it out; on an unselected focused node adds it.
  assert.deepEqual(toggleFocusedSelection(['osc-1', 'env-1'], 'osc-1'), ['env-1']);
  assert.deepEqual(toggleFocusedSelection(['osc-1'], 'env-1'), ['osc-1', 'env-1']);
  // Focus that replaced nothing: T keeps the node selected instead of emptying the selection.
  assert.deepEqual(toggleFocusedSelection(['osc-1'], 'osc-1', []), ['osc-1']);
});

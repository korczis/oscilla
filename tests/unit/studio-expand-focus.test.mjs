// Expand's deferred focus (#417 webkit, P8): studioExpand switches to the Studio and focuses the
// graph in the next frame; that focus must not take focus back from a control the user moved to
// within the frame (a fast Tab to Back, a screen reader's jump), or Enter goes to the graph.
//   node --test tests/unit/studio-expand-focus.test.mjs
// Wiring: src/js/ui/studio/workspace/navigation.js focusMovedSince, called by studioExpand's
// requestAnimationFrame before it focuses the graph or a node; the browser leg is
// tests/browser/cross-links.cjs expand-focus.
// Namespace import: on 2195a7a3 the function is missing and the test fails on an assertion.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as nav from '../../src/js/ui/studio/workspace/navigation.js';

const el = (connected = true) => ({ isConnected: connected });

test('the deferred focus leaves a control the user moved to alone', () => {
  assert.equal(typeof nav.focusMovedSince, 'function', 'navigation.js exports focusMovedSince');
  const body = el();
  const expand = el();
  const back = el();
  assert.equal(nav.focusMovedSince(back, expand, body), true, 'moved to Back: keep it');
  assert.equal(nav.focusMovedSince(expand, expand, body), false, 'still on Expand: focus the graph');
  assert.equal(nav.focusMovedSince(body, expand, body), false, 'lost to <body>: focus the graph');
  assert.equal(nav.focusMovedSince(null, expand, body), false, 'nothing focused: focus the graph');
  assert.equal(nav.focusMovedSince(el(false), expand, body), false,
    'a removed element: focus the graph');
});

test('studioExpand asks focusMovedSince before its deferred focus', () => {
  assert.equal(typeof nav.focusMovedSince, 'function');
  const src = readFileSync(new URL('../../src/js/ui/studio/workspace/navigation.js',
    import.meta.url), 'utf8');
  const at = src.indexOf('studioExpand(');
  const body = src.slice(at, src.indexOf('\n    },', at));
  assert.match(body, /const from = document\.activeElement;/, 'captured before the switch');
  const ask = body.indexOf('focusMovedSince(document.activeElement, from, document.body)');
  assert.ok(ask > 0, 'the frame asks before focusing');
  assert.ok(ask < body.indexOf('focusViewport()') && ask < body.indexOf('focusNode(nodeId)'),
    'asked before the graph or a node takes focus');
});

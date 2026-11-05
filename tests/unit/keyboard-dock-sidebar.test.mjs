// The docked keys (Synth and Studio) sit beside the Pro sidebar from lg up, never under it: the
// sidebar is z-40 over the dock's z-30, so a full-width dock lost its left part, Arm keys
// included, to the sidebar's links (lane-A train, midi.cjs keyboard-everywhere, all engines).
//   node --test tests/unit/keyboard-dock-sidebar.test.mjs
// Wiring: midi/keyboard-ui.js kbdDockClass, bound by src/index.html's #osc-keyboard; the offsets
// are the workspace column's own (ui/shell.js lg:ml-16 / lg:ml-64).
// Fails on 0ce5290e: the dock's classes were a literal in index.html with inset-x-0 only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createKeyboardUi } from '../../src/js/midi/keyboard-ui.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** The part with `workspace` and the shell's sidebar state, as Alpine merges them. */
function part(workspace, sidebarCollapsed) {
  const p = createKeyboardUi({ win: {} });
  const o = Object.create(null);
  Object.defineProperties(o, Object.getOwnPropertyDescriptors(p));
  o.workspace = workspace;
  o.sidebarCollapsed = sidebarCollapsed;
  return o;
}

test('the docked keys start at the sidebar edge, expanded and collapsed', () => {
  for (const ws of ['synth', 'studio']) {
    const open = part(ws, false).kbdDockClass;
    assert.match(open, /\bfixed\b/, `${ws}: docked`);
    assert.match(open, /\blg:left-64\b/, `${ws}: beside the expanded sidebar`);
    assert.doesNotMatch(open, /\blg:left-16\b/);
    const icons = part(ws, true).kbdDockClass;
    assert.match(icons, /\blg:left-16\b/, `${ws}: beside the icon sidebar`);
    assert.doesNotMatch(icons, /\blg:left-64\b/);
  }
});

test('the Playground keys are not docked', () => {
  assert.equal(part('playground', false).kbdDockClass, '');
});

test('the offsets are the workspace column margins and the markup binds kbdDockClass', () => {
  const shell = read('src/js/ui/shell.js');
  assert.match(shell, /'lg:ml-16': this\.sidebarCollapsed, 'lg:ml-64': !this\.sidebarCollapsed/);
  const html = read('src/index.html');
  const at = html.indexOf('id="osc-keyboard"');
  assert.ok(at > 0);
  assert.match(html.slice(at, html.indexOf('>', at)), /:class="kbdDockClass"/);
});

// K178 (the owner's question of 2026-11-04: why does the keyboard behave differently in every
// workspace): what the keys play and whether they are armed comes from one declared table,
// src/js/midi/routes.js, and no other module keeps its own workspace -> sink or arm map.
//
//   node --test tests/unit/keys-routes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mod = await import('../../src/js/midi/routes.js').catch(() => ({}));

test('one table: each workspace names its sink, its first arm state and its leave', () => {
  assert.equal(typeof mod.routeOf, 'function');
  assert.deepEqual(Object.keys(mod.KEY_ROUTES).sort(), ['playground', 'studio', 'synth']);
  assert.deepEqual({ ...mod.KEY_ROUTES.synth },
    { plays: 'synthSink', armed: true, leave: null, editors: null, yieldsTo: 'xy-pad' });
  // The Studio's graph and timeline keep their letter shortcuts while they have the focus.
  assert.deepEqual({ ...mod.KEY_ROUTES.studio },
    { plays: 'studioSink', armed: true, leave: 'leave',
      editors: '[data-osc="studio.graph.viewport"], [data-osc="studio.timeline"]',
      yieldsTo: null });
  assert.equal(mod.KEY_ROUTES.playground.plays, null, 'the Playground voice plays');
  assert.equal(mod.routeOf('measure'), mod.KEY_ROUTES.playground, 'an unlisted workspace');
  // The owner's decision of 2026-11-05: the keys play at once in every workspace.
  assert.deepEqual(mod.armedDefaults(), { playground: true, synth: true, studio: true });
  assert.ok(Object.isFrozen(mod.KEY_ROUTES) && Object.isFrozen(mod.KEY_ROUTES.synth));
});

test('no other module keeps its own workspace -> sink or arm map', () => {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src/js'));
  const own = path.join(ROOT, 'src/js/midi/routes.js');
  const bad = files.filter((f) => f !== own).filter((f) => {
    const s = readFileSync(f, 'utf8');
    return /synth:\s*'synthSink'|studio:\s*'studioSink'|kbdArmed:\s*\{/.test(s);
  }).map((f) => path.relative(ROOT, f));
  assert.deepEqual(bad, [], 'a second owner of the routes');
  const ui = readFileSync(path.join(ROOT, 'src/js/midi/ui.js'), 'utf8');
  assert.match(ui, /routeOf\(cmp\.workspace\)\.plays/, 'the note route reads the table');
  assert.match(ui, /routeOf\(old\)/, 'leaving a workspace reads the table');
  assert.match(readFileSync(path.join(ROOT, 'src/js/midi/keyboard-ui.js'), 'utf8'),
    /kbdArmed: armedDefaults\(\)/, 'the arm switch starts from the table');
});

// 21's K3 on K178: with the keys armed in every workspace (stopImmediatePropagation on a played
// key), a page shortcut bound to a bare key the keyboard plays (a note key or Z X C V) would be
// swallowed unless its surface is a declared editor. No K153 binding may use one: a shortcut
// takes a modifier, or its surface goes in KEY_ROUTES' editors.
test('no page key binding uses a bare key the armed keyboard plays', async () => {
  const { NOTE_KEYS, CONTROL_KEYS } = await import('../../src/js/midi/keyboard.js');
  const played = new Set([...Object.keys(NOTE_KEYS), ...Object.keys(CONTROL_KEYS)]);
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src/js'));
  const bad = [];
  let bindings = 0;
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\bkeys:\s*\[([^\]]*)\]/g)) {
      bindings += 1;
      for (const c of m[1].matchAll(/'([^']+)'/g)) {
        if (played.has(c[1])) bad.push(`${path.relative(ROOT, f)}: ${c[1]}`);
      }
    }
  }
  assert.ok(bindings > 0, 'the scan finds the bindings');
  assert.deepEqual(bad, [], 'a bare played key bound as a shortcut');
});

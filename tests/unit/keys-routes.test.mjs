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
  assert.deepEqual(JSON.parse(JSON.stringify(mod.KEY_ROUTES.studio)),
    { plays: 'studioSink', armed: true, leave: 'leave',
      editors: '[data-osc="studio.graph.viewport"], [data-osc="studio.timeline"]',
      yieldsTo: null,
      keepsRoom: { toolbar: '[data-osc="studio.bar"]', editorMin: mod.STUDIO_EDITOR_MIN_PX,
        stackedBelow: 768 } });
  assert.equal(mod.KEY_ROUTES.playground.plays, null, 'the Playground voice plays');
  assert.equal(mod.routeOf('measure'), mod.KEY_ROUTES.playground, 'an unlisted workspace');
  // Q105 (the owner's answer of 2026-11-04, 'Armed everywhere'): the keys play at once everywhere.
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

// #444: with the Studio armed (Q105) the docked keys took the Studio's toolbar on a 375 x 667
// phone and squashed its graph at 1024 x 768 (layout.cjs, ui-current.cjs). The keys fold to their
// handle where they would take the room the route keeps; the computer keys stay armed (Q105 is
// about the keys being armed, not about the on-screen keys showing). Measured rooms of the
// Studio at those sizes (chromium, the dock docked): the band the keys take and the toolbar's
// bottom.
const STUDIO_ROOMS = {
  '375x667 phone': { viewH: 667, band: 308, toolbarBottom: 572, stacked: true, folds: true },
  '390x844 phone': { viewH: 844, band: 308, toolbarBottom: 572, stacked: true, folds: true },
  '1024x768': { viewH: 768, band: 296, toolbarBottom: 316, stacked: false, folds: true },
  '1280x800': { viewH: 800, band: 295, toolbarBottom: 298, stacked: false, folds: true },
  '1536x1024': { viewH: 1024, band: 295, toolbarBottom: 295, stacked: false, folds: false },
  '1920x1080': { viewH: 1080, band: 295, toolbarBottom: 295, stacked: false, folds: false },
};

test('#444: the Studio keeps its toolbar and editor room; the keys fold where they would take it', () => {
  const studio = mod.routeOf('studio');
  for (const [size, r] of Object.entries(STUDIO_ROOMS)) {
    const { folds, ...room } = r;
    assert.equal(mod.roomFolds({ route: studio, room }), folds, size);
    assert.equal(mod.dockState({ route: studio, room }), folds ? 'collapsed' : 'docked', size);
    // The user's expansion wins, for the session.
    assert.equal(mod.dockState({ route: studio, room, userExpanded: true }), 'docked', size);
  }
  // Both sides of the threshold on the desktop grid: the keys' top at the toolbar plus the
  // editor's minimum, one pixel short folds, exactly there stays docked.
  const at = 295 + mod.STUDIO_EDITOR_MIN_PX + 295;
  assert.equal(mod.roomFolds({ route: studio,
    room: { viewH: at - 1, band: 295, toolbarBottom: 295, stacked: false } }), true);
  assert.equal(mod.roomFolds({ route: studio,
    room: { viewH: at, band: 295, toolbarBottom: 295, stacked: false } }), false);
  // A stacked page keeps only its toolbar.
  assert.equal(mod.roomFolds({ route: studio,
    room: { viewH: 900, band: 300, toolbarBottom: 600, stacked: true } }), false);
  // No rule where the route keeps no room, and unknown input never folds.
  assert.equal(mod.roomFolds({ route: mod.routeOf('playground'),
    room: { viewH: 300, band: 295, toolbarBottom: 280, stacked: false } }), false);
  for (const room of [null, {}, { viewH: 667, band: 0, toolbarBottom: 572 },
    { viewH: NaN, band: 300, toolbarBottom: 500 }]) {
    assert.equal(mod.roomFolds({ route: studio, room }), false, JSON.stringify(room));
  }
});

test('#444: the Studio route\'s stacked width is studio.css\'s one-panel breakpoint', () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..',
    'src/styles/studio.css'), 'utf8');
  const below = mod.routeOf('studio').keepsRoom.stackedBelow;
  assert.match(css, new RegExp(`@media \\(max-width: ${below - 1}\\.98px\\)[\\s\\S]*?`
    + '\\.osc-studio\\s*\\{[^}]*grid-template-columns: minmax\\(0, 1fr\\);'),
  'the Studio stacks below the width the route keeps its toolbar at');
});

// K178 criterion 1: one module owns the keyboard state (octave, velocity, held notes, lights,
// armed) for the on-screen keys, QWERTY and MIDI, and no workspace keeps its own copy. The
// routes and the arm map have their one owner (routes.js, above); the octave, the velocity and
// the lit notes live in the one keyboard midi/keyboard.js creates, made once, by keyboard-ui.js;
// the held notes in the one map midi/held-notes.js creates, made once, by notes.js; and the
// velocity constants are read only where that keyboard keeps the velocity. A module that makes a
// second keyboard or held map, or keeps a velocity of its own from those constants, is a second
// owner.
const STATE_OWNERS = [
  { what: 'the keyboard (octave, velocity, lit notes)', re: /\bcreateKeyboard\s*\(/g,
    allowed: { 'src/js/midi/keyboard.js': 'defines', 'src/js/midi/keyboard-ui.js': 1 } },
  { what: 'the held notes', re: /\bcreateHeldNotes\s*\(/g,
    allowed: { 'src/js/midi/held-notes.js': 'defines', 'src/js/midi/notes.js': 1 } },
  { what: 'the velocity', re: /\b(?:DEFAULT_VELOCITY|VELOCITY_STEP|MIN_VELOCITY|MAX_VELOCITY)\b/g,
    allowed: { 'src/js/midi/keyboard.js': 'defines' } },
];

/** Every second owner of the keys' state in `files` ({ 'src/js/...': text }). */
function secondOwners(files) {
  const bad = [];
  for (const { what, re, allowed } of STATE_OWNERS) {
    for (const [file, text] of Object.entries(files)) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      const n = (code.match(re) || []).length;
      if (!n) continue;
      const ok = allowed[file];
      if (ok === 'defines') continue;
      if (ok === undefined) bad.push(`${file}: a second owner of ${what}`);
      else if (n > ok) bad.push(`${file}: ${n} of ${what}, at most ${ok}`);
    }
  }
  return bad;
}

function sources() {
  const files = {};
  const walk = (d) => {
    for (const e of readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files[p] = readFileSync(path.join(ROOT, p), 'utf8');
    }
  };
  walk('src/js');
  return files;
}

test('K178 c1: one owner of the keys\' octave, velocity, held notes and lights', () => {
  const files = sources();
  assert.deepEqual(secondOwners(files), [], 'a second owner of the keys\' state');
  // Each owner is made where the table says, so the guard is not vacuous.
  assert.match(files['src/js/midi/keyboard-ui.js'], /\bcreateKeyboard\s*\(/);
  assert.match(files['src/js/midi/notes.js'], /\bcreateHeldNotes\s*\(/);
  assert.match(files['src/js/midi/keyboard.js'], /let velocity = DEFAULT_VELOCITY/);
});

test('K178 c1, seeded: a second keyboard, held map or velocity is refused', () => {
  const files = sources();
  const seeds = [
    ['src/js/synth/second-keys.js', 'const kb = createKeyboard({ play });', 'the keyboard'],
    ['src/js/ui/second-held.js', 'const held = createHeldNotes();', 'the held notes'],
    ['src/js/labs/second-velocity.js', 'let velocity = DEFAULT_VELOCITY;', 'the velocity'],
  ];
  for (const [file, text, what] of seeds) {
    const bad = secondOwners({ ...files, [file]: text });
    assert.equal(bad.length, 1, `${file}: refused`);
    assert.match(bad[0], new RegExp(`${file.replace(/[/.]/g, '\\$&')}: a second owner of ${what}`));
  }
  // A second keyboard made by the one owner itself is refused too.
  const twice = { ...files, 'src/js/midi/keyboard-ui.js':
    `${files['src/js/midi/keyboard-ui.js']}\nconst again = createKeyboard({});` };
  assert.match(secondOwners(twice).join(), /keyboard-ui\.js: 2 of the keyboard/);
  // A mention in a comment is no owner.
  assert.deepEqual(secondOwners({ ...files, 'src/js/x.js': '// createKeyboard() lives in midi' }),
    []);
});

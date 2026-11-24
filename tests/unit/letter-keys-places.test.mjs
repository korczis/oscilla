// U134 (the owner's decision Q114, 2026-11-24, 'Instrument places + switch (Recommended)':
// "Letter keys play in Synth, Studio and Generátor/Playground, with one global on/off switch
// shown in the strip; other pages stay silent"; WCAG 2.1.4). Whether a letter key plays is one
// decision, routes.js lettersPlay, read from the one route table (its rows' letters) and the one
// global switch (keyboard-ui.js kbdLetters, kept per browser under LETTERS_KEY). The workspaces
// are the shell registry's (ui/shell.js WORKSPACE_IDS), never typed here; only the owner's three
// instrument places are.
//
//   node --test tests/unit/letter-keys-places.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { WORKSPACE_IDS } from '../../src/js/ui/shell.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROUTES = path.join(ROOT, 'src/js/midi/routes.js');
const routes = await import('../../src/js/midi/routes.js');
const keyboard = await import('../../src/js/midi/keyboard.js');
const ui = await import('../../src/js/midi/keyboard-ui.js').catch(() => ({}));

/** Q114: the Synth, the Studio and the Generátor (= the Playground, Q114 question 2). */
const INSTRUMENT_PLACES = ['playground', 'studio', 'synth'];

/** Every way `mod` (a routes.js) breaks Q114 over `ids`: [] when none. */
function offences(mod, ids) {
  const bad = [];
  if (typeof mod.lettersPlay !== 'function') return ['no lettersPlay'];
  for (const ws of ids) {
    const want = INSTRUMENT_PLACES.includes(ws);
    if (mod.lettersPlay(ws, true) !== want) bad.push(`${ws}: switch on, plays ${!want}`);
    if (mod.lettersPlay(ws, false) !== false) bad.push(`${ws}: switch off, still plays`);
  }
  const derived = ids.filter((ws) => mod.lettersPlay(ws, true));
  if (JSON.stringify([...(mod.LETTER_PLACES || [])]) !== JSON.stringify(derived)) {
    bad.push('LETTER_PLACES is not the table\'s');
  }
  return bad;
}

test('KeyA plays in the Synth, the Studio and the Playground and in no other workspace', () => {
  assert.deepEqual(offences(routes, WORKSPACE_IDS), []);
  const silent = WORKSPACE_IDS.filter((ws) => !routes.lettersPlay(ws, true));
  // The pages the owner's question named stay silent (Měření, Experimenty, Výuka, O aplikaci).
  for (const ws of ['measure', 'experiments', 'learn', 'about']) {
    assert.ok(WORKSPACE_IDS.includes(ws), `${ws} is a workspace of the shell`);
    assert.ok(silent.includes(ws), `${ws} stays silent`);
  }
  assert.equal(silent.length, WORKSPACE_IDS.length - INSTRUMENT_PLACES.length);
  // Unknown places and a switch that is not exactly on never play.
  for (const [ws, on] of [[null, true], ['nowhere', true], ['synth', 1], ['synth', 'on'],
    ['synth', undefined]]) {
    assert.equal(routes.lettersPlay(ws, on), false, `${ws}, ${on}`);
  }
  // The keyboard's views and the shortcuts dialog read the same derived list.
  assert.deepEqual([...keyboard.KEYBOARD_VIEWS], [...routes.LETTER_PLACES]);
  assert.equal(routes.DEFAULT_ROUTE.letters, false, 'an unlisted workspace is silent');
});

test('mutation: a silent page that plays, a dropped place, an ignored switch', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'u134-routes-all-'));
  const src = readFileSync(ROUTES, 'utf8').replace("'../ui/shell.js'",
    `'${pathToFileURL(path.join(ROOT, 'src/js/ui/shell.js')).href}'`);
  const seeds = [
    [/(DEFAULT_ROUTE = Object\.freeze\(\{ plays: 'keysInstrument', letters: )false/, '$1true'],
    [/(studio: Object\.freeze\(\{ plays: 'keysInstrument', letters: )true/, '$1false'],
    [/=> on === true\n/, '=> true\n'],
  ];
  let i = 0;
  for (const [re, to] of seeds) {
    assert.match(src, re, `seed ${i} applies`);
    const file = path.join(dir, `seed-${i}.mjs`);
    writeFileSync(file, src.replace(re, to));
    const mod = await import(pathToFileURL(file).href);
    assert.notDeepEqual(offences(mod, WORKSPACE_IDS), [], `seed ${i} refused`);
    i += 1;
  }
});

test('no second list of the instrument places in src/js', () => {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src/js'));
  const q = "'(?:playground|studio|synth)'";
  const list = new RegExp(`\\[\\s*${q}\\s*,\\s*${q}\\s*,\\s*${q}\\s*\\]`);
  const scan = (texts) => Object.entries(texts).filter(([, s]) => list.test(s)).map(([f]) => f);
  const texts = Object.fromEntries(files.map((f) => [path.relative(ROOT, f),
    readFileSync(f, 'utf8')]));
  assert.deepEqual(scan(texts), [], 'a hand-typed list of the letter places');
  const seeded = { ...texts,
    'src/js/ui/x.js': "const KEYS_HERE = ['synth', 'studio', 'playground'];" };
  assert.deepEqual(scan(seeded), ['src/js/ui/x.js'], 'the scan finds a seeded list');
});

/** A Web Storage fake; `broken` throws as a blocked one does. */
function storage({ broken = false } = {}) {
  const m = new Map();
  const guard = () => { if (broken) throw new Error('SecurityError'); };
  return {
    map: m,
    getItem(k) { guard(); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { guard(); m.set(k, String(v)); },
  };
}

/** Run `fn` with `store` as the page's localStorage (core/storage.js reads window lazily). */
function withStorage(store, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const was = globalThis.window;
  globalThis.window = store === undefined ? {} : { localStorage: store };
  try { return fn(); } finally { if (had) globalThis.window = was; else delete globalThis.window; }
}

test('the switch is kept per browser: default on, off survives a reload, no storage is on', () => {
  assert.equal(ui.LETTERS_KEY, 'oscilla.v2.letterKeys');
  const ls = storage();
  withStorage(ls, () => {
    assert.equal(ui.readLetters(), true, 'nothing stored: on');
    const a = ui.createKeyboardUi({ win: {} });
    assert.equal(a.kbdLetters, true);
    const c = Object.defineProperties({ workspace: 'synth' },
      Object.getOwnPropertyDescriptors(a));
    assert.equal(c.kbdArmedHere, true, 'on in the Synth');
    c.kbdToggle();
    assert.equal(c.kbdLetters, false);
    assert.equal(c.kbdArmedHere, false, 'the switch off disarms the Synth');
    assert.equal(ls.map.get(ui.LETTERS_KEY), 'off', 'kept');
    for (const ws of WORKSPACE_IDS) {
      c.workspace = ws;
      assert.equal(c.kbdArmedHere, false, `off: ${ws} silent`);
    }
    assert.equal(ui.createKeyboardUi({ win: {} }).kbdLetters, false, 'a reload keeps it off');
    c.kbdToggle();
    assert.equal(ls.map.get(ui.LETTERS_KEY), 'on');
    assert.equal(ui.createKeyboardUi({ win: {} }).kbdLetters, true, 'and on again');
  });
  withStorage(storage({ broken: true }), () => {
    assert.equal(ui.readLetters(), true, 'blocked storage: on');
    assert.equal(ui.writeLetters(false), false, 'and nothing kept');
  });
  withStorage(undefined, () => assert.equal(ui.readLetters(), true, 'no storage at all: on'));
});

test('the readout and the switch name the places from the shell, never typed', async () => {
  const { WORKSPACE_LABELS } = await import('../../src/js/ui/shell.js');
  const labels = routes.LETTER_PLACES.map((id) => WORKSPACE_LABELS[id]);
  for (const l of labels) assert.ok(ui.LETTER_PLACE_NAMES.includes(l), l);
  const c = Object.defineProperties({ workspace: 'measure', kbdRange: 'C4 až F5' },
    Object.getOwnPropertyDescriptors(ui.createKeyboardUi({ win: {} })));
  assert.match(c.kbdReadout, /tu nehraje/);
  assert.ok(c.kbdReadout.includes(ui.LETTER_PLACE_NAMES));
  c.workspace = 'synth';
  assert.match(c.kbdReadout, /^Klávesy jsou připravené/);
  c.kbdLetters = false;
  assert.match(c.kbdReadout, /vypnutá přepínačem Klávesnice hraje/);
  assert.match(c.kbdSwitchTitle, /vypnuto/);
});

test('the one switch is in the status bar: a Pro toggle, role=switch, aria-checked, Czech', () => {
  const hook = 'data-osc="keyboard.arm"';
  const html = readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
  const bar = html.slice(html.indexOf('<footer class="osc-statusbar"'),
    html.indexOf('</footer>', html.indexOf('<footer class="osc-statusbar"')));
  const at = bar.indexOf(hook);
  const tag = at < 0 ? null
    : [bar.slice(bar.lastIndexOf('<button', at), bar.indexOf('</button>', at) + 9)];
  assert.ok(tag, 'the switch is in the status bar');
  assert.match(tag[0], /role="switch"/);
  assert.match(tag[0], /:aria-checked="String\(kbdLetters\)"/);
  assert.match(tag[0], /@click="kbdToggle\(\)"/);
  assert.match(tag[0], />Klávesnice hraje</);
  assert.equal(html.split(hook).length - 1, 1, 'one switch, no Arm in the dock');
  for (const part of ['button', 'track', 'label']) {
    assert.match(tag[0], new RegExp(`:class="kbdSwitch\\.${part}"`), part);
  }
  assert.match(ui.KBD_SWITCH.track, /group-aria-checked:bg-primary-600/, 'the Flowbite toggle');
  assert.doesNotMatch(Object.values(ui.KBD_SWITCH).join(' '), /\bosc-/, 'no osc-* tokens');
});

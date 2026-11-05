// Workspace navigation and the unsaved-work guard, pure halves (ledger W2, W4; ADR 0045):
// the one hash -> (workspace, V1 mode) mapping and its precedence, the hash a workspace switch
// writes, Copy config URL keeping the other domains' keys, and the guard registering a
// beforeunload listener only while something would be lost. The browser half is
// tests/browser/navigation.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  HASH_DOMAINS, configLinkHash, hashAfterRefusal, hashForWorkspace, isAnchorHash,
  navigationStateOf, routeOfHash, v1ModeFor, workspaceForV1Mode,
} from '../../src/js/ui/navigation.js';
import { createMemoryStore, observeMemoryStore } from '../../src/js/experiments/store.js';
import { WORKSPACES } from '../../src/js/ui/app.js';
import { collectUnsaved, createUnsavedGuard } from '../../src/js/ui/unsaved.js';
import { decodeHash, serializeHash } from '../../src/js/core/url-state.js';
import { decodeStudioLink } from '../../src/js/core/url-state-studio.js';
import { recipeParamOf } from '../../src/js/core/url-state-measure.js';
import { defaultInstrumentState, defaultEditorFields } from '../../src/js/core/config.js';

const { mask } = createRequire(import.meta.url)('../browser/lib/timing-scan.cjs');

const RECIPE = Buffer.from(JSON.stringify({ v: 1, f1: 50, f2: 12000 })).toString('base64url');
const q = (hash) => Object.fromEntries(new URLSearchParams(hash.replace(/^#/, '')));

test('every workspace id in m names that workspace, with or without #', () => {
  for (const ws of WORKSPACES) {
    assert.deepEqual(routeOfHash(`#m=${ws}`).workspace, ws, ws);
    assert.deepEqual(routeOfHash(`m=${ws}&v=1&f=440`).workspace, ws, ws);
  }
});

test('V1 mode ids in m map to their workspace; the V1 mode follows workspace and source', () => {
  assert.equal(routeOfHash('#v=1&m=sweep&s=sweep').workspace, 'playground');
  assert.equal(routeOfHash('#v=1&m=dual&s=dual').workspace, 'synthesis');
  assert.deepEqual(navigationStateOf('#v=1&m=learn&f=440', 'single'),
    { workspace: 'learn', owner: 'workspace', mode: 'learn' });
  assert.equal(navigationStateOf('#v=1&m=dual&s=dual', 'dual').mode, 'dual');
  assert.equal(navigationStateOf('#v=1&m=sweep&s=sweep', 'sweep').mode, 'sweep');
  assert.equal(navigationStateOf('#m=measure', 'dual').mode, 'dual');
  for (const m of ['playground', 'sweep', 'dual', 'presets', 'learn']) {
    assert.equal(routeOfHash(`#m=${m}`).workspace, workspaceForV1Mode(m), m);
  }
  // Load and hashchange share this mapping: mode and workspace cannot disagree.
  for (const ws of WORKSPACES) {
    for (const src of ['single', 'sweep', 'dual']) {
      const st = navigationStateOf(`#m=${ws}`, src);
      assert.equal(st.mode, v1ModeFor(st.workspace, src));
    }
  }
});

test('precedence: Studio keys > m > mr > Playground (ADR 0045)', () => {
  assert.deepEqual(routeOfHash(`#m=studio&mr=${RECIPE}`), { workspace: 'studio', owner: 'studio' });
  assert.deepEqual(routeOfHash(`#mr=${RECIPE}&m=studio&st=basic-tone`),
    { workspace: 'studio', owner: 'studio' });
  // st / sv without m=studio still belong to Studio, whose link refuses them: no other route.
  assert.equal(routeOfHash('#st=basic-tone').owner, 'studio');
  assert.equal(routeOfHash('#m=learn&sv=graph').owner, 'studio');
  assert.deepEqual(routeOfHash(`#m=learn&mr=${RECIPE}`), { workspace: 'learn', owner: 'workspace' });
  assert.deepEqual(routeOfHash(`#v=1&f=440&mr=${RECIPE}`), { workspace: 'measure', owner: 'measure' });
  assert.deepEqual(routeOfHash('#v=1&f=440'), { workspace: 'playground', owner: null });
  assert.deepEqual(routeOfHash(''), { workspace: 'playground', owner: null });
  // An m naming no page, or two pages, is refused (badRoute) and changes no workspace.
  assert.deepEqual(routeOfHash('#v=1&m=nowhere&f=440'),
    { workspace: 'playground', owner: 'workspace', badRoute: ['nowhere'] });
  assert.deepEqual(routeOfHash('#m=learn&m=dual'),
    { workspace: 'playground', owner: 'workspace', badRoute: ['learn', 'dual'] });
});

test('an in-page anchor is not a route', () => {
  assert.equal(isAnchorHash('#osc-main'), true);
  assert.equal(isAnchorHash(''), false);
  assert.equal(isAnchorHash('#m=measure'), false);
  assert.equal(routeOfHash('#osc-main'), null);
  assert.equal(hashForWorkspace('#osc-main', 'measure'), 'm=measure');
});

test('a workspace switch sets m, keeps the other keys and drops the Studio keys off STUDIO', () => {
  const s = serializeHash({ ...defaultInstrumentState(), ...defaultEditorFields() }, 'learn');
  const h = `${s}&mr=${RECIPE}`;
  const out = hashForWorkspace(h, 'measure');
  assert.equal(q(out).m, 'measure');
  assert.equal(q(out).mr, RECIPE);
  assert.deepEqual(decodeHash(out).cfg, decodeHash(h).cfg, 'the instrument keys are untouched');
  const studio = hashForWorkspace(`${h}&st=basic-tone&sv=timeline`, 'studio');
  assert.equal(q(studio).st, 'basic-tone');
  const left = hashForWorkspace(studio, 'playground');
  assert.equal(q(left).m, 'playground');
  assert.equal('st' in q(left) || 'sv' in q(left), false);
  assert.equal(decodeStudioLink(left), null, 'leaving STUDIO leaves no refused Studio link');
  assert.equal(routeOfHash(left).workspace, 'playground');
  assert.equal(hashForWorkspace('', 'about'), 'm=about');
  // Every written hash routes back to its workspace.
  for (const ws of WORKSPACES) assert.equal(routeOfHash(hashForWorkspace(h, ws)).workspace, ws);
});

test('Copy config URL keeps mr and the Studio keys and names the workspace', () => {
  const instrument = serializeHash({ ...defaultInstrumentState(), ...defaultEditorFields(),
    frequency: 523.25 }, 'playground');
  const current = `#m=studio&st=basic-tone&sv=timeline&mr=${RECIPE}&v=1&f=440&x=stale`;
  const out = configLinkHash(current, instrument, 'studio');
  const p = q(out);
  assert.equal(p.m, 'studio');
  assert.equal(p.st, 'basic-tone');
  assert.equal(p.sv, 'timeline');
  assert.equal(p.mr, RECIPE);
  assert.equal(p.f, '523.25', 'the instrument keys are the current ones');
  assert.equal('x' in p, 'x' in q(instrument), 'a stale instrument key is not carried');
  assert.equal(recipeParamOf(out), RECIPE);
  assert.equal(decodeStudioLink(out).ok, true);
  assert.equal(routeOfHash(out).workspace, 'studio');
  // In the Playground after a m=learn link: the link names the Playground, not Learn.
  const pg = configLinkHash('#v=1&m=learn&f=440', serializeHash({ ...defaultInstrumentState(),
    ...defaultEditorFields() }, 'learn'), 'playground');
  assert.equal(q(pg).m, 'playground');
  assert.equal(routeOfHash(pg).workspace, 'playground');
  // Off STUDIO the Studio keys would be a refused link: they are dropped.
  const off = configLinkHash('#m=studio&st=basic-tone', instrument, 'measure');
  assert.equal(decodeStudioLink(off), null);
  assert.equal(configLinkHash('#osc-main', instrument, 'measure').includes('osc-main'), false);
});

test('the dispatcher applies the domains in one declared order', () => {
  assert.deepEqual([...HASH_DOMAINS], ['instrument', 'labs', 'measure', 'studio',
    'keyboard', 'synth', 'records']);
});

function fakeWindow() {
  const listeners = new Set();
  return {
    listeners,
    addEventListener(type, fn) { if (type === 'beforeunload') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'beforeunload') listeners.delete(fn); },
  };
}

test('the guard holds a beforeunload listener only while something would be lost', () => {
  const win = fakeWindow();
  const state = { studio: false, measure: false };
  const guard = createUnsavedGuard({ win, sources: [
    () => (state.studio ? [{ domain: 'studio', label: 'Unsaved changes to X' }] : []),
    () => (state.measure ? [{ domain: 'measure', label: 'A completed measurement' }] : []),
  ] });
  assert.deepEqual(guard.update(), []);
  assert.equal(win.listeners.size, 0, 'a clean page registers nothing');
  assert.equal(guard.armed, false);
  state.studio = true;
  guard.update();
  assert.equal(win.listeners.size, 1);
  state.measure = true;
  assert.deepEqual(guard.update().map((x) => x.domain), ['studio', 'measure']);
  assert.equal(win.listeners.size, 1, 'one listener, however many domains');
  state.studio = false;
  guard.update();
  assert.equal(win.listeners.size, 1);
  state.measure = false;
  guard.update();
  assert.equal(win.listeners.size, 0, 'saved: the listener is gone');
  assert.equal(guard.armed, false);
});

test('the listener asks the browser to confirm; a failing source reports nothing', () => {
  const win = fakeWindow();
  const guard = createUnsavedGuard({ win, sources: [() => [{ domain: 'studio', label: 'x' }]] });
  guard.update();
  const [fn] = win.listeners;
  const e = { defaultPrevented: false, returnValue: undefined,
    preventDefault() { this.defaultPrevented = true; } };
  fn(e);
  assert.equal(e.defaultPrevented, true);
  assert.equal(e.returnValue, '');
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(collectUnsaved([() => { throw new Error('boom'); },
      () => [{ domain: 'measure', label: 'y' }, { domain: 1 }, null]]),
    [{ domain: 'measure', label: 'y' }]);
  } finally {
    console.error = quiet;
  }
});

test('a refused link leaves the address: its keys out, m the workspace the user stays in', () => {
  const studio = hashAfterRefusal('#m=studio&st=no-such-template&v=1&f=440',
    { instrument: undefined, measure: null, studio: false }, 'playground');
  assert.deepEqual(q(studio), { m: 'playground', v: '1', f: '440' });
  assert.equal(routeOfHash(studio).workspace, 'playground');
  const recipe = hashAfterRefusal('#mr=bad', { measure: false, studio: null }, 'analyzer');
  assert.deepEqual(q(recipe), { m: 'analyzer' });
  const both = hashAfterRefusal(`#m=learn&mr=bad&sv=mixer`, { measure: false, studio: false },
    'learn');
  assert.deepEqual(q(both), { m: 'learn' });
  // A domain that accepted keeps its keys.
  const kept = hashAfterRefusal(`#m=studio&st=basic-tone&mr=bad`, { measure: false, studio: true },
    'studio');
  assert.deepEqual(q(kept), { m: 'studio', st: 'basic-tone' });
});

test('every nav item links to its workspace address (a new tab opens it)', () => {
  const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');
  const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*data-osc="nav\.([a-z]+)"/g)]
    .map((m) => ({ href: m[1], id: m[2] }));
  assert.deepEqual(links.map((l) => l.id).sort(), [...WORKSPACES].sort());
  for (const l of links) {
    assert.equal(l.href, `#m=${l.id}`);
    assert.equal(routeOfHash(l.href).workspace, l.id);
  }
});

// The browser suites' own workspace lists: a check that visits every workspace reads them from
// WORKSPACES, so a new workspace is visited without an edit there (a hand-written twelve left
// Synth out of navigation.cjs open-every-workspace and first-screen.cjs ENTRIES). The browser
// scans' mask blanks comments and string contents, so what a comment quotes is not read as code.
const NAV_SUITE = new URL('../browser/navigation.cjs', import.meta.url);
const FIRST_SCREEN_SUITE = new URL('../browser/first-screen.cjs', import.meta.url);

function browserCheckBlock(source, code, id) {
  const head = `def('${id}'`;
  let at = source.indexOf(head);
  while (at >= 0 && code.slice(at, at + 4) !== 'def(') at = source.indexOf(head, at + 1);
  assert.ok(at >= 0, `tests/browser/navigation.cjs defines ${id}`);
  const next = code.indexOf('\n  def(', at + head.length);
  const end = next < 0 ? source.length : next;
  return { text: source.slice(at, end), code: code.slice(at, end) };
}

/** The array literals of string literals only (either quote) in a block, as their values. */
function stringArrays(block) {
  const lit = String.raw`(?:'[^'\n]*'|"[^"\n]*")`;
  const re = new RegExp(String.raw`\[\s*${lit}(?:\s*,\s*${lit})*\s*,?\s*\]`, 'g');
  const out = [];
  for (const m of block.text.matchAll(re)) {
    if (block.code[m.index] !== '[') continue; // inside a comment or a string
    out.push([...m[0].matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((s) => s[1] ?? s[2]));
  }
  return out;
}

/** The matches of a pattern that are code throughout: none of it in a comment or a string. */
function codeMatches(block, re) {
  return [...block.text.matchAll(re)]
    .filter((m) => mask(m[0]).code === block.code.slice(m.index, m.index + m[0].length));
}

/** No list of workspace ids is written out: the suite reads WORKSPACES instead. */
function assertNoHandList(label, block) {
  const known = new Set(WORKSPACES);
  for (const list of stringArrays(block)) {
    if (list.length < 2 || !list.every((w) => known.has(w))) continue;
    const missing = WORKSPACES.filter((w) => !list.includes(w));
    assert.fail(`${label} hard-codes ${list.length} workspace ids against ${WORKSPACES.length} `
      + `in WORKSPACES (missing: ${missing.join(', ') || 'none'}); read WORKSPACES instead`);
  }
}

/**
 * Every use of WORKSPACES in the code of a block is one of the whole-list forms named, and the
 * required ones are there: a filtered, sliced or shortened copy is none of them, so it drops no
 * workspace unnoticed.
 */
function assertWholeList(label, block, forms, required) {
  const covered = [];
  const found = {};
  for (const [name, re] of Object.entries(forms)) {
    found[name] = codeMatches(block, re);
    for (const m of found[name]) covered.push([m.index, m.index + m[0].length]);
  }
  for (const name of required) {
    assert.ok(found[name].length,
      `${label} has no ${name} of the whole WORKSPACES (${forms[name]})`);
  }
  for (const m of block.code.matchAll(/\bWORKSPACES\b/g)) {
    if (covered.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const line = block.text.slice(block.text.lastIndexOf('\n', m.index) + 1).split('\n')[0];
    assert.fail(`${label} uses WORKSPACES other than as the whole list: ${line.trim()}`);
  }
}

// ui/app.js WORKSPACES imported as the browser suites do (a file URL of src/js/ui/app.js).
const APP_URL = String.raw`pathToFileURL\(path\.join\([^()]*'src',\s*'js',\s*'ui',\s*'app\.js'\)\)`
  + String.raw`\s*\.href`;
const NAV_FORMS = {
  'import from ui/app.js': new RegExp(String.raw`const \{ WORKSPACES \} = await import\(`
    + String.raw`${APP_URL}\);`, 'g'),
  'loop over': /for \(const \w+ of WORKSPACES\) \{/g,
  'sorted copy': /\[\.\.\.WORKSPACES\]\.sort\(\)\.join\(\)/g,
};
const FIRST_SCREEN_FORMS = {
  declaration: /const WORKSPACES = \[\];/g,
  'fill from ui/app.js': new RegExp(String.raw`WORKSPACES\.push\(\.\.\.\(await import\(`
    + String.raw`${APP_URL}\)\)\.WORKSPACES\);`, 'g'),
  'entry per workspace': new RegExp(String.raw`\.\.\.WORKSPACES\.map\(\((\w+)\) => \(\{ `
    + String.raw`id: \`m=\$\{\1\}\`, hash: \`m=\$\{\1\}\`, workspace: \1 \}\)\),`, 'g'),
};

function navigationDerivesWorkspaces(source) {
  const { code } = mask(source);
  for (const [id, required] of [['open-every-workspace', ['import from ui/app.js', 'loop over']],
    ['nav-links', ['import from ui/app.js', 'sorted copy']]]) {
    const block = browserCheckBlock(source, code, id);
    assertNoHandList(id, block);
    assertWholeList(id, block, NAV_FORMS, required);
  }
}

function firstScreenDerivesWorkspaces(source) {
  const block = { text: source, code: mask(source).code };
  assertNoHandList('first-screen.cjs', block);
  assertWholeList('first-screen.cjs', block, FIRST_SCREEN_FORMS, Object.keys(FIRST_SCREEN_FORMS));
}

test('navigation.cjs visits every workspace WORKSPACES names, with no hand-written list', () => {
  navigationDerivesWorkspaces(readFileSync(NAV_SUITE, 'utf8'));
});

test('first-screen.cjs has an entry per workspace WORKSPACES names, none hand-written', () => {
  firstScreenDerivesWorkspaces(readFileSync(FIRST_SCREEN_SUITE, 'utf8'));
});

test('mutation: a list quoted in a comment is not code, one in code is (either quote)', () => {
  const source = [
    '  def(\'open-every-workspace\', async (ctx) => {',
    '    // [\'playground\', \'about\'] in a comment is not code',
    '    const ids = [\'playground\', \'measure\', \'about\'];',
    '    const more = ["learn", "studio"];',
    '  });',
    '  def(\'next\', async () => ({}));',
  ].join('\n');
  const block = browserCheckBlock(source, mask(source).code, 'open-every-workspace');
  assert.deepEqual(stringArrays(block), [['playground', 'measure', 'about'], ['learn', 'studio']]);
});

test('mutation: a workspace list that is hand-written, filtered or not imported is refused', () => {
  const nav = readFileSync(NAV_SUITE, 'utf8');
  const loop = 'for (const ws of WORKSPACES) {';
  const sorted = '[...WORKSPACES].sort().join()';
  const imp = '\'ui\', \'app.js\')).href);';
  for (const [i, mutate, refusal] of [
    [1, (s) => s.replace(loop, 'for (const ws of ["playground", "measure", "about"]) {'),
      /hard-codes 3 workspace ids/],
    [2, (s) => s.replace(loop, 'for (const ws of WORKSPACES.filter((w) => w !== \'synth\')) {'),
      /no loop over|other than as the whole list/],
    [3, (s) => s.replace(loop, 'for (const ws of WORKSPACES.slice(0, 12)) {'),
      /no loop over|other than as the whole list/],
    [4, (s) => s.replace(sorted, '[...WORKSPACES].slice(1).sort().join()'),
      /no sorted copy|other than as the whole list/],
    // The real import is elsewhere; a comment quoting the ui/app.js import does not stand in.
    [5, (s) => s.replace(imp, '\'ui\', \'navigation.js\')).href);\n    // const { WORKSPACES } = '
      + 'await import(pathToFileURL(path.join(__dirname, \'..\', \'..\', \'src\', \'js\', '
      + '\'ui\', \'app.js\')).href);'), /no import from ui\/app\.js|other than as the whole list/],
    // A loop over another list; a comment quoting the whole-list loop does not stand in.
    [6, (s) => s.replace(loop, '// for (const ws of WORKSPACES) {\n    for (const ws of ids) {'),
      /no loop over/],
  ]) {
    const mutated = mutate(nav);
    assert.notEqual(mutated, nav, `navigation mutation ${i} applies`);
    assert.throws(() => navigationDerivesWorkspaces(mutated), refusal, `navigation mutation ${i}`);
  }
  const fs = readFileSync(FIRST_SCREEN_SUITE, 'utf8');
  const map = '...WORKSPACES.map((w) =>';
  for (const [i, mutate, refusal] of [
    [1, (s) => s.replace('const WORKSPACES = [];', 'const WORKSPACES = [\'playground\', '
      + '\'measure\', \'experiments\', \'analyzer\', \'filter\', \'compare\',\n  \'synthesis\', '
      + '\'sequencer\', \'presets\', \'learn\', \'studio\', \'about\'];'),
      /hard-codes 12 workspace ids against 13 in WORKSPACES \(missing: synth\)/],
    [2, (s) => s.replace(map, '...WORKSPACES.filter((w) => w !== \'synth\').map((w) =>'),
      /no entry per workspace|other than as the whole list/],
    [3, (s) => s.replace('  ENTRIES.push(...entriesOf());', '  WORKSPACES.pop();\n'
      + '  ENTRIES.push(...entriesOf());'), /other than as the whole list: WORKSPACES\.pop/],
  ]) {
    const mutated = mutate(fs);
    assert.notEqual(mutated, fs, `first-screen mutation ${i} applies`);
    assert.throws(() => firstScreenDerivesWorkspaces(mutated), refusal,
      `first-screen mutation ${i}`);
  }
});

test('the memory store says what it holds, and an observer hears every write', async () => {
  const seen = [];
  const raw = createMemoryStore();
  const store = observeMemoryStore(raw, (h) => seen.push(h));
  assert.deepEqual(raw.held(), { experiments: 0, definitions: 0, studio: 0, findings: 0 });
  await store.putStudio({ id: 'p1', kind: 'oscilla-studio-patch', name: 'x',
    savedAt: '2026-10-06T00:00:00.000Z', studioHash: 'h', doc: {} }).catch(() => {});
  await store.put({}).catch(() => {}); // refused: the observer still hears it
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.at(-1), raw.held());
  const idb = { kind: 'indexeddb' };
  assert.equal(observeMemoryStore(idb, () => {}), idb, 'a persistent store is left as it is');
});

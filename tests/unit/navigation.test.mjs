// Workspace navigation and the unsaved-work guard, pure halves (ledger W2, W4; ADR 0045):
// the one hash -> (workspace, V1 mode) mapping and its precedence, the hash a workspace switch
// writes, Copy config URL keeping the other domains' keys, and the guard registering a
// beforeunload listener only while something would be lost. The browser half is
// tests/browser/navigation.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
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
  assert.deepEqual(routeOfHash('#v=1&m=nowhere&f=440'), { workspace: 'playground', owner: null });
  assert.equal(routeOfHash('#m=learn&m=dual'), null, 'two m keys name no workspace');
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
  assert.deepEqual([...HASH_DOMAINS], ['instrument', 'measure', 'studio']);
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

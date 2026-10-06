// The README privacy section says browser storage holds only the keys and the database it
// lists. This test derives that inventory from src/js and requires the table to equal it.
//
// What it reads, with comments stripped:
//   - every module that names browser storage at all: localStorage, sessionStorage or
//     indexedDB (bare, window., globalThis., self. or a scope parameter), the core/storage.js
//     wrappers localStore, sessionStore and safeStorage, or openExperimentStore*; the set of
//     such modules is declared below, so storage reached from a new module fails here;
//   - every key those modules pass to getItem/setItem/removeItem, to localStore/sessionStore
//     get/set/remove, to readJSON(store, …) and store.get/set/remove in core/storage.js, and
//     to a module's own wrapper of those calls (app.js storageGet/storageSet); a key is a
//     string literal, a module-level string constant or STORAGE_KEYS.<name>, and a key it
//     cannot resolve fails;
//   - every database indexedDB.open names, and every object store the upgrade creates.
// Not derived: which of localStorage or sessionStorage holds a key (the README states it).
//   node --test tests/unit/storage-inventory.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

function walk(rel) {
  return readdirSync(path.join(ROOT, rel), { withFileTypes: true }).flatMap((d) => {
    const p = `${rel}/${d.name}`;
    if (d.isDirectory()) return walk(p);
    return p.endsWith('.js') ? [p] : [];
  });
}

/** The modules that reach browser storage, and why. A new one must be added here. */
export const STORAGE_MODULES = Object.freeze({
  'src/js/core/storage.js': 'the Web Storage wrappers (presets, history)',
  'src/js/core/instrument.js': 'presets, history and the safety notice through the wrappers',
  'src/js/main.js': 'the safety notice and storage availability through the wrappers',
  'src/js/ui/app.js': 'theme and analysis tab (localStorage)',
  'src/js/ui/workbench.js': 'the safety notice through the wrappers',
  'src/js/ui/experiments.js': 'opens the experiments database (pageIndexedDb)',
  'src/js/ui/studio/workspace.js': 'opens the experiments database for the Studio library',
  'src/js/experiments/store.js': 'the IndexedDB experiments database and its object stores',
});

/** Source without comments; strings, template literals and regex-free code kept. */
export function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); i = j < 0 ? src.length : j; continue; }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j += 1; j += 1; }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const TOUCH = /\b(?:localStorage|sessionStorage|indexedDB|localStore|sessionStore|safeStorage|openExperimentStore(?:OrMemory)?)\b/;
const ARG = String.raw`\(\s*([^,()]+?)\s*[,)]`;
const KEY_CALLS = [
  new RegExp(String.raw`\b(?:localStorage|sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem)${ARG}`, 'g'),
  new RegExp(String.raw`\b(?:localStore|sessionStore)\s*\.\s*(?:get|set|remove)${ARG}`, 'g'),
  new RegExp(String.raw`\bsafeStorage\s*\(\s*[^)]*\)\s*\.\s*(?:get|set|remove)${ARG}`, 'g'),
];
// Inside core/storage.js the wrappers take the store as a parameter.
const STORAGE_JS_CALLS = [
  new RegExp(String.raw`\bstore\s*\.\s*(?:get|set|remove)${ARG}`, 'g'),
  new RegExp(String.raw`\breadJSON\s*\(\s*\w+\s*,\s*([^,()]+?)\s*[,)]`, 'g'),
];

/**
 * The storage inventory of a set of sources ({ path: text }):
 * { modules, keys, unresolved, databases, objectStores }.
 */
export function storageInventory(sources, storageKeys) {
  const modules = [];
  const keys = new Set();
  const unresolved = [];
  const databases = new Set();
  const objectStores = new Set();
  for (const [file, raw] of Object.entries(sources)) {
    const code = stripComments(raw);
    if (!TOUCH.test(code)) continue;
    modules.push(file);
    const consts = Object.fromEntries([...code.matchAll(
      /^(?:export )?const (\w+) = (['"])([^'"]*)\2;/gm)].map(([, n, , v]) => [n, v]));
    const resolve = (expr) => {
      const e = expr.trim();
      let m;
      if ((m = e.match(/^(['"`])([^'"`$]*)\1$/))) return m[2];
      if ((m = e.match(/^STORAGE_KEYS\.(\w+)$/))) return storageKeys[m[1]];
      if (/^\w+$/.test(e) && e in consts) return consts[e];
      return undefined;
    };
    const calls = [...KEY_CALLS, ...(file.endsWith('core/storage.js') ? STORAGE_JS_CALLS : [])];
    const params = new Set();
    for (const re of calls) {
      for (const m of code.matchAll(re)) {
        if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
        const v = resolve(m[1]);
        if (v !== undefined) { keys.add(v); continue; }
        // A parameter passed straight through: the enclosing function is a key wrapper.
        const before = code.slice(0, m.index);
        const fn = [...before.matchAll(/function (\w+)\s*\(([^)]*)\)/g)].pop();
        if (fn && fn[2].split(',').map((p) => p.trim().split('=')[0].trim()).includes(m[1].trim())) {
          params.add(fn[1]);
        } else {
          unresolved.push(`${file}: ${m[0].trim()}`);
        }
      }
    }
    for (const fn of params) {
      if (file.endsWith('core/storage.js') && fn === 'readJSON') continue;
      for (const m of code.matchAll(new RegExp(String.raw`\b${fn}${ARG}`, 'g'))) {
        if (code.slice(m.index - 9, m.index) === 'function ') continue;
        const v = resolve(m[1]);
        if (v === undefined) unresolved.push(`${file}: ${m[0].trim()}`); else keys.add(v);
      }
    }
    for (const m of code.matchAll(/\bindexedDB\s*\.\s*open\s*\(\s*([^,()]+?)\s*[,)]/g)) {
      const v = resolve(m[1]);
      const dflt = code.match(new RegExp(String.raw`\b${m[1].trim()}\s*=\s*(\w+)`));
      const db = v ?? (dflt ? resolve(dflt[1]) : undefined);
      if (db === undefined) unresolved.push(`${file}: ${m[0].trim()}`); else databases.add(db);
    }
    for (const m of code.matchAll(/\b(?:ensure|createObjectStore)\s*\(\s*([^,()]+?)\s*[,)]/g)) {
      if (code.slice(m.index - 9, m.index) === 'function ') continue;
      const v = resolve(m[1]);
      if (v !== undefined) { objectStores.add(v); continue; }
      if (/^(?:name)$/.test(m[1].trim())) continue; // ensure's own createObjectStore(name, …)
      unresolved.push(`${file}: ${m[0].trim()}`);
    }
  }
  return { modules: modules.sort(), keys: [...keys].sort(), unresolved, databases: [...databases],
    objectStores: [...objectStores].sort() };
}

const SOURCES = Object.fromEntries(walk('src/js').map((f) => [f, read(f)]));
const { STORAGE_KEYS } = await import('../../src/js/core/constants.js');
const inventory = (sources = SOURCES) => storageInventory(sources, STORAGE_KEYS);

/** The README table: { webStorage: ['localStorage key', …], stores: [...], db, version }. */
function readmeTable() {
  const readme = read('README.md');
  const start = readme.indexOf('Browser storage holds only these keys');
  assert.ok(start >= 0, 'README states the storage inventory');
  const head = readme.slice(start, readme.indexOf('\n', start));
  const rows = readme.slice(start).split('\n\n')[1].split('\n').slice(2)
    .map((r) => r.split('|').slice(1, -1).map((c) => c.trim().replace(/`/g, '')));
  return {
    head,
    webStorage: rows.filter(([s]) => s !== 'IndexedDB').map(([s, k]) => `${s} ${k}`),
    idb: rows.filter(([s]) => s === 'IndexedDB').map(([, k]) => k),
  };
}

test('the modules that reach browser storage are the declared ones', () => {
  assert.deepEqual(inventory().modules, Object.keys(STORAGE_MODULES).sort());
});

test('every storage key and object store resolves, and the README table equals them', async () => {
  const inv = inventory();
  assert.deepEqual(inv.unresolved, [], 'storage calls whose key the inventory cannot resolve');
  const { DB_NAME, DB_VERSION } = await import('../../src/js/experiments/store.js');
  assert.deepEqual(inv.databases, [DB_NAME], 'one database');
  const table = readmeTable();
  assert.deepEqual(table.webStorage.map((r) => r.split(' ')[1]).sort(), inv.keys,
    'README Web Storage keys');
  for (const r of table.webStorage) {
    assert.match(r, /^(?:localStorage|sessionStorage) /, `README row ${r} names its storage`);
  }
  assert.deepEqual(table.idb.sort(),
    inv.objectStores.map((s) => `${DB_NAME}, object store ${s}`).sort(), 'README object stores');
  assert.ok(table.head.includes(`\`${DB_NAME}\` (version ${DB_VERSION})`),
    `README names the database and its version ${DB_VERSION}`);
});

// Mutation tests: each common way of adding storage is caught.
const mutate = (file, text) => ({ ...SOURCES, [file]: (SOURCES[file] || '') + `\n${text}\n` });
const NEW = 'src/js/ui/new-feature.js';

test('mutation: bare localStorage.setItem in a new module adds a module and a key', () => {
  const inv = inventory(mutate(NEW, "localStorage.setItem('oscilla.v3.new', '1');"));
  assert.ok(inv.modules.includes(NEW));
  assert.ok(inv.keys.includes('oscilla.v3.new'));
});

test('mutation: globalThis.sessionStorage is caught, with its key', () => {
  const inv = inventory(mutate(NEW, "const v = globalThis.sessionStorage.getItem('oscilla.peek');"));
  assert.ok(inv.modules.includes(NEW));
  assert.ok(inv.keys.includes('oscilla.peek'));
});

test('mutation: the localStore / sessionStore wrappers are caught, in a known module too', () => {
  let inv = inventory(mutate('src/js/main.js', "localStore.set('oscilla.extra', 'x');"));
  assert.ok(inv.keys.includes('oscilla.extra'), 'a literal key through localStore');
  inv = inventory(mutate('src/js/ui/workbench.js', 'sessionStore.set(STORAGE_KEYS.theme, 1);'));
  assert.ok(inv.keys.includes(STORAGE_KEYS.theme), 'a STORAGE_KEYS key through sessionStore');
  inv = inventory(mutate(NEW, "import { sessionStore } from '../core/storage.js';"));
  assert.ok(inv.modules.includes(NEW), 'importing a wrapper makes a storage module');
});

test('mutation: a module wrapper key and an unresolvable key are caught', () => {
  let inv = inventory(mutate('src/js/ui/app.js',
    "const LAYOUT_KEY = 'oscilla.v2.layout';\nstorageSet(LAYOUT_KEY, 'wide');"));
  assert.ok(inv.keys.includes('oscilla.v2.layout'), 'storageSet(LAYOUT_KEY) resolves');
  inv = inventory(mutate(NEW, 'window.localStorage.setItem(prefix + id, 1);'));
  assert.ok(inv.unresolved.some((u) => u.startsWith(NEW)), 'a computed key is reported');
});

test('mutation: bare indexedDB, another database and another object store are caught', () => {
  let inv = inventory(mutate(NEW, 'const f = typeof indexedDB !== "undefined";'));
  assert.ok(inv.modules.includes(NEW), 'bare indexedDB');
  inv = inventory(mutate(NEW, "indexedDB.open('oscilla-cache', 1);"));
  assert.ok(inv.databases.includes('oscilla-cache'), 'indexedDB.open');
  inv = inventory(mutate('src/js/experiments/store.js',
    "export const CACHE = 'cache';\nfunction up(db) { ensure(CACHE, 'id'); }"));
  assert.ok(inv.objectStores.includes('cache'), 'a new object store');
});

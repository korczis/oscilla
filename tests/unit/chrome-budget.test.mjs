// Plan issue U131, PR-0 of docs/reconstruction/09-u131-u135-design.md: the chrome-budget
// measure and its shrink-only ratchet (tests/browser/lib/chrome-budget.cjs) against the
// committed debt (tests/browser/chrome-budget-baseline.json).
//
// - the budget table: 75 % at 1536 px and more with the keys collapsed, 70 % from 1024 px, 65 %
//   from 768 px, 55 % open at every desktop width, 50 % on a phone in any state;
// - the debt is the px below the budget, 0 at the budget, one px per px below it;
// - the ratchet: a rise fails, a new cell over budget fails, a fall passes and is listed, a cell
//   at its debt passes; only measured engines are judged; another host is judged within the
//   tolerance, and a cell it measures in the other keys state than the record is reported, not
//   judged; --update writes falls, refuses a rise without a stated reason and appends the
//   reason to the raises ledger with one; another host never updates;
// - the history: a version whose debt rose without a new raises entry naming it, or that edited
//   a raises entry, is named;
// - the committed baseline: a *-baseline.json scripts/facts.mjs reads as a summed debt, every
//   workspace of the shell registry at every viewport for every engine, each cell's key and
//   debt well formed, its history only falls, and each single rise of a committed cell, each
//   new over-budget cell and each fall is caught by its key (mutation).
//   node --test tests/unit/chrome-budget.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKSPACE_IDS } from '../../src/js/ui/shell.js';
import { BASELINE_FILE, baselineTotal } from '../../scripts/facts.mjs';

const require = createRequire(import.meta.url);
const cb = require('../browser/lib/chrome-budget.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_REL = 'tests/browser/chrome-budget-baseline.json';
const BASELINE = path.join(ROOT, BASELINE_REL);
const SUITE = path.join(ROOT, 'tests', 'browser', 'chrome-budget.cjs');
const ENGINES = ['chromium', 'firefox', 'webkit'];
const REASON = 'PR B moves the keys into the strip; the Synth phone loses 12 px to its handle';

const vp = (width, height, phone = false) => ({ width, height, phone });
const BASE = { note: 'n', host: 'darwin', tolerancePx: 16, raises: {}, debt: {
  'chromium/1536x1024/synth/open': 0,
  'chromium/320x740/studio/collapsed': 370,
  'chromium/320x740/synth/open': 10,
  'webkit/320x740/studio/collapsed': 370,
} };
const measured = (over = {}) => ({ 'chromium/1536x1024/synth/open': 0,
  'chromium/320x740/studio/collapsed': 370, 'chromium/320x740/synth/open': 10, ...over });

test('the budget table: the design\'s shares per width and keys state', () => {
  const at = (v, s) => cb.budgetOf(v, s);
  assert.deepEqual(at(vp(1536, 1024), 'collapsed'), { pct: 75, measure: 'content' });
  assert.deepEqual(at(vp(1920, 1080), 'collapsed'), { pct: 75, measure: 'content' });
  assert.deepEqual(at(vp(1535, 1024), 'collapsed'), { pct: 70, measure: 'content' });
  assert.deepEqual(at(vp(1280, 800), 'collapsed'), { pct: 70, measure: 'content' });
  assert.deepEqual(at(vp(1024, 768), 'collapsed'), { pct: 70, measure: 'content' });
  assert.deepEqual(at(vp(1023, 768), 'collapsed'), { pct: 65, measure: 'content' });
  assert.deepEqual(at(vp(768, 1024), 'collapsed'), { pct: 65, measure: 'content' });
  for (const w of [1536, 1280, 1024, 768]) {
    assert.deepEqual(at(vp(w, 800), 'open'), { pct: 55, measure: 'content' }, `${w} open`);
  }
  assert.equal(at(vp(767, 1024), 'collapsed'), null, 'no desktop budget below 768 px');
  assert.equal(at(vp(767, 1024), 'open'), null);
  for (const s of cb.STATES) {
    assert.deepEqual(at(vp(390, 844, true), s), { pct: 50, measure: 'primary' });
    assert.deepEqual(at(vp(320, 740, true), s), { pct: 50, measure: 'primary' });
  }
  assert.throws(() => at(vp(1536, 1024), 'docked'), /unknown state/);
  assert.deepEqual(cb.VIEWPORTS.map((v) => `${cb.viewportKey(v)}${v.phone ? ' phone' : ''}`),
    ['1536x1024', '1280x800', '1024x768', '768x1024', '390x844 phone', '320x740 phone'],
    'the census\'s viewports');
  for (const v of cb.VIEWPORTS) {
    for (const s of cb.STATES) assert.ok(cb.budgetOf(v, s), `${cb.viewportKey(v)} ${s} budgeted`);
  }
});

test('the debt is the px below the budget, 0 at or above it', () => {
  const b75 = { pct: 75 };
  assert.equal(cb.debtOf(b75, { px: 768, innerHeight: 1024 }), 0, 'exactly 75 %');
  assert.equal(cb.debtOf(b75, { px: 900, innerHeight: 1024 }), 0);
  assert.equal(cb.debtOf(b75, { px: 767, innerHeight: 1024 }), 1);
  assert.equal(cb.debtOf(b75, { px: 0, innerHeight: 1024 }), 768);
  // 55 % of 1024 is 563.2 px: 564 meets it, 563 does not
  assert.equal(cb.debtOf({ pct: 55 }, { px: 564, innerHeight: 1024 }), 0);
  assert.equal(cb.debtOf({ pct: 55 }, { px: 563, innerHeight: 1024 }), 1);
  // 70 % of 800 is 560 exactly, no float residue
  assert.equal(cb.debtOf({ pct: 70 }, { px: 560, innerHeight: 800 }), 0);
  assert.equal(cb.debtOf({ pct: 50 }, { px: 369.6, innerHeight: 740 }), 0, 'rounded px');
  assert.equal(cb.debtOf({ pct: 50 }, { px: 369.4, innerHeight: 740 }), 1);
  for (const bad of [{ px: NaN, innerHeight: 1 }, { px: 1, innerHeight: 0 }, { px: 1 }]) {
    assert.throws(() => cb.debtOf(b75, bad), /no debt/, JSON.stringify(bad));
  }
});

test('cell keys: built from their parts and parsed back; a string that is none is refused', () => {
  const key = cb.cellKey('webkit', vp(320, 740, true), 'studio', 'collapsed');
  assert.equal(key, 'webkit/320x740/studio/collapsed');
  assert.equal(cb.cellKey('webkit', '320x740', 'studio', 'collapsed'), key);
  assert.deepEqual(cb.parseKey(key),
    { engine: 'webkit', viewport: '320x740', place: 'studio', state: 'collapsed' });
  for (const bad of ['', 'webkit/320x740/studio', 'webkit/320x740/studio/docked',
    'webkit/320/studio/open', 'Webkit/320x740/studio/open', 42]) {
    assert.throws(() => cb.parseKey(bad), /is not a cell key/, String(bad));
  }
});

test('the ratchet: a debt that stays passes, a rise fails by its key, a fall passes', () => {
  const same = cb.judge(BASE, measured());
  assert.equal(cb.failed(same), false);
  assert.deepEqual([same.rises, same.news, same.falls, same.added], [[], [], [], []]);
  const rose = cb.judge(BASE, measured({ 'chromium/320x740/synth/open': 11 }));
  assert.equal(cb.failed(rose), true);
  assert.deepEqual(rose.rises, [{ key: 'chromium/320x740/synth/open', from: 10, to: 11 }]);
  const zeroRose = cb.judge(BASE, measured({ 'chromium/1536x1024/synth/open': 1 }));
  assert.deepEqual(zeroRose.rises.map((r) => r.key), ['chromium/1536x1024/synth/open'],
    'a cell at its budget that goes 1 px over');
  const fell = cb.judge(BASE, measured({ 'chromium/320x740/studio/collapsed': 300,
    'chromium/320x740/synth/open': 0 }));
  assert.equal(cb.failed(fell), false);
  assert.deepEqual(fell.falls, [
    { key: 'chromium/320x740/studio/collapsed', from: 370, to: 300 },
    { key: 'chromium/320x740/synth/open', from: 10, to: 0 }]);
  assert.deepEqual(cb.formatCells(fell.falls, 'fell'), [
    'chromium/320x740/studio/collapsed: fell 370 -> 300 px over budget',
    'chromium/320x740/synth/open: fell 10 -> 0 px over budget']);
});

test('the ratchet: a new cell over budget fails, one within it is added; only measured engines',
  () => {
    const v = cb.judge(BASE, measured({ 'chromium/1536x1024/studio/collapsed': 4,
      'chromium/1536x1024/studio/open': 0 }));
    assert.equal(cb.failed(v), true);
    assert.deepEqual(v.news, [{ key: 'chromium/1536x1024/studio/collapsed', from: 0, to: 4 }]);
    assert.deepEqual(v.added, [{ key: 'chromium/1536x1024/studio/open', from: 0, to: 0 }]);
    assert.deepEqual(v.gone, [], 'webkit was not measured: its cell is not judged');
    const g = cb.judge(BASE, { 'chromium/320x740/studio/collapsed': 370 });
    assert.equal(cb.failed(g), false, 'a cell no longer measured does not fail');
    assert.deepEqual(g.gone.map((x) => x.key),
      ['chromium/1536x1024/synth/open', 'chromium/320x740/synth/open']);
    assert.deepEqual(cb.formatCells(g.gone.slice(0, 1), 'no longer measured'),
      ['chromium/1536x1024/synth/open: no longer measured (was 0 px over budget)']);
    assert.equal(cb.failed(cb.judge({}, { 'webkit/390x844/synth/open': 1 })), true,
      'no baseline: every cell over budget is new');
    for (const bad of [-1, 1.5, '3', null]) {
      assert.throws(() => cb.judge(BASE, { 'chromium/320x740/synth/open': bad }), /no debt in px/);
    }
    assert.throws(() => cb.judge(BASE, { 'chromium/320x740/synth': 1 }), /is not a cell key/);
  });

test('another host is judged within the tolerance; the recording host exactly', () => {
  const tol = BASE.tolerancePx;
  const linux = (over) => cb.judge(BASE, measured(over), { host: 'linux' });
  const within = linux({ 'chromium/320x740/synth/open': 10 + tol,
    'chromium/1536x1024/synth/open': tol, 'chromium/320x740/studio/collapsed': 370 - tol });
  assert.equal(cb.failed(within), false);
  assert.deepEqual([within.rises, within.falls], [[], []]);
  assert.deepEqual([within.host, within.against, within.tolerancePx], ['linux', 'darwin', tol]);
  const beyond = linux({ 'chromium/320x740/synth/open': 11 + tol });
  assert.deepEqual(beyond.rises.map((r) => r.key), ['chromium/320x740/synth/open']);
  const fresh = cb.judge(BASE, measured({ 'chromium/768x1024/synth/open': tol }),
    { host: 'linux' });
  assert.deepEqual(fresh.news, []);
  assert.equal(cb.judge(BASE, measured({ 'chromium/768x1024/synth/open': tol + 1 }),
    { host: 'linux' }).news.length, 1);
  const here = cb.judge(BASE, measured({ 'chromium/320x740/synth/open': 11 }), { host: 'darwin' });
  assert.equal(here.tolerancePx, 0);
  assert.equal(here.rises.length, 1, 'on darwin 1 px is a rise');
  assert.equal(cb.judge({ ...BASE, tolerancePx: undefined }, measured(), { host: 'linux' })
    .tolerancePx, cb.TOLERANCE_PX);
});

test('another host whose fonts dock the keys elsewhere: the cell moved, neither gone nor new',
  () => {
    const run = measured({ 'chromium/320x740/studio/open': 500 });
    delete run['chromium/320x740/studio/collapsed'];
    const linux = cb.judge(BASE, run, { host: 'linux' });
    assert.equal(cb.failed(linux), false);
    assert.deepEqual(linux.moved, [{ key: 'chromium/320x740/studio/open',
      was: 'chromium/320x740/studio/collapsed', from: 370, to: 500 }]);
    assert.deepEqual([linux.news, linux.gone], [[], []]);
    assert.deepEqual(cb.formatCells(linux.moved, 'opens in the other keys state'), [
      'chromium/320x740/studio/open: opens in the other keys state (recorded as '
        + 'chromium/320x740/studio/collapsed, 370 px; now 500 px), not judged']);
    const darwin = cb.judge(BASE, run, { host: 'darwin' });
    assert.equal(cb.failed(darwin), true, 'on the recording host a changed state is judged');
    assert.deepEqual([darwin.moved, darwin.news.map((n) => n.key), darwin.gone.map((g) => g.key)],
      [[], ['chromium/320x740/studio/open'], ['chromium/320x740/studio/collapsed']]);
    const both = cb.judge(BASE, measured({ 'chromium/320x740/studio/open': 500 }),
      { host: 'linux' });
    assert.deepEqual([both.moved, both.news.map((n) => n.key)],
      [[], ['chromium/320x740/studio/open']], 'a second state beside the recorded one is new');
  });

test('--update writes falls, refuses a rise without a stated reason, appends one with it', () => {
  const before = JSON.stringify(BASE);
  const run = measured({ 'chromium/320x740/studio/collapsed': 300,
    'chromium/320x740/synth/open': 22, 'chromium/1536x1024/studio/open': 0,
    'chromium/1536x1024/studio/collapsed': 5 });
  delete run['chromium/1536x1024/synth/open'];
  const plain = cb.update(BASE, run, { host: 'darwin' });
  assert.equal(JSON.stringify(BASE), before, 'the input is not changed');
  assert.deepEqual(plain.next.debt, {
    'chromium/1536x1024/studio/open': 0,
    'chromium/320x740/studio/collapsed': 300,
    'chromium/320x740/synth/open': 10,
    'webkit/320x740/studio/collapsed': 370,
  }, 'the fall written, the gone cell dropped, the rise and the new debt kept out');
  assert.deepEqual(plain.refused.map((r) => r.key),
    ['chromium/320x740/synth/open', 'chromium/1536x1024/studio/collapsed']);
  assert.deepEqual(plain.next.raises, {});
  assert.deepEqual([plain.next.host, plain.next.tolerancePx, plain.next.note],
    ['darwin', 16, 'n']);
  const short = cb.update(BASE, run, { host: 'darwin', reason: 'because it grew' });
  assert.equal(short.refused.length, 2, 'a reason of 30 characters or less is no reason');
  const stated = cb.update(BASE, run, { host: 'darwin', reason: REASON });
  assert.deepEqual(stated.refused, []);
  assert.equal(stated.next.debt['chromium/320x740/synth/open'], 22);
  assert.equal(stated.next.debt['chromium/1536x1024/studio/collapsed'], 5);
  assert.deepEqual(stated.next.raises, {
    'chromium/1536x1024/studio/collapsed': [{ from: 0, to: 5, reason: REASON }],
    'chromium/320x740/synth/open': [{ from: 10, to: 22, reason: REASON }],
  });
  const again = cb.update(stated.next, measured({ 'chromium/320x740/synth/open': 30 }),
    { host: 'darwin', reason: `${REASON}, again` });
  assert.equal(again.next.raises['chromium/320x740/synth/open'].length, 2, 'appended');
  assert.deepEqual(Object.keys(stated.next), ['note', 'host', 'tolerancePx', 'debt', 'raises']);
  assert.throws(() => cb.update(BASE, run, { host: 'linux', reason: REASON }),
    /recorded on darwin; --update on linux/);
  for (const empty of [undefined, { note: 'n', debt: {}, raises: {} }]) {
    const first = cb.update(empty, { 'webkit/390x844/synth/open': 3,
      'webkit/390x844/studio/collapsed': 0 }, { host: 'linux', note: 'first' });
    assert.deepEqual(first.next, { note: 'first', host: 'linux', tolerancePx: cb.TOLERANCE_PX,
      debt: { 'webkit/390x844/studio/collapsed': 0, 'webkit/390x844/synth/open': 3 },
      raises: {} }, 'the first record takes every cell and the host, with no reason');
    assert.deepEqual([first.refused, first.raised], [[], []]);
  }
});

test('the history: an undeclared rise or an edited raises entry is named by version', () => {
  const v = (sha, debt, raises = {}) => ({ sha, json: { debt, raises } });
  const k = 'chromium/320x740/synth/open';
  assert.deepEqual(cb.undeclaredRises([v('a', { [k]: 10 })]), [], 'the first record is free');
  assert.deepEqual(cb.undeclaredRises([v('a', { [k]: 10 }), v('b', { [k]: 4 }),
    v('c', { [k]: 0 })]), [], 'falls');
  assert.deepEqual(cb.undeclaredRises([v('a', { [k]: 10 }), v('b', { [k]: 12 })]),
    [`${k}: the debt rose 10 -> 12 px at b (from a) with no raises entry { from, to: 12, `
      + 'reason } of more than 30 characters']);
  assert.equal(cb.undeclaredRises([v('a', {}), v('b', { [k]: 1 })]).length, 1, 'a new debt');
  assert.deepEqual(cb.undeclaredRises([v('a', {}), v('b', { [k]: 0 })]), [], 'a new cell at 0');
  const entry = { from: 10, to: 12, reason: REASON };
  assert.deepEqual(cb.undeclaredRises([v('a', { [k]: 10 }),
    v('b', { [k]: 12 }, { [k]: [entry] })]), [], 'declared');
  assert.equal(cb.undeclaredRises([v('a', { [k]: 10 }),
    v('b', { [k]: 13 }, { [k]: [entry] })]).length, 1, 'the entry names another debt');
  assert.equal(cb.undeclaredRises([v('a', { [k]: 10 }),
    v('b', { [k]: 12 }, { [k]: [{ ...entry, reason: 'short' }] })]).length, 1, 'no reason');
  assert.equal(cb.undeclaredRises([v('a', { [k]: 12 }, { [k]: [entry] }),
    v('b', { [k]: 12 }, { [k]: [entry] }), v('c', { [k]: 14 }, { [k]: [entry] })]).length, 1,
  'an old entry does not declare a later rise');
  const edited = cb.undeclaredRises([v('a', { [k]: 12 }, { [k]: [entry] }),
    v('b', { [k]: 12 }, { [k]: [{ ...entry, reason: `${REASON}!` }] })]);
  assert.deepEqual(edited, [`${k}: a raises entry of a was edited or removed at b; entries are `
    + 'appended, never edited']);
  assert.equal(cb.undeclaredRises([v('a', { [k]: 12 }, { [k]: [entry] }),
    v('b', { [k]: 12 }, {})]).length, 1, 'removed');
});

// ---------------------------------------------------------------- the committed baseline

const committed = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;

test('the committed baseline is a summed debt that scripts/facts.mjs reads as a ratchet', () => {
  assert.ok(committed, `${BASELINE_REL} exists`);
  assert.ok(BASELINE_FILE.test(BASELINE_REL), 'named so facts.mjs reads it as shrink-only debt');
  assert.deepEqual(Object.keys(committed), ['note', 'host', 'tolerancePx', 'debt', 'raises']);
  assert.equal(committed.host, 'darwin');
  assert.equal(committed.tolerancePx, cb.TOLERANCE_PX);
  const total = Object.values(committed.debt).reduce((n, d) => n + d, 0);
  const t = baselineTotal(committed);
  assert.deepEqual([t.how, t.field, t.value, t.derived], ['sum', 'debt', total, true]);
});

test('the committed baseline covers every workspace and viewport for every engine', () => {
  const seen = new Map();
  for (const [key, debt] of Object.entries(committed.debt)) {
    const p = cb.parseKey(key);
    assert.ok(Number.isInteger(debt) && debt >= 0, `${key}: ${debt}`);
    assert.ok(ENGINES.includes(p.engine), key);
    assert.ok(WORKSPACE_IDS.includes(p.place), key);
    const v = cb.VIEWPORTS.find((x) => cb.viewportKey(x) === p.viewport);
    assert.ok(v, `${key}: a viewport of the census`);
    const at = `${p.engine}/${p.viewport}/${p.place}`;
    seen.set(at, [...(seen.get(at) || []), p.state]);
  }
  for (const engine of ENGINES) {
    for (const v of cb.VIEWPORTS) {
      for (const ws of WORKSPACE_IDS) {
        const at = `${engine}/${cb.viewportKey(v)}/${ws}`;
        assert.ok(seen.has(at), `${at} is recorded`);
        if (v.phone) assert.equal(seen.get(at).length, 1, `${at}: the state it opens in`);
      }
    }
  }
  for (const [key, list] of Object.entries(committed.raises)) {
    cb.parseKey(key);
    assert.ok(Array.isArray(list) && list.length, key);
  }
  assert.equal(cb.failed(cb.judge(committed, committed.debt)), false, 'it matches itself');
});

/** Every committed version of the baseline, oldest first, then the working tree's. */
function versions() {
  const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) return null;
  const log = git('log', '--format=%H', '--', BASELINE_REL);
  if (log.status !== 0) return null;
  const list = log.stdout.split('\n').filter(Boolean).reverse().map((sha) => ({
    sha: sha.slice(0, 12), json: JSON.parse(git('show', `${sha}:${BASELINE_REL}`).stdout) }));
  return [...list, { sha: 'the working tree', json: committed }];
}

test('the committed baseline only falls: every rise in its history is declared', (t) => {
  const history = versions();
  if (!history) {
    t.skip('no git history here (a git archive tree)');
    return;
  }
  assert.deepEqual(cb.undeclaredRises(history), []);
});

test('mutation: each rise, new over-budget cell and fall of a committed cell is caught by key',
  () => {
    const keys = Object.keys(committed.debt);
    for (const key of keys) {
      const up = cb.judge(committed, { ...committed.debt, [key]: committed.debt[key] + 1 });
      assert.deepEqual([up.rises.map((r) => r.key), up.news, up.falls], [[key], [], []], key);
      assert.equal(cb.failed(up), true, key);
      const without = { ...committed, debt: { ...committed.debt } };
      delete without.debt[key];
      const fresh = cb.judge(without, { ...committed.debt, [key]: committed.debt[key] + 1 });
      assert.deepEqual(fresh.news.map((r) => r.key), [key], `${key} new over budget`);
      if (committed.debt[key] > 0) {
        const down = cb.judge(committed, { ...committed.debt, [key]: committed.debt[key] - 1 });
        assert.deepEqual([down.falls.map((r) => r.key), cb.failed(down)], [[key], false], key);
      }
      const history = [{ sha: 'base', json: committed },
        { sha: 'raised', json: { ...committed, debt: { ...committed.debt,
          [key]: committed.debt[key] + 1 } } }];
      assert.equal(cb.undeclaredRises(history).length, 1, `${key}: an undeclared rise`);
    }
    assert.ok(keys.some((k) => committed.debt[k] > 0), 'the baseline records some debt');
  });

test('the suite reads the places from the registry and keeps its primary table to them', () => {
  const src = readFileSync(SUITE, 'utf8');
  assert.match(src, /const WORKSPACES = op\.WORKSPACES;/, 'the shell registry, never a hand list');
  assert.match(src, /require\('\.\.\/\.\.\/src\/js\/ui\/shell\.js'\)/, 'phonePrimaryOf');
  const table = /const PRIMARY = Object\.freeze\(\{([^}]*)\}\);/.exec(src);
  assert.ok(table, 'the primary table');
  const ids = [...table[1].matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ['synth', 'studio']);
  for (const id of ids) assert.ok(WORKSPACE_IDS.includes(id), id);
});

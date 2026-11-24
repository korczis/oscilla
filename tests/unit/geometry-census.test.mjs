// Plan issue U128: the diff that judges the DOM geometry census
// (tests/browser/lib/geometry-census.cjs) against its committed baseline
// (tests/browser/geometry-census-reference.json).
//
// - an entry equal within the tolerance is no difference; a move or resize beyond it, a
//   display or visibility change, an element that stops (or starts) being rendered, an element
//   or a workspace added or removed each is, with its engine/viewport/workspace/element path;
// - only what a run measured is judged; a host without a record is judged on membership only;
// - --update replaces the measured engines and viewports of one host and keeps the rest;
// - mutation: each single change applied to every element of a real committed cell is caught,
//   named by its key; the committed baseline covers every workspace of the shell registry and
//   every viewport of the census, for every host and engine it records.
//   node --test tests/unit/geometry-census.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKSPACE_IDS } from '../../src/js/ui/shell.js';

const require = createRequire(import.meta.url);
const gc = require('../browser/lib/geometry-census.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = path.join(ROOT, 'tests', 'browser', 'geometry-census-reference.json');
const TOL = gc.TOLERANCE_PX;

const cellOf = (entries) => ({ chromium: { '1536x1024': { playground: entries } } });
const SOURCE = 'flex visible 272,157,258,485';
const BASE = cellOf({ 'panel:source': SOURCE, 'panel:filter': 'none visible -',
  'link:seq.toStudio@#m=studio': 'inline-flex visible 300,900,120,32' });
const withEntry = (key, entry) => cellOf({ ...BASE.chromium['1536x1024'].playground,
  [key]: entry });
const PATH = 'chromium/1536x1024/playground/panel:source';

test('encode and decode are inverse; a string that is no entry is refused', () => {
  const parts = gc.decode(SOURCE);
  assert.deepEqual(parts, { display: 'flex', visibility: 'visible', rendered: true,
    rect: [272, 157, 258, 485] });
  assert.equal(gc.encode(parts), SOURCE);
  assert.equal(gc.encode({ display: 'none', visibility: 'visible', rect: null }), 'none visible -');
  assert.equal(gc.encode({ display: 'block', visibility: 'hidden', rect: [1.4, -2.6, 3, 4] }),
    'block hidden 1,-3,3,4');
  for (const bad of ['', 'flex visible', 'flex visible 1,2,3', 'flex  visible -', 42]) {
    assert.throws(() => gc.decode(bad), /is not an entry/, String(bad));
  }
});

test('equal within the tolerance passes: every edge and side moved by the tolerance', () => {
  assert.deepEqual(gc.diffCensus(BASE, BASE), []);
  for (let i = 0; i < 4; i += 1) {
    for (const d of [TOL, -TOL]) {
      const rect = [272, 157, 258, 485];
      rect[i] += d;
      const cur = withEntry('panel:source', `flex visible ${rect.join(',')}`);
      assert.deepEqual(gc.diffCensus(BASE, cur), [], `part ${i} by ${d}`);
    }
  }
});

test('a move or resize beyond the tolerance fails with its element and field named', () => {
  const parts = ['x', 'y', 'w', 'h'];
  for (let i = 0; i < 4; i += 1) {
    const rect = [272, 157, 258, 485];
    rect[i] += TOL + 1;
    const cur = withEntry('panel:source', `flex visible ${rect.join(',')}`);
    const diffs = gc.diffCensus(BASE, cur);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].path, PATH);
    assert.equal(diffs[0].kind, 'changed');
    assert.deepEqual(diffs[0].fields.map((f) => f.field), [parts[i]]);
    const [line] = gc.formatDiff(diffs);
    assert.ok(line.startsWith(`${PATH}: ${parts[i]} `), line);
    assert.ok(line.includes(`tolerance ${TOL} px`), line);
  }
  const wider = gc.diffCensus(BASE, withEntry('panel:source', 'flex visible 272,157,300,485'),
    { tolerancePx: 50 });
  assert.deepEqual(wider, [], 'a stated tolerance replaces the default');
});

test('a hidden, shown, re-displayed or invisible element fails with its key named', () => {
  const cases = [
    ['panel:source', 'flex visible -', 'rendered'],
    ['panel:source', 'none visible -', 'display'],
    ['panel:source', 'grid visible 272,157,258,485', 'display'],
    ['panel:source', 'flex hidden 272,157,258,485', 'visibility'],
    ['panel:filter', 'block visible 0,0,10,10', 'display'],
  ];
  for (const [key, entry, field] of cases) {
    const diffs = gc.diffCensus(BASE, withEntry(key, entry));
    assert.equal(diffs.length, 1, `${key} -> ${entry}`);
    assert.equal(diffs[0].path, `chromium/1536x1024/playground/${key}`);
    assert.ok(diffs[0].fields.some((f) => f.field === field), `${entry}: ${field}`);
  }
  // A hidden element's rect is not compared with the shown one's: rendered says it.
  const hidden = gc.diffCensus(BASE, withEntry('panel:source', 'flex visible -'));
  assert.deepEqual(hidden[0].fields.map((f) => f.field), ['rendered']);
});

test('an element added or removed fails with its key named', () => {
  const added = gc.diffCensus(BASE, withEntry('link:new.toSynth', 'flex visible 1,2,3,4'));
  assert.deepEqual(added.map((d) => [d.kind, d.path]),
    [['added', 'chromium/1536x1024/playground/link:new.toSynth']]);
  assert.match(gc.formatDiff(added)[0], /link:new\.toSynth: added \("flex visible 1,2,3,4"\)/);
  const entries = { ...BASE.chromium['1536x1024'].playground };
  delete entries['panel:filter'];
  const removed = gc.diffCensus(BASE, cellOf(entries));
  assert.deepEqual(removed.map((d) => [d.kind, d.path]),
    [['removed', 'chromium/1536x1024/playground/panel:filter']]);
  assert.match(gc.formatDiff(removed)[0], /panel:filter: removed \(was "none visible -"\)/);
});

test('a workspace added or removed within a measured engine and viewport fails', () => {
  const cur = { chromium: { '1536x1024': { ...BASE.chromium['1536x1024'],
    newplace: { 'panel:source': SOURCE } } } };
  assert.deepEqual(gc.diffCensus(BASE, cur).map((d) => [d.kind, d.path]),
    [['workspace-added', 'chromium/1536x1024/newplace']]);
  assert.deepEqual(gc.diffCensus(cur, BASE).map((d) => [d.kind, d.path]),
    [['workspace-removed', 'chromium/1536x1024/newplace']]);
});

test('only what the run measured is judged; a measured cell without a baseline fails', () => {
  const base = { ...BASE, webkit: BASE.chromium, chromium: { ...BASE.chromium,
    '390x844': BASE.chromium['1536x1024'] } };
  assert.deepEqual(gc.diffCensus(base, BASE), [], 'webkit and 390x844 were not measured');
  const diffs = gc.diffCensus(BASE, { firefox: BASE.chromium });
  assert.deepEqual(diffs.map((d) => [d.kind, d.path]), [['no-baseline', 'firefox/1536x1024']]);
  assert.match(gc.formatDiff(diffs)[0], /no baseline/);
});

test('membership only (rects: false) ignores a move and still catches a hidden element', () => {
  const moved = withEntry('panel:source', 'flex visible 0,0,10,10');
  assert.deepEqual(gc.diffCensus(BASE, moved, { rects: false }), []);
  assert.equal(gc.diffCensus(BASE, moved).length, 1);
  const hidden = withEntry('panel:source', 'flex visible -');
  assert.deepEqual(gc.diffCensus(BASE, hidden, { rects: false }).map((d) => d.path), [PATH]);
});

test('judge: rects on a host with a record, membership only against another host without', () => {
  const baseline = { tolerancePx: TOL, hosts: { darwin: BASE } };
  const moved = withEntry('panel:source', 'flex visible 0,0,10,10');
  const own = gc.judge(baseline, moved, 'darwin');
  assert.equal(own.against, 'darwin');
  assert.equal(own.rects, true);
  assert.deepEqual(own.diffs.map((d) => d.path), [PATH]);
  const other = gc.judge(baseline, moved, 'linux');
  assert.equal(other.against, 'darwin');
  assert.equal(other.rects, false);
  assert.deepEqual(other.diffs, []);
  const hidden = gc.judge(baseline, withEntry('panel:source', 'flex visible -'), 'linux');
  assert.deepEqual(hidden.diffs.map((d) => d.path), [PATH]);
  const none = gc.judge({ hosts: {} }, BASE, 'linux');
  assert.equal(none.against, null);
  assert.deepEqual(none.diffs.map((d) => d.kind), ['no-baseline']);
  const loose = gc.judge({ tolerancePx: 50, hosts: { darwin: BASE } },
    withEntry('panel:source', 'flex visible 272,157,300,485'), 'darwin');
  assert.equal(loose.tolerancePx, 50, 'the baseline states its tolerance');
  assert.deepEqual(loose.diffs, []);
});

test('update replaces the measured engines and viewports of one host and keeps the rest', () => {
  const linux = cellOf({ 'panel:source': 'flex visible 1,1,1,1' });
  const baseline = { tolerancePx: TOL, $comment: ['kept'], hosts: { linux,
    darwin: { ...BASE, webkit: BASE.chromium, chromium: { ...BASE.chromium,
      '390x844': BASE.chromium['1536x1024'] } } } };
  const moved = withEntry('panel:source', 'flex visible 0,0,10,10');
  const { next, diffs } = gc.update(baseline, moved, 'darwin');
  assert.deepEqual(diffs.map((d) => d.path), [PATH], 'what the update changed');
  assert.equal(next.hosts.darwin.chromium['1536x1024'].playground['panel:source'],
    'flex visible 0,0,10,10');
  assert.deepEqual(next.hosts.darwin.chromium['390x844'], BASE.chromium['1536x1024']);
  assert.deepEqual(next.hosts.darwin.webkit, BASE.chromium);
  assert.deepEqual(next.hosts.linux, linux);
  assert.deepEqual(next.$comment, ['kept']);
  assert.deepEqual(Object.keys(next.hosts), ['darwin', 'linux']);
  assert.deepEqual(baseline.hosts.darwin.chromium['1536x1024'], BASE.chromium['1536x1024'],
    'the old baseline object is not written');
  const fresh = gc.update(undefined, BASE, 'linux', { comment: ['new'] });
  assert.deepEqual(fresh.next, { $comment: ['new'], tolerancePx: TOL, hosts: { linux: BASE } });
  assert.deepEqual(fresh.diffs.map((d) => d.kind), ['no-baseline']);
});

test('counts reports cells, elements and rendered elements per engine', () => {
  assert.deepEqual(gc.counts({ ...BASE, webkit: { '320x740': { a: {}, b: { x: SOURCE } } } }), {
    chromium: { cells: 1, elements: 3, rendered: 2 },
    webkit: { cells: 2, elements: 1, rendered: 1 },
  });
});

test('the census reads its viewports and links from one place', () => {
  assert.deepEqual(gc.VIEWPORTS.map((v) => `${gc.viewportKey(v)}${v.phone ? ' phone' : ''}`),
    ['1536x1024', '1280x800', '1024x768', '768x1024', '390x844 phone', '320x740 phone']);
  for (const sel of ['[data-osc-link]', '[data-osc$=".toStudio"]', '[data-osc$=".toSynth"]',
    '[data-osc$=".openInStudio"]', '[data-osc$=".openMenu"]', '[data-osc^="page.related"]']) {
    assert.ok(gc.LINK_SELECTOR.split(', ').includes(sel), sel);
  }
});

// ---------------------------------------------------------------- the committed baseline

const committed = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;

test('the committed baseline covers every workspace and viewport per host and engine', () => {
  assert.ok(committed, 'tests/browser/geometry-census-reference.json exists');
  assert.equal(committed.tolerancePx, TOL);
  const hosts = Object.keys(committed.hosts);
  assert.ok(hosts.length > 0, 'at least one host is recorded');
  const viewports = gc.VIEWPORTS.map(gc.viewportKey);
  for (const host of hosts) {
    for (const engine of ['chromium', 'firefox', 'webkit']) {
      const rec = committed.hosts[host][engine];
      assert.ok(rec, `${host} records ${engine}`);
      assert.deepEqual(Object.keys(rec), viewports, `${host}/${engine} viewports`);
      for (const vp of viewports) {
        assert.deepEqual(Object.keys(rec[vp]), [...WORKSPACE_IDS], `${host}/${engine}/${vp}`);
        for (const [ws, cell] of Object.entries(rec[vp])) {
          assert.ok(Object.keys(cell).length > 0, `${host}/${engine}/${vp}/${ws} is not empty`);
          for (const entry of Object.values(cell)) gc.decode(entry);
          for (const id of ['panel:source', 'panel:studio']) {
            assert.ok(id in cell, `${host}/${engine}/${vp}/${ws} has ${id}`);
          }
        }
      }
    }
  }
  assert.deepEqual(gc.judge(committed, committed.hosts[hosts[0]], hosts[0]).diffs, [],
    'the baseline matches itself');
});

test('mutation: each single change to each element of a committed cell is caught by key', () => {
  const host = Object.keys(committed.hosts)[0];
  const rec = committed.hosts[host];
  const engine = Object.keys(rec)[0];
  const vp = Object.keys(rec[engine])[0];
  const ws = Object.keys(rec[engine][vp])[0];
  const cell = rec[engine][vp][ws];
  const at = (entries) => ({ [engine]: { [vp]: { [ws]: entries } } });
  const base = at(cell);
  let rendered = 0;
  for (const [key, entry] of Object.entries(cell)) {
    const want = `${engine}/${vp}/${ws}/${key}`;
    const p = gc.decode(entry);
    const mutants = [
      { ...p, display: p.display === 'none' ? 'block' : 'none' },
      { ...p, visibility: p.visibility === 'hidden' ? 'visible' : 'hidden' },
      p.rendered ? { ...p, rect: null } : { ...p, rect: [0, 0, 10, 10] },
    ];
    if (p.rendered) {
      rendered += 1;
      for (let i = 0; i < 4; i += 1) {
        const rect = p.rect.slice();
        rect[i] += TOL + 1;
        mutants.push({ ...p, rect });
      }
    }
    for (const m of mutants) {
      const diffs = gc.diffCensus(base, at({ ...cell, [key]: gc.encode(m) }));
      assert.deepEqual(diffs.map((d) => d.path), [want], `${gc.encode(m)} for ${entry}`);
    }
    const without = { ...cell };
    delete without[key];
    assert.deepEqual(gc.diffCensus(base, at(without)).map((d) => [d.kind, d.path]),
      [['removed', want]]);
  }
  assert.ok(rendered > 0, 'the cell holds rendered elements');
  assert.deepEqual(gc.diffCensus(base, at({ ...cell, 'link:added': 'flex visible 1,1,1,1' }))
    .map((d) => d.kind), ['added']);
});

// The peeper shell (owner order 2026-11-02 (c); the probe tap API stub of V616): its model
// against createProbeStub(), and the page parts that make it reachable on every page.
//
// What it proves:
//   - the stub mirrors src/js/studio/probe.js of feat/v616-probe-tap (2a94dc6a): its exports
//     (createProbeStub, windowSamples, windowMsOf), its points; tap(id, { windowMs }) is the only
//     tap form, converted with the injected rate (44.1 and 48 kHz) to a power of two, and read()
//     returns window (samples) and the actual windowMs, marked stub: true; over budget a lease
//     reads live: false, reason 'budget', with no frame;
//   - the peeper asks with windowMs, shows the windowMs it got, and its release returns
//     active() to 0/0;
//   - the tap list is probe.points(), never a list of the page's own;
//   - a pinned peeper survives a route change and retargets its lease; an unpinned one closes;
//   - pinning is view state: it is kept in local storage (oscilla.peeper), never in the hash or
//     the history (the module writes neither);
//   - a close, a hide and a Stop release the lease: active() is 0/0; stopped, the peeper reads
//     live: false with the reason and never a fake frame; it never starts audio;
//   - peep(target) opens the peeper on a point, a node or an edge;
//   - the page header's action, the shortcut row and the docked section exist, and the view is
//     one swappable function (W004).
//   node --test tests/unit/peeper.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProbeStub, STUB_POINTS, windowMsOf, windowSamples }
  from '../../src/js/ui/peeper/probe-stub.js';
import { createPeeper, DEFAULT_TAP, PEEPER_KEY, PEEPER_WINDOWS_MS, pointFor, resolvePeeperPrefs }
  from '../../src/js/ui/peeper/model.js';
import { drawPeeperLine, peeperView, setPeeperView } from '../../src/js/ui/peeper/view.js';
import { GLOBAL_SHORTCUTS } from '../../src/js/ui/shortcuts.js';
import { CATALOG } from '../../src/js/ui/catalog/registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

function memory() {
  let v = null;
  return { load: () => v, save: (s) => { v = s; }, get value() { return v; } };
}

test('the stub has the documented shape at 44.1 and 48 kHz', () => {
  for (const sampleRate of [44100, 48000]) {
    const probe = createProbeStub({ sampleRate, hz: 440 });
    assert.equal(probe.stub, true);
    assert.deepEqual(probe.points().map((p) => p.id), STUB_POINTS.map((p) => p.id));
    assert.deepEqual(probe.active(), { analysers: 0, leases: 0 });
    const lease = probe.tap('output:master', { windowMs: 20 });
    const r = lease.read();
    const want = windowSamples(20, sampleRate);
    assert.equal(r.window, want);
    assert.equal(r.frame.length, want);
    assert.equal(r.sampleRate, sampleRate, 'the rate is the injected one, never assumed');
    assert.equal(r.windowMs, windowMsOf(want, sampleRate), 'the actual window, not the asked one');
    assert.notEqual(r.windowMs, 20);
    assert.equal(r.live, true);
    assert.equal(r.stub, true);
    // A sine at 440 Hz: the sample at a quarter period is the peak.
    const quarter = Math.round(sampleRate / 440 / 4);
    assert.ok(Math.abs(Math.abs(r.frame[quarter]) - 1) < 0.02);
    assert.deepEqual(probe.active(), { analysers: 1, leases: 1 });
    lease.release();
    assert.deepEqual(probe.active(), { analysers: 0, leases: 0 });
  }
  assert.equal(windowSamples(20, 48000), 1024);
  assert.equal(windowSamples(20, 44100), 1024);
  assert.equal(windowSamples(0.1, 48000), 32, 'at least 32 samples');
  assert.equal(windowSamples(10000, 48000), 32768, 'at most 32768 samples');
  assert.deepEqual(STUB_POINTS.map((p) => p.id), ['output:master', 'node:osc-1/audio',
    'node:filter-1/audio', 'node:lfo-1/control'], 'the points of feat/v616-probe-tap');
  // The one swap point: main.js imports the stub on one marked line.
  const main = read('src/js/main.js');
  assert.match(main, /SWAP POINT \(branch feat\/v616-probe-tap, src\/js\/studio\/probe\.js\)/);
  assert.equal((main.match(/from '\.\/ui\/peeper\/probe-stub\.js'/g) || []).length, 1);
});

test('taps on one point share an analyser; over budget a lease says so', () => {
  const probe = createProbeStub({ budget: 2 });
  const a = probe.tap('output:master', { windowMs: 20 });
  const b = probe.tap('output:master', { windowMs: 20 });
  assert.deepEqual(probe.active(), { analysers: 1, leases: 2 });
  const c = probe.tap('node:osc-1/audio', { windowMs: 20 });
  const r = c.read();
  assert.equal(r.live, false);
  assert.equal(r.reason, 'budget');
  assert.equal(r.frame, null, 'never a fake frame');
  for (const l of [a, b, c]) l.release();
  assert.deepEqual(probe.active(), { analysers: 0, leases: 0 });
});

test('the tap list is the probe points; a target is a point, node or edge', () => {
  const probe = createProbeStub();
  const p = createPeeper({ probe });
  assert.deepEqual(p.points(), probe.points());
  assert.equal(pointFor(probe.points(), 'node:filter-1/audio'), 'node:filter-1/audio');
  assert.equal(pointFor(probe.points(), { nodeId: 'osc-1' }), 'node:osc-1/audio');
  const edges = [...probe.points(), { id: 'edge:edge-6', kind: 'audio', label: 'Cable',
    edgeId: 'edge-6' }];
  assert.equal(pointFor(edges, { edgeId: 'edge-6' }), 'edge:edge-6');
  assert.equal(pointFor(probe.points(), 'node:nope/audio'), null);
  // The UI part renders peeper.points from the model; the page lists no tap point itself.
  const page = read('src/index.html');
  assert.match(page, /x-for="pt in peeper\.points"/);
  assert.doesNotMatch(page, /<option value="(output:master|node:)/);
});

test('peep(target) opens the peeper on the target and reads it while the output plays', () => {
  const probe = createProbeStub();
  const p = createPeeper({ probe });
  p.transport(true);
  assert.equal(p.open({ nodeId: 'filter-1' }), 'node:filter-1/audio');
  assert.equal(p.state().open, true);
  assert.equal(p.read().live, true);
  assert.deepEqual(probe.active(), { analysers: 1, leases: 1 });
  assert.equal(p.switchTap('node:lfo-1/control'), true, 'switchable');
  assert.equal(p.state().tap, 'node:lfo-1/control');
  assert.deepEqual(probe.active(), { analysers: 1, leases: 1 }, 'retargeted, not a second tap');
  assert.equal(p.switchTap('node:missing/audio'), false);
});

test('pinned survives a route change and retargets; unpinned closes and releases', () => {
  const probe = createProbeStub();
  const store = memory();
  const p = createPeeper({ probe, ...store });
  p.transport(true);
  p.open('node:osc-1/audio');
  p.route('measure');
  assert.equal(p.state().open, false, 'unpinned: a route change closes it');
  assert.deepEqual(probe.active(), { analysers: 0, leases: 0 });
  p.open();
  p.pin(true);
  for (const ws of ['measure', 'studio', 'about']) {
    p.route(ws);
    assert.equal(p.state().open, true, `pinned: open after a route to ${ws}`);
    assert.equal(p.leased(), true);
  }
  assert.deepEqual(probe.active(), { analysers: 1, leases: 1 });
  assert.deepEqual(JSON.parse(store.value), { pinned: true, tap: 'node:osc-1/audio',
    windowMs: 20 });
  // A new page with the same storage: the pinned peeper comes back, on the same tap.
  const again = createPeeper({ probe: createProbeStub(), ...store });
  assert.equal(again.state().open, true);
  assert.equal(again.state().tap, 'node:osc-1/audio');
});

test('pinning is never in the hash or the history', () => {
  for (const rel of ['src/js/ui/peeper/model.js', 'src/js/ui/peeper/ui.js',
    'src/js/ui/peeper/probe-stub.js', 'src/js/ui/peeper/view.js']) {
    const src = read(rel).replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /location\.hash|pushState|replaceState|history\./, rel);
  }
  assert.equal(PEEPER_KEY, 'oscilla.peeper');
  assert.deepEqual(resolvePeeperPrefs(null), { pinned: false, tap: DEFAULT_TAP, windowMs: 20 });
  assert.deepEqual(resolvePeeperPrefs('{"pinned":true,"tap":"node:lfo-1/control","windowMs":5}'),
    { pinned: true, tap: 'node:lfo-1/control', windowMs: 5 });
  assert.deepEqual(resolvePeeperPrefs('{"windowMs":7,"tap":3}'),
    { pinned: false, tap: DEFAULT_TAP, windowMs: 20 }, 'an invalid value falls back');
  assert.deepEqual(resolvePeeperPrefs('not json'),
    { pinned: false, tap: DEFAULT_TAP, windowMs: 20 });
  // The UI part reads and writes local storage in try/catch.
  const ui = read('src/js/ui/peeper/ui.js');
  assert.match(ui, /try \{ return storage \? storage\.getItem\(PEEPER_KEY\)/);
  assert.match(ui, /try \{ if \(storage\) storage\.setItem\(PEEPER_KEY, v\)/);
});

test('close, hide, collapse and Stop release the lease; stopped reads the reason, no frame', () => {
  const probe = createProbeStub();
  const p = createPeeper({ probe });
  p.open();
  assert.equal(p.leased(), false, 'it never starts audio: nothing plays, nothing is tapped');
  const stopped = p.read();
  assert.deepEqual(stopped, { live: false, reason: 'stopped' });
  p.transport(true);
  assert.deepEqual(probe.active(), { analysers: 1, leases: 1 });
  p.transport(false);
  assert.deepEqual(probe.active(), { analysers: 0, leases: 0 }, 'after Stop: 0/0');
  assert.equal(p.state().reason, 'stopped');
  p.transport(true);
  p.visibility(true);
  assert.deepEqual(probe.active(), { analysers: 0, leases: 0 }, 'hidden: released');
  assert.equal(p.read().reason, 'hidden');
  p.visibility(false);
  p.collapse(true);
  assert.deepEqual(probe.active(), { analysers: 0, leases: 0 }, 'collapsed: released');
  p.collapse(false);
  assert.equal(p.leased(), true);
  p.close();
  assert.deepEqual(probe.active(), { analysers: 0, leases: 0 }, 'closed: released');
});

test('the peeper asks with windowMs, gets the actual window, and its release returns 0/0', () => {
  for (const sampleRate of [44100, 48000]) {
    const probe = createProbeStub({ sampleRate });
    const asked = [];
    const spy = { ...probe, tap: (id, opts) => { asked.push(opts); return probe.tap(id, opts); } };
    const p = createPeeper({ probe: spy });
    p.transport(true);
    p.open();
    assert.deepEqual(asked, [{ windowMs: 20 }], 'windowMs is the only option it passes');
    const r = p.read();
    assert.equal(r.window, windowSamples(20, sampleRate));
    assert.equal(r.windowMs, windowMsOf(r.window, sampleRate));
    // The UI shows the window it got, from the reading (ui.js peeperSync).
    assert.match(read('src/js/ui/peeper/ui.js'),
      /reading\.windowMs\.toFixed\(1\)\} ms · \$\{reading\.window\} samples/);
    p.close();
    assert.deepEqual(probe.active(), { analysers: 0, leases: 0 });
  }
});

test('the window steps through its values and re-taps at the new window', () => {
  const probe = createProbeStub({ sampleRate: 48000 });
  const p = createPeeper({ probe });
  p.transport(true);
  p.open();
  const seen = [];
  for (let i = 0; i < PEEPER_WINDOWS_MS.length; i += 1) seen.push(p.stepWindow());
  assert.deepEqual(seen, [50, 5, 10, 20]);
  assert.deepEqual(probe.active(), { analysers: 1, leases: 1 });
  assert.equal(p.read().window, windowSamples(20, 48000));
});

test('the page reaches the peeper on every page: header action, shortcut, docked section', () => {
  const page = read('src/index.html');
  const actions = page.slice(page.indexOf('data-osc="page.actions"'));
  assert.match(actions.slice(0, 3000), /data-osc="peeper\.toggle"/,
    'the action sits in the page header every workspace shows');
  assert.ok(GLOBAL_SHORTCUTS.some((r) => r.id === 'peeper' && r.keys === '`'));
  assert.match(read('src/js/ui/peeper/ui.js'), /e\.code !== 'Backquote'/);
  // Docked in the content column's flow, between <main> and the status bar: it covers nothing.
  const main = page.indexOf('</main>');
  const sec = page.indexOf('data-osc="peeper"');
  const bar = page.indexOf('<footer class="osc-statusbar"');
  assert.ok(main < sec && sec < bar);
  assert.doesNotMatch(page.slice(sec - 200, sec + 300), /\bfixed\b|\babsolute\b/);
  for (const h of ['peeper.toggle', 'peeper.tap', 'peeper.pin', 'peeper.close', 'peeper.collapse',
    'peeper.canvas', 'peeper.reason', 'peeper.stub', 'peeper.window']) {
    assert.ok(page.includes(`data-osc="${h}"`), h);
    assert.ok(CATALOG.covers(h), `${h} is declared`);
  }
  assert.equal(CATALOG.get('peeper').visual, true, 'framed: full screen for free');
});

test('the view is one function W004 can swap', () => {
  assert.equal(peeperView(), drawPeeperLine);
  const mine = () => true;
  setPeeperView(mine);
  assert.equal(peeperView(), mine);
  setPeeperView(null);
  assert.equal(peeperView(), drawPeeperLine);
  assert.equal(drawPeeperLine(null, null), false);
});

// C052, the playback bus slice: one writer of the live engine's master level. Every request for
// a master level (the status bar's gain watcher in main.js, the instrument's first voice and its
// claimMasterLevel, the Studio's Output level and its held restore through the engine hooks)
// asks the bus, which alone calls engine.setMasterGain and holdMasterGain. A scan of src/js
// (it needs no new module) refuses a caller anywhere else; on the merge base it names main.js,
// instrument.js and the engine hooks. The level that sounds follows C012 and the reviewed
// contract of docs/v31/compiler.md 244-250 (#119 D2): the Studio's Output level applies while
// it owns the output, a deliberate status-bar change applies at once (newest wins), and the
// Studio's saved level comes back held at its STOP.
//   node --test tests/unit/master-level-writer.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

/** Every .js file under src/js, relative to ROOT. */
function jsFiles(dir = path.join(ROOT, 'src', 'js')) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js')) out.push(path.relative(ROOT, p));
  }
  return out;
}

/** The files whose master-level calls are not a second writer, each with its reason. */
const EXEMPT = {
  'src/js/core/output-bus.js': 'the bus: the one writer',
  'src/js/audio/audio-engine.js': 'the engine itself: holdMasterGain composes its own '
    + 'setMasterGain',
  'src/js/studio/offline.js': 'the offline render\'s own engine: a separate context, never the '
    + 'live output',
};

const CALL = /\b[\w$.]+\.(setMasterGain|holdMasterGain)\(/g;
/** The code of a source with its comments blanked (lines kept). */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/[^\n]*/g, '');

/** Callers of setMasterGain / holdMasterGain outside the bus: "file:line name". */
function writers(files, src = read) {
  const out = [];
  for (const f of files) {
    const rel = f.split(path.sep).join('/');
    if (EXEMPT[rel]) continue;
    const text = code(src(f));
    for (const m of text.matchAll(CALL)) {
      out.push(`${rel}:${text.slice(0, m.index).split('\n').length} ${m[1]}`);
    }
  }
  return out;
}

test('C052: no caller of setMasterGain or holdMasterGain outside the bus', () => {
  assert.deepEqual(writers(jsFiles()), []);
  for (const reason of Object.values(EXEMPT)) assert.ok(reason.length > 20);
});

test('C052 mutation: one call added elsewhere is named by file and line', () => {
  const f = path.join('src', 'js', 'ui', 'workbench.js');
  const added = `${read(f)}\nfunction x(engine) { engine.setMasterGain(0.5); }\n`;
  const found = writers([f], () => added);
  assert.equal(found.length, 1, found.join(' | '));
  assert.match(found[0], /^src\/js\/ui\/workbench\.js:\d+ setMasterGain$/);
  assert.deepEqual(writers([f], () => '// engine.setMasterGain(g) in a comment\n'), []);
});

/** A fake live engine that records each master write, and the bus over it. */
async function rig() {
  const { createOutputBus, requestMasterLevel } = await import('../../src/js/core/output-bus.js');
  const writes = [];
  const engine = { gainLevel: 0.08,
    setMasterGain(g) { this.gainLevel = g; writes.push(['set', g]); },
    holdMasterGain(g, at) { this.gainLevel = g; writes.push(['hold', g, at]); } };
  const cmp = { playing: false, notify() {}, measureOwnsOutput: () => false,
    studioOwnsOutput: () => false, stopNow() {}, studioStop() {} };
  const bus = createOutputBus({ app: () => cmp, sequencer: () => null, engine });
  return { bus, engine, writes, ask: (g, o) => requestMasterLevel(engine, g, o) };
}

test('C052: the Studio\'s Output level applies while it owns; a status-bar change is newest',
  async () => {
  const { bus, engine, writes, ask } = await rig();
  ask(0.2, { owner: 'instrument' }); // the instrument's claimMasterLevel
  bus.claim('studio', 'play');
  ask(0.5, { owner: 'studio' }); // the Studio's Output node, through the engine hooks
  assert.equal(engine.gainLevel, 0.5, 'the Studio\'s Output level sounds while it owns');
  bus.setMaster(0.3, { owner: 'instrument' }); // the status bar's gain watcher (main.js)
  assert.equal(engine.gainLevel, 0.3, 'a deliberate status-bar change applies at once');
  assert.deepEqual(writes, [['set', 0.2], ['set', 0.5], ['set', 0.3]]);
});

test('C052: instrument -> Studio -> instrument returns to the status-bar level', async () => {
  const { bus, engine, ask } = await rig();
  ask(0.2, { owner: 'instrument' });
  bus.claim('studio', 'play');
  ask(0.6, { owner: 'studio' });
  bus.claim('instrument', 'play');
  ask(0.2, { owner: 'instrument' }); // claimMasterLevel at the instrument's next voice
  assert.equal(engine.gainLevel, 0.2);
});

test('C052: the Studio\'s saved level comes back held at its STOP (runtime restoreMaster)',
  async () => {
  const { engine, writes, ask } = await rig();
  ask(0.25, { owner: 'instrument' });
  ask(0.7, { owner: 'studio' });
  ask(0.25, { owner: 'studio', at: 12.5 }); // hooks.restoreMasterLevel(saved, at)
  assert.deepEqual(writes.at(-1), ['hold', 0.25, 12.5], 'the restore is a held glide');
  assert.equal(engine.gainLevel, 0.25);
});

test('C052: each master write is a step of the bus\'s trace; no bus, written directly',
  async () => {
  const { createOutputBus, requestMasterLevel } = await import('../../src/js/core/output-bus.js');
  const { createTrace } = await import('../../src/js/core/trace.js');
  const trace = createTrace({ now: () => 0 });
  const engine = { setMasterGain() {}, holdMasterGain() {} };
  createOutputBus({ app: () => null, sequencer: () => null, engine, trace });
  requestMasterLevel(engine, 0.4, { owner: 'studio' });
  const s = trace.steps().at(-1);
  assert.deepEqual([s.owner, s.kind, s.entity.id, s.detail.level],
    ['bus', 'master', 'studio', 0.4]);
  const offline = { level: null, setMasterGain(g) { this.level = g; } }; // an offline render's
  requestMasterLevel(offline, 0.9);
  assert.equal(offline.level, 0.9);
});

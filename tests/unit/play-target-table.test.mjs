// U127 (C032, docs/reconstruction/07-target-architecture.md §4.3, 05-accessibility-audit.md
// problem 12): ONE per-place play-target table (src/js/core/play-target.js PLAY_TARGET) names
// what Play and Space act on in each place, and everything that used to keep a list of its own
// is derived from it:
//   - ui/shortcuts.js SPACE_OWNER (who answers Space with nothing focused, ADR 0050)
//   - core/play-hints.js STATUS_PLAY_WORKSPACES (where the status Play shows at every width, C030)
//   - the status bar's Play (ui/status-play.js): what a click starts, its name, where it hides
//   - the Space row of the Keyboard shortcuts dialog (ui/shortcuts.js shortcutHelp)
// In the Sequencer the target is the sequence: Space and the status Play start and stop the
// Pattern Sequencer, not the instrument's tone (it played the tone in all three engines).
// A second hand-written list of the same decision anywhere under src/js fails (mutation cases).
// Fails on the merge base, which has no core/play-target.js and two lists.
//   node --test tests/unit/play-target-table.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORKSPACES } from '../../src/js/ui/app.js';
import { OWNER } from '../../src/js/core/output-bus.js';
import {
  MEASURE_TARGET, PLAY_ACTIONS, PLAY_TARGET, SYNTH_TARGET, playTarget, spaceTarget,
  statusPlayEveryWidth,
} from '../../src/js/core/play-target.js';
import { STATUS_PLAY_WORKSPACES } from '../../src/js/core/play-hints.js';
import {
  SPACE_MEANING, SPACE_OWNER, instrumentTakesSpace, sequenceTakesSpace, shortcutHelp,
} from '../../src/js/ui/shortcuts.js';
import { createWorkbench } from '../../src/js/ui/workbench.js';
import { bindPageKeys } from '../../src/js/ui/keys/clients.js';
import { createKeyRegistry } from '../../src/js/ui/keys/registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TABLE_FILE = 'src/js/core/play-target.js';
const TARGETS = [OWNER.instrument, OWNER.sequencer, OWNER.studio, SYNTH_TARGET, MEASURE_TARGET];

test('U127: the table has one row per place, each naming a known target', () => {
  assert.deepEqual(Object.keys(PLAY_TARGET).sort(), [...WORKSPACES].sort());
  for (const [place, row] of Object.entries(PLAY_TARGET)) {
    assert.ok(row.target === null || TARGETS.includes(row.target), `${place}: ${row.target}`);
    assert.equal(typeof row.space, 'boolean', place);
    assert.equal(typeof row.ownPlay, 'boolean', place);
    if (!row.target) assert.ok(!row.space && !row.ownPlay, `${place}: nothing plays there`);
  }
  for (const t of TARGETS) {
    assert.equal(typeof PLAY_ACTIONS[t].run, 'string', t);
  }
  assert.equal(playTarget('bogus').target, null);
  assert.equal(playTarget('__proto__').target, null);
});

test('U127: the places and their targets (C032, 07 §4.3)', () => {
  const target = Object.fromEntries(Object.entries(PLAY_TARGET).map(([p, r]) => [p, r.target]));
  assert.deepEqual(target, {
    playground: 'instrument', measure: 'measure', experiments: null, analyzer: 'instrument',
    filter: 'instrument', compare: 'instrument', synthesis: 'instrument',
    sequencer: 'sequencer', presets: 'instrument', learn: null, studio: 'studio',
    synth: 'synth', about: null,
  });
  // the Synth plays from its keys and Měření's stimulus only from its button (ADR 0050)
  assert.equal(PLAY_TARGET.synth.space, false);
  assert.equal(PLAY_TARGET.measure.space, false);
});

test('U127: SPACE_OWNER is the table read for Space', () => {
  for (const place of WORKSPACES) {
    const r = PLAY_TARGET[place];
    assert.equal(SPACE_OWNER[place], r.space ? r.target : null, place);
    assert.equal(spaceTarget(place), SPACE_OWNER[place], place);
    assert.equal(instrumentTakesSpace(place), SPACE_OWNER[place] === OWNER.instrument, place);
    assert.equal(sequenceTakesSpace(place), SPACE_OWNER[place] === OWNER.sequencer, place);
  }
});

test('U127: STATUS_PLAY_WORKSPACES is the table read for the status Play at every width', () => {
  assert.deepEqual([...STATUS_PLAY_WORKSPACES], WORKSPACES.filter((p) =>
    PLAY_TARGET[p].target === OWNER.instrument && !PLAY_TARGET[p].ownPlay));
  for (const place of WORKSPACES) {
    assert.equal(statusPlayEveryWidth(place), !!PLAY_TARGET[place].target
      && !PLAY_TARGET[place].ownPlay, place);
  }
});

/** The workbench's status Play over fakes that record what was started. */
function rig(workspace, extra = {}) {
  const calls = [];
  const editor = { playing: false, togglePlay() { calls.push('sequencer'); this.playing = true; } };
  const svc = { labs: { sequencer: { editor, render() {} } },
    sequencerPlaying: () => editor.playing, stopAll: () => calls.push('stopAll'),
    stopPlayback: () => calls.push('stopPlayback') };
  const wb = createWorkbench(svc);
  Object.assign(wb, { workspace, playback: { owner: null, since: 0 }, playing: false,
    continuousAllowed: false, isProgrammed: false, kbdSounding: false,
    studio: { playing: false }, synth: { armed: false },
    meas: { flow: { primaryAction: { label: 'Zkontrolovat nastavení', enabled: true } } },
    trigger() { calls.push('instrument'); },
    toggleLatch() { calls.push('instrument'); },
    studioTogglePlay() { calls.push('studio'); },
    synthArm() { calls.push('synth'); },
    measureRunPrimary() { calls.push('measure'); },
    ...extra });
  return { wb, calls, editor };
}

test('U127: the status Play starts, names and hides by the table, in every place', () => {
  for (const place of WORKSPACES) {
    const { wb, calls } = rig(place);
    const t = PLAY_TARGET[place].target;
    assert.equal(wb.statusPlayTarget, t, place);
    assert.equal(wb.statusPlayShown, statusPlayEveryWidth(place), place);
    assert.equal(wb.statusPlayHidden, !t, `${place}: hidden where nothing plays`);
    wb.statusPlay();
    assert.deepEqual(calls, t ? [t] : [], `${place}: a click starts ${t}`);
    const name = t === MEASURE_TARGET ? 'Zkontrolovat nastavení' : t && PLAY_ACTIONS[t].name;
    assert.equal(wb.statusPlayName, name || 'Přehrát', place);
  }
});

test('U127: in the Sequencer the status Play starts the sequence, never the tone', () => {
  const { wb, calls, editor } = rig('sequencer');
  wb.statusPlay();
  assert.deepEqual(calls, ['sequencer']);
  assert.equal(editor.playing, true);
  // the sequence plays: the bar reads Stop and its press stops it (the bus's stopAll)
  wb.playback = { owner: OWNER.sequencer, since: 0 };
  assert.equal(wb.statusPlayName, 'Zastavit přehrávání');
  wb.statusPlay();
  assert.deepEqual(calls, ['sequencer', 'stopAll']);
});

test('U127: what sounds is shown and stopped in every place (Q114), the Studio included', () => {
  for (const place of WORKSPACES) {
    for (const sounding of [{ playing: true }, { kbdSounding: true },
      { studio: { playing: true } }, { synth: { armed: true } }]) {
      const { wb, calls } = rig(place, sounding);
      assert.equal(wb.statusPlayHidden, false, `${place} ${JSON.stringify(sounding)}`);
      assert.equal(wb.statusPlayName, 'Zastavit přehrávání', place);
      wb.statusPlay();
      assert.deepEqual(calls, ['stopAll'], `${place}: the Stop starts nothing`);
    }
  }
});

test('U127: Space in the Sequencer plays and stops the sequence (the page key binding)', () => {
  const keys = createKeyRegistry();
  let toggles = 0;
  const cmp = { workspace: 'sequencer', sequenceTogglePlay: () => { toggles += 1; },
    onKeyDown() { throw new Error('the instrument answered Space in the Sequencer'); } };
  bindPageKeys({ keys, cmp, stopSequencer() {} });
  const b = keys.resolve('Space', { workspace: 'sequencer' });
  assert.equal(b.id, 'sequence.space');
  b.run({});
  assert.equal(toggles, 1);
  for (const place of WORKSPACES.filter((p) => p !== 'sequencer')) {
    cmp.workspace = place;
    const r = keys.resolve('Space', { workspace: place });
    assert.equal(r ? r.id : null, instrumentTakesSpace(place) ? 'instrument.space' : null, place);
  }
});

test('U127: the dialog\'s Space row is the table\'s, the Sequencer\'s the sequence', () => {
  for (const place of WORKSPACES) {
    assert.deepEqual(shortcutHelp(place).space, SPACE_MEANING[SPACE_OWNER[place] || 'none'],
      place);
  }
  assert.equal(shortcutHelp('sequencer').space.text, 'Přehrání / zastavení sekvence');
  assert.ok(!shortcutHelp('sequencer').rows.some((r) => r.keys === 'Space'),
    'no second Space row in the Sequencer');
});

// ------------------------------------------------------------------ one table, no second list
const IDS = WORKSPACES.join('|');
const VALUE = `(OWNER\\.\\w+|null|'(${TARGETS.join('|')})')`;
/** The place lists the table derives, as sets: a literal array equal to one is a second list. */
const DERIVED = [STATUS_PLAY_WORKSPACES, WORKSPACES.filter((p) => SPACE_OWNER[p] === 'instrument'),
  WORKSPACES.filter((p) => !SPACE_OWNER[p])].map((l) => [...l].sort().join(','));

/** The kinds of second play-target list in `text` (a source file). */
export function secondPlayLists(text) {
  const found = [];
  if (/\bSPACE_OWNER\s*=\s*Object\.freeze\(\s*\{/.test(text)) found.push('a SPACE_OWNER literal');
  if (/\bSTATUS_PLAY_WORKSPACES\s*=\s*Object\.freeze\(\s*\[/.test(text)) {
    found.push('a STATUS_PLAY_WORKSPACES literal');
  }
  // three places in a row, each given a target (a comment may follow an entry)
  const entry = `\\b(${IDS})\\s*:\\s*${VALUE}\\s*,\\s*(\\/\\/[^\\n]*\\n\\s*)?`;
  if (new RegExp(entry.repeat(3)).test(text)) found.push('a place-keyed map of targets');
  for (const m of text.matchAll(/\[\s*'[a-z]+'(?:\s*,\s*'[a-z]+')+\s*,?\s*\]/g)) {
    const ids = [...m[0].matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort().join(',');
    if (DERIVED.includes(ids)) { found.push('a literal list of places the table derives'); break; }
  }
  return found;
}

const jsFiles = (dir) => readdirSync(path.join(ROOT, dir)).flatMap((n) => {
  const rel = path.join(dir, n);
  if (statSync(path.join(ROOT, rel)).isDirectory()) return jsFiles(rel);
  return n.endsWith('.js') ? [rel] : [];
});

test('U127: no second play-target list under src/js, outside the table', () => {
  const hits = jsFiles('src/js').filter((f) => f !== TABLE_FILE)
    .map((f) => [f, secondPlayLists(readFileSync(path.join(ROOT, f), 'utf8'))])
    .filter(([, kinds]) => kinds.length);
  assert.deepEqual(hits, []);
});

test('U127 mutation: each kind of re-added second list is found', () => {
  const cases = {
    // the merge base's two lists, as they were written
    'a SPACE_OWNER literal': 'export const SPACE_OWNER = Object.freeze({\n  playground: x,\n});',
    'a STATUS_PLAY_WORKSPACES literal':
      "export const STATUS_PLAY_WORKSPACES = Object.freeze(['analyzer']);",
    'a place-keyed map of targets': 'const S = {\n  playground: OWNER.instrument,\n'
      + "  measure: null, // nothing\n  sequencer: 'instrument',\n};",
    'a literal list of places the table derives':
      "const P = ['presets', 'analyzer', 'filter', 'compare'];",
  };
  for (const [kind, src] of Object.entries(cases)) {
    assert.deepEqual(secondPlayLists(src), [kind], kind);
  }
  // a map keyed by place whose values are not targets, and a partial list, are not lists of it
  const notIt = "const L = { playground: 'Playground', measure: 'Měření' };"
    + "\nconst from = ['analyzer', 'compare'];\nconst f = { filter: null, sequencer: null, x: 1 };";
  assert.deepEqual(secondPlayLists(notIt), []);
  // the merge base's SPACE_OWNER, whole: a literal and a place-keyed map of targets
  const base = 'export const SPACE_OWNER = Object.freeze({\n  playground: OWNER.instrument,\n'
    + '  measure: null,\n  experiments: null,\n  sequencer: OWNER.instrument,\n'
    + '  synth: null, // the Synth plays from its keys\n  about: null,\n});';
  assert.deepEqual(secondPlayLists(base),
    ['a SPACE_OWNER literal', 'a place-keyed map of targets']);
});

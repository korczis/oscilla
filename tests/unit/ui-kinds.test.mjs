// The instrument kind contract (plan issue W001, ADR 0081 decisions 2-3, ADR 0086): defineKind()
// and its prop descriptors (src/js/ui/catalog/kind.js), the declarations of
// src/js/ui/catalog/kinds/ (one so far, step-grid, whose view and first consumer are W008 and
// K222), the checks of scripts/ui-catalog/kinds-check.mjs, the digest pin
// tests/unit/ui-kinds-digest.json and the trace scripts/ui-catalog/trace/kinds.mjs.
//
// What it proves:
//   - the repository holds the contract for every declared kind: unique kind and version,
//     defaults that validate, io from the closed list, every emits target a Studio action type
//     of studio/actions.js, a command of the transport (studio/transport.js; there is no
//     transport-commands.js), a call of the note router (studio/live-notes.js), view or null;
//     state paths under the grammar that sources.js lists; links that resolve to a workspace
//     route or a catalogue id (G007's link address grammar is not built, so nothing else
//     resolves); an allowed WAI-ARIA role; no Space, no reserved key and no chord used twice;
//     every pointer and touch event reached by a key; a minimum target of 44 px or an exemption
//     of five words; a 390x844 rule; a reduced-motion rule on a live kind; truth rows that
//     exist; impl modules that exist or that the issue adding them names in its scope; a trace
//     entry whose ids resolve; the pinned digest of its props, events and keys;
//   - every key's row is in the Keyboard shortcuts dialog (shortcuts.js) once the kind's view
//     exists; before that the rows are pending on the issue that adds the view (W008), listed;
//   - a fixture per negative case of W001 is refused (the eight of the objective);
//   - the five rules: no bare letter key; a view keeps only transient state; literal class
//     names and no el.style; the mount's returns; no runtime module imports a declaration;
//   - the static scan over src/js/ui/kinds and the kinds' model modules refuses each import and
//     call it names (fixtures), and every kind is a name of the one closed list of kinds.js.
//   node --test tests/unit/ui-kinds.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS } from '../../src/js/ui/catalog/kinds.js';
import { KIND_DECLARATIONS } from '../../src/js/ui/catalog/kinds/index.js';
import stepGrid from '../../src/js/ui/catalog/kinds/step-grid.js';
import { ARIA_ROLES, IO, MIN_TARGET_PX, OWNER_STATE, TRANSIENT_STATE, canonicalJson,
  chordProblems, defineKind, instanceProblems, kindProblems, prop }
  from '../../src/js/ui/catalog/kind.js';
import { validateParamValue } from '../../src/js/studio/registry.js';
import { checkKindRepository, checkKinds, digestOf, issueScope, kindModuleFiles, loadKindFacts,
  pinOf, pinProblems, runtimeImportProblems, scanKindModules, transportCommands,
  UNDECLARED_VIEWS, undeclaredViewProblems } from '../../scripts/ui-catalog/kinds-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FACTS = await loadKindFacts(ROOT);

/** A raw, editable copy of a declaration (its prop descriptors kept as they are). */
const raw = (d) => ({ ...JSON.parse(JSON.stringify({ ...d, props: undefined })),
  props: [...d.props] });
/** The step-grid declaration with `edit` applied, as a raw object. */
const variant = (edit) => { const d = raw(stepGrid); edit(d); return d; };
/** The repository check of `decls` with `more` facts overriding the real ones. */
const check = (decls, more = {}) => checkKinds({ kinds: decls, facts: { ...FACTS, ...more } });
/** Asserts some problem matches `re`. */
function refused(problems, re) {
  const texts = problems.map((p) => (typeof p === 'string' ? p : p.message));
  assert.ok(texts.some((t) => re.test(t)), `expected ${re}, got ${JSON.stringify(texts)}`);
}
const throwsKind = (decl, re) => assert.throws(() => defineKind(decl),
  (e) => e instanceof TypeError && e.message.startsWith(`defineKind(${decl.kind}):`)
    && re.test(e.message));

// ------------------------------------------------------------------------------ the repository
test('the repository holds the kind contract', async () => {
  const { problems } = await checkKindRepository(ROOT);
  assert.deepEqual(problems, []);
});

test('one kind mechanism: every declared kind is a name of kinds.js KINDS, declared once', () => {
  assert.ok(KIND_DECLARATIONS.length >= 1);
  for (const d of KIND_DECLARATIONS) assert.ok(KINDS.includes(d.kind), d.kind);
  const names = KIND_DECLARATIONS.map((d) => d.kind);
  assert.equal(new Set(names).size, names.length);
  // One file per kind in kinds/, named by the kind, and the index lists them all.
  const files = readdirSync(path.join(ROOT, 'src/js/ui/catalog/kinds')).sort();
  assert.deepEqual(files, ['index.js', ...names.map((n) => `${n}.js`)].sort());
  assert.ok(Object.isFrozen(stepGrid) && Object.isFrozen(stepGrid.events[0]));
  assert.equal(KIND_DECLARATIONS[0], stepGrid);
});

test('step-grid: a projection of the notes clip, one action per gesture, no steps clip', () => {
  // Version 2 (W008): the grid change, NOTES_GRID_SET, joined with the Studio's action.
  assert.equal(stepGrid.version, 2);
  assert.deepEqual(stepGrid.events.find((e) => e.name === 'grid').emits, ['NOTES_GRID_SET']);
  assert.deepEqual([...stepGrid.state], ['studio.clip', 'notes']);
  for (const s of stepGrid.state) assert.ok(FACTS.sources.has(s), s);
  const targets = new Set(stepGrid.events.flatMap((e) => e.emits || []));
  assert.deepEqual([...targets].sort(), ['CLIP_UPDATE', 'NODE_PARAM_SET', 'NOTES_GRID_SET',
    'view']);
  for (const t of ['CLIP_UPDATE', 'NODE_PARAM_SET', 'NOTES_GRID_SET']) {
    assert.ok(FACTS.actionTypes.has(t), t);
  }
  assert.ok(!JSON.stringify(stepGrid).includes('steps clip'));
  // Defaults validate; ADR 0086 decision 2's default grid and decision 3's accent.
  for (const p of stepGrid.props) assert.equal(validateParamValue(p, p.default), null, p.key);
  const def = Object.fromEntries(stepGrid.props.map((p) => [p.key, p.default]));
  assert.equal(def.steps, 16);
  assert.equal(def.stepBeats, 0.25);
  assert.equal(stepGrid.constants.accentVel, 0.8);
  // The owner's state is a prop (rule 2), never kept by the view.
  for (const k of ['page', 'selection']) assert.ok(stepGrid.props.some((p) => p.key === k), k);
  // ARIA, target, layout, reduced motion, truth, impl.
  assert.equal(stepGrid.aria.role, 'grid');
  assert.equal(stepGrid.aria.parts.step, 'gridcell');
  assert.ok(stepGrid.target.min >= MIN_TARGET_PX);
  assert.ok(stepGrid.layout['390x844'].length > 0);
  assert.equal(stepGrid.live, true);
  assert.ok(stepGrid.reducedMotion.length > 0);
  assert.deepEqual(Object.keys(stepGrid.truth), ['none']);
  assert.equal(stepGrid.impl.issue, 'W008');
  const scope = FACTS.issueScope('W008');
  for (const m of stepGrid.impl.modules) assert.ok(scope.includes(m), m);
});

test('step-grid: every pointer and touch event is reached by a key, Space is never one', () => {
  const chords = stepGrid.keys.map((k) => k.chord);
  assert.equal(new Set(chords).size, chords.length);
  assert.ok(!chords.some((c) => /Space| $/.test(c)));
  for (const n of new Set([...stepGrid.pointer.events, ...stepGrid.touch.events])) {
    const e = stepGrid.events.find((x) => x.name === n);
    const bound = stepGrid.keys.some((k) => k.event === n);
    assert.ok(bound || (e.keyPath || []).every((c) => chords.includes(c)), n);
  }
  // The keys of W008's objective, each mapped to one event.
  assert.deepEqual(Object.fromEntries(stepGrid.keys.map((k) => [k.chord, k.event])), {
    ArrowLeft: 'move', ArrowRight: 'move', ArrowUp: 'move', ArrowDown: 'move',
    'Shift+ArrowLeft': 'select', 'Shift+ArrowRight': 'select', 'Shift+ArrowUp': 'select',
    'Shift+ArrowDown': 'select', Enter: 'toggle', 'Mod+C': 'copy', 'Mod+X': 'cut',
    'Mod+V': 'paste', Delete: 'clear', PageUp: 'transpose', PageDown: 'transpose',
    'Shift+PageUp': 'transpose', 'Shift+PageDown': 'transpose', '[': 'page', ']': 'page',
    'Shift+F10': 'menu', ContextMenu: 'menu',
  });
});

test('the key rows wait on W008 for the shortcuts table, judged once the view exists', async () => {
  const { pending } = await checkKindRepository(ROOT);
  assert.deepEqual(pending.map((p) => `${p.kind} ${p.workspace} ${p.row} ${p.issue}`), [
    'step-grid synth step-grid-move W008', 'step-grid synth step-grid-select W008',
    'step-grid synth step-grid-toggle W008', 'step-grid synth step-grid-clipboard W008',
    'step-grid synth step-grid-clear W008', 'step-grid synth step-grid-transpose W008',
    'step-grid synth step-grid-page W008', 'step-grid synth step-grid-menu W008']);
  // With the view on disk, a row the dialog lacks is refused; listed, it passes.
  const exists = () => true;
  refused(check([stepGrid], { exists }).problems,
    /key row step-grid-move is not in the shortcuts table of synth/);
  const rows = new Set(stepGrid.keys.map((k) => k.row));
  assert.deepEqual(check([stepGrid], { exists, shortcutRows: () => rows }),
    { problems: [], pending: [] });
});

test('a view whose kind is not declared yet waits outside the scan, listed with its issue', () => {
  // The XY pad view landed with K183 (#426) before W010 declares the xy-pad kind.
  assert.deepEqual({ ...UNDECLARED_VIEWS }, { 'src/js/ui/kinds/xy-pad.js': 'W010' });
  const files = kindModuleFiles(ROOT, KIND_DECLARATIONS);
  assert.ok(!('src/js/ui/kinds/xy-pad.js' in files), 'the undeclared view is left out');
  // Unlisted, the same view is scanned (and its timer refused): the list is what exempts it.
  refused(scanKindModules(kindModuleFiles(ROOT, KIND_DECLARATIONS, {})),
    /xy-pad\.js: calls a timer or an animation frame/);
  // The list only shrinks: a stale, declared, misplaced or unplanned entry is refused.
  const env = { exists: () => true, issueExists: () => true };
  assert.deepEqual(undeclaredViewProblems(KIND_DECLARATIONS, env), []);
  refused(undeclaredViewProblems(KIND_DECLARATIONS, { ...env, exists: () => false }),
    /the file does not exist/);
  refused(undeclaredViewProblems(KIND_DECLARATIONS, { ...env, issueExists: () => false }),
    /plan issue W010 does not exist/);
  refused(undeclaredViewProblems(KIND_DECLARATIONS, env, { 'src/js/synth/ui.js': 'W010' }),
    /outside src\/js\/ui\/kinds/);
  const declared = variant((v) => { v.impl.modules = ['src/js/ui/kinds/xy-pad.js']; });
  refused(undeclaredViewProblems([declared], env), /a declaration names it/);
});

test('the facts are read from the source: transport commands, note router, issue scope', () => {
  const cmds = [...FACTS.transportCommands];
  for (const c of ['start', 'stop', 'locate', 'setLoop', 'playhead', 'live', 'arm']) {
    assert.ok(cmds.includes(c), c);
  }
  assert.deepEqual(transportCommands('export function createStudioTransport() {\n'
    + '  return Object.freeze({\n    start,\n    live(a) {\n    },\n    get playing() {},\n'
    + '  });\n}'), ['start', 'live', 'playing']);
  assert.deepEqual([...FACTS.noteRouterCalls].sort(), ['allOff', 'event', 'held', 'reset']);
  assert.deepEqual(issueScope('id: X\nscope:\n- a/b.js\n  - "c d"\nnext: 1\n'), ['a/b.js', 'c d']);
});

// ------------------------------------------------------------------------------ the eight
test('negative 1: a kind without keys for a pointer event', () => {
  const d = variant((v) => { delete v.events.find((e) => e.name === 'paint').keyPath; });
  refused(kindProblems(d), /pointer: událost paint nemá klávesu/);
  const t = variant((v) => { v.touch.events.push('nowhere'); });
  refused(kindProblems(t), /touch: událost nowhere není deklarována/);
  const path = variant((v) => { v.events.find((e) => e.name === 'value').keyPath = ['Home']; });
  refused(kindProblems(path), /keyPath Home není klávesou druhu/);
  throwsKind(d, /nemá klávesu/);
});

test('negative 2: a key map holding Space, or a bare key used twice', () => {
  for (const chord of ['Space', ' ', 'Shift+Space', 'Mod+Space']) {
    const d = variant((v) => { v.keys.push({ chord, event: 'toggle', row: 'step-grid-toggle' }); });
    refused(kindProblems(d), /Space patří transportu nebo nástroji/);
  }
  const twice = variant((v) => { v.keys.push({ chord: 'Enter', event: 'clear', row: 'x' }); });
  refused(kindProblems(twice), /zkratka Enter je použita dvakrát/);
  for (const chord of ['Tab', 'Escape']) refused(chordProblems(chord), /globální klávesy/);
  refused(chordProblems('Shift+Mod+C'), /v tomto pořadí/);
  refused(chordProblems('Hyper+C'), /v tomto pořadí/);
  refused(chordProblems('Spacebar'), /není název klávesy/);
  assert.deepEqual(chordProblems('Mod+Shift+ArrowLeft'), []);
});

test('negative 3: an event emitting an action type the Studio does not export', () => {
  const d = variant((v) => { v.events.find((e) => e.name === 'toggle').emits = ['STEPS_SET']; });
  assert.deepEqual(kindProblems(d), []);
  refused(check([d]).problems, /emits STEPS_SET, which is neither a Studio action type/);
  for (const [t, ok] of [['transport.start', true], ['transport.teleport', false],
    ['notes.event', true], ['notes.bogus', false], ['view', true]]) {
    const v = variant((x) => { x.events[0].emits = [t]; });
    assert.equal(check([v]).problems.length === 0, ok, t);
  }
  const lower = variant((v) => { v.events[0].emits = ['clip_update']; });
  refused(kindProblems(lower), /emits je null, nebo seznam typů akcí/);
  assert.deepEqual(check([variant((v) => { v.events[0].emits = null; })]).problems, []);
});

test('negative 4: a state path outside the grammar', () => {
  for (const s of ['Studio.clip', 'studio..clip', 'studio/clip', 'notes[0]', '']) {
    refused(kindProblems(variant((v) => { v.state = [s]; })),
      s ? /je mimo gramatiku stavových cest/ : /state musí vyjmenovat/);
  }
  const unknown = variant((v) => { v.state = ['studio.steps']; });
  assert.deepEqual(kindProblems(unknown), []);
  refused(check([unknown]).problems, /state studio\.steps is not a path of sources\.js/);
});

test('negative 5: a target under 44 px without an exemption of five words', () => {
  const small = variant((v) => { v.target = { min: 32, exemption: 'too small here' }; });
  refused(kindProblems(small), /je pod 44 px bez výjimky/);
  const none = variant((v) => { v.target = { min: 40 }; });
  refused(kindProblems(none), /pod 44 px/);
  const ok = variant((v) => { v.target = { min: 32,
    exemption: 'a dense lane keeps its 44 px row height' }; });
  assert.deepEqual(kindProblems(ok), []);
});

test('negative 6: a missing truth row', () => {
  const d = variant((v) => { v.truth = ['step-grid.playhead']; });
  assert.deepEqual(kindProblems(d), []);
  refused(check([d]).problems, /truth row step-grid\.playhead is not in docs\/v3\/readout-truth/);
  const real = variant((v) => { v.truth = ['keyboard.held']; });
  assert.deepEqual(check([real]).problems, []);
  refused(kindProblems(variant((v) => { v.truth = { none: 'no' }; })), /truth musí vyjmenovat/);
  refused(kindProblems(variant((v) => { v.truth = []; })), /truth musí vyjmenovat/);
});

test('negative 7: an instance whose props fail its kind', () => {
  assert.deepEqual(instanceProblems(stepGrid, { steps: 16, lanes: [36, 38, 42],
    mode: 'notes', clipId: 'clip-1', page: 1, selection: [2, 5] }), []);
  refused(instanceProblems(stepGrid, { steps: 65 }),
    /vlastnost steps: 65 must be between 1 and 64/);
  refused(instanceProblems(stepGrid, { lanes: [128] }), /vlastnost lanes: .* between 0 and 127/);
  refused(instanceProblems(stepGrid, { mode: 'steps' }), /vlastnost mode: "steps" must be one of/);
  refused(instanceProblems(stepGrid, { clipId: '1 2' }), /vlastnost clipId: .* invalid format/);
  refused(instanceProblems(stepGrid, { swing: 0.5 }), /swing není vlastností druhu step-grid/);
});

test('negative 8: a declared shape changed without a version bump', () => {
  const pin = pinOf([stepGrid]);
  assert.deepEqual(pinProblems([stepGrid], pin), []);
  const changed = variant((v) => { v.keys.pop(); });
  refused(pinProblems([changed], pin), /shape \(props, events, keys\) changed without a version/);
  const prop1 = variant((v) => { v.props[5] = prop.integer('steps', 'Steps', { min: 1, max: 32,
    default: 16 }); });
  refused(pinProblems([prop1], pin), /changed without a version bump/);
  // A bump must be re-pinned; once re-pinned, an earlier copy at the old version passes.
  const v = stepGrid.version;
  const bumped = { ...changed, version: v + 1 };
  refused(pinProblems([bumped], pin), new RegExp(`version ${v + 1}, pinned ${v}: re-pin`));
  assert.deepEqual(pinProblems([bumped], pinOf([bumped]), [{ sha: 'base', pin }]), []);
  // Re-pinned without a bump, the base branch's copy still refuses it.
  refused(pinProblems([changed], pinOf([changed]), [{ sha: 'origin/main', pin }]),
    new RegExp(`without a version bump \\(version ${v} at origin\\/main\\)`));
  refused(pinProblems([{ ...stepGrid, version: v }], { 'step-grid': { ...pin['step-grid'],
    version: v + 1 } }), new RegExp(`version ${v} is below ${v + 1}`));
  refused(pinProblems([], pin), /pinned .* but not declared/);
  refused(pinProblems([stepGrid], {}), /no pin in tests\/unit\/ui-kinds-digest\.json/);
  // Only the shape is hashed: docs and layout change no digest.
  assert.equal(digestOf(variant((v) => { v.docs += ' Again.'; })), digestOf(stepGrid));
});

// ------------------------------------------------------------------------------ the five rules
test('rule 1: no kind binds a bare letter or digit key', () => {
  for (const chord of ['A', 'Shift+A', '5', 'Shift+7']) {
    refused(chordProblems(chord), /samotné písmeno nebo číslice patří zapnuté klávesnici/);
  }
  refused(chordProblems('Mod+c'), /písmeno se píše velké/);
  for (const chord of ['Mod+A', 'Alt+5', 'Ctrl+Shift+Z', '[', 'F2']) {
    assert.deepEqual(chordProblems(chord), [], chord);
  }
  throwsKind(variant((v) => { v.keys.push({ chord: 'R', event: 'ratchet', row: 'x' }); }),
    /samotné písmeno/);
});

test('rule 2: a view keeps only transient state; the owner passes the rest', () => {
  assert.deepEqual([...TRANSIENT_STATE], ['focus', 'drag-preview', 'open-entry']);
  for (const s of OWNER_STATE) {
    refused(kindProblems(variant((v) => { v.transient = ['focus', s]; })),
      new RegExp(`${s} předává vlastník`));
  }
});

test('rule 3: literal class names, no el.style, no style attribute', () => {
  const ok = { 'src/js/ui/kinds/x.js': "el.className = 'grid gap-1';\n"
    + "h('button', { class: 'size-11 rounded-lg', 'aria-pressed': on ? 'true' : 'false' });\n"
    + "svg.setAttribute('width', '44');\n" };
  assert.deepEqual(scanKindModules(ok), []);
  for (const [text, re] of [
    ['el.style.width = w;', /el\.style write/],
    ["el.style.setProperty('--x', 1);", /el\.style write/],
    ['el.style.cssText = s;', /el\.style write/],
    ["el.setAttribute('style', s);", /style attribute/],
    ["h('div', { style: s });", /style attribute/],
    ["host.innerHTML = '<div style=\"left:2px\"></div>';", /style attribute/],
    ['el.className = `w-${n}`;', /builds a class name at run time/],
    ["h('i', { class: `bg-${tone}` });", /builds a class name at run time/],
    ["el.className = 'w-' + n;", /builds a class name at run time/],
    ['el.classList.add(`ring-${n}`);', /builds a class name at run time/],
    ["el.className += ' on';", /appends to className/],
  ]) {
    refused(scanKindModules({ 'src/js/ui/kinds/x.js': text }), re);
  }
});

test('rule 4: every mount returns element, set, setDisabled, destroy and its extras', () => {
  const view = 'src/js/ui/kinds/step-grid.js';
  const good = 'export function mountStepGrid(host, props, owner) {\n'
    + '  const element = host;\n  return { element, set() {}, setDisabled() {}, destroy() {} };\n}';
  assert.deepEqual(scanKindModules({ [view]: good }, { [view]: stepGrid }), []);
  refused(scanKindModules({ [view]: good.replace('setDisabled() {}, ', '') },
    { [view]: stepGrid }), /returns no setDisabled/);
  refused(scanKindModules({ [view]: good.replace('mountStepGrid', 'mount') },
    { [view]: stepGrid }), /exports no mountStepGrid/);
  const extra = variant((v) => { v.mount = { extras: ['focusStep'] }; });
  refused(scanKindModules({ [view]: good }, { [view]: extra }), /returns no focusStep/);
  refused(kindProblems(variant((v) => { v.mount = { extras: ['destroy'] }; })),
    /mount musí být \{ extras/);
});

test('rule 5: no runtime module imports a kind declaration', () => {
  refused(runtimeImportProblems({
    'src/js/ui/synth/drums.js': "import grid from '../catalog/kinds/step-grid.js';" }),
  /imports src\/js\/ui\/catalog\/kinds\/step-grid\.js; no runtime module interprets/);
  refused(runtimeImportProblems({
    'src/js/ui/kinds/step-grid.js': "import { defineKind } from '../catalog/kind.js';" }),
  /catalog\/kind\.js/);
  assert.deepEqual(runtimeImportProblems({
    'src/js/ui/catalog/kinds/index.js': "import s from './step-grid.js';",
    'src/js/ui/x.js': "// import s from './catalog/kinds/step-grid.js';" }), []);
});

// ------------------------------------------------------------------------------ the static scan
test('the static scan: no store, sources, lab, dispatch, audio node or timer in a module', () => {
  const file = 'src/js/ui/kinds/step-grid-model.js';
  assert.deepEqual(scanKindModules({ [file]: "import { onFrame } from '../../charts/frame-loop.js';"
    + "\nimport { NOTE_RANGE } from '../../studio/notes.js';\nexport const x = 1;" }), []);
  for (const [text, re] of [
    ["import { ACTION_TYPES } from '../../studio/actions.js';", /imports studio\/actions\.js/],
    ["import { has } from '../catalog/sources.js';", /imports sources\.js/],
    ["import { createFilterLab } from '../../labs/filter-lab.js';", /imports a lab module/],
    ["import s from '../../core/storage.js';", /imports a store module/],
    ["const m = await import('../../studio/history.js');", /history\.js/],
    ['owner.store.dispatch(a);', /a dispatch/],
    ['store.commit(a);', /a store call/],
    ['const ctx = new AudioContext();', /an AudioContext/],
    ['const g = ctx.createGain();', /an audio node created/],
    ["await ctx.audioWorklet.addModule('x');", /a worklet/],
    ['requestAnimationFrame(draw);', /a timer or an animation frame/],
    ['setTimeout(done, 10);', /a timer/],
    ['const id = setInterval(tick, 16);', /a timer/],
  ]) {
    refused(scanKindModules({ [file]: text }), re);
  }
  // Comments and strings are not code.
  assert.deepEqual(scanKindModules({ [file]: "// setTimeout(x)\nconst s = 'dispatch(a)';" }), []);
});

// ------------------------------------------------------------------------------ the rest
test('a kind outside KINDS, a node face, a duplicate kind and a bad version are refused', () => {
  refused(kindProblems(variant((v) => { v.kind = 'drum-grid'; })), /neznámý druh "drum-grid"/);
  refused(kindProblems(variant((v) => { v.kind = 'node-face'; })), /tvář uzlu se odvozuje/);
  refused(kindProblems(variant((v) => { v.version = 0; })), /version musí být 1 nebo víc/);
  refused(kindProblems(variant((v) => { v.bogus = 1; })), /neznámé pole bogus/);
  refused(check([stepGrid, raw(stepGrid)]).problems, /the kind is declared twice/);
});

test('io, ARIA, layout, reduced motion, props and docs are held to their lists', () => {
  assert.ok(IO.includes('transport.playhead') && ARIA_ROLES.includes('grid'));
  refused(kindProblems(variant((v) => { v.io = ['dom']; })), /io dom není jedním z/);
  refused(kindProblems(variant((v) => { v.io = []; })), /io musí vyjmenovat/);
  refused(kindProblems(variant((v) => { v.aria.role = 'application'; })), /aria\.role/);
  refused(kindProblems(variant((v) => { v.aria.parts.step = 'cell'; })), /cell není povolená role/);
  refused(kindProblems(variant((v) => { v.layout = { '1536x1024': 'Sixteen steps per page.' }; })),
    /pravidlo pro 390x844/);
  refused(kindProblems(variant((v) => { delete v.reducedMotion; })), /pravidlo pro omezený pohyb/);
  assert.deepEqual(kindProblems(variant((v) => { v.live = false; delete v.reducedMotion; })), []);
  refused(kindProblems(variant((v) => { v.props.push({ key: 'x', default: 1 }); })),
    /vlastnost x musí být deskriptor vytvořený pomocí prop/);
  refused(kindProblems(variant((v) => { v.props.push(prop.integer('steps', 'Again', { min: 1,
    max: 2, default: 1 })); })), /vlastnost steps je deklarována dvakrát/);
  refused(kindProblems(variant((v) => { v.props.push(prop.integer('n', 'N', { min: 1, max: 2,
    default: 3 })); })), /vlastnost n: výchozí hodnota 3 must be between 1 and 2/);
  refused(kindProblems(variant((v) => { v.docs = 'A grid.'; })), /docs potřebuje větu/);
  refused(kindProblems(variant((v) => { v.events[0].does = 'Moves.'; })), /does potřebuje větu/);
});

test('links resolve to a workspace route or a catalogue id; G007 is not built', () => {
  assert.deepEqual(check([variant((v) => { v.links.opens = ['synth.studio', 'route:measure']; })])
    .problems, []);
  refused(check([variant((v) => { v.links.opens = ['route:drums']; })]).problems,
    /link route:drums resolves to no workspace route and no catalogue id \(G007/);
  refused(check([variant((v) => { v.links.openedBy = ['studio.tl.nowhere']; })]).problems,
    /link studio\.tl\.nowhere resolves to no/);
  refused(kindProblems(variant((v) => { v.links.opens = ['g007://synth/drums']; })),
    /není route:<workspace> ani id katalogu/);
  refused(check([variant((v) => { v.workspaces = ['drums']; })]).problems,
    /workspace drums is not a workspace/);
});

test('impl modules exist or are named by the issue that adds them', () => {
  const other = variant((v) => { v.impl.modules = ['src/js/ui/kinds/elsewhere.js']; });
  refused(check([other]).problems, /impl module src\/js\/ui\/kinds\/elsewhere\.js does not exist/);
  const unnamed = variant((v) => { delete v.impl.issue; });
  refused(check([unnamed]).problems, /no issue that adds it names it/);
  refused(check([variant((v) => { v.impl.issue = 'W999'; })]).problems, /W999 does not exist/);
  // An existing module needs no issue.
  const there = variant((v) => { v.impl = { modules: ['src/js/charts/frame-loop.js'] }; });
  assert.deepEqual(check([there], { shortcutRows: () => new Set(stepGrid.keys.map((k) => k.row)) })
    .problems, []);
});

test('the trace entry names W001, its intent criterion, rules, ADRs and tests', () => {
  const entry = FACTS.traces['kind:step-grid'];
  assert.ok(entry.plan.includes('W001') && entry.serves.includes('instrument-kinds#kind-contract'));
  const traces = (e) => ({ ...FACTS.traces, 'kind:step-grid': { ...entry, ...e } });
  refused(check([stepGrid], { traces: { } }).problems, /no trace entry kind:step-grid/);
  for (const [e, re] of [
    [{ plan: ['W008'] }, /names W001/],
    [{ serves: ['instrument-kinds#nowhere'] }, /serves instrument-kinds#kind-contract/],
    [{ rules: ['project.no-such-rule'] }, /rule project\.no-such-rule is not a project rule/],
    [{ adrs: ['adr-9999'] }, /ADR adr-9999 does not exist/],
    [{ tests: ['tests/unit/ui-catalog.test.mjs'] }, /does not name step-grid/],
    [{ tests: ['tests/unit/nowhere.test.mjs'] }, /does not exist/],
    [{ since: 'yesterday' }, /since must be the day/],
    [{ owner: 'x' }, /unknown trace field owner/],
  ]) {
    refused(check([stepGrid], { traces: traces(e) }).problems, re);
  }
  refused(check([], { traces: { 'kind:meter': entry } }).problems,
    /kind:meter: trace entry for an undeclared kind/);
});

test('the digest serialises with sorted keys and no functions', () => {
  assert.equal(canonicalJson({ b: 1, a: [() => 1, -Infinity, /x/g], f() {} }),
    '{"a":[null,"-Infinity","/x/g"],"b":1}');
  const reordered = { ...raw(stepGrid) };
  reordered.events = reordered.events.map((e) => Object.fromEntries(Object.entries(e).reverse()));
  assert.equal(digestOf(reordered), digestOf(stepGrid));
  assert.match(digestOf(stepGrid), /^sha256:[0-9a-f]{64}$/);
});

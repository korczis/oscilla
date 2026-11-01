// The UI catalogue contract (plan issue G001, ADR 0081): one declaration per component in
// src/js/ui/catalog, its state table, its registry with derived node faces, the docs-only trace
// under scripts/ui-catalog/trace, and the census that refuses drift.
//
// What it proves:
//   - the repository holds the contract (scripts/ui-catalog/check.mjs finds no problem): every
//     literal data-osc hook of src/index.html and src/js is declared or listed in the undeclared
//     section of tests/unit/ui-catalog-allowance.json, exactly; every value built at run time
//     has a pattern declaration naming its site; every declaration has a unique docs sentence, a
//     state path sources.js resolves (or state none where its kind allows it), link targets that
//     exist, a trace entry whose source carries its hooks and whose tests name every hook (NAMED,
//     not VERIFIED); and the allowance only shrinks against its committed copies;
//   - the contract table below: each declared hook, the kind of its declaration and the element
//     that carries it in the source (for a pattern on a variable site, one of the elements its
//     helpers build);
//   - a fixture per negative case of the issue is refused with a message naming the id;
//   - node faces are derived from the node registry (a fixture node type gains one);
//   - no module under src/ imports scripts/ or the trace, and no catalogue path has a segment
//     the Flowbite Pro ratchet refuses (COMPONENT_LIBRARY of scripts/ui-flowbite-pro-measure.mjs).
//   node --test tests/unit/ui-catalog.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG, DECLARATIONS, createCatalog } from '../../src/js/ui/catalog/registry.js';
import { defineComponent, hooksOf } from '../../src/js/ui/catalog/define.js';
import * as sources from '../../src/js/ui/catalog/sources.js';
import { KINDS, STATE_NONE_KINDS } from '../../src/js/ui/catalog/kinds.js';
import { NODE_DEFINITIONS, createNodeRegistry } from '../../src/js/studio/registry.js';
import { CATEGORIES, defineNode, numberParam } from '../../src/js/studio/nodes/common.js';
import { lexJs, scanHooks, scanSources, stringLiteralsOf }
  from '../../scripts/ui-catalog/scan.mjs';
import { checkCatalog, checkRepository, reader, unknownHooks }
  from '../../scripts/ui-catalog/check.mjs';
import { undeclaredAllowance } from '../../scripts/ui-catalog/allowance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ------------------------------------------------------------------------------ the repository
test('the repository holds the catalogue contract', async () => {
  const problems = await checkRepository(ROOT);
  assert.deepEqual(problems.map((p) => p.message), []);
});

test('the allowance lists exactly the undeclared hooks the generator derives', () => {
  const allowance = JSON.parse(readFileSync(path.join(ROOT,
    'tests/unit/ui-catalog-allowance.json'), 'utf8'));
  const derived = undeclaredAllowance({ census: scanHooks(ROOT), catalog: CATALOG,
    previous: allowance });
  assert.deepEqual(allowance, derived, 'run node scripts/ui-catalog/allowance.mjs --write');
  for (const e of allowance.undeclared) assert.ok(!CATALOG.covers(e.id), e.id);
});

// The contract table: [hook, kind of its declaration, element that carries it].
const CONTRACT = [
  ['studio.tl.return', 'transport', 'button'], ['studio.tl.play', 'transport', 'button'],
  ['studio.tl.stop', 'transport', 'button'], ['studio.tl.loop', 'switch', 'button'],
  ['studio.tl.transport', 'panel', 'div'], ['studio.tl.time', 'readout', 'output'],
  ['studio.tl.state', 'readout', 'span'], ['studio.tl.mode-seconds', 'choice', 'button'],
  ['studio.tl.mode-musical', 'choice', 'button'], ['studio.tl.tempo', 'param', 'input'],
  ['studio.tl.root', 'panel', 'section'], ['studio.tl.live', 'readout', 'p'],
  ['studio.tl.ruler', 'readout', 'div'], ['studio.tl.scroll', 'panel', 'div'],
  ['studio.tl.playhead', 'readout', 'div'], ['studio.tl.loop-band', 'param', 'div'],
  ['studio.tl.loop-start', 'param', 'div'], ['studio.tl.loop-end', 'param', 'div'],
  ['studio.tl.snap', 'choice', 'select'], ['studio.tl.add-clip', 'action', 'button'],
  ['studio.tl.zoom-out', 'action', 'button'], ['studio.tl.zoom-in', 'action', 'button'],
  ['studio.tl.zoom-fit', 'action', 'button'], ['studio.tl.marker', 'action', 'button'],
  ['studio.tl.loop-edit', 'open', 'button'], ['studio.tl.track', 'open', 'button'],
  ['studio.tl.automate', 'open', 'button'], ['studio.tl.details', 'panel', 'div'],
  ['studio.tl.details-status', 'readout', 'p'], ['studio.tl.d-close', 'action', 'button'],
  ['studio.tl.d-duplicate', 'action', 'button'], ['studio.tl.d-split', 'action', 'button'],
  ['studio.tl.d-delete', 'action', 'button'], ['studio.tl.d-loop-fit', 'action', 'button'],
  ['studio.tl.d-add', 'action', 'button'], ['studio.tl.d-automate', 'action', 'button'],
  ['studio.tl.d-timebaseHint', 'readout', 'p'],
  ['studio.compact', 'panel', 'section'], ['studio.compact.title', 'readout', 'span'],
  ['studio.compact.counts', 'readout', 'span'], ['studio.compact.summary', 'readout', 'p'],
  ['studio.compact.play', 'transport', 'button'], ['studio.compact.stop', 'transport', 'button'],
  ['studio.compact.loop', 'switch', 'button'], ['studio.compact.time', 'readout', 'span'],
  ['studio.compact.expand', 'open', 'button'], ['studio.compact.path', 'readout', 'div'],
  ['studio.compact.node', 'action', 'button'], ['studio.compact.clips', 'readout', 'div'],
  ['studio.compact.clip', 'clip', 'button'], ['studio.compact-timeline', 'readout', 'div'],
  ['studio.compact-playhead', 'readout', 'div'],
  ['filter.enable', 'switch', 'button'], ['filter.type', 'choice', 'button'],
  ['filter.cutoff', 'param', 'input'], ['filter.cutoffValue', 'param', 'input'],
  ['filter.q', 'param', 'input'], ['filter.qValue', 'param', 'input'],
  ['filter.gain', 'param', 'input'], ['filter.gainGroup', 'param', 'div'],
  ['filter.fullscreen', 'fullscreen', 'button'],
  ['mic.freeze', 'switch', 'button'], ['mic.average', 'switch', 'button'],
  ['mic.peakHold', 'switch', 'button'],
  ['nav-group.analyze', 'open', 'button'], ['nav-group.synthesis', 'open', 'button'],
  ['def.row', 'readout', 'li'], ['fnd.row', 'readout', 'li'],
  ['studio.graph.minimapToggle', 'action', 'button'], ['studio.graph.zoomOut', 'action', 'button'],
  ['studio.graph.zoomIn', 'action', 'button'], ['studio.graph.frameAll', 'action', 'button'],
  ['studio.graph.frameSelection', 'action', 'button'],
  ['studio.saved.insert', 'action', 'button'], ['studio.saved.replace', 'action', 'button'],
  ['studio.saved.delete', 'action', 'button'], ['studio.saved.export', 'action', 'button'],
  ['studio.inspector.name', 'param', 'input'], ['studio.inspector.studioTitle', 'param', 'input'],
  ['studio.inspector.x', 'param', 'input'], ['studio.inspector.y', 'param', 'input'],
  ['studio.inspector.depth', 'param', 'input'], ['studio.inspector.offset', 'param', 'input'],
  ['studio.inspector.start', 'param', 'input'], ['studio.inspector.duration', 'param', 'input'],
  ['studio.inspector.timeMode', 'param', 'select'], ['studio.inspector.tempo', 'param', 'input'],
  ['studio.inspector.beats', 'param', 'input'], ['studio.inspector.unit', 'param', 'select'],
  ['studio.inspector.loopStart', 'param', 'input'],
  ['studio.inspector.loopEnd', 'param', 'input'],
  ['studio.inspector.duplicate', 'action', 'button'],
  ['studio.inspector.delete', 'action', 'button'],
  ['studio.inspector.deleteEdge', 'action', 'button'],
  ['studio.inspector.selectFrom', 'action', 'button'],
  ['studio.inspector.selectTo', 'action', 'button'],
  ['studio.inspector.connect', 'open', 'button'], ['studio.inspector.savePatch', 'open', 'button'],
  ['studio.inspector.allowMic', 'action', 'button'],
];

/** The tags of the elements that carry `hook` in the source (see the header). */
function carrierTags(census, hook, decl) {
  const texts = new Map();
  const read = (f) => {
    if (!texts.has(f)) texts.set(f, readFileSync(path.join(ROOT, f), 'utf8'));
    return texts.get(f);
  };
  const CALL = /\b(?:h|el|s)\(\s*'([\w-]+)'|createElement\(\s*'([\w-]+)'\)/g;
  const tagAt = (file, index) => {
    const t = read(file);
    if (file.endsWith('.html')) return /<([\w-]+)/.exec(t.slice(t.lastIndexOf('<', index)))[1];
    let last = null;
    for (const m of t.slice(Math.max(0, index - 800), index).matchAll(CALL)) last = m[1] || m[2];
    return last;
  };
  // A template site builds this pattern only when its template is the declared one.
  const builds = (o) => {
    const t = /^`(.*)`$/.exec(o.expr);
    return !t || t[1].replace(/\$\{[^}]*\}/g, '{key}') === decl.pattern.template;
  };
  const out = new Set();
  for (const o of census.occurrences) {
    if (o.form === 'string') continue; // a selector names a hook; it carries none
    if (o.hook === hook || (o.hook === null && decl.pattern
      && decl.pattern.sites.includes(o.file) && builds(o))) out.add(tagAt(o.file, o.index));
  }
  return out;
}

test('the contract table: each declared hook, its kind and the element that carries it', () => {
  const census = scanHooks(ROOT);
  const declared = DECLARATIONS.flatMap((d) => hooksOf(d)).sort();
  assert.deepEqual(CONTRACT.map(([h]) => h).sort(), declared, 'one row per declared hook');
  const owner = new Map(DECLARATIONS.flatMap((d) => hooksOf(d).map((h) => [h, d])));
  for (const [hook, kind, tag] of CONTRACT) {
    const decl = owner.get(hook);
    assert.ok(CATALOG.covers(hook), hook);
    assert.equal(decl.kind, kind, `${hook}: kind`);
    const tags = carrierTags(census, hook, decl);
    assert.ok(tags.has(tag), `${hook}: carried by <${tag}>, found ${[...tags].join(', ')}`);
  }
});

// ------------------------------------------------------------------------------ fixtures
const NO_NODES = { list: () => [] };
const FX_HTML = 'src/fx.html';
const FX_TEST = 'tests/unit/fx.test.mjs';
const realRead = reader(ROOT);

/** A small valid world; `edit` changes it before the check runs. */
function world(edit = (w) => w) {
  const w = {
    decls: [
      { id: 'fx.play', kind: 'action', label: 'Play', state: 'studio.transport',
        docs: 'Starts the fixture transport from the fixture toolbar.' },
      { id: 'fx.cutoff', kind: 'param', label: 'Cutoff', state: 'lab.filter.frequency',
        docs: 'Sets the fixture cutoff on a logarithmic slider.',
        param: numberParam('frequency', 'Cutoff', { min: 20, max: 20000, scale: 'log',
          default: 2500 }) },
    ],
    files: {
      [FX_HTML]: '<button data-osc="fx.play"></button><input data-osc="fx.cutoff">',
      [FX_TEST]: "test('fx', () => { q('[data-osc=\"fx.play\"]'); q('fx.cutoff'); });",
    },
    js: {},
    traces: {},
    allowance: { undeclared: [] },
    history: [],
    runs: (f) => /^tests\/unit\/.+\.test\.mjs$/.test(f),
  };
  for (const d of w.decls) {
    w.traces[d.id] = { source: FX_HTML, plan: ['G001'],
      intents: ['component-system#contract-and-registry'], adrs: ['adr-0081'], tests: [FX_TEST] };
  }
  edit(w);
  const html = Object.fromEntries(Object.entries(w.files).filter(([f]) => f.endsWith('.html')));
  return checkCatalog({
    catalog: createCatalog(w.decls, NO_NODES),
    census: scanSources({ html, js: w.js }),
    allowance: w.allowance,
    history: w.history,
    sources,
    traces: w.traces,
    testCorpus: { runs: w.runs,
      strings: (f) => (f in w.files ? stringLiteralsOf(w.files[f]) : null) },
    read: (rel) => (rel in w.files ? w.files[rel] : realRead(rel)),
  });
}

/** The problems that name `id`; the assertion fails when there is none. */
function refused(problems, id) {
  const hits = problems.filter((p) => p.id === id && p.message.includes(id));
  assert.ok(hits.length, `expected a problem naming ${id}, got ${JSON.stringify(problems)}`);
  return hits.map((p) => p.message).join('\n');
}

const throwsFor = (id, decl, re) => assert.throws(() => defineComponent({ id, ...decl }),
  (e) => e instanceof TypeError && e.message.startsWith(`defineComponent(${id}):`)
    && re.test(e.message));

test('the fixture world holds the contract', () => {
  assert.deepEqual(world(), []);
});

test('refused: an undeclared new hook', () => {
  const p = world((w) => { w.files[FX_HTML] += '<button data-osc="fx.newHook"></button>'; });
  assert.match(refused(p, 'fx.newHook'), /undeclared data-osc hook/);
});

test('refused: a hook built from a variable with no pattern declaration', () => {
  const p = world((w) => {
    w.js['src/js/fx.js'] = "const b = (osc) => h('button', { 'data-osc': osc });\n";
  });
  assert.match(refused(p, 'src/js/fx.js:1'), /built at run time and no pattern/);
  const template = world((w) => {
    w.js['src/js/fx.js'] = "\n\nel.dataset.osc = `fx.${key}`;\n";
  });
  assert.match(refused(template, 'src/js/fx.js:3'), /fx\.\$\{key\}/);
});

test('refused: a hook only the running page shows', () => {
  const allowance = { undeclared: [{ id: 'fx.allowed', reason: 'not declared yet here' }] };
  const catalog = createCatalog([], NO_NODES);
  assert.deepEqual(unknownHooks(['fx.allowed', 'qa.fixture.undeclared'], catalog, allowance),
    ['qa.fixture.undeclared']);
  assert.deepEqual(unknownHooks(['studio.tl.play', 'studio.node.filter'], CATALOG, allowance),
    []);
});

test('refused: a declaration naming lab.filter.cutof', () => {
  const p = world((w) => { w.decls[1].state = 'lab.filter.cutof'; });
  assert.match(refused(p, 'fx.cutoff'), /state lab\.filter\.cutof is not a path of sources/);
});

test('refused: a ui.* path the table does not list', () => {
  assert.equal(sources.has('ui.anything'), false);
  assert.equal(sources.has('ui.workspace'), true);
  const p = world((w) => { w.decls[0].state = 'ui.anything'; });
  assert.match(refused(p, 'fx.play'), /state ui\.anything is not a path/);
});

test('refused: state none on a param, and without a reason', () => {
  throwsFor('fx.param', { kind: 'param', label: 'P', docs: 'A fixture parameter with no state.',
    state: { none: 'a parameter always owns a value' } }, /not allowed on the param kind/);
  throwsFor('fx.reason', { kind: 'readout', label: 'R', docs: 'A fixture readout of nothing much.',
    state: { none: '' } }, /reason of at least five words/);
  throwsFor('fx.short', { kind: 'panel', label: 'P', docs: 'A fixture panel of nothing much.',
    state: { none: 'too short' } }, /reason of at least five words/);
  for (const kind of KINDS.filter((k) => !STATE_NONE_KINDS.includes(k) && k !== 'node-face')) {
    throwsFor(`fx.${kind}`, { kind, label: 'K', docs: 'A fixture of a kind that owns a value.',
      state: { none: 'this kind has no state to own' } }, /state none is not allowed/);
  }
});

test('refused: an action or open declaration with state none and no effect', () => {
  for (const kind of ['action', 'open']) {
    throwsFor(`fx.${kind}`, { kind, label: 'A', docs: 'A fixture control that does something.',
      state: { none: 'it changes no state path at all' } }, new RegExp(`${kind} with state none`));
  }
  assert.ok(defineComponent({ id: 'fx.ok', kind: 'action', label: 'A',
    docs: 'A fixture control that does something.',
    state: { none: 'it changes no state path at all' }, effect: { download: 'a file' } }));
});

test('refused: a declaration without docs or without a test', () => {
  throwsFor('fx.nodocs', { kind: 'action', label: 'A', state: 'studio.model' },
    /docs needs a sentence/);
  const p = world((w) => { w.traces['fx.play'].tests = []; });
  assert.match(refused(p, 'fx.play'), /names no test/);
  const missing = world((w) => { delete w.traces['fx.play']; });
  assert.match(refused(missing, 'fx.play'), /no trace entry/);
});

test('refused: a test file that names the hook only in a comment, or that no script runs', () => {
  const p = world((w) => {
    w.files[FX_TEST] = "// q('[data-osc=\"fx.play\"]')\n"
      + "/* fx.play */ test('fx', () => q('fx.cutoff'));";
  });
  assert.match(refused(p, 'fx.play'), /names none of its hooks|no listed test names the hook/);
  const unrun = world((w) => {
    w.files['tests/helpers/fx.mjs'] = w.files[FX_TEST];
    w.traces['fx.play'].tests = ['tests/helpers/fx.mjs'];
  });
  assert.match(refused(unrun, 'fx.play'), /run by neither npm test nor a script/);
});

test('refused: a docs sentence equal to the label or copied from another declaration', () => {
  throwsFor('fx.same', { kind: 'action', label: 'Starts the fixture transport now please',
    docs: 'Starts the fixture transport now please', state: 'studio.model' }, /repeat the label/);
  const p = world((w) => { w.decls[1].docs = w.decls[0].docs; });
  assert.match(refused(p, 'fx.cutoff'), /docs repeat the docs of fx\.play/);
});

test('refused: a link to a missing id', () => {
  const p = world((w) => { w.decls[0].links = { opens: ['fx.nowhere'] }; });
  assert.match(refused(p, 'fx.play'), /link to missing id fx\.nowhere/);
  const inside = world((w) => { w.decls[0].in = 'fx.panel'; });
  assert.match(refused(inside, 'fx.play'), /missing id fx\.panel/);
});

test('refused: a default outside its range', () => {
  throwsFor('fx.range', { kind: 'param', label: 'Cutoff', docs: 'A fixture cutoff out of range.',
    state: 'lab.filter.frequency', param: numberParam('frequency', 'Cutoff', { min: 20,
      max: 20000, default: 5 }) }, /param default 5 must be between 20 and 20000/);
  throwsFor('fx.hand', { kind: 'param', label: 'Cutoff', docs: 'A hand-written fixture descriptor.',
    state: 'lab.filter.frequency', param: { key: 'f', default: 1 } },
  /descriptor built by studio\/nodes\/common\.js/);
});

test('refused: a trace source that does not carry the hook', () => {
  const p = world((w) => { w.traces['fx.play'].source = FX_TEST; });
  assert.match(refused(p, 'fx.play'), /does not carry the hook fx\.play/);
});

test('the allowance: exact, sorted, reasoned, and it only shrinks', () => {
  const entry = (id) => ({ id, reason: 'not declared yet here' });
  const base = (w) => {
    w.files[FX_HTML] += '<p data-osc="fx.a"></p><p data-osc="fx.b"></p>';
    w.allowance = { undeclared: [entry('fx.a'), entry('fx.b')] };
  };
  assert.deepEqual(world(base), []);
  assert.match(refused(world((w) => { base(w); w.allowance.undeclared.push(entry('fx.play')); }),
    'fx.play'), /declared, so it leaves/);
  assert.match(refused(world((w) => { base(w); w.allowance.undeclared.push(entry('fx.gone')); }),
    'fx.gone'), /no such data-osc hook/);
  assert.match(refused(world((w) => { base(w); w.allowance.undeclared.reverse(); }), 'fx.a'),
    /not sorted/);
  assert.match(refused(world((w) => {
    base(w);
    w.allowance.undeclared[0].reason = 'too short';
  }), 'fx.a'), /three words/);
  assert.match(refused(world((w) => { base(w); w.allowance.bogus = []; }), 'bogus'),
    /not a section/);
  // An entry rises: the section grew since a committed copy.
  const rises = world((w) => {
    base(w);
    w.history = [{ sha: 'c1', allowance: { undeclared: [entry('fx.a')] } }];
  });
  assert.match(refused(rises, 'undeclared'), /2 entries, 1 at c1/);
  assert.match(refused(rises, 'fx.b'), /never added or returned/);
  // An entry removed in an earlier commit returns.
  const returns = world((w) => {
    base(w);
    w.history = [{ sha: 'c2', allowance: { undeclared: [entry('fx.a'), entry('fx.c')] } },
      { sha: 'c1', allowance: { undeclared: [entry('fx.a'), entry('fx.b'), entry('fx.c')] } }];
  });
  assert.match(refused(returns, 'fx.b'), /not in the undeclared section at c2/);
  // A closed section refuses any entry; a section not yet opened judges nothing.
  assert.match(refused(world((w) => { base(w); w.history = [{ sha: 'c3',
    allowance: { undeclared: [] } }]; }), 'fx.a'), /closed section/);
  assert.deepEqual(world((w) => { base(w); w.history = [{ sha: 'c0', allowance: {} }]; }), []);
});

// ------------------------------------------------------------------------------ node faces
test('node faces are derived: a fixture node type gains its face with no catalogue edit', () => {
  const fixture = defineNode({
    type: 'fixture-tone', displayName: 'Fixture tone', idPrefix: 'fxtone',
    category: CATEGORIES.SOURCES, summary: () => 'Fixture tone',
    compiler: 'audio/audio-engine.js#AudioEngine',
    help: { what: 'A fixture tone that only the catalogue test adds.', inputs: 'None.',
      outputs: 'None.', constraints: 'None.' },
  });
  const registry = createNodeRegistry([...NODE_DEFINITIONS, fixture]);
  const catalog = createCatalog(DECLARATIONS, registry);
  const face = catalog.get('studio.node.fixture-tone');
  assert.equal(face.kind, 'node-face');
  assert.equal(face.label, 'Fixture tone');
  assert.equal(face.docs, 'A fixture tone that only the catalogue test adds.');
  assert.equal(face.state, 'studio.model');
  assert.equal(catalog.nodeFaces().length, CATALOG.nodeFaces().length + 1);
  assert.deepEqual(CATALOG.nodeFaces().map((d) => d.id),
    NODE_DEFINITIONS.map((d) => `studio.node.${d.type}`));
  assert.throws(() => defineComponent({ id: 'studio.node.x', kind: 'node-face', label: 'X',
    docs: 'A node face declared by hand here.', state: 'studio.model' }), /derived/);
});

test('the registry refuses a duplicate id or hook', () => {
  const d = { id: 'fx.a', kind: 'readout', label: 'A', docs: 'A fixture readout of one value.',
    state: 'studio.model' };
  assert.throws(() => createCatalog([d, { ...d, docs: 'Another fixture readout of one value.' }],
    NO_NODES), /duplicate id fx\.a/);
  assert.throws(() => createCatalog([d, { ...d, id: 'fx.b', hooks: ['fx.a'],
    docs: 'Another fixture readout of one value.' }], NO_NODES), /hook fx\.a is declared twice/);
});

// ------------------------------------------------------------------------------ boundaries
const SPECIFIER = new RegExp(String.raw`\b(?:import|export)\b[^'"\`;]*?\bfrom\s*(['"])([^'"]+)\1`
  + String.raw`|\bimport\s*\(?\s*(['"])([^'"]+)\3`, 'g');

/** The import specifiers of a module, comments removed. */
const importsOf = (text) => [...lexJs(text).code.matchAll(SPECIFIER)]
  .map((m) => m[2] || m[4]);

function srcFiles(dir = 'src') {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = `${dir}/${d.name}`;
    return d.isDirectory() ? srcFiles(rel) : [rel];
  });
}

/** The src/ modules that import anything under scripts/ (the trace included). */
function importsOfScripts(files) {
  const out = [];
  for (const [file, text] of Object.entries(files)) {
    for (const spec of importsOf(text)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (spec.startsWith('.') && resolved.startsWith('scripts/')) out.push(`${file} -> ${spec}`);
    }
  }
  return out;
}

test('no module under src/ imports scripts/ or the trace, and no trace file lives in src/', () => {
  const files = srcFiles();
  const js = Object.fromEntries(files.filter((f) => /\.m?js$/.test(f))
    .map((f) => [f, readFileSync(path.join(ROOT, f), 'utf8')]));
  assert.deepEqual(importsOfScripts(js), []);
  assert.deepEqual(files.filter((f) => f.endsWith('.mjs') || f.includes('ui-catalog')), []);
  // The detector finds a static, a re-export and a dynamic import of the trace.
  assert.deepEqual(importsOfScripts({
    'src/js/ui/catalog/a.js': "import t from '../../../../scripts/ui-catalog/trace/x.mjs';",
    'src/js/ui/b.js': "export { x } from '../../../scripts/ui-catalog/check.mjs';",
    'src/js/c.js': "const t = await import('../../scripts/ui-catalog/trace/x.mjs');",
    'src/js/d.js': "// import t from '../../scripts/ui-catalog/trace/x.mjs';",
  }).length, 3);
});

test('no catalogue path has a segment the Flowbite Pro ratchet refuses', () => {
  const measure = readFileSync(path.join(ROOT, 'scripts/ui-flowbite-pro-measure.mjs'), 'utf8');
  const m = /const COMPONENT_LIBRARY = \/(.+)\/([a-z]*);/.exec(measure);
  assert.ok(m, 'COMPONENT_LIBRARY is defined in scripts/ui-flowbite-pro-measure.mjs');
  const COMPONENT_LIBRARY = new RegExp(m[1], m[2]);
  const catalog = srcFiles('src/js/ui/catalog');
  assert.ok(catalog.length > 3);
  assert.deepEqual(catalog.filter((f) => COMPONENT_LIBRARY.test(f)), []);
  assert.ok(COMPONENT_LIBRARY.test('src/js/ui/components/x.js'), 'the guard bites');
});

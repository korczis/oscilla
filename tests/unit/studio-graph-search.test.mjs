// V610: one meaning-first fuzzy ranking for every Studio search (src/js/studio/registry.js
// rankSearch, re-exported by src/js/ui/studio/graph-search.js): exact name, name prefix, word
// start, alias, then the letters in order; ties by category order. The quick add and the node
// library list node types through library-panel.js libraryView (registry.search), the find dialog
// (/) lists nodes through searchNodes; all three rank with rankSearch and none carries its own
// matcher. Aliases live in the node definitions.
// An empty quick add lists the most recently added types first (view state, never saved).
//   node --test tests/unit/studio-graph-search.test.mjs
// Browser: tests/browser/v31-studio-graph.cjs --only fuzzy-add.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RECENT_LIMIT, rankSearch, rememberRecent, searchAnnouncement, searchNodes,
} from '../../src/js/ui/studio/graph-search.js';
import { libraryView } from '../../src/js/ui/studio/library-panel.js';
import { quickAddStatus } from '../../src/js/ui/studio/graph-picker.js';
import { NODE_REGISTRY, searchNodeTypes } from '../../src/js/studio/registry.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { normalizeStudio, serializeStudio } from '../../src/js/studio/schema.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { PERF_BUDGETS, buildLargeStudio } from './fixtures/v31-large-studio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const synth = () => templateModel(REFERENCE_TEMPLATE_ID);
const types = (q, opts) => libraryView(synth(), q, opts).groups.flatMap((g) => g.items)
  .map((i) => i.type);

test('V610 ranking table: each query names its first node type', () => {
  const table = { fltr: 'filter', lp: 'filter', hp: 'filter', bp: 'filter', eq: 'filter',
    vco: 'oscillator', vca: 'gain', osc: 'oscillator', nois: 'noise', vcf: 'filter',
    adsr: 'envelope', filter: 'filter', 'master output': 'master', gn: 'gain', mixr: 'mixer' };
  for (const [q, want] of Object.entries(table)) {
    assert.equal(types(q)[0], want, `"${q}" lists ${want} first, got ${types(q).join(', ')}`);
  }
  // Fuzzy: the letters of the name in order, case and accents folded.
  assert.equal(types('FLTR')[0], 'filter');
  assert.equal(types('fíltr')[0], 'filter');
  assert.equal(types('spgm')[0], 'spectrogram');
  // The registry's own search is the same ranking (no second matcher).
  for (const q of Object.keys(table)) {
    assert.deepEqual(searchNodeTypes(q).map((d) => d.type), types(q), `registry.search("${q}")`);
  }
  // "vca": the exact alias (Gain) before an alias that starts with it (VCA envelope).
  assert.deepEqual(types('vca'), ['gain', 'envelope']);
  // "gn": the letters of a name (Gain) before a part of an alias (Noise: "random signal").
  assert.deepEqual(types('gn'), ['gain', 'noise']);
});

test('V610 "eq" ranks Filter above every type that only contains the letters', () => {
  const ranked = rankSearch(NODE_REGISTRY.list().map((d) => ({ names: [d.displayName],
    aliases: [d.type, ...d.aliases], category: d.category, type: d.type })), 'eq');
  assert.equal(ranked[0].entry.type, 'filter');
  assert.equal(ranked[0].rank, 3, 'an alias');
  const rest = ranked.slice(1);
  assert.ok(rest.length >= 1, 'Sequence and the frequency aliases contain the letters');
  assert.ok(rest.every((x) => x.rank === 4), 'the others only contain the letters');
});

test('V610 one ranking: exact, prefix, word start, alias, letters; ties by category', () => {
  const e = (name, category, aliases = []) => ({ names: [name], aliases, category });
  const entries = [
    e('Wobbler', 'OUTPUT', ['tone bender']), // alias word start "tone"
    e('Wibbler', 'MEASUREMENT', ['tone']), // exact alias: before the alias word start
    e('Tone', 'MEASUREMENT'), // exact
    e('Tonearm', 'ANALYSIS'), // name prefix
    e('Big Tone', 'PROCESSING'), // word start
    e('Tremolo Nine', 'SOURCES'), // letters t-o-n-e in order
    e('Unrelated', 'SOURCES', ['stoned']), // a part of an alias
    e('Nothing', 'SOURCES'),
  ];
  const r = rankSearch(entries, 'tone');
  assert.deepEqual(r.map((x) => [x.entry.names[0], x.rank]), [
    ['Tone', 0], ['Tonearm', 1], ['Big Tone', 2], ['Wibbler', 3], ['Wobbler', 3],
    ['Tremolo Nine', 4], ['Unrelated', 4]]);
  // Equal scores: category order (Sources before Processing), then the order given.
  const tie = rankSearch([e('Alpha', 'PROCESSING'), e('Alpha', 'SOURCES'),
    e('Alpha', 'SOURCES', ['x'])], 'alpha');
  assert.deepEqual(tie.map((x) => x.entry.category + x.entry.aliases.length),
    ['SOURCES0', 'SOURCES1', 'PROCESSING0']);
  assert.deepEqual(rankSearch(entries, 'tone'), r, 'deterministic');
  // Every term must match (AND); the weakest term ranks; the whole query as a name is exact.
  assert.deepEqual(rankSearch(entries, 'big tone').map((x) => x.rank), [0]);
  assert.deepEqual(rankSearch(entries, 'tone big').map((x) => x.rank), [2]);
  assert.deepEqual(rankSearch(entries, ''), entries.map((entry) => ({ entry, rank: 0 })),
    'an empty query lists every entry in its order');
});

test('V610 a query matching nothing says so; an alias is a term, never a displayed name', () => {
  const none = libraryView(synth(), 'zzqx');
  assert.equal(none.empty, true);
  assert.equal(quickAddStatus(none, 'zzqx'), 'No node type matches “zzqx”.');
  assert.equal(searchAnnouncement(searchNodes(synth(), 'zzqx')), 'No node matches “zzqx”.');
  const lp = libraryView(synth(), 'lp');
  assert.equal(lp.first.name, 'Filter');
  assert.match(quickAddStatus(lp, 'lp'), /; Enter adds Filter\.$/);
  for (const it of lp.groups.flatMap((g) => g.items)) {
    assert.equal(it.name, NODE_REGISTRY.get(it.type).displayName);
  }
  const f = NODE_REGISTRY.get('filter').aliases;
  for (const a of ['lp', 'hp', 'bp', 'eq']) assert.ok(f.includes(a), `Filter alias ${a}`);
  assert.ok(NODE_REGISTRY.get('oscillator').aliases.includes('vco'));
  assert.ok(NODE_REGISTRY.get('gain').aliases.includes('vca'));
});

test('V610 find (/) ranks the nodes of the graph with the same function', () => {
  const m = synth();
  assert.equal(searchNodes(m, 'fltr').items[0].id, 'filter-1');
  assert.equal(searchNodes(m, 'lp').items[0].id, 'filter-1');
  assert.equal(searchNodes(m, 'vco').items[0].id, 'osc-1');
  assert.deepEqual(searchNodes(m, 'eq').items.map((i) => [i.id, i.rank]),
    [['filter-1', 3], ['lfo-1', 4], ['spectrum-1', 4]], 'the alias first, then the letters');
  assert.deepEqual(searchNodes(m, 'filter').items.map((i) => [i.id, i.rank]), [['filter-1', 1]]);
  assert.deepEqual(searchNodes(m, 'vca').items.map((i) => i.id), ['env-1'], 'Envelope is a VCA');
  assert.equal(searchAnnouncement(searchNodes(m, 'fltr'), { target: true }),
    '1 node matches; Enter selects Filter 1.', 'the status names the Enter target');
  assert.equal(searchAnnouncement(searchNodes(m, 'fltr')), '1 node matches.');
  // A node's own name before every node that only shares its type's name (V428 order).
  const renamed = synth();
  renamed.graph.nodes.find((n) => n.id === 'env-1').metadata.name = 'Filter';
  assert.deepEqual(searchNodes(renamed, 'filter').items.map((i) => [i.id, i.rank]),
    [['env-1', 0], ['filter-1', 1]]);
  // Letters of every script are kept: a node named in Cyrillic is found, and only it.
  renamed.graph.nodes.find((n) => n.id === 'osc-1').metadata.name = 'Бас';
  assert.deepEqual(searchNodes(renamed, 'бас').items.map((i) => i.id), ['osc-1']);
  assert.deepEqual(searchNodes(renamed, 'БАС').items.map((i) => i.id), ['osc-1'], 'case folded');
  assert.deepEqual(searchNodes(renamed, 'бас zz').items, []);
});

test('V610 an empty quick add lists the most recently added types first (view state)', () => {
  let recent = [];
  for (const t of ['noise', 'filter', 'lfo', 'filter', 'gain', 'pan', 'scope']) {
    recent = rememberRecent(recent, t);
  }
  assert.equal(RECENT_LIMIT, 5);
  assert.deepEqual(recent, ['scope', 'pan', 'gain', 'filter', 'lfo']);
  assert.deepEqual(rememberRecent(recent, ''), recent);
  assert.deepEqual(rememberRecent(['noise', 'filter', 'gain'], 'filter'),
    ['filter', 'noise', 'gain'], 'a repeated type moves to the front, listed once');
  const m = synth();
  const before = serializeStudio(m);
  const all = libraryView(m, '');
  const v = libraryView(m, '', { recent });
  assert.equal(v.groups[0].label, 'Recent');
  assert.deepEqual(v.groups[0].items.map((i) => i.type), recent);
  assert.equal(v.count, all.count, 'each type listed once');
  assert.equal(new Set(types('', { recent })).size, all.count);
  assert.equal(v.first.type, 'scope', 'Enter on an empty query adds the newest');
  assert.equal(quickAddStatus(v, ''),
    `${v.count} node types listed, the most recently added first; Enter adds Scope.`);
  assert.equal(quickAddStatus(all, ''), `${all.count} node types listed.`);
  assert.deepEqual(types('', { recent, onlyTypes: ['gain', 'pan', 'mixer'] }),
    ['pan', 'gain', 'mixer'], 'the cable filter still applies');
  assert.equal(types('lp', { recent })[0], 'filter', 'a query ranks, recency does not');
  assert.equal(serializeStudio(m), before, 'nothing of it enters the document');
});

test('V610 quick add, the library and find call the one ranking; no dialog has a matcher', () => {
  const picker = src('src/js/ui/studio/graph-picker.js');
  const library = src('src/js/ui/studio/library-panel.js');
  const search = src('src/js/ui/studio/graph-search.js');
  const registry = src('src/js/studio/registry.js');
  // The registry holds the one ranking; its search and the find dialog both call it.
  assert.equal((registry.match(/^export function rankSearch\(/gm) || []).length, 1);
  assert.match(registry, /\n {4}search\(query\) \{\n {6}return rankSearch\(/);
  assert.match(search,
    /import \{[^}]*\brankSearch\b[^}]*\} from '\.\.\/\.\.\/studio\/registry\.js';/);
  assert.match(search, /export function searchNodes[\s\S]*?rankSearch\(/);
  assert.match(library, /export function libraryView[\s\S]*?registry\.search\(/);
  // The quick add lists through libraryView, the find dialog through searchNodes.
  assert.match(picker, /export function createQuickAdd[\s\S]*?libraryView\(/);
  assert.match(picker, /export function createFindNode[\s\S]*?searchNodes\(/);
  assert.match(library, /export function mountLibrary[\s\S]*?libraryView\(/);
  for (const [name, text] of [['graph-picker.js', picker], ['library-panel.js', library],
    ['graph-search.js', search]]) {
    const matcher = new RegExp(['searchNodeTypes', '\\.includes\\(q', 'startsWith\\(',
      'function (norm|inOrder|termRank|termScore)\\b', 'const norm\\b'].join('|'));
    assert.doesNotMatch(text, matcher, `${name} carries no matcher of its own`);
  }
});

test('V610 a 100-node graph search stays within the search budget', () => {
  const store = createStudioStore(normalizeStudio({}),
    { idGenerator: createIdGenerator(normalizeStudio({})) });
  buildLargeStudio(store);
  const m = store.getModel();
  const cpu = (fn) => {
    const t0 = process.threadCpuUsage();
    fn();
    const d = process.threadCpuUsage(t0);
    return (d.user + d.system) / 1000;
  };
  searchNodes(m, 'fltr 1');
  let min = Infinity;
  for (let i = 0; i < 15; i++) min = Math.min(min, cpu(() => searchNodes(m, 'fltr 1')));
  assert.ok(min <= PERF_BUDGETS.search, `${min.toFixed(2)} ms <= ${PERF_BUDGETS.search} ms`);
  assert.equal(searchNodes(m, 'filter 12').items[0].id, 'filter-12');
});

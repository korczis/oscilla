// U130: the command palette (src/js/ui/palette.js). Its index is DERIVED: every workspace, Studio
// template, Synth tab, Synth module, Synth preset, instrument preset, riff, Learn card, node
// type and catalogue component has exactly one entry, the counts read from the registries and
// never typed here; a registry item without an entry is named (mutation). The searches the
// journeys found empty (J3: "LFO", "modulace") now find their entries; fold handles diacritics;
// the order is deterministic. Ctrl/Cmd+K is one binding of the key registry, Enter in the shell's
// search opens the palette, and the roving helper gives a combobox Home and End.
// On the merge base src/js/ui/palette.js does not exist, so this file fails there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const P = await import('../../src/js/ui/palette.js');
const { CATALOG } = await import('../../src/js/ui/catalog/registry.js');
const { KINDS } = await import('../../src/js/ui/catalog/kinds.js');
const { NODE_REGISTRY } = await import('../../src/js/studio/registry.js');
const { listTemplates } = await import('../../src/js/studio/templates/index.js');
const { PRESETS } = await import('../../src/js/synth/presets.js');
const SEMI_MONO = (await import('../../src/js/synth/panels/semi-mono.js')).default;
const { BUILTIN_PRESETS } = await import('../../src/js/data/presets.js');
const { RIFFS } = await import('../../src/js/studio/riffs/library.js');
const { LEARN_CARDS_SHOWN } = await import('../../src/js/data/learn-display.js');
const { RECORD_KINDS } = await import('../../src/js/core/url-state-records.js');
const shell = await import('../../src/js/ui/shell.js');
const { createKeyRegistry } = await import('../../src/js/ui/keys/registry.js');
const { bindPageKeys } = await import('../../src/js/ui/keys/clients.js');
const { roving } = await import('../../src/js/ui/keys/roving.js');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HTML = readFileSync(`${ROOT}src/index.html`, 'utf8');

/** The navbar menus' items of src/index.html, as actionsOfPage reads the page. */
function menuActionsOfMarkup(html) {
  const out = [];
  const item = /<button[^>]*role="menuitem[a-z]*"[^>]*data-osc="([^"]+)"[^>]*>([^<]*)</g;
  for (const m of html.matchAll(item)) {
    if (!out.some((a) => a.hook === m[1])) out.push({ hook: m[1], label: m[2].trim() || m[1] });
  }
  return out;
}
const HEADER = HTML.slice(HTML.indexOf('<header role="banner"'), HTML.indexOf('</header>'));
const ACTIONS = menuActionsOfMarkup(HEADER);
const RECORDS = RECORD_KINDS.map((kind, i) => ({ kind, id: `r${i}`, name: `Záznam ${i}` }));
const INDEX = P.paletteIndex({ actions: ACTIONS, records: RECORDS });
const of = (kind) => INDEX.filter((e) => e.kind === kind);
const ids = (list) => list.map((e) => e.key).sort();
const sorted = (list) => [...list].sort();

test('the index is derived: one entry per item of every registry, counts read from them', () => {
  assert.deepEqual(P.paletteMissing(INDEX, { actions: ACTIONS, records: RECORDS }), []);
  assert.equal(new Set(INDEX.map((e) => e.id)).size, INDEX.length, 'entry ids are unique');
  assert.deepEqual(ids(of('place')), sorted(shell.WORKSPACE_IDS));
  assert.deepEqual(ids(of('template')), sorted(listTemplates().map((t) => t.id)));
  assert.deepEqual(ids(of('tab')), sorted(SEMI_MONO.tabs.map((t) => t.id)));
  assert.deepEqual(ids(of('module')), sorted(SEMI_MONO.modules.map((m) => m.id)));
  assert.deepEqual(ids(of('synth-preset')), sorted(PRESETS.map((p) => p.id)));
  assert.deepEqual(ids(of('preset')), sorted(BUILTIN_PRESETS.map((p) => p.id)));
  assert.deepEqual(ids(of('riff')), sorted(RIFFS.map((r) => r.id)));
  assert.deepEqual(ids(of('learn')), sorted(LEARN_CARDS_SHOWN.map((c) => c.id)));
  assert.deepEqual(ids(of('node')), sorted(NODE_REGISTRY.list().map((d) => d.type)));
  const components = CATALOG.list().filter((d) => d.kind !== 'node-face');
  assert.deepEqual(ids(of('component')), sorted(components.map((d) => d.id)));
  assert.equal(of('node').length + of('component').length, CATALOG.list().length,
    'every catalogue declaration is one node or component entry');
  assert.deepEqual(ids(of('action')), sorted(ACTIONS.map((a) => a.hook)));
  assert.deepEqual(ids(of('record')), sorted(RECORDS.map((r) => `${r.kind}:${r.id}`)));
  assert.deepEqual([...new Set(INDEX.map((e) => e.kind))].sort(),
    P.PALETTE_KINDS.map((k) => k.id).sort(), 'every kind of PALETTE_KINDS has entries');
  for (const a of ['header.settings', 'header.shortcuts', 'export.wav', 'export.url']) {
    assert.ok(ACTIONS.some((x) => x.hook === a), `the page's menus hold ${a}`);
  }
});

test('mutation: a registry item without an entry, or with two, is named', () => {
  const dropped = INDEX.filter((e) => e.id !== 'template:first-patch');
  assert.deepEqual(P.paletteMissing(dropped, { actions: ACTIONS, records: RECORDS }),
    ['template:first-patch']);
  const extra = { id: 'u130-new', title: 'U130 New', category: 'synthesis', learn: null };
  const more = { templates: [...listTemplates(), extra], actions: ACTIONS, records: RECORDS };
  assert.deepEqual(P.paletteMissing(INDEX, more), ['template:u130-new']);
  assert.deepEqual(P.paletteMissing(P.paletteIndex(more), more), [], 'derived, so it follows');
  const twice = [...INDEX, INDEX.find((e) => e.id === 'node:lfo')];
  assert.deepEqual(P.paletteMissing(twice, { actions: ACTIONS, records: RECORDS }),
    ['node:lfo']);
  const node = { ...NODE_REGISTRY.list()[0], type: 'u130-node' };
  const catalog = [...CATALOG.list(), { id: 'studio.node.u130-node', kind: 'node-face',
    label: 'U130', docs: '' }];
  const nodes = { get: (t) => (t === 'u130-node' ? node : NODE_REGISTRY.get(t)) };
  assert.deepEqual(P.paletteMissing(INDEX, { catalog, nodes, actions: ACTIONS,
    records: RECORDS }), ['node:u130-node']);
});

test('every entry has a Czech-facing label, a kind name and a target its owner runs', () => {
  for (const e of INDEX) {
    assert.ok(e.label && e.hint, `${e.id}: label and hint`);
    assert.ok(P.PALETTE_KIND_LABELS[e.kind], `${e.id}: a kind name`);
    assert.equal(Object.keys(e.target).length > 0, true, `${e.id}: a target`);
  }
  for (const k of KINDS) assert.ok(P.COMPONENT_KIND_NAMES[k], `catalogue kind ${k} is named`);
  for (const d of NODE_REGISTRY.list()) {
    assert.ok(P.NODE_CATEGORY_NAMES[d.category], `node category ${d.category} is named`);
  }
  for (const k of RECORD_KINDS) assert.ok(P.RECORD_KIND_NAMES[k], `record kind ${k} is named`);
  // Templates and records go through the one hash dispatcher; places through setWorkspace.
  for (const e of of('template')) assert.match(e.target.href, /^#m=studio&st=/);
  for (const e of of('record')) assert.match(e.target.href, /^#m=experiments&(exp|def|finding)=/);
  for (const e of of('place')) assert.equal(e.target.route, e.key);
});

const first = (q, n = 1) => P.paletteSearch(INDEX, q).slice(0, n).map((e) => e.id);
const finds = (q) => P.paletteSearch(INDEX, q).map((e) => e.id);

test('the searches J3 found empty: "LFO" and "modulace", and "midi", "riff", a template name',
  () => {
    assert.deepEqual(sorted(first('LFO', 2)), ['module:mg', 'node:lfo'],
      'LFO finds the Synth MG / LFO module and the LFO node first');
    assert.ok(finds('lfo').includes('node:lfo'), 'the case of the query does not matter');
    assert.equal(first('modulace')[0], 'learn:modulation', 'modulace: the Learn card first');
    assert.ok(finds('modulace').includes('node:lfo'), 'modulace: the modulation nodes too');
    assert.ok(finds('midi').includes('component:midi.connect'), 'midi: Připojit MIDI');
    assert.ok(finds('midi').includes('place:synth'), 'midi: the Synth, which plays it');
    const riffs = finds('riff').filter((id) => id.startsWith('riff:'));
    assert.deepEqual(sorted(riffs), sorted(RIFFS.map((r) => `riff:${r.id}`)), 'riff: every riff');
    for (const t of listTemplates()) {
      assert.equal(first(t.title)[0], `template:${t.id}`, `${t.title}: its template first`);
    }
    assert.ok(finds('nastaveni').includes('action:header.settings'), 'nastavení: Settings');
    assert.equal(P.paletteSearch(INDEX, 'nastaveni')[0].kind, 'action');
    assert.equal(first('export wav')[0], 'action:export.wav');
  });

test('fold handles diacritics: Czech with or without them finds the same entries', () => {
  assert.equal(shell.fold('Měření'), 'mereni');
  assert.equal(shell.fold('  Ŕůžový ČÁP '), 'ruzovy cap');
  assert.deepEqual(shell.searchWords('Krokový sekvencer CV'), ['krokovy', 'sekvencer', 'cv']);
  assert.deepEqual(finds('měření'), finds('mereni'));
  assert.equal(first('mereni')[0], 'place:measure');
  assert.deepEqual(finds('výuka').slice(0, 1), ['place:learn']);
  assert.ok(shell.queryMatches(shell.searchWords('Analyzátor mikrofonu'), 'analyz mikro'));
  assert.ok(!shell.queryMatches(shell.searchWords('Analyzátor'), 'zator'), 'prefixes only');
  // navMatches keeps its meaning on the shared helpers.
  assert.deepEqual(shell.navSearch('filt'), ['filter']);
  assert.deepEqual(shell.navSearch('analýza'), shell.NAV_GROUPS.analyze);
});

test('the order is deterministic: label before alias before text, then kind, then index', () => {
  const a = P.paletteSearch(P.paletteIndex({ actions: ACTIONS }), 'filter');
  const b = P.paletteSearch(P.paletteIndex({ actions: ACTIONS }), 'filter');
  assert.deepEqual(a.map((e) => e.id), b.map((e) => e.id));
  const tiers = a.map((e) => P.matchTier(e, 'filter'));
  assert.deepEqual(tiers, [...tiers].sort((x, y) => x - y), 'tiers never go back');
  assert.equal(a[0].id, 'place:filter', 'the Filtry page first, by its English name');
  assert.equal(P.paletteSearch(INDEX, 'seq')[0].id, 'place:sequencer');
  assert.deepEqual(P.paletteSearch(INDEX, '').map((e) => e.id), INDEX.map((e) => e.id)
    .sort((x, y) => P.PALETTE_KINDS.findIndex((k) => x.startsWith(`${k.id}:`))
      - P.PALETTE_KINDS.findIndex((k) => y.startsWith(`${k.id}:`))),
  'an empty query lists everything in kind order');
  assert.deepEqual(finds('zzzz-u130'), []);
});

test('the status says how many it found, in Czech plural forms', () => {
  assert.equal(P.paletteStatus(0), 'Nic nenalezeno.');
  assert.equal(P.paletteStatus(1), '1 výsledek; Enter otevře vybraný.');
  assert.equal(P.paletteStatus(3), '3 výsledky; Enter otevře vybraný.');
  assert.equal(P.paletteStatus(7), '7 výsledků; Enter otevře vybraný.');
  assert.equal(P.paletteStatus(400), `400 výsledků, zobrazeno prvních ${P.PALETTE_LIMIT}; `
    + 'upřesněte hledání.');
});

test('the records are what Experiments has listed; the actions are the menus\' items', () => {
  const cmp = { exps: { rows: [{ id: 'e1', name: 'Pokoj' }], defs: [{ id: 'd1', name: 'Def' }] },
    fnd: { rows: [{ id: 'f1', statement: 'Basy hučí' }] } };
  assert.deepEqual(P.recordsOf(cmp), [{ kind: 'experiment', id: 'e1', name: 'Pokoj' },
    { kind: 'definition', id: 'd1', name: 'Def' }, { kind: 'finding', id: 'f1',
      name: 'Basy hučí' }]);
  assert.deepEqual(P.recordsOf({}), []);
  const el = (hook, text) => ({ getAttribute: (k) => (k === 'data-osc' ? hook : null),
    textContent: text });
  const doc = { querySelectorAll: () => [el('header.settings', ' Nastavení\n '),
    el('header.settings', 'again'), el('export.wav', 'Exportovat WAV'), el('', 'x')] };
  assert.deepEqual(P.actionsOfPage(doc), [{ hook: 'header.settings', label: 'Nastavení' },
    { hook: 'export.wav', label: 'Exportovat WAV' }]);
});

test('Ctrl/Cmd+K is one binding of the key registry, in every workspace and focus', () => {
  const keys = createKeyRegistry();
  let toggled = 0;
  const cmp = { workspace: 'studio', paletteOpen: false, paletteToggle() { toggled += 1; } };
  bindPageKeys({ keys, cmp, stopSequencer() {} });
  for (const chord of ['Ctrl+KeyK', 'Meta+KeyK']) {
    for (const focus of ['none', 'text', 'piano', 'dialog']) {
      const b = keys.resolve(chord, { workspace: 'synth', focus });
      assert.equal(b && b.id, 'palette.open', `${chord} in focus ${focus}`);
      b.run({});
    }
  }
  assert.equal(toggled, 8);
  assert.equal(keys.resolve('KeyK', { workspace: 'playground' }), null, 'a bare K is not it');
});

test('Enter in the shell search opens the palette with its text (U130)', () => {
  const s = shell.createShell({ get: () => null, set: () => {} });
  let shown = null;
  Object.assign(s, { paletteShow: (o) => { shown = o; }, closeDrawer() { this.drawerOpen = false; } });
  s.navQuery = 'lfo';
  s.navSearchGo();
  assert.deepEqual(shown, { query: 'lfo' });
  assert.equal(s.navQuery, '');
  s.navQuery = 'filt';
  assert.equal(s.navSearchStatus(), 'Nalezené pracovní plochy: 1; Enter otevře paletu se vším, '
    + 'co hledání najde');
  s.navQuery = '';
  assert.equal(s.navSearchStatus(), '');
});

test('roving: homeEndInText gives a combobox\'s Home and End to its list', () => {
  const run = (opts, key) => {
    let handler = null;
    const moved = [];
    const container = { addEventListener: (t, fn) => { handler = fn; }, removeEventListener() {} };
    roving(container, { count: () => 5, index: () => 2, move: (i) => moved.push(i), ...opts });
    const input = { tagName: 'INPUT', getAttribute: () => 'text' };
    let prevented = false;
    handler({ key, target: input, preventDefault() { prevented = true; }, stopPropagation() {} });
    return { moved, prevented };
  };
  assert.deepEqual(run({ homeEndInText: true }, 'End'), { moved: [4], prevented: true });
  assert.deepEqual(run({ homeEndInText: true }, 'Home'), { moved: [0], prevented: true });
  assert.deepEqual(run({}, 'End'), { moved: [], prevented: false }, 'off: the input keeps End');
  assert.deepEqual(run({ homeEndInText: true }, 'a'), { moved: [], prevented: false });
  assert.deepEqual(run({}, 'ArrowDown'), { moved: [3], prevented: true });
});

test('the palette dialog is one empty Pro modal in src/index.html, built by ui/palette.js', () => {
  const tag = /<dialog id="osc-dlg-palette"[^>]*>/.exec(HTML);
  assert.ok(tag, 'src/index.html holds the dialog');
  assert.match(tag[0], /data-osc="palette"/);
  assert.match(tag[0], /data-oscilla-modal/);
  assert.match(tag[0], /class="bg-white rounded-lg shadow dark:bg-gray-800"/);
  assert.doesNotMatch(tag[0], /osc-dialog/, 'no legacy dialog class');
  const src = readFileSync(`${ROOT}src/js/ui/palette.js`, 'utf8');
  for (const hook of ['palette.input', 'palette.list']) assert.ok(src.includes(`'${hook}'`), hook);
  assert.doesNotMatch(src, /addEventListener\('key(down|up)'/, 'keys go through roving');
  assert.doesNotMatch(src, /\.style\.|\.style\s*=|setProperty|cssText/, 'no inline style');
});

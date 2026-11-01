// U063 navigable-surface census: every workspace, panel, subview, dialog and route kind the
// code holds has a contract in tests/unit/surface-census.json, and every contract names a
// surface the code holds. Nothing here counts "all" by hand: the inventory is derived.
//
//   workspaces  src/js/ui/app.js WORKSPACES
//   panels      the elements of src/index.html carrying data-osc-modes, keyed by their id
//   subviews    every role=tab of the shell, keyed `<data-osc>:<data-value>`: static ones from
//               the markup, templated ones from the registry their <template x-for> iterates
//               (MEASURE_RESULT_TABS, PRESET_CATEGORIES); the Studio subviews, which are also
//               STUDIO_LINK_SUBVIEWS; and the regions a view switch shows
//               (x-show="exps.panel === '<value>'", the Experiments detail and compare views)
//   dialogs     every <dialog> of the shell, keyed by its id
//   routes      the hash domains of src/js/ui/navigation.js HASH_DOMAINS, each registered by
//               src/js/main.js navRegister
//
// Each entry: id, kind, reachedFrom (workspace ids; for a panel or subview the data-osc-modes
// of the element that holds it), purpose, state (a src/js file that exists), evidence (one of
// EVIDENCE), deepLink (an address the router sends to one of reachedFrom, or null with
// deepLinkWhyNot), tests (test files that exist and name the surface), plan (issues of
// .ai/repo/project/issues) and, for a panel, charts: the chart hosts inside it, which are K053's
// census (tests/unit/chart-host-census.json) and are named here, never described again.
//
// The debt is the entries with no deep link or no test. Its count may not exceed its value in
// any earlier commit of the census file (git log / git show; skipped without that history,
// like tests/unit/no-inert-surfaces.test.mjs, and failed under GitHub Actions when no commit
// holds the file). The running page is tests/browser/surface-census.cjs.
//
// What this does not decide: that a test file which names a surface exercises it (it is read
// as text: an id, a data-osc with its value, or the address of the surface), that a purpose
// is true and that an evidence class is the right one. Those stay with the reviewer.
//   node --test tests/unit/surface-census.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORKSPACES } from '../../src/js/ui/app.js';
import { HASH_DOMAINS, INSTRUMENT_HASH_KEYS, routeOfHash } from '../../src/js/ui/navigation.js';
import { MEASURE_RESULT_TABS } from '../../src/js/ui/measure.js';
import { PRESET_CATEGORIES } from '../../src/js/data/presets.js';
import {
  STUDIO_LINK_KEYS, STUDIO_LINK_SUBVIEWS, decodeStudioLink,
} from '../../src/js/core/url-state-studio.js';
import { RECIPE_HASH_KEY } from '../../src/js/core/url-state-measure.js';
import { RECORD_LINK_KEYS } from '../../src/js/core/url-state-records.js';
import { STUDIO_TEMPLATES } from '../../src/js/studio/templates/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const isFile = (rel) => existsSync(path.join(ROOT, rel)) && statSync(path.join(ROOT, rel)).isFile();

export const P = 'U063 surface-census:';
export const CENSUS_REL = 'tests/unit/surface-census.json';
const SELF = Object.freeze([CENSUS_REL, 'tests/unit/surface-census.test.mjs',
  'tests/browser/surface-census.cjs']);
export const KINDS = Object.freeze(['workspace', 'panel', 'subview', 'dialog', 'route']);
export const EVIDENCE = Object.freeze(['measured', 'derived', 'inferred', 'recorded', 'planned',
  'test-context', 'none']);
const FIELDS = Object.freeze(['id', 'kind', 'reachedFrom', 'purpose', 'state', 'evidence',
  'deepLink', 'deepLinkWhyNot', 'tests', 'plan', 'charts']);
/** The registries a templated role=tab iterates, by the name its x-for reads. */
const TAB_REGISTRIES = Object.freeze({
  MEASURE_RESULT_TABS: MEASURE_RESULT_TABS.map((t) => t.id),
  PRESET_CATEGORIES: PRESET_CATEGORIES.map((c) => c.id),
});
/**
 * View switches whose regions are navigable views of their own: the Experiments detail and
 * compare views (src/js/ui/experiments.js `exps.panel`). The other x-show comparisons of the
 * shell are not views: `meas.tab` and `presetTab` show the panes of tabs counted above,
 * `source`, `f.kind` and `exps.defForm.mode` are fields of one form.
 */
export const VIEW_SWITCHES = Object.freeze(['exps.panel']);
/** The keys each hash domain reads (navigation.js header). */
const DOMAIN_KEYS = Object.freeze({
  instrument: INSTRUMENT_HASH_KEYS,
  measure: [RECIPE_HASH_KEY],
  studio: [STUDIO_LINK_KEYS.template, STUDIO_LINK_KEYS.subview],
  records: Object.values(RECORD_LINK_KEYS),
});
/** What a `<placeholder>` of a deep link stands for when the router reads it. */
const PLACEHOLDER = 'u063-sample';

// ------------------------------------------------------------------------------ the shell
const lineOf = (text, at) => text.slice(0, at).split('\n').length;
const attrOf = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name.replace(/[.:]/g, '\\$&')}="([^"]*)"`));
  return m ? m[1] : null;
};

/** The offset just past the element that starts at `at` (balanced on its own tag name). */
function elementEnd(html, at, name) {
  const re = new RegExp(`<${name}\\b[^>]*>|</${name}\\s*>`, 'gi');
  re.lastIndex = at;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return html.length;
}

/** The HTML with its comments blanked (offsets and lines kept). */
const uncomment = (html) => html.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));

/**
 * The surfaces of a shell's markup: panels (data-osc-modes), tabs, view-switch regions,
 * dialogs, and the problems that keep one from being keyed.
 */
export function deriveShell(rawHtml) {
  const html = uncomment(rawHtml);
  const tags = [...html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*>/gi)].map((m) => ({
    tag: m[0], name: m[1].toLowerCase(), at: m.index, line: lineOf(html, m.index) }));
  const problems = [];
  const spans = tags.filter((t) => attrOf(t.tag, 'data-osc-modes') !== null)
    .map((t) => ({ ...t, end: elementEnd(html, t.at, t.name),
      modes: attrOf(t.tag, 'data-osc-modes').split(/\s+/).filter(Boolean) }));
  const modesAt = (at) => {
    const own = spans.filter((s) => s.at <= at && at < s.end).sort((a, b) => b.at - a.at)[0];
    return own ? own.modes : [];
  };
  const panels = [];
  for (const s of spans) {
    const id = attrOf(s.tag, 'id');
    if (!id) {
      problems.push(`a data-osc-modes element at src/index.html:${s.line} has no id, so the `
        + 'census cannot key it');
      continue;
    }
    const isHost = (t) => attrOf(t.tag, 'data-osc-chart') !== null
      || /(^|\s)osc-chart-host(\s|$)/.test(attrOf(t.tag, 'class') || '');
    const charts = tags.filter((t) => t.at > s.at && t.at < s.end && isHost(t))
      .map((t) => attrOf(t.tag, 'id') || `(a chart host without id at src/index.html:${t.line})`);
    panels.push({ id, modes: s.modes, charts, line: s.line, dataOsc: attrOf(s.tag, 'data-osc') });
  }
  const tabs = [];
  for (const t of tags.filter((x) => attrOf(x.tag, 'role') === 'tab')) {
    const osc = attrOf(t.tag, 'data-osc');
    const value = attrOf(t.tag, 'data-value');
    const bound = attrOf(t.tag, ':data-value');
    if (osc && value) {
      const id = attrOf(t.tag, 'id');
      const prefix = id && id.toLowerCase().endsWith(value.toLowerCase())
        ? id.slice(0, id.length - value.length) : null;
      tabs.push({ key: `${osc}:${value}`, dataOsc: osc, value, id, prefix, modes: modesAt(t.at),
        line: t.line });
      continue;
    }
    // A templated tab: the nearest open <template x-for="<v> in <REGISTRY>"> holds it.
    const loop = tags.filter((x) => x.name === 'template' && x.at < t.at
      && elementEnd(html, x.at, 'template') > t.at && /\sx-for="/.test(x.tag)).pop();
    const m = loop && attrOf(loop.tag, 'x-for').match(/^\s*\(?\s*(\w+)[^)]*?\)?\s+in\s+(\w+)\s*$/);
    const ids = m && TAB_REGISTRIES[m[2]];
    if (osc && bound && ids && bound.trim() === `${m[1]}.id`) {
      const idExpr = attrOf(t.tag, ':id') || '';
      const pm = idExpr.match(/^'([^']*)'\s*\+\s*\w+\.id$/);
      for (const v of ids) {
        tabs.push({ key: `${osc}:${v}`, dataOsc: osc, value: v, id: pm ? `${pm[1]}${v}` : null,
          prefix: pm ? pm[1] : null, modes: modesAt(t.at), line: t.line, registry: m[2] });
      }
      continue;
    }
    problems.push(`a role=tab at src/index.html:${t.line} has no data-osc with a data-value (or `
      + 'a :data-value read from a registry the census knows), so the census cannot key it');
  }
  const switches = [];
  for (const t of tags) {
    const xs = attrOf(t.tag, 'x-show');
    const m = xs && xs.match(/^\s*([\w.]+)\s*===\s*'([\w-]+)'\s*$/);
    if (!m || !VIEW_SWITCHES.includes(m[1])) continue;
    switches.push({ key: `${m[1]}:${m[2]}`, dataOsc: m[1], value: m[2], id: attrOf(t.tag, 'id'),
      prefix: null, modes: modesAt(t.at), line: t.line, isSwitch: true });
  }
  const dialogs = [];
  for (const t of tags.filter((x) => x.name === 'dialog')) {
    const id = attrOf(t.tag, 'id');
    if (!id) {
      problems.push(`a <dialog> at src/index.html:${t.line} has no id, so the census cannot `
        + 'key it');
      continue;
    }
    dialogs.push({ id, line: t.line });
  }
  return { panels, tabs, switches, dialogs, problems };
}

/** The navigable surfaces of a tree: Map `${kind}:${id}` -> surface, and the problems. */
export function deriveInventory({ html, mainJs }) {
  const shell = deriveShell(html);
  const problems = [...shell.problems];
  const out = new Map();
  const add = (kind, id, s) => {
    const key = `${kind}:${id}`;
    if (out.has(key)) problems.push(`${kind} "${id}" is derived twice (src/index.html:${s.line})`);
    else out.set(key, { ...s, kind, id, elementId: s.id === undefined ? null : s.id });
  };
  for (const w of WORKSPACES) add('workspace', w, { modes: [w] });
  for (const p of shell.panels) add('panel', p.id, p);
  for (const t of [...shell.tabs, ...shell.switches]) add('subview', t.key, t);
  for (const v of STUDIO_LINK_SUBVIEWS) {
    if (!out.has(`subview:studio.subview:${v}`)) {
      problems.push(`STUDIO_LINK_SUBVIEWS names "${v}", and the shell has no studio.subview tab `
        + 'for it');
    }
  }
  for (const t of shell.tabs.filter((x) => x.dataOsc === 'studio.subview')) {
    if (!STUDIO_LINK_SUBVIEWS.includes(t.value)) {
      problems.push(`the studio.subview tab "${t.value}" is not in STUDIO_LINK_SUBVIEWS, so no `
        + 'link can open it');
    }
  }
  for (const d of shell.dialogs) add('dialog', d.id, d);
  const registered = [...mainJs.matchAll(/\bnavRegister\(\s*'([\w-]+)'/g)].map((m) => m[1]);
  for (const r of HASH_DOMAINS) {
    add('route', r, { modes: [] });
    if (!registered.includes(r)) problems.push(`hash domain "${r}" is never registered (main.js)`);
  }
  for (const r of registered.filter((x) => !HASH_DOMAINS.includes(x))) {
    problems.push(`main.js registers hash domain "${r}", which HASH_DOMAINS does not name`);
  }
  return { surfaces: out, problems };
}

// ------------------------------------------------------------------------------ names
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quoted = (v) => new RegExp(`['"\`]${esc(v)}['"\`]`);
const word = (v) => new RegExp(`(^|[^\\w-])${esc(v)}(?![\\w-])`);

/**
 * The spellings by which a test file names a surface. A file names it when one of the
 * returned predicates holds on its text.
 */
export function namesOf(entry, surface) {
  const has = (s) => (t) => word(s).test(t);
  const both = (...ps) => (t) => ps.every((p) => p(t));
  const q = (v) => (t) => quoted(v).test(t);
  const re = (r) => (t) => r.test(t);
  const id = entry.id;
  switch (entry.kind) {
    case 'workspace':
      return [re(new RegExp(`\\bm=${esc(id)}(?![\\w-])`)), has(`nav.${id}`),
        both(q(id), re(/workspace|WORKSPACES|nav\./i))];
    case 'panel': {
      const m = id.match(/^(osc-[a-z]+-)(.+)$/);
      return [has(id), ...(m ? [both((t) => t.includes(m[1]), q(m[2]))] : []),
        ...(surface && surface.dataOsc ? [q(surface.dataOsc)] : [])];
    }
    case 'subview': {
      const s = surface || {};
      // A tab's data-osc is a quoted string in a test; a view switch is state read as code.
      const out = [both(s.isSwitch ? has(s.dataOsc || '') : q(s.dataOsc || ''), q(s.value || ''))];
      if (s.elementId) out.push(has(s.elementId));
      if (s.prefix) out.push(both((t) => t.includes(s.prefix), (t) => quoted(s.value).test(t)
        || quoted(s.value.toLowerCase()).test(t)));
      if (s.dataOsc === 'studio.subview') {
        out.push(re(new RegExp(`\\b${STUDIO_LINK_KEYS.subview}=${esc(s.value)}(?![\\w-])`)));
      }
      return out;
    }
    case 'dialog':
      return [has(id)];
    case 'route':
      return [re(new RegExp(`navRegister\\(\\s*['"]${esc(id)}['"]`)),
        both(q(id), (t) => (DOMAIN_KEYS[id] || []).some((k) => new RegExp(`[#&?]${esc(k)}=`)
          .test(t)))];
    default:
      return [];
  }
}

// ------------------------------------------------------------------------------ judging
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const sub = (link) => link.replace(/<[^<>]+>/g, PLACEHOLDER);

/** The problems of one entry's deep link. */
function deepLinkProblems(e, s) {
  const out = [];
  const name = `${e.kind} "${e.id}"`;
  if (e.deepLink === null) {
    if (typeof e.deepLinkWhyNot !== 'string' || e.deepLinkWhyNot.trim().split(/\s+/).length < 5) {
      out.push(`${name}: deepLink is null and deepLinkWhyNot does not say why (5 words or more)`);
    }
    return out;
  }
  if (e.deepLinkWhyNot !== undefined) out.push(`${name}: a deep link and deepLinkWhyNot both`);
  if (typeof e.deepLink !== 'string' || !e.deepLink.startsWith('#')) {
    return [...out, `${name}: deepLink is neither null nor an address starting with #`];
  }
  const link = sub(e.deepLink);
  const route = routeOfHash(link);
  if (!route) return [...out, `${name}: the router opens no workspace for ${e.deepLink}`];
  if (!(e.reachedFrom || []).includes(route.workspace)) {
    out.push(`${name}: ${e.deepLink} opens ${route.workspace}, not one of reachedFrom`);
  }
  if (e.kind === 'workspace' && route.workspace !== e.id) {
    out.push(`${name}: ${e.deepLink} opens ${route.workspace}`);
  }
  if (e.kind === 'subview' && s && s.dataOsc === 'studio.subview') {
    const d = decodeStudioLink(link, { templateIds: STUDIO_TEMPLATES.map((t) => t.id) });
    if (!d || !d.ok || d.subview !== s.value) {
      out.push(`${name}: ${e.deepLink} does not open the ${s.value} subview`);
    }
  }
  if (e.kind === 'route') {
    const keys = new URLSearchParams(link.slice(1));
    if (!(DOMAIN_KEYS[e.id] || []).some((k) => keys.has(k))) {
      out.push(`${name}: ${e.deepLink} carries none of the domain's keys `
        + `(${(DOMAIN_KEYS[e.id] || []).join(', ')})`);
    }
  }
  return out;
}

/**
 * Every problem of a census against a tree, each starting with the prefix and naming the
 * surface. `files`: rel -> text (or null when it does not exist); `issueIds`: Set of plan ids.
 */
export function judge(census, inventory, { fileText, issueIds }) {
  const out = inventory.problems.map((p) => `${P} ${p}`);
  const entries = Array.isArray(census && census.surfaces) ? census.surfaces : [];
  if (!entries.length) return [...out, `${P} ${CENSUS_REL} has no surfaces array`];
  const legend = Object.keys((census && census.evidenceClasses) || {});
  if (!sameSet(legend, EVIDENCE)) {
    out.push(`${P} evidenceClasses ${JSON.stringify(legend)} does not say what each of `
      + `${EVIDENCE.join(', ')} means`);
  }
  const seen = new Set();
  for (const e of entries) {
    const key = `${e && e.kind}:${e && e.id}`;
    const name = `${e && e.kind} "${e && e.id}"`;
    const bad = (m) => out.push(`${P} ${name}: ${m}`);
    if (!e || typeof e.id !== 'string' || !KINDS.includes(e.kind)) {
      out.push(`${P} an entry with no id or an unknown kind: ${JSON.stringify(e).slice(0, 120)}`);
      continue;
    }
    if (seen.has(key)) bad('listed twice');
    seen.add(key);
    const s = inventory.surfaces.get(key);
    if (!s) {
      bad('names no surface the tree holds (removed or renamed); remove or rename the entry');
      continue;
    }
    for (const f of Object.keys(e)) if (!FIELDS.includes(f)) bad(`unknown field "${f}"`);
    if (!Array.isArray(e.reachedFrom) || !e.reachedFrom.length
      || e.reachedFrom.some((w) => !WORKSPACES.includes(w))) {
      bad('reachedFrom is not a non-empty list of workspace ids');
    } else if (['workspace', 'panel', 'subview'].includes(e.kind) && !sameSet(e.reachedFrom,
      s.modes)) {
      bad(`reachedFrom ${JSON.stringify(e.reachedFrom)} is not where the shell shows it `
        + `(${JSON.stringify(s.modes)})`);
    }
    if (typeof e.purpose !== 'string' || e.purpose.trim().split(/\s+/).length < 4) {
      bad('purpose is not a sentence of 4 words or more');
    }
    if (typeof e.state !== 'string' || !/^src\/js\/.+\.js$/.test(e.state) || !isFile(e.state)) {
      bad(`state ${JSON.stringify(e.state)} is not a src/js module that exists`);
    }
    if (!EVIDENCE.includes(e.evidence)) {
      bad(`evidence ${JSON.stringify(e.evidence)} is not one of ${EVIDENCE.join(', ')}`);
    }
    for (const m of deepLinkProblems(e, s)) out.push(`${P} ${m}`);
    if (!Array.isArray(e.tests)) bad('tests is not a list');
    for (const t of Array.isArray(e.tests) ? e.tests : []) {
      const text = fileText(t);
      if (SELF.includes(t)) bad(`tests names the census itself (${t}); it exercises no surface`);
      else if (!/^tests\/(unit\/[\w.-]+\.test\.mjs|browser\/[\w.-]+\.cjs)$/.test(t)) {
        bad(`tests names ${t}, which is not a unit test or a browser suite`);
      } else if (text === null) bad(`tests names ${t}, which does not exist`);
      else if (!namesOf(e, s).some((p) => p(text))) {
        bad(`tests names ${t}, which does not name the surface (its id, data-osc with its `
          + 'value, or its address)');
      }
    }
    if (!Array.isArray(e.plan)) bad('plan is not a list');
    for (const id of Array.isArray(e.plan) ? e.plan : []) {
      if (!issueIds.has(id)) {
        bad(`plan names ${id}, which is not an issue of .ai/repo/project/issues`);
      }
    }
    if (e.kind === 'panel') {
      const want = s.charts;
      const got = e.charts === undefined ? [] : e.charts;
      if (!Array.isArray(got) || !sameSet(got, want)) {
        bad(`charts ${JSON.stringify(got)} is not the chart hosts inside it ${JSON.stringify(want)}`
          + ' (named for K053\'s census, tests/unit/chart-host-census.json)');
      }
    } else if (e.charts !== undefined) {
      bad('charts is a panel field (chart hosts are K053\'s census)');
    }
  }
  for (const [key, s] of inventory.surfaces) {
    if (!seen.has(key)) {
      out.push(`${P} ${s.kind} "${s.id}" exists${s.line ? ` (src/index.html:${s.line})` : ''} and `
        + `has no entry in ${CENSUS_REL}`);
    }
  }
  return out;
}

/** The entries in debt: no deep link, or no test. */
export const debtOf = (census) => (census.surfaces || [])
  .filter((e) => e.deepLink === null || !(Array.isArray(e.tests) && e.tests.length));

/** The commits whose census held less debt than `count`: [[sha, was]]. */
export const debtRaised = (count, history) => history
  .map(({ sha, census }) => [sha, debtOf(census).length]).filter(([, was]) => count > was);

// ------------------------------------------------------------------------------ the tree
const fileText = (rel) => (isFile(rel) ? read(rel) : null);
const issueIds = () => new Set(readdirSync(path.join(ROOT, '.ai/repo/project/issues'))
  .filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, '')));
const TREE = () => ({ html: read('src/index.html'), mainJs: read('src/js/main.js') });
const CENSUS = () => JSON.parse(read(CENSUS_REL));
const CTX = () => ({ fileText, issueIds: issueIds() });

test('every navigable surface of the tree has a contract, and every contract a surface', (t) => {
  const inventory = deriveInventory(TREE());
  const problems = judge(CENSUS(), inventory, CTX());
  assert.deepEqual(problems, [], problems.join('\n'));
  const byKind = Object.fromEntries(KINDS.map((k) => [k,
    [...inventory.surfaces.values()].filter((s) => s.kind === k).length]));
  // The inventory is read, not assumed: each kind is present.
  for (const k of KINDS) assert.ok(byKind[k] > 0, `${P} no ${k} was derived`);
  t.diagnostic(`derived: ${JSON.stringify(byKind)}`);
});

test('the census prints its debt: the entries with no deep link or no test', (t) => {
  const debt = debtOf(CENSUS());
  t.diagnostic(`debt ${debt.length}: ${debt.map((e) => `${e.kind}:${e.id}`
    + `${e.deepLink === null ? ' (no deep link)' : ''}${e.tests.length ? '' : ' (no test)'}`)
    .join(', ')}`);
  assert.ok(Array.isArray(debt));
});

test('mutation: a dialog, a tab and a data-osc-modes panel added to the shell are refused', () => {
  const tree = TREE();
  const census = CENSUS();
  const ctx = CTX();
  const at = (html, marker, insert) => {
    const i = html.indexOf(marker);
    assert.ok(i > 0, `marker ${marker} is in the shell`);
    return html.slice(0, i) + insert + html.slice(i);
  };
  const cases = [
    ['a dialog', at(tree.html, '</body>', '<dialog class="osc-dialog" id="osc-dlg-u063-probe">'
      + '</dialog>\n'), /dialog "osc-dlg-u063-probe" exists .* has no entry/],
    ['a tab', at(tree.html, '</body>', '<div role="tablist"><button type="button" role="tab" '
      + 'data-osc="analysis.tab" data-value="u063probe">P</button></div>\n'),
    /subview "analysis\.tab:u063probe" exists .* has no entry/],
    ['a panel', at(tree.html, '</body>', '<section class="osc-panel" id="osc-panel-u063-probe" '
      + 'data-osc-modes="analyzer"></section>\n'),
    /panel "osc-panel-u063-probe" exists .* has no entry/],
    ['a tab with no key', at(tree.html, '</body>', '<div role="tablist"><button role="tab">X'
      + '</button></div>\n'), /a role=tab at src\/index\.html:\d+ has no data-osc/],
    ['a dialog with no id', at(tree.html, '</body>', '<dialog class="osc-dialog"></dialog>\n'),
      /a <dialog> at src\/index\.html:\d+ has no id/],
    ['a templated tab of a registry the census does not know', at(tree.html, '</body>',
      '<template x-for="z in UNKNOWN_TABS" :key="z.id"><button role="tab" data-osc="x.tab" '
      + ':data-value="z.id"></button></template>\n'), /a role=tab .* has no data-osc/],
  ];
  for (const [what, html, re] of cases) {
    const problems = judge(census, deriveInventory({ ...tree, html }), ctx);
    assert.ok(problems.some((p) => p.startsWith(P) && re.test(p)),
      `${what} is refused by name; got:\n${problems.join('\n')}`);
  }
  // The same additions inside a comment are not surfaces.
  const commented = at(tree.html, '</body>', '<!-- <dialog id="osc-dlg-u063-c"></dialog> -->\n');
  assert.deepEqual(judge(census, deriveInventory({ ...tree, html: commented }), ctx), []);
});

test('mutation: a surface removed from the shell, a Studio subview or a hash domain unwired '
  + 'is refused', () => {
  const tree = TREE();
  const census = CENSUS();
  const ctx = CTX();
  const noHelp = tree.html.replace(/<dialog class="osc-dialog" id="osc-dlg-help"/,
    '<dialog class="osc-dialog" id="osc-dlg-help-renamed"');
  let p = judge(census, deriveInventory({ ...tree, html: noHelp }), ctx);
  assert.ok(p.some((x) => /dialog "osc-dlg-help": names no surface/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /dialog "osc-dlg-help-renamed" exists/.test(x)), p.join('\n'));
  const noInspector = tree.html.replace(/data-osc="studio\.subview" data-value="inspector"/,
    'data-osc="studio.subview" data-value="inspectorx"');
  p = judge(census, deriveInventory({ ...tree, html: noInspector }), ctx);
  assert.ok(p.some((x) => /STUDIO_LINK_SUBVIEWS names "inspector"/.test(x)), p.join('\n'));
  const unwired = tree.mainJs.replace(/cmp\.navRegister\('records'/, "cmp.navRegisterX('records'");
  p = judge(census, deriveInventory({ ...tree, mainJs: unwired }), ctx);
  assert.ok(p.some((x) => /hash domain "records" is never registered/.test(x)), p.join('\n'));
});

test('mutation: an entry whose test does not name it, or whose file, issue, evidence, '
  + 'reach, link or charts do not hold, is refused', () => {
  const tree = TREE();
  const inventory = deriveInventory(tree);
  const ctx = CTX();
  const census = CENSUS();
  const pick = (kind, pred = () => true) => census.surfaces.find((e) => e.kind === kind && pred(e));
  const withEntry = (key, patch) => ({ ...census, surfaces: census.surfaces.map((e) => (
    `${e.kind}:${e.id}` === key ? { ...e, ...patch } : e)) });
  const dlg = pick('dialog');
  const panel = pick('panel', (e) => (e.charts || []).length > 0);
  const ws = pick('workspace');
  const studioSv = pick('subview', (e) => e.id.startsWith('studio.subview:'));
  const cases = [
    [`dialog:${dlg.id}`, { tests: ['tests/unit/about.test.mjs'] },
      /tests names tests\/unit\/about\.test\.mjs, which does not name the surface/],
    [`dialog:${dlg.id}`, { tests: ['tests/unit/no-such.test.mjs'] }, /does not exist/],
    [`dialog:${dlg.id}`, { tests: [CENSUS_REL] }, /names the census itself/],
    [`dialog:${dlg.id}`, { plan: ['Z999'] }, /plan names Z999, which is not an issue/],
    [`dialog:${dlg.id}`, { state: 'src/js/ui/no-such.js' }, /is not a src\/js module that exists/],
    [`dialog:${dlg.id}`, { evidence: 'verified' }, /evidence "verified" is not one of/],
    [`dialog:${dlg.id}`, { deepLink: null, deepLinkWhyNot: '' }, /does not say why/],
    [`dialog:${dlg.id}`, { reachedFrom: ['nowhere'] }, /reachedFrom is not a non-empty list/],
    [`dialog:${dlg.id}`, { charts: ['osc-chart-bio'] }, /charts is a panel field/],
    [`dialog:${dlg.id}`, { owner: 'me' }, /unknown field "owner"/],
    [`panel:${panel.id}`, { charts: [] }, /is not the chart hosts inside it/],
    [`panel:${panel.id}`, { reachedFrom: ['about'] }, /is not where the shell shows it/],
    [`workspace:${ws.id}`, { deepLink: '#m=about' }, /opens about/],
    [`subview:${studioSv.id}`, { deepLink: '#m=studio&sv=nowhere' }, /does not open the/],
    ['route:records', { deepLink: '#m=experiments' }, /carries none of the domain's keys/],
  ];
  for (const [key, patch, re] of cases) {
    const p = judge(withEntry(key, patch), inventory, ctx);
    assert.ok(p.some((x) => x.startsWith(P) && x.includes(`"${key.split(':').slice(1).join(':')}"`)
      && re.test(x)), `${key} ${JSON.stringify(patch)} is refused by name; got:\n${p.join('\n')}`);
  }
  const dup = { ...census, surfaces: [...census.surfaces, dlg] };
  assert.ok(judge(dup, inventory, ctx).some((x) => /listed twice/.test(x)));
  const gone = { ...census, surfaces: census.surfaces.filter((e) => e !== dlg) };
  assert.ok(judge(gone, inventory, ctx).some((x) => x.includes(`dialog "${dlg.id}" exists`)));
});

// ------------------------------------------------------------------------------ the debt
/** The census of every commit that changed it, newest first; null without history. */
function censusHistory() {
  const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) return null;
  if (git('rev-parse', '--is-shallow-repository').stdout.trim() === 'true') return null;
  const log = git('log', '--format=%H', '--', CENSUS_REL);
  if (log.status !== 0) return null;
  const out = [];
  for (const sha of log.stdout.split('\n').filter(Boolean)) {
    const shown = git('show', `${sha}:${CENSUS_REL}`);
    if (shown.status !== 0) continue; // the commit that deleted it
    out.push({ sha: sha.slice(0, 12), census: JSON.parse(shown.stdout) });
  }
  return out;
}

test('the debt only shrinks: no more entries without a deep link or a test than in any '
  + 'earlier commit', (t) => {
  const history = censusHistory();
  if (!history || !history.length) {
    if (history && process.env.GITHUB_ACTIONS === 'true') {
      assert.fail(`${P} no commit holds ${CENSUS_REL}: the CI unit job checks out with `
        + 'fetch-depth: 0');
    }
    t.skip(`no git history of ${CENSUS_REL} here`);
    return;
  }
  const now = debtOf(CENSUS()).length;
  const raised = debtRaised(now, history);
  assert.deepEqual(raised, [], `${P} the debt grew to ${now}; it may only shrink:\n  `
    + raised.map(([sha, was]) => `${was} at ${sha}`).join('\n  '));
});

test('mutation: debt above an earlier commit is refused, debt paid off is not', () => {
  const e = (deepLink, tests) => ({ deepLink, tests });
  const history = [
    { sha: 'lowered', census: { surfaces: [e('#m=a', ['x']), e(null, ['x']), e('#m=b', ['x'])] } },
    { sha: 'original', census: { surfaces: [e(null, []), e(null, ['x']), e('#m=b', [])] } },
  ];
  assert.deepEqual(debtRaised(1, history), [], 'equal to the newest record');
  assert.deepEqual(debtRaised(0, history), [], 'paid off');
  assert.deepEqual(debtRaised(2, history), [['lowered', 1]], 'above a later record');
  assert.deepEqual(debtRaised(4, history), [['lowered', 1], ['original', 3]], 'above both');
  const now = { surfaces: [e(null, ['x']), e('#m=c', [])] };
  assert.equal(debtOf(now).length, 2, 'a null deep link and an empty test list each count');
  assert.deepEqual(debtRaised(debtOf(now).length, history), [['lowered', 1]]);
});

test('names: a file names a surface by its id, data-osc with value, or address only', () => {
  const inv = deriveInventory(TREE());
  const names = (key, text) => {
    const s = inv.surfaces.get(key);
    return namesOf({ kind: s.kind, id: s.id }, s).some((p) => p(text));
  };
  assert.ok(names('workspace:filter', "await page.goto(`${base}#m=filter`)"));
  assert.ok(!names('workspace:filter', "type: 'filter'"), 'a quoted word alone is not a workspace');
  assert.ok(names('panel:osc-panel-device', "['source', 'device'].map((p) => `#osc-panel-${p}`)"));
  assert.ok(names('subview:analysis.tab:signalPath', "page.click(`#osc-atab-${'signalPath'}`)"));
  assert.ok(names('subview:mic.tab:compare',
    "click('[data-osc=\"mic.tab\"][data-value=\"compare\"]')"));
  assert.ok(!names('subview:mic.tab:compare', "'mic.tab' and 'spectrogram'"));
  assert.ok(names('subview:studio.subview:timeline', "goto('#m=studio&sv=timeline')"));
  assert.ok(names('dialog:osc-dlg-help', "document.getElementById('osc-dlg-help')"));
  assert.ok(!names('dialog:osc-dlg-help', "'#osc-dlg-help-renamed'"));
  assert.ok(names('route:measure', "goto(`#m=measure&mr=${RECIPE}`); 'measure'"));
});

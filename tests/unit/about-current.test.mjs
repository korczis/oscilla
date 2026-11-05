// U002 (intent ui-current, milestone M054; docs/ui-audit.md A14, A15, A16): About tells OSCILLA
// as it stands at the current release and what comes next, not the first night.
//
// - A14: the story's headline, the heading of the release-line section that follows the hero,
//   is not the first night. The night stays as one dated station of the timeline, the one that
//   carries the wall-clock qualifier (owner, 2026-10-28, overriding Q005's delegated decision).
// - A16: About lists every workspace of the navigation, by its navigation label and in its
//   navigation order, with what it is for, and nothing that is not a workspace.
// - A15: "What comes next" renders src/data/roadmap.json, the open milestones of the plan with
//   their progress, which scripts/roadmap.mjs writes from `majordomus plan roadmap --json` and
//   release:prepare refreshes before its build. The build reads src/, never .ai/, so a
//   plan-only commit leaves the roadmap and dist unchanged, and the page fetches nothing.
//   Whether the committed roadmap still matches the plan is judged when OSC_ROADMAP_CHECK=1,
//   which release:prepare sets for its gate: a pull request that completes a milestone does
//   not fail here, the next release refreshes the list.
// The workspace list, the story order and the headline are read from src/index.html.
//   node --test tests/unit/about-current.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { WORKSPACES } from '../../src/js/ui/app.js';
import { LEARN_CARDS } from '../../src/js/data/learn.js';
import SEMI_MONO from '../../src/js/synth/panels/semi-mono.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const html = read('src/index.html');

/** The About view's markup, from its root to the end of <main>. */
export function aboutView(markup) {
  const at = markup.indexOf('id="osc-view-about"');
  return at < 0 ? '' : markup.slice(at, markup.indexOf('</main>', at));
}

/** Visible text: comments and tags dropped, entities and typographic dashes plain. */
function text(markup) {
  return markup
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&(?:ndash|mdash);|[–—]/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The navigation's workspaces, in order: { id, label } of each data-osc="nav.<id>" link. */
export function navWorkspaces(markup) {
  const nav = markup.slice(markup.indexOf('id="osc-nav"'), markup.indexOf('</nav>'));
  return [...nav.matchAll(/<a\b[^>]*\bdata-osc="nav\.([a-z]+)"[^>]*>([^<]+)<\/a>/g)]
    .map(([, id, label]) => ({ id, label: label.trim() }));
}

/** The first night, in any of the words the old headline used. */
export const NIGHT = /\b(?:one|first) night\b|\b\d+ h \d+ min\b|\bwall-clock\b|\bthrowaway\b/i;
/** The qualifier the night keeps, in the station that dates it. */
export const QUALIFIER = /\b5 h 51 min of wall-clock time, with several AI workers in parallel\b/;

/**
 * The problems of About's opening, one string each: the headline (the first h3 after the hero)
 * is the first night, its section is not the release line up to the current station, the
 * night is not one dated station with its qualifier, or the workspaces and what comes next do
 * not come before the Origin.
 */
export function headlineProblems(view) {
  if (!view) return ['the About view is missing'];
  const problems = [];
  const hero = view.indexOf('</header>');
  const rest = hero < 0 ? '' : view.slice(hero);
  const head = rest.match(new RegExp('<section\\b[^>]*aria-labelledby="([^"]+)"[^>]*>[\\s\\S]*?'
    + '<h3\\b[^>]*\\bid="([^"]+)"[^>]*>([\\s\\S]*?)</h3>'));
  if (!head) return ['no headline section follows the hero'];
  const [whole, labelledBy, id, heading] = head;
  const headline = text(heading);
  if (labelledBy !== id) {
    problems.push(`the headline section is labelled by ${labelledBy}, not its h3 ${id}`);
  }
  if (NIGHT.test(headline)) problems.push(`About's headline is the first night: "${headline}"`);
  const section = rest.slice(rest.indexOf(whole), rest.indexOf('</section>', rest.indexOf(whole)));
  const list = section.slice(section.indexOf('osc-about-timeline'), section.indexOf('</ol>'));
  if (!list.includes('osc-about-timeline')) {
    problems.push('the headline section is not the release line (no timeline)');
  }
  const stations = [...list.matchAll(/<li data-state="([a-z]+)"[^>]*>([\s\S]*?)<\/li>/g)];
  if (!stations.length || stations.at(-1)[1] !== 'current') {
    problems.push('the release line does not end on the current station');
  }
  const outside = section.replace(list, '');
  if (NIGHT.test(text(outside))) {
    problems.push(`the night is stated outside a station: "${text(outside).match(NIGHT)[0]}"`);
  }
  const night = stations.filter(([, , body]) => QUALIFIER.test(text(body)));
  if (night.length !== 1) {
    problems.push(`${night.length} stations carry the night's wall-clock qualifier, not one`);
  } else if (!/<time\b[^>]*\bdatetime="\d{4}-\d{2}-\d{2}T/.test(night[0][2])) {
    problems.push('the station that carries the night is not dated');
  } else if (!/\bfirst night\b/.test(text(night[0][2]))) {
    problems.push('the station that carries the qualifier does not name the first night');
  }
  const at = (needle) => view.indexOf(needle);
  const origin = at('id="osc-about-origin"');
  for (const [what, needle] of [['the workspace list', 'data-osc="about.workspaces"'],
    ['What comes next', 'data-osc="about.next"']]) {
    if (at(needle) < 0) problems.push(`${what} is missing`);
    else if (origin >= 0 && at(needle) > origin) problems.push(`${what} comes after the Origin`);
    else if (hero >= 0 && at(needle) < hero + rest.indexOf('</ol>')) {
      problems.push(`${what} comes before the release line`);
    }
  }
  return problems;
}

/**
 * The problems of About's workspace list against the navigation, one string each: a workspace
 * of the navigation missing or out of order, a name that is not its navigation label, an entry
 * that says nothing of what it is for, or an entry that is no workspace.
 */
export function workspaceProblems(markup) {
  const view = aboutView(markup);
  const at = view.indexOf('data-osc="about.workspaces"');
  if (at < 0) return ['About has no workspace list (data-osc="about.workspaces")'];
  const list = view.slice(at, view.indexOf('</ul>', at));
  const items = [...list.matchAll(
    /<li\b[^>]*\bdata-osc="about\.workspace\.([a-z]+)"[^>]*>\s*<b>([^<]*)<\/b>([\s\S]*?)<\/li>/g)]
    .map(([, id, name, rest]) => ({ id, name: name.trim(), purpose: text(rest) }));
  const nav = navWorkspaces(markup);
  const problems = [];
  if (list.split('<li').length - 1 !== items.length) {
    problems.push('an entry of the workspace list is not '
      + '<li data-osc="about.workspace.<id>"><b>name</b> purpose');
  }
  for (const ws of nav) {
    const item = items.find((i) => i.id === ws.id);
    if (!item) {
      problems.push(`workspace ${ws.id} of the navigation is missing from About's workspace list`);
      continue;
    }
    if (item.name !== ws.label) {
      problems.push(`workspace ${ws.id} is named "${item.name}", `
        + `the navigation says "${ws.label}"`);
    }
    if (item.purpose.split(' ').length < 4) {
      problems.push(`workspace ${ws.id} does not say what it is for: "${item.purpose}"`);
    }
  }
  for (const item of items) {
    if (!nav.some((ws) => ws.id === item.id)) {
      problems.push(`About lists ${item.id}, which is not a workspace of the navigation`);
    }
  }
  const order = items.map((i) => i.id).filter((id) => nav.some((ws) => ws.id === id));
  const navOrder = nav.map((ws) => ws.id).filter((id) => order.includes(id));
  if (order.join() !== navOrder.join()) {
    problems.push(`the workspace list is not in navigation order: ${order.join(', ')}`);
  }
  return problems;
}

const view = aboutView(html);

test('A14: About opens on the release line to the current release, not on the first night', () => {
  assert.deepEqual(headlineProblems(view), []);
});

test('mutation: the first-night headline, a night outside its station and a late list fail', () => {
  const swap = (from, to) => {
    const v = view.replace(from, to);
    assert.notEqual(v, view, `${from} is in the view`);
    return headlineProblems(v);
  };
  const headline = view.match(/(<h3 class="osc-about-statement" id="[^"]+">)([\s\S]*?)(<\/h3>)/);
  assert.ok(headline, 'the headline is an osc-about-statement h3');
  const night = swap(headline[0], `${headline[1]}Built in one night.\n`
    + '  <span>Not built as a throwaway.</span>' + headline[3]);
  assert.ok(night.some((p) => p.startsWith('About\'s headline is the first night')),
    night.join('; '));
  assert.ok(night.some((p) => p.startsWith('the night is stated outside a station')),
    night.join('; '));
  const unqualified = swap(' of wall-clock time, with several AI workers in parallel', '');
  assert.ok(unqualified.includes('0 stations carry the night\'s wall-clock qualifier, not one'),
    unqualified.join('; '));
  assert.ok(view.indexOf('data-osc="about.workspaces"') > 0, 'the workspace list is in the view');
  const late = headlineProblems(`${view.replace('data-osc="about.workspaces"', 'data-osc="x"')}`
    + '<ul data-osc="about.workspaces"></ul>');
  assert.deepEqual(late, ['the workspace list comes after the Origin']);
  assert.deepEqual(headlineProblems(view.replace('data-osc="about.next"', 'data-osc="x"')),
    ['What comes next is missing']);
});

test('A16: About lists every workspace of the navigation with what it is for', () => {
  const nav = navWorkspaces(html);
  assert.deepEqual(nav.map((ws) => ws.id), WORKSPACES, 'the navigation lists every workspace');
  assert.deepEqual(workspaceProblems(html), []);
});

test('mutation: a missing, renamed, unexplained or foreign workspace entry is named', () => {
  const swap = (from, to) => {
    const v = html.replace(from, to);
    assert.notEqual(v, html, `${from} is in the shell`);
    return workspaceProblems(v);
  };
  const filter = html.match(/<li data-osc="about\.workspace\.filter">[\s\S]*?<\/li>\s*/);
  assert.ok(filter, 'Filter Lab is listed');
  assert.deepEqual(swap(filter[0], ''),
    ['workspace filter of the navigation is missing from About\'s workspace list']);
  assert.deepEqual(swap('<b>Filter Lab</b>', '<b>Filters</b>'),
    ['workspace filter is named "Filters", the navigation says "Filter Lab"']);
  assert.deepEqual(swap(filter[0], '<li data-osc="about.workspace.filter"><b>Filter Lab</b> '
    + 'Filters.</li>\n'), ['workspace filter does not say what it is for: "Filters."']);
  assert.deepEqual(swap(filter[0], `${filter[0]}<li data-osc="about.workspace.mixer"><b>Mixer`
    + '</b> A mixer for every channel.</li>\n'),
  ['About lists mixer, which is not a workspace of the navigation']);
  const studio = html.match(/<li data-osc="about\.workspace\.studio">[\s\S]*?<\/li>\s*/);
  assert.deepEqual(swap(studio[0], '').length, 1);
  const moved = html.replace(studio[0], '').replace(filter[0], `${studio[0]}${filter[0]}`);
  assert.ok(workspaceProblems(moved).some((p) => p.startsWith('the workspace list is not in')));
});

// ------------------------------------------------------------------------- A15: what comes next
const ROADMAP_REL = 'src/data/roadmap.json';

/** A plan as `majordomus plan roadmap --json` gives it, with the fields roadmap.mjs reads. */
function planFixture() {
  const m = (id, status, title, done, required) => ({ id, status, title,
    issues: { total: required, required, by_status: { DONE: done } } });
  return { schema: 1, milestones: [m('M001', 'DONE', 'Instrument core', 26, 26),
    m('M011', 'ACTIVE', 'Release engineering', 17, 18), m('M036', 'DONE', 'V3.2 audit', 0, 0),
    m('M047', 'BLOCKED', 'Measurement extensions', 0, 9), m('M099', 'CANCELLED', 'Dropped', 0, 2),
    m('M060', 'PLANNED', 'Signal lab', 0, 3), m('M005', 'ACTIVE', 'Specification tail', 4, 13)] };
}

test('A15: What comes next renders the committed roadmap, built in and never fetched', async () => {
  assert.ok(existsSync(new URL(ROADMAP_REL, root)), `${ROADMAP_REL} exists`);
  const roadmap = JSON.parse(read(ROADMAP_REL));
  const { roadmapShapeProblems } = await import('../../scripts/roadmap.mjs');
  assert.deepEqual(roadmapShapeProblems(roadmap), []);
  assert.ok(roadmap.milestones.length > 0, 'the plan has open milestones');
  const at = view.indexOf('data-osc="about.next"');
  assert.ok(at > 0, 'About has a What comes next list');
  const section = view.slice(at, view.indexOf('</section>', at));
  for (const phase of ['now', 'next', 'later']) {
    const from = section.indexOf(`data-osc="about.next.${phase}"`);
    assert.ok(from > 0, `What comes next has the ${phase} list`);
    const list = section.slice(from, section.indexOf('</ul>', from));
    assert.match(list, new RegExp(`<template x-for="m in ROADMAP\\.phase\\.${phase}`
      + '\\.milestones" :key="m\\.id">'));
    assert.match(list, /x-text="m\.title"/);
    assert.match(list, /m\.done/);
    assert.match(list, /m\.required/);
  }
  // later is folded behind its count, by a button that names the list it opens
  const later = section.slice(section.indexOf('data-osc="about.next.later-toggle"'));
  assert.match(later, /aria-controls="osc-about-next-later-list"/);
  assert.match(later, /:aria-expanded="aboutLaterOpen/);
  assert.match(later, /id="osc-about-next-later-list" x-show="aboutLaterOpen"/);
  const about = read('src/js/ui/about.js');
  assert.match(about,
    /^import ROADMAP_DATA from '\.\.\/\.\.\/data\/roadmap\.json' with \{ type: 'json' \};$/m,
    'the roadmap is bundled at build time from src/data/roadmap.json');
  assert.doesNotMatch(about, /\bfetch\s*\(|XMLHttpRequest|import\s*\(/,
    'nothing is loaded at run time');
  const { ROADMAP, aboutPart } = await import('../../src/js/ui/about.js');
  assert.deepEqual(JSON.parse(JSON.stringify(ROADMAP.milestones)), roadmap.milestones);
  assert.deepEqual(ROADMAP.phases.map((p) => p.id), ['now', 'next', 'later']);
  assert.deepEqual(ROADMAP.phases.flatMap((p) => p.milestones.map((m) => m.id)).sort(),
    roadmap.milestones.map((m) => m.id).sort(), 'every milestone is in exactly one phase');
  for (const p of ROADMAP.phases) {
    assert.equal(ROADMAP.phase[p.id], p);
    assert.deepEqual(p.milestones.map((m) => m.id),
      roadmap.milestones.filter((m) => m.phase === p.id).map((m) => m.id),
      `${p.id} keeps the plan order`);
  }
  assert.equal(aboutPart().aboutLaterOpen, false, 'later opens folded');
  assert.match(read('src/js/main.js'), /\baboutPart\(\)/,
    'the About part is composed into the app');
});

test('A15: the roadmap lists the open milestones, in the plan order, with progress', async () => {
  const { roadmapFromPlan, roadmapProblems } = await import('../../scripts/roadmap.mjs');
  const plan = planFixture();
  const roadmap = roadmapFromPlan(plan);
  assert.deepEqual(roadmap.milestones, [
    { id: 'M011', title: 'Release engineering', done: 17, required: 18, phase: 'now' },
    { id: 'M047', title: 'Measurement extensions', done: 0, required: 9, phase: 'later' },
    { id: 'M060', title: 'Signal lab', done: 0, required: 3, phase: 'next' },
    { id: 'M005', title: 'Specification tail', done: 4, required: 13, phase: 'now' },
  ]);
  assert.deepEqual(roadmapProblems(roadmap, plan), []);
  const less = { ...roadmap, milestones: roadmap.milestones.filter((m) => m.id !== 'M047') };
  assert.deepEqual(roadmapProblems(less, plan), ['the roadmap omits open milestone M047']);
  const done = { ...roadmap, milestones: [{ id: 'M001', title: 'Instrument core', done: 26,
    required: 26, phase: 'now' }, ...roadmap.milestones] };
  assert.deepEqual(roadmapProblems(done, plan),
    ['the roadmap lists M001, which the plan has DONE']);
  const stale = { ...roadmap, milestones: roadmap.milestones.map((m) => (m.id === 'M011'
    ? { ...m, done: 16 } : m)) };
  assert.deepEqual(roadmapProblems(stale, plan),
    ['M011: the roadmap says 16/18 done, the plan 17/18']);
  const renamed = { ...roadmap, milestones: roadmap.milestones.map((m) => (m.id === 'M005'
    ? { ...m, title: 'Spec' } : m)) };
  assert.deepEqual(roadmapProblems(renamed, plan),
    ['M005: the roadmap says "Spec", the plan "Specification tail"']);
  const reordered = { ...roadmap, milestones: [...roadmap.milestones].reverse() };
  assert.deepEqual(roadmapProblems(reordered, plan),
    ['the roadmap is not in the plan order: M005, M060, M047, M011']);
  const moved = { ...roadmap, milestones: roadmap.milestones.map((m) => (m.id === 'M047'
    ? { ...m, phase: 'next' } : m)) };
  assert.deepEqual(roadmapProblems(moved, plan),
    ['M047: the roadmap says next, the plan later (BLOCKED)']);
  const { roadmapShapeProblems } = await import('../../scripts/roadmap.mjs');
  assert.deepEqual(roadmapShapeProblems({ ...roadmap, milestones: [{ ...roadmap.milestones[0],
    phase: 'someday' }] }), ['milestone 1: phase someday is not a phase']);
  const unknown = { ...roadmap, milestones: [...roadmap.milestones, { id: 'M777', title: 'x',
    done: 0, required: 1, phase: 'next' }] };
  assert.deepEqual(roadmapProblems(unknown, plan),
    ['the roadmap lists M777, which the plan has not']);
});

test('A15: a plan-only commit leaves the roadmap and dist unchanged', async () => {
  const { listSourceInputs } = await import('../../scripts/release-metadata.mjs');
  const inputs = listSourceInputs();
  assert.ok(inputs.includes(ROADMAP_REL), 'the roadmap is a build input');
  assert.deepEqual(inputs.filter((p) => p.startsWith('.ai/')), [], 'the build reads no plan file');
  const roadmap = read(ROADMAP_REL);
  assert.doesNotMatch(roadmap, /\d{4}-\d{2}-\d{2}T|\b[0-9a-f]{40}\b/,
    'the roadmap carries no time or commit that would change without a milestone change');
});

test('A15: release:prepare refreshes the roadmap before its build and judges it', async () => {
  const prep = await import('../../scripts/release-prepare.mjs');
  const { ROADMAP_REL: rel } = await import('../../scripts/roadmap.mjs');
  assert.equal(rel, ROADMAP_REL);
  const cmds = prep.GATE_COMMANDS.map(([cmd, args]) => `${cmd} ${args.join(' ')}`);
  const refresh = cmds.indexOf('node scripts/roadmap.mjs');
  assert.ok(refresh >= 0, `release:prepare refreshes the roadmap: ${cmds.join('; ')}`);
  assert.ok(refresh < cmds.indexOf('npm run build'), 'before the build that bundles it');
  assert.ok(prep.RESTORE_PATHS.includes(ROADMAP_REL), 'a failed gate restores the roadmap');
  assert.equal(prep.gateEnv({ PATH: '/bin' }).OSC_ROADMAP_CHECK, '1',
    'the gate judges the committed roadmap against the plan');
});

test('A15: under release:prepare, the roadmap is the plan\'s open milestones', async (t) => {
  if (process.env.OSC_ROADMAP_CHECK !== '1') {
    t.skip('judged by release:prepare (OSC_ROADMAP_CHECK=1), not by every pull request');
    return;
  }
  const { planRoadmap, roadmapProblems } = await import('../../scripts/roadmap.mjs');
  assert.deepEqual(roadmapProblems(JSON.parse(read(ROADMAP_REL)), planRoadmap()), [],
    'refresh it: node scripts/roadmap.mjs');
});

// ------------------------------------------------- U085: a workspace says only what it shows
// Each panel a workspace description names, by one of the phrases below, must be on that
// workspace's screen at 1536x1024. A focus workspace (Analyzer, Synthesis, ...) shows the panels
// whose data-osc-modes lists it, and a full-width view (Measure, Learn, Synth, ...) is the
// section whose data-osc-modes lists it (src/styles/integration.css hides every other panel from
// 1280 px). The Playground is the integrated grid: from 1280 px it hides the Spectrogram panel
// and every row-3 panel but the sequencer and the compact Studio (src/styles/instrument.css),
// and keeps the workspace-only panels (.osc-workspace) out. "the labs" names those row-3 labs.
// Learn names its first and last card and Synth each of its tabs, from their data modules.

/** [what the description says, the ids of the panels it names]. */
export const PANEL_PHRASES = [
  [/\bgenerator\b/i, ['osc-panel-source']],
  [/\bsignal analysis\b/i, ['osc-panel-analysis']],
  [/\bspectrogram of the output\b|\bmicrophone's live spectrum and spectrogram\b/i,
    ['osc-panel-spectrogram']],
  [/\bmicrophone analy[sz]er\b/i, ['osc-panel-mic']],
  [/\bDevice & Limits\b/, ['osc-panel-device']],
  [/\bguided measurement\b/i, ['osc-measure-flow']],
  [/\bpattern sequencer\b|\bblock sequences\b/i, ['osc-panel-sequencer']],
  [/\bcompact Studio\b/, ['osc-panel-studio']],
  [/\bbiquad filter\b/i, ['osc-panel-filter']],
  [/\bADSR envelope\b/i, ['osc-panel-envelope']],
  [/\badditive harmonics\b/i, ['osc-panel-additive']],
  [/\bphase and stereo\b/i, ['osc-panel-phase']],
  [/\bbioacoustics\b/i, ['osc-panel-bio']],
  [/\bdual oscillator\b/i, ['osc-panel-dual']],
  [/\bthe labs\b/i, ['osc-panel-filter', 'osc-panel-envelope', 'osc-panel-additive',
    'osc-panel-phase', 'osc-panel-bio']],
];

/** What a phrase claims about where a panel's signal comes from, checked in its source. */
export const SOURCE_CLAIMS = [
  [/\bspectrogram of the output\b/i, 'src/js/charts/spectrogram-panel.js', /main output analyser/],
  [/\bmicrophone's live spectrum and spectrogram\b/i, 'src/js/charts/spectrogram-panel.js',
    /\bmicrophone\b/],
];

/** The opening tag of the element with `id`, and where it starts ('' and -1 when absent). */
function tagOf(markup, id) {
  const at = markup.indexOf(`id="${id}"`);
  if (at < 0) return { tag: '', at: -1 };
  const from = markup.lastIndexOf('<', at);
  return { tag: markup.slice(from, markup.indexOf('>', at) + 1), at: from };
}

const modesOf = (tag) => (tag.match(/\bdata-osc-modes="([^"]*)"/)?.[1] ?? '').split(/\s+/);

/** Whether the panel `id` is on `workspace`'s screen at 1536x1024 (see the note above). */
export function shownAt1536(markup, id, workspace) {
  const { tag, at } = tagOf(markup, id);
  if (at < 0) return false;
  if (workspace === 'playground') {
    const row3 = markup.indexOf('<div class="osc-row3"');
    const only = markup.indexOf('<div class="osc-workspace"');
    const views = markup.indexOf('id="osc-view-experiments"');
    if (at > only && at < views) return false;
    if (/\bosc-p-spectrogram\b/.test(tag)) return false;
    if (at > row3 && at < only) return /\bosc-p-(?:sequencer|studio)\b/.test(tag);
    if (modesOf(tag).includes('playground') || at < row3) return true;
    const view = markup.lastIndexOf('<section class="osc-view', at);
    return view >= 0 && /workspace !== 'playground'/.test(markup.slice(view, at));
  }
  if (tag.includes('data-osc-modes=')) return modesOf(tag).includes(workspace);
  const view = markup.lastIndexOf('<section class="osc-view', at);
  return view >= 0 && modesOf(markup.slice(view, markup.indexOf('>', view))).includes(workspace);
}

/** About's workspace descriptions: { id: purpose text }. */
function descriptions(markup) {
  const view = aboutView(markup);
  return Object.fromEntries([...view.matchAll(
    /<li\b[^>]*\bdata-osc="about\.workspace\.([a-z]+)"[^>]*>\s*<b>[^<]*<\/b>([\s\S]*?)<\/li>/g)]
    .map(([, id, rest]) => [id, text(rest)]));
}

/**
 * What About's workspace descriptions claim that the workspace does not show, one string each:
 * a named panel off that workspace's screen, a source claim its code does not make, Learn's
 * range not its first and last card, a Synth tab left out.
 */
export function workspaceTruthProblems(markup) {
  const problems = [];
  for (const [id, purpose] of Object.entries(descriptions(markup))) {
    for (const [phrase, panels] of PANEL_PHRASES) {
      const said = purpose.match(phrase)?.[0];
      if (!said) continue;
      for (const panel of panels) {
        if (!shownAt1536(markup, panel, id)) {
          problems.push(`${id} names "${said}", but #${panel} is not on its screen at 1536 px`);
        }
      }
    }
    for (const [phrase, file, claim] of SOURCE_CLAIMS) {
      const said = purpose.match(phrase)?.[0];
      if (said && !claim.test(read(file).split('\n').slice(0, 4).join('\n'))) {
        problems.push(`${id} says "${said}", which ${file} does not`);
      }
    }
  }
  const all = descriptions(markup);
  const [first, last] = [LEARN_CARDS[0].title, LEARN_CARDS.at(-1).title];
  if (!new RegExp(`\\bfrom ${first} to ${last}\\b`, 'i').test(all.learn ?? '')) {
    problems.push(`learn does not run from its first card to its last: "${first}" to "${last}"`);
  }
  const [voice, ...tabs] = SEMI_MONO.tabs;
  if (!new RegExp(`\\b${voice.title}\\b`, 'i').test(all.synth ?? '')) {
    problems.push(`synth does not name its ${voice.label} tab's voice: "${voice.title}"`);
  }
  for (const tab of tabs) {
    if (!(all.synth ?? '').includes(`${tab.label} tab`)) {
      problems.push(`synth does not name its ${tab.label} tab`);
    }
  }
  return problems;
}

test('U085: each workspace description names only what that workspace shows at 1536 px', () => {
  // the Playground model is the CSS's: pin the rule it reads
  const css = read('src/styles/instrument.css');
  assert.match(css, new RegExp('\\.osc-app\\[data-mode="playground"\\] :is\\(\\.osc-p-spectrogram,'
    + '\\s*\\.osc-row3 > \\.osc-panel:not\\(\\.osc-p-sequencer, \\.osc-p-studio\\)\\)'));
  assert.match(css, /\.osc-workspace \{\s*display: none;/);
  assert.deepEqual(workspaceTruthProblems(html), []);
});

test('mutation U085: a reverted phrase is named', () => {
  const ws = (id) => html.match(new RegExp(
    `<li data-osc="about\\.workspace\\.${id}">[\\s\\S]*?</li>`))[0];
  const swap = (id, to) => {
    const v = html.replace(ws(id), `<li data-osc="about.workspace.${id}"><b>X</b> ${to}</li>`);
    return workspaceTruthProblems(v);
  };
  assert.ok(swap('synthesis', 'Additive harmonics, with the compact Studio.')
    .includes('synthesis names "compact Studio", but #osc-panel-studio is not on its screen '
      + 'at 1536 px'));
  assert.ok(swap('playground', 'The instrument and the labs.').some((p) =>
    p.startsWith('playground names "the labs", but #osc-panel-filter')));
  assert.ok(swap('analyzer', 'The microphone\'s live spectrum and spectrogram.').includes(
    'analyzer says "microphone\'s live spectrum and spectrogram", which '
    + 'src/js/charts/spectrogram-panel.js does not'));
  assert.ok(swap('learn', 'Concept cards from frequency to speaker limitations.').some((p) =>
    p.startsWith('learn does not run from its first card to its last')));
  assert.ok(swap('synth', 'A semi-modular mono voice, and an Engines tab.')
    .includes('synth does not name its XY tab'));
});

// ------------------------------------------------- U086: the roadmap names its release
// scripts/roadmap.mjs writes package.json's version into the roadmap as `release` when
// release:prepare refreshes it (after the bump), and What comes next's heading reads
// "as of v<release>" from it. version:check allows the copy in this generated file; this test
// is what holds it to package.json.
test('U086: the roadmap names the release it describes, and the heading renders it', async () => {
  const { version } = JSON.parse(read('package.json'));
  const roadmap = JSON.parse(read(ROADMAP_REL));
  assert.equal(roadmap.release, version, 'the roadmap was written at this release: refresh it');
  assert.match(roadmap.release, /^\d+\.\d+\.\d+$/, 'the release is X.Y.Z');
  const { roadmapFromPlan, roadmapShapeProblems } = await import('../../scripts/roadmap.mjs');
  assert.equal(roadmapFromPlan(planFixture()).release, version, 'roadmap.mjs writes the version');
  assert.equal(roadmapFromPlan(planFixture(), '9.8.7').release, '9.8.7');
  assert.deepEqual(roadmapShapeProblems({ ...roadmap, release: undefined }),
    ['release undefined is not a version X.Y.Z']);
  const { ROADMAP } = await import('../../src/js/ui/about.js');
  assert.equal(ROADMAP.release, version);
  const at = view.indexOf('id="osc-about-next"');
  const heading = view.slice(at, view.indexOf('</h3>', at));
  assert.match(heading, /x-text="` · as of v\$\{ROADMAP\.release\}`"/,
    'the heading says "as of vX.Y.Z" from the roadmap');
  assert.doesNotMatch(text(view.slice(at, view.indexOf('<h4', at))), /\bthis release\b/,
    'the section names the release, not "this release"');
});

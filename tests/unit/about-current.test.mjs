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
    m('M005', 'ACTIVE', 'Specification tail', 4, 13)] };
}

test('A15: What comes next renders the committed roadmap, built in and never fetched', async () => {
  assert.ok(existsSync(new URL(ROADMAP_REL, root)), `${ROADMAP_REL} exists`);
  const roadmap = JSON.parse(read(ROADMAP_REL));
  const { roadmapShapeProblems } = await import('../../scripts/roadmap.mjs');
  assert.deepEqual(roadmapShapeProblems(roadmap), []);
  assert.ok(roadmap.milestones.length > 0, 'the plan has open milestones');
  const at = view.indexOf('data-osc="about.next"');
  assert.ok(at > 0, 'About has a What comes next list');
  const list = view.slice(at, view.indexOf('</ul>', at));
  assert.match(list, /<template x-for="m in ROADMAP\.milestones" :key="m\.id">/);
  assert.match(list, /x-text="m\.title"/);
  assert.match(list, /m\.done/);
  assert.match(list, /m\.required/);
  const about = read('src/js/ui/about.js');
  assert.match(about,
    /^import ROADMAP_DATA from '\.\.\/\.\.\/data\/roadmap\.json' with \{ type: 'json' \};$/m,
    'the roadmap is bundled at build time from src/data/roadmap.json');
  assert.doesNotMatch(about, /\bfetch\s*\(|XMLHttpRequest|import\s*\(/,
    'nothing is loaded at run time');
  const { ROADMAP } = await import('../../src/js/ui/about.js');
  assert.deepEqual(JSON.parse(JSON.stringify(ROADMAP.milestones)), roadmap.milestones);
  assert.match(read('src/js/main.js'), /\baboutPart\(\)/,
    'the About part is composed into the app');
});

test('A15: the roadmap lists the open milestones, in the plan order, with progress', async () => {
  const { roadmapFromPlan, roadmapProblems } = await import('../../scripts/roadmap.mjs');
  const plan = planFixture();
  const roadmap = roadmapFromPlan(plan);
  assert.deepEqual(roadmap.milestones, [
    { id: 'M011', title: 'Release engineering', done: 17, required: 18 },
    { id: 'M047', title: 'Measurement extensions', done: 0, required: 9 },
    { id: 'M005', title: 'Specification tail', done: 4, required: 13 },
  ]);
  assert.deepEqual(roadmapProblems(roadmap, plan), []);
  const less = { ...roadmap, milestones: roadmap.milestones.filter((m) => m.id !== 'M047') };
  assert.deepEqual(roadmapProblems(less, plan), ['the roadmap omits open milestone M047']);
  const done = { ...roadmap, milestones: [{ id: 'M001', title: 'Instrument core', done: 26,
    required: 26 }, ...roadmap.milestones] };
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
    ['the roadmap is not in the plan order: M005, M047, M011']);
  const unknown = { ...roadmap, milestones: [...roadmap.milestones, { id: 'M777', title: 'x',
    done: 0, required: 1 }] };
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

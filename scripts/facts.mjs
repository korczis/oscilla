// The ONE derivation module of the README and the /lab/ landing (plan P014, owner decision
// Q107): it reads the repository and returns plain facts, every group stamped with the file or
// command it was read from. scripts/readme.mjs renders README.md's derived regions from it and
// scripts/landing.mjs the landing and its charts; neither keeps a list of its own, so a
// workspace, template, engine, claim or release added to its registry reaches both at once.
//
// Deterministic for a given commit: nothing reads the clock, every list is sorted or kept in
// its registry's order, and the git activity window ends at HEAD's commit date, not today. The
// result is JSON-serialisable (no class instances, no undefined). The git groups read only the
// v* tags reachable from HEAD (plan P015): a tag on a newer commit cannot change the facts of
// an older one, and a release tag set on HEAD or an ancestor is picked up by the Pages redeploy
// that release:publish dispatches after tagging (the same moment the stamp's release state
// changes, ADR 0059).
//
//   collectFacts({ root, git }) -> {
//     schema: 'oscilla-facts/v1', appUrl,
//     workspaces:  { source, items: [{ id, label, group, groupLabel, summary, deepLink,
//                                      related: [{ id, why, hash, deepLink }] }] },
//     templates:   { source, items: [{ id, label, category, summary, deepLink }] },
//     engines:     { source, items: [{ id, label }], blocked: [{ id, label }] },
//     claims:      { source, total, byStatus: { <status>: n }, areaRule,
//                    byArea: { <area>: n }, items: [{ id, claim, status, source,
//                    implementation, test, area }] },
//     releases:    { source, items: [{ version, tag, published_at, size, sha256 }] },
//     plan:        { source, byStatus, items: [{ id, title, order, status, done, total }] },
//     roadmap:     { source, dirs: { intents, milestones, issues }, order,
//                    items: [{ id, title, done, total, milestones: [{ id, title, order,
//                    status, done, total }] }], unassigned: [<milestone>] },
//     adrs:        { source, fields, total, byStatus: { <status>: n }, items: [{ id, number, title,
//                    status, date, path }] },
//     tests:       { source, unit, browser },
//     dist:        { source, bytes, gzip },
//     screenshots: { source, items: [{ path, workspace, view, theme, viewport, width, height,
//                                      caption, alt }] },
//     git:         { source, commits, firstCommit, head, headDate,
//                    weeks: [{ week, start, commits }] }      only when git: true
//     releaseChanges: { source, issueSource, types, items: [{ version, tag, from,
//                    published_at, recorded, commits, byType, planIds, prs,
//                    groups: [{ type, commits: [{ sha,
//                    subject, type, scope, breaking, conventional, date, planIds, prs }] }] }],
//                    unreleased: <the same, for lastTag..HEAD> | null }   only when git: true
//     codeInventory: { source, modules: [{ module, files, bytes }], perRelease: [{ version,
//                    tag, unit, browser, srcFiles, srcBytes, distBytes }] }  only when git: true
//   }

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parseClaims, unquote } from '../tests/unit/claims-parse.mjs';
import { parseYaml } from './yaml-subset.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP_URL = 'https://korczis.github.io/oscilla/';
/** Where the Pages deploy publishes the charts (scripts/landing.mjs renders them). */
export const CHART_BASE = 'https://korczis.github.io/oscilla/lab/charts/';
export const CHARTS = Object.freeze(['releases', 'size', 'plan', 'claims', 'activity',
  'modules', 'growth']);
/** How many ISO weeks the activity series covers, ending at HEAD's week. */
export const ACTIVITY_WEEKS = 26;

const SOURCES = Object.freeze({
  workspaces: 'src/js/ui/shell.js',
  templates: 'src/js/studio/templates/index.js',
  engines: 'src/js/synth/panels/engines.js',
  claims: 'docs/CLAIMS.yaml',
  releases: '.ai/repo/releases',
  plan: '.ai/repo/project/milestones',
  issues: '.ai/repo/project/issues',
  intents: '.ai/repo/project/intents',
  adrs: '.ai/repo/adrs',
  unit: 'tests/unit',
  browser: 'tests/browser',
  dist: 'dist/index.html',
  visual: 'tests/visual',
});

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function countBy(items, key) {
  const out = {};
  for (const item of items) out[item[key]] = (out[item[key]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => byString(a, b)));
}

// The registries are imported from `root`, not from this module's own tree, so a test (or
// the landing build of another checkout) reads the registries of the tree it names.
async function importFrom(root, rel) {
  return import(pathToFileURL(path.join(root, rel)).href);
}

function yamlFiles(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort() : [];
}

export function deepLink(id, hash = '') {
  return `${APP_URL}#m=${id}${hash}`;
}

async function workspaces(root) {
  const { WORKSPACE_REGISTRY, GROUP_REGISTRY } = await importFrom(root, SOURCES.workspaces);
  return {
    source: SOURCES.workspaces,
    items: WORKSPACE_REGISTRY.map((w) => ({
      id: w.id,
      label: w.label,
      group: w.group ?? null,
      groupLabel: w.group ? GROUP_REGISTRY[w.group]?.label ?? w.group : null,
      summary: w.summary ?? '',
      deepLink: deepLink(w.id),
      related: (w.related ?? []).map((r) => ({ id: r.id, why: r.why, hash: r.hash ?? '',
        deepLink: deepLink(r.id, r.hash ?? '') })),
    })),
  };
}

async function templates(root) {
  const { listTemplates } = await importFrom(root, SOURCES.templates);
  return {
    source: SOURCES.templates,
    items: listTemplates().map((t) => ({ id: t.id, label: t.title, category: t.category,
      summary: t.learn?.summary ?? '', deepLink: deepLink('studio', `&st=${t.id}`) })),
  };
}

async function engines(root) {
  const { ENGINE_MODULES, ENGINE_BLOCKED } = await importFrom(root, SOURCES.engines);
  return {
    source: SOURCES.engines,
    items: ENGINE_MODULES.map((e) => ({ id: e.id, label: e.label })),
    blocked: ENGINE_BLOCKED.map((e) => ({ id: e.id, label: e.label })),
  };
}

/** How a claim's area is derived from its implementation path (claims.areaRule). */
export const CLAIM_AREA_RULE = 'src/js/<area>/... -> <area>; src/js/<file> -> app; '
  + 'src/data/ -> data; src/index.html and src/styles/ -> ui; scripts/ -> tooling; '
  + '"-" -> none';

/** The area of a claim, from the path of its implementation (CLAIM_AREA_RULE). */
export function claimArea(implementation) {
  const p = String(implementation ?? '-').trim();
  if (!p || p === '-') return 'none';
  const js = /^src\/js\/([^/]+)(\/)?/.exec(p);
  if (js) return js[2] ? js[1] : 'app';
  if (p.startsWith('src/data/')) return 'data';
  if (p === 'src/index.html' || p.startsWith('src/styles/')) return 'ui';
  if (p.startsWith('scripts/')) return 'tooling';
  return p.split('/')[0];
}

// The ledger is line-oriented YAML that the strict subset parser refuses (plain values hold
// ': '), so it is read by the one reader its own tests use, not by a second one.
export function claims(root) {
  const text = readFileSync(path.join(root, SOURCES.claims), 'utf8');
  const items = parseClaims(text).map((c) => ({ id: c.id, claim: c.claim, status: c.status,
    source: c.source ?? '-', implementation: c.implementation ?? '-', test: c.test ?? '-',
    area: claimArea(c.implementation) }));
  return { source: SOURCES.claims, total: items.length, byStatus: countBy(items, 'status'),
    areaRule: CLAIM_AREA_RULE, byArea: countBy(items, 'area'), items };
}

function semverKey(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v);
  if (!m) throw new Error(`facts: release version ${v} is not SemVer`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? null];
}

export function compareSemver(a, b) {
  const [ka, kb] = [semverKey(a), semverKey(b)];
  for (let i = 0; i < 3; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  // a pre-release sorts before its release (SemVer 11.3)
  if (ka[3] === kb[3]) return 0;
  if (ka[3] === null) return 1;
  if (kb[3] === null) return -1;
  return byString(ka[3], kb[3]);
}

function releases(root) {
  const dir = path.join(root, SOURCES.releases);
  const items = yamlFiles(dir).map((f) => {
    const r = parseYaml(readFileSync(path.join(dir, f), 'utf8'));
    const web = (r.artifacts ?? []).find((a) => a.target === 'web') ?? {};
    return { version: String(r.version), tag: r.tag, published_at: r.published_at ?? null,
      size: web.size ?? null, sha256: web.sha256 ?? null };
  });
  items.sort((a, b) => compareSemver(a.version, b.version));
  return { source: SOURCES.releases, items };
}

// The status `majordomus plan status` derives, read from the files alone (no executable, so
// CI and the Pages deploy compute the same): an issue is DONE when `majordomus plan done`
// stamped completed_at, CANCELLED when cancelled: true. A milestone is DONE when every issue
// it still requires is done, ACTIVE when some are, OPEN when none are (majordomus splits OPEN
// into PLANNED and BLOCKED by the dependency graph, which the charts do not need).
export function plan(root) {
  const counts = {};
  const issueDir = path.join(root, SOURCES.issues);
  for (const f of yamlFiles(issueDir)) {
    const issue = parseYaml(readFileSync(path.join(issueDir, f), 'utf8'));
    const c = (counts[issue.milestone] ??= { total: 0, done: 0, cancelled: 0 });
    c.total += 1;
    if (issue.cancelled === true) c.cancelled += 1;
    else if (issue.completed_at) c.done += 1;
  }
  const dir = path.join(root, SOURCES.plan);
  const items = yamlFiles(dir).map((f) => {
    const m = parseYaml(readFileSync(path.join(dir, f), 'utf8'));
    const c = counts[m.id] ?? { total: 0, done: 0, cancelled: 0 };
    const total = c.total - c.cancelled;
    const status = c.done === total && (total > 0 || c.cancelled > 0) ? 'DONE'
      : c.done > 0 ? 'ACTIVE' : 'OPEN';
    return { id: m.id, title: m.title, order: Number.isFinite(m.order) ? m.order : null,
      status, done: c.done, total };
  });
  items.sort((a, b) => byString(a.id, b.id));
  return { source: `${SOURCES.plan} + ${SOURCES.issues}`, byStatus: countBy(items, 'status'),
    items };
}

// Only single-line fields of the front matter (id, title, status, date): an ADR's other
// fields are free text that need not fit the strict subset parser.
function frontMatter(text) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  const out = {};
  if (!fm) return out;
  for (const key of ['id', 'title', 'status', 'date']) {
    const m = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(fm[1]);
    if (m) out[key] = unquote(m[1]);
  }
  return out;
}

export function adrs(root) {
  const dir = path.join(root, SOURCES.adrs);
  const items = readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort().map((f) => {
    const fm = frontMatter(readFileSync(path.join(dir, f), 'utf8'));
    const status = /^[a-z-]+$/.test(fm.status ?? '') ? fm.status : 'unknown';
    return { id: fm.id ?? `adr-${f.slice(0, 4)}`, number: Number(f.slice(0, 4)),
      title: fm.title ?? f.replace(/^\d{4}-|\.md$/g, ''), status,
      date: /^\d{4}-\d{2}-\d{2}$/.test(fm.date ?? '') ? fm.date : null,
      path: `${SOURCES.adrs}/${f}` };
  });
  return { source: SOURCES.adrs, fields: 'NNNN-*.md front matter: id, title, status, date',
    total: items.length, byStatus: countBy(items, 'status'), items };
}

// The roadmap from the files alone (no `majordomus plan roadmap` at deploy): each intent of
// .ai/repo/project/intents with the milestones it lists, each with the done/total and status
// plan() derives; milestones ordered by their `order` field, then id; intents by the smallest
// order among their milestones, then id. A milestone no intent lists is `unassigned`.
const byOrder = (a, b) => ((a.order ?? Infinity) - (b.order ?? Infinity))
  || byString(a.id, b.id);

export function roadmap(root, planFacts = plan(root)) {
  const ms = new Map(planFacts.items.map((m) => [m.id, m]));
  const listed = new Set();
  const dir = path.join(root, SOURCES.intents);
  const items = yamlFiles(dir).map((f) => {
    const intent = parseYaml(readFileSync(path.join(dir, f), 'utf8'));
    const milestones = (intent.milestones ?? []).map(String).filter((id) => ms.has(id))
      .map((id) => { listed.add(id); return ms.get(id); }).sort(byOrder);
    return { id: intent.id, title: intent.title,
      order: milestones.length ? milestones[0].order : null,
      done: milestones.reduce((n, m) => n + m.done, 0),
      total: milestones.reduce((n, m) => n + m.total, 0), milestones };
  }).sort(byOrder).map(({ order, ...rest }) => rest);
  const unassigned = planFacts.items.filter((m) => !listed.has(m.id)).sort(byOrder);
  return { source: `${SOURCES.intents} + ${planFacts.source}`,
    dirs: { intents: SOURCES.intents, milestones: SOURCES.plan, issues: SOURCES.issues },
    order: 'milestones by their order field, then id; intents by their first milestone',
    items, unassigned };
}

function tests(root) {
  const unit = readdirSync(path.join(root, SOURCES.unit)).filter((f) => f.endsWith('.test.mjs'));
  const browser = readdirSync(path.join(root, SOURCES.browser)).filter((f) => f.endsWith('.cjs'));
  return { source: `${SOURCES.unit}/*.test.mjs + ${SOURCES.browser}/*.cjs`,
    unit: unit.length, browser: browser.length };
}

function dist(root) {
  const bytes = readFileSync(path.join(root, SOURCES.dist));
  return { source: SOURCES.dist, bytes: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length };
}

function pngSize(file) {
  const b = readFileSync(file);
  // the IHDR chunk follows the 8-byte signature: length, type, then width and height
  if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return { width: 0, height: 0 };
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const WORKSPACE_OF_DIR = Object.freeze({ measure: 'Measure', studio: 'Studio', synth: 'Synth' });
const VIEWPORTS = new Set(['desktop', 'phone', 'compact']);
const THEMES = new Set(['dark', 'light']);
const VIEW_WORDS = Object.freeze({ timeline: 'timeline', bay: 'patch bay', engines: 'Engines tab',
  panel: 'panel', xy: 'XY tab' });

/** `linux-x64-desktop-bay-dark.png` -> { viewport, view, theme }. */
export function parseReferenceName(name) {
  const parts = name.replace(/^linux-x64-/, '').replace(/\.png$/, '').split('-');
  const viewport = VIEWPORTS.has(parts[0]) ? parts.shift() : null;
  const theme = THEMES.has(parts[parts.length - 1]) ? parts.pop() : null;
  return { viewport, view: parts.length ? parts.join('-') : null, theme };
}

/** The short caption a gallery prints under the image. */
function screenshotCaption(workspace, { viewport, view, theme }) {
  return [workspace, viewport === 'compact' ? 'compact layout' : null,
    view ? VIEW_WORDS[view] ?? view : null, theme ? `${theme} theme` : null]
    .filter(Boolean).join(', ');
}

function screenshotAlt(workspace, { viewport, view, theme }) {
  const what = view ? `${workspace}, ${VIEW_WORDS[view] ?? view}` : workspace;
  const on = viewport === 'phone' ? 'on a phone' : viewport === 'compact'
    ? 'in the compact layout' : 'on a desktop';
  return `${what} ${on}${theme ? `, ${theme} theme` : ''}: the visual-gate reference of the `
    + 'built app';
}

// Only the committed references the visual gate compares against: the Playground's
// reference.png and the linux-x64 ones (the CI environment), never a local capture.
function screenshots(root) {
  const items = [];
  const playground = path.join(SOURCES.visual, 'reference.png');
  if (existsSync(path.join(root, playground))) {
    const meta = { viewport: 'desktop', view: null, theme: null };
    items.push({ path: playground, workspace: 'Playground', ...meta,
      ...pngSize(path.join(root, playground)), caption: screenshotCaption('Playground', meta),
      alt: screenshotAlt('Playground', meta) });
  }
  for (const dir of Object.keys(WORKSPACE_OF_DIR).sort()) {
    const abs = path.join(root, SOURCES.visual, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).filter((n) => /^linux-x64-.*\.png$/.test(n)).sort()) {
      const rel = `${SOURCES.visual}/${dir}/${f}`;
      const meta = parseReferenceName(f);
      const workspace = WORKSPACE_OF_DIR[dir];
      items.push({ path: rel, workspace, ...meta, ...pngSize(path.join(root, rel)),
        caption: screenshotCaption(workspace, meta), alt: screenshotAlt(workspace, meta) });
    }
  }
  // desktop before the compact layout before a phone, the whole view before its tabs
  const rank = { desktop: 0, compact: 1, phone: 2 };
  const order = (x) => [Object.values(WORKSPACE_OF_DIR).indexOf(x.workspace), rank[x.viewport] ?? 3,
    x.view ?? '', x.theme ?? ''];
  items.sort((a, b) => {
    const [ka, kb] = [order(a), order(b)];
    for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  });
  return { source: `${SOURCES.visual}/reference.png + ${SOURCES.visual}/*/linux-x64-*.png`,
    items };
}

const DAY_MS = 86400000;

/** The ISO 8601 week of a UTC date: { week: 'YYYY-Www', start: Monday 'YYYY-MM-DD' }. */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Monday 0
  const monday = new Date(d.getTime() - dow * DAY_MS);
  const thursday = new Date(monday.getTime() + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1 = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY_MS);
  const n = Math.round((monday - week1) / (7 * DAY_MS)) + 1;
  return { week: `${year}-W${String(n).padStart(2, '0')}`,
    start: monday.toISOString().slice(0, 10) };
}

/** Commits per ISO week (UTC), the `weeks` weeks ending at the week of the newest date. */
export function weeklyActivity(dates, weeks = ACTIVITY_WEEKS) {
  if (!dates.length) return [];
  const newest = dates.reduce((a, b) => (a > b ? a : b));
  const last = isoWeek(newest);
  const series = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = new Date(Date.parse(`${last.start}T00:00:00Z`) - i * 7 * DAY_MS);
    series.push({ ...isoWeek(start), commits: 0 });
  }
  const index = new Map(series.map((w, i) => [w.week, i]));
  for (const d of dates) {
    const i = index.get(isoWeek(d).week);
    if (i !== undefined) series[i].commits += 1;
  }
  return series;
}

function gitFacts(root) {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024 }).trim();
  const lines = run(['log', '--format=%H %cI', 'HEAD']).split('\n').filter(Boolean);
  const dates = lines.map((l) => new Date(l.split(' ')[1]));
  const [head, headDate] = lines[0].split(' ');
  const first = lines[lines.length - 1].split(' ')[1];
  return { source: 'git log --format="%H %cI" HEAD', commits: lines.length,
    firstCommit: new Date(first).toISOString(), head,
    headDate: new Date(headDate).toISOString(), weeks: weeklyActivity(dates) };
}

// ------------------------------------------------------------------- releases from git
/** The Conventional Commit types in the order a changelog lists them; others follow by name. */
export const COMMIT_TYPES = Object.freeze(['feat', 'fix', 'perf', 'refactor', 'revert', 'docs',
  'test', 'build', 'ci', 'style', 'chore', 'review', 'merge', 'other']);
const CONVENTIONAL = /^([a-z]+)(?:\(([^()]*)\))?(!)?: (.+)$/;
export const PLAN_ID = /\b[A-Z]\d{3}\b/g;
const PR_REF = /#(\d+)\b/g;

/**
 * A commit subject as a Conventional Commit: { type, scope, breaking, conventional, text }.
 * A subject that is not one is `merge` when the commit has two or more parents (git's own
 * "Merge branch ..."), else `other`.
 */
export function parseCommitSubject(subject, parents = 1) {
  const m = CONVENTIONAL.exec(subject);
  if (m) {
    return { type: m[1], scope: m[2] ?? null, breaking: m[3] === '!', conventional: true,
      text: m[4] };
  }
  return { type: parents > 1 ? 'merge' : 'other', scope: null, breaking: false,
    conventional: false, text: subject };
}

/** The plan ids a subject names (its scope included) that exist in `known`, sorted, once. */
export function planIdsIn(subject, known) {
  return [...new Set([...subject.matchAll(PLAN_ID)].map((x) => x[0]))]
    .filter((id) => known.has(id)).sort(byString);
}

/** The pull request numbers a subject names (#123), ascending, once. */
export function prsIn(subject) {
  return [...new Set([...subject.matchAll(PR_REF)].map((x) => Number(x[1])))]
    .sort((a, b) => a - b);
}

const typeRank = (t) => {
  const i = COMMIT_TYPES.indexOf(t);
  return i < 0 ? COMMIT_TYPES.length - 1 : i; // an unknown type sits before `other`
};
const byType = (a, b) => (typeRank(a) - typeRank(b)) || byString(a, b);

function gitRunner(root) {
  return (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The ids of the plan's issues (the file names under .ai/repo/project/issues). */
export function issueIds(root) {
  return new Set(yamlFiles(path.join(root, SOURCES.issues)).map((f) => f.replace(/\.yaml$/, '')));
}

/** The v* tags reachable from HEAD whose name is SemVer, in SemVer order. */
export function releaseTags(root) {
  const out = gitRunner(root)(['tag', '--merged', 'HEAD', '--list', 'v*']);
  return out.split('\n').map((t) => t.trim()).filter((t) => /^v\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(t))
    .sort((a, b) => compareSemver(a.slice(1), b.slice(1)));
}

const LOG_FORMAT = '--format=%H%x1f%P%x1f%s%x1f%cI%x1e';

/** The commits of a range, each once, newest first (commit date, then sha), parsed. */
export function commitsOf(root, range, known) {
  const out = gitRunner(root)(['log', LOG_FORMAT, range]);
  const commits = out.split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
    const [sha, parents, subject, date] = r.split('\x1f');
    const parsed = parseCommitSubject(subject, parents.trim() ? parents.trim().split(' ').length
      : 0);
    return { sha, subject, type: parsed.type, scope: parsed.scope, breaking: parsed.breaking,
      conventional: parsed.conventional, date: new Date(date.trim()).toISOString(),
      planIds: planIdsIn(subject, known), prs: prsIn(subject) };
  });
  commits.sort((a, b) => byString(b.date, a.date) || byString(a.sha, b.sha));
  return commits;
}

function changeSet(commits) {
  const groups = new Map();
  for (const c of commits) {
    if (!groups.has(c.type)) groups.set(c.type, []);
    groups.get(c.type).push(c);
  }
  const types = [...groups.keys()].sort(byType);
  return {
    commits: commits.length,
    byType: Object.fromEntries(types.map((t) => [t, groups.get(t).length])),
    planIds: [...new Set(commits.flatMap((c) => c.planIds))].sort(byString),
    prs: [...new Set(commits.flatMap((c) => c.prs))].sort((a, b) => a - b),
    groups: types.map((type) => ({ type, commits: groups.get(type) })),
  };
}

/**
 * Per release tag reachable from HEAD (SemVer order, as the release records sort), the
 * commits of `prev..tag` (the first tag: every commit up to it), grouped by Conventional
 * Commit type; `unreleased` is lastTag..HEAD, or null when HEAD is the last tag.
 */
export function releaseChanges(root, { releases: recs = [], known = issueIds(root),
  tags = releaseTags(root) } = {}) {
  const record = new Map(recs.map((r) => [r.tag, r]));
  const items = tags.map((tag, i) => {
    const from = i ? tags[i - 1] : null;
    const r = record.get(tag);
    return { version: tag.slice(1), tag, from, published_at: r?.published_at ?? null,
      recorded: Boolean(r), ...changeSet(commitsOf(root, from ? `${from}..${tag}` : tag, known)) };
  });
  let unreleased = null;
  if (tags.length) {
    const last = tags[tags.length - 1];
    const commits = commitsOf(root, `${last}..HEAD`, known);
    if (commits.length) unreleased = { from: last, ...changeSet(commits) };
  }
  const types = [...new Set(items.flatMap((x) => Object.keys(x.byType))
    .concat(unreleased ? Object.keys(unreleased.byType) : []))].sort(byType);
  return { source: `git tag --merged HEAD 'v*' (SemVer order) + git log ${LOG_FORMAT.replace(
    '%x1e', '')} <prev>..<tag>; plan ids /\\b[A-Z]\\d{3}\\b/ that exist under ${SOURCES.issues}`,
  issueSource: SOURCES.issues, types, items, unreleased };
}

// ------------------------------------------------------------------- code inventory from git
const UNIT_FILE = /^tests\/unit\/[^/]+\.test\.mjs$/;
const BROWSER_FILE = /^tests\/browser\/[^/]+\.cjs$/;
export const ROOT_MODULE = '(root)';

/** `git ls-tree -r --long <ref> -- <paths>` as [{ path, bytes }]. */
export function lsTree(root, ref, paths) {
  const out = gitRunner(root)(['ls-tree', '-r', '--long', '-z', ref, '--', ...paths]);
  return out.split('\0').filter(Boolean).map((l) => {
    const tab = l.indexOf('\t');
    const meta = l.slice(0, tab).split(/\s+/);
    return { type: meta[1], path: l.slice(tab + 1), bytes: Number(meta[3]) || 0 };
  }).filter((e) => e.type === 'blob');
}

/** Bytes and files per top-level module of src/js; files directly in src/js are (root). */
export function moduleSizes(entries) {
  const by = new Map();
  for (const e of entries) {
    if (!e.path.startsWith('src/js/')) continue;
    const rest = e.path.slice('src/js/'.length);
    const name = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : ROOT_MODULE;
    const cur = by.get(name) ?? { module: name, files: 0, bytes: 0 };
    cur.files += 1;
    cur.bytes += e.bytes;
    by.set(name, cur);
  }
  return [...by.values()].sort((a, b) => (b.bytes - a.bytes) || byString(a.module, b.module));
}

/** What a tree holds of tests and code: unit and browser test files, src/js, dist. */
export function treeInventory(entries) {
  const src = entries.filter((e) => e.path.startsWith('src/js/'));
  const dist = entries.find((e) => e.path === 'dist/index.html');
  return { unit: entries.filter((e) => UNIT_FILE.test(e.path)).length,
    browser: entries.filter((e) => BROWSER_FILE.test(e.path)).length,
    srcFiles: src.length, srcBytes: src.reduce((n, e) => n + e.bytes, 0),
    distBytes: dist ? dist.bytes : null };
}

const INVENTORY_PATHS = ['src/js', 'tests/unit', 'tests/browser', 'dist/index.html'];

export function codeInventory(root, tags = releaseTags(root)) {
  return {
    source: `git ls-tree -r --long <ref> -- ${INVENTORY_PATHS.join(' ')} (HEAD for modules, `
      + 'each v* tag reachable from HEAD for perRelease; unit = tests/unit/*.test.mjs, browser = '
      + 'tests/browser/*.cjs, distBytes = the committed, unstamped dist/index.html)',
    modules: moduleSizes(lsTree(root, 'HEAD', ['src/js'])),
    perRelease: tags.map((tag) => ({ version: tag.slice(1), tag,
      ...treeInventory(lsTree(root, tag, INVENTORY_PATHS)) })),
  };
}

export async function collectFacts({ root = REPO_ROOT, git = true } = {}) {
  const facts = {
    schema: 'oscilla-facts/v1',
    appUrl: APP_URL,
    workspaces: await workspaces(root),
    templates: await templates(root),
    engines: await engines(root),
    claims: claims(root),
    releases: releases(root),
    plan: plan(root),
    adrs: adrs(root),
    tests: tests(root),
    dist: dist(root),
    screenshots: screenshots(root),
  };
  facts.roadmap = roadmap(root, facts.plan);
  if (git) {
    facts.git = gitFacts(root);
    const tags = releaseTags(root);
    facts.releaseChanges = releaseChanges(root, { releases: facts.releases.items, tags });
    facts.codeInventory = codeInventory(root, tags);
  }
  return facts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const facts = await collectFacts({ git: !process.argv.includes('--no-git') });
  process.stdout.write(`${JSON.stringify(facts, null, 2)}\n`);
}

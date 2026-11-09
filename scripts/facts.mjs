// The ONE derivation module of the README and the /lab/ landing (plan P014, owner decision
// Q107): it reads the repository and returns plain facts, every group stamped with the file or
// command it was read from. scripts/readme.mjs renders README.md's derived regions from it and
// scripts/landing.mjs the landing and its charts; neither keeps a list of its own, so a
// workspace, template, engine, claim or release added to its registry reaches both at once.
//
// Deterministic for a given commit: nothing reads the clock, every list is sorted or kept in
// its registry's order, and the git activity window ends at HEAD's commit date, not today. The
// result is JSON-serialisable (no class instances, no undefined).
//
//   collectFacts({ root, git }) -> {
//     schema: 'oscilla-facts/v1', appUrl,
//     workspaces:  { source, items: [{ id, label, group, groupLabel, summary, deepLink,
//                                      related: [{ id, why, hash, deepLink }] }] },
//     templates:   { source, items: [{ id, label, category, summary, deepLink }] },
//     engines:     { source, items: [{ id, label }], blocked: [{ id, label }] },
//     claims:      { source, total, byStatus: { <status>: n }, items: [{ id, claim, status }] },
//     releases:    { source, items: [{ version, tag, published_at, size, sha256 }] },
//     plan:        { source, byStatus, items: [{ id, title, status, done, total }] },
//     adrs:        { source, total, byStatus: { <status>: n } },
//     tests:       { source, unit, browser },
//     dist:        { source, bytes, gzip },
//     screenshots: { source, items: [{ path, workspace, view, theme, viewport, width, height,
//                                      caption, alt }] },
//     git:         { source, commits, firstCommit, head, headDate,
//                    weeks: [{ week, start, commits }] }      only when git: true
//   }

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parseClaims } from '../tests/unit/claims-parse.mjs';
import { parseYaml } from './yaml-subset.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP_URL = 'https://korczis.github.io/oscilla/';
/** Where the Pages deploy publishes the charts (scripts/landing.mjs renders them). */
export const CHART_BASE = 'https://korczis.github.io/oscilla/lab/charts/';
export const CHARTS = Object.freeze(['releases', 'size', 'plan', 'claims', 'activity']);
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

// The ledger is line-oriented YAML that the strict subset parser refuses (plain values hold
// ': '), so it is read by the one reader its own tests use, not by a second one.
function claims(root) {
  const text = readFileSync(path.join(root, SOURCES.claims), 'utf8');
  const items = parseClaims(text).map((c) => ({ id: c.id, claim: c.claim, status: c.status }));
  return { source: SOURCES.claims, total: items.length, byStatus: countBy(items, 'status'),
    items };
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
function plan(root) {
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
    return { id: m.id, title: m.title, status, done: c.done, total };
  });
  items.sort((a, b) => byString(a.id, b.id));
  return { source: `${SOURCES.plan} + ${SOURCES.issues}`, byStatus: countBy(items, 'status'),
    items };
}

// Only the status line of the front matter: an ADR's other fields are free text that need not
// fit the strict subset parser.
function adrStatus(text) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  const m = fm && /^status:\s*["']?([a-z-]+)/m.exec(fm[1]);
  return m ? m[1] : 'unknown';
}

function adrs(root) {
  const dir = path.join(root, SOURCES.adrs);
  const items = readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort()
    .map((f) => ({ status: adrStatus(readFileSync(path.join(dir, f), 'utf8')) }));
  return { source: SOURCES.adrs, total: items.length, byStatus: countBy(items, 'status') };
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
  if (git) facts.git = gitFacts(root);
  return facts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const facts = await collectFacts({ git: !process.argv.includes('--no-git') });
  process.stdout.write(`${JSON.stringify(facts, null, 2)}\n`);
}

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
//     plan:        { source, statusSource: { source, tool, release, fallback }, byStatus,
//                    items: [{ id, title, order, status, phase, done, total }] }  (status:
//                    Majordomus's, milestoneStatuses; done/total: the issue files)
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
//     planBurnup:  { source, rule, issues, totals: { created, cancelled, scope, done },
//                    undated: { created, completed }, days: [{ day, created, cancelled, done,
//                    createdTotal, cancelledTotal, scopeTotal, doneTotal }] }        (P016)
//     releaseCadence: { source, field: 'published_at', unit: 'h', releases, undated, median,
//                    items: [{ version, from, published_at, hours }] }
//     claimsPerRelease: { source, statuses, items: [{ version, tag, present, total,
//                    byStatus }] }                                        only when git: true
//     ratchets:    { source, rule, items: [{ file, how, field, unit, derived, firstTag, rises,
//                    head: { present, value, series, extra }, perRelease: [{ version, tag,
//                    present, value, series, extra }] }] }                only when git: true
//     reviews:     { source, dateSource, severities, statuses, items: [{ pr, verdict, members,
//                    findings, bySeverity, byStatus, openBySeverity, addedAt, week }],
//                    totals: { reviews, findings, bySeverity, byStatus, openBySeverity,
//                    byVerdict, undated }, weeks: [{ week, start, reviews, findings,
//                    bySeverity }], findings: [{ source: '<pr>.yaml#<id>', pr, id, severity,
//                    status, title }] }                                   only when git: true
//     reviewAudits: { source, rule, commitRule, severities, classes, audits: [{ file, schema,
//                    date, base, judgedOn, extends, extendsMissing, completes, auditors, scope,
//                    summary, baseKnown }], perFinding: [{ source, pr, id, severity, title,
//                    class, audit, auditDate, evidence, issue, issueFile, commit }],
//                    unaudited: [<source>],
//                    orphans: [{ source, pr, id, class, audit }], split: { <class>: n, total },
//                    bySeverity: { <sev>: { <class>: n } }, p3: { audit, extensions, total,
//                    open, byClass, signals, sample, classified } | null }
//                                                                  (P017) only when git: true
//   }

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parseClaims, unquote } from '../tests/unit/claims-parse.mjs';
import { CLOSED as ROADMAP_CLOSED, PHASE_OF, ROADMAP_REL } from './roadmap.mjs';
import { parseYaml } from './yaml-subset.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP_URL = 'https://korczis.github.io/oscilla/';
/** Where the Pages deploy publishes the charts (scripts/landing.mjs renders them). */
export const CHART_BASE = 'https://korczis.github.io/oscilla/lab/charts/';
export const CHARTS = Object.freeze(['releases', 'size', 'plan', 'claims', 'activity',
  'modules', 'growth', 'burnup', 'claims-trend', 'ratchets', 'reviews', 'cadence']);
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

// ------------------------------------------------------------------- milestone status (P015)
/** The environment variable that makes the /lab/ build require Majordomus (Pages sets it). */
export const REQUIRE_MAJORDOMUS_ENV = 'OSC_LAB_REQUIRE_MAJORDOMUS';
/** The page's three milestone groups by Majordomus's phase: now is in progress, the rest open. */
export const STATUS_OF_PHASE = Object.freeze({ now: 'ACTIVE', next: 'OPEN', later: 'OPEN' });
export const MAJORDOMUS_SOURCE = 'majordomus plan roadmap --json';
const statusCache = new Map();

function runTool(bin, args, root) {
  const r = spawnSync(bin, args, { cwd: root, encoding: 'utf8', timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024 });
  if (r.error) {
    return { error: r.error.code === 'ENOENT' ? `${bin} is not on PATH`
      : `${bin} ${args.join(' ')}: ${r.error.message}` };
  }
  if (r.status !== 0) {
    return { error: `${bin} ${args.join(' ')} exited ${r.status}: ${(r.stderr || '').trim()
      .split('\n').slice(-1)[0] ?? ''}`.trim() };
  }
  return { out: r.stdout };
}

/**
 * The status of every milestone as Majordomus derives it (decision of oscilla-43, 2026-11-10,
 * recorded in P015): never recomputed here. First `majordomus plan roadmap --json` in `root`:
 * DONE and CANCELLED as it says, every other status grouped by its phase (scripts/roadmap.mjs
 * PHASE_OF: ACTIVE and VERIFY now, PLANNED next, BLOCKED later). With `requireMajordomus` (the
 * Pages deploy, --require-majordomus or OSC_LAB_REQUIRE_MAJORDOMUS=1) a missing or failing
 * majordomus throws by name. Without it, or with `useMajordomus: false`, the committed
 * src/data/roadmap.json, which release:prepare writes from the same command: a milestone it
 * lists takes its phase, one it does not list is DONE (CANCELLED when its file says
 * cancelled: true), as of the release package.json names; it may be one release behind the
 * plan files, and its status is shown as it is, never corrected from the issue counts.
 * -> { source, tool: { name, version } | null, release, fallback, statuses: { <id>: { status,
 *      phase, derived } } }   (memoised per root and options within one process)
 */
export function milestoneStatuses(root, { requireMajordomus = false, useMajordomus = true,
  bin = 'majordomus' } = {}) {
  const key = `${path.resolve(root)}\0${requireMajordomus}\0${useMajordomus}\0${bin}`;
  if (statusCache.has(key)) return statusCache.get(key);
  let fallback = useMajordomus ? null : 'not asked (useMajordomus: false)';
  if (useMajordomus) {
    const v = runTool(bin, ['version'], root);
    const r = v.error ? v : runTool(bin, ['plan', 'roadmap', '--json'], root);
    let plan = null;
    if (!r.error) {
      try {
        plan = JSON.parse(r.out);
      } catch (e) {
        r.error = `${MAJORDOMUS_SOURCE} gave no JSON: ${e.message}`;
      }
      if (plan && !Array.isArray(plan.milestones)) {
        r.error = `${MAJORDOMUS_SOURCE} gave no milestones list`;
      }
    }
    if (!r.error) {
      const statuses = {};
      for (const m of plan.milestones) {
        const derived = String(m.status);
        const phase = ROADMAP_CLOSED.includes(derived) ? null : PHASE_OF[derived] ?? 'next';
        statuses[m.id] = { status: phase ? STATUS_OF_PHASE[phase] : derived, phase, derived };
      }
      const version = (/(\d+\.\d+\.\d+\S*)/.exec(v.out) || [])[1] ?? v.out.trim();
      const out = { source: MAJORDOMUS_SOURCE, tool: { name: 'majordomus', version },
        release: null, fallback: null, statuses };
      statusCache.set(key, out);
      return out;
    }
    if (requireMajordomus) {
      throw new Error(`facts: the milestone status needs Majordomus (${MAJORDOMUS_SOURCE}): `
        + `${r.error}; install the pinned majordomus, or build without --require-majordomus `
        + `(${REQUIRE_MAJORDOMUS_ENV}) to read ${ROADMAP_REL}`);
    }
    fallback = r.error;
  }
  const file = path.join(root, ROADMAP_REL);
  if (!existsSync(file)) {
    throw new Error(`facts: no milestone status: ${fallback}, and ${ROADMAP_REL} is missing`);
  }
  const listed = new Map(JSON.parse(readFileSync(file, 'utf8')).milestones
    .map((m) => [m.id, m]));
  const statuses = {};
  const dir = path.join(root, SOURCES.plan);
  for (const f of yamlFiles(dir)) {
    const m = parseYaml(readFileSync(path.join(dir, f), 'utf8'));
    const l = listed.get(m.id);
    statuses[m.id] = l ? { status: STATUS_OF_PHASE[l.phase] ?? 'OPEN', phase: l.phase,
      derived: null } : { status: m.cancelled === true ? 'CANCELLED' : 'DONE', phase: null,
      derived: null };
  }
  const pkg = path.join(root, 'package.json');
  const release = existsSync(pkg) ? String(JSON.parse(readFileSync(pkg, 'utf8')).version) : null;
  const out = { source: ROADMAP_REL, tool: null, release, fallback, statuses };
  statusCache.set(key, out);
  return out;
}

// Each milestone with the status Majordomus derives (milestoneStatuses) and its progress from
// the issue files: done (completed_at, not cancelled) of total (not cancelled). A milestone the
// status source does not name is UNKNOWN, never guessed.
export function plan(root, statusFacts = milestoneStatuses(root, { useMajordomus: false })) {
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
    const st = statusFacts.statuses[m.id] ?? { status: 'UNKNOWN', phase: null };
    return { id: m.id, title: m.title, order: Number.isFinite(m.order) ? m.order : null,
      status: st.status, phase: st.phase, done: c.done, total: c.total - c.cancelled };
  });
  items.sort((a, b) => byString(a.id, b.id));
  // the status source last: a file (the fallback) or the majordomus command (statusSource
  // carries its version, or the release the file describes)
  return { source: `${SOURCES.plan} + ${SOURCES.issues} + ${statusFacts.source}`,
    statusSource: { source: statusFacts.source, tool: statusFacts.tool,
      release: statusFacts.release, fallback: statusFacts.fallback },
    byStatus: countBy(items, 'status'), items };
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

// ------------------------------------------------------------------- retrospective trends (P016)
const DAY = /^\d{4}-\d{2}-\d{2}/;

/** The UTC day of a date field ('2026-11-09' or an ISO time), or null when it is not one. */
export function utcDay(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  return DAY.test(s) && Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS)
  .toISOString().slice(0, 10);

/**
 * The plan's burn-up from the issue files: per UTC day from the first created_at to the last
 * created_at or completed_at, the issues created that day (created_at), those of them since
 * cancelled (cancelled: true; the files carry no cancellation date, so a cancelled issue is
 * counted on the day it was created) and the issues done that day (completed_at, cancelled
 * excluded, as plan() counts done), each with its running total. `undated` counts the issues
 * whose created_at or completed_at is not a date, which no day can hold.
 */
export function planBurnup(root) {
  const dir = path.join(root, SOURCES.issues);
  const created = new Map();
  const cancelled = new Map();
  const done = new Map();
  const undated = { created: 0, completed: 0 };
  const bump = (m, d) => m.set(d, (m.get(d) ?? 0) + 1);
  let total = 0;
  for (const f of yamlFiles(dir)) {
    const issue = parseYaml(readFileSync(path.join(dir, f), 'utf8'));
    total += 1;
    const c = utcDay(issue.created_at);
    if (c) {
      bump(created, c);
      if (issue.cancelled === true) bump(cancelled, c);
    } else undated.created += 1;
    if (issue.cancelled !== true && issue.completed_at) {
      const d = utcDay(issue.completed_at);
      if (d) bump(done, d);
      else undated.completed += 1;
    }
  }
  const all = [...created.keys(), ...done.keys()].sort(byString);
  const days = [];
  if (all.length) {
    const sums = { created: 0, cancelled: 0, done: 0 };
    for (let d = all[0]; d <= all[all.length - 1]; d = addDays(d, 1)) {
      const row = { day: d, created: created.get(d) ?? 0, cancelled: cancelled.get(d) ?? 0,
        done: done.get(d) ?? 0 };
      sums.created += row.created;
      sums.cancelled += row.cancelled;
      sums.done += row.done;
      days.push({ ...row, createdTotal: sums.created, cancelledTotal: sums.cancelled,
        scopeTotal: sums.created - sums.cancelled, doneTotal: sums.done });
    }
  }
  const last = days[days.length - 1];
  return {
    source: SOURCES.issues,
    rule: 'created: created_at (UTC day); done: completed_at (UTC day) of an issue that is not '
      + 'cancelled; cancelled: cancelled: true, counted on its created_at day (the files carry '
      + 'no cancellation date); scope = created - cancelled',
    issues: total,
    totals: { created: last?.createdTotal ?? 0, cancelled: last?.cancelledTotal ?? 0,
      scope: last?.scopeTotal ?? 0, done: last?.doneTotal ?? 0 },
    undated,
    days,
  };
}

/**
 * `git cat-file --batch` over `specs` ('<ref>:<path>'): a Map spec -> text, or null for a
 * spec that names no blob. One process for every read, in the order given.
 */
export function catFiles(root, specs) {
  const out = new Map();
  if (!specs.length) return out;
  const buf = execFileSync('git', ['cat-file', '--batch'], { cwd: root,
    input: `${specs.join('\n')}\n`, maxBuffer: 512 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'] });
  let at = 0;
  for (const spec of specs) {
    const nl = buf.indexOf(0x0a, at);
    const header = buf.toString('utf8', at, nl);
    at = nl + 1;
    const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
    if (!m) { out.set(spec, null); continue; }
    const size = Number(m[2]);
    out.set(spec, m[1] === 'blob' ? buf.toString('utf8', at, at + size) : null);
    at += size + 1;
  }
  return out;
}

const statusOrder = (keys, first) => [...first.filter((k) => keys.includes(k)),
  ...keys.filter((k) => !first.includes(k)).sort(byString)];

/**
 * The claims ledger at every release tag reachable from HEAD: `git show <tag>:docs/CLAIMS.yaml`
 * read by the claims parser its tests use, counted by status. A tag whose tree has no ledger is
 * `present: false` with null counts, never zero.
 */
export function claimsPerRelease(root, tags = releaseTags(root)) {
  const texts = catFiles(root, tags.map((t) => `${t}:${SOURCES.claims}`));
  const items = tags.map((tag) => {
    const text = texts.get(`${tag}:${SOURCES.claims}`);
    if (text === null || text === undefined) {
      return { version: tag.slice(1), tag, present: false, total: null, byStatus: null };
    }
    const list = parseClaims(text);
    return { version: tag.slice(1), tag, present: true, total: list.length,
      byStatus: countBy(list, 'status') };
  });
  const statuses = statusOrder([...new Set(items.flatMap((x) => Object.keys(x.byStatus ?? {})))],
    ['guaranteed', 'planned']);
  return { source: `git show <tag>:${SOURCES.claims} for each v* tag reachable from HEAD, read `
    + 'by tests/unit/claims-parse.mjs', statuses, items };
}

/** The ratchet baselines a tree keeps: tests/{unit,browser}/*-baseline.json. */
export const BASELINE_FILE = /^tests\/(?:unit|browser)\/[^/]+-baseline\.json$/;
const BASELINE_DIRS = ['tests/unit', 'tests/browser'];

const sumNumbers = (v) => (typeof v === 'number' && Number.isFinite(v) ? v
  : v && typeof v === 'object' ? Object.values(v).reduce((n, x) => n + sumNumbers(x), 0) : 0);
const arrayFields = (j) => Object.entries(j).filter(([, v]) => Array.isArray(v));

/**
 * What a baseline file counts, read from its own structure (each rule is the field its test
 * enforces): `total` when the file states one (czech-prose: its test pins total = the sum of
 * counts); a numeric `debt` with its `measure` as the series (ui-flowbite-pro: the numbers of one
 * measure compare only with each other); `caps`, the byte caps summed (source-size); the length
 * of the one list a file keeps (control-drive's undriven, readout-provenance's undescribed,
 * collection-count's entries); the numbers of `counts` or of an object `debt` summed, nested
 * ones included (key-listener, patch-contract, timing, iphone). Anything else is not derived:
 * its raw top-level entry count, `derived: false`.
 * -> { how, field, unit, value, series, derived, extra }
 */
export function baselineTotal(json) {
  const j = json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  if (typeof j.total === 'number') {
    return { how: 'total', field: 'total', unit: 'count', value: j.total, series: null,
      derived: true, extra: null };
  }
  if (typeof j.debt === 'number') {
    return { how: 'debt', field: 'debt', unit: 'count', value: j.debt,
      series: typeof j.measure === 'number' ? `measure ${j.measure}` : null, derived: true,
      extra: null };
  }
  if (j.caps && typeof j.caps === 'object' && !Array.isArray(j.caps)) {
    return { how: 'sum', field: 'caps', unit: 'bytes', value: sumNumbers(j.caps), series: null,
      derived: true, extra: { files: Object.keys(j.caps).length,
        raises: Array.isArray(j.raises) ? j.raises.length : 0 } };
  }
  const lists = arrayFields(j);
  if (lists.length === 1) {
    return { how: 'length', field: lists[0][0], unit: 'count', value: lists[0][1].length,
      series: null, derived: true, extra: null };
  }
  for (const field of ['counts', 'debt']) {
    if (j[field] && typeof j[field] === 'object' && !Array.isArray(j[field])) {
      return { how: 'sum', field, unit: 'count', value: sumNumbers(j[field]), series: null,
        derived: true, extra: null };
    }
  }
  const keys = Object.keys(j).filter((k) => !['note', 'rule'].includes(k));
  return { how: 'raw', field: null, unit: 'entries', value: keys.length, series: null,
    derived: false, extra: null };
}

const fileList = (root, ref) => lsTree(root, ref, BASELINE_DIRS).map((e) => e.path)
  .filter((p) => BASELINE_FILE.test(p));

/**
 * Every ratchet baseline the tree of HEAD or of any release tag reachable from it keeps
 * (BASELINE_FILE, found by git ls-tree, never listed by hand), with its total (baselineTotal)
 * at each tag and at HEAD. `rises` counts the consecutive tags (and the last tag to HEAD) at
 * which a total of the same series went up: a ratchet that only falls has none.
 */
export function ratchets(root, tags = releaseTags(root)) {
  const refs = [...tags, 'HEAD'];
  const present = new Map(refs.map((r) => [r, new Set(fileList(root, r))]));
  const files = [...new Set(refs.flatMap((r) => [...present.get(r)]))].sort(byString);
  const specs = refs.flatMap((r) => files.filter((f) => present.get(r).has(f))
    .map((f) => `${r}:${f}`));
  const texts = catFiles(root, specs);
  const read = (ref, file) => {
    const text = texts.get(`${ref}:${file}`);
    if (text === null || text === undefined) return null;
    try {
      return baselineTotal(JSON.parse(text));
    } catch {
      return { how: 'unreadable', field: null, unit: 'entries', value: null, series: null,
        derived: false, extra: null };
    }
  };
  const items = files.map((file) => {
    const point = (ref) => {
      const t = read(ref, file);
      return t ? { present: true, value: t.value, series: t.series, extra: t.extra, t }
        : { present: false, value: null, series: null, extra: null, t: null };
    };
    const perRelease = tags.map((tag) => {
      const { t, ...p } = point(tag);
      return { version: tag.slice(1), tag, ...p };
    });
    const { t: headT, ...head } = point('HEAD');
    const seq = [...perRelease, head].filter((p) => p.present && p.value !== null);
    let rises = 0;
    for (let i = 1; i < seq.length; i += 1) {
      if (seq[i].series === seq[i - 1].series && seq[i].value > seq[i - 1].value) rises += 1;
    }
    const latest = headT ?? [...tags].reverse().map((tag) => read(tag, file)).find(Boolean);
    return { file, how: latest.how, field: latest.field, unit: latest.unit,
      derived: latest.derived, firstTag: perRelease.find((p) => p.present)?.tag ?? null,
      rises, head, perRelease };
  });
  return {
    source: `git ls-tree -r <ref> -- ${BASELINE_DIRS.join(' ')} (files matching ${
      BASELINE_FILE.source}) + git cat-file --batch <ref>:<file>, for HEAD and each v* tag `
      + 'reachable from HEAD',
    rule: 'total: the file\'s total; debt: a numeric debt (series: its measure); caps: the sum '
      + 'of the byte caps; one list: its length; counts or an object debt: the sum of its '
      + 'numbers; anything else: the raw top-level entry count, not derived',
    items,
  };
}

/** The review records' severities and statuses in the order review-verdict.mjs declares them. */
export const REVIEW_SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);
export const REVIEW_STATUSES = Object.freeze(['open', 'closed']);
const REVIEWS = '.ai/repo/reviews';

/** The date each file under `dir` was first added in HEAD's history: Map path -> ISO time. */
export function addedDates(root, dir) {
  const out = gitRunner(root)(['log', '--diff-filter=A', '--no-renames', '--name-only',
    '--format=%x1e%cI', 'HEAD', '--', dir]);
  const first = new Map();
  for (const rec of out.split('\x1e').filter((r) => r.trim())) {
    const [date, ...names] = rec.trim().split('\n');
    const iso = new Date(date.trim()).toISOString();
    // newest first: a later (older) record replaces, so the first addition wins
    for (const n of names.filter(Boolean)) first.set(n.trim(), iso);
  }
  return first;
}

const zeroed = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));

/**
 * The review verdicts (.ai/repo/reviews/<pr>.yaml, schema review-verdict/v1): per pull request
 * its verdict, its findings by severity and by status, the open ones by severity, and the time
 * the record was first committed (git log --diff-filter=A); per ISO week of that time the
 * findings by severity. A severity or status outside the declared lists is kept under its own
 * name, after them.
 */
export function reviews(root) {
  const dir = path.join(root, REVIEWS);
  const files = yamlFiles(dir).filter((f) => /^\d+\.yaml$/.test(f));
  const added = addedDates(root, REVIEWS);
  const raw = files.map((f) => {
    const doc = parseYaml(readFileSync(path.join(dir, f), 'utf8'));
    const findings = Array.isArray(doc.findings) ? doc.findings : [];
    return { file: f, doc, findings };
  });
  const severities = statusOrder([...new Set(raw.flatMap((r) => r.findings.map((x) =>
    String(x.severity))))], [...REVIEW_SEVERITIES]);
  const allSev = statusOrder([...new Set([...REVIEW_SEVERITIES, ...severities])],
    [...REVIEW_SEVERITIES]);
  const statuses = statusOrder([...new Set([...REVIEW_STATUSES, ...raw.flatMap((r) =>
    r.findings.map((x) => String(x.status)))])], [...REVIEW_STATUSES]);
  const items = raw.map(({ file, doc, findings }) => {
    const bySeverity = zeroed(allSev);
    const byStatus = zeroed(statuses);
    const openBySeverity = zeroed(allSev);
    for (const x of findings) {
      bySeverity[String(x.severity)] += 1;
      byStatus[String(x.status)] += 1;
      if (String(x.status) === 'open') openBySeverity[String(x.severity)] += 1;
    }
    const at = added.get(`${REVIEWS}/${file}`) ?? null;
    return { pr: Number(file.replace(/\.yaml$/, '')), verdict: String(doc.verdict ?? 'unknown'),
      members: Array.isArray(doc.members) ? doc.members.length : 0, findings: findings.length,
      bySeverity, byStatus, openBySeverity, addedAt: at, week: at ? isoWeek(new Date(at)).week
        : null };
  }).sort((a, b) => a.pr - b.pr);
  const dated = items.filter((x) => x.addedAt);
  const weeks = [];
  if (dated.length) {
    const times = dated.map((x) => Date.parse(x.addedAt));
    const last = isoWeek(new Date(Math.max(...times))).week;
    let start = isoWeek(new Date(Math.min(...times))).start;
    for (;;) {
      const w = isoWeek(new Date(`${start}T00:00:00Z`));
      const these = dated.filter((x) => x.week === w.week);
      const bySeverity = zeroed(allSev);
      for (const x of these) for (const k of allSev) bySeverity[k] += x.bySeverity[k];
      weeks.push({ ...w, reviews: these.length,
        findings: these.reduce((n, x) => n + x.findings, 0), bySeverity });
      if (w.week === last) break;
      start = addDays(start, 7);
    }
  }
  const sum = (key, keys) => Object.fromEntries(keys.map((k) => [k,
    items.reduce((n, x) => n + x[key][k], 0)]));
  // every finding once, by the key an audit names it with: <pr>.yaml#<id> (P017)
  const findingList = raw.flatMap(({ file, findings }) => findings.map((x) => ({
    source: x.id === undefined || x.id === null ? null : `${file}#${x.id}`,
    pr: Number(file.replace(/\.yaml$/, '')), id: x.id === undefined || x.id === null ? null
      : String(x.id), severity: String(x.severity), status: String(x.status),
    title: String(x.title ?? '') }))).sort((a, b) => (a.pr - b.pr));
  return {
    source: `${REVIEWS}/<pr>.yaml (review-verdict/v1)`,
    dateSource: `git log --diff-filter=A --no-renames --format=%cI HEAD -- ${REVIEWS}`,
    severities: allSev, statuses, items,
    totals: { reviews: items.length, findings: items.reduce((n, x) => n + x.findings, 0),
      bySeverity: sum('bySeverity', allSev), byStatus: sum('byStatus', statuses),
      openBySeverity: sum('openBySeverity', allSev), byVerdict: countBy(items, 'verdict'),
      undated: items.length - dated.length },
    weeks,
    findings: findingList,
  };
}

// ------------------------------------------------------------------- review audits (P017)
/** The audit files beside the verdicts: .ai/repo/reviews/audit-<date>.yaml (review-audit/v1). */
export const AUDIT_FILE = /^audit-[^/]+\.yaml$/;
/** The severities an audit classifies; P3s it only counts (its p3 block). */
export const AUDITED_SEVERITIES = Object.freeze(['P0', 'P1', 'P2']);
/** The classes review-audit/v1 declares, then `unaudited`: an open finding no audit covers. */
export const AUDIT_CLASSES = Object.freeze(['open', 'fixed', 'superseded']);
export const UNAUDITED = 'unaudited';
const SOURCE_REF = /^(\d+\.yaml)#(.+)$/;

/**
 * The tokens of a text that may name a commit: 7 to 40 lowercase hex digits standing alone, at
 * least one of them a digit (so an English word made of a-f letters is not taken for one), in
 * the order they appear.
 */
export function hexTokens(text) {
  return [...String(text ?? '').matchAll(/(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/g)]
    .map((m) => m[0]).filter((t) => /\d/.test(t));
}

/**
 * `git cat-file --batch-check` over `names`, one process: Map name -> { sha, type }, or null for
 * a name that is missing or ambiguous (and for every name when git cannot run there).
 */
export function objectTypes(root, names) {
  const list = [...new Set(names)];
  const out = new Map(list.map((n) => [n, null]));
  if (!list.length) return out;
  let text;
  try {
    text = execFileSync('git', ['cat-file', '--batch-check'], { cwd: root, encoding: 'utf8',
      input: `${list.join('\n')}\n`, maxBuffer: 16 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'] });
  } catch {
    return out;
  }
  const lines = text.split('\n');
  list.forEach((n, i) => {
    const m = /^([0-9a-f]{40,64}) (\w+) \d+$/.exec(lines[i] ?? '');
    out.set(n, m ? { sha: m[1], type: m[2] } : null);
  });
  return out;
}

/** Whether commit `a` is an ancestor of (or is) commit `b`: git merge-base --is-ancestor. */
export function isAncestor(root, a, b) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: root,
      stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/** How the audits are ordered and joined (reviewAudits' `rule`, .ai/repo/reviews/README.md). */
export const AUDIT_RULE = 'an audit naming another in extends: completes it: it adds rows for '
  + 'the findings that one does not name and its p3_total completes that one\'s P3 block, and '
  + 'replaces nothing; the other audits are ordered by date, then file name without .yaml (so '
  + 'a same-day audit-<date>-b.yaml follows audit-<date>.yaml), and the latest naming '
  + '<pr>.yaml#<id> gives the class; a finding open at P0-P2 in its verdict that no audit names '
  + 'is unaudited';

/** How a fixed finding's commit is found (reviewAudits' `commitRule`). */
export const COMMIT_RULE = 'a fixed finding links the first token of its evidence of 7-40 '
  + 'lowercase hex digits (one at least a digit) that is a commit of this repository (git '
  + 'cat-file --batch-check) and an ancestor of the commit its audit judged on (judged_on, '
  + 'else base; git merge-base --is-ancestor); else no commit';

const str = (v) => (v === undefined || v === null ? null : String(v));

/**
 * An audit's auditor as one name: a string as written, or a { session, seat } object as
 * "<session> (<seat>)" (either alone when the other is missing).
 */
export function auditorName(a) {
  if (!a || typeof a !== 'object') return String(a);
  const session = str(a.session);
  const seat = str(a.seat);
  if (session && seat) return `${session} (${seat})`;
  return session ?? seat ?? JSON.stringify(a);
}

/**
 * The review audits (.ai/repo/reviews/audit-*.yaml) joined to the verdict findings of
 * `reviewsFacts` (reviews(), its `findings`). Audits are ordered by their `date`, then file
 * name, and the latest that names a finding (`source: <pr>.yaml#<id>`, in `findings` or
 * `p3_sample`) gives its class, evidence and issue: nothing is classified here. Every finding
 * a verdict still marks open at P0-P2 is listed under `perFinding`, as its audit class or as
 * `unaudited` when no audit names it; `orphans` are the sources an audit names that no verdict
 * holds; `p3` is the latest audit's P3 block as it records it (null without one). `issueFile`
 * is the plan issue's file when it exists in this tree (an audit may name an issue its own
 * pull request adds), else null. `commit` is the fixing commit by COMMIT_RULE, else null.
 */
export function reviewAudits(root, reviewsFacts) {
  const dir = path.join(root, REVIEWS);
  const files = yamlFiles(dir).filter((f) => AUDIT_FILE.test(f));
  const parsed = files.map((file) => {
    const doc = parseYaml(readFileSync(path.join(dir, file), 'utf8'));
    return { file, stem: file.replace(/\.yaml$/, ''), doc, date: utcDay(doc.date),
      extends: str(doc.extends) };
  });
  const byFile = new Map(parsed.map((d) => [d.file, d]));
  // the audit an extension completes, followed through extensions of extensions; an extension
  // that names no audit present here stands on its own (extendsMissing)
  const rootOf = (d, seen = new Set()) => {
    const target = d.extends ? byFile.get(d.extends.replace(/^.*\//, '')) : null;
    if (!target || target === d || seen.has(target.file)) return d;
    seen.add(d.file);
    return rootOf(target, seen);
  };
  const order = (a, b) => byString(a.date ?? '', b.date ?? '') || byString(a.stem, b.stem);
  const chains = parsed.filter((d) => rootOf(d) === d).sort(order).map((r) => [r,
    ...parsed.filter((d) => d !== r && rootOf(d) === r).sort(order)]);
  const docs = chains.flat();
  const audits = docs.map((d) => ({ file: `${REVIEWS}/${d.file}`, schema: str(d.doc.schema),
    date: d.date, base: str(d.doc.base), judgedOn: str(d.doc.judged_on),
    extends: d.extends ? `${REVIEWS}/${d.extends.replace(/^.*\//, '')}` : null,
    extendsMissing: Boolean(d.extends) && rootOf(d) === d,
    completes: rootOf(d) === d ? null : `${REVIEWS}/${rootOf(d).file}`,
    auditors: (Array.isArray(d.doc.auditors) ? d.doc.auditors : [d.doc.auditors]).filter((x) =>
      x !== undefined && x !== null).map(auditorName),
    scope: str(d.doc.scope), summary: d.doc.summary && typeof d.doc.summary === 'object'
      ? d.doc.summary : null }));
  const auditOf = new Map(docs.map((d, i) => [d, audits[i]]));
  // Within a chain the audit it extends keeps its rows and an extension only adds rows for the
  // sources it does not name; across chains the later root (by date, then file stem, so a
  // same-day audit-<date>-b.yaml follows audit-<date>.yaml) supersedes per source.
  const verdict = new Map((reviewsFacts?.findings ?? []).filter((x) => x.source)
    .map((x) => [x.source, x]));
  const latest = new Map();
  for (const chain of chains) {
    const rows = new Map();
    for (const d of chain) {
      const a = auditOf.get(d);
      const entries = [...(Array.isArray(d.doc.findings) ? d.doc.findings : []),
        ...(Array.isArray(d.doc.p3_sample) ? d.doc.p3_sample : [])];
      for (const e of entries) {
        const source = str(e.source);
        if (!source || rows.has(source)) continue;
        rows.set(source, { audit: a.file, date: a.date, base: a.judgedOn ?? a.base,
          cls: str(e.class), evidence: str(e.evidence), issue: str(e.issue),
          title: str(e.title) });
      }
    }
    for (const [source, row] of rows) latest.set(source, row);
  }
  const perFinding = (reviewsFacts?.findings ?? []).filter((x) => x.status === 'open'
    && AUDITED_SEVERITIES.includes(x.severity)).map((x) => {
    const a = x.source ? latest.get(x.source) : undefined;
    const cls = a?.cls ?? UNAUDITED;
    return { source: x.source, pr: x.pr, id: x.id, severity: x.severity, title: x.title,
      class: cls, audit: a?.audit ?? null, auditDate: a?.date ?? null,
      evidence: a?.evidence ?? null, issue: a?.issue ?? null,
      issueFile: a?.issue && /^[A-Z]\d{3}$/.test(a.issue)
        && existsSync(path.join(root, SOURCES.issues, `${a.issue}.yaml`))
        ? `${SOURCES.issues}/${a.issue}.yaml` : null,
      commit: null, base: a?.base ?? null };
  });
  // the fixing commits: every candidate token and base resolved by one cat-file process
  const fixed = perFinding.filter((x) => x.class === 'fixed');
  const checkBase = (a) => a.judgedOn ?? a.base;
  const types = objectTypes(root, [...fixed.flatMap((x) => hexTokens(x.evidence)),
    ...audits.map(checkBase).filter(Boolean)]);
  const baseSha = (b) => (b && types.get(b)?.type === 'commit' ? types.get(b).sha : null);
  for (const x of audits) x.baseKnown = Boolean(baseSha(checkBase(x)));
  const ancestry = new Map();
  for (const x of fixed) {
    const base = baseSha(x.base);
    for (const tok of hexTokens(x.evidence)) {
      const t = types.get(tok);
      if (t?.type !== 'commit') continue;
      const key = `${t.sha} ${base}`;
      if (base && !ancestry.has(key)) ancestry.set(key, isAncestor(root, t.sha, base));
      if (!base || ancestry.get(key)) {
        x.commit = t.sha;
        break;
      }
    }
  }
  for (const x of perFinding) delete x.base;
  const orphans = [...latest].filter(([source]) => !verdict.has(source))
    .map(([source, a]) => {
      const m = SOURCE_REF.exec(source);
      return { source, pr: m ? Number(m[1].replace(/\.yaml$/, '')) : null, id: m ? m[2] : null,
        class: a.cls, audit: a.audit };
    }).sort((a, b) => byString(a.source, b.source));
  const classes = statusOrder([...new Set([...AUDIT_CLASSES, ...perFinding.map((x) => x.class)
    .filter((c) => c !== UNAUDITED)])], [...AUDIT_CLASSES]).concat(UNAUDITED);
  const split = zeroed(classes);
  const bySeverity = Object.fromEntries(AUDITED_SEVERITIES.map((s) => [s, zeroed(classes)]));
  for (const x of perFinding) {
    split[x.class] += 1;
    bySeverity[x.severity][x.class] += 1;
  }
  const unknownBases = audits.filter((x) => !x.baseKnown).map((x) => x.file);
  // The P3 block of the latest chain: its root's p3 as recorded, completed by each extension's
  // p3_total (the classes over all of the root's open P3s; open_at_base its open count) or p3.
  const chain = chains[chains.length - 1] ?? [];
  let p3 = null;
  for (const d of chain) {
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
    const block = obj(d.doc.p3);
    const total = obj(d.doc.p3_total);
    if (!block && !total) continue;
    p3 ??= { audit: auditOf.get(chain[0]).file, extensions: [], total: null, open: null,
      byClass: null, signals: null,
      sample: Array.isArray(chain[0].doc.p3_sample) ? chain[0].doc.p3_sample.length : 0,
      classified: 0 };
    if (block) {
      p3.total = block.total ?? p3.total;
      p3.open = block.open ?? p3.open;
      p3.byClass = obj(block.by_class) ?? p3.byClass;
    }
    if (total) {
      // p3_total: the classes over all of the root's open P3s, and open_at_base their count
      p3.open = total.open_at_base ?? p3.open;
      p3.byClass = Object.fromEntries(Object.entries(total).filter(([k]) => k !== 'open_at_base'));
    }
    p3.signals = obj(d.doc.p3_signals) ?? p3.signals;
  }
  if (p3) {
    const files = new Set(chain.map((d) => auditOf.get(d).file));
    p3.extensions = chain.slice(1).map((x) => auditOf.get(x).file);
    p3.classified = [...latest].filter(([source, r]) => files.has(r.audit)
      && verdict.get(source)?.severity === 'P3').length;
  }
  return {
    source: `${REVIEWS}/audit-*.yaml (review-audit/v1) + ${REVIEWS}/<pr>.yaml`,
    rule: AUDIT_RULE,
    commitRule: `${COMMIT_RULE}${unknownBases.length ? `; the judged commit of ${
      unknownBases.join(', ')} is not a commit of this clone, so its ancestor check is `
      + 'skipped' : ''}`,
    severities: [...AUDITED_SEVERITIES], classes, audits, perFinding,
    unaudited: perFinding.filter((x) => x.class === UNAUDITED).map((x) => x.source),
    orphans, split: { ...split, total: perFinding.length }, bySeverity, p3,
  };
}

/** The median of numbers (the mean of the middle two of an even count), or null. */
export function median(values) {
  const v = values.slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const hours2 = (ms) => Math.round(ms / 36000) / 100;

/**
 * The hours between consecutive published releases (the release records' published_at, in
 * publication order), rounded to 0.01 h, and their median. A record without published_at has
 * no interval.
 */
export function releaseCadence(releaseFacts) {
  const rs = releaseFacts.items.filter((r) => r.published_at && Number.isFinite(
    Date.parse(r.published_at))).slice()
    .sort((a, b) => byString(a.published_at, b.published_at) || compareSemver(a.version,
      b.version));
  const items = rs.slice(1).map((r, i) => ({ version: r.version, from: rs[i].version,
    published_at: r.published_at,
    hours: hours2(Date.parse(r.published_at) - Date.parse(rs[i].published_at)) }));
  const m = median(items.map((x) => x.hours));
  return { source: releaseFacts.source, field: 'published_at', unit: 'h', releases: rs.length,
    undated: releaseFacts.items.length - rs.length, items,
    median: m === null ? null : Math.round(m * 100) / 100 };
}

/**
 * Every fact group of the checkout at `root`. `git` adds the groups read from its history (and
 * fails by name in a tree without one, such as a git archive: facts.mjs --no-git works there);
 * `majordomus` (default: `git`) asks `majordomus plan roadmap --json` for the milestone status,
 * and `requireMajordomus` (default: OSC_LAB_REQUIRE_MAJORDOMUS=1) refuses the fallback to
 * src/data/roadmap.json (milestoneStatuses).
 */
export async function collectFacts({ root = REPO_ROOT, git = true, majordomus = git,
  requireMajordomus = process.env[REQUIRE_MAJORDOMUS_ENV] === '1' } = {}) {
  if (git) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: root,
        stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      throw new Error(`facts: ${root} has no git history (a git archive tree?); the git groups `
        + 'need it: node scripts/facts.mjs --no-git works without them');
    }
  }
  const statusFacts = milestoneStatuses(root, { requireMajordomus,
    useMajordomus: majordomus || requireMajordomus });
  const facts = {
    schema: 'oscilla-facts/v1',
    appUrl: APP_URL,
    workspaces: await workspaces(root),
    templates: await templates(root),
    engines: await engines(root),
    claims: claims(root),
    releases: releases(root),
    plan: plan(root, statusFacts),
    adrs: adrs(root),
    tests: tests(root),
    dist: dist(root),
    screenshots: screenshots(root),
  };
  facts.roadmap = roadmap(root, facts.plan);
  facts.planBurnup = planBurnup(root);
  facts.releaseCadence = releaseCadence(facts.releases);
  if (git) {
    facts.git = gitFacts(root);
    const tags = releaseTags(root);
    facts.releaseChanges = releaseChanges(root, { releases: facts.releases.items, tags });
    facts.codeInventory = codeInventory(root, tags);
    facts.claimsPerRelease = claimsPerRelease(root, tags);
    facts.ratchets = ratchets(root, tags);
    facts.reviews = reviews(root);
    facts.reviewAudits = reviewAudits(root, facts.reviews);
  }
  return facts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const facts = await collectFacts({ git: !process.argv.includes('--no-git'),
      requireMajordomus: process.argv.includes('--require-majordomus')
        || process.env[REQUIRE_MAJORDOMUS_ENV] === '1' });
    process.stdout.write(`${JSON.stringify(facts, null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  }
}

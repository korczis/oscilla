// README.md's derived regions (plan P014, owner decision Q107): each region between
//   <!-- derived:<name>:begin (npm run readme) -->  and  <!-- derived:<name>:end -->
// is rendered from scripts/facts.mjs, so the README cannot drift from the registries it
// describes. Only facts that change with the product are rendered here (workspaces, templates,
// engines, the gated screenshots, the chart embeds); numbers that move on every pull request
// (commits, sizes, plan progress) live in the charts the Pages deploy regenerates instead, or
// every merge would make every open branch's README stale.
//
//   node scripts/readme.mjs           rewrite the regions in place
//   node scripts/readme.mjs --check   exit 1 naming each stale or missing region
//
// renderRegions(readme, facts) and staleRegions(readme, facts) are pure, so the unit test
// injects facts (an extra workspace, a hand edit) without touching the tree.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVITY_WEEKS, CHART_BASE, CHARTS, REPO_ROOT, collectFacts } from './facts.mjs';

export const README_PATH = path.join(REPO_ROOT, 'README.md');
export const LANDING_URL = 'https://korczis.github.io/oscilla/lab/';

export const beginMarker = (name) => `<!-- derived:${name}:begin (npm run readme) -->`;
export const endMarker = (name) => `<!-- derived:${name}:end -->`;

/** Text safe inside a Markdown table cell. */
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
/** Text safe inside an HTML attribute or element. */
const html = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A mermaid node id: the registry id with anything but letters and digits as `_`. */
const nodeId = (id) => `ws_${id.replace(/[^a-zA-Z0-9]/g, '_')}`;

/** At most `max` characters, cut at a word, with an ellipsis when cut. */
export function shorten(text, max = 32) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1).replace(/\s+\S*$/, '').replace(/[\s,.;:]+$/, '');
  return `${cut || t.slice(0, max)}…`;
}

// A mermaid edge label may not hold `|` or `"`; GitHub renders the rest as text.
const edgeText = (s) => s.replace(/["|]/g, '\'');

function edgeLabel(rel, templates) {
  const st = /^&st=([a-z0-9-]+)/.exec(rel.hash ?? '');
  const template = st && templates.find((t) => t.id === st[1]);
  return edgeText(template ? `${template.label} template` : shorten(rel.why));
}

function renderWorkspaces(facts) {
  const ws = facts.workspaces.items;
  const label = new Map(ws.map((w) => [w.id, w.label]));
  const rows = ws.map((w) => {
    const name = w.groupLabel ? `**${w.label}** (${w.groupLabel})` : `**${w.label}**`;
    const next = w.related.map((r) => `[${label.get(r.id) ?? r.id}](${r.deepLink} "${
      cell(r.why).replace(/"/g, '\'')}")`).join(', ');
    return `| ${name} | ${cell(w.summary)} | ${next || '-'} | [Open](${w.deepLink}) |`;
  });
  const groups = [...new Set(ws.filter((w) => w.group).map((w) => w.group))];
  const graph = ['```mermaid', 'flowchart LR'];
  for (const w of ws.filter((x) => !x.group)) graph.push(`  ${nodeId(w.id)}["${w.label}"]`);
  for (const g of groups) {
    const members = ws.filter((w) => w.group === g);
    graph.push(`  subgraph grp_${g}["${members[0].groupLabel}"]`);
    for (const w of members) graph.push(`    ${nodeId(w.id)}["${w.label}"]`);
    graph.push('  end');
  }
  for (const w of ws) {
    for (const r of w.related) {
      graph.push(`  ${nodeId(w.id)} -->|"${edgeLabel(r, facts.templates.items)}"| ${
        nodeId(r.id)}`);
    }
  }
  graph.push('```');
  return [
    'Every workspace of the app, in sidebar order, read from `WORKSPACE_REGISTRY` in',
    `\`${facts.workspaces.source}\`. **Open** starts the live app in that workspace; the links`,
    'under *Leads on to* are the Related strip its page header shows.',
    '',
    '| Workspace | What it does | Leads on to | Open |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    'How the workspaces lead into each other, inferred from the same registry (each arrow is a',
    '`related` entry, labelled with its reason or the Studio template it opens):',
    '',
    ...graph,
  ].join('\n');
}

function renderTemplates(facts) {
  const rows = facts.templates.items.map((t) => `| **${cell(t.label)}** | ${t.category} | ${
    cell(t.summary)} | [Open](${t.deepLink}) |`);
  return [
    'The Studio templates, in library order, read from `STUDIO_TEMPLATES` in',
    `\`${facts.templates.source}\`. Each link opens the template in the live Studio; nothing`,
    'plays until you press Play.',
    '',
    '| Template | Category | What it is | Open |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function renderEngines(facts) {
  const { items, blocked, source } = facts.engines;
  const synth = facts.workspaces.items.find((w) => w.id === 'synth');
  const lines = [
    'The polyphonic engines of the Synth\'s Engines tab, in picker order, read from',
    `\`ENGINE_MODULES\` in \`${source}\`${synth ? ` ([open the Synth](${synth.deepLink}))` : ''}:`,
    '',
    ...items.map((e) => `- **${e.label}** (\`${e.id}\`)`),
  ];
  if (blocked.length) {
    lines.push('', 'Shown disabled, each with the reason it cannot be offered yet '
      + `(\`ENGINE_BLOCKED\`): ${blocked.map((e) => `**${e.label}**`).join(', ')}.`);
  }
  return lines.join('\n');
}

const SHOT_WIDTH = Object.freeze({ desktop: 400, compact: 400, phone: 150 });

function shotCell(s) {
  const img = `<img src="${s.path}" width="${SHOT_WIDTH[s.viewport] ?? 300}" alt="${
    html(s.alt)}">`;
  return `<td align="center"><a href="${s.path}">${img}</a><br><sub>${html(s.caption)}</sub></td>`;
}

function shotTable(shots, perRow) {
  const rows = [];
  for (let i = 0; i < shots.length; i += perRow) {
    rows.push(['<tr>', ...shots.slice(i, i + perRow).map(shotCell), '</tr>'].join('\n'));
  }
  return ['<table>', ...rows, '</table>'].join('\n');
}

// The gallery shows each workspace's views in the default (or dark) theme; the light-theme
// references are gated the same way and linked rather than doubled on the page.
function renderScreenshots(facts) {
  const shots = facts.screenshots.items.filter((s) => s.theme !== 'light');
  const wide = shots.filter((s) => s.viewport !== 'phone');
  const phone = shots.filter((s) => s.viewport === 'phone');
  const light = facts.screenshots.items.filter((s) => s.theme === 'light');
  const out = [
    'These are the visual-gate references of the built app, not mock-ups: CI renders',
    '`dist/index.html` and the visual scripts (`scripts/visual-*.mjs`) fail the build when a',
    'render drifts from them. They are read from',
    `\`${facts.screenshots.source}\`.`,
    '',
    shotTable(wide, 3),
  ];
  if (phone.length) {
    out.push('', `On a phone, ${phone[0].width} px wide:`, '', shotTable(phone, 4));
  }
  if (light.length) {
    out.push('', `The same views in the light theme: ${light.map((s) => `[${s.caption}, ${
      s.viewport}](${s.path})`).join(', ')}.`);
  }
  return out.join('\n');
}

export const CHART_ALT = Object.freeze({
  releases: 'Release timeline: every published release of OSCILLA by its publication date',
  size: 'The size of the single-file app (dist/index.html) in each published release',
  plan: 'Plan progress: the issues done of each milestone, by milestone status',
  claims: 'The claims of docs/CLAIMS.yaml by status',
  activity: `Commits per ISO week over the last ${ACTIVITY_WEEKS} weeks of the repository`,
  modules: 'Source size of each src/js module at the deployed commit, largest first',
  growth: 'Unit test files and browser suites in the tree of each release tag',
  burnup: 'Plan burn-up: issues in the plan and issues done, cumulative per UTC day',
  'claims-trend': 'The claims of docs/CLAIMS.yaml by status at every release tag',
  ratchets: 'Every ratchet baseline of the repository at each release tag, one panel each',
  reviews: 'Review findings by severity per ISO week of the review record',
  cadence: 'Hours between consecutive published releases, with their median',
});

function renderLive() {
  const imgs = CHARTS.map((name) => `<p><img src="${CHART_BASE}${name}.svg" width="100%" alt="${
    html(CHART_ALT[name] ?? name)}"></p>`);
  return [
    'These charts are regenerated from the repository on every Pages deploy (release records,',
    'the plan, the claims ledger, the review records, git history and the trees of the release',
    'tags, read by `scripts/facts.mjs`), so they are current without a commit; nothing in them',
    'is estimated. The interactive versions, with the per-release changes, the roadmap, the',
    `claims explorer, the ratchets and the reviews, are on the [landing page](${LANDING_URL}).`,
    '',
    ...imgs,
  ].join('\n');
}

export const REGIONS = Object.freeze({
  workspaces: renderWorkspaces,
  templates: renderTemplates,
  engines: renderEngines,
  screenshots: renderScreenshots,
  live: renderLive,
});

function locate(readme, name) {
  const begin = readme.indexOf(beginMarker(name));
  const end = readme.indexOf(endMarker(name));
  if (begin < 0 || end < 0 || end < begin) return null;
  return { from: begin + beginMarker(name).length, to: end };
}

/** README text with every region re-rendered; throws when a region's markers are missing. */
export function renderRegions(readme, facts) {
  let out = readme;
  for (const [name, render] of Object.entries(REGIONS)) {
    const at = locate(out, name);
    if (!at) throw new Error(`README.md: derived region ${name} has no begin/end markers`);
    out = `${out.slice(0, at.from)}\n${render(facts)}\n${out.slice(at.to)}`;
  }
  return out;
}

/** [{ name, problem }] for each region that is missing or differs from its rendering. */
export function staleRegions(readme, facts) {
  const out = [];
  for (const [name, render] of Object.entries(REGIONS)) {
    const at = locate(readme, name);
    if (!at) { out.push({ name, problem: 'missing markers' }); continue; }
    if (readme.slice(at.from, at.to) !== `\n${render(facts)}\n`) {
      out.push({ name, problem: 'stale: run npm run readme' });
    }
  }
  return out;
}

async function main(argv) {
  const facts = await collectFacts({ git: false });
  const readme = readFileSync(README_PATH, 'utf8');
  if (argv.includes('--check')) {
    const stale = staleRegions(readme, facts);
    for (const s of stale) console.error(`README.md derived region ${s.name}: ${s.problem}`);
    if (stale.length) return 1;
    console.log(`README.md: ${Object.keys(REGIONS).length} derived regions current`);
    return 0;
  }
  const next = renderRegions(readme, facts);
  if (next !== readme) writeFileSync(README_PATH, next);
  console.log(`README.md: ${next === readme ? 'already current' : 'regions rewritten'}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

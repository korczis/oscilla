// The V3.1 Studio final report (spec §259, plan V433) stays true to the code it describes.
//
// docs/v31/studio-report.md is a dated snapshot. Every list in it that has a source in the
// repository is held between <!-- name:begin --> and <!-- name:end --> and compared here with
// that source, so a later change that adds a node type, a port type, an ADR or a use case fails
// this test instead of leaving the report wrong:
//   schema-versions  the Studio, patch, measured-path and experiment schema constants
//   node-types       NODE_REGISTRY.categories(), in library order
//   port-types       PORT_TYPE_LIST with ROLES_BY_TYPE, PORT_VISUALS and EDGE_PROPERTY_FIELDS
//   actions          ACTION_TYPES
//   timeline         the track, clip, time-base, event, measurement, curve, marker and time enums
//   templates        listTemplates()
//   browser-suites   the suites `npm run test:studio` runs (package.json)
//   commands         every `npm run <script>` / `npm test` the report gives exists
//   adrs             every ADR under .ai/repo/adrs/ tagged `studio`, with its title and status
//   features         .ai/repo/features/studio*.md
//   use-cases        .ai/repo/use-cases/studio-*.md
//   claims           the studio-* claims of docs/CLAIMS.yaml
//   rules            the project rules the Studio features name
//   plan             the plan issues of milestones M021-M033 (.ai/repo/project/issues/V4xx.yaml)
// Counts that change with every pull request (tests, the current artifact size) are snapshot
// values beside the command that measures them; only the command is checked. The v3.0.0 and
// v3.1.0 artifact sizes are fixed by their tags and are checked when the tags are present.
//   node --test tests/unit/v31-studio-report.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { EDGE_PROPERTY_FIELDS, PORT_TYPE_LIST, PORT_VISUALS, ROLES_BY_TYPE }
  from '../../src/js/studio/ports.js';
import {
  AUTOMATION_CURVES, CLIP_KINDS, CLIP_TIME_BASES, EVENT_ACTIONS, MARKER_KINDS,
  MEASUREMENT_ACTIONS, STUDIO_HASH_VERSION, STUDIO_KIND, STUDIO_SCHEMA_VERSION, TIME_MODES,
  TRACK_KINDS,
} from '../../src/js/studio/schema.js';
import { PATCH_KIND, PATCH_SCHEMA_VERSION } from '../../src/js/studio/patches.js';
import { ACTION_TYPES } from '../../src/js/studio/actions.js';
import { listTemplates } from '../../src/js/studio/templates/index.js';
import { MEASURED_PATH_VERSION } from '../../src/js/experiments/hash.js';
import {
  EXPERIMENT_BASE_SCHEMA_VERSION, EXPERIMENT_KIND, EXPERIMENT_SCHEMA_VERSION,
} from '../../src/js/experiments/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPORT = 'docs/v31/studio-report.md';
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const list = (rel) => readdirSync(path.join(ROOT, rel)).sort();
const report = () => read(REPORT);

/** The lines between <!-- name:begin --> and <!-- name:end --> (trimmed, non-empty). */
function region(text, name) {
  const re = new RegExp(`<!-- ${name}:begin -->\\n([\\s\\S]*?)\\n<!-- ${name}:end -->`);
  const m = text.match(re);
  assert.ok(m, `region ${name} in ${REPORT}`);
  return m[1].split('\n').map((l) => l.trim()).filter(Boolean);
}

/** A table region without its header and separator rows. */
function rows(text, name, header) {
  const lines = region(text, name);
  const separator = `|${' --- |'.repeat(header.split('|').length - 2)}`;
  assert.deepEqual(lines.slice(0, 2), [header, separator], `${name} header`);
  return lines.slice(2);
}

/** The scalar fields and inline or block lists of a Markdown/YAML front matter (or a YAML file). */
function frontMatter(text) {
  const body = text.startsWith('---\n') ? text.slice(4, text.indexOf('\n---', 4)) : text;
  const out = {};
  let listKey = null;
  for (const line of body.split('\n')) {
    const item = line.match(/^ {2}- (.*)$/);
    if (item && listKey) { out[listKey].push(item[1].trim()); continue; }
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) { listKey = null; continue; }
    const [, key, raw] = kv;
    listKey = null;
    if (raw === '') { out[key] = []; listKey = key; continue; }
    if (raw.startsWith('[')) {
      out[key] = raw.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }
    out[key] = raw.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1').replace(/''/g, "'");
  }
  return out;
}

const studioFeatures = () => list('.ai/repo/features').filter((f) => /^studio.*\.md$/.test(f))
  .map((f) => ({ file: f, ...frontMatter(read(`.ai/repo/features/${f}`)) }));

test('§259 the report is a dated snapshot naming its commit', () => {
  assert.match(report(), /^Snapshot as of commit `[0-9a-f]{7,40}` \(\d{4}-\d{2}-\d{2}\)/m);
});

test('§259 schema versions are the constants in code', () => {
  assert.deepEqual(rows(report(), 'schema-versions', '| Record | Kind | Schema version |'), [
    `| Studio project (StudioModel) | ${STUDIO_KIND} | ${STUDIO_SCHEMA_VERSION} |`,
    `| Studio execution-state hash (studioHash) | ${STUDIO_KIND} | ${STUDIO_HASH_VERSION} |`,
    `| Studio patch | ${PATCH_KIND} | ${PATCH_SCHEMA_VERSION} |`,
    `| Measured path (experiment studio.measured) | ${EXPERIMENT_KIND} | `
      + `${MEASURED_PATH_VERSION} |`,
    `| Experiment run from Studio with a measured path | ${EXPERIMENT_KIND} | `
      + `${EXPERIMENT_SCHEMA_VERSION} |`,
    `| Every other experiment | ${EXPERIMENT_KIND} | ${EXPERIMENT_BASE_SCHEMA_VERSION} |`,
  ]);
});

test('§259 node types are the registry, by category in library order', () => {
  assert.deepEqual(rows(report(), 'node-types', '| Category | Count | Node types |'),
    NODE_REGISTRY.categories().map((c) => `| ${c.label} | ${c.types.length} | `
      + `${c.types.map((d) => `${d.displayName} \`${d.type}\``).join(', ')} |`));
});

test('§259 port types are the four typed ports with their roles, glyphs and edge props', () => {
  const header = '| Type | Roles | Glyph | Cable | Edge properties |';
  assert.deepEqual(rows(report(), 'port-types', header),
    PORT_TYPE_LIST.map((t) => `| ${t} | ${ROLES_BY_TYPE[t].join(', ')} | `
      + `${PORT_VISUALS[t].shape} | ${PORT_VISUALS[t].cable} | `
      + `${EDGE_PROPERTY_FIELDS[t].join(', ')} |`));
});

test('§259 the action layer lists every action type', () => {
  assert.deepEqual(region(report(), 'actions'), [ACTION_TYPES.map((a) => `\`${a}\``).join(', ')]);
});

test('§259 timeline and automation capabilities are the model enums', () => {
  const j = (xs) => xs.join(', ');
  assert.deepEqual(rows(report(), 'timeline', '| Model field | Values |'), [
    `| Track kinds | ${j(TRACK_KINDS)} |`,
    `| Clip kinds | ${j(CLIP_KINDS)} |`,
    `| Clip time bases | ${j(CLIP_TIME_BASES)} |`,
    `| Event clip actions | ${j(EVENT_ACTIONS)} |`,
    `| Measurement clip steps | ${j(MEASUREMENT_ACTIONS)} |`,
    `| Automation curves | ${j(AUTOMATION_CURVES)} |`,
    `| Marker kinds | ${j(MARKER_KINDS)} |`,
    `| Transport time modes | ${j(TIME_MODES)} |`,
  ]);
});

test('§259 the shipped templates are listTemplates()', () => {
  assert.deepEqual(rows(report(), 'templates', '| Template id | Title | Category |'),
    listTemplates().map((t) => `| ${t.id} | ${t.title} | ${t.category} |`));
});

test('§259 the Studio browser suites are the ones `npm run test:studio` runs', () => {
  const script = JSON.parse(read('package.json')).scripts['test:studio'];
  const suites = script.split('&&').map((s) => s.trim().replace(/^node /, ''));
  assert.deepEqual(region(report(), 'browser-suites'), suites.map((s) => `- \`${s}\``));
});

test('§259 every command the report gives for a count exists', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  const lines = region(report(), 'commands').join('\n');
  const named = [...lines.matchAll(/`npm (?:run ([\w:-]+)|(test))\b[^`]*`/g)]
    .map((m) => m[1] || m[2]);
  assert.ok(named.length >= 3, 'the commands region names npm scripts');
  for (const name of named) assert.ok(scripts[name], `npm script ${name} exists`);
  for (const m of lines.matchAll(/`ls (tests\/[\w/.-]+?)\/([\w*.-]+)/g)) {
    const re = new RegExp(`^${m[2].replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
    assert.ok(list(m[1]).some((f) => re.test(f)), `ls ${m[1]}/${m[2]} matches a file`);
  }
});

test('§259 the v3.0.0 and v3.1.0 artifact sizes are the bytes at their tags', (t) => {
  const sizeRow = /^\| (v3\.[01]\.0) \| `[0-9a-f]+` \| ([\d,]+) \|/gm;
  const sizes = Object.fromEntries([...report().matchAll(sizeRow)]
    .map((m) => [m[1], Number(m[2].replace(/,/g, ''))]));
  assert.deepEqual(Object.keys(sizes), ['v3.0.0', 'v3.1.0']);
  for (const tag of Object.keys(sizes)) {
    const r = spawnSync('git', ['cat-file', '-s', `${tag}:dist/index.html`],
      { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) { t.diagnostic(`${tag} not in this checkout; size not checked`); continue; }
    assert.equal(Number(r.stdout.trim()), sizes[tag], `${tag} dist/index.html bytes`);
  }
});

test('§259 ADRs: every ADR tagged studio, with its title and status', () => {
  const expected = list('.ai/repo/adrs').filter((f) => /^\d{4}-.*\.md$/.test(f))
    .map((f) => ({ f, fm: frontMatter(read(`.ai/repo/adrs/${f}`)) }))
    .filter(({ fm }) => (fm.tags || []).includes('studio'))
    .map(({ f, fm }) => `| [${f.slice(0, 4)}](../../.ai/repo/adrs/${f}) | ${fm.title} | `
      + `${fm.status} |`);
  assert.deepEqual(rows(report(), 'adrs', '| ADR | Decision | Status |'), expected);
});

test('§259 features: every Studio feature record', () => {
  assert.deepEqual(rows(report(), 'features', '| Feature | Title | Status |'),
    studioFeatures().map((f) => `| [${f.id}](../../.ai/repo/features/${f.file}) | ${f.title} | `
      + `${f.status} |`));
});

test('§259 use cases: every Studio use case', () => {
  const expected = list('.ai/repo/use-cases').filter((f) => /^studio-.*\.md$/.test(f))
    .map((f) => {
      const fm = frontMatter(read(`.ai/repo/use-cases/${f}`));
      return `| [${fm.id}](../../.ai/repo/use-cases/${f}) | ${fm.title} |`;
    });
  assert.deepEqual(rows(report(), 'use-cases', '| Use case | Title |'), expected);
});

test('§259 claims: the studio-* claims of docs/CLAIMS.yaml', () => {
  const ids = [...read('docs/CLAIMS.yaml').matchAll(/^ {2}- id: (studio-[\w-]+)$/gm)]
    .map((m) => m[1]);
  assert.ok(ids.length > 0);
  assert.deepEqual(region(report(), 'claims'), [ids.map((id) => `\`${id}\``).join(', ')]);
});

test('§259 rules: the project rules the Studio features name, each in force', () => {
  const ids = [...new Set(studioFeatures().flatMap((f) => f.rules || []))].sort();
  for (const id of ids) {
    const name = id.replace(/^project\./, '');
    assert.ok(list('.ai/repo/rules/project').some((f) => f.startsWith(`${name}.v`)), `rule ${id}`);
  }
  assert.deepEqual(region(report(), 'rules'), [ids.map((id) => `\`${id}\``).join(', ')]);
});

test('§259 plan: the issues of milestones M021-M033, by milestone', () => {
  const byMilestone = new Map();
  for (const f of list('.ai/repo/project/issues').filter((x) => /^V4\d\d\.yaml$/.test(x))) {
    const { id, milestone } = frontMatter(read(`.ai/repo/project/issues/${f}`));
    if (!byMilestone.has(milestone)) byMilestone.set(milestone, []);
    byMilestone.get(milestone).push(id);
  }
  const expected = [...byMilestone.keys()].sort().map((m) => {
    const { title } = frontMatter(read(`.ai/repo/project/milestones/${m}.yaml`));
    return `| ${m} | ${title} | ${byMilestone.get(m).join(', ')} |`;
  });
  assert.equal(expected.length, 13, 'M021-M033');
  assert.deepEqual(rows(report(), 'plan', '| Milestone | Title | Issues |'), expected);
});

test('§259 the report is linked from the README Studio section and the user guide', () => {
  const readme = read('README.md');
  const start = readme.indexOf('## The V3.1 Studio');
  const studio = readme.slice(start, readme.indexOf('\n## ', start + 5));
  assert.ok(studio.includes('(docs/v31/studio-report.md)'), 'README link');
  assert.ok(read('docs/v31/user-guide.md').includes('(studio-report.md)'), 'user guide link');
  assert.ok(existsSync(path.join(ROOT, REPORT)));
});

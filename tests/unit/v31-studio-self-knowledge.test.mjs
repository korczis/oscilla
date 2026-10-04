// V3.1 Studio repository self-knowledge (spec §266, §225, §19-§20; plan V432, V403).
//
// §266: a fresh agent must learn from the repository alone that Studio exists, that the
// StudioModel is its canonical state shared by compact and full views, that ports are typed,
// that it compiles into the one AudioEngine, that the timeline runs on the audio clock, that
// automation, measurement integration and experiment provenance exist, which feedback is
// rejected, the schema version, which tests prove each capability and which public release
// contains it. This test asks those questions of the canonical records (features, use cases,
// rules, ADRs, docs/CLAIMS.yaml, docs/v31/) and checks each answer against the shipped code,
// so a record that drifts from the code, or a capability that only the chat history knows,
// fails here.
//   node --test tests/unit/v31-studio-self-knowledge.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CABLE_HIT_PX, DRAG_THRESHOLD_PX, GRID, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP,
} from '../../src/js/ui/studio/graph-geometry.js';
import { EDITOR_DEFAULT_SNAP, TIMELINE_ZOOM } from '../../src/js/ui/studio/timeline-view.js';
import {
  DEFAULT_VIEW, STUDIO_FILE_EXTENSION, STUDIO_SCHEMA_VERSION,
} from '../../src/js/studio/schema.js';
import { PATCH_FILE_EXTENSION } from '../../src/js/studio/patches.js';
import { STUDIO_IMPORT_LIMITS } from '../../src/js/studio/validate.js';
import { STUDIO_HISTORY_LIMIT } from '../../src/js/studio/history.js';
import { PASTE_OFFSET } from '../../src/js/studio/actions.js';
import { PORT_TYPE_LIST } from '../../src/js/studio/ports.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => existsSync(path.join(ROOT, rel));
const list = (rel) => readdirSync(path.join(ROOT, rel)).sort();
const norm = (s) => s.replace(/\s+/g, ' ');
const unquote = (v) => {
  const t = v.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
};

/** The top-level scalars and flow lists of a Markdown record's front matter, and its body. */
function record(rel) {
  const text = read(rel);
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, `${rel} has front matter`);
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    fm[key] = raw.startsWith('[')
      ? raw.slice(1, raw.lastIndexOf(']')).split(',').map((s) => unquote(s)).filter(Boolean)
      : unquote(raw);
  }
  return { fm, body: m[2], text };
}

/** docs/CLAIMS.yaml as { id: { claim, source, implementation, test, status, note } }. */
function claims() {
  const out = {};
  let cur = null;
  for (const line of read('docs/CLAIMS.yaml').split('\n')) {
    const start = line.match(/^ {2}- id:\s*(\S+)/);
    if (start) { cur = { id: start[1] }; out[cur.id] = cur; continue; }
    const kv = cur && line.match(/^ {4}([a-z_]+):\s*(.*)$/);
    if (kv) cur[kv[1]] = unquote(kv[2]);
  }
  return out;
}

const CLAIMS = claims();
const STUDIO_CLAIMS = Object.values(CLAIMS).filter((c) => c.id.startsWith('studio-'));
const FEATURE_FILES = list('.ai/repo/features').filter((f) => /^studio(-.*)?\.md$/.test(f))
  .map((f) => `.ai/repo/features/${f}`);
const USE_CASE_FILES = list('.ai/repo/use-cases').filter((f) => /^studio-.*\.md$/.test(f))
  .map((f) => `.ai/repo/use-cases/${f}`);
const FEATURES = Object.fromEntries(FEATURE_FILES.map((f) => [record(f).fm.id, record(f)]));
const USE_CASES = Object.fromEntries(USE_CASE_FILES.map((f) => [record(f).fm.id, record(f)]));
const RULES = Object.fromEntries(list('.ai/repo/rules/project').filter((f) => f !== 'README.md')
  .map((f) => record(`.ai/repo/rules/project/${f}`)).map((r) => [r.fm.id, r]));
const ADRS = Object.fromEntries(list('.ai/repo/adrs').filter((f) => /^\d{4}-/.test(f))
  .map((f) => ({ file: `.ai/repo/adrs/${f}`, ...record(`.ai/repo/adrs/${f}`) }))
  .map((a) => [a.fm.id, a]));
const TEST_FILES = [
  ...list('tests/unit').filter((f) => f.endsWith('.mjs')).map((f) => `tests/unit/${f}`),
  ...list('tests/browser').filter((f) => f.endsWith('.cjs')).map((f) => `tests/browser/${f}`),
];
const TEST_CORPUS = TEST_FILES.map((f) => norm(read(f)));
const PKG = JSON.parse(read('package.json'));

/** Whether a test file is run by a script of the release gate (spec §232). */
function inReleaseGate(rel) {
  if (/^tests\/unit\/[^/]+\.test\.mjs$/.test(rel)) return PKG.scripts.test.includes('tests/unit/');
  const gate = ['test:engine', 'test:measure', 'test:studio', 'test:browser', 'test:dsp',
    'test:labs', 'test:sequencer'].map((s) => PKG.scripts[s] || '').join(' ');
  return gate.split(/\s+/).includes(rel);
}

/** Whether a quoted test title (… marks an elision) appears in some test file. */
function testTitleExists(q) {
  const parts = q.split('...').map((p) => norm(p).trim()).filter(Boolean);
  return TEST_CORPUS.some((c) => parts.every((p) => c.includes(p)));
}

// ---------------------------------------------------------------- §266 capabilities

// Each §266 question and the canonical records that answer it. Every record must exist, be in
// force (rule active, claim guaranteed, feature stable, use case active) and be reachable from
// the Studio features, so the answer never depends on a prompt or a chat.
const CAPABILITIES = [
  { q: 'canonical state is the StudioModel', rules: ['project.studio-model-is-canonical'],
    adrs: ['adr-0030'], claims: ['studio-model-plain-data'], features: ['studio'] },
  { q: 'compact and full views share it', adrs: ['adr-0030'],
    claims: ['studio-one-store-projections'], useCases: ['studio-compact-full-sync'] },
  { q: 'ports are typed', rules: ['project.typed-ports'], adrs: ['adr-0032'],
    claims: ['studio-typed-connections'], features: ['studio-signal-graph'] },
  { q: 'the graph compiles into the existing AudioEngine',
    rules: ['project.audio-engine-discipline'], adrs: ['adr-0035'],
    claims: ['studio-compiled-topology', 'studio-registry-reuses-engine'],
    useCases: ['studio-build-a-signal-path'] },
  { q: 'the timeline runs on the audio clock', adrs: ['adr-0036'],
    claims: ['studio-transport-audio-clock'], features: ['studio-timeline'],
    useCases: ['studio-sequence-multiple-events'] },
  { q: 'automation exists, separate from modulation', adrs: ['adr-0037'],
    claims: ['studio-automation-model'], features: ['studio-automation'],
    useCases: ['studio-automate-a-parameter'] },
  { q: 'measurement integration', adrs: ['adr-0038'], claims: ['studio-measurement-topology'],
    features: ['studio-measurement-routing'], useCases: ['studio-define-a-measurement-pipeline'] },
  { q: 'the topology is recorded in experiments', adrs: ['adr-0038'],
    claims: ['studio-experiment-provenance'],
    useCases: ['studio-topology-in-experiment-provenance'] },
  { q: 'feedback restrictions', rules: ['project.no-silent-feedback'], adrs: ['adr-0033'],
    claims: ['studio-feedback-rejected'], useCases: ['studio-reject-an-invalid-connection'] },
  { q: 'the schema version', adrs: ['adr-0030'], claims: ['studio-schema-version'],
    features: ['studio-patches'] },
];

const namedByFeatures = (key) => new Set(Object.values(FEATURES).flatMap((f) => f.fm[key] || []));

test('§266 Studio exists: a stable feature, a README section and the workspace in the page', () => {
  const studio = FEATURES.studio;
  assert.ok(studio, 'feature studio');
  assert.equal(studio.fm.status, 'stable');
  assert.ok(!/not (yet )?in the shipped product/i.test(studio.body), 'studio.md says it shipped');
  assert.ok(read('README.md').includes('\n## The V3.1 Studio\n'), 'README Studio section');
  assert.ok(read('src/index.html').includes('id="osc-view-studio"'), 'Studio workspace markup');
  for (const sub of ['studio-signal-graph', 'studio-timeline', 'studio-automation',
    'studio-patches', 'studio-measurement-routing']) {
    assert.ok(FEATURES[sub], `feature ${sub}`);
    assert.ok(studio.fm.related.includes(sub), `studio relates ${sub}`);
  }
});

for (const cap of CAPABILITIES) {
  test(`§266 the repository answers: ${cap.q}`, () => {
    for (const id of cap.rules || []) {
      assert.ok(RULES[id], `rule ${id}`);
      assert.equal(RULES[id].fm.status, 'active', `rule ${id} is active`);
      assert.ok(namedByFeatures('rules').has(id), `a Studio feature names rule ${id}`);
    }
    for (const id of cap.adrs || []) {
      assert.ok(ADRS[id], `ADR ${id}`);
      assert.ok(namedByFeatures('adrs').has(id), `a Studio feature names ${id}`);
    }
    for (const id of cap.claims || []) {
      assert.ok(CLAIMS[id], `claim ${id}`);
      assert.equal(CLAIMS[id].status, 'guaranteed', `claim ${id} is guaranteed`);
      assert.ok(namedByFeatures('claims').has(id), `a Studio feature names claim ${id}`);
    }
    for (const id of cap.features || []) {
      assert.equal(FEATURES[id] && FEATURES[id].fm.status, 'stable', `feature ${id} is stable`);
    }
    for (const id of cap.useCases || []) {
      assert.equal(USE_CASES[id] && USE_CASES[id].fm.status, 'active', `use case ${id}`);
      assert.ok(namedByFeatures('use_cases').has(id), `a Studio feature names use case ${id}`);
    }
  });
}

test('§266 the typed-port rule names exactly the port types the code defines', () => {
  const statement = RULES['project.typed-ports'].fm.statement;
  const named = statement.match(/\(([A-Z, ]+)\)/);
  assert.ok(named, 'the rule lists the port types');
  assert.deepEqual(named[1].split(',').map((s) => s.trim()), [...PORT_TYPE_LIST]);
});

test('§266 the documented Studio schema version is the one the code writes', () => {
  const doc = read('docs/v31/studio-model.md');
  assert.ok(doc.includes(`\`STUDIO_SCHEMA_VERSION = ${STUDIO_SCHEMA_VERSION}\``), 'module table');
  assert.ok(doc.includes(`kind: 'oscilla-studio', schemaVersion: ${STUDIO_SCHEMA_VERSION}`),
    'model shape');
});

test('§266 which tests prove each capability: every Studio claim is guaranteed, its files '
  + 'exist, its test runs in the release gate and the test titles it quotes exist', () => {
  assert.ok(STUDIO_CLAIMS.length >= CAPABILITIES.length, 'Studio claims present');
  for (const c of STUDIO_CLAIMS) {
    assert.equal(c.status, 'guaranteed', `${c.id} is guaranteed`);
    for (const key of ['source', 'implementation', 'test']) {
      assert.ok(c[key] && c[key] !== '-' && exists(c[key]), `${c.id} ${key} ${c[key]} exists`);
    }
    assert.ok(inReleaseGate(c.test), `${c.id}: ${c.test} runs in the release gate`);
    for (const q of (c.note || '').match(/"[^"]+"/g) || []) {
      assert.ok(testTitleExists(q.slice(1, -1)), `${c.id} quotes a test that exists: ${q}`);
    }
    for (const [, name] of (c.note || '').matchAll(/\b[Cc]hecks? ([a-z][a-z0-9-]+)/g)) {
      assert.ok(TEST_FILES.some((f) => f.startsWith('tests/browser/v31-')
        && read(f).includes(name)), `${c.id} names a browser check that exists: ${name}`);
    }
  }
});

test('§266 which public release contains Studio: the record names one, no later than the '
  + 'current version, and the tag holds the Studio model where tags are present', () => {
  const m = FEATURES.studio.body.match(/First public release: `v(\d+)\.(\d+)\.(\d+)`/);
  assert.ok(m, 'features/studio.md names the first public release');
  const first = m.slice(1, 4).map(Number);
  const current = PKG.version.split(/[.-]/).slice(0, 3).map(Number);
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  assert.ok(cmp(first, [3, 1, 0]) >= 0, 'not before V3.1');
  assert.ok(cmp(first, current) <= 0, 'not after the current version');
  let tags = [];
  try {
    tags = execFileSync('git', ['tag', '--list', 'v*'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch { /* no git here: the version bound above is the check */ }
  const tag = `v${first.join('.')}`;
  if (tags.length > 0) {
    assert.ok(tags.includes(tag), `tag ${tag} exists`);
    execFileSync('git', ['cat-file', '-e', `${tag}:src/js/studio/schema.js`], { cwd: ROOT });
    const prev = tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
      .map((t) => t.slice(1).split('.').map(Number)).filter((v) => cmp(v, first) < 0)
      .sort(cmp).pop();
    if (prev) {
      assert.throws(() => execFileSync('git', ['cat-file', '-e',
        `v${prev.join('.')}:src/js/studio/schema.js`], { cwd: ROOT, stdio: 'ignore' }),
      `v${prev.join('.')} has no Studio, so ${tag} is the first`);
    }
  }
});

// ---------------------------------------------------------------- §225 no orphan records

test('§225 every Studio feature resolves what it names', () => {
  const featureIds = new Set(list('.ai/repo/features').filter((f) => f.endsWith('.md'))
    .map((f) => record(`.ai/repo/features/${f}`).fm.id));
  for (const [id, f] of Object.entries(FEATURES)) {
    assert.equal(f.fm.status, 'stable', `${id} is stable`);
    for (const r of f.fm.rules || []) {
      assert.ok(RULES[r] || r.startsWith('majordomus.'), `${id}: rule ${r}`);
    }
    for (const a of f.fm.adrs || []) assert.ok(ADRS[a], `${id}: ${a}`);
    for (const c of f.fm.claims || []) assert.ok(CLAIMS[c], `${id}: claim ${c}`);
    for (const u of f.fm.use_cases || []) assert.ok(USE_CASES[u], `${id}: use case ${u}`);
    for (const r of f.fm.related || []) assert.ok(featureIds.has(r), `${id}: related ${r}`);
    for (const d of f.fm.docs || []) assert.ok(exists(d), `${id}: doc ${d}`);
    for (const [p] of f.text.matchAll(/\b(?:src|tests|docs|scripts)\/[\w./-]+\.(?:m?js|cjs|md)\b/g)) {
      assert.ok(exists(p), `${id} cites ${p}`);
    }
  }
});

test('§225 every Studio use case is named by a feature, resolves its claims and quotes '
  + 'tests that exist', () => {
  const named = namedByFeatures('use_cases');
  for (const [id, u] of Object.entries(USE_CASES)) {
    assert.equal(u.fm.status, 'active', `${id} is active`);
    assert.ok(named.has(id), `${id} is named by a Studio feature`);
    for (const c of u.fm.claims || []) assert.ok(CLAIMS[c], `${id}: claim ${c}`);
    const proves = u.body.match(/# What proves it\n([\s\S]*?)\n# /);
    assert.ok(proves, `${id} says what proves it`);
    for (const q of proves[1].match(/"[^"]+"/g) || []) {
      assert.ok(testTitleExists(q.slice(1, -1)), `${id} quotes a test that exists: ${norm(q)}`);
    }
    for (const [p] of u.text.matchAll(/\b(?:src|tests|docs|scripts)\/[\w./-]+\.(?:m?js|cjs|md)\b/g)) {
      assert.ok(exists(p), `${id} cites ${p}`);
    }
  }
});

test('§225 every Studio claim is named by a Studio feature or use case', () => {
  const named = new Set([...namedByFeatures('claims'),
    ...Object.values(USE_CASES).flatMap((u) => u.fm.claims || [])]);
  for (const c of STUDIO_CLAIMS) assert.ok(named.has(c.id), `${c.id} is not an orphan`);
});

// ---------------------------------------------------------------- §19-§20 decisions, questions

test('§19 the decisions table of studio-model.md is what the code decided, line by line', () => {
  const doc = read('docs/v31/studio-model.md');
  const m = doc.match(/<!-- studio-decisions:begin -->\n([\s\S]*?)\n<!-- studio-decisions:end -->/);
  assert.ok(m, 'studio-decisions region');
  const expected = {
    ZOOM_MIN: String(ZOOM_MIN),
    ZOOM_MAX: String(ZOOM_MAX),
    ZOOM_STEP: String(ZOOM_STEP),
    GRID: `${GRID} units`,
    DRAG_THRESHOLD_PX: `${DRAG_THRESHOLD_PX} px`,
    CABLE_HIT_PX: `${CABLE_HIT_PX.fine} px fine pointer, ${CABLE_HIT_PX.coarse} px coarse pointer`,
    STUDIO_SCHEMA_VERSION: String(STUDIO_SCHEMA_VERSION),
    STUDIO_FILE_EXTENSION,
    PATCH_FILE_EXTENSION,
    pxPerSecond: `${DEFAULT_VIEW.timeline.pxPerSecond} px/s`,
    TIMELINE_ZOOM: `${TIMELINE_ZOOM.min}-${TIMELINE_ZOOM.max} px/s`,
    EDITOR_DEFAULT_SNAP: `${EDITOR_DEFAULT_SNAP.gridS} s time grid`,
    STUDIO_IMPORT_LIMITS: `${STUDIO_IMPORT_LIMITS.nodes} nodes`,
    STUDIO_HISTORY_LIMIT: `${STUDIO_HISTORY_LIMIT} entries`,
    PASTE_OFFSET: `(${PASTE_OFFSET.x}, ${PASTE_OFFSET.y}) units`,
  };
  const rows = m[1].split('\n').slice(2);
  const seen = new Set();
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    assert.equal(cells.length, 4, `row ${row}`);
    const [, value, nameCell, whereCell] = cells;
    const name = nameCell.replace(/`/g, '');
    const where = whereCell.replace(/`/g, '').match(/^(.+):(\d+)$/);
    assert.ok(where, `row ${name} cites file:line`);
    const lines = read(where[1]).split('\n');
    assert.ok(lines[Number(where[2]) - 1].includes(name),
      `${where[1]}:${where[2]} holds ${name}`);
    if (name in expected) assert.equal(value, expected[name], `${name} value`);
    seen.add(name);
  }
  for (const name of Object.keys(expected)) assert.ok(seen.has(name), `row for ${name}`);
  assert.ok(!/not decided/i.test(doc), 'no decided value is described as undecided');
});

test('§20 every Studio ADR with open questions carries a dated resolution note after them', () => {
  // The V3.1 Studio ADRs are 0030-0038 (spec §16; their block-list tags are not parsed here).
  const studioAdrs = Object.values(ADRS).filter((a) => /^adr-003[0-8]$/.test(a.fm.id));
  assert.equal(studioAdrs.length, 9, 'ADRs 0030-0038');
  for (const a of studioAdrs) {
    const open = a.body.search(/^## (Open questions|Recorded values and open questions)$/m);
    if (open < 0) continue;
    const res = a.body.search(/^## Resolution notes$/m);
    assert.ok(res > open, `${a.fm.id} has resolution notes after its open questions`);
    assert.match(a.body.slice(res), /^### \d{4}-\d{2}-\d{2}: /m, `${a.fm.id} note is dated`);
    assert.equal(a.fm.status, 'proposed', `${a.fm.id} keeps its status`);
  }
});

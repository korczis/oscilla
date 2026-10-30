// Numbers and lists in prose that copy the code, held to the code they copy.
//
// A count or a list a document repeats from the code either goes (the document points to the
// source) or is held here: each test reads the source of truth (package.json, a module's
// export, a fixture, a workflow) and the sentence that copies it, and fails when they part.
// A count a document no longer states is not required; one it states must be the code's.
//
//   - tests/README.md: the order of `release-gate`, `verify` and `test:release` is
//     package.json's; a freeze vector count is the golden's `meta.count`; the Playwright image
//     of the container command is the one ci.yml runs;
//   - README.md: the Testing table names every browser suite and visual script the release
//     scripts run; the privacy section's 0.3 s / 3 s / 1.5 s are PREFLIGHT_LEVEL_S,
//     REFERENCE_CAPTURE_S and DEFAULT_TIMING.postRollS; the navigation entries and groups are
//     src/index.html's; the generator patterns are PATTERNS and the sequencer blocks
//     BLOCK_TYPES; About is a workspace, never "the About dialog";
//   - docs/: a count stated beside `KNOWN_ALGORITHM_IDS` is its length (docs/v3/ included: its
//     catalogue describes the current build beside dated change notes, so it is held where it
//     names the code, not exempt as history); the node registry list of
//     docs/v31/studio-model.md is NODE_REGISTRY.list(); the template table of
//     docs/v31/patches-and-provenance.md is STUDIO_TEMPLATES.
//   node --test tests/unit/docs-derived.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PREFLIGHT_LEVEL_S } from '../../src/js/measurement/capture.js';
import { NAV_TREE } from '../../src/js/ui/shell.js';
import { REFERENCE_CAPTURE_S } from '../../src/js/calibration/reference.js';
import { DEFAULT_TIMING } from '../../src/js/measurement/engine.js';
import { KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';
import { PATTERNS } from '../../src/js/audio/patterns.js';
import { BLOCK_TYPES } from '../../src/js/sequencer/model.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { STUDIO_TEMPLATES } from '../../src/js/studio/templates/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (t) => t.replace(/\s+/g, ' ');
const PKG = JSON.parse(read('package.json'));
const README = read('README.md');
const TESTS_README = read('tests/README.md');

/** The text of a `## ` section of a Markdown document, up to the next `## `. */
function section(text, heading) {
  const start = text.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `the section "## ${heading}" exists`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? text.length : end);
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];
const numberOf = (word) => (/^\d+$/.test(word) ? Number(word)
  : NUMBER_WORDS.indexOf(word.toLowerCase()));

/** "a, b and c" → ['a', 'b', 'c']. */
const series = (text) => text.split(/,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------- tests/README.md

/** One step of an npm script, as tests/README.md names it. */
function stepName(cmd) {
  if (cmd === 'npm test') return '`npm test`';
  const run = cmd.match(/^npm run ([\w:-]+)$/);
  if (run) return `\`${run[1]}\``;
  const node = cmd.match(/^node ((?:scripts|tests)\/\S+)$/);
  return `\`${node ? node[1] : cmd}\``;
}

/** The sentence tests/README.md gives for an npm script: "<name> runs, in order: a, b, c." */
export function orderSentence(script, scripts = PKG.scripts, name = `\`${script}\``) {
  const steps = scripts[script].split('&&').map((s) => stepName(s.trim()));
  return `${name} runs, in order: ${steps.join(', ')}.`;
}

const GATE_SENTENCES = (scripts = PKG.scripts) => [
  orderSentence('release-gate', scripts, '`npm run release-gate`'),
  orderSentence('verify', scripts),
  orderSentence('test:release', scripts),
];

test('tests/README.md gives the order of release-gate, verify and test:release as package.json', () => {
  const text = flat(TESTS_README);
  for (const s of GATE_SENTENCES()) assert.ok(text.includes(s), `tests/README.md says: ${s}`);
});

test('mutation: a step added to verify is a sentence tests/README.md no longer has', () => {
  const scripts = { ...PKG.scripts, verify: `${PKG.scripts.verify} && npm run lint` };
  const text = flat(TESTS_README);
  assert.ok(!text.includes(GATE_SENTENCES(scripts)[1]));
  assert.equal(orderSentence('x', { x: 'npm test && npm run a:b && node scripts/c.mjs && d e' }),
    '`x` runs, in order: `npm test`, `a:b`, `scripts/c.mjs`, `d e`.');
});

test('a freeze vector count, where a document states one, is the golden\'s meta.count', () => {
  const golden = JSON.parse(read('tests/freeze/golden-a7b7a23.json'));
  assert.equal(golden.meta.count, golden.cases.length, 'the golden counts its own cases');
  for (const [rel, text] of [['README.md', README], ['tests/README.md', TESTS_README]]) {
    for (const [phrase, n] of flat(text).matchAll(/(?<![\w-])(\d[\d ]*) (?:golden )?vectors\b/g)) {
      assert.equal(Number(n.replace(/ /g, '')), golden.meta.count, `${rel}: "${phrase}"`);
    }
  }
});

test('the Playwright image tests/README.md names is the one ci.yml runs', () => {
  const ci = read('.github/workflows/ci.yml');
  const images = (t) => [...t.matchAll(/mcr\.microsoft\.com\/playwright:(v[\w.-]+)/g)]
    .map((m) => m[1]);
  const pinned = [...new Set(images(ci))];
  assert.equal(pinned.length, 1, `ci.yml runs one Playwright image (${pinned})`);
  for (const tag of images(TESTS_README)) assert.equal(tag, pinned[0]);
  assert.equal(pinned[0].match(/^v(\d+\.\d+\.\d+)/)[1], PKG.devDependencies.playwright,
    'the image is the Playwright package.json installs');
});

// ---------------------------------------------------------------- README.md

/** The repository files a script runs, through `npm run` too: [{ script, file }]. */
function filesRun(script, scripts = PKG.scripts, seen = new Set()) {
  if (seen.has(script) || !scripts[script]) return [];
  seen.add(script);
  const body = scripts[script];
  return [
    ...[...body.matchAll(/\bnode ((?:tests|scripts)\/\S+)/g)].map((m) => ({ script, file: m[1] })),
    ...[...body.matchAll(/\bnpm run ([\w:-]+)/g)].flatMap((m) => filesRun(m[1], scripts, seen)),
  ];
}

/** The browser suites and visual scripts `test:release` runs that the Testing table omits. */
export function testingTableOmits(readme = README, scripts = PKG.scripts) {
  const table = section(readme, 'Testing');
  return filesRun('test:release', scripts)
    .filter(({ file }) => !table.includes(`\`${file}\``))
    .map(({ script, file }) => `${script}: ${file}`);
}

test('the README Testing table names every suite and visual script test:release runs', () => {
  const run = filesRun('test:release');
  assert.ok(run.length > 20, `the release scripts are read (${run.length} files)`);
  assert.deepEqual(testingTableOmits(), []);
});

test('mutation: a suite added to test:studio and missing from the Testing table is named', () => {
  const scripts = { ...PKG.scripts,
    'test:studio': `${PKG.scripts['test:studio']} && node tests/browser/v31-studio-new.cjs` };
  const before = new Set(testingTableOmits());
  assert.deepEqual(testingTableOmits(README, scripts).filter((x) => !before.has(x)),
    ['test:studio: tests/browser/v31-studio-new.cjs']);
});

test('the README privacy section states the capture windows the code has', () => {
  const privacy = flat(section(README, 'Privacy'));
  assert.ok(privacy.includes(`input level from a ${PREFLIGHT_LEVEL_S} s window`),
    `the setup check window is PREFLIGHT_LEVEL_S (${PREFLIGHT_LEVEL_S} s)`);
  assert.ok(privacy.includes(`the reference capture (${REFERENCE_CAPTURE_S} s)`),
    `the reference capture is REFERENCE_CAPTURE_S (${REFERENCE_CAPTURE_S} s)`);
  assert.ok(privacy.includes(`(${DEFAULT_TIMING.postRollS} s by default)`),
    `the post-roll is DEFAULT_TIMING.postRollS (${DEFAULT_TIMING.postRollS} s)`);
});

test('the README never calls About a dialog: it is a workspace', () => {
  for (const [rel, text] of [['README.md', README], ['tests/README.md', TESTS_README],
    ['docs/GLOSSARY.md', read('docs/GLOSSARY.md')]]) {
    const said = flat(text).match(/.{0,40}\bAbout dialog\b.{0,20}/);
    assert.ok(!said, `${rel} names the About workspace: "${said && said[0]}"`);
  }
  assert.ok(!read('src/index.html').includes('osc-dlg-about'), 'there is no About dialog');
});

/** The sidebar navigation (shell.js NAV_TREE): top-level labels and each group's labels. */
function navigation() {
  return { top: NAV_TREE.map((e) => e.label),
    groups: NAV_TREE.filter((e) => e.kind === 'group')
      .map((g) => [g.label, g.items.map((w) => w.label)]) };
}

test('the README navigation names the sidebar entries and groups of the registry, in order', () => {
  const { top, groups } = navigation();
  assert.ok(top.length >= 5 && groups.length >= 1, 'the navigation is read');
  const text = flat(section(README, 'Navigation'));
  const entries = text.match(/The sidebar has (?:(\w+) )?entries: ([^.]*), in that order\./);
  assert.ok(entries, 'the README lists the sidebar entries');
  if (entries[1] && numberOf(entries[1]) >= 0) {
    assert.equal(numberOf(entries[1]), top.length, `"${entries[1]} entries"`);
  }
  assert.deepEqual(series(entries[2]).map((s) => s.replace(/\*\*/g, '')), top);
  for (const [group, items] of groups) {
    const m = text.match(new RegExp(`${group} opens ([^;.]*)[;.]`));
    assert.ok(m, `the README says what ${group} opens`);
    assert.deepEqual(series(m[1]), items, `${group} opens ${items.join(', ')}`);
  }
});

// The README's words for each generator pattern of audio/patterns.js. A new pattern needs its
// words here and in the README; a removed one fails until both drop it.
const PATTERN_WORDS = {
  tone: 'continuous', finite: 'finite tone', pulse: 'pulse', burst: 'burst',
  sweepUp: 'sweep up/down', sweepDown: 'sweep up/down', pingpong: 'ping-pong', chirp: 'chirp',
  siren: 'siren', alternating: 'alternating', wobble: 'wobble', am: 'AM', fm: 'FM',
  random: 'random', octave: 'octave-stepping', sequence: 'user-defined step sequences',
};

test('the README generator list names every pattern of PATTERNS, and the blocks BLOCK_TYPES', () => {
  const lab = flat(section(README, 'The V2 laboratory'));
  const generator = lab.match(/\*\*Generator:\*\*([^*]*)/)[1];
  assert.deepEqual(PATTERNS.map((p) => p.id).sort(), Object.keys(PATTERN_WORDS).sort(),
    'every pattern has its README words (PATTERN_WORDS) and no other');
  for (const [id, words] of Object.entries(PATTERN_WORDS)) {
    assert.ok(generator.includes(words), `the Generator bullet names ${id} as "${words}"`);
  }
  const blocks = lab.match(/\*\*Sequencer:\*\* a timeline of ([^.]*?) blocks,/);
  assert.ok(blocks, 'the Sequencer bullet lists its block types');
  assert.deepEqual(series(blocks[1]).map((b) => b.toLowerCase()), BLOCK_TYPES);
});

// ---------------------------------------------------------------- docs/

function markdownUnder(rel) {
  return readdirSync(path.join(ROOT, rel), { withFileTypes: true }).flatMap((d) => {
    const p = `${rel}/${d.name}`;
    if (d.isDirectory()) return markdownUnder(p);
    return p.endsWith('.md') ? [p] : [];
  });
}

test('a count stated beside KNOWN_ALGORITHM_IDS in docs/ is its length', () => {
  const seen = [];
  for (const rel of markdownUnder('docs')) {
    const text = flat(read(rel));
    for (const [phrase, n] of text.matchAll(/`KNOWN_ALGORITHM_IDS` \((\d+)\b/g)) {
      seen.push(rel);
      assert.equal(Number(n), KNOWN_ALGORITHM_IDS.length,
        `${rel}: "${phrase}" (KNOWN_ALGORITHM_IDS has ${KNOWN_ALGORITHM_IDS.length})`);
    }
    for (const [phrase] of text.matchAll(/fixtures\/v3\/<id>\.json` \([\d.]+ KB in all\)/g)) {
      assert.fail(`${rel}: "${phrase}": the fixtures' size is not held; drop it`);
    }
  }
  const fixtures = readdirSync(path.join(ROOT, 'tests/unit/fixtures/v3'))
    .filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(fixtures, [...KNOWN_ALGORITHM_IDS].sort(), 'one golden fixture per known ID');
});

test('the node registry list of docs/v31/studio-model.md is NODE_REGISTRY.list()', () => {
  const doc = flat(section(read('docs/v31/studio-model.md'), 'Node registry'));
  const defs = NODE_REGISTRY.list();
  const count = doc.match(/`NODE_REGISTRY` holds (\w+) frozen definitions/);
  if (count) assert.equal(numberOf(count[1]), defs.length, `"${count[0]}"`);
  const listed = doc.slice(0, doc.indexOf('A definition has'));
  const groups = [...listed.matchAll(/([A-Z][a-z]+) \(([^)]*)\)/g)]
    .map(([, category, names]) => [category.toUpperCase(), series(names)]);
  const want = [];
  for (const d of defs) {
    const last = want.at(-1);
    if (last && last[0] === d.category) last[1].push(d.displayName);
    else want.push([d.category, [d.displayName]]);
  }
  assert.deepEqual(groups, want);
});

test('the template table of docs/v31/patches-and-provenance.md is STUDIO_TEMPLATES', () => {
  const doc = read('docs/v31/patches-and-provenance.md');
  const from = doc.indexOf('| Id | Graph |');
  const table = doc.slice(from, doc.indexOf('\n\n', from));
  const ids = [...table.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(ids, STUDIO_TEMPLATES.map((t) => t.id));
  for (const [phrase, n] of flat(doc).matchAll(/\bthe (\w+) templates\b/g)) {
    if (numberOf(n) >= 0) assert.equal(numberOf(n), STUDIO_TEMPLATES.length, `"${phrase}"`);
  }
});

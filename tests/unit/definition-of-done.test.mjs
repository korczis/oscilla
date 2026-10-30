// project.definition-of-done: scripts/definition-of-done.mjs on fixture pull requests. Each
// fixture is a `main` commit and a PR branch; the script is run as CI runs it (a process, the
// PR JSON of `gh pr view`) and judged by its exit status and what it prints. The bodies are
// tests/unit/fixtures/definition-of-done/*.md; every clause is refused on its own, with a
// line that starts `project.definition-of-done:`, and every way to pass is shown.
//   node --test tests/unit/definition-of-done.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRepo } from './fixtures/git-repo.mjs';
import {
  ITEMS, dodSection, evidenceLookup, itemEvidence, producersOf, urlKeys, waiverOf,
} from '../../scripts/definition-of-done.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'definition-of-done.mjs');
const WRAPPER = path.join(ROOT, '.github', 'scripts', 'base-rule.sh');
const FIXTURES = path.join(ROOT, 'tests', 'unit', 'fixtures', 'definition-of-done');
const body = (name) => readFileSync(path.join(FIXTURES, name), 'utf8');
const COMPLETE = body('complete.md');
const real = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'NODE_TEST_CONTEXT']) delete ENV[k];

const README = (...rows) => ['# Tests', '', '| File | Gate | What it proves |',
  '| --- | --- | --- |', '| `unit/app.test.mjs` | GATE | the app |',
  '| `browser/app.cjs` | GATE | the app in a browser |', ...rows, ''].join('\n');
const URL_STATE = (extra = '') => `export const LINK_KEYS = Object.freeze({ mode: 'm'${extra} });
export function hashOf(mode) {
  const q = new URLSearchParams();
  q.set('v', '1');
  q.set(LINK_KEYS.mode, mode);
  return q.toString();
}
`;

/**
 * main: an app module, a url-state module, a browser suite, docs, tests/README.md and the plan
 * records and the script the bodies in tests/unit/fixtures/definition-of-done/ name (E999,
 * M999, scripts/release-cadence.mjs): an item counts only what the head holds.
 */
function fixture(t, files = {}) {
  const repo = gitRepo('oscilla-dod-');
  t.after(() => repo.dispose());
  repo.commit('base', {
    'src/js/ui/app.js': 'export const app = 1;\n',
    'src/js/core/url-state.js': URL_STATE(),
    'src/index.html': '<main><a href="#m=lab">Lab</a></main>\n',
    'tests/unit/app.test.mjs': "import test from 'node:test';\ntest('app', () => {});\n",
    'tests/browser/app.cjs': '// the app in a browser\n',
    'tests/README.md': README(),
    'docs/GUIDE.md': '# Guide\n',
    'README.md': 'fixture\n',
    '.ai/repo/project/issues/E999.yaml': 'id: E999\n',
    '.ai/repo/project/milestones/M999.yaml': 'id: M999\n',
    'scripts/release-cadence.mjs': '// the release cadence\n',
    ...files,
  });
  repo.branch('pr');
  return repo;
}

/** The change every passing src/ fixture carries: the app, its browser suite and its docs. */
const DONE = {
  'src/js/ui/app.js': 'export const app = 2;\n',
  'tests/browser/app.cjs': '// the app in a browser, at 2\n',
  'docs/GUIDE.md': '# Guide\n\nThe app is 2.\n',
};

function run(repo, { title = 'feat(ui): the app is 2', text = COMPLETE, headRefName,
  args = [] } = {}) {
  const pr = path.join(repo.dir, '..', `${path.basename(repo.dir)}.pr.json`);
  writeFileSync(pr, JSON.stringify({ title, body: text, headRefName }));
  const r = spawnSync(process.execPath, [SCRIPT, '--repo', repo.dir, '--pr-json', pr,
    '--base-branch', 'main', ...args], { encoding: 'utf8', env: ENV });
  spawnSync('rm', ['-f', pr]);
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/** The clauses a run refused, from its `project.definition-of-done: <clause>:` lines. */
const refused = (out) => [...out.matchAll(/^project\.definition-of-done: ([\w-]+):/gm)]
  .map((m) => m[1]);
/** Whether a line of the output is `project.definition-of-done: <clause>: <text>...`. */
const says = (out, clause, text) => out.split('\n')
  .some((l) => l.startsWith(`project.definition-of-done: ${clause}: ${text}`));

test('a src/ change with the section, a browser test and a doc passes', (t) => {
  const repo = fixture(t);
  repo.commit('feat', DONE);
  const r = run(repo);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /section: the six items/);
  assert.match(r.out, /deployed is not judged by the pull request/);
  assert.match(r.out, /definition-of-done: accepted/);
  const table = run(repo, { text: body('table.md') });
  assert.equal(table.status, 0, `a table of the items counts too\n${table.out}`);
});

test('a change outside src/ passes with nothing to judge, whatever its body', (t) => {
  const repo = fixture(t);
  repo.commit('docs', { 'docs/GUIDE.md': '# Guide\n\nMore.\n', 'scripts/x.mjs': '// x\n' });
  const r = run(repo, { title: 'docs(guide): more', text: '' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /none of the 2 changed path\(s\) is under src\/; nothing to judge/);
  assert.deepEqual(refused(r.out), []);
});

test('(a) a src/ change without the Definition of done section is refused', (t) => {
  const repo = fixture(t);
  repo.commit('feat', DONE);
  for (const text of ['', 'Plan: E999\n\nThe app is 2.\n',
    // quoted, in a code block or an HTML comment, the section is not the body's own
    `> ${COMPLETE.split('\n').join('\n> ')}`, `\`\`\`\n${COMPLETE}\n\`\`\`\n`,
    `<!--\n${COMPLETE}\n-->\n`]) {
    const r = run(repo, { text });
    assert.equal(r.status, 1, r.out);
    assert.deepEqual(refused(r.out), ['section'], r.out);
    assert.match(r.out, /^project\.definition-of-done: section: the body has no `Definition of /m);
  }
});

test('(a) an item that is missing, or names no path or plan id, is refused', (t) => {
  const repo = fixture(t);
  repo.commit('feat', DONE);
  const missing = run(repo, { text: COMPLETE.replace(/^- dynamics:.*\n/m, '') });
  assert.equal(missing.status, 1, missing.out);
  assert.ok(says(missing.out, 'section', 'the Definition of done lists no dynamics'), missing.out);
  const bare = run(repo, { text: COMPLETE.replace(/^- tested:.*$/m, '- tested: yes, fully') });
  assert.equal(bare.status, 1, bare.out);
  assert.match(bare.out, /^project\.definition-of-done: section: the item\(s\) tested name no /m);
  // the template as it comes: every item is a placeholder
  const template = real('.github/pull_request_template.md');
  const unfilled = run(repo, { text: template });
  assert.equal(unfilled.status, 1, unfilled.out);
  assert.ok(says(unfilled.out, 'section',
    'the item(s) extends, cross-links, dynamics, docs and routes, tested, deployed name no'),
  unfilled.out);
});

test('(a) an item counts a path or a plan id only when the head holds it', (t) => {
  const repo = fixture(t);
  repo.commit('feat', DONE);
  const tested = (text) => run(repo,
    { text: COMPLETE.replace(/^- tested:.*$/m, `- tested: ${text}`) });
  // a word that only looks like a file or an id, and a path or id the head does not hold
  for (const text of ['works like Node.js', 'the A440 tone', 'nothing.md', 'E998',
    '`src/js/ui/gone.js`', 'docs/none/', '`src/../README.md`']) {
    const r = tested(text);
    assert.equal(r.status, 1, `${text}\n${r.out}`);
    assert.deepEqual(refused(r.out), ['section'], text);
    assert.ok(says(r.out, 'section', 'the item(s) tested name no repository path'), text);
  }
  for (const text of ['E999', 'M999 and more', '`src/js/ui/app.js`', 'docs/', 'README.md',
    'tests/browser/app.cjs.']) {
    const r = tested(text);
    assert.equal(r.status, 0, `${text}\n${r.out}`);
  }
  // with --head the commit decides; without it, the working tree (a local run)
  writeFileSync(path.join(repo.dir, 'docs', 'draft.md'), '# Draft\n');
  assert.equal(tested('`docs/draft.md`').status, 0, 'the working tree holds the draft');
  const atHead = run(repo, { text: COMPLETE.replace(/^- tested:.*$/m, '- tested: docs/draft.md'),
    args: ['--head', 'HEAD'] });
  assert.equal(atHead.status, 1, atHead.out);
  assert.deepEqual(refused(atHead.out), ['section']);
  assert.equal(run(repo, { args: ['--head', 'HEAD'] }).status, 0, 'the head holds the rest');
});

test('(b) a src/ change without a browser test or its waiver is refused', (t) => {
  const repo = fixture(t);
  repo.commit('feat', { ...DONE, 'tests/browser/app.cjs': '// the app in a browser\n' });
  const r = run(repo);
  assert.equal(r.status, 1, r.out);
  assert.deepEqual(refused(r.out), ['browser']);
  assert.ok(says(r.out, 'browser', 'the pull request adds or changes no tests/browser/'), r.out);
  // a helper under tests/browser/lib is not a browser suite
  repo.commit('lib', { 'tests/browser/lib/helper.cjs': '// a helper\n' });
  assert.deepEqual(refused(run(repo).out), ['browser']);
});

test('(c) a src/ change without a doc or its waiver is refused', (t) => {
  const repo = fixture(t);
  repo.commit('feat', { ...DONE, 'docs/GUIDE.md': '# Guide\n' });
  const r = run(repo);
  assert.equal(r.status, 1, r.out);
  assert.deepEqual(refused(r.out), ['docs']);
  assert.ok(says(r.out, 'docs', 'the pull request changes nothing under docs/'), r.out);
  for (const doc of ['README.md', '.ai/repo/features/app.md']) {
    const other = fixture(t);
    other.commit('feat', { ...DONE, 'docs/GUIDE.md': '# Guide\n', [doc]: 'the app is 2\n' });
    assert.equal(run(other).status, 0, doc);
  }
});

test('a waiver with a real reason passes; without one, or not in the prose, it fails', (t) => {
  const repo = fixture(t);
  repo.commit('feat', { 'src/js/ui/app.js': 'export const app = 2;\n' });
  const waived = `${COMPLETE}\ndod-browser: n/a an internal constant no browser can observe\n`
    + '- dod-docs: n/a nothing a reader of the docs could see changed\n';
  const r = run(repo, { text: waived });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /browser: n\/a an internal constant no browser can observe/);
  assert.match(r.out, /docs: n\/a nothing a reader of the docs could see changed/);
  for (const [name, text] of [
    ['no reason', `${COMPLETE}\ndod-browser: n/a\ndod-docs: n/a\n`],
    ['the placeholder', `${COMPLETE}\ndod-browser: n/a <reason>\ndod-docs: n/a <reason>.\n`],
  ]) {
    const bad = run(repo, { text });
    assert.equal(bad.status, 1, `${name}\n${bad.out}`);
    assert.deepEqual(refused(bad.out), ['browser', 'docs'], name);
    assert.match(bad.out, /browser: `dod-browser: n\/a` without a reason/, name);
  }
  for (const text of [`${COMPLETE}\n> dod-browser: n/a quoted\n`,
    `${COMPLETE}\n\`\`\`\ndod-browser: n/a in code\n\`\`\`\n`,
    `${COMPLETE}\nWe could say dod-browser: n/a in a sentence.\n`]) {
    assert.ok(refused(run(repo, { text }).out).includes('browser'), text);
  }
});

test('(d) an added test file without its tests/README.md row is refused', (t) => {
  const repo = fixture(t);
  const added = {
    ...DONE,
    'tests/unit/app-two.test.mjs': "import test from 'node:test';\ntest('two', () => {});\n",
    'tests/browser/app-two.cjs': '// two\n',
  };
  repo.commit('feat', added);
  const r = run(repo);
  assert.equal(r.status, 1, r.out);
  assert.deepEqual(refused(r.out), ['tests-readme']);
  assert.ok(says(r.out, 'tests-readme', 'no tests/README.md row for tests/browser/app-two.cjs,'
    + ' tests/unit/app-two.test.mjs'), r.out);
  repo.commit('rows', { 'tests/README.md': README('| `unit/app-two.test.mjs` | GATE | two |',
    '| `browser/app-two.cjs` | GATE | two |') });
  const listed = run(repo);
  assert.equal(listed.status, 0, listed.out);
  assert.match(listed.out, /tests-readme: 2 added test file\(s\) listed/);
});

test('(e) a new url-state key without a route test is refused', (t) => {
  const repo = fixture(t);
  repo.commit('feat', { ...DONE, 'src/js/core/url-state.js': URL_STATE(", lab: 'lb'") });
  const r = run(repo);
  assert.equal(r.status, 1, r.out);
  assert.deepEqual(refused(r.out), ['url-state']);
  assert.ok(says(r.out, 'url-state',
    'new URL key(s) in src/js/core/url-state.js (lab, lb) and no changed'), r.out);
  repo.commit('route test', { 'tests/unit/url-state.test.mjs': '// lb round-trips\n',
    'tests/README.md': README('| `unit/url-state.test.mjs` | GATE | the keys |') });
  assert.equal(run(repo).status, 0);

  // a key set directly, in a new url-state module, proven by the navigation suite
  const other = fixture(t);
  other.commit('feat', { ...DONE,
    'src/js/core/url-state-lab.js': "export const lab = (q) => q.set('lab', '1');\n" });
  assert.deepEqual(refused(run(other).out), ['url-state']);
  other.commit('nav', { 'tests/browser/navigation.cjs': '// #lab=1 navigates\n',
    'tests/README.md': README('| `browser/navigation.cjs` | GATE | navigation |') });
  assert.equal(run(other).status, 0);

  // a change that adds no key needs no route test; a key in a comment is no key
  const same = fixture(t);
  same.commit('feat', { ...DONE, 'src/js/core/url-state.js': `${URL_STATE()}// tidied\n`
    + "// q.set('zz', 1);\n/* q.get('yy'); const OLD_KEY = 'xx'; */\n" });
  assert.equal(run(same).status, 0, run(same).out);
});

// The shapes src/js/core/url-state-measure.js writes a key in (RECIPE_HASH_KEY = 'mr', then
// q.set(RECIPE_HASH_KEY, ...)), and the other static ones a scan of literals alone missed.
const HASH_KEY = (v) => `export const RECIPE_HASH_KEY = '${v}';
export function writeRecipe(hash, param) {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  q.set(RECIPE_HASH_KEY, param);
  return q.toString();
}
`;

test('(e) a key in a *KEY constant, a KEYS object, a template or a params init is seen', (t) => {
  const shapes = {
    'a renamed *_KEY constant': [HASH_KEY('h'), HASH_KEY('hh')],
    'a new *_KEY constant': ['', HASH_KEY('mr')],
    'a key through another constant': ['', "const NAME = 'zz';\nq => q.set(NAME, 1);\n"],
    'a bare KEYS object': ['', "export const KEYS = { zoom: 'zz' };\n"],
    'a template literal': ['', 'export const z = (q) => q.set(`zz`, 1);\n'],
    'a URLSearchParams object': ['', "export const z = new URLSearchParams({ zz: '1' });\n"],
    'a URLSearchParams pair list': ['', "export const z = new URLSearchParams([['zz', 1]]);\n"],
  };
  for (const [name, [before, after]] of Object.entries(shapes)) {
    const repo = fixture(t, before ? { 'src/js/core/url-state-measure.js': before } : {});
    repo.commit('feat', { ...DONE, 'src/js/core/url-state-measure.js': after });
    const r = run(repo);
    assert.equal(r.status, 1, `${name}: ${r.out}`);
    assert.deepEqual(refused(r.out), ['url-state'], name);
  }
  // the same constant with the same value, moved, is no new key
  const moved = fixture(t, { 'src/js/core/url-state-measure.js': HASH_KEY('mr') });
  moved.commit('feat', { ...DONE,
    'src/js/core/url-state-measure.js': `// recipes\n${HASH_KEY('mr')}` });
  assert.equal(run(moved).status, 0);
  // the repository's own module: every key it writes is read
  const measure = urlKeys(real('src/js/core/url-state-measure.js'));
  for (const k of ['mr', 'f1', 'f2', 'phase']) assert.ok(measure.has(k), k);
});

test('(f) a new link producer without its integration-map row is refused', (t) => {
  const map = { rows: [{ producer: 'studio', control: 'nav-studio', target: '#m=studio' }] };
  const repo = fixture(t, { 'tests/browser/integration-map.json': JSON.stringify(map) });
  repo.commit('feat', { ...DONE,
    'src/index.html': '<main><a data-osc-link="lab" href="#m=lab">Lab</a></main>\n' });
  const r = run(repo);
  assert.equal(r.status, 1, r.out);
  assert.deepEqual(refused(r.out), ['integration-map']);
  assert.ok(says(r.out, 'integration-map',
    'no tests/browser/integration-map.json row for the new link producer(s) lab'), r.out);
  const rows = { rows: [...map.rows, { producer: 'lab', control: 'nav-lab', target: '#m=lab' }] };
  repo.commit('row', { 'tests/browser/integration-map.json': JSON.stringify(rows) });
  assert.equal(run(repo).status, 0);

  // an openIn call with a computed target needs the map changed by the pull request
  const calls = fixture(t, { 'tests/browser/integration-map.json': JSON.stringify(map) });
  calls.commit('feat', { ...DONE,
    'src/js/ui/app.js': 'export const app = (ui, id) => ui.openIn(`studio-${id}`, 2);\n' });
  assert.match(run(calls).out, /row for the new link producer\(s\) openIn\(`studio-\$\{id\}`, 2\)/);
  calls.commit('row', { 'tests/browser/integration-map.json': JSON.stringify(rows) });
  assert.equal(run(calls).status, 0);
});

test('(f) a computed or near-miss data-osc-link needs the map; a comment is no producer', (t) => {
  const map = { rows: [{ producer: 'studio-graph', control: 'nav-studio', target: '#m=studio' }] };
  const changedMap = { rows: [...map.rows, { producer: 'any', control: 'nav-any', target: '#' }] };
  const MAP = 'tests/browser/integration-map.json';
  for (const [name, file, text, id] of [
    ['a template literal', 'src/js/ui/app.js',
      'export const a = (t) => `<a data-osc-link="${t}">x</a>`;\n', 'data-osc-link="${t}"'],
    ['setAttribute with a variable', 'src/js/ui/app.js',
      "export const a = (el, t) => el.setAttribute('data-osc-link', t);\n", 'data-osc-link'],
    ['dataset.oscLink', 'src/js/ui/app.js',
      'export const a = (el, t) => { el.dataset.oscLink = t; };\n', 'dataset.oscLink'],
    ['an empty target', 'src/index.html', '<main><a data-osc-link="">S</a></main>\n',
      'data-osc-link=""'],
    ['a handlebars target', 'src/index.html', '<main><a data-osc-link="{{t}}">S</a></main>\n',
      'data-osc-link="{{t}}"'],
  ]) {
    const repo = fixture(t, { [MAP]: JSON.stringify(map) });
    repo.commit('feat', { ...DONE, [file]: text });
    const r = run(repo);
    assert.equal(r.status, 1, `${name}\n${r.out}`);
    assert.ok(says(r.out, 'integration-map',
      `no ${MAP} row for the new link producer(s) ${id}`), `${name}\n${r.out}`);
    // a computed target is judged by the map changing, as a computed openIn is
    repo.commit('row', { [MAP]: JSON.stringify(changedMap) });
    const rowed = run(repo);
    assert.equal(rowed.status, 0, `${name}, the map changed\n${rowed.out}`);
  }
  // a literal target matches a string of the map exactly: 'studio' is not 'studio-graph'
  const near = fixture(t, { [MAP]: JSON.stringify(map) });
  near.commit('feat', { ...DONE,
    'src/index.html': '<main><a data-osc-link="studio">S</a></main>\n' });
  const r = run(near);
  assert.equal(r.status, 1, r.out);
  assert.ok(says(r.out, 'integration-map', `no ${MAP} row for the new link producer(s) studio`),
    r.out);
  near.commit('unrelated row', { [MAP]: JSON.stringify(changedMap) });
  assert.equal(run(near).status, 1, 'a changed map does not row a literal target');
  // a commented call or assignment produces no link
  const commented = fixture(t, { [MAP]: JSON.stringify(map) });
  commented.commit('feat', { ...DONE, 'src/js/ui/app.js': "// ui.openIn('lab');\n"
    + "/* ui.sendTo('scope'); el.dataset.oscLink = t; */\nexport const app = 2; // openIn('x')\n",
  'src/index.html': '<main><!-- <a data-osc-link="lab"> --><a href="#m=lab">Lab</a></main>\n' });
  const c = run(commented);
  assert.equal(c.status, 0, c.out);
});

test('(f) until the base holds the integration map, the clause reports and passes', (t) => {
  const repo = fixture(t);
  repo.commit('feat', { ...DONE,
    'src/js/ui/app.js': "export const app = (ui) => ui.sendTo('scope');\n" });
  const r = run(repo);
  assert.equal(r.status, 0, r.out);
  assert.ok(r.out.includes('definition-of-done: integration-map: integration map not on the'
    + ' base (tests/browser/integration-map.json, K075); 1 new link producer(s) not judged:'
    + ' scope'), r.out);
});

test('a merge train is judged by its members', (t) => {
  const repo = fixture(t);
  repo.commit('train', { 'src/js/ui/app.js': 'export const app = 2;\n' });
  const r = run(repo, { title: 'Merge train 2026-10-30: #101, #102', text: body('train.md'),
    headRefName: 'train/2026-10-30' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /a train of 2 member\(s\) \(#101, #102\), each judged as its own pull/);
  const branch = run(repo, { title: 'chore: land the night', text: body('train.md'),
    headRefName: 'train/2026-10-30' });
  assert.equal(branch.status, 0, branch.out);
  for (const text of ['', '| member | what |\n| --- | --- |\n',
    '| member | what |\n| --- | --- |\n| 101 | chore(ui): tidy |\n']) {
    const bad = run(repo, { title: 'Merge train 2026-10-30', text,
      headRefName: 'train/2026-10-30' });
    assert.equal(bad.status, 1, bad.out);
    assert.deepEqual(refused(bad.out), ['train'], bad.out);
  }
  // a train title on another branch is no train here: a chore that changes src/ is judged
  for (const [title, headRefName] of [['Trains: land the night', 'chore/x'],
    ['Merge train 2026-10-30: #101, #102', undefined], ['train(ui): tidy', 'refactor/ui']]) {
    const titled = run(repo, { title, text: body('train.md'), headRefName });
    assert.equal(titled.status, 1, `${title} on ${headRefName}\n${titled.out}`);
    assert.deepEqual(refused(titled.out), ['section', 'browser', 'docs'], titled.out);
    assert.ok(!/a train/.test(titled.out), titled.out);
  }
  // a feat title is never a train, whatever its branch
  const feat = run(repo, { title: 'feat(ui): two', text: body('train.md'),
    headRefName: 'train/x' });
  assert.ok(refused(feat.out).includes('section'), feat.out);
});

test('the parsers: items, evidence, waivers, keys and producers', () => {
  assert.deepEqual([...dodSection(COMPLETE).keys()], ITEMS);
  assert.equal(dodSection('## Summary\n- extends: E999\n'), null);
  // the section ends at the next heading of its level
  const cut = dodSection('## Definition of done\n- extends: E999\n## Other\n- tested: x.js\n');
  assert.deepEqual([...cut.keys()], ['extends']);
  assert.deepEqual([...dodSection(real('.github/pull_request_template.md')).keys()], ITEMS,
    'the pull request template carries the six items');
  // the evidence is what this checkout holds
  const here = evidenceLookup(ROOT);
  for (const yes of ['E030', 'M083 and more', '`src/js/ui/app.js`', 'README.md', 'docs/',
    'tests/browser/navigation.cjs.', '.ai/repo/features/about.md', 'src/js/ui/app.js:12']) {
    assert.ok(itemEvidence(yes, here), yes);
  }
  for (const no of ['', 'n/a', 'yes', 'and/or', '<path or plan id>', 'P1', 'I/O', '#255',
    'works like Node.js', 'the A440 tone', 'nothing.md', 'E000', 'src/js/ui/nothing.js',
    'tests/browser/*.cjs', 'src/../README.md', '<E030>']) {
    assert.ok(!itemEvidence(no, here), no);
  }
  assert.equal(waiverOf('dod-docs: n/a', 'dod-docs').reason, '');
  assert.equal(waiverOf('* dod-docs: n/a  why not ', 'dod-docs').reason, 'why not');
  assert.equal(waiverOf('dod-docs: n/a why', 'dod-browser'), null);
  assert.deepEqual([...urlKeys(URL_STATE(", lab: 'lb'"))].sort(), ['lab', 'lb', 'm', 'mode', 'v']);
  assert.deepEqual([...urlKeys([
    "const A_KEY = 'a'; const b = 'b'; const c = `c${x}`; q.get(b); q.get(c); q.get(d);",
    "q.has('e'); q.delete(`f`); new URLSearchParams(String(h)); KEYS.g;",
  ].join('\n'))].sort(), ['a', 'b', 'e', 'f']);
  assert.deepEqual(producersOf('src/js/ui/x.js', [
    "ui.openIn('studio');", 'bus.sendTo(target, x);', 'openIn(target) {', 'function sendTo(t) {',
    'el.openInStudio(1);', '<a data-osc-link="lab">', '<a data-osc-link>',
    "// ui.openIn('commented');", "/* bus.sendTo('block'); */ const u = 'http://x/'; // sendTo(y)",
    'el.dataset.oscLink = target;', '<a data-osc-link="${t}">', '<a data-osc-link="">',
  ].join('\n')), ['lab', 'data-osc-link', 'data-osc-link="${t}"', 'data-osc-link=""',
    'dataset.oscLink', 'studio', 'sendTo(target, x)']);
  assert.deepEqual(producersOf('src/index.html',
    "<a data-osc-link='x'> openIn('y') <!-- <a data-osc-link='z'> -->"), ['x']);
});

test('usage errors exit 2', () => {
  for (const args of [[], ['--title'], ['--nope']]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /usage: node scripts\/definition-of-done\.mjs/);
  }
});

// .github/scripts/base-rule.sh runs the base branch's copy: the pull request that introduces
// the program is judged by its own copy, with a warning; any later one by the base's.
const PROGRAMS = ['scripts/definition-of-done.mjs', 'scripts/fail-first.mjs'];
const wrap = (repo, pr) => {
  const r = spawnSync('bash', [WRAPPER, 'main', 'scripts/definition-of-done.mjs', '--pr-json', pr,
    '--base-branch', 'main'], { cwd: repo.dir, encoding: 'utf8', env: ENV });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const prJson = (t, repo, text) => {
  const pr = path.join(repo.dir, '..', `${path.basename(repo.dir)}.pr.json`);
  t.after(() => spawnSync('rm', ['-f', pr]));
  writeFileSync(pr, JSON.stringify({ title: 'feat(ui): two', body: text }));
  return pr;
};

test('base-rule: the first pull request is judged by its own copy, with a warning', (t) => {
  const repo = fixture(t);
  repo.commit('introduce', {
    ...Object.fromEntries(PROGRAMS.map((p) => [p, real(p)])),
    'src/js/ui/app.js': 'export const app = 2;\n',
  });
  const r = wrap(repo, prJson(t, repo, ''));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::warning::base-rule: main \([0-9a-f]{12}\) has no scripts\/definition-of/);
  assert.match(r.out, /^project\.definition-of-done: section:/m);
});

test('base-rule: a pull request that makes the program always accept is refused', (t) => {
  const repo = fixture(t, Object.fromEntries(PROGRAMS.map((p) => [p, real(p)])));
  repo.commit('weaken', {
    'scripts/definition-of-done.mjs': "console.log('definition-of-done: accepted');\n",
    'src/js/ui/app.js': 'export const app = 2;\n',
  });
  const pr = prJson(t, repo, '');
  const own = spawnSync(process.execPath, [path.join(repo.dir, 'scripts/definition-of-done.mjs')],
    { encoding: 'utf8', env: ENV });
  assert.equal(own.status, 0, 'the pull request\'s own copy lets it through');
  const r = wrap(repo, pr);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /base-rule: scripts\/definition-of-done\.mjs of main \([0-9a-f]{12}\) /);
  assert.deepEqual(refused(r.out), ['section', 'browser', 'docs']);
});

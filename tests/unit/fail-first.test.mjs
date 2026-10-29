// project.fail-first: scripts/fail-first.mjs on fixture repositories. Each fixture is a `main`
// commit and a PR branch; the script is run as CI runs it (a process, a title, a body) and
// judged by its exit status and what it prints.
//   node --test tests/unit/fail-first.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRepo } from './fixtures/git-repo.mjs';
import { failFirst, waiver } from '../../scripts/fail-first.mjs';
import { digestOf } from '../../scripts/judge-isolation.mjs';
import { extractJudge } from './fixtures/judge-copy.mjs';

const { until } = createRequire(import.meta.url)('../browser/lib/wait.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'fail-first.mjs');

const ENV = { ...process.env };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete ENV[k];

const VALUE_TEST = (expected) => `import test from 'node:test';
import assert from 'node:assert/strict';
import { value } from '../../src/value.mjs';
test('value is ${expected}', () => assert.equal(value(), ${expected}));
`;

/** main: src/value.mjs returns 1 and its test says so. Returns the repository on a PR branch. */
function fixture() {
  const repo = gitRepo('oscilla-fail-first-');
  repo.commit('base', {
    'src/value.mjs': 'export const value = () => 1;\n',
    'tests/unit/value.test.mjs': VALUE_TEST(1),
    'README.md': 'fixture\n',
  });
  repo.branch('pr');
  return repo;
}

function run(repo, title, body) {
  const pr = path.join(repo.dir, '..', `${path.basename(repo.dir)}.pr.json`);
  writeFileSync(pr, JSON.stringify({ title, body: body ?? '' }));
  const r = spawnSync(process.execPath, [SCRIPT, '--repo', repo.dir, '--pr-json', pr,
    '--base-branch', 'main'], { encoding: 'utf8', env: ENV });
  spawnSync('rm', ['-f', pr]);
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test('a fix whose new test also passes on the merge base is refused', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('fix', {
    'src/value.mjs': 'export const value = () => 1; // tidied\n',
    'tests/unit/tidy.test.mjs': VALUE_TEST(1),
  });
  const r = run(repo, 'fix(x): tidy the value');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /tests\/unit\/tidy\.test\.mjs: passes without the change - not evidence/);
  assert.match(r.out, /none of the 1 added or changed unit test file\(s\) fails on the/);
});

test('a fix whose changed test fails on the merge base passes, and the kind is printed', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('fix', {
    'src/value.mjs': 'export const value = () => 2;\n',
    'tests/unit/value.test.mjs': VALUE_TEST(2),
  });
  const r = run(repo, 'fix(x): the value is 2');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /value\.test\.mjs: fails without the change \(assertion\), passes with it/);
  assert.match(r.out, /not ok: value is 2/);
  assert.match(r.out, /proven by 1 of 1 file\(s\)/);
});

test('one proving file is enough, and the others are listed as not evidence', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('feat', {
    'src/value.mjs': 'export const value = () => 2;\n',
    'tests/unit/value.test.mjs': VALUE_TEST(2),
    'tests/unit/always.test.mjs': "import test from 'node:test';\ntest('always', () => {});\n",
  });
  const r = run(repo, 'feat(x)!: the value is 2');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /always\.test\.mjs: passes without the change - not evidence/);
  assert.match(r.out, /proven by 1 of 2 file\(s\)/);
});

test('the waiver passes a PR that proves nothing, and its reason is printed', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('fix', { 'tests/unit/tidy.test.mjs': VALUE_TEST(1) });
  const title = 'fix(x): tidy the value';
  assert.equal(run(repo, title).status, 1, 'refused without the waiver');
  const r = run(repo, title, 'Summary.\n\nfail-first: n/a docs-only\n\nMore text.');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /^fail-first: n\/a docs-only$/m);
  const bare = run(repo, title, 'fail-first: n/a\n');
  assert.equal(bare.status, 1, 'a waiver without a reason is not one');
  assert.match(bare.out, /a waiver needs one/);
});

test('a test that fails once with the change and passes on the retry is still evidence', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  const marker = path.join(repo.dir, '..', `${path.basename(repo.dir)}.flaked`);
  t.after(() => spawnSync('rm', ['-f', marker]));
  // fails the first time it runs against the changed source, then passes: a load-sensitive test
  repo.commit('fix', {
    'src/value.mjs': 'export const value = () => 2;\n',
    'tests/unit/value.test.mjs': `import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { value } from '../../src/value.mjs';
test('value is 2', () => {
  assert.equal(value(), 2);
  const marker = ${JSON.stringify(marker)};
  if (!existsSync(marker)) { writeFileSync(marker, ''); assert.fail('flaked'); }
});
`,
  });
  const r = run(repo, 'fix(x): the value is 2');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /failed with the change \(assertion\); running it once more/);
  assert.match(r.out, /value\.test\.mjs: fails without the change \(assertion\), passes with it/);
});

test('a title that is not feat or fix has nothing to prove', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('docs', { 'README.md': 'fixture, documented\n' });
  for (const title of ['docs(x): say more', 'chore(release): v1.2.3', 'refactor: move',
    'feature: not a conventional type', 'fixes the thing']) {
    const r = run(repo, title);
    assert.equal(r.status, 0, `${title}: ${r.out}`);
    assert.match(r.out, /not a feat or fix PR; nothing to prove/);
  }
});

test('a feat or fix that adds or changes no unit test is refused', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('fix', { 'src/value.mjs': 'export const value = () => 2;\n' });
  const r = run(repo, 'fix: the value is 2');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /adds or changes no tests\/unit\/\*\*\/\*\.test\.mjs file/);
});

test('a test of a module the merge base does not have counts, named as module-not-found', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('feat', {
    'src/extra.mjs': 'export const extra = () => 3;\n',
    'tests/unit/extra.test.mjs': `import test from 'node:test';
import assert from 'node:assert/strict';
import { extra } from '../../src/extra.mjs';
test('extra is 3', () => assert.equal(extra(), 3));
`,
  });
  const r = run(repo, 'feat(x): extra');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /extra\.test\.mjs: fails without the change \(module-not-found\)/);
  assert.match(r.out, /failure kind\(s\)\s+without the change: module-not-found/);
});

test('a test that fails with the change too is not evidence', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('fix', {
    'src/value.mjs': 'export const value = () => 2;\n',
    'tests/unit/value.test.mjs': VALUE_TEST(3),
  });
  const r = run(repo, 'fix(x): the value is 2');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /value\.test\.mjs: FAILS WITH THE CHANGE TOO \(assertion\) - not evidence/);
  assert.match(r.out, /failed with the change \(assertion\); running it once more/);
});

test('the change is everything outside tests/: a script test fails on the base script', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('base script', { 'scripts/tool.mjs': 'export const tool = () => "old";\n' });
  repo.git('checkout', '-q', 'main');
  repo.git('merge', '-q', '--ff-only', 'pr');
  repo.git('checkout', '-q', 'pr');
  repo.commit('fix', {
    'scripts/tool.mjs': 'export const tool = () => "new";\n',
    'tests/unit/tool.test.mjs': `import test from 'node:test';
import assert from 'node:assert/strict';
import { tool } from '../../scripts/tool.mjs';
test('tool is new', () => assert.equal(tool(), 'new'));
`,
  });
  const r = run(repo, 'fix(scripts): the tool is new');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /tool\.test\.mjs: fails without the change \(assertion\), passes with it/);
});

test('a title that reads as feat or fix is one, in any case and spacing', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('fix', {
    'src/value.mjs': 'export const value = () => 1; // tidied\n',
    'tests/unit/tidy.test.mjs': VALUE_TEST(1),
  });
  for (const title of ['Fix(x): add', 'fix (x): add', '[WIP] fix(x): add', 'FEAT!: add',
    ' feat(x) : add', '[draft][wip] Feat: add', 'fix(x)!: add']) {
    const r = run(repo, title);
    assert.equal(r.status, 1, `${title}: ${r.out}`);
    assert.match(r.out, /passes without the change - not evidence/);
  }
});

test('a waiver is a line of the body\'s own prose, its reason not the placeholder', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('fix', { 'tests/unit/tidy.test.mjs': VALUE_TEST(1) });
  const title = 'fix(x): tidy the value';
  const refused = {
    'the placeholder of the advice': '- fail-first: n/a <reason>\n',
    'punctuation for a reason': 'fail-first: n/a ...\n',
    'a fenced code block': 'Output:\n\n```\nfail-first: n/a docs-only\n```\n',
    'an indented, tagged fence': 'Output:\n\n  ```text\n  fail-first: n/a docs-only\n  ```\n\nEnd.',
    'a tilde fence left open': '~~~\nfail-first: n/a docs-only\n',
    'a blockquote': '> fail-first: n/a docs-only\n',
    'an HTML comment': '<!--\nfail-first: n/a docs-only\n-->\n',
    'the middle of a sentence': 'We could say fail-first: n/a docs-only here.\n',
    // what GitHub renders as code or a quote (review of #255, R5)
    'an indented code block': 'Output:\n\n    fail-first: n/a docs-only\n',
    'a tab-indented code block': '\tfail-first: n/a docs-only\n',
    'a blockquote\'s lazy continuation': '> Quoted\nfail-first: n/a docs-only\n',
    'a code span': '`fail-first: n/a docs-only`\n',
    'a fence indented 3 spaces': '   ```\nfail-first: n/a docs-only\n   ```\n',
    // review of #255, round 2: a code span across the lines of a paragraph (R5), a fence in a
    // list item, indented 4 (R15), and a reason written only in code (R16)
    'a code span across lines': 'See `x\nfail-first: n/a docs-only` here.\n',
    'a code span across lines, in a list': '- See ``a\n  fail-first: n/a docs-only`` here.\n',
    'a fence in a list item': '- Output:\n\n    ```\n    fail-first: n/a docs-only\n    ```\n',
    'a tab-indented fence in a list item': '1. Output:\n\n\t~~~\n\tfail-first: n/a docs\n\t~~~\n',
    'a placeholder in code': 'fail-first: n/a `<reason>`\n',
    'punctuation in code': 'fail-first: n/a `...`\n',
    'a reason only in code': 'fail-first: n/a `docs-only`\n',
  };
  for (const [what, body] of Object.entries(refused)) {
    const r = run(repo, title, body);
    assert.equal(r.status, 1, `${what}: ${r.out}`);
    assert.doesNotMatch(r.out, /waived by the PR body/, what);
  }
  assert.match(run(repo, title, '- fail-first: n/a <reason>\n').out, /a waiver needs one/);
  const accepted = [
    '- fail-first: n/a only a browser suite can observe it\n',
    '```\nnpm test\n```\n\nFail-First: N/A docs-only\n',
    '* fail-first: n/a <css only> no unit test reaches the stylesheet\r\n',
    // what GitHub renders as prose (R5): no comment opens in a code span, no fence on a line
    // that closes its own backticks, a list item ends a quote, a list item's own paragraph
    'Write `<!--` to hide.\nfail-first: n/a docs-only\n',
    '```js x``` is inline.\nfail-first: n/a docs-only\n',
    '> Quoted\n- fail-first: n/a docs-only\n',
    '- Tidy.\n\n    fail-first: n/a docs-only\n',
    // a code span that closes before the waiver's line, and code beside a reason of words
    'See `x\ny` here.\nfail-first: n/a docs-only\n',
    'fail-first: n/a the `--keep` flag only prints a path\n',
  ];
  for (const body of accepted) {
    const r = run(repo, title, body);
    assert.equal(r.status, 0, `${JSON.stringify(body)}: ${r.out}`);
    assert.match(r.out, /waived by the PR body/);
  }
  assert.equal(waiver('fail-first: n/a <reason>').reason, '');
  assert.equal(waiver('fail-first: n/a x').reason, 'x');
  assert.equal(waiver('```\nfail-first: n/a x\n```'), null);
  // inline code is no reason (R16), and is printed as it was written
  for (const body of ['fail-first: n/a `<reason>`', 'fail-first: n/a `x` `y`',
    'fail-first: n/a ``a ` b``']) {
    assert.equal(waiver(body).reason, '', body);
  }
  assert.equal(waiver('fail-first: n/a the `--keep` flag only').reason,
    'the `--keep` flag only');
  assert.equal(waiver('See `a\nb` and\nfail-first: n/a `c` d').reason, '`c` d');
});

// review of #255, round 3: the body is read by CommonMark's block and inline rules, so a
// backslash-escaped backtick opens no span and a backtick in code pairs with nothing outside
// it (R5), a fence 4 columns in is a fence only inside a list item (R15), and a heading or an
// HTML comment is its own block, whose unmatched backtick reaches no line after it (R21).
// Round 4: link reference definitions, HTML blocks and inline tags (R5), and an inline
// comment's backtick in the waiver's own paragraph (R21).
test('the waiver is read as CommonMark reads the body (R5, R15, R21)', () => {
  const hidden = {
    // R5: the escaped backtick is literal, the next one opens a span across the waiver
    'after an escaped backtick': 'a \\` b ` c\nfail-first: n/a docs only\n` d\n',
    // R5: the backtick in the code block pairs with nothing, the span in the prose does
    'after an indented code block with a backtick': 'Text\n\n    a ` b\nSee `x\n'
      + 'fail-first: n/a docs only\n` end\n',
    'after a fenced code block with a backtick': '```\na ` b\n```\nSee `x\n'
      + 'fail-first: n/a docs only\n` end\n',
    // R15: outside a list a 4-space ``` is indented code, and the next ``` opens a real fence
    'in a real fence after a 4-space backtick line': '    ```\ntext\n```\n'
      + 'fail-first: n/a docs only\n```\n',
    // R15: inside a list item the same line opens a fence
    'in a list item\'s fence 4 columns in': '- item\n\n    ```\n    fail-first: n/a docs only\n'
      + '    ```\n',
    'in a nested list item\'s fence': '- a\n  - b\n\n      ```\n      fail-first: n/a docs only\n'
      + '      ```\n',
    // round 4, R5: what GitHub renders nothing of, a link reference definition's title
    // across lines, an HTML block (a type-6 tag's attribute) and an inline tag's attribute
    'in a link reference title': '[x]: /url "a\nfail-first: n/a docs only\nb"\n',
    'in a link reference title in parentheses': '[x]: /url (a\nfail-first: n/a docs only\n)\n',
    'in a link reference title on its own lines': '[x]:\n/url\n"t\nfail-first: n/a docs only"\n',
    'in a type-6 block\'s attribute': '<div title="\nfail-first: n/a docs only\n">\n',
    'in a type-6 block after a paragraph': 'Text\n<div\nfail-first: n/a docs only\n',
    'in a pre block': '<pre>\n\nfail-first: n/a docs only\n</pre>\n',
    'in an inline tag\'s attribute': 'See <span title="x\nfail-first: n/a docs only\n">y</span>\n',
    // round 5, R5: an inline link's title and an image's alt text are attributes only
    'in an inline link title': 'See [x](/url "a\nfail-first: n/a docs only\nb") here\n',
    'in an inline link title in parentheses': 'See [x](</u rl> (\nfail-first: n/a docs only\n))\n',
    'in an image\'s alt text': '![a\nfail-first: n/a docs only\nb](img.png "t")\n',
    'in an image\'s alt text holding a code span': '![a `]`\nfail-first: n/a docs only\n](i.png)\n',
    'in a reference image\'s alt text': '![a\nfail-first: n/a docs only\n][r]\n\n[r]: /i.png\n',
    // round 5, R5: the interrupts() fix: an HTML block ends a lazy continuation line's
    // paragraph, so what follows it is the block's, not prose
    'in a type-6 block after a list item\'s paragraph': '- item\n<div\nfail-first: n/a docs only\n',
    'in a script block after a quote\'s paragraph': '> quoted\n<script>\n'
      + 'fail-first: n/a docs only\n</script>\n',
  };
  for (const [what, body] of Object.entries(hidden)) {
    const w = waiver(body);
    assert.ok(w === null || w.reason === '', `${what}: ${JSON.stringify(w)}`);
  }
  const shown = {
    // R15: outside a list, a 4-space ``` is code, not a fence that runs on
    'after a 4-space backtick line outside a list': 'Text\n\n    ```\nfail-first: n/a docs only\n',
    // R21: a heading's and a comment's backticks reach no other block
    'right after a heading': '## Why\nfail-first: n/a docs only\n',
    'after a heading with an unmatched backtick': '## The ` key\nfail-first: n/a docs only\n'
      + 'see `x`\n',
    'after an HTML comment with an unmatched backtick': '<!-- a ` tick -->\n'
      + 'fail-first: n/a docs only\nmore `x`\n',
    'after an inline comment with a backtick': 'Note <!-- ` --> here.\n\n'
      + 'fail-first: n/a docs only\n` x\n',
    // round 4, R21: in the same paragraph, the comment's backtick would otherwise open a span
    // that the later one closes, hiding the waiver between them
    'after an inline comment with a backtick, in its paragraph': 'Note <!-- ` --> here.\n'
      + 'fail-first: n/a docs only\n` x\n',
    // R5: what follows a definition, an HTML block or a lone inline tag is prose
    'after a link reference definition': '[x]: /url "t"\nfail-first: n/a docs only\n',
    'after an HTML block and a blank line': '<div>\nx\n</div>\n\nfail-first: n/a docs only\n',
    'after a line that is no definition': '[x]: /url "t" more\nfail-first: n/a docs only\n',
    // R5: an escaped backtick opens nothing, a code block's backtick pairs with nothing
    'after an escaped backtick': 'a \\` b\nfail-first: n/a docs only\nc ` d\n',
    'after a fenced code block with a backtick': '```\na ` b\n```\nfail-first: n/a docs only\n'
      + 'c ` d\n',
    'after a setext heading': 'Why\n---\nfail-first: n/a docs only\n',
    'after a thematic break': '***\nfail-first: n/a docs only\n',
    // a fence is no paragraph: it has no lazy continuation, and ends with its quote
    'after a fence in a quote': '> ```\n> x\nfail-first: n/a docs only\n',
    // round 5, R5: a link's text is prose, and so is what follows a link or an image
    'in a link\'s text across lines': '[a\nfail-first: n/a docs only\nb](/url)\n',
    'after a link with a title': 'See [x](/url "t").\nfail-first: n/a docs only\n',
    'after an image': '![alt](x.png)\nfail-first: n/a docs only\n',
    'after a list item and a blank line, past an HTML block': '- item\n\n<div>\n\n'
      + 'fail-first: n/a docs only\n',
  };
  for (const [what, body] of Object.entries(shown)) {
    assert.deepEqual(waiver(body), { reason: 'docs only' }, what);
  }
  // an image is no reason: its alt text is not shown
  assert.equal(waiver('fail-first: n/a ![docs only](x.png)').reason, '');
  assert.equal(waiver('fail-first: n/a [docs only](/why)').reason, '[docs only]');
});

test('a test that asks git for the tracked files can be evidence', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('feat', {
    'src/extra.mjs': 'export const extra = () => 3;\n',
    'tests/unit/tracked.test.mjs': `import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
test('extra is tracked', () => {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\\n');
  assert.ok(files.includes('README.md'));
  assert.ok(files.includes('src/extra.mjs'), 'src/extra.mjs is tracked');
  const others = execFileSync('git', ['ls-files', '--others', '--exclude-standard'],
    { encoding: 'utf8' });
  assert.equal(others, '', 'nothing untracked, the linked node_modules included');
});
`,
  });
  // the fixture has dependencies, as the repository does: both trees get them linked in
  mkdirSync(path.join(repo.dir, 'node_modules'));
  const r = run(repo, 'feat(x): extra');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /tracked\.test\.mjs: fails without the change \(assertion\), passes with it/);
});

test('a unit test file with a non-ASCII name is seen', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('fix', {
    'src/value.mjs': 'export const value = () => 2;\n',
    'tests/unit/value.test.mjs': VALUE_TEST(1),
    'tests/unit/výstup.test.mjs': VALUE_TEST(2),
  });
  repo.git('rm', '-q', 'tests/unit/value.test.mjs');
  repo.commit('drop the old test', {});
  const r = run(repo, 'fix(x): the value is 2');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /výstup\.test\.mjs: fails without the change \(assertion\)/);
});

// review of #255, round 4: the CI judge (JUDGE_MANIFEST set) checks its own copy against the
// manifest its `judge` step wrote, before any child and after the last; it installs the
// packages itself (`npm ci --ignore-scripts` as a child, since round 8 in the extracted head
// tree, never the checkout); every
// child runs in a group of its own that dies with it; and it refuses to judge where a child
// could ptrace it (R12, R22).
const LOCK = `${JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3,
  requires: true, packages: { '': { name: 'fixture', version: '1.0.0' } } }, null, 2)}\n`;
const PKG = `${JSON.stringify({ name: 'fixture', version: '1.0.0', private: true })}\n`;

/**
 * A judge copy of this checkout's scripts/, committed to a base of their own and extracted as
 * the `judge` step extracts it (R30), read-only.
 */
function judgeCopy(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-fail-first-judge-'));
  const src = gitRepo('oscilla-fail-first-judge-src-');
  t.after(() => {
    spawnSync('chmod', ['-R', 'u+w', dir]);
    rmSync(dir, { recursive: true, force: true });
    src.dispose();
  });
  cpSync(path.join(ROOT, 'scripts'), path.join(src.dir, 'scripts'), { recursive: true });
  const sha = src.commit('the judge', {});
  const digest = extractJudge(src.dir, sha, dir);
  spawnSync('chmod', ['-R', 'a-w', dir]);
  return { dir, digest };
}

/** A fixture with a package and a lockfile, as the repository has. */
function packaged() {
  const repo = gitRepo('oscilla-fail-first-judge-');
  repo.commit('base', {
    'src/value.mjs': 'export const value = () => 1;\n',
    'tests/unit/value.test.mjs': VALUE_TEST(1),
    'package.json': PKG,
    'package-lock.json': LOCK,
  });
  repo.branch('pr');
  return repo;
}

function judgeRun(repo, judge, title, digest = judge.digest) {
  const r = spawnSync(process.execPath, [path.join(judge.dir, 'scripts', 'fail-first.mjs'),
    '--repo', repo.dir, '--title', title, '--base-branch', 'main'],
  { encoding: 'utf8', env: { ...ENV, JUDGE_MANIFEST: digest } });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test('round 4: the judge checks its copy, installs as its own child, then judges', (t) => {
  const judge = judgeCopy(t);
  const repo = packaged();
  t.after(() => repo.dispose());
  repo.commit('fix', {
    'src/value.mjs': 'export const value = () => 2;\n',
    'tests/unit/value.test.mjs': VALUE_TEST(2),
  });
  const r = judgeRun(repo, judge, 'fix(x): the value is 2');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /the judge copy matches its manifest \(\d+ files\)/);
  assert.match(r.out, /installed with `npm ci --ignore-scripts` by the judge, as its own child/);
  assert.match(r.out, /value\.test\.mjs: fails without the change \(assertion\), passes with it/);
  // another digest than the one its step recorded: refused before anything runs
  const wrong = judgeRun(repo, judge, 'fix(x): the value is 2', digestOf('x'));
  assert.equal(wrong.status, 1, wrong.out);
  assert.match(wrong.out, /REFUSED to judge: the judge copy: \.manifest has sha256/);
  assert.doesNotMatch(wrong.out, /npm ci|value\.test/);
});

// review of #255, round 8: the judge reads every commit and file it needs from git and writes
// both trees before any child runs; the install runs in the extracted head tree, never in the
// checkout, as a child like the tests. So install-time code (here a git dependency's prepare,
// which `npm ci --ignore-scripts` runs) that rewrites the checkout's .git (a replace ref for the
// merge base, a core.fsmonitor, a filter and an alias in .git/config) and plants a symbolic link
// in the checkout changes neither tree nor the verdict, then or on the next judgement.
test('round 8: install-time code cannot change what the judge extracted, or its verdict',
  async (t) => {
    const judge = judgeCopy(t);
    const repo = packaged();
    t.after(() => repo.dispose());
    const marks = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'oscilla-ff-r8-marks-')));
    t.after(() => rmSync(marks, { recursive: true, force: true }));
    const base = repo.git('rev-parse', 'main');
    // the decoy: a commit with the fix in it; a merge base replaced by it passes the test
    // without the change, which would turn the evidence into none
    const fixed = { 'src/value.mjs': 'export const value = () => 2;\n',
      'tests/unit/value.test.mjs': VALUE_TEST(2) };
    repo.git('checkout', '-q', '-b', 'decoy', 'main');
    const decoy = repo.commit('decoy', fixed);
    repo.git('checkout', '-q', 'pr');
    const gitDir = path.join(repo.dir, '.git');
    const hostile = `#!/bin/sh
# install-time code of the pull request, run by npm ci --ignore-scripts (review of #255, R17)
echo ran > '${marks}/install-ran'
mkdir -p '${gitDir}/refs/replace'
echo ${decoy} > '${gitDir}/refs/replace/${base}'
printf '[core]\\n\\tfsmonitor = touch ${marks}/fsmonitor-ran\\n' >> '${gitDir}/config'
printf '[filter "x"]\\n\\tclean = touch ${marks}/filter-ran\\n' >> '${gitDir}/config'
printf '\\tsmudge = touch ${marks}/filter-ran\\n' >> '${gitDir}/config'
printf '[alias]\\n\\tls = !touch ${marks}/alias-ran\\n' >> '${gitDir}/config'
ln -sfn / '${repo.dir}/escape'
`;
    const dep = gitRepo('oscilla-ff-r8-dep-');
    t.after(() => dep.dispose());
    const sha = dep.commit('dep', { 'hostile.sh': hostile, 'package.json': `${JSON.stringify({
      name: 'dep', version: '1.0.0', scripts: { prepare: 'sh hostile.sh' } })}\n` });
    const spec = `git+file://${dep.dir}#${sha}`;
    repo.commit('fix', {
      ...fixed,
      '.gitattributes': '* filter=x\n',
      'package.json': `${JSON.stringify({ name: 'fixture', version: '1.0.0', private: true,
        dependencies: { dep: spec } })}\n`,
      'package-lock.json': `${JSON.stringify({ name: 'fixture', version: '1.0.0',
        lockfileVersion: 3, requires: true, packages: {
          '': { name: 'fixture', version: '1.0.0', dependencies: { dep: spec } },
          'node_modules/dep': { version: '1.0.0', resolved: spec } } }, null, 2)}\n`,
    });
    const probe = () => ({ ok: true, message: 'ptrace: ptrace_scope 1' });
    const judged = () => failFirst({ repo: repo.dir, title: 'fix(x): the value is 2',
      baseBranch: 'main', judge, keep: true, probe });
    const trees = (lines) => {
      const kept = /trees kept in (.+)$/m.exec(lines.join('\n'))[1];
      t.after(() => rmSync(kept, { recursive: true, force: true }));
      const at = (tree, rel) => readFileSync(path.join(kept, tree, rel), 'utf8');
      return { kept, at };
    };
    const first = await judged();
    const log = first.lines.join('\n');
    assert.equal(first.status, 'proven', log);
    assert.match(log, /installed with `npm ci --ignore-scripts` by the judge/);
    assert.match(log, /value\.test\.mjs: fails without the change \(assertion\), passes with it/);
    // the attack is real: the install ran it, and it wrote the checkout's .git
    assert.equal(readFileSync(path.join(marks, 'install-ran'), 'utf8'), 'ran\n', log);
    assert.equal(readFileSync(path.join(gitDir, 'refs', 'replace', base), 'utf8'),
      `${decoy}\n`);
    assert.match(readFileSync(path.join(gitDir, 'config'), 'utf8'), /fsmonitor = touch/);
    const one = trees(first.lines);
    assert.equal(one.at('without', 'src/value.mjs'), 'export const value = () => 1;\n');
    assert.equal(one.at('without', 'tests/unit/value.test.mjs'), VALUE_TEST(2));
    assert.equal(one.at('with', 'src/value.mjs'), 'export const value = () => 2;\n');
    for (const tree of ['with', 'without']) {
      assert.equal(existsSync(path.join(one.kept, tree, 'escape')), false, tree);
    }
    // judged again, with the replace ref and the config in the checkout before it starts:
    // the judge's git honours neither
    const second = await judged();
    assert.equal(second.status, 'proven', second.lines.join('\n'));
    const two = trees(second.lines);
    assert.equal(two.at('without', 'src/value.mjs'), 'export const value = () => 1;\n');
    for (const mark of ['fsmonitor-ran', 'filter-ran', 'alias-ran']) {
      assert.equal(existsSync(path.join(marks, mark)), false, mark);
    }
  });

// review of #255, round 8: every git call of the judge runs with GIT_NO_REPLACE_OBJECTS=1,
// GIT_CONFIG_GLOBAL=/dev/null and GIT_CONFIG_NOSYSTEM=1 (and no other GIT_* variable), so a
// replace ref in the repository never answers for the merge base it names
test('round 8: every git call of the judge ignores replace refs and the global config', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  const base = repo.git('rev-parse', 'main');
  const fixed = { 'src/value.mjs': 'export const value = () => 2;\n',
    'tests/unit/value.test.mjs': VALUE_TEST(2) };
  repo.commit('fix', fixed);
  const decoy = repo.git('commit-tree', repo.git('rev-parse', 'HEAD^{tree}'), '-m', 'decoy');
  repo.git('replace', base, decoy);
  const bin = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'oscilla-ff-r8-git-')));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const log = path.join(bin, 'log');
  writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nprintf \'%s|%s|%s|%s|%s\\n\' '
    + '"${GIT_NO_REPLACE_OBJECTS-}" "${GIT_CONFIG_GLOBAL-}" "${GIT_CONFIG_NOSYSTEM-}" '
    + `"\${GIT_DIR-}\${GIT_INDEX_FILE-}" "$*" >> '${log}'\nexec '${real}' "$@"\n`);
  chmodSync(path.join(bin, 'git'), 0o755);
  const r = spawnSync(process.execPath, [SCRIPT, '--repo', repo.dir, '--title',
    'fix(x): the value is 2', '--base-branch', 'main'], { encoding: 'utf8',
    env: { ...ENV, PATH: `${bin}:${ENV.PATH}`, GIT_CONFIG_GLOBAL: path.join(bin, 'none'),
      GIT_INDEX_FILE: path.join(bin, 'index') } });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, out);
  assert.match(out, /value\.test\.mjs: fails without the change \(assertion\), passes with it/);
  const calls = readFileSync(log, 'utf8').trim().split('\n');
  for (const sub of ['rev-parse', 'merge-base', 'diff', 'ls-tree', 'cat-file', 'init', 'add']) {
    assert.ok(calls.some((c) => c.split('|')[4].split(' ').includes(sub)), `${sub}: ${calls}`);
  }
  for (const c of calls) assert.ok(c.startsWith('1|/dev/null|1||'), c);
});

// review of #255, round 8: the trees are written blob by blob (git ls-tree and git cat-file,
// never tar): a symbolic link, a path with an empty, `.` or `..` component, or one a checkout
// would refuse as .git (in any case) is refused before anything runs
test('round 8: the judge writes regular files only, at paths a checkout could hold', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  const base = repo.git('rev-parse', 'main');
  repo.commit('fix', { 'src/value.mjs': 'export const value = () => 2;\n',
    'tests/unit/value.test.mjs': VALUE_TEST(2) });
  const head = repo.git('rev-parse', 'HEAD');
  const blob = repo.git('rev-parse', 'HEAD:README.md');
  const sub = (entries) => {
    const r = spawnSync('git', ['-C', repo.dir, 'mktree'], { encoding: 'utf8',
      input: entries.map((e) => `${e}\n`).join(''), env: ENV });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const top = repo.git('ls-tree', head).split('\n');
  const linked = spawnSync('git', ['-C', repo.dir, 'hash-object', '-w', '--stdin'],
    { encoding: 'utf8', input: '/', env: ENV }).stdout.trim();
  for (const [what, extra, want] of [
    ['a symbolic link', [`120000 blob ${linked}\tescape`], /escape is a symbolic link/],
    ['a .. entry', [`100644 blob ${blob}\t..`], /"\.\." is no path a checkout can hold/],
    ['a .GIT directory', [`040000 tree ${sub([`100644 blob ${blob}\tconfig`])}\t.GIT`],
      /"\.GIT\/config" is no path a checkout can hold/],
    ['an NTFS short .git', [`040000 tree ${sub([`100644 blob ${blob}\tconfig`])}\tgit~1`],
      /"git~1\/config" is no path a checkout can hold/],
  ]) {
    const tree = sub([...top, ...extra]);
    const commit = repo.git('commit-tree', tree, '-p', base, '-m', what);
    repo.git('update-ref', 'refs/heads/pr', commit);
    const r = run(repo, 'fix(x): the value is 2');
    assert.equal(r.status, 1, `${what}: ${r.out}`);
    assert.match(r.out, want, what);
    assert.match(r.out, /REFUSED to judge: the head commit/, what);
    assert.doesNotMatch(r.out, /value\.test\.mjs:/, `${what}: nothing ran`);
  }
});

test('round 4: a child that changes the judge copy fails the judgement closed', (t) => {
  const judge = judgeCopy(t);
  const repo = packaged();
  t.after(() => repo.dispose());
  const target = path.join(judge.dir, 'scripts', 'fail-first.mjs');
  repo.commit('fix', {
    'src/value.mjs': 'export const value = () => 2;\n',
    // the same user may undo the read-only bit and rewrite the copy (R22)
    'tests/unit/value.test.mjs': `${VALUE_TEST(2)}import { chmodSync, appendFileSync }
  from 'node:fs';
chmodSync(${JSON.stringify(path.dirname(target))}, 0o755);
chmodSync(${JSON.stringify(target)}, 0o644);
appendFileSync(${JSON.stringify(target)}, '\\n// HOSTILE\\n');
`,
  });
  const r = judgeRun(repo, judge, 'fix(x): the value is 2');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /value\.test\.mjs: fails without the change/, 'the children ran');
  assert.match(r.out,
    /REFUSED to judge: the judge copy changed while the children ran: .*fail-first\.mjs changed/);
  assert.doesNotMatch(r.out, /fail-first: proven/);
});

test('round 4: a test\'s background grandchild is gone when the judge returns', async (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  const pidFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'oscilla-ff-grandchild-')), 'pid');
  t.after(() => rmSync(path.dirname(pidFile), { recursive: true, force: true }));
  repo.commit('fix', {
    'src/value.mjs': 'export const value = () => 2;\n',
    'tests/unit/value.test.mjs': `${VALUE_TEST(2)}import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const g = spawn('sleep', ['60'], { stdio: 'ignore' });
g.unref();
appendFileSync(${JSON.stringify(pidFile)}, g.pid + '\\n');
`,
  });
  const r = run(repo, 'fix(x): the value is 2');
  assert.equal(r.status, 0, r.out);
  const pids = readFileSync(pidFile, 'utf8').trim().split('\n').map(Number);
  assert.ok(pids.length >= 2, `a grandchild per run: ${pids}`);
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      const ps = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
      return ps.status === 0 && !/^Z/.test(ps.stdout.trim());
    } catch {
      return false;
    }
  };
  await until(() => pids.every((pid) => !alive(pid)), { ms: 5_000,
    what: 'every grandchild of a test run is gone once the judge has returned' });
});

test('round 4: no ptrace guarantee, no judgement; a child sees none of the runner\'s files',
  async (t) => {
    const repo = fixture();
    t.after(() => repo.dispose());
    const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'oscilla-ff-env-')), 'env.json');
    t.after(() => rmSync(path.dirname(out), { recursive: true, force: true }));
    repo.commit('fix', {
      'src/value.mjs': 'export const value = () => 2;\n',
      'tests/unit/value.test.mjs': `${VALUE_TEST(2)}import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.env));
`,
    });
    const refused = await failFirst({ repo: repo.dir, title: 'fix(x): 2', baseBranch: 'main',
      probe: () => ({ ok: false, message: 'ptrace: ptrace_scope is 0' }) });
    assert.equal(refused.status, 'refused');
    assert.match(refused.lines.join('\n'), /ptrace_scope is 0[\s\S]*REFUSED to judge/);
    assert.equal(existsSync(out), false, 'no child ran');
    const prev = { ...process.env };
    t.after(() => {
      for (const k of ['GITHUB_ENV', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY', 'RUNNER_TEMP']) {
        if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
      }
    });
    Object.assign(process.env, { GITHUB_ENV: '/x/env', GITHUB_OUTPUT: '/x/out',
      GITHUB_STEP_SUMMARY: '/x/summary', RUNNER_TEMP: '/x' });
    const ok = await failFirst({ repo: repo.dir, title: 'fix(x): 2', baseBranch: 'main',
      probe: () => ({ ok: true, message: 'ptrace: ptrace_scope 1' }) });
    assert.equal(ok.status, 'proven', ok.lines.join('\n'));
    const env = JSON.parse(readFileSync(out, 'utf8'));
    for (const k of ['GITHUB_ENV', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY', 'RUNNER_TEMP',
      'NODE_OPTIONS', 'BASH_ENV']) assert.equal(k in env, false, k);
    assert.equal(env.PATH.split(':')[0], path.dirname(process.execPath));
  });

// review of #255, round 6, R37: tests/unit/fixtures/judge-copy.mjs is no guarded path, so what
// it does here is pinned by its git blob id (as the f001 fixtures are): a change to it is a
// change to this guarded test
test('R37: the judge-copy fixture is the reviewed blob', () => {
  const data = readFileSync(path.join(ROOT, 'tests', 'unit', 'fixtures', 'judge-copy.mjs'));
  const oid = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
  assert.equal(oid, '08b44ae6656fe04a5515574d9ffd650ba97198b6');
});

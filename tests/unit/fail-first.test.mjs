// project.fail-first: scripts/fail-first.mjs on fixture repositories. Each fixture is a `main`
// commit and a PR branch; the script is run as CI runs it (a process, a title, a body) and
// judged by its exit status and what it prints.
//   node --test tests/unit/fail-first.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRepo } from './fixtures/git-repo.mjs';
import { waiver } from '../../scripts/fail-first.mjs';

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
    // R5: an escaped backtick opens nothing, a code block's backtick pairs with nothing
    'after an escaped backtick': 'a \\` b\nfail-first: n/a docs only\nc ` d\n',
    'after a fenced code block with a backtick': '```\na ` b\n```\nfail-first: n/a docs only\n'
      + 'c ` d\n',
    'after a setext heading': 'Why\n---\nfail-first: n/a docs only\n',
    'after a thematic break': '***\nfail-first: n/a docs only\n',
    // a fence is no paragraph: it has no lazy continuation, and ends with its quote
    'after a fence in a quote': '> ```\n> x\nfail-first: n/a docs only\n',
  };
  for (const [what, body] of Object.entries(shown)) {
    assert.deepEqual(waiver(body), { reason: 'docs only' }, what);
  }
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

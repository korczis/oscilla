// scripts/shell-words.mjs: the commands of a shell text as bash reads them, which the rules
// judge-first (scripts/ci-workflow-rules.mjs) and FORCED_SUCCESS (scripts/pr-metadata.mjs)
// rely on. Each form here has its own case, so removing its handling turns one red (review
// of #255, round 4, R7 and R27).
//   node --test tests/unit/shell-words.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { commandsOf } from '../../scripts/shell-words.mjs';

/** The programs a text runs, in order, each as bash names it (null: none). */
const programs = (text) => commandsOf(text).map((c) => (c.program
  ? (c.program.dynamic ? '$' : c.program.text) : null)).filter((p) => p !== null);

test('substitutions: top-level backticks, $( ), process substitution, inside quotes', () => {
  assert.deepEqual(programs('`npm ci`'), ['npm', '$']);
  assert.deepEqual(programs('echo `npm ci`'), ['npm', 'echo']);
  assert.deepEqual(programs('echo "$(npm ci)"'), ['npm', 'echo']);
  // round 5, R27: a backtick substitution inside double quotes runs its command too
  assert.deepEqual(programs('echo "x `npm ci` y"'), ['npm', 'echo']);
  assert.equal(commandsOf('echo "`npm ci`"').at(-1).args[0].dynamic, true);
  assert.deepEqual(programs('x=$(npm ci)'), ['npm']);
  assert.deepEqual(programs('cat <(npm ci)'), ['npm', 'cat']);
  assert.deepEqual(programs('tee >(npm ci) < /dev/null'), ['npm', 'tee']);
  assert.deepEqual(programs('diff <(git log) <(npm test)'), ['git', 'npm', 'diff']);
  // a process substitution is a word, not a redirection of the command
  assert.equal(commandsOf('cat <(npm ci)').at(-1).args.length, 1);
});

test('keywords and definitions: coproc, function, a one-line function hiding exit 0 (R7)',
  () => {
    assert.deepEqual(programs('coproc npm ci'), ['npm']);
    assert.deepEqual(programs('coproc X { npm ci; }'), ['npm']);
    assert.deepEqual(programs('function f { exit 0; }'), ['exit']);
    assert.deepEqual(programs('function f() { exit 0; }; f'), ['exit', 'f']);
    assert.deepEqual(programs('f() { exit 0; }; f'), ['f', 'exit', 'f']);
    assert.deepEqual(programs('function npm_ci { npm ci --ignore-scripts; }'), ['npm']);
    assert.deepEqual(programs('time -p npm ci'), ['npm']);
    assert.deepEqual(programs('if npm ci; then :; fi'), ['npm', ':']);
  });

test('redirections: a target is no program, and the program after one is', () => {
  assert.deepEqual(programs('echo x > npm'), ['echo']);
  assert.deepEqual(programs('> out npm ci'), ['npm']);
  assert.deepEqual(programs('2>/dev/null npm ci'), ['npm']);
  assert.deepEqual(programs('npm ci 2>&1 | tee log'), ['npm', 'tee']);
  assert.deepEqual(programs('npm ci >log 2>&1'), ['npm']);
  // round 5, R27: `2>&1` is one redirection with its target, so a `1>` right after it is a
  // redirection of its own and the word after that its target, not the program
  assert.deepEqual(programs('2>&1>/dev/null npm ci'), ['npm']);
  assert.deepEqual(programs('>&2>/dev/null npm ci'), ['npm']);
  const [cmd] = commandsOf('npm ci > log');
  assert.deepEqual(cmd.args.map((a) => a.text), ['ci']);
  // heredoc bodies are data
  assert.deepEqual(programs('cat <<EOF\nnpm test\nEOF\nls'), ['cat', 'ls']);
});

test('quotes and expansions: what bash runs, and what an expansion decides', () => {
  assert.deepEqual(programs("n''pm ci"), ['npm']);
  assert.deepEqual(programs('n\\pm ci'), ['npm']);
  assert.deepEqual(programs("$'\\x6epm' ci"), ['npm']);
  assert.deepEqual(programs('$NPM ci'), ['$']);
  assert.deepEqual(programs('${NPM:-npm} ci'), ['$']);
  assert.deepEqual(programs('env -i PATH=/x npm ci'), ['npm']);
  assert.deepEqual(programs('sudo -u root npm ci'), ['npm']);
  assert.deepEqual(programs('timeout 60 npm ci'), ['npm']);
  assert.deepEqual(programs('command -v npm'), []);
  assert.deepEqual(programs('# npm ci\nls'), ['ls']);
});

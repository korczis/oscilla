// What keeps a pull-request judge apart from the code it starts (scripts/judge-isolation.mjs,
// review of #255, R12, R22): the ptrace probe fails closed, the manifest of the extracted copy
// is the one the `judge` step writes and a changed copy is refused, a child's environment
// carries nothing of the runner's, and a child's background grandchild dies with it.
//   node --test tests/unit/judge-isolation.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync,
  writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyProblems, digestOf, isolatedEnv, loadManifest, manifestOf, ptraceProbe,
  runIsolated, SYSTEM_PATH } from '../../scripts/judge-isolation.mjs';
import { parseYaml } from '../../scripts/yaml-subset.mjs';
import { createRequire } from 'node:module';
import { extractJudge } from './fixtures/judge-copy.mjs';
import { gitRepo } from './fixtures/git-repo.mjs';

const { until } = createRequire(import.meta.url)('../browser/lib/wait.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROGRAM = path.join(ROOT, 'scripts', 'judge-isolation.mjs');
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete GIT_ENV[k];

test('ptrace: 0 or no Yama file on Linux refuses; 1 and more pass; off Linux only outside CI',
  () => {
    const linux = (text) => ptraceProbe({ platform: 'linux', ci: true, read: () => text });
    assert.equal(linux('0\n').ok, false);
    assert.match(linux('0\n').message, /ptrace_scope is 0/);
    assert.equal(linux('').ok, false);
    assert.equal(linux('x').ok, false);
    for (const scope of ['1\n', '2', '3\n']) assert.equal(linux(scope).ok, true, scope);
    const missing = ptraceProbe({ platform: 'linux', ci: false, read: () => {
      throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
    } });
    assert.equal(missing.ok, false);
    assert.match(missing.message, /cannot be read \(ENOENT\)/);
    // off Linux: a note outside CI, a refusal under it
    const local = ptraceProbe({ platform: 'darwin', ci: false, read: () => '0' });
    assert.equal(local.ok, true);
    assert.match(local.message, /the ptrace probe is skipped/);
    assert.equal(ptraceProbe({ platform: 'darwin', ci: true }).ok, false);
  });

/**
 * A base commit with the programs and the wrapper, and `extra` files ({ path: text }) beside
 * them; `link`: a symbolic link under scripts/ too. { repo, sha }.
 */
function base(t, extra = {}, { link = false } = {}) {
  const repo = gitRepo('oscilla-judge-base-');
  t.after(() => repo.dispose());
  repo.commit('base', { 'scripts/fail-first.mjs': 'export {};\n',
    'scripts/b-c.mjs': 'export const b = 1;\n', 'scripts/B.mjs': 'export const B = 1;\n',
    '.github/scripts/base-rule.sh': '#!/bin/sh\n', 'README.md': 'not copied\n', ...extra });
  chmodSync(path.join(repo.dir, '.github', 'scripts', 'base-rule.sh'), 0o755);
  if (link) symlinkSync('fail-first.mjs', path.join(repo.dir, 'scripts', 'link.mjs'));
  repo.git('add', '-A');
  repo.git('commit', '-q', '--allow-empty', '-m', 'modes and links');
  const sha = repo.git('rev-parse', 'HEAD');
  repo.git('update-ref', 'refs/remotes/origin/main', sha);
  return { repo, sha };
}

/** A judge copy of `sha` as the `judge` step makes it: { dir, digest }. */
function copy(t, b = base(t)) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-judge-copy-'));
  t.after(() => {
    spawnSync('chmod', ['-R', 'u+w', dir]);
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, digest: extractJudge(b.repo.dir, b.sha, dir), ...b };
}

/** The `judge` step of each judge job, run on `repo` as the runner would: its output. */
function judgeSteps(t, repo) {
  const out = [];
  for (const wf of ['.github/workflows/ci.yml', '.github/workflows/metadata.yml']) {
    for (const [name, job] of Object.entries(parseYaml(readFileSync(path.join(ROOT, wf),
      'utf8')).jobs)) {
      const step = (job.steps || []).find((s) => s.id === 'judge');
      if (!step) continue;
      const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'oscilla-judge-step-')));
      t.after(() => {
        spawnSync('chmod', ['-R', 'u+w', tmp]);
        rmSync(tmp, { recursive: true, force: true });
      });
      writeFileSync(path.join(tmp, 'output'), '');
      const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step.run],
        { cwd: repo.dir, encoding: 'utf8', env: { ...GIT_ENV, RUNNER_TEMP: tmp,
          GITHUB_BASE_REF: 'main', GITHUB_OUTPUT: path.join(tmp, 'output') } });
      out.push({ job: `${wf}:${name}`, status: r.status, log: `${r.stdout}${r.stderr}`,
        dir: path.join(tmp, 'judge'), output: readFileSync(path.join(tmp, 'output'), 'utf8') });
    }
  }
  return out;
}

// review of #255, round 5, R30: the manifest is `git ls-tree -r` of the base commit, not
// `find | sha256sum` of the extracted files, so writer and verifier read one definition: a
// symbolic link or a name with a backslash under the base's scripts/ is left out of the copy
// with a warning naming it, instead of making every judge refuse every pull request.
test('R30: every judge step writes manifestOf()\'s manifest, and copies exactly it', (t) => {
  const b = base(t, { 'scripts/a\\b.mjs': 'export {};\n', 'scripts/sp ace.mjs': '' },
    { link: true });
  const want = manifestOf(b.repo.dir, b.sha);
  assert.equal(want.skipped.length, 3, want.skipped.join('\n'));
  assert.ok(want.skipped.some((l) => /^120000 blob /.test(l)), 'the symbolic link');
  assert.ok(want.skipped.some((l) => /"scripts\/a\\\\b\.mjs"$/.test(l)), 'the backslash name');
  assert.match(want.text, new RegExp(`^commit ${b.sha}\\n100755 blob [0-9a-f]{40}\\t`
    + '\\.github/scripts/base-rule\\.sh\\n'));
  assert.doesNotMatch(want.text, /README|link\.mjs|a\\b|sp ace/);
  const steps = judgeSteps(t, b.repo);
  assert.deepEqual(steps.map((s) => s.job), ['.github/workflows/ci.yml:fail-first',
    '.github/workflows/ci.yml:review-verdict', '.github/workflows/metadata.yml:metadata']);
  for (const s of steps) {
    assert.equal(s.status, 0, `${s.job}: ${s.log}`);
    assert.match(s.log, /^ptrace_scope=(?:\d+|missing)$/m, `${s.job}: R31, measured`);
    assert.match(s.log, /::warning::the judge: not copied from refs\/remotes\/origin\/main/,
      s.job);
    assert.match(s.log, /::warning::the judge: not copied .*120000 blob .*scripts\/link\.mjs/,
      s.job);
    assert.match(s.log, /::warning::the judge: not copied .*"scripts\/a\\\\b\.mjs"/, s.job);
    const text = readFileSync(path.join(s.dir, '.manifest'), 'utf8');
    assert.equal(text, want.text, s.job);
    assert.match(s.output, new RegExp(`^manifest=${digestOf(text)}$`, 'm'), s.job);
    const m = loadManifest(s.dir, digestOf(text));
    assert.equal(m.problem, null, s.job);
    assert.equal(m.commit, b.sha);
    // R38: the count in the log is the files', the manifest's commit header is none
    assert.equal(text.trim().split('\n').length - 1, m.entries.size, s.job);
    assert.match(s.log, new RegExp(`, ${m.entries.size} files$`, 'm'), `${s.job}: R38`);
    assert.deepEqual(copyProblems(s.dir, m), [], s.job);
    assert.ok(statSync(path.join(s.dir, '.github', 'scripts', 'base-rule.sh')).mode & 0o100);
    // the verifier refuses what the writer left out, put back into the copy
    spawnSync('chmod', ['-R', 'u+w', s.dir]);
    symlinkSync('fail-first.mjs', path.join(s.dir, 'scripts', 'link.mjs'));
    writeFileSync(path.join(s.dir, 'scripts', 'a\\b.mjs'), 'export {};\n');
    assert.deepEqual(copyProblems(s.dir, m).sort(), ['scripts/a\\b.mjs is not in the manifest',
      'scripts/link.mjs is not in the manifest']);
  }
});

test('a copy that departs from its manifest, or a manifest not the recorded one, is refused',
  (t) => {
    const { dir, digest, sha } = copy(t);
    const text = readFileSync(path.join(dir, '.manifest'), 'utf8');
    const m = loadManifest(dir, digest);
    assert.equal(m.problem, null);
    assert.equal(m.entries.size, 4);
    assert.equal(m.commit, sha);
    assert.deepEqual(copyProblems(dir, m), []);
    // the digest of another manifest, no digest, no manifest, no commit line, an odd line
    assert.match(loadManifest(dir, digestOf(`${text}x`)).problem, /not the [0-9a-f]{64} the judge/);
    assert.match(loadManifest(dir, '').problem, /is no sha256/);
    assert.match(loadManifest(path.join(dir, 'scripts'), digest).problem, /ENOENT/);
    const odd = (body) => {
      const other = mkdtempSync(path.join(os.tmpdir(), 'oscilla-judge-odd-'));
      t.after(() => rmSync(other, { recursive: true, force: true }));
      writeFileSync(path.join(other, '.manifest'), body);
      return loadManifest(other, digestOf(body)).problem;
    };
    assert.match(odd(text.split('\n').slice(1).join('\n')), /no `commit <sha>` first line/);
    assert.match(odd(`${text}120000 blob ${'a'.repeat(40)}\tscripts/l\n`), /a line that is no/);
    assert.match(odd(`${text}100644 blob ${'a'.repeat(40)}\tscripts/a\\b\n`), /a line that is/);
    assert.match(odd(`commit ${sha}\n`), /lists no file/);
    // a changed, a missing, an added file, a symlink in place of one, a lost executable bit,
    // another .base-commit
    writeFileSync(path.join(dir, '.github', 'scripts', 'base-rule.sh'), '#!/bin/sh\nexit 0\n');
    assert.deepEqual(copyProblems(dir, m), ['.github/scripts/base-rule.sh changed']);
    writeFileSync(path.join(dir, '.github', 'scripts', 'base-rule.sh'), '#!/bin/sh\n');
    chmodSync(path.join(dir, '.github', 'scripts', 'base-rule.sh'), 0o644);
    assert.deepEqual(copyProblems(dir, m), ['.github/scripts/base-rule.sh has lost or gained its'
      + ' executable bit (100755)']);
    chmodSync(path.join(dir, 'scripts', 'B.mjs'), 0o755);
    assert.ok(copyProblems(dir, m).includes('scripts/B.mjs has lost or gained its executable'
      + ' bit (100644)'));
    chmodSync(path.join(dir, 'scripts', 'B.mjs'), 0o644);
    chmodSync(path.join(dir, '.github', 'scripts', 'base-rule.sh'), 0o755);
    rmSync(path.join(dir, 'scripts', 'b-c.mjs'));
    writeFileSync(path.join(dir, 'scripts', 'extra.mjs'), '');
    assert.deepEqual(copyProblems(dir, m).sort(), ['scripts/b-c.mjs is missing',
      'scripts/extra.mjs is not in the manifest']);
    rmSync(path.join(dir, 'scripts', 'B.mjs'));
    symlinkSync(path.join(dir, 'scripts', 'fail-first.mjs'), path.join(dir, 'scripts', 'B.mjs'));
    assert.ok(copyProblems(dir, m).includes('scripts/B.mjs is no regular file'));
    writeFileSync(path.join(dir, '.base-commit'), `${'b'.repeat(40)}\n`);
    assert.ok(copyProblems(dir, m).includes(`.base-commit is not the manifest's commit ${sha}`));
    // the program: exit 1 and the refusal; exit 0 on the copy as written
    const r = spawnSync(process.execPath, [PROGRAM, '--verify', dir, digest], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /judge-isolation: REFUSED/);
    const fresh = copy(t);
    spawnSync('chmod', ['-R', 'a-w', fresh.dir]);
    const ok = spawnSync(process.execPath, [PROGRAM, '--verify', fresh.dir, fresh.digest],
      { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /matches its manifest \(4 files\)/);
    assert.equal(spawnSync(process.execPath, [PROGRAM, '--verify', fresh.dir]).status, 2);
  });

test('a child\'s environment is the fixed PATH, its HOME, CI and what the judge sets', () => {
  const env = isolatedEnv({ home: '/tmp/h', extra: { npm_config_audit: 'false' } });
  assert.deepEqual(Object.keys(env).filter((k) => k !== 'CI').sort(),
    ['HOME', 'PATH', 'npm_config_audit']);
  assert.equal(env.PATH, [path.dirname(process.execPath), ...SYSTEM_PATH].join(':'));
  for (const k of ['GITHUB_ENV', 'GITHUB_PATH', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY',
    'RUNNER_TEMP', 'NODE_OPTIONS', 'BASH_ENV']) assert.equal(k in env, false, k);
});

test('a child runs in a group of its own, and its background grandchild dies with it',
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-judge-group-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const pidFile = path.join(dir, 'grandchild.pid');
    // the child leaves a sleeping grandchild behind (its stdio its own, unref'd) and exits 0
    const script = "const { spawn } = require('node:child_process');"
      + "const g = spawn('sleep', ['60'], { stdio: 'ignore' }); g.unref();"
      + `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));`
      + "console.log('child', process.pid);";
    const r = await runIsolated(process.execPath, ['-e', script],
      { env: isolatedEnv({ home: dir }), timeoutMs: 20_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^child \d+/);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    assert.ok(pid > 0);
    const alive = () => {
      try {
        process.kill(pid, 0);
        // a zombie still answers until init reaps it; ps says what it is
        const ps = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
        return ps.status === 0 && !/^Z/.test(ps.stdout.trim());
      } catch {
        return false;
      }
    };
    await until(() => !alive(), { ms: 5_000,
      what: 'the grandchild is gone once the judge has its result' });
    // a child that runs past its time is killed with its group
    const slow = await runIsolated('sleep', ['30'], { env: isolatedEnv({ home: dir }),
      timeoutMs: 300 });
    assert.equal(slow.timedOut, true);
    assert.equal(slow.signal, 'SIGKILL');
  });

// review of #255, round 6, R37: tests/unit/fixtures/judge-copy.mjs is no guarded path, so what
// it does here is pinned by its git blob id (as the f001 fixtures are): a change to it is a
// change to this guarded test
test('R37: the judge-copy fixture is the reviewed blob', () => {
  const data = readFileSync(path.join(ROOT, 'tests', 'unit', 'fixtures', 'judge-copy.mjs'));
  const oid = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
  assert.equal(oid, '08b44ae6656fe04a5515574d9ffd650ba97198b6');
});

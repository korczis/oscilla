// What keeps a pull-request judge apart from the code it starts (scripts/judge-isolation.mjs,
// review of #255, R12, R22): the ptrace probe fails closed, the manifest of the extracted copy
// is the one the `judge` step writes and a changed copy is refused, a child's environment
// carries nothing of the runner's, and a child's background grandchild dies with it.
//   node --test tests/unit/judge-isolation.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync }
  from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyProblems, digestOf, isolatedEnv, loadManifest, manifestOf, ptraceProbe,
  runIsolated, SYSTEM_PATH } from '../../scripts/judge-isolation.mjs';
import { createRequire } from 'node:module';

const { until } = createRequire(import.meta.url)('../browser/lib/wait.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROGRAM = path.join(ROOT, 'scripts', 'judge-isolation.mjs');

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

/** A judge copy: files under a directory, its manifest written as the judge step writes it. */
function copy(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-judge-copy-'));
  t.after(() => {
    spawnSync('chmod', ['-R', 'u+w', dir]);
    rmSync(dir, { recursive: true, force: true });
  });
  mkdirSync(path.join(dir, 'scripts'));
  mkdirSync(path.join(dir, '.github', 'scripts'), { recursive: true });
  writeFileSync(path.join(dir, 'scripts', 'fail-first.mjs'), 'export {};\n');
  writeFileSync(path.join(dir, 'scripts', 'b-c.mjs'), 'export const b = 1;\n');
  writeFileSync(path.join(dir, 'scripts', 'B.mjs'), 'export const B = 1;\n');
  writeFileSync(path.join(dir, '.github', 'scripts', 'base-rule.sh'), '#!/bin/sh\n');
  writeFileSync(path.join(dir, '.base-commit'), `${'a'.repeat(40)}\n`);
  return dir;
}

test('the manifest is what the judge step\'s find | sort | sha256sum writes', (t) => {
  const dir = copy(t);
  const step = spawnSync('bash', ['-c', 'cd "$1" && find . -type f ! -path ./.manifest -print0'
    + ' | LC_ALL=C sort -z | xargs -0 sha256sum', 'bash', dir], { encoding: 'utf8' });
  assert.equal(step.status, 0, step.stderr);
  assert.equal(manifestOf(dir), step.stdout);
  assert.match(manifestOf(dir), /^[0-9a-f]{64} {2}\.\/\.base-commit\n/);
});

test('a copy that departs from its manifest, or a manifest not the recorded one, is refused',
  (t) => {
    const dir = copy(t);
    const text = manifestOf(dir);
    writeFileSync(path.join(dir, '.manifest'), text);
    const digest = digestOf(text);
    const { entries, problem } = loadManifest(dir, digest);
    assert.equal(problem, null);
    assert.equal(entries.size, 5);
    assert.deepEqual(copyProblems(dir, entries), []);
    // the digest of another manifest, no digest, no manifest
    assert.match(loadManifest(dir, digestOf(`${text}x`)).problem, /not the [0-9a-f]{64} the judge/);
    assert.match(loadManifest(dir, '').problem, /is no sha256/);
    assert.match(loadManifest(path.join(dir, 'scripts'), digest).problem, /ENOENT/);
    // a changed, a missing, an added file and a symlink in place of one
    writeFileSync(path.join(dir, '.github', 'scripts', 'base-rule.sh'), '#!/bin/sh\nexit 0\n');
    assert.deepEqual(copyProblems(dir, entries), ['./.github/scripts/base-rule.sh changed']);
    rmSync(path.join(dir, 'scripts', 'b-c.mjs'));
    writeFileSync(path.join(dir, 'scripts', 'extra.mjs'), '');
    assert.deepEqual(copyProblems(dir, entries).sort(), ['./.github/scripts/base-rule.sh changed',
      './scripts/b-c.mjs is missing', './scripts/extra.mjs is not in the manifest']);
    rmSync(path.join(dir, 'scripts', 'B.mjs'));
    symlinkSync(path.join(dir, 'scripts', 'fail-first.mjs'), path.join(dir, 'scripts', 'B.mjs'));
    assert.ok(copyProblems(dir, entries).includes('./scripts/B.mjs is no regular file'));
    // the program: exit 1 and the refusal; exit 0 on the copy as written
    const r = spawnSync(process.execPath, [PROGRAM, '--verify', dir, digest], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /judge-isolation: REFUSED/);
    const fresh = copy(t);
    writeFileSync(path.join(fresh, '.manifest'), manifestOf(fresh));
    chmodSync(fresh, 0o555);
    const ok = spawnSync(process.execPath, [PROGRAM, '--verify', fresh,
      digestOf(readFileSync(path.join(fresh, '.manifest')))], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.equal(spawnSync(process.execPath, [PROGRAM, '--verify', fresh]).status, 2);
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

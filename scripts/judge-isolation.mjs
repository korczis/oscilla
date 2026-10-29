#!/usr/bin/env node
// What keeps a pull-request judge apart from the pull-request code it starts (review of
// #255, R12, R22): the judge is the base commit's copy, extracted into $RUNNER_TEMP/judge by
// its job's `judge` step, made read-only there and listed in a sha256 manifest before
// anything of the pull request runs; the fail-first judge then starts every child (the
// install, the PR's tests) through runIsolated() with isolatedEnv(), and decides from its own
// memory, never from a file a child can write.
//
//   node scripts/judge-isolation.mjs --verify <judge-dir> <manifest-sha256>   # exit 0, or 1
//
// The pieces, each a fail-closed check:
//   ptraceProbe   the guarantee that a same-uid child cannot reach into the running judge
//                 rests on Yama: with /proc/sys/kernel/yama/ptrace_scope 1 or more a process
//                 may ptrace (and so write /proc/<pid>/mem of) only its own descendants.
//                 0, or no such file on Linux, refuses; off Linux the probe is skipped with a
//                 note outside CI and refuses under CI.
//   manifest      the `judge` step writes <judge>/.manifest (`sha256sum` lines `<hex>  ./<path>`
//                 of every file of the copy, in byte order) and passes the manifest's own
//                 sha256 to the judge as JUDGE_MANIFEST; loadManifest() checks that digest and
//                 copyProblems() the copy against the manifest, before any child and after the
//                 last. Defence in depth only: the copy is chmod -R a-w, but a child runs as
//                 the same user and could chmod it back, and what the judge has loaded is
//                 already in its memory; the check sees a copy changed, it does not prevent it.
//   isolatedEnv   a child's whole environment: a fixed PATH (the judge's node directory, then
//                 the system's), a HOME of its own, CI when the judge has it, and what the
//                 judge adds (its npm_config_*). No GITHUB_ENV, GITHUB_PATH, GITHUB_OUTPUT,
//                 GITHUB_STEP_SUMMARY, RUNNER_TEMP, NODE_OPTIONS or BASH_ENV.
//   runIsolated   a child in a process group of its own (detached); when it exits, or its time
//                 runs out, the whole group is killed (SIGKILL), so a grandchild it left
//                 running in the background does not outlive the judge. A grandchild that
//                 starts a session of its own (setsid) leaves the group, and this does not
//                 reach it.
// Tested by tests/unit/judge-isolation.test.mjs and by the replay of the judge jobs in
// tests/unit/base-rule.test.mjs.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PTRACE_SCOPE = '/proc/sys/kernel/yama/ptrace_scope';
/** The system directories of a child's PATH, after the judge's node directory. */
export const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
export const MANIFEST = '.manifest';

/**
 * Whether a same-uid child is kept from ptrace on its parent: { ok, message }. `read` returns
 * the text of PTRACE_SCOPE (throws when it is missing); `platform` and `ci` are the run's.
 */
export function ptraceProbe({ platform = process.platform, ci = Boolean(process.env.CI),
  read = () => readFileSync(PTRACE_SCOPE, 'utf8') } = {}) {
  if (platform !== 'linux') {
    return ci
      ? { ok: false, message: `ptrace: ${platform} under CI has no Yama ptrace_scope to read;`
        + ' the judge runs on Linux only' }
      : { ok: true, message: `ptrace: not Linux (${platform}), outside CI: the ptrace probe is`
        + ' skipped, so a child of this run could reach into the judge' };
  }
  let text;
  try {
    text = read();
  } catch (e) {
    return { ok: false, message: `ptrace: ${PTRACE_SCOPE} cannot be read (${e.code || e.message}):`
      + ' without Yama any same-uid child may ptrace the judge' };
  }
  const scope = Number.parseInt(String(text).trim(), 10);
  if (!Number.isInteger(scope) || scope < 1) {
    return { ok: false, message: `ptrace: ${PTRACE_SCOPE} is ${String(text).trim() || '(empty)'}:`
      + ' a same-uid child may ptrace the judge or write its /proc/<pid>/mem' };
  }
  return { ok: true, message: `ptrace: ptrace_scope ${scope}, a child cannot reach its parent` };
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** Every regular file under `dir` but the manifest, as `./<path>`, in byte order. */
function filesOf(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (r !== MANIFEST) out.push({ rel: `./${r}`, file: e.isFile() });
    }
  };
  walk('');
  return out.sort((a, b) => Buffer.compare(Buffer.from(a.rel), Buffer.from(b.rel)));
}

/** The manifest of `dir` as the `judge` step's sha256sum writes it. */
export function manifestOf(dir) {
  return filesOf(dir).filter((f) => f.file)
    .map((f) => `${sha256(readFileSync(path.join(dir, f.rel)))}  ${f.rel}\n`).join('');
}

/** The sha256 of a manifest's text. */
export const digestOf = (text) => sha256(text);

/**
 * The manifest of the judge copy `dir`, checked against `digest`: { entries: Map<path,
 * sha256>, problem: null } or { entries: null, problem }.
 */
export function loadManifest(dir, digest) {
  if (!/^[0-9a-f]{64}$/.test(String(digest || ''))) {
    return { entries: null, problem: `the manifest digest ${JSON.stringify(digest ?? '')} is no`
      + ' sha256' };
  }
  let text;
  try {
    text = readFileSync(path.join(dir, MANIFEST));
  } catch (e) {
    return { entries: null, problem: `${path.join(dir, MANIFEST)}: ${e.code || e.message}` };
  }
  if (sha256(text) !== digest) {
    return { entries: null, problem: `${MANIFEST} has sha256 ${sha256(text)}, not the`
      + ` ${digest} the judge step recorded` };
  }
  const entries = new Map();
  for (const line of text.toString('utf8').split('\n')) {
    if (!line) continue;
    const m = /^([0-9a-f]{64}) {2}(\.\/[^\n\\]+)$/.exec(line);
    if (!m) return { entries: null, problem: `${MANIFEST}: a line that is no entry: ${line}` };
    entries.set(m[2], m[1]);
  }
  if (!entries.size) return { entries: null, problem: `${MANIFEST} lists no file` };
  return { entries, problem: null };
}

/** How the copy `dir` departs from its manifest's `entries`: [] when it is the same. */
export function copyProblems(dir, entries) {
  const out = [];
  const seen = new Set();
  for (const f of filesOf(dir)) {
    seen.add(f.rel);
    if (!entries.has(f.rel)) out.push(`${f.rel} is not in the manifest`);
    else if (!f.file || lstatSync(path.join(dir, f.rel)).isSymbolicLink()) {
      out.push(`${f.rel} is no regular file`);
    } else if (sha256(readFileSync(path.join(dir, f.rel))) !== entries.get(f.rel)) {
      out.push(`${f.rel} changed`);
    }
  }
  for (const rel of entries.keys()) if (!seen.has(rel)) out.push(`${rel} is missing`);
  return out;
}

/**
 * A child's whole environment: PATH (the judge's node directory first, then SYSTEM_PATH),
 * HOME, CI when the judge runs under it, and `extra` (what the judge itself sets).
 */
export function isolatedEnv({ home, extra = {} } = {}) {
  const env = { PATH: [path.dirname(process.execPath), ...SYSTEM_PATH].join(':'), HOME: home };
  if (process.env.CI) env.CI = process.env.CI;
  return { ...env, ...extra };
}

/**
 * Run `file` with `args` in a process group of its own and wait for it; then kill what is
 * left of the group. Resolves { status, signal, stdout, stderr, timedOut }.
 */
export function runIsolated(file, args, { cwd, env, timeoutMs = 180_000,
  maxBuffer = 256 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ status: null, signal: null, stdout: '', stderr: String(e.message),
        timedOut: false });
      return;
    }
    const out = { stdout: [], stderr: [], size: 0 };
    const keep = (k) => (chunk) => {
      if (out.size + chunk.length <= maxBuffer) out[k].push(chunk);
      out.size += chunk.length;
    };
    child.stdout.on('data', keep('stdout'));
    child.stderr.on('data', keep('stderr'));
    const killGroup = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // the group is gone already
      }
    };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    let done = false;
    const finish = (status, signal, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      killGroup();
      // the pipes close once nothing of the group holds them; bounded, since the group is dead
      const settle = () => resolve({ status, signal, timedOut,
        stdout: Buffer.concat(out.stdout).toString('utf8'),
        stderr: Buffer.concat(out.stderr).toString('utf8') + (error ? `\n${error.message}` : '') });
      let closed = 0;
      const grace = setTimeout(settle, 2000);
      const onClose = () => {
        closed += 1;
        if (closed === 2) {
          clearTimeout(grace);
          settle();
        }
      };
      if (child.stdout.closed) onClose(); else child.stdout.once('close', onClose);
      if (child.stderr.closed) onClose(); else child.stderr.once('close', onClose);
    };
    child.once('error', (e) => finish(null, null, e));
    child.once('exit', (status, signal) => finish(status, signal, null));
  });
}

const isMain = process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const [flag, dir, digest, ...rest] = process.argv.slice(2);
  if (flag !== '--verify' || !dir || !digest || rest.length) {
    console.error('usage: node scripts/judge-isolation.mjs --verify <judge-dir> <manifest-sha256>');
    process.exit(2);
  }
  const { entries, problem } = loadManifest(dir, digest);
  const problems = problem ? [problem] : copyProblems(dir, entries);
  for (const p of problems) console.error(`judge-isolation: ${p}`);
  if (problems.length) {
    console.error('judge-isolation: REFUSED: the judge copy is not the one its step extracted');
    process.exit(1);
  }
  console.log(`judge-isolation: the judge copy matches its manifest (${entries.size} files)`);
}

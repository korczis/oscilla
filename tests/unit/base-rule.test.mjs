// project.fail-first, project.review-verdict and project.pr-names-its-plan are judged by the
// BASE branch's copy of their programs: .github/scripts/base-rule.sh on fixture pull requests
// that rewrite the program that would judge them. Each fixture's `main` carries the real
// programs of this checkout.
//   node --test tests/unit/base-rule.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync,
  writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { copyProblems, digestOf, loadManifest, manifestOf }
  from '../../scripts/judge-isolation.mjs';
import { extractJudge } from './fixtures/judge-copy.mjs';
import { parseYaml } from '../../scripts/yaml-subset.mjs';
import { gitRepo } from './fixtures/git-repo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRAPPER = path.join(ROOT, '.github', 'scripts', 'base-rule.sh');
const PROGRAMS = ['scripts/review-verdict.mjs', 'scripts/fail-first.mjs',
  'scripts/git-ref.mjs', 'scripts/yaml-subset.mjs', 'scripts/pr-metadata.mjs',
  'scripts/release-analyze.mjs', 'scripts/release-metadata.mjs', 'scripts/shell-words.mjs',
  'scripts/judge-isolation.mjs'];
const real = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'NODE_TEST_CONTEXT']) delete ENV[k];

const sh = (repo, ...args) => {
  const r = spawnSync('bash', [WRAPPER, ...args], { cwd: repo.dir, encoding: 'utf8', env: ENV });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const own = (repo, program, ...args) => {
  const r = spawnSync(process.execPath, [path.join(repo.dir, program), '--repo', repo.dir,
    ...args], { encoding: 'utf8', env: ENV });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

/** main: the real programs, an engine file, a value with its test. On a PR branch. */
function fixture(t, { programs = PROGRAMS } = {}) {
  const repo = gitRepo('oscilla-base-rule-');
  t.after(() => repo.dispose());
  repo.commit('base', {
    ...Object.fromEntries(programs.map((p) => [p, real(p)])),
    'src/js/audio/audio-engine.js': 'export const gain = 1;\n',
    'src/value.mjs': 'export const value = () => 1;\n',
    'README.md': 'fixture\n',
  });
  // what actions/checkout fetches: the base branch as a remote-tracking ref
  repo.git('update-ref', BASE, 'main');
  repo.branch('pr');
  return repo;
}
const BASE = 'refs/remotes/origin/main';
const VERDICT = ['--pr', '42', '--base-branch', BASE];
const judged = (program) => new RegExp(`base-rule: scripts/${program}\\.mjs of ${BASE}`
  + ' \\([0-9a-f]{12}\\) judges this pull request');

test('a PR that deletes the audio entry from GUARDED is judged by main\'s list', (t) => {
  const repo = fixture(t);
  const edited = real('scripts/review-verdict.mjs').replace("  'src/js/audio/*',\n", '');
  assert.notEqual(edited, real('scripts/review-verdict.mjs'));
  repo.commit('change', {
    'src/js/audio/audio-engine.js': 'export const gain = 0.5;\n',
    'scripts/review-verdict.mjs': edited,
  });
  const r = sh(repo, BASE, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, judged('review-verdict'));
  assert.match(r.out, /src\/js\/audio\/audio-engine\.js/);
  assert.match(r.out, /REFUSED: \.ai\/repo\/reviews\/42\.yaml is not in the head commit/);
  // and the edited copy still sees its own file as guarded, since the list names it
  const self = own(repo, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(self.status, 1, self.out);
  assert.doesNotMatch(self.out, /audio-engine/);
});

test('a PR that replaces the program with one that always accepts is refused', (t) => {
  const repo = fixture(t);
  repo.commit('change', {
    'src/js/audio/audio-engine.js': 'export const gain = 0.5;\n',
    'scripts/review-verdict.mjs': "console.log('review-verdict: accepted');\n",
    'scripts/fail-first.mjs': "console.log('fail-first: proven');\n",
    'tests/unit/tidy.test.mjs': "import test from 'node:test';\ntest('nothing', () => {});\n",
  });
  assert.equal(own(repo, 'scripts/review-verdict.mjs', ...VERDICT).status, 0,
    'the PR\'s own copy lets it through: this is what must not judge');
  const verdict = sh(repo, BASE, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(verdict.status, 1, verdict.out);
  assert.match(verdict.out, /scripts\/review-verdict\.mjs\n/);
  assert.match(verdict.out, /REFUSED/);

  const pr = path.join(repo.dir, '..', `${path.basename(repo.dir)}.pr.json`);
  t.after(() => spawnSync('rm', ['-f', pr]));
  writeFileSync(pr, JSON.stringify({ title: 'fix(x): tidy', body: '' }));
  const first = sh(repo, BASE, 'scripts/fail-first.mjs', '--pr-json', pr,
    '--base-branch', BASE);
  assert.equal(first.status, 1, first.out);
  assert.match(first.out, judged('fail-first'));
  assert.match(first.out, /tidy\.test\.mjs: passes without the change - not evidence/);
});

test('a PR that replaces pr-metadata.mjs with one that always passes is refused (R022)', (t) => {
  const repo = fixture(t);
  repo.commit('change', {
    'scripts/pr-metadata.mjs': "console.log('pr-metadata: no violation');\n",
  });
  const pr = path.join(repo.dir, '..', `${path.basename(repo.dir)}.meta.json`);
  t.after(() => spawnSync('rm', ['-f', pr]));
  writeFileSync(pr, JSON.stringify({ number: 42, title: 'chore(x): tidy', headRefName: 'pr',
    body: '' }));
  const args = ['--pr-json', pr, '--head', 'HEAD', '--base', BASE, '--check'];
  assert.equal(own(repo, 'scripts/pr-metadata.mjs', ...args).status, 0,
    'the PR\'s own copy lets it through: this is what must not judge');
  const r = sh(repo, BASE, 'scripts/pr-metadata.mjs', ...args);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, judged('pr-metadata'));
  assert.match(r.out, /plan-id-missing: /);
});

test('the program\'s exit status and output pass through when it accepts', (t) => {
  const repo = fixture(t);
  repo.commit('docs', { 'README.md': 'fixture, documented\n' });
  const r = sh(repo, BASE, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /none of the 1 changed path\(s\) is guarded; no verdict needed/);
});

test('only where the base has no program does the checkout\'s copy judge, with a warning', (t) => {
  const repo = fixture(t, { programs: [] });
  repo.commit('introduce', {
    ...Object.fromEntries(PROGRAMS.map((p) => [p, real(p)])),
    'src/js/audio/audio-engine.js': 'export const gain = 0.5;\n',
  });
  const r = sh(repo, BASE, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out,
    /::warning::base-rule: refs\/remotes\/origin\/main \([0-9a-f]{12}\) has no scripts\/review/);
  assert.match(r.out, /REFUSED/);
});

test('any other program, and a base that does not exist, are refused', (t) => {
  const repo = fixture(t);
  assert.equal(sh(repo, BASE, 'scripts/build.mjs').status, 2);
  assert.notEqual(sh(repo, 'refs/remotes/origin/no-such-ref', 'scripts/review-verdict.mjs',
    ...VERDICT).status, 0);
  assert.notEqual(sh(repo).status, 0);
});

// R2 (review of #255): git looks a short name up in refs/tags/ before refs/remotes/, and the
// checkout fetches tags, so a pushed tag named origin/main shadowed the base branch and the
// pull request's own program judged it.
test('a tag named origin/main does not let the PR\'s own program judge (R2)', (t) => {
  const repo = fixture(t);
  repo.commit('change', {
    'src/js/audio/audio-engine.js': 'export const gain = 0.5;\n',
    'scripts/review-verdict.mjs': "console.log('review-verdict: accepted');\n",
  });
  repo.git('tag', 'origin/main', 'HEAD');
  const accepted = /review-verdict: accepted/;
  // the unqualified name every caller passed: refused before anything runs
  const short = sh(repo, 'origin/main', 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(short.status, 2, short.out);
  assert.match(short.out,
    /base-rule: origin\/main is not a remote-tracking ref \(refs\/remotes\/\.\.\.\)/);
  assert.doesNotMatch(short.out, accepted);
  // qualified, while the tag shadows its short name: refused as ambiguous
  const shadowed = sh(repo, BASE, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(shadowed.status, 2, shadowed.out);
  assert.match(shadowed.out,
    /base-rule: refs\/remotes\/origin\/main is ambiguous: refs\/tags\/origin\/main shadows/);
  assert.doesNotMatch(shadowed.out, accepted);
  // without the tag the base's program judges, by its ref or by its full commit name
  repo.git('tag', '-d', 'origin/main');
  const r = sh(repo, BASE, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, judged('review-verdict'));
  assert.match(r.out, /REFUSED/);
  const sha = repo.git('rev-parse', 'main');
  const bySha = sh(repo, sha, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(bySha.status, 1, bySha.out);
  assert.match(bySha.out, /REFUSED/);
  // nothing else names a base: a branch, a tag, HEAD, an abbreviated commit, an expression
  repo.git('tag', 'v1', 'main');
  for (const ref of ['main', 'refs/heads/main', 'refs/tags/v1', 'HEAD', sha.slice(0, 12),
    `${BASE}~0`, `${BASE}/`]) {
    const x = sh(repo, ref, 'scripts/review-verdict.mjs', ...VERDICT);
    assert.equal(x.status, 2, `${ref}: ${x.out}`);
    assert.doesNotMatch(x.out, accepted, ref);
  }
});

test('a program started through a symlinked directory still runs, not exit 0 unrun', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-base-rule-link-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  symlinkSync(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'));
  for (const program of ['review-verdict.mjs', 'fail-first.mjs', 'pr-metadata.mjs']) {
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts', program)],
      { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 2, `${program}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /usage: node scripts\//);
  }
  const rules = spawnSync(process.execPath, [path.join(dir, 'scripts', 'ci-workflow-rules.mjs')],
    { encoding: 'utf8', env: ENV });
  assert.match(rules.stdout + rules.stderr, /project\.ci-bounded:/);
});

// R12, R22 (review of #255, rounds 2-4): what runs before the judge in its job could take it
// over: a postinstall of the pull request's package.json, the `prepare` of a git dependency
// (which `npm ci --ignore-scripts` still runs, R17), a helper program a PR .npmrc names
// (`git=./evil.sh`, R18), or both at once (R22), which rewrote the extracted judge. So in
// round 4 nothing of the pull request runs before the judge, and the judge (the base's
// fail-first.mjs) runs the install itself; since round 8 it has read and written everything it
// judges from git first, and installs into the extracted head tree, never the checkout, as a
// child like the tests. Here every job of ci.yml and
// metadata.yml that runs base-rule.sh is run as the runner runs it, its steps in order: each
// `run` through its step's shell (bash -eo pipefail unless `shell:` says otherwise), what a
// step writes to $GITHUB_ENV and $GITHUB_PATH applied to the steps after it, $GITHUB_OUTPUT
// read into `steps.<id>.outputs`, setup-node putting this node's directory on PATH and the
// checkout being the fixture; npm runs for real, offline (a git dependency is a git+file: URL
// of a fixture repository; CI's would be github:).
const WRAPPER_REL = '.github/scripts/base-rule.sh';
const HOSTILE_SH = String.raw`#!/bin/sh
# what a pull request's code can do to the job that judges it (review of #255, R12, R17-R22)
cd "${'$'}{INIT_CWD:-.}"
for vector in "$@"; do
  case "$vector" in
    wrapper)
      printf '#!/bin/sh\necho "HOSTILE wrapper"\nexit 0\n' > .github/scripts/base-rule.sh ;;
    path)
      mkdir -p "$PWD/.hostile"
      printf '#!/bin/sh\necho "HOSTILE node"\nexit 0\n' > "$PWD/.hostile/node"
      chmod +x "$PWD/.hostile/node"
      echo "$PWD/.hostile" >> "$GITHUB_PATH" ;;
    env) echo "NODE_OPTIONS=--require $PWD/hostile.cjs" >> "$GITHUB_ENV"
      echo "BASH_ENV=$PWD/hostile-bash-env.sh" >> "$GITHUB_ENV" ;;
    ran=*) echo ran > "${'$'}{vector#ran=}" ;;
    judge)
      # read-only does not stop the same user (R22)
      chmod -R u+w "$RUNNER_TEMP/judge"
      printf '#!/bin/sh\necho "HOSTILE judge copy"\nexit 0\n' \
        > "$RUNNER_TEMP/judge/.github/scripts/base-rule.sh" ;;
  esac
done
`;
const LOCK = (name, packages = {}, rootDeps = null) => `${JSON.stringify({ name,
  version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name, version: '1.0.0',
    ...(rootDeps || Object.keys(packages).length ? { dependencies: rootDeps
      || Object.fromEntries(Object.entries(packages).map(([k, v]) => [k.replace(/^node_modules\//,
        ''), v.spec])) } : {}) },
  ...Object.fromEntries(Object.entries(packages).map(([k, v]) => [k, v.entry])) } },
null, 2)}\n`;
const PKG = (scripts, dependencies) => `${JSON.stringify({ name: 'fixture', version: '1.0.0',
  private: true, scripts, ...(dependencies ? { dependencies } : {}) }, null, 2)}\n`;
// a test the pull request adds, so that the fail-first judge gets as far as its install
const PR_TEST = "import test from 'node:test';\ntest('nothing to see', () => {});\n";
/** A git repository with one package whose `prepare` runs the PR's hostile.sh: its spec. */
function gitDependency(t, vectors, name = 'dep') {
  const dep = gitRepo('oscilla-base-rule-gitdep-');
  t.after(() => dep.dispose());
  const prepare = `sh "$INIT_CWD/hostile.sh" ${vectors.join(' ')}`;
  const sha = dep.commit('dep', { 'package.json': `${JSON.stringify({ name,
    version: '1.0.0', scripts: { prepare } })}\n` });
  return `git+file://${dep.dir}#${sha}`;
}

/**
 * main: the real programs and wrapper, a package; the PR adds a test and carries hostile code
 * reached by `route`: `postinstall` (its package.json), `git-dependency` (a dependency's
 * prepare, R17) or `npmrc` (a .npmrc `git=` with a git dependency to make npm call it, R18).
 */
function hostileFixture(t, vectors, route = 'postinstall') {
  const repo = gitRepo('oscilla-base-rule-r12-');
  t.after(() => repo.dispose());
  repo.commit('base', {
    ...Object.fromEntries(PROGRAMS.map((p) => [p, real(p)])),
    [WRAPPER_REL]: real(WRAPPER_REL),
    'package.json': PKG({}),
    'package-lock.json': LOCK('fixture'),
    'README.md': 'fixture\n',
  });
  chmodSync(path.join(repo.dir, WRAPPER_REL), 0o755);
  repo.commit('the wrapper is executable', {});
  repo.git('update-ref', BASE, 'main');
  repo.branch('pr');
  const files = {
    'hostile.sh': HOSTILE_SH,
    'hostile.cjs': "console.log('HOSTILE hook');\nprocess.exit(0);\n",
    'hostile-bash-env.sh': 'echo "HOSTILE BASH_ENV"; exit 0\n',
    'tests/unit/nothing.test.mjs': PR_TEST,
  };
  const evil = `#!/bin/sh\nsh ./hostile.sh ${vectors.join(' ')}\nexec git "$@"\n`;
  if (route === 'postinstall') {
    files['package.json'] = PKG({ postinstall: `sh hostile.sh ${vectors.join(' ')}` });
  } else {
    const spec = gitDependency(t, route === 'npmrc' ? [] : vectors);
    files['package.json'] = PKG({}, { dep: spec });
    files['package-lock.json'] = LOCK('fixture', { 'node_modules/dep': { spec,
      entry: { version: '1.0.0', resolved: spec } } });
    if (route === 'npmrc') {
      files['.npmrc'] = 'git=./evil.sh\n';
      files['evil.sh'] = evil;
    }
  }
  // (executable in the commit: the judge writes the tree from git, not from the checkout)
  if (files['evil.sh']) {
    writeFileSync(path.join(repo.dir, 'evil.sh'), files['evil.sh'], { mode: 0o755 });
    delete files['evil.sh'];
  }
  const head = repo.commit('feat: nothing to see', files);
  return { repo, head };
}

/** The step that calls the copy of base-rule.sh the job took from the base commit. */
const CALL = /judge\/\.github\/scripts\/base-rule\.sh/;

/** Every job that runs base-rule.sh, with its steps up to and including the judge's. */
function judgeJobs() {
  const out = [];
  for (const wf of ['.github/workflows/ci.yml', '.github/workflows/metadata.yml']) {
    const doc = parseYaml(real(wf));
    for (const [name, job] of Object.entries(doc.jobs)) {
      const steps = job.steps || [];
      const i = steps.findIndex((s) => typeof s.run === 'string' && CALL.test(s.run));
      if (i < 0) continue;
      const program = /scripts\/[\w-]+\.mjs/.exec(steps[i].run.split(CALL)[1])[0];
      out.push({ wf, name, program, env: { ...doc.env, ...job.env },
        steps: steps.slice(0, i + 1) });
    }
  }
  return out;
}

/**
 * Run a job's steps on the fixture as the runner would, `before` (shell texts) ahead of them
 * and the steps `drop` matches left out. setup-node puts this node's directory on PATH; the
 * checkout is the fixture. Returns the status and output of the last step that ran, and the
 * output of every step.
 */
function runJob(t, repo, head, job, { before = [], drop = () => false } = {}) {
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'oscilla-runner-')));
  t.after(() => {
    spawnSync('chmod', ['-R', 'u+w', tmp]); // the judge copy is read-only
    rmSync(tmp, { recursive: true, force: true });
  });
  const bin = path.join(tmp, 'bin');
  mkdirSync(bin);
  const prJson = path.join(tmp, 'event-pr.json');
  writeFileSync(prJson, JSON.stringify({ number: 42, title: 'feat(x): nothing to see',
    body: '', headRefName: 'pr' }));
  // the runner's /usr/bin/gh, for a judge's PATH of system directories
  writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\ncat "${prJson}"\n`);
  chmodSync(path.join(bin, 'gh'), 0o755);
  writeFileSync(path.join(tmp, 'npmrc'), '');
  const outputs = {};
  const context = () => ({
    'github.token': 'fixture-token',
    'github.event.pull_request.number': '42',
    'github.event.pull_request.head.sha': head,
    'runner.temp': tmp,
    ...Object.fromEntries(Object.entries(outputs).flatMap(([id, o]) => Object.entries(o)
      .map(([k, v]) => [`steps.${id}.outputs.${k}`, v]))),
  });
  const expand = (v) => String(v).replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_, e) => {
    const c = context();
    assert.ok(e in c, `${job.name}: the simulation knows the expression ${e}`);
    return c[e];
  });
  const expandAll = (o) => Object.fromEntries(Object.entries(o || {})
    .map(([k, v]) => [k, expand(v)]));
  // the job's environment, without anything of this test run's own npm (npm test sets
  // npm_config_local_prefix and friends, which would point npm ci at this checkout)
  const env = Object.fromEntries(Object.entries(ENV).filter(([k]) => !/^npm_|^INIT_CWD$/i.test(k)
    && k !== 'NODE_OPTIONS'));
  Object.assign(env, {
    GITHUB_BASE_REF: 'main', GITHUB_REPOSITORY: 'fixture/oscilla', RUNNER_TEMP: tmp,
    GITHUB_WORKSPACE: repo.dir, GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.md'),
    npm_config_cache: path.join(tmp, 'npm-cache'),
    npm_config_userconfig: path.join(tmp, 'npmrc'),
    npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
    npm_config_offline: 'true',
  });
  const steps = [...before.map((run) => ({ run })), ...job.steps.filter((s) => !drop(s))];
  let added = {};
  let paths = [bin];
  let last = null;
  const log = [];
  steps.forEach((step, k) => {
    if (last && last.status !== 0) return; // a failed step ends the job
    if (typeof step.run !== 'string') {
      assert.ok(!String(step.uses).startsWith('./'), `${job.name}: no local action to simulate`);
      // what setup-node does: its node's directory first on PATH
      if (/^actions\/setup-node@/.test(step.uses)) {
        paths = [path.dirname(process.execPath), ...paths];
      }
      return;
    }
    const files = { GITHUB_ENV: path.join(tmp, `env-${k}`),
      GITHUB_PATH: path.join(tmp, `path-${k}`), GITHUB_OUTPUT: path.join(tmp, `output-${k}`) };
    for (const f of Object.values(files)) writeFileSync(f, '');
    const script = path.join(tmp, `step-${k}.sh`);
    // the judge refuses CI off Linux (no Yama to probe), and the runner is Linux: elsewhere
    // the replay starts it as a local run, which skips the probe with a note
    writeFileSync(script, process.platform === 'linux' ? expand(step.run)
      : expand(step.run).replace(/ CI=true /g, ' '));
    const shell = (step.shell || 'bash --noprofile --norc -eo pipefail {0}').split(' ')
      .map((w) => (w === '{0}' ? script : w));
    const r = spawnSync(shell[0], shell.slice(1), {
      cwd: repo.dir, encoding: 'utf8',
      env: { ...env, ...expandAll(job.env), ...added, ...expandAll(step.env), ...files,
        PATH: [...paths, ENV.PATH].join(path.delimiter) },
    });
    last = { status: r.status, out: `${r.stdout}${r.stderr}` };
    log.push(last.out);
    // what the runner does between steps: $GITHUB_ENV sets, $GITHUB_PATH prepends
    for (const line of readFileSync(files.GITHUB_ENV, 'utf8').split('\n')) {
      const m = /^([A-Za-z_]\w*)=(.*)$/.exec(line);
      if (m) added = { ...added, [m[1]]: m[2] };
    }
    paths = [...readFileSync(files.GITHUB_PATH, 'utf8').split('\n').filter(Boolean).reverse(),
      ...paths];
    if (step.id) {
      const o = {};
      for (const line of readFileSync(files.GITHUB_OUTPUT, 'utf8').split('\n')) {
        const m = /^([\w-]+)=(.*)$/.exec(line);
        if (m) o[m[1]] = m[2];
      }
      // the runner's system directories hold gh; here the fixture's stands in for it
      if (o.path) o.path = `${bin}:${o.path}`;
      outputs[step.id] = o;
    }
  });
  return { ...last, log: log.join('\n') };
}

const STATUS = { 'scripts/fail-first.mjs': 1, 'scripts/pr-metadata.mjs': 1,
  'scripts/review-verdict.mjs': 0 };
/** The judge copy a job's `judge` step extracted, and whether it still matches its manifest. */
function copyIntact(repo, jobRoot) {
  const dir = path.join(jobRoot, 'judge');
  const manifest = readFileSync(path.join(dir, '.manifest'), 'utf8');
  const m = loadManifest(dir, digestOf(manifest));
  return manifest === manifestOf(repo.dir, repo.git('rev-parse', BASE)).text && !m.problem
    && copyProblems(dir, m).length === 0 && /\t\.github\/scripts\/base-rule\.sh\n/.test(manifest)
    && readFileSync(path.join(dir, WRAPPER_REL), 'utf8') === real(WRAPPER_REL);
}
/** runJob, keeping the runner's temporary directory to look at afterwards. */
function runJobKeep(t, repo, head, job, opts = {}) {
  let root = null;
  const r = runJob(t, repo, head, { ...job, steps: [{ run: 'echo "$RUNNER_TEMP" > "$PWD/.runner"' },
    ...job.steps] }, opts);
  root = readFileSync(path.join(repo.dir, '.runner'), 'utf8').trim();
  return { ...r, root };
}

test('R12: a PR\'s postinstall can no longer change what judges it, in any judge job', (t) => {
  const jobs = judgeJobs();
  assert.deepEqual(jobs.map((j) => `${j.wf}:${j.name}`).sort(), [
    '.github/workflows/ci.yml:fail-first', '.github/workflows/ci.yml:review-verdict',
    '.github/workflows/metadata.yml:metadata']);
  // the shape (round 4): setup-node, the checkout, the judge step, the judge's step; nothing
  // installs before the judge, and the judge's step is the job's last
  for (const job of jobs) {
    const names = job.steps.map((st) => st.uses || st.id || 'judge-step');
    assert.deepEqual(names, ['actions/setup-node@v7', 'actions/checkout@v7', 'judge',
      'judge-step'], job.name);
    assert.ok(job.steps.every((st) => !/\bnpm\b/.test(String(st.run || '')
      .split(CALL)[0])), `${job.name}: nothing is installed before the judge`);
    // round 8, P3: the judge fetches nothing after the checkout, so no credential is left in
    // the checkout's .git/config for the pull request's code to read
    assert.equal(job.steps[1].with?.['persist-credentials'], false, job.name);
  }
  // the control: with a plain `npm ci` and the checkout's own wrapper, each vector alone
  // takes the judge over
  const ff = jobs.find((j) => j.name === 'fail-first');
  for (const vector of ['wrapper', 'path', 'env']) {
    const { repo, head } = hostileFixture(t, [vector]);
    const r = runJob(t, repo, head, { ...ff, steps: [] }, { before: ['npm ci',
      '.github/scripts/base-rule.sh "refs/remotes/origin/$GITHUB_BASE_REF" scripts/fail-first.mjs'
      + ' --title "feat(x): y" --base-branch "refs/remotes/origin/$GITHUB_BASE_REF"'] });
    assert.equal(r.status, 0, `${vector}: ${r.out}`);
    assert.match(r.out, /HOSTILE/, `${vector}: the attack is real`);
  }
  // every judge job as it is: the postinstall does not run, the base's program judges, the
  // extracted copy is the one its step wrote; fail-first installed the packages itself
  for (const job of jobs) {
    const { repo, head } = hostileFixture(t, ['wrapper', 'path', 'env', 'judge']);
    const r = runJobKeep(t, repo, head, job);
    assert.doesNotMatch(r.log, /HOSTILE/, `${job.name}: ${r.log}`);
    assert.match(r.out, judged(job.program.slice(8, -4)), `${job.name}: ${r.out}`);
    assert.equal(r.status, STATUS[job.program], `${job.name}: ${r.out}`);
    assert.equal(readFileSync(path.join(repo.dir, WRAPPER_REL), 'utf8'), real(WRAPPER_REL),
      `${job.name}: the wrapper is the committed one`);
    assert.ok(copyIntact(repo, r.root), `${job.name}: the judge copy is unchanged`);
    if (job.name === 'fail-first') {
      assert.match(r.out, /the judge copy matches its manifest/);
      assert.match(r.out, /installed with `npm ci --ignore-scripts` by the judge/, r.out);
      assert.match(r.out, /nothing\.test\.mjs: passes without the change - not evidence/);
    } else {
      assert.doesNotMatch(r.log, /npm ci/, `${job.name} installs nothing`);
    }
  }
});

// R17, R18, R22 (review of #255, rounds 3 and 4): `npm ci --ignore-scripts` still clones a git
// dependency and runs its prepare, and still spawns the program a PR .npmrc names for git;
// before the judge (round 3's shape) that rewrote the read-only judge copy. Round 8: no guard
// tells such a lockfile apart any more. The judge has read and written everything it judges
// from git before the install, which runs in the extracted head tree as a child like the tests,
// with a cleared environment; so the hostile code runs, and reaches neither the checkout's
// wrapper, nor the judge copy (no RUNNER_TEMP, GITHUB_ENV or GITHUB_PATH reaches it), nor the
// verdict.
test('R17, R18, R22, round 8: install-time code runs as the judge\'s child and decides nothing',
  (t) => {
    const ff = judgeJobs().find((j) => j.name === 'fail-first');
    // round 3's shape: an install step between the judge step and the judge's step
    const round3 = { ...ff, steps: [...ff.steps.slice(0, -1), { run: 'npm ci --ignore-scripts' },
      ff.steps.at(-1)] };
    for (const route of ['git-dependency', 'npmrc']) {
      // the control: under --ignore-scripts npm runs the PR's code, and before the judge it
      // rewrites the read-only extracted copy, so the judge's step prints a forged pass
      const control = hostileFixture(t, ['wrapper', 'judge'], route);
      const plain = runJob(t, control.repo, control.head, round3);
      assert.match(readFileSync(path.join(control.repo.dir, WRAPPER_REL), 'utf8'), /HOSTILE/,
        `${route}: the attack is real under --ignore-scripts: ${plain.log}`);
      assert.match(plain.out, /HOSTILE judge copy/, `${route}: ${plain.log}`);
      assert.equal(plain.status, 0, `${route}: the forged pass`);
      // the job as it is: the hostile code runs as the judge's child, and the verdict is the
      // base program's (the PR's one test passes without the change: not evidence)
      const marks = mkdtempSync(path.join(os.tmpdir(), 'oscilla-base-rule-ran-'));
      t.after(() => rmSync(marks, { recursive: true, force: true }));
      const mark = path.join(marks, 'ran');
      const { repo, head } = hostileFixture(t, ['wrapper', 'path', 'env', 'judge',
        `ran=${mark}`], route);
      const r = runJobKeep(t, repo, head, ff);
      assert.equal(readFileSync(mark, 'utf8'), 'ran\n', `${route}: the code ran: ${r.log}`);
      assert.equal(r.status, 1, `${route}: ${r.log}`);
      assert.match(r.out, judged('fail-first'), route);
      assert.match(r.out, /installed with `npm ci --ignore-scripts` by the judge/, route);
      assert.match(r.out, /nothing\.test\.mjs: passes without the change - not evidence/, route);
      assert.doesNotMatch(r.log, /HOSTILE/, `${route}: ${r.log}`);
      assert.equal(readFileSync(path.join(repo.dir, WRAPPER_REL), 'utf8'), real(WRAPPER_REL));
      assert.ok(copyIntact(repo, r.root), `${route}: the judge copy is unchanged`);
    }
  });

// R25 (review of #255, round 4): a committed node_modules symlink made npm ci empty the copy
// it pointed at, and base-rule.sh then fell back to the checkout's program; now the judge
// writes regular files only (round 8: a symbolic link in the head commit is refused before
// anything runs), and refuses a copy missing a program its commit has.
test('R25: a committed node_modules is refused, and a judge copy lacking a program too', (t) => {
  const ff = judgeJobs().find((j) => j.name === 'fail-first');
  const { repo, head } = hostileFixture(t, ['wrapper']);
  const nm = path.join(repo.dir, 'node_modules');
  symlinkSync(os.tmpdir(), nm);
  repo.git('add', '-f', 'node_modules');
  repo.git('commit', '-q', '-m', 'a node_modules link');
  const r = runJobKeep(t, repo, repo.git('rev-parse', 'HEAD') || head, ff);
  assert.equal(r.status, 1, r.log);
  assert.match(r.out, /REFUSED to judge: the head commit [0-9a-f]{12}: node_modules is a symbolic/);
  assert.doesNotMatch(r.log, /HOSTILE/);
  assert.ok(copyIntact(repo, r.root));
  // base-rule.sh run from a judge copy that has a .base-commit and a manifest
  const fx = fixture(t);
  // the base carries the wrapper, as main does
  fx.git('checkout', '-q', 'main');
  fx.commit('the wrapper', { [WRAPPER_REL]: real(WRAPPER_REL) });
  fx.git('update-ref', BASE, 'main');
  fx.git('checkout', '-q', 'pr');
  fx.commit('docs', { 'README.md': 'fixture, documented\n' });
  const judge = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'oscilla-base-rule-judge-')));
  t.after(() => {
    spawnSync('chmod', ['-R', 'u+w', judge]);
    rmSync(judge, { recursive: true, force: true });
  });
  const sha = fx.git('rev-parse', 'main');
  const digest = extractJudge(fx.dir, sha, judge);
  /** The manifest without the lines `drop` matches, sealed: its digest. */
  const seal = (drop) => {
    const text = manifestOf(fx.dir, sha).text.split('\n').filter((l) => !drop.test(l))
      .join('\n');
    writeFileSync(path.join(judge, '.manifest'), text);
    return digestOf(text);
  };
  const viaCopy = (env, ...args) => {
    const x = spawnSync('bash', [path.join(judge, WRAPPER_REL), ...args],
      { cwd: fx.dir, encoding: 'utf8', env: { ...ENV, ...env } });
    return { status: x.status, out: `${x.stdout}${x.stderr}` };
  };
  const ok = viaCopy({ JUDGE_MANIFEST: digest }, BASE, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.out, judged('review-verdict'));
  // R28: a base that is not the commit the copy was taken from is refused
  fx.git('update-ref', 'refs/remotes/origin/other', 'HEAD');
  const other = viaCopy({ JUDGE_MANIFEST: digest }, 'refs/remotes/origin/other',
    'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(other.status, 2, other.out);
  assert.match(other.out, /is [0-9a-f]{40}, not the commit the judge was taken from/);
  // no digest, or a copy that departs from its manifest, is refused
  const none = viaCopy({}, BASE, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(none.status, 2, none.out);
  assert.match(none.out, /no JUDGE_MANIFEST/);
  rmSync(path.join(judge, 'scripts', 'review-verdict.mjs'));
  const lacking = viaCopy({ JUDGE_MANIFEST: digest }, BASE, 'scripts/review-verdict.mjs',
    ...VERDICT);
  assert.equal(lacking.status, 2, lacking.out);
  assert.match(lacking.out, /scripts\/review-verdict\.mjs is missing/);
  assert.match(lacking.out, /not the copy its step extracted/);
  // and resealed without it, the copy still may not fall back to the checkout's program
  const resealed = viaCopy({ JUDGE_MANIFEST: seal(/\tscripts\/review-verdict\.mjs$/) }, BASE,
    'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(resealed.status, 2, resealed.out);
  assert.match(resealed.out, /names scripts\/review-verdict\.mjs, which the judge copy lacks/);
  assert.doesNotMatch(resealed.out, /this checkout's copy judges/);
});

// review of #255, round 6, R37: tests/unit/fixtures/judge-copy.mjs is no guarded path, so what
// it does here is pinned by its git blob id (as the f001 fixtures are): a change to it is a
// change to this guarded test
test('R37: the judge-copy fixture is the reviewed blob', () => {
  const data = readFileSync(path.join(ROOT, 'tests', 'unit', 'fixtures', 'judge-copy.mjs'));
  const oid = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
  assert.equal(oid, '08b44ae6656fe04a5515574d9ffd650ba97198b6');
});

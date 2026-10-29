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
import { parseYaml } from '../../scripts/yaml-subset.mjs';
import { gitRepo } from './fixtures/git-repo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRAPPER = path.join(ROOT, '.github', 'scripts', 'base-rule.sh');
const PROGRAMS = ['scripts/review-verdict.mjs', 'scripts/fail-first.mjs',
  'scripts/git-ref.mjs', 'scripts/yaml-subset.mjs', 'scripts/pr-metadata.mjs',
  'scripts/release-analyze.mjs', 'scripts/release-metadata.mjs', 'scripts/shell-words.mjs',
  'scripts/install-guard.mjs'];
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

// R12 (review of #255, rounds 2 and 3): what runs before the judge in its job could take it
// over: a postinstall of the pull request's package.json, the `prepare` of a git dependency
// (which `npm ci --ignore-scripts` still runs, R17), or a helper program a PR .npmrc names
// (`git=./evil.sh`, R18) could rewrite base-rule.sh, put a node of its own on $GITHUB_PATH or a
// NODE_OPTIONS on $GITHUB_ENV. Here every job of ci.yml and metadata.yml that runs base-rule.sh
// is run as the runner runs it, its steps in order up to the judge's: each `run` through its
// step's shell (bash -eo pipefail unless `shell:` says otherwise), what a step writes to
// $GITHUB_ENV and $GITHUB_PATH applied to the steps after it, $GITHUB_OUTPUT read into
// `steps.<id>.outputs`, setup-node putting this node's directory on PATH and the checkout
// being the fixture; npm ci runs for real, offline, so a git dependency is a git+file: URL of
// a fixture repository (CI's would be github:, which the guard refuses the same way).
const WRAPPER_REL = '.github/scripts/base-rule.sh';
const HOSTILE_SH = String.raw`#!/bin/sh
# what a pull request's code can do to the job that judges it (review of #255, R12, R17, R18)
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
    judge)
      printf '#!/bin/sh\necho "HOSTILE judge copy"\nexit 0\n' \
        > "$RUNNER_TEMP/judge/.github/scripts/base-rule.sh" ;;
  esac
done
`;
const LOCK = (name, packages = {}) => `${JSON.stringify({ name, version: '1.0.0',
  lockfileVersion: 3, requires: true, packages: { '': { name, version: '1.0.0',
    ...(Object.keys(packages).length ? { dependencies: Object.fromEntries(Object.entries(packages)
      .map(([k, v]) => [k.replace(/^node_modules\//, ''), v.spec])) } : {}) },
  ...Object.fromEntries(Object.entries(packages).map(([k, v]) => [k, v.entry])) } },
null, 2)}\n`;
const PKG = (scripts, dependencies) => `${JSON.stringify({ name: 'fixture', version: '1.0.0',
  private: true, scripts, ...(dependencies ? { dependencies } : {}) }, null, 2)}\n`;

/** A git repository with one package whose `prepare` runs the PR's hostile.sh: its spec. */
function gitDependency(t, vectors) {
  const dep = gitRepo('oscilla-base-rule-gitdep-');
  t.after(() => dep.dispose());
  const prepare = `sh "$INIT_CWD/hostile.sh" ${vectors.join(' ')}`;
  const sha = dep.commit('dep', { 'package.json': `${JSON.stringify({ name: 'dep',
    version: '1.0.0', scripts: { prepare } })}\n` });
  return `git+file://${dep.dir}#${sha}`;
}

/**
 * main: the real programs and wrapper, a package; the PR carries hostile code reached by
 * `route`: `postinstall` (its package.json), `git-dependency` (a dependency's prepare, R17)
 * or `npmrc` (a .npmrc `git=` with a git dependency to make npm call it, R18).
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
  };
  if (route === 'postinstall') {
    files['package.json'] = PKG({ postinstall: `sh hostile.sh ${vectors.join(' ')}` });
  } else {
    const spec = gitDependency(t, route === 'npmrc' ? [] : vectors);
    files['package.json'] = PKG({}, { dep: spec });
    files['package-lock.json'] = LOCK('fixture', { 'node_modules/dep': { spec,
      entry: { version: '1.0.0', resolved: spec } } });
    if (route === 'npmrc') {
      files['.npmrc'] = 'git=./evil.sh\n';
      files['evil.sh'] = `#!/bin/sh\nsh ./hostile.sh ${vectors.join(' ')}\nexec git "$@"\n`;
    }
  }
  const head = repo.commit('feat: nothing to see', files);
  if (route === 'npmrc') chmodSync(path.join(repo.dir, 'evil.sh'), 0o755);
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
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
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
    npm_config_cache: path.join(tmp, 'npm-cache'), npm_config_userconfig: path.join(tmp, 'npmrc'),
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
    writeFileSync(script, expand(step.run));
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
/** The guard's step: the judge's node on the base's install-guard.mjs. */
const isGuard = (s) => (s.run || '').includes('"${{ steps.judge.outputs.node }}"'
  + ' "${{ runner.temp }}/judge/scripts/install-guard.mjs"');
const INSTALL = /^\s*npm ci\b/;

test('R12: a PR\'s postinstall can no longer change what judges it, in any judge job', (t) => {
  const jobs = judgeJobs();
  assert.deepEqual(jobs.map((j) => `${j.wf}:${j.name}`).sort(), [
    '.github/workflows/ci.yml:fail-first', '.github/workflows/ci.yml:review-verdict',
    '.github/workflows/metadata.yml:metadata']);
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
  // every judge job as it is: the postinstall does not run, the base's program judges
  for (const job of jobs) {
    const { repo, head } = hostileFixture(t, ['wrapper', 'path', 'env', 'judge']);
    const r = runJob(t, repo, head, job);
    assert.doesNotMatch(r.log, /HOSTILE/, `${job.name}: ${r.log}`);
    assert.match(r.out, judged(job.program.slice(8, -4)), `${job.name}: ${r.out}`);
    assert.equal(r.status, STATUS[job.program], `${job.name}: ${r.out}`);
    assert.equal(readFileSync(path.join(repo.dir, WRAPPER_REL), 'utf8'), real(WRAPPER_REL),
      `${job.name}: the wrapper is the committed one`);
  }
});

// R17, R18 (review of #255, round 3): `npm ci --ignore-scripts` still clones a git dependency
// and runs its prepare, and still spawns the program a PR .npmrc names for git. The base's
// install guard refuses both before npm runs; and were the guard gone, the judge would still
// be the base's for everything the PR writes to the checkout, $GITHUB_ENV or $GITHUB_PATH.
test('R17, R18: a git dependency\'s prepare and a .npmrc git= cannot change what judges', (t) => {
  const ff = judgeJobs().find((j) => j.name === 'fail-first');
  for (const route of ['git-dependency', 'npmrc']) {
    // the control: under --ignore-scripts npm still runs the PR's code
    const control = hostileFixture(t, ['wrapper'], route);
    const plain = runJob(t, control.repo, control.head, { ...ff, steps: [] },
      { before: ['npm ci --ignore-scripts'] });
    assert.equal(plain.status, 0, `${route}: ${plain.log}`);
    assert.match(readFileSync(path.join(control.repo.dir, WRAPPER_REL), 'utf8'), /HOSTILE/,
      `${route}: the attack is real under --ignore-scripts`);
    // the job as it is: the base's guard refuses before npm runs, and nothing hostile ran
    const { repo, head } = hostileFixture(t, ['wrapper', 'path', 'env', 'judge'], route);
    const r = runJob(t, repo, head, ff);
    assert.equal(r.status, 1, `${route}: ${r.log}`);
    assert.match(r.out, /install-guard: REFUSED/, route);
    assert.match(r.out, route === 'npmrc' ? /\.npmrc:1: git names a program npm runs/
      : /node_modules\/dep resolves to git\+file:/, route);
    assert.doesNotMatch(r.log, /HOSTILE|npm (warn|error)|added \d+ package/, route);
    assert.equal(readFileSync(path.join(repo.dir, WRAPPER_REL), 'utf8'), real(WRAPPER_REL));
    // the second line: without the guard the hostile code runs, and still the base's program
    // judges with its own status, for all it wrote to the checkout, $GITHUB_ENV and
    // $GITHUB_PATH (what it writes into the extracted copy itself only the guard keeps out)
    const second = hostileFixture(t, ['wrapper', 'path', 'env'], route);
    const unguarded = runJob(t, second.repo, second.head, ff,
      { drop: isGuard });
    assert.match(readFileSync(path.join(second.repo.dir, WRAPPER_REL), 'utf8'), /HOSTILE/,
      `${route}: the hostile code ran`);
    assert.doesNotMatch(unguarded.out, /HOSTILE/, `${route}: ${unguarded.out}`);
    assert.match(unguarded.out, judged('fail-first'), `${route}: ${unguarded.out}`);
    assert.equal(unguarded.status, STATUS['scripts/fail-first.mjs'], unguarded.out);
    // and the judge's shell is what keeps the BASH_ENV the PR wrote from running first
    const third = hostileFixture(t, ['env'], route);
    const plainShell = { ...ff, steps: ff.steps.map((s) => (CALL.test(s.run || '')
      ? { ...s, shell: undefined } : s)) };
    const bashEnv = runJob(t, third.repo, third.head, plainShell, { drop: isGuard });
    assert.match(bashEnv.out, /HOSTILE BASH_ENV/, `${route}: ${bashEnv.out}`);
    assert.equal(bashEnv.status, 0, `${route}: the control takes the judge over`);
  }
  // the install is the job's only step between the guard and the judge
  const names = ff.steps.map((s) => s.uses || s.id || (isGuard(s) ? 'guard'
    : INSTALL.test(s.run) ? 'install' : 'judge-step'));
  assert.deepEqual(names, ['actions/setup-node@v7', 'actions/checkout@v7', 'judge', 'guard',
    'install', 'judge-step']);
});

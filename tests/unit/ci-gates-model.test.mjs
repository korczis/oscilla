// The CI model .ai/repo/ci/gates.yaml, which Majordomus reads to plan and judge a task's
// validation gates (`majordomus check`, `finish`, `evidence --gate`, `gates.completion`),
// against the workflow it models, .github/workflows/ci.yml. The two must agree on:
//
//   the job set     one gate per CI job, and per matrix leg (`<job>-<browser>`) for a job with
//                   a browser matrix; every gate names its job; nothing more, nothing less
//   the commands    a gate's `runs` invokes the same npm scripts, repository programs,
//                   `majordomus doctor` and aggregate verdict as its job's steps, and a leg's
//                   gate sets OSC_BROWSERS to its own browser before every npm script
//   the selection   ci.yml runs every job on every pull request (no `paths` filter, no
//                   job-level condition but the aggregate's `always()`), so every gate is
//                   `always: true` and no path class names a gate or escalates
//   the aggregate   the `gate` job needs exactly the jobs whose gates the model's `gate`
//                   requires
//
// Each disagreement is applied to a copy of the real files below and must be reported, so the
// comparison cannot pass by comparing nothing.
//   node --test tests/unit/ci-gates-model.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../scripts/yaml-subset.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const MODEL_PATH = '.ai/repo/ci/gates.yaml';
const CI_PATH = '.github/workflows/ci.yml';
const PKG = JSON.parse(read('package.json'));

/** The installer is setup, not a check: it runs before every suite and proves nothing. */
const SETUP_PROGRAMS = new Set(['.github/scripts/ci-install.sh']);
/** The aggregate's verdict over `needs`, as ci.yml's `gate` job states it. */
const ALL_SUCCESS = 'all(.value.result == "success")';

/**
 * What a command text runs, as a sorted set of tokens: `npm test` and `npm run <script>`
 * (never `npm ci`), the repository programs it names (`scripts/...`, `.github/scripts/...`,
 * `.github/*.jq`) but the installer, `majordomus doctor`, and the aggregate verdict.
 */
export function commandTokens(text) {
  const out = new Set();
  for (const m of text.matchAll(/\bnpm\s+(test\b|run\s+([\w:.-]+))/g)) {
    out.add(m[2] ? `npm run ${m[2]}` : 'npm test');
  }
  const program = /(?:^|[\s"'(=;&|])((?:\.github\/scripts|scripts)\/[\w.-]+|\.github\/[\w.-]+\.jq)/g;
  for (const m of text.matchAll(program)) if (!SETUP_PROGRAMS.has(m[1])) out.add(m[1]);
  if (/\bmajordomus\s+doctor\b/.test(text)) out.add('majordomus doctor');
  if (text.includes(ALL_SUCCESS)) out.add('aggregate');
  return [...out].sort();
}

/** The browsers of a job's matrix, or null for a job without one. */
function legsOf(job) {
  const b = job?.strategy?.matrix?.browser;
  return Array.isArray(b) ? b : null;
}

/** Gate id -> { job, leg } as ci.yml implies it. */
export function expectedGates(ci) {
  const out = new Map();
  for (const [key, job] of Object.entries(ci.jobs ?? {})) {
    const legs = legsOf(job);
    if (legs) for (const leg of legs) out.set(`${key}-${leg}`, { job: key, leg });
    else out.set(key, { job: key, leg: null });
  }
  return out;
}

const runText = (job) => (job.steps ?? []).map((s) => s.run ?? '').join('\n');

/** Every disagreement between a ci.yml text and a gates.yaml text, one line each. */
export function compare(ciText, modelText) {
  const ci = parseYaml(ciText);
  const model = parseYaml(modelText);
  const found = [];
  if (model?.version !== 1) found.push(`model: version is ${model?.version}, not 1`);
  const gates = Array.isArray(model?.gates) ? model.gates : [];
  const classes = Array.isArray(model?.classes) ? model.classes : null;
  if (!gates.length) found.push('model: declares no gates');
  if (!classes) found.push('model: classes is not a list');
  const byId = new Map();
  for (const g of gates) {
    if (byId.has(g.id)) found.push(`model: gate ${g.id} is declared twice`);
    byId.set(g.id, g);
  }

  // the job set
  const want = expectedGates(ci);
  for (const [id, { job }] of want) {
    if (!byId.has(id)) found.push(`job set: ci.yml job ${job} has no gate ${id}`);
  }
  for (const id of byId.keys()) {
    if (!want.has(id)) found.push(`job set: gate ${id} is no job or matrix leg of ci.yml`);
  }

  // the selection: every job runs on every pull request
  const on = ci.on ?? {};
  const triggers = Object.keys(on);
  if (triggers.join() !== 'pull_request') {
    found.push(`selection: ci.yml starts on ${triggers.join(', ')}, not pull_request alone`);
  }
  for (const filter of ['paths', 'paths-ignore']) {
    if (on.pull_request && on.pull_request[filter] !== undefined) {
      found.push(`selection: ci.yml filters pull_request by ${filter}; the model selects every gate`);
    }
  }
  for (const [key, job] of Object.entries(ci.jobs ?? {})) {
    if (job.if !== undefined && !(key === 'gate' && job.if === 'always()')) {
      found.push(`selection: ci.yml job ${key} runs only if ${job.if}; the model selects it always`);
    }
  }
  for (const g of gates) {
    if (g.always !== true) found.push(`selection: gate ${g.id} is not always: true`);
    if (g['on-demand'] === true) found.push(`selection: gate ${g.id} is on-demand`);
    if (g['at-finish'] === true) found.push(`selection: gate ${g.id} is at-finish`);
  }
  for (const c of classes ?? []) {
    const sel = c.gates;
    if (sel === 'full' || (Array.isArray(sel) && sel.length)) {
      found.push(`selection: class ${c.id} selects ${JSON.stringify(sel)} by path`);
    }
  }

  // the commands, and each gate's job
  for (const [id, { job: key, leg }] of want) {
    const g = byId.get(id);
    if (!g) continue;
    const job = ci.jobs[key];
    if (g.job !== key) found.push(`commands: gate ${id} names job ${g.job}, not ${key}`);
    if (typeof g.summary !== 'string' || !g.summary.trim()) {
      found.push(`commands: gate ${id} has no summary`);
    }
    const runs = typeof g.runs === 'string' ? g.runs : '';
    const ciTokens = commandTokens(runText(job));
    const modelTokens = commandTokens(runs);
    if (ciTokens.join('|') !== modelTokens.join('|')) {
      found.push(`commands: gate ${id} runs [${modelTokens.join(', ')}], `
        + `job ${key} runs [${ciTokens.join(', ')}]`);
    }
    if (leg) {
      if (job.env?.OSC_BROWSERS !== '${{ matrix.browser }}') {
        found.push(`commands: job ${key} does not set OSC_BROWSERS from its matrix`);
      }
      const npm = [...runs.matchAll(/\bnpm\s+(?:test\b|run\s)/g)].length;
      const scoped = [...runs.matchAll(new RegExp(`OSC_BROWSERS=${leg}\\s+npm\\s+(?:test\\b|run\\s)`,
        'g'))].length;
      if (npm !== scoped) {
        found.push(`commands: gate ${id} runs an npm script without OSC_BROWSERS=${leg}`);
      }
      for (const m of runs.matchAll(/OSC_BROWSERS=(\S+)/g)) {
        if (m[1] !== leg) found.push(`commands: gate ${id} sets OSC_BROWSERS=${m[1]}`);
      }
    } else if (/OSC_BROWSERS=/.test(runs)) {
      found.push(`commands: gate ${id} narrows OSC_BROWSERS, and job ${key} has no browser matrix`);
    }
  }

  // the aggregate
  const agg = ci.jobs?.gate;
  const aggGate = byId.get('gate');
  if (agg && aggGate) {
    const needs = Array.isArray(agg.needs) ? agg.needs : [agg.needs];
    const wantReq = [...want].filter(([, v]) => needs.includes(v.job)).map(([id]) => id).sort();
    const req = [...(aggGate.requires ?? [])].sort();
    if (wantReq.join() !== req.join()) {
      found.push(`aggregate: gate requires [${req.join(', ')}], ci.yml gate needs `
        + `[${wantReq.join(', ')}]`);
    }
  }
  return found;
}

const CI = read(CI_PATH);
const MODEL = existsSync(path.join(ROOT, MODEL_PATH)) ? read(MODEL_PATH) : null;

/** Replace exactly one occurrence, so a mutation that no longer applies fails loudly. */
function mutate(text, from, to) {
  const parts = text.split(from);
  assert.equal(parts.length, 2, `the mutation target occurs once: ${from}`);
  return parts[0] + to + parts[1];
}
const has = (found, part) => found.some((f) => f.includes(part));

test('the repository declares a CI model at .ai/repo/ci/gates.yaml', () => {
  assert.ok(MODEL !== null, `${MODEL_PATH} exists`);
  assert.equal(parseYaml(MODEL).version, 1);
});

test('gates.yaml and ci.yml agree on the job set, the commands, the selection and the aggregate',
  () => {
    assert.deepEqual(compare(CI, MODEL), []);
  });

test('every npm script and repository program a gate runs exists', () => {
  for (const g of parseYaml(MODEL).gates) {
    for (const t of commandTokens(g.runs)) {
      if (t === 'npm test') assert.ok(PKG.scripts.test, 'package.json has a test script');
      else if (t.startsWith('npm run ')) {
        assert.ok(PKG.scripts[t.slice(8)], `${g.id}: package.json has ${t.slice(8)}`);
      } else if (t.includes('/')) assert.ok(existsSync(path.join(ROOT, t)), `${g.id}: ${t} exists`);
    }
  }
});

test('the token reader sees suites, programs and the verdict, and skips setup', () => {
  assert.deepEqual(commandTokens('npm ci\n.github/scripts/ci-install.sh browser webkit'), []);
  assert.deepEqual(commandTokens('mkdir -p logs && npm run test:engine 2>&1 | tee logs/e.log'),
    ['npm run test:engine']);
  assert.deepEqual(commandTokens('.github/scripts/base-rule.sh origin/main scripts/fail-first.mjs'),
    ['.github/scripts/base-rule.sh', 'scripts/fail-first.mjs']);
  assert.deepEqual(commandTokens('majordomus doctor --json > d.jsonl\njq -s -f .github/v.jq d.jsonl'),
    ['.github/v.jq', 'majordomus doctor']);
  assert.deepEqual(commandTokens(`jq -e 'to_entries | ${ALL_SUCCESS}'`), ['aggregate']);
});

test('a job ci.yml gains or loses is a disagreement', () => {
  const extra = mutate(CI, '  visual:\n', '  lint:\n    runs-on: ubuntu-latest\n    steps:\n'
    + '      - run: npm run build:check\n\n  visual:\n');
  assert.ok(has(compare(extra, MODEL), 'ci.yml job lint has no gate lint'));
  const fewer = mutate(CI, `    name: V1 engine checks (\${{ matrix.browser }})
    runs-on: ubuntu-latest
    timeout-minutes: 45
    strategy:
      fail-fast: false
      matrix:
        browser: [chromium, firefox, webkit]`, `    name: V1 engine checks (\${{ matrix.browser }})
    runs-on: ubuntu-latest
    timeout-minutes: 45
    strategy:
      fail-fast: false
      matrix:
        browser: [chromium, firefox]`);
  assert.ok(has(compare(fewer, MODEL), 'gate engine-webkit is no job or matrix leg'));
});

test('a gate the model gains or loses is a disagreement', () => {
  const doc = parseYaml(MODEL);
  const first = doc.gates[0].id;
  const without = MODEL.replace(new RegExp(`\\n  - id: ${first}\\n[\\s\\S]*?(?=\\n  - id: )`), '');
  assert.notEqual(without, MODEL);
  assert.ok(has(compare(CI, without), `has no gate ${first}`));
  const extra = mutate(MODEL, '\ngates:\n', '\ngates:\n  - id: lint\n    job: lint\n'
    + '    always: true\n    runs: npm run build:check\n    summary: x\n');
  assert.ok(has(compare(CI, extra), 'gate lint is no job or matrix leg'));
});

test('a command that differs on either side is a disagreement', () => {
  assert.ok(has(compare(mutate(CI, 'npm run test:dsp ', 'npm run test:dsp:fast '), MODEL),
    'gate suites-chromium runs'));
  assert.ok(has(compare(mutate(CI, 'run: npm run verify-dist\n', 'run: npm run build\n'), MODEL),
    'gate unit runs'));
  const unit = parseYaml(MODEL).gates.find((g) => g.id === 'unit').runs;
  assert.ok(has(compare(CI, mutate(MODEL, unit, unit.replace(' && npm run verify-dist', ''))),
    'gate unit runs'));
  const studio = parseYaml(MODEL).gates.find((g) => g.id === 'studio-webkit').runs;
  assert.ok(has(compare(CI, mutate(MODEL, studio, studio.replace('=webkit', '=chromium'))),
    'gate studio-webkit runs an npm script without OSC_BROWSERS=webkit'));
  assert.ok(has(compare(mutate(CI, 'scripts/review-verdict.mjs \\', 'scripts/other.mjs \\'), MODEL),
    'gate review-verdict runs'));
});

test('a path filter or a job condition in ci.yml is a disagreement, and so is a narrowed gate',
  () => {
    const filtered = mutate(CI, 'on:\n  pull_request:\n', 'on:\n  pull_request:\n'
      + '    paths: ["src/**"]\n');
    assert.ok(has(compare(filtered, MODEL), 'filters pull_request by paths'));
    const conditional = mutate(CI, '    name: Visual regression gate\n',
      '    name: Visual regression gate\n    if: github.event.pull_request.draft == false\n');
    assert.ok(has(compare(conditional, MODEL), 'job visual runs only if'));
    const narrowed = mutate(MODEL, '  - id: visual\n    job: visual\n    always: true\n',
      '  - id: visual\n    job: visual\n');
    assert.ok(has(compare(CI, narrowed), 'gate visual is not always: true'));
    const classed = MODEL.replace(/gates: \[\]/, 'gates: [visual]');
    assert.notEqual(classed, MODEL);
    assert.ok(has(compare(CI, classed), 'selects ["visual"] by path'));
  });

test('the aggregate gate requires exactly what ci.yml gate needs', () => {
  const needs = 'needs: [unit, knowledge, fail-first, review-verdict, engine, suites, measure, '
    + 'studio, browser, census, visual]';
  const fewer = mutate(CI, needs, needs.replace(', visual', ''));
  assert.ok(has(compare(fewer, MODEL), 'aggregate: gate requires'));
  const dropped = MODEL.replace(/\n {6}- visual(?=\n)/, '');
  assert.notEqual(dropped, MODEL);
  assert.ok(has(compare(CI, dropped), 'aggregate: gate requires'));
});

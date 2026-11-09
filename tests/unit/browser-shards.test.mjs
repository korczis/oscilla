// ci-speed (2026-11-09): ci.yml runs the release gate's browser suites in legs, per browser
// (jobs leg-1 and leg-2, matrix browser), as tests/browser/lib/shards.cjs deals them. Nothing loses a
// run in the split:
//   - the suites are derived from package.json (test:release and the scripts it runs, the
//     visual gate apart, which has its own job), never listed by hand, and a suite added to one
//     of those scripts is dealt on the next run;
//   - in every browser every unit (a suite, or one part of a split suite) is in exactly one leg,
//     and every leg runs something;
//   - the legs ci.yml declares are LEGS: browser b is in the matrix of leg-1..LEGS[b] and of no
//     other leg, each leg job sets OSC_LEG to its own number and OSC_BROWSERS from its matrix
//     and runs `npm run test:leg`, which runs shards.cjs;
//   - a split suite deals its checks over its parts exactly (dealt()) and accepts --part;
//   - the weights name only suites the gate runs, and the slowest leg stays within its budget;
//   - every release suite declares its pace (`// suite-pace: solo|shared (<reason>)`); a suite
//     that declares none runs solo; solo units never share a runner, shared ones run
//     OSC_SUITE_JOBS at a time (review c1 of 913a522d);
//   - lib/run-suites.cjs runs every unit, at most OSC_SUITE_JOBS at once, and a suite that
//     ignores SIGTERM at its deadline is killed after the grace (review c1, P3).
// Each rule is also applied to a mutated plan, workflow or package, and must say what broke.
//   node --test tests/unit/browser-shards.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../scripts/yaml-subset.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const shards = require(path.join(ROOT, 'tests', 'browser', 'lib', 'shards.cjs'));
const { runPool, startSuite } = require(path.join(ROOT, 'tests', 'browser', 'lib',
  'run-suites.cjs'));
const { BROWSERS, LEGS, PARTS, LEG_BUDGET_S, releaseSuites, units, plan, deal, dealt,
  parsePart, paceOf, soloOf } = shards;
const PKG = JSON.parse(read('package.json'));
const WEIGHTS = JSON.parse(read('tests/browser/shard-weights.json'));
const CI_TEXT = read('.github/workflows/ci.yml');
const CI = parseYaml(CI_TEXT);
const SHARDS = path.join(ROOT, 'tests', 'browser', 'lib', 'shards.cjs');

/** Every way a browser's legs fail to hold every unit exactly once, one line each. */
function coverageProblems(legs, us, browser) {
  const found = [];
  const seen = new Map();
  for (const l of legs) {
    if (!l.units.length) found.push(`${browser} leg ${l.leg} runs nothing`);
    for (const u of l.units) seen.set(u.label, [...(seen.get(u.label) || []), l.leg]);
  }
  for (const u of us) {
    const at = seen.get(u.label) || [];
    if (!at.length) found.push(`${browser}: ${u.label} is in no leg`);
    if (at.length > 1) found.push(`${browser}: ${u.label} is in legs ${at.join(', ')}`);
  }
  for (const label of seen.keys()) {
    if (!us.some((u) => u.label === label)) found.push(`${browser}: ${label} is no unit`);
  }
  return found;
}

/** Every way ci.yml's leg jobs disagree with LEGS, one line each. */
function workflowProblems(ci, legs = LEGS) {
  const found = [];
  const jobs = Object.entries(ci.jobs || {}).filter(([k]) => /^leg-\d+$/.test(k));
  const max = Math.max(...Object.values(legs));
  if (jobs.length !== max) found.push(`ci.yml has ${jobs.length} leg jobs, LEGS needs ${max}`);
  for (const [k, job] of jobs) {
    const n = Number(k.slice(4));
    const want = BROWSERS.filter((b) => legs[b] >= n);
    const got = job.strategy?.matrix?.browser;
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      found.push(`${k}: matrix browser ${JSON.stringify(got)}, LEGS needs ${JSON.stringify(want)}`);
    }
    if (String(job.env?.OSC_LEG) !== String(n)) found.push(`${k}: OSC_LEG is ${job.env?.OSC_LEG}`);
    if (job.env?.OSC_BROWSERS !== '${{ matrix.browser }}') {
      found.push(`${k}: OSC_BROWSERS is not its matrix browser`);
    }
    const runs = (job.steps || []).map((s) => s.run || '').join('\n');
    if (!/\bnpm run test:leg\b/.test(runs)) found.push(`${k}: does not run npm run test:leg`);
  }
  return found;
}

test('the suites are derived from package.json: test:release\'s scripts, visual apart', () => {
  const suites = releaseSuites(PKG);
  assert.ok(suites.length >= 30, `suites read: ${suites.length}`);
  assert.equal(new Set(suites).size, suites.length, 'each suite once');
  for (const s of suites) assert.ok(existsSync(path.join(ROOT, s)), `${s} exists`);
  for (const s of ['tests/browser/engine-v1port.cjs', 'tests/browser/dsp.cjs',
    'tests/browser/v3-ui.cjs', 'tests/browser/v31-studio-runtime.cjs',
    'tests/browser/integration-map.cjs', 'tests/browser/app.cjs', 'tests/browser/iphone.cjs',
    'tests/browser/control-census.cjs']) {
    assert.ok(suites.includes(s), `${s} is dealt`);
  }
  assert.ok(!suites.includes('tests/browser/lib/run-suites.cjs'), 'the runner is no suite');
  // every suite file a script of test:release names (visual apart) is dealt, and nothing else
  const named = new Set();
  for (const m of PKG.scripts['test:release'].matchAll(/npm run ([\w:.-]+)/g)) {
    if (m[1] === 'test:visual') continue;
    for (const f of PKG.scripts[m[1]].match(/tests\/browser\/[\w.-]+\.cjs/g) || []) {
      if (!f.endsWith('/lib/run-suites.cjs')) named.add(f);
    }
  }
  assert.deepEqual([...named].sort(), [...suites].sort());
  assert.equal(PKG.scripts['test:leg'], 'node tests/browser/lib/shards.cjs');
});

test('mutation: a suite added to a release script is dealt; a script that names none adds none',
  () => {
    const pkg = JSON.parse(JSON.stringify(PKG));
    pkg.scripts['test:browser'] += ' tests/browser/zz-new.cjs';
    assert.ok(releaseSuites(pkg).includes('tests/browser/zz-new.cjs'));
    for (const b of BROWSERS) {
      const legs = plan(b, { pkg, weights: WEIGHTS });
      assert.deepEqual(coverageProblems(legs, units(pkg), b), []);
      assert.equal(legs.flatMap((l) => l.units).filter((u) => /zz-new/.test(u.file)).length, 1);
    }
    pkg.scripts['test:release'] += ' && npm run test:nothing';
    assert.throws(() => releaseSuites(pkg), /runs test:nothing, no script/);
  });

test('every unit of every browser is in exactly one leg, and every leg runs something', () => {
  const us = units(PKG);
  for (const b of BROWSERS) {
    const legs = plan(b);
    assert.equal(legs.length, LEGS[b], `${b}: LEGS legs`);
    assert.deepEqual(coverageProblems(legs, us, b), []);
    // the plan is the same whatever the order its inputs come in (the weights decide, then
    // the package order): every runner computes the same legs
    assert.deepEqual(plan(b).map((l) => l.units.map((u) => u.label)),
      legs.map((l) => l.units.map((u) => u.label)));
  }
});

test('mutation: a dropped, a doubled and an invented unit are each named', () => {
  const us = units(PKG);
  const legs = plan('webkit');
  const drop = legs.map((l, i) => (i === 0 ? { ...l, units: l.units.slice(1) } : l));
  assert.match(coverageProblems(drop, us, 'webkit').join(), /is in no leg/);
  const twice = legs.map((l, i) => (i === 1 ? { ...l, units: [...l.units, legs[0].units[0]] } : l));
  assert.match(coverageProblems(twice, us, 'webkit').join(), /is in legs 1, 2/);
  const invent = legs.map((l, i) => (i === 0
    ? { ...l, units: [...l.units, { label: 'tests/browser/ghost.cjs' }] } : l));
  assert.match(coverageProblems(invent, us, 'webkit').join(), /ghost\.cjs is no unit/);
  const empty = deal([], 2, () => 1);
  assert.match(coverageProblems(empty, [], 'webkit').join(), /leg 1 runs nothing/);
});

test('ci.yml declares exactly the legs LEGS names, each running its own leg of its browser', () => {
  assert.deepEqual(workflowProblems(CI), []);
  for (const b of BROWSERS) assert.ok(LEGS[b] >= 1 && Number.isInteger(LEGS[b]), b);
  assert.deepEqual(CI.jobs.gate.needs.filter((j) => /^leg-/.test(j)), ['leg-1', 'leg-2']);
  // the old per-category browser jobs are gone: their suites run in the legs
  for (const k of ['engine', 'suites', 'measure', 'studio', 'browser', 'census']) {
    assert.equal(CI.jobs[k], undefined, `${k} runs in the legs`);
  }
});

test('mutation: a leg dropped from a matrix, a wrong OSC_LEG or another script is named', () => {
  const ci = JSON.parse(JSON.stringify(CI));
  ci.jobs['leg-2'].strategy.matrix.browser = ['chromium', 'firefox'];
  assert.match(workflowProblems(ci).join(), /leg-2: matrix browser \["chromium","firefox"\]/);
  const more = { ...LEGS, webkit: 3 };
  assert.match(workflowProblems(CI, more).join(), /ci\.yml has 2 leg jobs, LEGS needs 3/);
  const wrong = JSON.parse(JSON.stringify(CI));
  wrong.jobs['leg-2'].env.OSC_LEG = 1;
  assert.match(workflowProblems(wrong).join(), /leg-2: OSC_LEG is 1/);
  const other = JSON.parse(JSON.stringify(CI));
  for (const s of other.jobs['leg-1'].steps) {
    if (s.run) s.run = s.run.replace('npm run test:leg', 'npm run test:browser');
  }
  assert.match(workflowProblems(other).join(), /leg-1: does not run npm run test:leg/);
});

test('the weights name only dealt suites, every browser has them, the slowest leg fits', () => {
  const names = new Set(releaseSuites(PKG).map((f) => path.basename(f, '.cjs')));
  for (const b of BROWSERS) {
    const table = WEIGHTS.seconds[b];
    assert.ok(table && Object.keys(table).length >= 30, `${b} has weights`);
    for (const [k, v] of Object.entries(table)) {
      assert.ok(names.has(k), `${b}: weight for ${k}, which the release gate does not run`);
      assert.ok(Number.isFinite(v) && v >= 0, `${b}: ${k} ${v}`);
    }
    const slowest = Math.max(...plan(b).map((l) => l.s));
    assert.ok(slowest <= LEG_BUDGET_S, `${b}: slowest leg ${Math.round(slowest)} s one by one, `
      + `budget ${LEG_BUDGET_S} s`);
  }
  assert.ok(Array.isArray(WEIGHTS.runs) && WEIGHTS.runs.length >= 1, 'the runs measured are named');
  // a suite without a weight gets its browser's median, so a new suite is dealt before CI has
  // timed it
  const w = shards.weightOf({ file: 'tests/browser/zz-new.cjs' }, 'webkit', WEIGHTS.seconds);
  const all = Object.values(WEIGHTS.seconds.webkit).sort((a, b) => a - b);
  assert.equal(w, all[Math.floor(all.length / 2)]);
});

test('a split suite deals its checks over its parts exactly once, and accepts --part', () => {
  assert.ok(Object.keys(PARTS).length >= 1);
  for (const [file, n] of Object.entries(PARTS)) {
    assert.ok(releaseSuites(PKG).includes(file), `${file} is a release suite`);
    assert.match(read(file), /shards\.parsePart\(argv\)/, `${file} reads --part`);
    assert.match(read(file), /shards\.dealt\(/, `${file} deals by dealt()`);
    for (let i = 0; i < 500; i++) {
      const owners = [];
      for (let p = 1; p <= n; p++) if (dealt(i, { i: p, n })) owners.push(p);
      assert.deepEqual(owners.length, 1, `check ${i} of ${file} is in exactly one part`);
    }
  }
  assert.deepEqual(parsePart(['--part', '2/3']), { i: 2, n: 3 });
  assert.equal(parsePart(['--only', 'x']), null);
  for (const bad of ['0/2', '3/2', '2', 'a/b', '']) {
    assert.throws(() => parsePart(['--part', bad]), /--part takes/, bad);
  }
  const census = units(PKG).filter((u) => u.file === 'tests/browser/control-census.cjs');
  assert.deepEqual(census.map((u) => u.args.join(' ')),
    Array.from({ length: PARTS['tests/browser/control-census.cjs'] },
      (_, i) => `--part ${i + 1}/${PARTS['tests/browser/control-census.cjs']}`));
});

test('the census refuses a malformed part, and --part with --unrowed, before any browser', () => {
  for (const args of [['--part', '3/2'], ['--part', '1/2', '--unrowed']]) {
    const r = spawnSync(process.execPath, ['tests/browser/control-census.cjs', ...args],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, OSC_BROWSERS: 'chromium' },
        timeout: 60000 });
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--part|--unrowed/);
  }
});

test('runPool runs every unit, never more than `jobs` at once, results in the units\' order',
  async () => {
    let inFlight = 0;
    let peak = 0;
    const started = [];
    const codes = { a: 0, b: 1, c: 0, d: 0, e: 2 };
    const r = await runPool(['a', 'b', 'c', 'd', 'e'].map((file) => ({ file })), async (u) => {
      started.push(u.file);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => { setImmediate(resolve); });
      inFlight -= 1;
      return { status: codes[u.file] };
    }, { jobs: 2 });
    assert.equal(peak, 2, 'two at once');
    assert.deepEqual(started.sort(), ['a', 'b', 'c', 'd', 'e'], 'every unit ran once');
    assert.deepEqual(r.results.map((x) => x.file), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(r.results.map((x) => x.ok), [true, false, true, true, false]);
    assert.equal(r.code, 1);
    const thrown = await runPool([{ file: 'x' }], async () => { throw new Error('spawn'); });
    assert.equal(thrown.code, 1);
    assert.equal(thrown.results[0].why, 'spawn');
  });

test('shards.cjs as a process: a leg of fixture suites two at a time; bad selections exit 2', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'osc-shards-'));
  try {
    const run = (args, env) => spawnSync(process.execPath, [SHARDS, ...args],
      { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000, cwd: ROOT });
    const plan1 = run(['--plan'], { OSC_BROWSERS: 'webkit' });
    assert.equal(plan1.status, 0, plan1.stderr);
    assert.equal((plan1.stdout.match(/^webkit leg \d\/\d/gm) || []).length, LEGS.webkit);
    for (const [env, re] of [[{ OSC_BROWSERS: 'chromium,webkit' }, /exactly|one of/],
      [{ OSC_BROWSERS: 'chromium', OSC_LEG: '9' }, /OSC_LEG must be 1\.\.2/],
      [{ OSC_BROWSERS: 'chromium', OSC_LEG: '1', OSC_SUITE_JOBS: '0' }, /OSC_SUITE_JOBS/]]) {
      const r = run([], env);
      assert.equal(r.status, 2, `${JSON.stringify(env)}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, re);
    }
    // run-suites itself with OSC_SUITE_JOBS=2 over fixture suites: every one runs, each one's
    // output is printed as one block, and a failure fails the run
    const suite = (name, body) => {
      const file = path.join(dir, `${name}.cjs`);
      writeFileSync(file, `// suite-pace: shared (a fixture that judges no audio at all)\n`
        + `console.log('${name} line 1');\n${body}\nconsole.log('${name} line 2');\n`);
      return file;
    };
    const files = [suite('p1', ''), suite('f1', 'process.exitCode = 1;'), suite('p2', '')];
    const r = spawnSync(process.execPath, ['tests/browser/lib/run-suites.cjs', ...files],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, OSC_SUITE_JOBS: '2' }, timeout: 60000 });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /3 suites, the 3 shared 2 at a time, then the 0 solo one by one/);
    for (const n of ['p1', 'f1', 'p2']) {
      assert.match(r.stdout, new RegExp(`${n}\\.cjs \\(its output[^\\n]*\\n${n} line 1\\n${n} line 2\\n`
        + `run-suites: end of [^\\n]*${n}\\.cjs`), `${n} printed as one block`);
    }
    assert.match(r.stdout, /1 of 3 suites failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every release suite declares its pace with a reason; none declared runs solo', () => {
  const found = [];
  for (const file of releaseSuites(PKG)) {
    const text = read(file);
    const lines = text.split('\n').filter((l) => l.includes('suite-pace:'));
    const p = paceOf(text);
    if (lines.length !== 1 || !p) found.push(`${file}: ${lines.length} suite-pace line(s)`);
    else if (p.reason.trim().split(/\s+/).length < 5) found.push(`${file}: reason "${p.reason}"`);
  }
  assert.deepEqual(found, []);
  const us = units(PKG);
  assert.ok(us.some((u) => u.solo) && us.some((u) => !u.solo), 'both paces are dealt');
  for (const f of ['tests/browser/xy-pad.cjs', 'tests/browser/synth.cjs',
    'tests/browser/instrument-dsp.cjs', 'tests/browser/v31-studio-transport.cjs',
    'tests/browser/midi.cjs', 'tests/browser/control-census.cjs']) {
    assert.equal(soloOf(f), true, `${f} judges the realtime output: solo`);
  }
  // mutation: a suite whose declaration is gone (or never written) is solo, and so is a file
  // that does not exist
  assert.equal(paceOf('#!/usr/bin/env node\n// a suite\n'), null);
  assert.deepEqual(paceOf('x\n// suite-pace: shared (no audio is judged here at all)\n'),
    { pace: 'shared', reason: 'no audio is judged here at all' });
  assert.equal(soloOf('tests/browser/zz-none.cjs'), true);
  const allSolo = units(PKG, PARTS, () => true);
  assert.ok(allSolo.every((u) => u.solo));
  // the dealing weighs a shared unit less, never a solo one
  const legs = deal([{ label: 'a', solo: true }, { label: 'b', solo: false }], 1, () => 90, 1.5);
  assert.equal(legs[0].s, 180);
  assert.equal(legs[0].est, 150);
});

test('run-suites: solo units never share the runner, shared ones run two at a time', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'osc-pace-'));
  try {
    const log = path.join(dir, 'spans.log');
    const suite = (name) => {
      const file = path.join(dir, `${name}.cjs`);
      writeFileSync(file, `const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(log)}, '${name} start ' + Date.now() + '\\n');
const t = Date.now(); while (Date.now() - t < 300) {}
fs.appendFileSync(${JSON.stringify(log)}, '${name} end ' + Date.now() + '\\n');
`);
      return file;
    };
    const runner = path.join(ROOT, 'tests', 'browser', 'lib', 'run-suites.cjs');
    const entry = path.join(dir, 'entry.cjs');
    const us = [['s1', false], ['s2', false], ['s3', false], ['o1', true], ['o2', true]]
      .map(([n, solo]) => ({ file: suite(n), label: n, solo }));
    writeFileSync(entry, `require(${JSON.stringify(runner)}).runUnits(${JSON.stringify(us)})
  .then((c) => { process.exitCode = c; });\n`);
    const r = spawnSync(process.execPath, [entry], { encoding: 'utf8', timeout: 60000,
      env: { ...process.env, OSC_SUITE_JOBS: '2' } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /the 3 shared 2 at a time, then the 2 solo one by one/);
    const spans = {};
    for (const line of readFileSync(log, 'utf8').trim().split('\n')) {
      const [n, what, at] = line.split(' ');
      spans[n] = { ...spans[n], [what]: Number(at) };
    }
    const overlap = (a, b) => spans[a].start < spans[b].end && spans[b].start < spans[a].end;
    assert.ok(overlap('s1', 's2'), 'two shared suites ran at once');
    for (const o of ['o1', 'o2']) {
      for (const other of Object.keys(spans).filter((n) => n !== o)) {
        assert.ok(!overlap(o, other), `${o} ran alone (not beside ${other})`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a suite that ignores SIGTERM at its deadline is killed after the grace (c1 P3)',
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'osc-kill-'));
    try {
      const file = path.join(dir, 'stubborn.cjs');
      writeFileSync(file, "process.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n");
      const t0 = Date.now();
      const r = await startSuite({ file, label: 'stubborn' }, { ms: 500, graceMs: 500,
        hold: true, log: () => {} });
      assert.ok(Date.now() - t0 < 20000, 'it did not wait for the step bound');
      assert.equal(r.error && r.error.code, 'ETIMEDOUT');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

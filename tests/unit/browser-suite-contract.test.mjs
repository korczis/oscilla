// Rule project.suite-harness: every browser suite runs through tests/browser/lib/suite.cjs and
// never passes vacuously.
//
// Static half: each entry suite under tests/browser opens its run through the harness, takes
// playwright from it, tallies or reports its legs, and parses no selection of its own.
// Behavioural half: the harness refuses an empty or unknown selection with exit 2, fails a leg
// or a browser that ran 0 checks, fails an undeclared skip under CI, and holds a start on a
// loaded machine (bounded, and never under CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const suite = require('../browser/lib/suite.cjs');
const { mask } = require('../browser/lib/timing-scan.cjs');
const SUITE_LIB = path.join(ROOT, 'tests', 'browser', 'lib', 'suite.cjs');
const README = readFileSync(path.join(ROOT, 'tests', 'README.md'), 'utf8');

const ENTRIES = readdirSync(path.join(ROOT, 'tests', 'browser'))
  .filter((f) => f.endsWith('.cjs')).sort();
const read = (f) => readFileSync(path.join(ROOT, 'tests', 'browser', f), 'utf8');

// A suite that does not go through the harness yet, with the reason. The entry must be removed
// with the migration: a pending suite that conforms fails the test below.
const PENDING = {
  'v3-ui.cjs': 'owned by the findings and experiments changes in flight when the rule landed '
    + '(#149, #151); it still parses OSC_BROWSERS itself and requires playwright directly',
};

/** What keeps `source` (one entry suite, named `file`) out of the contract; [] when it is in. */
function contractProblems(file, source) {
  const { code } = mask(source);
  const name = file.replace(/\.cjs$/, '');
  const problems = [];
  const literal = (re) => [...code.matchAll(re)].map((m) => source.slice(m.index,
    m.index + m[0].length));
  if (!literal(/\brequire\s*\(\s*(['"])\s*\1\s*\)/g).some((r) => /\.\/lib\/suite\.cjs/.test(r))) {
    problems.push("does not require './lib/suite.cjs'");
  }
  const opened = literal(/\bsuite\s*\.\s*open\s*\(\s*\{\s*name\s*:\s*(['"])\s*\1/g);
  if (!opened.some((o) => new RegExp(`['"]${name}['"]$`).test(o))) {
    problems.push(`does not open its run with suite.open({ name: '${name}', ... })`);
  }
  if (!/\.\s*ready\s*\(/.test(code)) problems.push('never awaits the load gate (RUN.ready())');
  if (!/\.\s*(?:tally|reportLeg)\s*\(/.test(code)) {
    problems.push('never tallies a check or reports a leg (RUN.tally / RUN.reportLeg)');
  }
  if (/process\s*\.\s*env\s*\.\s*OSC_(?:BROWSERS|ORIGINS)\b/.test(code)) {
    problems.push('reads OSC_BROWSERS / OSC_ORIGINS itself instead of through the harness');
  }
  if (literal(/\brequire\s*\(\s*(['"])\s*\1\s*\)/g).some((r) => /['"]playwright/.test(r))) {
    problems.push("requires 'playwright' directly instead of RUN.playwright");
  }
  // An engine picked by a comparison with a default branch, or named outright, runs under
  // another browser's label when the selection is something else.
  if (/===\s*(['"])\s*\1\s*\?[^;:]*:\s*[\w.]*\b(?:chromium|firefox|webkit)\b/.test(code)
    || /\b(?:playwright|pw)\s*\.\s*(?:chromium|firefox|webkit)\b/.test(code)) {
    problems.push('names a browser engine outright (a default engine); index RUN.playwright '
      + 'by the selected name');
  }
  return problems;
}

// ------------------------------------------------------------------------------- static
test('every entry suite under tests/browser runs through the harness', () => {
  assert.ok(ENTRIES.length >= 20, `the entry suites are read (${ENTRIES.length})`);
  for (const file of ENTRIES) {
    const problems = contractProblems(file, read(file));
    if (PENDING[file]) {
      assert.ok(PENDING[file].length > 40, `${file}: the pending entry says why`);
      assert.notDeepEqual(problems, [],
        `${file} conforms now; remove it from PENDING in this test`);
    } else {
      assert.deepEqual(problems, [], `tests/browser/${file}:\n  ${problems.join('\n  ')}`);
    }
  }
  for (const file of Object.keys(PENDING)) {
    assert.ok(ENTRIES.includes(file), `${file} is pending but does not exist`);
  }
  assert.deepEqual(Object.keys(PENDING), ['v3-ui.cjs'], 'the pending list only shrinks');
});

test('every entry suite is run by a package script', () => {
  const scripts = Object.values(JSON.parse(readFileSync(path.join(ROOT, 'package.json'),
    'utf8')).scripts).join(' ');
  for (const file of ENTRIES) {
    assert.ok(scripts.includes(`tests/browser/${file}`), `${file} is not run by any npm script`);
  }
});

test('mutation: a suite that parses OSC_BROWSERS itself is out of the contract', () => {
  const dsp = read('dsp.cjs');
  assert.deepEqual(contractProblems('dsp.cjs', dsp), []);
  const reverted = dsp.replace('const targets = RUN.browsers.map(',
    "const names = (process.env.OSC_BROWSERS || '').split(',');\n  const targets = names.map(");
  assert.notEqual(reverted, dsp, 'the line to revert exists');
  assert.deepEqual(contractProblems('dsp.cjs', reverted),
    ['reads OSC_BROWSERS / OSC_ORIGINS itself instead of through the harness']);
});

test('mutation: a default engine, raw playwright or a missing tally is out of the contract', () => {
  const base = [
    "const suite = require('./lib/suite.cjs');",
    "const RUN = suite.open({ name: 'x' });",
    'const playwright = RUN.playwright;',
    '(async () => {',
    '  await RUN.ready();',
    '  for (const b of RUN.browsers) {',
    '    const browser = await playwright[b].launch(); RUN.tally(b);',
    '  }',
    '})();',
  ].join('\n');
  assert.deepEqual(contractProblems('x.cjs', base), []);
  const fallback = base.replace('playwright[b].launch()',
    "(b === 'firefox' ? playwright.firefox : playwright.chromium).launch()");
  assert.equal(contractProblems('x.cjs', fallback).length, 1);
  assert.match(contractProblems('x.cjs', fallback)[0], /names a browser engine outright/);
  assert.match(contractProblems('x.cjs', base.replace('RUN.playwright',
    "require('playwright')"))[0], /requires 'playwright' directly/);
  assert.match(contractProblems('x.cjs', base.replace(' RUN.tally(b);', ''))[0],
    /never tallies a check/);
  assert.match(contractProblems('x.cjs', base.replace('  await RUN.ready();\n', ''))[0],
    /never awaits the load gate/);
  assert.match(contractProblems('y.cjs', base)[0], /does not open its run with suite\.open/);
  // Words in comments and strings are not code.
  assert.deepEqual(contractProblems('x.cjs',
    `${base}\n// process.env.OSC_BROWSERS, require('playwright')\n`
    + "const s = 'playwright.chromium';"),
  []);
});

// ------------------------------------------------------------------------ the selection
test('parse refuses an empty, blank, repeated or unknown selection with exit code 2', () => {
  for (const raw of ['bogus', '', '   ', 'chromium,', 'chromium,,firefox', 'chromium,bogus',
    'chromium,chromium', 'Chromium', undefined, null]) {
    assert.throws(() => suite.parse(raw), (e) => e instanceof suite.UsageError
      && e.exitCode === 2, `parse(${JSON.stringify(raw)}) is refused`);
  }
  assert.deepEqual(suite.parse('chromium'), ['chromium']);
  assert.deepEqual(suite.parse('webkit, firefox'), ['webkit', 'firefox']);
  assert.throws(() => suite.parse('ftp', { known: suite.KNOWN_ORIGINS, what: 'origin' }),
    /unknown origin\(s\): ftp; expected file, http/);
});

test('select: the flag wins, a set-but-empty variable is empty, unset is the default', () => {
  const sel = (flag, env) => suite.select({ flag, env, envName: 'OSC_BROWSERS',
    known: suite.KNOWN_BROWSERS, what: 'browser' });
  assert.deepEqual(sel(undefined, {}), ['chromium', 'firefox', 'webkit']);
  assert.deepEqual(sel(undefined, { OSC_BROWSERS: 'webkit' }), ['webkit']);
  assert.deepEqual(sel('firefox', { OSC_BROWSERS: 'webkit' }), ['firefox']);
  assert.throws(() => sel(undefined, { OSC_BROWSERS: '' }), suite.UsageError);
  assert.throws(() => sel('bogus', {}), suite.UsageError);
});

// The parent's own OSC_BROWSERS must not leak into a probe that does not set one.
function withoutSelection(merged, given) {
  const out = { ...merged };
  if (!('OSC_BROWSERS' in given)) delete out.OSC_BROWSERS;
  delete out.OSC_ORIGINS;
  return out;
}
const child = (script, env = {}) => spawnSync(process.execPath, ['-e', script], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 60000,
  env: withoutSelection({ ...process.env, CI: '', GITHUB_ACTIONS: '', ...env }, env),
});
const OPEN = `const run = require(${JSON.stringify(SUITE_LIB)}).open({ name: 'probe' });`;

test('open exits 2 on a refused selection and names it', () => {
  for (const value of ['bogus', '', 'chromium,nope']) {
    const r = child(`${OPEN} console.log('ran');`, { OSC_BROWSERS: value });
    assert.equal(r.status, 2, `OSC_BROWSERS=${JSON.stringify(value)}: ${r.stderr}`);
    assert.match(r.stderr, /^\[probe\] (unknown browser\(s\)|empty browser list)/);
    assert.doesNotMatch(r.stdout, /ran/);
  }
  const origin = child(`require(${JSON.stringify(SUITE_LIB)}).open({ name: 'probe', `
    + "origins: 'ftp', defaultOrigins: ['file', 'http'] });");
  assert.equal(origin.status, 2);
  assert.match(origin.stderr, /unknown origin\(s\): ftp/);
});

test('every migrated suite exits 2 on an unknown and on an empty OSC_BROWSERS', () => {
  // Were a suite to get past its selection, the load gate (max below any load, 1 ms of
  // patience) ends it before it can launch a browser from a unit test.
  const guard = { CI: '', GITHUB_ACTIONS: '', OSC_LOAD_MAX: '0.000001', OSC_LOAD_WAIT_MS: '1' };
  for (const file of ENTRIES.filter((f) => !PENDING[f])) {
    for (const value of ['bogus', '']) {
      const r = spawnSync(process.execPath, [path.join('tests', 'browser', file)], {
        cwd: ROOT, encoding: 'utf8', timeout: 60000,
        env: { ...process.env, ...guard, OSC_BROWSERS: value },
      });
      assert.equal(r.status, 2,
        `${file} with OSC_BROWSERS=${JSON.stringify(value)} exited ${r.status}: ${r.stderr}`);
      assert.doesNotMatch(r.stdout, /ALL PASS|checks passed|\bPASS\b/, `${file} printed a pass`);
    }
  }
});

// ------------------------------------------------------------------------- 0 checks
const quiet = { log: () => {} };

test('reportLeg throws on a leg that ran 0 checks, and the run cannot pass afterwards', () => {
  const run = suite.createRun({ name: 's', browsers: ['chromium'], ...quiet });
  assert.throws(() => run.reportLeg({ leg: 'chromium/file', checks: 0 }),
    (e) => e instanceof suite.SuiteError && /leg chromium\/file ran 0 checks/.test(e.message));
  assert.throws(() => run.reportLeg({ leg: 'chromium/file' }), suite.SuiteError);
  assert.throws(() => run.reportLeg({ leg: 'chromium/file', checks: -1 }), suite.SuiteError);
  run.reportLeg({ leg: 'chromium/http', checks: 4 });
  assert.equal(run.verdict(0).code, 1, 'a later leg does not redeem the empty one');
});

test('the verdict fails a selected browser that ran 0 checks', () => {
  const run = suite.createRun({ name: 's', browsers: ['chromium', 'webkit'], ...quiet });
  run.tally('chromium 141.0');
  run.tally('chromium/file', 2);
  assert.deepEqual(run.counts(), { chromium: 3, webkit: 0 });
  const verdict = run.verdict(0);
  assert.equal(verdict.code, 1);
  assert.match(verdict.problems[0], /\[s\] webkit ran 0 checks/);
  run.reportLeg({ leg: 'webkit/http', checks: 1 });
  assert.deepEqual(run.verdict(0), { code: 0, problems: [] });
  assert.equal(run.verdict(1).code, 1, 'a failing exit code is kept');
});

test('a check that belongs to no selected browser is refused', () => {
  const run = suite.createRun({ name: 's', browsers: ['chromium'], ...quiet });
  assert.throws(() => run.tally('firefox'), /names none of the selected browsers/);
  assert.throws(() => run.tally('chromiumx'), /names none of the selected browsers/);
  assert.throws(() => run.tally(''), /names none of the selected browsers/);
});

test('a suite process that ran 0 checks exits 1 whatever it asked to exit with', () => {
  const none = child(`${OPEN} process.exit(0);`, { OSC_BROWSERS: 'webkit' });
  assert.equal(none.status, 1, none.stderr);
  assert.match(none.stderr, /FAIL \[probe\] webkit ran 0 checks/);
  const one = child(`${OPEN} run.tally('webkit'); console.log('ALL PASS'); process.exit(0);`,
    { OSC_BROWSERS: 'webkit' });
  assert.equal(one.status, 0, one.stderr);
  const half = child(`${OPEN} run.tally('chromium');`, { OSC_BROWSERS: 'chromium,firefox' });
  assert.equal(half.status, 1);
  assert.match(half.stderr, /FAIL \[probe\] firefox ran 0 checks/);
  for (const r of [none, one, half]) assert.match(r.stdout, /\[probe\] load [\d.]+ at end/);
});

// ------------------------------------------------------------------------------- skips
const SKIPS_README = [
  '# Tests', '', '## Declared skips', '',
  '| Skip | Reason |', '| --- | --- |',
  '| `s:listed` | the browser has no such device |',
  '| `s:no-reason` |  |',
  '', '## Next section', '', '| `s:outside` | not in the table |', '',
].join('\n');

function withReadme(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'osc-suite-'));
  const readme = path.join(dir, 'README.md');
  writeFileSync(readme, SKIPS_README);
  try { return fn(readme); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('declaredSkips reads the table of its section only, and only rows with a reason', () => {
  assert.deepEqual([...suite.declaredSkips(SKIPS_README)],
    [['s:listed', 'the browser has no such device']]);
  assert.deepEqual([...suite.declaredSkips('# Tests\n\nno section\n')], []);
});

test('under CI a skip that the README does not list fails; a listed one is recorded', () => {
  withReadme((readme) => {
    for (const env of [{ GITHUB_ACTIONS: 'true' }, { CI: '1' }, { CI: 'true' }]) {
      const run = suite.createRun({ name: 's', browsers: ['webkit'], env, readme, ...quiet });
      run.skip('webkit', 'listed', 'no fake capture device');
      assert.deepEqual(run.skips(), [{ leg: 'webkit', id: 'listed',
        reason: 'no fake capture device' }]);
      for (const id of ['unlisted', 'no-reason', 'outside']) {
        assert.throws(() => run.skip('webkit', id, 'because'),
          (e) => e instanceof suite.SuiteError
            && e.message.includes(`skip \`s:${id}\``) && /tests\/README\.md/.test(e.message));
      }
      run.tally('webkit');
      assert.equal(run.verdict(0).code, 1, 'an undeclared skip fails the run even if caught');
    }
  });
});

test('outside CI a skip is printed and allowed, and it never counts as a check', () => {
  withReadme((readme) => {
    const lines = [];
    const run = suite.createRun({ name: 's', browsers: ['webkit'], env: {}, readme,
      log: (l) => lines.push(l) });
    run.skip('webkit', 'unlisted', 'axe-core is not installed');
    assert.deepEqual(lines, ['SKIP [webkit] s:unlisted: axe-core is not installed']);
    assert.equal(run.verdict(0).code, 1, 'only skips: the browser ran 0 checks');
    assert.throws(() => run.skip('webkit', 'x', ' '), TypeError);
    assert.throws(() => run.skip('webkit', '', 'reason'), TypeError);
  });
  assert.equal(suite.isCi({}), false);
  assert.equal(suite.isCi({ CI: '' }), false);
  assert.equal(suite.isCi({ CI: 'false', GITHUB_ACTIONS: '0' }), false);
  assert.equal(suite.isCi({ GITHUB_ACTIONS: 'true' }), true);
});

test('every skip a suite can take is declared in tests/README.md, and nothing else is', () => {
  const declared = suite.declaredSkips(README);
  const used = new Set();
  for (const file of ENTRIES) {
    const source = read(file);
    const name = file.replace(/\.cjs$/, '');
    const { code } = mask(source);
    for (const m of code.matchAll(/\.\s*skip\s*\(\s*[^,]+,\s*((['"])\s*\2|[\w.]+)/g)) {
      const start = m.index + m[0].length - m[1].length;
      const id = source.slice(start, start + m[1].length);
      // A literal id is checked as written; a computed one (a check's own name) by its suite.
      used.add(/^['"]/.test(id) ? `${name}:${id.slice(1, -1)}` : `${name}:*`);
    }
  }
  assert.ok(used.size >= 3, `the suites' skips are read (${[...used].join(', ')})`);
  const computed = [...used].filter((u) => u.endsWith(':*')).map((u) => u.slice(0, -1));
  for (const key of used) {
    if (key.endsWith(':*')) {
      assert.ok([...declared.keys()].some((d) => d.startsWith(key.slice(0, -1))),
        `${key}: no skip of that suite is declared in tests/README.md`);
    } else {
      assert.ok(declared.has(key), `skip \`${key}\` is not declared in tests/README.md`);
    }
  }
  for (const [key, reason] of declared) {
    assert.ok(reason.length >= 20, `declared skip \`${key}\` gives a reason`);
    assert.ok(used.has(key) || computed.some((prefix) => key.startsWith(prefix)),
      `declared skip \`${key}\` is taken by no suite; remove the row`);
  }
});

// ---------------------------------------------------------------------------- load gate
function fakeClock() {
  const clock = { t: 0, sleeps: [] };
  clock.now = () => clock.t;
  clock.sleep = async (ms) => { clock.sleeps.push(ms); clock.t += ms; };
  return clock;
}

test('the load gate is a no-op under CI, whatever the load', async () => {
  for (const env of [{ CI: '1' }, { GITHUB_ACTIONS: 'true' }]) {
    const clock = fakeClock();
    const lines = [];
    const r = await suite.loadGate({ env: { ...env, OSC_LOAD_MAX: '36' },
      loadavg: () => [100, 0, 0], cores: 18, now: clock.now, sleep: clock.sleep,
      log: (l) => lines.push(l), label: 's' });
    assert.deepEqual(clock.sleeps, [], 'it returns at once');
    assert.equal(r.ci, true);
    assert.deepEqual(lines, ['[s] load 100.00 at start (CI: no load gate)']);
  }
});

test('outside CI the gate passes at once below the maximum and prints the load', async () => {
  const clock = fakeClock();
  const lines = [];
  const r = await suite.loadGate({ env: {}, loadavg: () => [4.2, 0, 0], cores: 18,
    now: clock.now, sleep: clock.sleep, log: (l) => lines.push(l), label: 's' });
  assert.deepEqual(clock.sleeps, []);
  assert.equal(r.max, 36, 'the default maximum is 2 x cores');
  assert.deepEqual(lines, ['[s] load 4.20 at start (max 36, 18 cores)']);
});

test('the gate waits while the load is high and starts once it falls', async () => {
  const clock = fakeClock();
  const loads = [100, 80, 40, 12];
  const lines = [];
  const r = await suite.loadGate({ env: { OSC_LOAD_MAX: '36' }, loadavg: () => [loads.shift()],
    cores: 4, now: clock.now, sleep: clock.sleep, log: (l) => lines.push(l), label: 's' });
  assert.deepEqual(clock.sleeps, [5000, 5000, 5000]);
  assert.equal(r.waitedMs, 15000);
  assert.equal(r.load, 12);
  assert.match(lines[0], /load 100\.00 is not below OSC_LOAD_MAX 36; waiting up to 600 s/);
  assert.match(lines[1], /load 12\.00 at start \(max 36, 4 cores, waited 15 s\)/);
});

test('the gate is bounded: a load that stays high ends in a named failure', async () => {
  const clock = fakeClock();
  await assert.rejects(
    suite.loadGate({ env: { OSC_LOAD_MAX: '36', OSC_LOAD_WAIT_MS: '1000' },
      loadavg: () => [100, 0, 0], cores: 18, now: clock.now, sleep: clock.sleep, log: () => {},
      label: 's' }),
    (e) => e instanceof suite.SuiteError
      && /\[s\] load gate: the 1-minute load average 100\.00 stayed at or above OSC_LOAD_MAX 36 /
        .test(e.message) && /for 1 s; nothing ran/.test(e.message));
  assert.deepEqual(clock.sleeps, [1000], 'it sleeps no longer than its bound');
  assert.equal(clock.t, 1000);
});

test('the gate of a real process: bounded on a loaded machine, immediate under CI', () => {
  const script = `const run = require(${JSON.stringify(SUITE_LIB)}).open({ name: 'probe' });`
    + "run.ready().then(() => { run.tally('chromium'); console.log('started'); },"
    + '(e) => { console.error(e.message); process.exit(3); });';
  const env = { OSC_BROWSERS: 'chromium', OSC_LOAD_MAX: '0.000001', OSC_LOAD_WAIT_MS: '1000' };
  const t0 = Date.now();
  const held = child(script, env);
  assert.equal(held.status, 3, held.stderr);
  assert.match(held.stderr, /load gate: the 1-minute load average [\d.]+ stayed at or above/);
  assert.doesNotMatch(held.stdout, /started/);
  assert.ok(Date.now() - t0 < 30000, 'the bound is honoured');
  const ci = child(script, { ...env, CI: '1' });
  assert.equal(ci.status, 0, ci.stderr);
  assert.match(ci.stdout, /\(CI: no load gate\)\nstarted/);
});

// ------------------------------------------------------------------- engines and evaluate
function fakePlaywright() {
  const page = () => ({
    evaluate: (fn) => (fn === 'hang' ? new Promise(() => {}) : Promise.resolve(`ran ${fn}`)),
    context() { return this.ctx; },
  });
  const context = () => {
    const ctx = { listeners: [], pages: () => [], on(ev, fn) { ctx.listeners.push([ev, fn]); } };
    ctx.newPage = async () => Object.assign(page(), { ctx });
    return ctx;
  };
  const browser = () => {
    const b = { contexts: () => [], newContext: async () => context() };
    b.newPage = async () => (await context().newPage());
    return b;
  };
  const type = (name) => ({ name: () => name, launch: async () => browser(),
    connect: async () => browser(), launchServer: async () => ({ wsEndpoint: () => 'ws://x' }) });
  return { chromium: type('chromium'), firefox: type('firefox'), webkit: type('webkit'),
    devices: {} };
}

test('an engine is reachable by a known name only; nothing maps to a default', () => {
  const pw = suite.boundPlaywright(fakePlaywright(), { ms: 50 });
  assert.equal(pw.webkit.name(), 'webkit');
  assert.deepEqual(pw.devices, {});
  for (const name of ['bogus', '', 'Chromium', 'safari']) {
    assert.throws(() => pw[name], (e) => e instanceof suite.UsageError
      && /unknown browser engine/.test(e.message), `playwright[${JSON.stringify(name)}]`);
  }
});

test('page.evaluate of every harness page is bounded and names its function', async () => {
  const pw = suite.boundPlaywright(fakePlaywright(), { ms: 40 });
  for (const open of [
    async (b) => b.newPage(),
    async (b) => (await b.newContext()).newPage(),
  ]) {
    for (const how of ['launch', 'connect']) {
      const page = await open(await pw.chromium[how]());
      assert.equal(await page.evaluate('quick'), 'ran quick');
      const t0 = Date.now();
      await assert.rejects(page.evaluate('hang'),
        /^WaitTimeout: page\.evaluate\(hang\): no answer within 40 ms of wall time$/);
      assert.ok(Date.now() - t0 < 2000);
    }
  }
  // A popup the page opens arrives through the context's page event.
  const ctx = await (await pw.firefox.launch()).newContext();
  const popup = { evaluate: () => new Promise(() => {}) };
  ctx.listeners.find(([ev]) => ev === 'page')[1](popup);
  await assert.rejects(popup.evaluate(() => window.x), /page\.evaluate\(\(\) => window\.x\)/);
  assert.ok(suite.DEFAULT_EVALUATE_MS >= 60000, 'the default bound ends a stall, not a slow page');
});

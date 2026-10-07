// Rule project.bounded-test-timing: a browser check waits for the condition it judges, against
// a wall-clock deadline that names it, and never measures the host.
//
// Three halves: the static scan (tests/browser/lib/timing-scan.cjs) finds each kind of wait or
// window the rule forbids and honours only a reasoned `timing-allow` marker; tests/browser as
// it stands holds no finding beyond the debt recorded in tests/browser/timing-baseline.json;
// and the shared waits (tests/browser/lib/wait.cjs) end on a named wall-clock deadline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scanner = require('../browser/lib/timing-scan.cjs');
const wait = require('../browser/lib/wait.cjs');

const kinds = (source, options) => scanner.scan(source, { file: 'x.cjs', ...options })
  .map((f) => `${f.line}:${f.kind}`);

// ------------------------------------------------------------------------------ the scan
test('a fixed sleep is found with its file and line', () => {
  const found = scanner.scan('async function f(page) {\n  await page.waitForTimeout(100);\n}\n',
    { file: 'tests/browser/dsp.cjs' });
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].file, found[0].line, found[0].kind],
    ['tests/browser/dsp.cjs', 2, 'fixed-sleep']);
  assert.match(scanner.format(found[0]), /^tests\/browser\/dsp\.cjs:2: \[fixed-sleep\] /);
});

test('a setTimeout sleep is found: awaited directly, or through a helper of any name', () => {
  assert.deepEqual(kinds('await new Promise((r) => setTimeout(r, 150));\n'), ['1:timer-sleep']);
  assert.deepEqual(kinds('await new Promise((resolve) => { setTimeout(resolve, 150); });\n'),
    ['1:timer-sleep']);
  assert.deepEqual(kinds([
    'const nap = (ms) => new Promise((r) => setTimeout(r, ms));',
    'async function f() {',
    '  await nap(200);',
    '}',
  ].join('\n')), ['3:timer-sleep']);
  assert.deepEqual(kinds('async function f() {\n  await sleep(200);\n  await H.sleep(5);\n}\n'),
    ['2:timer-sleep', '3:timer-sleep']);
  // A race deadline is not a sleep, and neither is the helper's own definition.
  assert.deepEqual(kinds('const sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n'
    + 'const v = await Promise.race([work(), sleep(5000).then(() => null)]);\n'), []);
});

test('a setTimeout sleep is found wherever it runs and however it is spelled', () => {
  for (const line of [
    // in the page: the suite awaits the evaluate, the page sleeps
    'await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));',
    'await new Promise((r) => setTimeout(() => r(), 100));',
    'await new Promise((resolve) => { setTimeout(() => { resolve(); }, 100); });',
    'await new Promise(function (done) { setTimeout(done, 100); });',
    'await new Promise((r) => window.setTimeout(r, 100));',
    // setTimeout of timers/promises is the sleep itself
    "await require('timers/promises').setTimeout(100);",
    "await require('node:timers/promises').setTimeout(100);",
  ]) {
    assert.deepEqual(kinds(`${line}\n`), ['1:timer-sleep'], line);
  }
  // not awaited where it is made
  assert.deepEqual(kinds([
    'async function f() {',
    '  const p = new Promise((r) => setTimeout(r, 300));',
    '  await work();',
    '  await p;',
    '}',
  ].join('\n')), ['2:timer-sleep']);
  for (const head of [
    "const { setTimeout: nap } = require('node:timers/promises');",
    "import { setTimeout as nap } from 'node:timers/promises';",
    "const nap = require('timers/promises').setTimeout;",
  ]) {
    assert.deepEqual(kinds(`${head}\nasync function f() {\n  await nap(100);\n}\n`),
      ['3:timer-sleep'], head);
  }
  assert.deepEqual(kinds("const timers = require('timers/promises');\n"
    + 'async function f() {\n  await timers.setTimeout(100);\n}\n'), ['3:timer-sleep']);
  assert.deepEqual(kinds("const { setTimeout } = require('timers/promises');\n"
    + 'async function f() {\n  await setTimeout(100);\n}\n'), ['3:timer-sleep']);
  // A timer that is one arm of a wait is a deadline, not a sleep.
  assert.deepEqual(kinds([
    'const v = await Promise.race([work(), new Promise((r) => setTimeout(r, 5000))]);',
    'const late = new Promise((resolve, reject) => {',
    "  const timer = setTimeout(() => reject(new Error('late')), ms);",
    '  p.then((value) => { clearTimeout(timer); resolve(value); });',
    '});',
    "await new Promise((resolve) => { el.addEventListener('x', resolve); "
      + 'setTimeout(resolve, 500); });',
    'await new Promise((resolve) => requestAnimationFrame(resolve));',
  ].join('\n')), []);
});

test('a sleep helper is followed to its calls, through any wrapper and across files', () => {
  // more than one statement
  assert.deepEqual(kinds([
    'function settle(ms) {',
    '  const p = new Promise((r) => setTimeout(r, ms));',
    '  return p;',
    '}',
    'async function f() {',
    '  await settle(100);',
    '}',
  ].join('\n')), ['6:timer-sleep']);
  // the sleep runs in the page; awaited or not, each call is one
  assert.deepEqual(kinds([
    'const settle = (page, ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);',
    'async function f(page) {',
    '  await settle(page, 100);',
    '  settle(page, 5).then(next);',
    '}',
  ].join('\n')), ['3:timer-sleep', '4:timer-sleep']);
  // a helper around a helper
  assert.deepEqual(kinds([
    'const nap = (ms) => new Promise((r) => setTimeout(r, ms));',
    'const rest = () => nap(100);',
    'async function f(page) {',
    '  await page.click("#a");',
    '  await rest();',
    '}',
  ].join('\n')), ['5:timer-sleep']);
  // A helper nobody calls here is reported where it is defined, so it cannot hide a sleep.
  const lib = 'const nap = (ms) => new Promise((r) => setTimeout(r, ms));\n'
    + 'module.exports = { nap };\n';
  assert.deepEqual(kinds(lib), ['1:timer-sleep']);
  assert.deepEqual(scanner.helperNames(lib), ['nap']);
  // A function that does something besides sleeping keeps its sleep where it is written.
  assert.deepEqual(kinds([
    'async function openTab(page) {',
    '  await page.click("#tab");',
    '  await new Promise((r) => setTimeout(r, 100));',
    '}',
    'async function f(page) {',
    '  await openTab(page);',
    '}',
  ].join('\n')), ['3:timer-sleep']);
  // A helper another file defines is a sleep here, unless this file gives the name a meaning.
  const user = 'async function f(H) {\n  await breathe(100);\n  H.breathe(5).then(go);\n}\n';
  assert.deepEqual(kinds(user), []);
  assert.deepEqual(kinds(user, { helpers: ['breathe'] }), ['2:timer-sleep', '3:timer-sleep']);
  assert.deepEqual(kinds(`const breathe = (n) => n * 2;\n${user}`, { helpers: ['breathe'] }), []);
});

test('the tree is scanned in two passes, so a helper of one file is a sleep in another', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'osc-timing-'));
  try {
    mkdirSync(path.join(root, 'tests', 'browser', 'lib'), { recursive: true });
    writeFileSync(path.join(root, 'tests', 'browser', 'lib', 'naps.cjs'),
      'const nap = (ms) => new Promise((r) => setTimeout(r, ms));\nmodule.exports = { nap };\n');
    writeFileSync(path.join(root, 'tests', 'browser', 'a.cjs'),
      "const { nap } = require('./lib/naps.cjs');\n(async () => {\n  await nap(300);\n})();\n");
    assert.deepEqual(scanner.scanTree(root).map((f) => `${f.file}:${f.line}:${f.kind}`), [
      'tests/browser/a.cjs:3:timer-sleep',
      'tests/browser/lib/naps.cjs:1:timer-sleep',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a poll counted in sleeps is found; one bounded by wall time is not', () => {
  assert.deepEqual(kinds([
    'for (let i = 0; i < 40; i++) {',
    '  await page.waitForTimeout(150);',
    '  if (await ready()) break;',
    '}',
  ].join('\n')), ['2:fixed-sleep']);
  assert.deepEqual(kinds([
    'for (let i = 0; i < 40; i++) {',
    '  await sleep(150);',
    '  if (await ready()) break;',
    '}',
  ].join('\n')), ['2:counted-poll']);
  assert.deepEqual(kinds([
    'const deadline = Date.now() + 5000;',
    'while (Date.now() < deadline) {',
    '  if (await ready()) break;',
    '  await sleep(50);',
    '}',
  ].join('\n')), []);
  assert.deepEqual(kinds([
    'const t0 = performance.now();',
    'do {',
    '  await sleep(20);',
    '} while (!done() && performance.now() - t0 < 3000);',
  ].join('\n')), []);
});

test('a loop over a collection or a count is never a poll, whatever its body measures', () => {
  // A runner loop that times each browser: the sleeps in it are fixed sleeps.
  assert.deepEqual(kinds([
    'for (const b of RUN.browsers) {',
    '  const t0 = Date.now();',
    '  await page.waitForTimeout(500);',
    '  await sleep(300);',
    '  console.log(Date.now() - t0);',
    '}',
  ].join('\n')), ['3:fixed-sleep', '4:timer-sleep']);
  // A bounded poll nested in the loop bounds its own period, not its neighbours'.
  assert.deepEqual(kinds([
    'for (const sr of [22050, 32000]) {',
    '  const start = Date.now();',
    "  while (e.state !== 'running' && Date.now() - start < 5000) await sleep(20);",
    '  await sleep(5);',
    '}',
  ].join('\n')), ['4:timer-sleep']);
  assert.deepEqual(kinds([
    'for (let i = 0; i < 40; i++) {',
    '  const t = Date.now();',
    '  await sleep(50);',
    '  log(t);',
    '}',
  ].join('\n')), ['3:counted-poll']);
  // A while loop is bounded by its own condition or exit guard, not by a clock it only reads.
  assert.deepEqual(kinds([
    'while (!done) {',
    '  const t = Date.now();',
    '  await sleep(5);',
    '  log(t);',
    '}',
  ].join('\n')), ['1:unbounded-loop', '3:counted-poll']);
  assert.deepEqual(kinds([
    'while (!done) {',
    '  const late = () => { if (Date.now() > deadline) return true; };',
    '  await sleep(5);',
    '}',
  ].join('\n')), ['1:unbounded-loop', '3:counted-poll']);
  // Bounded: a guard directly in the body that leaves on a clock reading.
  assert.deepEqual(kinds([
    'for (;;) {',
    '  if (await ready()) break;',
    "  if (Date.now() > deadline) throw new Error('late');",
    '  await sleep(50);',
    '}',
    'for (;;) {',
    '  const left = deadline - Date.now();',
    '  if (left <= 0) break;',
    '  await sleep(50);',
    '}',
    'for (let i = 0; Date.now() < deadline; i++) {',
    '  await sleep(50);',
    '}',
  ].join('\n')), []);
});

test('a waiting loop without a wall-clock deadline is found', () => {
  assert.deepEqual(kinds('while (ctx.currentTime < t) await tick();\n'), ['1:unbounded-loop']);
  assert.deepEqual(kinds('while (!(await page.evaluate(() => window.ready))) {\n}\n'),
    ['1:unbounded-loop']);
  assert.deepEqual(kinds('for (;;) {\n  if (await done()) break;\n}\n'), ['1:unbounded-loop']);
  assert.deepEqual(kinds('do {\n  x = await step();\n} while (!x);\n'), ['1:unbounded-loop']);
  // A loop that cannot wait is arithmetic, not a wait.
  assert.deepEqual(kinds('while (el) el = el.parentElement;\nwhile (i < n) i += 1;\n'), []);
  assert.deepEqual(kinds('for (const b of browsers) await runOne(b);\n'), []);
});

test('a Playwright wait without an explicit timeout is found', () => {
  assert.deepEqual(kinds('await page.waitForFunction(() => window.ready);\n'),
    ['1:unbounded-wait']);
  assert.deepEqual(kinds('await page.waitForSelector("#dlg[open]");\n'), ['1:unbounded-wait']);
  assert.deepEqual(kinds('const d = page.waitForEvent("download");\n'), ['1:unbounded-wait']);
  assert.deepEqual(kinds([
    'await page.waitForFunction(() => window.ready, null, { timeout: 5000 });',
    'await page.waitForSelector("#dlg[open]", { state: "visible", timeout: 5000 });',
    'await page.waitForEvent("download", { timeout: 5000 });',
    'await page.waitForFunction((sel) => {',
    '  return document.querySelector(sel);',
    '}, "#a", { timeout: 5000 });',
  ].join('\n')), []);
  // A word "timeout" in a string or a comment is not the option.
  assert.deepEqual(kinds('await page.waitForSelector("[data-timeout]"); // timeout later\n'),
    ['1:unbounded-wait']);
  // Nor is a parameter of the page function, nor options the call does not spell out.
  assert.deepEqual(kinds('await page.waitForFunction((timeout) => window.ready, 5);\n'),
    ['1:unbounded-wait']);
  assert.deepEqual(kinds('await page.waitForSelector("#a", opts);\n'), ['1:unbounded-wait']);
  // In Playwright a timeout of 0 disables the timeout.
  assert.deepEqual(kinds('await page.waitForFunction(() => window.ready, null, { timeout: 0 });\n'),
    ['1:unbounded-wait']);
  assert.deepEqual(kinds('await page.waitForSelector("#a", { state: "x", timeout: 0.0 });\n'),
    ['1:unbounded-wait']);
  assert.deepEqual(kinds([
    'await page.waitForSelector("#a", { timeout });',
    'await page.waitForSelector("#a", { timeout: T.short });',
    'await page.waitForLoadState("load", { timeout: 10000 });',
    'await page.locator("#a").waitFor({ state: "visible", timeout: 5000 });',
    'await page.waitForURL("**/x", { timeout: 5000 });',
  ].join('\n')), []);
  assert.deepEqual(kinds([
    'await page.waitForLoadState("load");',
    'await page.locator("#a").waitFor();',
    'await page.waitForURL("**/x");',
    'await page.waitForResponse((r) => r.ok());',
  ].join('\n')), ['1:unbounded-wait', '2:unbounded-wait', '3:unbounded-wait', '4:unbounded-wait']);
});

test('playwright outside the harness is found, since its page.evaluate has no bound', () => {
  assert.deepEqual(kinds("const playwright = require('playwright');\n"), ['1:raw-playwright']);
  assert.deepEqual(kinds("const { chromium } = require('playwright');\n"), ['1:raw-playwright']);
  assert.deepEqual(kinds("import { webkit } from 'playwright';\n"), ['1:raw-playwright']);
  assert.deepEqual(kinds("const pw = require('playwright-core');\n"), ['1:raw-playwright']);
  assert.deepEqual(kinds("const suite = require('./lib/suite.cjs');\n"), []);
  assert.deepEqual(kinds("const playwright = require('playwright');\n",
    { playwrightAllowed: true }), []);
});

test('a frame window from an integer literal is found; one from the sample rate is not', () => {
  assert.deepEqual(kinds('const head = buf.subarray(0, 280);\n'), ['1:fixed-frame-window']);
  assert.deepEqual(kinds('const tail = samples.slice(4800);\n'), ['1:fixed-frame-window']);
  assert.deepEqual(kinds('for (let i = 0; i < 280; i++) peak = Math.max(peak, d[i]);\n'),
    ['1:fixed-frame-window']);
  assert.deepEqual(kinds([
    'const head = buf.subarray(0, Math.round(0.006 * ctx.sampleRate));',
    'const tail = samples.slice(frames(0.1, sampleRate));',
    'for (let i = 0; i < d.length; i++) peak = Math.max(peak, d[i]);',
    'const few = buf.subarray(0, 32);',
  ].join('\n')), []);
  // A window that ends at the buffer's length still starts at a literal; the counter may sit
  // anywhere in the index.
  assert.deepEqual(kinds('for (let i = d.length - 280; i < d.length; i++) m += d[i];\n'),
    ['1:fixed-frame-window']);
  assert.deepEqual(kinds('for (let i = 0; i < 280; i++) m = Math.max(m, d[off + i]);\n'),
    ['1:fixed-frame-window']);
  assert.deepEqual(kinds('for (let i = 0; i < 128; i++) notes.push(i);\n'), []);
  // The finding says what to do when the count is not frames.
  assert.match(scanner.scan('const head = spectrum.subarray(0, 512);\n')[0].message,
    /if it counts text, bins or pixels mark it timing-allow and say which/);
  // Text is truncated, not windowed.
  assert.deepEqual(kinds([
    'console.log(JSON.stringify(res).slice(0, 600));',
    'const first = e.message.slice(0, 120);',
    'const shown = errors.slice(0, 100).join(" | ");',
  ].join('\n')), []);
});

test('an assumed sample rate is found; a render rate is not', () => {
  assert.deepEqual(kinds('const n = Math.round(0.006 * 48000);\n'), ['1:fixed-rate']);
  assert.deepEqual(kinds('const sr = engine.sampleRate || 44100;\n'), ['1:fixed-rate']);
  assert.deepEqual(kinds('const sr = 4.8e4;\n'), ['1:fixed-rate']);
  assert.deepEqual(kinds([
    'const ctx = new OfflineAudioContext(1, 48000, 48000);',
    'const t = await render({ duration: 1, sampleRate: 48000, channels: 2 });',
    'const a = await analyse({ seconds: 10, sr: 44100 });',
    'const bytes = encodeWav(samples, 44100);',
    'const ms = 480000; const hz = 4800;',
  ].join('\n')), []);
});

test('only a reasoned timing-allow marker silences a finding', () => {
  const sleep = 'await page.waitForTimeout(200);';
  assert.deepEqual(kinds(`${sleep} // timing-allow: deliberate 200 ms silence check\n`), []);
  assert.deepEqual(kinds(`// timing-allow: deliberate 200 ms silence check\n${sleep}\n`), []);
  assert.deepEqual(kinds(`/* timing-allow: deliberate 200 ms silence check */\n${sleep}\n`), []);
  // No reason: the sleep stands and the empty marker is a finding of its own.
  assert.deepEqual(kinds(`${sleep} // timing-allow:\n`), ['1:empty-allow', '1:fixed-sleep']);
  assert.deepEqual(kinds(`${sleep} // timing-allow: ok\n`), ['1:empty-allow', '1:fixed-sleep']);
  // A reason is at least three words: characters are not one, and neither is "because".
  for (const reason of ['xxxxxxxx', 'because.', 'needed here', '12345 67890 !!!!!']) {
    assert.deepEqual(kinds(`${sleep} // timing-allow: ${reason}\n`),
      ['1:empty-allow', '1:fixed-sleep'], reason);
  }
  // A marker two lines up, or above a line of code, covers nothing.
  assert.deepEqual(kinds(`// timing-allow: deliberate 200 ms silence check\n\n${sleep}\n`),
    ['3:fixed-sleep']);
  assert.deepEqual(kinds('const a = 1; // timing-allow: deliberate 200 ms silence check\n'
    + `${sleep}\n`), ['2:fixed-sleep']);
  // The marker is read from comments only.
  assert.deepEqual(kinds(`const s = '// timing-allow: deliberate 200 ms silence'; ${sleep}\n`),
    ['1:fixed-sleep']);
});

test('strings, templates, comments and regular expressions are not code', () => {
  assert.deepEqual(kinds([
    "const a = 'await page.waitForTimeout(100)';",
    'const b = "while (ctx.currentTime < t) await x();";',
    'const c = `await sleep(100) at 48000`;',
    '// await page.waitForTimeout(100);',
    '/* await page.waitForSelector("#a"); */',
    'const d = /waitForTimeout\\(\\d+\\)/.test(text);',
    "const e = text.split('/').length / 48e3 > 0 ? `${x.length}` : '';",
  ].join('\n')), ['7:fixed-rate']);
  // Code inside a template's ${ } is code.
  assert.deepEqual(kinds('const s = `${await page.waitForTimeout(5)}`;\n'), ['1:fixed-sleep']);
});

// ------------------------------------------------------------------- tests/browser as it is
test('tests/browser holds no timing finding beyond its recorded debt', () => {
  const baseline = scanner.readBaseline();
  const result = scanner.compare(scanner.scanTree(ROOT), baseline.debt);
  assert.deepEqual(scanner.report(result), [],
    `${scanner.RULE}: new waits or windows that measure the host (fix them, or mark a `
    + 'deliberate one with `// timing-allow: <reason>`):\n  '
    + scanner.report(result).join('\n  '));
});

test('every timing-allow marker of tests/browser gives its reason, printed for review', (t) => {
  const markers = scanner.treeMarkers(ROOT);
  assert.ok(markers.length >= 10, `the markers are read (${markers.length})`);
  for (const m of markers) {
    assert.ok(m.reason.split(/\s+/).length >= 3, `${m.file}:${m.line}: a reason of three words`);
    // Whether the reason is a good one is a reviewer's call: every marker is shown.
    t.diagnostic(`timing-allow ${m.file}:${m.line}: ${m.reason}`);
  }
  assert.equal(scanner.RULE, 'project.bounded-test-timing');
});

test('the recorded debt names real files and kinds, and never a fixed waitForTimeout', (t) => {
  const { debt } = scanner.readBaseline();
  for (const [file, byKind] of Object.entries(debt)) {
    assert.ok(existsSync(path.join(ROOT, file)), `${file} is recorded as debt but does not exist`);
    for (const [kind, n] of Object.entries(byKind)) {
      assert.ok(kind in scanner.KINDS, `${file}: unknown kind ${kind}`);
      assert.ok(Number.isInteger(n) && n > 0, `${file} ${kind}: a positive count`);
      // These three were migrated when the rule landed; nothing may be recorded for them again,
      // except in the one suite another change owned at the time.
      if (['fixed-sleep', 'unbounded-loop', 'empty-allow'].includes(kind)) {
        assert.fail(`${file}: ${kind} cannot be recorded as debt`);
      }
      if (['raw-playwright', 'unbounded-wait', 'fixed-frame-window'].includes(kind)) {
        assert.equal(file, 'tests/browser/v3-ui.cjs',
          `${file}: ${kind} cannot be recorded as debt`);
      }
    }
  }
  // Paid debt is reported, not failed: a change that removes a sleep must not need this file.
  const { stale } = scanner.compare(scanner.scanTree(ROOT), debt);
  for (const s of stale) {
    t.diagnostic(`stale debt: ${s.file} [${s.kind}] ${s.found} found, ${s.recorded} recorded; `
      + 'run node tests/browser/lib/timing-scan.cjs --write-baseline');
  }
});

test('mutation: each forbidden wait added to dsp.cjs is reported with its line', () => {
  const { debt } = scanner.readBaseline();
  const file = 'tests/browser/dsp.cjs';
  assert.equal(debt[file], undefined, 'dsp.cjs carries no debt, so every finding in it is new');
  // The suite as it is on disk, with one line added after its last.
  const source = readFileSync(path.join(ROOT, file), 'utf8').replace(/\n*$/, '\n');
  const added = source.split('\n').length;
  assert.deepEqual(scanner.scan(source, { file }), [], 'dsp.cjs is clean before the mutation');
  const mutate = (line) => scanner.report(scanner.compare(
    scanner.scan(`${source}${line}\n`, { file }), debt));
  const at = (kind) => new RegExp(`^tests/browser/dsp\\.cjs:${added}: \\[${kind}\\]`);
  for (const [line, kind] of [
    ['await page.waitForTimeout(100);', 'fixed-sleep'],
    ['await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));', 'timer-sleep'],
    ['await new Promise((r) => setTimeout(() => r(), 100));', 'timer-sleep'],
    ["await require('timers/promises').setTimeout(100);", 'timer-sleep'],
    ['for (const b of RUN.browsers) { const t0 = Date.now(); await sleep(300); log(t0); }',
      'timer-sleep'],
    ['const head = buf.subarray(0, 280);', 'fixed-frame-window'],
    ['await page.waitForFunction(() => window.ready);', 'unbounded-wait'],
    ['await page.waitForFunction(() => window.ready, null, { timeout: 0 });', 'unbounded-wait'],
    ['await page.waitForTimeout(100); // timing-allow: xxxxxxxx', 'empty-allow'],
  ]) {
    const out = mutate(line);
    assert.equal(out.length >= 1, true, line);
    assert.match(out[0], at(kind), line);
  }
  assert.deepEqual(
    mutate('await page.waitForTimeout(100); // timing-allow: deliberate 200 ms silence check'), []);
});

test('mutation: one more sleep in a suite that carries debt is reported', () => {
  const { debt } = scanner.readBaseline();
  const [file, byKind] = Object.entries(debt).find(([, k]) => k['timer-sleep']);
  const lines = Array.from({ length: byKind['timer-sleep'] + 1 }, () => 'await sleep(150);');
  const findings = scanner.scan(`async function f() {\n${lines.join('\n')}\n}\n`, { file });
  const out = scanner.report(scanner.compare(findings, debt));
  assert.match(out[0], new RegExp(`${byKind['timer-sleep'] + 1} \\[timer-sleep\\] finding\\(s\\), `
    + `${byKind['timer-sleep']} recorded as debt`));
  findings.pop();
  assert.deepEqual(scanner.report(scanner.compare(findings, debt)), []);
});

// ------------------------------------------------------------------------ the shared waits
test('until returns the value of the predicate once it holds', async () => {
  let n = 0;
  const value = await wait.until(() => { n += 1; return n >= 3 ? { n } : null; },
    { ms: 2000, what: 'third poll', every: 1 });
  assert.deepEqual(value, { n: 3 });
});

test('until ends on its wall-clock deadline and names the check and the last value', async () => {
  const t0 = Date.now();
  await assert.rejects(
    wait.until(() => 0, { ms: 60, what: 'the engine reports playing', every: 5 }),
    (e) => e instanceof wait.WaitTimeout
      && /^the engine reports playing: not reached within 60 ms of wall time/.test(e.message)
      && /last value 0/.test(e.message));
  assert.ok(Date.now() - t0 < 2000, 'the deadline is wall time');
});

test('until ends a predicate that never answers', async () => {
  const t0 = Date.now();
  await assert.rejects(
    wait.until(() => new Promise(() => {}), { ms: 60, what: 'a page that never answers' }),
    (e) => e instanceof wait.WaitTimeout && /^a page that never answers: /.test(e.message));
  assert.ok(Date.now() - t0 < 2000);
});

test('until and bounded refuse a wait without a deadline or a name', async () => {
  await assert.rejects(wait.until(() => true, { what: 'x' }), TypeError);
  await assert.rejects(wait.until(() => true, { ms: 100 }), TypeError);
  await assert.rejects(wait.until(() => true, { ms: Infinity, what: 'x' }), TypeError);
  assert.throws(() => wait.bounded(Promise.resolve(1), { ms: 100 }), TypeError);
  assert.throws(() => wait.bounded(Promise.resolve(1), { what: 'x' }), TypeError);
});

test('until passes a predicate error through instead of polling past it', async () => {
  await assert.rejects(wait.until(() => { throw new RangeError('page closed'); },
    { ms: 500, what: 'x' }), RangeError);
});

test('bounded settles as its promise does, or rejects by name at the deadline', async () => {
  assert.equal(await wait.bounded(Promise.resolve(7), { ms: 500, what: 'x' }), 7);
  await assert.rejects(wait.bounded(Promise.reject(new RangeError('boom')),
    { ms: 500, what: 'x' }), RangeError);
  await assert.rejects(wait.bounded(new Promise(() => {}), { ms: 30, what: 'page.evaluate(run)' }),
    (e) => e instanceof wait.WaitTimeout
      && e.message === 'page.evaluate(run): no answer within 30 ms of wall time');
  // A promise that rejects after its deadline is not an unhandled rejection.
  let late;
  const slow = new Promise((_, reject) => { late = reject; });
  await assert.rejects(wait.bounded(slow, { ms: 10, what: 'x' }), wait.WaitTimeout);
  late(new Error('page closed after the deadline'));
  await new Promise((resolve) => { setImmediate(resolve); });
});

test('frames and anchor take the window from the context rate', () => {
  assert.equal(wait.frames(0.006, 48000), 288);
  assert.equal(wait.frames(0.006, 44100), 265);
  assert.throws(() => wait.frames(0.006), TypeError);
  const a = wait.anchor({ currentTime: 2, sampleRate: 44100 }, 0.05);
  assert.equal(a.t0, 2.05);
  assert.equal(a.at(0.5), 2.55);
  assert.equal(a.frames(0.006), 265);
  assert.equal(a.frameAt(0), Math.round(2.05 * 44100));
  assert.throws(() => wait.anchor({ currentTime: 0 }), TypeError);
  // Self-contained: a page can run its source.
  // eslint-disable-next-line no-new-func
  const inPage = new Function(`return (${wait.anchor})({ currentTime: 1, sampleRate: 48000 }, 0)`);
  assert.equal(inPage().frames(0.5), 24000);
});

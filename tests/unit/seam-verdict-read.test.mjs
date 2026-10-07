// Ledger W7g: OSCILLA.measure.setValues answers `true` or { ok: false, errors } (ADR 0052), and
// a suite that discards the answer turns a refused setup into an unrelated failure later in
// the run. Every call in tests/browser and scripts/ reads the verdict: through
// tests/browser/lib/measure-seam.cjs, which throws with the reasons unless the call returned
// `true`, or by using the value itself (the checks that assert a refusal).
//   node --test tests/unit/seam-verdict-read.test.mjs
//
// One call is recorded as pending (PENDING): the live smoke's, which leaves with ledger W7e.
//
// What the scan decides: a call written as a statement or as the body of an arrow function is
// a discarded verdict. Its limits: it does not trace a value that is assigned and then ignored
// (`const r = m.setValues(v);`), passed as an argument to a call that ignores it
// (`foo(m.setValues(v))`), or returned out of page.evaluate and dropped by the caller
// (`await page.evaluate(() => { return m.setValues(v); });`), and it does not see a call made
// through an alias of the method. No such call exists in tests/browser or scripts/ today; a
// suite states its verdict through the helpers above or asserts it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HELPER = 'tests/browser/lib/measure-seam.cjs';
const requireCjs = createRequire(import.meta.url);
/**
 * Calls that leave with another open ledger line: file → why. An entry allows exactly the
 * calls of that file to stay, never more, and may be removed once they are gone.
 */
const PENDING = Object.freeze({
  'tests/browser/live-smoke.cjs': 'ledger W7e: the smoke loads ?measure=loopback#mr=<recipe> '
    + 'and its one setValues call goes with that change',
});

/** `file:line` of every setValues call in `text` whose verdict is not read. */
function discarded(text, file) {
  const out = [];
  const call = /([A-Za-z_$][\w$.]*)\.setValues\s*\(/g;
  for (let m = call.exec(text); m; m = call.exec(text)) {
    const before = text.slice(0, m.index).replace(/\s+$/, '');
    const line = text.slice(0, m.index).split('\n').length;
    const lineText = text.split('\n')[line - 1];
    if (/^\s*(\/\/|\*)/.test(lineText)) continue; // prose in a comment
    // Read: compared, assigned, returned, a property value or an argument.
    const read = /(=|:|\(|,|\breturn|!==|===)$/.test(before) && !/=>$/.test(before);
    if (!read) out.push(`${file}:${line}`);
  }
  return out;
}

function sources() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(cjs|mjs|js)$/.test(e.name)) out.push(rel);
    }
  };
  walk('tests/browser');
  walk('scripts');
  return out;
}

test('W7g: the scan reports a discarded verdict and accepts a read one', () => {
  const bad = [
    'm.setValues(values);',
    'await page.evaluate(() => window.OSCILLA.measure.setValues({ repeats: 1 }));',
    '{\n  window.OSCILLA.measure.setValues({ f1: 20 });\n}',
  ];
  for (const text of bad) assert.equal(discarded(text, 'x.cjs').length, 1, text);
  assert.deepEqual(discarded('a();\nb();\nm.setValues(v);', 'x.cjs'), ['x.cjs:3']);
  const good = [
    'const r = m.setValues(values);',
    'if (m.setValues(values) !== true) throw new Error("refused");',
    'return { setValues: m.setValues({ bogus: 1 }) };',
    'return m.setValues(values);',
    '// m.setValues(values); is prose here',
  ];
  for (const text of good) assert.deepEqual(discarded(text, 'x.cjs'), [], text);
});

test('W7g: no browser suite or script discards the verdict of OSCILLA.measure.setValues', () => {
  const found = [];
  for (const file of sources()) {
    if (file === HELPER) continue;
    const here = discarded(fs.readFileSync(path.join(ROOT, file), 'utf8'), file);
    if (Object.hasOwn(PENDING, file) && here.length <= 1) continue;
    found.push(...here);
  }
  assert.deepEqual(found, [], `setValues called and its verdict discarded (ledger W7g): use `
    + `${HELPER}`);
});

test('W7g: the shared setup helpers throw unless setValues returned true', async () => {
  const seam = requireCjs(path.join(ROOT, HELPER));
  const calls = [];
  /** A page whose evaluate runs the page function here, against a fake window.OSCILLA. */
  const pageWith = (verdict, loopbackOk = true) => ({
    evaluate: async (fn, arg) => {
      const was = globalThis.window;
      globalThis.window = { OSCILLA: { measure: {
        useLoopback: (system) => { calls.push(['useLoopback', system]); return loopbackOk; },
        setValues: (values) => { calls.push(['setValues', values]); return verdict; },
      } } };
      try {
        return fn(arg);
      } finally {
        globalThis.window = was;
      }
    },
  });
  await seam.applyValues(pageWith(true), { repeats: 1 });
  assert.deepEqual(calls, [['setValues', { repeats: 1 }]]);
  await assert.rejects(seam.applyValues(pageWith({ ok: false, errors: ['Runs: must be 1–10'] }),
    { repeats: 99 }), /OSCILLA\.measure\.setValues refused \{"repeats":99\}: Runs: must be 1–10/);
  // Anything but `true` is a refusal: the hook answered true before it validated anything.
  await assert.rejects(seam.applyValues(pageWith(undefined), { repeats: 1 }), /refused/);
  calls.length = 0;
  const system = { type: 'gain', gain: 0.5 };
  await seam.loopback(pageWith(true), { values: { repeats: 2 }, system });
  assert.deepEqual(calls, [['useLoopback', system], ['setValues', { repeats: 2 }]]);
  calls.length = 0;
  await seam.loopback(pageWith(true));
  assert.deepEqual(calls, [['useLoopback', null]], 'no values, no setValues call');
  await assert.rejects(seam.loopback(pageWith({ ok: false, errors: ['x'] }),
    { values: { repeats: 2 } }), /setValues refused/);
  await assert.rejects(seam.loopback(pageWith(true, false)),
    /OSCILLA\.measure\.useLoopback refused/);
});

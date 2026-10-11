// The MEASURE setup of the browser suites through window.OSCILLA.measure (ADR 0052).
//
// OSCILLA.measure.setValues answers `true` or { ok: false, errors }, and useLoopback answers
// false while a measurement runs. A suite that discards those answers turns a refused setup
// into an unrelated failure later in the run (ledger W7g), so the shared helpers throw with
// the reasons instead. tests/unit/seam-verdict-read.test.mjs fails on a setValues call in
// tests/browser or scripts/ whose verdict is not read.
//
//   const seam = require('./lib/measure-seam.cjs');
//   await seam.loopback(page, { values: SHORT });   // TEST CONTEXT, then the recipe values
//   await seam.applyValues(page, { repeats: 1 });
//
// Inside a larger page function, where a helper of the suite cannot be called, read the
// verdict in place: `seam.applied(await page.evaluate(() => { ...; return m.setValues(v); }))`.
'use strict';

/** Throw unless `verdict` is the `true` of an applied setValues call; returns true. */
function applied(verdict, values = null) {
  if (verdict === true) return true;
  const errors = verdict && Array.isArray(verdict.errors) ? verdict.errors.join('; ')
    : `it answered ${JSON.stringify(verdict)}`;
  throw new Error(`OSCILLA.measure.setValues refused ${values ? `${JSON.stringify(values)}` : ''}`
    .trim() + `: ${errors}`);
}

/** Set recipe values (field id → value) as a recipe link does; throws when refused. */
async function applyValues(page, values) {
  return applied(await page.evaluate((v) => window.OSCILLA.measure.setValues(v), values),
    values);
}

/**
 * Enter TEST CONTEXT (with `system`, a synthetic loopback system, when given) and then set
 * `values` when given; throws when either is refused.
 */
async function loopback(page, { values = null, system = null } = {}) {
  const entered = await page.evaluate((s) => window.OSCILLA.measure.useLoopback(s), system);
  if (entered !== true) {
    throw new Error('OSCILLA.measure.useLoopback refused: a measurement or a reference capture '
      + `is running (it answered ${JSON.stringify(entered)})`);
  }
  if (values) await applyValues(page, values);
  return true;
}

module.exports = { applied, applyValues, loopback };

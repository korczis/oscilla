// The family census (plan issue G021, milestone M123; the owner's order of 2026-11-04 and
// 2026-11-05: one parametrized implementation per control family, no parallel ones): each
// family of src/js/ui/catalog/families.js has one model module, its implementers say so in a
// ui-family marker, and today's duplicates are tests/unit/ui-families-baseline.json, which only
// shrinks.
//   node --test tests/unit/ui-families.test.mjs
// Wiring: scripts/ui-catalog/families.mjs familyCensus over every .js file under src/js (the
// source half). The rendered half (data-ui-family on every element of a family's role in every
// workspace) is the browser census of the same issue.
// Fails on 67daeff3: neither the family table, the census nor the baseline exists.
// Mutations: fixtures below add an unmarked knob, a second model, a skin with value logic, a
// model without its marker, a bad marker, and a baseline entry whose duplicate is gone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const at = (p) => new URL(p, ROOT);
const TABLE = 'src/js/ui/catalog/families.js';
const CENSUS = 'scripts/ui-catalog/families.mjs';
const BASELINE = 'tests/unit/ui-families-baseline.json';

const load = async () => {
  assert.ok(existsSync(at(TABLE)), `${TABLE}: the family table`);
  assert.ok(existsSync(at(CENSUS)), `${CENSUS}: the family census`);
  assert.ok(existsSync(at(BASELINE)), `${BASELINE}: the duplicate baseline`);
  const [{ FAMILIES }, census] = await Promise.all([import(at(TABLE)), import(at(CENSUS))]);
  return { FAMILIES, census, baseline: JSON.parse(readFileSync(at(BASELINE), 'utf8')) };
};

/** The problems of `files` that the baseline does not list, and the entries no problem has. */
function judge(census, families, files, duplicates) {
  const { problems } = census.familyCensus(files, families);
  const listed = new Set(duplicates.map(census.problemKey));
  const found = new Set(problems.map(census.problemKey));
  return { problems, extra: problems.filter((p) => !listed.has(census.problemKey(p))),
    stale: duplicates.filter((d) => !found.has(census.problemKey(d))) };
}

test('the tree: every family problem is a listed duplicate and every listed one still exists',
  async () => {
    const { FAMILIES, census, baseline } = await load();
    const r = judge(census, FAMILIES, census.readSources(new URL('.', ROOT).pathname),
      baseline.duplicates);
    assert.deepEqual(r.extra.map((p) => `${p.kind} ${p.family} ${p.file}: ${p.text}`), [],
      'a new implementation of a control family: reuse its model, or mark it as a skin');
    assert.deepEqual(r.stale.map((d) => `${d.family} ${d.file} ${d.kind}`), [],
      'a duplicate that is gone: remove its baseline entry (the baseline only shrinks)');
  });

test('the table: eight families, each model named exists with its marker, each with its slice',
  async () => {
    const { FAMILIES } = await load();
    assert.deepEqual(Object.keys(FAMILIES).sort(),
      ['app-shell', 'envelope', 'filter-response', 'keyboard', 'knob', 'patch-bay', 'slider',
        'switch']);
    for (const [id, f] of Object.entries(FAMILIES)) {
      assert.match(f.slice, /^G02[2-8]$/, `${id}: the slice that unifies it`);
      if (!f.model) continue;
      const text = readFileSync(at(f.model), 'utf8');
      assert.match(text, new RegExp(`^// ui-family: ${id} model$`, 'm'), `${id}: model marker`);
    }
  });

test('the baseline: each entry names its family slice and why, and no file twice per family',
  async () => {
    const { FAMILIES, baseline } = await load();
    const seen = new Set();
    for (const d of baseline.duplicates) {
      assert.equal(d.slice, FAMILIES[d.family].slice, `${d.file}: the ${d.family} slice`);
      assert.ok(typeof d.why === 'string' && d.why.split(/\s+/).length >= 5, `${d.file}: why`);
      const k = `${d.family}|${d.file}|${d.kind}`;
      assert.ok(!seen.has(k), `${k} listed twice`);
      seen.add(k);
    }
    // the rendered half: only families still without their one model may render unmarked
    for (const r of baseline.rendered) {
      assert.equal(r.key.split(' ')[0], r.family, `${r.key}: its family`);
      assert.equal(FAMILIES[r.family].model, null, `${r.key}: ${r.family} has its model, so its `
        + 'renders carry data-ui-family');
      assert.equal(r.slice, FAMILIES[r.family].slice, `${r.key}: the ${r.family} slice`);
    }
    assert.equal(new Set(baseline.rendered.map((r) => r.key)).size, baseline.rendered.length,
      'a rendered key listed twice');
    assert.ok(baseline.duplicates.some((d) => d.family === 'knob'
      && d.file === 'src/js/ui/synth/knob.js'), 'the second knob core is a listed duplicate');
  });

// ------------------------------------------------------------------------------ mutations
const FX = Object.freeze({
  knob: Object.freeze({ slice: 'G022', model: 'src/js/k/model.js', what: 'x' }),
  slider: Object.freeze({ slice: 'G023', model: null, what: 'x' }),
});
const MODEL = '// The knob.\n// ui-family: knob model\nexport const SWEEP_DEG = 270;\n';
const base = () => ({ 'src/js/k/model.js': MODEL,
  'src/js/k/use.js': "import { SWEEP_DEG } from './model.js';\nexport const a = SWEEP_DEG;\n" });

test('mutation: a clean fixture has no problem, and a consumer of the model is no implementer',
  async () => {
    const { census } = await load();
    assert.deepEqual(census.familyCensus(base(), FX).problems, []);
  });

test('mutation: an unmarked module with a knob signature fails, also without any marker',
  async () => {
    const { census } = await load();
    const f = { ...base(), 'src/js/k/two.js': '// another\nexport const SWEEP_DEG = 300;\n' };
    const r = judge(census, FX, f, []);
    assert.deepEqual(r.extra.map((p) => [p.kind, p.file]), [['unmarked', 'src/js/k/two.js']]);
    // a signature in a comment is no implementation
    const c = { ...base(), 'src/js/k/doc.js': '// const SWEEP_DEG = 1;\nexport const n = 1;\n' };
    assert.deepEqual(census.familyCensus(c, FX).problems, []);
  });

test('mutation: a second model, a skin with value logic, a missing model and bad markers fail',
  async () => {
    const { census } = await load();
    const kinds = (files) => census.familyCensus(files, FX).problems.map((p) => p.kind).sort();
    assert.deepEqual(kinds({ ...base(),
      'src/js/k/b.js': '// ui-family: knob model\nexport const SWEEP_DEG = 1;\n' }),
    ['second-model']);
    assert.deepEqual(kinds({ ...base(),
      'src/js/k/s.js': '// ui-family: knob skin pro\nexport const SWEEP_DEG = 1;\n' }),
    ['skin-logic']);
    assert.deepEqual(kinds({ ...base(), 'src/js/k/model.js': 'export const SWEEP_DEG = 1;\n' }),
      ['model-missing', 'unmarked']);
    assert.deepEqual(kinds({ ...base(), 'src/js/k/m.js': '// ui-family: dial model\n' }),
      ['bad-marker']);
    assert.deepEqual(kinds({ ...base(), 'src/js/k/n.js': '// ui-family: knob not: domain\n'
      + 'export const SWEEP_DEG = 1;\n' }), ['bad-marker']);
    // a not: marker with its reason takes the module out of the family
    assert.deepEqual(kinds({ ...base(), 'src/js/k/v.js': '// ui-family: knob not: a gauge '
      + 'needle of a meter view\nexport const SWEEP_DEG = 1;\n' }), []);
  });

test('mutation: only the model or a skin of a family may write its data-ui-family', async () => {
  const { census } = await load();
  const kinds = (files) => census.familyCensus(files, FX).problems.map((p) => p.kind).sort();
  assert.deepEqual(kinds({ ...base(),
    'src/js/k/w.js': "export const h = '<div data-ui-family=\"knob\"></div>';\n" }),
  ['foreign-attr']);
  assert.deepEqual(kinds({ ...base(),
    'src/js/k/d.js': "export const f = (el) => { el.dataset.uiFamily = 'knob'; };\n" }),
  ['foreign-attr']);
  assert.deepEqual(kinds({ ...base(), 'src/js/k/s.js': '// ui-family: knob skin pro\n'
    + "export const h = '<div data-ui-family=\"knob\"></div>';\n" }), []);
});

test('mutation: a second ADSR curve law or a computed biquad response is an implementer',
  async () => {
    const { census } = await load();
    const fam = { envelope: Object.freeze({ slice: 'G027', model: null, what: 'x' }),
      'filter-response': Object.freeze({ slice: 'G028', model: null, what: 'x' }) };
    const files = {
      'src/js/a.js': 'function envelope(p) {\n  const v = [p.attack, p.decay];\n  return v;\n}\n',
      'src/js/b.js': 'export function biquadDb(t, f0, q, g, f) { return 0; }\n',
      // the amplitude envelope of a signal is not an ADSR law
      'src/js/c.js': 'export function envelope(x) {\n  return x.map(Math.abs);\n}\n',
      // driving an envelope node is not computing its curve
      'src/js/d.js': 'function rebuildEnvelope(h, t) {\n  h.release(t);\n}\n',
      'src/js/e.js': 'function ownEnvelope(h) {\n  return typeof h.release === "function";\n}\n' };
    assert.deepEqual(census.familyCensus(files, fam).problems.map((p) => `${p.family} ${p.file}`),
      ['envelope src/js/a.js', 'filter-response src/js/b.js']);
  });

test('mutation: a baseline entry whose duplicate is gone fails (the baseline only shrinks)',
  async () => {
    const { census } = await load();
    const r = judge(census, FX, base(), [{ family: 'knob', file: 'src/js/k/old.js',
      kind: 'unmarked', slice: 'G022', why: 'a knob core that was removed already' }]);
    assert.deepEqual(r.stale.map((d) => d.file), ['src/js/k/old.js']);
  });

test('mutation: the switch signature counts rendered roles, not attribute selectors',
  async () => {
    const { census } = await load();
    const sw = { switch: Object.freeze({ slice: 'G023', model: null, what: 'x' }) };
    const files = {
      'src/js/a.js': "export const q = (t) => t.closest('[role=\"switch\"], button');\n",
      'src/js/b.js': "export const b = () => '<div role=\"radiogroup\"></div>';\n",
      'src/js/c.js': "export const c = (el) => el.setAttribute('role', 'switch');\n",
      'src/js/d.js': "export const d = { role: 'switch' };\n" };
    assert.deepEqual(census.familyCensus(files, sw).problems.map((p) => p.file),
      ['src/js/b.js', 'src/js/c.js', 'src/js/d.js']);
  });

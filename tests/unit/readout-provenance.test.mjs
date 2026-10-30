// The readout provenance check (T026, P05 audit): every readout of the interface has a complete
// row in docs/v3/readout-truth.yaml, or is recorded debt in readout-provenance-baseline.json,
// which only shrinks; docs/v3/readout-truth.md is the generated view of the table.
//
// A readout is a start tag of src/index.html or src/partials/**/*.html with a static data-osc
// value that binds x-text or :aria-valuetext, or carries role="meter", role="img" or aria-live,
// and is not a control without a value of its own (scripts/readout-truth.mjs says which). A
// declared chart (data-osc-chart) is the readout `chart:<id>`. A complete row states quantity,
// unit, source paths that exist, algorithm, resolution, calibration, limitations, test paths
// that exist (or why there are none), a label of the six P05 evidence labels, and each open
// defect names a plan issue of .ai/repo/project/issues.
//
// What it does not decide: that a row's prose is true of the code; the reviewer reads it.
//   node --test tests/unit/readout-provenance.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BASELINE_REL, LABELS, MARKDOWN_REL, ROOT, TABLE_REL, load, problemsOf, readoutsOf,
  renderMarkdown, treeKeys,
} from '../../scripts/readout-truth.mjs';

const NAME = 'readout provenance';
const HTML = readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const exists = (rel) => existsSync(path.join(ROOT, rel));
const issueExists = (id) => exists(`.ai/repo/project/issues/${id}.yaml`);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Keys of `listed` absent from an earlier version of the baseline: [[key, sha]]. */
export function grown(listed, history) {
  const out = [];
  for (const { sha, undescribed } of history) {
    const then = new Set(undescribed);
    for (const k of listed) if (!then.has(k)) out.push([k, sha]);
  }
  return out;
}

// ------------------------------------------------------------------------------ the tree
test('every readout of the markup has a complete row or is listed as undescribed', () => {
  const { problems, keys, table } = load();
  assert.ok(keys.length > 0, 'the scan finds readouts in src/index.html');
  assert.ok(table.readouts.length > 0, `${TABLE_REL} describes readouts`);
  assert.deepEqual(problems, [], `${NAME}: ${problems.length} problem(s); describe the readout `
    + `in ${TABLE_REL} (never list a new key in ${BASELINE_REL}):\n  ${problems.join('\n  ')}`);
});

test('the committed Markdown is the generated view of the table, byte for byte', () => {
  const { table, baseline } = load();
  const md = renderMarkdown(table, baseline);
  assert.equal(readFileSync(path.join(ROOT, MARKDOWN_REL), 'utf8'), md,
    `${MARKDOWN_REL} is stale: run node scripts/readout-truth.mjs`);
});

test('the baseline is sorted, holds each key once and has its note', () => {
  const b = JSON.parse(readFileSync(path.join(ROOT, BASELINE_REL), 'utf8'));
  assert.ok(typeof b.note === 'string' && b.note.length > 0, `${BASELINE_REL} has a note`);
  assert.ok(Array.isArray(b.undescribed), `${BASELINE_REL} has an undescribed list`);
  assert.deepEqual(b.undescribed, [...new Set(b.undescribed)].sort(), 'sorted, each key once');
});

/** The baseline of every commit that changed it, newest first; null without history. */
function baselineHistory() {
  const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) return null;
  const log = git('log', '--format=%H', '--', BASELINE_REL);
  if (log.status !== 0) return null;
  return log.stdout.split('\n').filter(Boolean).map((sha) => ({ sha: sha.slice(0, 12),
    undescribed: JSON.parse(git('show', `${sha}:${BASELINE_REL}`).stdout).undescribed }));
}

test('the baseline only shrinks: no key is listed that an earlier commit did not list', (t) => {
  const history = baselineHistory();
  if (!history || !history.length) {
    if (history && process.env.GITHUB_ACTIONS === 'true') {
      assert.fail(`no commit holds ${BASELINE_REL}: the CI unit job checks out with `
        + 'fetch-depth: 0');
    }
    t.skip('no git history of the baseline here');
    return;
  }
  const { baseline } = load();
  const raised = grown(baseline, history);
  assert.deepEqual(raised, [], `${NAME}: the baseline grew; it may only shrink:\n  `
    + raised.map(([k, sha]) => `${k}, not listed at ${sha}`).join('\n  '));
});

// ------------------------------------------------------------------------------ mutations
/** The real table, baseline and keys, with `edit` applied to copies; returns the problems. */
function mutated({ html = HTML, table: editTable, baseline: editBaseline } = {}) {
  const real = load();
  const table = clone(real.table);
  let baseline = [...real.baseline];
  if (editTable) editTable(table);
  if (editBaseline) baseline = editBaseline(baseline);
  const keys = [...new Set(readoutsOf(html).map((r) => r.key))].sort();
  return problemsOf(table, { keys, baseline, exists, issueExists });
}

const rowOf = (table, key) => table.readouts.find((r) => r.key === key);

test('mutation: a new readout in a copy of the markup with no row fails', () => {
  assert.deepEqual(mutated(), [], 'the unmutated tree is sound');
  const html = HTML.replace('</body>', '<span data-osc="fake.readout" x-text="x"></span></body>');
  assert.notEqual(html, HTML, 'the fixture changed the markup');
  const problems = mutated({ html });
  assert.deepEqual(problems, [`fake.readout: a readout with no row and not in ${BASELINE_REL}`]);
});

test('mutation: deleting the row of a readout that exists fails', () => {
  const problems = mutated({ table: (t) => {
    t.readouts = t.readouts.filter((r) => r.key !== 'source.gainValue');
  } });
  assert.deepEqual(problems,
    [`source.gainValue: a readout with no row and not in ${BASELINE_REL}`]);
});

test('mutation: a row whose readout no longer exists fails', () => {
  const html = HTML.replace(/\sdata-osc="dual\.beat"/, '');
  assert.notEqual(html, HTML, 'the fixture removed the dual.beat readout');
  assert.deepEqual(mutated({ html }),
    ['dual.beat: no such readout in the markup (row is stale)']);
});

test('mutation: a label outside the six evidence labels fails', () => {
  const problems = mutated({ table: (t) => { rowOf(t, 'source.freqValue').label = 'CONFIDENT'; } });
  assert.deepEqual(problems, [`source.freqValue: label "CONFIDENT" is not one of `
    + `${LABELS.join(', ')}`]);
  for (const label of LABELS) {
    assert.deepEqual(mutated({ table: (t) => { rowOf(t, 'source.freqValue').label = label; } }),
      [], `${label} is a label`);
  }
});

test('mutation: a missing source path, test path, field or plan issue fails', () => {
  assert.deepEqual(mutated({ table: (t) => {
    rowOf(t, 'source.freqValue').source = ['src/js/ui/no-such-module.js'];
  } }), ['source.freqValue: source path src/js/ui/no-such-module.js does not exist']);
  assert.deepEqual(mutated({ table: (t) => { rowOf(t, 'source.freqValue').source = []; } }),
    ['source.freqValue: source is missing']);
  assert.deepEqual(mutated({ table: (t) => {
    rowOf(t, 'source.freqValue').tests = ['tests/unit/no-such.test.mjs'];
  } }), ['source.freqValue: test path tests/unit/no-such.test.mjs does not exist']);
  assert.deepEqual(mutated({ table: (t) => { rowOf(t, 'source.freqValue').tests = []; } }),
    ['source.freqValue: no tests and no untested reason']);
  assert.deepEqual(mutated({ table: (t) => { delete rowOf(t, 'source.freqValue').unit; } }),
    ['source.freqValue: unit is missing']);
  assert.deepEqual(mutated({ table: (t) => {
    rowOf(t, 'source.gainValue').defects[0].issue = 'T999';
  } }), ['source.gainValue: defect "T999" names no plan issue']);
  assert.deepEqual(mutated({ table: (t) => {
    rowOf(t, 'source.gainValue').defects[0].summary = '';
  } }), ['source.gainValue: defect T001 has no summary']);
});

test('mutation: a grown baseline fails, against the tree and against its history', () => {
  assert.deepEqual(mutated({ baseline: (b) => [...b, 'source.freqValue'].sort() }),
    [`source.freqValue: described and still listed in ${BASELINE_REL}`]);
  assert.deepEqual(mutated({ baseline: (b) => [...b, 'gone.readout'].sort() }),
    [`gone.readout: listed in ${BASELINE_REL} but no longer a readout`]);
  const history = [{ sha: 'lowered', undescribed: ['a'] },
    { sha: 'original', undescribed: ['a', 'b'] }];
  assert.deepEqual(grown(['a'], history), []);
  assert.deepEqual(grown([], history), [], 'paid off');
  assert.deepEqual(grown(['a', 'b'], history), [['b', 'lowered']], 'listed again');
  assert.deepEqual(grown(['a', 'c'], history), [['c', 'lowered'], ['c', 'original']],
    'a new key');
});

// ------------------------------------------------------------------------------ negatives
test('negative: a control without a displayed value is not a readout', () => {
  const html = [
    '<button type="button" data-osc="x.button" x-text="label">Go</button>',
    '<a href="#" data-osc="x.link" x-text="c.target"></a>',
    '<input type="number" data-osc="x.input">',
    '<input type="range" data-osc="x.plainRange" aria-live="polite">',
    '<select data-osc="x.select" x-text="s"></select>',
    '<textarea data-osc="x.text" x-text="t"></textarea>',
    '<div role="radio" data-osc="x.radio" x-text="r"></div>',
    '<span role="tab" data-osc="x.tab" x-text="t"></span>',
    '<span x-text="noKey"></span>',
    '<!-- <span data-osc="x.inComment" x-text="c"></span> -->',
    '<span data-osc="x.static">plain text</span>',
    '<input type="range" data-osc="r.slider" :aria-valuetext="v">',
    '<output data-osc="r.value" x-text="v"></output>',
    '<p data-osc="r.status" role="status" aria-live="polite"></p>',
    '<div data-osc="r.meter" role="meter"></div>',
    '<div data-osc-chart="plot" data-osc="r.img" role="img"></div>',
  ].join('\n');
  assert.deepEqual(readoutsOf(html).map((r) => r.key),
    ['r.slider', 'r.value', 'r.status', 'r.meter', 'chart:plot', 'r.img']);
});

test('negative: the generated Markdown is byte-stable across runs and row order', () => {
  const { table, baseline } = load();
  const first = renderMarkdown(table, baseline);
  assert.equal(renderMarkdown(clone(table), [...baseline]), first, 'a second run is identical');
  const reversed = clone(table);
  reversed.readouts.reverse();
  assert.equal(renderMarkdown(reversed, baseline), first, 'the row order of the YAML is moot');
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'readout-truth.mjs'),
    '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, `--check passes on the tree:\n${run.stderr}`);
});

test('negative: partials under src/partials are scanned with the index', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'readout-truth-'));
  try {
    mkdirSync(path.join(dir, 'src', 'partials', 'deep'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'index.html'), '<output data-osc="a.v" x-text="v">');
    writeFileSync(path.join(dir, 'src', 'partials', 'deep', 'p.html'),
      '<span data-osc="b.v" x-text="v"></span><button data-osc="b.btn" x-text="l"></button>');
    assert.deepEqual(treeKeys(dir), ['a.v', 'b.v']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('negative: the check runs well under the unit-suite budget', () => {
  // CPU time of this thread, not wall time: a loaded shared machine stretches the latter
  // (plan E029). The scan, validation and rendering take a few tens of milliseconds.
  const cpu = process.threadCpuUsage ? () => process.threadCpuUsage() : () => process.cpuUsage();
  const before = cpu();
  const { table, baseline } = load();
  renderMarkdown(table, baseline);
  const used = cpu();
  const ms = (used.user - before.user + used.system - before.system) / 1000;
  assert.ok(ms < 1000, `the check used ${ms.toFixed(1)} ms of CPU; the budget is 1000 ms`);
});

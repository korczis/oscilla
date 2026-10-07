// Vocabulary (ADR 0053, docs/GLOSSARY.md): the names a format already persists decide the word
// the user sees. A run is one capture inside a measurement; an experiment is the stored record
// of a completed measurement; a project is a saved Studio document; the app is OSCILLA.
//
// Two halves:
//   1. frozen literals: the persisted and hashed names that the vocabulary follows. They are
//      compatibility surfaces (ADR 0023, ADR 0040) and change only with a schema version;
//   2. phrases: the user-facing sources never use "run" for a stored record, or "project" for
//      the app, so ledger P2 cannot come back unnoticed. Comments are not user text and are
//      stripped before the scan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXPERIMENT_KIND, EXPERIMENT_FILE_EXTENSION, LIMITS, RUN_ID_PATTERN, runId,
} from '../../src/js/experiments/schema.js';
import {
  DB_NAME, RECORDS, SUMMARIES, STUDIO_RECORDS, STUDIO_SUMMARIES, DEFINITIONS, STUDIO_RECORD_KINDS,
} from '../../src/js/experiments/store.js';
import { DEFINITION_KIND } from '../../src/js/experiments/definition.js';
import { aggregateCsv, transferCsv } from '../../src/js/experiments/csv.js';
import { STUDIO_KIND, STUDIO_FILE_EXTENSION } from '../../src/js/studio/schema.js';
import { PATCH_KIND, PATCH_FILE_EXTENSION } from '../../src/js/studio/patches.js';
import { PROFILE_FORMAT } from '../../src/js/calibration/profile.js';
import { RECIPE_HASH_KEY } from '../../src/js/core/url-state-measure.js';
import { STUDIO_LINK_KEYS } from '../../src/js/core/url-state-studio.js';
import { STORAGE_KEYS } from '../../src/js/core/constants.js';
import { WORKSPACES } from '../../src/js/ui/app.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ------------------------------------------------------------------ frozen literals

test('vocabulary: the stored record is an experiment in every persisted name', () => {
  assert.equal(EXPERIMENT_KIND, 'oscilla-experiment');
  assert.equal(EXPERIMENT_FILE_EXTENSION, '.oscilla.json');
  assert.equal(DB_NAME, 'oscilla-experiments');
  assert.deepEqual([RECORDS, SUMMARIES, STUDIO_RECORDS, STUDIO_SUMMARIES, DEFINITIONS],
    ['experiments', 'summaries', 'studio', 'studioSummaries', 'definitions']);
  assert.equal(DEFINITION_KIND, 'oscilla-definition');
  assert.ok(WORKSPACES.includes('experiments'), 'the workspace id m=experiments');
  assert.ok(WORKSPACES.includes('studio'), 'the workspace id m=studio');
});

test('vocabulary: a capture is a run in every stored and hashed name', () => {
  assert.equal(runId(0), 'run-1');
  assert.equal(runId(4), 'run-5');
  assert.ok(RUN_ID_PATTERN.test('run-1') && !RUN_ID_PATTERN.test('repeat-1'));
  assert.equal(LIMITS.runs, 64);
  assert.equal(LIMITS.runTransfers, 10);
  // The stored count of runs keeps its historical name (recipe.repeats).
  assert.deepEqual([...LIMITS.repeats], [1, 10]);
  const agg = aggregateCsv({ frequencies: [100], centreDb: [0], lowerDb: null, upperDb: null,
    spreadDb: null, runs: 3, method: 'mean', dispersion: 'std', repeatabilityDb: null,
    algorithm: 'oscilla.aggregate.v1' }, {});
  assert.equal(agg.split('\n')[0], '# OSCILLA aggregate of 3 runs (mean)');
  const one = transferCsv({ frequencies: [100], magnitudeDb: [0], snrDb: null, phaseDeg: null,
    validRange: [20, 20000], algorithm: 'oscilla.transfer.v1', sampleRate: 48000 }, {},
  { run: 0 });
  assert.ok(one.includes('\n# run: 0 (one run of a repeated measurement, not the aggregate)\n'));
  // The quality reasons stored in every record (and covered by the result hash) count runs.
  const quality = read('src/js/measurement/quality.js');
  const units = [...quality.matchAll(/add\('REPEATABILITY_NOT_MEASURED',[^;]*?, n, '(\w+)'\)/g)]
    .map((m) => m[1]);
  assert.ok(units.length >= 2, 'the REPEATABILITY_NOT_MEASURED reasons are found');
  assert.deepEqual([...new Set(units)], ['runs']);
  assert.match(quality, /`\$\{n\} runs: repeatability undefined/);
});

test('vocabulary: Studio, patch, calibration, link and storage names are unchanged', () => {
  assert.equal(STUDIO_KIND, 'oscilla-studio');
  assert.equal(STUDIO_FILE_EXTENSION, '.oscilla-studio.json');
  assert.equal(PATCH_KIND, 'oscilla-patch');
  assert.equal(PATCH_FILE_EXTENSION, '.oscilla-patch.json');
  assert.deepEqual([...STUDIO_RECORD_KINDS], ['oscilla-studio', 'oscilla-patch']);
  assert.equal(PROFILE_FORMAT, 'oscilla.calibration');
  assert.equal(RECIPE_HASH_KEY, 'mr');
  assert.deepEqual({ ...STUDIO_LINK_KEYS }, { mode: 'm', template: 'st', subview: 'sv' });
  assert.deepEqual({ ...STORAGE_KEYS }, {
    theme: 'oscilla.theme', presets: 'oscilla.presets', history: 'oscilla.history',
    safetySeen: 'oscilla.safetyNoticeCollapsed',
  });
});

// ------------------------------------------------------------------ phrases

function walk(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) return walk(p);
    return p.endsWith('.js') ? [p] : [];
  });
}

/** The user-facing sources: the page, the UI controllers, the record views and the evidence. */
const SOURCES = [
  'src/index.html',
  ...walk('src/js/ui'),
  ...walk('src/js/measurement/views'),
  'src/js/experiments/evidence.js',
];

/** A source without its comments (HTML, block and line comments outside a URL). */
function userText(path) {
  return read(path)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

/** "run" naming a stored record, and "project" naming the app. */
const REFUSED = [
  'Changed between runs', 'change between runs', 'this run', 'This run', 'the same run',
  'measured run', 'completed run', 'Two runs', 'every run', 'runs keep', 'next run',
  'Link a run', 'Choose a run', 'cite this run', 'about this run', 'The run is not stored',
  'the run is stored', 'the run was stored', 'the run is unchanged', 'same run is stored',
  'A run is executed', 'which version it ran', 'A run states', 'the version they ran',
  'About · Project', 'Project facts', 'Project evolution', 'how the project should work',
];

test('vocabulary: user text never calls a stored record a run, or the app a project', () => {
  const hits = [];
  for (const path of SOURCES) {
    const text = userText(path);
    for (const phrase of REFUSED) {
      if (text.includes(phrase)) hits.push(`${relative(ROOT, join(ROOT, path))}: "${phrase}"`);
    }
  }
  assert.deepEqual(hits, []);
});

test('vocabulary: a capture is still a run, and run is still the verb', () => {
  const html = userText('src/index.html');
  assert.ok(html.includes('>Runs CSV</button>'), 'the Experiments export "Runs CSV"');
  assert.ok(html.includes('<dt>Runs</dt>'), 'the Measure setup metric "Runs"');
  assert.ok(html.includes('>Run this definition</button>'), 'the verb "Run this definition"');
  assert.ok(html.includes('Changed between experiments'), 'the compare heading');
  assert.ok(html.includes('About · OSCILLA'), 'the About label');
  const flow = userText('src/js/measurement/views/measure-flow.js');
  assert.ok(flow.includes("gapS: 'Gap between runs'"), 'the Measure field between captures');
});

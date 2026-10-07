// The large-library fixture of tests/browser/perf-budgets.cjs (ledger P2 "no startup budget or
// large-library fixture"): what one browser's experiment database holds after long use, built
// only through the code the app itself runs, in Node.
//
//   LIBRARY = { experiments: 500, definitions: 50, studio: 20, recipes: 10, measurements: 20 }
//   buildLargeLibrary({ cacheDir, log }) -> Promise<Library>   (cached by a digest of its inputs)
//   Library = { digest, counts, sizes, irs: [base64 text], experiments: [{ json, ir, id, name,
//     definitionId, createdAt }], definitions: [Definition], studio: [{ value, summary }],
//     baselineId, compare: [idA, idB] }
//
// How every record is made (nothing is a hand-written shape):
//   - 10 MEASURE setup recipes (log sweeps of 1-3 s, 1-3 repeats, mean or median), each turned
//     into definitions by definition.js (setupRecipe, buildExecution, createDefinition; one in
//     five revised to a second version by reviseDefinition), 5 per recipe = 50, each passed
//     through validateDefinition as store.putDefinition does;
//   - 2 engine measurements per recipe (fixtures/v3-experiments.mjs measure(): the real
//     MeasurementEngine on its synthetic io, a different digital low-pass per recipe, the second
//     0.5 dB quieter) = 20 results;
//   - 500 experiments (the stored records of completed measurements): experimentFromResult
//     (the function MEASURE saves with) over those results, 10 per definition, bound to it by
//     definitionRef, each with its own id, time, name and notes (every 7th with later notes as
//     an annotation), one marked as the baseline by annotateExperiment; each then goes through
//     what store.put does: validateExperiment (result hash recomputed), serializeExperiment of
//     the validated record, summaryRecord;
//   - 20 Studio projects saved by studio/library.js saveProject into store.js's memory store:
//     two 100-node / 200-edge projects (tests/unit/fixtures/v31-large-studio.mjs) and 18 of the
//     six shipped templates, each retitled through the store's METADATA_SET action; the stored
//     record and its studioSummaryRecord row are what the IndexedDB store writes.
// Every experiment is a TEST CONTEXT record (synthetic io) and its name says so: nothing here
// presents itself as a measurement of a physical system.
//
// Experiments sharing one engine result carry the same result arrays, and so the same IR text.
// For the transfer into the page that text is sent once (`irs`) and each experiment's JSON
// names it (`ir`); the page puts it back before writing, so the stored record is the generated
// one byte for byte (and the app's own get() re-validates it, result hash included, whenever
// it is opened).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { measure, FIXTURE_RECIPE } from './v3-experiments.mjs';
import { buildLargeStudio } from '../../unit/fixtures/v31-large-studio.mjs';
import { experimentFromResult } from '../../../src/js/ui/measure-experiment.js';
import {
  annotateExperiment, experimentToJson, serializeExperiment,
} from '../../../src/js/experiments/schema.js';
import { validateExperiment } from '../../../src/js/experiments/validate.js';
import {
  buildExecution, createDefinition, definitionRef, reviseDefinition, setupRecipe,
  validateDefinition,
} from '../../../src/js/experiments/definition.js';
import {
  createMemoryStore, studioSummaryRecord, summaryRecord,
} from '../../../src/js/experiments/store.js';
import { KNOWN_ALGORITHM_IDS } from '../../../src/js/measurement/algorithms.js';
import { createStudioLibrary } from '../../../src/js/studio/library.js';
import { createIdGenerator, createStudioStore } from '../../../src/js/studio/actions.js';
import { STUDIO_TEMPLATES, templateModel } from '../../../src/js/studio/templates/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

export const LIBRARY = Object.freeze({ experiments: 500, definitions: 50, studio: 20, recipes: 10,
  measurements: 20 });
const PER_RECIPE_DEFS = LIBRARY.definitions / LIBRARY.recipes;
const EXPERIMENTS_PER_DEF = LIBRARY.experiments / LIBRARY.definitions;
const START_MS = Date.parse('2025-10-01T08:00:00.000Z');
const STEP_MS = 17 * 3600 * 1000 + 13 * 60 * 1000; // 500 experiments over about a year
const BUILD = Object.freeze({ version: '0.0.0-fixture', channel: 'test' });
const FORMAT = 2; // bump when the shape of the cached Library changes

// [f1, f2, duration s, repeats, aggregation, low-pass f0 of the synthetic system]
const RECIPES = [
  [20, 20000, 2, 3, 'mean', 6000], [20, 20000, 3, 1, 'mean', 9000],
  [50, 12000, 2, 3, 'mean', 4000], [100, 8000, 1, 3, 'median', 2500],
  [20, 16000, 2, 1, 'mean', 7000], [30, 18000, 1.5, 2, 'median', 5000],
  [20, 20000, 1, 3, 'mean', 11000], [200, 10000, 2, 1, 'mean', 3000],
  [40, 15000, 2.5, 3, 'median', 8000], [20, 20000, 2, 2, 'mean', 10000],
];
const CONDITIONS = [null, 'Microphone 1 m on axis, door closed.', 'Loopback cable, no microphone.',
  'Speaker on the desk, microphone at the listening position.', 'Ten minutes after power on.'];
const MIN_QUALITY = [null, 'USABLE', null, 'GOOD', 'USABLE'];
const ROOM_NOTES = ['Window closed.', 'Heating on.', 'After moving the speaker 5 cm left.',
  'Second microphone stand.', 'Fan off.', 'Evening, street quiet.', ''];

function setupOf([f1, f2, duration, repeats, aggregation]) {
  return { stimulus: { ...FIXTURE_RECIPE.stimulus, f1, f2, duration }, repeats,
    analysis: { ...FIXTURE_RECIPE.analysis, aggregation } };
}

/** SHA-256 over the inputs the library is built from: src/js, this file and its fixtures. */
function inputDigest() {
  const h = createHash('sha256');
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.js') || name.endsWith('.mjs')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src', 'js'));
  files.push(fileURLToPath(import.meta.url), path.join(HERE, 'v3-experiments.mjs'),
    path.join(ROOT, 'tests', 'unit', 'fixtures', 'v31-large-studio.mjs'));
  h.update(`format ${FORMAT}\n`);
  for (const f of files) h.update(`${path.relative(ROOT, f)}\n`).update(readFileSync(f));
  return h.digest('hex');
}

function buildDefinitions() {
  const defs = [];
  RECIPES.forEach((r, ri) => {
    for (let j = 0; j < PER_RECIPE_DEFS; j++) {
      const now = new Date(START_MS - (60 - ri * PER_RECIPE_DEFS - j) * 86400000).toISOString();
      let def = createDefinition({ id: `library-def-${ri}-${j}`, now,
        name: `Library definition ${ri * PER_RECIPE_DEFS + j + 1}: ${r[0]} Hz-${r[1] / 1000} kHz`,
        notes: j % 2 ? 'Authored for the large-library fixture.' : null,
        execution: buildExecution({ recipe: setupRecipe(setupOf(r)), conditions: CONDITIONS[j],
          minimumQuality: MIN_QUALITY[j] }) });
      if (j === PER_RECIPE_DEFS - 1) {
        def = reviseDefinition(def, buildExecution({ recipe: setupRecipe(setupOf(r)),
          conditions: `${CONDITIONS[j]} Revised.`, minimumQuality: MIN_QUALITY[j] }),
        { now: new Date(Date.parse(now) + 86400000).toISOString() }).definition;
      }
      const v = validateDefinition(def);
      if (!v.ok) throw new Error(`definition ${def.id}: ${JSON.stringify(v.errors[0])}`);
      defs.push(v.definition);
    }
  });
  return defs;
}

async function buildMeasurements(log) {
  const results = [];
  for (let ri = 0; ri < RECIPES.length; ri++) {
    const r = RECIPES[ri];
    const pair = [];
    for (let k = 0; k < LIBRARY.measurements / LIBRARY.recipes; k++) {
      pair.push(await measure({ f0: r[5], seed: 10 * ri + k + 1,
        gain: 0.25 * 10 ** ((-0.5 * k) / 20) }, setupOf(r)));
    }
    results.push(pair);
    log(`  measured recipe ${ri + 1}/${RECIPES.length}`);
  }
  return results;
}

/** The experiment as store.put would write it: { doc, summary } (validated, serialized). */
function stored(experiment) {
  const v = validateExperiment(experimentToJson(experiment), { knownAlgorithms:
    KNOWN_ALGORITHM_IDS });
  if (!v.ok) {
    throw new Error(`experiment ${experiment.experimentId}: ${JSON.stringify(v.errors[0])}`);
  }
  const doc = serializeExperiment(v.experiment);
  return { doc, summary: summaryRecord(doc, JSON.stringify(doc).length) };
}

async function buildExperiments(defs, results, log) {
  const experiments = [];
  const irs = [];
  const irIndex = new Map();
  const baselineAt = 37;
  for (let n = 0; n < LIBRARY.experiments; n++) {
    const di = n % LIBRARY.definitions;
    const ri = Math.floor(di / PER_RECIPE_DEFS);
    const def = defs[di];
    const result = results[ri][Math.floor(n / LIBRARY.definitions) % 2];
    const t = START_MS + n * STEP_MS;
    const now = new Date(t).toISOString();
    const notes = ROOM_NOTES[n % ROOM_NOTES.length];
    // The engine's wall clock at the start: the measurement took place just before the save.
    let e = experimentFromResult({ ...result, startedAtMs: t - 20000 }, {
      now, id: `library-experiment-${String(n + 1).padStart(3, '0')}`, build: BUILD,
      name: `TEST CONTEXT · library experiment ${n + 1} (${def.name.split(':')[0]})`, notes,
      laterNotes: n % 7 === 3 ? `${notes} Checked again the next day.`.trim() : null,
      definition: definitionRef(def),
    });
    if (!e.definition || e.definition.id !== def.id) {
      throw new Error(`experiment ${n + 1} is not bound to ${def.id}`);
    }
    if (n === baselineAt) e = annotateExperiment(e, { baseline: true });
    const { doc, summary } = stored(e);
    let ir = null;
    const samples = doc.results && doc.results.ir && doc.results.ir.samples;
    if (samples && typeof samples.data === 'string') {
      if (!irIndex.has(samples.data)) {
        irIndex.set(samples.data, irs.length);
        irs.push(samples.data);
      }
      ir = irIndex.get(samples.data);
      samples.data = null; // put back in the page before the write (irs[ir])
    }
    experiments.push({ id: doc.experimentId, name: doc.name, definitionId: def.id,
      createdAt: now, sizeBytes: summary.sizeBytes, ir, json: JSON.stringify({ doc, summary }) });
    if ((n + 1) % 100 === 0) log(`  built ${n + 1}/${LIBRARY.experiments} experiments`);
  }
  return { experiments, irs, baselineId: experiments[baselineAt].id };
}

async function buildStudio() {
  const mem = createMemoryStore({ knownAlgorithms: KNOWN_ALGORITHM_IDS });
  const lib = createStudioLibrary(mem);
  const out = [];
  for (let i = 0; i < LIBRARY.studio; i++) {
    let store;
    let base;
    if (i < 2) {
      store = createStudioStore(null, { idGenerator: createIdGenerator() });
      buildLargeStudio(store);
      base = '100 nodes';
    } else {
      const t = STUDIO_TEMPLATES[i % STUDIO_TEMPLATES.length];
      const model = templateModel(t.id);
      store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
      base = t.title;
    }
    const r = store.dispatch({ type: 'METADATA_SET',
      title: `Library project ${String(i + 1).padStart(2, '0')} · ${base}` });
    if (!r.ok) throw new Error(`Studio project ${i + 1}: ${r.reason}`);
    const id = `library-project-${String(i + 1).padStart(2, '0')}`;
    await lib.saveProject(store.getModel(), { id,
      now: new Date(START_MS + i * 9 * 86400000).toISOString() });
    const value = await mem.getStudio(id);
    out.push({ value, summary: studioSummaryRecord(value, JSON.stringify(value.doc).length) });
  }
  return out;
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Build (or read from `cacheDir`) the library. */
export async function buildLargeLibrary({ cacheDir = null, log = () => {} } = {}) {
  const digest = inputDigest();
  const file = cacheDir ? path.join(cacheDir, `oscilla-large-library-${digest.slice(0, 16)}.json`)
    : null;
  if (file && existsSync(file)) {
    log(`large library: cached ${path.basename(file)}`);
    return JSON.parse(readFileSync(file, 'utf8'));
  }
  const t0 = Date.now();
  log('large library: building (engine measurements, then experiments; cached afterwards)');
  const definitions = buildDefinitions();
  const results = await buildMeasurements(log);
  const { experiments, irs, baselineId } = await buildExperiments(definitions, results, log);
  const studio = await buildStudio();
  // Compare: two experiments of one definition from its two measurements (equivalent: A − B shown).
  const compare = [experiments[0].id, experiments[LIBRARY.definitions].id];
  const sizes = {
    experimentBytesTotal: sum(experiments.map((r) => r.sizeBytes)),
    experimentBytesMin: Math.min(...experiments.map((r) => r.sizeBytes)),
    experimentBytesMax: Math.max(...experiments.map((r) => r.sizeBytes)),
    definitionBytesTotal: sum(definitions.map((d) => JSON.stringify(d).length)),
    studioBytesTotal: sum(studio.map((s) => s.summary.sizeBytes)),
  };
  const lib = { format: FORMAT, digest, counts: { experiments: experiments.length,
    definitions: definitions.length, studio: studio.length, measurements: LIBRARY.measurements },
  sizes, irs, experiments, definitions, studio, baselineId, compare,
  buildMs: Date.now() - t0 };
  if (file) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, JSON.stringify(lib));
  }
  log(`large library: built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return lib;
}

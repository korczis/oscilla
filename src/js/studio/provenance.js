// Studio in experiment provenance (spec §109-§110, §162-§163; ADR 0019, ADR 0038; plan issue
// V425). Pure: plain data in, plain data out; no DOM, no Web Audio, no clock.
//
// Relationship (§110, no competing orchestration schema):
//   RECIPE (ADR 0019) stays the one authoritative description of WHAT the measurement does:
//     stimulus, repeats, analysis timing. Its configHash identifies "the same experiment
//     setup" and never includes Studio state, so a measurement run from Studio and the same
//     measurement run from the Measure workspace share a configHash.
//   STUDIO block (ADR 0038) is provenance BESIDE the recipe: experiment.studio =
//     { schemaVersion, studioHash, execution } — the Studio schema version, the execution state
//     that ran (schema.js executionState: nodes, parameters, edges, tracks, clips, automation,
//     loop, transport) and its SHA-256. Never view state, selection, positions, names or
//     markers (§163, §252, §255); never results; never a patch id alone (a patch can change
//     after the run). A Studio run DERIVES its recipe from the topology (recipeFromStudio), so
//     the two cannot disagree about the stimulus.
//
//   studioProvenance(model) -> { schemaVersion, studioHash, execution }
//   withStudioProvenance(experiment, model) -> a copy of the experiment with `studio` set
//   executionToModel(execution) -> normalized StudioModel (default names, positions at 0)
//   verifyExperimentStudio(experiment) -> { ok, present, model?, errors: [text] }
//     the Studio semantics experiments/validate.js does not check (node types, ports, cycles),
//     plus hash and canonical-form agreement; ok and present false when there is no block
//   recipeFromStudio(model, { sampleRate, repeats }) -> { ok: true, recipe, sweepId,
//     analyzerId } | { ok: false, reason }

import { canonicalJson } from '../experiments/canonical-json.js';
import { createRecipe } from '../experiments/schema.js';
import { DEFAULT_TIMING, TIMING_LIMITS } from '../measurement/engine.js';
import { normalizeStimulus } from '../measurement/stimulus.js';
import { SWEEP_FADE_S } from './adapters/nodes.js';
import { STUDIO_KIND, executionState, studioHash } from './schema.js';
import { validateStudioModel } from './validate.js';
import { importStudio } from './migrate.js';

/** The Studio provenance block of a model (throws TypeError for an invalid model). */
export function studioProvenance(model) {
  const report = validateStudioModel(model);
  if (!report.ok) {
    throw new TypeError(`studioProvenance: the Studio model is invalid: ${report.errors[0]
      .message}`);
  }
  return {
    schemaVersion: model.schemaVersion,
    studioHash: studioHash(model),
    execution: JSON.parse(canonicalJson(executionState(model))),
  };
}

/** A copy of `experiment` that records the Studio model it ran (ADR 0038). */
export function withStudioProvenance(experiment, model) {
  return { ...experiment, studio: studioProvenance(model) };
}

/** The normalized model an execution state describes (presentation and view at defaults). */
export function executionToModel(execution) {
  const doc = {
    kind: STUDIO_KIND,
    schemaVersion: execution.schemaVersion,
    graph: {
      nodes: execution.nodes.map((n) => ({ id: n.id, type: n.type, position: { x: 0, y: 0 },
        params: n.params })),
      edges: execution.edges,
    },
    timeline: {
      tracks: execution.timeline.tracks,
      clips: execution.timeline.clips,
      automation: execution.timeline.automation,
      loop: execution.timeline.loop,
    },
    transport: execution.transport,
  };
  const r = importStudio(doc);
  if (!r.ok) {
    const e = r.errors[0];
    throw new TypeError(`${e.path ? `${e.path}: ` : ''}${e.message}`);
  }
  return r.model;
}

/**
 * Check an experiment's Studio block beyond the experiment validator: the execution state is a
 * valid Studio graph and timeline of a supported schema, it is in canonical form, and its hash
 * is studioHash of that model. Never throws.
 */
export function verifyExperimentStudio(experiment) {
  const s = experiment && experiment.studio;
  if (!s) return { ok: false, present: false, errors: ['The experiment has no Studio block.'] };
  let model;
  try {
    model = executionToModel(s.execution);
  } catch (e) {
    return { ok: false, present: true, errors: [`studio.execution: ${e && e.message}`] };
  }
  const errors = [];
  if (model.schemaVersion !== s.schemaVersion) {
    errors.push('studio.schemaVersion differs from the migrated execution state');
  }
  if (canonicalJson(executionState(model)) !== canonicalJson(s.execution)) {
    errors.push('studio.execution is not in the normalized form of its own model');
  }
  if (studioHash(model) !== s.studioHash) errors.push('studio.studioHash does not match');
  return { ok: errors.length === 0, present: true, model, errors };
}

// ---------------------------------------------------------------- recipe from topology (§110)

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Duration of the first measurement clip with `action`, or null. */
function clipDuration(model, action) {
  const c = model.timeline.clips.find((x) => x.kind === 'measurement'
    && x.payload && x.payload.action === action);
  return c ? c.duration : null;
}

const within = (v, [lo, hi]) => isNum(v) && v >= lo && v <= hi;

/**
 * The measurement recipe a Studio measurement topology describes (§106, §110, ADR 0038):
 *   stimulus  the logarithmic Sweep wired to a Transfer Analyzer REFERENCE, exactly as the Sweep
 *             adapter renders it (measurement/stimulus.js normalizeStimulus of { log-sweep,
 *             f1 = start, f2 = end, duration, level, fade = min(SWEEP_FADE_S, duration / 4) }
 *             at `sampleRate`)
 *   analysis  timing from the measurement clips (pre-roll → preRollS, tail → postRollS,
 *             noise-check → noiseCheckS; engine DEFAULT_TIMING where a clip is absent or out of
 *             the engine's TIMING_LIMITS), phase from the Transfer Analyzer, aggregation 'mean'
 *   repeats   opts.repeats (1)
 * The result passes experiments/schema.js createRecipe; measurement/engine.js validateRecipe
 * accepts it (unit test). Never throws.
 */
export function recipeFromStudio(model, { sampleRate, repeats = 1 } = {}) {
  const no = (reason) => ({ ok: false, reason });
  if (!isNum(sampleRate)) return no('A sample rate is needed to derive the stimulus.');
  const byId = new Map(model.graph.nodes.map((n) => [n.id, n]));
  const analyzers = model.graph.nodes.filter((n) => n.type === 'transfer-analyzer');
  if (!analyzers.length) return no('The Studio has no Transfer Analyzer.');
  let analyzer = null;
  let sweep = null;
  for (const a of analyzers) {
    const ref = model.graph.edges.find((e) => e.to.node === a.id && e.to.port === 'reference');
    const src = ref ? byId.get(ref.from.node) : null;
    if (src && src.type === 'sweep' && ref.from.port === 'reference') {
      analyzer = a;
      sweep = src;
      break;
    }
  }
  if (!sweep) return no('No Sweep reference reaches a Transfer Analyzer.');
  const p = sweep.params;
  if (p.curve !== 'log') return no(`${sweep.metadata.name} is not logarithmic.`);
  let stimulus;
  try {
    stimulus = normalizeStimulus({ kind: 'log-sweep', sampleRate, duration: p.duration,
      level: p.level, f1: p.start, f2: p.end, fade: Math.min(SWEEP_FADE_S, p.duration / 4) })
      .spec;
  } catch (e) {
    return no(`${sweep.metadata.name}: ${e && e.message}`);
  }
  const pick = (action, key) => {
    const d = clipDuration(model, action);
    return within(d, TIMING_LIMITS[key]) ? d : DEFAULT_TIMING[key];
  };
  const analysis = {
    preRollS: pick('pre-roll', 'preRollS'),
    postRollS: pick('tail', 'postRollS'),
    gapS: DEFAULT_TIMING.gapS,
    noiseCheckS: pick('noise-check', 'noiseCheckS'),
    phase: analyzer.params.phase === true,
    aggregation: 'mean',
  };
  try {
    return { ok: true, recipe: createRecipe({ stimulus, repeats, analysis }), sweepId: sweep.id,
      analyzerId: analyzer.id };
  } catch (e) {
    return no(e && e.message);
  }
}

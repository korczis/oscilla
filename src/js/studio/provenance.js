// Studio in experiment provenance (spec §109-§110, §162-§163; ADR 0019, ADR 0038; plan issue
// V425). Pure: plain data in, plain data out; no DOM, no Web Audio, no clock.
//
// Relationship (§110, no competing orchestration schema):
//   RECIPE (ADR 0019) stays the one authoritative description of WHAT the measurement does:
//     stimulus, repeats, analysis timing. Its configHash identifies "the same experiment
//     setup" and never includes Studio state, so a measurement run from Studio and the same
//     measurement run from the Measure workspace share a configHash.
//   STUDIO block (ADR 0038) is provenance BESIDE the recipe: experiment.studio =
//     { schemaVersion, studioHash, execution, measured } — the Studio schema version, the
//     execution state of the graph the measurement was run from (schema.js executionState:
//     nodes, parameters, edges, tracks, clips, automation, loop, transport), its SHA-256, and the
//     measured path. Never view state, selection, positions, names or markers (§163, §252,
//     §255); never results; never a patch id alone (a patch can change after the run). A Studio
//     run DERIVES its recipe from the topology (recipeFromStudio), so the two cannot disagree
//     about the stimulus.
//   MEASURED PATH (ledger D3, ADR 0038 resolution 2026-10-06): studioHash covers the whole
//     graph, so an Oscillator nobody connected changed it. `measured` = { v, nodes, edges, clips,
//     hash } names what the measurement depended on — exactly what recipeFromStudio reads: the
//     Sweep wired to a Transfer Analyzer REFERENCE, the Sweep's audio route to the Master Output,
//     that analyzer, its observed chain (Calibration, Microphone, ... walked back through
//     OBSERVED inputs) and the measurement clips — with the SHA-256 of those records
//     (experiments/hash.js measuredPathHash). Nothing else in the graph sounds or is read during
//     the measurement: the Studio output is released before the engine plays its own sweep
//     (measurement-run.js). A model with no Sweep reference into a Transfer Analyzer has no
//     measured path and its block has no `measured`, like a block written before it existed
//     (experiment schema 3), which records the whole graph only.
//
//   studioProvenance(model) -> { schemaVersion, studioHash, execution, measured? }
//   measuredPath(model) -> { nodes, edges, clips } (ids, sorted by code unit) | null
//   withStudioProvenance(experiment, model) -> a copy of the experiment with `studio` set
//   executionToModel(execution) -> normalized StudioModel (default names, positions at 0)
//   verifyExperimentStudio(experiment) -> { ok, present, model?, errors: [text] }
//     the Studio semantics experiments/validate.js does not check (node types, ports, cycles),
//     plus hash and canonical-form agreement and, when the block has one, that `measured` names
//     the measured path of its own graph; ok and present false when there is no block
//   recipeFromStudio(model, { sampleRate, repeats, profileId }) -> { ok: true, recipe, sweepId,
//     analyzerId } | { ok: false, reason }

import { canonicalJson } from '../experiments/canonical-json.js';
import { MEASURED_PATH_VERSION, measuredPathHash } from '../experiments/hash.js';
import { createRecipe } from '../experiments/schema.js';
import { DEFAULT_TIMING, TIMING_LIMITS } from '../measurement/engine.js';
import { normalizeStimulus } from '../measurement/stimulus.js';
import { DEFAULT_POINTS_PER_OCTAVE } from '../measurement/transfer.js';
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
  const execution = JSON.parse(canonicalJson(executionState(model)));
  const out = { schemaVersion: model.schemaVersion, studioHash: studioHash(model), execution };
  const path = measuredPath(model);
  if (path) {
    out.measured = { v: MEASURED_PATH_VERSION, ...path,
      hash: measuredPathHash(execution, path) };
  }
  return out;
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
  if (s.measured) {
    const path = measuredPath(model);
    const same = !!path && ['nodes', 'edges', 'clips'].every((k) => canonicalJson(path[k])
      === canonicalJson(s.measured[k]));
    if (!same) {
      errors.push('studio.measured does not name the path the recipe is derived from in its own '
        + `graph (${path ? `that path has nodes ${path.nodes.join(', ')}` : 'that graph has no '
          + 'Sweep reference into a Transfer Analyzer'})`);
    }
  }
  return { ok: errors.length === 0, present: true, model, errors };
}

// ---------------------------------------------------------------- recipe from topology (§110)

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** The measurement clips with `action` (array order). */
function measurementClips(model, action) {
  return model.timeline.clips.filter((x) => x.kind === 'measurement'
    && x.payload && x.payload.action === action);
}

/** Two durations closer than this are the same (1 µs, timeline.js CONTIGUITY_TOLERANCE_S). */
const DURATION_TOLERANCE_S = 1e-6;

const within = (v, [lo, hi]) => isNum(v) && v >= lo && v <= hi;

const nameOf = (n) => (n.metadata && n.metadata.name) || n.id;
const byCode = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

/**
 * The measurement reference of a model: the first Transfer Analyzer (array order) whose
 * REFERENCE input comes from a Sweep's reference output, with that Sweep and edge; null when
 * there is none. { byId, analyzer, sweep, edge } | null; `analyzers` counts the analyzers.
 */
function measurementReference(model) {
  const byId = new Map(model.graph.nodes.map((n) => [n.id, n]));
  const analyzers = model.graph.nodes.filter((n) => n.type === 'transfer-analyzer');
  for (const a of analyzers) {
    const ref = model.graph.edges.find((e) => e.to.node === a.id && e.to.port === 'reference');
    const src = ref ? byId.get(ref.from.node) : null;
    if (src && src.type === 'sweep' && ref.from.port === 'reference') {
      return { byId, analyzer: a, sweep: src, edge: ref, analyzers: analyzers.length };
    }
  }
  return { byId, analyzer: null, sweep: null, edge: null, analyzers: analyzers.length };
}

/** The analyzer's observed chain, walked back through OBSERVED inputs: { nodes, edges }. */
function observedWalk(model, byId, analyzer) {
  const nodes = [];
  const edges = [];
  const seen = new Set();
  let at = analyzer;
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    const into = model.graph.edges.find((e) => e.to.node === at.id && e.to.port === 'observed');
    at = into ? byId.get(into.from.node) : null;
    if (into) edges.push(into);
    if (at) nodes.push(at);
  }
  return { nodes, edges };
}

/** The Sweep's audio output edges (its route out). */
const sweepRoute = (model, sweep) => model.graph.edges.filter((e) => e.from.node === sweep.id
  && e.from.port === 'audio');

/**
 * The measured path of a model (see the header): the ids, each list sorted by code unit, of the
 * nodes, edges and measurement clips recipeFromStudio reads; null without a Sweep reference
 * into a Transfer Analyzer. The path is reported whether or not recipeFromStudio would accept
 * the graph; a Studio run records it only after the recipe was derived.
 */
export function measuredPath(model) {
  const { byId, analyzer, sweep, edge } = measurementReference(model);
  if (!sweep) return null;
  const route = sweepRoute(model, sweep);
  const walk = observedWalk(model, byId, analyzer);
  const nodes = new Set([sweep.id, analyzer.id, ...walk.nodes.map((n) => n.id)]);
  for (const e of route) if (byId.has(e.to.node)) nodes.add(e.to.node);
  const edges = new Set([edge.id, ...route.map((e) => e.id), ...walk.edges.map((e) => e.id)]);
  const clips = model.timeline.clips.filter((c) => c.kind === 'measurement').map((c) => c.id);
  return { nodes: [...nodes].sort(byCode), edges: [...edges].sort(byCode),
    clips: [...new Set(clips)].sort(byCode) };
}

/**
 * Why the graph shows processing a MEASURE run does not do (null when it shows none): see
 * recipeFromStudio (V431 review A1).
 */
function unusedProcessing(model, byId, sweep, analyzer, applied) {
  const out = sweepRoute(model, sweep);
  if (!out.length) {
    return `${nameOf(sweep)} is not connected to the Master Output; the measurement plays the `
      + 'sweep through the output, so the graph must show that route.';
  }
  for (const e of out) {
    const to = byId.get(e.to.node);
    if (!to || to.type !== 'master') {
      return `${nameOf(sweep)} feeds ${to ? nameOf(to) : e.to.node} on its way out; the `
        + 'measurement plays its own sweep straight to the output, so that processing would be '
        + 'recorded and never measured. Connect the Sweep directly to the Master Output.';
    }
  }
  const cals = observedWalk(model, byId, analyzer).nodes.filter((n) => n.type === 'calibration');
  for (const c of cals) {
    const id = c.params.profileId || null;
    if (id !== applied) {
      return `${nameOf(c)} names ${id ? `profile ${id}` : 'no profile'}, but MEASURE applies `
        + `${applied ? `profile ${applied}` : 'none'}; the run uses MEASURE's calibration. `
        + 'Make them agree (the Calibration node, or frequency correction in MEASURE).';
    }
    if (id && c.params.extrapolate !== 'none') {
      return `${nameOf(c)} holds the profile's edges; MEASURE never extrapolates a profile.`;
    }
  }
  if (applied && !cals.length) {
    return `MEASURE applies frequency profile ${applied}, and the graph shows no Calibration `
      + 'node with it. Add one on the observed path, or turn frequency correction off.';
  }
  const ppo = analyzer.params.pointsPerOctave;
  if (isNum(ppo) && ppo !== DEFAULT_POINTS_PER_OCTAVE) {
    return `${nameOf(analyzer)} asks for ${ppo} points per octave; the measurement computes `
      + `${DEFAULT_POINTS_PER_OCTAVE}.`;
  }
  return null;
}

/**
 * The measurement recipe a Studio measurement topology describes (§106, §110, ADR 0038):
 *   stimulus  the logarithmic Sweep wired to a Transfer Analyzer REFERENCE, exactly as the Sweep
 *             adapter renders it (measurement/stimulus.js normalizeStimulus of { log-sweep,
 *             f1 = start, f2 = end, duration, level, fade = min(SWEEP_FADE_S, duration / 4) }
 *             at `sampleRate`)
 *   analysis  timing from the measurement clips (pre-roll → preRollS, tail → postRollS,
 *             noise-check → noiseCheckS; engine DEFAULT_TIMING only where a clip is absent),
 *             phase from the Transfer Analyzer, aggregation 'mean'
 *   repeats   opts.repeats (1)
 * The recipe must be what the timeline shows (V431 review A3/A7, X5), so it is REFUSED with a
 * reason — never silently substituted — when a timing clip is outside the engine's
 * TIMING_LIMITS, when more than one clip has the same timing or stimulus action (the pass would
 * be ambiguous: `studioHash` sorts records by id, array order is not part of the setup), or when
 * a stimulus clip is shorter than the Sweep it plays (the engine always plays the whole sweep).
 * It is also REFUSED when the graph shows processing the run does not do (V431 review A1), since
 * the experiment records the whole Studio graph beside the recipe:
 *   - the Sweep's audio output reaches anything but the Master Output directly, or nothing:
 *     the engine plays its own stimulus straight into the output, so a filter in between would
 *     be listed and never measured
 *   - a Calibration node on the observed path names a profile other than `profileId`, the one
 *     MEASURE applies (null or absent: none), or MEASURE applies one the graph does not show,
 *     or it holds the profile's edges (MEASURE never extrapolates)
 *   - the Transfer Analyzer's points per octave differ from the engine's
 *     (DEFAULT_POINTS_PER_OCTAVE): the run computes the engine's grid
 * The result passes experiments/schema.js createRecipe; measurement/engine.js validateRecipe
 * accepts it (unit test). Never throws.
 */
export function recipeFromStudio(model, { sampleRate, repeats = 1, profileId = null } = {}) {
  const no = (reason) => ({ ok: false, reason });
  if (!isNum(sampleRate)) return no('A sample rate is needed to derive the stimulus.');
  const { byId, analyzer, sweep, analyzers } = measurementReference(model);
  if (!analyzers) return no('The Studio has no Transfer Analyzer.');
  if (!sweep) return no('No Sweep reference reaches a Transfer Analyzer.');
  const p = sweep.params;
  if (p.curve !== 'log') return no(`${sweep.metadata.name} is not logarithmic.`);
  const unused = unusedProcessing(model, byId, sweep, analyzer, profileId || null);
  if (unused) return no(unused);
  let stimulus;
  try {
    stimulus = normalizeStimulus({ kind: 'log-sweep', sampleRate, duration: p.duration,
      level: p.level, f1: p.start, f2: p.end, fade: Math.min(SWEEP_FADE_S, p.duration / 4) })
      .spec;
  } catch (e) {
    return no(`${sweep.metadata.name}: ${e && e.message}`);
  }
  for (const action of ['noise-check', 'pre-roll', 'stimulus', 'tail']) {
    if (measurementClips(model, action).length > 1) {
      return no(`More than one ${action} clip: one pass of the timeline is one measurement.`);
    }
  }
  const [stim] = measurementClips(model, 'stimulus');
  if (stim && stim.duration < p.duration - DURATION_TOLERANCE_S) {
    return no(`The stimulus clip (${stim.duration} s) is shorter than ${sweep.metadata.name} `
      + `(${p.duration} s); the measurement plays the whole sweep.`);
  }
  const timing = {};
  for (const [action, key] of [['pre-roll', 'preRollS'], ['tail', 'postRollS'],
    ['noise-check', 'noiseCheckS']]) {
    const [c] = measurementClips(model, action);
    if (!c) {
      timing[key] = DEFAULT_TIMING[key];
    } else if (within(c.duration, TIMING_LIMITS[key])) {
      timing[key] = c.duration;
    } else {
      const [lo, hi] = TIMING_LIMITS[key];
      return no(`The ${action} clip lasts ${c.duration} s; the measurement engine accepts `
        + `${lo}-${hi} s.`);
    }
  }
  const analysis = {
    preRollS: timing.preRollS,
    postRollS: timing.postRollS,
    gapS: DEFAULT_TIMING.gapS,
    noiseCheckS: timing.noiseCheckS,
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

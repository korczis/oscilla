// Studio node adapters (spec §41-§42, §170-§171, §186-§190, §240): one adapter per registry node
// type, each naming the registry `compiler` key it implements and building the node ONLY from
// the existing V1/V2/V3 builders (AudioEngine helpers, createFilterStage, createStereoRouter,
// createNoiseSource, applyAdsr/releaseAt, renderStimulus, openMicrophone,
// createAnalyserReader, createRtaAverager). Studio is orchestration: no DSP is re-implemented
// here. Every node is created through `acct.track` / `acct.source` (engine accounting).
//
// adapter = { compiler, structural: [paramKey], rebuildWhenOwned?: [paramKey],
//             clock?: portId,   a TRIGGER input that clocks the node (plan node `clocked`)
//             check?(params, caps) -> reason | { code, reason } | null, create(env) -> handle }
// env     = { ctx, hooks, acct: { track, source }, now, at, params, node, def, options,
//             global: { setMasterLevel(g) -> wrote },  the runtime's gate to global engine state
//             settled(handle),                         a pending handle has settled (async)
//             gated }                                  another owner gates this envelope: it
//                                                      is built closed (runtime setOwnedParams)
// handle  = { inputs: { portId: AudioNode }, outputs: { portId: AudioNode },
//             outputRange: { portId: [lo, hi] }        control signal range (default [-1, 1]),
//             modTarget(key, mapping) -> { param: AudioParam, scale } | { reason },
//             applyBase(base, immediate, owned, w)  base = { key: { value, cents } } for
//                                         modulatable keys (value in the parameter's unit incl.
//                                         edge offsets, cents from log-mapped edges); every
//                                         AudioParam it writes is reported as w[key] = the
//                                         value written (a log edge's cents as w.detune),
//             update(changed, owned, w)   live change of non-modulatable, non-structural keys;
//                                         each key it acts on is reported as w[key] = how:
//                                         'set' | 'glide' (from now) | 'crossfade' |
//                                         'next-gate'; a key it does not act on is not reported
//             (`w` is the operation trace's record, ADR 0042: optional, plain object)
//             engage?()                   global side effects (the engine's master level), called
//                                         by the runtime only once the transaction committed;
//                                         `create` never writes global state (runtime.js "Global
//                                         side effects"), so a refused transaction leaves none
//             stop(at)                    sources stop at `at` (the route fades end before it),
//             dispose()                   the builder's own dispose (the runtime then
//                                         disconnects and untracks every tracked node),
//             info, status: 'ready' | 'degraded' | 'offline-only' | 'data' | 'pending',
//             code?, reason }   code: machine reason (mic-pending, mic-error, mic-ended)
// `structural` keys cannot change on a running node (OscillatorNode.type, a filter type that
// would swap the biquad the modulation is wired to, a sweep's whole schedule, ...): the
// runtime builds a replacement node and crossfades to it (spec §45).
//
// Owned parameters (docs/v31/compiler.md "Owned parameters"). `owned` is a Set of parameter
// keys another owner drives (the transport: automation lanes, a pattern-played oscillator's
// level), given by the runtime to applyBase and update; it holds only keys whose
// modTarget(key, 'linear') is an AudioParam. An adapter never writes that AudioParam for an
// owned key and writes every other parameter as usual. Without `owned` (or an empty Set) the
// adapter writes everything, as before. The first applyBase of a node (immediate, the node is
// still silent) is called with no owned keys: it gives every parameter its initial value. A
// builder whose live update rewrites every parameter and cannot skip one (createFilterStage
// .update for the bypass) names that key in `rebuildWhenOwned`: on a node with an owned
// parameter, diffPlans turns a change of it into a node-replace (crossfaded; the owner continues
// on the new node).
//
// Degraded nodes (§171) are explicit handles with a reason, never exceptions: Microphone
// without getUserMedia (file:// in some browsers) or before permission, Recorder (offline
// only), a missing ConstantSourceNode / StereoPannerNode feature.
//
// The adapters live by category beside this file (sources.js, modulation.js, processing.js,
// output.js, analysis.js, measurement.js, as the definitions in ../nodes/); common.js holds the
// helpers they share. This module is the table the compiler and the runtime read.

import * as sources from './sources.js';
import * as modulation from './modulation.js';
import * as processing from './processing.js';
import * as output from './output.js';
import * as analysis from './analysis.js';
import * as measurement from './measurement.js';
import * as instrument from './instrument.js';
import * as engines from './engines.js';

export { PARAM_TAU_S, inertHandle } from './common.js';
export { MIC_ENDED_TEXT, MIC_OFF_TEXT, SWEEP_FADE_S } from './sources.js';
export { CONTROL_STEP_SAMPLES, RANDOM_LOOP_VALUES } from './modulation.js';

const { dataNode } = measurement;

/** Adapter per registry node type; `compiler` must equal the registry definition's key. */
export const NODE_ADAPTERS = Object.freeze({
  oscillator: sources.oscillator, noise: sources.noise, sweep: sources.sweep,
  sequence: sources.sequence, microphone: sources.microphone,
  lfo: modulation.lfo, envelope: modulation.envelope, random: modulation.random,
  'step-modulator': modulation.stepModulator, macro: modulation.macro,
  gain: processing.gain, filter: processing.filter, pan: processing.pan,
  'stereo-split': processing.stereoSplit, mixer: processing.mixer, drive: processing.drive,
  scope: analysis.scope, spectrum: analysis.spectrum, spectrogram: analysis.spectrogram,
  meter: analysis.meter, rta: analysis.rta,
  master: output.master, recorder: output.recorder,
  capture: measurement.capture,
  calibration: dataNode('calibration/interpolate.js#applyFrequencyCorrection'),
  'transfer-analyzer': dataNode('measurement/transfer.js#computeTransfer'),
  'measurement-result': dataNode('experiments/schema.js#withResults'),
  keys: instrument.keys, vco: instrument.vco, ring: instrument.ring, 'xy-pad': instrument.xyPad,
  'additive-voice': engines.additiveVoice, 'fm-voice': engines.fmVoice,
  'am-voice': engines.amVoice, 'wavetable-voice': engines.wavetableVoice,
  'perc-voice': engines.percVoice,
});

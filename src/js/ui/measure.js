// MEASURE workspace: the DOM/Alpine adapter over the V3 measurement layer (spec §29-§36,
// §72-§78, §106-§112, §115-§118, §150-§158; docs/v3/ui-integration.md). Composed into the ONE
// OSCILLA component by main.js (Object.defineProperties, never spread).
//
// This layer renders view models; it computes no level, mask, range or label. Engine events go
// through the pure reducers of src/js/measurement/views (quality-bar, announcements) and the
// result through the pure view builders (measure-flow, response-chart, ir-chart, rta-chart);
// the charts (src/js/charts/measure-charts.js) draw those descriptors with the existing uPlot
// conventions. The measurement engine, its io, the result with its typed arrays, the
// calibration objects and the chart instances live in the closure `ctx`, never in Alpine's
// reactive state (rule project.audio-engine-discipline: Alpine never wraps engine objects).
//
// Output exclusivity (spec §74): while a measurement is in progress the instrument cannot play
// (main.js refuses engine.play and notifies), and starting a measurement stops the instrument,
// the sequencer and every voice. Escape and STOP abort through engine.abort (§111); page hide
// aborts through the capture io's own pagehide/visibility handling and main.js (§169); leaving
// the MEASURE workspace aborts a measurement in progress.
//
// Live RTA (spec §44-§49, §122-§123, §150; docs/v3/ui-integration.md "Live RTA"): the RTA tab
// starts a live analysis of the input on request. It opens the input through the capture io's
// own permission path (capture.js openLiveTap: one AnalyserNode on the measurement input),
// reads the analyser's time-domain samples with the V2 reader (analysis/analyser.js) on the
// shared frame loop, and computes the spectrum with measurement/live-rta.js (the spectrum.js
// mean-square scale of every band level). Per frame it only pushes samples and repaints the
// chart (no allocation, no Alpine write); the view model (summary, badges, readout text) is
// rebuilt LIVE_VIEW_INTERVAL_MS apart. Leaving the RTA tab or the workspace, Escape, page hide
// and starting a setup check or measurement stop it and release the tracks and nodes; it
// cannot start while a measurement is in progress (exclusive input). Live RTA is feedback:
// nothing of it is stored.
//
// TEST CONTEXT (§146, §249): `?measure=loopback`, the last choice of the Input device list
// (ledger W7b) or OSCILLA.measure.useLoopback() replaces the microphone with capture.js
// createLoopbackIo, a known synthetic digital system. The workspace then says so in a banner
// and in every saved experiment; it is never presented as a measurement of a physical system.
// Choosing an input leaves it; either way the transition clears the result and the input
// check of the side that is left and keeps a level calibration, void there (setTestContext).
//
// Level calibration (M3 of the V3 review): the dialog measures the reference itself — "Capture
// reference" records REFERENCE_CAPTURE_S seconds through the SAME capture io as a measurement
// (io.captureNoise, stimulus-free) and reads the one-third-octave band level at the reference
// frequency on the MEASURE mean-square scale (calibration/reference.js), names that scale, and
// stores the capture's input (hashed deviceId, sample rate, applied processing) with the
// LevelCalibration. The capture is abortable (Stop, Cancel, Escape, leaving the workspace) and
// releases the input afterwards. Typing the reading is an advanced option labelled with the
// same scale. A calibration whose input differs from the current one (latest preflight, result
// or reference capture) is not applied: the indicator reads UNCALIBRATED and says why.
//
// Frequency profiles (M4): the import states the sign convention and a one-point preview; when
// the file's header does not state it (correction / gain / EQ / cal), a dialog requires the
// explicit choice before the profile is loaded (calibration/parse.js).
//
// View options never fail a measurement (M6): a normalization whose reference lies outside the
// result's grid is disabled for that result (the selection resets to None), and a view that
// still cannot be built is reported as a note, never as "Measurement failed".
//
// Evidence as measured (ADR 0040, resolution 2026-10-05): when a measurement returns, MEASURE
// keeps a frozen companion of its result (measure-experiment.js measuredEvidence): the
// calibration the engine applied (result.calibrated) and the notes as they were when the
// measurement started. Save builds the experiment from that companion only. Loading another
// profile, switching a correction off or creating a level calibration after the run changes the
// next measurement, not this one; the Experiment panel then says that the saved record keeps
// the calibration it was measured with, and notes edited later are saved as an annotation.
//
// Profile export (V315): the loaded frequency profile exports as CSV or JSON
// (calibration/export.js); both files are deterministic and parse back to the same profile id.
//
// Input device (V322, spec §29 step 1): after the microphone permission (setup check, live RTA,
// reference capture) the inputs are listed with enumerateDevices (views/input-devices.js) and
// refreshed on 'devicechange'. The default input stays the default (no deviceId). A chosen
// input is passed to createCaptureIo as deviceId (getUserMedia deviceId { exact }); the io is
// re-created for it at the next capture, and the experiment records it hashed
// (constraints.requested.deviceId). A chosen input that disappears stays selected, marked
// "not available", with a readable message and an assertive announcement; nothing switches
// microphones silently.
//
// Recipe link (V355, spec §102): "Copy recipe link" writes the setup's recipe into the URL hash
// (`mr`, core/url-state-measure.js; recipe only, never results, calibration or device) next to
// the instrument's own hash state, with `m=measure`. A link read at load or as a new hash is
// handed here by the one hash dispatcher (ui/navigation.js, which also chooses the workspace,
// ADR 0045); it is validated like every import and refused whole when anything is wrong; a
// valid one fills the setup, and never starts a check or a measurement.
//
// Unsaved work (ADR 0045): measureWhatWouldBeLost() reports a completed measurement that is
// not saved and a level calibration (page memory only; a reload discards it) to the
// unsaved-work guard (ui/unsaved.js); the Experiment panel shows "unsaved result".
//
// Definitions (ADR 0043): measureLoadDefinition fills the setup from a definition version's
// recipe and keeps that version's run reference. A measurement records it only when the setup
// it starts with is exactly that recipe (definition.js setupRecipe, compared canonically) and
// the recipe that ran is what the version asks for (measure-experiment.js); otherwise the run
// carries the definition derived from its own recipe, and the panel and a notification say so.
// The reference is taken when the measurement starts: a later edit of the setup never moves
// the run to another definition. A Studio run (measureRunRecipe) never takes it. A derived
// reference (a saved run's own recipe) is not kept loaded: only its recipe fills the setup.
//
// Saving is idempotent per result: one save record per result (ctx.save { result, id, now,
// stored, experiment }) chooses the experiment id and timestamp once, so a retry writes the same
// record and never a second copy of one run. When a write reports an error, the store is read
// back: a record that is there with the result hash written (a lost acknowledgement) is the
// saved run, and the save goes on as "Update name and notes"; a Studio save's decoration is
// kept in the save record, so a retry from MEASURE writes the same facts. Once stored, a run is never put again: its name and annotation
// notes change through annotate (only what differs), and a record deleted since is stored again
// as saved (same id, timestamp and repeat link). The notes, the repeat link, the definition
// reference and the requested range are evidence taken when the measurement starts.
//
// Modules (E002): this file composes the workspace from its parts under src/js/ui/measure/, and
// stays the module its importers import. constants.js holds the shared constants and pure
// helpers; session.js the closure state `ctx`, the input binding of a level calibration, the
// engine, the initial state, the derived getters and the lifecycle; input.js the input device
// list and the TEST CONTEXT transition; views.js the view refresh and the result presentation;
// live.js the live RTA; run.js the setup check, a measurement, the flow actions and the recipe
// link; saving.js the experiment saving and the unsaved-work report; calibration.js the level
// reference capture, the level calibration and the frequency profile; test-seam.js
// window.OSCILLA.measure. Every part shares one `ctx` and reaches the functions of the others
// through `ops`, filled here before any part is built.

import {
  createMeasureContext, createSession, measureStatePart, measureDerivedPart,
  measureLifecyclePart,
} from './measure/session.js';
import { createInput } from './measure/input.js';
import { createViews, measureViewPart } from './measure/views.js';
import { createLive } from './measure/live.js';
import { createRun, measureFlowPart, measureRecipeLinkPart } from './measure/run.js';
import { createSaving, measureUnsavedPart, measureExperimentPart } from './measure/saving.js';
import {
  createCalibration, measureCalibrationPart, measureProfilePart,
} from './measure/calibration.js';
import { measureTestSeamPart } from './measure/test-seam.js';

export {
  MEASURE_RESULT_TABS, IR_SPANS, RTA_MODE_CHOICES, RTA_AVERAGING_CHOICES, LIVE_VIEW_INTERVAL_MS,
  RESPONSE_QUANTITIES, IR_WINDOW_MS, NORMALIZATIONS, LIVE_RTA_FIELDS, LEVEL_PENDING_TEXT,
  LEVEL_NEEDS_INPUT, LEVEL_FROM_TEST_CONTEXT, LEVEL_FROM_MICROPHONE, MANUAL_TEST_CONTEXT_LABEL,
} from './measure/constants.js';

/** The closure functions of every part, in one table (`ops`). */
const FUNCTIONS = [createSession, createInput, createViews, createLive, createRun, createSaving,
  createCalibration];

/** The members of the component, part by part, in the order the component lists them. */
const PARTS = [measureStatePart, measureDerivedPart, measureLifecyclePart, measureFlowPart,
  measureRecipeLinkPart, measureViewPart, measureCalibrationPart, measureUnsavedPart,
  measureProfilePart, measureExperimentPart, measureTestSeamPart];

/**
 * createMeasureUi(svc) → the MEASURE part of the component.
 * svc: { engine (AudioEngine), stopPlayback(cmp) (instrument, sequencer, voices),
 *        loopback: boolean (TEST CONTEXT at load, from the URL) }
 */
export function createMeasureUi(svc) {
  const ctx = createMeasureContext(svc);
  const ops = {};
  for (const create of FUNCTIONS) Object.assign(ops, create(ctx, svc, ops));
  // Getters stay getters: the parts are merged as property descriptors, never spread.
  const out = {};
  for (const part of PARTS) {
    Object.defineProperties(out, Object.getOwnPropertyDescriptors(part(ctx, svc, ops)));
  }
  return out;
}

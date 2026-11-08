// aria-live measurement announcements (spec §150-§151). Pure reducer over engine events.
//
//   initialAnnouncements() -> state
//   reduceAnnouncements(state, event) -> { state, message: null | { stage, text, politeness } }
//   announce(events) -> [message]            convenience: fold a whole event list
//
// One message per STAGE of a measurement, never per progress tick, chunk or repeat (§151:
// "no progress chatter"):
//   started    "Measurement started"          first NOISE_CHECK or ARMED of a measurement
//   noise      "Noise-floor check complete"   the engine's 'noise' event
//   sweep      "Sweep running"                first MEASURING (repeats do not re-announce)
//   terminal   exactly one of
//              "Measurement complete"                     COMPLETE
//              "Measurement invalid due to clipping"      INVALID with a clipping reason
//              "Measurement invalid: <reason>"            INVALID otherwise
//              "Measurement stopped"                      ABORTED
//              "Measurement error: <message>"             ERROR (assertive)
//   setup      "Setup check complete: ready" | "Setup check failed: <reason>"
//              for a preflight() that ends READY or INVALID before anything was measured;
//              the reason of a refused input or audio context is the blocker's own sentence
//              when it says more than the generic one (C033: "no input signal" was announced
//              for a microphone the browser would not open, a closed context was "Web Audio
//              is not available")
//   waiting    "Kontrola nastavení: povolte mikrofon, pokud se prohlížeč zeptá" while it asks (the
//              engine's 'waiting' event); once per check
// A new PREFLIGHT after a terminal state (or a reset to IDLE) starts a new measurement and
// re-arms every stage. Engine events are { type: 'state', from, to, info } and the typed
// events listed in engine.js; unknown events produce no message.

import { MEASUREMENT_STATES as S } from '../state-machine.js';
import { MEASUREMENT_ERRORS } from '../engine.js';

export const ANNOUNCEMENTS = Object.freeze({
  started: 'Measurement started',
  noise: 'Noise-floor check complete',
  sweep: 'Sweep running',
  complete: 'Measurement complete',
  clipping: 'Measurement invalid due to clipping',
  invalid: 'Measurement invalid',
  stopped: 'Measurement stopped',
  error: 'Measurement error',
  ready: 'Setup check complete: ready',
  setupFailed: 'Setup check failed',
  permission: 'Kontrola nastavení: povolte mikrofon, pokud se prohlížeč zeptá',
});

/**
 * Refusals whose blocker sentence names the true reason when it is not the generic one: the
 * input that could not be opened (no microphone API, the audio session, a device the browser
 * would not open) and the audio context (closed, unavailable).
 */
const OWN_SENTENCE_CODES = new Set(['NO_INPUT', 'UNSUPPORTED', 'UNSUPPORTED_WORKLET']);

const CLIP_CODES = new Set(['CLIPPING', 'CLIPPING_SEVERE', 'NOISE_CLIPPING', 'INPUT_CLIPPING']);

const REASON_WORDS = Object.freeze({
  NO_INPUT: 'no input signal',
  EMPTY: 'no input signal',
  DROPOUT: 'dropout in the capture',
  DISCONTINUITY: 'discontinuity in the capture',
  FRAMES_MISSING: 'frames missing from the capture',
  NO_ALIGNMENT: 'the stimulus was not found in the capture',
  STIMULUS_OUTSIDE_CAPTURE: 'the stimulus is not fully inside the capture',
  INVALID_CALIBRATION: 'invalid calibration data',
  INVALID_RECIPE: 'invalid measurement settings',
  MEMORY_LIMIT: 'the captures exceed the memory limit',
  MIC_DENIED: 'microphone permission denied',
  CONTEXT_SUSPENDED: 'audio is suspended',
  UNSUPPORTED: 'Web Audio is not available',
  UNSUPPORTED_WORKLET: 'audio capture is not supported',
  OUTPUT_SILENT: 'the output level is zero',
});

export function initialAnnouncements() {
  return Object.freeze({ said: Object.freeze({}), measuring: false, blockers: null });
}

function words(codes, blockers) {
  const c = codes.find((x) => REASON_WORDS[x]) || codes[0];
  if (!c) return null;
  const b = Array.isArray(blockers) ? blockers.find((x) => x && x.code === c) : null;
  const own = b && typeof b.text === 'string' && b.text ? b.text.replace(/\.$/, '') : null;
  if (own && OWN_SENTENCE_CODES.has(c) && b.text !== MEASUREMENT_ERRORS[c]) return own;
  if (REASON_WORDS[c]) return REASON_WORDS[c];
  return own || c;
}

const msg = (stage, text, politeness = 'polite') => Object.freeze({ stage, text, politeness });

/** reduceAnnouncements(state, event) → { state, message } (see the header). */
export function reduceAnnouncements(state, event) {
  const none = { state, message: null };
  if (!event || typeof event !== 'object') return none;
  const said = state.said;
  const once = (stage, text, politeness, extra = {}) => {
    if (said[stage]) return none;
    return { state: Object.freeze({ ...state, ...extra, said: Object.freeze({ ...said,
      [stage]: true }) }), message: msg(stage, text, politeness) };
  };
  if (event.type === 'preflight') {
    return { state: Object.freeze({ ...state, blockers: event.blockers || null }), message: null };
  }
  if (event.type === 'noise') {
    return once('noise', ANNOUNCEMENTS.noise, 'polite', { measuring: true });
  }
  if (event.type === 'waiting' && event.what === 'permission') {
    return once('waiting', ANNOUNCEMENTS.permission, 'polite');
  }
  if (event.type !== 'state') return none;
  const to = event.to;
  const info = event.info || {};
  // A new measurement: from IDLE or from a terminal state.
  if (to === S.IDLE) return { state: initialAnnouncements(), message: null };
  if (to === S.PREFLIGHT && (said.terminal || said.setup || event.from === S.IDLE)) {
    return { state: Object.freeze({ said: Object.freeze({}), measuring: false, blockers: null }),
      message: null };
  }
  if (to === S.NOISE_CHECK || to === S.ARMED) {
    return once('started', ANNOUNCEMENTS.started, 'polite', { measuring: true });
  }
  if (to === S.MEASURING) return once('sweep', ANNOUNCEMENTS.sweep, 'polite', { measuring: true });
  if (to === S.READY && !state.measuring && event.from === S.PREFLIGHT) {
    return once('setup', ANNOUNCEMENTS.ready);
  }
  if (to === S.COMPLETE) return once('terminal', ANNOUNCEMENTS.complete);
  if (to === S.ABORTED) return once('terminal', ANNOUNCEMENTS.stopped);
  if (to === S.ERROR) {
    const m = info.message ? `${ANNOUNCEMENTS.error}: ${String(info.message).replace(/\.$/, '')}`
      : ANNOUNCEMENTS.error;
    return once('terminal', m, 'assertive');
  }
  if (to === S.INVALID) {
    const codes = Array.isArray(info.reasons) ? info.reasons.map((r) => (typeof r === 'string'
      ? r : r && r.code)).filter(Boolean) : [];
    if (!state.measuring && event.from === S.PREFLIGHT) {
      const w = words(codes, state.blockers);
      return once('terminal', w ? `${ANNOUNCEMENTS.setupFailed}: ${w}`
        : ANNOUNCEMENTS.setupFailed, 'assertive');
    }
    if (codes.some((c) => CLIP_CODES.has(c))) {
      return once('terminal', ANNOUNCEMENTS.clipping, 'assertive');
    }
    if (info.quality === 'INVALID') {
      return once('terminal', `${ANNOUNCEMENTS.invalid}: the quality assessment rejected the `
        + 'data', 'assertive');
    }
    const w = words(codes, state.blockers);
    return once('terminal', w ? `${ANNOUNCEMENTS.invalid}: ${w}` : ANNOUNCEMENTS.invalid,
      'assertive');
  }
  return none;
}

/** Fold a list of engine events; returns the messages in order. */
export function announce(events, state = initialAnnouncements()) {
  const out = [];
  let st = state;
  for (const e of events) {
    const r = reduceAnnouncements(st, e);
    st = r.state;
    if (r.message) out.push(r.message);
  }
  return out;
}

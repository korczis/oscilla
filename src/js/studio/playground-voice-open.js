// Open the Playground voice in the Studio (plan V605; intent studio-completion,
// voice-opens-in-studio). Pure: the Playground values playground-voice.js reads in, an editable
// Studio document or a refusal with its reason out; no DOM, no Web Audio, no clock.
//
//   playgroundVoiceDocument(input) -> { ok: true, model, configuration }
//                                   | { ok: false, code, reason }
//     input: playgroundVoiceModel's (the Signal Path's own input, playground-voice.js), with
//     limitS and continuous (below).
//   voiceInputFrom(cmp, labInputs) -> that input, from the Playground component (main.js).
//
// The graph is the one the Signal Path draws (playgroundVoiceModel), node for node, with one
// addition: a mono dual voice without the stereo router gets the two centred Pan nodes the engine
// builds there (modulation.js buildDual: a StereoPanner at 0 per side, −3 dB per channel), which
// the drawn graph leaves out (its Signal Path stage reads "A + B summed"). What the graph alone
// does not say, the timeline says, so the document sounds what the Playground voice sounds when
// the Studio plays it:
//   an open plan (a held tone, AM, a dual voice)   one gate event clip on the Envelope from 0 to
//       the Playground's safety limit (input.limitS) minus the release: the Playground holds an
//       open voice at most that long without the continuous permission (audio-engine.js play,
//       "Open patterns": len = limitS, voice.js v1OpenEnvelope releases inside it), so the
//       Studio plays the voice a held PLAY plays, for as long and with the same release
//   a finite plan (a finite tone, the steps and ramps patterns, a sweep played once)
//       one gate event clip on the Envelope per tone (steps) or one for the whole plan,
//       ending where the Playground's release starts (audio/scheduler.js, voice.js stepEnv,
//       envelope.js scheduleAdsrStep), so the attack, decay and release are the Envelope's own;
//       a finite tone longer than the safety limit opens at the limit, as the Playground plays
//       it (scheduler.js scheduleConst), unless continuous playback is allowed
// input.limitS (seconds, the Playground's safetyLimit; DEFAULT_SAFETY_LIMIT_S when absent) and
// input.continuous (its "Allow continuous playback") come with the Signal Path's input
// (voiceInputFrom, used by main.js).
// Refused, with the reason the user reads (tests/unit/playground-voice-in-studio.test.mjs lists
// the configurations; the residual check of tests/browser/v31-studio-offline.cjs measures what
// the covered ones sound like):
//   - an invalid Playground configuration (no plan, so nothing sounds);
//   - the Additive lab: schema 1 has no field for the oscillator's partials (an annotation the
//     compiler does not read), so the Studio would sound the plain waveform;
//   - a dual voice whose B side starts at a non-zero phase: no field for a start phase either;
//   - a frequency modulation (siren, wobble, FM) of non-zero depth: the Studio fades every
//     modulation edge in from zero over its click-free start (STUDIO_XFADE_S), which on a
//     frequency leaves the carrier's phase shifted for the rest of the sound; the Playground
//     modulates at full depth from the first sample (measured: 2 to 6 dB above the Playground
//     render, where the residual of a covered voice is more than 60 dB below it);
//   - a repeating (continuous) sweep: the Playground schedules it cycle by cycle without an end,
//     and a Studio timeline holds a finite list of clips;
//   - an open plan with continuous playback allowed: the Playground holds it until it is
//     released, without an end, and a Studio timeline ends (a loop would retrigger the
//     Envelope, which a held voice does not), so it is refused rather than given a made-up end;
//   - a tone too short for its attack and release: the Playground shrinks them to fit that tone
//     (stepEnv: attack at most 40 %, release at most half), the Envelope has one attack and one
//     release for every gate; and an Envelope Lab release under 5 ms, which the
//     engine plays as 5 ms (audio-engine.js play: the voice's release is at least 5 ms);
//   - a voice whose values lie outside a Studio parameter's range (validateStudioModel), so the
//     project would not play or save as it is.

import { PLAYGROUND_VOICE_IDS, PLAYGROUND_VOICE_TITLE, playgroundVoiceModel }
  from './playground-voice.js';
import { createStudioModel } from './schema.js';
import { validateStudioModel } from './validate.js';
import { NODE_REGISTRY } from './registry.js';
import { STUDIO_XFADE_S } from './compiler.js';
import { DEFAULT_SAFETY_LIMIT_S } from '../core/safety.js';

/** Why a Playground voice does not open in the Studio, as the user reads it. */
export const VOICE_OPEN_TEXT = Object.freeze({
  invalid: 'The Playground configuration is not valid, so there is no voice to open.',
  additive: 'The Additive lab sets the partials the oscillator sums, and a Studio project has '
    + 'no field for them: the Studio would play the plain waveform instead.',
  phase: (deg) => `The Phase lab starts Osc B ${deg}° ahead of Osc A, and a Studio project has `
    + 'no field for a start phase: the two oscillators would not sound the same. Set the Phase '
    + 'lab offset to 0° to open it.',
  modulation: `The Studio fades a modulation in from zero over its first ${
    Math.round(STUDIO_XFADE_S * 1000)} ms. On the oscillator's frequency that leaves its phase `
    + 'shifted for the rest of the sound, while this Playground voice is modulated at full depth '
    + 'from its first sample, so the Studio would not sound the same.',
  continuous: 'This sweep repeats without an end, cycle after cycle, and a Studio timeline holds '
    + 'a finite list of clips. Choose a number of repeats to open it.',
  held: 'Continuous playback is allowed, so the Playground holds this voice until you release '
    + 'it, and a Studio timeline has an end. Turn continuous playback off to open it for at '
    + 'most the safety limit the Playground holds it for.',
  short: (ms) => `A tone of ${ms} ms is shorter than its attack and release allow: the `
    + 'Playground shortens them for that tone, and the Studio Envelope has one attack and one '
    + 'release for every note. Lengthen the tone (for a held voice: raise the safety limit) or '
    + 'shorten the attack or release to open it.',
  release: (ms) => `The Envelope Lab's release of ${ms} ms is shorter than the 5 ms the `
    + 'Playground releases a note with, so the Studio Envelope would end it sooner.',
  range: (msg) => `The voice has a value the Studio cannot hold: ${msg}`,
});

/**
 * The Signal Path's input from the Playground component `cmp` (instrument.js) and the labs'
 * plain inputs of its plan (`labInputs(plan)`, main.js labVizInputs): what
 * playgroundVoiceDocument reads, the safety limit and the continuous permission included.
 */
export function voiceInputFrom(cmp, labInputs) {
  if (!cmp) return null;
  const res = cmp.currentPlan();
  const plan = res.ok ? res.plan : null;
  return { plan, waveform: cmp.waveform, frequency: cmp.frequency, gain: cmp.gainLevel,
    attackMs: cmp.attack, releaseMs: cmp.release, lab: labInputs(plan),
    limitS: cmp.safetyLimit, continuous: !!cmp.continuousAllowed };
}

/** The configuration names the covered plan types are listed by (tests, the notice). */
export function voiceConfiguration(plan) {
  if (!plan) return null;
  if (plan.type === 'dual') return plan.stereo ? 'dual-stereo' : 'dual-mono';
  if (plan.type === 'const') return plan.kind === 'finite' ? 'finite-tone' : 'tone';
  return plan.type; // lfo, am, fm, steps, ramps
}

/**
 * The envelope a tone of `dur` seconds gets in the Playground, or null when the Playground
 * shrinks it there (stepEnv, scheduleAdsrStep): { a, r } in seconds.
 */
function unshrunk(dur, env) {
  if (env.a > dur * 0.4 || env.r > dur * 0.5) return null;
  if (env.adsr && env.adsr.d > dur - env.a - env.r) return null;
  return { a: env.a, r: env.r };
}

/**
 * The gate clips of a plan the Playground plays for `len` seconds as one tone (a finite plan's
 * own length, or the limit), or tone by tone: [{ start, duration }] or { short: seconds }.
 */
function gatesOf(plan, env, len) {
  const tones = plan.type === 'steps' ? plan.steps.map((s) => ({ t: s.t, dur: s.dur }))
    : plan.type === 'ramps' && plan.envelope === 'segment'
      ? plan.segments.map((s) => ({ t: s.t, dur: s.dur }))
      : [{ t: 0, dur: len }];
  const out = [];
  for (const tone of tones) {
    // The chirp's segment attack: at most a tenth of the chirp (scheduler.js rampSegments).
    const a = plan.chirp ? Math.min(env.a, plan.dur * 0.1) : env.a;
    const fit = unshrunk(tone.dur, { ...env, a });
    if (!fit || a !== env.a) return { short: tone.dur };
    out.push({ start: tone.t, duration: tone.dur - fit.r });
  }
  return out;
}

const round9 = (x) => Math.round(x * 1e9) / 1e9;

/**
 * The engine's centred StereoPanners of a mono dual voice (buildDual), between the oscillators
 * and the mixer: graph -> graph.
 */
function withCentrePanners(graph) {
  const ID = PLAYGROUND_VOICE_IDS;
  const mixer = graph.nodes.find((n) => n.id === ID.mixer);
  const x = mixer.position.x;
  const nodes = graph.nodes.map((n) => (n.id === ID.mixer ? { ...n,
    position: { ...n.position, x: x + 200 } } : n.position.x > x ? { ...n,
    position: { ...n.position, x: n.position.x + 200 } } : n));
  nodes.push({ id: ID.panA, type: 'pan', position: { x, y: -60 }, params: { pan: 0 },
    metadata: { name: 'Pan A (centre)' } });
  nodes.push({ id: ID.panB, type: 'pan', position: { x, y: 60 }, params: { pan: 0 },
    metadata: { name: 'Pan B (centre)' } });
  const edges = [];
  let next = graph.edges.length;
  for (const e of graph.edges) {
    const side = e.from.node === ID.osc ? ID.panA : e.from.node === ID.oscB ? ID.panB : null;
    if (side && e.to.node === ID.mixer) {
      edges.push({ ...e, to: { node: side, port: 'audio' } });
      next += 1;
      edges.push({ id: `edge-${next}`, from: { node: side,
        port: 'audio' }, to: { ...e.to } });
    } else edges.push(e);
  }
  return { nodes, edges };
}

/** The Playground voice as an editable Studio document, or why not (see the header). */
export function playgroundVoiceDocument(input = {}, { registry = NODE_REGISTRY } = {}) {
  const plan = input.plan || null;
  if (!plan) return { ok: false, code: 'invalid', reason: VOICE_OPEN_TEXT.invalid };
  const { model, annotations } = playgroundVoiceModel(input);
  const ID = PLAYGROUND_VOICE_IDS;
  if (annotations[ID.osc] && annotations[ID.osc].partials != null) {
    return { ok: false, code: 'additive', reason: VOICE_OPEN_TEXT.additive };
  }
  if (annotations[ID.oscB] && annotations[ID.oscB].phaseDeg) {
    return { ok: false, code: 'phase',
      reason: VOICE_OPEN_TEXT.phase(Math.round(annotations[ID.oscB].phaseDeg * 100) / 100) };
  }
  if ((plan.type === 'lfo' || plan.type === 'fm') && plan.depth) {
    return { ok: false, code: 'modulation', reason: VOICE_OPEN_TEXT.modulation };
  }
  if (plan.kind === 'continuous') {
    return { ok: false, code: 'continuous', reason: VOICE_OPEN_TEXT.continuous };
  }
  const continuous = !!input.continuous;
  const limitS = Number.isFinite(input.limitS) && input.limitS > 0 ? input.limitS
    : DEFAULT_SAFETY_LIMIT_S;
  const finite = plan.kind === 'finite';
  if (!finite && continuous) return { ok: false, code: 'held', reason: VOICE_OPEN_TEXT.held };
  // How long the Playground plays it as one tone: an open plan for the limit (held), a
  // limitable finite tone for at most the limit unless continuous, any other its own length.
  const len = !finite ? limitS
    : plan.limitable && plan.dur > limitS && !continuous ? limitS : plan.dur;
  const envNode = model.graph.nodes.find((n) => n.id === ID.envelope);
  const p = envNode.params;
  const lab = input.lab || null;
  const adsr = !!(lab && lab.adsr);
  const env = { a: Math.max(0.001, p.attack), r: Math.max(0.005, p.release),
    adsr: adsr ? { d: p.decay } : null };
  const timeline = { ...model.timeline };
  const dualMono = plan.type === 'dual' && model.graph.nodes.some((n) => n.id === ID.mixer)
    && !model.graph.nodes.some((n) => n.type === 'pan');
  const graph = dualMono ? withCentrePanners(model.graph) : model.graph;
  if (env.r !== p.release) {
    return { ok: false, code: 'release',
      reason: VOICE_OPEN_TEXT.release(Math.round(p.release * 10000) / 10) };
  }
  const gates = gatesOf(plan, env, len);
  const clips = Array.isArray(gates) ? gates.map((g, i) => ({ id: `clip-${i + 1}`,
    trackId: 'track-1', kind: 'event', start: round9(g.start), duration: round9(g.duration),
    target: null, payload: { action: 'gate' } })) : [];
  timeline.tracks = [{ id: 'track-1', kind: 'event', name: 'Gate', target: ID.envelope }];
  timeline.clips = clips;
  const doc = createStudioModel({ graph, timeline,
    metadata: { title: PLAYGROUND_VOICE_TITLE,
      notes: `Opened from the Playground's Signal Path: ${plan.label || plan.type}. A copy: `
        + 'editing it here leaves the Playground as it is.' } }, { registry });
  // A value the Studio cannot hold is named before a tone too short for its envelope.
  const report = validateStudioModel(doc, { registry });
  if (!report.ok) {
    const e = report.errors[0];
    return { ok: false, code: 'range', reason: VOICE_OPEN_TEXT.range(e.message) };
  }
  if (!Array.isArray(gates)) {
    return { ok: false, code: 'short',
      reason: VOICE_OPEN_TEXT.short(Math.round(gates.short * 1000)) };
  }
  return { ok: true, model: doc, configuration: voiceConfiguration(plan) };
}

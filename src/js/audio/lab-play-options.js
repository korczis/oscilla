// The V2 play options of the labs, built in one place (C007).
//
// Every play of the instrument goes through the engine.play wrapper of main.js, and so does a
// replacement voice: engine._restart plays the new plan with a copy of the old voice's options
// ({ ...v.opts }), which still carries whatever the labs contributed when that voice started.
// The wrapper spreads this function's result over those options, so the result names EVERY
// key a lab can contribute, each set to its current value or to null. A lab the user switched
// off while a voice sounded therefore stays off on the restarted voice (the engine treats null
// as absent), and the WAV render, which builds its options here as well, plays what the labs
// say now. The engine semantics are unchanged; with every lab off the options are V1's.
//
// Pure: no DOM, no Alpine, no node creation. The lab readers and factories come from the
// caller (main.js), and a factory only builds nodes when the engine invokes it with its own
// track/source accounting (project.audio-engine-discipline).

import { scheduleAdsrStep } from './envelope.js';

/** The keys labPlayOptions always returns. */
export const LAB_PLAY_KEYS = Object.freeze([
  'adsr', 'stepEnvelope', 'inserts', 'periodicWave', 'dualRouter', 'dualPhaseDeg',
]);

/**
 * The engine's step-envelope hook for an ADSR (o.stepEnvelope, audio-engine.js): every note of
 * known length (finite tone, step, ramps pass, sweep segment) gets the whole ADSR shrunk to its
 * length (envelope.js scheduleAdsrStep). The attack and release are the ones the engine hands
 * over (adsr.a and adsr.r, or the chirp's shortened attack); decay and sustain are the ADSR's.
 */
export function adsrStepEnvelope(eg, t, dur, a, r, adsr) {
  scheduleAdsrStep(eg, t, dur, { a, d: adsr.d, s: adsr.s, r });
}

/**
 * labPlayOptions(plan, ctx, labs) -> { adsr, stepEnvelope, inserts, periodicWave, dualRouter,
 *   dualPhaseDeg }, every key present, null where the lab does not apply.
 * labs (each optional):
 *   envelope    { enabled, adsr }      the Envelope lab: adsr { a, d, s, r } while enabled
 *   insert      factory | null         the filter insert for this context (always inserted; its
 *                                      own crossfaded bypass handles "disabled")
 *   additive    { enabled, wave(ctx) } the Additive lab; wave builds its PeriodicWave on ctx.
 *                                      Additive does not apply to a dual plan.
 *   dualRouter  (plan) -> factory|null the stereo router a dual plan needs, or null
 *   phaseDeg    number | null          B's phase against A for a dual plan
 */
export function labPlayOptions(plan, ctx, labs = {}) {
  const dual = !!plan && plan.type === 'dual';
  const env = labs.envelope;
  const adsr = env && env.enabled && env.adsr ? { ...env.adsr } : null;
  const add = labs.additive;
  const periodicWave = add && add.enabled && !dual && ctx ? add.wave(ctx) || null : null;
  const router = dual && typeof labs.dualRouter === 'function' ? labs.dualRouter(plan) : null;
  const phase = Number(labs.phaseDeg);
  return {
    adsr,
    stepEnvelope: adsr ? adsrStepEnvelope : null,
    inserts: typeof labs.insert === 'function' ? [labs.insert] : null,
    periodicWave,
    dualRouter: router || null,
    dualPhaseDeg: dual && labs.phaseDeg != null && Number.isFinite(phase) ? phase : null,
  };
}

/**
 * withLabOptions(engine, labOptions) installs the play wrapper on the engine instance (main.js):
 * every play, a replacement voice of _restart included, takes the caller's options with
 * labOptions(plan) spread OVER them, so the labs' current values (or null) win over what a
 * restarted voice copied from its predecessor. guard(plan, o), when given, is asked first and
 * a truthy answer refuses the play (null), as a measurement owning the output does. Returns
 * the engine's own play, bound.
 */
export function withLabOptions(engine, labOptions, guard = null) {
  const base = engine.play.bind(engine);
  engine.play = (plan, o = {}) => {
    if (guard && guard(plan, o)) return null;
    return base(plan, { ...o, ...labOptions(plan) });
  };
  return base;
}

/**
 * followEnvelopeLab(engine, envelope) -> what engine.setAdsr answered, or false when nothing
 * sounds. The Envelope lab's live path (C007 R-2): its onChange hands the lab's current ADSR
 * (or null while it is off) and the step hook that goes with it to the sounding voice, built
 * by labPlayOptions like every other play option.
 */
export function followEnvelopeLab(engine, envelope) {
  const v = engine && engine.voice;
  if (!v || v.ended || typeof engine.setAdsr !== 'function') return false;
  const o = labPlayOptions(v.plan, null, { envelope });
  return engine.setAdsr(o.adsr, o.stepEnvelope);
}

// Fixture for tests/browser/v31-studio-offline.cjs, plan V605: bundled with esbuild (IIFE) next
// to v31-studio-offline-entry.js into the one file:// page. For each configuration of
// tests/unit/fixtures/playground-voice-configs.mjs it renders, on OfflineAudioContexts at the
// sample rate of a realtime AudioContext in this browser (its own rate, never an assumed one):
//   the opened Studio document: playgroundVoiceDocument's model (studio/playground-voice-open.js)
//     through renderStudioOffline, the Studio runtime and transport on the offline context;
//   the Playground voice: the AudioEngine's own play() (audio-engine.js, with the labs' play
//     options built by audio/lab-play-options.js as main.js builds them, and the ADSR envelope
//     main.js installs) on an engine whose context is an offline one of the same length. Its
//     master stage feeds the destination directly: the safe output chain after it (limiter,
//     trim, ceiling, analyser) is the chain a Studio Master Output compiles to live (ADR 0035),
//     and the Studio's offline render leaves it out too (studio/offline.js).
// Both voices start at the same context time: the engine reads the context's clock at play() and
// starts START_OFFSET_S later; the engine's context reports, at that one reading, the Studio's
// start time minus START_OFFSET_S (an exact float), so every event of both lands on the same
// sample. Before that time nothing of either voice sounds.
// Compared span: from the end of the Studio's start crossfade (STUDIO_XFADE_S, its click-free
// start, which a Playground voice does not have) to the start of its output fade (STUDIO_STOP_S)
// at the end of the render. The residual is the RMS of the difference over both channels against
// the RMS of the Playground render there, in dB; `wholeDb` is the same from the voices' first
// sample, the start crossfade included (reported, not judged).

import { AudioEngine } from '../../../src/js/audio/audio-engine.js';
import { labPlayOptions } from '../../../src/js/audio/lab-play-options.js';
import { createFilterStage } from '../../../src/js/audio/filters.js';
import { createStereoRouter } from '../../../src/js/audio/stereo.js';
import { makeAdsrEnvelope } from '../../../src/js/audio/voice.js';
import { applyAdsr, releaseAt } from '../../../src/js/audio/envelope.js';
import { START_OFFSET_S } from '../../../src/js/core/constants.js';
import { renderStudioOffline } from '../../../src/js/studio/offline.js';
import { STUDIO_STOP_S, STUDIO_XFADE_S } from '../../../src/js/studio/compiler.js';
import { playgroundVoiceDocument } from '../../../src/js/studio/playground-voice-open.js';
import { VOICE_CONFIGS, voiceSetup } from '../../unit/fixtures/playground-voice-configs.mjs';

/** Seconds a held (open) voice is rendered: inside the Playground's 2 s safety limit. */
const HELD_S = 1;
/** Seconds rendered after a finite voice's programmed end (its release is inside it). */
const TAIL_S = 0.1;

/** The rate this browser runs a realtime AudioContext at. */
async function ownRate() {
  const C = window.AudioContext || window.webkitAudioContext;
  const ctx = new C();
  const sr = ctx.sampleRate;
  try { await ctx.close(); } catch (e) { /* closed */ }
  return sr;
}

function offlineContext(channels, length, sampleRate) {
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  try {
    return new C({ numberOfChannels: channels, length, sampleRate });
  } catch (e) {
    return new C(channels, length, sampleRate);
  }
}

/** A float64 `t` with t + START_OFFSET_S === start exactly (the engine's own sum). */
function clockFor(start) {
  const f = new Float64Array(1);
  const u = new BigInt64Array(f.buffer);
  f[0] = start - START_OFFSET_S;
  for (let i = 0; i < 64 && f[0] + START_OFFSET_S !== start; i++) {
    u[0] += f[0] + START_OFFSET_S < start ? 1n : -1n;
  }
  if (f[0] + START_OFFSET_S !== start) throw new Error(`no clock reading starts at ${start}`);
  return f[0];
}

/**
 * The offline context as the engine sees it: every member is the context's own (methods bound
 * to it), except currentTime, which reads `now` (the clock the engine starts the voice from).
 */
function contextAt(ctx, now) {
  return new Proxy(ctx, {
    get(target, key) {
      if (key === 'currentTime') return now;
      const v = Reflect.get(target, key);
      return typeof v === 'function' ? v.bind(target) : v;
    },
    set(target, key, value) { return Reflect.set(target, key, value); },
  });
}

/** The Playground voice of `setup`, started at `start`, rendered by the AudioEngine. */
async function renderPlayground(setup, duration, sampleRate, start) {
  const ctx = offlineContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const view = contextAt(ctx, clockFor(start));
  // The engine builds "its" AudioContext from env: here the offline one.
  const env = { AudioContext: function OfflineAsRealtime() { return view; },
    setTimeout: () => 0, clearTimeout() {}, navigator: null };
  const engine = new AudioEngine({ env });
  engine.setEnvelope(makeAdsrEnvelope({ applyAdsr, releaseAt })); // as main.js
  engine.gainLevel = setup.state.gainLevel;
  if (!engine.init()) throw new Error(`engine init: ${engine.lastError && engine.lastError.message}`);
  engine.master.disconnect();
  engine.master.connect(ctx.destination);
  const { labs, router, state, plan } = setup;
  const lab = labPlayOptions(plan, view, {
    envelope: labs.adsr ? { enabled: true, adsr: { ...labs.adsr } } : null,
    insert: labs.filter ? (c, track) => createFilterStage(c, { ...labs.filter, enabled: true },
      { track }) : null,
    additive: null,
    dualRouter: () => (router ? (c, track) => createStereoRouter(c, router, { track }) : null),
    phaseDeg: labs.phaseDeg != null ? labs.phaseDeg : null,
  });
  const info = engine.play(plan, { mode: 'hold', continuous: false, limitS: 2,
    durationS: state.duration / 1000, attackS: state.attack / 1000,
    releaseS: state.release / 1000, ...lab });
  if (!info) throw new Error(`play: ${engine.lastError && engine.lastError.message}`);
  const buffer = await ctx.startRendering();
  return { buffer, start: info.start };
}

/** Residual of `s` against `p` over [from, to) samples, both channels. */
function residual(p, s, from, to) {
  let ref = 0;
  let diff = 0;
  for (let c = 0; c < 2; c++) {
    const a = p.getChannelData(Math.min(c, p.numberOfChannels - 1));
    const b = s.getChannelData(Math.min(c, s.numberOfChannels - 1));
    for (let i = from; i < to; i++) {
      const d = a[i] - b[i];
      ref += a[i] * a[i];
      diff += d * d;
    }
  }
  const n = 2 * Math.max(1, to - from);
  const refRms = Math.sqrt(ref / n);
  const diffRms = Math.sqrt(diff / n);
  return { refRms, diffRms,
    db: refRms > 0 ? 20 * Math.log10(Math.max(diffRms, 1e-12) / refRms) : NaN };
}

window.PV = {
  configs: () => VOICE_CONFIGS.map((c) => ({ id: c.id, label: c.label, opens: c.opens,
    code: c.code || null })),

  /** One configuration: the document or refusal, and for an opened one both renders compared. */
  async render(id) {
    const entry = VOICE_CONFIGS.find((c) => c.id === id);
    const sampleRate = await ownRate();
    const setup = voiceSetup(entry, { sampleRate });
    const doc = playgroundVoiceDocument(setup.input);
    if (!doc.ok) return { id, sampleRate, opened: false, code: doc.code, reason: doc.reason };
    const plan = setup.plan;
    const duration = plan.kind === 'finite' ? plan.dur + TAIL_S : HELD_S;
    const st = await renderStudioOffline(doc.model, { duration, sampleRate, channels: 2 });
    if (!st.ok) {
      return { id, sampleRate, opened: true, rendered: false,
        why: [...st.limitations, ...st.errors] };
    }
    const pg = await renderPlayground(setup, duration, sampleRate, st.startTime);
    const first = Math.round(pg.start * sampleRate);
    const from = Math.ceil((pg.start + STUDIO_XFADE_S) * sampleRate);
    const to = Math.floor((duration - STUDIO_STOP_S) * sampleRate);
    const span = residual(pg.buffer, st.buffer, from, to);
    const whole = residual(pg.buffer, st.buffer, first, to);
    return { id, sampleRate, opened: true, rendered: true, configuration: doc.configuration,
      clips: doc.model.timeline.clips.length, lanes: doc.model.timeline.automation.length,
      sameStart: pg.start === st.startTime, start: st.startTime, from: from / sampleRate,
      to: to / sampleRate, refRms: span.refRms, residualDb: span.db, wholeDb: whole.db,
      limitations: st.plan.limitations };
  },
};

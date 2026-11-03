// The Web Audio lifecycle of a polyphonic Synth engine (plan K122): one host per engine node,
// voices built by the engine's own builder (adapters/engines.js) and allocated by the pure pool
// (synth/voice-pool.js). Native Web Audio only; every node goes through acct.track and every
// source through acct.source (engine accounting), so the census sees each voice and a stopped
// engine leaves none. No recurrence and no DelayNode (project.no-silent-feedback).
//
//   createVoiceHost({ ctx, acct, params, build }) -> host
//     build(v) -> { oneShotEnd?, dropped?, cleanup?, group?, chokes? }
//                  v = { ctx, t, note, hz, velocity, peak, p, into: AudioNode, track(n),
//                  source(n) }: the builder connects its voice into `into` (the voice
//                  amplifier: the ADSR at `peak`, or a constant `peak` for a one-shot, which
//                  shapes its own decay and returns when it ends); cleanup()
//                  undoes connections into nodes it does not own; a voice whose `chokes` names
//                  a group releases that group's sounding voices in CHOKE_RELEASE_S (a closed hat
//                  chokes an open one). A builder that starts no source sounds nothing: that
//                  note takes no voice and steals none.
//     host.out                       the engine's output; host.thru the Chain input (into out)
//     host.noteOn(t, note, velocity) -> { slot, stolen, retrigger, dropped }
//     host.noteOff(t, note) -> bool  host.allOff(t) -> n   host.stop(t)   host.dispose()
//     host.update(params)            the next notes use these parameters
//     host.voices(t?) -> n           voices sounding (held, or releasing before their end)
//
// A voice's amplifier releases with releaseAt (cancelAndHoldAtTime where the browser has it),
// its sources stop at the release end plus VOICE_STOP_MARGIN_S, and once every source has ended
// its nodes are disconnected and untracked. A stolen voice is released in STEAL_RELEASE_S and
// the new note starts after that fade, so the pool never sounds more than MAX_VOICES voices.
// A note-on for a note already held re-attacks its own voice from the level it holds (legato:
// its sources run on); all-off releases the held voices and cuts the ringing one-shots.
//
// Headroom (ADR 0058's rule for note voices, review of #332): a voice peaks at Level / 4 /
// MAX_VOICES of digital full scale times the velocity law, so the 16 voices at the highest
// Level (4) and velocity together peak at most at full scale and the Master Output level stays
// the cap: the output ceiling is never the limiter. No high-pass follows a voice: at some
// settings one raises its peak above that bound (measured: an FM stack +35 %, a square at E2
// +27 %; computed for review of #332 V7: a square at E2 +16 % at a 5 Hz and +58 % at a 20 Hz
// second-order cut-off), although at the settings that have a 0 Hz line it would lower it (ring
// of sines at ratio 1: to half, AM at depth 1: to 0.75). So a voice whose spectrum has a 0 Hz
// line (ring at ratio 1, a carrier at a whole multiple of its modulator) keeps that mean, and
// its engine's face says so.

import { applyAdsr, forgetParam, releaseAt } from '../../audio/envelope.js';
import { midiToFrequency } from '../../core/music.js';
import { velocityLevel } from '../../midi/notes.js';
import { MAX_VOICES, createVoicePool } from '../../synth/voice-pool.js';

export const VOICE_STOP_MARGIN_S = 0.02;
export const STEAL_RELEASE_S = 0.005;
export const CHOKE_RELEASE_S = 0.004;
/** The highest Level (nodes/engines.js): at it the pool's MAX_VOICES voices sum to full scale. */
export const VOICE_LEVEL_MAX = 4;
/** Level per unit of a voice's peak: 1 / (VOICE_LEVEL_MAX × MAX_VOICES) of full scale. */
export const VOICE_LEVEL_SCALE = 1 / (VOICE_LEVEL_MAX * MAX_VOICES);
export const voicePeak = (level, velocity) => Math.min(VOICE_LEVEL_MAX, Math.max(0, level))
  * VOICE_LEVEL_SCALE * velocityLevel(velocity);

export function createVoiceHost({ ctx, acct, params, build }) {
  const out = acct.track(ctx.createGain());
  const pool = createVoicePool({ max: MAX_VOICES });
  const live = new Map(); // slot -> voice
  let p = { ...params };

  function cleanup(v) {
    if (v.gone) return;
    v.gone = true;
    for (const n of v.nodes) {
      try { n.disconnect(); } catch (e) { /* already disconnected */ }
      acct.untrack(n);
    }
    forgetParam(v.amp.gain);
    if (typeof v.cleanup === 'function') v.cleanup();
    if (live.get(v.slot) === v) {
      live.delete(v.slot);
      pool.free(v.slot);
    }
  }

  function stopAt(v, end) {
    v.end = Math.min(v.end, end);
    for (const s of v.sources) {
      try { s.stop(v.end + VOICE_STOP_MARGIN_S); } catch (e) { /* stopped */ }
    }
  }

  function release(v, t, r) {
    if (v.released != null && v.end <= t + r) return v.end;
    v.released = t;
    if (v.oneShot) {
      if (r < v.end - t) { // a steal or a stop: cut the one-shot short
        releaseAt(v.amp.gain, t, r);
        stopAt(v, t + r);
      }
      return v.end;
    }
    const { endTime } = releaseAt(v.amp.gain, t, r);
    stopAt(v, endTime);
    return endTime;
  }

  const adsrOf = () => ({ a: p.attack, d: p.decay, s: p.sustain, r: p.release });

  function noteOn(t, note, velocity = 100) {
    const peak = voicePeak(p.level, velocity);
    const same = pool.heldSlot(note);
    const held = same == null ? null : live.get(same);
    if (held && !held.oneShot && !held.gone) { // legato: re-attack from the level it holds
      pool.on(note, t);
      applyAdsr(held.amp.gain, t, adsrOf(), peak, { retrigger: true });
      return { slot: same, stolen: false, retrigger: true, dropped: 0 };
    }
    // A full pool steals: the new voice starts once the stolen one has faded.
    const full = same == null && pool.active(t) >= pool.max;
    const start = full ? t + STEAL_RELEASE_S : t;
    const v = { slot: null, note, nodes: [], sources: [], end: Infinity, released: null,
      oneShot: false, gone: false, ended: 0 };
    const track = (n) => { v.nodes.push(acct.track(n)); return n; };
    const source = (n) => {
      track(n);
      acct.source(n);
      v.sources.push(n);
      n.addEventListener('ended', () => {
        v.ended += 1;
        if (v.ended >= v.sources.length) cleanup(v);
      });
      return n;
    };
    v.amp = track(ctx.createGain());
    const built = build({ ctx, t: start, note, hz: midiToFrequency(note), velocity, peak, p,
      into: v.amp, track, source }) || {};
    v.cleanup = built.cleanup;
    if (!v.sources.length) { // nothing sounds (every operator above the limit, every bar 0):
      cleanup(v); // no voice, and no voice stolen for it: the census counts what sounds
      return { slot: null, stolen: false, retrigger: false, dropped: built.dropped || 0 };
    }
    const a = pool.on(note, t);
    const old = live.get(a.slot);
    if (old) release(old, t, STEAL_RELEASE_S);
    v.slot = a.slot;
    v.amp.connect(out);
    v.group = built.group || null;
    if (built.chokes) { // a choke group: this hit releases the group's sounding voices
      for (const o of live.values()) {
        if (o.group === built.chokes) pool.end(o.slot, release(o, start, CHOKE_RELEASE_S));
      }
    }
    if (Number.isFinite(built.oneShotEnd)) {
      v.oneShot = true;
      v.amp.gain.setValueAtTime(peak, start);
      stopAt(v, built.oneShotEnd);
      pool.off(note, t);
      pool.end(a.slot, built.oneShotEnd);
    } else {
      applyAdsr(v.amp.gain, start, adsrOf(), peak);
    }
    live.set(a.slot, v);
    return { slot: a.slot, stolen: a.steal != null && !!old, retrigger: false,
      dropped: built.dropped || 0 };
  }

  function noteOff(t, note) {
    const slot = pool.off(note, t);
    const v = slot == null ? null : live.get(slot);
    if (!v) return false;
    pool.end(slot, release(v, t, p.release));
    return true;
  }

  return {
    out,
    thru: out,
    noteOn,
    noteOff,
    allOff(t, fast = false) {
      let n = 0;
      for (const slot of pool.allOff(t)) {
        const v = live.get(slot);
        if (v) { pool.end(slot, release(v, t, fast ? STEAL_RELEASE_S : p.release)); n++; }
      }
      for (const v of [...live.values()]) { // a ringing one-shot (an open hat) is cut too
        if (v.oneShot && v.released == null && v.end > t) {
          pool.end(v.slot, release(v, t, STEAL_RELEASE_S));
          n++;
        }
      }
      return n;
    },
    update(next) { p = { ...p, ...next }; },
    params: () => p,
    voices: (t = ctx.currentTime) => pool.active(t),
    held: () => pool.held(),
    stop(t) {
      for (const v of [...live.values()]) release(v, t, STEAL_RELEASE_S);
    },
    dispose() {
      for (const v of [...live.values()]) cleanup(v);
    },
  };
}

// The Web Audio lifecycle of a polyphonic Synth engine (plan K122): one host per engine node,
// voices built by the engine's own builder (adapters/engines.js) and allocated by the pure pool
// (synth/voice-pool.js). Native Web Audio only; every node goes through acct.track and every
// source through acct.source (engine accounting), so the census sees each voice and a stopped
// engine leaves none. No recurrence and no DelayNode (project.no-silent-feedback).
//
//   createVoiceHost({ ctx, acct, params, build }) -> host
//     build(v) -> { oneShotEnd?, dropped?, cleanup?, group?, chokes? }
//                  v = { ctx, t, note, hz, velocity, peak, p, into: AudioNode, track(n),
//                  source(n) }: the builder connects its voice into `into` (the voice amplifier:
//                  the ADSR at `peak`, or a constant `peak` for a one-shot, which shapes its own
//                  decay and returns when it ends); cleanup() undoes connections into nodes it
//                  does not own; a voice whose `chokes` names a group releases that group's
//                  sounding voices in CHOKE_RELEASE_S (a closed hat chokes an open one)
//     host.out                       the engine's output; host.thru the Chain input (into out)
//     host.noteOn(t, note, velocity) -> { slot, stolen, dropped }
//     host.noteOff(t, note) -> bool  host.allOff(t) -> n   host.stop(t)   host.dispose()
//     host.update(params)            the next notes use these parameters
//     host.voices(t?) -> n           voices sounding (held, or releasing before their end)
//
// A voice's amplifier releases with releaseAt (cancelAndHoldAtTime where the browser has it),
// its sources stop at the release end plus VOICE_STOP_MARGIN_S, and once every source has ended
// its nodes are disconnected and untracked. A stolen voice is released in STEAL_RELEASE_S.

import { applyAdsr, forgetParam, releaseAt } from '../../audio/envelope.js';
import { midiToFrequency } from '../../core/music.js';
import { velocityLevel } from '../../midi/notes.js';
import { MAX_VOICES, createVoicePool } from '../../synth/voice-pool.js';

export const VOICE_STOP_MARGIN_S = 0.02;
export const STEAL_RELEASE_S = 0.005;
export const CHOKE_RELEASE_S = 0.004;
/** Level per unit of a voice's peak: Level / 4 of digital full scale, times the velocity law. */
export const VOICE_LEVEL_SCALE = 1 / 4;
export const voicePeak = (level, velocity) => Math.max(0, level) * VOICE_LEVEL_SCALE
  * velocityLevel(velocity);

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

  function noteOn(t, note, velocity = 100) {
    const a = pool.on(note, t);
    const old = live.get(a.slot);
    if (old) release(old, t, STEAL_RELEASE_S);
    const v = { slot: a.slot, note, nodes: [], sources: [], end: Infinity, released: null,
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
    v.amp.connect(out);
    const peak = voicePeak(p.level, velocity);
    const built = build({ ctx, t, note, hz: midiToFrequency(note), velocity, peak, p,
      into: v.amp, track, source }) || {};
    v.cleanup = built.cleanup;
    v.group = built.group || null;
    if (built.chokes) { // a choke group: this hit releases the group's sounding voices
      for (const o of live.values()) {
        if (o.group === built.chokes) pool.end(o.slot, release(o, t, CHOKE_RELEASE_S));
      }
    }
    if (Number.isFinite(built.oneShotEnd)) {
      v.oneShot = true;
      v.amp.gain.setValueAtTime(peak, t);
      stopAt(v, built.oneShotEnd);
      pool.off(note, t);
      pool.end(a.slot, built.oneShotEnd);
    } else {
      applyAdsr(v.amp.gain, t, { a: p.attack, d: p.decay, s: p.sustain, r: p.release }, peak);
    }
    if (!v.sources.length) cleanup(v); // every operator was above the limit: nothing sounds
    else live.set(a.slot, v);
    return { slot: a.slot, stolen: a.steal != null && !!old, dropped: built.dropped || 0 };
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

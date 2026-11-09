// Studio transport commands shared by the transport strip, the timeline keyboard and the compact
// widget (spec §93-§96, §184-§185; plan V418). No DOM and no Web Audio: every call goes to the
// Studio transport (src/js/studio/transport.js), which alone touches audio, and every outcome is
// announced once through ctx.announce (§144).
//
//   createTransportCommands(ctx) -> { playStop, play, stop, returnToStart, locate, toggleLoop,
//                                     setLoop, escape, position, playing }
//   ctx = { store, transport, announce? }

import { transportAnnouncement } from './transport-view.js';

export function createTransportCommands(ctx) {
  const { store, transport } = ctx;
  const say = (text) => {
    if (text && typeof ctx.announce === 'function') ctx.announce(text);
  };
  const model = () => store.getModel();
  const position = () => {
    const p = transport.playhead();
    return p && Number.isFinite(p.position) ? p.position : 0;
  };

  /** The timeline plays (an armed run alone is stopped: its keys sound, K104). */
  const timelinePlaying = () => !!transport.playing && !transport.armed;

  function play() {
    if (timelinePlaying()) return { ok: true, already: true };
    const pos = position();
    const r = transport.start({ position: pos });
    if (r && r.ok) say(transportAnnouncement('play', { position: pos }, model()));
    else say(transportAnnouncement('refused', { reason: r && r.reason }, model()));
    return r;
  }

  /**
   * STOP (§184): releases everything; resolves with the transport's counts. A run that began
   * armed stays armed (K104, the owner's 'STOP keeps it armed'); Escape (fast) disarms.
   */
  function stop({ fast = false, silent = false } = {}) {
    const was = timelinePlaying();
    const p = transport.stop({ fast, keepArmed: !fast });
    if (was && !silent) say(transportAnnouncement(fast ? 'escape' : 'stop', {}, model()));
    return p;
  }

  function playStop() {
    return timelinePlaying() ? stop() : play();
  }

  function locate(p) {
    const r = transport.locate(Math.max(0, p));
    say(transportAnnouncement('locate', { position: r ? r.position : p }, model()));
    return r;
  }

  function returnToStart() {
    const r = transport.returnToStart();
    say(transportAnnouncement('locate', { position: 0 }, model()));
    return r;
  }

  function setLoop(patch) {
    const r = transport.setLoop(patch);
    if (r && r.ok && r.changed) {
      const loop = model().timeline.loop;
      say(transportAnnouncement('loop', loop, model()));
    } else if (r && !r.ok) {
      say(`Not done: ${r.reason}`);
    }
    return r;
  }

  function toggleLoop() {
    return setLoop({ enabled: !model().timeline.loop.enabled });
  }

  /**
   * Escape (§185) once the editor has no gesture, popup or selection mode of its own left:
   * the transport resolves the priority; 'stop-audio' stops fast (the transport does it).
   */
  function escape(state = {}) {
    const was = transport.playing;
    const action = transport.escape(state);
    if (action === 'stop-audio' && was) say(transportAnnouncement('escape', {}, model()));
    return action;
  }

  return Object.freeze({ play, stop, playStop, locate, returnToStart, setLoop, toggleLoop,
    escape, position, get playing() { return transport.playing; } });
}

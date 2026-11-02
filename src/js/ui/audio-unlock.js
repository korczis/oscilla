// The first gesture starts audio, on a phone as on a desktop (owner report 2026-11-02: no
// sound on the phone).
//
//   armAudioUnlock({ win, nav, unlock }) → { events, session }
//
// A page may start audio only inside a user activation. A mouse and a key grant it at their
// start (pointerdown, keydown); a touch only at its end (HTML: pointerup, touchend), so the
// unlock listens to both ends. A bare click, as assistive technology dispatches it, is no
// gesture: it creates no AudioContext (tests/browser/surface-census.cjs no-audio), so the
// unlock never listens to click.
//
// iOS (Safari 17+) mutes Web Audio at the ringer switch unless the page asks for a playback
// audio session; an instrument is a playback app, so the session is set where the API exists.
// A browser without it, or one that refuses the type, keeps its default.

/** The events that grant a user activation and so may start audio. */
export const UNLOCK_EVENTS = Object.freeze(['pointerdown', 'pointerup', 'touchend', 'keydown']);

/**
 * Listen for the gestures that may start audio and ask iOS for a playback session.
 * win: the window-like target; nav: the navigator-like object; unlock: called on each gesture.
 * Returns the events listened to and the session type left in place ('playback', the type a
 * refusal left, or null without the API).
 */
export function armAudioUnlock({ win, nav, unlock }) {
  for (const type of UNLOCK_EVENTS) win.addEventListener(type, unlock, { capture: true });
  let session = null;
  try {
    if (nav && nav.audioSession) {
      if (nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback';
      session = nav.audioSession.type;
    }
  } catch (e) { /* the browser refuses the session type: Web Audio keeps its default */ }
  return { events: [...UNLOCK_EVENTS], session };
}

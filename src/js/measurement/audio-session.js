// The audio session of a microphone capture (C033), for capture.js. See captureAudioSession.

/**
 * The audio session a capture needs (C033). The page asks iOS and WebKit for a `playback`
 * session at its first gesture (ui/audio-unlock.js, project.a-phone-sounds); in that session
 * getUserMedia rejects ("AudioSession category is not compatible with audio capture.", WebKit
 * 26.6, measured), so MEASURE could never open its input there. While this io holds an input
 * the session is `play-and-record`, which plays as `playback` does and also captures; the type
 * the page had is put back when the input closes. Without navigator.audioSession nothing is
 * set; a refusal keeps the session as it is and getUserMedia reports the real reason.
 * Returns restore(): idempotent; the last holder of a switched session puts `playback` back.
 */
export const CAPTURE_AUDIO_SESSION = 'play-and-record';

// One record per session switched by a capture: how many open inputs hold it (98 F3). Two
// capture ios (MEASURE's, the live RTA's) share the page's one navigator.audioSession, so the
// first to close must not put `playback` back while the other still holds its input.
const holds = new WeakMap();

export function captureAudioSession(nav) {
  const session = nav && nav.audioSession;
  if (!session || typeof session !== 'object') return () => {};
  let hold = holds.get(session);
  if (!hold) {
    try {
      if (session.type !== 'playback') return () => {};
      session.type = CAPTURE_AUDIO_SESSION;
    } catch (e) { return () => {}; /* refused: getUserMedia says why */ }
    hold = { count: 0 };
    holds.set(session, hold);
  }
  hold.count += 1;
  let held = true;
  return function restore() {
    if (!held) return;
    held = false;
    hold.count -= 1;
    if (hold.count > 0) return;
    holds.delete(session);
    // Only this module's own type is put back: a type someone else set since is theirs.
    try { if (session.type === CAPTURE_AUDIO_SESSION) session.type = 'playback'; }
    catch (e) { /* the browser keeps its session */ }
  };
}

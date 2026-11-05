// The audio session of a microphone capture (C033), for capture.js. See captureAudioSession.

/**
 * The audio session a capture needs (C033). The page asks iOS and WebKit for a `playback`
 * session at its first gesture (ui/audio-unlock.js, project.a-phone-sounds); in that session
 * getUserMedia rejects ("AudioSession category is not compatible with audio capture.", WebKit
 * 26.6, measured), so MEASURE could never open its input there. While this io holds an input
 * the session is `play-and-record`, which plays as `playback` does and also captures; the type
 * the page had is put back when the input closes. Without navigator.audioSession nothing is
 * set; a refusal keeps the session as it is and getUserMedia reports the real reason.
 * Returns restore(): idempotent, puts back the previous type when this call changed it.
 */
export const CAPTURE_AUDIO_SESSION = 'play-and-record';
export function captureAudioSession(nav) {
  const session = nav && nav.audioSession;
  let previous = null;
  try {
    if (session && session.type === 'playback') {
      session.type = CAPTURE_AUDIO_SESSION;
      previous = 'playback';
    }
  } catch (e) { previous = null; /* refused: getUserMedia says why */ }
  return function restore() {
    if (previous === null) return;
    const type = previous;
    previous = null;
    try { if (session.type === CAPTURE_AUDIO_SESSION) session.type = type; }
    catch (e) { /* the browser keeps its session */ }
  };
}

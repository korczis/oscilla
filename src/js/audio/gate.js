// The shortest gate a note holds (K184, project.a-phone-sounds): a tap whose press and release
// are handled in the same task (touchstart and touchend, pointerdown and pointerup, a key down
// and up, a MIDI on and off) opened and closed its gate at the same audio time, so it was
// silent (26 found it on the XY pad, about 1 Playwright tap in 10). Every note path defers an
// ordinary note-off to its on plus MIN_GATE_S; a longer note is unchanged, and a forced stop
// (Escape, All Notes Off, a panic) is never deferred.
//
// 30 ms: past the shortest attack a voice ramps (5 ms) with room for its first cycles to reach
// the output, and shorter than a deliberate staccato (about 60 ms and up), so it changes no
// played note. One constant, imported by every note path; no surface defines its own.

export const MIN_GATE_S = 0.03;

/** Whether a note-off is a forced stop, never deferred (af's rule, 98's F5 on K183): an explicit
 *  `forced`, or a held-notes release whose reason is not an ordinary note-off or re-press (blur,
 *  hide, Escape, a switch, disarm, unplug, all-off, silence, bound). */
const ORDINARY = Object.freeze(['note-off', 're-press', 'legato']);

export function forcedOff(info) {
  if (!info) return false;
  if (info.forced === true) return true;
  return typeof info.reason === 'string' && !ORDINARY.includes(info.reason);
}

/** When a gate opened at `onAt` (s, audio time) may close, asked to close at `offAt`. */
export function gateCloseAt(onAt, offAt) {
  return Number.isFinite(onAt) ? Math.max(offAt, onAt + MIN_GATE_S) : offAt;
}

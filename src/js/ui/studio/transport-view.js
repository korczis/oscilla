// Studio transport view helpers (spec §93-§96, §125, §180-§185; plan V418). Pure: plain data in,
// plain data out; no DOM, no Web Audio, no clock. The transport (src/js/studio/transport.js)
// owns playback; this module only says what the transport strip shows, which command a key
// means, and what to announce (§144: semantic actions, never per-frame chatter).

import { describeTime, formatSecondsText, formatTransportTime } from './timeline-view.js';

/** Transport readout refresh while playing (ms): text is not rewritten every frame. */
export const READOUT_INTERVAL_MS = 100;

/**
 * What the transport strip shows: { playing, playLabel, loopOn, loopLabel, readout, mode }.
 * `playhead` is transport.playhead() ({ position, playing }).
 */
export function transportStrip(model, playhead) {
  const loop = model.timeline.loop;
  const pos = playhead && Number.isFinite(playhead.position) ? playhead.position : 0;
  const playing = !!(playhead && playhead.playing);
  return {
    playing,
    playLabel: playing ? 'Stop' : 'Play',
    loopOn: !!loop.enabled,
    loopLabel: `Loop ${loop.enabled ? 'on' : 'off'}, ${formatSecondsText(loop.start)} to `
      + `${formatSecondsText(loop.end)}`,
    readout: formatTransportTime(pos, model.transport),
    mode: model.transport.timeMode === 'musical' ? 'musical' : 'seconds',
  };
}

/** Live-region text of a transport event (§144). */
export function transportAnnouncement(kind, detail = {}, model = null) {
  const tr = model ? model.transport : null;
  switch (kind) {
    case 'play':
      return `Playing from ${describeTime(detail.position || 0, tr)}`;
    case 'stop':
      return 'Stopped';
    case 'ended':
      return 'Playback ended';
    case 'escape':
      return 'Stopped (Escape)';
    case 'locate':
      return `Playhead at ${describeTime(detail.position || 0, tr)}`;
    case 'loop':
      return detail.enabled ? `Loop on, ${formatSecondsText(detail.start)} to `
        + `${formatSecondsText(detail.end)}` : 'Loop off';
    case 'refused':
      return `Not playing: ${detail.reason || 'the transport refused to start.'}`;
    default:
      return '';
  }
}

const isMod = (e) => !!(e.metaKey || e.ctrlKey);

/**
 * The timeline command of a key (§125 within the timeline): null when the key is not the
 * timeline's (the browser and the shell keep it). `target` is the kind of the focused element:
 * 'clip' | 'point' | 'marker' | 'loop' | 'field' | 'control' | 'other'. Form fields keep their
 * keys except Escape (§125: no interception while a form control is edited); a native button or
 * select ('control') keeps Space and Enter, and only Escape and undo / redo apply there.
 */
export function keyCommand(e, target = 'other') {
  const k = e.key;
  if (k === 'Escape') return { cmd: 'escape' };
  if (target === 'field') return null;
  if (isMod(e) && !e.altKey) {
    const lower = typeof k === 'string' ? k.toLowerCase() : '';
    if (lower === 'z') return { cmd: e.shiftKey ? 'redo' : 'undo' };
    if (lower === 'y' && e.ctrlKey && !e.metaKey) return { cmd: 'redo' };
    if (lower === 'd' && target === 'clip') return { cmd: 'duplicate' };
    return null;
  }
  if (e.altKey || target === 'control') return null;
  if (k === ' ' || e.code === 'Space') return { cmd: 'play-stop' };
  if (k === 'Home') return { cmd: 'return' };
  if (k === '[') return { cmd: 'marker-prev' };
  if (k === ']') return { cmd: 'marker-next' };
  const fine = !!e.shiftKey;
  if (target === 'clip' || target === 'marker' || target === 'loop' || target === 'point') {
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      return { cmd: 'nudge-time', dir: k === 'ArrowLeft' ? -1 : 1, fine };
    }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      return { cmd: target === 'point' ? 'nudge-value' : 'nudge-row', dir: k === 'ArrowUp' ? 1
        : -1, fine };
    }
    if (target === 'point' && (k === 'PageUp' || k === 'PageDown')) {
      return { cmd: 'nudge-value', dir: k === 'PageUp' ? 1 : -1, large: true };
    }
    if (k === 'Enter') return { cmd: 'edit' };
    if (k === 'Delete' || k === 'Backspace') return target === 'loop' ? null : { cmd: 'delete' };
  }
  if (target === 'clip' && (k === 's' || k === 'S') && !e.shiftKey) return { cmd: 'split' };
  if ((k === 'm' || k === 'M') && !e.shiftKey) return { cmd: 'add-marker' };
  if ((k === 'l' || k === 'L') && !e.shiftKey) return { cmd: 'loop-toggle' };
  return null;
}

/** Keyboard help shown under the timeline (also the region's description). */
export const KEY_HELP = 'Space play or stop · Esc cancel or stop · Home return · ←/→ move (Shift '
  + 'fine) · ↑/↓ track or value · Enter edit · Delete remove · Ctrl/⌘ D duplicate · S split at '
  + 'playhead · M marker · L loop · [ ] previous / next marker';

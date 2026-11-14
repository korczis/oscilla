// MIDI Control Change on the Synth panel (plan issue V506; ADR 0058, its V506 note).
//
// A controller's knob or fader edits the panel exactly as the mouse does: the slot's control is
// found on the panel's face, the 0-127 value is a position along that control (ui/synth/knob.js
// fromNorm, so a log cutoff sweeps in equal ratios), and the edit is one NODE_PARAM_SET (or one
// amount BATCH) through the panel's own setControl. A run of messages on one control is one undo
// entry, closed GESTURE_IDLE_MS after its last message, as a wheel burst is.
//
// The slots follow the factory layout that controllers of the KeyLab mkII family send and that
// the classic-synth plug-ins of the same maker read (derived 2026-11-14 from the installed
// plug-ins' default MIDI configuration; docs/MIDI.md lists the evidence): encoders 1-4 send
// CC 74, 71, 76, 77 (cutoff, resonance, LFO rate, LFO amount), encoders 6-9 CC 18, 19, 16, 17,
// faders 1-4 CC 73, 75, 79, 72 (the filter envelope's attack, decay, sustain, release),
// faders 5-8 CC 80-83 (the second envelope's), fader 9 CC 85 (volume). The General MIDI
// controllers join them: CC 1 (modulation wheel: vibrato) and CC 7 (volume). On this panel the
// filter envelope is EG 2 (it drives the LPF cutoff, normal n22, and the VCA, n24); EG 1 is
// heard through its pitch amount, which encoder 7 (CC 19) sets.
//
//   CC_SLOTS                     { cc: 'module.key' } on the Panel tab
//   ENGINE_ENV                   { cc: key } re-aimed at the played engine's own envelope
//   ccTarget(cc, played, faceOf) -> 'module.key' | null
//   ccValue(value, param)        -> the control's value at position value / 127
//   midiCc(cc, value, deps)      -> { cid, value, text } | null    (applies it)

import { fromNorm, formatValue } from '../ui/synth/knob.js';
import { GESTURE_IDLE_MS } from '../ui/synth/feel.js';

export const CC_SLOTS = Object.freeze({
  1: 'vco1.vco-mg', 7: 'out.level',
  74: 'lpf.frequency', 71: 'lpf.Q', 76: 'mg.rate', 77: 'lpf.lpf-mg', 93: 'mg.morph',
  18: 'lpf.lpf-eg2', 19: 'vco1.vco-eg1', 16: 'hpf.frequency', 17: 'hpf.Q',
  73: 'eg2.attack', 75: 'eg2.decay', 79: 'eg2.sustain', 72: 'eg2.release',
  80: 'eg1.attack', 81: 'eg1.decay', 82: 'eg1.sustain', 83: 'eg1.release',
  85: 'out.level',
});

/** The filter-envelope faders play the chosen engine's own envelope on the Engines tab. */
export const ENGINE_ENV = Object.freeze({ 73: 'attack', 75: 'decay', 79: 'sustain',
  72: 'release' });

/** The control a controller number edits while `played` (a module id) plays, or null. */
export function ccTarget(cc, played, faceOf) {
  const key = ENGINE_ENV[cc];
  if (key && played && played !== 'keys'
    && faceOf(played).some((c) => c.key === key && c.kind === 'knob')) return `${played}.${key}`;
  return CC_SLOTS[cc] || null;
}

/** The value at position `value` / 127 along the control's range (its scale included). */
export function ccValue(value, param) {
  return fromNorm(Math.min(127, Math.max(0, Number(value) || 0)) / 127, param);
}

// One open undo burst per store (a page has one).
const bursts = new WeakMap();

/**
 * Apply CC `cc` = `value` (0-127). deps: { faceOf, played, controlOf, setControl, handle }.
 * A control that is missing from the document, a switch or a cable is left alone (null).
 */
export function midiCc(cc, value, { faceOf, played, controlOf, setControl, handle }) {
  const cid = ccTarget(cc, played(), faceOf);
  const x = cid && controlOf(cid);
  if (!x || !x.node || (x.c.kind !== 'knob' && x.c.kind !== 'amount')) return null;
  const store = handle();
  let b = bursts.get(store);
  if (!b || b.cid !== cid) {
    if (b) { clearTimeout(b.timer); store.endGesture(); }
    b = { cid, timer: 0 };
    bursts.set(store, b);
    store.beginGesture(`Změnit ${x.mid.toUpperCase()} ${x.c.label} (MIDI CC ${cc})`);
  }
  clearTimeout(b.timer);
  b.timer = setTimeout(() => { bursts.delete(store); store.endGesture(); }, GESTURE_IDLE_MS);
  const v = ccValue(value, x.c.param);
  const r = setControl(cid, v);
  if (!r || r.ok === false) return null;
  const name = `${x.mid.toUpperCase()} ${x.c.label}`;
  return { cid, value: v, text: `CC ${cc} → ${name}: ${formatValue(v, x.c.param)}` };
}

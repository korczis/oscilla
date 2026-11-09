// The Record switch (plan K223): one component wherever a notes clip is edited by the step-grid
// kind, the Synth's Drums tab beside its Play and the Studio Inspector's step grid. A native
// button with role=switch and aria-checked; the R key presses it (ui/keys/clients.js
// 'notes.record', listed in the Keyboard shortcuts dialog). It arms the transport's one recorder
// (studio/notes-record.js recorderOf) for the shown clip: while the timeline plays, every live
// note the router delivers to the clip's target is taken, and the take is written as one undoable
// CLIP_UPDATE when Record is switched off or the transport stops. Czech (Q104).
//
//   recordSwitchHtml(cls) -> markup of the switch (the caller's Pro button classes)
//   bindRecordSwitch(btn, { transport, store, clipId, say }) -> { sync(), destroy() }
//     transport() -> the Studio transport or null; store { getModel, dispatch }; clipId() -> id;
//     say(text) the caller's polite announcement

import { recorderOf } from '../../studio/notes-record.js';

/** Czech count of hits: 1 úder, 2-4 údery, 5 and more úderů (review R2-K223-2). */
export const hitsText = (n) => `${n} ${n === 1 ? 'úder' : n >= 2 && n <= 4 ? 'údery' : 'úderů'}`;

export const RECORD_TEXT = Object.freeze({
  label: 'Nahrávat',
  on: 'Nahrávání zapnuto: údery z padů a kláves se zapíší do klipu, když transport hraje.',
  off: 'Nahrávání vypnuto.',
  // The take is said when it is written: at Stop, or when Record goes off (review R2-K223-1).
  written: (n) => `Záznam zapsán: ${hitsText(n)}, jedna úprava.`,
  noTransport: 'Nahrávat lze až se zvukem Studia: stiskněte Přehrát.',
});

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function recordSwitchHtml(cls) {
  return `<button type="button" role="switch" aria-checked="false" aria-keyshortcuts="R" `
    + `data-notes-record="" class="${esc(cls)}">${RECORD_TEXT.label}</button>`;
}

export function bindRecordSwitch(btn, { transport, store, clipId, say = () => {} }) {
  let rec = null;
  let off = null;
  const recorder = () => {
    const t = transport();
    if (!rec && t) {
      rec = recorderOf(t, store);
      off = rec.on(onEvent);
    }
    return rec;
  };
  // sync reads the recorder only once a press took it: transport() may set audio up (the Synth's
  // does), which only a user gesture may do on a phone (project.a-phone-sounds).
  function sync() {
    btn.setAttribute('aria-checked', String(!!(rec && rec.armed && rec.clipId === clipId())));
  }
  // A take written for this switch's clip is said where it happens; switched off with hits
  // pending, the take sentence carries the off state too, so one message says both.
  let switching = false;
  function onEvent(e) {
    sync();
    if (!e || e.type !== 'take') return;
    // Two switches may share the recorder (the Drums tab, the Studio Inspector): the one shown
    // says it, once.
    if (!btn.isConnected || !btn.getClientRects().length) return;
    say(e.reason === 'disarm' && switching ? `${RECORD_TEXT.written(e.n)} ${RECORD_TEXT.off}`
      : RECORD_TEXT.written(e.n));
  }
  const onClick = () => {
    const r = recorder();
    if (!r) {
      say(RECORD_TEXT.noTransport);
      return;
    }
    const on = r.armed && r.clipId === clipId();
    const pending = r.pending;
    switching = true;
    try { r.toggle(clipId()); } finally { switching = false; }
    sync();
    if (!on) say(RECORD_TEXT.on);
    else if (!pending) say(RECORD_TEXT.off);
  };
  btn.addEventListener('click', onClick);
  sync();
  return {
    sync,
    destroy() {
      btn.removeEventListener('click', onClick);
      if (off) off();
    },
  };
}

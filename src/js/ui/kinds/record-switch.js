// The Record switch (plan K223): one component wherever a notes clip is edited by the step-grid
// kind, the Synth's Drums tab beside its Play and the Studio Inspector's step grid. A native
// button with role=switch and aria-checked; the R key presses it (ui/keys/clients.js
// 'notes.record', listed in the Keyboard shortcuts dialog). It arms the transport's one recorder
// (studio/notes-record.js recorderOf) for the shown clip: while the timeline plays, every live
// note the router delivers to the clip's target is taken, and the take is written as one undoable
// CLIP_UPDATE when Record is switched off or the transport stops. Czech (Q104).
//
//   recordSwitchHtml(cls) -> markup of the switch (the caller's Pro button classes)
//   bindRecordSwitch(btn, { transport, store, clipId, say, text }) -> { sync(), destroy() }
//     transport() -> the Studio transport or null; store { getModel, dispatch }; clipId() -> id;
//     say(text) the caller's polite announcement; text: the sentences (RECORD_TEXT, or
//     PAD_RECORD_TEXT for a pad's switch, K231: clipId() -> padTakeId(nodeId), the take
//     written as automation of the pad's own X and Y)

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

/** Czech count of a take's automation points: 1 bod, 2-4 body, 5 and more bodů (K231). */
export const pointsText = (n) => `${n} ${n === 1 ? 'bod' : n >= 2 && n <= 4 ? 'body' : 'bodů'}`;

export const PAD_RECORD_TEXT = Object.freeze({
  ...RECORD_TEXT,
  on: 'Nahrávání zapnuto: tahy padu se zapíší jako automatizace jeho X a Y, když transport '
    + 'hraje.',
  written: (n) => `Záznam zapsán: ${pointsText(n)} automatizace, jedna úprava.`,
  refused: 'Pad se nahrává jen při přehrávání: stiskněte Přehrát.',
});

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function recordSwitchHtml(cls) {
  return `<button type="button" role="switch" aria-checked="false" aria-keyshortcuts="R" `
    + `data-notes-record="" class="${esc(cls)}">${RECORD_TEXT.label}</button>`;
}

export function bindRecordSwitch(btn, { transport, store, clipId, say = () => {},
  text = RECORD_TEXT }) {
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
    // A pad touch while the timeline does not play (K231): said by the pad's switch armed.
    if (e && e.type === 'refused' && text.refused && rec.clipId === clipId()) {
      say(text.refused);
      return;
    }
    if (!e || e.type !== 'take') return;
    // Two switches may share the recorder (the Drums tab, the Studio Inspector): the one shown
    // says it, once.
    if (!btn.isConnected || !btn.getClientRects().length) return;
    say(e.reason === 'disarm' && switching ? `${text.written(e.n)} ${text.off}`
      : text.written(e.n));
  }
  const onClick = () => {
    const r = recorder();
    if (!r) {
      say(text.noTransport);
      return;
    }
    const on = r.armed && r.clipId === clipId();
    const pending = r.pending;
    switching = true;
    try { r.toggle(clipId()); } finally { switching = false; }
    sync();
    if (!on) say(text.on);
    else if (!pending) say(text.off);
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

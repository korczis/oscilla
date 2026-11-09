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

export const RECORD_TEXT = Object.freeze({
  label: 'Nahrávat',
  on: 'Nahrávání zapnuto: údery z padů a kláves se zapíší do klipu, když transport hraje.',
  off: (n) => (n ? `Nahrávání vypnuto: ${n} úderů zapsáno jako jedna úprava.`
    : 'Nahrávání vypnuto: nic nezapsáno.'),
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
      off = rec.on(sync);
    }
    return rec;
  };
  // sync reads the recorder only once a press took it: transport() may set audio up (the Synth's
  // does), which only a user gesture may do on a phone (project.a-phone-sounds).
  function sync() {
    btn.setAttribute('aria-checked', String(!!(rec && rec.armed && rec.clipId === clipId())));
  }
  const onClick = () => {
    const r = recorder();
    if (!r) {
      say(RECORD_TEXT.noTransport);
      return;
    }
    const on = r.armed && r.clipId === clipId();
    const n = r.pending;
    r.toggle(clipId());
    sync();
    say(on ? RECORD_TEXT.off(n) : RECORD_TEXT.on);
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

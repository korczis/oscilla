// The Studio timeline's Play and Stop beside a Record switch: the one implementation of that
// toolbar control (plan K231; the owner's order of 2026-11-04, one implementation per control
// kind), used by the Drums tab's bar and by pad L under the Synth face, whose take records only
// while the timeline plays (the status bar's Play is the instrument's, ADR 0050). The rule
// (review R2-K222-5): the timeline runs iff the transport plays and is not merely armed (a
// strike or a touch arms it, K104), so a press then starts the timeline and never disarms it.
// The label follows the caller's playhead() (the Drums tab reads it every frame), else the
// transport's state events once a press has reached the transport. Czech (Q104).
//
//   TIMELINE_PLAY_TEXT                         { play, stop }
//   PLAY_BUTTON, RECORD_BUTTON                 the Pro button classes of the pad's toolbar
//   timelinePlayHtml({ hook = 'data-pad-play', playing = false }) -> the button's markup
//   bindTimelinePlay(btn, { transport, say, playhead, onChange }) -> { sync(), destroy() }
//     transport() -> the Studio transport or null (called on a press only: the Synth may set
//     audio up there, which a phone allows on a user gesture, project.a-phone-sounds);
//     playhead() -> the transport's playhead or null, read without setting audio up (optional);
//     onChange() after a press

export const TIMELINE_PLAY_TEXT = Object.freeze({ play: 'Přehrát', stop: 'Zastavit' });

export const PLAY_BUTTON = 'inline-flex h-11 items-center rounded-lg bg-primary-600 px-4 '
  + 'text-sm font-medium text-white hover:bg-primary-700 focus:outline-none '
  + 'focus-visible:ring-2 focus-visible:ring-primary-300';
export const RECORD_BUTTON = 'inline-flex h-11 items-center gap-1 rounded-lg border '
  + 'border-solid border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 '
  + 'hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 '
  + 'aria-checked:border-red-600 aria-checked:text-red-700 dark:border-gray-600 '
  + 'dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700';

export function timelinePlayHtml({ hook = 'data-pad-play', playing = false } = {}) {
  return `<button type="button" class="${PLAY_BUTTON}" ${hook}="" aria-pressed="${playing}">`
    + `${playing ? TIMELINE_PLAY_TEXT.stop : TIMELINE_PLAY_TEXT.play}</button>`;
}

export function bindTimelinePlay(btn, { transport, say = () => {}, playhead = null,
  onChange = null }) {
  let t = null;
  let off = null;
  function sync() {
    const ph = playhead ? playhead()
      : t && typeof t.playhead === 'function' ? t.playhead() : null;
    const on = !!(ph && ph.playing);
    btn.textContent = on ? TIMELINE_PLAY_TEXT.stop : TIMELINE_PLAY_TEXT.play;
    btn.setAttribute('aria-pressed', String(on));
  }
  const onClick = () => {
    t = transport();
    if (!t) return;
    if (!off && typeof t.on === 'function') {
      off = t.on((type) => {
        if (type === 'state') sync();
      });
    }
    const r = t.playing && !t.armed ? t.stop() : t.start();
    if (r && r.ok === false && r.reason) say(r.reason, true);
    sync();
    if (onChange) onChange();
  };
  btn.addEventListener('click', onClick);
  return {
    sync,
    destroy() {
      btn.removeEventListener('click', onClick);
      if (off) off();
    },
  };
}

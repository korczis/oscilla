// One sentence into a live region's text (U144). A screen reader speaks a polite live region
// when its text changes, so the same sentence written twice is heard once: the second write
// changes nothing. say() writes a new sentence at once; a sentence equal to the text the region
// holds is re-armed instead, the region emptied now and filled again in the next frame, so a
// sentence that legitimately repeats (a new event) is spoken again through the same region.
//
//   say(target, text, { key = 'announceText', defer = nextFrame }) -> true when it announces
//
// `target[key]` is the region's bound text (the status bar's status.announce reads the
// component's announceText; the playback bus says its leave and stop sentences through it). A
// newer write before the deferred fill wins: the fill happens only while the region is still
// empty. No imports: every layer may use it.

/** fn in the next animation frame, or in a later task where there are no frames (Node). */
export function nextFrame(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  else setTimeout(fn, 0);
}

/** Announce `text` through the live region bound to target[key] (see above). */
export function say(target, text, { key = 'announceText', defer = nextFrame } = {}) {
  const t = text === null || text === undefined ? '' : String(text);
  if (!target || !t) return false;
  if (target[key] !== t) {
    target[key] = t;
    return true;
  }
  target[key] = '';
  defer(() => { if (target[key] === '') target[key] = t; });
  return true;
}

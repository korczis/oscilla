// A jack held in place on the screen across a patch (JC-10, the Synth look audit): connecting
// re-draws the bay, shrinks the status line above it and hides the connection list below it, so
// the browser's scroll anchoring lost the jack and the view jumped (the patched jack 96 px down
// on a phone). holdJack measures the jack before the change and, in each of the next two frames
// (the page laid out, then the status line), scrolls its scroller by the distance the jack moved.
//
//   holdJack(host, key, change, { frame }) -> whatever change() returns

/** The nearest ancestor that scrolls (the page's own scroller when none does). */
function scrollerOf(el) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(e).overflowY)) return e;
  }
  return document.scrollingElement;
}

export function holdJack(host, key, change, { frame = requestAnimationFrame } = {}) {
  const top = () => {
    const j = host && host.querySelector(`[data-jack="${key}"]`);
    return j ? j.getBoundingClientRect().top : null;
  };
  const before = top();
  const scroller = before === null ? null : scrollerOf(host);
  // The browser's own scroll anchoring would fight the correction: off while the jack is held.
  const anchor = scroller && scroller.style ? scroller.style.overflowAnchor : null;
  if (scroller && scroller.style) scroller.style.overflowAnchor = 'none';
  const out = change();
  // Twice, a frame apart: the status line above the bay follows the change a frame later.
  const settle = (left) => frame(() => {
    const after = top();
    if (after !== null && after !== before) scroller.scrollTop += after - before;
    if (left > 1) settle(left - 1);
    else if (scroller.style) scroller.style.overflowAnchor = anchor;
  });
  if (scroller) settle(2);
  return out;
}

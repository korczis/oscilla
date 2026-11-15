'use strict';
/**
 * The page-side meter for K184's same-task tap checks (iphone.cjs tap-same-task, synth.cjs s-tap).
 *
 * A same-task tap sounds for tens of ms, shorter than a probe's round trip, so the page itself
 * measures every frame:
 *   - window.__tapNow: the engine analyser's RMS (dB) now, for "the output is quiet"; -Infinity
 *     when the engine has no output graph yet (nothing can sound), set by a real tick, never
 *     assumed before one;
 *   - window.__tapMax: the loudest RMS of any 2048-sample window of the output since the last
 *     markTap, for "the tap was heard".
 * "Heard" reads a second analyser fed from the engine's (an AnalyserNode passes its input on)
 * with the longest buffer, 32768 samples (0.74 s at 44.1 kHz, 0.68 s at 48 kHz), over only the
 * samples after the tap's own context time. A frame that stalls longer than the engine
 * analyser's window (linux WebKit on CI measured 408 ms; the engine analyser holds 186 ms) can
 * therefore not miss a tap, and a tap is never credited with the one before it.
 *
 * The second analyser is attached synchronously, by window.__tapAttach(), in the same task as
 * the tap (the caller's page function calls it right after dispatching the tap) and at markTap.
 * A tap that builds the engine's analyser (a surface's first note) is therefore measured from
 * its first render quantum, not from the next frame (review R2-TAP-1, oscilla-c3).
 *
 * All are page functions: pass them to page.evaluate. watchTaps resolves after its first tick.
 */

/** In the page: start the meter; resolves once a tick has measured. */
function watchTaps() {
  const m = { w: null, from: null, wt: null, t: null };
  window.__tapMax = -Infinity;
  window.__tapNow = undefined;
  window.__tapAt = Infinity;
  window.__tapAttach = () => {
    const e = window.OSCILLA.engine;
    const a = e && e.analyser;
    if (!a || m.from === a) return Boolean(a);
    m.w = a.context.createAnalyser();
    m.w.fftSize = 32768;
    a.connect(m.w);
    m.from = a;
    m.wt = new Float32Array(m.w.fftSize);
    return true;
  };
  return new Promise((resolve) => {
    const tick = () => {
      const e = window.OSCILLA.engine;
      const a = e && e.analyser;
      if (!a) {
        window.__tapNow = -Infinity;
      } else {
        window.__tapAttach();
        if (!m.t || m.t.length !== a.fftSize) m.t = new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(m.t);
        let s = 0;
        for (const x of m.t) s += x * x;
        window.__tapNow = 10 * Math.log10(s / m.t.length + 1e-24);
        m.w.getFloatTimeDomainData(m.wt);
        const wt = m.wt;
        const since = (a.context.currentTime - window.__tapAt) * a.context.sampleRate;
        const n = Math.min(wt.length, Math.max(0, Math.ceil(since) + 128));
        const span = Math.min(2048, n);
        for (let end = wt.length; span > 0 && end - span >= wt.length - n; end -= 1024) {
          let q = 0;
          for (let i = end - span; i < end; i += 1) q += wt[i] * wt[i];
          window.__tapMax = Math.max(window.__tapMax, 10 * Math.log10(q / span + 1e-24));
        }
      }
      resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** In the page: a tap starts now; "heard" counts only the output after this context time. */
function markTap() {
  window.__tapMax = -Infinity;
  window.__tapAttach();
  const e = window.OSCILLA.engine;
  window.__tapAt = e && e.analyser ? e.analyser.context.currentTime : -Infinity;
}

module.exports = { watchTaps, markTap };

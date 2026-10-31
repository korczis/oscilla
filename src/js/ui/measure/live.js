// MEASURE workspace (src/js/ui/measure.js): the live RTA of the RTA tab (spec §44-§49): one
// tap on the measurement input, the analysis of measurement/live-rta.js on the shared frame
// loop, and every path that stops it and releases the input. Nothing of it is stored.

import { MEASUREMENT_STATES as S } from '../../measurement/state-machine.js';
import { mapError, MEASUREMENT_ERRORS } from '../../measurement/engine.js';
import { createLiveRta } from '../../measurement/live-rta.js';
import { createAnalyserReader } from '../../analysis/analyser.js';
import { onFrame } from '../../charts/frame-loop.js';
import { LIVE_VIEW_INTERVAL_MS } from './constants.js';

/** The live functions over `ctx`; `ops` holds those of the other parts. */
export function createLive(ctx, svc, ops) {
  // ---------------------------------------------------------------- live RTA
  function liveTick(now) {
    const L = ctx.live;
    if (!L) return;
    const dt = L.lastAt === null ? 0 : Math.max(0, (now - L.lastAt) / 1000);
    L.lastAt = now;
    if (!L.rta.frozen) L.rta.push(L.reader.readTime(now), dt);
    if (ctx.charts.rta) ctx.charts.rta.redraw();
    if (now >= L.nextViewAt) {
      L.nextViewAt = now + LIVE_VIEW_INTERVAL_MS;
      ops.rebuildRta();
    }
  }

  function endLive(L) {
    ctx.live = null;
    if (L.off) L.off();
    const m = ctx.cmp.meas;
    m.rtaLive.running = false;
    m.rtaLive.kind = null;
    m.rtaFrozen = ctx.rta ? ctx.rta.averager.frozen : false;
    ops.announce({ politeness: 'polite', text: 'Live RTA stopped' });
    ops.rebuildRta();
  }

  /** The io closed the tap by itself (page hide, track ended, a measurement, dispose). */
  function liveClosed(token, reason) {
    const L = ctx.live;
    if (!L || L.token !== token || L.closing) return; // stopLive() is already cleaning up
    endLive(L);
    if (reason === 'track-ended') {
      ctx.cmp.meas.rtaLive.error = 'Live RTA stopped: the input device was disconnected or '
        + 'stopped.';
    }
  }

  /** Stop the live RTA (or its pending start); true when something was stopped. */
  function stopLive() {
    let stopped = false;
    if (ctx.liveStarting) {
      ctx.liveToken += 1; // the pending start sees a stale token and closes what it opened
      ctx.liveStarting = false;
      if (ctx.cmp) ctx.cmp.meas.rtaLive.starting = false;
      if (ctx.io) ctx.io.cancel();
      stopped = true;
    }
    const L = ctx.live;
    if (!L) return stopped;
    L.closing = true;
    try { L.tap.close(); } catch (e) { /* already released */ }
    endLive(L);
    return true;
  }

  function liveAnalysis(m, sampleRate) {
    return createLiveRta({ sampleRate, fftSize: m.view.rtaFftSize, window: m.view.rtaWindow,
      mode: m.view.rtaMode, averaging: m.view.rtaAveraging, ...ops.liveCalibration(m) });
  }

  /** A new frame length or window: resize the tap's analyser, restart the analysis. */
  function reconfigureLive(m) {
    const L = ctx.live;
    if (!L) return;
    if (L.tap.analyser.fftSize !== m.view.rtaFftSize) L.tap.analyser.fftSize = m.view.rtaFftSize;
    L.rta = liveAnalysis(m, L.rta.sampleRate); // the reader follows the analyser's fftSize
    L.lastAt = null;
    m.rtaFrozen = false;
    ops.rebuildRta();
  }

  async function startLive(cmp) {
    const m = cmp.meas;
    if (ctx.live || ctx.liveStarting || !m.rtaLive.available) return false;
    m.rtaLive.error = null;
    if (m.busy) {
      m.rtaLive.error = MEASUREMENT_ERRORS.BUSY;
      return false;
    }
    const me = ops.ensureEngine();
    if (me.state === S.READY) me.reset(); // a checked setup keeps the input open: release it
    svc.engine.init(); // in the user gesture (autoplay policy)
    const token = ++ctx.liveToken;
    ctx.liveStarting = true;
    m.rtaLive.starting = true;
    const kind = ctx.ioKind;
    try {
      const tap = await ctx.io.openLiveTap({ fftSize: m.view.rtaFftSize,
        onClosed: (reason) => liveClosed(token, reason) });
      if (token !== ctx.liveToken) {
        tap.close();
        return false;
      }
      const rta = liveAnalysis(m, tap.sampleRate);
      const L = { token, tap, rta, kind, lastAt: null, nextViewAt: 0, off: null, closing: false,
        reader: createAnalyserReader(tap.analyser, { sampleRate: tap.sampleRate }) };
      ctx.live = L;
      m.rtaLive.running = true;
      m.rtaLive.kind = kind;
      m.rtaFrozen = false;
      ops.announce({ politeness: 'polite', text: 'Live RTA started' });
      ops.rebuildRta();
      L.off = onFrame(liveTick);
      ops.inputOpened(null);
      return true;
    } catch (e) {
      if (token === ctx.liveToken) {
        const err = mapError(e, 'NO_INPUT');
        if (err.code !== 'ABORTED') m.rtaLive.error = err.message;
      }
      return false;
    } finally {
      if (token === ctx.liveToken) {
        ctx.liveStarting = false;
        m.rtaLive.starting = false;
      }
    }
  }

  return {
    liveTick, endLive, liveClosed, stopLive, liveAnalysis, reconfigureLive, startLive,
  };
}

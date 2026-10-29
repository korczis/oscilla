// Control drives of the browser suites (C020, finding control-census-5): a control is operated
// the way a user operates it (a click, a key, a typed value committed with Enter, a slider moved
// by pointer or by keyboard, a select), and its effect is then polled, against a wall-clock
// deadline that names the control (rule project.bounded-test-timing), at the subsystem it
// drives (the AudioEngine voice and its output level, a lab stage, the instrument state) and at
// a view that reflects it (a readout, a chart, a status-bar text, an aria state).
//
//   const drive = require('./lib/control-drive.cjs');
//   const res = await drive.rows(page, 'filter', [
//     { control: '#osc-filter-q-value', how: 'pointer', hz: [1000], steady: 1000,
//       act: drive.D.type('#osc-filter-q-value', '20'),
//       expect: (s) => drive.near(s.filter.Q, 20, 0.01),          // the lab stage
//       view: (s) => s.text.filterQ === '20',                     // the field, reformatted
//       sound: (s, b) => b.db[1000] - s.db[1000] > 15 },          // the engine output
//   ], { run });
//
// A row's `expect`, `view` and `sound` all hold in the same poll before the row passes. Output
// levels are read on the engine's post-chain analyser with a Goertzel filter at the requested
// frequency, at the context's own sample rate, so neither the analyser's smoothing nor the
// host's frame rate decides the result.
'use strict';

const { until } = require('./wait.cjs');

const ROW_MS = 10000;   // one row's effect: a glide is 15-50 ms of audio, a starved host is slow
const STEADY_MS = 10000;
const MSG_CHARS = 240; // characters of a failure message kept in the report

const near = (x, y, tol) => typeof x === 'number' && Math.abs(x - y) <= tol;

/**
 * In-page: everything a row may judge, read in one evaluate (plain values only). `hz` lists
 * the frequencies whose level (dB re full scale) is read from the engine analyser into `db`.
 */
function readState(hz) {
  const O = window.OSCILLA;
  const a = O.app;
  const e = O.engine;
  const L = O.labs;
  const v = e.voice && !e.voice.ended ? e.voice : null;
  const q = (s) => document.querySelector(s);
  const txt = (s) => (q(s) ? q(s).textContent.replace(/\s+/g, ' ').trim() : null);
  const val = (s) => (q(s) ? q(s).value : null);
  const at = (s, n) => (q(s) ? q(s).getAttribute(n) : null);
  const toneDb = (f) => {
    const an = e.analyser;
    if (!an || !e.ctx) return -240;
    const n = an.fftSize;
    const x = new Float32Array(n);
    an.getFloatTimeDomainData(x);
    const w = (2 * Math.PI * f) / e.ctx.sampleRate;
    let re = 0;
    let im = 0;
    let ws = 0;
    for (let i = 0; i < n; i++) {
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      ws += h;
      re += x[i] * h * Math.cos(w * i);
      im -= x[i] * h * Math.sin(w * i);
    }
    return 20 * Math.log10((2 * Math.hypot(re, im)) / ws + 1e-12);
  };
  const rms = (an) => {
    if (!an) return null;
    const x = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(x);
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    return Math.sqrt(s / x.length);
  };
  const db = {};
  for (const f of hz || []) db[f] = toneDb(f);
  const router = O.adapter.getStereoRouter ? O.adapter.getStereoRouter() : null;
  const filterChartAt = (f) => {
    try {
      const { x, y } = L.filter.chart.getData();
      let k = 0;
      for (let i = 1; i < x.length; i++) if (Math.abs(x[i] - f) < Math.abs(x[k] - f)) k = i;
      return y[k];
    } catch (err) {
      return null;
    }
  };
  const spg = L.spectrogram && L.spectrogram.view;
  const axesHash = (host) => {
    // The canvases of a chart host other than its plot: the drawn axes and their labels.
    if (!host) return null;
    const plot = spg ? spg.plotCanvas : null;
    let h = 0;
    for (const c of host.querySelectorAll('canvas')) {
      if (c === plot) continue;
      const d = c.toDataURL();
      for (let i = 0; i < d.length; i += 7) h = (h * 31 + d.charCodeAt(i)) | 0;
    }
    return h;
  };
  const ctx = e.ctx;
  // The loudest bin of the engine analyser, at the context's own rate.
  const peakHz = (() => {
    const an = e.analyser;
    if (!an || !ctx) return null;
    const f = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(f);
    let k = 1;
    for (let i = 2; i < f.length; i++) if (f[i] > f[k]) k = i;
    return f[k] > -90 ? (k * ctx.sampleRate) / an.fftSize : null;
  })();
  // The frequency the instrument's current plan starts at (what the engine is handed).
  const planStart = (() => {
    try {
      const r = a.currentPlan();
      return r && r.ok ? O.planFreqAt(r.plan, 0) : null;
    } catch (err) {
      return null;
    }
  })();
  const mic = L.mic && L.mic.chart ? L.mic.chart.options : null;
  const add = L.additive;
  return {
    workspace: a.workspace,
    now: ctx ? ctx.currentTime : 0,
    peakHz,
    planStart,
    app: { source: a.source, waveform: a.waveform, frequency: a.frequency,
      gainLevel: a.gainLevel, inputMode: a.inputMode, playing: a.playing, latched: a.latched,
      continuous: a.continuousAllowed, safetyLimit: Number(a.safetyLimit), duration: a.duration,
      attack: a.attack, release: a.release, a4: a.a4, rangeMode: a.rangeMode,
      rangeMin: a.rangeMin, rangeMax: a.rangeMax, seqPlaying: a.seqPlaying,
      sweep: { ...a.sweep }, dual: JSON.parse(JSON.stringify(a.dual)),
      envelopeFlag: !!(a.labFlags && a.labFlags.envelope) },
    engine: { gain: e.gainLevel, nodes: e.activeNodeCount, router: !!router,
      lr: router ? { l: rms(router.analyserL), r: rms(router.analyserR) } : null,
      voice: v ? { t0: v.t0, type: v.plan.type, attack: v.attack, release: v.release,
        wave: v.carrier ? v.carrier.type : null,
        freq: v.carrier ? v.carrier.frequency.value : null,
        len: Number.isFinite(v.deadline) ? v.deadline - v.t0 : null,
        limited: !!v.limited, periodicWave: !!v.periodicWave,
        adsr: v.adsr ? { ...v.adsr } : null,
        a: v.live && v.live.A ? { f: v.live.A.osc.frequency.value, g: v.live.A.g.gain.value,
          wave: v.live.A.osc.type } : null,
        b: v.live && v.live.B ? { f: v.live.B.osc.frequency.value, g: v.live.B.g.gain.value,
          wave: v.live.B.osc.type } : null } : null },
    db,
    filter: L.filter ? { ...L.filter.config, chart1k: filterChartAt(1000) } : null,
    envelope: L.envelope ? { on: L.envelope.enabled, ...L.envelope.adsr,
      graph: L.envelope.graph ? { ...L.envelope.graph.adsr } : null } : null,
    additive: add ? { on: add.enabled, selected: add.selected,
      partials: JSON.parse(JSON.stringify(add.partials)),
      // The table that plays (peak-normalised, handed to createPeriodicWave), as drawn.
      coeffs: add.coefficients().map((c) => ({ n: c.n, db: +c.gainDb.toFixed(3),
        deg: Math.round(c.phaseDeg) })),
      bars: add.chart ? add.chart.getBars().map((x) => +x.gainDb.toFixed(3)).join(',') : null }
      : null,
    phase: L.phase ? { ...L.phase.config } : null,
    spectrogram: spg ? { span: spg.options.timeSpanS, scale: spg.options.scale,
      axes: axesHash(q('#osc-chart-spectrogram')) } : null,
    mic: mic ? { averagingS: mic.averagingS, peakHold: mic.peakHold,
      active: !!L.mic.active } : null,
    dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => d.id),
    text: { freq: txt('#osc-freq-value'), freqAlt: txt('#osc-freq-alt'),
      gain: txt('#osc-gain-value'), sbFreq: txt('[data-osc="status.frequency"]'),
      sbWave: txt('[data-osc="status.waveform"]'), sbGain: txt('[data-osc="status.gain"]'),
      sbDuration: txt('[data-osc="status.duration"]'), corr: txt('#osc-corr-value'),
      beat: txt('[data-osc="dual.beat"]'), rangeMin: txt('[data-osc="source.rangeMin"]'),
      rangeMax: txt('[data-osc="source.rangeMax"]'),
      filterCutoff: val('#osc-filter-cutoff-value'), filterQ: val('#osc-filter-q-value'),
      envAttack: val('#osc-env-attack-value'), envDecay: val('#osc-env-decay-value'),
      envSustain: val('#osc-env-sustain-value'), envRelease: val('#osc-env-release-value'),
      addGain: val('#osc-add-gain-value'), addPhase: val('#osc-add-phase'),
      addHarmonic: val('#osc-add-harmonic'), dualAFreq: val('#osc-dual-a-freq'),
      dualBFreq: val('#osc-dual-b-freq'), stereoFa: val('#osc-stereo-fa'),
      stereoFb: val('#osc-stereo-fb'), setDuration: val('#osc-set-duration'),
      setAttack: val('#osc-set-attack'), setRelease: val('#osc-set-release') },
    aria: { filterGain: at('#osc-filter-gain', 'aria-valuetext'),
      filterCutoff: at('#osc-filter-cutoff', 'aria-valuetext'),
      filterQ: at('#osc-filter-q', 'aria-valuetext'),
      envOn: at('#osc-env-enable', 'aria-pressed'),
      envAttack: at('#osc-env-attack', 'aria-valuetext'),
      envDecay: at('#osc-env-decay', 'aria-valuetext'),
      envRelease: at('#osc-env-release', 'aria-valuetext'),
      envSustain: val('#osc-env-sustain'), addGain: at('#osc-add-gain', 'aria-valuetext'),
      cont: at('#osc-continuous-toggle', 'aria-checked'),
      stereoPan: at('#osc-stereo-pan', 'aria-valuetext'),
      stereoMono: at('#osc-stereo-mono', 'aria-checked'),
      stereoSplit: at('#osc-stereo-split', 'aria-checked'),
      dualAGain: at('#osc-dual-a-gain', 'aria-valuetext'),
      dualBGain: at('#osc-dual-b-gain', 'aria-valuetext'),
      dualADetune: at('#osc-dual-a-detune', 'aria-valuetext'),
      dualBDetune: at('#osc-dual-b-detune', 'aria-valuetext'),
      dualLevelA: at('#osc-dual-level-a', 'aria-valuetext'),
      dualLevelB: at('#osc-dual-level-b', 'aria-valuetext'),
      micAverage: at('[data-osc="mic.average"]', 'aria-checked'),
      micPeakHold: at('[data-osc="mic.peakHold"]', 'aria-checked'),
      ftype: [...document.querySelectorAll('[data-osc="filter.type"]')]
        .filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.value)
        .join(',') },
  };
}

// ------------------------------------------------------------------------------ drivers
const D = {
  click: (sel) => async (page) => { await page.locator(sel).first().click(); },
  /** Focus, then one or more keys (the keyboard path of a button, radio, switch or slider). */
  keys: (sel, ...keys) => async (page) => {
    await page.locator(sel).first().focus();
    for (const k of keys) await page.keyboard.press(k);
  },
  /** A typed value committed with Enter (text fields commit on change). */
  type: (sel, text) => async (page) => {
    const l = page.locator(sel).first();
    await l.fill(text);
    await l.press('Enter');
  },
  /** Typed with the keyboard only: select all, type, Enter. */
  typeKeys: (sel, text) => async (page) => {
    await page.locator(sel).first().focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  },
  /** A slider moved by pointer: a click on the track at the fraction `at` of its width. */
  slide: (sel, at) => async (page) => {
    const l = page.locator(sel).first();
    await l.scrollIntoViewIfNeeded();
    const b = await l.boundingBox();
    await page.mouse.click(b.x + b.width * at, b.y + b.height / 2);
  },
  select: (sel, value) => async (page) => { await page.selectOption(sel, value); },
};

/** Wait until the level at `hz` is present and steady: two readings in a row within 0.5 dB. */
async function steady(page, hz, what) {
  let prev = null;
  let db = null;
  await until(async () => {
    db = (await page.evaluate(readState, [hz])).db[hz];
    const ok = prev !== null && db > -90 && Math.abs(db - prev) < 0.5;
    prev = db;
    return ok;
  }, { ms: STEADY_MS, what: `${what}: a steady tone at ${hz} Hz before the change`, every: 120 });
  return db;
}

/**
 * Run `rows` in order on one page. Each row: { control, how, setup?, act, expect, view,
 * sound?, hz?, steady?, after? }. Returns { ok, rows, failed: [{ control, how, error, ... }] }.
 */
async function rows(page, family, list, { run } = {}) {
  const failed = [];
  let n = 0;
  for (const row of list) {
    if (run && run.aborted) break;
    const name = `${family}: ${row.control} by ${row.how}`;
    let s = null;
    let b = null;
    try {
      if (row.setup) await row.setup(page);
      if (row.steady) await steady(page, row.steady, name);
      b = await page.evaluate(readState, row.hz || []);
      await row.act(page);
      await until(async () => {
        s = await page.evaluate(readState, row.hz || []);
        return row.expect(s, b) && row.view(s, b) && (!row.sound || row.sound(s, b));
      }, { ms: row.ms || ROW_MS, what: name });
      n++;
    } catch (e) {
      const part = (f) => { try { return s && b ? !!f(s, b) : null; } catch (x) { return null; } };
      failed.push({ control: row.control, how: row.how,
        subsystem: part(row.expect), view: part(row.view),
        sound: row.sound ? part(row.sound) : undefined,
        db: s ? s.db : undefined, dbBefore: b ? b.db : undefined,
        state: s && row.report ? row.report(s) : undefined,
        error: String(e && e.message ? e.message : e).split('\n')[0].slice(0, MSG_CHARS) });
    } finally {
      if (row.after) await row.after(page).catch(() => {});
    }
  }
  return { ok: failed.length === 0 && n === list.length, rows: list.length, passed: n, failed };
}

module.exports = { D, near, readState, rows, steady, ROW_MS };

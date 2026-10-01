#!/usr/bin/env node
// OSCILLA spec-conformance checks: targeted assertions against numbered spec sections.
// Dev-only, like smoke.cjs; the application itself has no dependencies.
//
//   npm --prefix tests install
//   node tests/spec.cjs                          # file:// index.html next to this folder
//   node tests/spec.cjs --url https://korczis.github.io/oscilla/
//   node tests/spec.cjs --browser firefox        # chromium (default) | firefox | webkit
//
// Exit code 0 only when every check passes.
'use strict';

const path = require('path');
const playwright = require('playwright');

const args = process.argv.slice(2);
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
const ENGINE = args.includes('--browser') ? args[args.indexOf('--browser') + 1] : 'chromium';
const BASE = urlArg || `file://${path.resolve(__dirname, '..', 'index.html')}`;
// Known third-party noise, not application errors (same list as smoke.cjs).
const IGNORED_CONSOLE = [
  /cdn\.tailwindcss\.com should not be used in production/,
  /Use of the (orientation|motion) sensor is deprecated/,
];

// The 31 nominal third-octave values from the spec (THIRD-OCTAVE PRESET).
const THIRD_OCTAVE = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];
// Spec LEARN MODE topic names → topic ids used by index.html.
const LEARN_IDS = {
  frequency: 'frequency',
  period: 'period',
  wavelength: 'wavelength',
  amplitude: 'amplitude',
  waveform: 'waveform',
  harmonic: 'harmonic',
  Nyquist: 'nyquist',
  'sample rate': 'samplerate',
  aliasing: 'aliasing',
  modulation: 'modulation',
  AM: 'am',
  FM: 'fm',
  interference: 'interference',
  beating: 'beating',
  'logarithmic frequency perception': 'logscale',
  'human hearing range': 'hearing',
  ultrasound: 'ultrasound',
  'speaker limitations': 'speakers',
};
const PRESET_SCHEMA_KEYS = [
  'version',
  'name',
  'mode',
  'pattern',
  'waveform',
  'frequency',
  'gain',
  'duration',
  'envelope',
  'range',
  'params',
  'dual',
  'cfg',
];

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    failures.push(`${name} ${detail}`);
    console.log(`  FAIL ${name} ${detail}`);
  }
}
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;
const b64url = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');

const consoleProblems = [];

async function ready(page) {
  await page.waitForFunction(
    () =>
      window.Alpine &&
      window.OSCILLA &&
      document.querySelector('[x-ref=vizCanvas] canvas') &&
      window.Alpine.$data(document.body).initialized,
    null,
    { timeout: 20000 },
  );
}

async function openPage(browser, opts = {}) {
  const { width = 1280, height = 900, hash = '', init = null, ctx = {} } = opts;
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: 'light',
    ...ctx,
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type())) return;
    if (IGNORED_CONSOLE.some((re) => re.test(m.text()))) return;
    consoleProblems.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleProblems.push(`[pageerror] ${e.message}`));
  await page.goto(`${BASE}${hash}`, { waitUntil: 'load' });
  await ready(page);
  return { context, page };
}

const app = (page, fn, arg) =>
  page.evaluate(
    ([src, a]) => {
      const data = window.Alpine.$data(document.body);
      const O = window.OSCILLA;
      return new Function('app', 'engine', 'O', 'arg', `return (${src})(app, engine, O, arg);`)(
        data,
        O.engine,
        O,
        a,
      );
    },
    [fn.toString(), arg],
  );

/** waitForFunction that reports false instead of throwing on timeout. */
async function waitTrue(page, fn, arg, timeout = 3000) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 'raf' });
    return true;
  } catch (e) {
    return false;
  }
}

const frameCount = (page) => page.evaluate(() => window.OSCILLA.viz.p5.frameCount);

async function main() {
  const t0 = Date.now();
  console.log(`OSCILLA spec-conformance test → ${BASE} (${ENGINE})`);
  const launch = {
    chromium: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
    firefox: {
      firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false },
    },
    webkit: {},
  }[ENGINE];
  const browser = await playwright[ENGINE].launch(launch);

  // ------------------------------------------------------------------ pure data
  {
    const { page, context } = await openPage(browser);

    console.log('§30 harmonics');
    const h = await page.evaluate(() => {
      const H = window.OSCILLA.harmonicTable;
      const nyq = 24000;
      const sine = H('sine', 1000, nyq).list.map((x) => x.n);
      const tri = H('triangle', 1000, nyq).list;
      const wrong = [];
      for (const w of ['sine', 'triangle', 'sawtooth', 'square']) {
        for (const f of [20, 100, 440, 1000, 5000, 8000, 12000, 15500, 20000]) {
          for (const x of H(w, f, nyq).list)
            if (x.below !== x.n * f < nyq) wrong.push(`${w}@${f} n=${x.n}`);
        }
      }
      const sq15 = H('square', 15500, nyq).list.find((x) => x.n === 3) || null;
      const sq20 = H('square', 20, nyq);
      return {
        sine,
        triN: tri.map((x) => x.n),
        triDb: tri.map((x) => x.db),
        tri3: (tri.find((x) => x.n === 3) || {}).db,
        wrong: wrong.slice(0, 6),
        sq15,
        sq20Below: sq20.below,
        sq20ListBelow: sq20.list.filter((x) => x.below).length,
      };
    });
    check(
      'sine has exactly one partial (the fundamental)',
      JSON.stringify(h.sine) === '[1]',
      JSON.stringify(h.sine),
    );
    check(
      'triangle contains only odd harmonics',
      h.triN.length > 1 && h.triN.every((n) => n % 2 === 1),
      JSON.stringify(h.triN),
    );
    check(
      'triangle dB strictly decreasing',
      h.triDb.every((d, i) => i === 0 || d < h.triDb[i - 1]),
      JSON.stringify(h.triDb.slice(0, 6)),
    );
    check('triangle 3f ≈ −19.08 dB (1/9)', near(h.tri3, -19.085, 0.01), String(h.tri3));
    check('every entry: below === (n·f < Nyquist)', h.wrong.length === 0, JSON.stringify(h.wrong));
    check(
      'square 15.5 kHz @48 kHz lists 3f (46.5 kHz) as above Nyquist',
      !!h.sq15 && h.sq15.below === false,
      JSON.stringify(h.sq15),
    ); // known bug — fixed in index.html
    // odd n with n·20 < 24000 → n ∈ {1, 3, …, 1199} → 600 harmonics
    check(
      'square 20 Hz @48 kHz: 600 odd harmonics below Nyquist',
      h.sq20Below === 600,
      `below=${h.sq20Below} listed=${h.sq20ListBelow}`,
    ); // known bug — fixed in index.html

    console.log('§33/§34 sweep presets and rates');
    const sw = await app(page, (a, e, O) => {
      const defaultCurve = a.sweep.curve;
      const out = {};
      for (const p of O.BUILTIN_PRESETS.filter((x) => x.cat === 'sweeps')) {
        a.loadPreset(p);
        out[p.name] = {
          start: a.sweep.start,
          end: a.sweep.end,
          ms: a.sweep.durationMs,
          curve: a.sweep.curve,
          source: a.source,
        };
      }
      const human = O.BUILTIN_PRESETS.find(
        (x) => x.cat === 'sweeps' && x.name === 'Human spectrum',
      );
      a.loadPreset(human);
      a.setMode('sweep');
      return {
        defaultCurve,
        out,
        hzs: a.sweepHzPerSec,
        octs: a.sweepOctPerSec,
        safeMax: a.safeMax,
      };
    });
    check('default sweep curve is logarithmic', sw.defaultCurve === 'log', sw.defaultCurve);
    const expect = {
      'Human spectrum': [20, 20000],
      'Speech-oriented range': [100, 8000],
      Presence: [2000, 6000],
      'High range': [8000, 18000],
      'Upper range': [12000, sw.safeMax],
      'Sub-bass': [20, 100],
      Bass: [40, 250],
    };
    for (const [name, [lo, hi]] of Object.entries(expect)) {
      const got = sw.out[name];
      check(
        `sweep preset “${name}” ${lo} → ${Math.round(hi)} Hz`,
        !!got && got.source === 'sweep' && near(got.start, lo, 1e-6) && near(got.end, hi, 0.01),
        JSON.stringify(got),
      );
    }
    const hum = sw.out['Human spectrum'];
    check(
      'Human spectrum is 10 s and logarithmic',
      !!hum && hum.ms === 10000 && hum.curve === 'log',
      JSON.stringify(hum),
    );
    check('20 Hz → 20 kHz over 10 s = 1998 Hz/s', near(sw.hzs, 1998, 0.01), String(sw.hzs));
    check(
      '20 Hz → 20 kHz over 10 s ≈ 0.9966 oct/s',
      near(sw.octs, Math.log2(1000) / 10, 1e-6),
      String(sw.octs),
    );
    await page.waitForFunction(
      () => document.querySelector('#rate-hz') && document.querySelector('#rate-hz').offsetParent,
    );
    const rates = await page.evaluate(() => [
      Number(document.querySelector('#rate-hz').value),
      Number(document.querySelector('#rate-oct').value),
    ]);
    check(
      'Hz/s and oct/s readouts show 1998 and 0.9966',
      near(rates[0], 1998, 0.5) && near(rates[1], 0.9966, 0.00051),
      JSON.stringify(rates),
    );

    console.log('§36 beating presets');
    const pairs = await page.evaluate(() =>
      window.OSCILLA.BUILTIN_PRESETS.filter((p) => p.cat === 'dual' && !p.requiresHeadphones).map(
        (p) => [p.cfg.dual.a.freq, p.cfg.dual.b.freq, p.cfg.source, !!p.cfg.dual.stereo],
      ),
    );
    const pairKey = JSON.stringify(
      pairs.map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0] || x[1] - y[1]),
    );
    check(
      'beating presets are exactly 440+441, 440+442, 440+445, 440+450, 1000+1002',
      pairKey ===
        JSON.stringify([
          [440, 441],
          [440, 442],
          [440, 445],
          [440, 450],
          [1000, 1002],
        ]),
      pairKey,
    );
    check(
      'beating presets are mono-mix dual presets',
      pairs.every(([, , s, st]) => s === 'dual' && !st),
      JSON.stringify(pairs),
    );

    console.log('§39 pattern presets');
    const pt = await app(page, (a, e, O) => {
      a.setMode('presets');
      const sweepBefore = JSON.stringify(a.sweep);
      const out = {};
      let sweepAfterHigh = null;
      for (const name of [
        'Short high tone',
        'Double pulse',
        'High sweep',
        'Fast siren',
        'Chirp',
        'Soft wobble',
      ]) {
        const p = O.BUILTIN_PRESETS.find((x) => x.cat === 'patterns' && x.name === name);
        if (!p) {
          out[name] = null;
          continue;
        }
        const before = JSON.stringify(a.sweep);
        a.loadPreset(p);
        if (name === 'High sweep') sweepAfterHigh = { before, after: JSON.stringify(a.sweep) };
        const r = a.currentPlan();
        out[name] = r.ok ? JSON.parse(JSON.stringify(r.plan)) : { error: r.error };
      }
      return { out, sweepBefore, sweepAfterHigh };
    });
    const P = pt.out;
    const sh = P['Short high tone'];
    check(
      'Short high tone: 15.5 kHz sine, 300 ms',
      !!sh &&
        sh.type === 'const' &&
        sh.kind === 'finite' &&
        sh.wave === 'sine' &&
        sh.freq === 15500 &&
        near(sh.dur, 0.3, 1e-9),
      JSON.stringify(sh),
    );
    const dp = P['Double pulse'];
    check(
      'Double pulse: 15.5 kHz, 150 ms × 2',
      !!dp &&
        dp.type === 'steps' &&
        dp.steps.length === 2 &&
        dp.steps.every((s) => s.f === 15500 && near(s.dur, 0.15, 1e-9)),
      JSON.stringify(dp && dp.steps),
    );
    const hs = P['High sweep'];
    const hsSeg = hs && hs.segments && hs.segments.length === 1 ? hs.segments[0] : null;
    check(
      'High sweep: 12 → 18 kHz, 800 ms',
      !!hsSeg && hsSeg.f0 === 12000 && hsSeg.f1 === 18000 && near(hsSeg.dur, 0.8, 1e-9),
      JSON.stringify(hs && hs.segments),
    );
    const fs = P['Fast siren'];
    check(
      'Fast siren: 13 ↔ 17 kHz',
      !!fs &&
        fs.type === 'lfo' &&
        near(fs.center - fs.depth, 13000, 1e-6) &&
        near(fs.center + fs.depth, 17000, 1e-6),
      JSON.stringify(fs),
    );
    const ch = P.Chirp;
    const chSeg = ch && ch.segments ? ch.segments[0] : null;
    check(
      'Chirp: 10 → 18 kHz, 300 ms',
      !!chSeg &&
        ch.segments.length === 1 &&
        chSeg.f0 === 10000 &&
        chSeg.f1 === 18000 &&
        near(chSeg.dur, 0.3, 1e-9),
      JSON.stringify(ch && ch.segments),
    );
    const wb = P['Soft wobble'];
    check(
      'Soft wobble: 15 kHz ± 800 Hz',
      !!wb && wb.type === 'lfo' && wb.center === 15000 && wb.depth === 800,
      JSON.stringify(wb),
    );
    check(
      'applying “High sweep” leaves the Sweep-mode settings untouched',
      !!pt.sweepAfterHigh && pt.sweepAfterHigh.before === pt.sweepAfterHigh.after,
      JSON.stringify(pt.sweepAfterHigh),
    ); // known bug — fixed in index.html

    console.log('§44 learn topics');
    const ids = await page.evaluate(() => window.OSCILLA.LEARN_TOPICS.map((t) => t.id));
    const want = Object.values(LEARN_IDS).sort();
    const missingIds = want.filter((x) => !ids.includes(x));
    const extraIds = ids.filter((x) => !want.includes(x));
    check(
      'Learn topics cover exactly the 18 spec topics',
      JSON.stringify([...ids].sort()) === JSON.stringify(want) && ids.length === 18,
      `missing=${JSON.stringify(missingIds)} extra=${JSON.stringify(extraIds)}`,
    );

    console.log('§45 explore hints');
    await app(page, (a) => {
      a.setMode('playground');
      a.setRangeMode('human');
      a.setPattern('tone');
      a.setWaveform('sine');
      a.explore = true;
      a.setFrequency(440);
    });
    const hintText = (needle) =>
      waitTrue(
        page,
        (n) => {
          const el = document.querySelector('section[aria-label="Explore hints"]');
          return !!el && el.offsetParent !== null && el.textContent.includes(n);
        },
        needle,
        1500,
      );
    check('Explore at 440 Hz shows “2.27 ms”', await hintText('2.27 ms'));
    await app(page, (a) => a.setFrequency(15500));
    check('Explore at 15.5 kHz shows “64.5 µs”', await hintText('64.5 µs'));
    await app(page, (a) => a.setWaveform('square'));
    const hints = await app(page, (a) => a.hints);
    check(
      'Explore at 15.5 kHz square shows the Nyquist hint',
      await hintText('Nyquist is a digital limit'),
      JSON.stringify(hints),
    ); // known bug — fixed in index.html
    await context.close();
  }

  // ------------------------------------------------------------------ live viz bridge
  {
    // Attribute traffic probe: counts setAttribute/getAttribute calls whose stack passes through
    // the p5 draw loop (p.draw / p5 redraw), while `on`.
    const domProbe = () => {
      try {
        Error.stackTraceLimit = 60;
      } catch (e) {
        /* non-V8 */
      }
      window.__domProbe = { on: false, total: 0, draw: 0, samples: [] };
      for (const name of ['setAttribute', 'getAttribute']) {
        const orig = Element.prototype[name];
        Element.prototype[name] = function probed(...a) {
          const pr = window.__domProbe;
          if (pr.on) {
            pr.total++;
            const stack = new Error().stack || '';
            if (/p\.draw|\bredraw\b|\b_draw\b/.test(stack)) {
              pr.draw++;
              if (pr.samples.length < 3)
                pr.samples.push(`${name}(${a[0]}) on <${this.tagName.toLowerCase()}>`);
            }
          }
          return orig.apply(this, a);
        };
      }
    };
    const { page, context } = await openPage(browser, { init: domProbe });
    console.log('§26/§27 real-signal label and spectrum scale');
    const def = await app(page, (a, e, O) => ({
      app: a.spectrumScale,
      viz: O.viz.state.spectrumScale,
    }));
    check(
      'default spectrum scale is LOG (app and viz state)',
      def.app === 'log' && def.viz === 'log',
      JSON.stringify(def),
    );
    await app(page, (a) => {
      a.vizMode = 'spectrum';
    });
    await page
      .locator('[role=radiogroup][aria-label="Frequency axis"] button', { hasText: 'LIN' })
      .click();
    check(
      'LIN toggle propagates to viz state',
      await waitTrue(page, () => window.OSCILLA.viz.state.spectrumScale === 'linear'),
    );
    await page
      .locator('[role=radiogroup][aria-label="Frequency axis"] button', { hasText: 'LOG' })
      .click();
    check(
      'LOG toggle propagates back to viz state',
      await waitTrue(page, () => window.OSCILLA.viz.state.spectrumScale === 'log'),
    );

    await app(page, (a) => {
      a.ensureAudio();
      a.vizMode = 'wave';
      a.setMode('sweep');
      a.applyConfig(
        {
          sweep: {
            start: 20,
            end: 20000,
            durationMs: 10000,
            curve: 'log',
            direction: 'up',
            repeat: 'once',
          },
        },
        'preset',
      );
      a.trigger();
    });
    const sampleAt = async (sec) => {
      await page.waitForFunction(
        (s) => {
          const e = window.OSCILLA.engine;
          return e.voice && e.ctx.currentTime - e.voice.t0 > s;
        },
        sec,
        { timeout: 8000 },
      );
      return app(page, (a, e, O) => {
        const L = O.viz.state.labels;
        const key = ['realFreq', 'instFreq', 'liveFreq', 'freq'].find(
          (k) => typeof L[k] === 'string',
        );
        const label = L[key];
        return {
          key,
          label,
          parsed: O.parseFrequency(label).value,
          inst: e.instantaneousFrequency(),
          requested: a.frequency,
        };
      });
    };
    const s1 = await sampleAt(1.5);
    const s2 = await sampleAt(3.0);
    const follows = (s) =>
      s.inst > 0 && s.parsed > 0 && s.parsed / s.inst > 0.8 && s.parsed / s.inst < 1.25;
    check(
      'sweep playing: REAL SIGNAL label follows the instantaneous frequency',
      follows(s1) && follows(s2) && s1.label !== s2.label,
      JSON.stringify([s1, s2]),
    ); // known bug — fixed in index.html
    await app(page, (a) => a.stopNow());

    console.log('§35 stereo split');
    await app(page, (a) => {
      a.safetyLimit = 5;
      a.setMode('dual');
      a.setStereo(true);
      a.play('hold');
    });
    const panOf = () =>
      page.evaluate(() => {
        const v = window.OSCILLA.engine.voice;
        const L = v && v.live;
        return L && L.A && L.B && L.A.panner && L.B.panner
          ? [L.A.panner.pan.value, L.B.panner.pan.value]
          : null;
      });
    await waitTrue(page, () => !!window.OSCILLA.engine.voice, null, 2000);
    const stereoPan = await panOf();
    check(
      'stereo split: A pan −1, B pan +1 while playing',
      !!stereoPan && near(stereoPan[0], -1, 1e-6) && near(stereoPan[1], 1, 1e-6),
      JSON.stringify(stereoPan),
    );
    await app(page, (a) => a.setStereo(false));
    const settled = await waitTrue(
      page,
      () => {
        const L = window.OSCILLA.engine.voice && window.OSCILLA.engine.voice.live;
        return (
          !!L && Math.abs(L.A.panner.pan.value) < 0.01 && Math.abs(L.B.panner.pan.value) < 0.01
        );
      },
      null,
      3000,
    );
    check(
      'switching to mono while playing moves both pans to 0',
      settled,
      JSON.stringify(await panOf()),
    );
    await app(page, (a) => {
      a.stopNow();
      a.play('hold');
    });
    await waitTrue(page, () => !!window.OSCILLA.engine.voice, null, 2000);
    const monoPan = await panOf();
    check(
      'mono mix: A pan 0, B pan 0',
      !!monoPan && monoPan[0] === 0 && monoPan[1] === 0,
      JSON.stringify(monoPan),
    );
    await app(page, (a) => a.stopNow());

    console.log('§42 session history');
    const hist = await app(page, async (a, e) => {
      a.setMode('playground');
      a.setPattern('finite');
      a.duration = 50;
      for (let i = 0; i < 55; i++) {
        a.setFrequency(200 + i * 10);
        a.play('trigger');
        a.stopNow();
        await new Promise((r) => setTimeout(r, 4));
      }
      const stored = JSON.parse(sessionStorage.getItem('oscilla.history') || '[]');
      const first = a.history[0];
      const target = a.history[10];
      const want = target.freqs ? target.freqs[0] : target.frequency;
      a.setFrequency(999);
      a.recallHistory(target);
      return {
        len: a.history.length,
        stored: stored.length,
        keys: Object.keys(first),
        want,
        got: a.frequency,
      };
    });
    check(
      '55 plays keep exactly 50 history entries (memory and sessionStorage)',
      hist.len === 50 && hist.stored === 50,
      JSON.stringify(hist),
    );
    const hk = hist.keys;
    const hasKeys =
      (hk.includes('ts') || hk.includes('timestamp')) &&
      (hk.includes('freqs') || hk.includes('frequency')) &&
      ['mode', 'waveform', 'pattern', 'duration'].every((k) => hk.includes(k));
    check(
      'history entries carry timestamp, mode, frequency, waveform, pattern, duration',
      hasKeys,
      JSON.stringify(hk),
    );
    check(
      'history recall restores the frequency',
      near(hist.got, hist.want, 0.01),
      JSON.stringify(hist),
    );

    console.log('§57 performance');
    await app(page, (a) => {
      a.stopNow();
      a.alerts = [];
      a.vizMode = 'wave';
    });
    await waitTrue(
      page,
      () => !window.OSCILLA.engine.voice && window.OSCILLA.engine.activeNodeCount === 0,
      null,
      3000,
    );
    // let p5 settle after the last state change, then count attribute traffic for ~60 frames
    const settleFrom = await frameCount(page);
    await page.waitForFunction((f) => window.OSCILLA.viz.p5.frameCount >= f + 5, settleFrom, {
      timeout: 5000,
    });
    await page.evaluate(() => {
      const pr = window.__domProbe;
      pr.total = 0;
      pr.draw = 0;
      pr.samples = [];
      pr.on = true;
    });
    const fcStart = await frameCount(page);
    await page.waitForFunction((f) => window.OSCILLA.viz.p5.frameCount >= f + 60, fcStart, {
      timeout: 8000,
    });
    const probe = await page.evaluate(() => {
      const pr = window.__domProbe;
      pr.on = false;
      return { total: pr.total, draw: pr.draw, samples: pr.samples };
    });
    check(
      'idle draw loop makes 0 setAttribute/getAttribute calls over 60 frames',
      probe.draw === 0,
      JSON.stringify(probe),
    ); // known bug — fixed in index.html

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const fcHidden = await frameCount(page);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
    const fcHiddenLater = await frameCount(page);
    check(
      'document.hidden pauses the p5 sketch',
      fcHiddenLater - fcHidden <= 1,
      `${fcHidden} → ${fcHiddenLater}`,
    );
    await page.evaluate(() => {
      delete document.hidden;
      delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    check(
      'sketch resumes when visible again',
      await waitTrue(page, (f) => window.OSCILLA.viz.p5.frameCount > f + 3, fcHiddenLater, 3000),
    );
    await context.close();
  }

  // ------------------------------------------------------------------ frequency map
  {
    console.log('§32 frequency map');
    const { page, context } = await openPage(browser);
    await app(page, (a) => {
      a.setMode('playground');
      a.setRangeMode('human');
    });
    const map = page.locator('[x-ref=fmap]');
    await map.scrollIntoViewIfNeeded();
    const box = await map.boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.click(box.x + box.width * 0.5, y);
    const mid = await app(page, (a) => a.frequency);
    check(
      'click at 50 % of the Human map → ≈ 632 Hz (±2 %)',
      Math.abs(mid / 632.456 - 1) <= 0.02,
      String(mid),
    );

    const seen = [];
    await page.mouse.move(box.x + box.width * 0.25, y);
    await page.mouse.down();
    seen.push(await app(page, (a) => a.frequency));
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(box.x + box.width * (0.25 + 0.05 * i), y);
      seen.push(await app(page, (a) => a.frequency));
    }
    await page.mouse.up();
    check(
      'drag 25 % → 75 % increases frequency monotonically',
      seen.every((f, i) => i === 0 || f > seen[i - 1]) && seen[0] < 200 && seen[10] > 2000,
      JSON.stringify(seen.map((f) => Math.round(f))),
    );

    await map.focus();
    const key = async (k) => {
      await app(page, (a) => a.setFrequency(440));
      await page.keyboard.press(k);
      return app(page, (a) => ({ f: a.frequency, min: a.rangeMin }));
    };
    const right = await key('ArrowRight');
    check(
      'ArrowRight = × 2^(1/12)',
      near(right.f, 440 * Math.pow(2, 1 / 12), 0.01),
      String(right.f),
    );
    const up = await key('PageUp');
    check('PageUp = × 2', near(up.f, 880, 0.01), String(up.f));
    const home = await key('Home');
    check('Home = range minimum', near(home.f, home.min, 1e-6), JSON.stringify(home));

    await app(page, (a) => a.setRangeMode('advanced'));
    await waitTrue(
      page,
      () => document.querySelector('[x-ref=fmap]').getAttribute('aria-valuemin') === '1',
      null,
      2000,
    );
    const aria = await page.evaluate(() => {
      const el = document.querySelector('[x-ref=fmap]');
      return {
        min: Number(el.getAttribute('aria-valuemin')),
        max: Number(el.getAttribute('aria-valuemax')),
        safe: window.Alpine.$data(document.body).safeMax,
      };
    });
    check(
      'Advanced range: aria-valuemin 1, aria-valuemax = safe maximum',
      aria.min === 1 && near(aria.max, aria.safe, 1),
      JSON.stringify(aria),
    );
    await context.close();
  }

  // ------------------------------------------------------------------ high-DPI canvas
  {
    console.log('§58 retina / canvas');
    const { page, context } = await openPage(browser, { ctx: { deviceScaleFactor: 2 } });
    const dims = () =>
      page.evaluate(() => {
        const c = document.querySelector('[x-ref=vizCanvas] canvas');
        const box = document.querySelector('[x-ref=vizCanvas]').getBoundingClientRect();
        return {
          w: c.width,
          cw: c.clientWidth,
          rw: c.getBoundingClientRect().width,
          box: box.width,
        };
      });
    const d0 = await dims();
    check(
      'deviceScaleFactor 2: canvas backing width ≈ 2 × CSS width',
      near(d0.w / d0.cw, 2, 0.02),
      JSON.stringify(d0),
    );
    const fits = [];
    for (const [w, h] of [
      [375, 700],
      [1024, 768],
      [320, 640],
      [1440, 900],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      const ok = await waitTrue(
        page,
        () => {
          const c = document.querySelector('[x-ref=vizCanvas] canvas');
          const box = document.querySelector('[x-ref=vizCanvas]').getBoundingClientRect();
          const r = c.getBoundingClientRect();
          return r.width <= box.width + 0.5 && box.width - r.width < 4;
        },
        null,
        3000,
      );
      const d = await dims();
      fits.push({ vw: w, ok, ...d, ratio: +(d.w / d.cw).toFixed(3) });
    }
    check(
      'canvas never wider than its container across viewport resizes',
      fits.every((f) => f.ok && f.rw <= f.box + 0.5),
      JSON.stringify(fits),
    );
    check(
      'high-DPI ratio kept after resizes',
      fits.every((f) => near(f.ratio, 2, 0.02)),
      JSON.stringify(fits.map((f) => f.ratio)),
    );
    await context.close();
  }

  // ------------------------------------------------------------------ binaural
  {
    console.log('§37 binaural');
    const { page, context } = await openPage(browser);
    const def = await app(page, (a) => a.dual.binaural);
    check('binaural defaults to OFF', def === false, String(def));
    await app(page, (a, e, O) => {
      a.setMode('dual');
      a.loadPreset(O.BUILTIN_PRESETS.find((p) => p.cat === 'dual' && p.requiresHeadphones));
    });
    const dialog = await waitTrue(
      page,
      () => {
        // the modal is position: fixed, so offsetParent is always null; use computed style + box
        const m = document.getElementById('headphonesModal');
        if (!m || m.classList.contains('hidden') || getComputedStyle(m).display === 'none')
          return false;
        const r = m.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && m.getAttribute('aria-hidden') !== 'true';
      },
      null,
      2000,
    );
    const pending = await app(page, (a) => a.dual.binaural);
    check('binaural preset opens the headphones dialog', dialog);
    check('binaural stays off until headphones are confirmed', pending === false, String(pending));
    await page.locator('#headphonesModal button', { hasText: 'I am using headphones' }).click();
    const confirmed = await app(page, (a) => ({
      b: a.dual.binaural,
      s: a.dual.stereo,
      fa: a.dual.a.freq,
      fb: a.dual.b.freq,
    }));
    check(
      'confirming headphones enables binaural 440 / 446 Hz stereo',
      confirmed.b === true && confirmed.s === true && confirmed.fa === 440 && confirmed.fb === 446,
      JSON.stringify(confirmed),
    );
    await context.close();

    const extra = {
      dual: {
        a: { freq: 440, wave: 'sine', gain: 100, detune: 0 },
        b: { freq: 446, wave: 'sine', gain: 100, detune: 0 },
        levelA: 80,
        levelB: 80,
        stereo: true,
        binaural: true,
      },
    };
    const r = await openPage(browser, { hash: `#v=1&m=dual&s=dual&x=${b64url(extra)}` });
    const restored = await app(r.page, (a) => ({
      b: a.dual.binaural,
      src: a.source,
      fb: a.dual.b.freq,
    }));
    check(
      'URL hash with dual.binaural=true restores binaural false',
      restored.b === false && restored.src === 'dual' && restored.fb === 446,
      JSON.stringify(restored),
    );
    await r.context.close();
  }

  // ------------------------------------------------------------------ URL: continuous + lazy audio
  {
    console.log('§43 URL state');
    const sweep = {
      start: 20,
      end: 20000,
      durationMs: 10000,
      curve: 'log',
      direction: 'up',
      repeat: 'continuous',
      repeatCount: 3,
    };
    const { page, context } = await openPage(browser, {
      hash: `#v=1&m=sweep&s=sweep&x=${b64url({ sweep })}`,
      init: () => {
        window.__ctxCount = 0;
        for (const name of ['AudioContext', 'webkitAudioContext']) {
          const C = window[name];
          if (typeof C !== 'function') continue;
          window[name] = new Proxy(C, {
            construct(t, a, nt) {
              window.__ctxCount++;
              return Reflect.construct(t, a, nt);
            },
          });
        }
      },
    });
    const st = await app(page, (a, e) => ({
      repeat: a.sweep.repeat,
      cont: a.continuousAllowed,
      ctx: !!e.ctx,
      made: window.__ctxCount,
      src: a.source,
    }));
    check(
      'hash sweep.repeat “continuous” restores “once”',
      st.repeat === 'once' && st.src === 'sweep',
      JSON.stringify(st),
    );
    check('hash never restores continuous permission', st.cont === false, JSON.stringify(st));
    check(
      'no AudioContext created when loading from a hash',
      !st.ctx && st.made === 0,
      JSON.stringify(st),
    );
    await context.close();
  }

  // ---------------------------------------------------------- custom presets: migration + schema
  {
    console.log('§41 custom presets');
    const { page, context } = await openPage(browser);
    await page.evaluate(() => {
      localStorage.setItem(
        'oscilla.presets',
        JSON.stringify({
          version: 1,
          presets: [
            { name: 'Legacy 1k square', frequency: '1k', waveform: 'square' },
            { version: 1, name: 42, cfg: 'not a config' },
            {
              version: 99,
              id: 'future',
              name: 'From the future',
              cfg: { source: 'single', pattern: 'tone', frequency: 440 },
            },
          ],
        }),
      );
    });
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    const loaded = await app(page, (a) => ({
      n: a.customPresets.length,
      names: a.customPresets.map((p) => p.name),
      f: a.customPresets[0] && a.customPresets[0].cfg.frequency,
      w: a.customPresets[0] && a.customPresets[0].cfg.waveform,
      warn: a.alerts.filter((x) => x.level === 'warning').map((x) => x.title),
    }));
    check(
      'v0 entry migrated, invalid and version-99 entries dropped',
      loaded.n === 1 &&
        loaded.names[0] === 'Legacy 1k square' &&
        loaded.f === 1000 &&
        loaded.w === 'square',
      JSON.stringify(loaded),
    );
    check('dropped entries raise a warning notice', loaded.warn.length > 0, JSON.stringify(loaded));
    const saved = await app(page, (a) => {
      a.setFrequency(1234);
      a.saveName = 'Spec preset';
      a.savePreset();
      const raw = JSON.parse(localStorage.getItem('oscilla.presets'));
      return {
        version: raw.version,
        entries: raw.presets.map((p) => ({ name: p.name, keys: Object.keys(p) })),
      };
    });
    const missing = saved.entries.map((e) => ({
      name: e.name,
      missing: PRESET_SCHEMA_KEYS.filter((k) => !e.keys.includes(k)),
    }));
    check(
      'every stored preset (incl. migrated) has the full versioned schema',
      saved.entries.length === 2 && missing.every((m) => !m.missing.length),
      JSON.stringify(missing),
    ); // defect found by this test: presetRecord copies undefined gain/duration from a v0 cfg

    await context.close();
  }

  // ------------------------------------------------------------------ low sample rate
  {
    console.log('§38/§40 Nyquist-aware presets at 32 kHz');
    const { page, context } = await openPage(browser, {
      init: () => {
        for (const name of ['AudioContext', 'webkitAudioContext']) {
          const C = window[name];
          if (typeof C !== 'function') continue;
          window[name] = new Proxy(C, {
            construct(t, a, nt) {
              return Reflect.construct(t, [{ ...(a[0] || {}), sampleRate: 32000 }], nt);
            },
          });
        }
      },
    });
    const r = await app(page, (a, e, O) => {
      a.ensureAudio();
      const ref = {};
      for (const p of O.BUILTIN_PRESETS.filter((x) => x.cat === 'reference'))
        ref[p.cfg.frequency] = a.presetDisabled(p);
      const third = O.BUILTIN_PRESETS.find(
        (x) => x.cat === 'patterns' && x.name === 'Third-octave demonstration',
      );
      a.loadPreset(third);
      const plan = a.currentPlan();
      return {
        sr: e.sampleRate,
        safe: a.safeMax,
        ref,
        text: O.parseFrequencyList(a.pp.sequence.text).values,
        steps: plan.ok ? plan.plan.steps.length : plan.error,
      };
    });
    check('context forced to 32 kHz', r.sr === 32000, String(r.sr));
    check(
      'reference 15.5 / 17 / 18 / 20 kHz disabled at 32 kHz',
      [15500, 17000, 18000, 20000].every((f) => r.ref[f] === true),
      JSON.stringify(r.ref),
    );
    check('reference 12 kHz enabled at 32 kHz', r.ref[12000] === false, JSON.stringify(r.ref));
    check(
      'third-octave preset carries the 31 nominal values',
      JSON.stringify(r.text) === JSON.stringify(THIRD_OCTAVE),
      JSON.stringify(r.text),
    );
    const expectSteps = THIRD_OCTAVE.filter((f) => f <= r.safe).length;
    check(
      `third-octave plan has ${expectSteps} steps (values ≤ safe max ${Math.round(r.safe)} Hz)`,
      r.steps === expectSteps,
      String(r.steps),
    );
    await context.close();
  }

  console.log('console');
  check(
    'no console problems during the spec run',
    consoleProblems.length === 0,
    consoleProblems.slice(0, 5).join(' | '),
  );

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (failed) {
    console.log(failures.map((f) => ` - ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

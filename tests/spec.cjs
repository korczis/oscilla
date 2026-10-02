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

const fs = require('fs');
const path = require('path');
const url = require('url');
const playwright = require('playwright');

const args = process.argv.slice(2);
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
const ENGINE = args.includes('--browser') ? args[args.indexOf('--browser') + 1] : 'chromium';
const BASE = urlArg || `file://${path.resolve(__dirname, '..', 'index.html')}`;
// Known third-party noise, not application errors (same list as smoke.cjs).
const IGNORED_CONSOLE = [
  /cdn\.tailwindcss\.com should not be used in production/,
  /Use of the (orientation|motion) sensor is deprecated/,
  // Firefox performance advisory when the page scrolls (§10 wheel test): Popper, used by
  // Flowbite tooltips and dropdowns, repositions on scroll. The app has no scroll listener.
  /scroll-linked positioning effect/,
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

// Spec sentences quoted verbatim (whitespace normalized).
const LOW_WARNING = [
  'Consumer speakers may reproduce this poorly, distort, or undergo large mechanical excursion.',
  'Low-frequency inaudibility does not imply low physical output.',
];
const HIGH_WARNING = [
  'Perceived loudness is not a reliable indicator of acoustic output.',
  'Phone speakers, headphones, filters, DACs and amplifiers may significantly attenuate or ' +
    'distort high-frequency signals.',
  'Do not infer safety from weak perception.',
];
const DEVICE_EXPLANATION =
  'The Web Audio engine can mathematically generate a requested signal within digital limits, ' +
  'but the physical speaker/headphones may attenuate, distort, or fail to reproduce it.';
const SAFETY_NOTICE = [
  'Audio signals can be uncomfortable or harmful at excessive output levels. Start low, ' +
    'especially with headphones. Perceived loudness is not a reliable measure of acoustic ' +
    'output, particularly at very low or very high frequencies.',
  'Digital signal generation does not guarantee that your playback hardware reproduces the ' +
    'requested frequency accurately.',
];
const SPEC_MODES = ['PLAYGROUND', 'SWEEP', 'DUAL OSC', 'PRESETS', 'LEARN'];
const WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440];
// PATTERN ENGINE list → pattern ids; PATTERN DETAILS parameters → parameter keys.
const SPEC_PATTERNS = {
  tone: 'continuous tone',
  finite: 'finite tone',
  pulse: 'pulse',
  burst: 'burst',
  sweepUp: 'sweep up',
  sweepDown: 'sweep down',
  pingpong: 'ping-pong sweep',
  chirp: 'chirp',
  siren: 'siren',
  alternating: 'alternating frequencies',
  wobble: 'frequency wobble',
  am: 'AM tremolo',
  fm: 'FM modulation',
  random: 'random frequency sequence',
  octave: 'octave stepping',
  sequence: 'user-defined sequence',
};
const PATTERN_PARAM_KEYS = {
  tone: ['frequency', 'duration', 'attack', 'release'],
  finite: ['frequency', 'duration', 'attack', 'release'],
  pulse: ['frequency', 'pulseMs', 'pauseMs', 'reps'],
  burst: ['frequency', 'burstMs', 'intervalMs', 'count'],
  sweepUp: ['start', 'end', 'durationMs', 'curve'],
  sweepDown: ['start', 'end', 'durationMs', 'curve'],
  pingpong: ['min', 'max', 'cycleMs', 'repeats'],
  chirp: ['start', 'end', 'durationMs', 'ramp'],
  siren: ['min', 'max', 'rate', 'shape'],
  alternating: ['fA', 'fB', 'toneMs', 'gapMs', 'repeats'],
  wobble: ['frequency', 'depth', 'rate'],
  am: ['frequency', 'modFreq', 'depth'],
  fm: ['frequency', 'modFreq', 'depthHz'],
  random: ['min', 'max', 'toneMs', 'gapMs', 'count'],
  octave: ['text'],
  sequence: ['text'],
};
// LIVE TECHNICAL METRICS label → what the UI label must contain (it may shorten "Current
// pattern" to "Pattern", "AudioContext state" to "AudioContext", "Playback state" to "Playback").
const METRIC_LABELS = [
  ['Requested frequency', /requested/i],
  ['Current pattern', /pattern/i],
  ['Waveform', /waveform/i],
  ['Duration', /duration/i],
  ['Gain', /gain/i],
  ['Period', /period/i],
  ['Wavelength', /wavelength/i],
  ['Nearest note', /nearest note/i],
  ['Sample rate', /sample rate/i],
  ['Nyquist frequency', /nyquist/i],
  ['AudioContext state', /audiocontext/i],
  ['Playback state', /playback/i],
];
// DEBUG MODE field → accepted UI label (case-insensitive).
const DEBUG_FIELDS = [
  ['AudioContext state', /^audiocontext( state)?$/i],
  ['sampleRate', /^sample ?rate$/i],
  ['currentTime', /^current ?time$/i],
  ['Nyquist', /^nyquist( frequency)?$/i],
  ['safe maximum', /^safe max(imum)?$/i],
  ['active source count', /^active sources?( count)?$/i],
  ['active node count', /^active nodes?( count)?$/i],
  ['playing state', /^playing( state)?$/i],
  ['current requested frequency', /^(current )?requested frequency$/i],
  ['current instantaneous frequency', /^(current )?instantaneous frequency$/i],
  ['pattern', /^(current )?pattern$/i],
  ['last error', /^last error$/i],
  ['p5 FPS', /^p5 fps$/i],
  ['visualizer state', /^visuali[sz]er( state)?$/i],
];
// CODE ORGANIZATION: the ten section banners, in order.
const BANNERS = [
  /constants/i,
  /^(\d+\.\s*)?helpers$/i,
  /frequency helpers/i,
  /musical.note helpers/i,
  /preset definitions/i,
  /audio ?engine/i,
  /visuali[sz]ation bridge/i,
  /alpine component/i,
  /p5 sketch/i,
  /bootstrap/i,
];
// NO FAKE SCIENCE claims and CONTENT / TERMINOLOGY "Bad" terms (plus stems of them).
const BANNED = [
  /\bdogs?\b|dog-only|\bbark/i,
  /humans? (cannot|can't|can not) hear/i,
  /ultrasound works/i,
  /100\s*%\s*safe/i,
  /instant correction/i,
  /improves? (focus|sleep|cognition)/i,
  /tinnitus/i,
  /therap|healing/i,
  /inaudible (frequenc|sound|tone|signal)/i,
  /guaranteed? (ultrasound|to stop)/i,
  /\bSPL\b/,
  /safe frequenc/i,
  /15\.50? ?kHz[^.]*ultrasound|ultrasound[^.]*15\.50? ?kHz/i,
];
// The only sentences allowed to mention a BANNED pattern: each one negates the claim. Exact
// (whitespace-normalized) text, so a new mention or an edited one fails until reviewed here.
const NEGATED_CLAIMS = [
  'Logical gain 0.080 of a conservative maximum 0.25 (relative level — not SPL).',
  'Relative levels only — not calibrated, not SPL.',
  'Vertical axis: relative level in dB, uncalibrated — not SPL.',
  'Levels are relative; no SPL is shown or implied.',
  'This demonstrates a perceptual effect only; it makes no claim about focus, sleep, therapy or ' +
    'any health effect.',
  'This is a perceptual phenomenon; no focus, sleep, therapeutic, meditative, neurological or ' +
    'medical effect is claimed.',
  'Not a hearing test, not a medical or therapeutic device, not a calibrated measurement ' +
    'instrument.',
  '15.5 kHz is a high-frequency signal, not ultrasound.',
];
const NEGATION = /\b(not|no|never|nor|without|cannot)\b|n't\b|uncalibrated/i;
const sentences = (text) =>
  String(text)
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

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

async function ready(page, canvas = true) {
  await page.waitForFunction(
    (c) =>
      window.Alpine &&
      window.OSCILLA &&
      (!c || document.querySelector('[x-ref=vizCanvas] canvas')) &&
      window.Alpine.$data(document.body).initialized,
    canvas,
    { timeout: 20000 },
  );
}

/** Test-only helpers installed in every page as window.__t (the app never reads them). */
const TEST_HELPERS = () => {
  const norm = (s) =>
    String(s || '')
      .replace(/\s+/g, ' ')
      .trim();
  window.__t = {
    norm,
    vis(el) {
      if (!el || !el.getClientRects().length) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.opacity !== '0';
    },
    rendered: () => norm(document.body.innerText),
    raf: () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
};

/**
 * quiet: expected-failure pages (blocked CDN, missing APIs) — console messages are not counted,
 * uncaught page errors still are. canvas: false when p5 is not expected to start.
 */
async function openPage(browser, opts = {}) {
  const { width = 1280, height = 900, hash = '', query = '', init = null, ctx = {} } = opts;
  const { route = null, quiet = false, canvas = true } = opts;
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: 'light',
    ...ctx,
  });
  await context.addInitScript(TEST_HELPERS);
  if (init) await context.addInitScript(init);
  if (route) await route(context);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (quiet || !['error', 'warning'].includes(m.type())) return;
    if (IGNORED_CONSOLE.some((re) => re.test(m.text()))) return;
    consoleProblems.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => {
    errors.push(e.message);
    consoleProblems.push(`[pageerror] ${e.message}`);
  });
  await page.goto(`${BASE}${query}${hash}`, { waitUntil: 'load' });
  await ready(page, canvas);
  return { context, page, errors };
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
const settle = (page) => page.evaluate(() => window.__t.raf());
const rendered = (page) => page.evaluate(() => window.__t.rendered());

/** Open one advanced accordion section (by panel id) unless it is open already. */
async function openAccordion(page, id) {
  const head = page.locator(`[data-accordion-target="#${id}"]`);
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await waitTrue(page, (i) => window.__t.vis(document.getElementById(i)), id, 2000);
}

/** 'playing' | 'releasing' | 'none' for the engine's current voice. */
const voiceState = (page) =>
  page.evaluate(() => {
    const v = window.OSCILLA.engine.voice;
    return v ? (v.releasing ? 'releasing' : 'playing') : 'none';
  });
async function stopClean(page) {
  await app(page, (a) => a.stopNow());
  await waitTrue(page, () => !window.OSCILLA.engine.voice, null, 2000);
}

/** Visibility and ellipsis truncation of the innermost visible element containing `text`. */
const textBox = (page, text) =>
  page.evaluate((txt) => {
    const t = window.__t;
    const skip = ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'];
    const all = [...document.body.querySelectorAll('*')].filter(
      (el) => !skip.includes(el.tagName) && t.vis(el) && t.norm(el.textContent).includes(txt),
    );
    const el = all.find((x) => ![...x.children].some((c) => all.includes(c)));
    if (!el) return { found: false };
    // Clipped when the text runs past the box of itself or an ancestor that hides overflow.
    const range = document.createRange();
    range.selectNodeContents(el);
    const tr = range.getBoundingClientRect();
    let clip = null;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).overflowX !== 'visible') {
        const r = n.getBoundingClientRect();
        if (tr.right > r.right + 1 || tr.left < r.left - 1) clip = n.tagName;
      }
    }
    return { found: true, tag: el.tagName, truncated: !!clip, clippedBy: clip };
  }, text);

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
      firefoxUserPrefs: {
        'media.autoplay.default': 0,
        'media.autoplay.block-webaudio': false,
        'media.navigator.streams.fake': true,
        'media.navigator.permission.disabled': true,
      },
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
    );
    // The count covers partials ≥ −60 dB (square: 1/n ≥ 0.001 → n ≤ 999) below Nyquist:
    // odd n ≤ 999 with n·20 < 24000 → 500, counted analytically even though the list is capped.
    check(
      'square 20 Hz @48 kHz: 500 odd harmonics ≥ −60 dB below Nyquist',
      h.sq20Below === 500,
      `below=${h.sq20Below} listed=${h.sq20ListBelow}`,
    );

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
    );

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
    );
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
    );
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
    );

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

  // ------------------------------------------------------------------ static UI + pure helpers
  const source = /^https?:/.test(BASE)
    ? await (await fetch(BASE)).text()
    : fs.readFileSync(url.fileURLToPath(BASE.split(/[?#]/)[0]), 'utf8');
  {
    const { page, context } = await openPage(browser);

    console.log('§63 progressive disclosure (initial UI)');
    const first = await app(page, (a) => {
      const t = window.__t;
      const heads = [...document.querySelectorAll('[data-accordion-target]')];
      const panels = heads.map((h) =>
        document.querySelector(h.getAttribute('data-accordion-target')),
      );
      const latch = [...document.querySelectorAll('button')].find((b) =>
        /continuously/i.test(b.textContent),
      );
      return {
        mode: a.mode,
        waveform: a.waveform,
        instrument:
          t.vis(document.getElementById('instrument')) &&
          t.vis(document.querySelector('.hold-btn')) &&
          t.vis(document.querySelector('[x-ref=fmap]')),
        heads: heads.length,
        expanded: heads.filter((h) => h.getAttribute('aria-expanded') === 'true').length,
        openPanels: panels.filter((p) => t.vis(p)).map((p) => p.id),
        explore: a.explore,
        hints: t.vis(document.querySelector('section[aria-label="Explore hints"]')),
        binaural: a.dual.binaural,
        continuous: a.continuousAllowed,
        latch: t.vis(latch),
        dialogs: [...document.querySelectorAll('[role=dialog], [aria-modal=true]')].filter(t.vis)
          .length,
      };
    });
    check(
      'initial view is PLAYGROUND with the instrument (map, HOLD) visible',
      first.mode === 'playground' && first.instrument,
      JSON.stringify(first),
    );
    check(
      'every advanced accordion section starts collapsed',
      first.heads >= 4 && first.expanded === 0 && first.openPanels.length === 0,
      JSON.stringify(first),
    );
    check('Explore starts off (no hints shown)', !first.explore && !first.hints);
    check('binaural starts off', first.binaural === false);
    check(
      'continuous playback starts off (no PLAY CONTINUOUSLY button)',
      !first.continuous && !first.latch,
      JSON.stringify(first),
    );
    check('no dialog open initially', first.dialogs === 0, String(first.dialogs));

    console.log('§1 single-file deliverable');
    const refs = await page.evaluate(() =>
      [...document.querySelectorAll('[src], link[href]')].map(
        (el) => el.getAttribute('src') || el.getAttribute('href'),
      ),
    );
    const localRefs = refs.filter((r) => !/^(https:\/\/|data:)/.test(r));
    check(
      'every script, stylesheet and icon is a CDN URL or inline data (no local assets)',
      localRefs.length === 0,
      JSON.stringify(localRefs),
    );

    console.log('§2 tech stack');
    const stack = await page.evaluate(() => ({
      srcs: [...document.querySelectorAll('script[src]')].map((s) => s.src),
      globals: ['Tone', 'Howler', 'Howl'].filter((g) => g in window),
    }));
    for (const [lib, re] of [
      ['Tailwind', /tailwindcss/],
      ['Flowbite', /flowbite/],
      ['Alpine.js', /alpinejs/],
      ['p5.js', /\/p5(\.min)?\.js$/],
    ]) {
      check(
        `script tag for ${lib}`,
        stack.srcs.some((s) => re.test(s)),
        JSON.stringify(stack.srcs),
      );
    }
    check(
      'no Tone.js / Howler.js script or global',
      !stack.srcs.some((s) => /tone|howler/i.test(s)) && stack.globals.length === 0,
      JSON.stringify(stack),
    );

    console.log('§3 product identity at 1280 px');
    for (const txt of ['OSCILLA', 'Interactive Sound & Frequency Lab']) {
      const b = await textBox(page, txt);
      check(`1280 px: “${txt}” visible, not truncated`, b.found && !b.truncated, JSON.stringify(b));
    }

    console.log('§6 frequency range (provisional, before audio)');
    const prov = await app(page, (a) => {
      const out = { prov: a.provisional, safe: a.safeMax };
      for (const m of ['human', 'high', 'advanced']) {
        a.setRangeMode(m);
        out[m] = [a.rangeMin, a.rangeMax];
      }
      a.setRangeMode('human');
      out.text = window.__t.rendered();
      return out;
    });
    check(
      'HUMAN 20 Hz – 20 kHz',
      prov.human[0] === 20 && prov.human[1] === 20000,
      JSON.stringify(prov.human),
    );
    check(
      'HIGH starts at 8 kHz and ends at the safe maximum',
      prov.high[0] === 8000 && near(prov.high[1], prov.safe, 1e-6),
      JSON.stringify({ high: prov.high, safe: prov.safe }),
    );
    check(
      'ADVANCED starts at 1 Hz and ends at the safe maximum',
      prov.advanced[0] === 1 && near(prov.advanced[1], prov.safe, 1e-6),
      JSON.stringify(prov.advanced),
    );
    check(
      'before audio starts the UI marks the sample rate as provisional',
      prov.prov === true && /provisional|prov\./i.test(prov.text),
    );

    console.log('§4 core product modes');
    const modeList = await app(page, (a) => a.APP_MODES.map((m) => ({ id: m.id, label: m.label })));
    check(
      'exactly the 5 spec modes, in order',
      JSON.stringify(modeList.map((m) => m.label.toUpperCase())) === JSON.stringify(SPEC_MODES),
      JSON.stringify(modeList),
    );
    const tabTexts = await page.evaluate(() =>
      [
        ...document.querySelectorAll('[role=tablist][aria-label="Application mode"] [role=tab]'),
      ].map((b) => window.__t.norm(b.innerText).toUpperCase()),
    );
    check(
      '1280 px: the mode tabs read PLAYGROUND · SWEEP · DUAL OSC · PRESETS · LEARN',
      JSON.stringify(tabTexts) === JSON.stringify(SPEC_MODES),
      JSON.stringify(tabTexts),
    );
    const startLoc = await page.evaluate(() => [location.href, history.length]);
    const order = [...modeList.slice(1), modeList[0]];
    const visited = [];
    for (const m of order) {
      await page.click(`#tab-${m.id}`);
      visited.push(
        await page.evaluate(() => [
          window.Alpine.$data(document.body).mode,
          location.href,
          history.length,
        ]),
      );
    }
    check(
      'clicking each mode tab switches the mode in place',
      visited.every((v, i) => v[0] === order[i].id),
      JSON.stringify(visited.map((v) => v[0])),
    );
    check(
      'mode switches never change location (path, query, hash) or history',
      visited.every((v) => v[1] === startLoc[0] && v[2] === startLoc[1]),
      JSON.stringify({ startLoc, visited }),
    );

    console.log('§7 logarithmic frequency control');
    const lg = await page.evaluate(() => {
      const O = window.OSCILLA;
      const errs = [];
      for (const [min, max] of [
        [20, 20000],
        [1, 22800],
        [8000, 21000],
        [100, 10000],
      ]) {
        for (let i = 0; i <= 20; i++) {
          const f = min * Math.pow(max / min, i / 20);
          const n = O.frequencyToNormalized(f, min, max);
          const ref = Math.log(f / min) / Math.log(max / min);
          const back = O.normalizedToFrequency(n, min, max);
          if (Math.abs(n - ref) > 1e-9 || Math.abs(back / f - 1) > 1e-9) errs.push([min, max, f]);
        }
      }
      return {
        errs: errs.slice(0, 3),
        mid: O.frequencyToNormalized(Math.sqrt(20 * 20000), 20, 20000),
        third: O.frequencyToNormalized(200, 20, 20000),
        quarter: O.normalizedToFrequency(0.25, 1, 10000),
        half: O.normalizedToFrequency(0.5, 20, 20000),
      };
    });
    check(
      'frequencyToNormalized = log(f/min)/log(max/min) and round-trips exactly',
      lg.errs.length === 0,
      JSON.stringify(lg.errs),
    );
    check(
      'known points: 632.46 Hz → 0.5, 200 Hz → 1/3 (20–20k); 0.25 → 10 Hz (1–10k)',
      near(lg.mid, 0.5, 1e-9) &&
        near(lg.third, 1 / 3, 1e-9) &&
        near(lg.quarter, 10, 1e-9) &&
        near(lg.half, Math.sqrt(20 * 20000), 1e-6),
      JSON.stringify(lg),
    );

    console.log('§8 frequency regions');
    const REGION_CASES = [
      [20, 'SUB-BASS'],
      [59.9, 'SUB-BASS'],
      [60, 'BASS'],
      [249.9, 'BASS'],
      [250, 'LOW MIDS'],
      [500, 'MIDRANGE'],
      [2000, 'UPPER MIDS'],
      [4000, 'PRESENCE'],
      [6000, 'BRILLIANCE'],
      [12000, 'VERY HIGH FREQUENCY'],
      [15500, 'VERY HIGH FREQUENCY'],
      [16000, 'UPPER HEARING RANGE'],
      [20000, 'UPPER HEARING RANGE'],
      [20001, 'NOMINAL ULTRASONIC REGION'],
    ];
    const regions = await page.evaluate(
      (cases) => cases.map(([f]) => window.OSCILLA.regionFor(f).label),
      REGION_CASES,
    );
    const wrongRegions = REGION_CASES.filter(([, l], i) => regions[i] !== l).map(
      ([f, l], i) => `${f}: ${regions[i]} ≠ ${l}`,
    );
    check(
      'all 10 regions at their boundaries (20 kHz still UPPER HEARING RANGE, 20001 ultrasonic)',
      wrongRegions.length === 0,
      JSON.stringify(wrongRegions),
    );
    await app(page, (a) => {
      a.setMode('playground');
      a.setPattern('tone');
      a.setFrequency(15500);
    });
    await settle(page);
    const regionShown = await rendered(page);
    check(
      'the readout shows the region of 15.5 kHz: VERY HIGH FREQUENCY (not ultrasonic)',
      regionShown.includes('VERY HIGH FREQUENCY') && !regionShown.includes('ULTRASONIC REGION'),
    );

    console.log('§9 flexible frequency entry');
    const PARSE_EXAMPLES = [
      ['440', 440],
      ['440hz', 440],
      ['1k', 1000],
      ['1khz', 1000],
      ['15.5k', 15500],
      ['15500', 15500],
      ['20k', 20000],
      ['20khz', 20000],
    ];
    const FORMAT_EXAMPLES = [
      [20, '20 Hz'],
      [440, '440 Hz'],
      [1000, '1.00 kHz'],
      [15500, '15.50 kHz'],
      [20000, '20.00 kHz'],
    ];
    const MALFORMED = ['', '   ', 'abc', '-5', '0', '0hz', 'NaN', 'Infinity', '12..5', '5kk', 'k'];
    const pf = await page.evaluate(
      ([ex, fx, bad]) => {
        const O = window.OSCILLA;
        const all = [...bad, null, undefined, NaN, Infinity, -1, {}, []];
        return {
          ex: ex.map(([s]) => O.parseFrequency(s)),
          fx: fx.map(([f]) => O.formatFrequency(f)),
          bad: all.map((s) => {
            const r = O.parseFrequency(s);
            return {
              in: String(s),
              ok: r.ok,
              nan: 'value' in r && !Number.isFinite(r.value),
              err: typeof r.error === 'string' && r.error.length > 0,
            };
          }),
        };
      },
      [PARSE_EXAMPLES, FORMAT_EXAMPLES, MALFORMED],
    );
    const wrongParse = PARSE_EXAMPLES.filter(([, v], i) => !(pf.ex[i].ok && pf.ex[i].value === v));
    check(
      'the 8 spec inputs parse to Hz (440, 440hz, 1k, 1khz, 15.5k, 15500, 20k, 20khz)',
      wrongParse.length === 0,
      JSON.stringify(wrongParse),
    );
    const wrongFormat = FORMAT_EXAMPLES.filter(([, s], i) => pf.fx[i] !== s);
    check(
      'formats 20 Hz · 440 Hz · 1.00 kHz · 15.50 kHz · 20.00 kHz',
      wrongFormat.length === 0,
      JSON.stringify(pf.fx),
    );
    const leaky = pf.bad.filter((r) => r.ok || r.nan || !r.err);
    check(
      'malformed inputs rejected with a message and no NaN',
      leaky.length === 0,
      JSON.stringify(leaky),
    );
    const freqInput = page.locator('#freq-input');
    await freqInput.fill('abc');
    await freqInput.press('Enter');
    await settle(page);
    const typedBad = await app(page, (a) => ({
      f: a.frequency,
      err: window.__t.norm(document.getElementById('freq-error').textContent),
      shown: window.__t.vis(document.getElementById('freq-error')),
    }));
    check(
      'typing “abc” shows an error and keeps the frequency',
      typedBad.f === 15500 && typedBad.err.length > 0 && typedBad.shown,
      JSON.stringify(typedBad),
    );
    const typed = [];
    for (const [txt, want, shown] of [
      ['15.5k', 15500, '15.50 kHz'],
      ['20 kHz', 20000, '20.00 kHz'],
      ['440hz', 440, '440 Hz'],
    ]) {
      await freqInput.fill(txt);
      await freqInput.press('Enter');
      await settle(page);
      const r = await app(page, (a) => ({ f: a.frequency, readout: a.readoutText }));
      typed.push({ txt, ...r, ok: r.f === want && r.readout === shown });
    }
    check(
      'typed 15.5k / 20 kHz / 440hz set the frequency and the readout formats it',
      typed.every((r) => r.ok),
      JSON.stringify(typed),
    );

    console.log('§11 musical note mode');
    const notes = await app(page, async (a, e, O) => {
      const nn = [440, 261.63, 82.41].map((f) => O.nearestNote(f, 440));
      a.noteMode = true;
      a.setRangeMode('human');
      a.setFrequency(440);
      await window.__t.raf();
      const text440 = window.__t.rendered();
      const btns = [
        ...document.querySelectorAll('[role=group][aria-label="Note shortcuts"] button'),
      ].filter(window.__t.vis);
      const pressed = [];
      for (const b of btns) {
        b.click();
        const n = a.note;
        pressed.push({ label: b.textContent.trim(), name: n && n.name, cents: n && n.cents });
      }
      a.setA4(400);
      const lo = a.a4;
      a.setA4(500);
      const hi = a.a4;
      a.setA4('abc');
      const bad = a.a4;
      a.setA4(432);
      a.setNote('A4');
      const at432 = { f: a.frequency, note: a.note };
      a.setA4(440);
      a.setFrequency(440);
      const cents = [
        ...document.querySelectorAll('[role=group][aria-label="Cents fine tuning"] button'),
      ];
      const plus10 = cents.find((b) => /\+\s*10/.test(b.textContent));
      if (plus10) plus10.click();
      const after10 = a.frequency;
      a.setFrequency(440);
      a.noteMode = false;
      return { nn, text440, pressed, lo, hi, bad, at432, cents: cents.length, after10 };
    });
    check(
      '440 → A4 0 cents, 261.63 → C4, 82.41 → E2',
      notes.nn[0].name === 'A4' &&
        notes.nn[0].cents === 0 &&
        notes.nn[1].name === 'C4' &&
        notes.nn[2].name === 'E2',
      JSON.stringify(notes.nn),
    );
    check(
      'note mode shows “A4” and “0 cents” at 440 Hz',
      /\bA4\b/.test(notes.text440) && notes.text440.includes('0 cents'),
    );
    check(
      'concert pitch clamps to 432–445 Hz (default 440 for invalid input)',
      notes.lo === 432 && notes.hi === 445 && notes.bad === 440,
      JSON.stringify([notes.lo, notes.hi, notes.bad]),
    );
    check(
      'A4 at concert pitch 432 Hz is 432 Hz, 0 cents',
      near(notes.at432.f, 432, 0.01) && notes.at432.note.cents === 0,
      JSON.stringify(notes.at432),
    );
    const noteLabels = notes.pressed.map((p) => p.label);
    check(
      'the 11 note buttons C2…C7 exist and each lands on its note at 0 cents',
      JSON.stringify(noteLabels) ===
        JSON.stringify(['C2', 'A2', 'C3', 'A3', 'C4', 'A4', 'C5', 'A5', 'C6', 'A6', 'C7']) &&
        notes.pressed.every((p) => p.name === p.label && p.cents === 0),
      JSON.stringify(notes.pressed),
    );
    check(
      'cents fine tuning: 4 buttons, +10 ¢ from 440 Hz = 442.55 Hz',
      notes.cents === 4 && near(notes.after10, 440 * Math.pow(2, 10 / 1200), 0.01),
      JSON.stringify([notes.cents, notes.after10]),
    );

    console.log('§12 waveforms');
    const wf = await app(page, async (a) => {
      const t = window.__t;
      const g = document.querySelector('[role=radiogroup][aria-label=Waveform]');
      const info = [...g.querySelectorAll('[role=radio]')].map((r) => {
        const p = r.querySelector('svg path');
        return { text: t.norm(r.textContent), svg: !!p && (p.getAttribute('d') || '').length > 5 };
      });
      const note = () => {
        const el = [...document.querySelectorAll('[role=note]')].find(
          (n) => /harmonic/i.test(n.textContent) && /Nyquist/.test(n.textContent),
        );
        return { vis: t.vis(el), text: el ? t.norm(el.textContent) : '' };
      };
      a.setFrequency(15000);
      const out = {};
      for (const w of ['sine', 'square', 'sawtooth', 'triangle']) {
        a.setWaveform(w);
        await t.raf();
        out[w] = note();
      }
      a.setWaveform('sine');
      a.setFrequency(440);
      return { info, out };
    });
    check('sine is the default waveform', first.waveform === 'sine', first.waveform);
    check(
      'four waveforms, each with an SVG icon and a plain-text label (no Unicode glyphs)',
      wf.info.length === 4 && wf.info.every((w) => w.svg && /^[A-Za-z]+$/.test(w.text)),
      JSON.stringify(wf.info),
    );
    check(
      'harmonic warning shown for square, saw and triangle at 15 kHz, hidden for sine',
      wf.out.square.vis && wf.out.sawtooth.vis && wf.out.triangle.vis && !wf.out.sine.vis,
      JSON.stringify(Object.fromEntries(Object.entries(wf.out).map(([k, v]) => [k, v.vis]))),
    );
    const hw = wf.out.square.text;
    check(
      'harmonic warning: exceeds Nyquist, filtering alters, nonlinear artifacts, spectrum differs',
      /exceed Nyquist/i.test(hw) &&
        /alter/i.test(hw) &&
        /nonlinear/i.test(hw) &&
        /differ/i.test(hw),
      hw,
    );

    console.log('§13/§14 pattern engine and details');
    const pat = await app(page, (a, e, O) => {
      const saved = JSON.parse(JSON.stringify(a.pp));
      const ids = O.PATTERNS.map((p) => p.id);
      const params = Object.fromEntries(O.PATTERNS.map((p) => [p.id, p.params.map((d) => d.key)]));
      const plans = {};
      for (const id of ids) {
        a.setPattern(id);
        const r = a.currentPlan();
        plans[id] = r.ok ? r.plan.type : `error: ${r.error}`;
      }
      const buttons = document.querySelectorAll(
        '[role=group][aria-label$=" patterns"] button',
      ).length;
      const plan = (id, pp) => {
        a.setPattern(id);
        Object.assign(a.pp[id], pp);
        const r = a.currentPlan();
        return r.ok ? r.plan : { error: r.error };
      };
      const pulse = plan('pulse', { reps: 5, pulseMs: 100, pauseMs: 50 });
      const burst = plan('burst', { burstMs: 40, intervalMs: 250, count: 4 });
      const alt = plan('alternating', { repeats: 3 });
      const out = {
        ids,
        params,
        plans,
        buttons,
        pulse: pulse.steps ? pulse.steps.length : pulse,
        burst: burst.steps ? burst.steps.map((s) => s.t) : burst,
        alt: alt.steps ? alt.steps.map((s) => s.f) : alt,
        altAB: [a.pp.alternating.fA, a.pp.alternating.fB],
        octave: O.parseFrequencyList(a.pp.octave.text).values,
        sequence: a.pp.sequence.text,
      };
      a.pp = saved;
      return out;
    });
    check(
      'exactly the 16 spec patterns',
      JSON.stringify([...pat.ids].sort()) === JSON.stringify(Object.keys(SPEC_PATTERNS).sort()),
      JSON.stringify(pat.ids),
    );
    const planErrors = Object.entries(pat.plans).filter(([, t]) => /^error/.test(t));
    check('every pattern builds a plan', planErrors.length === 0, JSON.stringify(planErrors));
    check('16 pattern buttons in the Pattern panel', pat.buttons === 16, String(pat.buttons));
    const missingParams = Object.entries(PATTERN_PARAM_KEYS)
      .map(([id, keys]) => [id, keys.filter((k) => !(pat.params[id] || []).includes(k))])
      .filter(([, m]) => m.length);
    check(
      'each pattern exposes the parameters PATTERN DETAILS lists',
      missingParams.length === 0,
      JSON.stringify(missingParams),
    );
    check('pulse: repetitions = step count (5 → 5)', pat.pulse === 5, JSON.stringify(pat.pulse));
    const onsets = Array.isArray(pat.burst)
      ? pat.burst.slice(1).map((t, i) => t - pat.burst[i])
      : [];
    check(
      'burst: onset-to-onset spacing = interval (250 ms), 4 bursts',
      onsets.length === 3 && onsets.every((d) => near(d, 0.25, 1e-9)),
      JSON.stringify(pat.burst),
    );
    check(
      'alternating: 2 × repeats steps, A/B in turn',
      Array.isArray(pat.alt) &&
        pat.alt.length === 6 &&
        pat.alt.every((f, i) => f === pat.altAB[i % 2]),
      JSON.stringify(pat.alt),
    );
    check(
      'octave stepping default list is exactly 125 … 16000',
      JSON.stringify(pat.octave) === JSON.stringify([125, 250, 500, 1000, 2000, 4000, 8000, 16000]),
      JSON.stringify(pat.octave),
    );
    check(
      'user sequence default is “440, 880, 660, 1320”',
      pat.sequence === '440, 880, 660, 1320',
      pat.sequence,
    );
    const textarea = page.locator('section[aria-labelledby=pattern-heading] textarea');
    const typeList = async (txt) => {
      await textarea.fill(txt);
      await textarea.dispatchEvent('change');
      await settle(page);
    };
    await app(page, (a) => a.setPattern('octave'));
    await settle(page);
    await typeList('100, 200, 400');
    const octEdit = await app(page, (a) => {
      const r = a.currentPlan();
      return r.ok ? r.plan.steps.map((s) => s.f) : r.error;
    });
    check(
      'octave steps are editable (100, 200, 400 → 3 steps)',
      JSON.stringify(octEdit) === '[100,200,400]',
      JSON.stringify(octEdit),
    );
    await typeList('125, 250, 500, 1000, 2000, 4000, 8000, 16000');
    await app(page, (a) => a.setPattern('sequence'));
    await settle(page);
    await typeList('440, abc, 880');
    const seqBad = await page.evaluate(() => {
      const a = window.Alpine.$data(document.body);
      const ta = document.querySelector('section[aria-labelledby=pattern-heading] textarea');
      const err = document.getElementById(`${ta.id}-err`);
      const r = a.currentPlan();
      return {
        err: err && window.__t.vis(err) ? window.__t.norm(err.textContent) : '',
        invalid: ta.getAttribute('aria-invalid'),
        ok: r.ok,
        error: r.error || '',
      };
    });
    check(
      'a malformed user sequence reports an error naming the bad entry',
      seqBad.err.includes('abc') && seqBad.invalid === 'true' && !seqBad.ok,
      JSON.stringify(seqBad),
    );
    await typeList('0.5, 440');
    const seqLow = await app(page, (a) => ({
      warnings: a.planWarnings,
      shown: window.__t.rendered(),
    }));
    check(
      'a value below 1 Hz reports a below-minimum warning (not “above”)',
      seqLow.warnings.some((w) => /below/i.test(w)) &&
        !seqLow.warnings.some((w) => /above/i.test(w)) &&
        seqLow.warnings.some((w) => seqLow.shown.includes(w)),
      JSON.stringify(seqLow.warnings),
    );
    await typeList('440, 880, 660, 1320');
    await app(page, (a) => a.setPattern('tone'));

    console.log('§21 gain / output');
    const gainText = () =>
      page.evaluate(() => window.__t.norm(document.getElementById('gain').parentElement.innerText));
    const g0 = await app(page, (a) => ({ level: a.gainLevel, pct: a.gainPct, label: a.gainLabel }));
    const g0text = await gainText();
    check(
      'default logical gain 0.08 reads LOW',
      g0.level === 0.08 && g0.label === 'LOW' && /\bLOW\b/.test(g0text),
      JSON.stringify({ g0, g0text }),
    );
    await page.locator('#gain').fill('100');
    await settle(page);
    const g100 = await app(page, (a) => ({ level: a.gainLevel, label: a.gainLabel }));
    const g100text = await gainText();
    check(
      'UI 100 % → logical gain 0.25 (not 1), labelled HIGH',
      g100.level === 0.25 && g100.label === 'HIGH' && /\bHIGH\b/.test(g100text),
      JSON.stringify({ g100, g100text }),
    );
    const labels = await app(page, (a) =>
      [0, 59, 60, 79, 80, 100].map((p) => {
        a.setGainPct(p);
        return `${a.gainPct}:${a.gainLabel}`;
      }),
    );
    check(
      'gain labels: LOW < 60 %, MEDIUM < 80 %, HIGH from 80 %',
      JSON.stringify(labels) ===
        JSON.stringify(['0:LOW', '59:LOW', '60:MEDIUM', '79:MEDIUM', '80:HIGH', '100:HIGH']),
      JSON.stringify(labels),
    );
    await app(page, (a) => {
      a.gainLevel = 0.08;
    });

    console.log('§22/§23 low- and high-frequency safety');
    const warnAt = async (f) => {
      await app(
        page,
        (a, e, O, x) => {
          a.setMode('playground');
          a.setPattern('tone');
          a.setRangeMode('human');
          a.setFrequency(x);
        },
        f,
      );
      await settle(page);
      return rendered(page);
    };
    const r30 = await warnAt(30);
    const r15k = await warnAt(15000);
    const r440 = await warnAt(440);
    check(
      '30 Hz shows the low-frequency warning with both spec sentences',
      LOW_WARNING.every((s) => r30.includes(s)),
      JSON.stringify(LOW_WARNING.filter((s) => !r30.includes(s))),
    );
    check(
      '15 kHz shows the high-frequency warning with all three spec sentences',
      HIGH_WARNING.every((s) => r15k.includes(s)),
      JSON.stringify(HIGH_WARNING.filter((s) => !r15k.includes(s))),
    );
    check(
      '440 Hz shows neither warning',
      ![...LOW_WARNING, ...HIGH_WARNING].some((s) => r440.includes(s)),
    );

    console.log('§25 visualization modes');
    const vm = await app(page, async (a, e, O) => {
      const ids = a.VIZ_MODES.map((v) => v.id);
      const radios = document.querySelectorAll(
        '[role=radiogroup][aria-label="Visualization mode"] [role=radio]',
      ).length;
      const synced = [];
      for (const id of ids) {
        a.vizMode = id;
        await window.__t.raf();
        synced.push(O.viz.state.vizMode === id);
      }
      a.vizMode = 'wave';
      return { ids, radios, synced };
    });
    check(
      'six modes: WAVE, SPECTRUM, MOTION, PATH, HARMONICS, INTERFERENCE (compact selector)',
      JSON.stringify(vm.ids) ===
        JSON.stringify(['wave', 'spectrum', 'motion', 'path', 'harmonics', 'interference']) &&
        vm.radios === 6,
      JSON.stringify(vm),
    );
    check('every mode reaches the sketch through the bridge', vm.synced.every(Boolean));

    console.log('§28/§29 frequency motion and signal path');
    const motion = await page.evaluate(() => {
      const O = window.OSCILLA;
      const r = O.buildPlan(
        {
          source: 'single',
          pattern: 'sweepUp',
          waveform: 'sine',
          pp: { sweepUp: { start: 100, end: 10000, durationMs: 2000, curve: 'log' } },
        },
        { safeMax: 20000, continuous: false },
      );
      return [0, 1, 2].map((t) => O.planFreqAt(r.plan, t));
    });
    check(
      'motion: a 100 Hz → 10 kHz log sweep is 100 / 1000 / 10000 Hz at 0 / 1 / 2 s',
      near(motion[0], 100, 1e-6) && near(motion[1], 1000, 1e-6) && near(motion[2], 10000, 1e-6),
      JSON.stringify(motion),
    );
    const pathNodes = await app(page, async (a, e, O) => {
      const read = () => O.viz.state.pathNodes.map((n) => ({ t: n.title, on: n.enabled }));
      a.setPattern('tone');
      await window.__t.raf();
      const tone = read();
      a.setPattern('fm');
      await window.__t.raf();
      const fm = read();
      a.setPattern('tone');
      return { tone, fm };
    });
    const pathOrder = ['OSCILLATOR', 'MODULATION', 'ENVELOPE', 'MASTER GAIN', 'ANALYSER'];
    const titles = pathNodes.tone.map((n) => n.t);
    const idx = [...pathOrder, 'DEVICE OUTPUT'].map((t) => titles.indexOf(t));
    check(
      'signal path: OSCILLATOR → MODULATION → ENVELOPE → MASTER GAIN → ANALYSER → DEVICE OUTPUT',
      idx.every((i, k) => i >= 0 && (k === 0 || i > idx[k - 1])),
      JSON.stringify(titles),
    );
    const modNode = (list) => list.find((n) => n.on !== undefined) || {};
    check(
      'modulation node subdued for a fixed tone, active for FM',
      modNode(pathNodes.tone).on === false && modNode(pathNodes.fm).on === true,
      JSON.stringify(pathNodes),
    );

    console.log('§31 wavelength and period');
    const WP = [
      [20, '17.15 m', '50 ms'],
      [100, '3.43 m', '10 ms'],
      [440, '0.78 m', '2.27 ms'],
      [1000, '34.3 cm', '1 ms'],
      [10000, '3.43 cm', '100 µs'],
      [15500, '2.21 cm', '64.5 µs'],
      [20000, '1.72 cm', '50 µs'],
    ];
    const wp = await page.evaluate(
      (rows) =>
        rows.map(([f]) => [window.OSCILLA.formatWavelength(f), window.OSCILLA.formatPeriod(f)]),
      WP,
    );
    const wrongWp = WP.filter(([, w, p], i) => wp[i][0] !== w || wp[i][1] !== p).map(
      ([f], i) => `${f}: ${wp[i].join(' / ')}`,
    );
    check('the 7 spec wavelength/period examples', wrongWp.length === 0, JSON.stringify(wrongWp));

    console.log('§46 Flowbite / Tailwind');
    const fb = await page.evaluate(() => ({
      api: ['Modal', 'Dropdown', 'Accordion', 'Tabs'].filter(
        (n) => typeof window[n] !== 'function',
      ),
      accordion: !!document.querySelector('[data-accordion] [data-accordion-target]'),
      tabs: !!document.querySelector('[data-tabs-toggle] [data-tabs-target]'),
      dropdown: !!document.querySelector('[data-dropdown-toggle], [aria-haspopup=menu]'),
      modals: document.querySelectorAll('[data-oscilla-modal]').length,
    }));
    check(
      'Flowbite drives modals, dropdowns, the accordion and the preset tabs',
      fb.api.length === 0 && fb.accordion && fb.tabs && fb.dropdown && fb.modals >= 3,
      JSON.stringify(fb),
    );

    console.log('§55 state architecture');
    const sa = await app(page, (a) => {
      const props = ['mode', 'initialized', 'playing', 'releasing', 'waveform', 'pattern'];
      props.push('frequency', 'duration', 'attack', 'release', 'rangeMode', 'rangeMin', 'rangeMax');
      props.push('sweep', 'dual', 'history');
      const fns = ['init', 'ensureAudio', 'play', 'stop', 'trigger', 'setFrequency'];
      fns.push('savePreset', 'loadPreset', 'deletePreset');
      return {
        xdata: document.body.getAttribute('x-data'),
        missingProps: props.filter((k) => !(k in a)),
        missingFns: fns.filter((k) => typeof a[k] !== 'function'),
        gain: 'gainLevel' in a || 'gain' in a,
      };
    });
    check(
      'Alpine component oscillaApp carries the suggested state and methods',
      sa.xdata === 'oscillaApp' && !sa.missingProps.length && !sa.missingFns.length && sa.gain,
      JSON.stringify(sa),
    );
    const handlers = [...source.matchAll(/\s(?:@|x-on:)[\w.:-]+="([^"]*)"/g)].map((m) => m[1]);
    const complex = handlers.filter((h) => h.length > 60 || /;|=>|\bif\s*\(/.test(h));
    check(
      'x-on handlers stay short (≤ 60 chars, no statements or arrow functions)',
      handlers.length > 20 && complex.length === 0,
      JSON.stringify(complex),
    );

    console.log('§56 code organization');
    const banners = [...source.matchAll(/^\/\/ ={20,}\r?\n\/\/ (.+)\r?\n\/\/ ={20,}$/gm)].map((m) =>
      m[1].trim(),
    );
    const bannerTitles = banners.map((b) => b.replace(/^\d+\.\s*/, ''));
    check(
      'the script has the 10 spec section banners, in order',
      bannerTitles.length === BANNERS.length && BANNERS.every((re, i) => re.test(bannerTitles[i])),
      JSON.stringify(banners),
    );

    console.log('§62 preset description quality');
    const pq = await page.evaluate(() =>
      window.OSCILLA.BUILTIN_PRESETS.map((p) => ({
        id: p.id,
        name: p.name,
        desc: p.desc,
        params: p.params,
        cfg: !!p.cfg && typeof p.cfg === 'object',
      })),
    );
    const emptyPresets = pq
      .filter(
        (p) =>
          !p.cfg || ![p.name, p.desc, p.params].every((s) => typeof s === 'string' && s.trim()),
      )
      .map((p) => p.id);
    check(
      `all ${pq.length} built-in presets have a name, a description and parameters`,
      pq.length > 40 && emptyPresets.length === 0,
      JSON.stringify(emptyPresets),
    );
    const calib = pq
      .flatMap((p) => [p.name, p.desc, p.params].flatMap(sentences))
      .filter((s) => /calibrat/i.test(s) && !NEGATION.test(s));
    check(
      'no preset claims calibration (only “not calibrated”)',
      calib.length === 0,
      JSON.stringify(calib),
    );

    console.log('§50 live technical metrics');
    const accId = (re) =>
      page.evaluate((src) => {
        const r = new RegExp(src, 'i');
        const h = [...document.querySelectorAll('[data-accordion-target]')].find((x) =>
          r.test(x.textContent),
        );
        return h ? h.getAttribute('data-accordion-target').slice(1) : null;
      }, re.source);
    const metricsId = await accId(/live technical metrics/);
    await openAccordion(page, metricsId);
    const dts = await page.evaluate(
      (id) =>
        [...document.querySelectorAll(`#${id} dt`)]
          .filter((d) => window.__t.vis(d))
          .map((d) => ({
            dt: window.__t.norm(d.textContent),
            dd: window.__t.norm(d.nextElementSibling && d.nextElementSibling.textContent),
          })),
      metricsId,
    );
    const missingMetrics = METRIC_LABELS.filter(([, re]) => !dts.some((d) => re.test(d.dt))).map(
      ([l]) => l,
    );
    check(
      'all 12 metric labels present (Requested frequency … Playback state)',
      missingMetrics.length === 0,
      JSON.stringify({ missingMetrics, dts: dts.map((d) => d.dt) }),
    );
    check(
      'every metric shows a value',
      dts.length >= 12 && dts.every((d) => d.dd.length > 0),
      JSON.stringify(dts.filter((d) => !d.dd)),
    );

    console.log('§51 device & output limits');
    const devId = await accId(/device\s*&\s*output limits/);
    check('accordion titled “DEVICE & OUTPUT LIMITS”', !!devId, String(devId));
    if (devId) {
      await openAccordion(page, devId);
      const dev = await page.evaluate(
        (id) => window.__t.norm(document.getElementById(id).innerText),
        devId,
      );
      const fields = [
        ['sample rate', /sample rate/i],
        ['Nyquist frequency', /nyquist/i],
        ['browser', /browser/i],
        ['platform', /platform/i],
        ['requested frequency', /requested frequency/i],
        ['digital representability', /representab/i],
      ];
      const missingFields = fields.filter(([, re]) => !re.test(dev)).map(([l]) => l);
      check(
        'shows sample rate, Nyquist, browser, platform, requested frequency, representability',
        missingFields.length === 0,
        JSON.stringify(missingFields),
      );
      check('contains the exact spec explanation sentence', dev.includes(DEVICE_EXPLANATION), dev);
    }

    console.log('§59 dropdown triggers');
    await app(page, (a) => {
      a.setMode('playground');
      a.vizMode = 'spectrum';
    });
    await settle(page);
    const triggers = await page.evaluate(() =>
      [...document.querySelectorAll('[data-dropdown-toggle], [aria-haspopup]')]
        .filter((b) => !/^menuitem/.test(b.getAttribute('role') || ''))
        .map((b) => {
          const c = b.getAttribute('aria-controls');
          return {
            id: b.id || window.__t.norm(b.textContent).slice(0, 20),
            controls: c,
            target: !!(c && document.getElementById(c)),
            expanded: b.getAttribute('aria-expanded'),
          };
        }),
    );
    const badTriggers = triggers.filter(
      (t) => !t.target || !['true', 'false'].includes(t.expanded),
    );
    check(
      'every dropdown trigger has aria-controls (existing target) and aria-expanded',
      triggers.length >= 2 && badTriggers.length === 0,
      JSON.stringify(badTriggers),
    );
    // Open and close every visible dropdown trigger (Overlays, Theme) by clicking it.
    const toggles = [];
    const ddTriggers = page.locator('[data-dropdown-toggle]:visible, [aria-haspopup]:visible');
    for (let i = 0; i < (await ddTriggers.count()); i++) {
      const b = ddTriggers.nth(i);
      if (/^menuitem/.test((await b.getAttribute('role')) || '')) continue;
      const state = () =>
        b.evaluate((el) => {
          const id = el.getAttribute('aria-controls') || el.getAttribute('data-dropdown-toggle');
          return {
            name: window.__t.norm(el.textContent || el.getAttribute('aria-label')),
            expanded: el.getAttribute('aria-expanded'),
            menu: window.__t.vis(document.getElementById(id)),
          };
        });
      await b.click();
      await settle(page);
      const opened = await state();
      await b.click();
      await settle(page);
      const closed = await state();
      toggles.push({ ...opened, closedExpanded: closed.expanded, closedMenu: closed.menu });
    }
    const badToggles = toggles.filter(
      (t) => !(t.menu && t.expanded === 'true' && t.closedExpanded === 'false' && !t.closedMenu),
    );
    check(
      'opening a dropdown (Overlays, Theme) sets aria-expanded true, closing sets it false',
      toggles.length >= 2 && badToggles.length === 0,
      JSON.stringify(toggles),
    );
    const fbTriggers = await page.evaluate(() =>
      [...document.querySelectorAll('[data-accordion-target], [data-tabs-target]')]
        .map((b) => ({
          sel: b.getAttribute('data-accordion-target') || b.getAttribute('data-tabs-target'),
          controls: b.getAttribute('aria-controls'),
          expanded: b.hasAttribute('data-accordion-target')
            ? b.getAttribute('aria-expanded')
            : 'n/a',
        }))
        .filter((t) => t.sel !== `#${t.controls}` || t.expanded === null),
    );
    check(
      'accordion and tab triggers reference their panels (aria-controls, aria-expanded)',
      fbTriggers.length === 0,
      JSON.stringify(fbTriggers),
    );
    await app(page, (a) => {
      a.vizMode = 'wave';
    });

    console.log('§49 accessibility: radio groups and dialogs');
    const groups = await page.evaluate(() =>
      [...document.querySelectorAll('[role=radiogroup]')].map((g) => {
        const radios = [...g.querySelectorAll('[role=radio]')];
        const lb = g.getAttribute('aria-labelledby');
        const name =
          g.getAttribute('aria-label') || (lb && document.getElementById(lb)?.textContent);
        return {
          name: window.__t.norm(name).slice(0, 28),
          n: radios.length,
          stops: radios.filter((r) => r.tabIndex === 0).length,
        };
      }),
    );
    const badGroups = groups.filter((g) => g.stops !== 1);
    check(
      `every radiogroup (${groups.length}) has exactly one radio with tabindex 0`,
      groups.length > 5 && badGroups.length === 0,
      JSON.stringify(badGroups),
    );
    const dialogCheck = async (label, opener, id, key) => {
      await opener.focus();
      await page.keyboard.press(key);
      const opened = await waitTrue(
        page,
        (i) => {
          const m = document.getElementById(i);
          return window.__t.vis(m) && m.contains(document.activeElement);
        },
        id,
        2000,
      );
      const attrs = await page.evaluate((i) => {
        const m = document.getElementById(i);
        return { role: m.getAttribute('role'), modal: m.getAttribute('aria-modal') };
      }, id);
      let trapped = true;
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Tab');
        trapped =
          trapped &&
          (await page.evaluate(
            (x) => document.getElementById(x).contains(document.activeElement),
            id,
          ));
      }
      await page.keyboard.press('Escape');
      const closed = await waitTrue(
        page,
        (i) => !window.__t.vis(document.getElementById(i)),
        id,
        2000,
      );
      await waitTrue(page, () => document.activeElement !== document.body, null, 500);
      const returned = await opener.evaluate((el) => el === document.activeElement);
      check(
        `${label}: role=dialog, aria-modal, focus moves in and stays (Tab), Escape closes`,
        opened && attrs.role === 'dialog' && attrs.modal === 'true' && trapped && closed,
        JSON.stringify({ opened, ...attrs, trapped, closed }),
      );
      check(`${label}: focus returns to the opener`, returned);
    };
    await dialogCheck(
      'About dialog',
      page.locator('header button[aria-label^="About"]'),
      'aboutModal',
      'Enter',
    );
    await app(page, (a) => a.setMode('presets'));
    await settle(page);
    await dialogCheck(
      'Save preset dialog',
      page.locator('button:visible', { hasText: /^\s*Save preset\s*$/ }).first(),
      'saveModal',
      'Enter',
    );
    await app(page, (a) => a.setMode('dual'));
    await settle(page);
    await dialogCheck(
      'Headphones dialog',
      page.locator('label', { hasText: 'Binaural demo' }).locator('input[type=checkbox]'),
      'headphonesModal',
      'Space',
    );
    check(
      'cancelling the headphones dialog leaves binaural off',
      (await app(page, (a) => a.dual.binaural)) === false,
    );
    await app(page, (a) => a.setMode('playground'));

    console.log('§61 safety alert at 1280 px');
    const s1280 = await page.evaluate((S) => {
      const t = window.__t;
      const dom = t.norm(document.body.textContent);
      const r = t.rendered();
      return S.map((s) => ({ dom: dom.includes(s), visible: r.includes(s) }));
    }, SAFETY_NOTICE);
    check(
      'both spec safety sentences are in the DOM and visible at 1280 px',
      s1280.every((s) => s.dom && s.visible),
      JSON.stringify(s1280),
    );

    console.log('§24/§60 no fake science, terminology');
    const corpus = await app(page, async (a, e, O) => {
      const t = window.__t;
      const out = [document.title, document.querySelector('meta[name=description]').content];
      for (const h of document.querySelectorAll('[data-accordion-target]')) {
        if (h.getAttribute('aria-expanded') !== 'true') h.click();
      }
      a.explore = true;
      for (const m of ['playground', 'sweep', 'dual', 'presets', 'learn']) {
        a.setMode(m);
        await t.raf();
        out.push(document.body.innerText);
      }
      for (const v of a.VIZ_MODES) {
        a.vizMode = v.id;
        out.push(a.vizCaption);
      }
      a.vizMode = 'wave';
      for (const m of document.querySelectorAll('[data-oscilla-modal], [role=dialog]')) {
        out.push(
          ...[...m.querySelectorAll('h1,h2,h3,p,label,button,li')].map((x) => x.textContent),
        );
      }
      for (const p of O.BUILTIN_PRESETS) out.push(p.name, p.desc, p.params);
      for (const tp of O.LEARN_TOPICS) {
        out.push(tp.title, tp.body, tp.demo.label);
        a.learnTopic = tp.id;
        out.push(a.topicExample);
      }
      a.learnTopic = 'frequency';
      for (const p of O.PATTERNS) out.push(p.label, p.desc, ...p.params.map((d) => d.label));
      a.setMode('playground');
      a.setRangeMode('advanced');
      for (const f of [30, 440, 15500, 21000]) {
        a.setFrequency(f);
        for (const w of ['sine', 'square']) {
          a.setWaveform(w);
          out.push(...a.hints, a.representability);
        }
      }
      out.push(...Object.values(O.viz.state.labels).filter((x) => typeof x === 'string'));
      out.push(...O.viz.state.pathNodes.flatMap((n) => [n.title, n.sub]));
      a.setWaveform('sine');
      a.setRangeMode('human');
      a.setFrequency(440);
      a.explore = false;
      return out;
    });
    const sketchSrc = source.slice(
      source.search(/\/\/ \d*\.?\s*P5 SKETCH/),
      source.search(/\/\/ \d*\.?\s*BOOTSTRAP/),
    );
    const canvasText = [...sketchSrc.matchAll(/'([^'\n]{4,})'/g)].map((m) => m[1]);
    const said = [...new Set([...corpus, ...canvasText].flatMap(sentences))];
    const hits = said.filter((s) => BANNED.some((re) => re.test(s)));
    const unreviewed = hits.filter((s) => !NEGATED_CLAIMS.includes(s));
    const badAllow = NEGATED_CLAIMS.filter((s) => !NEGATION.test(s));
    check(
      `no banned claim or “Bad” term outside ${NEGATED_CLAIMS.length} reviewed negations ` +
        `(${said.length} sentences scanned)`,
      unreviewed.length === 0 && badAllow.length === 0,
      JSON.stringify({ unreviewed, badAllow }, null, 1),
    );
    check(
      '§21: “SPL” appears only negated (not SPL / no SPL)',
      hits.filter((s) => /\bSPL\b/.test(s)).every((s) => NEGATION.test(s)),
      JSON.stringify(hits.filter((s) => /\bSPL\b/.test(s))),
    );

    console.log('§10 fine frequency controls');
    await page.setViewportSize({ width: 1280, height: 700 });
    await app(page, (a) => {
      a.setMode('playground');
      a.setPattern('tone');
      a.setRangeMode('human');
      a.setFrequency(440);
    });
    await settle(page);
    const fine = page.locator('[role=group][aria-label="Fine frequency steps"] button');
    const FINE = [
      ['−1 octave', 220],
      ['+1 octave', 880],
      ['−1 semitone', 440 / Math.pow(2, 1 / 12)],
      ['+1 semitone', 440 * Math.pow(2, 1 / 12)],
      ['−10 Hz', 430],
      ['+10 Hz', 450],
      ['−1 Hz', 439],
      ['+1 Hz', 441],
    ];
    const fineGot = [];
    for (let i = 0; i < FINE.length; i++) {
      await app(page, (a) => a.setFrequency(440));
      await fine.nth(i).click();
      fineGot.push(await app(page, (a) => a.frequency));
    }
    check(
      `fine steps from 440 Hz: ${FINE.map(([l]) => l).join(', ')}`,
      (await fine.count()) === 8 && FINE.every(([, w], i) => near(fineGot[i], w, 0.01)),
      JSON.stringify(fineGot),
    );
    const fmap = page.locator('[x-ref=fmap]');
    const mapKey = async (k) => {
      await app(page, (a) => a.setFrequency(440));
      await page.keyboard.press(k);
      return app(page, (a) => a.frequency);
    };
    await fmap.focus();
    const mk = {
      plain: await mapKey('ArrowUp'),
      shift: await mapKey('Shift+ArrowUp'),
      alt: await mapKey('Alt+ArrowUp'),
    };
    check(
      'focused map: Arrow = 1 semitone, Shift = 10 cents, Alt = 1 cent',
      near(mk.plain, 440 * Math.pow(2, 1 / 12), 0.01) &&
        near(mk.shift, 440 * Math.pow(2, 10 / 1200), 0.01) &&
        near(mk.alt, 440 * Math.pow(2, 1 / 1200), 0.01),
      JSON.stringify(mk),
    );
    await page.evaluate(() => {
      document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    const unfocusedKey = await mapKey('ArrowUp');
    check(
      'arrow keys do nothing when the map is not focused',
      unfocusedKey === 440,
      String(unfocusedKey),
    );
    let mb = await fmap.boundingBox();
    await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
    await page.mouse.wheel(0, 200);
    const pageScrolled = await waitTrue(page, () => window.scrollY > 0, null, 2000);
    await page.evaluate(() => window.__t.sleep(150));
    const afterWheel = await app(page, (a) => a.frequency);
    check(
      'wheel over the unfocused map scrolls the page and leaves the frequency',
      pageScrolled && afterWheel === 440,
      JSON.stringify({ pageScrolled, afterWheel }),
    );
    await fmap.focus();
    await settle(page);
    const y0 = await page.evaluate(() => window.scrollY);
    mb = await fmap.boundingBox();
    await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
    await page.mouse.wheel(0, 200);
    const wheelStep = await waitTrue(
      page,
      () => window.Alpine.$data(document.body).frequency !== 440,
      null,
      2000,
    );
    const focusedWheel = await page.evaluate(() => ({
      f: window.Alpine.$data(document.body).frequency,
      y: window.scrollY,
    }));
    check(
      'wheel over the focused map steps the frequency and does not scroll the page',
      wheelStep && near(focusedWheel.f, 440 / Math.pow(2, 1 / 12), 0.01) && focusedWheel.y === y0,
      JSON.stringify({ y0, ...focusedWheel }),
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await app(page, (a) => a.setFrequency(440));

    console.log('§20 continuous playback');
    const safeId = await accId(/playback safety/);
    await openAccordion(page, safeId);
    const limits = await page.evaluate(
      (id) =>
        [...document.querySelectorAll(`#${id} [role=radiogroup] [role=radio]`)].map((r) => ({
          t: window.__t.norm(r.textContent),
          on: r.getAttribute('aria-checked'),
        })),
      safeId,
    );
    check(
      'limit options exactly 0.5 / 1 / 2 / 3 / 5 s, default 2 s',
      JSON.stringify(limits.map((l) => l.t)) ===
        JSON.stringify(['0.5 s', '1 s', '2 s', '3 s', '5 s']) &&
        limits
          .filter((l) => l.on === 'true')
          .map((l) => l.t)
          .join() === '2 s',
      JSON.stringify(limits),
    );
    const latchBtn = page.locator('button', { hasText: /PLAY CONTINUOUSLY/ });
    const latchBefore = await latchBtn.isVisible();
    await page.locator('label', { hasText: 'Allow continuous playback' }).click();
    await settle(page);
    const contOn = await app(page, (a) => a.continuousAllowed);
    const latchAfter = await latchBtn.isVisible();
    check(
      'the PLAY CONTINUOUSLY button appears only after “Allow continuous playback”',
      !latchBefore && contOn && latchAfter,
      JSON.stringify({ latchBefore, contOn, latchAfter }),
    );
    const persisted = await app(page, async (a) => {
      a.setPattern('finite');
      a.duration = 50;
      a.play('trigger');
      a.stopNow();
      a.saveName = 'spec continuous check';
      a.savePreset();
      await a.copyConfigLink();
      a.closeModal('copyModal');
      const dump = (s) => {
        const o = {};
        for (let i = 0; i < s.length; i++) o[s.key(i)] = s.getItem(s.key(i));
        return o;
      };
      const out = {
        local: dump(localStorage),
        session: dump(sessionStorage),
        link: a.copyUrl,
        hash: location.hash,
        still: a.continuousAllowed,
      };
      a.setContinuous(false);
      a.setPattern('tone');
      a.duration = 500;
      try {
        history.replaceState(null, '', location.href.split('#')[0]);
      } catch (err) {
        /* file:// */
      }
      return out;
    });
    const leaks = [];
    const scan = (v, where) => {
      if (typeof v === 'string') {
        if (v === 'continuous') leaks.push(where);
        if (/^[[{]/.test(v)) {
          try {
            scan(JSON.parse(v), where);
          } catch (err) {
            /* not JSON */
          }
        }
      } else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (/continu|latch/i.test(k)) leaks.push(`${where}.${k}`);
          scan(x, `${where}.${k}`);
        }
      }
    };
    scan(persisted.local, 'localStorage');
    scan(persisted.session, 'sessionStorage');
    for (const url of [persisted.link, persisted.hash]) {
      const q = new URLSearchParams(String(url).split('#')[1] || '');
      for (const [k, v] of q) {
        if (/continu|latch/i.test(k) || v === 'continuous') leaks.push(`hash ${k}`);
        if (k === 'x') scan(JSON.parse(Buffer.from(v, 'base64url').toString('utf8')), 'hash x');
      }
    }
    check(
      'continuous permission never reaches localStorage, sessionStorage or the link',
      persisted.still && persisted.link.includes('#') && leaks.length === 0,
      JSON.stringify({ leaks, link: persisted.link }),
    );

    console.log('§53 debug mode (default)');
    check(
      'no debug panel without ?debug=1',
      !(await page.locator('aside[aria-label="Debug panel"]').isVisible()),
    );

    console.log('§47 theme');
    const pal = () =>
      app(page, (a, e, O) => ({
        dark: document.documentElement.classList.contains('dark'),
        theme: a.theme,
        bg: O.viz.palette.bg.join(','),
        v: O.viz.paletteVersion,
        stored: localStorage.getItem('oscilla.theme'),
      }));
    const chooseTheme = async (t) => {
      await page.click('#themeButton');
      await page.locator('#themeMenu [role=menuitemradio]', { hasText: t }).click();
      await settle(page);
    };
    const th0 = await pal();
    check(
      'theme defaults to system (light here)',
      th0.theme === 'system' && !th0.dark,
      JSON.stringify(th0),
    );
    await chooseTheme('dark');
    const th1 = await pal();
    check(
      'choosing dark applies it and stores it',
      th1.dark && th1.theme === 'dark' && th1.stored === 'dark',
      JSON.stringify(th1),
    );
    check(
      'the visualization palette follows the theme',
      th1.bg !== th0.bg && th1.v > th0.v,
      JSON.stringify([th0.bg, th1.bg]),
    );
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    const th2 = await pal();
    check(
      'an explicit theme persists across reload',
      th2.dark && th2.theme === 'dark',
      JSON.stringify(th2),
    );
    await chooseTheme('system');
    await page.emulateMedia({ colorScheme: 'dark' });
    const sysDark = await waitTrue(
      page,
      () => document.documentElement.classList.contains('dark'),
      null,
      2000,
    );
    const palDark = await pal();
    await page.emulateMedia({ colorScheme: 'light' });
    const sysLight = await waitTrue(
      page,
      () => !document.documentElement.classList.contains('dark'),
      null,
      2000,
    );
    const palLight = await pal();
    check(
      'system theme follows prefers-color-scheme live (and the palette with it)',
      sysDark && sysLight && palDark.bg !== palLight.bg && palLight.stored === 'system',
      JSON.stringify({ sysDark, sysLight, palDark, palLight }),
    );
    await chooseTheme('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => window.__t.sleep(300));
    const forcedLight = await pal();
    check(
      'an explicit light theme ignores a dark system preference',
      !forcedLight.dark && forcedLight.theme === 'light',
      JSON.stringify(forcedLight),
    );
    await page.emulateMedia({ colorScheme: 'light' });
    await context.close();
  }

  // ------------------------------------------------------------------ audio engine at 44.1 kHz
  {
    // Forces 44.1 kHz and instruments the Web Audio graph: node creation, oscillator 'ended'
    // events, every AudioParam scheduling call (value, time, and whether it runs inside a
    // setTimeout / setInterval / requestAnimationFrame callback).
    const audioProbe = () => {
      const P = (window.__probe = {
        osc: 0,
        ended: 0,
        biquads: 0,
        compressors: 0,
        freqHigh: [],
        inTimer: 0,
        timerCount: 0,
        timerSamples: [],
        badTimes: [],
        zeroSets: 0,
        expToZero: 0,
      });
      const NYQ = 22050;
      for (const name of ['AudioContext', 'webkitAudioContext']) {
        const C = window[name];
        if (typeof C !== 'function') continue;
        window[name] = new Proxy(C, {
          construct(t, a, nt) {
            return Reflect.construct(t, [{ ...(a[0] || {}), sampleRate: 44100 }], nt);
          },
        });
      }
      const freqParams = new WeakSet();
      const gainParams = new WeakSet();
      const onOsc = (o) => {
        P.osc++;
        freqParams.add(o.frequency);
        o.addEventListener('ended', () => P.ended++);
      };
      const Base = window.BaseAudioContext || window.AudioContext || window.webkitAudioContext;
      const wrapCreate = (name, after) => {
        const orig = Base.prototype[name];
        if (typeof orig !== 'function') return;
        Base.prototype[name] = function (...a) {
          const n = orig.apply(this, a);
          after(n);
          return n;
        };
      };
      wrapCreate('createOscillator', onOsc);
      wrapCreate('createGain', (g) => gainParams.add(g.gain));
      wrapCreate('createBiquadFilter', () => P.biquads++);
      wrapCreate('createDynamicsCompressor', () => P.compressors++);
      for (const [name, after] of [
        ['OscillatorNode', onOsc],
        ['BiquadFilterNode', () => P.biquads++],
      ]) {
        const C = window[name];
        if (typeof C !== 'function') continue;
        window[name] = new Proxy(C, {
          construct(t, a, nt) {
            const n = Reflect.construct(t, a, nt);
            after(n);
            return n;
          },
        });
      }
      const AP = window.AudioParam.prototype;
      const clock = () => {
        const e = window.OSCILLA && window.OSCILLA.engine;
        return e && e.ctx ? e.ctx.currentTime : null;
      };
      for (const m of [
        'setValueAtTime',
        'linearRampToValueAtTime',
        'exponentialRampToValueAtTime',
        'setTargetAtTime',
      ]) {
        const orig = AP[m];
        AP[m] = function (v, t, ...rest) {
          if (P.inTimer) {
            P.timerCount++;
            if (P.timerSamples.length < 3) {
              P.timerSamples.push(`${m}: ${(new Error().stack || '').split('\n').slice(2, 5)}`);
            }
          }
          if (freqParams.has(this) && v >= NYQ) P.freqHigh.push(`${m}(${v})`);
          if (gainParams.has(this) && m === 'setValueAtTime' && v === 0) P.zeroSets++;
          if (m === 'exponentialRampToValueAtTime' && !(v > 0)) P.expToZero++;
          const c = clock();
          if (c != null && typeof t === 'number' && (t < c - 0.05 || t > c + 700)) {
            if (P.badTimes.length < 5) P.badTimes.push(`${m}(t=${t}) at currentTime ${c}`);
          }
          return orig.call(this, v, t, ...rest);
        };
      }
      const vd = Object.getOwnPropertyDescriptor(AP, 'value');
      if (vd && vd.set) {
        Object.defineProperty(AP, 'value', {
          ...vd,
          set(v) {
            if (freqParams.has(this) && v >= NYQ) P.freqHigh.push(`value=${v}`);
            vd.set.call(this, v);
          },
        });
      }
      for (const name of ['setTimeout', 'setInterval', 'requestAnimationFrame']) {
        const orig = window[name];
        window[name] = function (cb, ...rest) {
          if (typeof cb !== 'function') return orig.call(window, cb, ...rest);
          const wrapped = function (...a) {
            P.inTimer++;
            try {
              return cb.apply(this, a);
            } finally {
              P.inTimer--;
            }
          };
          return orig.call(window, wrapped, ...rest);
        };
      }
    };
    const { page, context } = await openPage(browser, { init: audioProbe });

    console.log('§6 frequency range at 44.1 kHz');
    const r6 = await app(page, (a, e) => {
      const out = { before: a.provisional };
      a.ensureAudio();
      Object.assign(out, {
        after: a.provisional,
        sr: e.sampleRate,
        nyq: a.nyquist,
        safe: a.safeMax,
      });
      for (const m of ['human', 'high', 'advanced']) {
        a.setRangeMode(m);
        out[m] = [a.rangeMin, a.rangeMax];
      }
      a.setFrequency(1e6);
      out.clamped = a.frequency;
      a.setRangeMode('human');
      a.setFrequency(440);
      return out;
    });
    check(
      'context forced to 44.1 kHz replaces the provisional assumption',
      r6.sr === 44100 && r6.before === true && r6.after === false,
      JSON.stringify(r6),
    );
    check(
      'safe maximum = 0.95 × 44100 / 2 = 20947.5 Hz',
      near(r6.safe, 20947.5, 1e-6),
      String(r6.safe),
    );
    check(
      'HUMAN 20–20000, HIGH 8000–20947.5, ADVANCED 1–20947.5',
      JSON.stringify([r6.human, r6.high, r6.advanced]) ===
        JSON.stringify([
          [20, 20000],
          [8000, 20947.5],
          [1, 20947.5],
        ]),
      JSON.stringify([r6.human, r6.high, r6.advanced]),
    );
    check(
      'setFrequency(1 MHz) clamps to the safe maximum',
      near(r6.clamped, 20947.5, 0.001),
      String(r6.clamped),
    );

    console.log('§2 tech stack: audio chain');
    const chain = await app(page, (a, e) => ({
      compressors: window.__probe.compressors,
      limiter: e.limiter instanceof DynamicsCompressorNode,
    }));
    check(
      'the output chain contains a DynamicsCompressorNode',
      chain.compressors >= 1 && chain.limiter,
      JSON.stringify(chain),
    );

    console.log('§15 Web Audio architecture');
    const eng = await app(page, (a, e) => ({
      cls: e.constructor && e.constructor.name,
      analyser: e.analyser instanceof AnalyserNode,
      sr: e.sampleRate,
      nyq: e.nyquist,
      counts: [typeof e.activeNodeCount, typeof e.activeSourceCount],
      missing: ['init', 'play', 'release', 'stopAll'].filter((f) => typeof e[f] !== 'function'),
    }));
    check(
      'a dedicated AudioEngine class exposes analyser, sample rate, Nyquist, node counts, stop',
      eng.cls === 'AudioEngine' &&
        eng.analyser &&
        eng.sr === 44100 &&
        eng.nyq === 22050 &&
        eng.counts.join() === 'number,number' &&
        eng.missing.length === 0,
      JSON.stringify(eng),
    );

    console.log('§6 nothing scheduled at or above Nyquist');
    const ext = await app(page, (a, e, O) => {
      const det = (o) => o.freq * Math.pow(2, (o.detune || 0) / 1200);
      const peak = (p) => {
        if (p.type === 'lfo') return p.center + p.depth;
        if (p.type === 'fm') return p.freq + p.depth;
        if (p.type === 'dual') return Math.max(det(p.a), det(p.b));
        if (p.type === 'ramps') return Math.max(...p.segments.map((s) => Math.max(s.f0, s.f1)));
        if (p.type === 'steps') return Math.max(...p.steps.map((s) => s.f));
        return p.freq;
      };
      const out = [];
      const run = (label, mode) => {
        const ok = a.play(mode);
        out.push({ label, ok, peak: ok && e.voice ? peak(e.voice.plan) : null });
        a.stopNow();
      };
      a.setMode('playground');
      a.setRangeMode('advanced');
      a.frequency = 1e6; // bypasses setFrequency: the plan itself must clamp
      Object.assign(a.pp.sweepUp, { start: 1e5, end: 1e6 });
      Object.assign(a.pp.sweepDown, { start: 1e5, end: 1e6 });
      Object.assign(a.pp.pingpong, { min: 1e4, max: 1e6 });
      Object.assign(a.pp.chirp, { start: 1e4, end: 1e6 });
      Object.assign(a.pp.siren, { min: 1e5, max: 1e6 });
      Object.assign(a.pp.alternating, { fA: 1e5, fB: 1e6 });
      Object.assign(a.pp.wobble, { depth: 5000 });
      Object.assign(a.pp.fm, { depthHz: 10000, modFreq: 2000 });
      Object.assign(a.pp.random, { min: 1e4, max: 1e6 });
      a.pp.octave.text = '8000, 16000, 32000, 64000';
      a.pp.sequence.text = '30000, 440, 25000';
      for (const p of O.PATTERNS) {
        a.setPattern(p.id);
        run(p.id, p.kind === 'open' ? 'hold' : 'trigger');
      }
      a.setMode('sweep');
      a.sweep.start = 20;
      a.sweep.end = 1e6;
      run('sweep mode', 'trigger');
      a.setMode('dual');
      a.dual.a.freq = 1e6;
      a.dual.a.detune = 1200;
      a.dual.b.freq = 21500;
      run('dual osc', 'hold');
      a.resetDefaults();
      a.setMode('playground');
      a.alerts = [];
      return { nyq: e.nyquist, out, freqHigh: window.__probe.freqHigh.slice(0, 5) };
    });
    const notPlayed = ext.out.filter((r) => !r.ok).map((r) => r.label);
    check(
      `all 16 patterns, sweep mode and dual osc play with out-of-range input`,
      ext.out.length === 18 && notPlayed.length === 0,
      JSON.stringify(notPlayed),
    );
    const overNyq = ext.out.filter((r) => r.ok && !(r.peak < ext.nyq));
    check(
      'every played signal peaks below Nyquist (incl. LFO/FM depth and detune)',
      overNyq.length === 0,
      JSON.stringify(overNyq),
    );
    check(
      'no oscillator frequency is ever scheduled at or above Nyquist',
      ext.freqHigh.length === 0,
      JSON.stringify(ext.freqHigh),
    );
    check(
      'no BiquadFilterNode is created during any play',
      (await page.evaluate(() => window.__probe.biquads)) === 0,
    );

    console.log('§17/§18 click-free playback and stop semantics');
    const clean = () =>
      waitTrue(
        page,
        () => {
          const e = window.OSCILLA.engine;
          const P = window.__probe;
          return (
            e.activeNodeCount === 0 &&
            e.activeSourceCount === 0 &&
            e.voices.size === 0 &&
            P.osc === P.ended
          );
        },
        null,
        4000,
      );
    const engState = () =>
      app(page, (a, e) => ({
        nodes: e.activeNodeCount,
        sources: e.activeSourceCount,
        voices: e.voices.size,
        osc: window.__probe.osc,
        ended: window.__probe.ended,
      }));
    const clean1 = await clean();
    check(
      'after stop every oscillator has ended and the engine holds 0 nodes and 0 sources',
      clean1,
      JSON.stringify(await engState()),
    );
    const loop = await app(page, (a, e) => {
      a.setMode('playground');
      a.setPattern('tone');
      let maxLive = 0;
      const live = () => [...e.voices].filter((v) => !v.releasing && !v.ended).length;
      for (let i = 0; i < 20; i++) {
        a.play('hold');
        maxLive = Math.max(maxLive, live());
        a.stopNow();
      }
      const okLast = a.play('hold') && !!e.voice && !e.voice.releasing;
      a.stopNow();
      return { maxLive, okLast };
    });
    const clean2 = await clean();
    check(
      'PLAY → STOP × 20, then PLAY again: plays every time, then 0 nodes and all oscillators ended',
      loop.okLast && loop.maxLive === 1 && clean2,
      JSON.stringify({ ...loop, ...(await engState()) }),
    );
    const stack = await app(page, (a, e) => {
      const live = () => [...e.voices].filter((v) => !v.releasing && !v.ended).length;
      let maxLive = 0;
      for (let i = 0; i < 5; i++) {
        a.play('hold');
        maxLive = Math.max(maxLive, live());
      }
      a.stopNow();
      return maxLive;
    });
    const clean3 = await clean();
    check(
      'five PLAYs without STOP never stack voices (one sounding voice at a time)',
      stack === 1 && clean3,
      JSON.stringify({ stack, ...(await engState()) }),
    );
    const clicks = await page.evaluate(() => [window.__probe.zeroSets, window.__probe.expToZero]);
    check(
      'no gain is hard-set to 0 and no exponential ramp targets 0',
      clicks[0] === 0 && clicks[1] === 0,
      JSON.stringify(clicks),
    );

    console.log('§19 playback UX');
    await app(page, (a) => {
      a.setMode('playground');
      a.setPattern('tone');
      a.safetyLimit = 5;
      a.alerts = [];
    });
    const hold = page.locator('.hold-btn');
    let hb;
    const pressHold = async () => {
      await hold.scrollIntoViewIfNeeded();
      hb = await hold.boundingBox();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
    };
    await pressHold();
    const sDown = await voiceState(page);
    await page.mouse.move(hb.x + hb.width / 2, Math.max(2, hb.y - 120));
    await page.evaluate(() => window.__t.sleep(60));
    const sOut = await voiceState(page);
    await page.mouse.up();
    const sUp = await voiceState(page);
    check('pointerdown on HOLD starts playback', sDown === 'playing', sDown);
    check(
      'a captured hold keeps playing when the pointer leaves the button',
      sOut === 'playing',
      sOut,
    );
    check('pointerup releases', sUp !== 'playing', sUp);
    await stopClean(page);
    await pressHold();
    const sDown2 = await voiceState(page);
    await hold.dispatchEvent('pointercancel', {
      pointerId: 1,
      pointerType: 'mouse',
      bubbles: true,
    });
    const sCancel = await voiceState(page);
    await page.mouse.up();
    check(
      'pointercancel releases',
      sDown2 === 'playing' && sCancel !== 'playing',
      `${sDown2} → ${sCancel}`,
    );
    await stopClean(page);
    const leave = await page.evaluate(async () => {
      const b = document.querySelector('.hold-btn');
      const state = () => {
        const v = window.OSCILLA.engine.voice;
        return v ? (v.releasing ? 'releasing' : 'playing') : 'none';
      };
      const init = { pointerId: 77, pointerType: 'touch', isPrimary: true, bubbles: true };
      b.dispatchEvent(new PointerEvent('pointerdown', { ...init, cancelable: true }));
      const down = state();
      b.dispatchEvent(new PointerEvent('pointerleave', { ...init, bubbles: false }));
      return { down, captured: b.hasPointerCapture(77), left: state() };
    });
    check(
      'pointerleave releases when the pointer is not captured',
      leave.down === 'playing' && !leave.captured && leave.left !== 'playing',
      JSON.stringify(leave),
    );
    await stopClean(page);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.down('Space');
    const spaceDown = await voiceState(page);
    await page.keyboard.up('Space');
    const spaceUp = await voiceState(page);
    check(
      'Space on the page holds an open pattern; releasing Space releases',
      spaceDown === 'playing' && spaceUp !== 'playing',
      `${spaceDown} → ${spaceUp}`,
    );
    await stopClean(page);
    await app(page, (a) => {
      a.setPattern('finite');
      a.duration = 800;
    });
    const seq0 = await app(page, (a, e) => e._seq);
    await page.keyboard.press('Space');
    const trig = await app(
      page,
      (a, e, O, s0) => ({
        started: e._seq === s0 + 1,
        kind: e.voice && e.voice.plan.kind,
        releasing: !!(e.voice && e.voice.releasing),
      }),
      seq0,
    );
    check(
      'Space triggers a programmed pattern (keyup does not cut it)',
      trig.started && trig.kind === 'finite' && !trig.releasing,
      JSON.stringify(trig),
    );
    await stopClean(page);
    const ignored = await app(page, async (a, e) => {
      const t = window.__t;
      const out = {};
      const fire = (el, name) => {
        if (!el) {
          out[name] = 'missing';
          return;
        }
        el.focus();
        const before = e._seq;
        const init = { key: ' ', code: 'Space', bubbles: true, cancelable: true };
        el.dispatchEvent(new KeyboardEvent('keydown', init));
        el.dispatchEvent(new KeyboardEvent('keyup', init));
        out[name] =
          document.activeElement !== el ? 'not focused' : e._seq !== before ? 'PLAYED' : 'ignored';
        a.stopNow();
      };
      a.setMode('playground');
      a.setPattern('sequence');
      await t.raf();
      fire(document.getElementById('freq-input'), 'input');
      fire(document.querySelector('section[aria-labelledby=pattern-heading] textarea'), 'textarea');
      a.setPattern('chirp');
      await t.raf();
      fire(document.querySelector('section[aria-labelledby=pattern-heading] select'), 'select');
      const trigger = [...document.querySelectorAll('button')].find(
        (b) => t.norm(b.textContent) === 'TRIGGER',
      );
      fire(trigger, 'button (TRIGGER)');
      fire(document.getElementById('tab-sweep'), 'button (mode tab)');
      const ce = document.createElement('div');
      ce.contentEditable = 'true';
      ce.textContent = 'editable';
      document.body.appendChild(ce);
      fire(ce, 'contenteditable');
      ce.remove();
      return out;
    });
    check(
      'Space is ignored in input, textarea, select, other buttons and contenteditable',
      Object.values(ignored).every((v) => v === 'ignored'),
      JSON.stringify(ignored),
    );
    await page.focus('#freq-input');
    const seq1 = await app(page, (a, e) => e._seq);
    await page.keyboard.press('Space');
    check(
      'a real Space keypress in the frequency input does not play',
      (await app(page, (a, e) => e._seq)) === seq1,
    );
    await app(page, (a) => {
      a.setPattern('tone');
      a.setFrequency(440);
    });
    await stopClean(page);
    await pressHold();
    const escBefore = await voiceState(page);
    await page.keyboard.press('Escape');
    const escAfter = await voiceState(page);
    await page.mouse.up();
    check(
      'Escape stops immediately',
      escBefore === 'playing' && escAfter !== 'playing',
      `${escBefore} → ${escAfter}`,
    );
    await stopClean(page);
    await hold.focus();
    await page.keyboard.down('Space');
    const tabBefore = await voiceState(page);
    await page.keyboard.press('Tab');
    let tabMoved = await hold.evaluate((el) => el !== document.activeElement);
    if (!tabMoved) {
      await hold.evaluate((el) => el.blur()); // WebKit: Tab may not leave a button
      tabMoved = 'blur()';
    }
    const tabAfter = await voiceState(page);
    await page.keyboard.up('Space');
    check(
      'holding Space on HOLD, then Tab away (blur) releases',
      tabBefore === 'playing' && tabAfter !== 'playing',
      JSON.stringify({ tabBefore, tabMoved, tabAfter }),
    );
    await stopClean(page);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.down('Space');
    const blurBefore = await voiceState(page);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const blurAfter = await voiceState(page);
    await page.keyboard.up('Space');
    check(
      'holding Space on the page, then window blur, releases',
      blurBefore === 'playing' && blurAfter !== 'playing',
      `${blurBefore} → ${blurAfter}`,
    );
    await stopClean(page);

    console.log('§49 playback state for assistive technology');
    await app(page, (a) => {
      a.setPattern('finite');
      a.duration = 300;
    });
    await waitTrue(page, () => window.Alpine.$data(document.body).status === 'READY', null, 3000);
    const statusInfo = await page.evaluate(() => {
      const re = /\b(READY|PLAYING|RELEASING|STOPPED|ERROR)\b/;
      const header = document.querySelector('header');
      // Announced: the header live region, which speaks only PLAYING, STOPPED and ERROR.
      const el = header.querySelector('[role=status]');
      // Shown: the visible status word (a STOP button while playing or releasing).
      const shown = () => {
        const app = window.Alpine.$data(document.body);
        return [...header.querySelectorAll('button, div')].some(
          (x) => x.offsetParent !== null && !x.closest('.sr-only') && x.textContent.includes(app.status),
        ) ? app.status : null;
      };
      window.__statusSeq = [];
      window.__shownSeq = [];
      const push = (arr, v) => { if (v && arr[arr.length - 1] !== v) arr.push(v); };
      const rec = () => {
        const m = el.textContent.match(re);
        push(window.__statusSeq, m && m[1]);
        push(window.__shownSeq, shown());
      };
      rec();
      new MutationObserver(rec).observe(header, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      return {
        live: el.getAttribute('aria-live') || 'polite (role=status)',
        inHeader: !!el.closest('header'),
      };
    });
    const triggerBtn = page.locator('button', { hasText: /^\s*TRIGGER\s*$/ });
    await triggerBtn.click();
    await waitTrue(page, () => window.__shownSeq.slice(1).includes('READY'), null, 5000);
    const statusSeq = await page.evaluate(() => window.__statusSeq);
    const shownSeq = await page.evaluate(() => window.__shownSeq);
    const inOrder = (seq, want) => {
      let wi = 0;
      for (const s of seq) if (s === want[wi]) wi++;
      return wi === want.length;
    };
    check(
      '[role=status] announces PLAYING → STOPPED only; the header shows PLAYING → RELEASING → ' +
        'STOPPED → READY for a triggered tone',
      inOrder(statusSeq, ['PLAYING', 'STOPPED']) &&
        !statusSeq.some((x) => x === 'RELEASING' || x === 'READY') &&
        inOrder(shownSeq, ['PLAYING', 'RELEASING', 'STOPPED', 'READY']),
      JSON.stringify({ statusSeq, shownSeq, ...statusInfo }),
    );
    await app(page, (a) => {
      a.setPattern('sequence');
      a.pp.sequence.text = '440, abc';
      a.alerts = [];
    });
    await settle(page);
    await triggerBtn.click();
    await settle(page);
    const errState = await page.evaluate(() => {
      const t = window.__t;
      const alert = [...document.querySelectorAll('[role=alert]')].find(t.vis);
      return {
        seq: window.__statusSeq.slice(-1)[0],
        alert: alert ? t.norm(alert.textContent) : '',
      };
    });
    check(
      'an invalid sequence sets ERROR in [role=status] and shows an alert',
      errState.seq === 'ERROR' && /invalid|abc/i.test(errState.alert),
      JSON.stringify(errState),
    );
    await app(page, (a) => {
      a.pp.sequence.text = '440, 880, 660, 1320';
      a.alerts = [];
    });
    await settle(page);
    await app(page, (a) => a.setPattern('tone'));

    console.log('§50 metrics during a 20 Hz → 20 kHz sweep');
    const metricsHead = page.locator('[data-accordion-target]', {
      hasText: /live technical metrics/i,
    });
    if ((await metricsHead.getAttribute('aria-expanded')) !== 'true') await metricsHead.click();
    const readMetrics = () =>
      page.evaluate(() => {
        const t = window.__t;
        const out = {};
        for (const dt of document.querySelectorAll('dt')) {
          const k = t.norm(dt.textContent);
          if (/^(requested frequency|duration)$/i.test(k) && t.vis(dt) && !(k in out)) {
            out[k] = t.norm(dt.nextElementSibling.textContent);
          }
        }
        return out;
      });
    await app(page, (a) => {
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
    });
    await settle(page);
    const mIdle = await readMetrics();
    await app(page, (a) => a.trigger());
    await page.evaluate(() => window.__t.sleep(400));
    const mPlay = await readMetrics();
    const mOk = (m) => {
      const req = m['Requested frequency'] || '';
      return (
        req.includes('20 Hz') && req.includes('20.00 kHz') && /\b10 s\b/.test(m.Duration || '')
      );
    };
    check(
      'Requested frequency shows 20 Hz – 20.00 kHz and Duration 10 s (idle and while playing)',
      mOk(mIdle) && mOk(mPlay),
      JSON.stringify({ mIdle, mPlay }),
    );
    await stopClean(page);

    console.log('§21 conservative output gain');
    // Read while a tone sounds: Chromium stops advancing automation on an idle GainNode.
    await app(page, (a) => {
      a.setMode('playground');
      a.setPattern('tone');
      a.setGainPct(100);
      a.play('hold');
    });
    await page.evaluate(() => window.__t.sleep(250));
    const master = await app(page, (a, e) => ({
      value: e.master.gain.value,
      level: a.gainLevel,
      ctx: e.ctx.state,
    }));
    await stopClean(page);
    check(
      'UI 100 % drives the master gain to 0.25, never to Web Audio gain 1',
      master.value > 0.2 && master.value <= 0.25 + 1e-6,
      JSON.stringify(master),
    );
    await app(page, (a) => {
      a.gainLevel = 0.08;
    });

    console.log('§15/§16 audio scheduling on the AudioContext clock');
    const sched = await page.evaluate(() => {
      const P = window.__probe;
      return { timerCount: P.timerCount, samples: P.timerSamples, badTimes: P.badTimes };
    });
    check(
      'no AudioParam is scheduled from a setTimeout / setInterval / rAF callback',
      sched.timerCount === 0,
      JSON.stringify(sched.samples),
    );
    check(
      'every AudioParam event time is on the AudioContext clock (≥ currentTime)',
      sched.badTimes.length === 0,
      JSON.stringify(sched.badTimes),
    );
    await context.close();
  }

  // ------------------------------------------------------------------ phone width + responsive
  {
    const touch = ENGINE !== 'firefox'; // Playwright's Firefox has no touch emulation
    const { page, context } = await openPage(browser, {
      width: 375,
      height: 667,
      ctx: { hasTouch: touch },
    });
    const MODES = ['playground', 'sweep', 'dual', 'presets', 'learn'];

    console.log('§3 product identity at 375 px');
    for (const txt of ['OSCILLA', 'Interactive Sound & Frequency Lab']) {
      const b = await textBox(page, txt);
      check(`375 px: “${txt}” visible, not truncated`, b.found && !b.truncated, JSON.stringify(b));
    }

    console.log('§61 safety alert at 375 px');
    const safetyText = () =>
      page.evaluate((S) => {
        const r = window.__t.norm(
          document.querySelector('aside[aria-label="Safety notice"]').innerText,
        );
        return { harmful: /harmful/i.test(r), full: S.every((s) => r.includes(s)), text: r };
      }, SAFETY_NOTICE);
    const s375 = await safetyText();
    check('375 px: the visible safety line mentions “harmful”', s375.harmful, s375.text);
    const more = page.locator('aside[aria-label="Safety notice"] button:visible').first();
    if (touch) await more.tap();
    else await more.click();
    await settle(page);
    const sFull = await safetyText();
    check(
      '375 px: one tap shows the full safety notice (both spec sentences)',
      sFull.full,
      sFull.text.slice(0, 160),
    );
    await app(page, (a) => {
      a.safetyExpanded = false;
    });

    console.log('§5 playground in the first viewport');
    for (const [w, h] of [
      [390, 844],
      [430, 932],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await app(page, (a) => a.setMode('playground'));
      await page.evaluate(() => window.scrollTo(0, 0));
      await settle(page);
      const fv = await page.evaluate(() => {
        const parts = {
          visualization: '[x-ref=vizCanvas]',
          readout: '[x-text=readoutText]',
          map: '[x-ref=fmap]',
          waveform: '[role=radiogroup][aria-label=Waveform]',
          hold: '.hold-btn',
        };
        const out = {};
        for (const [k, sel] of Object.entries(parts)) {
          const el = document.querySelector(sel);
          out[k] = el && window.__t.vis(el) ? Math.round(el.getBoundingClientRect().bottom) : null;
        }
        return { out, h: window.innerHeight };
      });
      const below = Object.entries(fv.out)
        .filter(([, b]) => b == null || b > fv.h)
        .map(([k, b]) => `${k} bottom ${b}`);
      check(
        `${w}×${h}: visualization, readout, map, waveform and HOLD inside the first viewport`,
        below.length === 0,
        JSON.stringify(below),
      );
    }

    console.log('§48 responsive design');
    await page.setViewportSize({ width: 375, height: 667 });
    await page.evaluate(() => {
      for (const h of document.querySelectorAll('[data-accordion-target]')) {
        if (h.getAttribute('aria-expanded') !== 'true') h.click();
      }
    });
    const reported = new Set();
    for (const m of MODES) {
      await app(page, (a, e, O, x) => a.setMode(x), m);
      await settle(page);
      const small = await page.evaluate(() => {
        const t = window.__t;
        const out = [];
        for (const el of document.querySelectorAll(
          'button, input, select, textarea, [role=slider]',
        )) {
          const box = ['checkbox', 'radio'].includes(el.type) ? el.closest('label') || el : el;
          if (!t.vis(box) || box.closest('[aria-hidden=true]')) continue;
          const r = box.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1) continue; // visually hidden (sr-only)
          if (r.width < 43.5 || r.height < 43.5) {
            const name = el.getAttribute('aria-label') || el.textContent || el.id || el.type;
            const size = `${Math.round(r.width)}×${Math.round(r.height)}`;
            out.push(`${el.tagName.toLowerCase()} “${t.norm(name).slice(0, 24)}” ${size}`);
          }
        }
        return out;
      });
      const fresh = small.filter((s) => !reported.has(s));
      small.forEach((s) => reported.add(s));
      check(
        `375 px ${m}: every visible control is a ≥ 44 × 44 px target`,
        small.length === 0,
        `${small.length} offenders${fresh.length < small.length ? ' (some listed above)' : ''}: ` +
          fresh.slice(0, 12).join(' · '),
      );
    }
    const overflow = [];
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 800 });
      for (const m of MODES) {
        await app(page, (a, e, O, x) => a.setMode(x), m);
        await settle(page);
        const d = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (d > 0) overflow.push(`${w}px ${m} +${d}`);
      }
    }
    check(
      'no horizontal overflow in any mode at 320, 375, 390, 430, 768, 1024, 1280, 1440 px',
      overflow.length === 0,
      JSON.stringify(overflow),
    );
    await context.close();
  }

  // ------------------------------------------------------------------ debug panel
  {
    console.log('§53 debug mode (?debug=1)');
    const { page, context } = await openPage(browser, { query: '?debug=1' });
    await waitTrue(
      page,
      () => document.querySelectorAll('aside[aria-label="Debug panel"] dt').length >= 14,
      null,
      3000,
    );
    const dbg = await page.evaluate(() => {
      const el = document.querySelector('aside[aria-label="Debug panel"]');
      return {
        vis: window.__t.vis(el),
        dts: [...el.querySelectorAll('dt')].map((x) => window.__t.norm(x.textContent)),
      };
    });
    check('?debug=1 shows the debug panel', dbg.vis);
    const missingDbg = DEBUG_FIELDS.filter(([, re]) => !dbg.dts.some((d) => re.test(d))).map(
      ([l]) => l,
    );
    check(
      'the debug panel lists all 14 spec fields',
      missingDbg.length === 0,
      JSON.stringify({ missingDbg, dts: dbg.dts }),
    );
    await context.close();
  }

  // ------------------------------------------------------------------ microphone
  {
    console.log('§52 optional microphone analysis');
    const gum = () => {
      window.__mic = { calls: 0, streams: [] };
      const md = navigator.mediaDevices;
      if (!md || typeof md.getUserMedia !== 'function') return;
      const orig = md.getUserMedia.bind(md);
      md.getUserMedia = (c) => {
        window.__mic.calls++;
        return orig(c).then((s) => {
          window.__mic.streams.push(s);
          return s;
        });
      };
    };
    const { page, context } = await openPage(browser, { init: gum });
    const micDefault = await app(page, (a, e) => {
      a.setPattern('finite');
      a.duration = 50;
      a.play('trigger');
      a.stopNow();
      return { active: a.micActive, mic: !!e.mic, calls: window.__mic.calls };
    });
    check(
      'microphone off by default; never requested on load or on play',
      !micDefault.active && !micDefault.mic && micDefault.calls === 0,
      JSON.stringify(micDefault),
    );
    if (ENGINE === 'webkit') {
      console.log('  skip microphone stream checks (WebKit has no fake capture device)');
    } else {
      const indicator = () =>
        page.evaluate(() => /\bMIC ON\b|microphone (is )?(on|active)/i.test(window.__t.rendered()));
      const tracks = () =>
        page.evaluate(() =>
          window.__mic.streams.flatMap((s) => s.getTracks().map((t) => t.readyState)),
        );
      const on = await app(page, async (a, e) => {
        await a.toggleMic();
        a.alerts = []; // the toast is not the indicator
        return { active: a.micActive, mic: !!e.mic };
      });
      await settle(page);
      check(
        'enabling the microphone shows an active indicator',
        on.active && on.mic && (await indicator()),
        JSON.stringify(on),
      );
      await app(page, (a) => {
        a.vizMode = 'wave';
      });
      await settle(page);
      check('the microphone indicator stays visible outside the spectrum view', await indicator());
      const off = await app(page, async (a, e) => {
        await a.toggleMic();
        return { active: a.micActive, mic: !!e.mic };
      });
      const offTracks = await tracks();
      await settle(page);
      check(
        'disabling the microphone stops every track (readyState “ended”)',
        !off.active && !off.mic && offTracks.length > 0 && offTracks.every((s) => s === 'ended'),
        JSON.stringify({ off, offTracks }),
      );
      check('no microphone indicator once disabled', !(await indicator()));
      const race = await app(page, async (a, e) => {
        const t = window.__t;
        a.vizMode = 'spectrum';
        await t.raf();
        const btn = [...document.querySelectorAll('button')].find(
          (b) =>
            t.vis(b) &&
            /use mic|mic on|microphone/i.test(
              `${b.textContent} ${b.getAttribute('aria-label') || ''}`,
            ),
        );
        if (!btn) return { btn: false };
        btn.click();
        btn.click(); // double tap before Alpine re-renders :disabled
        for (
          let i = 0;
          i < 60 && (a.micPending || window.__mic.streams.length < window.__mic.calls);
          i++
        ) {
          await t.sleep(50);
        }
        const calls = window.__mic.calls;
        if (a.micActive) await a.toggleMic();
        return { btn: true, calls, active: a.micActive, mic: !!e.mic };
      });
      const raceTracks = await tracks();
      check(
        'a double tap on the mic button leaves no live track after disabling',
        race.btn && !race.active && !race.mic && raceTracks.every((s) => s === 'ended'),
        JSON.stringify({ race, raceTracks }),
      );
    }
    await context.close();

    const deny = () => {
      const reject = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      if (!navigator.mediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
      }
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: reject,
        configurable: true,
        writable: true,
      });
    };
    const denied = await openPage(browser, { init: deny, quiet: true });
    const dn = await app(denied.page, async (a, e) => {
      a.vizMode = 'spectrum';
      await a.toggleMic();
      await window.__t.raf();
      const alert = [...document.querySelectorAll('[role=alert]')].find(window.__t.vis);
      return {
        active: a.micActive,
        pending: a.micPending,
        mic: !!e.mic,
        alert: alert ? window.__t.norm(alert.textContent) : '',
      };
    });
    check(
      'permission denial shows an alert and leaves the microphone off, without exceptions',
      !dn.active &&
        !dn.pending &&
        !dn.mic &&
        /denied|permission/i.test(dn.alert) &&
        !denied.errors.length,
      JSON.stringify({ dn, errors: denied.errors }),
    );
    await denied.context.close();
  }

  // ------------------------------------------------------------------ error handling
  {
    console.log('§54 error handling');
    const noAudio = () => {
      for (const n of ['AudioContext', 'webkitAudioContext']) {
        try {
          delete window[n];
        } catch (e) {
          /* not configurable */
        }
        if (window[n]) {
          Object.defineProperty(window, n, {
            value: undefined,
            configurable: true,
            writable: true,
          });
        }
      }
    };
    const na = await openPage(browser, { init: noAudio, quiet: true });
    const naState = await app(na.page, (a) => ({
      status: a.status,
      alert: [...document.querySelectorAll('[role=alert]')]
        .filter(window.__t.vis)
        .map((x) => window.__t.norm(x.textContent))
        .join(' | '),
      pill: /\bERROR\b/.test(window.__t.norm(document.querySelector('header').innerText)),
    }));
    check(
      'AudioContext unavailable: ERROR status (visible) and an alert',
      naState.status === 'ERROR' && naState.pill && /web audio/i.test(naState.alert),
      JSON.stringify(naState),
    );
    const naHold = na.page.locator('.hold-btn');
    await naHold.scrollIntoViewIfNeeded();
    const nb = await naHold.boundingBox();
    await na.page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
    await na.page.mouse.down();
    await na.page.mouse.up();
    await na.page.locator('button', { hasText: /^\s*TRIGGER\s*$/ }).click();
    await na.page.evaluate(() => document.activeElement && document.activeElement.blur());
    await na.page.keyboard.press('Space');
    await settle(na.page);
    const naAfter = await app(na.page, (a) => a.status);
    check(
      'AudioContext unavailable: HOLD, TRIGGER and Space throw nothing',
      na.errors.length === 0 && naAfter === 'ERROR',
      JSON.stringify({ errors: na.errors, naAfter }),
    );
    await na.context.close();

    const blockStorage = () => {
      for (const n of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, n, {
          configurable: true,
          get() {
            throw new DOMException('The operation is insecure.', 'SecurityError');
          },
        });
      }
    };
    const bs = await openPage(browser, { init: blockStorage, quiet: true });
    const bsState = await app(bs.page, (a, e) => {
      a.setTheme('dark');
      a.setPattern('finite');
      a.duration = 50;
      const played = a.play('trigger');
      a.stopNow();
      return {
        local: a.storage.local,
        session: a.storage.session,
        played,
        history: a.history.length,
        notices: a.alerts.filter((x) => x.level === 'warning').map((x) => x.title),
      };
    });
    check(
      'storage throwing on access: app runs, warns, keeps history in memory',
      !bsState.local &&
        !bsState.session &&
        bsState.played &&
        bsState.history === 1 &&
        bsState.notices.length > 0 &&
        bs.errors.length === 0,
      JSON.stringify({ bsState, errors: bs.errors }),
    );
    await bs.context.close();

    const seedBad = () => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('oscilla.presets', '{not json');
      localStorage.setItem('oscilla.theme', 'neon');
      sessionStorage.setItem('oscilla.history', '{"ts": "x"}');
    };
    const ms = await openPage(browser, { init: seedBad, quiet: true });
    const msState = () =>
      app(ms.page, (a) => ({
        presets: a.customPresets.length,
        history: a.history.length,
        theme: a.theme,
        notices: a.alerts.filter((x) => x.level === 'warning').map((x) => x.title),
      }));
    const ms1 = await msState();
    await ms.page.evaluate(() => {
      localStorage.setItem('oscilla.presets', JSON.stringify({ version: 1, presets: 5 }));
      sessionStorage.setItem('oscilla.history', JSON.stringify([{ ts: 1, cfg: null }, null, 7]));
    });
    await ms.page.reload({ waitUntil: 'load' });
    await ready(ms.page);
    const ms2 = await msState();
    check(
      'malformed preset, history and theme storage are ignored without errors',
      ms1.presets === 0 &&
        ms1.history === 0 &&
        ms1.theme === 'system' &&
        ms2.presets === 0 &&
        ms2.history === 0 &&
        ms.errors.length === 0,
      JSON.stringify({ ms1, ms2, errors: ms.errors }),
    );
    check(
      'unreadable preset storage raises a visible warning',
      ms2.notices.some((t) => /preset/i.test(t)),
      JSON.stringify(ms2.notices),
    );
    await ms.context.close();

    const HASHES = [
      '#v=1&f=abc&w=laser&p=nope&s=evil&rm=galaxy',
      '#v=1&f=-5&g=NaN&d=-100&a=1e9&r=x',
      '#v=1&x=%%%notbase64',
      `#v=1&x=${b64url([1, 2, 3])}`,
      `#v=1&x=${Buffer.from('{"pp":{', 'utf8').toString('base64url')}`,
      `#v=1&s=sweep&x=${b64url({
        sweep: { start: 'NaN', end: -1, durationMs: -5, curve: 'cubic', repeat: 'forever' },
      })}`,
      `#v=1&s=single&p=sequence&x=${b64url({
        pp: { sequence: { text: '440, abc', toneMs: 'fast' }, nonexistent: {} },
      })}`,
      `#v=1&s=dual&x=${b64url({ dual: { a: null, b: { freq: 'x', detune: 1e9 }, levelA: -3 } })}`,
      '#v=1&f=Infinity&g=1',
      `#v=1&rm=custom&x=${b64url({ range: { min: 5000, max: 10 } })}`,
    ];
    const hashState = (page) =>
      app(page, (a, e) => {
        const bad = [];
        const walk = (v, p) => {
          if (typeof v === 'number' && !Number.isFinite(v)) bad.push(p);
          else if (v && typeof v === 'object')
            for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`);
        };
        walk(
          {
            frequency: a.frequency,
            gain: a.gainLevel,
            duration: a.duration,
            attack: a.attack,
            release: a.release,
            a4: a.a4,
            range: [a.rangeMin, a.rangeMax],
            sweep: a.sweep,
            dual: a.dual,
            pp: a.pp,
          },
          'state',
        );
        const r = a.currentPlan();
        return {
          bad,
          f: a.frequency,
          gain: a.gainLevel,
          plan: r.ok || (typeof r.error === 'string' && r.error.length > 0),
          notices: a.alerts.filter((x) => x.level !== 'success').length,
          playing: !!e.voice || a.playing,
        };
      });
    const mh = await openPage(browser, { hash: HASHES[0], quiet: true });
    const hashResults = [{ h: HASHES[0], ...(await hashState(mh.page)) }];
    for (const h of HASHES.slice(1)) {
      await mh.page.evaluate((x) => {
        window.Alpine.$data(document.body).alerts = [];
        location.hash = x;
      }, h);
      await waitTrue(
        mh.page,
        () => window.Alpine.$data(document.body).alerts.length > 0,
        null,
        1500,
      );
      hashResults.push({ h, ...(await hashState(mh.page)) });
    }
    await mh.page.goto('about:blank');
    await mh.page.goto(`${BASE}${HASHES[8]}`, { waitUntil: 'load' });
    await ready(mh.page);
    hashResults.push({ h: `${HASHES[8]} (fresh load)`, ...(await hashState(mh.page)) });
    const badHash = hashResults.filter(
      (r) => r.bad.length || !(r.f > 0) || !(r.gain <= 0.08) || !r.plan || !r.notices || r.playing,
    );
    check(
      `${hashResults.length} malformed hashes: finite state, gain ≤ default, a notice, no autoplay`,
      badHash.length === 0 && mh.errors.length === 0,
      JSON.stringify({ badHash, errors: mh.errors }),
    );
    await mh.context.close();

    const nop5 = await openPage(browser, {
      quiet: true,
      canvas: false,
      route: (c) => c.route(/\/p5(\.min)?\.js$/, (r) => r.abort()),
    });
    await waitTrue(nop5.page, () => window.Alpine.$data(document.body).vizFailed, null, 4000);
    const p5State = await app(nop5.page, (a, e) => {
      a.setPattern('finite');
      a.duration = 50;
      const played = a.play('trigger');
      a.stopNow();
      return {
        failed: a.vizFailed,
        p5: typeof window.p5,
        fallback: /visualization unavailable/i.test(window.__t.rendered()),
        notice: a.alerts.some((x) => /visuali/i.test(x.title)),
        played,
      };
    });
    check(
      'p5.js blocked: vizFailed, fallback text, a notice, audio still plays, no exceptions',
      p5State.failed &&
        p5State.p5 === 'undefined' &&
        p5State.fallback &&
        p5State.notice &&
        p5State.played &&
        nop5.errors.length === 0,
      JSON.stringify({ p5State, errors: nop5.errors }),
    );
    await nop5.context.close();
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

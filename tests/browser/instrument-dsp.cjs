#!/usr/bin/env node
// K060: the Keys node's pitch CV, measured from real renders (Chromium, Firefox and WebKit).
// K068: notes clips played by the Studio transport on the audio clock, measured the same way.
//
//   node tests/browser/instrument-dsp.cjs [--browsers chromium,firefox,webkit] [--json out.json]
//   OSC_BROWSERS=webkit node tests/browser/instrument-dsp.cjs     # the same, from the environment
//
// Bundles tests/browser/fixtures/instrument-dsp-entry.js in memory with esbuild into a blank
// page (nothing is written to disk). The fixture builds Keys -> VCO (sine) -> Master Output
// through the one Studio store, runs the real Studio runtime and adapters on an
// OfflineAudioContext at 44.1 kHz and at 48 kHz, plays notes through studio/live-notes.js and
// measures each frequency from the rising zero crossings of the render (many periods per note).
//
// Checks, per browser and per rate (each rate read back from the rendered buffer):
//   k-track    A2, A4 and A6 (8') each within 1 cent of 440 x 2^((note - 69) / 12) Hz
//   k-a4a5     A4 at 440 Hz and A5 at 880 Hz within 0.1 cent
//   k-clamp    at VCO scale 4' every note 0-127 is measured: each note whose frequency lies
//              below the clamp within 0.1 cent of it (note 0 among them), and note 127 at the
//              clamp, the highest pitch-clip point at or below 0.95 x Nyquist, within 0.1 cent;
//              the runtime debugInfo states the clamp at that rate
//   k-glide    a legato glide of 100 ms from A3 to A4: the Keys CV comes within 1 cent of A4 at
//              100 ms +- one render quantum (128 frames at the rate) and not before, is halfway
//              at 50 ms (linear), and the VCO plays A4 within 1 cent from 100 ms + one quantum.
//              Fails on e51b169d, whose glide was an exponential approach (time constant 33 ms)
//
// K068, per browser and per rate: a notes clip on the Keys node of Keys -> VCO -> Envelope ->
// Master Output played by the Studio transport offline (the render length as its look-ahead, as
// offline.js plays it); onsets measured from the Envelope's contour (fixture renderNotes):
//   n-onsets   eight sixteenths and one off-grid note at 120 and 97 BPM with swing 0 and 0.33 of
//              stepBeats: every onset within one frame of baseTime + beats x 60 / tempo, swung
//              only on odd grid positions, and no clip left unplayed
//   n-offgrid  the note at beat 2.1 unmoved by swing 0.33
//   n-tempo    the measured half-beat interval at 97 BPM is the one at 120 BPM x 120 / 97
//   n-ratchet  r 3: three onsets, each within one frame
//   n-slide    a slide into a held note opens no gate (one onset), and the Keys CV reaches its
//              pitch within one cent by Glide + one frame, halfway at half the Glide (linear)
//   n-chance   two renders with p 0.5 and one seed are identical, a second seed changes them,
//              and the hits are the steps where mulberry32(seed ^ 0 ^ index) < 0.5
//   n-census   on a running AudioContext, STOP with a ratchet pending resolves with the engine
//              and runtime node census 0 and no note record left
// Tap tempo (four taps 500 ms apart: 120 BPM) is asserted at unit level
// (tests/unit/studio-steps-playback.test.mjs). On b7a5c9f7 (chromium) the K060 checks pass and
// the leg fails at its first K068 render ('the suite runs': the store refuses the grid).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const suite = require('./lib/suite.cjs');
const { until, bounded } = require('./lib/wait.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const RUN = suite.open({ name: 'instrument-dsp', browsers: arg('browsers') });
const playwright = RUN.playwright;
const JSON_OUT = arg('json', '');
const LOAD_MS = 60000;
const CHECK_MS = 240000; // the 4' sweep renders some 22 s of audio at each rate
const CENSUS_MS = 15000; // a running context reaching the ratchet, and the STOP released
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};

const JS = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'fixtures',
  'instrument-dsp-entry.js')], bundle: true, format: 'iife', write: false, target: 'es2020',
logLevel: 'error' }).outputFiles[0].text;
const HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>OSCILLA '
  + 'instrument DSP fixture</title></head><body><script>'
  + `${JS.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;

let failures = 0;
const report = [];
function check(leg, name, ok, detail) {
  RUN.tally(leg);
  const line = `${ok ? 'PASS' : 'FAIL'} [${leg}] ${name}${detail ? ` — ${detail}` : ''}`;
  report.push({ leg, name, ok, detail });
  console.log(line);
  if (!ok) failures++;
}
const f = (x, d = 3) => (x == null ? 'null' : Number(x).toFixed(d));
const within = (c, tol) => c !== null && Math.abs(c) <= tol;

async function runBrowser(name) {
  const browser = await playwright[name].launch(LAUNCH[name]);
  const leg = `${name} ${browser.version()}`;
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(HTML);
    await until(() => page.evaluate(() => !!window.K), { ms: LOAD_MS,
      what: 'the instrument DSP fixture loads' });
    const rates = await page.evaluate(() => window.K.RATES);
    const call = (fn, opts, what) => bounded(page.evaluate(([n, o]) => window.K[n](o),
      [fn, opts]), { ms: CHECK_MS, what });
    for (const rate of rates) {
      // k-track: three notes two octaves apart at 8'.
      const tr = await call('track', { notes: [45, 69, 93], sampleRate: rate },
        `k-track renders at ${rate} Hz`);
      const at = `${leg} @ ${tr.sampleRate} Hz`;
      check(at, 'k-track A2, A4, A6 within 1 cent', tr.rows.every((r) => within(r.cents, 1)),
        tr.rows.map((r) => `${r.note}: ${f(r.hz, 4)} Hz (${f(r.cents)} ct, ${r.periods} periods)`)
          .join('; '));
      // k-a4a5: A4 and A5 within 0.1 cent.
      const a = await call('track', { notes: [69, 81], sampleRate: rate, periods: 200 },
        `k-a4a5 renders at ${rate} Hz`);
      check(at, 'k-a4a5 A4 440 Hz and A5 880 Hz within 0.1 cent',
        a.rows.every((r) => within(r.cents, 0.1)) && a.rows[0].expected === 440
          && a.rows[1].expected === 880,
        a.rows.map((r) => `${f(r.hz, 5)} Hz (${f(r.cents, 4)} ct)`).join('; '));
      // k-clamp: every note at 4', note 127 at the clamp.
      const notes = Array.from({ length: 128 }, (_, i) => i);
      const c = await call('track', { notes, scale: '4', sampleRate: rate, periods: 20,
        minS: 0.05 }, `k-clamp renders at ${rate} Hz`);
      const below = c.rows.filter((r) => r.exact < c.clampHz);
      const worst = below.reduce((w, r) => (Math.abs(r.cents ?? 1e9) > Math.abs(w.cents ?? 0)
        ? r : w), below[0]);
      const top = c.rows[127];
      check(at, "k-clamp every note below the clamp exact at 4' (0.1 cent)",
        below.length > 100 && below.every((r) => within(r.cents, 0.1)) && below[0].note === 0,
        `${below.length} notes below the clamp, worst ${worst.note}: ${f(worst.cents, 4)} ct`);
      check(at, "k-clamp note 127 at 4' held at the clamp, at or below 0.95 x Nyquist",
        top.exact > c.clampHz && within(top.cents, 0.1) && c.clampHz <= c.nyquist95
          && c.clampHz > c.nyquist95 * 2 ** (-1 / 200),
        `${f(top.hz, 2)} Hz (${f(top.cents, 4)} ct from the clamp ${f(c.clampHz, 2)} Hz; 0.95 x `
          + `Nyquist ${f(c.nyquist95, 1)} Hz; asked ${f(top.exact, 1)} Hz)`);
      check(at, 'k-clamp no note refused in 0-127', c.refused.length === 0,
        c.refused.slice(0, 2).join(' | '));
      check(at, 'k-clamp the runtime debugInfo states the clamp at this rate',
        typeof c.stated === 'string' && c.stated.includes('0.95 × Nyquist')
          && c.stated.includes(`(${Math.round(c.nyquist95)} Hz here)`), c.stated);
      // k-glide: linear in exact time.
      const g = await call('glide', { sampleRate: rate }, `k-glide renders at ${rate} Hz`);
      check(at, 'k-glide the CV arrives within 1 cent at 100 ms +- one quantum',
        g.arriveLateS !== null && Math.abs(g.arriveLateS) <= g.quantumS
          && within(g.centsAtGlide, 1) && within(g.centsAtGlidePlusQuantum, 1),
        `arrives ${f(g.arriveLateS * 1000, 3)} ms from 100 ms (quantum ${f(g.quantumS * 1000)} `
          + `ms); at 100 ms ${f(g.centsAtGlide, 3)} ct`);
      check(at, 'k-glide linear: halfway at 50 ms', within(g.centsAtHalfFromMidpoint, 1),
        `${f(g.centsAtHalfFromMidpoint, 3)} ct from the midpoint`);
      check(at, 'k-glide the VCO plays A4 within 1 cent after the glide',
        within(g.centsAfter, 1) && within(g.centsBefore, 1),
        `${f(g.hzAfter, 4)} Hz (${f(g.centsAfter, 4)} ct); A3 before ${f(g.centsBefore, 4)} ct`);
      // K068: notes clips on the audio clock.
      const half = {};
      for (const tempo of [120, 97]) {
        for (const swing of [0, 0.33]) {
          const sg = await call('swingGrid', { sampleRate: rate, tempo, swing },
            `n-onsets renders at ${rate} Hz, ${tempo} BPM, swing ${swing}`);
          const worst = sg.rows.reduce((w, x) => Math.max(w, x.diff === null ? Infinity
            : Math.abs(x.diff)), 0);
          check(at, `n-onsets ${tempo} BPM swing ${swing}: every onset within one frame`,
            sg.count === sg.expected && worst <= 1 && sg.unplayed === 0,
            `${sg.count} of ${sg.expected} onsets, worst ${worst} frame(s); diffs `
              + sg.rows.map((x) => x.diff).join(' '));
          if (swing === 0.33) {
            check(at, `n-offgrid ${tempo} BPM: the off-grid note is unmoved by swing`,
              sg.offGrid.diff !== null && Math.abs(sg.offGrid.diff) <= 1,
              `beat 2.1 at frame ${sg.offGrid.got}, computed ${sg.offGrid.want}`);
          } else half[tempo] = sg.interval;
        }
      }
      const ratio = half[97] / half[120];
      check(at, 'n-tempo the onsets rescale with the tempo (97 BPM: x 120 / 97)',
        Math.abs(half[97] - half[120] * (120 / 97)) <= 1,
        `half a beat: ${f(half[120], 1)} frames at 120, ${f(half[97], 1)} at 97 (ratio `
          + `${f(ratio, 5)}, ${f(120 / 97, 5)} computed)`);
      const rt = await call('ratchet', { sampleRate: rate }, `n-ratchet renders at ${rate} Hz`);
      check(at, 'n-ratchet r 3 gives three onsets, each within one frame',
        rt.count === 3 && rt.rows.every((x) => x.diff !== null && Math.abs(x.diff) <= 1),
        `${rt.count} onsets, diffs ${rt.rows.map((x) => x.diff).join(' ')}`);
      const sl = await call('slide', { sampleRate: rate }, `n-slide renders at ${rate} Hz`);
      check(at, 'n-slide no gate onset at the slide',
        sl.count === 1 && sl.slideOnsets === 0 && Math.abs(sl.rows[0].diff) <= 1,
        `${sl.count} onset(s), ${sl.slideOnsets} at the slide`);
      check(at, 'n-slide the Keys CV reaches the pitch within the glide time (linear)',
        sl.arriveFrames !== null && sl.arriveFrames <= sl.glideFrames + 1
          && sl.arriveFrames >= sl.glideFrames - Math.ceil(sl.glideFrames / 100)
          && within(sl.centsHalf, 1),
        `arrives ${sl.arriveFrames} frames after the slide (Glide ${sl.glideFrames}); `
          + `${f(sl.centsHalf, 3)} ct from the midpoint at half the Glide`);
      const ch = await call('chance', { sampleRate: rate }, `n-chance renders at ${rate} Hz`);
      check(at, 'n-chance p 0.5: two renders identical, another seed differs',
        ch.same && ch.differs, `identical ${ch.same}, differs with seed 2 ${ch.differs}`);
      check(at, 'n-chance the hits are mulberry32(seed ^ pass ^ index) < p',
        JSON.stringify(ch.hits) === JSON.stringify(ch.want)
          && JSON.stringify(ch.otherHits) === JSON.stringify(ch.otherWant),
        `seed 1 steps ${ch.hits.join(',')}; seed 2 steps ${ch.otherHits.join(',')}`);
    }
    // n-census: a running AudioContext, STOP with the ratchet pending.
    const cs = await bounded(page.evaluate(() => window.K.censusStart()), { ms: CENSUS_MS,
      what: 'n-census the running context starts' });
    await until(() => page.evaluate((t) => window.K.censusNow() > t, cs.ratchetAt + 0.2),
      { ms: CENSUS_MS, what: 'n-census the clock passes the ratchet\'s first onsets' });
    await page.evaluate(() => window.K.censusStop());
    const done = await until(() => page.evaluate(() => window.K.censusDone()),
      { ms: CENSUS_MS, what: 'n-census the STOP resolves' });
    check(leg, 'n-census STOP with a ratchet pending: node census 0, no note left',
      done.engineNodes === 0 && done.engineSources === 0 && done.runtimeNodes === 0
        && done.noteRecords === 0,
      `engine ${done.engineNodes} nodes / ${done.engineSources} sources, runtime `
        + `${done.runtimeNodes}, note records ${done.noteRecords} (context ${cs.state})`);
    check(leg, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}

(async () => {
  await RUN.ready();
  for (const name of RUN.browsers) {
    try {
      await runBrowser(name);
    } catch (e) {
      check(name, 'the suite runs', false, String(e.message || e).split('\n')[0]);
    }
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.log(failures ? `${failures} FAILED` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})();

#!/usr/bin/env node
// OSCILLA Synth engines (plan K090-K092, K089 part, K121-K123; Q019, Q021) on the built
// dist/index.html in chromium, firefox and webkit, at 1536 x 1024 and 390 x 844. Every check
// asserts the sound read from the engine's analyser after the safety chain (line levels, peaks,
// a decay slope, a spectral centroid) or the voice and node census, never the DOM alone.
//
//   node tests/browser/synth-engines.cjs [--browsers chromium,firefox,webkit]
//        [--origins file,http] [--only e-fm,e-poly]
//
// Checks (desktop leg; the phone leg runs e-fm, e-midi and e-mobile):
//   e-fm        ratio 1:3, index 2, A4 (QWERTY H): lines at 440 (J0), 1760 and 880 (J1, the lower
//               one folded), 3080 and 2200 (J2); J1 - J0 = 8.2 dB and J2 - J1 = -4.3 dB within 2 dB
//   e-additive  drawbars 1, 0.5, 0.25 at C4: harmonics 2 and 3 at -6.0 and -12.0 dB rel to the
//               fundamental within 1 dB (line energy over +-3 bins)
//   e-wavetable morph 0 (sine): the 2nd harmonic 40 dB down; morph 3 (saw): within 3 dB of -6 dB;
//               the MG at 0.5 Hz patched into Morph at 1.5 by two jack taps: the centroid moves
//               by a quarter of the morph 0 to 3 span measured above (times the cable's reach)
//   e-sync      sync ratio 2 (morph 1) at A4: 880 Hz present, 440 and 1320 Hz 30 dB below it;
//               ratio 4.5 (morph 3): the master's grid, 440 Hz present
//   e-am        ring ratio 1.25 at A4: 110 and 990 Hz, the carrier 20 dB below; AM depth 1: the
//               sidebands -6.0 dB rel to the carrier within 2 dB
//   e-perc      the kick (QWERTY A) decays at -60 dB per 0.5 s within 10 %, fitted from 6 to
//               30 dB below its peak (the idle panel's floor is some 55 dB below it); the hat
//               choke is o-choke (the hats sit too close to that floor live)
//   e-poly      16 held notes: voice census 16; a 17th: still 16 and the oldest note's line gone;
//               all off: the runtime node census back to its count before the notes
//   e-nosource  every drawbar at 0: a held note sounds nothing and holds no voice (census 0)
//   e-removed   the Additive engine removed in Studio: the panel's held note is silent (the
//               chain into the Output is broken), the bay names ADDITIVE with Restore module and
//               the Panel tab shows its plate; Restore module there brings the panel back
//   e-route     the Panel tab's keys play the panel (130.8 Hz from VCO 1 at 16'), the Engines tab's
//               the chosen engine (no 130.8 Hz); a tab switch releases held notes; a blocked
//               engine says why and plays nothing
//   e-midi      through tests/browser/lib/midi-stub.cjs on the FM engine: Note On sounds,
//               Note Off silences
//   e-link      #m=synth&yt=engines&ye=fm&yp=fm-bell opens the FM engine with the bell's ratio
//               and sounds; the copied link names yt=engines&ye=fm; a bad ye is refused
//   e-mobile    390 x 844 with touch: no horizontal page scroll, every tab, engine and knob 44 px+,
//               a tap on an engine selects it and a tap on the docked keys sounds
//   e-headroom  16 notes held at full velocity at the default Level with the Master Output at
//               its highest level: no sample of the output reaches the ceiling (MAX_OUTPUT_GAIN)
//
// Offline checks (review of #332; desktop leg): tests/browser/fixtures/synth-engines-offline-
// entry.js, bundled in memory with esbuild, builds the real engine adapters on an
// OfflineAudioContext and plays notes on them; these assert the rendered samples.
//   o-clap      the clap decays at -60 dB per 0.28 s (from its last burst) within 10 %
//   o-perc      every pitch class (C4-B4): its voice decays at -60 dB per its longest layer's
//               decay within 12 %, the slope fitted from -20 to -50 dB below the peak
//   o-pitch     every FM algorithm, its default patch and every ratio at 1, at A0, E1, A1, A3 and
//               A4: operator 1's pitch from what drives its frequency (the 0 Hz line of the
//               deviation, a Hann mean over whole periods of the note) within 5 cents of the
//               note in every window from 0.05 to 2.9 s; and at A3 and A4 the spectrum's line
//               nearest the note within 5 cents of it in every window from 0.1 to 2.9 s
//   o-headroom  16 notes at full velocity at the default Level, each engine: the sum peaks at
//               or below digital full scale; one voice at Level 4 peaks at or below 1/16
//               (every FM algorithm, AM and ring, every percussion key, the additive shapes)
//   o-morph     every wavetable bank at morph 0 to 3 in steps of 0.25: the level within 0.5 dB
//               of its two tables' levels interpolated in dB, the peak at or below 1/16
//   o-retrig    a held formant pad retriggered: its level never falls more than 1 dB
//   o-choke     a closed hat chokes an open one: 40 dB down within 0.1 s of it; with Hat choke
//               off the open hat takes 0.3 s+ for those 40 dB (its 0.5 s decay: 0.33 s)
//   o-alloff    a ringing open hat (Decay x4): all-off cuts it 60 dB within 50 ms
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const suite = require('./lib/suite.cjs');
const { serveDist } = require('./lib/serve.cjs');
const { until, bounded } = require('./lib/wait.cjs');
const midiStub = require('./lib/midi-stub.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist', 'index.html');
const RUN = suite.open({ name: 'synth-engines', browsers: arg('browsers'),
  origins: arg('origins'), defaultOrigins: ['file'] });
const playwright = RUN.playwright;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};
const SIZES = { desktop: { width: 1536, height: 1024 }, phone: { width: 390, height: 844 } };
const PHONE_CHECKS = new Set(['e-fm', 'e-midi', 'e-mobile']);
const LOAD_MS = 60000;
const SOUND_MS = 8000; // an attack, a parameter's glide and the analyser's smoothing
const CHECK_MS = 120000;
const A4 = 440;
const C4 = 261.6256;
const J = [0.22389, 0.57672, 0.35283]; // J0(2), J1(2), J2(2)
const db = (x) => 20 * Math.log10(x);
const MAX_OUTPUT_GAIN = 0.25; // src/js/core/constants.js: the ceiling
const OFFLINE_JS = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'fixtures',
  'synth-engines-offline-entry.js')], bundle: true, format: 'iife', write: false,
logLevel: 'error' }).outputFiles[0].text;
const OFFLINE_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>OSCILLA '
  + 'Synth engines offline fixture</title></head><body><script>'
  + `${OFFLINE_JS.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
async function offline(context) {
  const page = await context.newPage();
  await page.setContent(OFFLINE_HTML);
  await until(() => page.evaluate(() => !!window.E), { ms: LOAD_MS, what: 'the fixture loads' });
  return page;
}
const ALGORITHMS = ['2-op', '3-stack', '3-y', '4-stack', '4-pairs', '4-three', '4-parallel'];

// ------------------------------------------------------------------------------ page probes
function probe() {
  const e = window.OSCILLA.engine;
  const a = e.analyser;
  const f = new Float32Array(a.frequencyBinCount);
  a.getFloatFrequencyData(f);
  const t = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(t);
  let s = 0;
  for (const x of t) s += x * x;
  return { sr: e.ctx.sampleRate, n: a.fftSize, db: Array.from(f),
    rmsDb: 10 * Math.log10(s / t.length + 1e-24) };
}
const binOf = (p, hz) => Math.round((hz * p.n) / p.sr);
/** A line's level: the energy of the bins within 3 of it (the window's main lobe). */
function lineDb(p, hz) {
  const b = binOf(p, hz);
  let s = 0;
  for (let i = Math.max(1, b - 3); i <= Math.min(p.db.length - 1, b + 3); i++) {
    s += 10 ** (p.db[i] / 10);
  }
  return 10 * Math.log10(s + 1e-30);
}
/** A peak at hz: its line 10 dB above the bins 6 to 9 away on both sides. */
function peakAt(p, hz) {
  const b = binOf(p, hz);
  const side = Math.max(...[b - 9, b - 8, b - 7, b - 6, b + 6, b + 7, b + 8, b + 9]
    .filter((i) => i > 0 && i < p.db.length).map((i) => p.db[i]));
  return lineDb(p, hz) > -100 && lineDb(p, hz) - side >= 10;
}
function centroid(p, lo, hi) {
  let w = 0;
  let s = 0;
  for (let i = binOf(p, lo); i <= binOf(p, hi); i++) {
    const e = 10 ** (p.db[i] / 10);
    w += e;
    s += e * ((i * p.sr) / p.n);
  }
  return s / (w || 1);
}
const read = (page) => page.evaluate(probe);
const counts = (page) => page.evaluate(() => window.OSCILLA.studio.counts());
const dbg = (page) => page.evaluate(() => window.OSCILLA.app.synthDebug());
async function sound(page, pred, what, ms = SOUND_MS) {
  let last = null;
  await until(async () => {
    last = await read(page);
    return pred(last);
  }, { ms, what });
  return last;
}
const silent = (page, what) => sound(page, (p) => p.rmsDb < -70, what);

async function openSynth(context, base, hash) {
  const page = await context.newPage();
  await page.goto(`${base}${hash}`);
  await until(() => page.evaluate(() => !!(window.OSCILLA && window.OSCILLA.app
    && window.OSCILLA.app.synthDebug && window.OSCILLA.app.synthDebug().present
    && document.querySelector('[data-osc="synth.bay.svg"]'))),
  { ms: LOAD_MS, what: 'the Synth is rendered' });
  // The Master Output at its highest level: a voice peaks at 1/16 of full scale at Level 4
  // (16 voices sum to full scale), so the checks read the engines 10 dB above the default.
  const r = await page.evaluate((v) => {
    const st = window.OSCILLA.studio.store;
    const m = st.getModel().graph.nodes.find((n) => n.type === 'master');
    return st.dispatch({ type: 'NODE_PARAM_SET', nodeId: m.id, key: 'level', value: v });
  }, MAX_OUTPUT_GAIN);
  if (!r.ok) throw new Error(`the Master level is not set: ${r.reason}`);
  await page.locator('#osc-synth-title').click();
  return page;
}
const engines = (eng, values = '') => `#m=synth&yt=engines&ye=${eng}${values
  ? `&yv=${values}` : ''}`;
async function hold(page, code) {
  await page.locator('#osc-synth-title').click();
  await page.keyboard.down(code);
}
async function tapJack(page, id) {
  await page.locator(`[data-jack="${id}"]`).focus();
  await page.keyboard.press('Enter');
}
const sink = (page, fn, ...args) => page.evaluate(([f, a]) => {
  const s = window.OSCILLA.app.synthSink();
  return f === 'allOff' ? s.allOff() : s[f](...a);
}, [fn, args]);

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, hash, fn) => checks.push({ name, hash, fn });

  def('e-fm', engines('fm', 'fm.ratio2:3,fm.index2:2,fm.modSustain:1,fm.sustain:1'),
    async ({ page }) => {
      await hold(page, 'KeyH');
      const lines = [A4, 4 * A4, 2 * A4, 7 * A4, 5 * A4];
      const p = await sound(page, (q) => q.rmsDb > -50 && lines.every((f) => peakAt(q, f))
        && Math.abs(lineDb(q, 4 * A4) - lineDb(q, A4) - db(J[1] / J[0])) <= 2
        && Math.abs(lineDb(q, 7 * A4) - lineDb(q, 4 * A4) - db(J[2] / J[1])) <= 2,
      'sidebands at 440 +- k x 1320 Hz with levels |J_k(2)|');
      await page.keyboard.up('KeyH');
      await silent(page, 'the note releases');
      return { ok: Math.abs(lineDb(p, 2 * A4) - lineDb(p, 4 * A4)) <= 2,
        lines: lines.map((f) => +lineDb(p, f).toFixed(1)) };
    });

  def('e-additive', engines('additive', 'additive.h1:1,additive.h2:0.5,additive.h3:0.25,'
    + 'additive.h4:0,additive.sustain:1'), async ({ page }) => {
    await hold(page, 'KeyA');
    const want = [db(0.5), db(0.25)];
    const p = await sound(page, (q) => q.rmsDb > -55 && peakAt(q, C4)
      && Math.abs(lineDb(q, 2 * C4) - lineDb(q, C4) - want[0]) <= 1
      && Math.abs(lineDb(q, 3 * C4) - lineDb(q, C4) - want[1]) <= 1,
    'harmonics 2 and 3 at -6.0 and -12.0 dB rel within 1 dB');
    await page.keyboard.up('KeyA');
    return { ok: true, rel: [lineDb(p, 2 * C4) - lineDb(p, C4), lineDb(p, 3 * C4)
      - lineDb(p, C4)].map((x) => +x.toFixed(2)) };
  });

  def('e-wavetable', engines('wavetable', 'wavetable.morph:0,wavetable.sustain:1,mg.rate:0.5'),
    async ({ page }) => {
      await hold(page, 'KeyA');
      const sine = await sound(page, (q) => peakAt(q, C4)
        && lineDb(q, 2 * C4) <= lineDb(q, C4) - 40, 'morph 0: a sine');
      await page.keyboard.up('KeyA');
      await page.locator('[data-knob="wavetable.morph"]').focus();
      await page.keyboard.press('End');
      await hold(page, 'KeyA');
      const saw = await sound(page, (q) => peakAt(q, 2 * C4)
        && Math.abs(lineDb(q, 2 * C4) - lineDb(q, C4) - db(0.5)) <= 3, 'morph 3: a saw');
      await page.keyboard.up('KeyA');
      // The MG swing, against a threshold measured here: the centroids of morph 0 and 3 (the
      // sine and the saw above) bound what the morph can do; the MG, patched into Morph at 1.5
      // and run at 0.5 Hz (the analyser's 0.17 s window sees a twelfth of its cycle), must
      // swing the centroid by a quarter of that span times the share of it the cable reaches.
      const wtId = (await dbg(page)).nodes.wavetable;
      await page.evaluate((id) => window.OSCILLA.studio.store.dispatch({ type: 'NODE_PARAM_SET',
        nodeId: id, key: 'morph', value: 1.5 }), wtId);
      await tapJack(page, 'mg.control:out');
      await tapJack(page, 'wavetable.morph:in');
      const d = await dbg(page);
      const patched = d.cables.some((c) => c.from === 'mg.control' && c.to === 'wavetable.morph');
      const edge = await page.evaluate((ids) => window.OSCILLA.studio.store.getModel().graph.edges
        .find((e) => e.from.node === ids.mg && e.to.node === ids.wavetable
          && e.to.port === 'morph'), d.nodes);
      const depth = Math.abs(edge && edge.props && edge.props.depth != null ? edge.props.depth : 1);
      const span = Math.abs(centroid(saw, 100, 4000) - centroid(sine, 100, 4000));
      const want = 0.25 * span * Math.min(1, depth / 1.5);
      await hold(page, 'KeyA');
      let lo = Infinity;
      let hi = -Infinity;
      await sound(page, (q) => {
        if (q.rmsDb < -70) return false;
        const c = centroid(q, 100, 4000);
        lo = Math.min(lo, c);
        hi = Math.max(hi, c);
        return hi - lo >= want;
      }, `the MG moves the morph: the centroid swings ${want.toFixed(0)} Hz`, 12000);
      await page.keyboard.up('KeyA');
      return { ok: patched && want >= 25, sine: +(lineDb(sine, 2 * C4) - lineDb(sine, C4))
        .toFixed(1), saw: +(lineDb(saw, 2 * C4) - lineDb(saw, C4)).toFixed(1),
      span: +span.toFixed(0), depth, want: +want.toFixed(0), swing: +(hi - lo).toFixed(0) };
    });

  def('e-sync', engines('sync', 'sync.morph:1,sync.sustain:1'), async ({ page }) => {
    await hold(page, 'KeyH');
    const r2 = await sound(page, (q) => peakAt(q, 2 * A4)
      && lineDb(q, A4) <= lineDb(q, 2 * A4) - 30 && lineDb(q, 3 * A4) <= lineDb(q, 2 * A4) - 30,
    'sync x 2: only even harmonics of the note');
    await page.keyboard.up('KeyH');
    await page.locator('[data-knob="sync.morph"]').focus();
    await page.keyboard.press('End');
    await hold(page, 'KeyH');
    const r45 = await sound(page, (q) => peakAt(q, A4), 'sync x 4.5: the note\'s own grid');
    await page.keyboard.up('KeyH');
    return { ok: true, r2: [lineDb(r2, A4), lineDb(r2, 2 * A4)].map((x) => +x.toFixed(1)),
      r45: +lineDb(r45, A4).toFixed(1) };
  });

  def('e-am', engines('am', 'am.mode:ring,am.ratio:1.25,am.sustain:1'), async ({ page }) => {
    await hold(page, 'KeyH');
    const ring = await sound(page, (q) => peakAt(q, 110) && peakAt(q, 990)
      && lineDb(q, A4) <= lineDb(q, 990) - 20, 'ring: 110 and 990 Hz, the carrier 20 dB down');
    await page.keyboard.up('KeyH');
    await page.locator('[data-option="am.mode"][data-v="am"]').click();
    await hold(page, 'KeyH');
    const am = await sound(page, (q) => peakAt(q, A4) && peakAt(q, 990)
      && Math.abs(lineDb(q, 990) - lineDb(q, A4) - db(0.5)) <= 2,
    'AM depth 1: sidebands -6.0 dB rel to the carrier');
    await page.keyboard.up('KeyH');
    return { ok: true, ring: +(lineDb(ring, A4) - lineDb(ring, 990)).toFixed(1),
      am: +(lineDb(am, 990) - lineDb(am, A4)).toFixed(1) };
  });

  /** In the page: the RMS from a key press (or a second one) until 45 dB below its peak. */
  const decayIn = (page, code, then = null) => page.evaluate(async ([c, t]) => {
    const e = window.OSCILLA.engine;
    const a = e.analyser;
    const buf = new Float32Array(a.fftSize);
    const rms = () => {
      a.getFloatTimeDomainData(buf);
      let s = 0;
      for (const x of buf) s += x * x;
      return 10 * Math.log10(s / buf.length + 1e-24);
    };
    const key = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { code: k, key: k,
      bubbles: true }));
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    key('keydown', c);
    let t0 = null;
    const start = e.ctx.currentTime;
    const wall = performance.now() + 8000; // a wall-clock deadline beside the audio clock's
    if (t) { // the second key once the first sounds (a condition, on the audio clock)
      while (rms() < -60 && e.ctx.currentTime - start < 2 && performance.now() < wall) {
        await frame();
      }
      key('keydown', t);
    }
    const pts = [];
    let peak = -Infinity;
    while (e.ctx.currentTime - start < 4 && performance.now() < wall) { // 4 s of audio clock
      await frame();
      const v = rms();
      if (t0 === null && v > -70) t0 = e.ctx.currentTime;
      pts.push([e.ctx.currentTime, v]);
      peak = Math.max(peak, v);
      if (t0 !== null && v < peak - 45) break; // 45 dB below the peak: the decay is measured

    }
    key('keyup', c);
    if (t) key('keyup', t);
    return { pts, t0 };
  }, [code, then]);

  def('e-perc', engines('perc'), async ({ page }) => {
    // Armed first, and quiet, so the kick is the first sound after the arm (a slow arm under
    // load can let the idle panel through until its Keys-gated envelopes close).
    await page.evaluate(() => window.OSCILLA.app.synthArm());
    await silent(page, 'armed, nothing sounds');
    await page.locator('#osc-synth-title').click();
    const kick = await decayIn(page, 'KeyA');
    const peak = Math.max(...kick.pts.map((p) => p[1]));
    const fit = kick.pts.filter((p) => p[1] <= peak - 6 && p[1] >= peak - 30
      && p[0] > kick.pts.find((q) => q[1] === peak)[0]);
    const n = fit.length;
    const mx = fit.reduce((s, p) => s + p[0], 0) / n;
    const my = fit.reduce((s, p) => s + p[1], 0) / n;
    const slope = fit.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0)
      / fit.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
    await silent(page, 'the kick has ended');
    const want = -60 / 0.5;
    return { ok: n >= 4 && Math.abs(slope / want - 1) <= 0.1, slope: +slope.toFixed(1), want,
      points: n };
  });

  def('e-poly', engines('additive', 'additive.release:0.05,additive.sustain:1'),
    async ({ page }) => {
      await sink(page, 'noteOn', 60, 100);
      await sound(page, (q) => q.rmsDb > -60, 'the engine is armed and sounds');
      await sink(page, 'noteOff', 60);
      await silent(page, 'released');
      const base = (await counts(page)).runtimeNodes;
      // The oldest note, C6, is alone above 600 Hz: the 15 after it are 36-50 (four harmonics
      // at most, the drawbar defaults) and the 17th is G5 (784 Hz).
      const notes = [84, ...Array.from({ length: 15 }, (_, i) => 36 + i)];
      for (const n of notes) await sink(page, 'noteOn', n, 100);
      const sixteen = (await dbg(page)).voices;
      const oldest = 1046.5;
      const before = await sound(page, (q) => peakAt(q, oldest), 'the oldest note sounds');
      await sink(page, 'noteOn', 79, 100);
      const p = await sound(page, (q) => peakAt(q, 783.99)
        && lineDb(q, oldest) <= lineDb(before, oldest) - 20,
      'the 17th note takes the oldest voice');
      const still = (await dbg(page)).voices;
      await sink(page, 'allOff');
      await silent(page, 'all off');
      await until(async () => (await counts(page)).runtimeNodes === base,
        { ms: 5000, what: 'the node census returns to its count before the notes' });
      return { ok: sixteen === 16 && still === 16, sixteen, still, base,
        line: +lineDb(p, 783.99).toFixed(1) };
    });

  def('e-nosource', engines('additive', Array.from({ length: 12 }, (_, i) => `additive.h${i + 1}:0`)
    .join(',')), async ({ page }) => {
    await sink(page, 'noteOn', 60, 100);
    await until(async () => (await dbg(page)).armed, { ms: 10000, what: 'the keys arm' });
    const p = await silent(page, 'a note with every drawbar at 0 sounds nothing');
    const held = (await dbg(page)).voices;
    await sink(page, 'noteOff', 60);
    return { ok: held === 0, voices: held, rmsDb: +p.rmsDb.toFixed(1) };
  });

  def('e-removed', '#m=synth', async ({ page }) => {
    await hold(page, 'KeyA');
    await sound(page, (q) => peakAt(q, C4 / 2), 'the panel sounds through the chain');
    const id = (await dbg(page)).nodes.additive;
    const r = await page.evaluate((nid) => window.OSCILLA.studio.store.dispatch({
      type: 'NODE_REMOVE', nodeId: nid }), id);
    const gone = await silent(page, 'the chain is broken at ADDITIVE: the panel is silent');
    await page.keyboard.up('KeyA');
    await until(() => page.locator('[data-gone="additive"]').count().then((n) => n === 1),
      { ms: 10000, what: 'the bay names the removed engine' });
    const row = (await page.locator('[data-gone="additive"]').textContent()).trim();
    const plate = page.locator('[data-osc="synth.modules"] [data-restore-module="additive"]');
    const onPanel = await plate.count();
    await plate.click();
    await hold(page, 'KeyA');
    await sound(page, (q) => peakAt(q, C4 / 2), 'Restore module brings the panel back');
    await page.keyboard.up('KeyA');
    const back = (await dbg(page)).nodes.additive;
    return { ok: r.ok && onPanel === 1 && /ADDITIVE removed in Studio/.test(row) && !!back,
      // timing-allow: 80 characters of the bay row's text, not frames
      gone: +gone.rmsDb.toFixed(1), row: row.slice(0, 80), onPanel };
  });

  def('e-route', '#m=synth', async ({ page }) => {
    await hold(page, 'KeyA');
    await sound(page, (q) => peakAt(q, C4 / 2), 'the Panel tab plays the panel');
    await page.locator('[data-synth-tab="engines"]').click();
    const released = await silent(page, 'a tab switch releases the held note');
    await page.keyboard.up('KeyA');
    await page.locator('[data-engine="additive"]').click();
    await hold(page, 'KeyA');
    const eng = await sound(page, (q) => peakAt(q, C4) && lineDb(q, C4 / 2) < lineDb(q, C4) - 30,
      'the Engines tab plays the engine, not the panel');
    await page.keyboard.up('KeyA');
    await silent(page, 'released');
    await page.locator('[data-blocked="pluck"]').dispatchEvent('click'); // aria-disabled
    const status = await page.locator('[data-osc="synth.status"]').textContent();
    const d = await dbg(page);
    return { ok: /no-silent-feedback/.test(status) && d.engine === 'additive',
      // timing-allow: 80 characters of the status text, not frames
      released: released.rmsDb, engine: lineDb(eng, C4), status: status.slice(0, 80) };
  });

  def('e-midi', null, async ({ context, base }) => {
    await context.addInitScript(midiStub.install, {});
    const page = await openSynth(context, base, engines('fm', 'fm.sustain:1'));
    await page.evaluate(() => window.OSCILLA.app.midiConnect());
    await until(() => page.evaluate(() => window.__oscMidiSeam.calls().length === 1),
      { ms: 10000, what: 'Connect MIDI asks once' });
    await page.evaluate((n) => window.__oscMidiSeam.resolve(0, [n]), midiStub.STUB_NAME);
    await until(() => page.evaluate(() => window.OSCILLA.app.midiState === 'connected'),
      { ms: 10000, what: 'the stub input connects' });
    await page.evaluate((n) => window.__oscMidiSeam.message(n, [0x90, 69, 100]),
      midiStub.STUB_NAME);
    const on = await sound(page, (q) => peakAt(q, A4) && q.rmsDb > -55,
      'Note On 69 plays the FM engine');
    const d = await dbg(page);
    await page.evaluate((n) => window.__oscMidiSeam.message(n, [0x80, 69, 0]), midiStub.STUB_NAME);
    const off = await silent(page, 'Note Off releases it');
    await page.close();
    return { ok: /fm$/.test(d.played || ''), on: on.rmsDb, off: off.rmsDb };
  });

  def('e-link', null, async ({ context, base }) => {
    const page = await openSynth(context, base, '#m=synth&yt=engines&ye=fm&yp=fm-bell');
    const d = await dbg(page);
    const ratio = (await page.locator('[data-value="fm.ratio2"]').textContent()).trim();
    await hold(page, 'KeyH');
    const p = await sound(page, (q) => peakAt(q, A4) && q.rmsDb > -55, 'the bell sounds');
    await page.keyboard.up('KeyH');
    const hash = await page.evaluate(() => window.OSCILLA.app.synthCopyLink());
    await until(() => page.evaluate(() => /copied|Copy the link/.test(window.OSCILLA.app.synth
      .status)), { ms: 10000, what: 'the copy settles before the next link' });
    await page.goto(`${base}#m=synth&ye=lpf`);
    await until(() => page.evaluate(() => window.location.hash.indexOf('ye=') < 0
      && /no engine/.test(window.OSCILLA.app.synth.status)),
    { ms: 15000, what: 'a bad engine is refused and its keys leave the address' });
    await page.close();
    return { ok: d.tab === 'engines' && d.engine === 'fm' && ratio === '3.50'
      && /yt=engines&ye=fm/.test(hash), ratio, hash, rmsDb: p.rmsDb };
  });

  def('e-mobile', engines('additive'), async ({ page }) => {
    const m = await page.evaluate(() => {
      const small = [...document.querySelectorAll('[data-knob], [data-engine], [data-blocked], '
        + '[data-synth-tab], [data-option], [data-toggle]')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.width < 43.5 || r.height < 43.5);
      }).map((el) => el.getAttribute('data-knob') || el.getAttribute('data-engine')
        || el.getAttribute('data-option') || el.getAttribute('data-synth-tab') || el.tagName);
      return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth, small };
    });
    await page.locator('[data-engine="fm"]').tap();
    const d = await dbg(page);
    const box = await page.locator('[data-osc="keyboard.keys"]').boundingBox();
    await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.85);
    await page.mouse.down();
    const p = await sound(page, (q) => q.rmsDb > -60, 'a press on the docked keys plays FM');
    await page.mouse.up();
    await silent(page, 'releasing the key silences it');
    return { ok: m.scroll <= m.inner && m.small.length === 0 && d.engine === 'fm', ...m,
      engine: d.engine, rmsDb: p.rmsDb };
  });
  def('e-headroom', engines('additive', 'additive.sustain:1'), async ({ page }) => {
    const masterId = await page.evaluate(() => window.OSCILLA.studio.store.getModel().graph.nodes
      .find((n) => n.type === 'master').id);
    const set = await page.evaluate(([id, v]) => window.OSCILLA.studio.store.dispatch({
      type: 'NODE_PARAM_SET', nodeId: id, key: 'level', value: v }), [masterId, MAX_OUTPUT_GAIN]);
    const notes = Array.from({ length: 16 }, (_, i) => 48 + i);
    for (const n of notes) await sink(page, 'noteOn', n, 127);
    await sound(page, (q) => q.rmsDb > -60, 'the 16 voices sound');
    // The output after the safety chain, frame by frame over 1 s of audio clock.
    const r = await page.evaluate(async () => {
      const e = window.OSCILLA.engine;
      const buf = new Float32Array(e.analyser.fftSize);
      const start = e.ctx.currentTime;
      const wall = performance.now() + 8000;
      let peak = 0;
      let frames = 0;
      while (e.ctx.currentTime - start < 1 && performance.now() < wall) {
        await new Promise((res) => requestAnimationFrame(res));
        e.analyser.getFloatTimeDomainData(buf);
        for (const x of buf) peak = Math.max(peak, Math.abs(x));
        frames++;
      }
      return { peak, frames, voices: window.OSCILLA.app.synthDebug().voices };
    });
    await sink(page, 'allOff');
    return { ok: set.ok && r.voices === 16 && r.frames >= 5 && r.peak < MAX_OUTPUT_GAIN * 0.999,
      peak: +r.peak.toFixed(4), ceiling: MAX_OUTPUT_GAIN, frames: r.frames, voices: r.voices };
  });

  // ---------------------------------------------------------------- offline (review of #332)
  def('o-clap', null, async ({ context }) => {
    const page = await offline(context);
    const r = await page.evaluate(() => window.E.decay(61, {}, { win: 0.01, hi: -20, lo: -50 }));
    const want = -60 / 0.28;
    return { ok: r.points >= 8 && Math.abs(r.slope / want - 1) <= 0.1, slope: r.slope && +r
      .slope.toFixed(1), want: +want.toFixed(1), points: r.points };
  });

  def('o-perc', null, async ({ context }) => {
    const page = await offline(context);
    const rows = await page.evaluate(async () => {
      const out = [];
      for (let n = 60; n < 72; n++) {
        const hat = n === 66 || n === 68;
        out.push({ n, ...window.E.percVoice(n), ...(await window.E.decay(n, {}, {
          win: hat ? 0.004 : 0.01, hi: -20, lo: -50 })) });
      }
      return out;
    });
    const bad = rows.filter((r) => !(r.points >= 4
      && Math.abs(r.slope / (-60 / r.decayS) - 1) <= 0.12));
    return { ok: bad.length === 0 && new Set(rows.map((r) => r.id)).size === 9,
      slopes: rows.map((r) => `${r.id}:${Math.round(r.slope)}/${Math.round(-60 / r.decayS)}`),
      bad: bad.map((r) => r.n) };
  });

  def('o-pitch', null, async ({ context }) => {
    const page = await offline(context);
    // The carrier's pitch (review of #332, round 3): the deviation into operator 1's frequency,
    // its 0 Hz line from 50 ms after the onset, at the bass notes too. A modulator's 0 Hz line
    // reaching it (a stack at commensurate ratios) is a pitch offset, which this reads directly.
    const NOTES = [21, 28, 33, 57, 69]; // A0, E1, A1, A3, A4
    const PATCHES = { default: {}, r1: { ratio1: 1, ratio2: 1, ratio3: 1, ratio4: 1 } };
    const drive = await page.evaluate(async ([algs, notes, patches]) => {
      const out = [];
      for (const [patch, p] of Object.entries(patches)) {
        for (const algorithm of algs) {
          const worst = [];
          for (const note of notes) {
            const r = await window.E.drive({ algorithm, ...p }, note);
            worst.push(Math.max(...r.map((x) => Math.abs(x.cents))));
          }
          out.push({ patch, algorithm, worst });
        }
      }
      return out;
    }, [ALGORITHMS, NOTES, PATCHES]);
    // The spectrum at A3 and A4, from 0.1 s: in the first tenth the index falls fastest and
    // the line's own level changes inside a window, which biases a peak reading of any
    // algorithm (a pure 4-three included). At the bass notes the sidebands that coincide on
    // the note's line move its peak as the index falls in every algorithm with two or more
    // modulators on a carrier (4-three, no stack, reads 42 cents at A0): not a pitch, so the
    // bass is judged from the drive above.
    const W = [[0.1, 0.4], [0.4, 0.8], [0.8, 1.5], [1.5, 2.9]];
    const rows = await page.evaluate(async ([algs, w]) => {
      const out = [];
      for (const algorithm of algs) {
        for (const note of [57, 69]) {
          const r = await window.E.pitch({ algorithm }, note, w);
          out.push({ algorithm, note, cents: r.map((x) => +x.cents.toFixed(2)) });
        }
      }
      return out;
    }, [ALGORITHMS, W]);
    const worstLine = Math.max(...rows.flatMap((r) => r.cents.map(Math.abs)));
    const worstDrive = Math.max(...drive.flatMap((r) => r.worst));
    return { ok: drive.length === 14 && worstDrive <= 5 && rows.length === 14 && worstLine <= 5,
      worstDrive: +worstDrive.toFixed(3), worstLine,
      drive: drive.map((r) => `${r.patch}:${r.algorithm}:${r.worst.map((c) => +c.toFixed(2))
        .join('/')}`) };
  });

  def('o-headroom', null, async ({ context }) => {
    const page = await offline(context);
    const r = await page.evaluate(async (algs) => {
      const sum = {};
      const notes = Array.from({ length: 16 }, (_, i) => 48 + i);
      for (const t of ['additive-voice', 'fm-voice', 'am-voice', 'wavetable-voice',
        'perc-voice']) sum[t] = (await window.E.peak(t, { sustain: 1 }, notes)).peak;
      const one = [];
      const voice = async (t, p, n) => one.push([`${t} ${JSON.stringify(p)} ${n}`,
        (await window.E.peak(t, { sustain: 1, level: 4, ...p }, [n])).peak]);
      for (const shape of ['custom', 'sawtooth', 'square', 'triangle']) {
        await voice('additive-voice', { shape }, 40);
      }
      for (const algorithm of algs) await voice('fm-voice', { algorithm }, 57);
      for (const p of [{ mode: 'ring' }, { mode: 'am' }, { mode: 'ring', ratio: 1 },
        { mode: 'am', carrier: 'square', modulator: 'sawtooth' }]) await voice('am-voice', p, 45);
      for (let n = 60; n < 72; n++) await voice('perc-voice', {}, n);
      for (const tone of [0, 1]) await voice('perc-voice', { tone }, 62);
      return { sum, one };
    }, ALGORITHMS);
    const over = r.one.filter(([, pk]) => pk > (1 / 16) * 1.001);
    return { ok: Object.values(r.sum).every((x) => x <= 1) && over.length === 0,
      sum: Object.fromEntries(Object.entries(r.sum).map(([k, v]) => [k, +v.toFixed(3)])),
      worstVoice: +Math.max(...r.one.map((x) => x[1] * 16)).toFixed(3), over };
  });

  def('o-morph', null, async ({ context }) => {
    const page = await offline(context);
    const ms = Array.from({ length: 13 }, (_, i) => i * 0.25);
    const banks = await page.evaluate(async (m) => {
      const out = {};
      for (const b of ['basic', 'formant', 'pulse', 'sync']) out[b] = await window.E.morph(b, m);
      return out;
    }, ms);
    let worst = 0;
    let peak = 0;
    for (const rows of Object.values(banks)) {
      const at = (m) => rows.find((x) => Math.abs(x.m - m) < 1e-9);
      for (const r of rows) {
        const i = Math.min(2, Math.floor(r.m));
        const x = r.m - i;
        const want = at(i).rmsDb + (at(i + 1).rmsDb - at(i).rmsDb) * x;
        worst = Math.max(worst, Math.abs(r.rmsDb - want));
        peak = Math.max(peak, r.peak * 16);
      }
    }
    return { ok: worst <= 0.5 && peak <= 1.001, worstDb: +worst.toFixed(3),
      peakRelVoice: +peak.toFixed(3) };
  });

  def('o-retrig', null, async ({ context }) => {
    const page = await offline(context);
    const r = await page.evaluate(() => window.E.retrigger('wavetable-voice', { bank: 'formant',
      morph: 1.5, attack: 0.6, release: 1.2, sustain: 0.8 }));
    return { ok: r.results[1].retrigger === true && r.min >= r.held - 1, held: +r.held.toFixed(2),
      min: +r.min.toFixed(2) };
  });

  def('o-choke', null, async ({ context }) => {
    const page = await offline(context);
    const on = await page.evaluate(() => window.E.choke({ choke: true }));
    const off = await page.evaluate(() => window.E.choke({ choke: false }));
    // Choked: the open hat released in CHOKE_RELEASE_S under the closed hat's 0.06 s decay
    // (40 dB in 0.04 s); not choked, the open hat's 0.5 s decay needs 0.33 s for 40 dB.
    return { ok: on.fallS <= 0.1 && off.fallS >= 0.3, chokedS: +on.fallS.toFixed(3),
      ringS: +off.fallS.toFixed(3) };
  });

  def('o-alloff', null, async ({ context }) => {
    const page = await offline(context);
    const r = await page.evaluate(() => window.E.allOff(70, { decay: 4 }));
    return { ok: r.before > -80 && r.after <= r.before - 60, before: +r.before.toFixed(1),
      after: +r.after.toFixed(1) };
  });
  return checks;
}

// ------------------------------------------------------------------------------ runner
/** Does check `name` run at `sizeName` under the --only selection? */
const runsAt = (name, sizeName) => (!ONLY || ONLY.has(name))
  && (sizeName === 'phone' ? PHONE_CHECKS.has(name) : name !== 'e-mobile');

async function runLeg(browserName, sizeName, base) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const results = {};
  try {
    for (const { name, hash, fn } of defineChecks()) {
      if (!runsAt(name, sizeName)) continue;
      const context = await browser.newContext({ viewport: SIZES[sizeName],
        hasTouch: sizeName === 'phone' });
      const errors = [];
      context.on('page', (pg) => pg.on('pageerror', (e) => errors.push(String(e))));
      const t0 = Date.now();
      try {
        const page = hash ? await openSynth(context, base, hash) : null;
        const v = await bounded(fn({ page, context, base, size: sizeName }),
          { ms: CHECK_MS, what: `${name} finishes` });
        results[name] = { ...v, ok: v.ok && errors.length === 0, errors: errors.slice(0, 4),
          ms: Date.now() - t0 };
      } catch (e) {
        results[name] = { ok: false, detail: String(e.message || e).split('\n')[0],
          errors: errors.slice(0, 4), ms: Date.now() - t0 };
      }
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close();
  }
  return results;
}

(async () => {
  // --only names checks of this suite; a size none of them runs at is not a leg (review of
  // #332, V3: an o-* check selected alone ran a phone leg of 0 checks, which the harness fails).
  const known = defineChecks().map((c) => c.name);
  const unknown = ONLY ? [...ONLY].filter((n) => !known.includes(n)) : [];
  if (unknown.length) {
    console.error(`unknown --only check(s) ${unknown.join(', ')}; known: ${known.join(', ')}`);
    process.exit(2);
  }
  const sizes = Object.keys(SIZES).filter((sz) => known.some((n) => runsAt(n, sz)));
  await RUN.ready();
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  const server = RUN.origins.includes('http')
    ? await serveDist(DIST, { prefix: 'oscilla-synth-engines-' }) : null;
  let failed = 0;
  try {
    for (const b of RUN.browsers) {
      for (const o of RUN.origins) {
        for (const size of sizes) {
          const base = o === 'file' ? pathToFileURL(DIST).href : server.url;
          const key = `${b}/${o}/${size}`;
          const t0 = Date.now();
          const res = await runLeg(b, size, base);
          const names = Object.keys(res);
          RUN.reportLeg({ leg: key, checks: names.length });
          const bad = names.filter((n) => !res[n].ok);
          failed += bad.length;
          console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/synth-engines: ${names.length
            - bad.length}/${names.length} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
          for (const n of names) {
            console.log(`   ${res[n].ok ? 'ok' : 'x '} ${n}: ${JSON.stringify(res[n]).slice(0, 700)}`);
          }
        }
      }
    }
  } finally {
    if (server) server.close();
  }
  process.exit(failed ? 1 : 0);
})();

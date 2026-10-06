#!/usr/bin/env node
// OSCILLA V2 chart renderers and lab controllers: browser checks with a fake engine adapter.
//
//   NODE_PATH=/Users/korczis/dev/oscilla/tests/node_modules node tests/browser/labs.cjs
//   node tests/browser/labs.cjs --browser firefox        # chromium | firefox (default: both)
//   node tests/browser/labs.cjs --build <dir>             # write labs-fixture.html and
//                                                         # labs-visual.html (15.5 kHz) to <dir>
//   node tests/browser/labs.cjs --screenshot <file.png>  # 1536x1024 after an 11 s live run
//
// The fixture is the shell's src/index.html with its CSS (src/styles/main.css, which imports
// uPlot's CSS)
// and tests/browser/fixtures/labs-entry.js bundled in memory with esbuild, served from
// http://127.0.0.1 (a secure context, so getUserMedia works with the fake device).
// Exit code 0 only when every check passes in every browser.
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const esbuild = require('esbuild');
const playwright = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const ENGINES = opt('--browser') ? [opt('--browser')]
  : (process.env.OSC_BROWSERS ? process.env.OSC_BROWSERS.split(',') : ['chromium', 'firefox']);

// ---------------------------------------------------------------- fixture build

async function buildFixture(config) {
  const css = await esbuild.build({
    stdin: {
      contents: '@import "./src/styles/main.css";\n', // main.css imports uPlot's CSS
      resolveDir: ROOT,
      loader: 'css',
    },
    bundle: true,
    write: false,
    logLevel: 'silent',
  });
  const js = await esbuild.build({
    entryPoints: [path.join(__dirname, 'fixtures', 'labs-entry.js')],
    bundle: true,
    format: 'iife',
    write: false,
    logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'node_modules')],
  });
  const src = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
  const script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const style = css.outputFiles[0].text.replace(/<\/style/gi, '<\\/style');
  return src
    .replace('<!-- @inline-css -->', () => `<style>${style}</style>`)
    .replace('<!-- @inline-js -->', () => '<script>window.__LABS_CONFIG__ = '
      + `${JSON.stringify(config)};</script>\n<script>${script}</script>`);
}

function serve(pages) {
  const server = http.createServer((req, res) => {
    const page = pages[new URL(req.url, 'http://x').pathname];
    if (!page) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Chromium's built-in fake capture device is silent in this version, so it gets a WAV with a
// known tone; Firefox's fake device (media.navigator.streams.fake) produces a 1 kHz tone.
const FAKE_MIC_HZ = { chromium: 2000, firefox: 1000 };
// Analyser level (est.levelDb) below which the fake tone is not being delivered yet. Steady
// readings: Chromium -25.6 dB (the WAV's 0.25 amplitude: 20·log10(0.25 · 0.42 / 2), Blackman
// coherent gain, one-sided spectrum), Firefox -33.5 dB. While the stream starts, a window the
// tone has barely entered reads far lower (-110 dB seen in a release gate) and its peak is
// smeared off the tone, so such an estimate is not a detection of the tone.
const FAKE_MIC_MIN_LEVEL_DB = -60;

function writeToneWav(file, hz, seconds = 4, sr = 48000) {
  const n = seconds * sr;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(0.25 * 32767 * Math.sin((2 * Math.PI * hz * i) / sr)), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
  return file;
}

let fakeWav = null;

function launch(engine) {
  if (engine === 'firefox') {
    return playwright.firefox.launch({
      firefoxUserPrefs: {
        'media.navigator.streams.fake': true,
        'media.navigator.permission.disabled': true,
        'media.autoplay.default': 0,
        'media.autoplay.block-webaudio': false,
      },
    });
  }
  return playwright.chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      ...(fakeWav ? [`--use-file-for-fake-audio-capture=${fakeWav}`] : []),
    ],
  });
}

// ---------------------------------------------------------------- checks

async function runEngine(engine, base) {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };
  const browser = await launch(engine);
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 } });
  if (engine === 'chromium') {
    await context.grantPermissions(['microphone'], { origin: base }).catch(() => {});
  }
  const page = await context.newPage();
  const errors = [];
  // Errors thrown by Alpine while evaluating the shell's own markup bindings (src/index.html +
  // src/js/ui/app.js, owned by the visual shell / integration) are reported separately: they
  // are not produced by the charts or the lab controllers under test.
  const shellErrors = [];
  const onPageError = (tag) => (e) => {
    const msg = `${tag}: ${e.message}`;
    // Chromium tags Alpine evaluator frames "[Alpine] <expr>", Firefox shows Alpine's
    // generateEvaluatorFromString frame; the object form of x-bind (x-bind="obj", used by the
    // Studio markup) fails inside Alpine's applyBindingsObject when the shell's state is absent.
    if (/\[Alpine\]|generateEvaluatorFromString|applyBindingsObject/.test(e.stack || '')) {
      shellErrors.push(msg);
    } else errors.push(msg);
  };
  page.on('pageerror', onPageError('pageerror'));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  console.log(`\n${engine} ${browser.version()}`);
  await page.goto(`${base}/labs.html`);
  await page.waitForFunction(() => window.__oscReady && window.__labs, null, { timeout: 10000 });
  // Wait on the audio clock, not wall time: a starved CI runner renders far less than 1.5 s of
  // audio in 1.5 s, and the charts would read a nearly silent analyser (deadline 10 s).
  await page.waitForFunction(() => window.__labs.ctx.currentTime >= 1.2, null, { timeout: 10000 })
    .catch(() => {});
  await page.waitForTimeout(400);

  // (1) Spectrum: peak at the oscillator frequency, read from uPlot's own data.
  const spec = await page.evaluate(() => {
    const { labs, ctx } = window.__labs;
    const u = labs.analysis.chart.uplot;
    const x = u.data[0];
    const y = u.data[1];
    let best = 0;
    for (let i = 1; i < y.length; i++) if (y[i] > y[best]) best = i;
    const w = x.length;
    const pxRatio = (20000 / 20) ** (1 / w); // one log-axis column
    const r = labs.analysis.chart.readers.main;
    return { peakHz: x[best], peakDb: y[best], points: w, colRatio: pxRatio,
      binHz: ctx.sampleRate / r.fftSize, chip: document.querySelector('#osc-chart-spectrum'
        + ' .osc-chip-readout:not([hidden])')?.textContent || '' };
  });
  const tol = Math.max(spec.binHz, 1000 * (spec.colRatio - 1)) * 1.5;
  check('spectrum peak at the oscillator frequency (uPlot data)',
    Math.abs(spec.peakHz - 1000) <= tol && spec.peakDb > -40,
    `${spec.peakHz.toFixed(1)} Hz at ${spec.peakDb.toFixed(1)} dB, ${spec.points} points, `
      + `±${tol.toFixed(1)}`);
  check('requested-frequency chip shows frequency and level', /1 kHz/.test(spec.chip)
    && /dB/.test(spec.chip), JSON.stringify(spec.chip));

  // Log/Linear and Max through the shell controls.
  await page.click('#osc-spec-linear');
  await page.selectOption('#osc-spec-max', '5000');
  await page.waitForTimeout(200);
  const lin = await page.evaluate(() => {
    const u = window.__labs.labs.analysis.chart.uplot;
    const x = u.data[0];
    const y = u.data[1];
    let best = 0;
    for (let i = 1; i < y.length; i++) if (y[i] > y[best]) best = i;
    return { distr: u.scales.x.distr, max: u.scales.x.max, peakHz: x[best] };
  });
  check('Linear + Max 5 kHz applied; peak still at 1 kHz',
    lin.distr === 1 && Math.abs(lin.max - 5000) < 1 && Math.abs(lin.peakHz - 1000) < 15,
    JSON.stringify(lin));
  await page.click('#osc-spec-log');
  await page.selectOption('#osc-spec-max', '20000');

  // (2) Filter curve = getFrequencyResponse of an independent BiquadFilterNode.
  const filterCompare = () => page.evaluate(() => {
    const { labs, ctx } = window.__labs;
    const c = labs.filter.config;
    const { x, y } = labs.filter.chart.getData();
    const ref = ctx.createBiquadFilter();
    ref.type = c.type;
    ref.frequency.value = c.frequency;
    ref.Q.value = c.type === 'lowpass' || c.type === 'highpass' ? 20 * Math.log10(c.Q) : c.Q;
    ref.gain.value = c.gain;
    const f = Float32Array.from(x);
    const mag = new Float32Array(f.length);
    const ph = new Float32Array(f.length);
    ref.getFrequencyResponse(f, mag, ph);
    let maxErr = 0;
    for (let i = 0; i < f.length; i++) {
      const db = 20 * Math.log10(mag[i]);
      if (Number.isFinite(db)) maxErr = Math.max(maxErr, Math.abs(db - y[i]));
    }
    return { config: c, maxErr, points: f.length };
  });
  let fc = await filterCompare();
  check('filter curve equals getFrequencyResponse (low-pass 2.5 kHz, Q 0.707)',
    fc.maxErr < 1e-3 && fc.config.type === 'lowpass' && Math.abs(fc.config.frequency - 2500) < 1,
    `max |Δ| ${fc.maxErr.toExponential(2)} dB over ${fc.points} points`);
  await page.click('#osc-ftype-highpass');
  await page.waitForTimeout(50);
  fc = await filterCompare();
  check('filter type via shell radio (high-pass) and curve still exact',
    fc.config.type === 'highpass' && fc.maxErr < 1e-3, `max |Δ| ${fc.maxErr.toExponential(2)}`);
  // Drag on the graph: right and up → higher cutoff and higher Q.
  const over = await page.evaluate(() => {
    const r = window.__labs.labs.filter.chart.uplot.over.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const before = fc.config;
  await page.mouse.move(over.x + over.w * 0.3, over.y + over.h * 0.5);
  await page.mouse.down();
  await page.mouse.move(over.x + over.w * 0.6, over.y + over.h * 0.5 - 40, { steps: 6 });
  await page.mouse.up();
  fc = await filterCompare();
  const expectHz = 20 * 1000 ** 0.6;
  check('drag on the filter graph sets cutoff (x) and Q (vertical); curve still exact',
    Math.abs(fc.config.frequency / expectHz - 1) < 0.03 && fc.config.Q > before.Q * 1.8
      && fc.maxErr < 1e-3,
    `cutoff ${fc.config.frequency.toFixed(0)} Hz (expect ≈${expectHz.toFixed(0)}), `
      + `Q ${before.Q.toFixed(3)} → ${fc.config.Q.toFixed(3)}`);
  const fields = await page.evaluate(() => ({
    cutoff: document.querySelector('#osc-filter-cutoff-value').value,
    q: document.querySelector('#osc-filter-q-value').value,
  }));
  check('cutoff and Q fields follow the drag', /kHz|Hz/.test(fields.cutoff) && fields.q !== '0.707',
    JSON.stringify(fields));
  await page.click('#osc-ftype-lowpass');

  // (3) Additive bars = the coefficients handed to createPeriodicWave.
  const additive = (preset) => page.evaluate((p) => {
    const { labs, modules } = window.__labs;
    if (p) {
      const sel = document.querySelector('#osc-add-preset');
      sel.value = p;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const bars = labs.additive.chart.getBars();
    const { real, imag } = modules.buildPeriodicWave(null, labs.additive.partials);
    let maxErr = 0;
    let compared = 0;
    for (const b of bars) {
      const g = Math.hypot(real[b.n] || 0, imag[b.n] || 0);
      const db = g > 0 ? 20 * Math.log10(g) : -Infinity;
      if (!Number.isFinite(db) && !Number.isFinite(b.gainDb)) continue;
      maxErr = Math.max(maxErr, Math.abs(db - b.gainDb));
      compared++;
    }
    return { maxErr, compared, n: bars.length };
  }, preset);
  let add = await additive(null);
  // The PeriodicWave tables are Float32Array; the bars are the same values in double precision.
  check('additive bars equal the PeriodicWave coefficients (custom)',
    add.n === 10 && add.maxErr < 1e-5,
    `${add.compared} bars, max |Δ| ${add.maxErr}`);
  add = await additive('square');
  check('additive bars equal the coefficients after preset "Square approx"',
    add.maxErr < 1e-5 && add.compared === 5,
    `${add.compared} non-zero bars, max |Δ| ${add.maxErr}`);
  const addHost = await page.$('#osc-chart-additive canvas');
  const ab = await addHost.boundingBox();
  await page.mouse.click(ab.x + 31 + ((ab.width - 37) / 10) * 2.5, ab.y + ab.height / 2);
  const sel = await page.evaluate(() => ({
    selected: window.__labs.labs.additive.selected,
    field: document.querySelector('#osc-add-harmonic').value,
    preset: document.querySelector('#osc-add-preset').value,
  }));
  check('click a bar selects that harmonic', sel.selected === 3 && sel.field === '3',
    JSON.stringify(sel));

  // (4) Spectrogram: non-floor pixels on the tone row, floor elsewhere.
  const spg = await page.evaluate(() => {
    const { labs, floorColour } = window.__labs;
    const view = labs.spectrogram.view;
    const c = view.plotCanvas;
    const g = c.getContext('2d');
    const dpr = c.width / view.plotRect.w;
    const rowAt = (f) => Math.round(view.yForFrequency(f) * dpr);
    const x = c.width - 6;
    const px = (y) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
    const floor = floorColour();
    const dist = (a) => Math.max(...a.map((v, i) => Math.abs(v - floor[i])));
    const tone = px(rowAt(1000));
    const far = px(rowAt(100));
    return { tone, far, floor, toneDist: dist(tone), farDist: dist(far),
      strategy: view.spectrogram.strategy };
  });
  check('spectrogram draws non-floor pixels at the tone row', spg.toneDist > 60 && spg.farDist <= 3,
    `tone ${spg.tone} vs floor ${spg.floor} (Δ${spg.toneDist}), `
      + `100 Hz row Δ${spg.farDist}, ${spg.strategy}`);
  await page.click('#osc-spg-freeze');
  const frozen = await page.evaluate(() => window.__labs.labs.spectrogram.view.spectrogram.frozen);
  await page.click('#osc-spg-freeze');
  check('spectrogram Freeze switch freezes the renderer', frozen === true);

  // (5) Sequencer: add / move / delete / play / stop → 0 live sources.
  const seqState = () => page.evaluate(() => {
    const { labs, sources } = window.__labs;
    const ed = labs.sequencer.editor;
    return {
      blocks: ed.model.blocks.map((b) => b.type),
      dom: [...document.querySelectorAll('#osc-seq-timeline .osc-block')].map((b) => b.className),
      selected: ed.selectedId,
      title: document.querySelector('#osc-seq-editor-title').textContent,
      fields: [...document.querySelectorAll('[data-osc="seq.editor.fields"] .osc-label')]
        .map((l) => l.textContent),
      ticks: [...document.querySelectorAll('#osc-seq-ruler span')].map((s) => s.textContent),
      live: sources.live.size,
      started: sources.started,
      stats: ed.stats(),
      playing: ed.playing,
    };
  });
  let s0 = await seqState();
  check('sequencer renders the reference blocks, ruler and Sweep editor fields',
    s0.blocks.length === 5 && s0.dom.length === 5 && s0.ticks[0] === '0.0s',
    `${s0.blocks.join(',')} | ticks ${s0.ticks.join(' ')}`);
  await page.click('#osc-seq-timeline .osc-block--sweep');
  s0 = await seqState();
  check('selecting Sweep shows Start, End, Duration, Curve',
    s0.title === 'Sweep' && s0.fields.join(',') === 'Start,End,Duration,Curve',
    s0.fields.join(','));
  await page.click('#osc-seq-add');
  await page.click('[data-osc="seq.addType"][data-value="burst"]');
  let s1 = await seqState();
  check('add block (Burst after the selection) with its schema fields',
    s1.blocks.length === 6 && s1.blocks[2] === 'burst' && s1.title === 'Burst'
      && s1.fields.join(',') === 'Frequency,Duration,Burst,Interval (onset to onset)',
    `${s1.blocks.join(',')} | ${s1.fields.join(',')}`);
  await page.click('#osc-seq-move-earlier');
  s1 = await seqState();
  check('move earlier', s1.blocks[1] === 'burst', s1.blocks.join(','));
  // Drag the burst block to the end.
  const tl = await page.evaluate(() => {
    const b = document.querySelector('#osc-seq-timeline .osc-block--burst').getBoundingClientRect();
    const t = document.querySelector('#osc-seq-timeline').getBoundingClientRect();
    const last = window.__labs.labs.sequencer.rects.pop(); // model order
    const end = t.left + last.x + last.w + 4;
    return { bx: b.left + b.width / 2, by: b.top + b.height / 2, end };
  });
  await page.mouse.move(tl.bx, tl.by);
  await page.mouse.down();
  await page.mouse.move(tl.end, tl.by, { steps: 8 });
  await page.mouse.up();
  s1 = await seqState();
  check('drag reorder moves the block to the end (DOM order follows)', s1.blocks[5] === 'burst'
    && /burst/.test(s1.dom[5]), s1.blocks.join(','));
  // Keyboard: Delete removes the selected block.
  await page.focus('#osc-seq-timeline');
  await page.keyboard.press('Delete');
  s1 = await seqState();
  check('keyboard Delete removes the selected block', s1.blocks.length === 5
    && !s1.blocks.includes('burst'), s1.blocks.join(','));
  await page.click('#osc-seq-add');
  await page.click('[data-osc="seq.addType"][data-value="fm"]');
  await page.click('#osc-seq-delete');
  s1 = await seqState();
  check('delete button removes the selected block', s1.blocks.length === 5, s1.blocks.join(','));
  await page.click('#osc-seq-play');
  await page.waitForTimeout(400);
  const playing = await seqState();
  const playhead = await page.evaluate(() => {
    const ph = [...document.querySelectorAll('#osc-seq-timeline > div')].find((d) =>
      d.style.zIndex === '2');
    return ph ? { hidden: ph.hidden, t: ph.style.transform } : null;
  });
  await page.click('#osc-seq-stop');
  await page.waitForTimeout(500);
  const stopped = await seqState();
  check('play schedules sources; playhead follows the audio clock',
    playing.playing && playing.live > 0 && playhead && !playhead.hidden,
    `live ${playing.live}, playhead ${JSON.stringify(playhead)}`);
  check('stop leaves 0 live sources (and 0 editor voices)',
    stopped.live === 0 && stopped.stats.activeSourceCount === 0 && stopped.stats.voices === 0
      && !stopped.playing,
    `started ${stopped.started}, live ${stopped.live}, ${JSON.stringify(stopped.stats)}`);

  // (6) Device panel: real sample rate.
  const dev = await page.evaluate(() => ({
    sr: document.querySelector('#osc-dev-sr').textContent,
    ny: document.querySelector('#osc-dev-nyquist').textContent,
    safe: document.querySelector('#osc-dev-safemax').textContent,
    out: document.querySelector('#osc-dev-output').textContent,
    real: window.__labs.ctx.sampleRate,
  }));
  const fmt = (v) => `${Math.round(v).toLocaleString('en-US')} Hz`;
  check('device panel shows the real sampleRate, Nyquist and safe max',
    dev.sr === fmt(dev.real) && dev.ny === fmt(dev.real / 2) && dev.safe === fmt(dev.real * 0.475),
    `${dev.sr} / ${dev.ny} / ${dev.safe}; output "${dev.out}"`);

  // (7) Envelope: dragging the A handle changes attack and its field/slider.
  const env0 = await page.evaluate(() => {
    const l = window.__labs.labs.envelope.graph.getLayout();
    const c = document.querySelector('#osc-chart-envelope canvas').getBoundingClientRect();
    return { a: window.__labs.labs.envelope.adsr.a, hx: c.left + l.handles.attack.x,
      hy: c.top + l.handles.attack.y, pxPerS: l.pxPerS };
  });
  await page.mouse.move(env0.hx, env0.hy);
  await page.mouse.down();
  await page.mouse.move(env0.hx + 20, env0.hy, { steps: 4 });
  await page.mouse.up();
  const env1 = await page.evaluate(() => ({ a: window.__labs.labs.envelope.adsr.a,
    field: document.querySelector('#osc-env-attack-value').value }));
  const expectA = env0.a + 20 / env0.pxPerS;
  check('envelope A handle drag sets attack (graph + field)',
    Math.abs(env1.a - expectA) < 0.002 && env1.field.endsWith('ms'),
    `${(env0.a * 1000).toFixed(1)} → ${(env1.a * 1000).toFixed(1)} ms `
      + `(expect ${(expectA * 1000).toFixed(1)}), field ${env1.field}`);

  // (8) Bioacoustics: rows from the cited data; click → onSelectRange with sourced values.
  const bio = await page.evaluate(() => window.__labs.labs.bio.chart.getRows());
  const bioBox = await (await page.$('#osc-chart-bio canvas')).boundingBox();
  await page.mouse.click(bioBox.x + bioBox.width * 0.8, bioBox.y + 21 * 1.5);
  const range = await page.evaluate(() => window.__lastRange);
  check('bio bars from HEARING_RANGES; click selects the sourced range',
    bio.length >= 5 && bio[0].range === '31 Hz – 17.6 kHz' && range && range.id === 'dog'
      && range.min === 67 && range.max === 45000,
    `${bio.map((r) => `${r.label} ${r.range}`).join('; ')} | click → ${JSON.stringify(range)}`);

  // (9) Phase & Stereo without a stereo router: model plot; the fixture's tone plays mono, so
  // the correlation says "1.00 mono" (identical channels by construction), not "nothing playing".
  const ph = await page.evaluate(() => ({ source: window.__labs.labs.phase.source,
    corr: document.querySelector('#osc-corr-value').textContent,
    basis: document.querySelector('#osc-corr-basis').textContent,
    canvas: !!document.querySelector('#osc-chart-phase canvas') }));
  check('phase view without router: analytic model, correlation "1.00 mono"',
    ph.source === 'model' && ph.corr === '1.00' && ph.basis === 'mono' && ph.canvas,
    JSON.stringify(ph));

  // (10) Microphone with the fake capture device.
  const micBefore = await page.evaluate(() =>
    document.querySelector('#osc-mic-detected').textContent);
  await page.click('#osc-mic-toggle');
  // The wait ends on exactly what the check asserts (and the level shows the tone has arrived),
  // so a transient estimate while the fake stream starts can neither end it nor be judged.
  const want = FAKE_MIC_HZ[engine];
  const micDetects = (m) => !!(m && m.active && m.est && m.ref
    && m.est.levelDb >= FAKE_MIC_MIN_LEVEL_DB
    && Math.abs(m.est.frequencyHz - m.ref.hz) <= 2 * m.ref.binHz
    && Math.abs(m.est.frequencyHz - want) <= Math.max(m.est.uncertaintyHz, 1));
  let mic = null;
  let polls = 0;
  for (let i = 0; i < 40; i++) {
    polls = i + 1;
    await page.waitForTimeout(150);
    mic = await page.evaluate(() => {
      const m = window.__labs.labs.mic;
      const an = m.analyser;
      let ref = null;
      if (an) {
        const d = new Float32Array(an.frequencyBinCount);
        an.getFloatFrequencyData(d);
        let k = 1;
        for (let i = 2; i < d.length; i++) if (d[i] > d[k]) k = i;
        ref = { hz: (k * an.context.sampleRate) / an.fftSize, db: d[k],
          binHz: an.context.sampleRate / an.fftSize };
      }
      return { active: m.active, error: m.error, est: m.estimate, ref,
        text: document.querySelector('#osc-mic-detected').textContent,
        label: m.stream ? m.stream.getAudioTracks()[0].label : null };
    });
    if (micDetects(mic)) break;
  }
  check(`mic (fake device) detects the fake ${want} Hz tone within ± its uncertainty`,
    micDetects(mic),
    mic.est ? `${mic.est.frequencyHz.toFixed(2)} ± ${mic.est.uncertaintyHz.toFixed(2)} Hz `
      + `at ${mic.est.levelDb.toFixed(1)} dB (min ${FAKE_MIC_MIN_LEVEL_DB}) vs peak bin `
      + `${mic.ref ? `${mic.ref.hz.toFixed(1)} Hz at ${mic.ref.db.toFixed(1)} dB` : 'none'}; `
      + `"${mic.text}"; device "${mic.label}"; after ${polls} polls`
      : `active ${mic.active} error "${mic.error}" text "${mic.text}"; after ${polls} polls`);
  check('mic readout before enabling says it is off', /microphone off/i.test(micBefore), micBefore);
  await page.click('#osc-mtab-compare');
  await page.waitForTimeout(250);
  const cmp = await page.evaluate(() => ({ text: document.querySelector('#osc-mic-detected')
    .textContent, cmp: window.__labs.labs.mic.comparison,
    toolbar: !document.querySelector('[data-osc="mic.freeze"]').closest('[role=group]').hidden }));
  check('mic Compare tab shows difference against the requested frequency',
    cmp.toolbar && cmp.cmp && cmp.cmp.calibrated === false && /Δ/.test(cmp.text), cmp.text);
  await page.click('#osc-mtab-live');
  const stopState = await page.evaluate(() => {
    const s = window.__labs.labs.mic.stream;
    document.querySelector('#osc-mic-toggle').click();
    return { states: s.getTracks().map((t) => t.readyState),
      active: window.__labs.labs.mic.active,
      pressed: document.querySelector('#osc-mic-toggle').getAttribute('aria-pressed') };
  });
  check('mic toggle off stops every track', stopState.states.every((st) => st === 'ended')
    && !stopState.active && stopState.pressed === 'false', JSON.stringify(stopState));

  // (11) Stereo live: correlation from the L/R analysers.
  const page2 = await context.newPage();
  page2.on('pageerror', onPageError('pageerror(stereo)'));
  page2.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console(stereo): ${m.text()}`);
  });
  await page2.goto(`${base}/labs-stereo.html`);
  await page2.waitForFunction(() => window.__oscReady && window.__labs, null, { timeout: 10000 });
  await page2.waitForTimeout(1200);
  const st = await page2.evaluate(() => ({ source: window.__labs.labs.phase.source,
    corr: document.querySelector('#osc-corr-value').textContent,
    meter: document.querySelector('#osc-corr-meter').getAttribute('aria-valuetext') }));
  const corrV = Number(st.corr);
  check('stereo playing: live L/R data, correlation estimated (quarter-period lag ≈ 0)',
    st.source === 'live' && Number.isFinite(corrV) && Math.abs(corrV) < 0.15
      && /estimated/.test(st.meter), JSON.stringify(st));
  await page2.close();

  check('0 console errors from charts/labs', errors.length === 0, errors.slice(0, 5).join(' | '));
  if (shellErrors.length) {
    // The fixture registers the bare shell component; markup bound to the composed component
    // (src/js/main.js: V1 instrument + workbench) has no data here.
    const uniq = [...new Set(shellErrors.map((m) => m.replace(/^[^:]+: /, '')))];
    console.log(`  WARN  ${shellErrors.length} error(s) from the shell's Alpine bindings `
      + `(not under test here; ${uniq.length} distinct, e.g. ${uniq.slice(0, 4).join(' | ')})`);
  }
  await browser.close();
  return results;
}

async function main() {
  const pages = {
    '/labs.html': await buildFixture({ frequency: 1000, gain: 0.5 }),
    '/labs-stereo.html': await buildFixture({ frequency: 1000, gain: 0.5, stereo: true }),
    '/labs-visual.html': await buildFixture({ frequency: 15500, gain: 0.5, warmupMs: 4500,
      referenceState: true }),
  };
  const buildDir = opt('--build');
  if (buildDir) {
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'labs-fixture.html'), pages['/labs.html']);
    fs.writeFileSync(path.join(buildDir, 'labs-visual.html'), pages['/labs-visual.html']);
    console.log(`wrote ${buildDir}/labs-fixture.html and labs-visual.html`);
    return;
  }
  const os = require('os');
  fakeWav = writeToneWav(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osc-labs-')),
    'tone.wav'), FAKE_MIC_HZ.chromium);
  const server = await serve(pages);
  const base = `http://127.0.0.1:${server.address().port}`;
  const shot = opt('--screenshot');
  if (shot) {
    const browser = await launch('chromium');
    const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
    await page.goto(`${base}/labs-visual.html`);
    await page.waitForTimeout(11000);
    await page.screenshot({ path: shot });
    await browser.close();
    server.close();
    console.log(`screenshot: ${shot}`);
    return;
  }
  let failed = 0;
  for (const engine of ENGINES) {
    const res = await runEngine(engine, base);
    failed += res.filter((r) => !r.ok).length;
  }
  server.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

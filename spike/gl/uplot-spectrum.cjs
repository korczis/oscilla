#!/usr/bin/env node
// Y001 spike (branch spike/gl-views, never merged): the live spectrum's uPlot draw time per
// frame in the shipped page, to decide whether a GL spectrum line would save anything.
//
//   node spike/gl/uplot-spectrum.cjs [--dist dist/index.html] [--browsers chromium]
//        [--dpr 1,2] [--frames 300] [--warm 60] [--out <dir>] [--commit <sha>]
//
// Serves the built page from 127.0.0.1/oscilla/ with COOP/COEP (crossOriginIsolated, so
// performance.now() is not coarsened; the page is self-contained), loads it at 1536 x 1024, takes the live spectrum's uPlot instance
// (window.OSCILLA.labs.analysis.chart.uplot: src/js/labs/analysis.js, src/js/charts/
// spectrum-chart.js), holds HOLD to play the default tone until the analyser carries signal,
// and instruments the instance (nothing in the page is changed):
//   sync    performance.now() around the chart's own u.setData(...) + u.redraw(true, false)
//           calls (instance methods wrapped): scales and paths invalidated, commit queued
//   paint   uPlot's drawClear hook to its draw hook (one appended last, after the chart's own
//           drawOverlay): axes, the series path built and stroked/filled, the overlay
//   total   sync + paint of the same frame (the commit is a microtask after the rAF tick)
// median / p95 / mean / max over --frames frames after --warm frames. os.loadavg() before and
// after. Output: <out>/uplot-spectrum-<platform>-<arch>-<browser>-dpr<d>.json
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const playwright = require('playwright');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const BROWSERS = arg('browsers', 'chromium').split(',');
const DPRS = arg('dpr', '1,2').split(',').map(Number);
const FRAMES = Number(arg('frames', '300'));
const WARM = Number(arg('warm', '60'));
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), 'y001')));
const COMMIT = arg('commit', (() => {
  try {
    return require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'],
      { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { return null; }
})());
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0,
    'media.autoplay.blocking_policy': 0, 'media.autoplay.block-webaudio': false } },
  webkit: {},
};
const RUN_MS = 120000; // wall-clock deadline of one run

const load = () => os.loadavg().map((x) => Math.round(x * 100) / 100);
const r3 = (x) => Math.round(x * 1000) / 1000;
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, median: r3(q(0.5)), p95: r3(q(0.95)), mean: r3(s.reduce((a, b) => a + b,
    0) / s.length), max: r3(s[s.length - 1]) };
}

/** Page side: wrap the instance and collect `frames` frames after `warm`. */
function instrument([warm, frames]) {
  const chart = window.OSCILLA && window.OSCILLA.labs && window.OSCILLA.labs.analysis
    && window.OSCILLA.labs.analysis.chart;
  const u = chart && chart.uplot;
  if (!u) return Promise.resolve({ error: 'no live spectrum uPlot instance' });
  const host = u.root.parentElement;
  const rec = { sync: [], paint: [], total: [] };
  let seen = 0;
  let syncMs = 0;
  let paintStart = 0;
  const setData = u.setData;
  const redraw = u.redraw;
  let inFrame = false;
  u.setData = function wrappedSetData(...a) {
    const t0 = performance.now();
    const r = setData.apply(this, a);
    syncMs = performance.now() - t0;
    inFrame = true;
    return r;
  };
  u.redraw = function wrappedRedraw(...a) {
    const t0 = performance.now();
    const r = redraw.apply(this, a);
    if (inFrame) syncMs += performance.now() - t0;
    return r;
  };
  return new Promise((resolve) => {
    const done = () => {
      u.setData = setData;
      u.redraw = redraw;
      u.hooks.drawClear.splice(u.hooks.drawClear.indexOf(onClear), 1);
      u.hooks.draw.splice(u.hooks.draw.indexOf(onDraw), 1);
      resolve({ rec, points: u.data[0].length, series: u.series.length - 1,
        bbox: { width: u.bbox.width, height: u.bbox.height }, pxRatio: u.pxRatio,
        canvas: { width: u.ctx.canvas.width, height: u.ctx.canvas.height },
        hostVisible: host.offsetParent !== null,
        crossOriginIsolated: self.crossOriginIsolated === true });
    };
    function onClear() { paintStart = performance.now(); }
    function onDraw() {
      if (!inFrame) return; // a draw not caused by a frame (resize, theme)
      inFrame = false;
      const paint = performance.now() - paintStart;
      seen += 1;
      if (seen > warm) {
        rec.sync.push(syncMs);
        rec.paint.push(paint);
        rec.total.push(syncMs + paint);
      }
      if (seen >= warm + frames) done();
    }
    (u.hooks.drawClear = u.hooks.drawClear || []).push(onClear);
    (u.hooks.draw = u.hooks.draw || []).push(onDraw);
  });
}

function serve() {
  const server = http.createServer((req, res) => {
    if (!req.url.startsWith('/oscilla/')) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp' });
    res.end(fs.readFileSync(DIST));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function run(name, dpr, base) {
  const browser = await playwright[name].launch({ headless: true, ...LAUNCH[name] });
  const out = { browser: name, browserVersion: browser.version(), dpr, platform: process.platform,
    arch: process.arch, commit: COMMIT, dist: path.relative(ROOT, DIST),
    command: `node spike/gl/uplot-spectrum.cjs ${argv.join(' ')}`.trim(), frames: FRAMES,
    warm: WARM, started: new Date().toISOString(), loadBefore: load() };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 1024 },
      deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    await page.goto(`${base}/oscilla/`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null,
      { timeout: 60000 });
    out.version = await page.evaluate(() => window.OSCILLA.version);
    const box = await page.locator('#osc-hold-play').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    try {
      await page.waitForFunction(() => {
        const e = window.OSCILLA.engine;
        if (!e.analyser) return false;
        const d = new Float32Array(e.analyser.fftSize);
        e.analyser.getFloatTimeDomainData(d);
        let pk = 0;
        for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
        return pk > 0.01;
      }, null, { timeout: 10000, polling: 50 });
      out.sounding = true;
      const r = await page.evaluate(instrument, [WARM, FRAMES]);
      if (r.error) out.error = r.error;
      else {
        out.sync = stats(r.rec.sync);
        out.paint = stats(r.rec.paint);
        out.total = stats(r.rec.total);
        out.points = r.points;
        out.series = r.series;
        out.bbox = r.bbox;
        out.canvas = r.canvas;
        out.pxRatio = r.pxRatio;
        out.hostVisible = r.hostVisible;
        out.crossOriginIsolated = r.crossOriginIsolated;
      }
    } finally {
      await page.mouse.up();
    }
    out.errors = errors.slice(0, 5);
    await ctx.close();
  } catch (e) {
    out.error = String(e && e.message || e);
  } finally {
    await browser.close();
  }
  out.loadAfter = load();
  return out;
}

async function withDeadline(p, ms, what) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what}: `
    + `no result within ${ms} ms`)), ms); });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(t); }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const name of BROWSERS) {
    for (const dpr of DPRS) {
      const r = await withDeadline(run(name, dpr, base), RUN_MS, `${name} dpr ${dpr}`)
        .catch((e) => ({ browser: name, dpr, error: String(e), loadBefore: load() }));
      fs.writeFileSync(path.join(OUT, `uplot-spectrum-${process.platform}-${process.arch}-`
        + `${name}-dpr${dpr}.json`), `${JSON.stringify(r, null, 2)}\n`);
      const s = (x) => (x ? `median ${x.median} p95 ${x.p95}` : '-');
      console.log(`${name} dpr ${dpr}: total ${s(r.total)} ms (sync ${s(r.sync)}, paint `
        + `${s(r.paint)}) points ${r.points} canvas ${r.canvas && `${r.canvas.width}x`
        + `${r.canvas.height}`} | load ${r.loadBefore[0]}${r.error ? ` | ERROR ${r.error}` : ''}`);
    }
  }
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });

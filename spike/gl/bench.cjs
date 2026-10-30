#!/usr/bin/env node
// Y001 spike (branch spike/gl-views, never merged): what raw WebGL, p5 WEBGL and Canvas 2D
// cost per frame for a 1024 x 512 level ring (one column per frame) and a 2048-point XY trace.
//
//   node spike/gl/bench.cjs [--browsers chromium,firefox,webkit] [--modes headless[,headed]]
//        [--backends raw-gl,p5gl,canvas2d] [--scenes ring,xy] [--frames 300] [--warm 60]
//        [--sampling-interval 1024] [--out <dir>] [--commit <sha>]
//
// Serves spike/gl/ and /p5.min.js (node_modules/p5/lib/p5.min.js) on 127.0.0.1 and, per
// browser x mode x backend x scene, in fresh browser contexts at deviceScaleFactor 1:
//   time     --warm frames, then --frames frames: performance.now() around push + draw
//            (main-thread time; GPU work is not in it), median / p95 / mean / max, and the rAF
//            interval median / p95 (dropped frames show there)
//   heap     chromium only (CDP): Performance.getMetrics JSHeapUsedSize before/after the timed
//            run, then a second --frames run under HeapProfiler sampling (samplingInterval
//            --sampling-interval bytes, objects collected by minor and major GC included), whose
//            sampled bytes / frames is the allocation per frame, split by script (backend
//            module, p5.min.js, the bench page, other)
//   synced   --frames more frames with a 1-pixel readback after each draw, timed the same way:
//            the time until the pixels exist (GPU / raster work and one readback included)
//   calls    a separate page load with every context wrapped (?count=1): draw, clear and
//            upload calls per frame
// Output: <out>/bench-<platform>-<arch>-<browser>-<mode>.json, os.loadavg() before and after
// each case. One browser runs at a time.
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
const list = (name, fallback) => arg(name, fallback).split(',').map((s) => s.trim());
const BROWSERS = list('browsers', 'chromium,firefox,webkit');
const MODES = list('modes', 'headless');
const BACKENDS = list('backends', 'raw-gl,p5gl,canvas2d');
const SCENES = list('scenes', 'ring,xy');
const FRAMES = Number(arg('frames', '300'));
const WARM = Number(arg('warm', '60'));
const SAMPLING = Number(arg('sampling-interval', '1024'));
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), 'y001')));
const COMMIT = arg('commit', (() => {
  try {
    return require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'],
      { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { return null; }
})());
const CASE_MS = 180000; // wall-clock deadline of one case
const P5 = require.resolve('p5/lib/p5.min.js');

const load = () => os.loadavg().map((x) => Math.round(x * 100) / 100);
const r2 = (x) => Math.round(x * 1000) / 1000;
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, median: r2(q(0.5)), p95: r2(q(0.95)), mean: r2(s.reduce((a, b) => a + b,
    0) / s.length), max: r2(s[s.length - 1]) };
}

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/plain' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const file = u.pathname === '/p5.min.js' ? P5
      : path.join(__dirname, path.normalize(u.pathname).replace(/^([/\\])+/, ''));
    if (!file.startsWith(__dirname) && file !== P5) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      // COOP/COEP make the page crossOriginIsolated, so performance.now() is not coarsened to
      // 100 us (Chromium) / 1 ms; the page records the granularity it got.
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-resource-policy': 'same-origin' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function withDeadline(p, ms, what) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what}: `
    + `no result within ${ms} ms`)), ms); });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(t); }
}

/** Sum the sampled self sizes of a SamplingHeapProfile by the script of each node. */
function bucketProfile(profile) {
  const by = {};
  let total = 0;
  const bucket = (url) => {
    if (!url) return 'other (native, no script)';
    if (url.endsWith('/p5.min.js')) return 'p5.min.js';
    if (url.includes('/backends/')) return `backend ${url.split('/backends/')[1]}`;
    if (url.includes('/backends.html')) return 'bench page';
    return url;
  };
  const walk = (n) => {
    if (n.selfSize) {
      const k = bucket(n.callFrame.url);
      by[k] = (by[k] || 0) + n.selfSize;
      total += n.selfSize;
    }
    for (const c of n.children || []) walk(c);
  };
  walk(profile.head);
  return { total, by };
}

async function openPage(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true || window.__error, null,
    { timeout: 30000 });
  return { ctx, page, errors };
}

async function benchCase(browser, name, base, backend, scene) {
  const out = { backend, scene, loadBefore: load() };
  const url = `${base}/backends.html?backend=${backend}&scene=${scene}`;
  const a = await openPage(browser, url);
  try {
    out.error = await a.page.evaluate(() => window.__error || null);
    if (out.error) return out;
    out.info = await a.page.evaluate(() => window.__info);
    out.timer = await a.page.evaluate(() => window.__timer);
    await a.page.evaluate((n) => window.__run(n), WARM);
    let cdp = null;
    if (name === 'chromium') {
      cdp = await a.ctx.newCDPSession(a.page);
      await cdp.send('Performance.enable');
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.collectGarbage');
    }
    const metric = async () => {
      if (!cdp) return null;
      const { metrics } = await cdp.send('Performance.getMetrics');
      return metrics.find((m) => m.name === 'JSHeapUsedSize').value;
    };
    const heap0 = await metric();
    const timed = await a.page.evaluate((n) => window.__run(n), FRAMES);
    const heap1 = await metric();
    out.mainThreadMs = stats(timed.times);
    out.rafIntervalMs = stats(timed.intervals);
    if (cdp) {
      out.jsHeapUsedDelta = { bytes: heap1 - heap0, perFrame: r2((heap1 - heap0) / FRAMES),
        note: 'Performance.getMetrics JSHeapUsedSize after - before the timed run; GC can '
          + 'make it negative or hide allocation' };
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: SAMPLING,
        includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      await a.page.evaluate((n) => window.__run(n), FRAMES);
      const { profile } = await cdp.send('HeapProfiler.stopSampling');
      const b = bucketProfile(profile);
      const per = {};
      for (const [k, v] of Object.entries(b.by)) per[k] = Math.round(v / FRAMES);
      out.allocation = { method: `CDP HeapProfiler sampling, samplingInterval ${SAMPLING} B, `
        + 'includeObjectsCollectedByMinorGC/MajorGC true, second run of the same frames',
      frames: FRAMES, bytesPerFrame: Math.round(b.total / FRAMES), byScriptPerFrame: per,
      // The bench page's own data generation is not the backend's cost.
      backendBytesPerFrame: Math.round((b.total - (b.by['bench page'] || 0)) / FRAMES) };
    }
    // The same draw followed by a 1-pixel readback: the time until the pixels exist (GPU or
    // rasteriser work included, plus one readback round trip).
    const synced = await a.page.evaluate((n) => window.__run(n, true), FRAMES);
    out.syncedMs = stats(synced.times);
  } finally {
    out.errors = a.errors.slice(0, 5);
    await a.ctx.close();
  }
  const c = await openPage(browser, `${url}&count=1`);
  try {
    await c.page.evaluate(() => window.__run(10));
    out.callsPerFrame = (await c.page.evaluate(() => window.__run(60))).calls;
  } finally {
    await c.ctx.close();
  }
  out.loadAfter = load();
  return out;
}

function line(browser, mode, r) {
  if (r.error) return `${browser}/${mode} ${r.backend}/${r.scene}: ERROR ${r.error}`;
  const m = r.mainThreadMs;
  const al = r.allocation ? ` alloc ${r.allocation.backendBytesPerFrame} B/f (excl. page)` : '';
  const calls = Object.entries(r.callsPerFrame || {}).map(([k, v]) => `${k}=${r2(v)}`).join(' ');
  return `${browser}/${mode} ${r.backend}/${r.scene}: main median ${m.median} p95 ${m.p95} ms, `
    + `synced median ${r.syncedMs && r.syncedMs.median} p95 ${r.syncedMs && r.syncedMs.p95}, `
    + `raf p95 ${r.rafIntervalMs && r.rafIntervalMs.p95}${al} | ${calls} | timer `
    + `${r.timer && r2(r.timer.granularityMs)} ms | load ${r.loadBefore[0]}`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const name of BROWSERS) {
      for (const mode of MODES) {
        if (mode === 'headed' && process.platform !== 'darwin') continue;
        const browser = await playwright[name].launch({ headless: mode === 'headless' });
        const rec = { leg: `${process.platform}-${process.arch}-${name}-${mode}`, browser: name,
          browserVersion: browser.version(), mode, platform: process.platform,
          arch: process.arch, playwright: require('playwright/package.json').version,
          p5: require('p5/package.json').version, commit: COMMIT,
          command: `node spike/gl/bench.cjs ${argv.join(' ')}`.trim(), frames: FRAMES,
          warm: WARM, started: new Date().toISOString(), cases: [] };
        try {
          for (const backend of BACKENDS) {
            for (const scene of SCENES) {
              const r = await withDeadline(benchCase(browser, name, base, backend, scene),
                CASE_MS, `${name} ${backend} ${scene}`).catch((e) => ({ backend, scene,
                error: String(e && e.message || e), loadBefore: load() }));
              rec.cases.push(r);
              console.log(line(name, mode, r));
            }
          }
        } finally {
          await browser.close();
        }
        fs.writeFileSync(path.join(OUT, `bench-${rec.leg}.json`),
          `${JSON.stringify(rec, null, 2)}\n`);
      }
    }
  } finally {
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });

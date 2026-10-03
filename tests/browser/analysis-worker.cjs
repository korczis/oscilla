#!/usr/bin/env node
// M10: the offline analysis in the data: URL Worker vs on the main thread, in real browsers.
//
//   node tests/browser/analysis-worker.cjs [--browsers chromium,firefox,webkit]
//                                          [--origins file,http] [--json out.json]
//                                          [--bench [--rates 48000,96000] [--seconds 10,30]
//                                                   [--modes inline,worker]]
//
// The fixture is one HTML file with one classic inline script (the constraints of
// dist/index.html): an esbuild bundle of analysis-task.js + analysis-runner.js with the define
// __OSCILLA_ANALYSIS_WORKER__ set to scripts/build-analysis-worker.mjs's Worker script, exactly
// as scripts/build.mjs builds the app. It is opened from file:// and from
// http://127.0.0.1:<port>/oscilla/.
//
// Asserted per browser and origin:
//   - the Worker starts from the data: URL (no inline fallback);
//   - its result is bit-identical to analyzeInline on a copy of the same message (3 runs of a
//     2 s sweep at 48 kHz with a noise capture and phase: every typed array compared byte for
//     byte, every other field by value), and the captures were transferred;
//   - the main thread stays responsive while the Worker runs a 10 s sweep at 48 kHz: the
//     largest gap between MessageChannel heartbeats is below MAX_WORKER_GAP_MS;
//   - an abort mid-analysis rejects at once (ABORTED; that it terminates the Worker is checked
//     in tests/unit/v3-analysis-worker.test.mjs).
// --bench (reported, not asserted; recorded in docs/v3/spike-audioworklet-worker.md "M10"):
// 10 s and 30 s sweeps at 48 and 96 kHz, one run + 1 s noise capture, inline (the pre-M10 path:
// analyzeInline with a MessageChannel yield between steps) and Worker, each in a fresh browser:
// total time, longest main-thread block (heartbeat gap; Chromium also the longtask entries),
// and peak RSS growth of the browser's whole process tree (ps, sampled every 20 ms) and what is
// still held 1.5 s after the analysis.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const playwright = require('playwright');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BROWSERS = arg('browsers', process.env.OSC_BROWSERS || 'chromium,firefox,webkit').split(',');
const ORIGINS = arg('origins', 'file,http').split(',');
const BENCH = argv.includes('--bench');
const JSON_OUT = arg('json', '');
const RATES = arg('rates', '48000,96000').split(',').map(Number);
const SECONDS = arg('seconds', '10,30').split(',').map(Number);
const MODES = arg('modes', 'inline,worker').split(',');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src', 'js');
// The spike measured 1-4 ms heartbeat gaps with a Worker; a blocked main thread shows the
// analysis steps (≥ 200 ms for a 10 s sweep). 50 ms leaves room for a loaded CI machine.
const MAX_WORKER_GAP_MS = 50;

const ENTRY = `
import { renderStimulus } from './measurement/stimulus.js';
import { analysisMessage, analyzeInline } from './measurement/analysis-task.js';
import { defaultAnalyze, EMBEDDED_WORKER_SOURCE } from './measurement/analysis-runner.js';

const T = {};
window.T = T;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
}
// One-pole low-pass system + seeded noise; pre-roll 0.5 s, post-roll 1.5 s (DEFAULT_TIMING).
T.message = ({ seconds, sr, runs = 1, phase = false }) => {
  const st = renderStimulus({ kind: 'log-sweep', sampleRate: sr, duration: seconds, level: 0.25,
    f1: 20, f2: 20000, fade: 0.01 });
  const pre = Math.round(0.5 * sr);
  const len = Math.ceil((0.5 + seconds + 1.5) * sr) + 256;
  const r = rng(7);
  const captures = [];
  for (let k = 0; k < runs; k++) {
    const y = new Float32Array(len);
    let z = 0;
    for (let i = 0; i < st.samples.length; i++) {
      z += 0.3 * (st.samples[i] - z);
      y[pre + k + i] = (1 - 0.01 * k) * z;
    }
    for (let i = 0; i < len; i++) y[i] += 1e-4 * r();
    captures.push(y);
  }
  const noise = new Float32Array(sr);
  for (let i = 0; i < noise.length; i++) noise[i] = 1e-4 * r();
  return analysisMessage({ stimulus: st.samples, sampleRate: sr, f1: 20, f2: 20000, captures,
    noise, phase, aggregation: 'mean' });
};
const copy = (m) => ({ ...m, captures: m.captures.map((c) => c.slice()),
  noise: m.noise ? m.noise.slice() : null });

const yieldTask = () => new Promise((resolve) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
  ch.port2.postMessage(0);
});

// Largest gap between MessageChannel heartbeats while fn() runs (= longest main-thread block).
async function withHeartbeat(fn) {
  const ch = new MessageChannel();
  let last = performance.now();
  let maxGap = 0;
  let beating = true;
  ch.port1.onmessage = () => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
    if (beating) ch.port2.postMessage(0);
  };
  const longTasks = [];
  let obs = null;
  try {
    obs = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) longTasks.push(e.duration);
    });
    obs.observe({ type: 'longtask', buffered: false });
  } catch (e) { obs = null; }
  ch.port2.postMessage(0);
  const t0 = performance.now();
  let value;
  try {
    value = await fn();
  } finally {
    beating = false;
    if (obs) obs.disconnect();
  }
  ch.port1.close();
  return { value, totalMs: performance.now() - t0, maxGapMs: maxGap,
    longTaskMaxMs: obs ? Math.max(0, ...longTasks) : null };
}

function sameBits(a, b, where, out) {
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor
      || a.length !== b.length) { out.push(where + ': type/length'); return; }
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== y[i]) { out.push(where + ': byte ' + i); return; }
    }
    return;
  }
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) { out.push(where + ': keys'); return; }
    for (const k of ka) {
      if (where === '' && k === 'steps') continue; // step times differ by design
      sameBits(a[k], b[k], where + '.' + k, out);
    }
    return;
  }
  if (!Object.is(a, b)) out.push(where + ': ' + a + ' vs ' + b);
}

T.hasWorker = () => typeof EMBEDDED_WORKER_SOURCE === 'string'
  && EMBEDDED_WORKER_SOURCE.length > 1000;

T.identity = async () => {
  const m = T.message({ seconds: 2, sr: 48000, runs: 3, phase: true });
  const ref = await analyzeInline(copy(m));
  const analyze = defaultAnalyze();
  const steps = [];
  const res = await analyze(m, { onStep: (s) => steps.push(s) });
  const diffs = [];
  sameBits(res, ref, '', diffs);
  return { mode: analyze.mode || 'inline', fallback: analyze.lastFallback || null,
    diffs: diffs.slice(0, 5), steps: steps.length, refSteps: ref.steps.length,
    transferred: m.captures.every((c) => c.length === 0) && m.noise.length === 0,
    irLength: res.ir.samples.length };
};

T.run = async ({ seconds, sr, mode }) => {
  const m = T.message({ seconds, sr });
  const fn = mode === 'worker' ? defaultAnalyze() : analyzeInline;
  const steps = [];
  const hb = await withHeartbeat(() => fn(m, { yield: yieldTask, onStep: (s) => steps.push(s),
    now: () => performance.now() }));
  return { mode: fn.mode || 'inline', fallback: fn.lastFallback || null, totalMs: hb.totalMs,
    maxGapMs: hb.maxGapMs, longTaskMaxMs: hb.longTaskMaxMs, fftSize: hb.value.transfers[0].fftSize,
    longestStepMs: Math.max(...steps.map((s) => s.ms)), irLength: hb.value.ir.samples.length,
    irTruncation: hb.value.ir.truncation || null };
};

T.abort = async () => {
  const m = T.message({ seconds: 10, sr: 48000 });
  const ac = new AbortController();
  const analyze = defaultAnalyze();
  const t0 = performance.now();
  const p = analyze(m, { signal: ac.signal });
  setTimeout(() => ac.abort(), 150);
  try {
    await p;
    return { rejected: false };
  } catch (e) {
    return { rejected: true, code: e.code || null, afterMs: performance.now() - t0 };
  }
};
`;

const HTML = (js) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>OSCILLA M10 analysis worker</title></head>
<body><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;

async function bundle() {
  const { buildAnalysisWorker } = await import(
    pathToFileURL(path.join(ROOT, 'scripts', 'build-analysis-worker.mjs')).href);
  const worker = await buildAnalysisWorker({ root: ROOT });
  const r = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: SRC, sourcefile: 'analysis-worker-entry.js' },
    bundle: true, format: 'iife', write: false, target: 'es2020', logLevel: 'silent',
    define: { __OSCILLA_ANALYSIS_WORKER__: JSON.stringify(worker.code) },
  });
  return r.outputFiles[0].text;
}

function startServer(html) {
  const server = http.createServer((req, res) => {
    if (req.url === '/oscilla/' || req.url === '/oscilla/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// RSS (bytes) of a process and all its descendants.
function treeRss(rootPid) {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' })
    .trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [pid, ppid] of rows) {
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const rss = new Map(rows.map(([pid, , kb]) => [pid, kb * 1024]));
  let sum = 0;
  const stack = [rootPid];
  while (stack.length) {
    const p = stack.pop();
    sum += rss.get(p) || 0;
    for (const c of kids.get(p) || []) stack.push(c);
  }
  return sum;
}

let failures = 0;
let passes = 0;
const report = { meta: { date: new Date().toISOString(), node: process.version,
  platform: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0].model }, runs: {}, bench: [] };
function check(key, name, ok, detail = '') {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} [${key}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function runOne(name, origin, url) {
  const key = `${name}/${origin}`;
  const browser = await playwright[name].launch();
  const rec = (report.runs[key] = { version: browser.version() });
  console.log(`\n${key} (${rec.version})`);
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  try {
    await page.goto(url, { waitUntil: 'load' });
    check(key, 'Worker script embedded', await page.evaluate(() => window.T.hasWorker()));
    const id = (rec.identity = await page.evaluate(() => window.T.identity()));
    check(key, 'analysis runs in the data: URL Worker', id.mode === 'worker' && !id.fallback,
      `${id.mode}${id.fallback ? `, fallback: ${id.fallback}` : ''}`);
    check(key, 'Worker result bit-identical to analyzeInline (3 runs, noise, phase)',
      id.diffs.length === 0, id.diffs.join('; ') || `${id.steps}/${id.refSteps} steps`);
    check(key, 'captures and noise transferred to the Worker', id.transferred);
    const w = (rec.worker10 = await page.evaluate(() => window.T.run({ seconds: 10, sr: 48000,
      mode: 'worker' })));
    check(key, `main thread responsive during a 10 s / 48 kHz Worker analysis (max gap < `
      + `${MAX_WORKER_GAP_MS} ms)`, w.mode === 'worker' && w.maxGapMs < MAX_WORKER_GAP_MS,
    `max gap ${w.maxGapMs.toFixed(1)} ms, total ${w.totalMs.toFixed(0)} ms, longest Worker step `
      + `${w.longestStepMs.toFixed(0)} ms`);
    const ab = (rec.abort = await page.evaluate(() => window.T.abort()));
    check(key, 'abort rejects with ABORTED while the Worker computes', ab.rejected
      && ab.code === 'ABORTED' && ab.afterMs < 1000, JSON.stringify(ab));
    check(key, 'no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    check(key, 'run completed', false, e.stack || String(e));
  } finally {
    await browser.close();
  }
}

async function benchOne(name, url, cfg) {
  const server = await playwright[name].launchServer();
  const browser = await playwright[name].connect(server.wsEndpoint());
  const pid = server.process().pid;
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(300000);
    await page.goto(url, { waitUntil: 'load' });
    // Warm-up: parse/compile the bundle and the Worker once on a tiny input.
    await page.evaluate((mode) => window.T.run({ seconds: 1, sr: 48000, mode }), cfg.mode);
    // WebKit's WebContent process is started by launchd, not by the browser process, so the
    // process tree does not contain it: no memory figures there.
    const rss = name === 'webkit' ? null : treeRss;
    const base = rss ? rss(pid) : 0;
    let peak = base;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        if (rss) peak = Math.max(peak, rss(pid));
        await new Promise((r) => setTimeout(r, 20));
      }
    })();
    let out;
    try {
      out = await page.evaluate((c) => window.T.run(c), cfg);
    } finally {
      sampling = false;
      await sampler;
    }
    // Retained 1.5 s later: an inline analysis leaves its garbage in the page heap until the
    // page's next GC; a terminated Worker returns its heap at once.
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
    if (!rss) return { ...out, baseMiB: null, peakDeltaMiB: null, afterDeltaMiB: null };
    const after = rss(pid);
    return { ...out, baseMiB: base / 2 ** 20, peakDeltaMiB: (peak - base) / 2 ** 20,
      afterDeltaMiB: (after - base) / 2 ** 20 };
  } finally {
    await browser.close();
    await server.close();
  }
}

(async () => {
  const js = await bundle();
  const html = HTML(js);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-m10-'));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, html);
  const server = ORIGINS.includes('http') ? await startServer(html) : null;
  const httpUrl = server ? `http://127.0.0.1:${server.address().port}/oscilla/` : null;
  const fileUrl = pathToFileURL(file).href;
  try {
    for (const b of BROWSERS) {
      for (const o of ORIGINS) await runOne(b, o, o === 'file' ? fileUrl : httpUrl);
    }
    if (BENCH) {
      console.log('\nbench (file://, one fresh browser per row; reported, not asserted)');
      for (const b of BROWSERS) {
        for (const sr of RATES) {
          for (const seconds of SECONDS) {
            for (const mode of MODES) {
              const r = await benchOne(b, fileUrl, { seconds, sr, mode })
                .catch((e) => ({ error: e.message.split('\n')[0] }));
              const row = { browser: b, sr, seconds, mode, ...r };
              report.bench.push(row);
              console.log(`  ${b} ${sr} Hz ${seconds} s ${mode}: ${r.error ? `ERROR ${r.error}`
                : `N=${r.fftSize}, total ${r.totalMs.toFixed(0)} ms, main-thread max block `
                + `${r.maxGapMs.toFixed(0)} ms${r.longTaskMaxMs != null ? ` (longtask `
                + `${r.longTaskMaxMs.toFixed(0)} ms)` : ''}, longest step `
                + `${r.longestStepMs.toFixed(0)} ms, ${r.peakDeltaMiB === null ? 'RSS n/a'
                  : `peak RSS +${r.peakDeltaMiB.toFixed(0)} MiB (base ${r.baseMiB.toFixed(0)} `
                  + `MiB, +${r.afterDeltaMiB.toFixed(0)} MiB 1.5 s after)`}, IR ${r.irLength}`
                + `${r.irTruncation ? ` (capped from ${r.irTruncation.fullLength})` : ''}`}`);
            }
          }
        }
      }
    }
  } finally {
    if (server) server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL PASS'} (${passes} checks passed)`);
  process.exit(failures ? 1 : 0);
})();

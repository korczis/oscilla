#!/usr/bin/env node
// Y001 spike (branch spike/gl-views, never merged): WebGL capability probe per gate browser.
//
//   node spike/gl/probe.cjs [--browsers chromium,firefox,webkit] [--modes headless,headed]
//        [--max-contexts 64] [--out <dir>]
//
// Per leg (browser x mode) it loads spike/gl/probe.html from file:// and records, for webgl2
// and webgl: getContext with and without failIfMajorPerformanceCaveat, VENDOR/RENDERER and the
// unmasked renderer where WEBGL_debug_renderer_info gives it, MAX_TEXTURE_SIZE,
// MAX_VERTEX_TEXTURE_IMAGE_UNITS, an R8 (webgl2) and LUMINANCE upload + sample round trip,
// EXT_color_buffer_float, EXT_color_buffer_half_float, OES_element_index_uint; then, in a fresh
// browser context per kind, how many live contexts a page holds before the oldest is lost.
// Headed legs run only on darwin (CI runs headless). One browser runs at a time. Output:
// <out>/probe-<platform>-<arch>-<browser>-<mode>.json, with os.loadavg() before and after.
//
// linux-x64 legs: run inside mcr.microsoft.com/playwright:v1.63.0-noble (spike/gl/README.md).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BROWSERS = arg('browsers', 'chromium,firefox,webkit').split(',');
const MODES = arg('modes', process.platform === 'darwin' ? 'headless,headed' : 'headless')
  .split(',');
const MAX_CONTEXTS = Number(arg('max-contexts', '64'));
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), 'y001')));
const PAGE = pathToFileURL(path.join(__dirname, 'probe.html')).href;
const LEG_MS = 180000; // wall-clock deadline of one leg
const COMMIT = arg('commit', (() => {
  try {
    return require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'],
      { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { return null; }
})());

const load = () => os.loadavg().map((x) => Math.round(x * 100) / 100);

async function withDeadline(p, ms, what) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what}: `
    + `no result within ${ms} ms`)), ms); });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(t); }
}

async function freshPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const consoleLines = [];
  page.on('console', (m) => { if (consoleLines.length < 50) consoleLines.push(`${m.type()}: `
    + m.text()); });
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
  return { ctx, page, consoleLines };
}

async function leg(name, mode) {
  if (mode === 'headed' && process.platform !== 'darwin') return null;
  const started = new Date().toISOString();
  const loadBefore = load();
  const browser = await playwright[name].launch({ headless: mode === 'headless' });
  const out = { leg: `${process.platform}-${process.arch}-${name}-${mode}`, browser: name,
    browserVersion: browser.version(), mode, platform: process.platform, arch: process.arch,
    playwright: require('playwright/package.json').version, commit: COMMIT,
    command: `node spike/gl/probe.cjs ${argv.join(' ')}`.trim(), started, loadBefore };
  try {
    const a = await freshPage(browser);
    out.capabilities = await a.page.evaluate(() => window.__probe());
    out.capabilityConsole = a.consoleLines;
    await a.ctx.close();
    out.contextBudget = {};
    for (const kind of ['webgl', 'webgl2']) {
      const b = await freshPage(browser);
      out.contextBudget[kind] = await b.page.evaluate(([k, m]) => window.__contextBudget(k, m),
        [kind, MAX_CONTEXTS]);
      out.contextBudget[kind].console = b.consoleLines.filter((l) => /context/i.test(l))
        .slice(0, 5);
      await b.ctx.close();
    }
  } catch (e) {
    out.error = String(e && e.stack || e);
  } finally {
    await browser.close();
  }
  out.loadAfter = load();
  return out;
}

function summary(r) {
  const c = r.capabilities ? r.capabilities.contexts : {};
  const k = (x) => (c[x] && c[x].plain ? `${c[x].plain.ok ? 'ok' : 'NO'}/caveat-`
    + `${c[x].withCaveatFail.ok ? 'ok' : 'NO'}` : '?');
  const cb = r.contextBudget || {};
  const lim = (x) => (!cb[x] ? '?' : cb[x].firstLossAt !== null ? `${cb[x].firstLossAt - 1}`
    : cb[x].lostEvents ? `${cb[x].aliveByEvents} (async)` : `>=${cb[x].created}`);
  const rend = (c.webgl2 && (c.webgl2.unmaskedRenderer || c.webgl2.renderer))
    || (c.webgl && (c.webgl.unmaskedRenderer || c.webgl.renderer)) || '-';
  return `${r.leg.padEnd(32)} webgl2 ${k('webgl2')} webgl ${k('webgl')} `
    + `limit gl1 ${lim('webgl')} gl2 ${lim('webgl2')} | ${rend} | load ${r.loadBefore[0]}`
    + (r.error ? ` | ERROR ${r.error.split('\n')[0]}` : '');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const name of BROWSERS) {
    for (const mode of MODES) {
      const r = await withDeadline(leg(name, mode), LEG_MS, `${name} ${mode}`)
        .catch((e) => ({ leg: `${process.platform}-${process.arch}-${name}-${mode}`,
          error: String(e), loadBefore: load() }));
      if (!r) continue;
      const file = path.join(OUT, `probe-${r.leg}.json`);
      fs.writeFileSync(file, `${JSON.stringify(r, null, 2)}\n`);
      console.log(summary(r));
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });

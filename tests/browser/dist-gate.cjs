#!/usr/bin/env node
// Browser release gate for dist/index.html: every check runs per browser twice, from file:// and
// from a GitHub-Pages-like sub-path (http://127.0.0.1:<port>/oscilla/, python3 http.server).
//   node tests/browser/dist-gate.cjs [--dist dist/index.html] [--browsers chromium,firefox,webkit]
// Needs Playwright browsers: npx playwright install chromium firefox webkit.
// Checks marked SMOKE target the skeleton's smoke app; replace them as the real UI lands.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
  return acc;
}, []));
const dist = path.resolve(args.dist || path.join(__dirname, '..', '..', 'dist', 'index.html'));
const browsers = (args.browsers || 'chromium,firefox,webkit').split(',');
const label = args.label || 'dist';

function startServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-pages-'));
  fs.mkdirSync(path.join(root, 'oscilla'));
  fs.copyFileSync(dist, path.join(root, 'oscilla', 'index.html'));
  const port = 8700 + Math.floor(Math.random() * 200);
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root],
    { stdio: 'ignore' });
  return { proc, root, url: `http://127.0.0.1:${port}/oscilla/` };
}

async function waitForServer(url) {
  for (let i = 0; i < 50; i += 1) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start: ${url}`);
}

const LAUNCH = {
  chromium: { args: ['--autoplay-policy=user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 1, 'media.autoplay.blocking_policy': 0 } },
  webkit: {},
};

async function runOne(browserName, baseUrl) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const warnings = [];
  const requests = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('request', (r) => requests.push(r.url()));
  const results = {};
  const check = async (name, fn) => {
    try {
      const v = await fn();
      results[name] = v === true || (v && v.ok) ? { ok: true, ...(v === true ? {} : v) } : { ok: false, detail: v };
    } catch (e) {
      results[name] = { ok: false, detail: String(e.message || e).split('\n')[0] };
    }
  };

  const target = `${baseUrl}#f=880&w=square`;
  const tLoad = Date.now();
  await page.goto(target, { waitUntil: 'load' });
  await check('boot', async () => {
    await page.waitForSelector('html[data-ready="true"]', { timeout: 10000 });
    const readyAt = Number(await page.evaluate(() => document.documentElement.dataset.readyAt));
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return n ? { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : {};
    });
    return { ok: true, wallMs: Date.now() - tLoad, readyAt, ...nav };
  });

  await check('alpine-reactive+hash', async () => {
    const fromHash = await page.textContent('#freq-readout');
    const waveFromHash = await page.textContent('#wave-readout');
    await page.$eval('#freq', (el) => { el.value = '1000'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector('#freq-readout').textContent === '1.00 kHz', null, { timeout: 3000 });
    const hash = await page.evaluate(() => location.hash);
    const how = await page.textContent('#hash-write');
    const ok = fromHash.trim() === '880 Hz' && waveFromHash.trim() === 'square' && hash.includes('f=1000');
    return ok ? { ok, hash, how } : { fromHash, waveFromHash, hash, how };
  });

  await check('dialog-modal', async () => {
    await page.click('#info-btn');
    await page.waitForSelector('#info-modal[open]', { timeout: 3000 });
    const modal = await page.evaluate(() => document.querySelector('#info-modal').matches(':modal'));
    await page.keyboard.press('Escape');
    await page.waitForSelector('#info-modal:not([open])', { state: 'attached', timeout: 3000 });
    return modal ? true : { modal };
  });

  await check('alpine-menu', async () => {
    await page.click('#wave-btn');
    await page.waitForSelector('#wave-menu', { state: 'visible', timeout: 3000 });
    await page.click('#wave-menu [data-wave="triangle"]');
    await page.waitForFunction(() => document.querySelector('#wave-readout').textContent === 'triangle', null, { timeout: 3000 });
    await page.waitForSelector('#wave-menu', { state: 'hidden', timeout: 3000 });
    return true;
  });

  await check('p5-draws', async () => {
    await page.waitForFunction(() => window.__oscilla.bridge.frames > 5, null, { timeout: 5000 });
    const px = await page.evaluate(() => {
      const c = document.querySelector('#p5-host canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 150) lit += 1;
      return { w: c.width, h: c.height, lit, frames: window.__oscilla.bridge.frames };
    });
    return px.lit > 100 ? { ok: true, ...px } : px;
  });

  await check('uplot-renders', async () => {
    await page.waitForFunction(() => window.__oscilla.bridge.chartUpdates > 3, null, { timeout: 5000 });
    const info = await page.evaluate(() => {
      const c = document.querySelector('#chart-host .uplot canvas');
      if (!c) return { canvas: false };
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let ink = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink += 1;
      return { canvas: true, w: c.width, h: c.height, ink, updates: window.__oscilla.bridge.chartUpdates };
    });
    return info.canvas && info.ink > 50 ? { ok: true, ...info } : info;
  });

  await check('oscillator+analyser', async () => {
    await page.click('#play');
    await page.waitForFunction(() => document.querySelector('#engine-state').textContent === 'running', null, { timeout: 5000 });
    await page.waitForTimeout(600);
    const rms = await page.evaluate(() => window.__oscilla.engine.analyserRms());
    return rms > 0.005 ? { ok: true, rms: Number(rms.toFixed(4)) } : { rms };
  });

  await check('worklet-blob', async () => {
    const state = await page.textContent('#worklet-state');
    await page.waitForTimeout(300);
    const rms = await page.evaluate(() => window.__oscilla.engine.workletRms);
    return state === 'loaded' && rms > 0.005 ? { ok: true, rms: Number(rms.toFixed(4)) } : { state, rms };
  });

  await check('dynamic-import-inlined', async () => {
    const t = await page.textContent('#lab-info');
    return t === 'lazy module inlined' ? true : { text: t };
  });

  await check('css-bundled', async () => {
    const r = await page.evaluate(() => ({
      token: getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim(),
      uplotCss: getComputedStyle(document.querySelector('.uplot .u-wrap')).position,
      nested: getComputedStyle(document.querySelector('#play')).color,
    }));
    return r.token && r.uplotCss === 'relative' && r.nested === 'rgb(255, 255, 255)' ? { ok: true, ...r } : r;
  });

  await page.click('#play'); // stop
  await page.waitForTimeout(100);

  const globals = await page.evaluate(() => {
    const f = document.createElement('iframe');
    document.body.appendChild(f);
    const base = new Set(Object.getOwnPropertyNames(f.contentWindow));
    f.remove();
    return Object.getOwnPropertyNames(window).filter((k) => !base.has(k));
  });

  const docUrl = baseUrl.split('#')[0];
  const foreign = requests.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:') && u.split('#')[0] !== docUrl);
  results['no-network'] = foreign.length === 0
    ? { ok: true, requests: requests.length, blobOrData: requests.filter((u) => /^(blob|data):/.test(u)).length }
    : { ok: false, detail: foreign };
  results['no-console-errors'] = errors.length === 0 ? { ok: true } : { ok: false, detail: errors };
  await browser.close();
  return { results, warnings, globals };
}

(async () => {
  const server = startServer();
  await waitForServer(server.url);
  const targets = { file: pathToFileURL(dist).href, http: server.url };
  const report = { label, dist, size: fs.statSync(dist).size, runs: {} };
  let failed = 0;
  try {
    for (const b of browsers) {
      for (const [mode, url] of Object.entries(targets)) {
        const r = await runOne(b, url);
        report.runs[`${b}/${mode}`] = r;
        const bad = Object.entries(r.results).filter(([, v]) => !v.ok);
        failed += bad.length;
        console.log(`${label.padEnd(10)} ${b.padEnd(9)} ${mode.padEnd(5)} `
          + `${bad.length ? 'FAIL ' + bad.map(([k, v]) => `${k}=${JSON.stringify(v.detail)}`).join('; ') : 'PASS'}`
          + ` | ${Object.keys(r.results).length} checks`);
      }
    }
  } finally {
    server.proc.kill();
    fs.rmSync(server.root, { recursive: true, force: true });
  }
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

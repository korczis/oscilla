#!/usr/bin/env node
// SPIKE (plan issue E012, branch spike/p5-canvas2d, never merged): per-view pixel parity of the
// p5 views between two builds. `shoot` renders every view of the primary analysis host and the
// Phase & Stereo view of one dist in Chromium at the reference viewport (1536x1024, reduced
// motion, idle, so no view animates) and saves each canvas as a PNG; `compare` reports, per
// view, the share of pixels pixelmatch (threshold 0.1, as visual-compare.mjs) finds different.
//
//   node scripts/p5-view-shots.mjs shoot <dist.html> <out-dir>
//   node scripts/p5-view-shots.mjs compare <dir-a> <dir-b> [--json <file>]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const VIEWS = ['scope', 'wave', 'path', 'interference', 'harmonicBars'];
const PAGE_MS = 60000;

async function shoot(dist, out) {
  const { chromium } = require('playwright');
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1536, height: 1024 },
      deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(pathToFileURL(path.resolve(dist)).href, { waitUntil: 'load',
      timeout: PAGE_MS });
    await page.waitForSelector('html[data-ready="true"]', { timeout: PAGE_MS });
    await page.waitForFunction(() => {
      const h = window.OSCILLA && window.OSCILLA.host;
      return !!(h && h.p5 && h.p5.canvas && h.p5._setupDone !== false);
    }, null, { timeout: PAGE_MS });
    const shots = {};
    for (const id of VIEWS) {
      shots[id] = await page.evaluate((v) => {
        const host = window.OSCILLA.host;
        host.setView(v);
        host.p5.redraw();
        return host.p5.canvas.toDataURL('image/png');
      }, id);
    }
    shots.phaseStereo = await page.evaluate(() => {
      const view = window.OSCILLA.labs.phase && window.OSCILLA.labs.phase.view;
      const inst = view && view.instance;
      if (!inst || !inst.canvas) return null;
      inst.redraw();
      return inst.canvas.toDataURL('image/png');
    });
    for (const [id, url] of Object.entries(shots)) {
      if (!url) continue;
      writeFileSync(path.join(out, `${id}.png`),
        Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    }
    writeFileSync(path.join(out, 'errors.json'), `${JSON.stringify(errors, null, 2)}\n`);
    console.log(`shot ${Object.keys(shots).filter((k) => shots[k]).join(', ')} -> ${out}`
      + `${errors.length ? ` (${errors.length} page errors)` : ''}`);
  } finally {
    await browser.close();
  }
}

function compare(a, b, jsonOut) {
  const { PNG } = require('pngjs');
  const pm = require('pixelmatch');
  const pixelmatch = pm.default || pm;
  const rows = {};
  for (const id of [...VIEWS, 'phaseStereo']) {
    const fa = path.join(a, `${id}.png`);
    const fb = path.join(b, `${id}.png`);
    if (!existsSync(fa) || !existsSync(fb)) { rows[id] = null; continue; }
    const ia = PNG.sync.read(readFileSync(fa));
    const ib = PNG.sync.read(readFileSync(fb));
    if (ia.width !== ib.width || ia.height !== ib.height) {
      rows[id] = { size: [`${ia.width}x${ia.height}`, `${ib.width}x${ib.height}`] };
      continue;
    }
    const diff = pixelmatch(ia.data, ib.data, null, ia.width, ia.height, { threshold: 0.1 });
    const total = ia.width * ia.height;
    rows[id] = { width: ia.width, height: ia.height, differing: diff,
      percent: Math.round((diff / total) * 10000) / 100 };
  }
  for (const [id, r] of Object.entries(rows)) {
    console.log(`${id.padEnd(13)} ${r === null ? 'missing' : r.size ? `size ${r.size.join(' vs ')}`
      : `${r.percent}% (${r.differing} of ${r.width * r.height} px)`}`);
  }
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(rows, null, 2)}\n`);
}

const [mode, x, y, ...rest] = process.argv.slice(2);
if (mode === 'shoot' && x && y) await shoot(x, y);
else if (mode === 'compare' && x && y) {
  const j = rest.indexOf('--json');
  compare(x, y, j >= 0 ? rest[j + 1] : '');
} else {
  console.error('usage: p5-view-shots.mjs shoot <dist.html> <out> | compare <a> <b> [--json f]');
  process.exit(2);
}

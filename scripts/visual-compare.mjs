#!/usr/bin/env node
// Visual comparison against the reference screenshot.
//
//   NODE_PATH=/Users/korczis/dev/oscilla/tests/node_modules node scripts/visual-compare.mjs \
//     [target] [--mock] [--responsive] [--crops] [--label <name>] [--out <dir>] [--play]
//
// --out <dir>  write every artifact there instead of tests/visual/out (agents running in
//              parallel must not clobber each other).
// --play       (built app: 'dist' or a path) launch Chromium with autoplay allowed and drive a
//              REAL reference-like scene through window.OSCILLA before the screenshot: a 10 s
//              20 Hz -> 20 kHz log sweep (V1 sweepUp defaults) feeds the spectrogram, then a
//              15.5 kHz sine is held on the Hold button (real pointer) while the analysers show
//              live data. The sequencer keeps its reference sequence with Sweep selected.
//
// target: omitted -> src/index.html rendered through a dev preview (CSS via main.css @imports,
//         Alpine + src/js/ui/app.js as modules, served from a local HTTP server rooted at app/);
//         'dist' -> dist/index.html; any other path or http(s) URL is loaded as is.
// Output (tests/visual/out/): current.png, side-by-side.png (reference | current | diff),
// diff.png, report.json, crops/<region>.png with --crops, responsive-<w>.png with --responsive.
// Prints per-region mismatch % and each region's DOM box next to the reference box.
//
// pngjs and pixelmatch are pinned devDependencies; OSC_VISUAL_TOOLS may point elsewhere.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outArg = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const OUT = outArg ? path.resolve(outArg) : path.join(ROOT, 'tests/visual/out');
const REGIONS_FILE = path.join(ROOT, 'tests/visual/regions.json');
const TOOLS = process.env.OSC_VISUAL_TOOLS || ROOT;
const RESPONSIVE_WIDTHS = [320, 375, 768, 1024, 1280, 1536];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--label'
  && args[i - 1] !== '--out');

// Playwright honours NODE_PATH through require(); the image tools come from TOOLS.
const requireHere = createRequire(import.meta.url);
const requireTools = createRequire(path.join(TOOLS, 'package.json'));
const { chromium } = requireHere('playwright');
const { PNG } = requireTools('pngjs');
const pixelmatchMod = requireTools('pixelmatch');
const pixelmatch = pixelmatchMod.default || pixelmatchMod;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serve(root) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Turn the build template into a dev page: real CSS files + the dev Alpine boot. */
function writePreview() {
  const src = readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
  const html = src
    .replace('<!-- @inline-css -->', '<link rel="stylesheet" href="/src/styles/main.css">')
    .replace('<!-- @inline-js -->',
      '<script type="module" src="/tests/visual/preview-boot.mjs"></script>');
  const file = path.join(OUT, 'preview.html');
  writeFileSync(file, html);
  return '/tests/visual/out/preview.html';
}

function readPng(file) {
  return PNG.sync.read(readFileSync(file));
}

function blit(dst, src, ox, oy) {
  for (let y = 0; y < src.height; y++) {
    const s = y * src.width * 4;
    const d = ((oy + y) * dst.width + ox) * 4;
    src.data.copy(dst.data, d, s, s + src.width * 4);
  }
}

function crop(png, [x, y, w, h]) {
  const out = new PNG({ width: w, height: h });
  for (let yy = 0; yy < h; yy++) {
    const s = ((y + yy) * png.width + x) * 4;
    png.data.copy(out.data, yy * w * 4, s, s + w * 4);
  }
  return out;
}

function stackVertical(a, b, gap = 6) {
  const out = new PNG({ width: Math.max(a.width, b.width), height: a.height + b.height + gap });
  out.data.fill(255);
  blit(out, a, 0, 0);
  blit(out, b, 0, a.height + gap);
  return out;
}

const fmt = (b) => (b
  ? b.map((v) => String(Math.round(v)).padStart(4)).join(' ')
  : '   -    -    -    -');
const delta = (r, d) => (d ? r.map((v, i) => Math.round(d[i] - v)) : null);
const pad = (s, n) => String(s).padEnd(n);

/**
 * The real scene of --play. Returns a function that releases the held tone after the shot.
 * Everything drawn comes from the running AudioContext: no injected data.
 */
async function playScene(page, errors) {
  await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
  // A real click starts the AudioContext inside a user gesture.
  await page.click('#osc-source-title');
  // 1) the spectrogram history: V1 sweepUp defaults (20 Hz -> 20 kHz, 10 s, log)
  await page.click('#osc-source-pattern');
  await page.selectOption('#osc-pattern-select', 'sweepUp');
  await page.click('#osc-trigger');
  await page.waitForTimeout(10400);
  // 2) back to the oscillator: 15.5 kHz sine
  await page.click('#osc-source-osc');
  await page.click('#osc-wave-sine');
  await page.evaluate(() => {
    const a = window.OSCILLA.app;
    a.setFrequency(15500);
    a.tabs.analysis = 'waveform';
    a.alerts = [];
  });
  const box = await page.locator('#osc-hold-play').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1200);
  // park the pointer capture-free: the hold keeps sounding while the shot is taken
  const state = await page.evaluate(() => ({
    playing: window.OSCILLA.app.playing, f: window.OSCILLA.app.frequency,
    sr: window.OSCILLA.engine.sampleRate,
  }));
  if (!state.playing) errors.push(`--play: tone not playing (${JSON.stringify(state)})`);
  return async () => { await page.mouse.up(); };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const cfg = JSON.parse(readFileSync(REGIONS_FILE, 'utf8'));
  const refFile = path.resolve(path.dirname(REGIONS_FILE), cfg.reference);
  const ref = readPng(refFile);
  const { width: W, height: H } = cfg.viewport;

  let server = null;
  let url;
  const target = positional[0];
  if (!target) {
    server = await serve(ROOT);
    url = `http://127.0.0.1:${server.address().port}${writePreview()}`;
  } else if (target === 'dist') {
    url = pathToFileURL(path.join(ROOT, 'dist/index.html')).href;
  } else if (/^https?:/.test(target)) {
    url = target;
  } else {
    url = pathToFileURL(path.resolve(target)).href;
  }
  if (flag('--mock')) url += (url.includes('?') ? '&' : '?') + 'mock=1';

  const PLAY = flag('--play');
  const browser = await chromium.launch(PLAY
    ? { args: ['--autoplay-policy=no-user-gesture-required'] } : {});
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__oscReady || window.Alpine, null, { timeout: 5000 })
    .catch(() => errors.push('Alpine did not start within 5 s (static render compared)'));
  await page.evaluate(() => document.fonts && document.fonts.ready);
  // The reference shows a returning user: the first-run safety notice is dismissed (a real
  // click, as a user would; its collapsed state is then stored for the session).
  const safety = page.locator('[data-osc="safety.dismiss"]');
  if (await safety.isVisible().catch(() => false)) await safety.click();
  await page.waitForTimeout(400);
  let releaseHold = null;
  if (PLAY) releaseHold = await playScene(page, errors);

  const currentFile = path.join(OUT, 'current.png');
  await page.screenshot({ path: currentFile });
  if (releaseHold) await releaseHold();
  const cur = readPng(currentFile);

  // Full-frame diff (diffMask: only differing pixels are painted).
  const diff = new PNG({ width: W, height: H });
  pixelmatch(ref.data, cur.data, diff.data, W, H, {
    threshold: 0.12, includeAA: false, diffMask: true,
  });
  writeFileSync(path.join(OUT, 'diff.png'), PNG.sync.write(diff));

  const side = new PNG({ width: W * 3, height: H });
  blit(side, ref, 0, 0);
  blit(side, cur, W, 0);
  // Diff panel: current dimmed, differing pixels in red.
  const shown = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) {
    const on = diff.data[i * 4 + 3] > 0;
    shown.data[i * 4] = on ? 255 : cur.data[i * 4] * 0.35;
    shown.data[i * 4 + 1] = on ? 40 : cur.data[i * 4 + 1] * 0.35;
    shown.data[i * 4 + 2] = on ? 40 : cur.data[i * 4 + 2] * 0.35;
    shown.data[i * 4 + 3] = 255;
  }
  blit(side, shown, W * 2, 0);
  writeFileSync(path.join(OUT, 'side-by-side.png'), PNG.sync.write(side));

  const boxes = await page.evaluate((all) => {
    const out = {};
    for (const [name, r] of Object.entries(all)) {
      const el = r.selector && document.querySelector(r.selector);
      if (!el) { out[name] = null; continue; }
      const b = el.getBoundingClientRect();
      out[name] = [b.x, b.y, b.width, b.height];
    }
    return out;
  }, { ...cfg.regions, ...cfg.controls });

  // Renderer hosts hold live data the shell must not fake; a second mismatch figure excludes
  // them so chrome (panels, controls, type) can be judged on its own.
  const hostRects = await page.evaluate(() => [...document.querySelectorAll('[data-osc-chart]')]
    .map((el) => el.getBoundingClientRect())
    .filter((b) => b.width && b.height)
    .map((b) => [Math.floor(b.x), Math.floor(b.y), Math.ceil(b.right), Math.ceil(b.bottom)]));
  const inHost = new Uint8Array(W * H);
  for (const [x0, y0, x1, y1] of hostRects) {
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
      inHost.fill(1, y * W + Math.max(0, x0), y * W + Math.min(W, x1));
    }
  }

  const report = { url, regions: {}, controls: {}, total: 0, errors };
  let totalDiff = 0;
  for (let i = 0; i < W * H; i++) if (diff.data[i * 4 + 3] > 0) totalDiff++;
  report.total = +(100 * totalDiff / (W * H)).toFixed(2);
  let chromeDiff = 0;
  let chromeArea = 0;
  for (let i = 0; i < W * H; i++) {
    if (inHost[i]) continue;
    chromeArea++;
    if (diff.data[i * 4 + 3] > 0) chromeDiff++;
  }
  report.totalExclData = +(100 * chromeDiff / chromeArea).toFixed(2);

  const lines = [];
  lines.push(`${pad('region', 12)} ${pad('reference x    y    w    h', 26)}  `
    + `${pad('DOM x    y    w    h', 22)}  `
    + `${pad('delta x y w h', 18)} mismatch  excl.data`);
  for (const [name, r] of Object.entries(cfg.regions)) {
    const [x, y, w, h] = r.box;
    let n = 0;
    let nc = 0;
    let area = 0;
    for (let yy = y; yy < Math.min(H, y + h); yy++) {
      for (let xx = x; xx < Math.min(W, x + w); xx++) {
        const k = yy * W + xx;
        const on = diff.data[k * 4 + 3] > 0;
        if (on) n++;
        if (!inHost[k]) {
          area++;
          if (on) nc++;
        }
      }
    }
    const pct = +(100 * n / (w * h)).toFixed(2);
    const pctChrome = area ? +(100 * nc / area).toFixed(2) : 0;
    const d = delta(r.box, boxes[name]);
    const maxAbs = d ? Math.max(...d.map(Math.abs)) : null;
    report.regions[name] = {
      ref: r.box, dom: boxes[name], delta: d, maxAbsDelta: maxAbs, mismatch: pct,
      mismatchExclData: pctChrome,
    };
    lines.push(`${pad(name, 12)} ${fmt(r.box)}       ${fmt(boxes[name])}   `
      + `${pad(d ? d.join(' ') : '-', 18)} ${String(pct).padStart(6)} %  `
      + `${String(pctChrome).padStart(6)} %`
      + `${maxAbs > 4 ? '  <-- geometry' : ''}`);
    if (flag('--crops')) {
      mkdirSync(path.join(OUT, 'crops'), { recursive: true });
      writeFileSync(path.join(OUT, 'crops', `${name}.png`),
        PNG.sync.write(stackVertical(crop(ref, r.box), crop(cur, r.box))));
    }
  }
  lines.push('');
  lines.push(`${pad('control', 14)} ${pad('reference', 21)} ${pad('DOM', 21)} delta`);
  for (const [name, r] of Object.entries(cfg.controls)) {
    if (!r.selector) continue;
    const d = delta(r.box, boxes[name]);
    report.controls[name] = { ref: r.box, dom: boxes[name], delta: d };
    const maxAbs = d ? Math.max(...d.map(Math.abs)) : null;
    lines.push(`${pad(name, 14)} ${fmt(r.box)} ${fmt(boxes[name])} ${d ? d.join(' ') : 'missing'}`
      + `${maxAbs > 4 ? '  <--' : ''}`);
  }
  lines.push('');
  lines.push(`total mismatch: ${report.total} %   `
    + `excluding renderer hosts: ${report.totalExclData} %`
    + `   (${url})`);
  if (errors.length) lines.push(`page errors:\n  ${errors.join('\n  ')}`);

  if (flag('--responsive')) {
    report.responsive = {};
    lines.push('');
    lines.push('responsive: width  scrollWidth  overflow  offenders');
    for (const w of RESPONSIVE_WIDTHS) {
      for (const coarse of [false, true]) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: w < 768 ? 812 : 1024 },
          deviceScaleFactor: 1,
          hasTouch: coarse,
          isMobile: coarse && w < 1024,
        });
        const p = await ctx.newPage();
        await p.goto(url, { waitUntil: 'load' });
        await p.waitForFunction(() => window.__oscReady || window.Alpine, null, { timeout: 5000 })
          .catch(() => {});
        await p.waitForTimeout(100);
        const res = await p.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const sw = document.documentElement.scrollWidth;
          const offenders = [];
          for (const el of document.querySelectorAll('body *')) {
            const b = el.getBoundingClientRect();
            if (b.width && b.right > vw + 0.5 && el.offsetParent !== null) {
              const scroller = el.closest('.osc-nav, .osc-analysis-tabs, .osc-sr-only');
              if (!scroller) {
                offenders.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
              }
            }
          }
          const coarseMq = matchMedia('(pointer: coarse)').matches;
          const small = [];
          if (coarseMq) {
            const sel = 'button, a[href], select, input:not([type=hidden]), '
              + '[role=tab], [role=radio]';
            for (const el of document.querySelectorAll(sel)) {
              const b = el.getBoundingClientRect();
              const skip = el.closest('.osc-skip, [tabindex="-1"]');
              if (!b.width || el.offsetParent === null || skip) continue;
              if (el.closest('.osc-stepper-keys')) continue;
              if (b.height < 43.5 || (b.width < 43.5 && el.type !== 'range')) {
                const name = el.id || el.className.toString().split(' ')[0];
                small.push(`${name} ${Math.round(b.width)}x${Math.round(b.height)}`);
              }
            }
          }
          return {
            vw, sw, offenders: offenders.slice(0, 8), coarse: coarseMq,
            small: small.slice(0, 12), smallCount: small.length,
          };
        });
        if (!coarse) {
          await p.screenshot({ path: path.join(OUT, `responsive-${w}.png`), fullPage: true });
        }
        report.responsive[`${w}${coarse ? '-coarse' : ''}`] = res;
        lines.push(`  ${String(w).padStart(5)}${coarse ? ' coarse' : '       '} `
          + `${String(res.sw).padStart(8)}  `
          + `${res.sw > res.vw ? 'OVERFLOW' : 'ok      '}  ${res.offenders.join(', ')}`
          + `${res.coarse ? `  small targets: ${res.smallCount} ${res.small.join(', ')}` : ''}`);
        await ctx.close();
      }
    }
  }

  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const label = option('--label');
  if (label) writeFileSync(path.join(OUT, `report-${label}.json`), JSON.stringify(report, null, 2));
  console.log(lines.join('\n'));
  await browser.close();
  if (server) server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

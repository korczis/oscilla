#!/usr/bin/env node
// OSCILLA Synth XY tab (plan K097) on the built dist/index.html in chromium, firefox and webkit,
// at 1536 x 1024 and 390 x 844 (touch). Every sound check reads the engine's analyser after the
// safety chain or the runtime's own pad handle, never the DOM alone.
//
//   node tests/browser/xy-pad.cjs [--browsers chromium,firefox,webkit] [--origins file,http]
//        [--only x-link,x-pointer]
//
// Checks (desktop; the phone leg runs x-touch):
//   x-link     linked: #m=synth&yt=xy opens the XY tab; the XY lead preset chosen in the preset
//              menu is one undo entry that sets the pad's scale on its face (C, minor
//              pentatonic) and patches Pitch and Gate into the voice and Y into LPF Cutoff;
//              Open in Studio draws the pad's node and each of its edges in the Studio graph
//   x-pointer  real-time: a pointer held on the pad's first step sounds C3 (130.8 Hz) and the
//              runtime pad pitch is -1.75 oct; moved to the seventh step it sounds Eb4
//              (311.1 Hz); Y from the bottom to the top raises the 4-9 kHz band 6 dB+ against
//              the fundamental (the LPF opens); the release is silent (below -70 dB rel)
//   x-keys     interactive: arrows move the cursor (aria-valuenow, aria-valuetext of both
//              sliders), Enter held sounds and its release silences; a held Enter is released
//              by Escape, by blur and by page hide; the surface is role=application described
//              by its axes inside a role=group with two sliders
//   x-touch    (390 px, touch, chromium) one touch sounds; a second touch point moves Y only
//              (X's aria-valuenow unchanged); lifting both silences; no horizontal page scroll
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { serveDist } = require('./lib/serve.cjs');
const { until, bounded } = require('./lib/wait.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist', 'index.html');
const RUN = suite.open({ name: 'xy-pad', browsers: arg('browsers'), origins: arg('origins'),
  defaultOrigins: ['file'] });
const playwright = RUN.playwright;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};
const SIZES = { desktop: { width: 1536, height: 1024 }, phone: { width: 390, height: 844 } };
const PHONE_CHECKS = new Set(['x-touch']);
const LOAD_MS = 60000;
const SOUND_MS = 8000; // an attack, a glide and the analyser's smoothing
const CHECK_MS = 120000;
const C3 = 130.8128;
const EB4 = 311.127;
const STEPS = 11; // C minor pentatonic over two octaves, the top C closing

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
function levelAt(p, hz) {
  const b = binOf(p, hz);
  return Math.max(...[b - 1, b, b + 1].filter((i) => i > 0 && i < p.db.length).map((i) => p.db[i]));
}
/** A peak at hz: within one bin, 6 dB above the bins three to five away on both sides. */
function peakAt(p, hz) {
  const b = binOf(p, hz);
  const side = Math.max(...[b - 5, b - 4, b - 3, b + 3, b + 4, b + 5]
    .filter((i) => i > 0 && i < p.db.length).map((i) => p.db[i]));
  return levelAt(p, hz) > -90 && levelAt(p, hz) - side >= 6;
}
function bandDb(p, lo, hi) {
  let s = 0;
  for (let i = binOf(p, lo); i <= Math.min(p.db.length - 1, binOf(p, hi)); i++) {
    s += 10 ** (p.db[i] / 10);
  }
  return 10 * Math.log10(s + 1e-30);
}
const read = (page) => page.evaluate(probe);
async function sound(page, pred, what, ms = SOUND_MS) {
  let last = null;
  await until(async () => {
    last = await read(page);
    return pred(last);
  }, { ms, what });
  return last;
}
const silent = (page, what) => sound(page, (p) => p.rmsDb < -70, what);
const loud = (page, what) => sound(page, (p) => p.rmsDb > -45, what);

/** The pad node, its edges and the runtime pitch of its handle (null when not running). */
const padState = (page) => page.evaluate(() => {
  const st = window.OSCILLA.studio;
  const pad = st.model.graph.nodes.find((n) => n.type === 'xy-pad');
  const h = pad && st.runtime && st.runtime.nodes.get(pad.id);
  return { id: pad ? pad.id : null, params: pad ? pad.params : null,
    edges: pad ? st.model.graph.edges.filter((e) => e.from.node === pad.id)
      .map((e) => ({ id: e.id, port: e.from.port, to: e.to })) : [],
    pitch: h && h.outputs && h.outputs.pitch ? h.outputs.pitch.offset.value : null };
});
const aria = (page, sel, name) => page.locator(sel).getAttribute(name);

async function openXy(context, base, { preset = 'xy-lead' } = {}) {
  const page = await context.newPage();
  await page.goto(`${base}#m=synth&yt=xy`);
  await until(() => page.evaluate(() => !!(window.OSCILLA && window.OSCILLA.app
    && window.OSCILLA.app.synthDebug && window.OSCILLA.app.synthDebug().present
    && window.OSCILLA.app.synthDebug().tab === 'xy'
    && document.querySelector('[data-osc="synth.xy"]'))),
  { ms: LOAD_MS, what: 'the XY tab is rendered' });
  if (preset) {
    await page.locator('#osc-synth-preset').selectOption(preset);
    await until(() => page.evaluate(() => {
      const s = document.querySelector('[data-xy-surface]');
      return !!s && s.getAttribute('aria-disabled') === 'false';
    }), { ms: 10000, what: 'the XY preset patches the pad into the voice' });
  }
  return page;
}

/** Client coordinates of a pad point: step `i` of STEPS along X, `fy` (0 bottom) along Y. */
async function padPoint(page, i, fy) {
  // The docked keyboard covers the bottom of the view: the pad is scrolled to the top first.
  await page.evaluate(() => {
    const el = document.querySelector('[data-xy-surface]');
    el.scrollIntoView({ block: 'start' });
    let sc = el.parentElement; // then clear of a sticky chip bar above it
    while (sc && sc !== document.body && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) {
      sc = sc.parentElement;
    }
    (sc && sc !== document.body ? sc : window).scrollBy(0, -80);
  });
  const b = await page.locator('[data-xy-surface]').boundingBox();
  const p = { x: b.x + ((i + 0.5) / STEPS) * b.width, y: b.y + (1 - fy) * b.height };
  const hit = await page.evaluate((q) => !!document.elementFromPoint(q.x, q.y)
    .closest('[data-xy-surface]'), p);
  if (!hit) throw new Error(`the pad point ${i}, ${fy} is covered`);
  return p;
}

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });

  def('x-link', async ({ page }) => {
    const tab = await aria(page, '#osc-synth-tab-xy', 'aria-selected');
    const rev = await page.evaluate(() => window.OSCILLA.studio.store.getRevision());
    const s = await padState(page);
    const face = await page.evaluate(() => [...document.querySelectorAll(
      '[data-option^="xy."][aria-checked="true"]')].map((e) => e.dataset.option + ':' + e.dataset.v));
    const ports = s.edges.map((e) => `${e.port}>${e.to.port}`).sort();
    const want = ['gate>gate', 'gate>gate', 'pitch>pitch', 'pitch>pitch', 'y>frequency'];
    if (tab !== 'true' || JSON.stringify(ports) !== JSON.stringify(want)
      || s.params.mode !== 'minor-pentatonic' || s.params.key !== 'C'
      || !face.includes('xy.mode:minor-pentatonic') || !face.includes('xy.key:C')) {
      return { ok: false, detail: 'the preset did not set the scale and the cables', tab, ports,
        params: s.params, face };
    }
    await page.evaluate(() => window.OSCILLA.studio.store.undo());
    const undone = await padState(page);
    if (undone.edges.length) return { ok: false, detail: 'one undo leaves pad cables', undone };
    await page.evaluate(() => window.OSCILLA.studio.store.redo());
    await page.locator('[data-osc="synth.studio"]').click();
    await until(() => page.evaluate((ids) => window.OSCILLA.app.workspace === 'studio'
      && ids.every((id) => document.querySelector(`[data-node-id="${id}"]`)
        || document.querySelector(`[data-edge-id="${id}"]`)),
    [s.id, ...s.edges.map((e) => e.id)]), { ms: 10000,
      what: 'the Studio graph draws the pad node and its edges' });
    return { ok: true, rev, ports, face };
  });

  def('x-pointer', async ({ page }) => {
    let p = await padPoint(page, 0, 0.05);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    const low = await sound(page, (q) => peakAt(q, C3), 'the first step sounds C3');
    await until(async () => Math.abs((await padState(page)).pitch - (48 - 69) / 12) < 1e-3,
      { ms: SOUND_MS, what: 'the runtime pad pitch is C3, -1.75 oct from A4' });
    const yLow = await sound(page, (q) => peakAt(q, C3), 'C3 with Y at the bottom');
    p = await padPoint(page, 6, 0.05);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await sound(page, (q) => peakAt(q, EB4), 'the seventh step sounds Eb4');
    const base = await sound(page, (q) => peakAt(q, EB4), 'Eb4 with Y at the bottom');
    const rel = (q) => bandDb(q, 4000, 9000) - levelAt(q, EB4);
    p = await padPoint(page, 6, 0.95);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    const top = await sound(page, (q) => peakAt(q, EB4) && rel(q) - rel(base) >= 6,
      'Y at the top opens the LPF: the 4-9 kHz band 6 dB up');
    await page.mouse.up();
    await silent(page, 'the release is silent');
    return { ok: true, low: low.rmsDb, yLow: yLow.rmsDb,
      openedDb: Number((rel(top) - rel(base)).toFixed(1)) };
  });

  def('x-keys', async ({ page }) => {
    const surface = page.locator('[data-xy-surface]');
    const role = await surface.getAttribute('role');
    const desc = await page.evaluate(() => {
      const s = document.querySelector('[data-xy-surface]');
      const d = document.getElementById(s.getAttribute('aria-describedby').split(' ')[0]);
      return { text: d ? d.textContent : '', group: s.parentElement.getAttribute('role'),
        sliders: [...s.parentElement.querySelectorAll('[role="slider"]')].map((x) => [
          x.getAttribute('aria-valuenow'), x.getAttribute('aria-valuetext')]) };
    });
    if (role !== 'application' || desc.group !== 'group' || desc.sliders.length !== 2
      || !/X is the pitch/.test(desc.text) || !/Y drives/.test(desc.text)) {
      return { ok: false, detail: 'the surface is not described by its axes', role, desc };
    }
    await surface.focus();
    const x0 = Number(await aria(page, '[data-xy-axis="x"]', 'aria-valuenow'));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    const x1 = Number(await aria(page, '[data-xy-axis="x"]', 'aria-valuenow'));
    const y1 = await aria(page, '[data-xy-axis="y"]', 'aria-valuetext');
    if (x1 !== x0 + 1 || !/% to LPF Cutoff/.test(y1)) {
      return { ok: false, detail: 'the arrows did not move the cursor', x0, x1, y1 };
    }
    const held = async (what) => {
      await surface.focus();
      await page.keyboard.down('Enter');
      await loud(page, `Enter held sounds (${what})`);
    };
    await held('release');
    await page.keyboard.up('Enter');
    await silent(page, 'releasing Enter silences');
    await held('Escape');
    await page.keyboard.press('Escape');
    await silent(page, 'Escape releases the held pad');
    await page.keyboard.up('Enter');
    await held('blur');
    await page.locator('#osc-synth-preset').focus();
    await silent(page, 'blur releases the held pad');
    await page.keyboard.up('Enter');
    await held('hide');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await silent(page, 'page hide releases the held pad');
    await page.keyboard.up('Enter');
    return { ok: true, x0, x1, y1 };
  });

  def('x-touch', async ({ page, browserName }) => {
    if (browserName !== 'chromium') {
      RUN.skip(`${browserName}/phone`, 'x-touch', 'two touch points need the CDP touch input');
      return { ok: true, skipped: true };
    }
    const cdp = await page.context().newCDPSession(page);
    const a = await padPoint(page, 3, 0.2);
    const b = await padPoint(page, 9, 0.8);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type,
      touchPoints: points.map((q, i) => ({ x: q.x, y: q.y, id: i + 1 })) });
    await touch('touchStart', [a]);
    await loud(page, 'one touch sounds');
    const x0 = await aria(page, '[data-xy-axis="x"]', 'aria-valuenow');
    const y0 = await aria(page, '[data-xy-axis="y"]', 'aria-valuenow');
    await touch('touchStart', [a, b]);
    await touch('touchMove', [a, { x: b.x, y: b.y - 20 }]);
    await until(async () => (await aria(page, '[data-xy-axis="y"]', 'aria-valuenow')) !== y0,
      { ms: 5000, what: 'the second touch point moves Y' });
    const x1 = await aria(page, '[data-xy-axis="x"]', 'aria-valuenow');
    if (x1 !== x0) return { ok: false, detail: 'the second touch moved X', x0, x1 };
    await touch('touchEnd', []);
    await silent(page, 'lifting both touches silences');
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth
      - document.documentElement.clientWidth);
    return { ok: scroll <= 1, x0, x1, scroll };
  });
  return checks;
}

// ------------------------------------------------------------------------------ runner
const runsAt = (name, sizeName) => (!ONLY || ONLY.has(name))
  && (sizeName === 'phone' ? PHONE_CHECKS.has(name) : !PHONE_CHECKS.has(name));

async function runLeg(browserName, sizeName, base) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const results = {};
  try {
    for (const { name, fn } of defineChecks()) {
      if (!runsAt(name, sizeName)) continue;
      const context = await browser.newContext({ viewport: SIZES[sizeName],
        hasTouch: sizeName === 'phone' });
      const errors = [];
      context.on('page', (pg) => pg.on('pageerror', (e) => errors.push(String(e))));
      const t0 = Date.now();
      try {
        const page = await openXy(context, base);
        const v = await bounded(fn({ page, context, base, browserName }),
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
    ? await serveDist(DIST, { prefix: 'oscilla-xy-pad-' }) : null;
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
          console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/xy-pad: ${names.length
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

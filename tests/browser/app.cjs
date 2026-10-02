#!/usr/bin/env node
// OSCILLA dist release gate: the built dist/index.html in chromium, firefox and webkit, each
// from file:// AND from a GitHub-Pages-like sub-path (http://127.0.0.1:<port>/oscilla/ served by
// python3 -m http.server).
//
//   node tests/browser/app.cjs [--dist dist/index.html] [--browsers chromium,firefox,webkit]
//                              [--origins file,http] [--only name1,name2] [--json out.json]
//
// Playwright resolves from app/node_modules or NODE_PATH (e.g. /Users/korczis/dev/oscilla/tests/
// node_modules). Exit code 1 when any check fails.
'use strict';
const { spawn } = require('node:child_process');
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
const DIST = path.resolve(arg('dist', path.join(__dirname, '..', '..', 'dist', 'index.html')));
const BROWSERS = arg('browsers', 'chromium,firefox,webkit').split(',');
const ORIGINS = arg('origins', 'file,http').split(',');
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const JSON_OUT = arg('json', '');
const WIDTHS = [320, 375, 768, 1024, 1280, 1536];

const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } },
  webkit: {},
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------ server
function startServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-gate-'));
  fs.mkdirSync(path.join(root, 'oscilla'));
  fs.copyFileSync(DIST, path.join(root, 'oscilla', 'index.html'));
  const port = 8900 + Math.floor(Math.random() * 300);
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1',
    '--directory', root], { stdio: 'ignore' });
  return { proc, root, url: `http://127.0.0.1:${port}/oscilla/` };
}

async function waitForServer(url) {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not yet */ }
    await sleep(100);
  }
  throw new Error(`server did not start: ${url}`);
}

// ------------------------------------------------------------------------------ WAV parsing
function parseWavHeader(buf) {
  const s = (o, n) => buf.toString('ascii', o, o + n);
  if (s(0, 4) !== 'RIFF' || s(8, 4) !== 'WAVE') return { ok: false, why: 'no RIFF/WAVE' };
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = s(off, 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(off + 8), channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    } else if (id === 'data') {
      data = { offset: off + 8, size };
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) return { ok: false, why: 'missing fmt or data chunk' };
  let peak = 0;
  if (fmt.format === 1 && fmt.bits === 16) {
    for (let i = data.offset; i + 1 < data.offset + data.size && i + 1 < buf.length; i += 2) {
      peak = Math.max(peak, Math.abs(buf.readInt16LE(i)) / 32768);
    }
  }
  const frames = data.size / (fmt.channels * (fmt.bits / 8));
  return { ok: true, ...fmt, frames, seconds: frames / fmt.sampleRate, peak,
    riffSize: buf.readUInt32LE(4), fileSize: buf.length };
}

// ------------------------------------------------------------------------------ page helpers
const H = {
  ready: (page) => page.waitForSelector('html[data-ready="true"]', { timeout: 15000 }),
  app: (page, fn, arg) => page.evaluate(fn, arg),
  peak: (page) => page.evaluate(() => {
    const e = window.OSCILLA.engine;
    if (!e.analyser) return 0;
    const d = new Float32Array(e.analyser.fftSize);
    e.analyser.getFloatTimeDomainData(d);
    let pk = 0;
    for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
    return pk;
  }),
  peakHz: (page) => page.evaluate(() => {
    const e = window.OSCILLA.engine;
    const f = new Float32Array(e.analyser.frequencyBinCount);
    e.analyser.getFloatFrequencyData(f);
    let k = 1;
    for (let i = 2; i < f.length; i++) if (f[i] > f[k]) k = i;
    return { hz: (k * e.ctx.sampleRate) / e.analyser.fftSize, db: f[k] };
  }),
  nodes: (page) => page.evaluate(() => window.OSCILLA.engine.activeNodeCount),
  waitNodes0: async (page, ms = 1500) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await H.nodes(page) === 0) return true;
      await sleep(50);
    }
    return false;
  },
  stopAll: (page) => page.evaluate(() => {
    const a = window.OSCILLA.app;
    a.stopNow();
    a.alerts = []; // notifications would cover controls of the next check
    const seq = window.OSCILLA.labs.sequencer;
    if (seq && seq.editor.playing) seq.editor.stop();
  }),
  // Multi-step checks hold longer than the 2 s hard limit on slow engines: allow continuous
  // playback for their duration (the limit itself is covered by the unit freeze vectors).
  continuous: (page, on) => page.evaluate((v) => window.OSCILLA.app.setContinuous(v), on),
  spaceDown: async (page) => {
    await H.focusBody(page);
    await page.keyboard.down(' ');
  },
  focusBody: (page) => page.evaluate(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.body.focus();
  }),
  workspace: async (page, ws) => {
    await page.click(`[data-osc="nav.${ws}"]`);
    await page.waitForFunction((w) => document.querySelector('#osc-app').dataset.mode === w, ws);
    await sleep(150);
  },
};

/** Accessible-name + reachability audit of every interactive [data-osc] element, in-page. */
function auditControls() {
  const INTERACTIVE = 'button, input, select, textarea, a[href], [role="switch"], [role="tab"],'
    + ' [role="radio"], [role="menuitem"], [role="listbox"], [tabindex]:not([tabindex="-1"])';
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const name = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => text(document.getElementById(id))).join(' ').trim();
      if (t) return t;
    }
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab && text(lab)) return text(lab);
    }
    const wrap = el.closest('label');
    if (wrap && text(wrap)) return text(wrap);
    if (['BUTTON', 'A'].includes(el.tagName) || el.getAttribute('role')) {
      if (text(el)) return text(el);
    }
    if (el.title) return el.title;
    return '';
  };
  const visible = (el) => {
    if (el.closest('[hidden]') || el.closest('dialog:not([open])')) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const reachable = (el) => {
    if (el.tabIndex >= 0) return true;
    const role = el.getAttribute('role');
    if (role === 'radio' || role === 'tab') {
      return [...el.parentElement.children].some((s) => s.getAttribute('role') === role
        && s.tabIndex >= 0);
    }
    if (el.closest('.osc-stepper-keys')) return true; // pointer helpers of a focusable input
    return false;
  };
  const out = [];
  document.querySelectorAll('[data-osc]').forEach((el) => {
    if (!el.matches(INTERACTIVE)) return;
    if (el.id === 'osc-import-file') return; // opened by the Import menu items
    out.push({
      osc: el.dataset.osc, id: el.id || '', name: name(el), visible: visible(el),
      reachable: reachable(el), disabled: !!el.disabled,
    });
  });
  return out;
}

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });

  def('boot-no-console-errors', async ({ page, errors }) => {
    await sleep(800);
    const info = await page.evaluate(() => ({
      labs: Object.keys(window.OSCILLA.labs), labErrors: window.OSCILLA.labErrors,
      version: window.OSCILLA.version, host: !!window.OSCILLA.host,
    }));
    const ok = errors.length === 0 && Object.keys(info.labErrors).length === 0 && info.host
      && info.version === '2.0.0';
    return { ok, errors: errors.slice(0, 5), ...info };
  });

  def('controls-reachable-labelled', async ({ page }) => {
    const seen = new Map();
    const collect = async () => {
      for (const c of await page.evaluate(auditControls)) {
        const key = c.osc; // one entry per control kind; visible if any instance is
        const prev = seen.get(key);
        seen.set(key, { ...c, visible: c.visible || (prev && prev.visible) });
      }
    };
    await collect();
    await page.click('#osc-source-pattern');
    await collect();
    await page.click('#osc-source-osc');
    for (const menu of ['#osc-overflow', '#osc-export', '#osc-seq-add']) {
      await page.click(menu);
      await collect();
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => { window.OSCILLA.app.explore = true; });
    await sleep(80);
    await collect();
    await page.evaluate(() => { window.OSCILLA.app.explore = false; });
    await page.click('#osc-ptab-stereo');
    await collect();
    await page.click('#osc-ptab-phase');
    await page.click('#osc-mtab-compare');
    await collect();
    await page.click('#osc-mtab-live');
    await page.click('#osc-ftype-peaking');
    await collect();
    await page.click('#osc-ftype-lowpass');
    for (const id of ['saveModal', 'headphonesModal', 'copyModal', 'settings', 'help', 'about',
      'osc-dlg-mic']) {
      await page.evaluate((d) => window.OSCILLA.app.openModal(d), id);
      await sleep(120);
      await collect();
      await page.evaluate((d) => window.OSCILLA.app.closeModal(d), id);
    }
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.customPresets = [{ version: 1, id: 'gate', name: 'gate', created: 0,
        cfg: a.serializeConfig() }];
    });
    for (const ws of ['synthesis', 'learn', 'presets']) {
      await H.workspace(page, ws);
      await collect();
    }
    await page.evaluate(() => { window.OSCILLA.app.presetTab = 'custom'; });
    await sleep(80);
    await collect();
    await page.evaluate(() => { window.OSCILLA.app.presetTab = 'history'; });
    await sleep(80);
    await collect();
    await page.evaluate(() => { window.OSCILLA.app.customPresets = []; window.OSCILLA.app.presetTab = 'reference'; });
    await H.workspace(page, 'playground');
    await page.setViewportSize({ width: 375, height: 800 });
    await sleep(200);
    await page.click('#osc-sb-actions-toggle');
    await collect();
    await page.click('#osc-sb-actions-toggle');
    await page.setViewportSize({ width: 1536, height: 1024 });
    await sleep(200);
    const list = [...seen.values()];
    const unlabelled = list.filter((c) => !c.name).map((c) => c.osc + (c.id ? `#${c.id}` : ''));
    const unreachable = list.filter((c) => !c.reachable).map((c) => c.osc);
    const neverVisible = list.filter((c) => !c.visible).map((c) => c.osc);
    return { ok: !unlabelled.length && !unreachable.length && !neverVisible.length,
      controls: list.length, unlabelled, unreachable, neverVisible };
  });

  def('hold-plays-release-zero-nodes', async ({ page }) => {
    const hold = await page.locator('#osc-hold-play').boundingBox();
    await page.mouse.move(hold.x + hold.width / 2, hold.y + hold.height / 2);
    await page.mouse.down();
    await sleep(500);
    const gain = await page.evaluate(() => window.OSCILLA.app.gainLevel);
    const peak = await H.peak(page);
    const nodes = await H.nodes(page);
    const status = await page.evaluate(() => ({
      label: document.querySelector('[data-osc="status.label"]').textContent,
      green: document.querySelector('#osc-status').classList.contains('is-playing'),
      dot: getComputedStyle(document.querySelector('.osc-status-dot')).backgroundColor,
    }));
    await page.mouse.up();
    const zero = await H.waitNodes0(page);
    const ok = Math.abs(peak - gain) < 0.01 && nodes > 0 && zero && status.label === 'PLAYING'
      && status.green;
    return { ok, gain, peak: +peak.toFixed(4), nodesWhilePlaying: nodes, zeroAfter: zero, status };
  });

  def('waveform-change-while-playing', async ({ page }) => {
    await H.continuous(page, true);
    await H.focusBody(page);
    await page.keyboard.down(' ');
    await sleep(300);
    const before = await page.evaluate(() => window.OSCILLA.engine.voice?.carrier?.type);
    await page.click('#osc-wave-square');
    await sleep(250);
    const after = await page.evaluate(() => ({
      type: window.OSCILLA.engine.voice?.carrier?.type,
      playing: window.OSCILLA.app.playing,
      app: window.OSCILLA.app.waveform,
    }));
    // a square wave's crest factor is ~1 (peak ≈ RMS); a sine's is √2
    const crest = await page.evaluate(() => {
      const e = window.OSCILLA.engine;
      const d = new Float32Array(e.analyser.fftSize);
      e.analyser.getFloatTimeDomainData(d);
      let pk = 0; let s = 0;
      for (const v of d) { pk = Math.max(pk, Math.abs(v)); s += v * v; }
      return pk / Math.sqrt(s / d.length);
    });
    await page.keyboard.up(' ');
    const zero = await H.waitNodes0(page);
    await page.click('#osc-wave-sine');
    const ok = before === 'sine' && after.type === 'square' && after.playing && crest < 1.25 && zero;
    return { ok, before, after, crest: +crest.toFixed(3), zeroAfter: zero };
  });

  def('frequency-slider-and-fine-steps', async ({ page }) => {
    await H.continuous(page, true);
    await H.focusBody(page);
    await page.keyboard.down(' ');
    await sleep(200);
    await page.locator('#osc-freq-slider').fill('700');
    await sleep(250);
    const s1 = await page.evaluate(() => ({ app: window.OSCILLA.app.frequency,
      eng: window.OSCILLA.engine.voice?.carrier?.frequency.value }));
    await page.click('#osc-step-oct-up');
    await sleep(250);
    const s2 = await page.evaluate(() => ({ app: window.OSCILLA.app.frequency,
      eng: window.OSCILLA.engine.voice?.carrier?.frequency.value }));
    await page.click('#osc-step-10-down');
    await page.click('#osc-step-st-up');
    await sleep(250);
    const s3 = await page.evaluate(() => ({ app: window.OSCILLA.app.frequency,
      eng: window.OSCILLA.engine.voice?.carrier?.frequency.value,
      readout: document.querySelector('#osc-freq-value').textContent }));
    const fft = await H.peakHz(page);
    await page.keyboard.up(' ');
    await H.waitNodes0(page);
    const expect3 = (s2.app - 10) * 2 ** (1 / 12);
    const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
    const ok = s1.app !== 440 && near(s1.eng, s1.app, 0.01) && near(s2.app, Math.min(
      s1.app * 2, 20000), 0.01) && near(s2.eng, s2.app, 0.01) && near(s3.app, expect3, 0.01)
      && near(s3.eng, s3.app, 0.01) && near(fft.hz, s3.app, 0.02);
    await page.evaluate(() => window.OSCILLA.app.setFrequency(440));
    return { ok, slider: s1, octUp: s2, steps: s3, expected: +expect3.toFixed(2), fftPeakHz: fft.hz };
  });

  def('pattern-select-plays-sweep', async ({ page }) => {
    await page.click('#osc-source-pattern');
    await page.selectOption('#osc-pattern-select', 'sweepUp');
    await sleep(100);
    const fields = await page.$$eval('[data-osc="pattern.param"]', (els) => els.map((e) => e.dataset.key));
    // shorten: 200 Hz -> 4 kHz over 2 s
    await page.fill('[data-osc="pattern.param"][data-key="start"]', '200');
    await page.press('[data-osc="pattern.param"][data-key="start"]', 'Enter');
    await page.fill('[data-osc="pattern.param"][data-key="end"]', '4000');
    await page.press('[data-osc="pattern.param"][data-key="end"]', 'Enter');
    await page.fill('[data-osc="pattern.param"][data-key="durationMs"]', '2000');
    await page.press('[data-osc="pattern.param"][data-key="durationMs"]', 'Enter');
    await page.click('#osc-trigger');
    await sleep(500);
    const a = await page.evaluate(() => window.OSCILLA.engine.instantaneousFrequency());
    const fa = await H.peakHz(page);
    await sleep(700);
    const b = await page.evaluate(() => window.OSCILLA.engine.instantaneousFrequency());
    const fb = await H.peakHz(page);
    const status = await page.evaluate(() => window.OSCILLA.app.statusPatternText);
    await page.keyboard.press('Escape');
    const zero = await H.waitNodes0(page);
    const ok = fields.includes('start') && a > 200 && b > a * 1.3 && fb.hz > fa.hz && zero
      && /Sweep up/.test(status);
    await page.selectOption('#osc-pattern-select', 'tone');
    await page.click('#osc-source-osc');
    return { ok, fields, instA: a && +a.toFixed(1), instB: b && +b.toFixed(1), fftA: fa.hz,
      fftB: fb.hz, status, zeroAfter: zero };
  });

  def('presets-save-load', async ({ page }) => {
    await page.evaluate(() => window.OSCILLA.app.setFrequency(1234));
    await page.click('#osc-wave-triangle');
    await page.click('#osc-act-save-preset');
    await page.waitForSelector('#osc-dlg-save[open]');
    await page.fill('#osc-save-name', 'Gate preset');
    await page.click('[data-osc="save.confirm"]');
    await sleep(150);
    const stored = await page.evaluate(() => {
      try {
        const raw = JSON.parse(localStorage.getItem('oscilla.presets') || '{}');
        return (Array.isArray(raw) ? raw : raw.presets || []).map((p) => p.name);
      }
      catch (e) { return ['<unreadable>']; }
    });
    await page.evaluate(() => window.OSCILLA.app.setFrequency(500));
    await page.click('#osc-wave-sine');
    await H.workspace(page, 'presets');
    await page.click('[data-osc="presets.tab"][data-value="custom"]');
    const item = page.locator('[data-osc="presets.item"]', { hasText: 'Gate preset' }).first();
    await item.locator('[data-osc="presets.load"]').click();
    await sleep(150);
    const after = await page.evaluate(() => ({ f: window.OSCILLA.app.frequency,
      w: window.OSCILLA.app.waveform }));
    // delete it again (two taps)
    await item.locator('[data-osc="presets.delete"]').click();
    await item.locator('[data-osc="presets.delete"]').click();
    const left = await page.evaluate(() => window.OSCILLA.app.customPresets.length);
    await H.workspace(page, 'playground');
    await page.click('#osc-wave-sine');
    await page.evaluate(() => window.OSCILLA.app.setFrequency(440));
    const ok = stored.includes('Gate preset') && Math.abs(after.f - 1234) < 0.01
      && after.w === 'triangle' && left === 0;
    return { ok, stored, after, leftAfterDelete: left };
  });

  def('url-copy-round-trip', async ({ page, context, baseUrl }) => {
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.setFrequency(2345);
      a.setWaveform('sawtooth');
    });
    await page.click('#osc-act-url');
    await sleep(300);
    const url = await page.evaluate(() => window.OSCILLA.app.copyUrl);
    await page.keyboard.press('Escape');
    const p2 = await context.newPage();
    const errs = [];
    p2.on('pageerror', (e) => errs.push(e.message));
    await p2.goto(url);
    await H.ready(p2);
    const restored = await p2.evaluate(() => ({ f: window.OSCILLA.app.frequency,
      w: window.OSCILLA.app.waveform, playing: window.OSCILLA.app.playing }));
    await p2.close();
    await page.evaluate(() => { window.OSCILLA.app.setFrequency(440); window.OSCILLA.app.setWaveform('sine'); });
    const ok = url.startsWith(baseUrl.split('#')[0]) && /#v=1&/.test(url)
      && Math.abs(restored.f - 2345) < 0.01 && restored.w === 'sawtooth' && !restored.playing
      && !errs.length;
    return { ok, url: url.slice(0, 140), restored, errs };
  });

  def('config-export-import-round-trip', async ({ page }) => {
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.setFrequency(3210);
      a.setWaveform('square');
      a.dual.a.freq = 300;
    });
    await page.click('#osc-ftype-highpass');
    await page.click('#osc-filter-enable');
    await page.click('#osc-export');
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      page.click('[data-osc="export.config"]'),
    ]);
    const file = await dl.path();
    const text = fs.readFileSync(file, 'utf8');
    const doc = JSON.parse(text);
    // change everything, then import the file through the real file input
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.setFrequency(777);
      a.setWaveform('sine');
      a.dual.a.freq = 999;
    });
    await page.click('#osc-ftype-lowpass');
    await page.click('#osc-filter-enable');
    await page.setInputFiles('#osc-import-file', { name: 'cfg.json', mimeType: 'application/json',
      buffer: Buffer.from(text) });
    await sleep(400);
    const after = await page.evaluate(() => ({
      f: window.OSCILLA.app.frequency, w: window.OSCILLA.app.waveform,
      dualA: window.OSCILLA.app.dual.a.freq, filter: window.OSCILLA.labs.filter.config,
    }));
    const bad = await page.evaluate(() => window.OSCILLA.app.importConfigText('{"version":99}'));
    const keys = ['version', 'oscillaVersion', 'sampleRateRequested', 'mode', 'source', 'waveform',
      'frequency', 'gain', 'envelope', 'filter', 'pattern', 'sequencer', 'dualOsc', 'metadata'];
    const missing = keys.filter((k) => !(k in doc));
    // reset
    await page.evaluate(() => { window.OSCILLA.app.setFrequency(440); window.OSCILLA.app.setWaveform('sine'); });
    await page.click('#osc-ftype-lowpass');
    if (after.filter.enabled) await page.click('#osc-filter-enable');
    const ok = !missing.length && doc.version === 1 && Math.abs(after.f - 3210) < 0.01
      && after.w === 'square' && Math.abs(after.dualA - 300) < 0.01
      && after.filter.type === 'highpass' && after.filter.enabled === true && bad === false;
    return { ok, missing, file: path.basename(dl.suggestedFilename()), after, rejectsBadVersion: !bad };
  });

  def('wav-export-valid', async ({ page }) => {
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.setFrequency(1000);
      a.setEnv('duration', '400');
    });
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('#osc-act-export-audio'),
    ]);
    const wav = parseWavHeader(fs.readFileSync(await dl.path()));
    // sequence export through the header menu
    await page.click('#osc-export');
    const [dl2] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('[data-osc="export.seqWav"]'),
    ]);
    const seq = parseWavHeader(fs.readFileSync(await dl2.path()));
    await page.evaluate(() => { window.OSCILLA.app.setFrequency(440); window.OSCILLA.app.setEnv('duration', '500'); });
    const gain = 0.08;
    const ok = wav.ok && wav.format === 1 && wav.bits === 16 && wav.channels === 2
      && wav.sampleRate >= 44100 && wav.seconds > 0.4 && wav.seconds < 0.8
      && Math.abs(wav.peak - gain) < 0.01 && wav.riffSize === wav.fileSize - 8
      && seq.ok && seq.seconds > 2 && seq.peak > 0.01;
    return { ok, tone: wav, sequence: seq, names: [dl.suggestedFilename(), dl2.suggestedFilename()] };
  });

  def('nav-workspaces-switch', async ({ page }) => {
    const expect = {
      sequencer: ['#osc-panel-sequencer'], analyzer: ['#osc-panel-mic', '#osc-panel-spectrogram'],
      filter: ['#osc-panel-filter'], synthesis: ['#osc-panel-dual', '#osc-panel-envelope'],
      compare: ['#osc-panel-bio', '#osc-panel-mic'], learn: ['#osc-view-learn'],
      presets: ['#osc-view-presets'],
    };
    const res = {};
    for (const [ws, sels] of Object.entries(expect)) {
      await H.workspace(page, ws);
      res[ws] = await page.evaluate((list) => {
        const vis = (s) => { const el = document.querySelector(s); const r = el && el.getBoundingClientRect(); return !!(r && r.width > 0 && r.height > 0); };
        const filterBig = document.querySelector('#osc-chart-filter').getBoundingClientRect().height;
        return { shown: list.every(vis), current: document.querySelector('[data-osc^="nav."][aria-current="page"]')?.dataset.osc,
          filterH: Math.round(filterBig), sourceHiddenInLearn: !vis('#osc-panel-source') };
      }, sels);
    }
    await H.workspace(page, 'playground');
    const ok = Object.entries(res).every(([ws, r]) => r.shown && r.current === `nav.${ws}`)
      && res.filter.filterH > 300 && res.learn.sourceHiddenInLearn;
    return { ok, res };
  });

  def('theme-toggles', async ({ page }) => {
    const v0 = await page.evaluate(() => window.OSCILLA.viz.paletteVersion);
    await page.click('#osc-theme-toggle');
    await sleep(150);
    const light = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme,
      bg: getComputedStyle(document.body).backgroundColor, pv: window.OSCILLA.viz.paletteVersion }));
    await page.click('#osc-theme-toggle');
    await sleep(150);
    const dark = await page.evaluate(() => document.documentElement.dataset.theme);
    const ok = light.theme === 'light' && dark === 'dark' && light.pv > v0;
    return { ok, light, dark };
  });

  def('no-horizontal-overflow', async ({ page }) => {
    const res = {};
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await sleep(250);
      res[w] = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth }));
    }
    await page.setViewportSize({ width: 1536, height: 1024 });
    await sleep(200);
    const bad = Object.entries(res).filter(([, r]) => r.sw > r.cw + 1).map(([w]) => w);
    return { ok: !bad.length, bad, res };
  });

  def('page-hide-releases-voice', async ({ page }) => {
    await H.focusBody(page);
    await page.keyboard.down(' ');
    await sleep(300);
    const playing = await page.evaluate(() => window.OSCILLA.app.playing);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const zero = await H.waitNodes0(page);
    await page.evaluate(() => {
      delete document.hidden;
      delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.keyboard.up(' ');
    return { ok: playing && zero, playing, zeroAfterHide: zero };
  });

  def('analysis-tabs-and-fullscreen', async ({ page }) => {
    const res = {};
    for (const tab of ['spectrum', 'spectrogram', 'harmonics', 'signalPath', 'waveform']) {
      await page.click(`#osc-atab-${tab.toLowerCase()}`);
      await sleep(250);
      res[tab] = await page.evaluate(() => ({
        view: window.OSCILLA.host && window.OSCILLA.host.view,
        canvases: [...document.querySelectorAll('#osc-analysis-view canvas')]
          .filter((c) => c.getBoundingClientRect().height > 0).length,
      }));
    }
    await page.selectOption('#osc-time-window', '20');
    const tw = await page.evaluate(() => window.OSCILLA.app.timeWindowMs);
    await page.click('#osc-analysis-fullscreen');
    await sleep(300);
    const fs1 = await page.evaluate(() => !!(document.fullscreenElement
      || document.querySelector('.osc-panel.is-fullscreen')));
    await page.click('#osc-analysis-fullscreen').catch(() => {});
    let fs2 = true;
    for (let i = 0; i < 20 && fs2; i++) {
      await sleep(100);
      fs2 = await page.evaluate(() => !!(document.fullscreenElement
        || document.querySelector('.osc-panel.is-fullscreen')));
    }
    await page.selectOption('#osc-time-window', '5');
    const ok = res.harmonics.view === 'harmonicBars' && res.signalPath.view === 'path'
      && res.waveform.view === 'scope' && res.spectrogram.canvases > 0 && tw === 20 && fs1 && !fs2;
    return { ok, res, timeWindow: tw, fullscreenOn: fs1, fullscreenOff: !fs2 };
  });

  def('labs-basic', async ({ page }) => {
    await H.continuous(page, true);
    const out = {};
    // filter: low-pass at 500 Hz must attenuate a 5 kHz tone when enabled
    await page.evaluate(() => {
      window.OSCILLA.app.setFrequency(5000);
      window.OSCILLA.labs.filter.update({ type: 'lowpass', frequency: 500, Q: 0.7071, enabled: true });
    });
    await H.focusBody(page);
    await page.keyboard.down(' ');
    await sleep(400);
    out.filteredPeak = +(await H.peak(page)).toFixed(4);
    await page.keyboard.up(' ');
    await H.waitNodes0(page);
    await page.evaluate(() => window.OSCILLA.labs.filter.update({ enabled: false }));
    await H.spaceDown(page);
    await sleep(400);
    out.bypassPeak = +(await H.peak(page)).toFixed(4);
    await page.keyboard.up(' ');
    await H.waitNodes0(page);
    // ADSR: sustain 0.5 halves the held level
    await page.evaluate(() => {
      window.OSCILLA.app.setFrequency(440);
      window.OSCILLA.labs.envelope.update({ adsr: { a: 0.01, d: 0.05, s: 0.5, r: 0.05 }, enabled: true });
    });
    await H.spaceDown(page);
    await sleep(500);
    out.adsrPeak = +(await H.peak(page)).toFixed(4);
    await page.keyboard.up(' ');
    await H.waitNodes0(page);
    await page.evaluate(() => window.OSCILLA.labs.envelope.update({ enabled: false }));
    // additive: enabled -> PeriodicWave on the carrier
    await page.click('#osc-add-enable');
    await H.spaceDown(page);
    await sleep(300);
    out.additiveCarrier = await page.evaluate(() => window.OSCILLA.engine.voice?.carrier?.type);
    await page.keyboard.up(' ');
    await H.waitNodes0(page);
    await page.click('#osc-add-enable');
    // sequencer: play / stop
    await page.click('#osc-seq-play');
    await sleep(400);
    out.seqPlaying = await page.evaluate(() => ({ app: window.OSCILLA.app.seqPlaying,
      label: document.querySelector('[data-osc="status.label"]').textContent,
      peak: 0 }));
    out.seqPeak = +(await H.peak(page)).toFixed(4);
    await page.click('#osc-seq-stop');
    await sleep(300);
    out.seqStopped = await page.evaluate(() => {
      const s = window.OSCILLA.labs.sequencer.editor;
      const st = s.stats();
      return { playing: s.playing, sources: st.activeSourceCount, nodes: st.activeNodeCount };
    });
    // device metrics are real after audio started
    out.device = await page.evaluate(() => ({
      sr: document.querySelector('#osc-dev-sr').textContent,
      ny: document.querySelector('#osc-dev-nyquist').textContent,
    }));
    // dual + stereo split through the router
    await H.workspace(page, 'synthesis');
    await page.click('#osc-dual-enable');
    await page.click('#osc-dual-stereo');
    await H.spaceDown(page);
    await sleep(400);
    out.dual = await page.evaluate(() => ({ source: window.OSCILLA.app.source,
      router: !!window.OSCILLA.adapter.getStereoRouter(),
      corr: document.querySelector('#osc-corr-value').textContent }));
    await page.keyboard.up(' ');
    await H.waitNodes0(page);
    await page.click('#osc-dual-mono');
    await page.click('#osc-dual-enable');
    await H.workspace(page, 'playground');
    const gain = 0.08;
    const ok = out.filteredPeak < gain * 0.2 && Math.abs(out.bypassPeak - gain) < 0.01
      && Math.abs(out.adsrPeak - gain * 0.5) < 0.012 && out.additiveCarrier === 'custom'
      && out.seqPlaying.app && out.seqPlaying.label === 'PLAYING' && out.seqPeak > 0.005
      && !out.seqStopped.playing && out.seqStopped.sources === 0
      && /\d/.test(out.device.sr) && out.dual.source === 'dual' && out.dual.router;
    return { ok, ...out };
  });

  // ---- accessibility residuals of the final V1 probe (WCAG 2.4.11, focus loss, overlap)
  def('a11y-alerts-never-cover-focus', async ({ page, browserName }) => {
    const res = {};
    // WebKit (macOS) tabs only to form fields unless Option is held: Option+Tab reaches all.
    const TAB = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    for (const w of [768, 1024, 1280, 1536]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.evaluate(() => {
        const a = window.OSCILLA.app;
        a.alerts = [];
        a.notify('error', 'Gate error', 'A persistent error that must never cover a focused control.');
        a.notify('warning', 'Gate warning', 'A second notification.');
      });
      await sleep(150);
      await page.focus('.osc-skip');
      const seen = new Set();
      let steps = 0;
      let covered = [];
      for (; steps < 320; steps++) {
        await page.keyboard.press(TAB);
        const r = await page.evaluate(() => {
          const a = document.activeElement;
          if (!a || a === document.body) return { body: true };
          const key = a.id || a.dataset.osc || a.outerHTML.slice(0, 60);
          const box = a.getBoundingClientRect();
          const region = document.querySelector('[data-osc="alerts"]');
          const inAlert = region.contains(a);
          const hits = [...region.querySelectorAll('.osc-toast')].some((t) => {
            const b = t.getBoundingClientRect();
            return !inAlert && b.width && box.width && box.left < b.right && box.right > b.left
              && box.top < b.bottom && box.bottom > b.top;
          });
          return { key, hits };
        });
        if (r.body) continue;
        if (r.hits) covered.push(r.key);
        if (seen.has(r.key) && steps > 20) break;
        seen.add(r.key);
      }
      res[w] = { steps, distinct: seen.size, covered: covered.slice(0, 6) };
    }
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    await page.setViewportSize({ width: 1536, height: 1024 });
    await sleep(150);
    const ok = Object.values(res).every((r) => !r.covered.length && r.distinct > 60);
    return { ok, res };
  });

  def('a11y-focus-never-body', async ({ page }) => {
    const out = {};
    const active = () => page.evaluate(() => {
      const a = document.activeElement;
      return !a || a === document.body ? 'BODY' : (a.id || a.dataset.osc || a.tagName);
    });
    // menu item that opens a dialog, closed with Escape -> back on the menu button
    await page.focus('#osc-overflow');
    await page.keyboard.press('Enter');
    await sleep(100);
    await page.focus('[data-osc="header.shortcuts"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#osc-dlg-help[open]');
    await page.keyboard.press('Escape');
    await sleep(200);
    out.menuDialog = await active();
    // menu item that only acts (PNG download) -> back on the menu button
    await page.focus('#osc-export');
    await page.keyboard.press('Enter');
    await sleep(100);
    await page.focus('[data-osc="export.png"]');
    await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
      page.keyboard.press('Enter')]);
    await sleep(200);
    out.menuAction = await active();
    // dismissing a notification
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.alerts = [];
      a.notify('error', 'One', 'first');
      a.notify('error', 'Two', 'second');
    });
    await sleep(100);
    await page.focus('[data-osc="alert"] button');
    await page.keyboard.press('Enter');
    await sleep(150);
    out.dismissFirst = await active();
    await page.keyboard.press('Enter');
    await sleep(150);
    out.dismissLast = await active();
    // status-bar export while busy (aria-disabled, never disabled)
    await page.focus('#osc-act-export-audio');
    await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      page.keyboard.press('Enter')]);
    out.exportBusy = await active();
    // save preset dialog submitted by keyboard
    await page.focus('#osc-act-save-preset');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#osc-dlg-save[open]');
    await page.fill('#osc-save-name', 'Focus gate');
    await page.keyboard.press('Enter');
    await sleep(250);
    out.saveDialog = await active();
    // deleting the preset from the Presets view (two key presses)
    await H.workspace(page, 'presets');
    await page.click('[data-osc="presets.tab"][data-value="custom"]');
    await page.focus('[data-osc="presets.delete"]');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await sleep(200);
    out.presetDelete = await active();
    // a Learn demo hides the Learn view
    await H.workspace(page, 'learn');
    await page.focus('[data-osc="learn.demo"]');
    await page.keyboard.press('Enter');
    await sleep(300);
    out.learnDemo = await active();
    // microphone toggle (fails or prompts quickly; never disables itself)
    await page.focus('#osc-mic-toggle');
    await page.keyboard.press('Enter');
    await sleep(400);
    out.micToggle = await active();
    await page.evaluate(() => { const m = window.OSCILLA.labs.mic; if (m && m.active) m.stop(); });
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; window.OSCILLA.app.customPresets = []; });
    await H.workspace(page, 'playground');
    const ok = Object.values(out).every((v) => v !== 'BODY')
      && out.menuDialog === 'osc-overflow' && out.menuAction === 'osc-export'
      && out.learnDemo === 'osc-hold-play' && out.saveDialog === 'osc-act-save-preset';
    return { ok, ...out };
  });

  def('a11y-header-no-overlap-narrow', async ({ page }) => {
    const res = {};
    const states = {
      READY: () => {},
      PLAYING: async () => { await H.continuous(page, true); await H.spaceDown(page); await sleep(250); },
      SUSPENDED: () => page.evaluate(() => { window.OSCILLA.app.status = 'SUSPENDED'; }),
      RELEASING: () => page.evaluate(() => { window.OSCILLA.app.status = 'RELEASING'; }),
    };
    for (const w of [320, 360, 375, 390]) {
      await page.setViewportSize({ width: w, height: 800 });
      for (const [name, enter] of Object.entries(states)) {
        await enter();
        await sleep(150);
        const r = await page.evaluate(() => {
          const header = document.querySelector('.osc-header');
          const hb = header.getBoundingClientRect();
          const parts = [...header.querySelectorAll('.osc-brand, .osc-nav, .osc-header-actions > *')]
            .filter((el) => el.getBoundingClientRect().width > 0);
          const boxes = parts.map((el) => ({ el: el.className.split(' ')[0] || el.tagName, b: el.getBoundingClientRect() }));
          const overlaps = [];
          for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
              const a = boxes[i].b; const b = boxes[j].b;
              const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (ix > 0.5 && iy > 0.5) overlaps.push(`${boxes[i].el}×${boxes[j].el}`);
            }
          }
          const outside = boxes.filter(({ b }) => b.right > hb.right + 0.5 || b.left < hb.left - 0.5)
            .map((x) => x.el);
          return { overlaps, outside, scroll: document.documentElement.scrollWidth > innerWidth };
        });
        res[`${w}/${name}`] = r;
        await page.keyboard.up(' ');
        await page.evaluate(() => { const a = window.OSCILLA.app; a.stopNow(); a.status = 'READY'; });
        await H.continuous(page, false);
      }
    }
    await page.setViewportSize({ width: 1536, height: 1024 });
    await sleep(150);
    const bad = Object.entries(res).filter(([, r]) => r.overlaps.length || r.outside.length || r.scroll);
    return { ok: !bad.length, bad: Object.fromEntries(bad.slice(0, 6)) };
  });

  def('a11y-bars-cover-no-target', async ({ page }) => {
    const res = {};
    for (const [w, h] of [[320, 640], [375, 812], [768, 900], [1024, 768], [1280, 800], [1536, 1024]]) {
      await page.setViewportSize({ width: w, height: h });
      await sleep(250);
      res[`${w}x${h}`] = await page.evaluate(() => {
        const main = document.getElementById('osc-main');
        main.scrollTop = 0;
        window.scrollTo(0, 0);
        const sel = 'button, a[href], input:not([type=file]), select, textarea, [role="tab"],'
          + ' [role="radio"], [role="switch"], [tabindex="0"]';
        const bad = [];
        let tested = 0;
        for (const el of document.querySelectorAll(sel)) {
          if (el.closest('[hidden], dialog, .osc-sr-only') || el.classList.contains('osc-skip')) continue;
          let r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          let box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
          // clip by the viewport and every clipping ancestor (scrollers, overflow: hidden)
          box = { l: Math.max(box.l, 0), t: Math.max(box.t, 0), r: Math.min(box.r, innerWidth),
            b: Math.min(box.b, innerHeight) };
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const cs = getComputedStyle(p);
            if (/(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) {
              const q = p.getBoundingClientRect();
              box = { l: Math.max(box.l, q.left), t: Math.max(box.t, q.top),
                r: Math.min(box.r, q.right), b: Math.min(box.b, q.bottom) };
            }
          }
          if (box.r - box.l < 2 || box.b - box.t < 2) continue; // scrolled out of view
          tested++;
          const cx = (box.l + box.r) / 2;
          for (const y of [box.t + 1, box.b - 1]) {
            const hit = document.elementFromPoint(cx, y);
            if (!hit || el.contains(hit) || hit.contains(el)) continue;
            const label = hit.closest('label');
            if (label && (label.control === el || label.contains(el))) continue;
            const bar = hit.closest('.osc-statusbar, .osc-header, [data-osc="alerts"]');
            if (bar && !bar.contains(el)) {
              bad.push(`${el.id || el.dataset.osc || el.tagName} under ${bar.className.split(' ')[0]}`);
              break;
            }
          }
        }
        return { tested, bad: bad.slice(0, 8), count: bad.length };
      });
    }
    await page.setViewportSize({ width: 1536, height: 1024 });
    await sleep(150);
    const ok = Object.values(res).every((r) => r.count === 0 && r.tested > 10);
    return { ok, res };
  });

  def('no-console-errors-after-run', async ({ errors }) => ({ ok: errors.length === 0,
    errors: errors.slice(0, 8) }));

  return checks;
}

// ------------------------------------------------------------------------------ runner
async function runOne(browserName, origin, baseUrl) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 },
    acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const results = {};
  await page.goto(baseUrl, { waitUntil: 'load' });
  try {
    await H.ready(page);
  } catch (e) {
    results.ready = { ok: false, detail: 'html[data-ready] not set', errors };
    await browser.close();
    return results;
  }
  for (const { name, fn } of defineChecks()) {
    if (ONLY && !ONLY.has(name) && name !== 'boot-no-console-errors') continue;
    const t0 = Date.now();
    try {
      const v = await Promise.race([
        fn({ page, context, errors, baseUrl, browserName, origin }),
        sleep(60000).then(() => ({ ok: false, detail: 'timeout 60 s' })),
      ]);
      results[name] = { ...v, ms: Date.now() - t0 };
    } catch (e) {
      const msg = String(e.message || e).split('\n');
      const sel = msg.find((l) => /waiting for|locator/.test(l)) || '';
      results[name] = { ok: false, detail: `${msg[0]} ${sel.trim()}`, ms: Date.now() - t0 };
    }
    try { await H.stopAll(page); } catch { /* page gone */ }
    try { await H.continuous(page, false); } catch { /* page gone */ }
    try { await page.keyboard.up(' '); } catch { /* ignore */ }
  }
  await browser.close();
  return results;
}

(async () => {
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  const server = ORIGINS.includes('http') ? startServer() : null;
  if (server) await waitForServer(server.url);
  const all = {};
  let failed = 0;
  try {
    for (const b of BROWSERS) {
      for (const o of ORIGINS) {
        const base = o === 'file' ? pathToFileURL(DIST).href : server.url;
        const key = `${b}/${o}`;
        const t0 = Date.now();
        const res = await runOne(b, o, base);
        all[key] = res;
        const names = Object.keys(res);
        const bad = names.filter((n) => !res[n].ok);
        failed += bad.length;
        console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}: ${names.length - bad.length}/`
          + `${names.length} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        for (const n of bad) console.log(`   x ${n}: ${JSON.stringify(res[n]).slice(0, 600)}`);
      }
    }
  } finally {
    if (server) {
      server.proc.kill();
      fs.rmSync(server.root, { recursive: true, force: true });
    }
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(all, null, 2)}\n`);
  process.exit(failed ? 1 : 0);
})();

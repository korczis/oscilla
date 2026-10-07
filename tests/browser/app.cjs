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
const BROWSERS = arg('browsers', process.env.OSC_BROWSERS || 'chromium,firefox,webkit').split(',');
const ORIGINS = arg('origins', 'file,http').split(',');
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const JSON_OUT = arg('json', '');
const WIDTHS = [320, 375, 768, 1024, 1280, 1536];
const CHECK_TIMEOUT_MS = 60000; // per check, unless it declares its own budget

// Chromium and Firefox get their fake capture devices (granted without a prompt) so the
// microphone checks can open a real stream; WebKit has none and skips only that part.
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } },
  webkit: {},
};
const FAKE_MIC = new Set(['chromium', 'firefox']);

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
  // Deadline poll: resolves to the first value of fn() that passes test(), or to the last value
  // once ms expired. Checks assert on the result instead of sleeping a fixed time first.
  until: async (fn, test, ms = 2000, step = 40) => {
    const t0 = Date.now();
    let v = await fn();
    while (!test(v) && Date.now() - t0 < ms) {
      await sleep(step);
      v = await fn();
    }
    return v;
  },
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
  /** Reach a workspace through the nav; a grouped one (ANALYZE, SYNTHESIS) opens its group. */
  navTo: async (page, ws) => {
    const item = `[data-osc="nav.${ws}"]`;
    const group = await page.evaluate((s) => {
      const el = document.querySelector(s);
      const g = el && el.closest('[data-osc-nav-group]');
      return g && el.offsetParent === null ? g.dataset.oscNavGroup : null;
    }, item);
    if (group) await page.click(`[data-osc="nav-group.${group}"]`);
    await page.click(item);
  },
  workspace: async (page, ws) => {
    await H.navTo(page, ws);
    await page.waitForFunction((w) => document.querySelector('#osc-app').dataset.mode === w, ws);
    await sleep(150);
  },
  /** Let n animation frames pass (focus scrolling, Alpine's x-show, rAF focus hand-offs). */
  frames: (page, n = 2) => page.evaluate((k) => new Promise((r) => {
    const step = (i) => (i ? requestAnimationFrame(() => step(i - 1)) : r());
    step(k);
  }), n),
  /** The focused element as its id or data-osc, 'BODY' when focus was dropped. */
  active: (page) => page.evaluate(() => {
    const a = document.activeElement;
    return !a || a === document.body ? 'BODY' : (a.id || a.dataset.osc || a.tagName);
  }),
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
    // The STUDIO workspace and its dialogs are audited, state by state, by
    // tests/browser/v31-studio-graph.cjs (controls-labelled); its file input is opened by the
    // Import button. The compact widget in the Playground stays in this audit.
    if (el.id === 'osc-studio-import-file'
      || el.closest('#osc-view-studio, [data-osc-studio-dialog]')) return;
    out.push({
      osc: el.dataset.osc, id: el.id || '', name: name(el), visible: visible(el),
      reachable: reachable(el), disabled: !!el.disabled,
    });
  });
  return out;
}

/**
 * In-page: is the focused element covered, fully or partly, by a notification, the header, the
 * status bar, the hints strip or any fixed/sticky element, or cut off by the viewport? Samples
 * elementFromPoint at the centre and the four inset corners of its box.
 */
/** In-page expression: two frames for focus scrolling to settle, then focusObscured(). */
const SETTLED_OBSCURED = 'new Promise((r) => requestAnimationFrame(() => '
  + `requestAnimationFrame(r))).then(() => (${focusObscured})())`;

function focusObscured() {
  const el = document.activeElement;
  if (!el || el === document.body) return { body: true };
  const key = el.id || el.dataset.osc || el.outerHTML.slice(0, 60);
  const r = el.getBoundingClientRect();
  const ix = Math.min(2, r.width / 4);
  const iy = Math.min(2, r.height / 4);
  const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + ix, r.top + iy],
    [r.right - ix, r.top + iy], [r.left + ix, r.bottom - iy], [r.right - ix, r.bottom - iy]];
  const COVER = '.osc-header, .osc-statusbar, [data-osc="alerts"], .osc-hints';
  const coverOf = (hit) => {
    const bar = hit.closest(COVER);
    if (bar && !bar.contains(el)) return bar.className.split(' ')[0];
    for (let p = hit; p && p !== document.body; p = p.parentElement) {
      if (/fixed|sticky/.test(getComputedStyle(p).position) && !p.contains(el)) {
        return p.id || p.className.split(' ')[0] || p.tagName;
      }
    }
    return '';
  };
  const under = [];
  for (const [x, y] of pts) {
    const hit = document.elementFromPoint(x, y);
    if (!hit) { under.push('off-screen'); continue; }
    if (el.contains(hit) || hit.contains(el)) continue;
    const c = coverOf(hit);
    if (c) under.push(c);
  }
  return { key, under: [...new Set(under)], n: under.length };
}

/** In-page: the last visible tab stop in document order (start of a Shift+Tab walk). */
function focusLastTabStop() {
  const sel = 'button, a[href], input:not([type=file]), select, textarea, [tabindex]';
  const all = [...document.querySelectorAll(sel)].filter((el) => {
    if (el.tabIndex < 0 || el.disabled || el.closest('[hidden], dialog:not([open])')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  });
  const last = all[all.length - 1];
  last.focus();
  return last.id || last.dataset.osc || last.tagName;
}

/**
 * In-page: replace getUserMedia with a request that stays pending until
 * window.__oscGum.settle(real) — real: the original device request (fake capture device),
 * otherwise a NotAllowedError. window.__oscGum.restore() puts the original back.
 */
function installPendingMic() {
  const md = navigator.mediaDevices;
  const orig = md && typeof md.getUserMedia === 'function' ? md.getUserMedia.bind(md) : null;
  const gum = { calls: 0, settle: () => {}, restore: () => {} };
  const pending = (c) => {
    gum.calls += 1;
    return new Promise((res, rej) => {
      gum.settle = (real) => (real && orig ? orig(c).then(res, rej)
        : rej(new DOMException('Permission denied', 'NotAllowedError')));
    });
  };
  if (md) {
    md.getUserMedia = pending;
    gum.restore = () => { if (orig) md.getUserMedia = orig; else delete md.getUserMedia; };
  } else {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: pending },
      configurable: true });
    gum.restore = () => { delete navigator.mediaDevices; };
  }
  window.__oscGum = gum;
}

/** In-page: phone header and status bar geometry (rows, overlaps, clipping, scrolling). */
function phoneBars() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && !el.classList.contains('osc-sr-only');
  };
  const name = (el) => el.id || el.dataset.osc || el.className.split(' ')[0] || el.tagName;
  const boxes = (els) => els.filter(vis)
    .map((el) => ({ n: name(el), b: el.getBoundingClientRect() }));
  const overlaps = (list) => {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].b;
        const b = list[j].b;
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 0.5 && y > 0.5) out.push(`${list[i].n}×${list[j].n}`);
      }
    }
    return out;
  };
  const bad = [];
  const header = document.querySelector('.osc-header');
  const hb = header.getBoundingClientRect();
  const nav = header.querySelector('.osc-nav').getBoundingClientRect();
  const top = boxes([...header.querySelectorAll('.osc-brand, .osc-header-actions > *')]);
  const hparts = [...top, { n: 'osc-nav', b: nav }];
  bad.push(...overlaps(hparts).map((o) => `header ${o}`));
  for (const p of hparts) {
    if (p.b.left < hb.left - 0.5 || p.b.right > hb.right + 0.5) bad.push(`${p.n} outside header`);
  }
  // On phones the workspace strip is the header's second row, under the brand and actions.
  const firstRow = Math.max(...top.map((p) => p.b.bottom));
  if (nav.top < firstRow - 0.5) bad.push(`nav row ${nav.top} above ${firstRow}`);
  let next = header.nextElementSibling;
  while (next && !vis(next)) next = next.nextElementSibling;
  if (next && next.getBoundingClientRect().top < hb.bottom - 0.5) {
    bad.push(`header over ${name(next)}`);
  }
  const sb = document.querySelector('.osc-statusbar');
  const sbb = sb.getBoundingClientRect();
  const sparts = boxes([...sb.children]);
  bad.push(...overlaps(sparts).map((o) => `status bar ${o}`));
  for (const p of sparts) {
    if (p.b.left < sbb.left - 0.5 || p.b.right > sbb.right + 0.5) bad.push(`${p.n} outside bar`);
  }
  const main = document.getElementById('osc-main').getBoundingClientRect();
  if (sbb.top < main.bottom - 0.5) bad.push('status bar over the main row');
  const state = document.querySelector('.osc-sb-state').getBoundingClientRect();
  const label = document.querySelector('[data-osc="status.label"]');
  const lb = label.getBoundingClientRect();
  if (label.scrollWidth > label.clientWidth + 1 || lb.right > state.right + 0.5) {
    bad.push('status label clipped');
  }
  const readout = boxes([...document.querySelectorAll('[data-osc="status.readout"] > *')]);
  for (const p of readout) {
    if (p.b.left < lb.right - 0.5) bad.push(`${p.n} over the status label`);
    if (p.b.right > state.right + 1) bad.push(`${p.n} clipped by ${p.b.right - state.right} px`);
  }
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth) {
    bad.push(`page scrolls ${doc.scrollWidth - doc.clientWidth} px`);
  }
  if (header.scrollWidth > header.clientWidth + 1) bad.push('header scrolls horizontally');
  if (sb.scrollWidth > sb.clientWidth + 1) bad.push('status bar scrolls horizontally');
  return { label: label.textContent.trim(), bad };
}

// ------------------------------------------------------------------------------ checks
// Checks that fail because of a defect already tracked in the Majordomus plan. They still run
// and are reported on every run; they do not fail the gate, and one that starts passing does,
// so the entry cannot outlive its fix.
const KNOWN_DEFECTS = Object.freeze({});

function defineChecks() {
  const checks = [];
  // opts.timeoutMs: the check's budget (default CHECK_TIMEOUT_MS)
  const def = (name, fn, opts = {}) => checks.push({ name, fn, timeoutMs: opts.timeoutMs });

  def('boot-no-console-errors', async ({ page, errors }) => {
    await sleep(800);
    const info = await page.evaluate(() => ({
      labs: Object.keys(window.OSCILLA.labs), labErrors: window.OSCILLA.labErrors,
      version: window.OSCILLA.version, host: !!window.OSCILLA.host,
    }));
    const ok = errors.length === 0 && Object.keys(info.labErrors).length === 0 && info.host
      && info.version === require('../../package.json').version;
    return { ok, errors: errors.slice(0, 5), ...info };
  });

  // Ledger W7 (ADR 0052): the seam ships in the page, so its surface is pinned here. A key is
  // added or removed only by editing these lists; every hook observes, drives an action a user
  // already has, or injects only inside TEST CONTEXT (tests/unit/v4-seam-contract.test.mjs).
  def('seam-surface-pinned', async ({ page }) => {
    const OSCILLA_KEYS = ['engine', 'viz', 'adapter', 'labs', 'labErrors', 'app', 'host',
      'measure', 'experiments', 'studio', 'navigation', 'unsaved', 'studioTimeline', 'buildPlan',
      'planFreqAt', 'parseFrequency', 'parseFrequencyList', 'formatFrequency', 'formatPeriod',
      'formatWavelength', 'frequencyToNormalized', 'normalizedToFrequency', 'nearestNote',
      'noteToFrequency', 'regionFor', 'harmonicTable', 'BUILTIN_PRESETS', 'LEARN_TOPICS',
      'PATTERNS', 'parseWav', 'encodeWav', 'buildConfigExport', 'parseConfigImport', 'version',
      'build', 'legacyV1Stamp'];
    const MEASURE_KEYS = ['state', 'engine', 'io', 'ioKind', 'result', 'history', 'useLoopback',
      'useMicrophone', 'onceInState', 'clearStateHook', 'live', 'setValues', 'counts', 'liveRta',
      'liveRtaSnapshot', 'experimentFromResult', 'levelCalibration', 'inputNow', 'reference',
      'referenceCapturing', 'setInputNow', 'showResult', 'responseView', 'deviceId',
      'ioDeviceId', 'refreshInputs', 'irView'];
    const got = await page.evaluate(() => {
      const O = window.OSCILLA;
      const m = O.measure;
      const fixed = {};
      for (const k of ['version', 'build', 'legacyV1Stamp']) {
        const d = Object.getOwnPropertyDescriptor(O, k);
        const was = O[k];
        try { O[k] = 'overwritten'; } catch (e) { /* strict mode */ }
        fixed[k] = !!d && d.writable === false && d.configurable === false && O[k] === was;
      }
      const values = JSON.stringify(O.app.meas.values);
      const title = O.app.meas.shownTitle;
      return {
        oscilla: Object.keys(O), measure: Object.keys(m), fixed,
        testContext: !!O.app.meas.loopback,
        // Inject hooks refuse outside TEST CONTEXT; the drive hook validates like a recipe link.
        setInputNow: m.setInputNow({ device: { label: 'Unchecked', id: 'x' }, constraints: null,
          sampleRate: 48000 }),
        inputNow: m.inputNow,
        showResult: m.showResult({ state: 'COMPLETE', transfer: {}, ir: {} }),
        result: m.result, titleKept: O.app.meas.shownTitle === title,
        setValues: m.setValues({ bogus: 1 }), setRange: m.setValues({ duration: 0.5 }),
        valuesKept: JSON.stringify(O.app.meas.values) === values,
      };
    });
    const diff = (have, want) => ({ added: have.filter((k) => !want.includes(k)),
      removed: want.filter((k) => !have.includes(k)) });
    const o = diff(got.oscilla, OSCILLA_KEYS);
    const m = diff(got.measure, MEASURE_KEYS);
    const refusedValues = (r) => !!r && r.ok === false && Array.isArray(r.errors);
    const ok = o.added.length + o.removed.length + m.added.length + m.removed.length === 0
      && Object.values(got.fixed).every(Boolean)
      && !got.testContext && got.setInputNow === false && got.inputNow === null
      && got.showResult === false && got.result === null && got.titleKept
      && refusedValues(got.setValues) && refusedValues(got.setRange) && got.valuesKept;
    return { ok, oscilla: o, measure: m, fixed: got.fixed, testContext: got.testContext,
      setInputNow: got.setInputNow, showResult: got.showResult, titleKept: got.titleKept,
      setValues: got.setValues, setRange: got.setRange, valuesKept: got.valuesKept };
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
    for (const menu of ['#osc-nav-group-analyze', '#osc-nav-group-synthesis', '#osc-overflow',
      '#osc-export', '#osc-seq-add']) {
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
    for (const id of ['saveModal', 'headphonesModal', 'copyModal', 'settings', 'help',
      'osc-dlg-mic', 'osc-dlg-recipe-link']) {
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
    await H.workspace(page, 'about');
    await collect();
    // MEASURE and EXPERIMENTS: every state that shows a control. A TEST CONTEXT loopback
    // measurement (2 runs) gives the result tabs, Save/Repeat and, saved twice, two experiments
    // for the detail, compare and dialog controls.
    await H.workspace(page, 'measure');
    await page.evaluate(() => {
      const m = window.OSCILLA.measure;
      m.useLoopback();
      m.setValues({ duration: 1, repeats: 2, noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5,
        gapS: 0.2 });
      window.OSCILLA.app.measureSetExpert(true);
    });
    await collect();
    await page.evaluate(() => window.OSCILLA.app.measureStart());
    await page.waitForFunction(() => ['COMPLETE', 'INVALID', 'ABORTED', 'ERROR']
      .includes(window.OSCILLA.measure.state), null, { timeout: 45000 });
    const measureState = await page.evaluate(() => [window.OSCILLA.measure.state,
      window.OSCILLA.app.meas.error && window.OSCILLA.app.meas.error.message,
      window.OSCILLA.measure.history.join('>')]);
    await page.evaluate(() => window.OSCILLA.app.measureImportCalibrationText('20,0\n20000,0\n',
      'audit.csv'));
    for (const tab of ['ir', 'rta', 'response']) {
      await page.click(`[data-osc="measure.tab"][data-value="${tab}"]`);
      await page.waitForSelector(`#osc-m-pane-${tab}`, { state: 'visible', timeout: 5000 });
      await collect();
    }
    // A profile whose header does not state its sign: the convention dialog (M4).
    await page.evaluate(() => window.OSCILLA.app.measureImportCalibrationText(
      'Hz,Gain\n20,0\n20000,0\n', 'audit-gain.csv'));
    await page.check('[data-osc="calConv.choice"][value="deviation"]');
    await collect();
    await page.evaluate(() => window.OSCILLA.app.measureCancelCalibrationImport());
    await page.click('[data-osc="measure.levelCal"]');
    await collect();
    // A reference capture in progress shows Stop (M3); it is stopped, nothing is stored.
    const capturing = page.evaluate(() => window.OSCILLA.app.measureCaptureLevelReference());
    await page.waitForSelector('[data-osc="levelCal.stop"]', { state: 'visible', timeout: 5000 })
      .catch(() => {});
    await collect();
    await page.evaluate(() => window.OSCILLA.app.measureAbortLevelReference());
    const capResult = await capturing;
    if (capResult !== false) console.log('audit: reference capture was not stopped', capResult);
    await page.click('[data-osc="levelCal.manual"]'); // the advanced manual reading (M3)
    await page.fill('#osc-lc-obs', '-30');
    await collect();
    await page.click('[data-osc="levelCal.save"]');
    await page.waitForSelector('[data-osc="measure.levelRemove"]', { state: 'visible',
      timeout: 5000 }).catch(() => {});
    await collect();
    await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      if (window.OSCILLA.measure.state === 'COMPLETE') {
        const id = await a.measureSave();
        if (id) await a.experimentsDuplicate(id);
      }
      a.measureClearLevelCalibration();
      a.measureClearCalibration();
      a.measureSetExpert(false);
      a.alerts = [];
    });
    await H.workspace(page, 'experiments');
    await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      await a.experimentsRefresh();
      a.exps.rows.forEach((r) => a.experimentsToggleSelect(r.id));
      if (a.exps.rows[0]) await a.experimentsOpen(a.exps.rows[0].id);
    });
    await collect();
    await page.click('[data-osc="exp.rename"]');
    await collect();
    await page.evaluate(() => window.OSCILLA.app.closeModal('osc-dlg-exp-rename'));
    await page.click('[data-osc="exp.delete"]');
    await collect();
    await page.click('[data-osc="exp.deleteCancel"]');
    await page.click('[data-osc="exp.compare"]');
    await page.waitForSelector('[data-osc="exp.backToDetail"]', { state: 'visible', timeout: 5000 })
      .catch(() => {});
    await collect();
    // Definitions (ADR 0043): the dialog new and in edit (with its setup choice), a listed
    // definition's buttons, and a definition loaded into MEASURE.
    await page.evaluate(() => window.OSCILLA.app.experimentsDefAsk());
    await sleep(120);
    await collect();
    await page.fill('#osc-def-name', 'audit definition');
    await page.click('[data-osc="def.save"]');
    await page.waitForSelector('[data-osc="def.edit"]', { state: 'visible', timeout: 5000 })
      .catch(() => {});
    await collect();
    await page.click('[data-osc="def.edit"]');
    await sleep(120);
    await collect();
    await page.evaluate(() => window.OSCILLA.app.closeModal('osc-dlg-def'));
    await page.evaluate(async () => {
      // An authored definition stays loaded in MEASURE (a derived one only fills the setup).
      const a = window.OSCILLA.app;
      const d = a.exps.defs[0]
        && await window.OSCILLA.experiments.store().getDefinition(a.exps.defs[0].id);
      if (d) {
        const v = d.versions[d.versions.length - 1];
        a.measureLoadDefinition({ id: d.id, version: v.version, hash: v.hash, derived: false,
          execution: v.execution }, { name: d.name, match: 'match' });
        a.setWorkspace('measure');
      }
    });
    await page.waitForSelector('[data-osc="measure.clearDefinition"]', { state: 'visible',
      timeout: 5000 }).catch(() => {});
    await collect();
    await page.evaluate(() => {
      window.OSCILLA.app.measureClearDefinition();
      window.OSCILLA.app.alerts = [];
    });
    await H.workspace(page, 'experiments');
    await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      for (const r of a.exps.rows.slice()) {
        a.exps.deleteId = r.id;
        await a.experimentsDelete();
      }
      a.exps.panel = 'detail';
      a.alerts = [];
    });
    await H.workspace(page, 'playground');
    await page.setViewportSize({ width: 375, height: 800 });
    await H.workspace(page, 'measure');
    await collect();
    await H.workspace(page, 'playground');
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
      controls: list.length, unlabelled, unreachable, neverVisible, measureState };
  });

  def('hold-plays-release-zero-nodes', async ({ page }) => {
    const hold = await page.locator('#osc-hold-play').boundingBox();
    await page.mouse.move(hold.x + hold.width / 2, hold.y + hold.height / 2);
    await page.mouse.down();
    const gain = await page.evaluate(() => window.OSCILLA.app.gainLevel);
    // the attack is a few ms; allow the analyser a generous 2 s to show the full level
    const peak = await H.until(() => H.peak(page), (p) => Math.abs(p - gain) < 0.01);
    const nodes = await H.nodes(page);
    const status = await H.until(() => page.evaluate(() => ({
      label: document.querySelector('[data-osc="status.label"]').textContent,
      green: document.querySelector('#osc-status').classList.contains('is-playing'),
      dot: getComputedStyle(document.querySelector('.osc-status-dot')).backgroundColor,
    })), (st) => st.label === 'PLAYING' && st.green, 1000);
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
    const after = await H.until(() => page.evaluate(() => ({
      type: window.OSCILLA.engine.voice?.carrier?.type,
      playing: window.OSCILLA.app.playing,
      app: window.OSCILLA.app.waveform,
    })), (v) => v.type === 'square');
    // a square wave's crest factor is ~1 (peak ≈ RMS); a sine's is √2. Poll until the analyser
    // window holds only the new wave (2 s deadline).
    const crest = await H.until(() => page.evaluate(() => {
      const e = window.OSCILLA.engine;
      const d = new Float32Array(e.analyser.fftSize);
      e.analyser.getFloatTimeDomainData(d);
      let pk = 0; let s = 0;
      for (const v of d) { pk = Math.max(pk, Math.abs(v)); s += v * v; }
      return pk / Math.sqrt(s / d.length);
    }), (c) => c < 1.25);
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
      presets: ['#osc-view-presets'], about: ['#osc-view-about'],
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

  // V371 (spec §73, §75, §198): eight top-level entries; ANALYZE and SYNTHESIS are disclosure
  // groups whose items are the V2 workspaces with their old nav ids. Every workspace is reached
  // by keyboard (Tab through an open group; arrows from its button), aria-current marks the item
  // (page) and its group (true), Escape and a click outside close a group, focus never drops,
  // and the dropdown stays inside the viewport at desktop and phone widths.
  def('nav-groups-keyboard', async ({ page, browserName }) => {
    const TOP = ['nav.playground', 'nav.measure', 'nav.experiments', 'nav-group.analyze',
      'nav-group.synthesis', 'nav.learn', 'nav.studio', 'nav.about'];
    const GROUPS = { analyze: ['analyzer', 'filter', 'compare'],
      synthesis: ['synthesis', 'sequencer', 'presets'] };
    const state = () => page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      return { mode: q('#osc-app').dataset.mode,
        active: document.activeElement && document.activeElement !== document.body
          ? document.activeElement.dataset.osc : 'BODY',
        current: [...document.querySelectorAll('#osc-nav [aria-current]')]
          .map((e) => `${e.dataset.osc}=${e.getAttribute('aria-current')}`),
        expanded: [...document.querySelectorAll('[data-osc^="nav-group."]')]
          .filter((b) => b.getAttribute('aria-expanded') === 'true').map((b) => b.dataset.osc) };
    });
    const res = { bad: [] };
    const want = (cond, msg) => { if (!cond) res.bad.push(msg); };
    res.top = await page.evaluate(() => [...document.querySelectorAll('#osc-nav > li')]
      .map((li) => li.querySelector(':scope > a, :scope > button').dataset.osc));
    want(JSON.stringify(res.top) === JSON.stringify(TOP), `top level ${res.top.join(',')}`);
    for (const w of [1536, 375]) {
      await page.setViewportSize({ width: w, height: w > 400 ? 1024 : 812 });
      await sleep(150);
      // Tab order: the top level in order, an open group's items right after its button.
      // WebKit (macOS default) skips links and buttons on Tab unless the user opts in, so the
      // Tab paths run in chromium and firefox; the arrow paths run everywhere.
      if (browserName !== 'webkit') {
        await H.workspace(page, 'playground');
        await page.focus('[data-osc="nav.playground"]');
        const seen = ['nav.playground'];
        for (let i = 0; i < TOP.length - 1; i++) {
          await page.keyboard.press('Tab');
          seen.push((await state()).active);
        }
        want(JSON.stringify(seen) === JSON.stringify(TOP), `${w} tab order ${seen.join(',')}`);
      }
      for (const [g, items] of Object.entries(GROUPS)) {
        const btn = `[data-osc="nav-group.${g}"]`;
        for (const [i, ws] of items.entries()) {
          // Tab path: Enter opens, Tab walks into the list, Enter on the item navigates.
          if (browserName !== 'webkit') {
            await H.workspace(page, 'playground');
            await page.focus(btn);
            await page.keyboard.press('Enter');
            for (let k = 0; k <= i; k++) await page.keyboard.press('Tab');
            const at = (await state()).active;
            want(at === `nav.${ws}`, `${w} tab into ${g} reached ${at}, not nav.${ws}`);
            await page.keyboard.press('Enter');
            await sleep(120);
            const v = await state();
            want(v.mode === ws, `${w} tab ${ws}: mode ${v.mode}`);
          }
          // Arrow path: ArrowDown opens on the current (or first) item, Home, then ArrowDown.
          await H.workspace(page, 'playground');
          await page.focus(btn);
          await page.keyboard.press('ArrowDown');
          await sleep(60);
          const open = await page.evaluate((sel) => {
            const panel = document.getElementById(document.querySelector(sel)
              .getAttribute('aria-controls'));
            const r = panel.getBoundingClientRect();
            const items = [...panel.querySelectorAll('a')].map((a) => a.getBoundingClientRect());
            const hit = items.every((b) => {
              const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
              return el && panel.contains(el);
            });
            return { shown: r.width > 0 && r.height > 0, inside: r.left >= 0 && r.top >= 0
              && r.right <= innerWidth && r.bottom <= innerHeight, hit,
              minH: Math.min(...items.map((b) => b.height)) };
          }, btn);
          want(open.shown && open.inside && open.hit, `${w} ${g} panel ${JSON.stringify(open)}`);
          await page.keyboard.press('Home');
          for (let k = 0; k < i; k++) await page.keyboard.press('ArrowDown');
          await page.keyboard.press('Enter');
          await sleep(120);
          const v = await state();
          want(v.mode === ws && v.active === `nav-group.${g}` && !v.expanded.length
            && v.current.includes(`nav.${ws}=page`) && v.current.includes(`nav-group.${g}=true`)
            && v.current.length === 2, `${w} arrow ${ws}: ${JSON.stringify(v)}`);
        }
        // Escape closes and returns focus to the button; reopening marks the current item.
        await page.focus(btn);
        await page.keyboard.press('ArrowDown');
        await sleep(60);
        const reopened = await state();
        want(reopened.active === `nav.${items.at(-1)}`, `${w} reopen ${g} at ${reopened.active}`);
        await page.keyboard.press('Escape');
        await sleep(60);
        const esc = await state();
        want(!esc.expanded.length && esc.active === `nav-group.${g}`,
          `${w} escape ${g} ${JSON.stringify(esc)}`);
        // Click toggles; a click elsewhere closes.
        await page.click(btn);
        want((await state()).expanded.includes(`nav-group.${g}`), `${w} click opens ${g}`);
        await page.click('.osc-header', { position: { x: 3, y: 3 } });
        await sleep(60);
        want(!(await state()).expanded.length, `${w} outside click closes ${g}`);
      }
      // A top-level workspace clears the group mark.
      await H.workspace(page, 'learn');
      const learn = await state();
      want(JSON.stringify(learn.current) === '["nav.learn=page"]', `${w} learn ${learn.current}`);
    }
    await page.setViewportSize({ width: 1536, height: 1024 });
    await H.workspace(page, 'playground');
    return { ok: !res.bad.length, top: res.top, bad: res.bad.slice(0, 8) };
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
  def('a11y-alerts-never-cover-focus', async ({ page, browserName, run }) => {
    const res = {};
    // WebKit (macOS) tabs only to form fields unless Option is held: Option+Tab reaches all.
    const TAB = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    for (const w of [768, 1024, 1280, 1536]) {
      if (run.aborted) break;
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
      for (; steps < 320 && !run.aborted; steps++) {
        await page.keyboard.press(TAB);
        await H.frames(page); // focus scrolling settled (slow runners measured mid-scroll)
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
  }, { timeoutMs: 240000 }); // four widths, ~100 focus steps each, a frame wait per step

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

  // ---- V1 regressions (tests/spec.cjs at v1.0.1) restated in V2 terms
  // §39: a preset or demo whose label names the octave steps plays exactly those steps, even
  // after the user edited the Steps (Hz) field to other or invalid frequencies.
  def('octave-steps-reset-by-preset-and-demo', async ({ page }) => {
    const OCT = [125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const steps = '[data-osc="pattern.param"][data-key="text"]';
    const out = [];
    for (const text of ['300, 600', '125, 250, abc']) {
      for (const via of ['preset', 'learn']) {
        await page.click('#osc-source-pattern');
        await page.selectOption('#osc-pattern-select', 'octave');
        await page.fill(steps, text);
        await page.press(steps, 'Enter');
        const edited = await page.evaluate(() => window.OSCILLA.app.pp.octave.text);
        if (via === 'preset') {
          await H.workspace(page, 'presets');
          await page.click('[data-osc="presets.tab"][data-value="patterns"]');
          await page.locator('[data-osc="presets.item"][data-id="pt-octaves"]')
            .locator('[data-osc="presets.load"]').click();
          await H.workspace(page, 'playground');
        } else {
          await H.workspace(page, 'learn');
          await page.locator('[data-osc="learn.demo"]', { hasText: 'Octave steps 125 Hz' }).click();
          await page.waitForFunction(() => window.OSCILLA.app.workspace === 'playground');
        }
        await sleep(100);
        const r = await page.evaluate((sel) => {
          const a = window.OSCILLA.app;
          const plan = a.currentPlan();
          const field = document.querySelector(sel);
          return { pattern: a.pattern, field: field.value,
            invalid: field.getAttribute('aria-invalid'),
            freqs: plan.ok ? plan.plan.steps.map((s) => s.f) : plan.error };
        }, steps);
        // what plays: trigger and read the first step of the voice the engine scheduled, at
        // elapsed time 0 of its plan (a wall-clock sleep before instantaneousFrequency() could
        // land past the first step, or before the voice existed, on a loaded runner)
        await page.click('#osc-trigger');
        const first = await H.until(() => page.evaluate(() => {
          const o = window.OSCILLA;
          return o.engine.voice ? o.planFreqAt(o.engine.voice.plan, 0) : null;
        }), (f) => f !== null);
        await page.keyboard.press('Escape');
        await H.waitNodes0(page);
        out.push({ text, via, edited, ...r, first: first && +first.toFixed(1) });
      }
    }
    await page.evaluate(() => { window.OSCILLA.app.stopNow(); window.OSCILLA.app.alerts = []; });
    await page.selectOption('#osc-pattern-select', 'tone');
    await page.click('#osc-source-osc');
    const want = JSON.stringify(OCT);
    const ok = out.every((o) => o.edited === o.text && o.pattern === 'octave'
      && JSON.stringify(o.freqs) === want && o.field === OCT.join(', ') && o.invalid !== 'true'
      && Math.abs(o.first - 125) < 0.5);
    return { ok, runs: out };
  });

  // §48 (WCAG 2.4.11): with an error notification showing, no focused control is covered, fully
  // or partly, by a notification, the header, the status bar or any fixed/sticky element, Tab
  // forward and Shift+Tab back. Measured by elementFromPoint after focus scrolling settled.
  // Every tab stop at four widths, both directions: one round trip per step (the settle and the
  // measurement in one evaluate) and its own budget, as the V3 workbench and the V3.1 Studio
  // brought the tab order to several hundred stops (WebKit on CI needed close to 60 s).
  def('a11y-focus-never-obscured', async ({ page, browserName, run }) => {
    // WebKit (macOS) tabs only to form fields unless Option is held: Option+Tab reaches all.
    const KEYS = browserName === 'webkit' ? ['Alt+Tab', 'Alt+Shift+Tab'] : ['Tab', 'Shift+Tab'];
    const res = {};
    for (const w of [768, 1024, 1280, 1536]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.evaluate(() => {
        const a = window.OSCILLA.app;
        a.alerts = [];
        a.notify('error', 'Gate error', 'Persistent: it must never cover a focused control.');
      });
      await sleep(150);
      for (const key of KEYS) {
        await page.evaluate(() => { document.getElementById('osc-main').scrollTop = 0; });
        if (key.includes('Shift')) await page.evaluate(focusLastTabStop);
        else await page.focus('.osc-skip');
        await H.frames(page);
        const seen = new Set();
        const covered = [];
        let steps = 0;
        for (; steps < 320 && !run.aborted; steps++) {
          await page.keyboard.press(key);
          const r = await page.evaluate(SETTLED_OBSCURED);
          if (r.body) continue;
          if (r.n) covered.push(`${r.key} under ${r.under.join('/')}`);
          if (seen.has(r.key) && steps > 20) break;
          seen.add(r.key);
        }
        res[`${w}/${key.includes('Shift') ? 'back' : 'forward'}`] = { steps, distinct: seen.size,
          covered: covered.slice(0, 6), count: covered.length };
      }
    }
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    await page.setViewportSize({ width: 1536, height: 1024 });
    await sleep(150);
    const ok = Object.values(res).every((r) => !r.count && r.distinct > 60);
    return { ok, res };
  }, { timeoutMs: 240000 });

  // §49 (a): the safety notice's dismiss and the control that reopens it hide themselves, so each
  // hands focus to the other (V1: "Got it" <-> "Full notice"). Contract for V2's notice:
  // [data-osc="safety.dismiss"] and [data-osc="safety.reopen"].
  // DEFECT (not fixed here): V2 renders no safety notice at all. core/instrument.js keeps V1's
  // safetyCollapsed / safetyExpanded / showSafety() / collapseSafety() and main.js restores
  // oscilla.safetyNoticeCollapsed, but src/index.html has no notice markup, so the V1 §61 notice
  // (both safety statements, visible, non-obnoxious) is missing. Adding it is new markup and
  // layout in src/index.html and src/styles, outside a regression-check change; this check
  // fails until the notice exists and is listed in KNOWN_DEFECTS (plan issue V247) until then.
  def('a11y-safety-notice-focus-handoff', async ({ page }) => {
    const DISMISS = '[data-osc="safety.dismiss"]';
    const REOPEN = '[data-osc="safety.reopen"]';
    const present = await page.evaluate((s) => s.map((q) => !!document.querySelector(q)),
      [DISMISS, REOPEN]);
    if (!present.every(Boolean)) {
      return { ok: false, detail: 'V2 renders no safety notice: no dismiss/reopen control',
        dismiss: present[0], reopen: present[1] };
    }
    const focused = () => page.evaluate(() => {
      const a = document.activeElement;
      return !a || a === document.body ? 'BODY' : (a.dataset.osc || a.id || a.tagName);
    });
    const res = {};
    for (const w of [1536, 375]) {
      await page.setViewportSize({ width: w, height: w > 600 ? 1024 : 800 });
      await page.evaluate(() => window.OSCILLA.app.showSafety());
      await H.frames(page);
      await page.focus(DISMISS);
      await page.keyboard.press('Enter');
      await H.frames(page, 3);
      const afterDismiss = await focused();
      await page.keyboard.press('Enter');
      await H.frames(page, 3);
      res[w] = { afterDismiss, afterReopen: await focused() };
    }
    await page.setViewportSize({ width: 1536, height: 1024 });
    await sleep(150);
    const ok = Object.values(res).every((r) => r.afterDismiss === 'safety.reopen'
      && r.afterReopen === 'safety.dismiss');
    return { ok, res };
  });

  // §49 (b): the microphone button keeps focus while a start is pending (aria-disabled, never
  // disabled, and a second press opens no second request), after the start and after stop.
  // V2 has one microphone button, #osc-mic-toggle, that never hides (V1's header chip did and
  // handed focus on), so focus stays on it throughout. WebKit has no fake capture device: there
  // the pending request is refused instead of opening a stream.
  def('a11y-mic-focus-pending-and-stop', async ({ page, browserName }) => {
    const real = FAKE_MIC.has(browserName);
    await H.workspace(page, 'analyzer');
    await page.evaluate(installPendingMic);
    const state = () => page.evaluate(() => {
      const b = document.getElementById('osc-mic-toggle');
      const a = document.activeElement;
      const m = window.OSCILLA.labs.mic;
      return { focus: !a || a === document.body ? 'BODY' : (a.id || a.dataset.osc || a.tagName),
        disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'),
        pressed: b.getAttribute('aria-pressed'), active: m.active, error: m.error,
        calls: window.__oscGum.calls };
    });
    const out = {};
    await page.focus('#osc-mic-toggle');
    await page.keyboard.press('Enter');
    await H.frames(page);
    out.pending = await state();
    await page.keyboard.press('Enter'); // ignored while pending: no second stream
    await H.frames(page);
    out.secondPress = await state();
    await page.evaluate((r) => window.__oscGum.settle(r), real);
    await page.waitForFunction(() => {
      const m = window.OSCILLA.labs.mic;
      return m.active || m.error;
    }, null, { timeout: 5000 }).catch(() => {});
    await H.frames(page);
    out.started = await state();
    if (real) {
      await page.keyboard.press('Enter');
      await H.frames(page, 3);
      out.stopped = await state();
    }
    await page.evaluate(() => {
      const m = window.OSCILLA.labs.mic;
      if (m.active) m.stop();
      window.__oscGum.restore();
      window.OSCILLA.app.alerts = [];
    });
    await H.workspace(page, 'playground');
    const p = out.pending;
    const ok = p.focus === 'osc-mic-toggle' && !p.disabled && p.ariaDisabled === 'true'
      && p.calls === 1 && out.secondPress.calls === 1 && out.secondPress.focus === 'osc-mic-toggle'
      && out.started.focus === 'osc-mic-toggle' && out.started.ariaDisabled !== 'true'
      && (real ? out.started.active && out.started.pressed === 'true'
        && out.stopped.focus === 'osc-mic-toggle' && !out.stopped.active
        : !out.started.active && !!out.started.error);
    return { ok, realStream: real, ...out };
  });

  // §49 (c): dismissing a notification whose Dismiss button has focus moves focus to the next
  // notification's Dismiss (the previous one after the last), and to the main region after the
  // only one — also when the info/success auto-dismiss timer removes it (dismissAlert(id)).
  def('a11y-alert-dismiss-focus-next', async ({ page }) => {
    const where = () => page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return 'BODY';
      const t = a.closest('[data-osc="alert"]');
      return t ? `alert:${t.querySelector('strong').textContent}` : (a.id || a.dataset.osc);
    });
    const dismissOf = (title) => page.locator('[data-osc="alert"]', { hasText: title })
      .locator('button');
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.alerts = [];
      a.notify('error', 'One', 'first');
      a.notify('error', 'Two', 'second');
      a.notify('error', 'Three', 'third');
    });
    await H.frames(page);
    const out = {};
    await dismissOf('Two').focus();
    await page.keyboard.press('Enter');
    await H.frames(page, 3);
    out.middle = await where();
    await page.keyboard.press('Enter');
    await H.frames(page, 3);
    out.last = await where();
    await page.keyboard.press('Enter');
    await H.frames(page, 3);
    out.only = await where();
    // the auto-dismiss timer path, with a neighbour and without one
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.alerts = [];
      a.notify('error', 'Stays', 'persistent');
      a.notify('info', 'Leaves', 'auto-dismissed');
    });
    await H.frames(page);
    const timer = () => page.evaluate(() => {
      const a = window.OSCILLA.app;
      const info = a.alerts.find((x) => x.level === 'info');
      a.dismissAlert(info.id);
    });
    await dismissOf('Leaves').focus();
    await timer();
    await H.frames(page, 3);
    out.timerNext = await where();
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.alerts = [];
      a.notify('info', 'Alone', 'auto-dismissed');
    });
    await H.frames(page);
    await dismissOf('Alone').focus();
    await timer();
    await H.frames(page, 3);
    out.timerOnly = await where();
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    const fallback = (v) => v === 'osc-main' || v === 'osc-hold-play';
    const ok = out.middle === 'alert:Three' && out.last === 'alert:One' && fallback(out.only)
      && out.timerNext === 'alert:Stays' && fallback(out.timerOnly);
    return { ok, ...out };
  });

  // §61: on phones (320, 360, 375 px) the header and the status bar never overlap themselves or
  // the next row and never scroll horizontally, in every status state, with and without the
  // microphone on (WebKit: without only, it has no fake capture device).
  def('a11y-phone-bars-every-state', async ({ page, browserName }) => {
    const label = () => page.evaluate(() => document.querySelector('[data-osc="status.label"]')
      .textContent.trim());
    const set = (s) => page.evaluate((x) => { window.OSCILLA.app.status = x; }, s);
    const states = {
      READY: () => set('READY'),
      PLAYING: async () => {
        await H.continuous(page, true);
        await H.spaceDown(page);
        await sleep(250);
      },
      RELEASING: async () => {
        // a release longer than the hard limit is dropped (the voice ends sooner on its own)
        await H.continuous(page, true);
        await page.evaluate(() => window.OSCILLA.app.setEnv('release', '3000'));
        await H.spaceDown(page);
        await sleep(250);
        await page.keyboard.up(' ');
        await sleep(100);
      },
      SUSPENDED: () => set('SUSPENDED'),
      STOPPED: () => set('STOPPED'),
      ERROR: () => set('ERROR'),
    };
    const reset = async () => {
      await page.keyboard.up(' ');
      await page.evaluate(() => {
        const a = window.OSCILLA.app;
        a.stopNow();
        a.status = 'READY';
        a.setEnv('release', '30');
      });
      await H.continuous(page, false);
      await H.waitNodes0(page);
    };
    const mics = FAKE_MIC.has(browserName) ? [false, true] : [false];
    const res = {};
    for (const mic of mics) {
      if (mic) {
        await page.evaluate(() => window.OSCILLA.labs.mic.start());
        await page.waitForFunction(() => window.OSCILLA.labs.mic.active, null, { timeout: 5000 });
      }
      for (const w of [320, 360, 375]) {
        await page.setViewportSize({ width: w, height: 700 });
        await sleep(150);
        for (const [name, enter] of Object.entries(states)) {
          await enter();
          await H.frames(page);
          const shown = await label();
          const r = await page.evaluate(phoneBars);
          res[`${w}/${name}${mic ? '/mic' : ''}`] = { shown, bad: r.bad };
          await reset();
        }
      }
      if (mic) await page.evaluate(() => window.OSCILLA.labs.mic.stop());
    }
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    await page.setViewportSize({ width: 1536, height: 1024 });
    await sleep(150);
    const bad = Object.entries(res).filter(([k, r]) => r.bad.length
      || r.shown !== k.split('/')[1]);
    return { ok: !bad.length, cases: Object.keys(res).length,
      bad: Object.fromEntries(bad.slice(0, 6)) };
  });

  // About: the last primary nav item, keyboard-operable, a native full-width view whose links
  // go exactly where they say, laid out without overflow or clipping at every tested width.
  def('about-page', async ({ page, browserName }) => {
    const res = {};
    res.nav = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#osc-nav > li > a')].map((a) => a.dataset.osc);
      return { last: items.at(-1), count: items.length };
    });
    // Tab order: Studio -> About (Safari/WebKit skips links on Tab unless the user opts in).
    // V3.1: Studio is the last workspace before About (spec §198).
    await page.focus('[data-osc="nav.studio"]');
    await page.keyboard.press('Tab');
    res.tabbedTo = await page.evaluate(() => document.activeElement && document.activeElement.dataset.osc);
    await page.focus('[data-osc="nav.about"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#osc-app').dataset.mode === 'about');
    await sleep(200);
    res.view = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const view = q('#osc-view-about');
      const shown = (el) => { const r = el && el.getBoundingClientRect(); return !!(r && r.width > 0 && r.height > 0); };
      const link = (osc) => { const el = q(`[data-osc="${osc}"]`); return el && { href: el.getAttribute('href'), target: el.target, rel: el.rel, h: Math.round(el.getBoundingClientRect().height) }; };
      const text = view.innerText;
      return {
        shown: shown(view), current: q('[data-osc^="nav."][aria-current="page"]')?.dataset.osc,
        title: document.title, h2: view.querySelectorAll('h2').length,
        heading: q('#osc-about-title').textContent.replace(/\s+/g, ' ').trim(),
        anchors: ['OSCILLA', 'Majordomus', 'github.com/korczis/oscilla', 'korczis@gmail.com', 'majordomus.dev']
          .filter((t) => !text.includes(t)),
        source: link('about.source'), majordomus: link('about.majordomus'), email: link('about.email'),
        traceHidden: q('.osc-about-trace').getAttribute('aria-hidden') === 'true',
        othersHidden: ['#osc-view-learn', '#osc-view-presets', '#osc-panel-source', '#osc-panel-analysis']
          .every((s) => !shown(q(s))),
      };
    });
    const v = res.view;
    // Reduced motion: the one-shot trace draw collapses to (near) zero duration.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    res.reducedMotionS = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.osc-about-trace')).animationDuration));
    await page.emulateMedia({ reducedMotion: null });
    // Layout at every tested width: no page overflow, nothing leaves the view, no clipped text,
    // the evolution stations never overlap, and the links stay at least 24 px tall.
    res.widths = {};
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await sleep(200);
      res.widths[w] = await page.evaluate(() => {
        const view = document.getElementById('osc-view-about');
        const vr = view.getBoundingClientRect();
        const bad = [];
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) bad.push('page overflow');
        for (const el of view.querySelectorAll('*')) {
          if (el.closest('svg') || el.classList.contains('osc-sr-only') || el.closest('.osc-sr-only')) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (r.left < vr.left - 1 || r.right > vr.right + 1) bad.push(`outside: ${el.tagName}.${el.className}`);
          if (/^(H2|H3|P|DD|DT|LI|A|STRONG|EM|B|SPAN)$/.test(el.tagName) && el.scrollWidth > el.clientWidth + 1
            && getComputedStyle(el).overflowX !== 'visible') bad.push(`clipped: ${el.tagName}.${el.className}`);
        }
        const st = [...view.querySelectorAll('.osc-about-timeline > li')].map((li) => li.getBoundingClientRect());
        for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
          const a = st[i]; const b = st[j];
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) bad.push(`stations ${i + 1}/${j + 1} overlap`);
        }
        // A station's text stays inside its station: squeezed columns let it run into the next.
        // A station with a word far longer than any column, added for the measurement only:
        // the layout, not today's station names and fonts, must keep it inside its station.
        const probe = document.createElement('li');
        probe.dataset.state = 'planned';
        probe.innerHTML = '<span class="osc-about-step osc-num">99</span>'
          + '<strong>Reproducibilityunderstandingly</strong><span>Probe</span><em>Probe</em>';
        view.querySelector('.osc-about-timeline').appendChild(probe);
        view.querySelectorAll('.osc-about-timeline > li').forEach((li, i) => {
          if ([...li.children].some((c) => c.scrollWidth > li.clientWidth + 1)) {
            bad.push(`station ${i + 1} text wider than the station`);
          }
        });
        probe.remove();
        for (const a of view.querySelectorAll('a[href]')) {
          if (a.getBoundingClientRect().height < 23.5) bad.push(`small target ${a.dataset.osc}`);
        }
        return bad.slice(0, 6);
      });
    }
    await page.setViewportSize({ width: 1536, height: 1024 });
    await sleep(150);
    // The overflow-menu entry opens the same workspace; leaving restores the product title.
    await H.workspace(page, 'playground');
    res.baseTitle = await page.evaluate(() => document.title);
    await page.click('#osc-overflow');
    await page.click('[data-osc="header.about"]');
    await sleep(150);
    res.menuMode = await page.evaluate(() => document.querySelector('#osc-app').dataset.mode);
    await H.workspace(page, 'playground');
    const external = (l, href) => l && l.href === href && l.target === '_blank'
      && /noopener/.test(l.rel) && /noreferrer/.test(l.rel);
    const ok = res.nav.last === 'nav.about'
      && (res.tabbedTo === 'nav.about' || browserName === 'webkit')
      && v.shown && v.current === 'nav.about' && v.title === 'OSCILLA · About' && v.h2 === 1
      && v.heading === 'About OSCILLA' && !v.anchors.length && v.traceHidden && v.othersHidden
      && external(v.source, 'https://github.com/korczis/oscilla')
      && external(v.majordomus, 'https://majordomus.dev/')
      && v.email && v.email.href === 'mailto:korczis@gmail.com'
      && res.reducedMotionS < 0.01
      && Object.values(res.widths).every((b) => !b.length)
      && res.menuMode === 'about' && !/About/.test(res.baseTitle);
    return { ok, ...res };
  });

  def('no-console-errors-after-run', async ({ errors }) => ({ ok: errors.length === 0,
    errors: errors.slice(0, 8) }));

  // The unsaved-work guard asks only while work would be lost: a beforeunload question the run
  // did not expect means a guard armed by mistake. A reload of the page proves it is quiet now.
  def('no-unexpected-unload-prompt', async ({ page, unload, baseUrl }) => {
    const armed = await page.evaluate(() => window.OSCILLA.unsaved.armed);
    const lost = await page.evaluate(() => window.OSCILLA.unsaved.whatWouldBeLost());
    if (!armed) {
      await page.goto(baseUrl, { waitUntil: 'load' });
      await H.ready(page);
    }
    return { ok: unload.unexpected.length === 0, unexpected: unload.unexpected, armed, lost };
  });

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
  // A beforeunload question (unsaved work, ADR 0045) is expected only on the recovery reload
  // after a timeout, and only while the page's guard is armed. Any other one is recorded and
  // fails no-unexpected-unload-prompt (it is accepted so the run can go on).
  const unload = { expected: false, unexpected: [] };
  page.on('dialog', (d) => {
    if (d.type() !== 'beforeunload') return d.dismiss().catch(() => {});
    if (!unload.expected) unload.unexpected.push(page.url());
    return d.accept().catch(() => {});
  });
  const results = {};
  await page.goto(baseUrl, { waitUntil: 'load' });
  try {
    await H.ready(page);
  } catch (e) {
    results.ready = { ok: false, detail: 'html[data-ready] not set', errors };
    await browser.close();
    return results;
  }
  for (const { name, fn, timeoutMs = CHECK_TIMEOUT_MS } of defineChecks()) {
    if (ONLY && !ONLY.has(name) && name !== 'boot-no-console-errors') continue;
    const t0 = Date.now();
    // A check that runs out of time is told to stop (run.aborted) and the page is reloaded:
    // otherwise its loop keeps driving the page underneath the next check.
    const run = { aborted: false };
    try {
      const v = await Promise.race([
        fn({ page, context, errors, baseUrl, browserName, origin, run, unload }),
        sleep(timeoutMs).then(() => {
          run.aborted = true;
          return { ok: false, detail: `timeout ${timeoutMs / 1000} s`, timedOut: true };
        }),
      ]);
      results[name] = { ...v, ms: Date.now() - t0 };
      if (v.timedOut) {
        unload.expected = await page.evaluate(() => !!(window.OSCILLA.unsaved
          && window.OSCILLA.unsaved.armed)).catch(() => false);
        await page.goto(baseUrl, { waitUntil: 'load' });
        unload.expected = false;
        await H.ready(page);
      }
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
  let known = 0;
  try {
    for (const b of BROWSERS) {
      for (const o of ORIGINS) {
        const base = o === 'file' ? pathToFileURL(DIST).href : server.url;
        const key = `${b}/${o}`;
        const t0 = Date.now();
        const res = await runOne(b, o, base);
        all[key] = res;
        const names = Object.keys(res);
        const bad = names.filter((n) => !res[n].ok && !KNOWN_DEFECTS[n]);
        const open = names.filter((n) => !res[n].ok && KNOWN_DEFECTS[n]);
        // A known defect that now passes fails the gate until its entry is removed.
        const stale = names.filter((n) => res[n].ok && KNOWN_DEFECTS[n]);
        failed += bad.length + stale.length;
        known += open.length;
        console.log(`${bad.length || stale.length ? 'FAIL' : 'PASS'} ${key}: `
          + `${names.length - bad.length - open.length}/${names.length} checks`
          + `${open.length ? `, ${open.length} known defect(s)` : ''}`
          + ` (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        for (const n of bad) console.log(`   x ${n}: ${JSON.stringify(res[n]).slice(0, 600)}`);
        for (const n of open) console.log(`   ! ${n}: KNOWN DEFECT, tracked as ${KNOWN_DEFECTS[n]}`);
        for (const n of stale) {
          console.log(`   x ${n}: passes now; remove it from KNOWN_DEFECTS (${KNOWN_DEFECTS[n]})`);
        }
      }
    }
  } finally {
    if (server) {
      server.proc.kill();
      fs.rmSync(server.root, { recursive: true, force: true });
    }
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(all, null, 2)}\n`);
  if (known) console.log(`${known} known-defect result(s) reported above, each tracked in the plan`);
  process.exit(failed ? 1 : 0);
})();

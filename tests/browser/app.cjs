#!/usr/bin/env node
// OSCILLA dist release gate: the built dist/index.html in chromium, firefox and webkit, each
// from file:// AND from a GitHub-Pages-like sub-path (http://127.0.0.1:<port>/oscilla/ served by
// python3 -m http.server).
//
//   node tests/browser/app.cjs [--dist dist/index.html] [--browsers chromium,firefox,webkit]
//                              [--origins file,http] [--only name1,name2] [--json out.json]
//
// Playwright resolves from app/node_modules or NODE_PATH (e.g. <checkout>/tests/
// node_modules). Exit code 1 when any check fails.
'use strict';
const { serveDist } = require('./lib/serve.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { until } = require('./lib/wait.cjs');
const seam = require('./lib/measure-seam.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DIST = path.resolve(arg('dist', path.join(__dirname, '..', '..', 'dist', 'index.html')));
const RUN = suite.open({ name: 'app', browsers: arg('browsers'),
  origins: arg('origins'), defaultOrigins: ['file', 'http'] });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const ORIGINS = RUN.origins;
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

/**
 * Harmonics of a steady tone of `f0` Hz in a 16-bit PCM WAV (first channel): Goertzel with a
 * Hann window over the middle half of the span where the signal exceeds half its peak, at the
 * file's own rate. Returns { h2, h3 } in dB relative to the fundamental.
 */
function toneHarmonicsDb(buf, f0) {
  const h = parseWavHeader(buf);
  let off = 12;
  while (buf.toString('ascii', off, off + 4) !== 'data') off += 8 + buf.readUInt32LE(off + 4);
  const step = h.channels * 2;
  const x = new Float64Array(h.frames);
  for (let i = 0; i < h.frames; i++) x[i] = buf.readInt16LE(off + 8 + i * step) / 32768;
  let first = -1;
  let last = -1;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) > h.peak / 2) { if (first < 0) first = i; last = i; }
  }
  const span = last - first;
  const a = first + Math.floor(span / 4);
  const n = Math.floor(span / 2);
  const power = (f) => {
    const w = (2 * Math.PI * f) / h.sampleRate;
    const c = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      const s0 = x[a + i] * win + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return s1 * s1 + s2 * s2 - c * s1 * s2;
  };
  const p1 = power(f0);
  const db = (p) => 10 * Math.log10(Math.max(p, 1e-30) / p1);
  return { h2: +db(power(2 * f0)).toFixed(1), h3: +db(power(3 * f0)).toFixed(1), frames: n };
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
    await page.waitForFunction((w) => document.querySelector('#osc-app').dataset.mode === w, ws,
      { timeout: 8000 });
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

// ------------------------------------------------------------------------------ UI drivers
// The control-drive checks (C020) operate each control the way a user does and then poll,
// against a named wall-clock deadline (rule project.bounded-test-timing), until the subsystem
// the control drives (engine voice, lab stage, model) and a view that reflects it (a readout, a
// chart, an aria state) both show the change. tests/unit/control-drive-baseline.test.mjs
// requires that every control of src/index.html is driven somewhere in tests/browser.
const U = {
  /** A typed value committed with Enter (text and number fields commit on change). */
  fill: async (page, sel, text) => {
    await page.fill(sel, text);
    await page.press(sel, 'Enter');
  },
  /** Focus the control, then press keys (the keyboard path of a slider, radio or switch). */
  press: async (page, sel, ...keys) => {
    await page.focus(sel);
    for (const k of keys) await page.keyboard.press(k);
  },
  /** A pointer click on a slider's track at the fraction `at` of its width. */
  tap: async (page, sel, at) => {
    const l = page.locator(sel);
    await l.scrollIntoViewIfNeeded();
    const b = await l.boundingBox();
    await page.mouse.click(b.x + b.width * at, b.y + b.height / 2);
  },
  /**
   * Poll fn() until test(value) holds and return that value; on the deadline the error names
   * the step (`what`) and carries the last value read.
   */
  poll: async (fn, test, what, ms = 8000) => {
    let last;
    try {
      const hit = await until(async () => {
        last = await fn();
        return test(last) ? { v: last } : null;
      }, { ms, what });
      return hit.v;
    } catch (e) {
      throw new Error(`${e.message}; last ${JSON.stringify(last).slice(0, 1500)}`);
    }
  },
  /** Level (dBFS) of one frequency on the engine's post-chain analyser: Goertzel on a
   *  Hann-windowed time block, so the analyser's smoothing does not decide the result. */
  toneDb: (page, hz) => page.evaluate((f) => {
    const e = window.OSCILLA.engine;
    const an = e.analyser;
    if (!an) return -240;
    const n = an.fftSize;
    const x = new Float32Array(n);
    an.getFloatTimeDomainData(x);
    const w = (2 * Math.PI * f) / e.ctx.sampleRate;
    let re = 0;
    let im = 0;
    let ws = 0;
    for (let i = 0; i < n; i++) {
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      ws += h;
      re += x[i] * h * Math.cos(w * i);
      im -= x[i] * h * Math.sin(w * i);
    }
    return 20 * Math.log10((2 * Math.hypot(re, im)) / ws + 1e-12);
  }, hz),
  /** Latch the instrument on (the status bar's Play key with continuous playback allowed). */
  latch: (page) => page.evaluate(() => {
    const a = window.OSCILLA.app;
    a.setContinuous(true);
    if (!a.latched) a.toggleLatch();
  }),
  /** The oscillator source again (the dual switch off), from the Synthesis panel. */
  singleSource: async (page) => {
    if (await page.evaluate(() => window.OSCILLA.app.source) !== 'dual') return;
    await H.workspace(page, 'synthesis');
    await page.click('#osc-dual-enable');
    await U.poll(() => page.evaluate(() => window.OSCILLA.app.source), (v) => v !== 'dual',
      'the dual switch returns the instrument to one oscillator', 5000);
  },
  unlatch: async (page) => {
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      if (a.latched) a.toggleLatch();
      a.stopNow();
    });
    await U.poll(() => H.nodes(page), (n) => n === 0, 'the latched tone is torn down', 5000);
  },
};

/** Accessible-name + reachability audit of every interactive [data-osc] element, in-page. */
function auditControls() {
  const INTERACTIVE = 'button, input, select, textarea, summary, a[href], [role="switch"],'
    + ' [role="tab"],'
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
  // Repeated controls (the compact Studio's node and clip chips) share a data-osc: their
  // node or clip id tells them apart, so a walk does not stop at the second chip.
  const key = el.id || (el.dataset.osc ? [el.dataset.osc, el.dataset.nodeId, el.dataset.clipId]
    .filter(Boolean).join(':') : el.outerHTML.slice(0, 60));
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

/**
 * In-page: a fake media device that every engine has (WebKit has no fake capture device):
 * getUserMedia answers with a fresh stream of a MediaStreamDestination of a context the test
 * owns, never connected to OSCILLA's output. window.__oscSynthMic.restore() puts the original
 * getUserMedia back and closes that context.
 */
function installSynthMic() {
  const md = navigator.mediaDevices;
  const orig = md && typeof md.getUserMedia === 'function' ? md.getUserMedia : null;
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const gum = () => {
    const dst = ctx.createMediaStreamDestination();
    return Promise.resolve(dst.stream);
  };
  const mic = { restore: () => {} };
  if (md) {
    md.getUserMedia = gum;
    mic.restore = () => { if (orig) md.getUserMedia = orig; else delete md.getUserMedia; };
  } else {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: gum },
      configurable: true });
    mic.restore = () => { delete navigator.mediaDevices; };
  }
  const restore = mic.restore;
  mic.restore = () => { restore(); ctx.close().catch(() => {}); };
  window.__oscSynthMic = mic;
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
  // `studioTimeline` left the list with ledger W7a: it built a second Studio store and
  // transport, and the timeline suite now drives the canonical ones.
  def('seam-surface-pinned', async ({ page }) => {
    const OSCILLA_KEYS = ['engine', 'viz', 'adapter', 'labs', 'labErrors', 'app', 'host',
      'measure', 'experiments', 'studio', 'navigation', 'unsaved', 'buildPlan', 'planFreqAt',
      'parseFrequency', 'parseFrequencyList', 'formatFrequency', 'formatPeriod',
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

  // Ledger W7b (ADR 0052): TEST CONTEXT is a choice of the MEASURE Input device list. It is
  // entered and left from the page; leaving clears what was produced in it (here a setup
  // check and an INVALID result with its noise-check snapshot; a COMPLETE result is in the unit
  // suite, tests/unit/v4-test-context-choice.test.mjs). A level calibration typed on it is
  // kept and reads UNCALIBRATED, with the reason, outside it (owner decision of 2026-10-11).
  // With the fake microphone (chromium, firefox on http) a level calibration stored on a real
  // input survives entering and leaving and reads UNCALIBRATED, with the reason, while the page
  // is in TEST CONTEXT.
  def('test-context-from-the-page', async ({ page, browserName, origin }) => {
    const TC_LABEL = 'TEST CONTEXT · digital loopback (no microphone)';
    const SELECT = '#osc-m-input-device';
    await H.workspace(page, 'measure');
    const view = () => page.evaluate(() => {
      const a = window.OSCILLA.app;
      const m = window.OSCILLA.measure;
      const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
      const sel = document.getElementById('osc-m-input-device');
      const banner = document.querySelector('[data-osc="measure.testContext"]');
      return { loopback: a.meas.loopback, value: sel.value, disabled: sel.disabled,
        selected: text(sel.selectedOptions[0]), options: [...sel.options].map(text),
        status: text(document.getElementById(sel.getAttribute('aria-describedby'))),
        banner: banner.offsetParent !== null ? text(banner) : null,
        chip: text(document.querySelector('#osc-measure-input .osc-m-chip')),
        flag: new URLSearchParams(window.location.search).get('measure'),
        state: m.state, ioKind: m.ioKind, inputNow: !!m.inputNow, level: !!m.levelCalibration,
        indicator: a.measureCalIndicator, polite: a.meas.live.polite,
        assertive: a.meas.live.assertive, levelVoid: a.meas.cal.levelVoid,
        result: m.result ? m.result.state : null,
        resultLabel: m.result && m.result.testContext ? m.result.testContext.kind : null,
        reasons: m.result ? m.result.reasons.map((r) => r.code) : null,
        rta: a.meas.rta ? a.meas.rta.badges.slice() : null,
        noiseStep: a.meas.flow.steps.find((s) => s.id === 'noise').status,
        primary: text(document.getElementById('osc-measure-primary')),
        toasts: a.alerts.map((t) => `${t.title}: ${t.message}`) };
    });
    const typeLevel = () => page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.measureOpenLevelCalibration();
      a.measureSetLevelManual(true);
      Object.assign(a.meas.levelForm, { referenceHz: '1000', referenceDb: '94',
        observedDb: '-30' });
      const stored = a.measureSaveLevelCalibration();
      a.measureSetLevelManual(false);
      return stored;
    });
    const check = async () => {
      await page.click('#osc-measure-primary');
      return H.until(view, (v) => v.state === 'READY' && v.inputNow, 15000);
    };
    const enter = async () => {
      await page.selectOption(SELECT, { label: TC_LABEL }, { timeout: 5000 });
      return H.until(view, (v) => v.loopback && !!v.banner && /^TEST CONTEXT/.test(v.polite),
        3000);
    };
    const leave = async () => {
      await page.selectOption(SELECT, '', { timeout: 5000 });
      return H.until(view, (v) => !v.loopback && !v.banner && /^Left TEST CONTEXT/
        .test(v.polite), 3000);
    };
    const zero = (c) => c.ioNodes === 0 && c.ioSources === 0 && c.captures === 0
      && c.ports === 0 && c.tracks === 0;
    const released = () => H.until(() => page.evaluate(() => window.OSCILLA.measure.counts()),
      zero, 3000);

    const before = await view();
    const entered = await enter();
    const checked = await check();
    const stored = await typeLevel();
    const calibrated = await view();
    const left = await leave();
    const counts = await released();
    const res = {
      offered: !before.loopback && !before.disabled && before.value === ''
        && before.options.at(-1) === TC_LABEL && before.banner === null
        && before.chip === 'Microphone',
      entered: entered.loopback && entered.selected === TC_LABEL && !entered.disabled
        && /^TEST CONTEXT\./.test(entered.banner || '')
        && entered.chip === 'TEST CONTEXT loopback'
        && /no input device is used\. Choose an input to leave TEST CONTEXT/
          .test(entered.status)
        && /^TEST CONTEXT: digital loopback, no microphone/.test(entered.polite),
      checkedInIt: checked.state === 'READY' && checked.ioKind === 'loopback'
        && checked.inputNow && stored === true && calibrated.level
        && calibrated.indicator === 'CALIBRATED',
      left: !left.loopback && left.value === '' && left.banner === null
        && left.chip === 'Microphone' && !left.disabled,
      cleared: left.state === 'IDLE' && !left.inputNow && left.indicator === 'UNCALIBRATED'
        && /Cleared: the input check\. Run the /.test(left.polite)
        && left.toasts.some((t) => /^Left TEST CONTEXT: Cleared/.test(t)),
      // The calibration typed in TEST CONTEXT is kept, void outside it (decision 2026-10-11).
      calibrationKept: left.level && !/level calibration/.test(left.polite)
        && /^UNCALIBRATED: the level calibration was made in TEST /.test(left.levelVoid || ''),
      released: zero(counts),
      // The address follows the choice where the browser rewrites it (not judged on file://).
      address: origin !== 'http' || (before.flag === null && entered.flag === 'loopback'
        && left.flag === null),
    };
    const detail = { before, entered, checked, calibrated, left, counts };
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    // Review of #167: an INVALID result made in TEST CONTEXT, by page actions only (the volume
    // at 0: the loopback hears digital silence). It has no transfer and nothing titled
    // "TEST CONTEXT result"; it, its noise-check snapshot and the outcome said for it must not
    // stay under the input chosen next.
    const gain = () => page.$eval('#osc-gain', (el) => Number(el.value));
    const setGain = async (pct) => {
      await page.$eval('#osc-gain', (el, v) => {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, pct);
      return H.until(gain, (v) => v === pct, 3000);
    };
    const gainWas = await gain();
    await enter();
    // A short recipe, as a recipe link would set it (the seam's setValues is that validation).
    const shortened = await seam.applyValues(page, { duration: 1, repeats: 1, noiseCheckS: 0.5,
      preRollS: 0.25, postRollS: 0.5 });
    // The setup check refuses a zero output level, so the volume goes down after it is READY.
    await check();
    await setGain(0);
    await page.click('#osc-measure-primary');
    const invalid = await H.until(view, (v) => ['INVALID', 'COMPLETE', 'ABORTED', 'ERROR']
      .includes(v.state) && v.result !== null && v.assertive !== '', 45000);
    const leftInvalid = await leave();
    res.invalidInIt = shortened === true && invalid.state === 'INVALID'
      && invalid.result === 'INVALID' && invalid.reasons.includes('NO_INPUT')
      && invalid.resultLabel === 'digital-loopback' && invalid.noiseStep === 'done'
      && Array.isArray(invalid.rta) && invalid.rta.includes('NOISE CHECK SNAPSHOT')
      && /^Measurement invalid/.test(invalid.assertive);
    res.invalidCleared = leftInvalid.result === null && leftInvalid.rta === null
      && leftInvalid.noiseStep !== 'done' && leftInvalid.state === 'IDLE'
      && leftInvalid.assertive === '' && leftInvalid.chip === 'Microphone'
      && /Cleared: the invalid TEST CONTEXT result/.test(leftInvalid.polite)
      && leftInvalid.toasts.some((t) => /the invalid TEST CONTEXT result/.test(t));
    await setGain(gainWas);
    res.releasedAfterInvalid = zero(await released());
    Object.assign(detail, { gainWas, shortened, invalid, leftInvalid });
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    if (FAKE_MIC.has(browserName) && origin === 'http') {
      // A real input: its check ends when TEST CONTEXT is entered, its calibration stays.
      const mic = await check();
      const micStored = await typeLevel();
      const micCal = await view();
      const inIt = await enter();
      const back = await leave();
      res.realInputKept = mic.ioKind === 'microphone' && micStored === true
        && micCal.indicator === 'CALIBRATED' && inIt.level && !inIt.inputNow
        && inIt.indicator === 'UNCALIBRATED'
        && /^UNCALIBRATED: the level calibration was taken with a microphone/
          .test(inIt.levelVoid || '') && back.level
        && !back.inputNow && back.levelVoid === null
        && back.indicator === 'PENDING INPUT CHECK'
        && !back.toasts.some((t) => /level calibration/.test(t));
      Object.assign(detail, { mic, micCal, inIt, back });
      await page.evaluate(() => {
        window.OSCILLA.app.measureClearLevelCalibration();
        window.OSCILLA.app.alerts = [];
      });
      res.releasedAfterMic = zero(await released());
    }
    // The calibration typed in TEST CONTEXT is kept: the checks after this one start without it.
    await page.evaluate(() => window.OSCILLA.app.measureClearLevelCalibration());
    await H.workspace(page, 'playground'); // the checks after this one start there
    const failed = Object.keys(res).filter((k) => !res[k]);
    return failed.length ? { ok: false, failed, detail } : { ok: true, ...res };
  });

  // Ledger W7f and W7c (ADR 0052, ADR 0017): the level indicator reads CALIBRATED only for an
  // input that was checked in the context the page is in. An input named in TEST CONTEXT (by
  // the loopback, by setInputNow or by a TEST CONTEXT result) is not a checked input once the
  // page is on the microphone, a level calibration made in one context does not apply in the
  // other, and one typed by hand in TEST CONTEXT says so. On its own page: it leaves a result
  // and a calibration behind.
  def('calibrated-only-for-a-checked-input', async ({ context, baseUrl, browserName, origin }) => {
    const p = await context.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    const MIC = { device: { label: 'Mic A', id: 'mic-a' },
      constraints: { requested: null, applied: { echoCancellation: false,
        noiseSuppression: false, autoGainControl: false, channelCount: 1 } } };
    /** The level state now: the getters the indicator renders, and what is stored. */
    const now = () => p.evaluate(() => {
      const a = window.OSCILLA.app;
      const m = window.OSCILLA.measure;
      const c = m.levelCalibration;
      return { input: m.inputNow ? 'known' : null, indicator: a.measureCalIndicator,
        levels: a.measureLevelsText, void: a.meas.cal.levelVoid,
        pending: !!a.meas.cal.levelPending, stored: !!c, conditions: c ? c.conditions : null,
        state: a.measureLevelStateText, testContext: !!a.meas.loopback,
        // Every other place the page states a level: the Calibration step and the views.
        step: a.meas.flow.steps.find((s) => s.id === 'calibration').detail,
        title: a.meas.shownTitle,
        rta: a.meas.rta ? { badges: a.meas.rta.badges.slice(), yLabel: a.meas.rta.yLabel } : null,
        response: a.meas.response ? { badges: a.meas.response.badges.slice(),
          yLabel: a.meas.response.yLabel } : null };
    });
    /** A view that exists and claims no absolute level. */
    const relative = (view) => !!view && !view.badges.includes('CALIBRATED')
      && !/dB SPL/.test(view.yLabel);
    /** Check setup on the microphone; resolves when the check has ended. */
    const checkMicrophone = async (what) => {
      await inPage(() => { window.OSCILLA.app.measureCheck(); }); // the poll below is the wait
      return until(() => inPage(() => {
        const m = window.OSCILLA.measure;
        return ['READY', 'INVALID', 'ERROR'].includes(m.state)
          ? { state: m.state, kind: m.ioKind, input: m.inputNow ? 'known' : null } : null;
      }), { ms: 15000, what });
    };
    /** Type a reading by hand and press Store; resolves to the verdict and the state after. */
    const typeReading = async (conditions = '') => {
      const tried = await p.evaluate((text) => {
        const a = window.OSCILLA.app;
        a.measureSetLevelManual(true);
        Object.assign(a.meas.levelForm, { referenceHz: '1000', referenceDb: '94',
          observedDb: '-30', conditions: text });
        return { note: a.measureLevelManualNote, saved: a.measureSaveLevelCalibration(),
          error: a.meas.levelForm.error };
      }, conditions);
      return { ...tried, ...await now() };
    };
    const inPage = (fn, arg) => p.evaluate(fn, arg);
    const NEEDS_INPUT = /^Run the setup check first: a level calibration is valid only for the/;
    /** Nothing to bind to: no input, the typed reading refused with the reason, no CALIBRATED. */
    const refused = (r) => r.input === null && r.saved === false && NEEDS_INPUT.test(r.error)
      && NEEDS_INPUT.test(r.note) && !r.stored && r.indicator === 'UNCALIBRATED'
      && r.levels === 'relative (dBFS-like)';
    const indicatorText = () => p.evaluate(() => document
      .querySelector('[data-osc="measure.levelIndicator"]').textContent.replace(/\s+/g, ' ')
      .trim());
    const res = {};
    try {
      await p.goto(baseUrl, { waitUntil: 'load' });
      await H.ready(p);
      await H.workspace(p, 'measure');
      // A real TEST CONTEXT measurement: its setup check names the loopback input.
      res.setup = await inPage(() => {
        const m = window.OSCILLA.measure;
        return { loopback: m.useLoopback(), values: m.setValues({ duration: 1, repeats: 1,
          noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5, gapS: 0.2 }) };
      });
      await inPage(() => window.OSCILLA.app.measureStart());
      res.run = await until(() => inPage(() => {
        const m = window.OSCILLA.measure;
        return ['COMPLETE', 'INVALID', 'ABORTED', 'ERROR'].includes(m.state)
          ? { state: m.state, input: m.inputNow ? 'known' : null,
            testContext: !!(m.result && m.result.testContext) } : null;
      }), { ms: 45000, what: 'the TEST CONTEXT measurement ends' });
      // Route A with the input the loopback's own check named ...
      res.leftLoopback = await inPage(() => {
        window.__oscResult = window.OSCILLA.measure.result;
        return window.OSCILLA.measure.useMicrophone();
      });
      // Nothing shown in TEST CONTEXT stays on the microphone page (review of #169).
      res.afterLeaving = await now();
      res.afterCheck = await typeReading();
      // ... and with an input injected in TEST CONTEXT.
      res.injected = await inPage((input) => {
        const m = window.OSCILLA.measure;
        return { loopback: m.useLoopback(), set: m.setInputNow({ ...input,
          sampleRate: window.OSCILLA.engine.ctx.sampleRate }), known: !!m.inputNow,
        left: m.useMicrophone() };
      }, MIC);
      res.afterInject = await typeReading();
      // Route B: a TEST CONTEXT result shown while the page is on the microphone.
      res.shown = await inPage(() => ({ ok: window.OSCILLA.measure.showResult(window.__oscResult),
        title: window.OSCILLA.app.meas.shownTitle }));
      res.afterShow = await typeReading();
      // In TEST CONTEXT the typed reading is stored, labelled (W7c), and applies there only.
      res.inContext = await inPage((input) => {
        const m = window.OSCILLA.measure;
        return { loopback: m.useLoopback(), set: m.setInputNow({ ...input,
          sampleRate: window.OSCILLA.engine.ctx.sampleRate }) };
      }, MIC);
      res.typedInContext = await typeReading('calibrator on the capsule');
      res.left = await inPage(() => window.OSCILLA.measure.useMicrophone());
      res.outside = await now();
      res.outsideText = await until(async () => {
        const t = await indicatorText();
        return t === 'Level UNCALIBRATED' ? t : null;
      }, { ms: 5000, what: 'the level indicator reads UNCALIBRATED outside TEST CONTEXT' })
        .catch(() => indicatorText());
      const v = {
        setup: res.setup.loopback === true && res.setup.values === true,
        ran: res.run.state === 'COMPLETE' && res.run.input === 'known' && res.run.testContext,
        routeACheck: res.leftLoopback === true && refused(res.afterCheck),
        nothingLeftBehind: res.afterLeaving.title === null && res.afterLeaving.rta === null
          && res.afterLeaving.response === null,
        routeAInject: res.injected.loopback && res.injected.set === true && res.injected.known
          && res.injected.left === true && refused(res.afterInject),
        routeB: res.shown.ok === true && res.shown.title === 'TEST CONTEXT result'
          && refused(res.afterShow),
        inContext: res.inContext.set === true && res.typedInContext.saved === true
          && res.typedInContext.indicator === 'CALIBRATED' && res.typedInContext.testContext
          && /level CALIBRATED$/.test(res.typedInContext.step),
        labelled: /^TEST CONTEXT: .* calibrator on the capsule$/
          .test(res.typedInContext.conditions || '')
          && /^TEST CONTEXT reference reading stored/.test(res.typedInContext.state),
        outside: res.left === true && !res.outside.testContext && res.outside.input === null
          && res.outside.indicator === 'UNCALIBRATED' && !res.outside.pending
          && /^UNCALIBRATED: the level calibration was made in TEST CONTEXT/
            .test(res.outside.void || '')
          && res.outsideText === 'Level UNCALIBRATED'
          && /level relative \(dBFS-like\)$/.test(res.outside.step),
      };
      // With a fake microphone: the checked microphone is the one input a reading binds to,
      // and that calibration does not apply in TEST CONTEXT.
      if (FAKE_MIC.has(browserName) && origin === 'http') {
        await inPage(() => window.OSCILLA.app.measureClearLevelCalibration());
        res.micCheck = await checkMicrophone('the microphone setup check ends');
        // The third sequence: a reading typed in TEST CONTEXT for an injected input with the
        // checked microphone's own binding, then a real check of that microphone. The binding
        // matches field for field; the calibration still does not apply.
        res.sameBinding = await inPage(() => {
          const m = window.OSCILLA.measure;
          const input = JSON.parse(JSON.stringify(m.inputNow));
          const left = m.setValues({ repeats: 1 }); // an edit: the READY check is reset
          return { left, loopback: m.useLoopback(), set: m.setInputNow(input) };
        });
        res.typedSameBinding = await typeReading('same binding, typed in TEST CONTEXT');
        res.backForCheck = await inPage(() => window.OSCILLA.measure.useMicrophone());
        res.micCheckAgain = await checkMicrophone('the second microphone setup check ends');
        res.afterRealCheck = await now();
        await inPage(() => window.OSCILLA.app.measureClearLevelCalibration());
        res.micTyped = await typeReading('on the microphone');
        // A TEST CONTEXT result shown on the microphone page, with a microphone calibration
        // stored and its input checked: the result's views never take that calibration ...
        res.shownChecked = await inPage(() => window.OSCILLA.measure
          .showResult({ ...window.__oscResult, input: null }));
        res.afterShownChecked = await now();
        // ... nor, once the result has named its own (TEST CONTEXT) input, a pending one (P1).
        res.shownPending = await inPage(() => window.OSCILLA.measure
          .showResult({ ...window.__oscResult }));
        res.afterShownPending = await now();
        res.intoLoopback = await inPage(() => window.OSCILLA.measure.useLoopback());
        res.micCalInLoopback = await now();
        res.backOnMic = await inPage(() => window.OSCILLA.measure.useMicrophone());
        res.micCalUnchecked = await now();
        v.micChecked = res.micCheck.state === 'READY' && res.micCheck.kind === 'microphone'
          && res.micCheck.input === 'known';
        v.micCalibrated = res.micTyped.saved === true && res.micTyped.indicator === 'CALIBRATED'
          && res.micTyped.conditions === 'on the microphone'
          && /^reference reading stored/.test(res.micTyped.state);
        v.micCalNotInLoopback = res.intoLoopback === true && res.micCalInLoopback.testContext
          && res.micCalInLoopback.indicator === 'UNCALIBRATED'
          && /^UNCALIBRATED: the level calibration was taken with a microphone/
            .test(res.micCalInLoopback.void || '');
        v.micCalPendingAgain = res.backOnMic === true && res.micCalUnchecked.input === null
          && res.micCalUnchecked.indicator === 'PENDING INPUT CHECK'
          && /level pending input check$/.test(res.micCalUnchecked.step);
        v.thirdSequence = res.sameBinding.left === true && res.sameBinding.loopback === true
          && res.sameBinding.set === true && res.typedSameBinding.saved === true
          && res.typedSameBinding.indicator === 'CALIBRATED' && res.backForCheck === true
          && res.micCheckAgain.state === 'READY' && res.micCheckAgain.kind === 'microphone'
          && res.afterRealCheck.input === 'known' && res.afterRealCheck.stored
          && res.afterRealCheck.indicator === 'UNCALIBRATED'
          && /^UNCALIBRATED: the level calibration was made in TEST CONTEXT/
            .test(res.afterRealCheck.void || '')
          && /level relative \(dBFS-like\)$/.test(res.afterRealCheck.step);
        v.testResultNeverTakesMicCal = res.shownChecked === true
          && res.afterShownChecked.title === 'TEST CONTEXT result'
          && res.afterShownChecked.input === 'known'
          && res.afterShownChecked.indicator === 'CALIBRATED'
          && relative(res.afterShownChecked.rta) && relative(res.afterShownChecked.response);
        v.pendingIsRelative = res.shownPending === true
          && res.afterShownPending.title === 'TEST CONTEXT result'
          && res.afterShownPending.input === null
          && res.afterShownPending.indicator === 'PENDING INPUT CHECK'
          && /level pending input check$/.test(res.afterShownPending.step)
          && relative(res.afterShownPending.rta) && relative(res.afterShownPending.response);
      } else {
        res.microphone = 'not run: no fake microphone on this browser and origin';
      }
      const failed = Object.keys(v).filter((k) => !v[k]);
      return { ok: failed.length === 0 && errs.length === 0, failed, errs, ...res };
    } finally {
      await p.close({ runBeforeUnload: false }).catch(() => {});
    }
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
    // From 1280 px the Playground leaves Phase & Stereo and Filter Lab to their workspaces
    // (P002, Q004 option A): their tabs are pressed there.
    await H.workspace(page, 'compare');
    await page.click('#osc-ptab-stereo');
    await collect();
    await page.click('#osc-ptab-phase');
    await page.click('#osc-mtab-compare');
    await collect();
    await page.click('#osc-mtab-live');
    await H.workspace(page, 'filter');
    await page.click('#osc-ftype-peaking');
    await collect();
    await page.click('#osc-ftype-lowpass');
    await H.workspace(page, 'analyzer'); // the Spectrogram panel's own controls
    await collect();
    await H.workspace(page, 'playground');
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
    // Compare shows the microphone analyzer's counterpart links (U005), as the Analyzer does.
    for (const ws of ['synthesis', 'compare', 'learn', 'presets']) {
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
    // The cross-links shown in one workspace only (U010): the Sequencer's and Filter Lab's
    // Studio links, and Experiments before anything is saved (its empty list leads to Measure).
    for (const ws of ['sequencer', 'filter', 'experiments']) {
      await H.workspace(page, ws);
      if (ws === 'experiments') {
        await page.waitForFunction(() => window.OSCILLA.app.exps.loaded, null,
          { timeout: 10000 }).catch(() => {});
      }
      await collect();
    }
    await H.workspace(page, 'about');
    await collect();
    // MEASURE and EXPERIMENTS: every state that shows a control. A TEST CONTEXT loopback
    // measurement (2 runs) gives the result tabs, Save/Repeat and, saved twice, two experiments
    // for the detail, compare and dialog controls.
    await H.workspace(page, 'measure');
    await seam.loopback(page, { values: { duration: 1, repeats: 2, noiseCheckS: 0.5,
      preRollS: 0.25, postRollS: 0.5, gapS: 0.2 } });
    await page.evaluate(() => window.OSCILLA.app.measureSetExpert(true));
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
    // Findings (ADR 0046): the run detail's buttons, the dialog with a comparison linked, a
    // listed finding's buttons and its delete dialog.
    await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      if (a.exps.rows[0]) await a.experimentsOpen(a.exps.rows[0].id);
    });
    await page.waitForSelector('[data-osc="exp.findingNew"]', { state: 'visible', timeout: 5000 })
      .catch(() => {});
    // Connected records (ADR 0048): the open experiment is a duplicate, so its section holds a
    // link; the definition and finding rows carry their disclosure.
    await page.waitForSelector('[data-osc="cnx.link"]', { state: 'visible', timeout: 10000 })
      .catch(() => {});
    await collect();
    await page.click('[data-osc="exp.findingNew"]');
    await page.waitForSelector('#osc-fnd-statement', { state: 'visible', timeout: 5000 })
      .catch(() => {});
    await page.fill('#osc-fnd-statement', 'audit finding');
    await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      const [x, y] = a.exps.rows;
      if (x && y) await a.findingsAddCompare(x.id, y.id);
    });
    await page.waitForSelector('[data-osc="fnd.removeRef"]', { state: 'visible', timeout: 5000 })
      .catch(() => {});
    await collect();
    await page.click('[data-osc="fnd.save"]');
    await page.waitForSelector('[data-osc="fnd.edit"]', { state: 'visible', timeout: 5000 })
      .catch(() => {});
    await collect();
    await page.click('[data-osc="fnd.delete"]');
    await page.waitForSelector('[data-osc="fnd.deleteConfirm"]', { state: 'visible',
      timeout: 5000 }).catch(() => {});
    await collect();
    await page.click('[data-osc="fnd.deleteConfirm"]');
    // A refused stale edit: "Load the stored version", then the typed text kept to copy.
    await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      await a.findingsAskRun(a.exps.rows[0].id);
      a.fnd.form.statement = 'audit conflict';
      const f = await a.findingsSave();
      if (!f) return;
      await a.findingsAskEdit(f.id);
      a.fnd.form.statement = 'audit edit';
      const s = await a.experimentsStore();
      const now = await s.getFinding(f.id);
      await s.putFinding({ ...now, statement: 'audit other tab',
        updatedAt: new Date(Date.parse(now.updatedAt) + 1000).toISOString() });
      await a.findingsSave();
    });
    await page.waitForSelector('[data-osc="fnd.loadStored"]', { state: 'visible', timeout: 5000 })
      .catch(() => {});
    await collect();
    await page.click('[data-osc="fnd.loadStored"]');
    await page.waitForSelector('[data-osc="fnd.mine"]', { state: 'visible', timeout: 5000 })
      .catch(() => {});
    await collect();
    await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      a.findingsDiscardDraft();
      for (const r of a.fnd.rows.slice()) await a.findingsDeleteNow(r.id);
    });
    // A draft kept after Escape: the panel's note offers to continue or discard it.
    await page.click('[data-osc="exp.findingNew"]');
    await page.waitForSelector('#osc-fnd-statement', { state: 'visible', timeout: 5000 })
      .catch(() => {});
    await page.fill('#osc-fnd-statement', 'audit draft');
    await page.waitForSelector('[data-osc="fnd.discard"]', { state: 'visible', timeout: 5000 })
      .catch(() => {});
    await collect();
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-osc="fnd.draftNote"]', { state: 'visible', timeout: 5000 })
      .catch(() => {});
    await collect();
    await page.click('[data-osc="fnd.draftDiscard"]');
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
    // V501: Connect MIDI is offered only where this build and origin expose Web MIDI (ADR 0058);
    // where the page does not offer it (WebKit, Firefox on file://) its hidden row is correct.
    const midiOffered = await page.evaluate(() => !!(window.OSCILLA.app
      && window.OSCILLA.app.midiCanConnect));
    const notOffered = midiOffered ? [] : ['midi.connect'];
    const neverVisible = list.filter((c) => !c.visible && !notOffered.includes(c.osc))
      .map((c) => c.osc);
    // Controls the audit must have met (they exist only in a state the audit sets up).
    const unseen = ['cnx.link', 'cnx.toggle'].filter((k) => !seen.has(k));
    return { ok: !unlabelled.length && !unreachable.length && !neverVisible.length
      && !unseen.length, unseen,
      controls: list.length, unlabelled, unreachable, neverVisible, notOffered, measureState };
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

  // C013 (finding vis-divergence-1): the scope and its canvas label follow the output owner.
  // Sequencer Play and the Playground's compact Studio Play each sound through the one output
  // analyser; the scope then draws the live trace named after that owner, the aria label says
  // the same, and with reduced motion on the loop keeps drawing (several frames, not one redraw).
  def('scope-follows-owner', async ({ page }) => {
    const owner = () => page.evaluate(() => window.OSCILLA.viz.state.outputOwner);
    await page.evaluate(() => window.OSCILLA.app.ensureAudio());
    await H.navTo(page, 'playground');
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'playground'),
      { ms: 8000, what: 'scope-follows-owner: the Playground is open' });
    await page.click('#osc-atab-waveform');
    await page.evaluate(() => {
      const ctx = window.OSCILLA.host.p5.drawingContext;
      window.__c013Drawn = [];
      if (!ctx.__c013) {
        const orig = ctx.fillText.bind(ctx);
        ctx.fillText = (t, ...rest) => {
          if (window.__c013Drawn) window.__c013Drawn.push(String(t));
          return orig(t, ...rest);
        };
        ctx.__c013 = true;
      }
      const v = window.OSCILLA.viz;
      v.state.reducedMotion = true; // prefers-reduced-motion as the bridge reads it at start
      v.updateLoop();
    });
    const read = () => page.evaluate(() => {
      const drawn = window.__c013Drawn.splice(0);
      return {
        live: drawn.filter((t) => t.startsWith('output analyser')),
        idle: drawn.filter((t) => /not playing/.test(t)).length,
        aria: document.getElementById('osc-chart-waveform').getAttribute('aria-label'),
        looping: window.OSCILLA.viz.looping,
      };
    });
    // One leg: wait for the owner's label and aria label, then count the frames drawn after it.
    const leg = async (name, re, ariaRe) => {
      const first = await until(async () => {
        const r = await read();
        return r.live.some((t) => re.test(t)) && ariaRe.test(r.aria) ? r : null;
      }, { ms: 6000, what: `scope-follows-owner: ${name}: live scope and aria label` });
      let idle = 0;
      let drawn = 0;
      const later = await until(async () => {
        const r = await read();
        idle += r.idle;
        drawn += r.live.filter((t) => re.test(t)).length;
        return drawn >= 3 ? r : null;
      }, { ms: 6000, what: `scope-follows-owner: ${name}: the scope keeps drawing` });
      return { label: first.live[0], aria: first.aria, looping: later.looping, idle };
    };
    const out = {};
    try {
      out.reducedLoopIdle = (await read()).looping;
      out.loopWas = await page.evaluate(() => {
        const ed = window.OSCILLA.labs.sequencer.editor;
        const was = !!ed.model.loop;
        if (!was) ed.setLoop(true); // the sequence still sounds when a loaded host is slow
        return was;
      });
      await page.click('#osc-seq-play');
      out.seq = await leg('sequencer', /^output analyser · sequencer/,
        /^Live output analyser waveform \(sequencer\)/);
      out.seqOwner = await owner();
      await page.evaluate((was) => {
        const ed = window.OSCILLA.labs.sequencer.editor;
        ed.stop();
        if (!was) ed.setLoop(false);
      }, out.loopWas);
      out.seqStopped = await until(() => page.evaluate(() => {
        const ed = window.OSCILLA.labs.sequencer.editor;
        return !ed.playing && ed.stats().activeNodeCount === 0
          && window.OSCILLA.viz.state.outputOwner === null;
      }), { ms: 4000, what: 'scope-follows-owner: the sequencer stops and frees its nodes' });
      await page.click('[data-osc="studio.compact.play"]');
      out.studio = await leg('Studio', /^output analyser · Studio/,
        /^Live output analyser waveform \(Studio\)/);
      out.studioOwner = await owner();
    } finally {
      await page.evaluate((was) => {
        const ed = window.OSCILLA.labs.sequencer.editor;
        if (ed.playing) ed.stop();
        if (was === false) ed.setLoop(false);
        const s = window.OSCILLA.studio;
        if (s && s.counts().playing) window.OSCILLA.app.studioStop();
      }, out.loopWas);
      out.studioStopped = await until(() => page.evaluate(() => !window.OSCILLA.studio.counts()
        .playing && !window.OSCILLA.viz.state.outputOwner),
      { ms: 4000, what: 'scope-follows-owner: the Studio stops' });
      out.idleAria = (await read()).aria;
      await page.evaluate(() => {
        window.__c013Drawn = null;
        const v = window.OSCILLA.viz;
        let rm = false;
        try { rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* */ }
        v.state.reducedMotion = rm;
        v.updateLoop();
      });
    }
    out.zeroAfter = await H.waitNodes0(page, 3000);
    const ok = out.reducedLoopIdle === false
      && out.seq.looping && out.seq.idle === 0 && out.seqOwner === 'sequencer' && out.seqStopped
      && out.studio.looping && out.studio.idle === 0 && out.studioOwner === 'studio'
      && out.studioStopped && /^Waveform, not playing/.test(out.idleAria) && out.zeroAfter;
    return { ok, ...out };
  });

  // C013 (finding vis-divergence-4): the Spectrum's requested marker follows the sequence while
  // only the sequencer sounds: the instrument at 250 Hz is not played, block 0 (Tone 440 Hz)
  // marks 440 Hz, and the Silence block (a gap) hides the marker and its level chip.
  def('spectrum-marker-follows-sequence', async ({ page }) => {
    await page.evaluate(() => window.OSCILLA.app.ensureAudio());
    await H.navTo(page, 'playground');
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'playground'),
      { ms: 8000, what: 'spectrum-marker-follows-sequence: the Playground is open' });
    const loopWas = await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.setFrequency(250);
      const ed = window.OSCILLA.labs.sequencer.editor;
      const was = !!ed.model.loop;
      if (!was) ed.setLoop(true); // the gap comes round again on a loaded machine
      return was;
    });
    const read = () => page.evaluate(() => {
      const ed = window.OSCILLA.labs.sequencer.editor;
      const chart = window.OSCILLA.labs.analysis.chart;
      return { block: ed.activeBlockIndex(), cur: ed.currentFrequency(),
        req: chart.options.requested, inst: window.OSCILLA.app.playing,
        shown: document.getElementById('osc-chart-spectrum').offsetParent !== null };
    });
    const out = {};
    try {
      await page.click('#osc-seq-play');
      out.tone = await until(async () => {
        const r = await read();
        return r.block === 0 && r.cur === 440 && r.req === 440 ? r : null;
      }, { ms: 6000, what: 'spectrum-marker-follows-sequence: block 0 marks 440 Hz' });
      out.gap = await until(async () => {
        const r = await read();
        return r.block === 2 && r.cur === null && r.req === null ? r : null;
      }, { ms: 8000, what: 'spectrum-marker-follows-sequence: the Silence block hides it' });
    } finally {
      await page.evaluate((was) => {
        const ed = window.OSCILLA.labs.sequencer.editor;
        ed.stop();
        if (!was) ed.setLoop(false);
      }, loopWas);
    }
    out.idle = await until(async () => {
      const r = await read();
      return r.req === 250 ? r : null;
    }, { ms: 4000, what: 'spectrum-marker-follows-sequence: stopped, the instrument marker' });
    out.zeroAfter = await until(() => page.evaluate(() => window.OSCILLA.labs.sequencer.editor
      .stats().activeNodeCount === 0), { ms: 4000,
      what: 'spectrum-marker-follows-sequence: the sequencer frees its nodes' });
    const ok = out.tone.shown && !out.tone.inst && !!out.gap && out.idle.req === 250
      && out.zeroAfter;
    return { ok, ...out };
  });

  // C009 (findings engine-sync-9, dead-controls-8): a release edited from 30 ms to 2 s while a
  // note is held is the one letting go uses, through the Settings field with the Envelope lab
  // off and through the lab's Release field with it on. 300 ms after letting go a 2 s linear
  // fade is still above 30 % of the held level; the 30 ms one it started with is silent. Every
  // reading is taken by a condition poll on the audio clock, windowed at the context's rate.
  // Review F1/F2: the same edit in the app's default (continuous off, the 2 s hard limit), where
  // 2 s cannot fit: letting go still starts a fade (RELEASING), shortened to end before the
  // limit, so halfway through it the level is between 20 % and 80 % of the held one (a let-go
  // that did nothing stays near 100 % until the limit).
  def('release-edit-while-held', async ({ page }) => {
    const mode = () => page.evaluate(() => document.querySelector('#osc-app').dataset.mode);
    if (await mode() !== 'playground') {
      await H.navTo(page, 'playground');
      await page.waitForFunction(() => document.querySelector('#osc-app').dataset.mode
        === 'playground', null, { timeout: 8000 });
    }
    await H.continuous(page, true); // an unlimited hold: no hard-limit end to refuse the fade
    const initial = await page.evaluate(() => ({ release: window.OSCILLA.app.release,
      labR: window.OSCILLA.labs.envelope.adsr.r, labOn: window.OSCILLA.labs.envelope.enabled }));
    // At phone width the Envelope panel is shown only in its own workspace (Synthesis).
    const showLab = async () => {
      if (await page.isVisible('#osc-env-enable')) return;
      await H.navTo(page, 'synthesis');
      await page.waitForFunction(() => document.querySelector('#osc-app').dataset.mode
        === 'synthesis', null, { timeout: 8000 });
    };
    const setLab = async (on) => {
      if (await page.evaluate(() => window.OSCILLA.labs.envelope.enabled) !== on) {
        await showLab();
        await page.click('#osc-env-enable');
      }
      return until(() => page.evaluate((v) => window.OSCILLA.labs.envelope.enabled === v, on),
        { ms: 3000, what: `release-edit-while-held: Envelope lab ${on ? 'on' : 'off'}` });
    };
    const setSettings = async (ms) => {
      await page.evaluate(() => window.OSCILLA.app.openDialog('settings'));
      await page.waitForSelector('#osc-set-release', { state: 'visible', timeout: 8000 });
      await page.fill('#osc-set-release', String(ms));
      await page.press('#osc-set-release', 'Tab'); // commits (change event)
      await page.evaluate(() => window.OSCILLA.app.closeDialog('settings'));
      return until(() => page.evaluate((v) => window.OSCILLA.app.release === v, ms),
        { ms: 3000, what: `release-edit-while-held: Settings release ${ms} ms` });
    };
    const setLabRelease = async (text, s) => {
      await showLab();
      await page.fill('#osc-env-release-value', text);
      await page.press('#osc-env-release-value', 'Enter');
      return until(() => page.evaluate((v) => Math.abs(window.OSCILLA.labs.envelope.adsr.r - v)
        < 1e-9, s), { ms: 3000, what: `release-edit-while-held: lab release ${text}` });
    };
    // RMS of the analyser window once the audio clock has passed `t` plus that window, so the
    // whole window lies after `t`; null (poll again) before.
    const rmsAfter = (t, what) => until(() => page.evaluate((at) => {
      const e = window.OSCILLA.engine;
      const an = e.analyser;
      if (!e.ctx || e.ctx.currentTime < at + an.fftSize / e.ctx.sampleRate) return null;
      const d = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(d);
      let s = 0;
      for (const x of d) s += x * x;
      return { rms: Math.sqrt(s / d.length) };
    }, t), { ms: 10000, what }).then((r) => r.rms);
    const leg = async (name, edit) => {
      const t0 = await page.evaluate(() => {
        const a = window.OSCILLA.app;
        a.source = 'single';
        a.setPattern('tone');
        a.setWaveform('sine');
        a.setFrequency(440);
        a.holding = true;
        a.play('hold');
        const v = window.OSCILLA.engine.voice;
        return v ? v.t0 : null;
      });
      const held = await rmsAfter(t0 + 0.1, `release-edit-while-held: ${name} held level`);
      await edit();
      const voice = await page.evaluate(() => {
        const v = window.OSCILLA.engine.voice;
        return v ? { release: v.release, noteOff: v.noteOff ?? null, endTime: v.endTime } : null;
      });
      const tRel = await page.evaluate(() => {
        window.OSCILLA.app.releaseHold(); // what letting go of Hold to Play does
        return window.OSCILLA.engine.ctx.currentTime;
      });
      const after = await rmsAfter(tRel + 0.3, `release-edit-while-held: ${name} 300 ms after`);
      await page.evaluate(() => window.OSCILLA.app.stopNow());
      const zero = await until(async () => await H.nodes(page) === 0,
        { ms: 5000, what: `release-edit-while-held: ${name} nodes freed` }).catch(() => false);
      const ratio = held > 0 ? after / held : 0;
      return { ok: held > 0.01 && ratio > 0.3 && zero, held: +held.toFixed(4),
        after: +after.toFixed(4), ratio: +ratio.toFixed(3), voice, zero };
    };
    // Review F1: the hard-limited default. The fade's end is the voice's end after the let-go.
    const limitedLeg = async () => {
      const t0 = await page.evaluate(() => {
        const a = window.OSCILLA.app;
        a.source = 'single';
        a.setPattern('tone');
        a.setWaveform('sine');
        a.setFrequency(440);
        a.holding = true;
        a.play('hold');
        const v = window.OSCILLA.engine.voice;
        return v ? v.t0 : null;
      });
      const name = 'Settings, 2 s limit';
      const held = await rmsAfter(t0 + 0.1, `release-edit-while-held: ${name} held level`);
      const limitEnd = await page.evaluate(() => window.OSCILLA.engine.voice?.endTime ?? null);
      await setSettings(2000);
      const off = await page.evaluate(() => {
        const e = window.OSCILLA.engine;
        const v = e.voice;
        window.OSCILLA.app.releaseHold();
        return { t: e.ctx.currentTime, releasing: !!(v && v.releasing),
          end: v ? v.endTime : null, limited: !!(v && v.limited), noteOff: v ? v.noteOff : null,
          status: window.OSCILLA.app.status }; // the engine's release event is synchronous
      });
      const room = off.end != null ? off.end - off.t : 0;
      const mid = room > 0.2 ? await rmsAfter(off.t + room / 2,
        `release-edit-while-held: ${name} halfway through the fade`) : null;
      await page.evaluate(() => window.OSCILLA.app.stopNow());
      const zero = await until(async () => await H.nodes(page) === 0,
        { ms: 5000, what: `release-edit-while-held: ${name} nodes freed` }).catch(() => false);
      const ratio = held > 0 && mid != null ? mid / held : null;
      return { ok: held > 0.01 && off.limited && off.releasing && off.status === 'RELEASING'
        && off.end <= limitEnd && ratio != null && ratio > 0.2 && ratio < 0.8 && zero,
      held: +held.toFixed(4), ratio: ratio == null ? null : +ratio.toFixed(3),
      room: +room.toFixed(3), limitEnd, off, zero };
    };
    const res = {};
    try {
      await setLab(false);
      await setSettings(30);
      res.settings = await leg('Settings', () => setSettings(2000));
      await setLab(true);
      await setLabRelease('30 ms', 0.03);
      res.lab = await leg('Envelope lab', () => setLabRelease('2 s', 2));
      await setLab(false);
      await setSettings(30);
      await H.continuous(page, false);
      res.limited = await limitedLeg();
    } finally {
      await page.evaluate(() => window.OSCILLA.app.stopNow());
      await H.continuous(page, true).catch(() => {});
      await setLabRelease(`${Math.round(initial.labR * 1000)} ms`, initial.labR).catch(() => {});
      await setLab(initial.labOn).catch(() => {});
      await setSettings(initial.release).catch(() => {});
    }
    return { ok: res.settings.ok && res.lab.ok && res.limited.ok, ...res };
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

  // T003 (truth-table GEN-04): a clamped or unparsable sweep value shows its error on the field,
  // tied to the input, at desktop size and at 390x844; a limit from the provisional rate says so.
  def('sweep-field-errors-inline', async ({ page }) => {
    const END = '#sw-end';
    const view = () => page.evaluate(() => {
      const input = document.querySelector('#sw-end');
      const alert = document.querySelector('#sw-end-error');
      const box = alert ? alert.getBoundingClientRect() : null;
      return {
        value: input ? input.value : null,
        invalid: input ? input.getAttribute('aria-invalid') : null,
        describedBy: input ? input.getAttribute('aria-describedby') : null,
        text: alert ? alert.textContent.trim() : null,
        role: alert ? alert.getAttribute('role') : null,
        inParams: !!(alert && alert.closest('#osc-pattern-params')),
        shown: !!(box && box.width > 0 && box.height > 0),
        inside: !!(box && box.left >= 0 && box.right <= window.innerWidth + 0.5),
        scroll: document.documentElement.scrollWidth > window.innerWidth,
        provisional: window.OSCILLA.app.provisional,
      };
    });
    const type = async (sel, text) => {
      await page.fill(sel, text);
      await page.press(sel, 'Enter');
    };
    const seen = (w, h, what, pred) => until(async () => {
      const v = await view();
      return pred(v) ? v : null;
    }, { ms: 5000, what: `sweep-field-errors-inline ${w}x${h}: ${what}` });
    const res = {};
    await page.click('#osc-source-pattern');
    await page.evaluate(() => { window.OSCILLA.app.source = 'sweep'; });
    await page.waitForSelector(END, { state: 'visible', timeout: 8000 });
    for (const [w, h] of [[1536, 1024], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await type(END, '30000');
      const over = await seen(w, h, 'the End error is shown', (v) => v.shown && !!v.text);
      await type(END, '10000');
      const fine = await seen(w, h, 'the End error clears', (v) => !v.shown
        && v.invalid === 'false');
      await type(END, 'abc');
      const parse = await seen(w, h, 'the parse error is shown', (v) => v.shown
        && /is not a frequency/.test(v.text));
      await type(END, '10000');
      await seen(w, h, 'the parse error clears', (v) => !v.shown);
      res[`${w}x${h}`] = { over, fine, parse };
    }
    // A sweep value a preset or link applies replaces the typed one: its error goes with it.
    await type(END, '30000');
    await seen(390, 844, 'the End error is shown before the preset', (v) => v.shown);
    await page.evaluate(() => window.OSCILLA.app.applyConfig({ v: 1, source: 'sweep',
      sweep: { end: 10000 } }, 'preset'));
    const preset = await seen(390, 844, 'a preset clears the End error', (v) => !v.shown
      && v.value === '10.00 kHz');
    await page.setViewportSize({ width: 1536, height: 1024 });
    await page.evaluate(() => { window.OSCILLA.app.source = 'single'; });
    await page.selectOption('#osc-pattern-select', 'tone');
    await page.click('#osc-source-osc');
    // The clamped value is the limit the message names, and "provisional" appears exactly
    // while no AudioContext has given the real rate.
    const good = ({ over, fine, parse }) => over.role === 'alert' && over.inParams
      && over.inside && !over.scroll && over.invalid === 'true'
      && over.describedBy === 'sw-end-error' && /kHz$/.test(over.value)
      && over.text.includes(`digital limit ${over.value}`)
      && /provisional/.test(over.text) === over.provisional
      && fine.value === '10.00 kHz' && fine.describedBy === null
      && parse.invalid === 'true' && parse.inside;
    const bad = Object.entries(res).filter(([, r]) => !good(r));
    const cleared = preset.invalid === 'false' && preset.describedBy === null;
    return { ok: !bad.length && cleared, res, preset };
  });

  def('presets-save-load', async ({ page }) => {
    await page.evaluate(() => window.OSCILLA.app.setFrequency(1234));
    await page.click('#osc-wave-triangle');
    await page.click('#osc-act-save-preset');
    await page.waitForSelector('#osc-dlg-save[open]', { timeout: 8000 });
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
    // Filter Lab is pressed in its own workspace: from 1280 px the Playground leaves it there
    // (P002, Q004 option A). The export and the import run from the Playground, as before.
    await H.workspace(page, 'filter');
    await page.click('#osc-ftype-highpass');
    await page.click('#osc-filter-enable');
    await H.workspace(page, 'playground');
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
    await H.workspace(page, 'filter');
    await page.click('#osc-ftype-lowpass');
    await page.click('#osc-filter-enable');
    await H.workspace(page, 'playground');
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
    await H.workspace(page, 'filter');
    await page.click('#osc-ftype-lowpass');
    if (after.filter.enabled) await page.click('#osc-filter-enable');
    await H.workspace(page, 'playground');
    const ok = !missing.length && doc.version === 1 && Math.abs(after.f - 3210) < 0.01
      && after.w === 'square' && Math.abs(after.dualA - 300) < 0.01
      && after.filter.type === 'highpass' && after.filter.enabled === true && bad === false;
    return { ok, missing, file: path.basename(dl.suggestedFilename()), after, rejectsBadVersion: !bad };
  });

  // C017 (finding persist-4): the parser accepts filter Q 50 and attack 10 s, the labs clamp
  // them. The import names each limited value instead of "All settings were restored.", and
  // keeps them apart from the invalid ones. The filter's top (20 kHz here) holds at 44.1 and
  // 48 kHz alike: min(20000, sampleRate * 0.475).
  def('import-names-limits', async ({ page }) => {
    const got = await page.evaluate(() => {
      const O = window.OSCILLA;
      const a = O.app;
      const before = { filter: O.labs.filter.config, adsr: O.labs.envelope.adsr,
        envEnabled: O.labs.envelope.enabled };
      a.alerts = [];
      const doc = { version: 1,
        filter: { enabled: before.filter.enabled, type: before.filter.type, frequency: 21000,
          Q: 50, gain: 0 },
        envelope: { adsr: { enabled: before.envEnabled, a: 10, d: 0.1, s: 0.5, r: 20 } } };
      const applied = a.importConfigText(JSON.stringify(doc));
      const after = { filter: O.labs.filter.config, adsr: O.labs.envelope.adsr };
      const toast = a.alerts.find((t) => t.title === 'Config imported') || null;
      // sane values back, then the previous state, so the next check starts where it was
      a.alerts = [];
      const clean = a.importConfigText(JSON.stringify({ version: 1,
        filter: { enabled: before.filter.enabled, type: before.filter.type, frequency: 1000,
          Q: 1, gain: 0 },
        envelope: { adsr: { enabled: before.envEnabled, a: 0.01, d: 0.1, s: 0.5, r: 0.2 } } }));
      const cleanToast = a.alerts.find((t) => t.title === 'Config imported') || null;
      O.labs.filter.update(before.filter);
      O.labs.envelope.update({ adsr: before.adsr });
      a.alerts = [];
      return { applied, after, toast, clean, cleanToast };
    });
    const msg = (got.toast && got.toast.message) || '';
    const named = ['filter frequency limited to 20000 Hz (file: 21000 Hz)',
      'filter Q limited to 30 (file: 50)', 'envelope attack limited to 2 s (file: 10 s)',
      'envelope release limited to 5 s (file: 20 s)'];
    const missing = named.filter((n) => !msg.includes(n));
    const ok = got.applied === true && got.toast && got.toast.level === 'warning'
      && !missing.length && !/invalid/.test(msg) && !/All settings were restored/.test(msg)
      && got.after.filter.Q === 30 && got.after.filter.frequency === 20000
      && got.after.adsr.a === 2 && got.after.adsr.r === 5
      && got.clean === true && got.cleanToast && got.cleanToast.level === 'success'
      && got.cleanToast.message === 'All settings were restored.';
    return { ok, missing, toast: got.toast, after: got.after, cleanToast: got.cleanToast };
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

  // C004 (findings dup-stale-3, persist-6): the instrument owns the sequence waveform. A file
  // whose instrument waveform is the current one (sine) and whose sequencer.waveform is square
  // fires no instrument change, yet every answer must still be sine: the realtime sequence's
  // oscillators, the sequence WAV (Goertzel h2 and h3 below -60 dB of the fundamental), the
  // status readout and the derived waveform the sequence writes back. The import says that the
  // file's square was not applied instead of "All settings were restored."
  def('seq-waveform-one-owner', async ({ page }) => {
    const what = (s) => `seq-waveform-one-owner: ${s}`;
    await page.mouse.click(2, 2); // a gesture builds and resumes the context (WebKit)
    await page.evaluate(() => {
      window.OSCILLA.app.ensureAudio();
      return window.OSCILLA.engine.resume();
    });
    await until(() => page.evaluate(() => window.OSCILLA.engine.state === 'running'),
      { ms: 10000, what: what('the AudioContext runs') });
    const saved = await page.evaluate(() => {
      const O = window.OSCILLA;
      O.app.setWaveform('sine');
      // Record every OscillatorNode type the page sets, realtime and offline.
      const d = Object.getOwnPropertyDescriptor(OscillatorNode.prototype, 'type');
      window.__c004 = { d, types: [] };
      Object.defineProperty(OscillatorNode.prototype, 'type', {
        configurable: true,
        get() { return d.get.call(this); },
        set(v) {
          const offline = typeof this.context.startRendering === 'function';
          window.__c004.types.push({ v, offline });
          d.set.call(this, v);
        },
      });
      return O.labs.sequencer.editor.serialize();
    });
    try {
      await until(() => page.evaluate(() => window.OSCILLA.labs.sequencer.editor.model.waveform
        === 'sine'), { ms: 5000, what: what('the sequence follows the instrument (sine)') });
      const doc = await page.evaluate(() => window.OSCILLA.app.exportConfig());
      doc.waveform = 'sine';
      doc.sequencer = { ...doc.sequencer, waveform: 'square', loop: false,
        blocks: [{ id: 'b1', type: 'tone', durationMs: 600, params: { freq: 440 } }] };
      await page.setInputFiles('#osc-import-file', { name: 'cfg.json',
        mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
      const message = await until(() => page.evaluate(() => {
        const a = window.OSCILLA.app.alerts.find((x) => x.title === 'Config imported');
        return a ? a.message : '';
      }), { ms: 8000, what: what('the import is reported') });
      await H.navTo(page, 'sequencer');
      await until(() => page.evaluate(() => document.querySelector('#osc-app').dataset.mode
        === 'sequencer'), { ms: 8000, what: what('the Sequencer workspace opens') });
      await page.evaluate(() => { window.__c004.types.length = 0; });
      await page.click('#osc-seq-play');
      const live = await until(() => page.evaluate(() => {
        const O = window.OSCILLA;
        const realtime = window.__c004.types.filter((t) => !t.offline).map((t) => t.v);
        if (!O.app.seqPlaying || !realtime.length) return null;
        return { realtime, status: document.querySelector('[data-osc="status.waveform"]')
          .textContent.trim(), model: O.labs.sequencer.editor.model.waveform,
        written: O.labs.sequencer.editor.serialize().waveform };
      }), { ms: 8000, what: what('the sequence plays') });
      await page.click('#osc-seq-stop');
      await until(() => page.evaluate(() => !window.OSCILLA.labs.sequencer.editor.playing),
        { ms: 8000, what: what('the sequence stops') });
      await page.evaluate(() => { window.__c004.types.length = 0; });
      await page.click('#osc-export');
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 20000 }),
        page.click('[data-osc="export.seqWav"]'),
      ]);
      const buf = fs.readFileSync(await dl.path());
      const offline = await page.evaluate(() => window.__c004.types.filter((t) => t.offline)
        .map((t) => t.v));
      const wav = parseWavHeader(buf);
      const harm = wav.ok ? toneHarmonicsDb(buf, 440) : null;
      const ok = live.realtime.every((v) => v === 'sine') && live.status === 'Sine'
        && live.model === 'sine' && live.written === 'sine'
        && offline.length > 0 && offline.every((v) => v === 'sine')
        && !!harm && harm.h2 < -60 && harm.h3 < -60
        && /follows the instrument waveform \(sine\); the file's square was not applied/
          .test(message);
      return { ok, message, live: { ...live, realtime: [...new Set(live.realtime)] },
        offline: [...new Set(offline)], harm };
    } finally {
      await page.evaluate((seq) => {
        const w = window.__c004;
        if (w) Object.defineProperty(OscillatorNode.prototype, 'type', w.d);
        delete window.__c004;
        window.OSCILLA.labs.sequencer.update({ sequence: seq });
      }, saved);
    }
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

  // C014 (finding vis-divergence-2): the Analyzer spectrogram writes nothing for a paused or
  // hidden interval. A 1 kHz tone sounds through GAP_S seconds of the audio clock while the
  // frame loop is paused (leg pause: the Pause animation button) or the document reads hidden
  // (leg hidden: the document.hidden getter the frame loop reads, without the visibilitychange
  // event that would release the voice). After the resume, the tone may cover only the time
  // since the resume; before the fix the first frame painted the whole gap with one spectrum.
  def('spectrogram-no-backfill', async ({ page }) => {
    const TONE_HZ = 1000;
    const GAP_S = 3;
    // The checks after this one expect the workspace it started in.
    const startMode = await page.evaluate(() => document.querySelector('#osc-app').dataset.mode);
    await H.navTo(page, 'analyzer');
    await page.waitForFunction(() => document.querySelector('#osc-app').dataset.mode
      === 'analyzer', null, { timeout: 8000 });
    await page.evaluate(() => window.OSCILLA.app.ensureAudio());
    await until(() => page.evaluate(() => {
      const v = window.OSCILLA.labs.spectrogram.view;
      return !!(v && v.spectrogram && v.spectrogram.rowMap && v.plotCanvas.width > 1);
    }), { ms: 10000, what: 'spectrogram-no-backfill: the Analyzer spectrogram has its axis' });
    const readRow = () => page.evaluate((f) => {
      const v = window.OSCILLA.labs.spectrogram.view;
      const spg = v.spectrogram;
      const c = v.plotCanvas;
      const y = Math.round(spg.yForFrequency(f));
      const row = c.getContext('2d').getImageData(0, y, c.width, 1).data;
      const lut = spg.lut;
      let bright = 0;
      for (let x = 0; x < c.width; x++) {
        const d = Math.abs(row[x * 4] - lut[0]) + Math.abs(row[x * 4 + 1] - lut[1])
          + Math.abs(row[x * 4 + 2] - lut[2]);
        if (d > 60) bright++;
      }
      return { width: c.width, spanS: spg.options.timeSpanS, bright };
    }, TONE_HZ);
    const leg = async (name, enter, leave) => {
      await page.evaluate((f) => {
        window.OSCILLA.labs.spectrogram.view.spectrogram.clear();
        const a = window.OSCILLA.app;
        a.setContinuous(true);
        a.setWaveform('sine');
        a.setFrequency(f);
        if (!a.playing) a.toggleLatch();
      }, TONE_HZ);
      // The renderer is running (its clock is set) when the tone is already on the canvas.
      await until(async () => (await readRow()).bright > 0,
        { ms: 10000, what: `spectrogram-no-backfill ${name}: the tone is painted before` });
      await enter();
      const before = await readRow();
      const t0 = await page.evaluate(() => window.OSCILLA.engine.ctx.currentTime);
      // The gap is GAP_S seconds of the audio clock with the tone at the analyser.
      await until(() => page.evaluate(({ f, end }) => {
        const e = window.OSCILLA.engine;
        if (!e.analyser || e.ctx.currentTime < end) return false;
        const d = new Float32Array(e.analyser.frequencyBinCount);
        e.analyser.getFloatFrequencyData(d);
        let k = 1;
        for (let i = 2; i < d.length; i++) if (d[i] > d[k]) k = i;
        const hz = (k * e.ctx.sampleRate) / e.analyser.fftSize;
        return Math.abs(hz - f) < 20 && d[k] > -80;
      }, { f: TONE_HZ, end: t0 + GAP_S }), { ms: GAP_S * 1000 + 15000,
        what: `spectrogram-no-backfill ${name}: ${GAP_S} s of the audio clock with the tone` });
      const still = await readRow();
      const tResume = Date.now();
      await leave();
      const after = await until(async () => {
        const r = await readRow();
        return r.bright > before.bright ? { ...r, tRead: Date.now() } : null;
      }, { ms: 10000, what: `spectrogram-no-backfill ${name}: the tone is painted after resume` });
      const perS = after.width / after.spanS;
      const honestMax = Math.ceil(((after.tRead - tResume) / 1000 + 0.3) * perS);
      const gapColumns = Math.floor(GAP_S * perS);
      const added = after.bright - before.bright;
      return { before: before.bright, duringGap: still.bright - before.bright, added, honestMax,
        gapColumns, width: after.width,
        ok: still.bright === before.bright && added <= honestMax && honestMax < gapColumns };
    };
    const res = {};
    res.pause = await leg('pause', () => page.click('#osc-viz-pause'),
      () => page.click('#osc-viz-pause'));
    const setHidden = (on) => page.evaluate((h) => {
      if (h) Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      else delete document.hidden;
    }, on);
    try {
      res.hidden = await leg('hidden', () => setHidden(true), () => setHidden(false));
    } finally {
      await setHidden(false);
    }
    const paused = await page.evaluate(() => window.OSCILLA.app.vizPaused);
    await H.stopAll(page);
    await H.navTo(page, startMode);
    await page.waitForFunction((w) => document.querySelector('#osc-app').dataset.mode === w,
      startMode, { timeout: 8000 });
    return { ok: res.pause.ok && res.hidden.ok && paused === false, paused, startMode, ...res };
  });

  def('labs-basic', async ({ page }) => {
    await H.continuous(page, true);
    const out = {};
    const gain = await page.evaluate(() => window.OSCILLA.app.gainLevel);
    const held = async (test, what) => {
      await H.spaceDown(page);
      const v = await U.poll(async () => +(await H.peak(page)).toFixed(4), test, what);
      await page.keyboard.up(' ');
      await H.waitNodes0(page);
      return v;
    };
    // filter, set in the Filter Lab: low-pass at 500 Hz must attenuate a 5 kHz tone when enabled
    await H.workspace(page, 'filter');
    await page.evaluate(() => window.OSCILLA.app.setFrequency(5000));
    if (await page.getAttribute('#osc-filter-enable', 'aria-checked') !== 'true') {
      await page.click('#osc-filter-enable');
    }
    await page.click('#osc-ftype-lowpass');
    await U.fill(page, '#osc-filter-cutoff-value', '500');
    await U.fill(page, '#osc-filter-q-value', '0.707');
    out.filter = await page.evaluate(() => window.OSCILLA.labs.filter.config);
    out.filteredPeak = await held((p) => p > 0 && p < gain * 0.2,
      'labs-basic: the 5 kHz tone is attenuated by the 500 Hz low-pass');
    await page.click('#osc-filter-enable');
    out.bypassPeak = await held((p) => Math.abs(p - gain) < 0.01,
      'labs-basic: the filter switched off passes the tone at its level');
    // ADSR, set in the Envelope panel: sustain 0.5 halves the held level
    await H.workspace(page, 'synthesis');
    await page.evaluate(() => window.OSCILLA.app.setFrequency(440));
    if (await page.getAttribute('#osc-env-enable', 'aria-pressed') !== 'true') {
      await page.click('#osc-env-enable');
    }
    await U.fill(page, '#osc-env-attack-value', '10 ms');
    await U.fill(page, '#osc-env-decay-value', '50 ms');
    await U.fill(page, '#osc-env-sustain-value', '0.5');
    await U.fill(page, '#osc-env-release-value', '50 ms');
    out.adsr = await page.evaluate(() => window.OSCILLA.labs.envelope.adsr);
    out.adsrPeak = await held((p) => Math.abs(p - gain * 0.5) < 0.012,
      'labs-basic: the held note settles at the typed sustain of 0.5');
    await page.click('#osc-env-enable');
    // additive: enabled -> PeriodicWave on the carrier. Additive Synthesis is pressed in
    // Synthesis: from 1280 px the Playground leaves it there (P002, Q004 option A).
    await H.workspace(page, 'synthesis');
    await page.click('#osc-add-enable');
    await H.spaceDown(page);
    out.additiveCarrier = await U.poll(() => page.evaluate(() => window.OSCILLA.engine.voice
      && window.OSCILLA.engine.voice.carrier && window.OSCILLA.engine.voice.carrier.type),
    (t) => t === 'custom', 'labs-basic: the additive switch puts a PeriodicWave on the carrier');
    await page.keyboard.up(' ');
    await H.waitNodes0(page);
    await page.click('#osc-add-enable');
    await H.workspace(page, 'playground');
    // sequencer: play / stop
    await H.workspace(page, 'sequencer');
    await page.click('#osc-seq-play');
    out.seqPlaying = await U.poll(() => page.evaluate(() => ({ app: window.OSCILLA.app.seqPlaying,
      label: document.querySelector('[data-osc="status.label"]').textContent })),
    (s) => s.app && s.label === 'PLAYING', 'labs-basic: the sequence plays and the status says so');
    out.seqPeak = await U.poll(async () => +(await H.peak(page)).toFixed(4), (p) => p > 0.005,
      'labs-basic: the sequence sounds');
    await page.click('#osc-seq-stop');
    out.seqStopped = await U.poll(() => page.evaluate(() => {
      const s = window.OSCILLA.labs.sequencer.editor;
      const st = s.stats();
      return { playing: s.playing, sources: st.activeSourceCount, nodes: st.activeNodeCount };
    }), (s) => !s.playing && s.sources === 0, 'labs-basic: STOP leaves no sequencer source');
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
    out.dual = await U.poll(() => page.evaluate(() => ({ source: window.OSCILLA.app.source,
      router: !!window.OSCILLA.adapter.getStereoRouter(),
      corr: document.querySelector('#osc-corr-value').textContent })),
    (d) => d.source === 'dual' && d.router,
    'labs-basic: the stereo dual voice runs through the router');
    await page.keyboard.up(' ');
    await H.waitNodes0(page);
    await page.click('#osc-dual-mono');
    await page.click('#osc-dual-enable');
    await H.workspace(page, 'playground');
    const ok = out.filter.type === 'lowpass' && Math.abs(out.filter.frequency - 500) < 0.5
      && out.adsr.s === 0.5 && out.additiveCarrier === 'custom'
      && !out.seqStopped.playing && out.seqStopped.sources === 0
      && /\d/.test(out.device.sr) && out.dual.source === 'dual' && out.dual.router;
    return { ok, gain, ...out };
  });

  // ---- C020 control drive: each control operated by pointer or keyboard reaches its
  // subsystem (the live filter stage and the sound, the envelope of the next note, the dual
  // voice, the router, the instrument state) and a view that reflects it. The envelope is
  // judged on the next note and the filter on the instrument's tone: an edit reaching a held
  // note and the filter reaching the sequencer are separate findings (PACK 03 control-census-3
  // and -2), not asserted here.
  const filterState = (page, hz) => page.evaluate((f) => {
    const L = window.OSCILLA.labs.filter;
    const st = L.stage;
    const n = st && st.node;
    const d = L.chart ? L.chart.getData() : null;
    let at = null;
    if (d && d.x.length) {
      let k = 0;
      for (let i = 1; i < d.x.length; i++) if (Math.abs(d.x[i] - f) < Math.abs(d.x[k] - f)) k = i;
      at = Math.round(d.y[k] * 10) / 10;
    }
    const q = (s) => document.querySelector(s);
    return { cfg: L.config, live: !L.previewOnly, type: n ? n.type : null,
      hz: n ? Math.round(n.frequency.value) : null, chartDb: at,
      on: q('#osc-filter-enable').getAttribute('aria-checked'),
      cutoffText: q('#osc-filter-cutoff-value').value,
      cutoffSlider: q('#osc-filter-cutoff').getAttribute('aria-valuetext'),
      qText: q('#osc-filter-q-value').value,
      qSlider: q('#osc-filter-q').getAttribute('aria-valuetext'),
      gainShown: !q('[data-osc="filter.gainGroup"]').hidden,
      gainSlider: q('#osc-filter-gain').getAttribute('aria-valuetext') };
  }, hz);

  def('ui-filter-controls', async ({ page }) => {
    const HZ = 1000;
    const out = {};
    await H.workspace(page, 'filter');
    await page.evaluate((f) => {
      const a = window.OSCILLA.app;
      a.setWaveform('sine');
      a.setFrequency(f);
    }, HZ);
    if (await page.getAttribute('#osc-filter-enable', 'aria-checked') !== 'true') {
      await page.click('#osc-filter-enable');
    }
    await page.click('#osc-ftype-lowpass');
    await U.fill(page, '#osc-filter-cutoff-value', '20000');
    const S = async () => ({ ...(await filterState(page, HZ)), db: +(await U.toneDb(page, HZ))
      .toFixed(1) });
    const step = (name, test) => U.poll(S, test, `ui-filter-controls: ${name}`);
    // the tone's own level: its gain, in dBFS, through the open filter
    const L0 = +(20 * Math.log10(await page.evaluate(() => window.OSCILLA.app.gainLevel)))
      .toFixed(1);
    out.L0 = L0;
    try {
      await U.latch(page);
      await step('the open low-pass passes the tone at its level', (s) => s.live
        && s.type === 'lowpass' && s.on === 'true' && s.cfg.frequency > 10000
        && Math.abs(s.db - L0) < 1.5);
      out.L0 = L0;
      // cutoff typed, by pointer on the field: 150 Hz takes the 1 kHz tone down
      await U.fill(page, '#osc-filter-cutoff-value', '150');
      out.cutoffText = await step('typed cutoff 150 Hz', (s) => Math.abs(s.cfg.frequency - 150)
        < 0.5 && Math.abs(s.hz - 150) < 2 && s.db < L0 - 20 && s.chartDb < -20
        && /150/.test(s.cutoffSlider));
      // cutoff slider by keyboard: End opens the filter again
      await U.press(page, '#osc-filter-cutoff', 'End');
      out.cutoffKey = await step('cutoff slider End', (s) => s.cfg.frequency > 10000
        && s.db > L0 - 3 && s.cutoffText !== '150 Hz' && s.chartDb > -3);
      // cutoff slider by pointer, near its low end
      await U.tap(page, '#osc-filter-cutoff', 0.02);
      out.cutoffTap = await step('cutoff slider tapped low', (s) => s.cfg.frequency < 200
        && s.db < L0 - 15);
      // the types, at a cutoff on the tone
      await U.fill(page, '#osc-filter-cutoff-value', '1000');
      await page.click('#osc-ftype-notch');
      out.notch = await step('notch on the tone', (s) => s.cfg.type === 'notch'
        && s.type === 'notch'
        && s.db < L0 - 30 && s.chartDb < -30);
      await page.click('#osc-ftype-bandpass');
      out.bandpass = await step('band-pass on the tone', (s) => s.cfg.type === 'bandpass'
        && s.type === 'bandpass' && Math.abs(s.db - L0) < 3 && s.chartDb > -3);
      await U.press(page, '#osc-ftype-bandpass', 'ArrowLeft');
      await U.fill(page, '#osc-filter-cutoff-value', '5000');
      out.highpass = await step('high-pass by keyboard, 5 kHz', (s) => s.cfg.type === 'highpass'
        && s.type === 'highpass' && s.db < L0 - 20 && s.chartDb < -20);
      // Q: a narrow band-pass at 3 kHz rejects the 1 kHz tone more than a wide one
      await page.click('#osc-ftype-bandpass');
      await U.fill(page, '#osc-filter-cutoff-value', '3000');
      await U.fill(page, '#osc-filter-q-value', '0.707');
      // the level heard is the level the chart draws at the tone (within 2 dB)
      const heard = (s) => Math.abs(s.db - (L0 + s.chartDb)) < 2;
      const wide = await step('band-pass 3 kHz, Q 0.707', (s) => s.type === 'bandpass'
        && Math.abs(s.cfg.Q - 0.707) < 0.01 && s.hz === 3000 && heard(s));
      await U.fill(page, '#osc-filter-q-value', '20');
      out.qText = await step('typed Q 20', (s) => Math.abs(s.cfg.Q - 20) < 0.01
        && s.chartDb < wide.chartDb - 15 && s.db < wide.db - 15 && s.qSlider !== wide.qSlider);
      await U.press(page, '#osc-filter-q', 'Home');
      out.qKey = await step('Q slider Home', (s) => s.cfg.Q < 0.707 && s.db > out.qText.db + 10
        && heard(s) && s.qText !== out.qText.qText);
      // gain: peaking by keyboard from notch, then the gain slider by keyboard
      await page.click('#osc-ftype-notch');
      await U.press(page, '#osc-ftype-notch', 'ArrowRight');
      await U.fill(page, '#osc-filter-cutoff-value', '1000');
      await U.press(page, '#osc-filter-gain', 'Home');
      out.cut = await step('peaking -24 dB', (s) => s.cfg.type === 'peaking' && s.gainShown
        && s.cfg.gain === -24 && s.db < L0 - 12 && /-24/.test(s.gainSlider));
      await U.press(page, '#osc-filter-gain', 'End');
      out.boost = await step('peaking +24 dB', (s) => s.cfg.gain === 24 && s.db > L0 + 6
        && s.chartDb > 20);
      // the switch: off passes the tone the low-pass held back
      await page.click('#osc-ftype-lowpass');
      await U.fill(page, '#osc-filter-cutoff-value', '150');
      await step('low-pass 150 Hz again', (s) => s.type === 'lowpass' && s.db < L0 - 20);
      await page.click('#osc-filter-enable');
      out.off = await step('filter switched off', (s) => !s.cfg.enabled && s.on === 'false'
        && Math.abs(s.db - L0) < 3);
    } finally {
      await U.unlatch(page);
      if (await page.getAttribute('#osc-filter-enable', 'aria-checked') === 'true') {
        await page.click('#osc-filter-enable');
      }
      await page.click('#osc-ftype-lowpass');
      await U.fill(page, '#osc-filter-cutoff-value', '2500');
    }
    return { ok: true, ...out };
  });

  def('ui-envelope-controls', async ({ page }) => {
    const out = {};
    await H.workspace(page, 'synthesis');
    await H.continuous(page, true);
    await page.evaluate(() => window.OSCILLA.app.setFrequency(440));
    const gain = await page.evaluate(() => window.OSCILLA.app.gainLevel);
    const E = () => page.evaluate(() => {
      const L = window.OSCILLA.labs.envelope;
      const q = (s) => document.querySelector(s);
      const t = (k) => ({ text: q(`#osc-env-${k}-value`).value,
        slider: q(`#osc-env-${k}`).getAttribute('aria-valuetext') || q(`#osc-env-${k}`).value });
      return { on: L.enabled, pressed: q('#osc-env-enable').getAttribute('aria-pressed'),
        adsr: L.adsr, graph: L.graph ? L.graph.adsr : null,
        a: t('attack'), d: t('decay'), s: t('sustain'), r: t('release') };
    });
    const step = (name, test) => U.poll(E, test, `ui-envelope-controls: ${name}`);
    const near = (x, y) => Math.abs(x - y) < 1e-6;
    if (await page.getAttribute('#osc-env-enable', 'aria-pressed') !== 'true') {
      await page.click('#osc-env-enable');
    }
    await step('the envelope is on', (e) => e.on && e.pressed === 'true');
    await U.fill(page, '#osc-env-attack-value', '5 ms');
    await U.fill(page, '#osc-env-decay-value', '20 ms');
    await U.fill(page, '#osc-env-sustain-value', '0.25');
    await U.fill(page, '#osc-env-release-value', '40 ms');
    out.typed = await step('typed A 5 ms, D 20 ms, S 0.25, R 40 ms', (e) => near(e.adsr.a, 0.005)
      && near(e.adsr.d, 0.02) && near(e.adsr.s, 0.25) && near(e.adsr.r, 0.04)
      && e.graph && near(e.graph.s, 0.25) && near(e.graph.a, 0.005)
      && /5/.test(e.a.slider) && /20/.test(e.d.slider) && /40/.test(e.r.slider));
    const note = async (lo, hi, what) => {
      await H.spaceDown(page);
      const p = await U.poll(async () => +(await H.peak(page)).toFixed(4),
        (v) => v > gain * lo && v < gain * hi, `ui-envelope-controls: ${what}`);
      await page.keyboard.up(' ');
      await H.waitNodes0(page);
      return p;
    };
    out.note1 = await note(0.17, 0.33, 'the next note holds at sustain 0.25');
    // the sliders by keyboard: each moves its value and its text field
    await U.press(page, '#osc-env-sustain', 'ArrowRight', 'ArrowRight', 'ArrowRight',
      'ArrowRight', 'ArrowRight');
    out.sustainKey = await step('sustain slider by keyboard', (e) => Math.abs(e.adsr.s - 0.3) < 1e-6
      && Number(e.s.text) === 0.3 && e.graph && Math.abs(e.graph.s - 0.3) < 1e-6);
    out.note2 = await note(0.22, 0.38, 'the next note holds at sustain 0.30');
    // the time sliders by keyboard, to their ends: the value, its field and the graph follow
    await U.press(page, '#osc-env-attack', 'End');
    await U.press(page, '#osc-env-decay', 'End');
    await U.press(page, '#osc-env-release', 'Home');
    out.timeKeys = await step('attack and decay to their maximum, release to its minimum',
      (e) => e.adsr.a > 0.5 && e.a.text !== out.typed.a.text && e.adsr.d > 0.5
        && e.d.text !== out.typed.d.text && e.adsr.r < 0.04 && e.r.text !== out.typed.r.text
        && e.graph && e.graph.a === e.adsr.a && e.graph.d === e.adsr.d && e.graph.r === e.adsr.r);
    await U.fill(page, '#osc-env-attack-value', '10 ms');
    await U.fill(page, '#osc-env-decay-value', '100 ms');
    await U.fill(page, '#osc-env-sustain-value', '0.6');
    await U.fill(page, '#osc-env-release-value', '300 ms');
    await page.click('#osc-env-enable');
    out.off = await step('the envelope is off', (e) => !e.on && e.pressed === 'false');
    out.note3 = await note(0.85, 1.15, 'with the envelope off the next note is at full level');
    return { ok: true, gain, ...out };
  });

  const dualState = () => {
    const O = window.OSCILLA;
    const a = O.app;
    const v = O.engine.voice && !O.engine.voice.ended ? O.engine.voice : null;
    const side = (k) => {
      const s = v && v.live && v.live[k];
      return s ? { f: Math.round(s.osc.frequency.value * 2 ** (s.osc.detune.value / 1200) * 10)
        / 10, g: s.g.gain.value, wave: s.osc.type } : null;
    };
    const q = (s) => document.querySelector(s);
    return { source: a.source, dual: JSON.parse(JSON.stringify(a.dual)),
      A: side('A'), B: side('B'), phase: O.labs.phase.config, router: O.labs.phase.routerConfig,
      live: !!O.adapter.getStereoRouter(),
      liveCfg: O.adapter.getStereoRouter() ? O.adapter.getStereoRouter().config : null,
      corrState: O.labs.phase.correlationState,
      dualPhase: v && v.opts ? v.opts.dualPhaseDeg : null,
      enable: q('#osc-dual-enable').getAttribute('aria-checked'),
      aFreq: q('#osc-dual-a-freq').value, bFreq: q('#osc-dual-b-freq').value,
      fa: q('#osc-stereo-fa').value, fb: q('#osc-stereo-fb').value,
      aGain: q('#osc-dual-a-gain').getAttribute('aria-valuetext'),
      aDetune: q('#osc-dual-a-detune').getAttribute('aria-valuetext'),
      levelA: q('#osc-dual-level-a').getAttribute('aria-valuetext'),
      pan: q('#osc-stereo-pan').getAttribute('aria-valuetext'),
      stereoBtn: q('#osc-dual-stereo').getAttribute('aria-checked'),
      splitBtn: q('#osc-stereo-split').getAttribute('aria-checked'),
      corr: q('#osc-corr-value').textContent.trim() };
  };

  def('ui-dual-phase-stereo-controls', async ({ page }) => {
    const out = {};
    await H.workspace(page, 'synthesis');
    const D = () => page.evaluate(dualState);
    const step = (name, test) => U.poll(D, test, `ui-dual-phase-stereo-controls: ${name}`);
    const near = (x, y, tol = 1) => x != null && Math.abs(x - y) <= tol;
    if (await page.getAttribute('#osc-dual-enable', 'aria-checked') !== 'true') {
      await page.click('#osc-dual-enable');
    }
    try {
      await U.latch(page);
      const s0 = await step('the dual voice sounds', (d) => d.source === 'dual'
        && d.enable === 'true'
        && d.A && d.B);
      out.gA = s0.A.g;
      out.gB = s0.B.g;
      await U.fill(page, '#osc-dual-a-freq', '330');
      await U.fill(page, '#osc-dual-b-freq', '660');
      out.freqs = await step('typed A 330 Hz, B 660 Hz', (d) => d.dual.a.freq === 330
        && d.dual.b.freq === 660 && near(d.A.f, 330) && near(d.B.f, 660) && d.fa === '330'
        && d.fb === '660' && d.phase.freqA === 330 && d.phase.freqB === 660);
      await page.selectOption('#osc-dual-a-wave', 'square');
      await page.selectOption('#osc-dual-b-wave', 'triangle');
      out.waves = await step('A square, B triangle', (d) => d.dual.a.wave === 'square'
        && d.A.wave === 'square' && d.dual.b.wave === 'triangle' && d.B.wave === 'triangle');
      await U.press(page, '#osc-dual-a-detune', 'End');
      await U.press(page, '#osc-dual-b-detune', 'Home');
      out.detune = await step('A +100 cents, B -100 cents', (d) => d.dual.a.detune === 100
        && d.dual.b.detune === -100 && near(d.A.f, 330 * 2 ** (1 / 12))
        && near(d.B.f, 660 * 2 ** (-1 / 12)) && /100/.test(d.aDetune));
      await U.press(page, '#osc-dual-a-detune', 'ArrowLeft');
      await U.fill(page, '#osc-dual-a-freq', '330');
      await U.press(page, '#osc-dual-a-gain', 'Home');
      out.gainA0 = await step('A gain 0', (d) => d.dual.a.gain === 0 && d.A.g < 0.01 * out.gA + 1e-6
        && /^0/.test(d.aGain));
      await U.press(page, '#osc-dual-a-gain', 'End');
      await U.tap(page, '#osc-dual-b-gain', 0.25);
      out.gains = await step('A gain 100, B gain tapped low', (d) => d.dual.a.gain === 100
        && near(d.A.g, out.gA, out.gA * 0.05) && d.dual.b.gain < 50 && d.B.g < out.gB * 0.6);
      await U.press(page, '#osc-dual-level-a', 'Home');
      await U.tap(page, '#osc-dual-level-b', 0.5);
      out.levels = await step('level A 0, level B mid', (d) => d.dual.levelA === 0 && d.A.g < 1e-4
        && d.dual.levelB > 30 && d.dual.levelB < 70 && /^0/.test(d.levelA));
      await U.press(page, '#osc-dual-level-a', 'End');
      const r0 = await D();
      await U.press(page, '#osc-dual-a-range', 'ArrowRight', 'ArrowRight', 'ArrowRight');
      await U.tap(page, '#osc-dual-b-range', 0.3);
      out.ranges = await step('the A and B frequency sliders', (d) => d.dual.a.freq > r0.dual.a.freq
        && d.aFreq !== r0.aFreq && near(d.A.f, d.dual.a.freq * 2 ** (d.dual.a.detune / 1200), 2)
        && d.dual.b.freq !== r0.dual.b.freq && d.bFreq !== r0.bFreq
        && near(d.B.f, d.dual.b.freq * 2 ** (d.dual.b.detune / 1200), 2));
      // Phase & Stereo panel: the offset restarts the sounding B, the frequencies are the dual
      // voice's own
      await page.click('#osc-ptab-phase');
      await U.fill(page, '#osc-phase-offset', '90');
      out.offset = await step('phase offset 90 degrees', (d) => d.phase.phaseDeg === 90
        && d.dualPhase === 90 && d.A && d.B);
      await page.click('#osc-ptab-stereo');
      await U.fill(page, '#osc-stereo-fa', '300');
      await U.fill(page, '#osc-stereo-fb', '301');
      out.stereoFreqs = await step('stereo A 300 Hz, B 301 Hz', (d) => d.phase.freqA === 300
        && d.phase.freqB === 301 && d.dual.a.freq === 300 && d.dual.b.freq === 301
        && d.aFreq === '300' && d.bFreq === '301'
        && near(d.A.f, 300 * 2 ** (d.dual.a.detune / 1200), 1));
      // The route is taken when a note starts (the router is built per note): a route chosen
      // while a note sounds is judged on the next one.
      await page.click('#osc-dual-stereo');
      out.stereo = await step('dual routed stereo', (d) => d.dual.stereo
        && d.phase.route === 'stereo' && d.router.mode === 'split' && d.stereoBtn === 'true'
        && d.splitBtn === 'true');
      await U.unlatch(page);
      await U.latch(page);
      out.stereoNote = await step('the next note runs through the stereo router', (d) => d.live
        && d.liveCfg && d.liveCfg.mode === 'split' && d.corrState === 'live' && /\d/.test(d.corr)
        && d.A && d.B);
      await page.click('#osc-stereo-mono');
      out.mono = await step('stereo mono again', (d) => d.phase.route === 'mono'
        && !d.dual.stereo && d.splitBtn === 'false');
      // pan (the mono mix): the next note is panned through the router, and a pan moved while
      // it sounds reaches the live router
      await U.press(page, '#osc-stereo-pan', 'End');
      out.pan = await step('pan to the right', (d) => d.phase.pan === 1 && /right/.test(d.pan)
        && d.router.mode === 'mono' && d.router.panA === 1);
      await U.unlatch(page);
      await U.latch(page);
      out.panNote = await step('the next note is panned right', (d) => d.live && d.liveCfg
        && d.liveCfg.panA === 1 && d.liveCfg.panB === 1);
      await U.press(page, '#osc-stereo-pan', 'Home');
      out.panLive = await step('pan to the left reaches the sounding note', (d) =>
        d.phase.pan === -1
        && /left/.test(d.pan) && d.live && d.liveCfg && d.liveCfg.panA === -1);
      await U.tap(page, '#osc-stereo-pan', 0.5);
      await step('pan tapped to the centre', (d) => Math.abs(d.phase.pan) < 0.05);
      await page.click('#osc-stereo-split');
      out.split = await step('stereo split from the panel', (d) => d.phase.route === 'stereo'
        && d.dual.stereo && d.stereoBtn === 'true');
      await page.click('#osc-dual-mono');
      out.dualMono = await step('dual routed mono', (d) => !d.dual.stereo
        && d.phase.route === 'mono' && d.splitBtn === 'false');
    } finally {
      await U.unlatch(page);
      await U.singleSource(page);
    }
    const off = await D();
    return { ok: off.source !== 'dual' && off.enable === 'false', ...out };
  });

  def('ui-additive-controls', async ({ page }) => {
    const out = {};
    await U.singleSource(page);
    await H.workspace(page, 'synthesis');
    const A = () => page.evaluate(() => {
      const L = window.OSCILLA.labs.additive;
      const v = window.OSCILLA.engine.voice;
      const q = (s) => document.querySelector(s);
      return { on: L.enabled, sel: L.selected, partials: L.partials.slice(0, 4),
        coeff: L.coefficients().slice(0, 4).map((c) => ({ gainDb: c.gainDb })),
        wave: v && !v.ended && v.carrier ? v.carrier.type : null,
        same: !!(v && v.periodicWave && v.periodicWave === window.__c020wave),
        sw: q('#osc-add-enable').getAttribute('aria-checked'), preset: q('#osc-add-preset').value,
        gainText: q('#osc-add-gain-value').value, gainSlider: q('#osc-add-gain').value,
        phaseText: q('#osc-add-phase').value };
    });
    const step = (name, test) => U.poll(A, test, `ui-additive-controls: ${name}`);
    await page.evaluate(() => window.OSCILLA.app.setFrequency(220));
    if (await page.getAttribute('#osc-add-enable', 'aria-checked') !== 'true') {
      await page.click('#osc-add-enable');
    }
    try {
      await U.latch(page);
      out.on = await step('additive on: a PeriodicWave on the carrier', (a) => a.on
        && a.sw === 'true'
        && a.wave === 'custom');
      await page.evaluate(() => { window.__c020wave = window.OSCILLA.engine.voice.periodicWave; });
      await page.selectOption('#osc-add-preset', 'square');
      out.preset = await step('square preset', (a) => a.preset === 'square'
        && a.partials[1].gain < 1e-6 && a.partials[2].gain > 0.2 && !a.same && a.wave === 'custom');
      await page.evaluate(() => { window.__c020wave = window.OSCILLA.engine.voice.periodicWave; });
      await U.fill(page, '#osc-add-harmonic', '3');
      await U.fill(page, '#osc-add-gain-value', '-12 dB');
      // the fields and the bars show the level that plays, re full scale
      out.gain = await step('harmonic 3 plays at -12 dB', (a) => a.sel === 3
        && Math.abs(a.coeff[2].gainDb + 12) < 0.1 && Number(a.gainSlider) === -12 && !a.same);
      await page.evaluate(() => { window.__c020wave = window.OSCILLA.engine.voice.periodicWave; });
      await U.press(page, '#osc-add-gain', 'ArrowLeft', 'ArrowLeft');
      out.gainKey = await step('gain slider by keyboard', (a) => Number(a.gainSlider) === -13
        && a.gainText !== out.gain.gainText && Math.abs(a.coeff[2].gainDb + 13) < 0.1 && !a.same);
      await U.fill(page, '#osc-add-phase', '90');
      out.phase = await step('harmonic 3 at 90 degrees', (a) => Math.abs(a.partials[2].phase
        - Math.PI / 2) < 1e-6 && /90/.test(a.phaseText) && a.preset === 'custom');
      await page.click('#osc-add-enable');
      out.off = await step('additive off: the carrier is a plain oscillator again', (a) => !a.on
        && a.sw === 'false' && a.wave !== 'custom');
    } finally {
      await U.unlatch(page);
      if (await page.getAttribute('#osc-add-enable', 'aria-checked') === 'true') {
        await page.click('#osc-add-enable');
      }
      await page.selectOption('#osc-add-preset', 'sine');
    }
    return { ok: true, ...out };
  });

  const sourceState = () => {
    const O = window.OSCILLA;
    const a = O.app;
    const v = O.engine.voice && !O.engine.voice.ended ? O.engine.voice : null;
    const t = (s) => {
      const el = document.querySelector(s);
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
    };
    return { waveform: a.waveform, frequency: a.frequency, gainLevel: a.gainLevel,
      engineGain: O.engine.gainLevel, inputMode: a.inputMode, sourceKind: a.sourceKind,
      pattern: a.pattern, sweep: { ...a.sweep }, playing: a.playing,
      voice: v && v.carrier ? { wave: v.carrier.type, f: Math.round(v.carrier.frequency.value * 100)
        / 100, type: v.plan ? v.plan.type : null } : null,
      freqText: t('#osc-freq-value'), freqAlt: t('#osc-freq-alt'), gainText: t('#osc-gain-value'),
      sbFreq: t('[data-osc="status.frequency"]'), sbWave: t('[data-osc="status.waveform"]'),
      sbGain: t('[data-osc="status.gain"]'), sbPattern: t('[data-osc="status.pattern"]') };
  };

  def('ui-source-controls', async ({ page }) => {
    const out = {};
    await U.singleSource(page);
    await H.workspace(page, 'playground');
    const S = () => page.evaluate(sourceState);
    const step = (name, test) => U.poll(S, test, `ui-source-controls: ${name}`);
    const near = (x, y, tol) => x != null && Math.abs(x - y) <= tol;
    if (await page.getAttribute('#osc-source-osc', 'aria-checked') !== 'true') {
      await page.click('#osc-source-osc');
    }
    await page.evaluate(() => window.OSCILLA.app.setFrequency(440));
    await U.latch(page);
    await step('a latched 440 Hz tone', (s) => s.voice && near(s.voice.f, 440, 0.5));
    const wave = (w) => step(`waveform ${w}`, (s) => s.waveform === w && s.voice
      && s.voice.wave === w && new RegExp(w.slice(0, 3), 'i').test(s.sbWave || ''));
    await page.click('#osc-wave-sawtooth');
    out.sawtooth = await wave('sawtooth');
    await page.click('#osc-wave-square');
    out.square = await wave('square');
    await U.press(page, '#osc-wave-square', 'ArrowRight');
    out.triangle = await wave('triangle');
    await page.click('#osc-step-oct-down');
    out.octDown = await step('one octave down', (s) => near(s.frequency, 220, 0.01)
      && near(s.voice.f, 220, 0.5) && /220/.test(s.freqText) && /220/.test(s.sbFreq));
    await page.click('#osc-step-st-down');
    const st = 220 * 2 ** (-1 / 12);
    out.stDown = await step('one semitone down', (s) => near(s.frequency, st, 0.01)
      && near(s.voice.f, st, 0.5) && s.freqText !== out.octDown.freqText);
    await U.press(page, '#osc-step-10-up', 'Enter');
    out.tenUp = await step('ten hertz up by keyboard', (s) => near(s.frequency, st + 10, 0.01)
      && near(s.voice.f, st + 10, 0.5));
    const f0 = out.tenUp.frequency;
    await U.press(page, '#osc-freq-slider', 'ArrowRight', 'ArrowRight');
    out.slider = await step('frequency slider by keyboard', (s) => s.frequency > f0
      && near(s.voice.f, s.frequency, s.frequency * 0.01) && s.sbFreq !== out.tenUp.sbFreq);
    await page.click('#osc-mode-note');
    out.note = await step('note entry mode', (s) => s.inputMode === 'note'
      && s.freqAlt !== out.slider.freqAlt);
    await page.click('#osc-mode-freq');
    const g0 = out.note.gainLevel;
    await U.press(page, '#osc-gain', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft');
    out.gain = await step('gain slider by keyboard', (s) => s.gainLevel < g0
      && Math.abs(s.engineGain - s.gainLevel) < 1e-6 && s.gainText !== out.note.gainText
      && s.sbGain !== out.note.sbGain);
    await U.press(page, '#osc-gain', 'ArrowRight', 'ArrowRight', 'ArrowRight');
    await U.unlatch(page);
    await page.click('#osc-wave-sine');
    // the pattern source: a pattern, one of its parameters, and the sweep mode with its fields
    await page.click('#osc-source-pattern');
    await page.selectOption('#osc-pattern-select', 'pulse');
    out.pattern = await step('pattern Pulse', (s) => s.sourceKind === 'pattern'
      && s.pattern === 'pulse' && /pulse/i.test(s.sbPattern || ''));
    const param = page.locator('[data-osc="pattern.param"]').first();
    const key = await param.getAttribute('data-key');
    await param.fill('330');
    await param.press('Enter');
    out.param = await U.poll(() => page.evaluate(([k]) => {
      const el = document.querySelector(`[data-osc="pattern.param"][data-key="${k}"]`);
      return { key: k, value: el ? el.value : null };
    }, [key]), (p) => /330/.test(p.value), 'ui-source-controls: a typed pattern parameter');
    await page.selectOption('#osc-pattern-select', '__sweep');
    await page.fill('[data-osc="sweep.param"][data-key="end"]', '5000');
    await page.press('[data-osc="sweep.param"][data-key="end"]', 'Enter');
    await page.selectOption('#sw-direction', 'down');
    out.sweep = await step('sweep end 5 kHz, downwards', (s) => s.sweep.end === 5000
      && s.sweep.direction === 'down');
    await page.selectOption('#sw-direction', 'up');
    await page.click('#osc-source-osc');
    return { ok: true, ...out };
  });

  def('ui-device-and-analysis-controls', async ({ page }) => {
    const out = {};
    await H.workspace(page, 'analyzer');
    const V = () => page.evaluate(() => {
      const O = window.OSCILLA;
      const a = O.app;
      const v = O.engine.voice && !O.engine.voice.ended ? O.engine.voice : null;
      const q = (s) => document.querySelector(s);
      const mic = O.labs.mic && O.labs.mic.chart ? O.labs.mic.chart.options : null;
      return { continuous: a.continuousAllowed, contAria: q('#osc-continuous-toggle')
        .getAttribute('aria-checked'), limit: a.safetyLimit, limitDisabled: q('#osc-safety-limit')
        .disabled, len: v && Number.isFinite(v.deadline) ? v.deadline - v.t0 : null,
      timeWindowMs: a.timeWindowMs, specMax: O.labs.analysis.chart.options.maxHz,
      spg: { span: O.labs.spectrogram.view.options.timeSpanS,
        scale: O.labs.spectrogram.view.options.scale },
      mic: mic ? { avg: mic.averagingS, peak: mic.peakHold } : null,
      avgAria: q('[data-osc="mic.average"]').getAttribute('aria-checked'),
      peakAria: q('[data-osc="mic.peakHold"]').getAttribute('aria-checked') };
    });
    const step = (name, test) => U.poll(V, test, `ui-device-and-analysis-controls: ${name}`);
    const before = await V();
    await page.click('#osc-continuous-toggle');
    out.cont = await step('continuous toggled', (s) => s.continuous !== before.continuous
      && s.contAria === String(s.continuous));
    if (out.cont.continuous) {
      await U.press(page, '#osc-continuous-toggle', 'Space');
      await step('continuous off by keyboard', (s) => !s.continuous && s.contAria === 'false');
    }
    await page.selectOption('#osc-safety-limit', '0.5');
    out.limit = await step('hard limit 0.5 s', (s) => s.limit === 0.5 && !s.limitDisabled);
    await H.spaceDown(page);
    out.held = await step('a held note stops at the 0.5 s limit', (s) => s.len != null
      && s.len <= 0.5 + 0.05);
    await page.keyboard.up(' ');
    await H.waitNodes0(page);
    await page.selectOption('#osc-safety-limit', '2');
    await page.selectOption('#osc-time-window', '20');
    await page.selectOption('#osc-spec-max', '5000');
    await page.selectOption('#osc-spg-span-select', '5');
    await page.selectOption('#osc-spg-scale-select', 'linear');
    out.views = await step('time window, spectrum max, spectrogram span and scale', (s) =>
      s.timeWindowMs === 20 && s.specMax === 5000 && s.spg.span === 5 && s.spg.scale === 'linear');
    await page.click('[data-osc="mic.tab"][data-value="compare"]');
    await page.click('[data-osc="mic.average"]');
    await page.click('[data-osc="mic.peakHold"]');
    out.mic = await step('mic compare: average and peak hold', (s) => s.avgAria === 'true'
      && s.peakAria === 'true' && s.mic && s.mic.avg > 0 && s.mic.peak === true);
    await page.click('[data-osc="mic.average"]');
    await page.click('[data-osc="mic.peakHold"]');
    await step('mic compare options off', (s) => s.avgAria === 'false' && s.peakAria === 'false'
      && s.mic.avg === 0 && s.mic.peak === false);
    await page.click('[data-osc="mic.tab"][data-value="live"]');
    await page.selectOption('#osc-time-window', '5');
    await page.selectOption('#osc-spec-max', '20000');
    await page.selectOption('#osc-spg-span-select', '10');
    await page.selectOption('#osc-spg-scale-select', 'log');
    return { ok: true, ...out };
  });

  def('ui-settings-controls', async ({ page }) => {
    const out = {};
    await H.workspace(page, 'playground');
    const T = () => page.evaluate(() => {
      const a = window.OSCILLA.app;
      const v = window.OSCILLA.engine.voice;
      const t = (s) => document.querySelector(s).textContent.replace(/\s+/g, ' ').trim();
      return { a4: a.a4, duration: a.duration, attack: a.attack, release: a.release,
        rangeMode: a.rangeMode, rangeMin: a.rangeMin, rangeMax: a.rangeMax,
        open: document.querySelector('#osc-dlg-settings').open, freqAlt: t('#osc-freq-alt'),
        len: v && !v.ended && Number.isFinite(v.deadline) ? v.deadline - v.t0 : null,
        voice: v && !v.ended ? { attack: v.attack, release: v.release } : null };
    });
    const step = (name, test) => U.poll(T, test, `ui-settings-controls: ${name}`);
    await page.click('#osc-mode-note');
    await page.click('#osc-overflow');
    await page.click('[data-osc="header.settings"]');
    const s0 = await step('Settings opened from the menu', (s) => s.open);
    await U.fill(page, '#osc-set-a4', '432');
    out.a4 = await step('A4 432 Hz', (s) => s.a4 === 432 && s.freqAlt !== s0.freqAlt);
    await U.fill(page, '#osc-set-duration', '300');
    await U.fill(page, '#osc-set-attack', '50');
    await U.fill(page, '#osc-set-release', '400');
    out.env = await step('duration 300, attack 50, release 400 ms', (s) => s.duration === 300
      && s.attack === 50 && s.release === 400);
    await page.selectOption('#osc-set-range', 'advanced');
    out.advanced = await step('range Advanced', (s) => s.rangeMode === 'advanced'
      && s.rangeMax > s0.rangeMax);
    await page.selectOption('#osc-set-range', 'custom');
    await U.fill(page, '#osc-set-min', '100');
    await U.fill(page, '#osc-set-max', '5000');
    out.custom = await step('custom range 100 Hz to 5 kHz', (s) => s.rangeMode === 'custom'
      && s.rangeMin === 100 && s.rangeMax === 5000);
    await page.keyboard.press('Escape');
    await step('Settings closed', (s) => !s.open);
    await page.click('#osc-trigger');
    out.trigger = await step('a triggered note lasts the set 300 ms with its edges', (s) =>
      s.len != null && Math.abs(s.len - 0.3) < 0.02 && s.voice
      && Math.abs(s.voice.attack - 0.05) < 1e-6 && Math.abs(s.voice.release - 0.4) < 1e-6);
    await H.waitNodes0(page, 3000);
    await page.click('#osc-overflow');
    await page.click('[data-osc="header.settings"]');
    await step('Settings reopened', (s) => s.open);
    await page.selectOption('#osc-set-range', 'human');
    await U.fill(page, '#osc-set-a4', '440');
    await U.fill(page, '#osc-set-duration', '500');
    await U.fill(page, '#osc-set-attack', '10');
    await U.fill(page, '#osc-set-release', '30');
    await step('defaults restored', (s) => s.a4 === 440 && s.duration === 500 && s.attack === 10
      && s.release === 30 && s.rangeMode === 'human');
    await page.keyboard.press('Escape');
    await page.click('#osc-mode-freq');
    return { ok: true, ...out };
  });

  // K001 and K003 on the composed page, through main.js's wiring rather than the editor alone:
  // the V2 sequencer plays inside the engine's node accounting (engine.activeNodeCount rises
  // while it plays, with no instrument voice, and is 0 after STOP); the waveform the Sequencer
  // follows from the instrument is no undo step and survives an undo; undo and redo of a tempo
  // change move the Tempo select with the sequence.
  def('sequencer-engine-census-and-history', async ({ page }) => {
    await H.stopAll(page);
    const inMode = (w) => until(() => page.evaluate((x) =>
      document.querySelector('#osc-app').dataset.mode === x, w),
    { ms: 8000, what: `the ${w} workspace is shown` });
    const read = () => page.evaluate(() => {
      const e = window.OSCILLA.engine;
      const ed = window.OSCILLA.labs.sequencer.editor;
      return { playing: ed.playing, seqNodes: ed.stats().activeNodeCount,
        nodes: e.activeNodeCount, sources: e.activeSourceCount, voice: !!e.voice,
        tempo: ed.model.tempoBpm, select: document.querySelector('#osc-seq-tempo').value,
        waveform: ed.model.waveform, appWaveform: window.OSCILLA.app.waveform,
        depth: ed.historyDepth };
    });
    const when = (test, what, ms = 10000) => until(async () => {
      const v = await read();
      return test(v) ? v : null;
    }, { ms, what });
    const out = {};
    await H.navTo(page, 'sequencer');
    await inMode('sequencer');
    out.idle = await when((v) => !v.playing && v.nodes === 0 && v.sources === 0,
      'the engine is idle before the sequencer census');
    // Looped, so the sequence is still sounding whenever the poll first reads it.
    await page.evaluate(() => window.OSCILLA.labs.sequencer.editor.setLoop(true));
    await page.click('#osc-seq-play');
    out.playing = await when((v) => v.playing && v.seqNodes > 0 && !v.voice && v.nodes > 0
      && v.sources > 0, 'the engine counts the nodes of the playing sequence');
    await page.click('#osc-seq-stop');
    out.stopped = await when((v) => !v.playing && v.nodes === 0 && v.sources === 0,
      'the engine count is 0 after the sequencer STOP');
    await page.evaluate(() => window.OSCILLA.labs.sequencer.editor.setLoop(false));
    // The instrument's waveform, mirrored into the Sequencer: no undo step.
    const w0 = out.stopped.appWaveform;
    const w1 = w0 === 'square' ? 'triangle' : 'square';
    const depth0 = (await read()).depth;
    await page.evaluate((w) => window.OSCILLA.app.setWaveform(w), w1);
    out.mirrored = await when((v) => v.waveform === w1, 'the Sequencer follows the waveform');
    await page.selectOption('#osc-seq-tempo', '60');
    out.tempo60 = await when((v) => v.tempo === 60 && v.select === '60', 'tempo 60 applied');
    await page.focus('#osc-seq-timeline');
    await page.keyboard.press('Control+z');
    out.undone = await when((v) => v.tempo !== 60, 'Ctrl+Z undoes the tempo change');
    await page.keyboard.press('Shift+Control+z');
    out.redone = await when((v) => v.tempo === 60, 'Shift+Ctrl+Z redoes the tempo change');
    await page.keyboard.press('Control+z');
    out.back = await when((v) => v.tempo !== 60, 'Ctrl+Z undoes the tempo change again');
    await page.evaluate((w) => window.OSCILLA.app.setWaveform(w), w0);
    await H.navTo(page, 'playground');
    await inMode('playground');
    const tempo0 = out.idle.tempo;
    const ok = out.idle.nodes === 0 && out.playing.nodes > 0 && out.stopped.nodes === 0
      && out.stopped.sources === 0 && out.mirrored.depth === depth0
      && out.undone.tempo === tempo0 && out.undone.select === String(tempo0)
      && out.undone.waveform === w1 && out.undone.appWaveform === w1
      && out.redone.select === '60' && out.back.select === String(tempo0);
    return { ok, ...out };
  });

  // ---- C001: every stop path reads the sequencer's live state, not the 150 ms seqPlaying copy.
  // In-page probe: start the looped sequence and fire `how` in the SAME task, so the poll that
  // copies editor.playing into app.seqPlaying cannot have run (the window a fast Escape or a
  // backgrounded tab falls into). Returns the state read straight after the event.
  const seqPollWindow = (page, how) => page.evaluate((h) => {
    const a = window.OSCILLA.app;
    const ed = window.OSCILLA.labs.sequencer.editor;
    const played = ed.play();
    const at = { mirror: a.seqPlaying, editor: ed.playing };
    if (h === 'escape') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } else if (h === 'pagehide') {
      window.dispatchEvent(new Event('pagehide'));
    } else if (h === 'visibilitychange') {
      // A hidden document without hiding the test's page: shadow the getter for one dispatch.
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      try {
        document.dispatchEvent(new Event('visibilitychange'));
      } finally {
        delete document.hidden;
      }
    } else if (h === 'status-key') {
      document.querySelector('#osc-sb-play').click();
    }
    const after = { editor: ed.playing, mirror: a.seqPlaying, instrument: a.playing,
      voice: !!(window.OSCILLA.engine.voice && !window.OSCILLA.engine.voice.ended) };
    return { played, at, after };
  }, how);
  // The stopped sequence's voices drain (they fade, then release every node) and it stays off.
  const seqDrained = (page, what) => until(() => page.evaluate(() => {
    const ed = window.OSCILLA.labs.sequencer.editor;
    const st = ed.stats();
    return !ed.playing && !window.OSCILLA.app.seqPlaying && st.activeSourceCount === 0
      && st.activeNodeCount === 0 ? st : null;
  }), { ms: 6000, what });
  // The probes loop the sequence (so a missed stop keeps sounding) on a running context.
  const seqReady = async (page) => {
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('sequencer'));
    await page.waitForSelector('#osc-seq-play', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => window.OSCILLA.app.ensureAudio());
    await until(() => page.evaluate(() => {
      const ctx = window.OSCILLA.engine.ctx;
      return !!ctx && ctx.state === 'running';
    }), { ms: 8000, what: 'the audio context runs before the sequence probes' });
    await page.evaluate(() => window.OSCILLA.labs.sequencer.editor.setLoop(true));
  };
  const seqDone = (page) => page.evaluate(() => {
    window.OSCILLA.labs.sequencer.editor.setLoop(false);
    window.OSCILLA.app.setWorkspace('playground');
  });

  def('seq-stop-in-poll-window', async ({ page }) => {
    const res = {};
    try {
      await seqReady(page);
      for (const how of ['escape', 'pagehide', 'visibilitychange']) {
        const r = await seqPollWindow(page, how);
        res[how] = r;
        r.drained = await seqDrained(page, `${how} in the poll window: the sequence drains`);
      }
    } finally {
      await seqDone(page);
    }
    const ok = Object.values(res).every((r) => r.played && r.at.editor && !r.at.mirror
      && !r.after.editor && !r.after.mirror && !!r.drained);
    return { ok, ...res };
  });

  // The status-bar transport key (shown below 768 px) reads "Stop playback" while the sequence
  // plays: one press (click or Enter) stops it and starts no instrument voice. Pressed inside
  // the poll window it still stops the sequence (the live state); its label returns to Play.
  def('status-key-stops-only', async ({ page }) => {
    const res = {};
    const st = () => page.evaluate(() => {
      const a = window.OSCILLA.app;
      const e = window.OSCILLA.engine;
      return { editor: window.OSCILLA.labs.sequencer.editor.playing, mirror: a.seqPlaying,
        instrument: a.playing, voice: !!(e.voice && !e.voice.ended), nodes: e.activeNodeCount,
        label: document.querySelector('#osc-sb-play').getAttribute('aria-label') };
    });
    const quiet = (what) => until(async () => {
      const s = await st();
      return !s.editor && !s.mirror && !s.instrument && !s.voice && s.nodes === 0
        && s.label !== 'Stop playback' ? s : null;
    }, { ms: 6000, what });
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      await seqReady(page);
      await page.waitForSelector('#osc-sb-play', { state: 'visible', timeout: 8000 });
      for (const how of ['click', 'enter']) {
        await page.click('#osc-seq-play');
        const before = await until(async () => {
          const s = await st();
          return s.label === 'Stop playback' && s.editor ? s : null;
        }, { ms: 6000, what: `status key (${how}) reads Stop playback while the sequence plays` });
        res[how] = { before };
        if (how === 'click') {
          await page.click('#osc-sb-play');
        } else {
          await page.focus('#osc-sb-play');
          await page.keyboard.press('Enter');
        }
        res[how].after = await st();
        res[how].quiet = await quiet(`status key (${how}): nothing sounds after Stop playback`);
      }
      res.pollWindow = await seqPollWindow(page, 'status-key');
      res.pollWindow.quiet = await quiet('status key in the poll window: nothing sounds');
    } finally {
      await page.setViewportSize({ width: 1536, height: 1024 });
      await seqDone(page);
    }
    const pressed = (r) => r.before.label === 'Stop playback' && !r.after.editor
      && !r.after.instrument && !r.after.voice && !!r.quiet;
    const pw = res.pollWindow;
    const ok = pressed(res.click) && pressed(res.enter) && pw.played && pw.at.editor
      && !pw.at.mirror && !pw.after.editor && !pw.after.instrument && !pw.after.voice
      && !!pw.quiet;
    return { ok, ...res };
  });

  // ---- C007: the labs' play options are built in one place and the current lab state wins
  // (src/js/audio/lab-play-options.js). Each check is a finding's reproduction (PACK 03
  // engine-sync-1, -6, -7) and judges engine state the views also read, not a fixed delay.
  const quiet = (page, what) => until(() => H.nodes(page).then((n) => n === 0),
    { ms: 8000, what });
  const newVoice = (page, id, what) => until(() => page.evaluate((old) => {
    const e = window.OSCILLA.engine;
    const v = e.voice;
    return v && !v.ended && v.id !== old ? { id: v.id } : null;
  }, id), { ms: 10000, what });

  // engine-sync-1: a pattern change restarts the voice with a copy of its options; a lab
  // switched off while it sounded must stay off on the restarted voice.
  def('restart-follows-labs', async ({ page }) => {
    await H.continuous(page, true);
    const res = {};
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.setWaveform('sine'); a.setPattern('tone'); a.setFrequency(440);
    });
    await page.click('#osc-add-enable');
    await page.evaluate(() => { const a = window.OSCILLA.app; a.holding = true; a.play('hold'); });
    const v1 = await newVoice(page, 0, 'restart-follows-labs: held tone with Additive');
    res.withAdditive = await page.evaluate(() => window.OSCILLA.engine.voice.carrier.type);
    await page.click('#osc-add-enable'); // Additive off while it sounds
    await until(() => page.evaluate(() => {
      const v = window.OSCILLA.engine.voice;
      return v && !v.periodicWave && v.carrier.type === 'sine';
    }), { ms: 5000, what: 'restart-follows-labs: Additive off reaches the sounding carrier' });
    await page.evaluate(() => window.OSCILLA.app.setPattern('finite')); // a restart
    const v2 = await newVoice(page, v1.id, 'restart-follows-labs: voice restarted (Additive)');
    res.afterAdditive = await page.evaluate(() => {
      const v = window.OSCILLA.engine.voice;
      return { lab: window.OSCILLA.labs.additive.enabled, pw: !!v.periodicWave,
        carrier: v.carrier.type };
    });
    await page.evaluate(() => window.OSCILLA.app.stopNow());
    await quiet(page, 'restart-follows-labs: quiet after the Additive case');
    await page.evaluate(() => {
      window.OSCILLA.app.setPattern('tone');
      window.OSCILLA.labs.envelope.update({ adsr: { a: 0.01, d: 0.1, s: 0.6, r: 0.3 },
        enabled: true });
      const a = window.OSCILLA.app; a.holding = true; a.play('hold');
    });
    const v3 = await newVoice(page, v2.id, 'restart-follows-labs: held tone with the Envelope');
    res.withEnvelope = await page.evaluate(() => window.OSCILLA.engine.voice.adsr);
    await page.evaluate(() => {
      window.OSCILLA.labs.envelope.update({ enabled: false }); // Envelope off while it sounds
      window.OSCILLA.app.setPattern('finite');
    });
    await newVoice(page, v3.id, 'restart-follows-labs: voice restarted (Envelope)');
    res.afterEnvelope = await page.evaluate(() => {
      const v = window.OSCILLA.engine.voice;
      return { lab: window.OSCILLA.labs.envelope.enabled, adsr: v.adsr,
        stepEnvelope: typeof v.opts.stepEnvelope, viz: window.OSCILLA.viz.labInputs(v.plan).adsr };
    });
    await page.evaluate(() => { window.OSCILLA.app.stopNow(); window.OSCILLA.app.setPattern('tone'); });
    await quiet(page, 'restart-follows-labs: quiet at the end');
    const ok = res.withAdditive === 'custom' && !res.afterAdditive.lab && !res.afterAdditive.pw
      && res.afterAdditive.carrier === 'sine' && !!res.withEnvelope && !res.afterEnvelope.lab
      && res.afterEnvelope.adsr === null && res.afterEnvelope.stepEnvelope !== 'function'
      && res.afterEnvelope.viz === null;
    return { ok, ...res };
  });

  // engine-sync-6: Additive does not apply to a dual plan, live included: switching it on while
  // a dual voice sounds leaves both oscillators as a fresh dual voice has them.
  def('additive-skips-dual', async ({ page }) => {
    await H.continuous(page, true);
    const res = {};
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.source = 'dual'; a.setStereo(false); a.setDualFreq('a', '300'); a.setDualFreq('b', '1111');
      // an earlier check (ui-dual-phase-stereo-controls) leaves A square and B triangle
      a.dual.a.wave = 'sine'; a.dual.b.wave = 'sine';
      a.holding = true; a.play('hold');
    });
    await until(() => page.evaluate(() => {
      const v = window.OSCILLA.engine.voice;
      return !!(v && !v.ended && v.plan.type === 'dual');
    }), { ms: 10000, what: 'additive-skips-dual: dual voice sounding' });
    res.before = await page.evaluate(() => {
      const v = window.OSCILLA.engine.voice;
      return [v.live.A.osc.type, v.live.B.osc.type];
    });
    await page.click('#osc-add-enable'); // Additive on while the dual voice sounds
    res.live = await until(() => page.evaluate(() => {
      const O = window.OSCILLA;
      const v = O.engine.voice;
      if (!O.labs.additive.enabled || !v) return null;
      return { types: [v.live.A.osc.type, v.live.B.osc.type], pw: !!v.periodicWave,
        viz: O.viz.labInputs(v.plan).additive,
        refused: O.engine.setPeriodicWave(O.labs.additive.periodicWave(O.engine.ctx)) === false };
    }), { ms: 5000, what: 'additive-skips-dual: Additive on reached the lab' });
    await page.evaluate(() => window.OSCILLA.app.stopNow());
    await quiet(page, 'additive-skips-dual: quiet');
    await page.click('#osc-add-enable');
    await page.evaluate(() => { window.OSCILLA.app.source = 'single'; });
    const ok = res.before.join() === 'sine,sine' && res.live.types.join() === 'sine,sine'
      && !res.live.pw && res.live.viz === null && res.live.refused;
    return { ok, ...res };
  });

  // engine-sync-7: with the Envelope on, a finite tone and a steps pattern take the whole ADSR
  // (decay and sustain included), as a held tone does, and the views say so.
  def('adsr-reaches-programmed', async ({ page }) => {
    await H.continuous(page, true);
    const res = {};
    const duration = await page.evaluate(() => {
      const a = window.OSCILLA.app;
      const was = a.duration;
      a.setWaveform('sine'); a.setFrequency(440); a.duration = 5000; a.setPattern('finite');
      return was;
    });
    const midNote = async (on, what) => {
      await page.evaluate((env) => {
        window.OSCILLA.labs.envelope.update({ adsr: { a: 0.01, d: 0.1, s: 0.1, r: 0.3 },
          enabled: env });
        window.OSCILLA.app.trigger();
      }, on);
      // the analyser reads the last ~40 ms: anywhere between 0.5 s and 4 s is mid-note
      const got = await until(() => page.evaluate(() => {
        const e = window.OSCILLA.engine;
        const v = e.voice;
        if (!v || v.ended) return null;
        const t = e.ctx.currentTime - v.t0;
        if (t < 0.5 || t > 4) return null;
        const d = new Float32Array(e.analyser.fftSize);
        e.analyser.getFloatTimeDomainData(d);
        let pk = 0;
        for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
        return { peak: pk, adsr: v.adsr, env: e._valueAt(v.env, e.ctx.currentTime),
          viz: window.OSCILLA.viz.labInputs(v.plan).adsr };
      }), { ms: 15000, what });
      await page.evaluate(() => window.OSCILLA.app.stopNow());
      await quiet(page, `${what}: quiet`);
      return got;
    };
    res.off = await midNote(false, 'adsr-reaches-programmed: finite tone, Envelope off');
    res.on = await midNote(true, 'adsr-reaches-programmed: finite tone, Envelope on');
    res.ratio = res.off.peak > 0 ? res.on.peak / res.off.peak : null;
    // steps: every step holds at the sustain after its attack and decay
    res.steps = await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.setPattern('sequence');
      a.trigger();
      const e = window.OSCILLA.engine;
      const v = e.voice;
      const levels = v.plan.steps.filter((s) => s.dur > 0.24)
        .map((s) => e._valueAt(v.env, v.t0 + s.t + 0.12));
      return { type: v.plan.type, levels, viz: window.OSCILLA.viz.labInputs(v.plan).adsr };
    });
    await page.evaluate((was) => {
      const a = window.OSCILLA.app;
      a.stopNow(); a.duration = was; a.setPattern('tone');
      window.OSCILLA.labs.envelope.update({ enabled: false });
    }, duration);
    await quiet(page, 'adsr-reaches-programmed: quiet at the end');
    const near = (x, want) => Math.abs(x - want) < 0.01;
    const ok = !res.off.adsr && near(res.off.env, 1) && !!res.on.adsr && near(res.on.env, 0.1)
      && !!res.on.viz && res.ratio !== null && res.ratio < 0.2 && res.ratio > 0.05
      && res.steps.type === 'steps' && res.steps.levels.length > 0
      && res.steps.levels.every((l) => near(l, 0.1)) && !!res.steps.viz;
    return { ok, ...res };
  });

  // #296 R-2: the Envelope lab has a live path. With no pattern change or new note, a held
  // tone follows the panel: Sustain typed in its field (a click-free restart at the new level),
  // Release alone (in place, the same voice), and the power switch (off: level 1, on: back).
  // R-1: with the Envelope on, a continuous ping-pong sweep holds at the sustain too.
  // Run at the desktop size and at 390x844, where the panel's controls are reached by scrolling.
  const envelopeFollowsHeld = async (page) => {
    await H.continuous(page, true);
    await H.workspace(page, 'synthesis'); // the Envelope panel is on this workspace
    const res = {};
    // the voice's envelope level and the analyser's peak, once the note is past a + d
    const held = (old, what, want) => until(() => page.evaluate(([prev, w]) => {
      const O = window.OSCILLA;
      const e = O.engine;
      const v = e.voice;
      if (!v || v.ended || v.releasing || (prev != null && v.id === prev)) return null;
      if (e.ctx.currentTime - v.t0 < 0.4) return null;
      const env = e._valueAt(v.env, e.ctx.currentTime);
      if (w != null && Math.abs(env - w) > 0.01) return null;
      const d = new Float32Array(e.analyser.fftSize);
      e.analyser.getFloatTimeDomainData(d);
      let pk = 0;
      for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
      // the analyser's window may still hold the attack (Firefox under load): wait until the
      // output is at the envelope's level (the instrument level times the sustain), +-25 %
      const out = O.app.gainLevel * (w == null ? env : w);
      if (Math.abs(pk - out) > out * 0.25) return null;
      return { id: v.id, adsr: v.adsr, release: v.release, env, peak: pk,
        viz: O.viz.labInputs(v.plan).adsr, lab: O.labs.envelope.enabled };
    }, [old, want]), { ms: 10000, what });
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.setWaveform('sine'); a.setPattern('tone'); a.setFrequency(440);
      window.OSCILLA.labs.envelope.update({ adsr: { a: 0.01, d: 0.1, s: 0.6, r: 0.3 },
        enabled: true });
      a.holding = true; a.play('hold');
    });
    res.start = await held(null, 'envelope-follows-held: held tone at sustain 0.6', 0.6);
    await page.fill('#osc-env-sustain-value', '0.1');
    await page.dispatchEvent('#osc-env-sustain-value', 'change');
    res.sustain = await held(res.start.id, 'envelope-follows-held: Sustain 0.1 reaches it', 0.1);
    res.ratio = res.start.peak > 0 ? res.sustain.peak / res.start.peak : null;
    await page.fill('#osc-env-release-value', '50');
    await page.dispatchEvent('#osc-env-release-value', 'change');
    res.release = await until(() => page.evaluate(() => {
      const v = window.OSCILLA.engine.voice;
      return v && Math.abs(v.release - 0.05) < 1e-9 ? { id: v.id, r: v.adsr.r } : null;
    }), { ms: 5000, what: 'envelope-follows-held: Release 50 ms reaches the held voice' });
    await page.click('#osc-env-enable'); // off while it sounds
    res.off = await held(res.sustain.id, 'envelope-follows-held: Envelope off reaches it', 1);
    await page.click('#osc-env-enable'); // on again
    res.on = await held(res.off.id, 'envelope-follows-held: Envelope on reaches it', 0.1);
    await page.evaluate(() => window.OSCILLA.app.stopNow());
    await quiet(page, 'envelope-follows-held: quiet after the held tone');
    const was = await page.evaluate(() => {
      const a = window.OSCILLA.app;
      const keep = { source: a.source, sweep: JSON.parse(JSON.stringify(a.sweep)) };
      a.source = 'sweep';
      Object.assign(a.sweep, { start: 200, end: 2000, durationMs: 1000, direction: 'pingpong' });
      a.setSweepRepeat('continuous');
      a.holding = true; a.play('hold');
      return keep;
    });
    res.sweep = await held(res.on.id, 'envelope-follows-held: ping-pong sweep at sustain', 0.1);
    res.sweepPlan = await page.evaluate(() => {
      const p = window.OSCILLA.engine.voice.plan;
      return { kind: p.kind, envelope: p.envelope };
    });
    await page.evaluate((keep) => {
      const a = window.OSCILLA.app;
      a.stopNow(); a.source = keep.source; Object.assign(a.sweep, keep.sweep);
      window.OSCILLA.labs.envelope.update({ adsr: { a: 0.01, d: 0.1, s: 0.6, r: 0.3 },
        enabled: false });
    }, was);
    await quiet(page, 'envelope-follows-held: quiet at the end');
    await H.workspace(page, 'playground');
    const ok = res.start.adsr.s === 0.6 && res.sustain.adsr.s === 0.1
      && res.sustain.viz.s === 0.1 && res.ratio > 0.1 && res.ratio < 0.25
      && res.release.id === res.sustain.id && res.release.r === 0.05
      && res.off.adsr === null && res.off.viz === null && !res.off.lab && res.off.release > 0
      && res.on.adsr && res.on.adsr.s === 0.1 && res.on.lab
      && res.sweepPlan.kind === 'continuous' && res.sweepPlan.envelope === 'whole'
      && res.sweep.adsr && res.sweep.adsr.s === 0.1;
    return { ok, ...res };
  };
  def('envelope-follows-held', async ({ page }) => {
    const res = {};
    for (const [width, height] of [[1536, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height });
      res[`${width}x${height}`] = await envelopeFollowsHeld(page);
    }
    await page.setViewportSize({ width: 1536, height: 1024 });
    return { ok: Object.values(res).every((r) => r.ok), ...res };
  });

  // #296 R-7: a drag is one edit. The Sustain slider dragged in 20 'input' events and the
  // graph's S handle dragged in 20 pointer moves leave the held voice sounding (no restart, no
  // extra voice) until the drag ends; its 'change' / pointerup restarts it once, at the value
  // the drag ended on. The counters are engine 'play' events and audibleVoiceCount, sampled
  // after each event's handlers have run. At the desktop size and at 390x844.
  const envelopeDragOneRestart = async (page, what) => {
    await H.continuous(page, true);
    await H.workspace(page, 'synthesis');
    const voiceAt = (old, label, want) => until(() => page.evaluate(([prev, w]) => {
      const e = window.OSCILLA.engine;
      const v = e.voice;
      if (!v || v.ended || v.releasing || v.id === prev || !v.adsr) return null;
      if (e.ctx.currentTime - v.t0 < 0.4) return null;
      const env = e._valueAt(v.env, e.ctx.currentTime);
      return Math.abs(env - w) < 0.01 && Math.abs(v.adsr.s - w) < 1e-9 ? { id: v.id, env } : null;
    }, [old, want]), { ms: 10000, what: `${what}: ${label}` });
    await page.evaluate(() => {
      const O = window.OSCILLA;
      const a = O.app;
      a.setWaveform('sine'); a.setPattern('tone'); a.setFrequency(440);
      O.labs.envelope.update({ adsr: { a: 0.01, d: 0.1, s: 0.6, r: 0.3 }, enabled: true });
      a.holding = true; a.play('hold');
      const e = O.engine;
      const c = { plays: 0, maxAudible: 0 };
      window.__r7 = c;
      c.off = e.on((t) => { if (t === 'play') c.plays++; });
      // bubbling listeners on window run after the controls' own handlers
      const sample = () => { c.maxAudible = Math.max(c.maxAudible, e.audibleVoiceCount); };
      window.addEventListener('input', sample);
      window.addEventListener('pointermove', sample);
      c.unsample = () => {
        window.removeEventListener('input', sample);
        window.removeEventListener('pointermove', sample);
      };
    });
    const res = {};
    res.start = await voiceAt(null, 'held tone at sustain 0.6', 0.6);
    res.slider = await page.evaluate(() => {
      const c = window.__r7;
      const id = window.OSCILLA.engine.voice.id;
      c.plays = 0;
      c.maxAudible = 0;
      const el = document.querySelector('#osc-env-sustain');
      for (let i = 1; i <= 20; i++) {
        el.value = (0.6 - (0.5 * i) / 20).toFixed(2);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const during = { plays: c.plays, maxAudible: c.maxAudible,
        same: window.OSCILLA.engine.voice.id === id };
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { during, plays: c.plays, lab: window.OSCILLA.labs.envelope.adsr.s };
    });
    res.afterSlider = await voiceAt(res.start.id, 'Sustain 0.1 after the slider drag', 0.1);
    const canvas = page.locator('#osc-chart-envelope canvas');
    await canvas.scrollIntoViewIfNeeded({ timeout: 5000 });
    const at = await page.evaluate(() => {
      const l = window.OSCILLA.labs.envelope.graph.getLayout();
      const c = document.querySelector('#osc-chart-envelope canvas').getBoundingClientRect();
      window.__r7.plays = 0;
      window.__r7.maxAudible = 0;
      return { x: c.left + l.handles.sustain.x, y: c.top + l.handles.sustain.y,
        id: window.OSCILLA.engine.voice.id };
    });
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y - 30, { steps: 20 });
    res.graphDuring = await page.evaluate((id) => ({ plays: window.__r7.plays,
      maxAudible: window.__r7.maxAudible, same: window.OSCILLA.engine.voice.id === id,
      lab: window.OSCILLA.labs.envelope.adsr.s }), at.id);
    await page.mouse.up();
    res.graph = await page.evaluate(() => ({ plays: window.__r7.plays,
      lab: window.OSCILLA.labs.envelope.adsr.s }));
    res.afterGraph = await voiceAt(at.id, 'the graph drag\'s sustain reaches the held voice',
      res.graph.lab);
    await page.evaluate(() => {
      const c = window.__r7;
      c.off(); c.unsample(); delete window.__r7;
      window.OSCILLA.app.stopNow();
      window.OSCILLA.labs.envelope.update({ adsr: { a: 0.01, d: 0.1, s: 0.6, r: 0.3 },
        enabled: false });
    });
    await quiet(page, `${what}: quiet at the end`);
    await H.workspace(page, 'playground');
    const s = res.slider;
    const g = res.graphDuring;
    const ok = s.during.plays === 0 && s.during.same && s.during.maxAudible === 1
      && s.plays === 1 && Math.abs(s.lab - 0.1) < 1e-9
      && g.plays === 0 && g.same && g.maxAudible === 1 && g.lab > 0.1 + 1e-6
      && res.graph.plays === 1;
    return { ok, ...res };
  };
  def('envelope-drag-one-restart', async ({ page }) => {
    const res = {};
    for (const [width, height] of [[1536, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height });
      const size = `${width}x${height}`;
      res[size] = await envelopeDragOneRestart(page, `envelope-drag-one-restart ${size}`);
    }
    await page.setViewportSize({ width: 1536, height: 1024 });
    return { ok: Object.values(res).every((r) => r.ok), ...res };
  });

  // #296 R-9: the keyboard is one edit too. A range input fires 'input' and 'change' for
  // every arrow step, so the Sustain slider's keys settle while one is down and its keyup
  // commits once after the lab's keyCommitMs. ArrowLeft held for 20 auto-repeats leaves the
  // held voice sounding (no restart, one audible voice) and restarts it once, at the value it
  // stopped on; 20 ArrowRight presses restart it once, plus one per gap between a keyup and
  // the next keydown longer than the window (measured in the page, so a slow host is not
  // a failure); a real mouse drag of the slider still restarts it once, at the release.
  const envelopeKeysOneRestart = async (page, what) => {
    await H.continuous(page, true);
    await H.workspace(page, 'synthesis');
    const voiceAt = (old, label, want) => until(() => page.evaluate(([prev, w]) => {
      const e = window.OSCILLA.engine;
      const v = e.voice;
      if (!v || v.ended || v.releasing || v.id === prev || !v.adsr) return null;
      if (e.ctx.currentTime - v.t0 < 0.4) return null;
      const env = e._valueAt(v.env, e.ctx.currentTime);
      return Math.abs(env - w) < 0.01 && Math.abs(v.adsr.s - w) < 1e-9 ? { id: v.id, env } : null;
    }, [old, want]), { ms: 10000, what: `${what}: ${label}` });
    const committed = (label, n) => until(() => page.evaluate((k) => (window.__r9.plays >= k
      ? window.__r9.plays : null), n), { ms: 5000, what: `${what}: ${label}` });
    await page.evaluate(() => {
      const O = window.OSCILLA;
      const a = O.app;
      a.setWaveform('sine'); a.setPattern('tone'); a.setFrequency(440);
      O.labs.envelope.update({ adsr: { a: 0.01, d: 0.1, s: 0.6, r: 0.3 }, enabled: true });
      a.holding = true; a.play('hold');
      const e = O.engine;
      const el = document.querySelector('#osc-env-sustain');
      const c = { plays: 0, maxAudible: 0, downs: [], ups: [] };
      window.__r9 = c;
      c.off = e.on((t) => { if (t === 'play') c.plays++; });
      // bubbling listeners on window run after the slider's own handlers
      const sample = () => { c.maxAudible = Math.max(c.maxAudible, e.audibleVoiceCount); };
      const down = (ev) => { if (ev.target === el) c.downs.push(performance.now()); };
      const up = (ev) => { if (ev.target === el) c.ups.push(performance.now()); };
      for (const t of ['input', 'change', 'pointermove']) window.addEventListener(t, sample);
      window.addEventListener('keydown', down);
      window.addEventListener('keyup', up);
      c.unsample = () => {
        for (const t of ['input', 'change', 'pointermove']) window.removeEventListener(t, sample);
        window.removeEventListener('keydown', down);
        window.removeEventListener('keyup', up);
      };
      c.reset = () => {
        c.plays = 0; c.maxAudible = 0; c.downs = []; c.ups = [];
        return e.voice.id;
      };
      c.read = (id) => ({ plays: c.plays, maxAudible: c.maxAudible, downs: c.downs.length,
        same: e.voice.id === id, lab: O.labs.envelope.adsr.s, slider: Number(el.value) });
    });
    const res = { windowMs: await page.evaluate(() => window.OSCILLA.labs.envelope.keyCommitMs) };
    res.start = await voiceAt(null, 'held tone at sustain 0.6', 0.6);
    const slider = page.locator('#osc-env-sustain');
    await slider.scrollIntoViewIfNeeded({ timeout: 5000 });
    await slider.focus({ timeout: 5000 });

    // ArrowLeft held: one keydown, 19 auto-repeats, then the keyup
    let id = await page.evaluate(() => window.__r9.reset());
    for (let i = 0; i < 20; i++) await page.keyboard.down('ArrowLeft');
    res.held = await page.evaluate((v) => window.__r9.read(v), id);
    await page.keyboard.up('ArrowLeft');
    res.heldPlays = await committed('the held keys commit', 1);
    res.afterHeld = await voiceAt(res.start.id, 'Sustain 0.4 after the held key', 0.4);
    res.heldEnd = await page.evaluate((v) => window.__r9.read(v), id);

    // 20 presses of ArrowRight
    id = await page.evaluate(() => window.__r9.reset());
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
    res.pressed = await page.evaluate((v) => window.__r9.read(v), id);
    res.pressPlays = await committed('the presses commit', 1);
    res.afterPresses = await voiceAt(res.afterHeld.id, 'Sustain 0.6 after the presses', 0.6);
    res.pressEnd = await page.evaluate((w) => {
      const c = window.__r9;
      let gaps = 0;
      for (let i = 1; i < c.downs.length; i++) if (c.downs[i] - c.ups[i - 1] > w) gaps++;
      return { plays: c.plays, gaps, downs: c.downs.length, ups: c.ups.length };
    }, res.windowMs);

    // a real mouse drag of the slider: no key, so its inputs settle and its change commits
    const box = await slider.boundingBox();
    id = await page.evaluate(() => window.__r9.reset());
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.6, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, y, { steps: 20 });
    res.dragDuring = await page.evaluate((v) => window.__r9.read(v), id);
    await page.mouse.up();
    res.dragPlays = await committed('the mouse drag commits', 1);
    res.drag = await page.evaluate((v) => window.__r9.read(v), id);
    res.afterDrag = await voiceAt(res.afterPresses.id, 'the drag\'s sustain reaches the voice',
      res.drag.lab);
    res.dragEnd = await page.evaluate((v) => window.__r9.read(v), id);

    await page.evaluate(() => {
      const c = window.__r9;
      c.off(); c.unsample(); delete window.__r9;
      document.activeElement.blur();
      window.OSCILLA.app.stopNow();
      window.OSCILLA.labs.envelope.update({ adsr: { a: 0.01, d: 0.1, s: 0.6, r: 0.3 },
        enabled: false });
    });
    await quiet(page, `${what}: quiet at the end`);
    await H.workspace(page, 'playground');
    const h = res.held;
    const d = res.dragDuring;
    const ok = res.windowMs > 0 && res.windowMs <= 500
      && h.downs === 20 && h.plays === 0 && h.same && h.maxAudible === 1
      && Math.abs(h.lab - 0.4) < 1e-9 && res.heldEnd.plays === 1
      && res.pressed.downs === 20 && res.pressEnd.ups === 20
      && res.pressEnd.plays >= 1 && res.pressEnd.plays <= 1 + res.pressEnd.gaps
      && d.plays === 0 && d.same && d.maxAudible === 1 && d.lab < 0.6 - 1e-6
      && res.dragEnd.plays === 1;
    return { ok, ...res };
  };
  def('envelope-keys-one-restart', async ({ page }) => {
    const res = {};
    for (const [width, height] of [[1536, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height });
      const size = `${width}x${height}`;
      res[size] = await envelopeKeysOneRestart(page, `envelope-keys-one-restart ${size}`);
    }
    await page.setViewportSize({ width: 1536, height: 1024 });
    return { ok: Object.values(res).every((r) => r.ok), ...res };
  });

  // T001 (truth-table row GEN-01, ADR 0002): the output says when the safety ceiling acts. The
  // audit probe's path (continuous, 1 kHz, latch, Filter Lab peaking 1 kHz Q 1 +24 dB at the
  // default gain) shows the state in the source panel and in the status bar, unclipped by the
  // bar, at 1536x1024 and 390x844; it clears within a named deadline once the boost is removed;
  // the same path without the boost, idle, and sine, square and sawtooth at 100 % gain with no
  // insert show nothing. The pure judgement is tests/unit/readout-states-ceiling.test.mjs.
  def('output-ceiling-indicator', async ({ page }) => {
    const res = { sizes: {}, plain: {} };
    const view = () => page.evaluate(() => {
      const a = window.OSCILLA.app;
      const bar = document.querySelector('[data-osc="status.state"]').parentElement;
      const box = (sel) => {
        const el = document.querySelector(sel);
        const b = el.getBoundingClientRect();
        const p = bar.getBoundingClientRect();
        return { shown: getComputedStyle(el).display !== 'none' && b.width > 0,
          inBar: b.left >= p.left - 0.5 && b.right <= p.right + 0.5,
          inView: b.left >= -0.5 && b.right <= window.innerWidth + 0.5,
          text: el.textContent.replace(/\s+/g, ' ').trim() };
      };
      const ctx = window.OSCILLA.engine.ctx;
      return { flag: a.outputAtCeiling, acting: a.ceilingActing, playing: a.playing,
        source: box('[data-osc="source.ceiling"]'), status: box('[data-osc="status.ceiling"]'),
        label: box('[data-osc="status.label"]'), title: document.querySelector('#osc-gain-value').title,
        fraction: window.OSCILLA.viz.ceiling.fraction, time: ctx ? ctx.currentTime : 0,
        width: window.innerWidth, scroll: document.documentElement.scrollWidth };
    });
    const none = (v) => !v.flag && !v.acting && !v.source.shown && !v.status.shown;
    // Sound on, without the indicator, for 0.6 s of audio time: every poll is recorded.
    const holdQuiet = async (what) => {
      const seen = [];
      const t0 = (await view()).time;
      await until(async () => {
        const v = await view();
        seen.push(v);
        return v.playing && v.time >= t0 + 0.6;
      }, { ms: 5000, what });
      return { polls: seen.length, flagged: seen.filter((v) => !none(v)).length };
    };
    const filterBefore = await page.evaluate(() => ({ ...window.OSCILLA.labs.filter.config }));
    await H.continuous(page, true);
    for (const [w, h] of [[1536, 1024], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      const r = {};
      r.idle = none(await view());
      await page.evaluate(() => {
        const a = window.OSCILLA.app;
        a.setGainPct(57);
        a.setWaveform('sine');
        a.setFrequency(1000);
        window.OSCILLA.labs.filter.update({ type: 'peaking', frequency: 1000, Q: 1, gain: 24,
          enabled: true });
        a.toggleLatch();
      });
      const on = await until(async () => {
        const v = await view();
        // The window fills over 0.17 s while the filter glides in: wait for a full one.
        return v.acting && v.source.shown && v.status.shown && v.fraction > 0.5 ? v : null;
      }, { ms: 5000, what: `the ceiling indicator shows under a +24 dB boost at ${w}x${h}` });
      r.on = { status: on.status, source: on.source, labelHidden: !on.label.shown,
        fraction: +on.fraction.toFixed(3), setpointTitle: /setpoint/.test(on.title)
          && /OUTPUT AT CEILING \(clipped\)/.test(on.title), scroll: on.scroll <= on.width };
      await page.evaluate(() => window.OSCILLA.labs.filter.update({ enabled: false }));
      const off = await until(async () => {
        const v = await view();
        return none(v) && v.label.shown ? v : null;
      }, { ms: 2000, what: `the ceiling indicator clears within 2 s of the boost removed (${w})` });
      r.cleared = off.playing && !/clipped/.test(off.title);
      r.unboosted = await holdQuiet(`the unboosted 1 kHz sine sounds 0.6 s at ${w}`);
      await page.evaluate(() => window.OSCILLA.app.stopNow());
      await until(async () => {
        const v = await view();
        return !v.playing && none(v);
      }, { ms: 3000, what: `idle after the stop shows no ceiling state (${w})` });
      r.idleAfter = true;
      r.ok = r.idle && r.idleAfter && r.cleared && r.on.status.inBar && r.on.status.inView
        && r.on.source.inView && r.on.labelHidden && r.on.setpointTitle && r.on.scroll
        && r.on.status.text === '\u26A0\uFE0E OUTPUT AT CEILING (clipped)'
        && r.on.source.text === r.on.status.text && r.on.fraction > 0.5
        && r.unboosted.flagged === 0 && r.unboosted.polls > 1;
      res.sizes[`${w}x${h}`] = r;
    }
    await page.setViewportSize({ width: 1536, height: 1024 });
    // 100 % gain, no insert: the pre-ceiling peak is at or below the cap (P05 audit: sine
    // -12.04, square -12.45, sawtooth -12.70 dBFS).
    for (const wave of ['sine', 'square', 'sawtooth']) {
      await page.evaluate((wv) => {
        const a = window.OSCILLA.app;
        a.setGainPct(100);
        a.setWaveform(wv);
        a.toggleLatch();
      }, wave);
      res.plain[wave] = await holdQuiet(`${wave} at 100 % gain sounds 0.6 s with no insert`);
      await page.evaluate(() => window.OSCILLA.app.stopNow());
      await until(() => page.evaluate(() => !window.OSCILLA.app.playing
        && window.OSCILLA.engine.activeNodeCount === 0),
      { ms: 3000, what: `the ${wave} voice is freed` });
    }
    await page.evaluate((cfg) => {
      const a = window.OSCILLA.app;
      a.setGainPct(57);
      a.setWaveform('sine');
      window.OSCILLA.labs.filter.update(cfg);
    }, filterBefore);
    const ok = Object.values(res.sizes).every((r) => r.ok)
      && Object.values(res.plain).every((p) => p.flagged === 0 && p.polls > 1);
    return { ok, ...res };
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
          // The compact Studio's chips share a data-osc; their node or clip id tells them apart.
          const key = a.id || (a.dataset.osc ? [a.dataset.osc, a.dataset.nodeId,
            a.dataset.clipId].filter(Boolean).join(':') : a.outerHTML.slice(0, 60));
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
    await page.waitForSelector('#osc-dlg-help[open]', { timeout: 8000 });
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
    await page.waitForSelector('#osc-dlg-save[open]', { timeout: 8000 });
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
          await page.waitForFunction(() => window.OSCILLA.app.workspace === 'playground', null,
            { timeout: 8000 });
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

  // C015 (finding engine-sync-3): a context closed from outside makes the engine discard it and
  // detach the microphone graph, stopping its tracks. A stopped track dispatches no 'ended', so
  // the lab learns of it only from the engine's detach event (adapter.onMicDetached). It must
  // then report off, reset its button and say why, and the next start must read the new
  // context, not the analyser of the dead one. The stream comes from installSynthMic, so all
  // three engines run every step.
  def('mic-detach-on-close', async ({ page, errors }) => {
    const errorsBefore = errors.length;
    const shows = (ws) => page.waitForFunction(
      (w) => document.querySelector('#osc-app').dataset.mode === w, ws, { timeout: 8000 });
    await page.evaluate(installSynthMic);
    await H.navTo(page, 'analyzer');
    await shows('analyzer');
    const state = () => page.evaluate(() => {
      const e = window.OSCILLA.engine;
      const m = window.OSCILLA.labs.mic;
      const b = document.getElementById('osc-mic-toggle');
      const an = m.analyser;
      return { active: m.active, error: m.error, hasAnalyser: !!an,
        analyserOnEngineCtx: !!(an && e.ctx && an.context === e.ctx),
        engineCtx: !!e.ctx, newCtx: !!(e.ctx && e.ctx !== window.__oscOldCtx),
        engineMicNodes: e.micNodeCount, engineAttachment: !!e.micAttachment,
        pressed: b.getAttribute('aria-pressed'), label: b.textContent.trim(),
        detected: document.getElementById('osc-mic-detected').textContent.trim() };
    });
    const out = {};
    try {
      await page.click('#osc-mic-toggle');
      out.live = await until(async () => {
        const s = await state();
        return s.active && s.engineMicNodes > 0 && s.analyserOnEngineCtx && s;
      }, { ms: 10000, what: 'mic-detach-on-close: the mic lab is live on the engine context' });
      out.liveTracks = await page.evaluate(() => {
        window.__oscLabStream = window.OSCILLA.labs.mic.stream;
        return window.__oscLabStream.getTracks().map((t) => t.readyState);
      });
      await page.evaluate(() => {
        window.__oscOldCtx = window.OSCILLA.engine.ctx;
        return window.__oscOldCtx.close();
      });
      // The engine discards the context and emits the detach in one onstatechange call, so the
      // lab's state is final once the engine has dropped the context.
      await until(() => page.evaluate(() => window.OSCILLA.engine.ctx === null),
        { ms: 10000, what: 'mic-detach-on-close: the engine discards the closed context' });
      out.closed = await state();
      out.closedTracks = await page.evaluate(
        () => window.__oscLabStream.getTracks().map((t) => t.readyState));
      // The next press starts the microphone again on a context the engine rebuilds. A lab
      // that still reports live (the defect) would take that press as a stop: not pressed.
      if (!out.closed.active) {
        await page.click('#osc-mic-toggle');
        out.restarted = await until(async () => {
          const s = await state();
          return (s.active || s.error) && s;
        }, { ms: 10000, what: 'mic-detach-on-close: the second start settles' });
        await page.click('#osc-mic-toggle');
        out.stopped = await state();
      }
    } finally {
      await page.evaluate(() => {
        const m = window.OSCILLA.labs.mic;
        if (m.active) m.stop();
        if (window.__oscSynthMic) window.__oscSynthMic.restore();
        delete window.__oscOldCtx;
        delete window.__oscLabStream;
        window.OSCILLA.app.alerts = [];
      });
      await H.navTo(page, 'playground');
      await shows('playground');
    }
    const c = out.closed;
    const r = out.restarted || {};
    const st = out.stopped || {};
    const v = {
      setupLive: out.live.pressed === 'true' && out.liveTracks.every((t) => t === 'live'),
      engineDetached: !c.engineCtx && c.engineMicNodes === 0 && !c.engineAttachment,
      tracksEnded: out.closedTracks.length > 0 && out.closedTracks.every((t) => t === 'ended'),
      labOffAfterClose: c.active === false && c.hasAnalyser === false,
      buttonOffAfterClose: c.pressed === 'false' && c.label === 'Use microphone',
      reasonStated: /audio context was closed/.test(c.error) && c.detected === c.error,
      restartOnNewContext: r.active === true && r.newCtx && r.analyserOnEngineCtx
        && r.pressed === 'true' && r.error === '',
      // The user's own Stop states no engine loss (review F1 of #289): the engine emits its
      // 'user' detach inside the lab's stop(), so a lab that released its analyser after the
      // call would read "The audio engine disconnected the microphone" here.
      stopAfterRestart: st.active === false && st.pressed === 'false'
        && st.engineMicNodes === 0 && st.error === ''
        && st.detected === 'UNAVAILABLE (microphone off)',
      noPageErrors: errors.length === errorsBefore,
    };
    const ok = Object.values(v).every(Boolean);
    return { ok, v, ...out, errors: errors.slice(errorsBefore, errorsBefore + 5) };
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
    if (mics.length === 1) {
      RUN.skip(browserName, 'phone-bars-with-microphone', 'no fake capture device in this browser');
    }
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
    await page.waitForFunction(() => document.querySelector('#osc-app').dataset.mode === 'about',
      null, { timeout: 8000 });
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
        // U002: the headline is the release line, the workspaces of the navigation are listed
        // in its order, and What comes next renders the bundled roadmap.
        headline: q('#osc-about-line-title').textContent.replace(/\s+/g, ' ').trim(),
        navIds: [...document.querySelectorAll('#osc-nav a[data-osc^="nav."]')]
          .map((a) => a.dataset.osc.slice('nav.'.length)),
        workspaceIds: [...view.querySelectorAll('[data-osc="about.workspaces"] > li')]
          .filter(shown).map((li) => li.dataset.osc.slice('about.workspace.'.length)),
        next: [...view.querySelectorAll('[data-osc="about.next"] > li')].filter(shown)
          .map((li) => ({ id: li.dataset.milestone,
            text: li.textContent.replace(/\s+/g, ' ').trim() })),
        othersHidden: ['#osc-view-learn', '#osc-view-presets', '#osc-panel-source', '#osc-panel-analysis']
          .every((s) => !shown(q(s))),
      };
    });
    const v = res.view;
    const roadmap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'data',
      'roadmap.json'), 'utf8')).milestones;
    res.roadmapOk = roadmap.length > 0 && v.next.length === roadmap.length
      && roadmap.every((m, i) => v.next[i].id === m.id && v.next[i].text.includes(m.title)
        && v.next[i].text.includes(`${m.done} of ${m.required} done`));
    res.workspacesOk = v.navIds.length > 0 && v.workspaceIds.join() === v.navIds.join();
    res.headlineOk = !!v.headline && !/\bone night\b|\bthrowaway\b/i.test(v.headline);
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
        probe.innerHTML = '<span>99</span>'
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
      && res.menuMode === 'about' && !/About/.test(res.baseTitle)
      && res.roadmapOk && res.workspacesOk && res.headlineOk;
    return { ok, ...res };
  });

  // C002 (findings coupling-1, -2, -3): one output owner at a time. The instrument, the
  // sequencer and the Studio hand the output over in the action itself, read from each owner's
  // own state in the same evaluate (not after the 150 ms seqPlaying poll), and the newer action
  // wins. On its own page, so that the Studio document is the default one.
  def('one-output-owner', async ({ context, baseUrl }) => {
    const p = await context.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    const res = {};
    const inPage = (fn, arg) => p.evaluate(fn, arg);
    /** Every owner's state now, from the owner itself. */
    const install = () => inPage(() => {
      window.__c002 = () => {
        const O = window.OSCILLA;
        const a = O.app;
        return { instrument: !!a.playing && !a.releasing, instrumentPlaying: !!a.playing,
          seq: !!O.labs.sequencer.editor.playing, seqFlag: !!a.seqPlaying,
          studio: !!a.studioOwnsOutput(), t: O.engine.ctx ? O.engine.ctx.currentTime : null };
      };
    });
    const silent = (label) => until(() => inPage(() => {
      const O = window.OSCILLA;
      const st = O.labs.sequencer.editor.stats();
      return O.engine.activeNodeCount === 0 && st.activeSourceCount === 0 && !O.app.playing
        && !O.app.studioOwnsOutput() ? { nodes: 0, seqSources: 0 } : null;
    }), { ms: 8000, what: `one-output-owner: every node released after ${label}` });
    const stopEverything = () => inPage(() => {
      const O = window.OSCILLA;
      O.labs.sequencer.editor.stop();
      if (O.app.studioOwnsOutput()) O.app.studioStop();
      O.app.stopNow();
      O.app.alerts = [];
    });
    /** The audio clock has run `s` past `t0` (the 150 ms poll and Studio's watch had time). */
    const later = (t0, s, label) => until(() => inPage((x) => {
      const now = window.__c002();
      return now.t !== null && now.t - x.t0 >= x.s ? now : null;
    }, { t0, s }), { ms: 8000, what: `one-output-owner: ${label} still holds ${s} s later` });
    try {
      await p.goto(baseUrl, { waitUntil: 'load' });
      await H.ready(p);
      await inPage(() => {
        window.OSCILLA.app.setWorkspace('sequencer');
        window.OSCILLA.app.setContinuous(true); // the latched tone below outlives the 2 s limit
      });
      await until(() => inPage(() => document.querySelector('#osc-app').dataset.mode
        === 'sequencer'), { ms: 8000, what: 'one-output-owner: the Sequencer workspace opens' });
      await install();
      // (a) sequencer, then the instrument: the voice takes the output, the sequence stops.
      await p.click('#osc-seq-play');
      await until(() => inPage(() => window.__c002().seq),
        { ms: 5000, what: 'one-output-owner: the sequence plays' });
      res.seqThenInstrument = await inPage(() => {
        window.OSCILLA.app.trigger();
        return window.__c002();
      });
      res.seqThenInstrumentSettled = await until(() => inPage(() => {
        const s = window.__c002();
        return s.instrumentPlaying ? s : null;
      }), { ms: 5000, what: 'one-output-owner: the instrument plays after the sequence' });
      await stopEverything();
      res.afterA = await silent('instrument after sequencer');
      // (b) the instrument (latched), then the sequencer: the voice is released at the click.
      await inPage(() => window.OSCILLA.app.toggleLatch());
      await until(() => inPage(() => window.__c002().instrument),
        { ms: 5000, what: 'one-output-owner: the latched tone plays' });
      res.instrumentThenSeq = await inPage(() => {
        document.querySelector('#osc-seq-play').click();
        return window.__c002();
      });
      res.instrumentThenSeqSettled = await until(() => inPage(() => {
        const s = window.__c002();
        return !s.instrumentPlaying ? s : null;
      }), { ms: 5000, what: 'one-output-owner: the released tone ends while the sequence plays' });
      await stopEverything();
      res.afterB = await silent('sequencer after instrument');
      // (c) the Studio plays, then sequencer Play: the Studio stops in the same click.
      await p.click('[data-osc="studio.compact.play"]');
      await until(() => inPage(() => window.__c002().studio),
        { ms: 8000, what: 'one-output-owner: the Studio plays' });
      res.studioThenSeq = await inPage(() => {
        document.querySelector('#osc-seq-play').click();
        return window.__c002();
      });
      res.studioThenSeqLater = await later(res.studioThenSeq.t, 0.5, 'sequencer over Studio');
      await stopEverything();
      res.afterC = await silent('sequencer after Studio');
      // (d) sequencer Play, then Studio PLAY in the same task: the newer action (Studio) wins,
      // and neither the poll nor Studio's seqPlaying watch takes it back.
      res.seqThenStudio = await inPage(() => {
        document.querySelector('#osc-seq-play').click();
        window.OSCILLA.app.studioPlay();
        return window.__c002();
      });
      res.seqThenStudioLater = await later(res.seqThenStudio.t, 0.5, 'Studio over sequencer');
      await stopEverything();
      res.afterD = await silent('Studio after sequencer');
      // (e) Studio PLAY, then sequencer Play in the same task: the sequencer wins.
      res.studioThenSeqSameTask = await inPage(() => {
        window.OSCILLA.app.studioPlay();
        document.querySelector('#osc-seq-play').click();
        return window.__c002();
      });
      res.studioThenSeqSameTaskLater = await later(res.studioThenSeqSameTask.t, 0.5,
        'sequencer over Studio (same task)');
      await stopEverything();
      res.afterE = await silent('sequencer after Studio (same task)');
      const only = (s, owner) => ['instrument', 'seq', 'studio']
        .every((k) => s[k] === (k === owner));
      const v = {
        a: !res.seqThenInstrument.seq && !res.seqThenInstrument.seqFlag
          && only(res.seqThenInstrumentSettled, 'instrument'),
        b: res.instrumentThenSeq.seq && res.instrumentThenSeq.seqFlag
          && !res.instrumentThenSeq.instrument && only(res.instrumentThenSeqSettled, 'seq'),
        c: only(res.studioThenSeq, 'seq') && only(res.studioThenSeqLater, 'seq'),
        d: only(res.seqThenStudio, 'studio') && !res.seqThenStudio.seqFlag
          && only(res.seqThenStudioLater, 'studio'),
        e: only(res.studioThenSeqSameTask, 'seq') && only(res.studioThenSeqSameTaskLater, 'seq'),
        noPageErrors: errs.length === 0,
      };
      const failed = Object.keys(v).filter((k) => !v[k]);
      return { ok: failed.length === 0, failed, errs, ...res };
    } finally {
      await p.close({ runBeforeUnload: false }).catch(() => {});
    }
  });

  // C002 (finding coupling-1): while a measurement owns the output the sequencer is refused
  // exactly like the instrument, with the same notice, and the measurement goes on. The Studio
  // template Measurement Sweep hands the output to MEASURE from the Sequencer workspace, where
  // the sequencer's Play is on screen (TEST CONTEXT loopback, so no microphone is opened).
  def('seq-refused-during-measure', async ({ context, baseUrl }) => {
    const p = await context.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    const inPage = (fn, arg) => p.evaluate(fn, arg);
    const res = {};
    try {
      await p.goto(`${baseUrl}?measure=loopback`, { waitUntil: 'load' });
      await H.ready(p);
      res.opened = await inPage(() => {
        const a = window.OSCILLA.app;
        const ok = a.studioLoadTemplate('measurement-sweep');
        a.setWorkspace('sequencer');
        return ok;
      });
      await until(() => inPage(() => document.querySelector('#osc-app').dataset.mode
        === 'sequencer'), { ms: 8000, what: 'seq-refused-during-measure: the Sequencer opens' });
      await p.click('[data-osc="studio.compact.play"]');
      res.owns = await until(() => inPage(() => window.OSCILLA.app.measureOwnsOutput()),
        { ms: 20000, what: 'seq-refused-during-measure: the measurement owns the output' });
      await inPage(() => { window.OSCILLA.app.alerts = []; });
      await p.click('#osc-seq-play');
      res.after = await inPage(() => {
        const O = window.OSCILLA;
        const ed = O.labs.sequencer.editor;
        return { seqPlaying: !!ed.playing, seqFlag: !!O.app.seqPlaying, error: ed.error,
          title: document.querySelector('#osc-seq-play').getAttribute('title'),
          alerts: O.app.alerts.map((x) => x.title), owns: O.app.measureOwnsOutput(),
          state: O.measure.state };
      });
      // Contrast: the instrument meets the same refusal.
      res.instrument = await inPage(() => {
        const a = window.OSCILLA.app;
        a.trigger();
        return { playing: !!a.playing };
      });
      await inPage(() => {
        const a = window.OSCILLA.app;
        a.measureAbort('user');
        if (a.studioOwnsOutput()) a.studioStop();
      });
      res.released = await until(() => inPage(() => {
        const O = window.OSCILLA;
        return O.engine.activeNodeCount === 0 && !O.app.measureOwnsOutput()
          && O.labs.sequencer.editor.stats().activeSourceCount === 0 ? true : null;
      }), { ms: 10000, what: 'seq-refused-during-measure: every node released after the abort' });
      const REFUSAL = /^The output belongs to the measurement/;
      const v = {
        opened: res.opened === true,
        owns: res.owns === true,
        refused: !res.after.seqPlaying && !res.after.seqFlag,
        said: REFUSAL.test(res.after.error) && REFUSAL.test(res.after.title || '')
          && res.after.alerts.includes('Measurement in progress'),
        measurementGoesOn: res.after.owns === true,
        instrumentRefused: !res.instrument.playing,
        noPageErrors: errs.length === 0,
      };
      const failed = Object.keys(v).filter((k) => !v[k]);
      return { ok: failed.length === 0, failed, errs, ...res };
    } finally {
      await p.close({ runBeforeUnload: false }).catch(() => {});
    }
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
  await RUN.ready();
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  const server = ORIGINS.includes('http') ? await serveDist(DIST, { prefix: 'oscilla-gate-' }) : null;
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
        RUN.reportLeg({ leg: key, checks: names.length });
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
      server.close();
    }
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(all, null, 2)}\n`);
  if (known) console.log(`${known} known-defect result(s) reported above, each tracked in the plan`);
  process.exit(failed ? 1 : 0);
})();

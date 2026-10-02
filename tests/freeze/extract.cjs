#!/usr/bin/env node
// OSCILLA V1 freeze harness: load the inline application script of a V1 index.html into a Node
// vm context, without a DOM and without Web Audio, so its pure helpers (and, through small
// stubs, the Alpine component's logic and the AudioEngine against a mock AudioContext) can be
// called from Node.
//
//   node extract.cjs                      # list the banner sections and the exported names
//   node extract.cjs --golden             # regenerate golden.json from vectors.cjs
//   OSCILLA_HTML=/path/index.html node extract.cjs ...
//   OSCILLA_HTML=../baseline-a7b7a23/index.html OSCILLA_BASELINE=a7b7a23 \
//     OSCILLA_GOLDEN_OUT=golden-a7b7a23.json node extract.cjs --golden
// (a7b7a23 adaptations: WaveShaperNode, stop() without a time, suspend(), an external close
// that fires onstatechange, and a recording `document` stub for the resume-retry listeners.)
//
// Nothing here edits index.html. Section 10 (bootstrapping: Alpine registration, window error
// handlers, window.OSCILLA) is never evaluated; every other section only declares things.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DEFAULT_HTML = path.resolve(__dirname, '..', 'baseline-95dfa81', 'index.html');
const FIXED_NOW = Date.UTC(2026, 0, 1, 12, 0, 0); // deterministic Date.now() inside the context

// ------------------------------------------------------------------ script extraction

/** The inline <script> (no src) that carries the application, with its 1-based line offset. */
function extractAppScript(html) {
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1].includes('// 1. CONSTANTS')) {
      const before = html.slice(0, m.index + '<script>'.length);
      const firstLine = before.split('\n').length; // line of '<script>' itself
      return { code: m[1], firstLine };
    }
  }
  throw new Error('No inline application <script> containing "// 1. CONSTANTS" found.');
}

/** Split the script at its "// ====\n// N. TITLE\n// ====" banners. */
function splitSections(code, firstLine) {
  const lines = code.split('\n');
  const banner = /^\/\/ ={20,}$/;
  const title = /^\/\/ (\d+)\. (.+)$/;
  const starts = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    if (banner.test(lines[i]) && title.test(lines[i + 1]) && banner.test(lines[i + 2])) {
      const [, n, t] = lines[i + 1].match(title);
      starts.push({ n: Number(n), title: t.trim(), idx: i });
    }
  }
  return starts.map((s, k) => {
    const endIdx = k + 1 < starts.length ? starts[k + 1].idx : lines.length;
    return {
      n: s.n,
      title: s.title,
      // index.html line numbers (the script text starts right after '<script>' on firstLine)
      startLine: firstLine + s.idx,
      endLine: firstLine + endIdx - 1,
      code: lines.slice(s.idx, endIdx).join('\n'),
    };
  });
}

/** Top-level (column-0) declarations of a code chunk. */
function topLevelNames(code) {
  const out = [];
  const re = /^(?:const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(code))) out.push(m[1]);
  return out;
}

// ------------------------------------------------------------------ stubs

class MemoryStorage {
  constructor(init = {}, { throwing = false } = {}) {
    this._m = new Map(Object.entries(init));
    this._throw = throwing;
  }
  _guard() { if (this._throw) { const e = new Error('blocked'); e.name = 'SecurityError'; throw e; } }
  getItem(k) { this._guard(); return this._m.has(String(k)) ? this._m.get(String(k)) : null; }
  setItem(k, v) { this._guard(); this._m.set(String(k), String(v)); }
  removeItem(k) { this._guard(); this._m.delete(String(k)); }
  clear() { this._guard(); this._m.clear(); }
  dump() { return Object.fromEntries(this._m); }
}

/** A recording stand-in for `document` (event listeners only). */
function makeDocument() {
  const listeners = [];
  return {
    listeners,
    addEventListener: (type, fn, opts) => { listeners.push({ type, fn, capture: !!(opts && (opts === true || opts.capture)) }); },
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
}

/** Timers never fire on their own: they are recorded, and flushTimers() can run them. */
function makeTimers() {
  let seq = 0;
  const pending = new Map();
  const add = (fn, ms, repeat) => { const id = ++seq; pending.set(id, { fn, ms, repeat }); return id; };
  return {
    setTimeout: (fn, ms) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: (id) => { pending.delete(id); },
    clearInterval: (id) => { pending.delete(id); },
    queueMicrotask: (fn) => add(fn, 0, false),
    requestAnimationFrame: (fn) => add(fn, 16, false),
    pendingCount: () => pending.size,
    /** Run every pending one-shot timer once (intervals stay pending). Returns how many ran. */
    flushOnce() {
      let ran = 0;
      for (const [id, t] of [...pending]) {
        if (t.repeat) continue;
        pending.delete(id);
        t.fn();
        ran++;
      }
      return ran;
    },
  };
}

// ------------------------------------------------------------------ mock Web Audio

/**
 * A recording mock of the Web Audio surface AudioEngine uses. Every node and every AudioParam
 * automation call is logged, so a test can freeze the exact graph and schedule.
 * opts: { sampleRate, state: 'running' | 'suspended', cancelAndHold: bool, stereoPanner: bool,
 *         resumable: bool (default true; false = resume() resolves but the state stays, like a
 *         browser that withholds audio until a user activation) }
 */
function makeMockAudio(opts = {}) {
  const cfg = { sampleRate: 48000, state: 'running', cancelAndHold: true, stereoPanner: true, ...opts };
  const contexts = [];

  class MockParam {
    constructor(name, value) {
      this.name = name;
      this.value = value;
      this.events = [];
      if (cfg.cancelAndHold) {
        this.cancelAndHoldAtTime = (t) => { this.events.push(['cancelAndHold', null, t]); return this; };
      }
    }
    setValueAtTime(v, t) { this.events.push(['set', v, t]); return this; }
    linearRampToValueAtTime(v, t) { this.events.push(['linear', v, t]); return this; }
    exponentialRampToValueAtTime(v, t) {
      if (!(v > 0) && !(v < 0)) throw new RangeError('exponentialRampToValueAtTime: value must be nonzero');
      this.events.push(['exp', v, t]);
      return this;
    }
    setTargetAtTime(v, t, c) { this.events.push(['target', v, t, c]); return this; }
    cancelScheduledValues(t) { this.events.push(['cancel', null, t]); return this; }
  }

  class MockNode {
    constructor(ctx, kind) {
      this.context = ctx;
      this.kind = kind;
      this.id = ctx._nodes.length;
      this.out = [];
      this.disconnected = 0;
      ctx._nodes.push(this);
    }
    connect(dest, output = 0, input = 0) {
      const target = dest instanceof MockParam ? `param:${dest.owner}.${dest.name}` : `node:${dest.id}`;
      this.out.push(output || input ? `${target}[${output}->${input}]` : target);
      return dest;
    }
    disconnect() { this.disconnected++; }
  }

  const param = (node, name, value) => { const p = new MockParam(name, value); p.owner = node.id; return p; };

  class MockSource extends MockNode {
    constructor(ctx, kind) { super(ctx, kind); this.startAt = null; this.stops = []; this.ended = false; this.onended = null; }
    start(t) { this.startAt = t; }
    stop(t) { this.stops.push(t === undefined ? 'now' : t); }
  }

  class MockAudioContext {
    constructor(o = {}) {
      this._nodes = [];
      this.sampleRate = o.sampleRate || cfg.sampleRate;
      this.currentTime = 0;
      this.state = cfg.state;
      this.onstatechange = null;
      this.latencyHint = o.latencyHint;
      this.destination = new MockNode(this, 'destination');
      contexts.push(this);
    }
    createGain() { const n = new MockNode(this, 'gain'); n.gain = param(n, 'gain', 1); return n; }
    createOscillator() {
      const n = new MockSource(this, 'oscillator');
      n.type = 'sine';
      n.frequency = param(n, 'frequency', 440);
      n.detune = param(n, 'detune', 0);
      return n;
    }
    createDynamicsCompressor() {
      const n = new MockNode(this, 'compressor');
      n.threshold = param(n, 'threshold', -24); n.knee = param(n, 'knee', 30); n.ratio = param(n, 'ratio', 12);
      n.attack = param(n, 'attack', 0.003); n.release = param(n, 'release', 0.25);
      return n;
    }
    createAnalyser() {
      const n = new MockNode(this, 'analyser');
      n.fftSize = 2048; n.smoothingTimeConstant = 0.8; n.minDecibels = -100; n.maxDecibels = -30;
      Object.defineProperty(n, 'frequencyBinCount', { get() { return n.fftSize / 2; } });
      n.getFloatTimeDomainData = (a) => a.fill(0);
      n.getFloatFrequencyData = (a) => a.fill(-Infinity);
      return n;
    }
    createChannelMerger(k) { const n = new MockNode(this, `merger${k}`); return n; }
    createWaveShaper() {
      const n = new MockNode(this, 'waveshaper');
      n.curve = null;
      n.oversample = 'none';
      return n;
    }
    resume() { if (cfg.resumable !== false) this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    /** The browser (or another script) changes the state: fires onstatechange like a real one. */
    externalState(state) {
      this.state = state;
      if (typeof this.onstatechange === 'function') this.onstatechange();
    }
    /** Advance the audio clock; sources whose last scheduled stop has passed fire onended. */
    advance(t) {
      this.currentTime = t;
      for (const n of this._nodes) {
        if (!(n instanceof MockSource) || n.ended || !n.stops.length) continue;
        if (n.stops[n.stops.length - 1] <= t + 1e-12) {
          n.ended = true;
          if (typeof n.onended === 'function') n.onended();
        }
      }
    }
    /** A serialisable trace of the whole graph. */
    trace() {
      const r = (v) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v);
      return this._nodes.map((n) => {
        const o = { id: n.id, kind: n.kind, out: n.out.slice(), disconnected: n.disconnected };
        if (n.type !== undefined) o.type = n.type;
        if (n instanceof MockSource) { o.startAt = r(n.startAt); o.stops = n.stops.map(r); o.ended = n.ended; }
        const params = {};
        for (const [k, v] of Object.entries(n)) {
          if (v instanceof MockParam) params[k] = { value: r(v.value), events: v.events.map((e) => e.map(r)) };
        }
        if (Object.keys(params).length) o.params = params;
        if (n.kind === 'analyser') { o.fftSize = n.fftSize; o.smoothing = n.smoothingTimeConstant; }
        if (n.kind === 'waveshaper') {
          const c = n.curve;
          o.oversample = n.oversample;
          o.curve = c ? { length: c.length, first: r(c[0]), mid: r(c[c.length >> 1]), last: r(c[c.length - 1]) } : null;
        }
        return o;
      });
    }
  }
  if (cfg.stereoPanner) {
    MockAudioContext.prototype.createStereoPanner = function () {
      const n = new MockNode(this, 'panner'); n.pan = param(n, 'pan', 0); return n;
    };
  }
  return { AudioContext: MockAudioContext, contexts, cfg };
}

// ------------------------------------------------------------------ loader

/**
 * Evaluate sections 1–9 of the V1 script in a fresh vm context.
 * opts: { html, audio: makeMockAudio() result | null, local/session: MemoryStorage,
 *         hash, search }
 * Returns { g: every top-level binding, ctx: the vm global, timers, sections, storage }.
 */
function loadOscilla(opts = {}) {
  const htmlPath = opts.html || process.env.OSCILLA_HTML || DEFAULT_HTML;
  const html = fs.readFileSync(htmlPath, 'utf8');
  const { code, firstLine } = extractAppScript(html);
  const sections = splitSections(code, firstLine);
  const evaluated = sections.filter((s) => s.n >= 1 && s.n <= 9);
  if (evaluated.length !== 9) throw new Error(`Expected sections 1–9, found ${evaluated.map((s) => s.n).join(',')}`);
  const body = evaluated.map((s) => s.code).join('\n');
  const names = topLevelNames(body);

  const timers = makeTimers();
  const local = opts.local || new MemoryStorage();
  const session = opts.session || new MemoryStorage();
  const sandbox = {
    console,
    TextEncoder, TextDecoder, URLSearchParams, URL, btoa, atob,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    queueMicrotask: timers.queueMicrotask, requestAnimationFrame: timers.requestAnimationFrame,
    localStorage: local, sessionStorage: session,
    document: opts.document || makeDocument(),
    location: { hash: opts.hash || '', search: opts.search || '', href: `file:///oscilla/index.html${opts.search || ''}${opts.hash || ''}` },
    navigator: { userAgent: 'oscilla-freeze/1.0', platform: 'node' },
  };
  if (opts.audio) sandbox.AudioContext = opts.audio.AudioContext;
  const context = vm.createContext(sandbox);
  vm.runInContext(`
    globalThis.window = globalThis;
    Date.now = () => ${FIXED_NOW};
    (() => { let a = 0x9e3779b9; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  `, context);
  const exportLine = `\n;globalThis.__OSCILLA_FREEZE__ = { ${names.join(', ')} };\n`;
  vm.runInContext(body + exportLine, context, { filename: `${path.basename(htmlPath)}#sections-1-9` });
  const g = context.__OSCILLA_FREEZE__;

  /** A fresh Alpine component object, used as plain JS (no reactivity, no init()). */
  const newApp = (patch = {}) => {
    const app = g.oscillaApp();
    app.$watch = () => {};
    app.$nextTick = (fn) => fn && fn();
    app.$refs = {};
    Object.assign(app, patch);
    return app;
  };
  return { g, ctx: context, timers, sections, names, local, session, newApp, htmlPath, document: sandbox.document };
}

module.exports = { loadOscilla, makeMockAudio, makeDocument, MemoryStorage, extractAppScript, splitSections, topLevelNames, FIXED_NOW };

// ------------------------------------------------------------------ CLI

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--golden')) {
    const { buildGolden } = require('./vectors.cjs');
    const out = path.resolve(__dirname, process.env.OSCILLA_GOLDEN_OUT || 'golden.json');
    const golden = buildGolden();
    fs.writeFileSync(out, `${JSON.stringify(golden, null, 1)}\n`);
    const groups = {};
    for (const c of golden.cases) groups[c.group] = (groups[c.group] || 0) + 1;
    console.log(`wrote ${out}: ${golden.cases.length} cases`);
    for (const [k, v] of Object.entries(groups)) console.log(`  ${k.padEnd(28)} ${v}`);
  } else {
    const { sections, names, htmlPath } = loadOscilla();
    console.log(`source: ${htmlPath}`);
    const all = splitSections(...Object.values(extractAppScript(fs.readFileSync(htmlPath, 'utf8'))));
    for (const s of all) {
      console.log(`  §${s.n} ${s.title.padEnd(34)} lines ${s.startLine}–${s.endLine}  ${s.n <= 9 ? 'evaluated' : 'skipped (side effects)'}`);
    }
    console.log(`exported ${names.length} top-level bindings`);
  }
}


#!/usr/bin/env node
// The demo song as a vertical slice (plan issue K144): one user journey through every part of
// OSCILLA that exists, on the built dist/index.html from file:// in chromium, firefox and
// webkit. The song is "Lantern in the Slag Yard", an original piece (src/js/studio/templates/
// demo-song-score.js), opened as the Studio template "Demo song".
//
//   node tests/browser/demo-song.cjs [--browsers chromium,firefox,webkit]   (or OSC_BROWSERS)
//
// The journey, in the order a user takes it; each step drives the page's own controls:
//   midi-connect        Settings, Connect MIDI: the MIDI test seam (tests/browser/lib/
//                       midi-stub.cjs; "handles (stubbed API)") resolves the request and the page
//                       states `connected` with the stub's self-naming input
//   midi-riff           the first two bars of the bass riff as Note On / Note Off through the
//                       stub: the stub input delivers all 24 messages in the page, the page
//                       reports no error and the MIDI state stays connected (nothing on this
//                       tree consumes them yet: midi-notes-sound is the expected failure)
//   song-open           Templates, Open "Demo song: Lantern in the Slag Yard": 18 nodes, 18
//                       edges, 744 tempo-linked clips on five tracks, 7 section markers, 96 BPM,
//                       clean
//   tempo               the Inspector's Tempo field (nothing selected) at 120 BPM moves every
//                       clip (the song ends at 88 s) and the timeline strip shows it; 96 restores
//   drums               the Kick, Snare and Hats tracks hold the song's drum hits, and the Kick
//                       track's Add clip control adds one more hit at the playhead (one undo)
//   tone                Lead voice: waveform sawtooth; Lead filter: Q 6, both typed in the
//                       Inspector and in the model (they stay: PLAY, Save and the WAV carry them)
//   automation          the build automation is on the timeline (bass cutoff, lead LFO rate, the
//                       outro fade); Automate on the Bass filter's cutoff shows its lane
//   play                PLAY: the running graph is the edited song (the runtime's applied
//                       revision is the store's, all 18 nodes live, all 18 edges routed), the
//                       engine counts nodes and sources, the main output is not silent, and no
//                       clip or lane of the song is left unplayed
//   views               while it plays: the Analyzer's scope data is not silent, its spectrum
//                       holds the bass band well above its idle level, and its spectrogram draws
//                       the bass rows away from their idle colour
//   playhead            the timeline playhead the editor draws follows the transport position
//   stop-restart        STOP leaves 0 engine nodes, sources and runtime nodes; PLAY plays again;
//                       STOP is quiet again
//   wav                 Save, then one more edit left unsaved (tempo 100 BPM); Render WAV:
//                       the dialog's offer covers the edited song (its clips end at 105.6 s),
//                       and a 12 s window of it downloads as a WAV of that length, not silent,
//                       below 0 dBFS, whose first drum hit (the intro's snare pickup) lands
//                       where 100 BPM puts it (9.0 s), not where the template's 96 BPM would
//                       (9.375 s). The window is short so the render stays cheap in WebKit; the
//                       rest of the song is the same nodes and clips, which the play step runs
//                       and tests/unit/demo-song.test.mjs plans offline in full
//   save-reload         the page is closed without its unload prompt and opened again in the
//                       same browser context; Projects, Open: the opened model serializes equal
//                       to what Save stored, and what Save stored equals the live model it saved
//                       but for its view state, which the editors commit on a debounce
//   no-errors           no page error or console error during the journey
//
// Expected failures. A step that needs work that has not landed runs and is expected to fail;
// it is printed XFAIL with the plan issue or pull request that fills it, counted as a check,
// and never skipped. Its predicate states the effect the work must have, never only markup,
// and it fails in one way only: it returns { ok: false } or throws Unmet, both naming the unmet
// condition. Any other error inside it (a selector that no longer matches, a control that does
// not open, a page that throws) is a FAIL, not an expected failure. When that work lands the
// step passes and prints XPASS, which fails the suite until the step becomes a check() and its
// mark leaves EXPECTED; an expected() whose id has no mark is a FAIL.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { until, bounded, WaitTimeout } = require('./lib/wait.cjs');
const midiStub = require('./lib/midi-stub.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const RUN = suite.open({ name: 'demo-song', browsers: arg('browsers') });
const playwright = RUN.playwright;

const LOAD_MS = 90000;      // the page reports ready
const STEP_MS = 15000;      // a control the journey drives takes effect
const PLAY_MS = 20000;      // PLAY of a 744-clip song reaches a running graph
const NOTE_MS = 3000;       // a MIDI note would have made the engine count a node by then
const OFFER_MS = 5000;      // after the library opens, a draft offer would be on screen by then
const RENDER_S = 12;        // the WAV window: the intro and the snare pickup (9.0 s at 100 BPM)
const RENDER_MS = 120000;   // that window rendered, encoded and downloaded (under 2 s on a Mac)
const DRAFT_TEMPO = 100;    // the edit left unsaved before the render and the page closing
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0,
    'media.autoplay.blocking_policy': 0, 'media.autoplay.block-webaudio': false } },
  webkit: {},
};
const SONG_TITLE = 'Demo song: Lantern in the Slag Yard';
// The step marks: the work each expected failure waits for. Remove a mark when it lands.
const EXPECTED = Object.freeze({
  'midi-notes-sound': 'V502 (pull request #261): MIDI notes sound through the AudioEngine',
  'midi-records': 'V505: a MIDI performance records into an editable track; a MIDI note '
    + 'playing a Studio voice has no plan yet (K144 gap G2)',
  'drum-accents': 'K144 gap G4 (no plan yet): a Studio clip has no level, so velocity is lost',
  'drive-knob': 'K012 (pull request #267): the Drive node',
  'resonance-lane': 'K144 gap G10 (no plan yet): the Studio does not automate a filter Q',
  'node-views-draw': 'K016: the Scope, Spectrum, Spectrogram and Meter node cards paint live',
  'keyboard-view': 'K026 and V504: a keyboard view whose key lights and sounds when played',
  'restore-last': 'V604: after the page is closed the Studio offers back the last working draft',
});

let failures = 0;
let passes = 0;
let xfails = 0;

function check(leg, id, name, ok, detail = '') {
  RUN.tally(leg);
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} [${leg}] ${id}: ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

/** The one way an expected failure fails: the effect its owner adds is not in the page. */
class Unmet extends Error {
  constructor(detail) {
    super(detail);
    this.name = 'Unmet';
  }
}

/** `until`, whose deadline is the unmet condition of an expected failure, not an error. */
async function untilUnmet(pred, { ms, what }, detail) {
  try {
    return await until(pred, { ms, what });
  } catch (err) {
    if (err instanceof WaitTimeout) throw new Unmet(`${detail()} (${err.message})`);
    throw err;
  }
}

// An expected failure: `fn` returns { ok, detail } as a check would, or throws Unmet. It runs
// every time. Any other throw is a FAIL: a broken step must not read as its owner's gap.
async function expected(leg, id, name, fn) {
  RUN.tally(leg);
  const why = EXPECTED[id];
  if (!why) {
    failures += 1;
    console.log(`  FAIL [${leg}] ${id}: ${name} — no mark in EXPECTED: make the step a check()`);
    return;
  }
  let r;
  try {
    r = await fn();
  } catch (err) {
    if (!(err instanceof Unmet)) {
      failures += 1;
      console.log(`  FAIL [${leg}] ${id}: ${name} — the expected failure broke, not its owner's `
        + `gap (${why}): ${String((err && err.stack) || err).slice(0, 400)}`);
      return;
    }
    r = { ok: false, detail: err.message.slice(0, 300) };
  }
  if (r.ok) {
    failures += 1;
    console.log(`  XPASS [${leg}] ${id}: ${name} — it passes now; make it a check() and remove `
      + `its mark (${why})${r.detail ? `; ${r.detail}` : ''}`);
  } else {
    xfails += 1;
    console.log(`  XFAIL [${leg}] ${id}: ${name} — expected until ${why}`
      + `${r.detail ? `; ${r.detail}` : ''}`);
  }
}

// ------------------------------------------------------------------------------ page helpers
const counts = (page) => page.evaluate(() => window.OSCILLA.studio.counts());
const model = (page) => page.evaluate(() => window.OSCILLA.studio.model);

async function ready(page, what) {
  await until(() => page.evaluate(() => document.documentElement.dataset.ready === 'true'
    && !!(window.OSCILLA && window.OSCILLA.app)), { ms: LOAD_MS, what });
}

async function studio(page, leg) {
  if (await page.evaluate(() => document.querySelector('#osc-app').dataset.mode) !== 'studio') {
    await page.locator('[data-osc="nav.studio"]').first().click();
  }
  await until(() => page.evaluate(() => document.querySelector('#osc-app').dataset.mode
    === 'studio' && !!window.OSCILLA.studio && !!window.OSCILLA.studio.store),
  { ms: STEP_MS, what: `${leg}: the Studio workspace opens` });
}

/** The Analyzer workspace, from its Analyze menu in the header. */
async function analyzer(page, leg) {
  await page.locator('[data-osc="nav-group.analyze"]').first().click();
  await page.locator('[data-osc="nav.analyzer"]').first().click();
  await until(() => page.evaluate(() => document.querySelector('#osc-app').dataset.mode
    === 'analyzer'), { ms: STEP_MS, what: `${leg}: the Analyzer workspace opens` });
}

/** Type into a field like a user: select its text, type, commit with Enter. */
async function type(page, selector, text) {
  const field = page.locator(selector).first();
  await field.click({ clickCount: 3 });
  await field.fill(text);
  await field.press('Enter');
}

/** Select a node by clicking its card in the graph. */
async function selectNode(page, leg, id) {
  await page.locator(`.osc-sg-node[data-node-id="${id}"] .osc-sg-title`).first().click();
  await until(() => page.evaluate((nid) => {
    const sel = window.OSCILLA.studio.store.getSelection();
    return sel.nodes.length === 1 && sel.nodes[0] === nid;
  }, id), { ms: STEP_MS, what: `${leg}: ${id} is the one selected node` });
}

async function clearSelection(page) {
  await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'SELECTION_CHANGE',
    selection: { nodes: [] } }));
}

const param = (m, nodeId, key) => m.graph.nodes.find((n) => n.id === nodeId).params[key];
const songEnd = (m) => Math.round(Math.max(...m.timeline.clips.map((c) => c.start + c.duration))
  * 1000) / 1000;

// What the Analyzer shows of the main output: the scope's time data, the spectrum and the
// spectrogram, read from the views' own sources (the visualization bridge, the main output
// analyser, the spectrogram's plot canvas). The spectrogram is a ring buffer, so its rows are
// read whole: `lit` counts the pixels of the 80, 110 and 220 Hz rows (the bass and kick) that
// differ from `floor`, the colour of its empty plot.
const analyzerView = (page, floor = null) => page.evaluate((fl) => {
  const viz = window.OSCILLA.viz;
  viz.pull();
  const td = viz.state.live.timeData;
  let acc = 0;
  if (td) for (let i = 0; i < td.length; i++) acc += td[i] * td[i];
  const rms = td ? Math.sqrt(acc / td.length) : 0;
  const spec = viz.outputSpectrum();
  const rate = viz.state.live.sampleRate;
  let bass = -Infinity;
  if (spec && rate) {
    const binHz = rate / 2 / spec.length;
    // timing-allow: counts spectrum bins between 40 and 400 Hz, not audio frames
    for (let i = Math.floor(40 / binHz); i <= Math.ceil(400 / binHz); i++) {
      if (spec[i] > bass) bass = spec[i];
    }
  }
  const sg = window.OSCILLA.labs && window.OSCILLA.labs.spectrogram
    ? window.OSCILLA.labs.spectrogram.view : null;
  let lit = null;
  let empty = null;
  if (sg && sg.plotCanvas && sg.plotRect && sg.plotRect.w > 0) {
    const c = sg.plotCanvas;
    const g = c.getContext('2d');
    const dpr = c.width / sg.plotRect.w;
    empty = Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3));
    const ref = fl || empty;
    lit = 0;
    for (const f of [80, 110, 220]) {
      const row = g.getImageData(0, Math.round(sg.yForFrequency(f) * dpr), c.width, 1).data;
      for (let i = 0; i < row.length; i += 4) {
        const d = Math.max(Math.abs(row[i] - ref[0]), Math.abs(row[i + 1] - ref[1]),
          Math.abs(row[i + 2] - ref[2]));
        if (d > 20) lit += 1;
      }
    }
  }
  return { rms, bass: Number.isFinite(bass) ? bass : null, lit, empty };
}, floor);

// The 16-bit PCM WAV the Studio downloads: format, length and level from its samples.
function wavStats(buf) {
  const b = Buffer.from(buf);
  const fmt = b.indexOf('fmt ');
  const data = b.indexOf('data');
  const channels = b.readUInt16LE(fmt + 10);
  const sampleRate = b.readUInt32LE(fmt + 12);
  const bits = b.readUInt16LE(fmt + 22);
  const bytes = b.readUInt32LE(data + 4);
  const start = data + 8;
  const end = Math.min(b.length, start + bytes);
  let peak = 0;
  let acc = 0;
  let n = 0;
  for (let o = start; o + 1 < end; o += 2) {
    const v = Math.abs(b.readInt16LE(o)) / 32768;
    if (v > peak) peak = v;
    acc += v * v;
    n += 1;
  }
  return { riff: b.toString('ascii', 0, 4), wave: b.toString('ascii', 8, 12), channels,
    sampleRate, bits, seconds: bytes / (channels * (bits / 8)) / sampleRate,
    peakDbfs: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    rmsDbfs: n && acc > 0 ? 10 * Math.log10(acc / n) : -Infinity,
    firstHit: firstHit(b, { start, end, channels, sampleRate }) };
}

// When the first drum hit sounds in the WAV, in seconds of the file. Bars 1 to 3 of the song are
// the bass alone, low-passed at 300 Hz; the first drum is the snare pickup of bar 4, noise
// band-passed at 1.8 kHz. Above 5 kHz (two RBJ high-pass sections, 24 dB per octave) the bass
// leaves a floor and the snare stands 15 to 20 dB over it, so the first 5 ms block 10 dB over
// the loudest block from 0.5 to 8 s (after the first bass note's onset, before any drum at
// 96 or 100 BPM) is the hit. Every rate here is the file's own.
function firstHit(b, { start, end, channels, sampleRate }) {
  const w = 2 * Math.PI * 5000 / sampleRate;
  const al = Math.sin(w) / Math.SQRT2;
  const cw = Math.cos(w);
  const a0 = 1 + al;
  const k = [(1 + cw) / 2 / a0, -(1 + cw) / a0, (1 + cw) / 2 / a0, -2 * cw / a0, (1 - al) / a0];
  const st = [[0, 0, 0, 0], [0, 0, 0, 0]];
  const section = (s, x) => {
    const y = k[0] * x + k[1] * s[0] + k[2] * s[1] - k[3] * s[2] - k[4] * s[3];
    s[1] = s[0]; s[0] = x; s[3] = s[2]; s[2] = y;
    return y;
  };
  // timing-allow: 5 ms analysis blocks of the downloaded file, read at its own sample rate
  const block = Math.round(sampleRate * 0.005);
  const energy = [];
  let acc = 0;
  let k2 = 0;
  for (let o = start; o + 2 * channels <= end; o += 2 * channels) {
    let x = 0;
    for (let c = 0; c < channels; c++) x += b.readInt16LE(o + 2 * c) / 32768;
    const y = section(st[1], section(st[0], x / channels));
    acc += y * y;
    k2 += 1;
    if (k2 === block) { energy.push(acc / block); acc = 0; k2 = 0; }
  }
  const quietEnd = Math.min(energy.length, Math.floor(8 / 0.005));
  let floor = 0;
  for (let i = Math.floor(0.5 / 0.005); i < quietEnd; i++) floor = Math.max(floor, energy[i]);
  for (let i = quietEnd; i < energy.length; i++) {
    if (floor > 0 && energy[i] > floor * 10) return (i * block) / sampleRate;
  }
  return null;
}

// What each named node card's canvases paint: the largest share of a canvas's pixels that
// differ from its first pixel, and a fingerprint of the pixels to compare two reads with.
const cardPaint = (page, ids) => page.evaluate((list) => list.map((id) => {
  const canvases = [...document.querySelectorAll(`.osc-sg-node[data-node-id="${id}"] canvas`)];
  let painted = 0;
  const prints = [];
  for (const c of canvases) {
    if (!c.width || !c.height) continue;
    const off = document.createElement('canvas');
    off.width = c.width;
    off.height = c.height;
    const g = off.getContext('2d');
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    let print = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.max(Math.abs(d[i] - d[0]), Math.abs(d[i + 1] - d[1]), Math.abs(d[i + 2] - d[2]),
        Math.abs(d[i + 3] - d[3])) > 20) n += 1;
      print = (print * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13 + d[i + 3] * 17) >>> 0;
    }
    painted = Math.max(painted, n / (c.width * c.height));
    prints.push(print);
  }
  return { id, canvases: canvases.length, painted, print: prints.join(',') };
}), ids);

// The keyboard canvas's pixels (RGBA), or null when the page has no keyboard canvas.
const keysImage = (page) => page.evaluate(() => {
  const c = document.querySelector('[data-osc="keyboard.keys"]')
    || document.querySelector('[data-osc^="keyboard"] canvas, '
      + '[data-osc^="studio.keyboard"] canvas');
  if (!c || !c.width || !c.height) return null;
  const off = document.createElement('canvas');
  off.width = c.width;
  off.height = c.height;
  const g = off.getContext('2d');
  g.drawImage(c, 0, 0);
  return Array.from(g.getImageData(0, 0, c.width, c.height).data);
});
const changedPixels = (a, b) => {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2])) > 20) n += 1;
  }
  return n;
};

// ------------------------------------------------------------------------------ the journey
async function journey(browser, leg) {
  const context = await browser.newContext({ acceptDownloads: true,
    viewport: { width: 1536, height: 1024 } });
  await context.addInitScript(midiStub.install, {});
  const errors = [];
  const url = pathToFileURL(DIST).href;
  const openPage = async (what) => {
    const p = await context.newPage();
    p.setDefaultTimeout(30000);
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await p.goto(url, { waitUntil: 'load' });
    await ready(p, what);
    return p;
  };
  try {
    let page = await openPage(`${leg}: the page is ready`);

    // 1. MIDI through the test seam (handles (stubbed API)).
    await page.locator('[data-osc="action.settings"]').click();
    await until(() => page.evaluate(() => document.getElementById('osc-dlg-settings').open),
      { ms: STEP_MS, what: `${leg}: the Settings dialog opens` });
    await page.locator('[data-osc="midi.connect"]').click();
    await until(() => page.evaluate(() => window.__oscMidiSeam.calls().length === 1),
      { ms: STEP_MS, what: `${leg}: Connect MIDI asks for access once` });
    await page.evaluate((n) => window.__oscMidiSeam.resolve(0, [n]), midiStub.STUB_NAME);
    const midi = await until(() => page.evaluate(() => {
      const el = document.querySelector('[data-osc="midi.status"]');
      return el.dataset.midiState === 'connected' && el.textContent.trim();
    }), { ms: STEP_MS, what: `${leg}: the MIDI state reads connected` });
    check(leg, 'midi-connect', 'handles (stubbed API): Connect MIDI reaches connected with the '
      + 'stub input', midi.includes(midiStub.STUB_NAME), midi);
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => !document.getElementById('osc-dlg-settings').open),
      { ms: STEP_MS, what: `${leg}: the Settings dialog closes` });

    // 2. The riff as MIDI notes. The first note is held until the engine would count it. The
    // Studio document exists from boot; its clips are counted before the first note, so a
    // recording made while the riff plays counts as new (midi-records).
    const clipsBefore = (await model(page)).timeline.clips.length;
    const bars = [[33, 110], [33, 78], [40, 100], [45, 104], [43, 100], [40, 88],
      [33, 110], [33, 78], [38, 100], [39, 98], [40, 110], [43, 96]];
    const before = await page.evaluate(() => window.OSCILLA.engine.activeNodeCount);
    // What the stub input delivers in the page, heard by a listener of the test's own: the
    // page listens to no MIDI message on this tree, so delivery is what the seam proves.
    await page.evaluate((name) => {
      const seen = [];
      window.__demoMidiSeen = seen;
      window.__oscMidiSeam.port(name).addEventListener('midimessage',
        (e) => seen.push(Array.from(e.data)));
    }, midiStub.STUB_NAME);
    await page.evaluate(([n, v, name]) => window.__oscMidiSeam.message(name, [0x90, n, v]),
      [bars[0][0], bars[0][1], midiStub.STUB_NAME]);
    await expected(leg, 'midi-notes-sound', 'a MIDI Note On sounds through the AudioEngine',
      async () => {
        const n = await untilUnmet(() => page.evaluate((b) => {
          const c = window.OSCILLA.engine.activeNodeCount;
          return c > b && c;
        }, before), { ms: NOTE_MS, what: `${leg}: a MIDI note makes the engine count a node` },
        () => `${before} engine nodes before, none added`);
        return { ok: n > before, detail: `${n} engine nodes` };
      });
    for (const [i, [n, v]] of bars.entries()) {
      if (i > 0) {
        await page.evaluate(([nn, vv, name]) => window.__oscMidiSeam.message(name,
          [0x90, nn, vv]), [n, v, midiStub.STUB_NAME]);
      }
      await page.evaluate(([nn, name]) => window.__oscMidiSeam.message(name, [0x80, nn, 0]),
        [n, midiStub.STUB_NAME]);
    }
    const sent = bars.flatMap(([n, v]) => [[0x90, n, v], [0x80, n, 0]]);
    const afterRiff = await page.evaluate(() => ({
      state: document.querySelector('[data-osc="midi.status"]').dataset.midiState,
      lastError: window.OSCILLA.engine.lastError ? window.OSCILLA.engine.lastError.message
        : null,
      seen: window.__demoMidiSeen.slice() }));
    check(leg, 'midi-riff', 'handles (stubbed API): the stub input delivers the 12 riff notes '
      + '(24 messages) in the page, which stays connected without an error',
    JSON.stringify(afterRiff.seen) === JSON.stringify(sent) && afterRiff.state === 'connected'
      && !afterRiff.lastError && !errors.length,
    `${afterRiff.seen.length} of ${sent.length} messages delivered, state ${afterRiff.state}, `
      + `engine error ${afterRiff.lastError || 'none'}`);

    // 3. The song, from the Templates dialog.
    await studio(page, leg);
    await expected(leg, 'midi-records', 'the MIDI riff is recorded into the Studio', async () => {
      const m = await model(page);
      return { ok: m.timeline.clips.length > clipsBefore,
        detail: `${m.timeline.clips.length} clips after the riff, ${clipsBefore} before it` };
    });
    await page.locator('[data-osc="studio.templates"]').first().click();
    await until(() => page.evaluate(() => document.getElementById('osc-dlg-studio-templates')
      .open), { ms: STEP_MS, what: `${leg}: the Templates dialog opens` });
    const listed = await page.evaluate(() => [...document.querySelectorAll(
      '#osc-dlg-studio-templates .osc-st-tpl-title')].map((h) => h.textContent));
    await page.locator('[data-osc="studio.template.open"][data-template="demo-song"]').click();
    const song = await until(async () => {
      const m = await model(page);
      return m.metadata.title === SONG_TITLE && m;
    }, { ms: STEP_MS, what: `${leg}: the demo song opens` });
    const dirty = await page.evaluate(() => window.OSCILLA.studio.dirty);
    const tracks = {};
    for (const c of song.timeline.clips) tracks[c.trackId] = (tracks[c.trackId] || 0) + 1;
    check(leg, 'song-open', 'Templates, Open "Demo song": the whole song as one Studio document',
      listed.includes(SONG_TITLE) && song.graph.nodes.length === 18
        && song.graph.edges.length === 18 && song.timeline.clips.length === 744 && song.timeline.tracks.length === 5
        && song.timeline.clips.every((c) => !!c.musical) && song.timeline.markers.length === 7
        && song.transport.tempo === 96 && song.transport.timeMode === 'musical' && !dirty,
      `${song.graph.nodes.length} nodes, ${song.graph.edges.length} edges, ${
        song.timeline.clips.length} clips ${
        JSON.stringify(tracks)}, ${song.timeline.markers.map((x) => x.label).join(' | ')}, ${
        song.transport.tempo} BPM, dirty ${dirty}`);

    // 4. Tempo.
    await clearSelection(page);
    await type(page, '[data-osc="studio.inspector.tempo"]', '120');
    const fast = await until(async () => {
      const m = await model(page);
      return m.transport.tempo === 120 && m;
    }, { ms: STEP_MS, what: `${leg}: the typed tempo reaches the model` });
    const strip = await page.evaluate(() => document.querySelector('[data-osc="studio.tl.tempo"]')
      .value || document.querySelector('[data-osc="studio.tl.tempo"]').textContent);
    await type(page, '[data-osc="studio.inspector.tempo"]', '96');
    const back = await until(async () => {
      const m = await model(page);
      return m.transport.tempo === 96 && m;
    }, { ms: STEP_MS, what: `${leg}: the tempo returns to 96 BPM` });
    check(leg, 'tempo', 'the Inspector tempo moves every tempo-linked clip',
      songEnd(fast) === 88 && String(strip).includes('120') && songEnd(back) === 110,
      `ends at ${songEnd(fast)} s at 120 BPM (strip ${String(strip).trim()}), ${songEnd(back)} s `
        + 'at 96 BPM');

    // 5. Drums.
    const kicks = (m) => m.timeline.clips.filter((c) => c.trackId === 'track-kick').length;
    const k0 = kicks(back);
    await page.locator('[data-osc="studio.tl.add-clip"][data-key="track-add:track-kick"]').click();
    const added = await until(async () => {
      const m = await model(page);
      return kicks(m) === k0 + 1 && m;
    }, { ms: STEP_MS, what: `${leg}: Add clip puts one more hit on the Kick track` });
    await page.locator('[data-osc="studio.undo"]').first().click();
    const undone = await until(async () => {
      const m = await model(page);
      return kicks(m) === k0 && m;
    }, { ms: STEP_MS, what: `${leg}: undo removes the added hit` });
    check(leg, 'drums', 'the drum tracks hold the song\'s hits; Add clip adds one, undo removes it',
      k0 === 135 && tracks['track-snare'] === 107 && tracks['track-hat'] === 160
        && kicks(added) === 136 && kicks(undone) === 135, `kick ${k0}, snare ${
        tracks['track-snare']}, hats ${tracks['track-hat']}`);
    await expected(leg, 'drum-accents', 'the drum hits carry their velocities (accents)',
      async () => {
        const m = await model(page);
        const hit = m.timeline.clips.find((c) => c.trackId === 'track-snare');
        const level = hit && (hit.level ?? (hit.payload && hit.payload.level));
        return { ok: typeof level === 'number', detail: 'a snare clip has no level field' };
      });

    // 6. The synth tone and the filter.
    await page.locator('[data-osc="studio.frameAll"]').first().click();
    await selectNode(page, leg, 'lead-osc');
    await page.locator('[data-osc="studio.inspector.param"][data-key="waveform"]').first()
      .selectOption('sawtooth');
    await selectNode(page, leg, 'lead-filter');
    await type(page, '[data-osc="studio.inspector.param"][data-key="Q"]', '6');
    const toned = await until(async () => {
      const m = await model(page);
      return param(m, 'lead-osc', 'waveform') === 'sawtooth' && param(m, 'lead-filter', 'Q') === 6
        && m;
    }, { ms: STEP_MS, what: `${leg}: the waveform and Q edits reach the model` });
    check(leg, 'tone', 'Lead voice sawtooth and Lead filter Q 6 through the Inspector',
      !!toned, `${param(toned, 'lead-osc', 'waveform')}, Q ${param(toned, 'lead-filter', 'Q')}`);
    await expected(leg, 'drive-knob', 'a Drive node can be added for the driven tone',
      async () => {
        // The Add list not opening is a broken step (FAIL); only a list without drive is Unmet.
        await page.locator('[data-osc="studio.add"]').first().click();
        try {
          const found = await until(() => page.evaluate(() => document.querySelectorAll(
            '[data-osc="studio.add.item"]').length > 0 && [...document.querySelectorAll(
            '[data-osc="studio.add.item"]')].map((b) => b.dataset.type)),
          { ms: STEP_MS, what: `${leg}: the Add node list opens` });
          return { ok: found.includes('drive'), detail: `${found.length} node types, no drive` };
        } finally {
          await page.keyboard.press('Escape');
        }
      });

    // 7. The build automation. Automate on a parameter that has a lane shows that lane.
    const lanes = (m) => m.timeline.automation.map((l) => `${l.target.node}.${l.target.param}`);
    const songLanes = lanes(toned);
    await selectNode(page, leg, 'bass-filter');
    await page.locator('[data-osc="studio.inspector.automate"][data-key="frequency"]').click();
    const cutoff = toned.timeline.automation.find((l) => l.id === 'lane-cutoff');
    const shown = await until(() => page.evaluate((n) => {
      const sel = window.OSCILLA.studio.store.getSelection();
      return (sel.points || []).length === n && sel.points;
    }, cutoff.points.length), { ms: STEP_MS,
      what: `${leg}: Automate on the cutoff shows its lane` });
    check(leg, 'automation', 'the build lanes are on the timeline; Automate on the cutoff shows '
      + 'its lane', ['bass-filter.frequency', 'lead-lfo.rate', 'main-mix.level1',
      'main-mix.level2', 'main-mix.level3'].every((l) => songLanes.includes(l))
      && shown.length === cutoff.points.length, `${songLanes.join(', ')}; ${shown.length} `
      + 'cutoff points selected');
    await expected(leg, 'resonance-lane', 'the bass filter Q can be automated for the build',
      async () => {
        const r = await page.evaluate(() => ({
          offered: !!document.querySelector('[data-osc="studio.inspector.automate"]'
            + '[data-key="Q"]'),
          note: [...document.querySelectorAll('[data-osc="studio.inspector.no-automate"]')]
            .map((n) => n.textContent.trim()).find((t) => /Q/.test(t)) || '' }));
        return { ok: r.offered, detail: r.note || 'no Automate control on Q' };
      });

    // 8. PLAY. First the Analyzer as it is before anything plays: its empty spectrogram.
    await analyzer(page, leg);
    const pre = await until(async () => {
      const v = await analyzerView(page);
      return v.lit !== null && v;
    }, { ms: STEP_MS, what: `${leg}: the Analyzer's spectrogram is mounted` });
    await studio(page, leg);
    await clearSelection(page);
    await page.locator('[data-osc="studio.play"]').first().click();
    const playing = await until(async () => {
      const c = await counts(page);
      return c.playing && c.runtimeNodes > 0 && c.engineNodes > 0 && c;
    }, { ms: PLAY_MS, what: `${leg}: PLAY runs the song's graph` });
    const sounding = await until(async () => {
      const v = await analyzerView(page);
      return v.rms > 0.002 && v;
    }, { ms: STEP_MS, what: `${leg}: the main output is not silent` });
    const tr = await page.evaluate(() => {
      const s = window.OSCILLA.studio;
      const d = s.transport.debugInfo();
      const rt = s.runtime.debugInfo();
      const applied = s.runtime.applied();
      return { unplayed: Array.isArray(d.unplayed) ? d.unplayed.map((u) => u.id) : null,
        revision: s.store.getRevision(), applied: applied ? applied.revision : null,
        handles: rt.handleCount, routed: rt.routedEdgeCount,
        degraded: rt.degraded.map((x) => `${x.id}:${x.status}`),
        inactive: rt.inactiveEdges.map((x) => x.id) };
    });
    check(leg, 'play', 'PLAY: the running graph is the edited song, the engine counts it, the '
      + 'output sounds, no clip or lane is left unplayed', playing.engineSources > 0
      && sounding.rms > 0.002 && tr.applied === tr.revision && tr.handles === 18
      && tr.routed === 18 && !tr.degraded.length && !tr.inactive.length
      && Array.isArray(tr.unplayed) && !tr.unplayed.length,
    `revision ${tr.revision}, applied ${tr.applied}; ${tr.handles} nodes live, ${tr.routed} `
      + `edges routed${tr.degraded.length ? `, degraded ${tr.degraded.join(', ')}` : ''}${
        tr.inactive.length ? `, inactive ${tr.inactive.join(', ')}` : ''}; ${
        playing.engineNodes} engine nodes, ${playing.engineSources} sources, ${
        playing.runtimeNodes} runtime nodes, RMS ${sounding.rms.toFixed(4)}; not played: ${
        tr.unplayed ? tr.unplayed.join(', ') || 'none' : 'unknown'}`);
    await expected(leg, 'node-views-draw', 'the Studio\'s Scope, Spectrum, Spectrogram and Meter '
      + 'node cards draw what plays', async () => {
      // Drawn, not mounted: each card's canvas paints at least 0.5 % of its pixels away from
      // its background, and repaints while the song plays (two reads differ). A blank or a
      // still canvas (a "No signal" text, say) is the unmet condition.
      const ids = ['scope-1', 'spectrum-1', 'spectrogram-1', 'meter-1'];
      const first = await cardPaint(page, ids);
      const say = (v) => v.map((c) => `${c.id} ${c.canvases} canvas(es), ${
        (c.painted * 100).toFixed(2)} % painted`).join('; ');
      if (first.some((c) => !c.canvases)) throw new Unmet(say(first));
      let last = first;
      const live = await untilUnmet(async () => {
        last = await cardPaint(page, ids);
        return last.every((c, i) => c.painted >= 0.005 && c.print !== first[i].print) && last;
      }, { ms: STEP_MS, what: `${leg}: the view node cards paint while the song plays` },
      () => `${say(last)}; repainted: ${last.map((c, i) => c.print !== first[i].print)
        .join(', ')}`);
      return { ok: true, detail: say(live) };
    });

    // The timeline playhead, read as the editor draws it, against the transport.
    const drawn = () => page.evaluate(() => new Promise((resolve) => {
      const el = document.querySelector('[data-osc="studio.tl.playhead"]');
      const seen = new MutationObserver(() => {
        seen.disconnect();
        const m = /translateX\(([-\d.]+)px\)/.exec(el.style.transform || '');
        resolve({ p: window.OSCILLA.studio.transport.playhead().position,
          x: m ? Number(m[1]) : null });
      });
      seen.observe(el, { attributes: true, attributeFilter: ['style'] });
    }));
    const h1 = await until(async () => {
      const d = await drawn();
      return d.p > 0.5 && d.x !== null && d;
    }, { ms: STEP_MS, what: `${leg}: the editor draws the playhead past 0.5 s` });
    const h2 = await until(async () => {
      const d = await drawn();
      return d.p > h1.p + 0.5 && d.x !== null && d;
    }, { ms: STEP_MS, what: `${leg}: the drawn playhead advances 0.5 s further` });
    const scale = (h2.x - h1.x) / (h2.p - h1.p);
    check(leg, 'playhead', 'the timeline playhead follows the transport position',
      scale > 0 && Math.abs((h1.x / h1.p) - scale) / scale < 0.05,
      `${h1.p.toFixed(3)} s at ${h1.x.toFixed(1)} px, ${h2.p.toFixed(3)} s at ${
        h2.x.toFixed(1)} px`);

    // The Analyzer's views while the song plays, against their idle state after it.
    await analyzer(page, leg);
    const busy = await until(async () => {
      const v = await analyzerView(page, pre.empty);
      return v.rms > 0.002 && v.bass !== null && v.lit > 0 && v;
    }, { ms: STEP_MS, what: `${leg}: the Analyzer reads the playing song` });

    // 9. STOP and PLAY again.
    await studio(page, leg);
    const quiet = async (what) => until(async () => {
      const c = await counts(page);
      return !c.playing && c.engineNodes === 0 && c.engineSources === 0 && c.runtimeNodes === 0
        && c;
    }, { ms: STEP_MS, what });
    await page.locator('[data-osc="studio.stop"]').first().click();
    const q1 = await quiet(`${leg}: STOP leaves no node`);
    await analyzer(page, leg);
    // After STOP the scope falls silent and the spectrum's bass band decays (the analyser
    // smooths it) to 30 dB below its playing level.
    const idle = await until(async () => {
      const v = await analyzerView(page, pre.empty);
      return v.rms < 1e-4 && (v.bass === null || v.bass < busy.bass - 30) && v;
    }, { ms: STEP_MS, what: `${leg}: the Analyzer reads silence after STOP` });
    check(leg, 'views', 'the Analyzer\'s scope, spectrum and spectrogram show the song',
      busy.rms > 0.002 && idle.rms < 1e-4 && busy.bass > -80 && pre.lit === 0 && busy.lit > 0,
      `scope RMS ${busy.rms.toFixed(4)} playing, ${idle.rms.toExponential(1)} stopped; `
        + `40-400 Hz peak ${busy.bass.toFixed(1)} dB playing, ${idle.bass === null ? 'none'
          : idle.bass.toFixed(1)} dB stopped; spectrogram 80/110/220 Hz rows: ${pre.lit} lit `
        + `pixels before PLAY, ${busy.lit} while playing`);
    await studio(page, leg);
    await page.locator('[data-osc="studio.play"]').first().click();
    const p2 = await until(async () => {
      const c = await counts(page);
      return c.playing && c.runtimeNodes > 0 && c;
    }, { ms: PLAY_MS, what: `${leg}: PLAY plays again` });
    await page.locator('[data-osc="studio.stop"]').first().click();
    const q2 = await quiet(`${leg}: the second STOP leaves no node`);
    check(leg, 'stop-restart', 'STOP leaves 0 nodes and sources, PLAY plays again, STOP again',
      !!q1 && !!p2 && !!q2, `${p2.runtimeNodes} runtime nodes on the second PLAY`);

    // The keyboard view, with the Studio stopped (a held key does not play over the Studio).
    await expected(leg, 'keyboard-view', 'a key pressed on the keyboard view lights on its '
      + 'canvas and sounds', async () => {
      // The effect, not the markup: a keyboard canvas whose key lights when the computer key
      // is held, while the engine counts the note and the main output carries it.
      if (!(await keysImage(page))) throw new Unmet('no keyboard canvas in the page');
      const arm = page.locator('[data-osc="keyboard.arm"]:visible').first();
      let armed = false;
      if (await arm.count() && (await arm.getAttribute('aria-pressed')) !== 'true') {
        await arm.click();
        armed = true;
      }
      const base = await keysImage(page);
      const nodes0 = (await counts(page)).engineNodes;
      let last = { lit: 0, nodes: nodes0, rms: 0 };
      await page.keyboard.down('KeyA');
      try {
        const on = await untilUnmet(async () => {
          const img = await keysImage(page);
          const v = await analyzerView(page);
          last = { lit: img ? changedPixels(base, img) : 0, nodes: (await counts(page)).engineNodes,
            rms: v.rms };
          return last.lit >= 200 && last.nodes > nodes0 && last.rms > 0.002 && last;
        }, { ms: STEP_MS, what: `${leg}: the held key lights and sounds` },
        () => `${last.lit} key pixels lit, ${last.nodes} engine nodes (${nodes0} before), `
          + `output RMS ${last.rms.toFixed(4)}`);
        return { ok: true, detail: `${on.lit} key pixels lit, ${on.nodes} engine nodes, `
          + `output RMS ${on.rms.toFixed(4)}` };
      } finally {
        await page.keyboard.up('KeyA');
        await page.keyboard.press('Escape');
        if (armed) await arm.click();
      }
    });

    // 10. Save, then an edit left unsaved: the working draft differs from the saved project.
    await page.locator('[data-osc="studio.save"]').first().click();
    // What Save wrote, read back from the Studio library, against the live model. Their view
    // state (scroll, zoom) is left out of that comparison only: the editors commit it on a
    // debounce, so a follow-scroll during PLAY may still be landing in the model when Save
    // writes it. The opened project is later compared with the stored one whole.
    const saved = await until(() => page.evaluate(async () => {
      const s = window.OSCILLA.studio;
      if (s.dirty || !s.projectId) return false;
      const got = await (await s.library()).loadProject(s.projectId);
      if (!got) return false;
      const bare = (m) => JSON.stringify({ ...m, view: null });
      return { id: s.projectId, text: JSON.stringify(got.model),
        same: bare(got.model) === bare(s.model), title: got.model.metadata.title,
        persistent: window.OSCILLA.app.studio.persistent };
    }), { ms: STEP_MS, what: `${leg}: Save stores the project` });
    await clearSelection(page);
    await type(page, '[data-osc="studio.inspector.tempo"]', String(DRAFT_TEMPO));
    const draft = await until(async () => {
      const m = await model(page);
      return m.transport.tempo === DRAFT_TEMPO
        && await page.evaluate(() => window.OSCILLA.studio.dirty) && m;
    }, { ms: STEP_MS, what: `${leg}: the unsaved tempo edit reaches the model` });

    // 11. Render WAV of the live, edited song: the offered length covers its last clip (the
    // timeline's end also counts the lanes, whose points are in seconds), and the window
    // rendered carries its tempo (the first drum hit moves with it).
    await page.locator('[data-osc="studio.renderWav"]').first().click();
    const offered = await until(() => page.evaluate(() => {
      const dlg = document.getElementById('osc-dlg-studio-render');
      const d = document.querySelector('[data-osc="studio.render.duration"]');
      const n = document.querySelector('[data-osc="studio.render.note"]');
      return dlg.open && d.value && n.textContent && { duration: Number(d.value),
        note: n.textContent.trim() };
    }), { ms: STEP_MS, what: `${leg}: the Render WAV dialog opens with its offer` });
    const end = songEnd(draft);
    const snareAt = Math.min(...draft.timeline.clips.filter((c) => c.trackId === 'track-snare')
      .map((c) => c.start));
    await page.locator('[data-osc="studio.render.duration"]').first().fill(String(RENDER_S));
    const t0 = Date.now();
    const what = `${leg}: Render WAV downloads the ${RENDER_S} s window`;
    const [download] = await bounded(Promise.all([
      page.waitForEvent('download', { timeout: RENDER_MS }),
      page.locator('[data-osc="studio.render.start"]').click(),
    ]), { ms: RENDER_MS, what });
    const file = await bounded(download.path(), { ms: STEP_MS, what });
    const wav = wavStats(fs.readFileSync(file));
    const lead = wav.firstHit === null ? null : wav.firstHit - snareAt;
    check(leg, 'wav', `Render WAV: the edited song (${DRAFT_TEMPO} BPM, unsaved), a ${RENDER_S} s `
      + 'window, not silent, below full scale, its first drum hit where the tempo puts it',
    end === 105.6 && offered.duration > end && wav.riff === 'RIFF' && wav.wave === 'WAVE'
      && wav.channels === 2 && wav.bits === 16 && Math.abs(wav.seconds - RENDER_S) < 0.001
      && wav.peakDbfs > -40 && wav.peakDbfs < 0 && wav.rmsDbfs > -60
      && lead !== null && lead >= 0 && lead < 0.06,
    `the clips end at ${end} s, ${offered.duration} s offered ("${offered.note}"); ${
      download.suggestedFilename()}: ${
      wav.seconds.toFixed(3)} s, ${wav.sampleRate} Hz, ${wav.channels} ch, peak ${
      wav.peakDbfs.toFixed(1)} dBFS, RMS ${wav.rmsDbfs.toFixed(1)} dBFS; first hit at ${
      wav.firstHit === null ? 'none' : `${wav.firstHit.toFixed(3)} s`}, the snare pickup at ${
      snareAt} s at ${DRAFT_TEMPO} BPM (${(snareAt * DRAFT_TEMPO / 96).toFixed(3)} s at 96); ${
      ((Date.now() - t0) / 1000).toFixed(1)} s`);

    // 12. The page closes with the edit unsaved (no unload prompt, as a crash or a killed tab
    // would) and opens again in the same browser context, whose storage it keeps.
    await page.close({ runBeforeUnload: false });
    page = await openPage(`${leg}: the page is ready after it was closed and opened again`);
    await studio(page, leg);
    await expected(leg, 'restore-last', 'after the page closed with an unsaved edit the Studio '
      + 'offers the draft back, and accepting restores it', async () => {
      await bounded(page.evaluate(async () => !!(await window.OSCILLA.studio.library())),
        { ms: STEP_MS, what: `${leg}: the Studio library opens` });
      const opened = (await model(page)).metadata.title;
      const offer = page.locator('[data-osc^="studio."]:is([data-osc*="draft"], '
        + '[data-osc*="restore"], [data-osc*="recover"]):visible')
        .or(page.getByRole('button', { name: /restore|recover/i }));
      await untilUnmet(async () => (await offer.count()) > 0, { ms: OFFER_MS,
        what: `${leg}: the Studio offers the draft back` },
      () => `no draft offered; the Studio opened "${opened}"`);
      // Offered: accepting must restore the draft, or the step FAILs (a WaitTimeout, not Unmet).
      await offer.first().click();
      const back = await until(async () => {
        const m = await model(page);
        return m.metadata.title === SONG_TITLE && m.transport.tempo === DRAFT_TEMPO && m;
      }, { ms: STEP_MS, what: `${leg}: accepting the offer restores the unsaved draft` });
      return { ok: true,
        detail: `restored "${back.metadata.title}" at ${back.transport.tempo} BPM` };
    });
    if (!saved.persistent) {
      RUN.skip(leg, 'save-reload', 'the Studio library is not persistent in this browser here');
    } else {
      // Over unsaved changes (a draft restored above, once V604 lands) Open asks first, and the
      // user replaces them; over the clean page it opens at once.
      const unsaved = await page.evaluate(() => window.OSCILLA.studio.dirty);
      await page.locator('[data-osc="studio.open"]').first().click();
      await page.getByRole('button', { name: `Open ${SONG_TITLE}` }).first().click();
      if (unsaved) {
        await page.getByRole('button',
          { name: `Replace the unsaved changes in Studio with ${SONG_TITLE}` }).first().click();
      }
      const reopened = await until(async () => {
        const m = await model(page);
        return m.metadata.title === SONG_TITLE && m.timeline.clips.length === 744
          && m.transport.tempo === 96 && JSON.stringify(m);
      }, { ms: STEP_MS, what: `${leg}: Projects, Open loads the saved song` });
      check(leg, 'save-reload', 'Save stores the edited song; the page closed and opened, '
        + 'Projects, Open: the stored model, not the unsaved edit',
      saved.same && saved.title === SONG_TITLE && reopened === saved.text,
      `${saved.id}: stored ${saved.same ? 'equals' : 'differs from'} the live model (view `
        + `state aside), opened ${reopened === saved.text ? 'equals' : 'differs from'} the `
        + `stored, ${reopened.length} characters`);
    }

    check(leg, 'no-errors', 'no page error or console error', errors.length === 0,
      errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}

async function main() {
  await RUN.ready();
  for (const b of RUN.browsers) {
    const browser = await playwright[b].launch(LAUNCH[b]);
    console.log(`\n${b} (${browser.version()})`);
    try {
      await journey(browser, b);
    } catch (err) {
      check(b, 'journey', 'the journey completed', false, err && err.stack);
    } finally {
      await browser.close();
    }
  }
  console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL PASS'} (${passes} checks passed, ${
    xfails} expected failure(s))`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

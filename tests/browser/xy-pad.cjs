#!/usr/bin/env node
// OSCILLA Synth XY tab (plan K097, K167) on the built dist/index.html in chromium, firefox and
// webkit, at 1536 x 1024, 1280 x 720 (x-dock-desktop) and 390 x 844 (touch). Every sound check
// reads the engine's analyser after the safety chain or the runtime's own pad handle, never the
// DOM alone.
//
//   node tests/browser/xy-pad.cjs [--browsers chromium,firefox,webkit] [--origins file,http]
//        [--only x-link,x-pointer]
//
// Every check opens the Synth's XY tab as the owner meets it (no preset: the default Synth
// document, K183) unless it is about the XY lead preset (x-link, x-pointer, x-view*); the
// gesture rule is off except on the phone-cold leg. A check that cannot run on an engine is skipped before it
// opens a page and is reported as skipped, never counted as a check (K148): a leg whose every
// check was skipped prints a SKIP line and reports nothing.
//
// Checks (desktop; the phone leg runs x-first, x-touch, x-chip-gap and x-view-phone, the
// phone-cold leg x-cold-touch, the phone-dock and phone-dock-se legs x-dock-yields, the laptop
// leg x-dock-desktop):
//   x-link     linked: #m=synth&yt=xy opens the XY tab; the XY lead preset chosen in the preset
//              menu is one undo entry that sets the pad's scale on its face (C, minor
//              pentatonic) and cables Y alone into LPF Cutoff, no Pitch or Gate cable (K183
//              review F3), after which QWERTY A still sounds C4 (RMS above -45 dB); its undo
//              gives back the default document's one Y cable; Open in Studio draws the pad's
//              node and each of its edges in the Studio graph
//   x-pointer  real-time, XY lead: a pointer held on the pad's first step sounds C3 (130.8 Hz)
//              and the transport holds MIDI 48 (the keys' one note path); moved to the seventh step it sounds Eb4
//              (311.1 Hz); Y from the bottom to the top raises the 10-16 kHz band against
//              the fundamental by at least the least rise of the low-pass biquad's response
//              over the band (less 2 dB), derived from the document: LPF Cutoff's log cables,
//              EG 2 at its sustain (the preset keeps its amount), Y at 0.05 and 0.95, one
//              factor for 0.95 x Nyquist as computeBases scales them; a derived rise under 6 dB
//              fails the check; the release is silent (below -70 dB rel)
//   x-first    (K183; desktop in every engine; 390 px touch in chromium by CDP touch and in webkit
//              by PointerEvents of pointerType touch dispatched on the pad, since Playwright
//              drives no held touch in webkit: page.touchscreen has tap only, no CDP touch)
//              a fresh Synth, no preset: the pad is enabled with no Patch button; QWERTY A
//              sounds C4 and its release silences; one pointer-down (a touch on the phone) on
//              the pad's first step raises the runtime's source count from 0 and sounds C3
//              (VCO 2 at 8': 130.8 Hz) within SOUND_MS; moved to the seventh step it sounds Eb4
//              (311.1 Hz); the lift silences; QWERTY A still sounds after (RMS above -45
//              dB, review F6); with A held a touch takes the voice (Eb4) and its lift gives
//              C4 back, audible; the Synth status names what the keys and the pad play
//   x-y-rest   (K183 review N2; desktop, every engine) the keys' C4 with no touch sets the
//              6-12 kHz band against C4; a touch at Y 0.9 raises it 6 dB or more; after the lift
//              the pad's Y output reads 0 (X's too, cabled into LPF Cutoff and lifted from the
//              last cell, review of #428 NF3), the readout says Y 0 %, and C4 from the keys has the
//              band back within 1.5 dB of the no-touch reference (named until() deadlines)
//   x-keys     interactive: arrows move the cursor (aria-valuenow, aria-valuetext of both
//              sliders), Enter held sounds and its release silences; a held Enter is released
//              by Escape, by blur and by page hide; the surface is role=application described
//              by its axes inside a role=group with two sliders
//   x-touch    (390 px, touch, chromium) one touch sounds; a second touch point moves Y only
//              (X's aria-valuenow unchanged); lifting both silences; no horizontal page scroll
//   x-release-stop   (K167) a held pad is released by the Studio transport's Stop: silent
//              (below -70 dB rel), runtime census 0, no held note, the pad's gate closed, and
//              the next press sounds again
//   x-release-leave  (K167) a held pad is released by leaving the Synth workspace (the
//              workspace switch itself, no focus move): silent, census 0, gate closed
//   x-release-owner  (K167) a held pad is released when another workspace's player (the
//              Pattern Sequencer) takes the audio owner: gate closed, no held note, the
//              transport stopped; once that player stops, silent and census 0
//   x-view     (S3) a held pointer draws the ring at the touch point (its centre within 2 px),
//              the note beside it equal to the runtime pad pitch's note, the Y value equal to
//              what the LPF Cutoff knob and Y's cable ask at the Y slider's value (base x
//              2^(depth y), 4 digits), the same note and value in the X and Y aria-valuetext, the
//              gate LED lit; the Y ends read the cutoff at Y 0 and 1; the readout line sits
//              above the surface; moving draws a trail; the release clears it, hides the ring
//              and unlights the LED
//   x-view-phone     (S3; 390 px, touch) the same on a phone: a touch (CDP in chromium, the
//              pointer in firefox and webkit) draws the ring, the note, the value and a trail,
//              and the pad does not move under the finger (the readout keeps its lines);
//              lifting clears it
//   x-view-reduced   (S3; prefers-reduced-motion: reduce) the ring follows the pointer and no
//              trail segment is ever drawn
//   x-chip-gap (K167; 390 px, touch) the Synth's sticky chip bar sticks flush under the app
//              nav: scrolled, every point of the band between them hits the nav or the chip
//              bar, never page content
//   x-cold-touch  (K183 S4; 390 px, touch, mobile where the engine has it, the browser's
//              gesture rule ON: Chromium --autoplay-policy=user-gesture-required, the others as
//              they ship) the XY tab opened by its link, so the page has no user activation
//              (chromium reads only through CDP evaluations with userGesture false) and no
//              running context; the pad is playable at once (enabled, no Patch button). A first
//              touch held on the pad (chromium: CDP touch; webkit and firefox: the pointer)
//              starts the audio and the held note sounds once it runs (the note replayed on the
//              unlock); while the context was still suspended the pad's line said "Tap once to
//              start audio" (webkit and firefox start it suspended; Chromium's headless shell
//              starts it running even under the gesture rule, so there the line must never say
//              it); the lift silences, the line says the pad plays, a second held touch sounds
//              and its release silences; no touch edits the document
//   x-dock-yields    (K171; 390 x 844 and 375 x 667, the iPhone 13 and SE sizes; touch, mobile
//              where the engine has it, the gesture rule ON; every engine) from the Synth's
//              own entry on its Panel tab (no pad mounted: the keys own the notes, the dock
//              docked with its keys shown), the XY tab opened by a tap: the pad is playable at
//              once (K183) and owns the notes, and with no scroll by the test the whole pad is
//              inside the first viewport and nothing covers it (elementFromPoint at its four
//              corners, 8 px in for its rounded border, and its centre is the pad), the docked
//              keyboard folded to its handle (aria-expanded false, the keys not drawn), visible
//              below the pad; the first tap on the pad sounds (the engine's analyser, sampled
//              every frame from before the tap, a tap of two input events: CDP touch in
//              chromium, the pointer in webkit and firefox; its peak above -60 dB, a short note
//              over the -70 dB silence line); while the pad owns the notes a held computer key A
//              sounds C4 (the analyser) and its release silences; the handle unfolds the dock,
//              with its keys shown, and folds it again by tap, by Enter on the focused handle
//              and by Alt+K (the key registry), the pad whole above it each time; a computer
//              key held with the dock unfolded is released when it folds
//   x-dock-desktop   (K171; 1536 x 1024 and 1280 x 720, the owner's screenshot of 2026-11-05: the
//              dock covered the pad's lower part) on the XY tab as the owner meets it (the pad
//              owns the notes), with no scroll by the test, nothing covers the pad:
//              elementFromPoint at its four corners, 2 px inside its rounded border, and its
//              centre is the pad, never the dock; the dock is folded to its handle
//              (aria-expanded false, the keys not drawn), the handle visible inside the viewport
//              below the pad and the element at its centre; a pointer held on the pad sounds,
//              and unfolding the dock by Alt+K (the pad whole above it, its height following the
//              room: 100dvh less the chrome and --osc-dock-h, the keys shown) and folding it
//              again by Alt+K leave the pad's note sounding (the fold releases only the keys'
//              notes); the lift silences
//   x-dock-handle-hold (review of #425, R8; 390 x 844, touch, the gesture rule on; chromium by
//              CDP touch, webkit by a touch pointer dispatched on the pad and a real tap; firefox
//              skips it) a finger held on the pad sounds, a second finger taps the dock's handle:
//              the keys unfold where the tap is a click (webkit; chromium makes no click of a
//              tap while another finger is down, and the dock stays folded),
//              the focus stays in the pad's group, its gate stays open (aria-pressed) and the
//              note sounds on; the lift silences
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
// The gesture rule on (project.a-phone-sounds): Chromium's default for a page without media
// engagement, stated; the other engines as they ship.
const GESTURE_LAUNCH = { chromium: { args: ['--autoplay-policy=user-gesture-required'] },
  firefox: {}, webkit: {} };
const SIZES = { desktop: { width: 1536, height: 1024 }, laptop: { width: 1280, height: 720 },
  phone: { width: 390, height: 844 }, 'phone-cold': { width: 390, height: 844 },
  'phone-dock': { width: 390, height: 844 }, 'phone-dock-se': { width: 375, height: 667 } };
const LEG_OF = { 'x-touch': 'phone', 'x-chip-gap': 'phone', 'x-cold-touch': 'phone-cold',
  'x-view-phone': 'phone' };
const CONTEXT_OF = { 'x-view-reduced': { reducedMotion: 'reduce' } };
// x-first runs on the desktop and the phone legs; K171 holds at the iPhone 13 and SE sizes,
// and at 1536 x 1024 and 1280 x 720 with a mouse.
const LEGS_OF = { 'x-first': ['desktop', 'phone'],
  'x-dock-yields': ['phone-dock', 'phone-dock-se'], 'x-dock-desktop': ['desktop', 'laptop'],
  'x-dock-handle-hold': ['phone-dock'] };
// The legs with the browser's gesture rule on and mobile emulation where the engine has it.
const GESTURE_LEGS = new Set(['phone-cold', 'phone-dock', 'phone-dock-se']);
// The checks about the XY lead preset (the pad's view, S3, is measured on it); every other one
// opens the tab as the owner meets it.
const PRESET_OF = { 'x-link': 'xy-lead', 'x-pointer': 'xy-lead', 'x-view': 'xy-lead',
  'x-view-phone': 'xy-lead', 'x-view-reduced': 'xy-lead' };
// The tab a check opens the Synth on (default the XY tab): x-dock-yields starts on its Panel.
const TAB_OF = { 'x-dock-yields': 'panel' };
// Checks that open their own page (x-cold-touch: with no user activation before its touch).
const SELF_OPEN = new Set(['x-cold-touch']);
// Engines a check cannot run on, with the reason (reported as a skip, never as a check).
const SKIP_OF = {
  'x-touch': { firefox: 'two touch points need the CDP touch input',
    webkit: 'two touch points need the CDP touch input' },
  'x-first/phone': { firefox: 'Firefox has no mobile emulation: no coarse pointer' },
  'x-dock-handle-hold': { firefox: 'two fingers need a held touch: Playwright holds none in '
    + 'firefox, and a held mouse ends at a touch tap there (its compatibility mouse events)' },
};
const LOAD_MS = 60000;
const SOUND_MS = 8000; // an attack, a glide and the analyser's smoothing
const CHECK_MS = 120000;
const C3 = 130.8128;
const C4 = 261.6256;
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
/**
 * |H(f)| in dB of Web Audio's low-pass biquad (the Audio EQ Cookbook form the spec defines;
 * Q in dB as the node takes it) at cutoff f0 and sample rate sr.
 */
function lowpassDb(f, f0, qDb, sr) {
  const w0 = (2 * Math.PI * f0) / sr;
  const alpha = Math.sin(w0) / (2 * 10 ** (qDb / 20));
  const c = Math.cos(w0);
  const [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
  const [a0, a1, a2] = [1 + alpha, -2 * c, 1 - alpha];
  const w = (2 * Math.PI * f) / sr;
  const mag = (k0, k1, k2) => Math.hypot(k0 + k1 * Math.cos(w) + k2 * Math.cos(2 * w),
    -(k1 * Math.sin(w) + k2 * Math.sin(2 * w)));
  return 20 * Math.log10(mag(b0, b1, b2) / mag(a0, a1, a2));
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
/** The runtime census, the transport and the pad's gate (aria-pressed), in one read. */
const census = (page) => page.evaluate(() => {
  const st = window.OSCILLA.studio;
  const t = st.transport;
  const s = document.querySelector('[data-xy-surface]');
  return { ...st.counts(), held: t ? t.heldNotes().length : 0,
    pressed: s ? s.getAttribute('aria-pressed') : null, owner: window.OSCILLA.app.outputOwner };
});
/** Released: the pad's gate closed, no note held, the runtime census 0, the output silent. */
async function releasedAll(page, what) {
  let c = null;
  await until(async () => {
    c = await census(page);
    return c.pressed === 'false' && c.held === 0 && c.runtimeNodes === 0 && !c.playing;
  }, { ms: SOUND_MS, what: `${what}: gate closed, nothing held, runtime census 0` });
  const q = await silent(page, `${what}: silent`);
  return { ...c, rmsDb: Number(q.rmsDb.toFixed(1)) };
}
/** Hold Enter on the focused pad until it sounds (a press that no pointer or focus move ends). */
async function holdEnter(page, what) {
  await page.locator('[data-xy-surface]').focus();
  await page.keyboard.down('Enter');
  await loud(page, `Enter held sounds (${what})`);
  await until(async () => (await census(page)).pressed === 'true', { ms: SOUND_MS,
    what: `the pad's gate is open (${what})` });
}
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

async function openXy(context, base, { preset = null, tab = 'xy' } = {}) {
  // preset null: the tab as a first open shows it; tab 'panel': the Synth opened on its Panel
  const page = await context.newPage();
  await page.goto(`${base}#m=synth${tab === 'xy' ? '&yt=xy' : ''}`);
  await until(() => page.evaluate((want) => !!(window.OSCILLA && window.OSCILLA.app
    && window.OSCILLA.app.synthDebug && window.OSCILLA.app.synthDebug().present
    && window.OSCILLA.app.synthDebug().tab === want
    && (want !== 'xy' || document.querySelector('[data-osc="synth.xy"]'))), tab),
  { ms: LOAD_MS, what: `the Synth's ${tab} tab is rendered` });
  if (tab === 'xy') {
    await until(() => page.evaluate(() => !!document.querySelector('[data-xy-surface]')),
      { ms: 10000, what: 'the XY pad is mounted' });
  }
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

/** The pad's view (S3): the ring's centre, its readouts, the trail, the LED, the Y ends, the
 *  sliders' texts and where the readout line and the surface sit. */
const viewState = (page) => page.evaluate(() => {
  const q = (sel) => document.querySelector(sel);
  const ring = q('[data-xy-ring]');
  const cursor = q('[data-xy-cursor]');
  const r = ring ? ring.getBoundingClientRect() : null;
  const s = q('[data-xy-surface]').getBoundingClientRect();
  const out = q('[data-osc="synth.xy.readout"]').getBoundingClientRect();
  const led = q('[data-xy-gate] [data-led]');
  const text = (sel) => (q(sel) ? q(sel).textContent : null);
  return { shown: !!cursor && !cursor.classList.contains('hidden'),
    ring: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null,
    note: text('[data-xy-note]'), value: text('[data-xy-value]'),
    trail: [...document.querySelectorAll('[data-xy-trail] line')]
      .filter((l) => !l.classList.contains('hidden')).length,
    lit: led ? led.getAttribute('data-lit') : null,
    ends: [text('[data-xy-yend="bottom"]'), text('[data-xy-yend="top"]')],
    xText: q('[data-xy-axis="x"]').getAttribute('aria-valuetext'),
    yText: q('[data-xy-axis="y"]').getAttribute('aria-valuetext'),
    yNow: Number(q('[data-xy-axis="y"]').getAttribute('aria-valuenow')),
    readoutBottom: out.bottom, surfaceTop: s.top };
});
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** The note of a pitch in octaves from A4 (the pad's Pitch output). */
const noteOf = (oct) => {
  const n = Math.round(69 + 12 * oct);
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
};
/** Hz from a knob text ("5.1445 kHz", "800 Hz"). */
const hzOf = (t) => {
  const m = /(-?[\d.]+)\s*(kHz|Hz)/.exec(t || '');
  return m ? Number(m[1]) * (m[2] === 'kHz' ? 1000 : 1) : NaN;
};
/**
 * What LPF Cutoff plays at Y = y on the running graph, read as the unit test reads it on the
 * fake engine: the biquad's base frequency x 2^((its detune's base cents + Y's edge gain x y)
 * / 1200), Y's gain read as the runtime scheduled it (its ramp's target: an AudioParam's
 * value is the ramp's start in firefox and webkit). Y's gain is the one computeBases sized: on
 * the default document (K183) LPF Cutoff's MG and EG 2 normals share its 0.95 x Nyquist
 * headroom, so Y's depth is scaled ("held") and the knob's value x 2^(depth y) is no longer
 * what plays. NaN while nothing runs.
 */
const cutoffAt = (page, y) => page.evaluate((yy) => {
  const st = window.OSCILLA.studio;
  const pad = st.model.graph.nodes.find((n) => n.type === 'xy-pad');
  const e = st.model.graph.edges.find((x) => x.from.node === pad.id && x.from.port === 'y');
  const h = st.runtime && st.runtime.nodes.get(e.to.node);
  const eh = st.runtime && st.runtime.edges.get(e.id);
  const lin = h && h.modTarget('frequency', 'linear');
  const log = h && h.modTarget('frequency', 'log');
  const p = e.props;
  const g = eh && eh.ramp && Number.isFinite(eh.ramp.target) ? eh.ramp.target : NaN;
  if (!lin || !lin.param || !log || !log.param || !Number.isFinite(g)) {
    return { mapping: p.mapping, polarity: p.polarity, hz: NaN };
  }
  return { mapping: p.mapping, polarity: p.polarity,
    hz: lin.param.value * 2 ** ((log.param.value + g * yy) / 1200) };
}, y);
/** A pad point where the pad is now (no scroll: a held touch keeps the page where it is). */
async function pointIn(page, i, fy) {
  const b = await page.locator('[data-xy-surface]').boundingBox();
  return { x: b.x + ((i + 0.5) / STEPS) * b.width, y: b.y + (1 - fy) * b.height };
}
const near = (a, b, rel = 1e-3) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

/** The note the transport holds on the keys' one note path (K183: the pad plays through the
 *  keys; its own Pitch output feeds no cable, and Chromium does not render a ConstantSource
 *  nothing reads), in octaves from A4, or null while nothing is held. */
const heldPitch = (page) => page.evaluate(() => {
  const t = window.OSCILLA.studio.transport;
  const h = t ? t.heldNotes() : [];
  return h.length ? (h[0] - 69) / 12 : null;
});

/** S3 on the touched pad: ring at the point, the note the runtime plays, the Y value. The
 *  checks run on the XY lead (both VCOs at 8'): the note heard is the note held. */
async function viewHeld(page, at, what) {
  let v = null;
  let pad = null;
  try {
    await until(async () => {
      v = await viewState(page);
      pad = { pitch: await heldPitch(page) };
      return v.shown && !!v.ring && Math.hypot(v.ring.x - at.x, v.ring.y - at.y) <= 2
        && pad.pitch !== null && v.note === noteOf(pad.pitch) && v.lit === 'true';
    }, { ms: SOUND_MS, what: `${what}: the ring at the touch point, the note the runtime `
      + 'plays, the gate LED lit' });
  } catch (e) {
    return { ok: false, why: String(e.message).split('\n')[0], at, v,
      pitch: pad && pad.pitch, runtimeNote: pad && pad.pitch !== null ? noteOf(pad.pitch) : null };
  }
  const shown = hzOf(v.value);
  // What plays is read from AudioParams that may still be gliding to their bases: polled until
  // it is the value shown, within the named deadline (a miss is reported below, never thrown).
  let want = await cutoffAt(page, v.yNow);
  try {
    await until(async () => {
      want = await cutoffAt(page, v.yNow);
      return near(shown, want.hz) && near(hzOf(v.yText), want.hz);
    }, { ms: SOUND_MS, what: `${what}: the Y value shown is what LPF Cutoff plays` });
  } catch (e) { /* the comparison below says what differs */ }
  const ok = want.mapping === 'log' && /^LPF Cutoff /.test(v.value) && near(shown, want.hz)
    && v.xText.startsWith(`${v.note}, degree `) && v.yText.includes(`LPF Cutoff: `)
    && near(hzOf(v.yText), want.hz);
  return { ok, v, pad: pad.pitch, want: Number(want.hz.toFixed(1)), shown,
    off: Number(Math.hypot(v.ring.x - at.x, v.ring.y - at.y).toFixed(2)) };
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
    // K183 review F3: a preset patches Y alone; the keys keep their Pitch and Gate normals.
    const want = ['y>frequency'];
    if (tab !== 'true' || JSON.stringify(ports) !== JSON.stringify(want)
      || s.params.mode !== 'minor-pentatonic' || s.params.key !== 'C'
      || !face.includes('xy.mode:minor-pentatonic') || !face.includes('xy.key:C')) {
      return { ok: false, detail: 'the preset did not set the scale and the cables', tab, ports,
        params: s.params, face };
    }
    const keyDb = await keyA(page, 'after the XY lead preset: the keys still play');
    await page.evaluate(() => window.OSCILLA.studio.store.undo());
    const undone = await padState(page);
    // One undo gives the default document back: its one Y cable into LPF Cutoff (K183).
    if (JSON.stringify(undone.edges.map((e) => `${e.port}>${e.to.port}`)) !== '["y>frequency"]') {
      return { ok: false, detail: 'one undo does not give the default cables back', undone };
    }
    await page.evaluate(() => window.OSCILLA.studio.store.redo());
    await page.locator('[data-osc="synth.studio"]').click();
    await until(() => page.evaluate((ids) => window.OSCILLA.app.workspace === 'studio'
      && ids.every((id) => document.querySelector(`[data-node-id="${id}"]`)
        || document.querySelector(`[data-edge-id="${id}"]`)),
    [s.id, ...s.edges.map((e) => e.id)]), { ms: 10000,
      what: 'the Studio graph draws the pad node and its edges' });
    return { ok: true, rev, ports, face, keyDb };
  });

  def('x-pointer', async ({ page }) => {
    let p = await padPoint(page, 0, 0.05);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    const low = await sound(page, (q) => peakAt(q, C3), 'the first step sounds C3');
    // The note goes through the keys (K183): the transport holds C3 (MIDI 48). The pad node's
    // own Pitch output feeds no cable since the review's F3, and Chromium does not render a
    // ConstantSource nothing reads, so its offset is no reading of what plays.
    await until(() => page.evaluate(() => {
      const t = window.OSCILLA.studio.transport;
      const h = t ? t.heldNotes() : []; // the Keys node's note and the pad node's gate
      return h.length > 0 && h.every((n) => n === 48);
    }), { ms: SOUND_MS, what: 'the pad holds C3 (MIDI 48) on the keys\' one note path' });
    const yLow = await sound(page, (q) => peakAt(q, C3), 'C3 with Y at the bottom');
    p = await padPoint(page, 6, 0.05);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await sound(page, (q) => peakAt(q, EB4), 'the seventh step sounds Eb4');
    const base = await sound(page, (q) => peakAt(q, EB4), 'Eb4 with Y at the bottom');
    // What Y should do, derived from the document (K183 review F3: a preset keeps the LPF's
    // amount knobs, so EG 2 holds the cutoff up at its sustain): the cutoff of LPF Cutoff's
    // log cables, EG 2 at its sustain and Y at 0.05 or 0.95, all scaled by the one factor
    // computeBases gives them to stay at or below 0.95 x Nyquist; the band's level relative to
    // Eb4 rises at least by the least rise of the biquad's own response over the band.
    const doc = await page.evaluate(() => {
      const st = window.OSCILLA.studio;
      const m = st.model;
      const lpf = m.graph.nodes.find((n) => n.metadata && n.metadata.panel
        && n.metadata.panel.module === 'lpf');
      const eg2 = m.graph.nodes.find((n) => n.metadata && n.metadata.panel
        && n.metadata.panel.module === 'eg2');
      const pad = m.graph.nodes.find((n) => n.type === 'xy-pad');
      const into = m.graph.edges.filter((e) => e.to.node === lpf.id && e.to.port === 'frequency')
        .map((e) => ({ from: e.from.node === pad.id ? 'y' : e.from.node === eg2.id ? 'eg2'
          : 'other', ...e.props }));
      return { f0: lpf.params.frequency, q: lpf.params.Q, sustain: eg2.params.sustain, into,
        sr: window.OSCILLA.engine.ctx.sampleRate };
    });
    const cap = 0.95 * (doc.sr / 2);
    const logs = doc.into.filter((e) => e.mapping === 'log' && !e.muted);
    // Each log cable's upward excursion is its depth in octaves (computeBases: a range mapped
    // onto [0, depth] or [-depth, depth]); with the cables' top above the room, one factor.
    const upC = logs.reduce((t, e) => t + 1200 * e.depth, 0);
    const room = 1200 * Math.log2(cap / Math.min(cap, doc.f0));
    const kc = upC > room ? Math.max(0, room) / upC : 1;
    const oct = (y) => logs.reduce((t, e) => t + (e.from === 'y' ? y * e.depth
      : e.from === 'eg2' ? doc.sustain * e.depth : 0), 0) * kc;
    const fc = (y) => Math.min(cap, doc.f0) * 2 ** oct(y);
    const qDb = 20 * Math.log10(doc.q);
    const BAND = [10000, 16000];
    let want = Infinity; // the least rise of the response over the band, 100 Hz steps
    for (let f = BAND[0]; f <= BAND[1]; f += 100) {
      want = Math.min(want, lowpassDb(f, fc(0.95), qDb, doc.sr) - lowpassDb(f, fc(0.05), qDb,
        doc.sr));
    }
    if (!(want >= 6)) {
      return { ok: false, detail: 'the derivation leaves Y no 6 dB to show in the band', want,
        doc, fc: [fc(0.05), fc(0.95)] };
    }
    const rel = (q) => bandDb(q, BAND[0], BAND[1]) - levelAt(q, EB4);
    p = await padPoint(page, 6, 0.95);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    // 2 dB under the derived least rise: the analyser's smoothing and the MG's vibrato.
    const top = await sound(page, (q) => peakAt(q, EB4) && rel(q) - rel(base) >= want - 2,
      `Y at the top opens the LPF: the ${BAND.join('-')} Hz band ${want.toFixed(1)} dB up `
      + '(derived)');
    await page.mouse.up();
    await silent(page, 'the release is silent');
    return { ok: true, low: low.rmsDb, yLow: yLow.rmsDb, cutoffs: [Math.round(fc(0.05)),
      Math.round(fc(0.95))], wantDb: Number(want.toFixed(1)),
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
      || !/X is the note/.test(desc.text) || !/Y drives/.test(desc.text)) {
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

  def('x-touch', async ({ page }) => {
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

  def('x-release-stop', async ({ page }) => {
    await holdEnter(page, 'stop');
    await page.evaluate(() => window.OSCILLA.app.studioStop()); // STOP, the focus stays put
    const after = await releasedAll(page, 'Stop releases the held pad');
    await page.keyboard.up('Enter');
    await holdEnter(page, 'the next press after Stop');
    await page.keyboard.up('Enter');
    await silent(page, 'releasing the next press silences');
    return { ok: true, after };
  });

  def('x-release-leave', async ({ page }) => {
    await holdEnter(page, 'leave');
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('studio'));
    const after = await releasedAll(page, 'leaving the Synth releases the held pad');
    await page.keyboard.up('Enter');
    return { ok: true, after };
  });

  def('x-release-owner', async ({ page }) => {
    await holdEnter(page, 'owner');
    const started = await page.evaluate(() => window.OSCILLA.labs.sequencer.editor.play());
    if (!started) return { ok: false, detail: 'the Pattern Sequencer did not start' };
    let c = null;
    await until(async () => {
      c = await census(page);
      return c.owner === 'sequencer' && c.pressed === 'false' && c.held === 0 && !c.playing;
    }, { ms: SOUND_MS, what: 'the sequencer takes the owner: the held pad is released' });
    await page.evaluate(() => window.OSCILLA.labs.sequencer.editor.stop());
    const after = await releasedAll(page, 'once the sequencer stops');
    await page.keyboard.up('Enter');
    return { ok: true, taken: c, after };
  });

  def('x-chip-gap', async ({ page }) => {
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.alerts = [];
      if (typeof a.dismissSafety === 'function') a.dismissSafety();
    });
    let g = null;
    await until(async () => {
      g = await page.evaluate(() => {
        const main = document.getElementById('osc-main');
        main.scrollTop = main.scrollHeight; // far enough that the chip bar is stuck
        const chips = document.querySelector('[data-osc="synth.panel"] nav');
        // The chrome above the scroller is the Pro shell's page header (F002, U006), under the
        // navbar (role banner): the chip bar sticks flush under it.
        const nav = document.querySelector('[data-osc="page.header"]');
        const top = Math.round(nav.getBoundingClientRect().bottom);
        const stuck = Math.round(chips.getBoundingClientRect().top);
        // Sample inside the chip bar, clear of the scroller's own scrollbar: webkit draws an
        // overlay scrollbar (about 15 px, not counted in clientWidth) at the scroller's right
        // edge after a scroll, and a hit there is the scroller itself, not page content.
        const SCROLLBAR_PX = 20;
        const mr = main.getBoundingClientRect();
        const cr = chips.getBoundingClientRect();
        const left = Math.ceil(Math.max(cr.left, mr.left)) + 4;
        const right = Math.floor(Math.min(cr.right, mr.right - SCROLLBAR_PX));
        const hits = [];
        for (let y = top - 2; y <= stuck + 4; y += 1) {
          for (const x of [left, Math.round((left + right) / 2), right]) {
            const e = document.elementFromPoint(x, y);
            const who = !e ? 'none' : chips.contains(e) ? 'chips' : nav.contains(e)
              || e.closest('[role="banner"]') ? 'nav' : `${e.tagName}.${String(e.className
                .baseVal ?? e.className).slice(0, 40)}`;
            hits.push([x, y, who]);
          }
        }
        return { top, stuck, scrolled: main.scrollTop > 0, xs: [left, right], hits };
      });
      return g.scrolled && g.stuck <= g.top + 12;
    }, { ms: 10000, what: 'the scrolled Synth sticks its chip bar under the app nav' });
    const bad = g.hits.filter(([, , who]) => who !== 'nav' && who !== 'chips');
    return { ok: !bad.length && Math.abs(g.stuck - g.top) <= 1 && g.xs[1] - g.xs[0] > 200,
      top: g.top, stuck: g.stuck, xs: g.xs, bad: bad.slice(0, 6) };
  });

  // ---- K183: the pad sounds on first touch, as the owner meets it
  /** What the pad and the keys see now: enabled, a Patch button, the line, the status. */
  const padView = (page) => page.evaluate(() => {
    const s = document.querySelector('[data-xy-surface]');
    const first = document.querySelector('[data-xy-first]');
    return { disabled: s ? s.getAttribute('aria-disabled') : null,
      button: !!document.querySelector('[data-xy-voice]'),
      first: first && !first.hidden ? first.textContent : null,
      status: window.OSCILLA.app.synth.status,
      sources: window.OSCILLA.studio.counts().runtimeSources };
  });
  /**
   * Hold a point: CDP touch (chromium phone); in webkit on the phone leg ('dispatch')
   * PointerEvents of pointerType touch dispatched on the pad, because Playwright drives no held
   * touch in webkit (page.touchscreen has tap only, and webkit has no CDP touch); the mouse
   * elsewhere; -> { move, lift }.
   */
  async function press(page, p, { touch = false } = {}) {
    if (touch === 'dispatch') {
      const fire = (type, q) => page.evaluate(([t, x, y]) => {
        const s = document.querySelector('[data-xy-surface]');
        s.dispatchEvent(new PointerEvent(t, { pointerId: 71, pointerType: 'touch',
          isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y,
          pressure: t === 'pointerup' ? 0 : 0.5 }));
      }, [type, q.x, q.y]);
      await fire('pointerdown', p);
      let at = p;
      return { move: async (q) => { at = q; await fire('pointermove', q); },
        lift: () => fire('pointerup', at) };
    }
    if (touch) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart',
        touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
      return {
        move: (q) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
          touchPoints: [{ x: q.x, y: q.y, id: 1 }] }),
        lift: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
      };
    }
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    return { move: (q) => page.mouse.move(q.x, q.y, { steps: 4 }), lift: () => page.mouse.up() };
  }
  /** QWERTY A (C4) sounds while held and its release silences. */
  async function keyA(page, what) {
    await page.keyboard.down('KeyA');
    // Audible (RMS above -45 dB), not only a peak over the analyser's floor (review F6).
    const q = await sound(page, (x) => x.rmsDb > -45 && peakAt(x, C4),
      `QWERTY A sounds C4 (${what})`);
    await page.keyboard.up('KeyA');
    await silent(page, `the key's release silences (${what})`);
    return Number(q.rmsDb.toFixed(1));
  }

  def('x-first', async ({ page, browserName, sizeName }) => {
    const before = await padView(page);
    if (before.disabled !== 'false' || before.button) {
      return { ok: false, detail: 'the fresh pad is not enabled, or offers a Patch button',
        before };
    }
    if (before.sources !== 0) return { ok: false, detail: 'sources run before a touch', before };
    const keyBefore = await keyA(page, 'before the pad');
    await page.evaluate(() => window.OSCILLA.app.studioStop()); // back to no source
    await until(async () => (await padView(page)).sources === 0, { ms: SOUND_MS,
      what: 'the Stop leaves no runtime source' });
    // The phone leg touches: CDP touch in chromium, dispatched touch PointerEvents in webkit
    // (press); firefox skips this leg (no mobile emulation).
    const touch = sizeName !== 'phone' ? false : browserName === 'chromium' ? true : 'dispatch';
    const p0 = await padPoint(page, 0, 0.5);
    const hold = await press(page, p0, { touch });
    let raised = null;
    await until(async () => (raised = await padView(page)).sources > 0, { ms: SOUND_MS,
      what: 'one pointer-down on the pad raises the runtime source count' });
    const low = await sound(page, (q) => q.rmsDb > -45 && peakAt(q, C3),
      'the pad\'s first step sounds C3');
    await hold.move(await padPoint(page, 6, 0.5));
    const high = await sound(page, (q) => q.rmsDb > -45 && peakAt(q, EB4) && !peakAt(q, C3),
      'moved to the seventh step it sounds Eb4');
    await hold.lift();
    const off = await silent(page, 'the lift silences');
    const keyAfter = await keyA(page, 'after the pad');
    // Both at once (review F6): A held sounds C4, a touch on the pad takes the voice (the last
    // note), and its lift gives C4 back, audible, while A is still held.
    await page.keyboard.down('KeyA');
    await sound(page, (q) => q.rmsDb > -45 && peakAt(q, C4), 'A held sounds C4');
    const both = await press(page, await padPoint(page, 6, 0.5), { touch });
    await sound(page, (q) => q.rmsDb > -45 && peakAt(q, EB4), 'the pad over the held key: Eb4');
    await both.lift();
    const back = await sound(page, (q) => q.rmsDb > -45 && peakAt(q, C4),
      'the pad lifted, the held key sounds C4 again');
    await page.keyboard.up('KeyA');
    await silent(page, 'the key\'s release silences');
    const status = (await padView(page)).status;
    if (!/keys and the XY pad play/.test(status)) {
      return { ok: false, detail: 'the status does not say what the keys and the pad play',
        status };
    }
    return { ok: true, touch, sources: raised.sources, low: low.rmsDb, high: high.rmsDb,
      off: Number(off.rmsDb.toFixed(1)), keyBefore, keyAfter,
      keyBack: Number(back.rmsDb.toFixed(1)), status };
  });

  def('x-y-rest', async ({ page }) => {
    // K183 review N2: the touch's Y does not stay on the filter after its lift. The keys' C4
    // with no touch sets the reference: the 6-12 kHz band against C4 (LPF Cutoff from its knob,
    // EG 2 and MG). A touch at Y 0.9 opens the filter; after the lift the pad's Y output reads
    // 0, the readout says Y 0 %, and the keys' C4 has that band back at the reference.
    const BAND = [6000, 12000];
    const rel = (q) => bandDb(q, BAND[0], BAND[1]) - levelAt(q, C4);
    const padOut = (port) => page.evaluate((pt) => {
      const st = window.OSCILLA.studio;
      const pad = st.model.graph.nodes.find((n) => n.type === 'xy-pad');
      const h = pad && st.runtime && st.runtime.nodes.get(pad.id);
      return h && h.outputs && h.outputs[pt] ? h.outputs[pt].offset.value : null;
    }, port);
    const padY = () => padOut('y');
    const settled = async (what) => { // the band, once two successive polls agree to 1 dB
      let prev = null;
      let now = null;
      await until(async () => {
        now = rel(await read(page));
        const same = prev !== null && Math.abs(now - prev) < 1;
        prev = now;
        return same;
      }, { ms: SOUND_MS, what });
      return now;
    };
    await page.keyboard.down('KeyA');
    await sound(page, (q) => q.rmsDb > -45 && peakAt(q, C4), 'A sounds C4, no touch yet');
    const ref = await settled('the band with no touch settles');
    await page.keyboard.up('KeyA');
    await silent(page, 'A released');
    const hold = await press(page, await padPoint(page, 5, 0.9)); // C4 at Y 0.9
    let opened = null;
    await sound(page, (q) => q.rmsDb > -45 && peakAt(q, C4) && (opened = rel(q)) - ref >= 6,
      'a touch at Y 0.9 opens LPF Cutoff: the band 6 dB or more over the reference');
    await hold.lift();
    await silent(page, 'the lift silences');
    await until(async () => Math.abs(await padY()) < 1e-3, { ms: SOUND_MS,
      what: 'the pad\'s Y output is back at its rest, 0' });
    const text = await page.locator('[data-osc="synth.xy.readout"]').textContent();
    if (!/ Y 0 % → /.test(text)) {
      return { ok: false, detail: 'the readout does not say Y 0 % after the lift', text };
    }
    await page.keyboard.down('KeyA');
    await sound(page, (q) => q.rmsDb > -45 && peakAt(q, C4), 'A sounds C4 after the lift');
    let back = null;
    await until(async () => Math.abs((back = await settled('the band settles after the lift'))
      - ref) < 1.5, { ms: SOUND_MS, what: 'the keys\' filter is back at its knob value: the '
      + 'band within 1.5 dB of the no-touch reference' });
    await page.keyboard.up('KeyA');
    await silent(page, 'A released again');
    // Review of #428 NF3 (af's ruling): X rests too. X cabled into LPF Cutoff as Y is; a touch
    // on the last cell (X 0.955) at Y 0.05, then the lift: X's output reads 0 and the keys' C4
    // has the band at the reference again (X's cable adds nothing once the pad is let go).
    const cabled = await page.evaluate(() => {
      const st = window.OSCILLA.studio;
      const g = st.model.graph;
      const pad = g.nodes.find((n) => n.type === 'xy-pad');
      const ye = g.edges.find((e) => e.from.node === pad.id && e.from.port === 'y');
      return st.store.dispatch({ type: 'EDGE_ADD', id: 'x-rest-probe', from: { node: pad.id,
        port: 'x' }, to: { ...ye.to }, props: { ...ye.props } }).ok;
    });
    if (!cabled) return { ok: false, detail: 'X could not be cabled into LPF Cutoff' };
    await page.keyboard.down('KeyA');
    await sound(page, (q) => q.rmsDb > -45 && peakAt(q, C4), 'A sounds C4 with X cabled');
    const refX = await settled('the band with X cabled and no touch settles');
    await page.keyboard.up('KeyA');
    await silent(page, 'A released, X cabled');
    const xHold = await press(page, await padPoint(page, STEPS - 1, 0.05));
    await until(async () => (await padOut('x')) > 0.9, { ms: SOUND_MS,
      what: 'a touch on the last cell plays X at 0.955' });
    await xHold.lift();
    await silent(page, 'the lift silences, X cabled');
    await until(async () => Math.abs(await padOut('x')) < 1e-3, { ms: SOUND_MS,
      what: 'the pad\'s X output is back at its rest, 0 (X\'s cable into LPF Cutoff reads 0)' });
    await page.keyboard.down('KeyA');
    await sound(page, (q) => q.rmsDb > -45 && peakAt(q, C4), 'A sounds C4 after the X lift');
    let backX = null;
    await until(async () => Math.abs((backX = await settled('the band settles after the X lift'))
      - refX) < 1.5, { ms: SOUND_MS, what: 'X adds nothing to LPF Cutoff after its lift: the '
      + 'band within 1.5 dB of the reference with X cabled' });
    await page.keyboard.up('KeyA');
    await silent(page, 'A released after the X lift');
    return { ok: true, refDb: Number(ref.toFixed(1)), openedDb: Number(opened.toFixed(1)),
      backDb: Number(back.toFixed(1)), text, xRefDb: Number(refX.toFixed(1)),
      xBackDb: Number(backX.toFixed(1)) };
  });

  def('x-cold-touch', async ({ context, base, browserName }) => {
    // The page opens with no user activation: in chromium every read is a CDP evaluation with
    // userGesture false (Playwright's own waits and evaluations grant one).
    const chromium = browserName === 'chromium';
    const page = chromium ? await context.newPage() : await openXy(context, base);
    const cdp = chromium ? await context.newCDPSession(page) : null;
    const quiet = async (fn, arg) => {
      if (!cdp) return page.evaluate(fn, arg);
      const r = await cdp.send('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg)
        === undefined ? '' : JSON.stringify(arg)})`, returnByValue: true, userGesture: false });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value;
    };
    const look = () => quiet(() => {
      const e = window.OSCILLA && window.OSCILLA.engine;
      const s = document.querySelector('[data-xy-surface]');
      const first = document.querySelector('[data-xy-first]');
      return { active: !!(navigator.userActivation && navigator.userActivation.hasBeenActive),
        ctx: e && e.ctx ? e.ctx.state : null, pad: !!s,
        disabled: s ? s.getAttribute('aria-disabled') : null,
        button: !!document.querySelector('[data-xy-voice]'),
        first: first ? first.textContent : null, lines: window.__xyLines || null,
        rev: window.OSCILLA && window.OSCILLA.studio ? window.OSCILLA.studio.store.getRevision()
          : null };
    });
    if (chromium) {
      await page.goto(`${base}#m=synth&yt=xy`);
      await until(async () => (await look()).pad, { ms: LOAD_MS,
        what: 'the XY pad is mounted (read without a user activation)' });
    }
    // Every text the pad's line shows, with the context's state at that moment.
    await quiet(() => {
      window.__xyLines = [];
      const f = document.querySelector('[data-xy-first]');
      new MutationObserver(() => {
        const e = window.OSCILLA.engine;
        window.__xyLines.push([f.textContent, e.ctx ? e.ctx.state : null]);
      }).observe(f, { childList: true, characterData: true, subtree: true });
    });
    const entry = await look();
    if (entry.disabled !== 'false' || entry.button || entry.ctx === 'running'
      || (chromium && entry.active)) {
      return { ok: false, detail: 'the pad is not playable at once, or the page had audio or '
        + 'an activation before a touch', entry };
    }
    // A pad point, scrolled clear of the dock.
    const at = (i, fy) => quiet(([k, y, n]) => {
      const el = document.querySelector('[data-xy-surface]');
      el.scrollIntoView({ block: 'start' });
      let sc = el.parentElement;
      while (sc && sc !== document.body && !/(auto|scroll)/.test(getComputedStyle(sc)
        .overflowY)) sc = sc.parentElement;
      (sc && sc !== document.body ? sc : window).scrollBy(0, -80);
      const b = el.getBoundingClientRect();
      const q = { x: b.left + ((k + 0.5) / n) * b.width, y: b.top + (1 - y) * b.height };
      const hit = document.elementFromPoint(q.x, q.y);
      return { ...q, hit: !!hit && !!hit.closest('[data-xy-surface]') };
    }, [i, fy, STEPS]);
    const p = await at(3, 0.3);
    if (!p.hit) return { ok: false, detail: 'the pad point is covered', p };
    const heard = (pred, what) => until(async () => pred(await quiet(probe)),
      { ms: SOUND_MS, what });
    // The first touch, held: chromium by CDP touch, the others by the pointer (no CDP touch).
    const hold = await press(page, p, { touch: chromium });
    await until(async () => (await look()).ctx === 'running', { ms: SOUND_MS,
      what: 'the first touch\'s gesture starts the audio' });
    await heard((q) => q.rmsDb > -45, 'the note held through the unlock sounds');
    await hold.lift();
    await heard((q) => q.rmsDb < -70, 'its lift silences');
    let after = null;
    await until(async () => (after = await look()).first
      === 'Touch the pad to play. Nothing sounds until you do.', { ms: SOUND_MS,
      what: 'once audio runs the line says the pad plays' });
    // A suspended context at the touch said "Tap once to start audio" until it ran. Chromium's
    // headless shell starts the context running under the gesture rule too: no suspended
    // moment to state there, and none may be stated; webkit and firefox start it suspended.
    const coldSeen = after.lines.some(([t, st]) => t === 'Tap once to start audio.'
      && st !== 'running');
    const wrong = after.lines.some(([t, st]) => t === 'Tap once to start audio.'
      && st === 'running' && !coldSeen);
    if ((!chromium && !coldSeen) || wrong) {
      return { ok: false, detail: 'the cold first touch did not say Tap once to start audio '
        + 'while the context was suspended', lines: after.lines };
    }
    const again = await press(page, p, { touch: chromium });
    await loud(page, 'after the unlock a held touch sounds');
    await again.lift();
    const off = await silent(page, 'its release silences');
    if (after.rev !== entry.rev) {
      return { ok: false, detail: 'a touch edited the document', entry, after };
    }
    return { ok: true, coldSeen, lines: after.lines.slice(0, 4),
      off: Number(off.rmsDb.toFixed(1)) };
  });

  // ---- K171: the docked keyboard yields to the pad that owns the notes
  const HANDLE = '[data-osc="keyboard.handle"]';
  /** The dock and the pad as the first viewport shows them, read without scrolling. */
  const dockView = (page, IN = 8) => page.evaluate((IN) => {
    const dock = document.querySelector('[data-osc="keyboard"]');
    const handle = document.querySelector('[data-osc="keyboard.handle"]');
    const keys = document.querySelector('[data-osc="keyboard.keys"]');
    const s = document.querySelector('[data-xy-surface]');
    const shown = (el) => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom,
      left: b.left, right: b.right }; };
    const pad = s ? r(s) : null;
    // IN px inside the pad's rounded border, on each corner's diagonal (a corner's own hit test
    // follows its radius: 2 px in from the box's corner is outside an 8 px arc).
    const rad = s ? parseFloat(getComputedStyle(s).borderTopLeftRadius) || 0 : 0;
    const d = rad > IN ? rad - (rad - IN) / Math.SQRT2 : IN;
    const pts = pad ? [[pad.left + d, pad.top + d], [pad.right - d, pad.top + d],
      [pad.left + d, pad.bottom - d], [pad.right - d, pad.bottom - d],
      [(pad.left + pad.right) / 2, (pad.top + pad.bottom) / 2]] : [];
    const hits = pts.map(([x, y]) => {
      const e = document.elementFromPoint(x, y);
      return !!e && e.closest('[data-xy-surface]') === s;
    });
    return { vh: window.innerHeight, vw: window.innerWidth, pad, hits,
      state: dock.getAttribute('data-dock-state'), handle: shown(handle) ? r(handle) : null,
      expanded: handle ? handle.getAttribute('aria-expanded') : null,
      keys: shown(keys), folded: [...dock.children]
        .filter((c) => c.hidden && !c.hasAttribute('data-dock-keep')).length,
      held: window.OSCILLA.app.kbdHeld, disabled: s ? s.getAttribute('aria-disabled') : null,
      handleHit: shown(handle) ? (() => {
        const b = handle.getBoundingClientRect();
        const e = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
        return !!e && handle.contains(e);
      })() : false, dockTop: dock.getBoundingClientRect().top };
  }, IN);
  const inView = (v) => !!v.pad && v.pad.top >= 0 && v.pad.bottom <= v.vh && v.pad.left >= 0
    && v.pad.right <= v.vw && v.hits.length === 5 && v.hits.every(Boolean);
  // The keys are drawn wherever the dock is unfolded and hidden with it folded (routes.js
  // keysShown, the dock's one rule); unfolded, the pad stays whole above the dock (its height
  // follows the room).
  // whole: false where the test itself moved the focus (and so the page) since the last unfold.
  async function dockIs(page, want, what, { IN = 8, whole = true } = {}) {
    let v = null;
    try {
      await until(async () => {
        v = await dockView(page, IN);
        return v.state === want && v.expanded === String(want !== 'collapsed')
          && v.keys === (want === 'docked')
          && (!whole || (inView(v) && v.pad.bottom <= v.dockTop));
      }, { ms: SOUND_MS, what });
    } catch (e) {
      throw new Error(`${e.message}; last ${JSON.stringify(v)}`);
    }
    return v;
  }

  def('x-dock-yields', async ({ page, browserName }) => {
    const before = await dockView(page); // the Synth's Panel tab: no pad, the keys own the notes
    await page.tap('#osc-synth-tab-xy'); // the pad, playable at once (K183), owns the notes
    let v = null;
    await until(async () => {
      v = await dockView(page);
      return v.disabled === 'false' && v.state === 'collapsed' && inView(v) && !!v.handle;
    }, { ms: SOUND_MS, what: 'the playable pad is whole in the first viewport, the dock folded' });
    if (before.state !== 'docked' || !before.keys || v.expanded !== 'false' || v.keys
      || v.handle.top < v.pad.bottom || v.handle.bottom > v.vh) {
      return { ok: false, detail: 'the dock did not fold to a handle below the pad', before, v };
    }
    // The first tap on the pad sounds: the analyser is sampled every frame from before it.
    await page.evaluate(() => {
      const w = window;
      w.__k171Peak = -Infinity;
      const tick = () => {
        const e = w.OSCILLA.engine;
        if (e.ctx && e.analyser && e.ctx.state === 'running') {
          const d = new Float32Array(e.analyser.fftSize);
          e.analyser.getFloatTimeDomainData(d);
          let s = 0;
          for (const x of d) s += x * x;
          w.__k171Peak = Math.max(w.__k171Peak, 10 * Math.log10(s / d.length + 1e-24));
        }
        if (w.__k171Peak !== null) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const c = { x: (v.pad.left + v.pad.right) / 2, y: (v.pad.top + v.pad.bottom) / 2 };
    // A finger's tap: its start and its end are two input events, never one task (Playwright's
    // touchscreen.tap delivers both at once, a press no finger makes). Chromium taps by CDP
    // touch; webkit and firefox, without CDP touch, press with the pointer.
    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart',
        touchPoints: [{ x: c.x, y: c.y, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.up();
    }
    let peak = null;
    await until(async () => {
      peak = await page.evaluate(() => window.__k171Peak);
      return peak > -60; // a tap is a short note: well above the -70 dB silence line
    }, { ms: SOUND_MS, what: 'the first tap on the pad sounds (the engine analyser)' });
    await page.evaluate(() => { window.__k171Peak = null; });
    await silent(page, 'the tap ends silent');
    // While the pad owns the notes the computer keys still play: a held A sounds C4.
    await page.locator('#osc-synth-tab-xy').focus();
    const keyDb = await keyA(page, 'the pad owns the notes, the dock folded');
    // The handle unfolds and folds the keys: by tap, by Enter on it, by Alt+K.
    await page.tap(HANDLE);
    const tapped = await dockIs(page, 'docked', 'a tap on the handle unfolds the keys');
    await page.tap(HANDLE);
    await dockIs(page, 'collapsed', 'a second tap folds them');
    await page.locator(HANDLE).focus();
    await page.keyboard.press('Enter');
    await dockIs(page, 'docked', 'Enter on the focused handle unfolds the keys');
    await page.keyboard.press('Enter');
    await dockIs(page, 'collapsed', 'Enter again folds them');
    await page.locator('[data-xy-surface]').focus();
    await page.keyboard.press('Alt+KeyK');
    const keyed = await dockIs(page, 'docked', 'Alt+K (the key registry) unfolds the keys');
    // A computer key held while the dock is unfolded is released when it folds.
    await page.locator('#osc-synth-tab-xy').focus();
    await page.keyboard.down('KeyA');
    await until(async () => !!(await dockView(page)).held, { ms: SOUND_MS,
      what: 'the computer key A holds a note with the dock unfolded' });
    await page.keyboard.press('Alt+KeyK');
    const folded = await dockIs(page, 'collapsed', 'Alt+K folds the dock', { whole: false });
    await until(async () => !(await dockView(page)).held, { ms: SOUND_MS,
      what: 'folding the keys released the held note' });
    await page.keyboard.up('KeyA');
    return { ok: true, pad: v.pad, handle: v.handle, peak: Number(peak.toFixed(1)), keyDb,
      tapped: tapped.state, keyed: keyed.state, folded: folded.folded };
  });

  def('x-dock-handle-hold', async ({ page, browserName }) => {
    // Review of #425, R8: a finger holds the pad and sounds; a second finger taps the dock's
    // handle. The tap takes no focus, so the pad keeps its focus and the held note keeps
    // sounding (the pad's focusout would end the gate); the lift silences.
    // What each engine proves:
    // - chromium generates no click and no mousedown for a tap while another finger is down
    //   (chromium's event list measured by CDP on 2026-11-05: the handle sees pointerdown,
    //   touchstart, pointerup and touchend only): the dock stays folded, and there the check
    //   proves that and that the note was never at risk;
    // - webkit makes the second finger's tap a click (and a mousedown), inferred from the
    //   check's results (it failed on f31d8906, before R8: the focus moved and aria-pressed
    //   went false; it passes on 067df74e): the keys unfold, and the check proves the handle's
    //   prevented mousedown keeps the focus and the gate;
    // - firefox skips it (Playwright holds no touch there; SKIP_OF says why).
    let v = null;
    await until(async () => {
      v = await dockView(page);
      return v.disabled === 'false' && v.state === 'collapsed' && inView(v) && !!v.handle;
    }, { ms: SOUND_MS, what: 'the playable pad is whole in the first viewport, the dock folded' });
    const c = { x: (v.pad.left + v.pad.right) / 2, y: (v.pad.top + v.pad.bottom) / 2 };
    // Two fingers: chromium holds the pad by CDP touch, webkit by a touch pointer dispatched on
    // the pad (Playwright holds no touch there); the second finger is a real tap on the handle.
    const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
    const hold = cdp ? null : await press(page, c, { touch: 'dispatch' });
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart',
        touchPoints: [{ x: c.x, y: c.y, id: 1 }] });
    }
    await loud(page, 'a finger held on the pad sounds');
    const focusOf = () => page.evaluate(() => {
      const s = document.querySelector('[data-xy-surface]');
      return { pressed: s.getAttribute('aria-pressed'),
        inPad: !!s.closest('[role="group"]') && s.closest('[role="group"]')
          .contains(document.activeElement) };
    });
    const before = await focusOf();
    const h = await page.locator(HANDLE).boundingBox();
    const t = { x: h.x + h.width / 2, y: h.y + h.height / 2, id: 2 };
    if (cdp) { // the second finger down and up while the first stays
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart',
        touchPoints: [{ x: c.x, y: c.y, id: 1 }, t] });
      // touchEnd names the finger that lifts: the second, while the first stays on the pad.
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [t] });
    } else {
      await page.touchscreen.tap(t.x, t.y);
    }
    // WebKit makes the second finger's tap a click: it unfolds the keys. Chromium makes no
    // click of a tap while another finger is down (nor a mousedown): the dock stays folded.
    const want = browserName === 'chromium' ? 'collapsed' : 'docked';
    const open = await dockIs(page, want, `the second finger's tap leaves the dock ${want}`,
      { whole: false });
    const after = await focusOf();
    const held = await loud(page, 'the pad\'s note sounds on after the tap on the handle');
    if (before.pressed !== 'true' || after.pressed !== 'true' || !after.inPad) {
      return { ok: false, detail: 'the tap on the handle took the focus or ended the gate',
        before, after };
    }
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await hold.lift();
    const off = await silent(page, 'the lift silences');
    return { ok: true, before, after, state: open.state, held: Number(held.rmsDb.toFixed(1)),
      off: Number(off.rmsDb.toFixed(1)) };
  });

  def('x-dock-desktop', async ({ page, sizeName }) => {
    // The pad, playable as the tab opens (K183), owns the notes: the dock folds at this size too.
    let v = null;
    try {
      await until(async () => {
        v = await dockView(page, 2);
        return v.disabled === 'false' && v.state === 'collapsed' && inView(v) && !!v.handle;
      }, { ms: SOUND_MS, what: `the playable pad is whole at ${sizeName}, the dock folded` });
    } catch (e) {
      return { ok: false, detail: e.message, v };
    }
    const ok = v.expanded === 'false' && !v.keys && v.folded > 0 && v.handleHit
      && v.handle.top >= v.pad.bottom && v.handle.bottom <= v.vh;
    if (!ok) {
      return { ok, detail: 'the dock covers the pad or hides its handle', vw: v.vw, vh: v.vh,
        pad: v.pad, handle: v.handle, hits: v.hits, keys: v.keys };
    }
    // Unfolded by the user (Alt+K, the key registry): the keys show and the pad stays whole
    // above the dock; Alt+K folds it again. A note the pad holds meanwhile keeps sounding: the
    // fold releases only the keys' own notes, never the pad's.
    await page.locator('[data-xy-surface]').focus();
    await page.keyboard.press('Alt+KeyK');
    const open = await dockIs(page, 'docked',
      `Alt+K unfolds the dock at ${sizeName}, the pad whole`, { IN: 2 });
    await page.keyboard.press('Alt+KeyK');
    // A fold by the user moves nothing: the pad is where the unfold put it.
    const folded = await dockIs(page, 'collapsed', `Alt+K folds it at ${sizeName}`, { IN: 2 });
    const p = { x: (folded.pad.left + folded.pad.right) / 2,
      y: (folded.pad.top + folded.pad.bottom) / 2 };
    const hold = await press(page, p);
    await loud(page, 'a pointer held on the pad sounds');
    await page.keyboard.press('Alt+KeyK');
    await dockIs(page, 'docked', `Alt+K unfolds the dock while the pad sounds`,
      { IN: 2, whole: false });
    await page.keyboard.press('Alt+KeyK');
    await dockIs(page, 'collapsed', 'Alt+K folds it while the pad sounds', { IN: 2,
      whole: false });
    const held = await loud(page, 'the fold left the pad\'s note sounding');
    await hold.lift();
    const off = await silent(page, 'the lift silences');
    return { ok, vw: v.vw, vh: v.vh, pad: v.pad, handle: v.handle, open: { pad: open.pad,
      dockTop: open.dockTop }, held: Number(held.rmsDb.toFixed(1)),
      off: Number(off.rmsDb.toFixed(1)) };
  });
  def('x-view', async ({ page }) => {
    const p = await padPoint(page, 6, 0.4);
    const at = { x: p.x + 7, y: p.y - 11 }; // off the cell's centre: the ring is the touch's
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    const held = await viewHeld(page, at, 'a held pointer');
    if (!held.ok) return { ok: false, detail: 'the touch point is not drawn as sent', ...held };
    const lo = await cutoffAt(page, 0);
    const hi = await cutoffAt(page, 1);
    const ends = held.v.ends.map(hzOf);
    if (!near(ends[0], lo.hz) || !near(ends[1], hi.hz)) {
      return { ok: false, detail: 'the Y ends do not read the cutoff at Y 0 and 1', ends,
        want: [lo.hz, hi.hz] };
    }
    if (!(held.v.readoutBottom <= held.v.surfaceTop + 0.5)) {
      return { ok: false, detail: 'the readout line is not above the pad', v: held.v };
    }
    const q = await pointIn(page, 2, 0.8);
    await page.mouse.move(q.x, q.y, { steps: 8 });
    let moved = null;
    await until(async () => (moved = await viewState(page)).trail >= 2,
      { ms: SOUND_MS, what: 'moving draws a trail' });
    const after = await viewHeld(page, q, 'moved');
    if (!after.ok) return { ok: false, detail: 'the moved point is not drawn as sent', ...after };
    await page.mouse.up();
    let off = null;
    await until(async () => {
      off = await viewState(page);
      return off.trail === 0 && off.lit === 'false' && !off.shown;
    }, { ms: SOUND_MS, what: 'the release clears the trail, hides the ring and unlights the '
      + 'gate LED' });
    return { ok: true, note: held.v.note, value: held.v.value, ringOff: held.off,
      ends: held.v.ends, trail: moved.trail, moved: [after.v.note, after.v.value],
      released: { trail: off.trail, lit: off.lit, shown: off.shown } };
  });

  def('x-view-phone', async ({ page, browserName }) => {
    const a = await padPoint(page, 3, 0.3);
    const b = await pointIn(page, 8, 0.7);
    const idleTop = (await viewState(page)).surfaceTop;
    let move;
    let lift;
    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type,
        touchPoints: pts.map((t) => ({ x: t.x, y: t.y, id: 1 })) });
      await touch('touchStart', [a]);
      move = async (t) => touch('touchMove', [t]);
      lift = async () => touch('touchEnd', []);
    } else {
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      move = (t) => page.mouse.move(t.x, t.y);
      lift = () => page.mouse.up();
    }
    const held = await viewHeld(page, a, 'a touch');
    if (!held.ok) return { ok: false, detail: 'the touch point is not drawn as sent', ...held };
    if (Math.abs(held.v.surfaceTop - idleTop) > 0.5) {
      return { ok: false, detail: 'the pad moved under the finger', idleTop, held: held.v };
    }
    for (let i = 1; i <= 6; i++) {
      await move({ x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6 });
    }
    let moved = null;
    await until(async () => (moved = await viewState(page)).trail >= 2,
      { ms: SOUND_MS, what: 'a moving touch draws a trail' });
    const after = await viewHeld(page, b, 'a moved touch');
    if (!after.ok) return { ok: false, detail: 'the moved touch is not drawn as sent', ...after };
    await lift();
    let off = null;
    await until(async () => {
      off = await viewState(page);
      return off.trail === 0 && off.lit === 'false' && !off.shown;
    }, { ms: SOUND_MS, what: 'lifting clears the trail, hides the ring and unlights the LED' });
    return { ok: true, note: held.v.note, value: held.v.value, ringOff: held.off,
      trail: moved.trail, moved: [after.v.note, after.v.value] };
  });

  def('x-view-reduced', async ({ page }) => {
    const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)')
      .matches);
    if (!reduced) return { ok: false, detail: 'the context does not prefer reduced motion' };
    const a = await padPoint(page, 2, 0.2);
    const b = await pointIn(page, 8, 0.8);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    const held = await viewHeld(page, a, 'reduced motion: a held pointer');
    if (!held.ok) return { ok: false, detail: 'the touch point is not drawn as sent', ...held };
    let most = 0;
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
      most = Math.max(most, (await viewState(page)).trail);
    }
    const after = await viewHeld(page, b, 'reduced motion: the last point');
    most = Math.max(most, after.v.trail);
    await page.mouse.up();
    return { ok: after.ok && most === 0, trailMost: most, last: [after.v.note, after.v.value],
      ringOff: after.off };
  });
  return checks;
}

// ------------------------------------------------------------------------------ runner
const runsAt = (name, sizeName) => (!ONLY || ONLY.has(name))
  && (LEGS_OF[name] || [LEG_OF[name] || 'desktop']).includes(sizeName);
/** Why `name` cannot run on this engine and leg, or null (SKIP_OF). */
const skipOf = (name, sizeName, browserName) => ((SKIP_OF[`${name}/${sizeName}`]
  || SKIP_OF[name]) || {})[browserName] || null;

async function runLeg(browserName, sizeName, base, leg) {
  const cold = GESTURE_LEGS.has(sizeName); // the gesture rule on, mobile where it exists
  const results = {};
  const todo = defineChecks().filter(({ name }) => runsAt(name, sizeName));
  // K148: a skip is recorded under this leg's own key and never counted as a check.
  for (const { name } of todo) {
    const why = skipOf(name, sizeName, browserName);
    if (why) {
      RUN.skip(leg, name, why);
      results[name] = { skipped: true, reason: why };
    }
  }
  const run = todo.filter(({ name }) => !results[name]);
  if (!run.length) return results; // nothing to run: no engine is launched for this leg
  const browser = await playwright[browserName].launch((cold ? GESTURE_LAUNCH
    : LAUNCH)[browserName]);
  try {
    for (const { name, fn } of run) {
      const context = await browser.newContext({ viewport: SIZES[sizeName],
        hasTouch: sizeName.startsWith('phone'), ...(CONTEXT_OF[name] || {}),
        // Firefox has no mobile emulation (Playwright refuses isMobile there).
        ...(cold && browserName !== 'firefox' ? { isMobile: true } : {}) });
      const errors = [];
      context.on('page', (pg) => pg.on('pageerror', (e) => errors.push(String(e))));
      const t0 = Date.now();
      try {
        // x-cold-touch opens its own page: no wait of the harness may grant an activation.
        const page = SELF_OPEN.has(name) ? null
          : await openXy(context, base, { preset: PRESET_OF[name] || null,
            tab: TAB_OF[name] || 'xy' });
        const v = await bounded(fn({ page, context, base, browserName, sizeName }),
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
          const res = await runLeg(b, size, base, key);
          const names = Object.keys(res);
          const ran = names.filter((n) => !res[n].skipped);
          const skipped = names.length - ran.length;
          if (!ran.length) { // every check of this leg skipped: no PASS line, nothing counted
            console.log(`SKIP ${key}/xy-pad: every check skipped (${names.join(', ')})`);
            continue;
          }
          RUN.reportLeg({ leg: key, checks: ran.length });
          const bad = ran.filter((n) => !res[n].ok);
          failed += bad.length;
          console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/xy-pad: ${ran.length
            - bad.length}/${ran.length} checks${skipped ? `, ${skipped} skipped` : ''} (${(
            (Date.now() - t0) / 1000).toFixed(1)} s)`);
          for (const n of names) {
            const r = res[n];
            console.log(`   ${r.skipped ? 'skip' : r.ok ? 'ok' : 'x '} ${n}: `
              + `${JSON.stringify(r).slice(0, 700)}`);
          }
        }
      }
    }
  } finally {
    if (server) server.close();
  }
  process.exit(failed ? 1 : 0);
})();

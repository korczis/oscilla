#!/usr/bin/env node
// OSCILLA Synth workspace (plan K058-K066, K103 part, K104, K106 part) on the built
// dist/index.html in chromium, firefox and webkit, at 1536 x 1024 and 390 x 844. Every check
// asserts the sound, read from the engine's analyser after the safety chain (RMS, spectrum
// peaks at the expected frequencies) or the engine and runtime node census, never the DOM alone.
//
//   node tests/browser/synth.cjs [--browsers chromium,firefox,webkit] [--origins file,http]
//        [--only s-sound,s-filter]
//
// Checks (desktop leg; the phone leg runs s-sound, s-cable and s-mobile):
//   s-sound    no cable: QWERTY A plays C4, VCO 1 at 16' and VCO 2 at 8' (peaks at 130.8 and
//              261.6 Hz within one bin, RMS above -40 dB rel); key up: below -70 dB rel
//   s-filter   LPF cutoff to its minimum by keyboard (Home): the energy above 2 kHz falls 12 dB+
//   s-feel     the knob and choice feel (p2's W1b review): during a drag the ARIA position is the
//              0..1000 travel; Shift mid-drag moves nothing; a double-click restores the initial
//              value; the wheel turns the knob under the pointer, a burst one undo entry;
//              arrows, Home and End move a choice (a rotary: its radios are in option order)
//              and focus stays on the checked option; a
//              double-click on a disabled knob changes nothing, and a cancelled pointer on a
//              jack is neither a tap nor a drop, the jack taking its touches (21's S13, S9)
//   s-wave     Square on VCO 1 (VCO 2 muted): the 2nd harmonic 30 dB+ below the 3rd; Pulse with a
//              typed width of 25 %: the 4th harmonic 30 dB+ below the 3rd
//   s-rest     armed with no key held (Arm, no note), a cable from EG 1 into the VCA: below
//              -70 dB rel over 0.5 s of audio time (no drone; the transport closes the
//              Keys-gated envelopes at arm, and an EG cable rests at 0)
//   s-armstall the first Arm with the page's main thread stalled inside the apply (every
//              AudioNode.connect busy-waits 20 ms, as a loaded host did): from the click until
//              0.5 s of audio time after armed, the analyser never reads above -70 dB rel (the
//              Keys-gated envelopes are built closed; review of #332, V4). On b3f7d006 it fails
//              in chromium (-42.6 dB rel); firefox and webkit did not reproduce the defect even
//              at 100 ms per connect, so there it guards the fix and proves nothing more
//   s-track    Keys pitch re-patched into VCO 1 pitch (VCO 2 muted): C4 then C5 peak at 130.8
//              and 261.6 Hz, 1.00 oct per octave
//   s-restpitch EG 1 patched into VCO 1 pitch (it replaces the Keys normal) with EG 1 sustain 0
//              (VCO 2 muted): once EG 1 has decayed, VCO 1 rests at its base, A at 16' (220 Hz),
//              not an octave low
//   s-cable    Keys velocity patched into VCO 2 pitch by two jack taps breaks its normal: across
//              C4 and E4 the VCO 2 peak stays put (VCO 1 muted); removing the cable restores
//              tracking; the Studio model holds the same cable
//   s-refuse   LPF out into Mixer in 1 (a loop) is refused with the feedback sentence; the model
//              and the engine census are unchanged
//   s-ring     VCO 1 and VCO 2 as sines at 261.6 and 327.0 Hz into the ring modulator alone:
//              peaks at the difference and the sum, the carrier 20 dB+ below them
//   s-midi     through tests/browser/lib/midi-stub.cjs: Note On 60 sounds, Note Off silences
//   s-link     #m=synth&yp=bass&yv=lpf.frequency:300 sets the knob and sounds; a malformed link is
//              refused and its keys leave the address
//   s-relink   MG patched into LPF cutoff (the jacks of a normal) is a cable: listed, in the
//              link the Copy link button writes; the link reopens the cable at the same depth
//              and the MG sweeps the cutoff on both pages (the 1-3 kHz band swings 10 dB+)
//   s-studio   Open in Studio: #m=studio, the panel's nodes selected, the same revision
//   s-escape   Escape releases a held note; leaving the workspace disarms: runtime census 0
//   s-wheelcable a cable patched inside an open wheel burst is its own undo entry (21's P3)
//   s-knobesc  a pressed knob takes the focus (ERG-04); Escape mid-drag (ERG-03) and a
//              pointercancel mid-drag (21's R7) restore the value the press found, add no undo
//              entry and leave the keys armed
//   s-touchpatch (phone) a touch from a jack is cancelled in every engine, a tap still picks a
//              jack up, and a chromium touch drag patches a cable without scrolling (ERG-01)
//   s-armstop  the Arm button follows the transport (review S1): Arm, then a transport Stop
//              made outside the Synth while it is shown (page hide; before any Studio visit):
//              the button reads Arm and Arm arms; Arm, the Studio and its Stop, back to the
//              Synth: it reads Arm, Arm arms and a key sounds. Fails on 9cf786ac (Disarm stays)
//   s-xyengine an XY preset writes only the voice it plays (review S6): drawbar 1 of the
//              additive engine set by Home, then XY bass from the Preset menu (one undo entry,
//              the pad in D Dorian): the drawbar keeps its value in the model and on its face.
//              Fails on 9cf786ac (the drawbar is back at 1.00)
//   s-preset   each preset, chosen in the Preset menu, is one undo entry, sets its knobs on
//              the face and changes the sound by its own mark: Bass (LPF 180 Hz: the 1-4 kHz
//              band 12 dB+ further below the fundamental than Init), Lead (VCO 1 at 8': no
//              130.8 Hz, a fifth at 392 Hz), Sweep (the MG sweeps the LPF: the 1-3 kHz band
//              swings 8 dB+) and Ring bell (ring products of 523.3 and 327.0 Hz at 196.2 and
//              850.3 Hz)
//   s-look     the rendered panel: no legacy svg stroke on a jack or a plate, every jack ring and
//              cable colour 3:1+ and every plate label 4.5:1+ on its background in the dark and
//              light themes (read from the layer's [data-ring] and [data-stroke] hooks), a nut
//              under every jack, a plug on each cable end and two screws on every plate (F013
//              W1), a focused jack shows its focus ring, a card folds (aria-expanded)
//   s-choices  (desktop at 1536, 1280 and 640; phone at 320, 375 and 390) on every tab, each
//              choice's option boxes and legends lie inside its plate's padding box, 44 px+ of
//              every option box can be pressed, and a press on a legend's centre lands on its
//              own option's radio, the one its text names
//   s-choicekeys every slide and lever (11 on the tabs), from its bottom option: ArrowUp moves
//              the checked radio's box up (a smaller y), ArrowDown moves it down, Home checks
//              the top radio and End the bottom one, focus on the checked radio, in the drawn
//              order its radios run in (review of W1c, finding 1). It needs choiceKey
//              (src/js/synth/gestures.js) to read the host svg's data-style: on toggle and
//              slide, ArrowUp +1 option, ArrowDown -1, Home and End the first and last radio
//   s-connect  Enter on a jack opens the connection list (targets, refused ones with reasons);
//              choosing a target patches; the jack names say which can take the cable
//   s-scope    K152: a drag across the LPF plate's scope sets its cutoff on the drawing's log
//              axis (left 20 Hz, right 20 kHz) as one undo step, the curve and the knob's value
//              follow, and its label says what it draws
//   s-dock     K066, beside the piano: the instrument picker is a menu button whose role=menu
//              lists every notes node (8, the XY pad too) and New Synth voice; arrows and
//              Enter route the keys to the FM engine in one undo entry (a note then takes an FM voice) and undo
//              routes them back; the waveform radiogroup by arrow keys turns VCO 1's saw into a
//              square (its 2nd harmonic 30 dB+ below the 3rd); a quick preset by pointer (tap
//              on the phone) is one entry and the Studio Inspector shows the same LPF cutoff at
//              the same revision. Reload keeps nothing (the Synth stores nothing; the copied
//              link, s-link, reopens a preset)
//   s-nodepreset K020: in the Studio Inspector of the panel's LPF, the Presets menu button opens
//              a role=menu; arrows and Enter choose Dark low-pass: one undo entry, the cutoff
//              field reads 400, every edge kept, and the darker filter is heard (the 1-4 kHz
//              band 4 dB+ further below the fundamental; EG 2 still opens it by its amount)
//   s-library  K102, the one patch library, inside the dialog osc-dlg-studio-library (desktop
//              and phone): the Synth's Library button (a tap
//              on the phone) opens the dialog; the instrument filter keeps the FM engine's two
//              patches in a role=listbox; arrows reach FM keys and Insert adds it in one undo
//              entry, the keys play it at once (a note takes a voice of the new node); in the
//              Studio the node is in the graph and the same library, opened from the
//              Inspector's Presets menu (on the phone, whose Studio folds the Inspector away,
//              through the same opener), lists FM keys as in use
//   s-libxy    K102 with K097: the library's tag filter 'xy' lists the XY pad's four built-in
//              presets; Enter on the first applies it in one undo entry and the pad takes its
//              scale; a name and Save the XY pad as a preset save it, listed under 'xy' at once
//   s-riffs    K149 with K102: the library's Riffs category lists the original riffs, each said
//              as "Original, in the style of <genre> (<era>)", Insert its only way in; Listen
//              is heard (RMS above -40 dB rel), Stop falls below -70 dB rel and neither adds an
//              undo entry (an ephemeral audition, Q032); Enter
//              inserts the first in one undo entry: an event track of its name with its clips
//              on an Oscillator that reaches the Master Output
//   s-mobile   390 x 844 with touch: no horizontal page scroll, every knob and jack box 44 px+,
//              with six cables patched every jack and cable end scrolls clear of the dock,
//              the Patch bay chip shows the bay at the card's width with the cards hidden, its
//              text 12 px+ and no two jack labels overlapping (V636), a section chip brings the
//              cards back and lands its plate's heading below the sticky chip bar, the docked
//              keys are visible and a tap on them sounds
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { serveDist } = require('./lib/serve.cjs');
const { until, bounded, WaitTimeout } = require('./lib/wait.cjs');
const midiStub = require('./lib/midi-stub.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist', 'index.html');
const RUN = suite.open({ name: 'synth', browsers: arg('browsers'), origins: arg('origins'),
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
const PHONE_CHECKS = new Set(['s-sound', 's-cable', 's-mobile', 's-look', 's-dock',
  's-library', 's-choices', 's-touchpatch']);
const LOAD_MS = 60000;
const SOUND_MS = 8000; // a note's attack, a knob change's glide and the analyser's smoothing
const CHECK_MS = 120000;
const C4 = 261.6256;
const ARM_STALL_MS = 20; // per connect(): measured to reproduce V4 on b3f7d006 in chromium

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
  return { sr: e.ctx.sampleRate, n: a.fftSize, db: Array.from(f), t: e.ctx.currentTime,
    rmsDb: 10 * Math.log10(s / t.length + 1e-24) };
}
const binOf = (p, hz) => Math.round((hz * p.n) / p.sr);
/** The level at hz: the highest bin within one bin of it. */
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
const counts = (page) => page.evaluate(() => window.OSCILLA.studio.counts());
const dbg = (page) => page.evaluate(() => window.OSCILLA.app.synthDebug());
/** Poll the analyser until `pred(probe)` holds, within `ms`; returns the probe that held. */
async function sound(page, pred, what, ms = SOUND_MS) {
  let last = null;
  await until(async () => {
    last = await read(page);
    return pred(last);
  }, { ms, what });
  return last;
}

async function openSynth(context, base, hash = '#m=synth') {
  const page = await context.newPage();
  await page.goto(`${base}${hash}`);
  await until(() => page.evaluate(() => !!(window.OSCILLA && window.OSCILLA.app
    && window.OSCILLA.app.synthDebug && window.OSCILLA.app.synthDebug().present
    && !document.getElementById('osc-view-synth').hidden
    && document.querySelector('[data-osc="synth.bay.svg"]'))),
  { ms: LOAD_MS, what: 'the Synth view is shown and its panel rendered' });
  await page.locator('#osc-synth-title').click();
  return page;
}
const knob = (page, cid) => page.locator(`[data-knob="${cid}"]`);
/** Below xl the Synth shows one face, the cards or the bay: press its chip when it is not shown
 *  (at xl the Panel chip is hidden and both faces show, so this does nothing). */
async function face(page, f) {
  const chip = page.locator(`[data-face="${f}"]`);
  if (await chip.isVisible() && await chip.getAttribute('aria-pressed') !== 'true') {
    await chip.click();
  }
}
async function keyKnob(page, cid, key) {
  await face(page, 'panel');
  await knob(page, cid).focus();
  await page.keyboard.press(key);
}
async function typeKnob(page, cid, text) {
  await face(page, 'panel');
  await knob(page, cid).focus();
  await page.keyboard.press('Enter');
  const input = page.locator('[data-osc="synth.panel"] input[type="text"]');
  await input.fill(text);
  await input.press('Enter');
}
const option = (page, cid, v) => page.locator(`[data-option="${cid}"][data-v="${v}"]`).click();
async function tapJack(page, id) {
  await face(page, 'bay');
  await page.locator(`[data-jack="${id}"]`).focus();
  await page.keyboard.press('Enter');
}
async function hold(page, code) {
  await page.locator('#osc-synth-title').click();
  await page.keyboard.down(code);
}
const silent = (page, what) => sound(page, (p) => p.rmsDb < -70, what);

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });

  def('s-sound', async ({ page }) => {
    await hold(page, 'KeyA');
    const p = await sound(page, (q) => q.rmsDb > -40 && peakAt(q, C4 / 2) && peakAt(q, C4),
      'C4 sounds at 130.8 and 261.6 Hz');
    await page.keyboard.up('KeyA');
    const q = await silent(page, 'the note releases below -70 dB rel');
    return { ok: true, rmsDb: p.rmsDb, off: q.rmsDb, at: [levelAt(p, C4 / 2), levelAt(p, C4)] };
  });

  /** RMS stays below `db` while the audio clock runs `span` s; the loudest probe is returned. */
  async function quiet(page, db, span, what) {
    const t0 = await page.evaluate(() => window.OSCILLA.engine.ctx.currentTime);
    let worst = -Infinity;
    await until(async () => {
      const p = await read(page);
      worst = Math.max(worst, p.rmsDb);
      if (worst >= db) throw new Error(`${what}: ${worst.toFixed(1)} dB rel`);
      return (await page.evaluate(() => window.OSCILLA.engine.ctx.currentTime)) - t0 >= span;
    }, { ms: SOUND_MS, what });
    return worst;
  }

  def('s-rest', async ({ page }) => {
    await page.locator('[data-osc="synth.arm"]').click();
    await until(() => page.evaluate(() => window.OSCILLA.app.synthDebug().armed),
      { ms: 10000, what: 'Arm arms the panel' });
    const before = await quiet(page, -70, 0.5, 'armed with no key held is silent');
    await tapJack(page, 'eg1.control:out');
    await tapJack(page, 'vca.gain:in');
    const d = await dbg(page);
    if (!d.cables.some((c) => c.from === 'eg1.control' && c.to === 'vca.gain')) {
      return { ok: false, detail: 'EG 1 into the VCA is not patched', cables: d.cables };
    }
    const after = await quiet(page, -70, 0.5, 'an EG cable into the VCA rests at 0');
    return { ok: true, before, after };
  });

  def('s-armstall', async ({ page }) => {
    // The stimulus: the main thread blocks in every connect() of the arm's apply, so the audio
    // clock passes the envelopes' build time before the transport owns them. A page interval
    // keeps the loudest analyser window (fftSize samples back) from before the click on.
    await page.evaluate((ms) => {
      const connect = AudioNode.prototype.connect;
      const s = { on: true, peak: -Infinity, timer: null };
      window.__oscArmStall = s;
      AudioNode.prototype.connect = function stalledConnect(...a) {
        const end = performance.now() + (s.on ? ms : 0);
        while (performance.now() < end) { /* the stall is the stimulus */ }
        return connect.apply(this, a);
      };
      s.restore = () => {
        AudioNode.prototype.connect = connect;
        s.on = false;
      };
      s.timer = setInterval(() => {
        const e = window.OSCILLA.engine;
        const an = e && e.analyser;
        if (!an) return;
        const t = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(t);
        let sum = 0;
        for (const x of t) sum += x * x;
        s.peak = Math.max(s.peak, 10 * Math.log10(sum / t.length + 1e-24));
      }, 4);
    }, ARM_STALL_MS);
    await page.locator('[data-osc="synth.arm"]').click();
    await until(() => page.evaluate(() => window.OSCILLA.app.synthDebug().armed),
      { ms: 30000, what: 'Arm arms the panel through the stalled apply' });
    const t0 = await page.evaluate(() => {
      window.__oscArmStall.restore();
      return window.OSCILLA.engine.ctx.currentTime;
    });
    let peak = -Infinity;
    await until(async () => {
      const v = await page.evaluate(() => ({ peak: window.__oscArmStall.peak,
        t: window.OSCILLA.engine.ctx.currentTime }));
      peak = v.peak;
      if (peak >= -70) throw new Error(`a stalled first Arm sounds: ${peak.toFixed(1)} dB rel`);
      return v.t - t0 >= 0.5;
    }, { ms: SOUND_MS, what: 'a stalled first Arm is silent over 0.5 s of audio time' });
    await page.evaluate(() => clearInterval(window.__oscArmStall.timer));
    return { ok: true, peak, stallMs: ARM_STALL_MS };
  });

  def('s-track', async ({ page }) => {
    await keyKnob(page, 'mix.level2', 'Home');
    await tapJack(page, 'keys.pitch:out');
    await tapJack(page, 'vco1.pitch:in');
    const d = await dbg(page);
    if (!d.cables.some((c) => c.from === 'keys.pitch' && c.to === 'vco1.pitch')) {
      return { ok: false, detail: 'Keys pitch into VCO 1 pitch is not a cable', cables: d.cables };
    }
    const at = [];
    for (const [code, hz] of [['KeyA', C4 / 2], ['KeyK', C4]]) {
      await hold(page, code);
      const p = await sound(page, (q) => q.rmsDb > -45 && peakAt(q, hz),
        `VCO 1 at ${hz.toFixed(1)} Hz (1.00 oct per octave)`);
      at.push(levelAt(p, hz));
      await page.keyboard.up(code);
      await silent(page, 'the note releases');
    }
    return { ok: true, at };
  });

  def('s-restpitch', async ({ page }) => {
    await keyKnob(page, 'mix.level2', 'Home');
    await keyKnob(page, 'eg1.sustain', 'Home');
    await typeKnob(page, 'eg1.decay', '0.05');
    await tapJack(page, 'eg1.control:out');
    await tapJack(page, 'vco1.pitch:in');
    const d = await dbg(page);
    if (!d.cables.some((c) => c.from === 'eg1.control' && c.to === 'vco1.pitch')) {
      return { ok: false, detail: 'EG 1 into VCO 1 pitch is not a cable', cables: d.cables };
    }
    await hold(page, 'KeyA');
    // The cable replaces the Keys pitch normal, so VCO 1 plays its base: A4 at 16', 220 Hz.
    const p = await sound(page, (q) => q.rmsDb > -45 && peakAt(q, 220)
      && levelAt(q, 110) < levelAt(q, 220) - 20,
    "EG 1 at rest leaves VCO 1 at its base, 220 Hz at 16', not an octave low");
    await page.keyboard.up('KeyA');
    return { ok: true, rest: levelAt(p, 220), low: levelAt(p, 110) };
  });

  def('s-filter', async ({ page }) => {
    await hold(page, 'KeyA');
    const open = await sound(page, (q) => q.rmsDb > -40, 'C4 sounds with the LPF at 1.2 kHz');
    const before = bandDb(open, 2000, 12000);
    await keyKnob(page, 'lpf.frequency', 'Home');
    const shut = await sound(page, (q) => bandDb(q, 2000, 12000) <= before - 12,
      'the energy above 2 kHz falls 12 dB with the cutoff at its minimum');
    await page.keyboard.up('KeyA');
    return { ok: true, before, after: bandDb(shut, 2000, 12000) };
  });

  def('s-feel', async ({ page }) => {
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    const knob = page.locator('[data-knob="lpf.frequency"]');
    await knob.scrollIntoViewIfNeeded();
    const pos = () => knob.evaluate((el) => ({ now: Number(el.getAttribute('aria-valuenow')),
      max: el.getAttribute('aria-valuemax'),
      text: document.querySelector('[data-value="lpf.frequency"]').textContent }));
    const start = await pos();
    const b = await knob.boundingBox();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    // A drag: the ARIA position stays the 0..1000 travel while it moves (N003).
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 40, { steps: 4 });
    const mid = await pos();
    // Shift mid-drag re-anchors: one more pixel moves the position by no more than a coarse step.
    await page.keyboard.down('Shift');
    await page.mouse.move(cx, cy + 41);
    const fine = await pos();
    await page.keyboard.up('Shift');
    await page.mouse.up();
    // A double-click restores the initial value: the first click leaves the knob in place.
    await page.mouse.move(cx, cy);
    await knob.dblclick();
    await until(async () => (await pos()).text === start.text, { ms: 5000,
      what: 'a double-click restores the initial value' });
    // The wheel turns the knob under the pointer; a burst is one undo entry.
    const before = await depth();
    const w0 = (await pos()).now;
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, -100);
    await until(async () => (await pos()).now > w0, { ms: 5000, what: 'the wheel turns it' });
    await until(async () => (await depth()) === before + 1, { ms: 5000,
      what: 'a wheel burst is one undo entry' });
    // 21's R3: a drag right after a wheel notch is its own undo entry (the burst is flushed),
    // and R8: a pinch (Ctrl+wheel) is the page's and leaves the knob alone.
    const d0 = await depth();
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -100);
    await until(async () => (await pos()).now !== w0 || true, { ms: 1000,
      what: 'the notch lands' });
    await page.mouse.down();
    await page.mouse.move(cx, cy + 30, { steps: 3 });
    await page.mouse.up();
    await until(async () => (await depth()) === d0 + 2, { ms: 5000,
      what: 'the wheel burst and the drag are two undo entries' });
    const p0 = (await pos()).now;
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    const pinch = (await pos()).now;
    // A choice: arrows, Home and End move the selection and focus stays on the checked option.
    // A rotary, whose radios run in option order; a slide's and a lever's run as drawn, top to
    // bottom, and s-choicekeys holds their keys to the drawing.
    const group = page.locator('[data-osc="synth-view"] [role="radiogroup"][data-style="rotary"]')
      .filter({ has: page.locator('[data-option]') }).first();
    const checked = group.locator('[aria-checked="true"]');
    await checked.focus();
    const v0 = await checked.getAttribute('data-v');
    await page.keyboard.press('ArrowRight');
    const choice = async () => page.evaluate(() => {
      const a = document.activeElement;
      return { v: a && a.getAttribute('data-v'), checked: a && a.getAttribute('aria-checked') };
    });
    await until(async () => { const c = await choice(); return c.checked === 'true'
      && c.v !== v0; }, { ms: 5000, what: 'ArrowRight moves the choice and its focus' });
    await page.keyboard.press('End');
    const last = await group.locator('[data-option]').last().getAttribute('data-v');
    await until(async () => { const c = await choice(); return c.v === last
      && c.checked === 'true'; }, { ms: 5000, what: 'End chooses the last option' });
    await page.keyboard.press('Home');
    const first = await group.locator('[data-option]').first().getAttribute('data-v');
    await until(async () => { const c = await choice(); return c.v === first
      && c.checked === 'true'; }, { ms: 5000, what: 'Home chooses the first option' });
    // 21's S13: a double-click on a disabled knob changes nothing (the first one shown).
    const width = page.locator('[data-osc="synth-view"] [data-knob][aria-disabled="true"]').first();
    await width.scrollIntoViewIfNeeded();
    const wa = await width.getAttribute('aria-valuenow');
    const disabled = await width.getAttribute('aria-disabled');
    await width.dispatchEvent('dblclick'); // a disabled knob may refuse the pointer itself
    const wb = await width.getAttribute('aria-valuenow');
    // 21's S9: a cancelled pointer on a jack is neither a tap nor a drop: a real press on a
    // jack, then the browser's pointercancel for that pointer, then the release.
    const jack = page.locator('[data-osc="synth.bay.svg"] [data-jack]').first();
    await jack.scrollIntoViewIfNeeded();
    const jb = await jack.boundingBox();
    const cablesBefore = (await dbg(page)).cables.length;
    await page.evaluate(() => {
      window.__pid = null;
      document.addEventListener('pointerdown', (e) => { window.__pid = e.pointerId; },
        { capture: true, once: true });
    });
    await page.mouse.move(jb.x + jb.width / 2, jb.y + jb.height / 2);
    await page.mouse.down();
    await page.evaluate(() => {
      const j = document.querySelector('[data-osc="synth.bay.svg"] [data-jack]');
      j.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true,
        pointerId: window.__pid }));
    });
    await page.mouse.move(jb.x + jb.width / 2 + 120, jb.y + jb.height / 2 + 40, { steps: 3 });
    await page.mouse.up();
    const cancel = await page.evaluate(() => ({
      pending: !!document.querySelector('[data-jack][aria-pressed="true"]'),
      touch: getComputedStyle(document.querySelector('[data-jack]')).touchAction }));
    cancel.before = cablesBefore;
    cancel.after = (await dbg(page)).cables.length;
    const ok = mid.max === '1000' && mid.now >= 0 && mid.now <= 1000 && mid.now !== start.now
      && Math.abs(fine.now - mid.now) <= 20 && disabled === 'true' && wa === wb
      && cancel.after === cancel.before && !cancel.pending && cancel.touch === 'none'
      && pinch === p0;
    return { ok, start, mid, fine, disabled, wa, wb, cancel, pinch, p0 };
  });

  def('s-wave', async ({ page }) => {
    await keyKnob(page, 'mix.level2', 'Home');
    await keyKnob(page, 'lpf.frequency', 'End');
    await option(page, 'vco1.waveform', 'square');
    await hold(page, 'KeyA');
    const f = C4 / 2;
    const sq = await sound(page, (q) => peakAt(q, 3 * f) && levelAt(q, 2 * f)
      <= levelAt(q, 3 * f) - 30, "the square's 2nd harmonic is 30 dB below its 3rd");
    await option(page, 'vco1.waveform', 'pulse');
    await typeKnob(page, 'vco1.width', '25');
    const pu = await sound(page, (q) => peakAt(q, 3 * f) && peakAt(q, 2 * f)
      && levelAt(q, 4 * f) <= levelAt(q, 3 * f) - 30, 'the 25 % pulse nulls its 4th harmonic');
    await page.keyboard.up('KeyA');
    return { ok: true, square: [levelAt(sq, 2 * f), levelAt(sq, 3 * f)],
      pulse: [levelAt(pu, 3 * f), levelAt(pu, 4 * f)] };
  });

  def('s-cable', async ({ page, size }) => {
    await keyKnob(page, 'mix.level1', 'Home');
    await keyKnob(page, 'lpf.frequency', 'End');
    await tapJack(page, 'keys.velocity:out');
    await tapJack(page, 'vco2.pitch:in');
    const d = await dbg(page);
    if (d.cables.length !== 1 || d.cables[0].to !== 'vco2.pitch') {
      return { ok: false, detail: 'the cable is not patched', cables: d.cables };
    }
    const model = await page.evaluate(() => window.OSCILLA.studio.model.graph.edges
      .map((e) => e.id));
    // Velocity (0..1, unipolar like its source) 100 / 127 at a 1-octave depth: VCO 2 at
    // 440 x 2^(100/127), the same for every note.
    const fixed = 440 * 2 ** (100 / 127);
    const peaks = [];
    for (const code of ['KeyA', 'KeyD']) {
      await hold(page, code);
      peaks.push((await sound(page, (q) => q.rmsDb > -45 && peakAt(q, fixed),
        `VCO 2 stays at ${fixed} Hz`)).rmsDb);
      await page.keyboard.up(code);
      await silent(page, 'the note releases');
    }
    await face(page, 'bay');
    await page.locator(`[data-remove-cable="${d.cables[0].id}"]`).click();
    await hold(page, 'KeyD');
    await sound(page, (q) => q.rmsDb > -45 && peakAt(q, C4 * 2 ** (4 / 12)),
      'VCO 2 tracks E4 again');
    await page.keyboard.up('KeyD');
    const after = await dbg(page);
    return { ok: model.includes(d.cables[0].id) && after.cables.length === 0, size, fixed, peaks };
  });

  // ERG-01 (the Synth look audit): on a phone a finger dragged from one jack to another patches
  // a cable, and the page does not scroll under it. A touch starting on a jack is the bay's: its
  // touchstart is cancelled (Chromium ignores touch-action on SVG children). Chromium drags a
  // real touch (CDP); every engine proves the cancel on a constructed touchstart.
  def('s-touchpatch', async ({ page, browserName }) => {
    await face(page, 'bay');
    // The bay's first plate 400 px down (below the listening-safety notice, above the docked
    // keys), and each point used proven to land on its own jack before it is touched.
    await page.evaluate(() => {
      const m = document.querySelector('.osc-main');
      const j = document.querySelector('[data-jack="keys.velocity:out"]');
      m.scrollTop += j.getBoundingClientRect().top - 400;
    });
    const centre = async (id) => {
      const r = await page.locator(`[data-jack="${id}"]`).boundingBox();
      const q = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      const hit = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        const j = el && el.closest('[data-jack]');
        return j ? j.dataset.jack : el && el.tagName;
      }, q);
      if (hit !== id) throw new Error(`the point of ${id} lands on ${hit}`);
      return q;
    };
    const a = await centre('keys.velocity:out');
    const b = await centre('vco1.pitch:in');
    const cancelled = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      // WebKit refuses the Touch constructor: a plain touchstart Event reaches the same listener.
      let ev;
      try {
        const t = new Touch({ identifier: 9, target: el, clientX: x, clientY: y });
        ev = new TouchEvent('touchstart', { cancelable: true, bubbles: true, touches: [t],
          targetTouches: [t], changedTouches: [t] });
      } catch (e) {
        ev = new Event('touchstart', { cancelable: true, bubbles: true });
        for (const k of ['touches', 'targetTouches', 'changedTouches']) {
          Object.defineProperty(ev, k, { value: [] });
        }
      }
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, a);
    if (cancelled !== true) {
      return { ok: false, detail: 'a touch on a jack is not cancelled', cancelled };
    }
    // A tap stays a tap (p2): the cancelled touchstart drops the synthesized click, and the jack's
    // tap runs on pointerup, so a tap on a jack still picks it up (pressed), and a second ends it.
    const tapped = async () => page.locator('[data-jack="vco1.tune:in"]')
      .getAttribute('aria-pressed');
    const t = await centre('vco1.tune:in');
    await page.touchscreen.tap(t.x, t.y);
    const picked = await until(async () => (await tapped()) === 'true',
      { ms: 3000, what: 'a tap on a jack picks it up' }).catch(() => false);
    await page.touchscreen.tap(t.x, t.y);
    const dropped = await until(async () => (await tapped()) === 'false',
      { ms: 3000, what: 'a second tap puts it down' }).catch(() => false);
    if (!picked || !dropped) {
      return { ok: false, detail: 'a tap on a jack no longer picks it up', picked, dropped };
    }
    if (browserName !== 'chromium') return { ok: true, cancelled, drag: 'chromium only (CDP)' };
    // Where the dragged-from jack is on the screen: the page did not scroll under the finger if
    // it is where it was (scrollTop alone also moves when scroll anchoring keeps the view still).
    const top = () => page.evaluate(() => Math.round(document
      .querySelector('[data-jack="keys.velocity:out"]').getBoundingClientRect().top));
    const before = await top();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, q) => cdp.send('Input.dispatchTouchEvent', { type,
      touchPoints: q ? [{ x: q.x, y: q.y, id: 1 }] : [] });
    await touch('touchStart', a);
    for (let i = 1; i <= 8; i += 1) {
      await touch('touchMove', { x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8 });
    }
    const mid = await top();
    await touch('touchEnd', null);
    const patched = await until(async () => {
      const d = await dbg(page);
      return d.cables.length === 1 && d.cables[0].to === 'vco1.pitch' ? d.cables : null;
    }, { ms: 5000, what: 'the touch drag patches keys.velocity to vco1.pitch' })
      .catch(async () => (await dbg(page)).cables);
    // The page does not move under the finger while it drags (before = mid), nor after the drop
    // re-draws the bay (JC-10: the jack is held where it was, within a pixel).
    const after = await until(async () => {
      const y = await top();
      return Math.abs(y - before) <= 1 ? y : null;
    }, { ms: 3000, what: 'the dragged-from jack stays where it was after the drop' })
      .catch(top);
    return { ok: patched.length === 1 && patched[0].to === 'vco1.pitch' && mid === before
      && Math.abs(after - before) <= 1, cancelled, cables: patched, jackTop: [before, mid, after] };
  });

  // ERG-04 and ERG-03 (the Synth look audit): pressing a knob focuses it, so the keys follow a
  // grabbed knob; Escape during the drag restores the value the press found, adds no undo entry
  // and leaves the keys armed (the page's Escape disarms them only when no drag is open).
  def('s-knobesc', async ({ page }) => {
    await face(page, 'panel');
    await page.locator('[data-osc="synth.arm"]').click();
    const armed = () => page.evaluate(() => window.OSCILLA.app.synthDebug().armed);
    await until(armed, { ms: 10000, what: 'Arm arms the panel' });
    const k = knob(page, 'lpf.frequency');
    await k.scrollIntoViewIfNeeded();
    const start = await k.getAttribute('aria-valuenow');
    const undo = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    const undoBefore = await undo();
    const r = await k.boundingBox();
    const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y - 40, { steps: 8 });
    const moved = await k.getAttribute('aria-valuenow');
    const focused = await page.evaluate(() => document.activeElement
      && document.activeElement.dataset.knob);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    const back = await knob(page, 'lpf.frequency').getAttribute('aria-valuenow');
    // 21's R7: the browser taking the pointer mid-drag (pointercancel, a real pointer id) also
    // restores the value, with no undo entry; it never commits the drag.
    await page.evaluate(() => {
      window.__pid = null;
      document.addEventListener('pointerdown', (e) => { window.__pid = e.pointerId; },
        { capture: true, once: true });
    });
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y - 40, { steps: 8 });
    const moved2 = await k.getAttribute('aria-valuenow');
    await page.evaluate(() => document.querySelector('[data-knob="lpf.frequency"]')
      .dispatchEvent(new PointerEvent('pointercancel', { bubbles: true,
        pointerId: window.__pid })));
    await page.mouse.up();
    const back2 = await knob(page, 'lpf.frequency').getAttribute('aria-valuenow');
    const ok = moved !== start && focused === 'lpf.frequency' && back === start
      && moved2 !== start && back2 === start
      && (await undo()) === undoBefore && (await armed()) === true;
    return { ok, start, moved, back, moved2, back2, focused, undo: [undoBefore, await undo()],
      armed: await armed() };
  });

  // 21's P3 on Train 6: a cable patched while a wheel burst is still open (within
  // GESTURE_IDLE_MS of the last notch) is its own undo entry; it never folds into the burst.
  def('s-wheelcable', async ({ page }) => {
    await face(page, 'panel');
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    const k = knob(page, 'lpf.frequency');
    await k.scrollIntoViewIfNeeded();
    const r = await k.boundingBox();
    const d0 = await depth();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.wheel(0, -100);
    await page.evaluate(() => {
      const press = (id) => {
        const j = document.querySelector(`[data-jack="${id}"]`);
        j.focus();
        j.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      };
      press('keys.velocity:out');
      press('vco2.pitch:in'); // in the same task: well inside the burst's idle window
    });
    const two = await until(async () => ((await depth()) === d0 + 2 ? true : null),
      { ms: 3000, what: 'the wheel turn and the cable are two undo entries' }).catch(() => false);
    const d = await dbg(page);
    return { ok: !!two && d.cables.length === 1, depth: [d0, await depth()], cables: d.cables };
  });

  def('s-refuse', async ({ page }) => {
    await hold(page, 'KeyA');
    await sound(page, (q) => q.rmsDb > -40, 'a note sounds');
    const before = await page.evaluate(() => ({ edges: window.OSCILLA.studio.model.graph.edges
      .length, rev: window.OSCILLA.app.studio && window.OSCILLA.studio.model }));
    const c0 = await counts(page);
    await tapJack(page, 'lpf.audio:out');
    await tapJack(page, 'mix.in1:in');
    const status = await page.locator('[data-osc="synth.status"]').textContent();
    const after = await page.evaluate(() => window.OSCILLA.studio.model.graph.edges.length);
    const c1 = await counts(page);
    await page.keyboard.up('KeyA');
    return { ok: /own source|loop|feedback/i.test(status) && after === before.edges
      && c1.runtimeNodes === c0.runtimeNodes, status, c0, c1 };
  });

  def('s-ring', async ({ page }) => {
    await option(page, 'vco1.scale', '8');
    await option(page, 'vco1.waveform', 'sine');
    await option(page, 'vco2.waveform', 'sine');
    await typeKnob(page, 'vco2.tune', '386');
    await keyKnob(page, 'mix.level1', 'Home');
    await keyKnob(page, 'mix.level2', 'Home');
    await keyKnob(page, 'mix.level4', 'End');
    await keyKnob(page, 'lpf.frequency', 'End');
    await hold(page, 'KeyA');
    const f2 = C4 * 2 ** (386 / 1200);
    const p = await sound(page, (q) => peakAt(q, f2 + C4) && peakAt(q, f2 - C4)
      && levelAt(q, C4) <= levelAt(q, f2 + C4) - 20, 'ring products at f2 +- f1, carrier down');
    await page.keyboard.up('KeyA');
    return { ok: true, sum: levelAt(p, f2 + C4), diff: levelAt(p, f2 - C4),
      carrier: levelAt(p, C4) };
  });

  def('s-midi', async ({ context, base }) => {
    await context.addInitScript(midiStub.install, {});
    const page = await openSynth(context, base);
    await page.evaluate(() => window.OSCILLA.app.midiConnect());
    await until(() => page.evaluate(() => window.__oscMidiSeam.calls().length === 1),
      { ms: 10000, what: 'Connect MIDI asks once' });
    await page.evaluate((n) => window.__oscMidiSeam.resolve(0, [n]), midiStub.STUB_NAME);
    await until(() => page.evaluate(() => window.OSCILLA.app.midiState === 'connected'),
      { ms: 10000, what: 'the stub input connects' });
    await page.evaluate((n) => window.__oscMidiSeam.message(n, [0x90, 60, 100]),
      midiStub.STUB_NAME);
    const on = await sound(page, (q) => peakAt(q, C4 / 2) && q.rmsDb > -40,
      'Note On 60 plays the panel');
    await page.evaluate((n) => window.__oscMidiSeam.message(n, [0x80, 60, 0]), midiStub.STUB_NAME);
    const off = await silent(page, 'Note Off releases it');
    await page.close();
    return { ok: true, on: on.rmsDb, off: off.rmsDb };
  });

  def('s-link', async ({ context, base }) => {
    const page = await openSynth(context, base, '#m=synth&yp=bass&yv=lpf.frequency:300');
    const text = await page.locator('[data-value="lpf.frequency"]').textContent();
    await hold(page, 'KeyA');
    const p = await sound(page, (q) => peakAt(q, C4 / 2) && q.rmsDb > -50,
      "the bass link sounds at 16'");
    await page.keyboard.up('KeyA');
    await page.goto(`${base}#m=synth&yp=nope`);
    await until(() => page.evaluate(() => window.location.hash.indexOf('yp=') < 0
      && /no preset/.test(window.OSCILLA.app.synth.status)),
    { ms: 15000, what: 'the malformed link is refused and its keys leave' });
    await page.close();
    return { ok: text.trim() === '300 Hz', knob: text, rmsDb: p.rmsDb };
  });

  /** The 1-3 kHz band swings by `db` while a note sounds (an LFO sweeping the cutoff). */
  async function swings(page, db, what) {
    let lo = Infinity;
    let hi = -Infinity;
    await hold(page, 'KeyA');
    await sound(page, (q) => q.rmsDb > -45, 'the note sounds');
    await sound(page, (q) => {
      if (q.rmsDb <= -45) return false;
      const b = bandDb(q, 1000, 3000);
      lo = Math.min(lo, b);
      hi = Math.max(hi, b);
      return hi - lo >= db;
    }, what);
    await page.keyboard.up('KeyA');
    return +(hi - lo).toFixed(1);
  }

  def('s-relink', async ({ page, context, base }) => {
    await tapJack(page, 'mg.control:out');
    await tapJack(page, 'lpf.frequency:in');
    await typeKnob(page, 'lpf.lpf-mg', '3');
    // 1 Hz, not 4: the analyser's window must stay short against the MG period, or a slow
    // runner (CI, 44.1 kHz, software GL) smears the sweep below 10 dB; measured in the
    // playwright container: 4 Hz passed 1 of 3, 1 Hz 10 of 10, no-modulation noise 2-4.5 dB.
    await typeKnob(page, 'mg.rate', '1');
    await typeKnob(page, 'lpf.frequency', '300');
    const d = await dbg(page);
    if (d.cables.length !== 1 || d.cables[0].to !== 'lpf.frequency') {
      return { ok: false, detail: 'MG into LPF cutoff is not listed as a cable', cables: d.cables };
    }
    const depth = (pg) => pg.evaluate(() => {
      const ids = window.OSCILLA.app.synthDebug().nodes;
      return window.OSCILLA.studio.model.graph.edges.filter((e) => e.to.node === ids.lpf
        && e.to.port === 'frequency').map((e) => e.props.depth);
    });
    const here = await swings(page, 10, 'the MG sweeps the cutoff through the cable');
    // Copy link, the button: it writes the link it copies below the actions (synth.link),
    // whether or not the clipboard takes it.
    await page.locator('[data-osc="synth.copy-link"]').click();
    const link = await until(() => page.evaluate(() => window.OSCILLA.app.synth.link || null),
      { ms: 10000, what: 'Copy link shows the link' });
    const hash = link.slice(link.indexOf('#') + 1);
    const again = await openSynth(context, base, `#${hash}`);
    const d2 = await dbg(again);
    const there = await swings(again, 10, 'the reopened link sweeps the cutoff the same way');
    const [a, b] = [await depth(page), await depth(again)];
    await again.close();
    return { ok: /yc=/.test(hash) && JSON.stringify(d2.cables.map((c) => [c.from, c.to]))
      === JSON.stringify([['mg.control', 'lpf.frequency']]) && JSON.stringify(a) === '[3]'
      && JSON.stringify(b) === '[3]', hash, here, there, depths: [a, b] };
  });

  def('s-studio', async ({ page }) => {
    await hold(page, 'KeyA');
    await sound(page, (q) => q.rmsDb > -40, 'the panel sounds before Studio opens');
    await page.keyboard.up('KeyA');
    const before = await page.evaluate(() => ({ rev: window.OSCILLA.studio.store.getRevision(),
      nodes: Object.values(window.OSCILLA.app.synthDebug().nodes).sort() }));
    await page.locator('[data-osc="synth.studio"]').click();
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'studio'
      && /m=studio/.test(window.location.hash)), { ms: 10000, what: 'Studio opens' });
    const after = await page.evaluate(() => ({ rev: window.OSCILLA.studio.store.getRevision(),
      sel: [...window.OSCILLA.studio.selection.nodes].sort() }));
    return { ok: after.rev === before.rev && JSON.stringify(after.sel)
      === JSON.stringify(before.nodes) && after.sel.length === before.nodes.length
      && after.sel.length >= 14, before, after };
  });

  def('s-scope', async ({ page }) => {
    const scope = page.locator('[data-scope-drive="lpf.frequency"]');
    await scope.scrollIntoViewIfNeeded();
    const box = await scope.boundingBox();
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    const before = { depth: await depth(),
      value: await page.locator('[data-value="lpf.frequency"]').textContent() };
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.9, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, y, { steps: 4 });
    await page.mouse.move(box.x + box.width * 0.5, y, { steps: 4 });
    await page.mouse.up();
    const after = await page.evaluate(() => {
      const m = window.OSCILLA.studio.store.getModel();
      const lpf = m.graph.nodes.find((n) => n.metadata && n.metadata.panel
        && n.metadata.panel.module === 'lpf');
      return { hz: lpf.params.frequency,
        depth: window.OSCILLA.studio.store.debugInfo().undoDepth,
        value: document.querySelector('[data-value="lpf.frequency"]').textContent,
        label: document.querySelector('[data-scope="lpf"] svg').getAttribute('aria-label') };
    });
    return { ok: Math.abs(after.hz - 632.5) < 20 && after.depth === before.depth + 1
      && after.value !== before.value
      && /^lowpass response \(computed\), 6\d\d(\.\d)? Hz, /.test(after.label),
    before, after };
  });

  def('s-dock', async ({ page, size }) => {
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    const out = {};
    // The picker: a menu button; the keyboard walks its role=menu items, Enter routes.
    const d0 = await dbg(page);
    const fm = d0.nodes.fm;
    // V635: on a phone the instrument row is folded behind the dock's More button.
    const more = page.locator('[data-osc="keyboard.more"]');
    if (await more.isVisible()) {
      await more.click();
      await until(() => page.locator('[data-osc="synth.pick"]').isVisible(),
        { ms: 5000, what: 'More unfolds the instrument row' });
      out.unfolded = await more.getAttribute('aria-expanded');
    }
    const pick = page.locator('#osc-synth-pick');
    await pick.focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('[data-osc="synth.pick.menu"]');
    await until(() => menu.isVisible(), { ms: 5000, what: 'the instrument menu opens' });
    out.items = await menu.locator('[role="menuitem"]').count();
    out.expanded = await pick.getAttribute('aria-expanded');
    const before = await depth();
    const focused = () => page.evaluate(() => (document.activeElement
      && document.activeElement.getAttribute('role') === 'menuitem'
      ? document.activeElement.dataset.pick : null));
    await until(async () => (await focused()) !== null, { ms: 5000,
      what: 'focus enters the instrument menu' });
    // Step down one item at a time, each step confirmed, until FM has the focus (bounded by
    // the item count), then choose it.
    for (let i = 0; i < out.items && (await focused()) !== fm; i++) {
      const at = await focused();
      await page.keyboard.press('ArrowDown');
      await until(async () => (await focused()) !== at, { ms: 5000,
        what: 'ArrowDown moves the focus to the next item' });
    }
    await until(async () => (await focused()) === fm, { ms: 5000,
      what: 'the focus reaches the FM engine' });
    await page.keyboard.press('Enter');
    await until(async () => (await dbg(page)).played === fm, { ms: 5000,
      what: 'Enter routes the keys to the FM engine' });
    out.routeEntries = (await depth()) - before;
    out.label = await page.evaluate(() => window.OSCILLA.studio.store.undoLabel());
    await hold(page, 'KeyA');
    await until(async () => (await dbg(page)).voices >= 1, { ms: SOUND_MS,
      what: 'a note takes an FM voice' });
    await page.keyboard.up('KeyA');
    await page.evaluate(() => window.OSCILLA.studio.store.undo());
    await until(async () => (await dbg(page)).played === d0.played, { ms: 5000,
      what: 'undo routes the keys back' });
    // The waveform radiogroup by keyboard: Saw -> Square on VCO 1, heard.
    await keyKnob(page, 'mix.level2', 'Home');
    await keyKnob(page, 'lpf.frequency', 'End');
    const f = C4 / 2;
    await hold(page, 'KeyA');
    await sound(page, (q) => peakAt(q, 2 * f) && peakAt(q, 3 * f), "the saw's 2nd harmonic");
    await page.locator('[data-osc="synth.dock.wave"] [aria-checked="true"]').focus();
    await page.keyboard.press('ArrowRight');
    await until(() => page.evaluate(() => window.OSCILLA.studio.model.graph.nodes
      .find((n) => n.metadata.panel && n.metadata.panel.module === 'vco1').params.waveform
      === 'square'), { ms: 5000, what: 'the arrow key chooses Square' });
    const sq = await sound(page, (q) => peakAt(q, 3 * f) && levelAt(q, 2 * f)
      <= levelAt(q, 3 * f) - 30, "the square's 2nd harmonic is 30 dB below its 3rd");
    out.square = [levelAt(sq, 2 * f), levelAt(sq, 3 * f)];
    await page.locator('#osc-synth-title').click();
    await page.keyboard.up('KeyA');
    // A quick preset by pointer or touch, linked to the Studio Inspector.
    const b0 = await depth();
    const bass = page.locator('[data-osc="synth.dock.preset"] [data-v="bass"]');
    if (size === 'phone') await bass.tap(); else await bass.click();
    await until(async () => (await depth()) === b0 + 1, { ms: 5000,
      what: 'the Bass quick preset is one undo entry' });
    const rev = await page.evaluate(() => window.OSCILLA.studio.store.getRevision());
    const lpf = d0.nodes.lpf;
    await page.locator('[data-osc="synth.studio"]').click();
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'studio'),
      { ms: 10000, what: 'Studio opens' });
    await page.evaluate((id) => window.OSCILLA.studio.store.dispatch({ type: 'SELECTION_CHANGE',
      selection: { nodes: [id] } }), lpf);
    const field = page.locator('[data-osc="studio.inspector.param"][data-key="frequency"]');
    await until(async () => /180/.test(await field.inputValue().catch(() => '')),
      { ms: 10000, what: 'the Inspector shows the LPF cutoff of Bass (180 Hz)' });
    out.inspector = await field.inputValue();
    out.sameRevision = rev === await page.evaluate(() => window.OSCILLA.studio.store
      .getRevision());
    return { ok: out.items === 9 && out.expanded === 'true' && out.routeEntries === 1
      && /^Play .* from the keys$/.test(out.label) && out.sameRevision, ...out };
  });

  def('s-nodepreset', async ({ page }) => {
    const d0 = await dbg(page);
    await keyKnob(page, 'lpf.frequency', 'End');
    await hold(page, 'KeyA');
    const open = tilt(await steady(page, tilt, 'the open filter settles'));
    await page.keyboard.up('KeyA');
    await silent(page, 'the note releases');
    const before = await page.evaluate(() => ({ depth: window.OSCILLA.studio.store.debugInfo()
      .undoDepth, edges: window.OSCILLA.studio.model.graph.edges.map((e) => e.id).join() }));
    await page.locator('[data-osc="synth.studio"]').click();
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'studio'),
      { ms: 10000, what: 'Studio opens' });
    await page.evaluate((id) => window.OSCILLA.studio.store.dispatch({ type: 'SELECTION_CHANGE',
      selection: { nodes: [id] } }), d0.nodes.lpf);
    const btn = page.locator('[data-osc="studio.inspector.presets"]');
    await until(() => btn.isVisible(), { ms: 10000, what: 'the Inspector shows Presets' });
    await btn.focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('[data-osc="studio.inspector.presets.menu"]');
    await until(() => menu.isVisible(), { ms: 5000, what: 'the preset menu opens' });
    await page.keyboard.press('ArrowDown'); // Default, then Dark low-pass
    await until(() => page.evaluate(() => document.activeElement.dataset.preset === 'dark'),
      { ms: 5000, what: 'the arrow reaches Dark low-pass' });
    await page.keyboard.press('Enter');
    const field = page.locator('[data-osc="studio.inspector.param"][data-key="frequency"]');
    await until(async () => /^400/.test(await field.inputValue().catch(() => '')),
      { ms: 10000, what: 'the cutoff field reads 400' });
    const after = await page.evaluate(() => ({ depth: window.OSCILLA.studio.store.debugInfo()
      .undoDepth, edges: window.OSCILLA.studio.model.graph.edges.map((e) => e.id).join(),
    label: window.OSCILLA.studio.store.undoLabel() }));
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('synth'));
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'synth'),
      { ms: 10000, what: 'back in the Synth' });
    await hold(page, 'KeyA');
    const dark = tilt(await steady(page, tilt, 'the dark low-pass settles'));
    await page.keyboard.up('KeyA');
    return { ok: after.depth === before.depth + 1 && after.edges === before.edges
      && /^Preset Dark low-pass/.test(after.label) && dark <= open - 4, label: after.label,
    tilt: [open, dark] };
  });

  def('s-library', async ({ page, size }) => {
    const press = (loc) => (size === 'phone' ? loc.tap() : loc.click());
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    const dlg = page.locator('[data-osc="library"]');
    const libraryButton = page.locator('[data-osc="synth.library"]');
    if (size === 'phone') await libraryButton.tap(); else await libraryButton.click();
    await until(() => dlg.isVisible(), { ms: 10000, what: 'the patch library opens' });
    await page.locator('[data-osc="library.instrument"]').selectOption('fm-voice');
    const list = page.locator('[data-osc="library.list"]');
    const names = await list.locator('[role="option"] span:first-child').allTextContents();
    await list.focus();
    await page.keyboard.press('ArrowDown');
    await until(async () => (await page.locator('[data-osc="library.name"]').textContent())
      === 'FM keys', { ms: 5000, what: 'the arrow reaches FM keys' });
    const before = await depth();
    await press(page.locator('[data-osc="library.insert"]'));
    await until(async () => (await depth()) === before + 1, { ms: 5000,
      what: 'Insert is one undo entry' });
    const added = await page.evaluate(() => window.OSCILLA.studio.model.metadata.noteTarget);
    await press(page.locator('[data-osc="studio.saved.close"]'));
    await until(async () => !(await dlg.isVisible()), { ms: 5000, what: 'the library closes' });
    await hold(page, 'KeyA');
    await until(async () => { const d = await dbg(page); return d.played === added
      && d.voices >= 1; }, { ms: SOUND_MS, what: 'a note takes a voice of the inserted engine' });
    await page.keyboard.up('KeyA');
    await page.locator('[data-osc="synth.studio"]').click();
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'studio'),
      { ms: 10000, what: 'Studio opens' });
    const inGraph = await page.evaluate((id) => window.OSCILLA.studio.model.graph.nodes
      .some((n) => n.id === id), added);
    await page.evaluate((id) => window.OSCILLA.studio.store.dispatch({ type: 'SELECTION_CHANGE',
      selection: { nodes: [id] } }), added);
    if (size === 'phone') { // the phone's Studio folds its Inspector away: the same opener
      await page.evaluate(() => window.OSCILLA.app.patchLibraryOpen());
    } else {
      const btn = page.locator('[data-osc="studio.inspector.presets"]');
      await until(() => btn.isVisible(), { ms: 10000, what: 'the Inspector shows Presets' });
      await btn.click();
      await page.locator('[data-osc="studio.inspector.presets.library"]').click();
    }
    await until(() => dlg.isVisible(), { ms: 10000, what: 'the library opens from the Studio' });
    await page.locator('[data-osc="library.instrument"]').selectOption('fm-voice');
    const row = list.locator('[role="option"]', { hasText: 'FM keys' });
    await until(async () => /in use/.test(await row.textContent()), { ms: 5000,
      what: 'the Studio lists FM keys as in use' });
    return { ok: JSON.stringify(names) === '["FM bell","FM keys"]' && inGraph, names, added };
  });

  def('s-libxy', async ({ page }) => {
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    const pad = () => page.evaluate(() => window.OSCILLA.studio.model.graph.nodes
      .find((n) => n.metadata.panel && n.metadata.panel.module === 'xy').params);
    await page.locator('[data-osc="synth.library"]').click();
    const list = page.locator('[data-osc="library.list"]');
    await until(() => list.isVisible(), { ms: 10000, what: 'the patch library opens' });
    const tag = page.locator('[data-osc="library.tag"]');
    await until(async () => (await tag.locator('option[value="xy"]').count()) === 1,
      { ms: 10000, what: 'the xy tag is offered' });
    await tag.selectOption('xy');
    const options = list.locator('[role="option"]');
    const built = await options.count();
    const before = await depth();
    await list.focus();
    await page.keyboard.press('Enter');
    await until(async () => (await depth()) === before + 1, { ms: 5000,
      what: 'Enter applies the first XY preset in one undo entry' });
    const p = await pad();
    await page.locator('[data-osc="library.saveName"]').fill('Night drive');
    await page.locator('[data-osc="library.save.xy"]').click();
    await until(async () => (await options.count()) === built + 1
      && /Night drive/.test(await list.textContent()), { ms: 10000,
      what: 'the saved XY preset is listed under xy' });
    return { ok: built === 4 && p.mode === 'minor-pentatonic', built, mode: p.mode };
  });

  // Review of src/js/synth (oscilla-21, S1): the Arm button is the transport's armed flag.
  const armText = (page) => page.locator('[data-osc="synth.arm"]').textContent()
    .then((x) => x.trim());
  async function armedNow(page, what) {
    await page.locator('[data-osc="synth.arm"]').click();
    await until(async () => (await dbg(page)).armed && (await armText(page)) === 'Disarm',
      { ms: 10000, what });
  }
  async function readsArm(page, what) {
    await until(async () => !(await dbg(page)).armed && (await armText(page)) === 'Arm',
      { ms: 10000, what });
  }
  def('s-armstop', async ({ page }) => {
    await armedNow(page, 'Arm arms the panel and the button reads Disarm');
    // A Stop the Synth did not make while it is shown: page hide stops the Studio transport.
    // Before any Studio visit nothing else re-reads the Synth, so a copy would stay Disarm.
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await readsArm(page, 'a transport Stop made outside the Synth reads Arm');
    await armedNow(page, 'Arm arms after a Stop made outside the Synth');
    // The review's path: to the Studio, its Stop, back to the Synth.
    await page.locator('[data-osc="nav.studio"]').click();
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'studio'),
      { ms: 10000, what: 'the Studio opens' });
    await page.locator('[data-osc="studio.stop"]').click();
    await page.locator('[data-osc="nav.synth"]').click();
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'synth'),
      { ms: 10000, what: 'back in the Synth' });
    await readsArm(page, 'after the Studio and its Stop the button reads Arm');
    await armedNow(page, 'Arm arms again after the Studio Stop');
    await hold(page, 'KeyA');
    const on = await sound(page, (q) => q.rmsDb > -40, 'the re-armed panel sounds');
    await page.keyboard.up('KeyA');
    return { ok: true, on: on.rmsDb };
  });

  // Review of src/js/synth (oscilla-21, S6): an XY preset writes the voice it plays, never an
  // engine of the Engines tab.
  def('s-xyengine', async ({ page }) => {
    const KNOB = 'additive.h1';
    const param = () => page.evaluate(() => window.OSCILLA.studio.model.graph.nodes
      .find((n) => n.metadata.panel && n.metadata.panel.module === 'additive').params.h1);
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    const tabTo = async (id) => {
      await page.locator(`#osc-synth-tab-${id}`).click();
      await until(async () => (await dbg(page)).tab === id, { ms: 10000,
        what: `the ${id} tab opens` });
    };
    await tabTo('engines');
    await until(() => knob(page, KNOB).isVisible(), { ms: 10000,
      what: 'the additive engine shows its drawbars' });
    const initial = await param();
    await keyKnob(page, KNOB, 'Home');
    await until(async () => (await param()) !== initial, { ms: 10000,
      what: 'Home moves drawbar 1' });
    const set = await param();
    const text = (await page.locator(`[data-value="${KNOB}"]`).textContent()).trim();
    await tabTo('xy');
    const before = await depth();
    await page.locator('#osc-synth-preset').selectOption('xy-bass');
    await until(async () => (await depth()) === before + 1, { ms: 10000,
      what: 'the XY bass preset is one undo entry' });
    const mode = await page.evaluate(() => window.OSCILLA.studio.model.graph.nodes
      .find((n) => n.metadata.panel && n.metadata.panel.module === 'xy').params.mode);
    const after = await param();
    await tabTo('engines');
    await until(() => knob(page, KNOB).isVisible(), { ms: 10000,
      what: 'the additive engine is shown again' });
    const shown = (await page.locator(`[data-value="${KNOB}"]`).textContent()).trim();
    return { ok: mode === 'dorian' && after === set && shown === text, initial, set, after,
      text, shown, mode };
  });

  def('s-riffs', async ({ page }) => {
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    await page.locator('[data-osc="synth.library"]').click();
    const list = page.locator('[data-osc="library.list"]');
    await until(() => list.isVisible(), { ms: 10000, what: 'the patch library opens' });
    const inst = page.locator('[data-osc="library.instrument"]');
    await until(async () => (await inst.locator('option[value="riffs"]').count()) === 1,
      { ms: 10000, what: 'the Riffs category is offered' });
    await inst.selectOption('riffs');
    const options = list.locator('[role="option"]');
    const count = await options.count();
    const name = await page.locator('[data-osc="library.name"]').textContent();
    const style = await page.locator('[data-osc="library.detail.text"]').textContent();
    const modes = await page.locator('[data-osc="library.detail"] [data-mode]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-mode')));
    const before = await depth();
    const listen = page.locator('[data-osc="library.listen"]');
    await listen.click();
    const heard = await sound(page, (q) => q.rmsDb > -40, 'Listen plays the riff');
    // What sounds is the riff's own plan, never the instrument's tone rebuilt over it.
    const plan = await page.evaluate(() => {
      const v = window.OSCILLA.engine.voice;
      return v && v.plan ? v.plan.label : null;
    });
    const pressed = await listen.getAttribute('aria-pressed');
    // Stopped from outside (any other owner's stop): the button follows the sound at once.
    await page.evaluate(() => window.OSCILLA.engine.stopAll());
    await until(async () => (await listen.getAttribute('aria-pressed')) === 'false', { ms: 2000,
      what: 'a stop from outside releases the Listen button' });
    await listen.click();
    await sound(page, (q) => q.rmsDb > -40, 'Listen plays the riff again');
    await listen.click();
    const hushed = await sound(page, (q) => q.rmsDb < -70, 'Stop ends the audition');
    const unsaved = (await depth()) === before;
    await list.focus();
    await page.keyboard.press('Enter');
    await until(async () => (await depth()) === before + 1, { ms: 5000,
      what: 'Enter inserts the first riff in one undo entry' });
    const added = await page.evaluate((title) => {
      const m = window.OSCILLA.studio.model;
      const track = m.timeline.tracks.find((t) => t.name === title);
      const osc = track && m.graph.nodes.find((n) => n.id === track.target);
      const master = m.graph.nodes.find((n) => n.type === 'master');
      const reach = new Set(osc ? [osc.id] : []);
      for (let grew = true; grew;) {
        grew = false;
        for (const e of m.graph.edges) {
          if (reach.has(e.from.node) && !reach.has(e.to.node)) grew = !!reach.add(e.to.node);
        }
      }
      return { track: !!track, osc: osc ? osc.type : null, master: !!master && reach.has(master.id),
        clips: track ? m.timeline.clips.filter((c) => c.trackId === track.id).length : 0 };
    }, name);
    return { ok: count >= 12 && /^Original, in the style of /.test(style)
      && JSON.stringify(modes) === '["insert"]' && added.track && added.osc === 'oscillator'
      && added.master && added.clips > 0 && pressed === 'true' && unsaved
      && plan === `Riff ${name}`, plan, count, name, style,
    modes, added, heard: heard.rmsDb, hushed: hushed.rmsDb, pressed, unsaved };
  });

  def('s-escape', async ({ page }) => {
    await hold(page, 'KeyA');
    await sound(page, (q) => q.rmsDb > -40, 'a held note sounds');
    await page.keyboard.press('Escape');
    const q = await silent(page, 'Escape releases it');
    await page.keyboard.up('KeyA');
    await page.locator('[data-osc="nav.studio"]').click();
    await until(async () => (await counts(page)).runtimeNodes === 0,
      { ms: 10000, what: 'leaving the Synth disarms: runtime census 0' });
    return { ok: !(await dbg(page)).armed, off: q.rmsDb, counts: await counts(page) };
  });

  /** The note's steady level: two probes 0.25 s of audio time apart agree within 0.5 dB. */
  async function steady(page, f, what) {
    let last = null;
    let lastT = 0;
    return sound(page, (q) => {
      if (q.rmsDb <= -45) return false;
      const v = f(q);
      const ok = last !== null && q.t - lastT >= 0.25 && Math.abs(v - last) < 0.5;
      if (last === null || q.t - lastT >= 0.25) { last = v; lastT = q.t; }
      return ok;
    }, what);
  }
  const tilt = (q) => bandDb(q, 1000, 4000) - levelAt(q, C4 / 2);

  def('s-preset', async ({ page }) => {
    const knobText = (cid) => page.locator(`[data-value="${cid}"]`).textContent()
      .then((x) => x.trim());
    const choose = async (id) => {
      const before = await page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
      await page.locator('#osc-synth-preset').selectOption(id);
      await until(() => page.evaluate((b) => window.OSCILLA.studio.store.debugInfo().undoDepth
        === b + 1, before), { ms: 10000, what: `the ${id} preset is one undo entry` });
      return page.evaluate(() => window.OSCILLA.studio.store.undoLabel());
    };
    const out = {};
    // Init, from a panel off it (a knob moved), as the reference of Bass.
    await keyKnob(page, 'mix.level3', 'End');
    out.init = await choose('init');
    await hold(page, 'KeyA');
    const ref = tilt(await steady(page, tilt, 'Init settles'));
    await page.keyboard.up('KeyA');
    await silent(page, 'Init releases');

    out.bass = await choose('bass');
    out.bassKnob = await knobText('lpf.frequency');
    await hold(page, 'KeyA');
    const bass = await sound(page, (q) => q.rmsDb > -50 && tilt(q) <= ref - 12,
      'Bass: the 1-4 kHz band falls 12 dB further below the fundamental');
    await page.keyboard.up('KeyA');
    await silent(page, 'Bass releases');

    out.lead = await choose('lead');
    out.leadScale = await page.locator('[data-option="vco1.scale"][aria-checked="true"]')
      .getAttribute('data-v');
    await hold(page, 'KeyA');
    await sound(page, (q) => q.rmsDb > -45 && peakAt(q, C4 * 1.5) && peakAt(q, C4)
      && levelAt(q, C4 / 2) < levelAt(q, C4) - 20, "Lead: VCO 1 at 8', a fifth at 392 Hz");
    await page.keyboard.up('KeyA');
    await silent(page, 'Lead releases');

    out.sweep = await choose('sweep');
    out.sweepKnob = await knobText('lpf.lpf-mg');
    const swing = await swings(page, 8, 'Sweep: the MG sweeps the low-pass');
    await silent(page, 'Sweep releases');

    out.ring = await choose('ring-bell');
    out.ringKnob = await knobText('mix.level4');
    const f1 = C4 * 2; // VCO 1 at 4'
    const f2 = C4 * 2 ** (386 / 1200); // VCO 2 at 8', +386 cents
    await hold(page, 'KeyA');
    await sound(page, (q) => peakAt(q, f1 + f2) && peakAt(q, f1 - f2),
      'Ring bell: ring products at 196.2 and 850.3 Hz');
    await page.keyboard.up('KeyA');
    return { ok: /^Preset Init$/.test(out.init) && /^Preset Bass$/.test(out.bass)
      && out.bassKnob === '180 Hz' && out.leadScale === '8' && out.sweepKnob !== '0.00 oct'
      && /^Preset Ring bell$/.test(out.ring) && out.ringKnob !== '0.00', ...out, ref,
    bass: tilt(bass), swing };
  });

  // Every choice (W1c, the core's switch with its legends on the plate) fits its plate: on
  // every tab at every width the leg looks at, each option's hit box and each legend lie inside
  // the padding box of its plate's controls, at least 44 px of every hit box can be pressed,
  // and a press on a legend's centre lands on the radio of that option (review of W1c, 1 and 3).
  def('s-choices', async ({ context, base, size }) => {
    const widths = size === 'phone' ? [320, 375, 390] : [1536, 1280, 640];
    const tabs = ['panel', 'xy', ...['additive', 'fm', 'am', 'wavetable', 'sync', 'perc']
      .map((e) => `engines&ye=${e}`)];
    const bad = [];
    const seen = new Set();
    for (const tab of tabs) {
      const page = await openSynth(context, base, `#m=synth&yt=${tab}`);
      await face(page, 'panel');
      for (const w of widths) {
        await page.setViewportSize({ width: w, height: SIZES[size].height });
        await until(() => page.evaluate((x) => window.innerWidth === x, w),
          { ms: 5000, what: `the page is ${w} px wide` });
        const r = await page.evaluate(() => {
          const out = { bad: [], cids: [] };
          const dock = document.getElementById('osc-keyboard');
          // The band a legend is seen in: below what sticks to the top of the view (the chip
          // bar, the engine picker), above the docked keys.
          const sticky = [...document.querySelectorAll('#osc-view-synth *')]
            .filter((el) => getComputedStyle(el).position === 'sticky');
          const band = () => {
            const lo = Math.max(0, ...sticky.map((el) => el.getBoundingClientRect())
              .filter((q) => q.height > 0 && q.top < innerHeight / 3).map((q) => q.bottom));
            const hi = dock && dock.getClientRects().length
              ? Math.min(innerHeight, dock.getBoundingClientRect().top) : innerHeight;
            return hi > lo ? (lo + hi) / 2 : innerHeight / 2;
          };
          for (const svg of document.querySelectorAll('[data-osc="synth.panel"] '
            + 'svg[role="radiogroup"]')) {
            if (!svg.getClientRects().length) continue;
            const cid = svg.closest('[data-control]').getAttribute('data-control');
            out.cids.push(cid);
            const holder = svg.closest('[data-control]').parentElement;
            const hb = holder.getBoundingClientRect();
            const cs = getComputedStyle(holder);
            const pad = { l: hb.left + parseFloat(cs.paddingLeft) - 0.5,
              r: hb.right - parseFloat(cs.paddingRight) + 0.5 };
            const sec = svg.closest('section').getBoundingClientRect();
            const radios = [...svg.querySelectorAll('[data-option][role="radio"]')];
            const legends = [...svg.querySelectorAll('text[data-legend]')];
            if (legends.length !== radios.length) {
              out.bad.push(`${cid}: ${legends.length} legends, ${radios.length} radios`);
            }
            for (const b of radios) {
              const q = b.getBoundingClientRect();
              if (q.left < pad.l || q.right > pad.r) {
                out.bad.push(`${cid} ${b.dataset.v}: its box [${q.left.toFixed(1)}, `
                  + `${q.right.toFixed(1)}] leaves the plate's [${pad.l.toFixed(1)}, `
                  + `${pad.r.toFixed(1)}]`);
              }
              const vis = Math.min(q.right, sec.right, innerWidth) - Math.max(q.left, sec.left, 0);
              if (vis < 43.5 || q.height < 43.5) {
                out.bad.push(`${cid} ${b.dataset.v}: ${vis.toFixed(1)} x ${q.height.toFixed(1)} `
                  + 'px can be pressed');
              }
            }
            // The scroller: the nearest ancestor that scrolls, else the page.
            let box = svg.parentElement;
            while (box && !(box.scrollHeight > box.clientHeight
              && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
            const scroller = box || document.scrollingElement;
            for (const t of legends) {
              const label = t.textContent;
              // Twice: the first scroll may stick the chip bar, which moves the band.
              for (let k = 0; k < 2; k++) {
                const q0 = t.getBoundingClientRect();
                scroller.scrollBy(0, q0.top + q0.height / 2 - band());
              }
              const q = t.getBoundingClientRect();
              if (q.left < pad.l || q.right > pad.r) {
                out.bad.push(`${cid} "${label}": [${q.left.toFixed(1)}, ${q.right.toFixed(1)}] `
                  + `leaves the plate's [${pad.l.toFixed(1)}, ${pad.r.toFixed(1)}]`);
              }
              // Its radio: the one named by the legend (the radios run in the drawn order, not
              // the legends' option order).
              const want = radios.find((b) => b.textContent === label);
              const hit = document.elementFromPoint((q.left + q.right) / 2,
                (q.top + q.bottom) / 2);
              const got = hit && hit.closest('[data-option][role="radio"]');
              if (!want || got !== want) {
                out.bad.push(`${cid} "${label}": a press lands on `
                  + `${got ? got.dataset.v : (hit ? hit.tagName : 'nothing')}`);
              }
            }
          }
          out.scroll = document.documentElement.scrollWidth > innerWidth + 1;
          return out;
        });
        r.cids.forEach((c) => seen.add(c));
        bad.push(...r.bad.map((x) => `${w} ${tab}: ${x}`));
        if (r.scroll) bad.push(`${w} ${tab}: the page scrolls sideways`);
      }
      await page.close();
    }
    return { ok: bad.length === 0 && seen.size === 16, choices: seen.size, widths,
      bad: bad.slice(0, 12), more: Math.max(0, bad.length - 12) };
  });

  // Review of W1c, finding 1: a slide and a lever draw option 0 at the bottom and their radios
  // run top to bottom, so the keys must move the selection the way the drawing moves. On every
  // slide and lever of every tab, from its bottom option: ArrowUp moves the checked radio's box
  // up, ArrowDown moves it back down, Home checks the top radio and End the bottom one, and
  // focus stays on the checked radio. A key that moves nothing is read after a bounded wait.
  def('s-choicekeys', async ({ context, base }) => {
    const tabs = ['panel', ...['additive', 'fm', 'am', 'wavetable', 'sync', 'perc']
      .map((e) => `engines&ye=${e}`)];
    const bad = [];
    const seen = new Set();
    for (const tab of tabs) {
      const page = await openSynth(context, base, `#m=synth&yt=${tab}`);
      await face(page, 'panel');
      const cids = await page.evaluate(() => [...document.querySelectorAll(
        '[data-osc="synth.panel"] svg[role="radiogroup"]')]
        .filter((g) => (g.dataset.style === 'slide' || g.dataset.style === 'toggle')
          && g.getClientRects().length && g.getAttribute('aria-disabled') !== 'true')
        .map((g) => g.closest('[data-control]').getAttribute('data-control')));
      for (const cid of cids) {
        seen.add(cid);
        // The checked radio, its box's top in the drawing (y, px from the svg's top), the top
        // and bottom radios, and whether focus is on the checked one.
        const state = () => page.evaluate((id) => {
          const radios = [...document.querySelectorAll(`[data-option="${id}"]`)];
          const svg = radios[0].closest('svg');
          const y = (r) => r.getBoundingClientRect().top - svg.getBoundingClientRect().top;
          const byY = [...radios].sort((a, b) => y(a) - y(b));
          const c = radios.find((r) => r.getAttribute('aria-checked') === 'true');
          return { v: c ? c.dataset.v : null, y: c ? Math.round(y(c) * 10) / 10 : null,
            top: byY[0].dataset.v, bottom: byY[byY.length - 1].dataset.v,
            focus: !!c && document.activeElement === c };
        }, cid);
        // Press `key` and wait for the checked option to change; a key that moves nothing is
        // the state after the deadline.
        const press = async (key) => {
          const from = await state();
          await page.keyboard.press(key);
          try {
            return await until(async () => { const s = await state(); return s.v !== from.v
              && s; }, { ms: 1500, what: `${cid}: ${key} moves the choice` });
          } catch (e) {
            if (!(e instanceof WaitTimeout)) throw e;
            return state();
          }
        };
        const s0 = await state();
        await page.locator(`[data-option="${cid}"][data-v="${s0.bottom}"]`).click();
        await until(async () => (await state()).v === s0.bottom,
          { ms: 5000, what: `${cid}: a press on the bottom option checks it` });
        await page.locator(`[data-option="${cid}"][aria-checked="true"]`).focus();
        const a = await state();
        const up = await press('ArrowUp');
        if (!(up.y < a.y)) {
          bad.push(`${cid}: ArrowUp from ${a.v} (y ${a.y}) checked ${up.v} (y ${up.y}), not one `
            + 'drawn above');
        }
        const down = await press('ArrowDown');
        if (!(down.y > up.y)) {
          bad.push(`${cid}: ArrowDown from ${up.v} (y ${up.y}) checked ${down.v} (y ${down.y}), `
            + 'not one drawn below');
        }
        const home = await press('Home');
        if (home.v !== a.top) bad.push(`${cid}: Home checked ${home.v}, not the top ${a.top}`);
        const end = await press('End');
        if (end.v !== a.bottom) {
          bad.push(`${cid}: End checked ${end.v}, not the bottom ${a.bottom}`);
        }
        for (const [k, s] of [['ArrowUp', up], ['ArrowDown', down], ['Home', home], ['End', end]]) {
          if (!s.focus) bad.push(`${cid}: after ${k} focus is not on the checked radio`);
        }
      }
      await page.close();
    }
    return { ok: bad.length === 0 && seen.size === 11, controls: seen.size, bad: bad.slice(0, 14),
      more: Math.max(0, bad.length - 14) };
  });

  def('s-look', async ({ page }) => {
    const look = () => page.evaluate(() => {
      const hex = (c) => {
        const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(c);
        return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
      };
      const paint = (v) => {
        const d = document.createElement('i');
        d.style.color = v;
        document.body.appendChild(d);
        const c = hex(getComputedStyle(d).color);
        d.remove();
        return c;
      };
      const lum = ({ r, g, b }) => [r, g, b].map((x) => {
        const c = x / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (a, b) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      };
      const bay = document.querySelector('[data-osc="synth.bay"]');
      const card = hex(getComputedStyle(bay).backgroundColor);
      const svg = document.querySelector('[data-osc="synth.bay.svg"]');
      // A jack: hit area, focus ring, ring, inner glyph, label (bay.js).
      const leaks = [...svg.querySelectorAll('[data-jack] > :nth-child(1), '
        + '[data-jack] > :nth-child(4)')].concat([...document.querySelectorAll(
        '[data-module] > svg rect')]).filter((el) => getComputedStyle(el).stroke !== 'none')
        .length;
      // The layer's hooks (ui/synth/jack.js, cable.js), never child order.
      const rings = [...svg.querySelectorAll('[data-jack] [data-ring]')]
        .map((el) => ratio(paint(el.getAttribute('stroke')), card));
      const wires = [...svg.querySelectorAll('[data-cable] [data-stroke]')]
        .map((el) => ratio(paint(el.getAttribute('stroke')), card));
      // F013 W1: a nut under every jack, a plug on each cable end, two screws on every plate.
      const PLATE = '[data-osc="synth.panel"] section[data-module]:not([data-osc="synth.bay"])';
      const hw = { nuts: svg.querySelectorAll('[data-nut]').length,
        jacks: svg.querySelectorAll('[data-jack]').length,
        plugs: svg.querySelectorAll('[data-plug]').length,
        plates: document.querySelectorAll(PLATE).length,
        screws: document.querySelectorAll(`${PLATE} [data-screw]`).length };
      const top = paint(getComputedStyle(document.querySelector('[data-osc="synth.panel"]'))
        .getPropertyValue('--osc-surface-3'));
      const labels = [...document.querySelectorAll('[data-module] [id$="-label"]')]
        .map((el) => ratio(hex(getComputedStyle(el).color), top));
      return { card, leaks, ring: Math.min(...rings), wire: Math.min(...wires),
        label: Math.min(...labels), wires: wires.length, hw };
    });
    // One cable from each of the six source colours' modules, so every cable colour is drawn.
    for (const [a, b] of [['keys.velocity', 'vco2.tune'], ['vco1.audio', 'ring.modulator'],
      ['vco2.audio', 'mix.in4'], ['ring.audio', 'mix.in3'], ['noise.audio', 'mix.in1'],
      ['mix.audio', 'vca.audio']]) {
      await tapJack(page, `${a}:out`);
      await tapJack(page, `${b}:in`);
    }
    const themes = {};
    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => {
        if (window.OSCILLA.app.theme !== t) window.OSCILLA.app.toggleTheme();
      }, theme);
      // The bay is redrawn from the theme's tokens: a free jack's ring is --osc-text-dim.
      await until(() => page.evaluate((t) => {
        const doc = document.documentElement;
        const dim = getComputedStyle(doc).getPropertyValue('--osc-text-dim').trim();
        const ring = document.querySelector('[data-jack="out.audio:in"] [data-ring]');
        return doc.dataset.theme === t && ring && ring.getAttribute('stroke') !== null
          && document.querySelector('[data-jack="mg.rate:in"] [data-ring]')
            .getAttribute('stroke') === dim;
      }, theme), { ms: 10000, what: `the ${theme} theme redraws the bay` });
      themes[theme] = await look();
    }
    // Focus: Tab onto a jack shows its ring (opacity 1), and it is hidden otherwise.
    await page.locator('[data-jack="keys.pitch:out"]').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const j = document.activeElement.closest('[data-jack]');
      const ring = j && j.querySelector('[data-focus-ring]');
      const other = document.querySelector('[data-jack]:not(:focus) [data-focus-ring]');
      return { jack: j && j.dataset.jack, on: ring && getComputedStyle(ring).opacity,
        off: other && getComputedStyle(other).opacity };
    });
    // Fold: a card header is a disclosure button.
    await face(page, 'panel');
    await page.locator('[data-collapse="lpf"]').click();
    const fold = await page.evaluate(() => ({
      expanded: document.querySelector('[data-collapse="lpf"]').getAttribute('aria-expanded'),
      knobs: document.querySelectorAll('[data-module="lpf"] [data-knob]').length,
      summary: !!document.querySelector('[data-summary="lpf"]') }));
    await page.locator('[data-fold-all="open"]').click();
    const ok = Object.values(themes).every((t) => t.leaks === 0 && t.ring >= 3 && t.wire >= 3
      && t.label >= 4.5 && t.wires === 6 && t.hw.nuts === t.hw.jacks && t.hw.jacks > 0
      && t.hw.plugs === 12 && t.hw.plates > 0 && t.hw.screws === 2 * t.hw.plates)
      && focus.on === '1' && focus.off === '0'
      && fold.expanded === 'false' && fold.knobs === 0 && fold.summary;
    return { ok, themes, focus, fold };
  });

  def('s-connect', async ({ page }) => {
    await page.locator('[data-jack="mg.control:out"]').focus();
    await page.keyboard.press('Enter');
    const list = await page.evaluate(() => {
      const box = document.querySelector('[data-osc="synth.connect"]');
      const can = document.querySelector('[data-jack="lpf.frequency:in"]').getAttribute(
        'aria-label');
      const no = document.querySelector('[data-jack="mix.in1:in"]').getAttribute('aria-label');
      return { hidden: box.hidden, targets: box.querySelectorAll('[data-connect-to]').length,
        refused: box.querySelectorAll('s').length, can, no };
    });
    await page.locator('[data-connect-to="lpf.frequency:in"]').focus();
    await page.keyboard.press('Enter');
    const d = await dbg(page);
    return { ok: !list.hidden && list.targets > 5 && list.refused > 5
      && /can take the cable/.test(list.can) && /refused: /.test(list.no)
      && d.cables.some((c) => c.from === 'mg.control' && c.to === 'lpf.frequency'), list,
    cables: d.cables };
  });

  def('s-mobile', async ({ page }) => {
    const m = await page.evaluate(() => {
      const small = [...document.querySelectorAll('[data-knob], '
        + '[data-jack] rect:not([data-focus-ring]), [data-osc="synth.view"] button, '
        + '[data-option]')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.width < 43.5 || r.height < 43.5);
      }).map((el) => el.getAttribute('data-knob') || el.getAttribute('data-option')
        || (el.parentNode && el.parentNode.getAttribute && el.parentNode.getAttribute('data-jack')));
      const kb = document.querySelector('[data-osc="keyboard.keys"]').getBoundingClientRect();
      // The text floor (ui/synth/label.js, F013 W1): no plate text below 12 px.
      const tiny = [...document.querySelectorAll('[data-osc="synth.panel"] [data-module] '
        + 'span, [data-osc="synth.panel"] [data-module] output, '
        + '[data-osc="synth.panel"] [data-module] p')]
        .filter((el) => el.getBoundingClientRect().width > 0
          && parseFloat(getComputedStyle(el).fontSize) < 12)
        .map((el) => (el.id || el.className || el.tagName).slice(0, 40));
      return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth,
        small, tiny, kb: { top: kb.top, bottom: kb.bottom, h: window.innerHeight } };
    });
    // The bay face (B2): the whole width under the chip bar, its text 12 px and up, every
    // jack a 44 px target; a module chip brings the cards back.
    await page.locator('[data-face="bay"]').tap();
    const bay = await page.evaluate(() => {
      const svg = document.querySelector('[data-osc="synth.bay.svg"]').getBoundingClientRect();
      const bar = document.querySelector('nav[aria-label="Synth sections"]')
        .getBoundingClientRect();
      const cards = document.querySelector('[data-face-of="panel"]').getBoundingClientRect();
      const fonts = [...document.querySelectorAll('[data-osc="synth.bay.svg"] text')]
        .map((t) => parseFloat(getComputedStyle(t).fontSize));
      const jacks = [...document.querySelectorAll('[data-jack] > rect:first-child')]
        .map((r) => r.getBoundingClientRect()).filter((r) => r.width < 43.5 || r.height < 43.5);
      const labels = [...document.querySelectorAll('[data-jack] text')]
        .map((t) => t.getBoundingClientRect());
      const overlaps = labels.filter((a, i) => labels.some((b, k) => k > i
        && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5
        && b.top < a.bottom - 0.5)).length;
      const card = document.querySelector('[data-osc="synth.bay"]');
      return { width: Math.round(svg.width), card: Math.round(card.clientWidth),
        inner: window.innerWidth,
        gap: Math.round(svg.top - bar.bottom), cardsHidden: cards.height === 0,
        minFont: Math.min(...fonts), small: jacks.length, overlaps,
        pressed: document.querySelector('[data-face="bay"]').getAttribute('aria-pressed') };
    });
    if (!(bay.cardsHidden && bay.card >= bay.inner - 56 && bay.width >= bay.card - 25
      && bay.minFont >= 12 && !bay.small
      && !bay.overlaps && bay.pressed === 'true')) {
      return { ok: false, detail: 'the bay face', bay };
    }
    // No control may be covered (phone-whole): with six cables patched, every jack and every
    // cable end scrolls clear of the dock (the page pads its bottom by --osc-dock-h) and below
    // the chip bar, and a tap there lands on the jack itself (a plug takes no pointer).
    for (const [a, b] of [['keys.velocity', 'vco2.tune'], ['vco1.audio', 'ring.modulator'],
      ['vco2.audio', 'mix.in4'], ['ring.audio', 'mix.in3'], ['noise.audio', 'mix.in1'],
      ['mix.audio', 'vca.audio']]) {
      await tapJack(page, `${a}:out`);
      await tapJack(page, `${b}:in`);
    }
    const reach = await page.evaluate(() => {
      const dock = document.getElementById('osc-keyboard').getBoundingClientRect();
      const bar = document.querySelector('nav[aria-label="Synth sections"]')
        .getBoundingClientRect();
      const svg = document.querySelector('[data-osc="synth.bay.svg"]');
      const ends = [...svg.querySelectorAll('[data-jack]')].map((el) => [el, el])
        .concat([...svg.querySelectorAll('[data-plug] circle:first-child')]
          .map((el) => [el, null]));
      // The scroller: the nearest ancestor that scrolls, else the page. An explicit scroll, as
      // Firefox does not scroll an SVG <g> by scrollIntoView.
      let box = svg.parentElement;
      while (box && !(box.scrollHeight > box.clientHeight
        && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      const scroller = box || document.scrollingElement;
      const covered = [];
      for (const [el, self] of ends) {
        const q = el.getBoundingClientRect();
        scroller.scrollBy(0, q.top + q.height / 2 - (bar.bottom + dock.top) / 2);
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const jack = hit && hit.closest('[data-jack]');
        if (r.bottom > dock.top || r.top < bar.bottom || !jack || (self && jack !== self)) {
          covered.push((self || el.parentNode).getAttribute('data-jack') || 'plug');
        }
      }
      return { ends: ends.length, covered, dock: Math.round(dock.height) };
    });
    if (reach.ends !== 62 + 12 || reach.covered.length) {
      return { ok: false, detail: 'a jack or a cable end stays under the dock', reach };
    }
    await page.locator('[data-goto="lpf"]').tap();
    const chip = await page.evaluate(() => {
      const h = document.querySelector('#synth-m-lpf').getBoundingClientRect();
      const bar = document.querySelector('nav[aria-label="Synth sections"]')
        .getBoundingClientRect();
      const hit = document.elementFromPoint(h.left + 4, h.top + h.height / 2);
      return { top: Math.round(h.top), bar: Math.round(bar.bottom),
        visible: !!hit && hit.closest('[data-module]') !== null
          && hit.closest('[data-module]').getAttribute('data-module') === 'lpf' };
    });
    if (!chip.visible) return { ok: false, detail: 'the LPF chip hides its heading', chip };
    const box = await page.locator('[data-osc="keyboard.keys"]').boundingBox();
    await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.85);
    await page.mouse.down();
    const p = await sound(page, (q) => q.rmsDb > -45, 'a press on the docked keys sounds');
    await page.mouse.up();
    await silent(page, 'releasing the key silences it');
    return { ok: m.scroll <= m.inner && m.small.length === 0 && m.tiny.length === 0
      && m.kb.bottom <= m.kb.h
      && m.kb.top > 0, ...m, bay, reach, chip, rmsDb: p.rmsDb };
  });
  return checks;
}

// ------------------------------------------------------------------------------ runner
/** Does check `name` run at `sizeName` under the --only selection? */
const runsAt = (name, sizeName) => (!ONLY || ONLY.has(name))
  && (sizeName === 'phone' ? PHONE_CHECKS.has(name)
    : !['s-mobile', 's-touchpatch'].includes(name));

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
        const own = ['s-midi', 's-link'].includes(name);
        const page = own ? null : await openSynth(context, base);
        const v = await bounded(fn({ page, context, base, size: sizeName, browserName }),
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
  // --only names checks of this suite; a size none of them runs at is not a leg (a desktop
  // check selected alone ran a phone leg of 0 checks, which the harness fails).
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
  const server = RUN.origins.includes('http') ? await serveDist(DIST, { prefix: 'oscilla-synth-' })
    : null;
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
          console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/synth: ${names.length
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

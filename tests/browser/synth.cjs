#!/usr/bin/env node
// suite-pace: solo (synth voices judged by level and pitch on the realtime analyser with deadlines)
// OSCILLA Synth workspace (plan K058-K066, K103 part, K104, K106 part) on the built
// dist/index.html in chromium, firefox and webkit, at 1536 x 1024 and 390 x 844. Every check
// asserts the sound, read from the engine's analyser after the safety chain (RMS, spectrum
// peaks at the expected frequencies) or the engine and runtime node census, never the DOM alone.
//
//   node tests/browser/synth.cjs [--browsers chromium,firefox,webkit] [--origins file,http]
//        [--only s-sound,s-filter]
//
// The default Synth document has no cable (K220: pad L's typed normals drive the filters; K183's
// Y cable into LPF Cutoff is no longer patched): every count of cables, wires, plugs and cable
// ends below is the check's own.
//
// Checks (desktop leg; the phone leg runs s-sound, s-cable and s-mobile):
//   s-sound    no cable: QWERTY A plays C4, VCO 1 at 16' and VCO 2 at 8' (peaks at 130.8 and
//              261.6 Hz within one bin, RMS above -40 dB rel); key up: below -70 dB rel
//   s-filter   LPF cutoff to its minimum by keyboard (Home): the energy above 2 kHz falls 12 dB+
//   s-feel     the knob and choice feel (p2's W1b review): during a drag the ARIA position is the
//              0..1000 travel; Shift mid-drag moves nothing; a double-click restores the initial
//              value; the wheel turns the knob under the pointer, a burst one undo entry;
//              Ctrl+wheel (the page's pinch, K205) turns nothing, opens no undo entry and is not
//              preventDefault'ed (the browser's zoom, WCAG 1.4.4, is not blocked), judged by a
//              plain sentinel notch after it that lands exactly one notch past it;
//              arrows, Home and End move a choice (a rotary: its radios are in option order)
//              and focus stays on the checked option; a
//              double-click on a disabled knob changes nothing, and a cancelled pointer on a
//              jack is neither a tap nor a drop, the jack taking its touches (21's S13, S9)
//   s-wave     Square on VCO 1 (VCO 2 muted): the 2nd harmonic 30 dB+ below the 3rd; Pulse with a
//              typed width of 25 %: the 4th harmonic 30 dB+ below the 3rd
//   s-rest     armed with no key held (Arm, no note), a cable from EG 1 into the VCA: below
//              -70 dB rel over 0.5 s of audio time (no drone; the transport closes the
//              Keys-gated envelopes at arm, and an EG cable rests at 0)
//   s-dadsr    K230 (desktop and phone): EG 1's Delay turns by a pointer drag (a touch drag on
//              the phone: a trusted one through CDP in chromium; firefox and webkit drive no held
//              trusted touch, so there the phone leg drags with the pointer) and EG 2's Hold by
//              ArrowUp, each one undo entry; with EG 1 patched into the VCA and its Delay typed
//              0.6 s, a held key stays below -70 dB rel for 0.4 s of audio time and then sounds
//              (named deadlines); the Studio graph's EG cards and the Inspector show the Delay
//              and the Hold at the revision the Synth left
//   s-mg       K229 (desktop and phone): the MG's Key sync toggles by pointer (a tap on the
//              phone) and keyboard, its Sync division by pointer (tap) and ArrowRight, its Morph
//              knob by a pointer drag (a CDP touch drag on the chromium phone leg, the pointer
//              in firefox and webkit) and ArrowUp, each one undo entry; with Key sync on, Sync
//              off and Rate 0.5 Hz, a scope probe (an AnalyserNode on the MG's control output)
//              reads after each of two key presses the triangle at the phase since that press's
//              reset within 0.05, more than 0.15 from the phase since the first (named
//              deadlines); the Studio graph's MG card, its
//              Keys Gate edge and the Inspector show the values at the Synth's revision
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
//   s-linkprops Copy link carries a cable's own props (review S7): MG patched into LPF cutoff,
//              that edge set unipolar with offset 0.25 (the Studio Inspector's EDGE_UPDATE):
//              the copied link opened in a new page holds the cable with the same props.
//              Fails on 3c22d01a (bipolar, offset 0 there)
//   s-knobmemory a knob a cable broke keeps its depth in the model (review S10): LPF EG 2 ->
//              cutoff typed 3.5, MG patched into LPF cutoff (it breaks that knob's normal): the
//              document remembers 3.5 (metadata.synthAmounts); Copy link opened in a new page,
//              the cable removed there: the EG 2 normal is back at 3.5 and the knob reads 3.50.
//              Fails on 3c22d01a (the receiver brings it back at its declared 2)
//   s-studio   Open in Studio: #m=studio, the panel's nodes selected, the same revision
//   s-escape   Escape releases a held note; leaving the workspace disarms: runtime census 0
//   s-connect-escape K236 (329 R6): a pending connect from MG CV, its connection list shown,
//              then Escape: the list is hidden with no Patch button left, and Enter on LPF
//              Cutoff starts a new connect from there instead of patching MG into it.
//              Fails on c4a5d77a (the list stays open and the stale jack still connects)
//   s-tap      K184: 20 QWERTY taps whose key-down and key-up share one task each sound
//   s-armstop  the Arm button follows the transport (review S1): Arm, then a transport Stop
//              made outside the Synth while it is shown (page hide; before any Studio visit):
//              the button reads Arm and Arm arms; Arm, the Studio and its Stop, back to the
//              Synth: it reads Arm, Arm arms and a key sounds. Fails on 9cf786ac (Disarm stays)
//   s-armed    K104 (desktop and phone): Arm by pointer (a tap on the phone) stops a playing
//              Playground voice and checks the role=switch; Enter and Space on it disarm and
//              arm, Escape disarms; armed and stopped, QWERTY A is held on the running Keys
//              node and sounds. Desktop: leaving the Synth disarms (census 0); in the Studio a
//              key arms it and the transport bar's armed indicator shows, PLAY plays, and STOP
//              leaves the keys armed (indicator and Synth state) with A still sounding (the
//              owner's 'STOP keeps it armed', 2026-11-03); leaving the Studio disarms it
//   s-svs      K226: a step-voltage sequencer on the panel's Keys Gate, row A into VCO 1's pitch;
//              while the Studio plays, the Inspector's Krok button by pointer (tap on the phone)
//              and keyboard steps it: each press says its step (Krok 1, 2, 3; a lost or refused
//              one fails there, with what the Inspector said) and the running CV holds each
//              step's value (named deadline); the timeline loops while it runs (R2-T5-7: the
//              default document plays 3 s, shorter than the deadlines), undone after
//   s-steps    K221 (desktop and phone): no strip by default; the dock's picker lists
//              Krokový sekvencer, and Enter on it adds the strip in one undo entry, shown above
//              the face; a pointer on step 3 (a tap on the phone) puts its note (beat 0.5, C4)
//              in the strip's notes clip on the panel's Keys; while the Studio plays the strip's
//              playing step shows and moves; no horizontal page scroll; the strip is the
//              step-grid kind (data-step-grid notes and its grid surface), as in drums dr-mount
//   s-libinsert K225 (desktop and phone): in a changed document without the panel, the Synth's
//              Library (the Studio's one patch library) inserts the panel from its Bass preset by
//              pointer (a tap on the phone), one undo entry, the status naming the Master feed it
//              took; after Undo, Enter on Bass in the listbox inserts it again (LPF at 180 Hz); the
//              Studio graph draws its nodes and normal edges, and armed, a key sounds
//   s-normals  K214 (desktop and phone): in a changed document Insert puts the panel in by
//              pointer (a tap on the phone) and, after Undo, by keyboard; the Studio graph draws
//              its nodes and normal edges; VCO 2 Pitch's normal deleted in the Studio stays
//              deleted, the Synth shows the jack open and Restore normal brings it back with its
//              id in one history entry, announced in the polite live region (fails on c589955b);
//              armed, a Studio cable beside the normal sums with it, and Break normal drops the
//              normal from the runtime edge list while the cable stays active and the voice sounds
//   s-xyengine an XY preset writes only the voice it plays (review S6): drawbar 1 of the
//              additive engine set by Home, then XY bass from the Preset menu (one undo entry,
//              the pad in D Dorian): the drawbar keeps its value in the model and on its face.
//              Fails on 9cf786ac (the drawbar is back at 1.00)
//   s-chiprelease a note-off releases the node its note-on played (review S3): on the Engines
//              tab the keys routed to FM, QWERTY A held, the ADDITIVE chip clicked (the tab
//              and engine unchanged, the route cleared), A up: below -70 dB rel and no held
//              note. Fails on 3c22d01a (the FM voice stays held)
//   s-radioroute the engine radio reads the model's route (review S4): on the Engines tab the
//              keys routed to FM (the dock's choice): FM is the one checked engine and its
//              plate is shown, not ADDITIVE's; QWERTY A sounds and its release falls below
//              -70 dB rel. Fails on 3c22d01a (ADDITIVE checked while the keys play FM)
//   s-newvoice New Synth voice keeps the insert contract (review S5): the workspace's insert
//              undone and a node of the user's added (Insert is offered), the dock's New Synth
//              voice says the Master feed it took and places every node it adds below the
//              user's; A sounds and its release falls below -70 dB rel. Fails on 3c22d01a
//              ("The keys play KEYBOARD.", the panel at the top)
//   s-keysilent a keyboard the pad's cables silenced says why (review S8): XY lead from the
//              Preset menu cables Y alone (K183 review F3) and QWERTY A still sounds (RMS above
//              -40 dB rel); the check then taps the pad's Gate into EG 1 and EG 2 itself, and
//              after the Panel tab's Init the tab shows why the keys sound nothing with Unpatch
//              the pad; A stays below -70 dB rel and the status says why; Unpatch the pad
//              removes the pad's cables and the notice, and A sounds again (RMS above -40 dB
//              rel). Fails on 3c22d01a (no notice, a silent key says nothing)
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
//   s-choicekeys every slide and lever (10 on the tabs since K229 fixed the MG's shape lever), from
//              its bottom option: ArrowUp moves
//              the checked radio's box up (a smaller y), ArrowDown moves it down, Home checks
//              the top radio and End the bottom one, focus on the checked radio, in the drawn
//              order its radios run in (review of W1c, finding 1). It needs choiceKey
//              (src/js/synth/gestures.js) to read the host svg's data-style: on toggle and
//              slide, ArrowUp +1 option, ArrowDown -1, Home and End the first and last radio
//   s-connect  Enter on a jack opens the connection list (targets, refused ones with reasons);
//              choosing a target patches; the jack names say which can take the cable
//   s-dock     K066, beside the piano: the instrument picker is a menu button whose role=menu
//              lists every notes node (9, both XY pads too) and New Synth voice; arrows and
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
//   s-pads     K220 (desktop and phone): the PADY card under the Panel face holds pad L beside
//              pad R at 1536 px; at 390 px one pad at a time, chosen by the L/R toggle (44 px
//              buttons, review R2-K220-2); ArrowRight on pad L moves its X
//              (aria-valuenow); Tónina D beside pad R is one undo entry and pad R's node plays D;
//              with QWERTY A held (VCO 2 silent, E059), a press on pad L's right edge opens the
//              low-pass (the 6-12 kHz band against C4, each reading settled on the audio clock,
//              6 dB+ over pad L at rest) and its release closes it again (within 1.5 dB); a
//              held press on pad L and one on pad R are released by a transport Stop
//              (aria-pressed false), and pad R's release is silent; pad R's Y is heard as
//              velocity (review R2-K220-1): a note at Y 95 % 6 dB+ over Y 5 %, each settled
//   s-gateclip K220 review R2-K220-5: a Keys gate clip (K060) on the panel's Keys, which plays no
//              note, is heard through VELOCITY (RMS above -45 dB rel; the velocity rests at 100)
//              and the transport's Stop silences it (below -70 dB rel)
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
const { watchTaps, markTap } = require('./lib/tap-meter.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist', 'index.html');
/** Every jack the panel declares (its modules' jacksOf), read from the source, not the page. */
const panelJacks = () => import(pathToFileURL(path.join(ROOT, 'src', 'js', 'synth', 'panels',
  'semi-mono.js')).href).then(({ default: p }) => p.modules
  .reduce((n, m) => n + p.jacksOf(m.id).length, 0));
const RUN = suite.open({ name: 'synth', browsers: arg('browsers'), origins: arg('origins'),
  defaultOrigins: ['file'] });
const playwright = RUN.playwright;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false,
    // s-feel's pinch (Ctrl+wheel, R8) zooms the browser; Firefox would keep that zoom for the
    // site in every later context of this browser and every later click would miss
    'browser.zoom.siteSpecific': false } },
  webkit: {},
};
const SIZES = { desktop: { width: 1536, height: 1024 }, phone: { width: 390, height: 844 } };
const PHONE_CHECKS = new Set(['s-sound', 's-cable', 's-mobile', 's-look', 's-dock',
  's-library', 's-choices', 's-armed', 's-normals', 's-steps', 's-libinsert', 's-dadsr', 's-mg', 's-pads']);
const LOAD_MS = 60000;
const SOUND_MS = 8000; // a note's attack, a knob change's glide and the analyser's smoothing
const CHECK_MS = 120000;
const C4 = 261.6256;
// The FM engine at its Init values sounds C4 at about -55 dB rel (measured in chromium on the
// Mac, 48 kHz): heard is 6 dB below that, still 9 dB above the release's -70 dB rel.
const FM_HEARD_DB = -61;
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
// The default Synth document's cables: none since K220 (the panel's insertion patches nothing;
// pad L's X and Y are normals). The checks below count the cables they patch beside them.
const DEFAULT_CABLES = 0;
const own = (d) => d.cables;
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
/** The running graph (if any) is the store's current revision: an edit has reached the audio
 *  before a key is judged against it (a loaded host applies a little after the dispatch). */
const settled = (page, what) => until(() => page.evaluate(() => {
  const a = window.OSCILLA.studio.runtime.applied();
  return !a || a.revision === window.OSCILLA.studio.store.getRevision();
}), { ms: 10000, what });
const SETTLE_SPAN_S = 0.5; // of audio clock between the two readings that agree
const SETTLE_DB = 0.25;
/**
 * `measure(probe)` once it holds on the audio clock: two readings SETTLE_SPAN_S of context time
 * apart within SETTLE_DB (an envelope still moving the filter is not a reading of the pad).
 */
async function settledOn(page, measure, what) {
  let prev = null;
  let now = null;
  await until(async () => {
    const q = await read(page);
    now = measure(q);
    if (!prev) {
      prev = { t: q.t, v: now };
      return false;
    }
    if (q.t - prev.t < SETTLE_SPAN_S) return false;
    const same = Math.abs(now - prev.v) < SETTLE_DB;
    prev = { t: q.t, v: now };
    return same;
  }, { ms: SOUND_MS, what: `${what} (two readings ${SETTLE_SPAN_S} s of audio clock apart within `
    + `${SETTLE_DB} dB)` });
  return now;
}

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

  // K230: EG 1's Delay and EG 2's Hold on the face, heard and shown in the Studio.
  def('s-dadsr', async ({ page, size }) => {
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    const param = (cid) => page.evaluate((c) => {
      const [m, k] = c.split('.');
      const id = window.OSCILLA.app.synthDebug().nodes[m];
      const n = window.OSCILLA.studio.store.getModel().graph.nodes.find((x) => x.id === id);
      return n ? n.params[k] : null;
    }, cid);
    const out = {};
    await face(page, 'panel');
    // The Delay by a drag: the pointer, or a finger on the phone.
    const delay = knob(page, 'eg1.delay');
    await delay.scrollIntoViewIfNeeded();
    const b = await delay.boundingBox();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const d0 = await depth();
    const chromium = page.context().browser().browserType().name() === 'chromium';
    if (size === 'phone' && chromium) {
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: cx, y }] });
      await touch('touchStart', cy);
      for (let i = 1; i <= 6; i++) await touch('touchMove', cy - 10 * i);
      await touch('touchEnd');
      out.drag = 'touch (CDP)';
    } else {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 60, { steps: 6 });
      await page.mouse.up();
      out.drag = 'pointer';
    }
    await until(async () => (await param('eg1.delay')) > 0, { ms: 5000,
      what: `a ${out.drag} drag turns EG 1's Delay up from 0` });
    await until(async () => (await depth()) === d0 + 1, { ms: 5000,
      what: 'the Delay drag is one undo entry' });
    out.dragged = await param('eg1.delay');
    // The Hold by keyboard.
    const h0 = await depth();
    await keyKnob(page, 'eg2.hold', 'ArrowUp');
    await until(async () => (await param('eg2.hold')) > 0, { ms: 5000,
      what: 'ArrowUp turns EG 2\'s Hold up from 0' });
    await until(async () => (await depth()) === h0 + 1, { ms: 5000,
      what: 'the Hold key is one undo entry' });
    out.hold = await param('eg2.hold');
    // Heard: EG 1 into the VCA (it breaks EG 2's normal), its Delay typed 0.6 s.
    await typeKnob(page, 'eg1.delay', '0.6');
    await until(async () => (await param('eg1.delay')) === 0.6, { ms: 5000,
      what: 'the Delay typed 0.6 s' });
    await tapJack(page, 'eg1.control:out');
    await tapJack(page, 'vca.gain:in');
    const d = await dbg(page);
    if (!d.cables.some((c) => c.from === 'eg1.control' && c.to === 'vca.gain')) {
      return { ok: false, detail: 'EG 1 into the VCA is not patched', cables: d.cables };
    }
    await settled(page, 'the running graph has EG 1 into the VCA and the Delay');
    await hold(page, 'KeyA');
    out.during = await quiet(page, -70, 0.4, 'a key held through the Delay stays silent');
    const p = await sound(page, (q) => q.rmsDb > -50, 'the key sounds after the Delay');
    out.after = p.rmsDb;
    await page.keyboard.up('KeyA');
    await silent(page, 'the note releases below -70 dB rel');
    // Shown in the Studio graph and Inspector at the Synth's revision.
    const rev = await page.evaluate(() => window.OSCILLA.studio.store.getRevision());
    const [delayS, holdS] = [await param('eg1.delay'), await param('eg2.hold')];
    await page.locator('[data-osc="synth.studio"]').click();
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'studio'),
      { ms: 10000, what: 'Studio opens' });
    const sum = (id) => page.locator(`[data-node-id="${id}"] .osc-sg-sum`).textContent()
      .catch(() => '');
    const ms = (v) => `${Math.round(v * 1000)} ms`;
    const graph = page.locator('[data-osc="studio.subview"][data-value="graph"]');
    if (await graph.isVisible()) await graph.click();
    await until(async () => (await sum(d.nodes.eg1)).includes(`Zp ${ms(delayS)}`)
      && (await sum(d.nodes.eg2)).includes(`V ${ms(holdS)}`), { ms: 10000,
      what: 'the graph cards show EG 1\'s Delay and EG 2\'s Hold' });
    out.cards = [await sum(d.nodes.eg1), await sum(d.nodes.eg2)];
    const tab = page.locator('[data-osc="studio.subview"][data-value="inspector"]');
    const field = (key) => page.locator(`[data-osc="studio.inspector.param"][data-key="${key}"]`)
      .inputValue().catch(() => '');
    const shows = async (id, key, v) => {
      await page.evaluate((n) => window.OSCILLA.studio.store.dispatch({ type: 'SELECTION_CHANGE',
        selection: { nodes: [n] } }), id);
      if (await tab.isVisible()) await tab.click();
      await until(async () => Math.abs(Number((await field(key)).replace(',', '.')) - v) < 1e-9,
        { ms: 10000, what: `the Inspector shows ${key} ${v} s` });
      return field(key);
    };
    out.inspector = [await shows(d.nodes.eg1, 'delay', delayS),
      await shows(d.nodes.eg2, 'hold', holdS)];
    out.sameRevision = rev === await page.evaluate(() => window.OSCILLA.studio.store
      .getRevision());
    return { ok: out.sameRevision, ...out };
  });

  // K229: the MG's Key sync, Sync division and Morph on the face, the restart in a scope probe.
  def('s-mg', async ({ page, size }) => {
    const press = (loc) => (size === 'phone' ? loc.tap() : loc.click());
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    const mgParam = (k) => page.evaluate((key) => {
      const id = window.OSCILLA.app.synthDebug().nodes.mg;
      return window.OSCILLA.studio.store.getModel().graph.nodes.find((x) => x.id === id)
        .params[key];
    }, k);
    const keyed = () => page.evaluate(() => {
      const n = window.OSCILLA.app.synthDebug().nodes;
      return window.OSCILLA.studio.store.getModel().graph.edges.filter((e) => e.from.node
        === n.keys && e.from.port === 'gate' && e.to.node === n.mg && e.to.port === 'reset')
        .length;
    });
    const oneEntry = async (d0, what) => until(async () => (await depth()) === d0 + 1,
      { ms: 5000, what: `${what} is one undo entry` });
    const out = {};
    await face(page, 'panel');
    // Key sync: on by pointer (tap), off and on again by keyboard.
    const sync = page.locator('[data-toggle="mg.keysync"]');
    await sync.scrollIntoViewIfNeeded();
    let d0 = await depth();
    await press(sync);
    await until(async () => (await keyed()) === 1, { ms: 5000,
      what: 'Key sync on patches the Keys Gate into the MG reset' });
    await oneEntry(d0, 'Key sync on');
    d0 = await depth();
    await page.locator('[data-toggle="mg.keysync"]').focus();
    await page.keyboard.press('Enter');
    await until(async () => (await keyed()) === 0, { ms: 5000, what: 'Enter turns Key sync off' });
    await oneEntry(d0, 'Key sync off');
    await page.locator('[data-toggle="mg.keysync"]').focus();
    await page.keyboard.press('Space');
    await until(async () => (await keyed()) === 1, { ms: 5000, what: 'Space turns Key sync on' });
    out.pressed = await page.locator('[data-toggle="mg.keysync"]').getAttribute('aria-pressed');
    // Sync: 1/4 by pointer (tap), the next division by ArrowRight.
    d0 = await depth();
    await press(page.locator('[data-option="mg.sync"][data-v="1/4"]'));
    await until(async () => (await mgParam('sync')) === '1/4', { ms: 5000,
      what: 'a press on 1/4 syncs the MG' });
    await oneEntry(d0, 'the Sync press');
    await page.locator('[data-option="mg.sync"][aria-checked="true"]').focus();
    await page.keyboard.press('ArrowRight');
    await until(async () => !['off', '1/4'].includes(await mgParam('sync')), { ms: 5000,
      what: 'ArrowRight moves the Sync division' });
    out.sync = await mgParam('sync');
    // Morph: a drag (the pointer, or a finger on the phone), then ArrowUp.
    const morph = knob(page, 'mg.morph');
    await morph.scrollIntoViewIfNeeded();
    const b = await morph.boundingBox();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    d0 = await depth();
    const chromium = page.context().browser().browserType().name() === 'chromium';
    if (size === 'phone' && chromium) {
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: cx, y }] });
      await touch('touchStart', cy);
      for (let i = 1; i <= 4; i++) await touch('touchMove', cy - 10 * i);
      await touch('touchEnd');
      out.drag = 'touch (CDP)';
    } else {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 40, { steps: 4 });
      await page.mouse.up();
      out.drag = 'pointer';
    }
    await until(async () => (await mgParam('morph')) > 0, { ms: 5000,
      what: `a ${out.drag} drag turns Morph up from 0` });
    await oneEntry(d0, 'the Morph drag');
    const m1 = await mgParam('morph');
    await keyKnob(page, 'mg.morph', 'ArrowUp');
    await until(async () => (await mgParam('morph')) > m1, { ms: 5000,
      what: 'ArrowUp turns Morph up' });
    out.morph = await mgParam('morph');
    // Shown in the Studio at the Synth's revision.
    const rev = await page.evaluate(() => window.OSCILLA.studio.store.getRevision());
    const ids = (await dbg(page)).nodes;
    await page.locator('[data-osc="synth.studio"]').click();
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'studio'),
      { ms: 10000, what: 'Studio opens' });
    const graph = page.locator('[data-osc="studio.subview"][data-value="graph"]');
    if (await graph.isVisible()) await graph.click();
    const pctText = `${Math.round(out.morph * 100)} %`;
    const card = () => page.locator(`[data-node-id="${ids.mg}"] .osc-sg-sum`).textContent()
      .catch(() => '');
    await until(async () => { const t = await card(); return t.includes(out.sync)
      && t.includes(pctText); }, { ms: 10000,
    what: 'the graph card shows the MG\'s Sync division and Morph' });
    out.card = await card();
    const tab = page.locator('[data-osc="studio.subview"][data-value="inspector"]');
    await page.evaluate((n) => window.OSCILLA.studio.store.dispatch({ type: 'SELECTION_CHANGE',
      selection: { nodes: [n] } }), ids.mg);
    if (await tab.isVisible()) await tab.click();
    const field = (key) => page.locator(`[data-osc="studio.inspector.param"][data-key="${key}"]`)
      .inputValue().catch(() => '');
    await until(async () => Math.abs(Number((await field('morph')).replace(',', '.'))
      - out.morph) < 1e-9 && (await field('sync')) === out.sync, { ms: 10000,
    what: 'the Inspector shows the MG\'s Morph and Sync' });
    out.inspector = [await field('morph'), await field('sync')];
    out.sameRevision = rev === await page.evaluate(() => window.OSCILLA.studio.store
      .getRevision());
    out.edge = await keyed();
    // The restart, heard in a scope probe: Sync off, Rate 0.5 Hz, Morph 0 (the triangle).
    await page.evaluate(() => { window.location.hash = '#m=synth'; });
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'synth'),
      { ms: 10000, what: 'back in the Synth' });
    await face(page, 'panel');
    await page.evaluate((id) => {
      const st = window.OSCILLA.studio.store;
      st.dispatch({ type: 'NODE_PARAM_SET', nodeId: id, params: { sync: 'off', rate: 0.5,
        morph: 0 } });
    }, ids.mg);
    const scope = (id) => page.evaluate((nid) => {
      const e = window.OSCILLA.engine;
      const h = window.OSCILLA.studio.runtime.nodes.get(nid);
      // The Synth builds its graph at the first key: until then there is nothing to probe.
      if (!h || !h.info || typeof h.info.voices !== 'function') return null;
      if (!window.__mgScope || window.__mgScope.h !== h) {
        if (window.__mgScope) window.__mgScope.a.disconnect();
        const a = e.ctx.createAnalyser();
        a.fftSize = 256;
        h.outputs.control.connect(a);
        window.__mgScope = { a, h, at: e.ctx.currentTime };
      }
      const s = window.__mgScope;
      const buf = new Float32Array(s.a.fftSize);
      s.a.getFloatTimeDomainData(buf);
      // Ready once the clock has run two analysis windows past the probe's connection.
      return { t: e.ctx.currentTime, v: buf[buf.length - 1],
        ready: e.ctx.currentTime > s.at + (2 * s.a.fftSize) / e.ctx.sampleRate,
        starts: h.info.voices().map((x) => x.start) };
    }, id);
    const tri = (p) => { const x = p - Math.floor(p); return x < 0.25 ? 4 * x
      : x < 0.75 ? 2 - 4 * x : 4 * x - 4; };
    const pressOnce = async (n) => {
      const s0 = await scope(ids.mg);
      const before = s0 ? s0.starts.at(-1) : -Infinity;
      await hold(page, 'KeyA');
      const r = await until(async () => { const q = await scope(ids.mg); return q && q.ready
        && q.starts.at(-1) > before && q.t > q.starts.at(-1) + 0.02 ? q : null; }, { ms: 5000,
      what: `key press ${n} restarts the MG (a voice from its reset, Key sync on)` });
      await page.keyboard.up('KeyA');
      return { ...r, reset: r.starts.at(-1), since: tri((r.t - r.starts.at(-1)) * 0.5) };
    };
    await settled(page, 'the running graph has the MG at Sync off, Rate 0.5 Hz, Morph 0');
    const first = await pressOnce(1);
    // The second press a quarter period (0.5 s) or more after the first: read within 0.2 s of
    // its reset (phase p <= 0.1), the triangle since it is 4p and since the first 1 - 4p or
    // beyond, at least 0.2 apart.
    await until(async () => (await scope(ids.mg)).t > first.reset + 0.5, { ms: 5000,
      what: 'the audio clock runs on 0.5 s' });
    const second = await pressOnce(2);
    // Had the MG run on from the first press's reset, it would read this phase instead.
    second.sinceFirst = tri((second.t - first.reset) * 0.5);
    // 0.05: 25 ms of the triangle's slope, the analyser's newest sample behind the clock.
    const near = (q) => Math.abs(q.v - q.since) <= 0.05;
    out.scope = [first, second].map((q) => ({ v: q.v, reset: q.reset, t: q.t, since: q.since,
      sinceFirst: q.sinceFirst }));
    await page.evaluate(() => { const s = window.__mgScope; if (s) s.a.disconnect(); });
    const restarted = near(first) && near(second)
      && Math.abs(second.v - second.sinceFirst) > 0.15
      && second.t - second.reset <= 0.2;
    return { ok: out.sameRevision && out.edge === 1 && out.pressed === 'true' && restarted,
      restarted, ...out };
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
    // E069: the knob's centre is read where it has settled, before every gesture. Under load the
    // page was still scrolling after scrollIntoViewIfNeeded, so a centre read once at the start
    // went stale (the knob moved 40-100 px) and a wheel at it hit the value readout or a button,
    // scrolled the page further, and never reached the knob. Two reads that agree, with the knob
    // itself under the point, are the settled centre.
    let cx = 0;
    let cy = 0;
    let seen = null;
    const settle = (what) => until(async () => {
      const b = await knob.boundingBox();
      const c = b && { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      const same = c && seen && Math.abs(c.x - seen.x) < 0.5 && Math.abs(c.y - seen.y) < 0.5;
      seen = c;
      if (!same) return null;
      const onKnob = await page.evaluate(([x, y]) => {
        const k = document.querySelector('[data-knob="lpf.frequency"]');
        const at = document.elementFromPoint(x, y);
        return !!(k && at && k.contains(at));
      }, [c.x, c.y]);
      if (!onKnob) return null;
      cx = c.x;
      cy = c.y;
      return c;
    }, { ms: 5000, what: `s-feel: the knob has settled under the pointer (${what})` });
    await settle('the drag');
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
    await settle('the double-click');
    await page.mouse.move(cx, cy);
    await knob.dblclick();
    await until(async () => (await pos()).text === start.text, { ms: 5000,
      what: 'a double-click restores the initial value' });
    // The wheel turns the knob under the pointer; a burst is one undo entry.
    const before = await depth();
    const w0 = (await pos()).now;
    // E069: both notches go in one page task. A burst ends GESTURE_IDLE_MS (400 ms) after its
    // last notch, and two mouse.wheel round trips under load came farther apart than that: the
    // product rightly made two entries, the poll below caught the instant between their commits,
    // and the second burst, still open, landed inside the notch+drag window (d0 + 3).
    await knob.evaluate((k) => {
      for (let i = 0; i < 2; i += 1) {
        k.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, bubbles: true,
          cancelable: true }));
      }
    });
    await until(async () => (await pos()).now > w0, { ms: 5000, what: 'the wheel turns it' });
    await until(async () => (await depth()) === before + 1, { ms: 5000,
      what: 'a wheel burst is one undo entry' });
    // 21's R3: a drag right after a wheel notch is its own undo entry (the burst is flushed),
    // and R8: a pinch (Ctrl+wheel) is the page's and leaves the knob alone.
    // E059: the drag starts only once the notch has landed (the knob moved): a pointerdown that
    // overtook the notch opened the drag first, the late notch folded into the drag's gesture,
    // and the two entries were one (#490, CI WebKit). The wait used to read `!== w0 || true`,
    // true at once.
    const d0 = await depth();
    const n0 = (await pos()).now;
    await settle('the notch');
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -100);
    await until(async () => (await pos()).now !== n0, { ms: 5000,
      what: 'the notch lands (the knob moves) before the drag' });
    const notch = (await pos()).now - n0; // one plain notch, in ARIA positions
    await page.mouse.down();
    await page.mouse.move(cx, cy + 30, { steps: 3 });
    await page.mouse.up();
    await until(async () => (await depth()) === d0 + 2, { ms: 5000,
      what: 'the wheel burst and the drag are two undo entries' });
    // K205: the pinch is judged once it has certainly been handled. A plain notch follows it as
    // a sentinel (wheel events reach the page in order): when the sentinel has landed, the knob
    // is exactly one notch past p0 and history one entry deeper, so the Ctrl+wheel before it
    // turned nothing and opened nothing. Read at once, as before, it proved nothing.
    const p0 = (await pos()).now;
    const h0 = await depth();
    // K205 as restated (oscilla-43, 2026-11-09): the pinch is left to the browser, whose zoom is
    // an accessibility feature (WCAG 1.4.4) and is not asserted. A listener on window, which the
    // event reaches last, records whether anything took it from the browser.
    await page.evaluate(() => {
      window.__pinch = [];
      window.addEventListener('wheel', (e) => {
        if (e.ctrlKey) window.__pinch.push(e.defaultPrevented);
      });
    });
    await settle('the pinch');
    await page.mouse.move(cx, cy);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    // The sentinel goes to the knob itself: Chromium and WebKit act on the pinch (the zoom it
    // is left for), so the pointer's old coordinates may no longer be over the knob.
    await knob.dispatchEvent('wheel', { deltaY: -100, deltaMode: 0, bubbles: true,
      cancelable: true });
    const { now: sentinel } = await until(async () => {
      const now = (await pos()).now;
      return now !== p0 ? { now } : null; // an object: a position of 0 is a landing too
    }, { ms: 5000, what: 'the plain notch after the pinch lands' });
    await until(async () => (await depth()) === h0 + 1, { ms: 5000,
      what: 'the pinch opened no undo entry, the sentinel notch one' });
    const pinch = sentinel - notch; // the knob as the pinch left it
    const pinchPrevented = await page.evaluate(() => window.__pinch);
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
      && pinch === p0 && notch !== 0 && pinchPrevented.length === 1 && pinchPrevented[0] === false;
    return { ok, start, mid, fine, disabled, wa, wb, cancel, pinch, p0, notch, pinchPrevented };
  });

  // K220: the two performance pads under the face (synth.pads.l.pad, synth.pads.r.scale)
  def('s-pads', async ({ page, size }) => {
    await face(page, 'panel');
    const L = page.locator('[data-osc="synth.pads.l.pad"] [data-xy-surface]');
    const R = page.locator('[data-osc="synth.pads.r"] [data-xy-surface]');
    await until(async () => await L.count() === 1 && await R.count() === 1,
      { ms: 10000, what: 'the PADY card shows pad L and pad R' });
    await page.locator('[data-osc="synth.pads"]').scrollIntoViewIfNeeded();
    // Below lg one pad at a time through the L/R toggle (review R2-K220-2); from lg both, side
    // by side. show(k) presses the toggle where it is shown.
    const toggle = page.locator('[data-osc="synth.pads.toggle"]');
    const show = async (k) => {
      if (!await toggle.isVisible()) return;
      await toggle.locator(`[data-pad-show="${k}"]`).click();
      await until(async () => await (k === 'l' ? L : R).isVisible(), { ms: 10000,
        what: `the toggle shows pad ${k.toUpperCase()}` });
    };
    if (size === 'phone') {
      const vis = async () => [await L.isVisible(), await R.isVisible()];
      const first = await vis();
      await show('r');
      const second = await vis();
      const boxes = await toggle.locator('button').evaluateAll((bs) => bs.map((b) => {
        const r = b.getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)];
      }));
      if (String(first) !== 'true,false' || String(second) !== 'false,true'
        || boxes.some(([w, h]) => w < 44 || h < 44)) {
        return { ok: false, detail: 'the phone shows one pad at a time through a 44 px toggle',
          first, second, boxes };
      }
      await show('l');
    } else {
      const bl = await page.locator('[data-osc="synth.pads.l"]').boundingBox();
      const br = await page.locator('[data-osc="synth.pads.r"]').boundingBox();
      if (!(Math.abs(bl.y - br.y) < 2 && bl.x + bl.width <= br.x) || await toggle.isVisible()) {
        return { ok: false, detail: 'pad L and pad R are not side by side', bl, br };
      }
    }
    const ax = '[data-osc="synth.pads.l"] [data-xy-axis="x"]';
    await L.focus();
    const x0 = Number(await page.locator(ax).getAttribute('aria-valuenow'));
    await page.keyboard.press('ArrowRight');
    const x1 = Number(await page.locator(ax).getAttribute('aria-valuenow'));
    if (!(x1 > x0)) return { ok: false, detail: 'ArrowRight did not move pad L', x0, x1 };
    // The key picker beside pad R: one undo entry, pad R's node takes it.
    const padR = () => page.evaluate(() => {
      const st = window.OSCILLA.studio;
      const n = st.model.graph.nodes.find((x) => x.type === 'xy-pad' && x.id.endsWith('-xy'));
      return { key: n && n.params.key, depth: st.store.debugInfo().undoDepth };
    });
    const k0 = await padR();
    await show('r');
    await page.locator('[data-osc="synth.pads.r.scale"] #synth-pad-r-key').selectOption('D');
    await until(async () => (await padR()).key === 'D', { ms: 10000,
      what: 'Tónina D reaches pad R\'s node' });
    const k1 = await padR();
    if (k1.depth !== k0.depth + 1) return { ok: false, detail: 'not one undo entry', k0, k1 };
    await show('l');
    // Pad L opens the low-pass while a note is held (X normalled into LPF Cutoff). Every band
    // reading is settled (EG 2 moves the cutoff for seconds after a key) and taken against C4
    // with VCO 2 silent (E059: the two VCOs beat in that band on one held note).
    const quiet2 = await page.evaluate(() => {
      const st = window.OSCILLA.studio;
      const mix = st.model.graph.nodes.find((n) => n.type === 'mixer');
      return !!mix && st.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: mix.id,
        key: 'level2', value: 0 }).ok;
    });
    if (!quiet2) return { ok: false, detail: 'VCO 2 could not be set silent in the mixer' };
    const at = async (loc, fx, fy) => {
      // The pad at the view's centre: its edges clear of the sticky chip bar and the dock.
      await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const b = await loc.boundingBox();
      return { x: b.x + fx * b.width, y: b.y + (1 - fy) * b.height };
    };
    const rel = (q) => bandDb(q, 6000, 12000) - levelAt(q, C4);
    await hold(page, 'KeyA');
    await sound(page, (q) => q.rmsDb > -45 && peakAt(q, C4), 'QWERTY A sounds C4');
    const base = await settledOn(page, rel, 'the band with pad L at rest');
    const pl = await at(L, 0.97, 0.03);
    await page.mouse.move(pl.x, pl.y);
    await page.mouse.down();
    let open = null;
    await until(async () => (open = await settledOn(page, rel, 'the band under pad L'))
      - base >= 6, { ms: SOUND_MS, what: 'a press on pad L\'s right edge opens the low-pass: '
      + 'the 6-12 kHz band 6 dB+ over pad L at rest' });
    await page.mouse.up();
    let back = null;
    await until(async () => Math.abs((back = await settledOn(page, rel,
      'the band after pad L\'s release')) - base) < 1.5, { ms: SOUND_MS,
    what: 'pad L\'s release closes the low-pass again: the band within 1.5 dB of pad L at rest' });
    await page.keyboard.up('KeyA');
    await silent(page, 'the held note released');
    // Pad R's Y is the touch's velocity, heard through VELOCITY (review R2-K220-1): a held note
    // at Y 95 % is 6 dB or more over the same note at Y 5 %, each level settled.
    await show('r');
    const level = async (fy) => {
      const p = await at(R, 0.05, fy);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await sound(page, (q) => q.rmsDb > -70, `pad R at Y ${fy} sounds`);
      const v = await settledOn(page, (q) => q.rmsDb, `pad R's level at Y ${fy}`);
      await page.mouse.up();
      await silent(page, `pad R released at Y ${fy}`);
      return v;
    };
    const soft = await level(0.05);
    const hard = await level(0.95);
    if (!(hard - soft >= 6)) {
      return { ok: false, detail: 'pad R\'s Y is not heard as velocity', soft, hard };
    }
    // A transport Stop releases a held press on either pad.
    const pressed = (loc) => loc.getAttribute('aria-pressed');
    const stopped = {};
    for (const [name, loc] of [['L', L], ['R', R]]) {
      await show(name.toLowerCase());
      const p = await at(loc, 0.5, 0.5);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await until(async () => await pressed(loc) === 'true', { ms: SOUND_MS,
        what: `pad ${name} is pressed` });
      await page.evaluate(() => window.OSCILLA.studio.transport.stop());
      await until(async () => await pressed(loc) === 'false', { ms: SOUND_MS,
        what: `a transport Stop releases pad ${name}` });
      await page.mouse.up();
      stopped[name] = Number((await silent(page, `pad ${name} silent after the Stop`)).rmsDb
        .toFixed(1));
    }
    return { ok: true, layout: size === 'phone' ? 'one at a time' : 'side by side', x0, x1,
      bandUp: Number((open - base).toFixed(1)), bandBack: Number((back - base).toFixed(1)),
      velocityDb: Number((hard - soft).toFixed(1)), stopped };
  });

  // K220 review R2-K220-5: a Keys gate clip (K060) plays no note; through VELOCITY it must still
  // sound, at the keys' resting velocity (100), and stop silent.
  def('s-gateclip', async ({ page }) => {
    const ok = await page.evaluate(() => {
      const st = window.OSCILLA.studio;
      const keys = st.model.graph.nodes.find((n) => n.id.endsWith('-keys'));
      const tr = st.store.dispatch({ type: 'TRACK_ADD', kind: 'event', target: keys.id });
      if (!tr.ok) return false;
      return st.store.dispatch({ type: 'CLIP_ADD', trackId: tr.created.tracks[0], kind: 'event',
        start: 0, duration: 4, payload: { action: 'gate' } }).ok;
    });
    if (!ok) return { ok: false, detail: 'the gate clip could not be added' };
    await page.evaluate(() => window.OSCILLA.studio.transport.start());
    const on = await sound(page, (q) => q.rmsDb > -45,
      'the gate clip on the panel\'s Keys is heard through VELOCITY');
    await page.evaluate(() => window.OSCILLA.studio.transport.stop());
    const off = await silent(page, 'Stop silences it');
    return { ok: true, on: Number(on.rmsDb.toFixed(1)), off: Number(off.rmsDb.toFixed(1)) };
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
    const d0 = await dbg(page);
    const d = { ...d0, cables: own(d0) };
    if (d.cables.length !== 1 || d.cables[0].to !== 'vco2.pitch'
      || d0.cables.length !== 1 + DEFAULT_CABLES) {
      return { ok: false, detail: 'the cable is not patched', cables: d0.cables };
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
    return { ok: model.includes(d.cables[0].id) && own(after).length === 0
      && after.cables.length === DEFAULT_CABLES, size, fixed, peaks };
  });

  // K184 (project.a-phone-sounds): a tap whose key-down and key-up are handled in the same task
  // opened and closed the voice's gate at the same audio time, so it was silent. Each of 20 such
  // taps on KEYS (QWERTY A, dispatched together in one task) is heard above -60 dB rel within the
  // deadline, and the voice is silent again before the next.
  def('s-tap', async ({ page }) => {
    await page.locator('#osc-synth-title').click();
    // A tap lasts tens of ms, shorter than a probe round trip: the page measures it itself
    // (lib/tap-meter.cjs), from the samples after each tap, so a stalled frame cannot miss one.
    await page.evaluate(watchTaps);
    const heardTaps = [];
    for (let i = 0; i < 20; i += 1) {
      await page.evaluate(markTap);
      await page.evaluate(() => {
        const o = { code: 'KeyA', key: 'a', bubbles: true, cancelable: true };
        window.dispatchEvent(new KeyboardEvent('keydown', o));
        window.dispatchEvent(new KeyboardEvent('keyup', o));
        window.__tapAttach(); // same task: the analyser is attached before the tap renders
      });
      const peak = await until(async () => {
        const m = await page.evaluate(() => window.__tapMax);
        return m > -60 ? m : null;
      }, { ms: 3000, what: `same-task tap ${i + 1} sounds` }).catch(() => null);
      heardTaps.push(peak === null ? null : Number(peak.toFixed(1)));
      await silent(page, `tap ${i + 1} ends`);
    }
    return { ok: heardTaps.every((x) => x !== null), taps: heardTaps };
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
      && /předvolba "nope" neexistuje/.test(window.OSCILLA.app.synth.status)),
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
    const d0 = await dbg(page);
    const d = { ...d0, cables: own(d0) };
    if (d.cables.length !== 1 || d.cables[0].to !== 'lpf.frequency') {
      return { ok: false, detail: 'MG into LPF cutoff is not listed as a cable',
        cables: d0.cables };
    }
    const depth = (pg) => pg.evaluate(() => { // the MG cable's (the pad's Y cable adds beside it)
      const ids = window.OSCILLA.app.synthDebug().nodes;
      return window.OSCILLA.studio.model.graph.edges.filter((e) => e.to.node === ids.lpf
        && e.to.port === 'frequency' && e.from.node === ids.mg).map((e) => e.props.depth);
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
    return { ok: /yc=/.test(hash) && JSON.stringify(own(d2).map((c) => [c.from, c.to]))
      === JSON.stringify([['mg.control', 'lpf.frequency']]) && JSON.stringify(a) === '[3]'
      && JSON.stringify(b) === '[3]', hash, here, there, depths: [a, b] };
  });

  // Review of src/js/synth (oscilla-21, S7): Copy link carries a cable's own props.
  def('s-linkprops', async ({ page, context, base }) => {
    await tapJack(page, 'mg.control:out');
    await tapJack(page, 'lpf.frequency:in');
    await until(async () => (await dbg(page)).cables.some((c) => c.to === 'lpf.frequency'),
      { ms: 10000, what: 'MG is patched into LPF cutoff' });
    const props = (pg) => pg.evaluate(() => {
      const c = window.OSCILLA.app.synthDebug().cables.find((x) => x.to === 'lpf.frequency');
      const e = c && window.OSCILLA.studio.model.graph.edges.find((x) => x.id === c.id);
      return e ? e.props : null;
    });
    // The Studio Inspector's edit of that edge: one EDGE_UPDATE through the one store.
    await page.evaluate(() => {
      const c = window.OSCILLA.app.synthDebug().cables.find((x) => x.to === 'lpf.frequency');
      window.OSCILLA.studio.store.dispatch({ type: 'EDGE_UPDATE', edgeId: c.id,
        props: { polarity: 'unipolar', offset: 0.25 } });
    });
    const here = await props(page);
    await page.locator('[data-osc="synth.copy-link"]').click();
    const link = await until(() => page.evaluate(() => window.OSCILLA.app.synth.link || null),
      { ms: 10000, what: 'Copy link shows the link' });
    const again = await openSynth(context, base, link.slice(link.indexOf('#')));
    try {
      const there = await until(() => props(again), { ms: 10000,
        what: 'the reopened link holds the cable' });
      return { ok: here.polarity === 'unipolar' && here.offset === 0.25
        && JSON.stringify(there) === JSON.stringify(here), here, there, link };
    } finally {
      await again.close();
    }
  });

  // Review of src/js/synth (oscilla-21, S10): a knob a cable broke keeps its depth in the
  // model, so the link's receiver brings it back at the sender's setting.
  def('s-knobmemory', async ({ page, context, base }) => {
    await typeKnob(page, 'lpf.lpf-eg2', '3.5');
    await tapJack(page, 'mg.control:out');
    await tapJack(page, 'lpf.frequency:in');
    await until(async () => (await dbg(page)).cables.some((c) => c.to === 'lpf.frequency'),
      { ms: 10000, what: 'MG is patched into LPF cutoff' });
    const kept = await page.evaluate(() => (window.OSCILLA.studio.model.metadata.synthAmounts
      || {})['lpf-eg2']);
    await page.locator('[data-osc="synth.copy-link"]').click();
    const link = await until(() => page.evaluate(() => window.OSCILLA.app.synth.link || null),
      { ms: 10000, what: 'Copy link shows the link' });
    const again = await openSynth(context, base, link.slice(link.indexOf('#')));
    try {
      await face(again, 'bay');
      // Remove the cable this check patched (MG into LPF cutoff), never "the first cable": the
      // reopened patch also holds K183's default XY cable into the cutoff (xy.y), listed first.
      const cut = await until(() => again.evaluate(() => (window.OSCILLA.app.synthDebug().cables
        .find((c) => c.from === 'mg.control' && c.to === 'lpf.frequency') || {}).id
        || null),
      { ms: 10000, what: 'the reopened link holds the MG -> LPF cutoff cable' });
      await again.locator(`[data-osc="synth.cables"] [data-remove-cable="${cut}"]`).click();
      const depth = await until(() => again.evaluate(() => {
        const ids = window.OSCILLA.app.synthDebug().nodes;
        const e = window.OSCILLA.studio.model.graph.edges.find((x) => x.from.node === ids.eg2
          && x.to.node === ids.lpf && x.to.port === 'frequency');
        return e ? e.props.depth : null;
      }), { ms: 10000, what: 'removing the cable restores the EG 2 normal' });
      await face(again, 'panel');
      const shown = (await again.locator('[data-value="lpf.lpf-eg2"]').textContent()).trim();
      return { ok: kept === 3.5 && depth === 3.5 && /^\+?3\.50?\b/.test(shown), kept, depth, shown,
        link };
    } finally {
      await again.close();
    }
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
    // Nine notes nodes (pad L too since K220, the same xy-pad kind as pad R), New Synth voice
    // and, since K221, Krokový sekvencer.
    return { ok: out.items === 11 && out.expanded === 'true' && out.routeEntries === 1
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

  // K104, armed monitoring, and the owner's 'STOP keeps it armed (Recommended)' (2026-11-03).
  def('s-armed', async ({ page, size }) => {
    const sw = page.locator('[data-osc="synth.arm"]');
    const app = (fn) => page.evaluate(fn);
    const state = async () => ({ armed: (await dbg(page)).armed,
      checked: await sw.getAttribute('aria-checked') });
    const is = (want, what) => until(async () => {
      const s = await state();
      return s.armed === want && s.checked === String(want);
    }, { ms: 10000, what });
    const role = await sw.getAttribute('role');
    // Real-time: arming stops a playing Playground voice (the output owner's release path).
    await app(() => { const a = window.OSCILLA.app; a.duration = 4000; return a.play('trigger'); });
    await until(() => app(() => !!window.OSCILLA.app.playing),
      { ms: 10000, what: 'the Playground voice plays' });
    if (size === 'phone') await sw.tap(); else await sw.click();
    await is(true, `Arm by ${size === 'phone' ? 'touch' : 'pointer'}: the switch is checked`);
    await until(() => app(() => !window.OSCILLA.app.playing && !window.OSCILLA.engine.voice),
      { ms: 10000, what: 'arming stopped the Playground voice' });
    // Interactive: the switch by keyboard, and Escape disarms.
    await sw.focus();
    await page.keyboard.press('Enter');
    await is(false, 'Enter on the switch disarms');
    await page.keyboard.press('Space');
    await is(true, 'Space on the switch arms');
    await page.keyboard.press('Escape');
    await is(false, 'Escape disarms');
    if (size === 'phone') await sw.tap(); else await sw.click();
    await is(true, 'armed again');
    // Real-time: a key while armed and stopped reaches the running Keys node and sounds.
    await hold(page, 'KeyA');
    await until(async () => (await dbg(page)).held.includes(60),
      { ms: 10000, what: 'C4 while armed and stopped is held on the running Keys node' });
    const on = await sound(page, (q) => q.rmsDb > -40, 'the armed, stopped panel sounds');
    await page.keyboard.up('KeyA');
    await silent(page, 'the key up releases it');
    if (size === 'phone') return { ok: role === 'switch', role, on: on.rmsDb };
    // Linked: leaving the Synth disarms; in the Studio a key arms it, PLAY plays the document,
    // and STOP stops the timeline while the keys stay armed: the transport bar's indicator and
    // the Synth's own state both say armed, and a key still sounds.
    await page.locator('[data-osc="nav.studio"]').click();
    await until(async () => (await counts(page)).runtimeNodes === 0 && !(await dbg(page)).armed,
      { ms: 10000, what: 'leaving the Synth disarms: runtime census 0' });
    const badge = page.locator('[data-osc="studio.armed"]');
    await page.evaluate(() => {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    });
    await page.keyboard.down('KeyA');
    await until(async () => (await dbg(page)).armed && await badge.isVisible(),
      { ms: 10000, what: 'a key in the Studio arms it and the transport bar shows armed' });
    await page.keyboard.up('KeyA');
    await page.locator('[data-osc="studio.play"]').click();
    await until(() => app(() => window.OSCILLA.app.studio.playing
      && window.OSCILLA.studio.transport.playhead().playing),
    { ms: 10000, what: 'PLAY while armed plays the timeline' });
    await page.locator('[data-osc="studio.stop"]').click();
    await until(async () => (await dbg(page)).armed && await badge.isVisible()
      && await app(() => !window.OSCILLA.app.studio.playing && window.OSCILLA.app.synth.armed),
    { ms: 10000, what: 'STOP after PLAY leaves the keys armed, shown in the bar and the Synth' });
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.down('KeyA');
    const after = await sound(page, (q) => q.rmsDb > -40, 'a key after STOP still sounds');
    await page.keyboard.up('KeyA');
    await page.locator('[data-osc="nav.synth"]').click();
    await until(async () => (await counts(page)).runtimeNodes === 0 && !(await dbg(page)).armed
      && (await sw.getAttribute('aria-checked')) === 'false',
    { ms: 10000, what: 'leaving the Studio disarms it: census 0, the switch unchecked' });
    return { ok: role === 'switch', role, on: on.rmsDb, after: after.rmsDb };
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

  // Review of src/js/synth (oscilla-21, S3): a note-off releases the node its note-on played.
  const tabTo = async (page, id) => {
    await page.locator(`#osc-synth-tab-${id}`).click();
    await until(async () => (await dbg(page)).tab === id, { ms: 10000,
      what: `the ${id} tab opens` });
  };
  def('s-chiprelease', async ({ page }) => {
    await tabTo(page, 'engines');
    const fm = (await dbg(page)).nodes.fm;
    await page.evaluate((id) => window.OSCILLA.app.synthPick(id), fm);
    await until(async () => (await dbg(page)).played === fm, { ms: 10000,
      what: 'the keys play the FM engine' });
    await hold(page, 'KeyA');
    const on = await sound(page, (q) => q.rmsDb > FM_HEARD_DB, 'the FM engine sounds the held key');
    // The chip of the engine the tab shows: no tab or engine change, only the route goes.
    await page.locator('[data-engine="additive"]').click();
    await until(async () => (await dbg(page)).played === (await dbg(page)).nodes.additive,
      { ms: 10000, what: 'the chip routes the keys to the additive engine' });
    await page.keyboard.up('KeyA');
    const off = await silent(page, 'the FM voice is released after the chip and key up');
    await until(async () => (await dbg(page)).held.length === 0, { ms: 10000,
      what: 'no note is held after the key is up' });
    const census = await counts(page);
    return { ok: true, on: on.rmsDb, off: off.rmsDb, census };
  });

  // Review of src/js/synth (oscilla-21, S4): the engine radio reads the model's route.
  const enginesShown = (page) => page.evaluate(() => ({
    on: [...document.querySelectorAll('[data-engine][aria-checked="true"]')]
      .map((x) => x.dataset.engine),
    plates: [...document.querySelectorAll('[data-osc="synth.modules"] [data-module]')]
      .map((x) => x.dataset.module) }));
  def('s-radioroute', async ({ page }) => {
    await tabTo(page, 'engines');
    const fm = (await dbg(page)).nodes.fm;
    await page.evaluate((id) => window.OSCILLA.app.synthPick(id), fm);
    const shown = await until(async () => {
      const x = await enginesShown(page);
      return x.on.join() === 'fm' && x.plates.includes('fm') && !x.plates.includes('additive')
        && x;
    }, { ms: 10000, what: 'the radio checks FM and shows its plate, as the keys play FM' });
    await hold(page, 'KeyA');
    const on = await sound(page, (q) => q.rmsDb > FM_HEARD_DB, 'the FM engine sounds the held key');
    const d = await dbg(page);
    await page.keyboard.up('KeyA');
    const off = await silent(page, 'the key up releases the FM voice');
    return { ok: d.played === fm && d.engine === 'fm', shown, on: on.rmsDb, off: off.rmsDb };
  });

  // Review of src/js/synth (oscilla-21, S5): New Synth voice keeps the insert contract.
  def('s-newvoice', async ({ page }) => {
    // A document without the panel whose own chain feeds Master Output, changed by the user:
    // the workspace's own insert undone, then a node of the user's.
    await page.evaluate(() => {
      const st = window.OSCILLA.studio.store;
      st.undo();
      st.dispatch({ type: 'NODE_ADD', nodeType: 'fm-voice', name: 'FM 2',
        position: { x: 0, y: 900 } });
    });
    await until(async () => !(await dbg(page)).present && page.locator('[data-insert-panel]')
      .isVisible(), { ms: 10000, what: 'the view offers Insert, the panel gone' });
    const mine = await page.evaluate(() => window.OSCILLA.studio.model.graph.nodes
      .map((n) => ({ id: n.id, y: n.position.y })));
    const top = Math.max(...mine.map((n) => n.y));
    await page.locator('#osc-synth-pick').click();
    const menu = page.locator('[data-osc="synth.pick.menu"]');
    await until(() => menu.isVisible(), { ms: 5000, what: 'the instrument menu opens' });
    // By the keyboard, as s-dock chooses (a pointer click on the item outlives the menu it
    // closes: Playwright waits on the detached item)
    await menu.locator('[data-pick="new-voice"]').focus();
    await page.keyboard.press('Enter');
    const said = await until(async () => {
      const t = await page.locator('[data-osc="synth.status"]').textContent();
      return /took Master Output from/.test(t) && t;
    }, { ms: 10000, what: 'New Synth voice says the Master feed it took' });
    // The panel's own nodes: Master Output is the document's one, kept where it is.
    const placed = await page.evaluate((had) => window.OSCILLA.studio.model.graph.nodes
      .filter((n) => !had.includes(n.id)).map((n) => n.position.y), mine.map((n) => n.id));
    await hold(page, 'KeyA');
    const on = await sound(page, (q) => q.rmsDb > -40, 'the new voice sounds the held key');
    await page.keyboard.up('KeyA');
    const off = await silent(page, 'the key up releases the new voice');
    return { ok: placed.length > 10 && placed.every((y) => y > top), said, top,
      lowest: Math.min(...placed), on: on.rmsDb, off: off.rmsDb };
  });

  // Review of src/js/synth (oscilla-21, S8): a keyboard the pad's cables silenced says why. Under
  // K183 no built-in XY preset patches the pad's Gate (review F3: XY lead cables Y alone and the
  // keys keep sounding), so the check takes both EG gates itself, by jack taps in the bay.
  def('s-keysilent', async ({ page }) => {
    const status = () => page.locator('[data-osc="synth.status"]').textContent();
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    await tabTo(page, 'xy');
    const before = await depth();
    await page.locator('#osc-synth-preset').selectOption('xy-lead');
    await until(async () => (await depth()) === before + 1,
      { ms: 10000, what: 'XY lead is applied, one undo entry' });
    const lead = await dbg(page);
    if (lead.cables.some((c) => c.from === 'xy.gate' || c.from === 'xy.pitch')) {
      return { ok: false, detail: 'XY lead patched the pad\'s Pitch or Gate (K183 review F3)',
        cables: lead.cables };
    }
    await hold(page, 'KeyA');
    const still = await sound(page, (q) => q.rmsDb > -40,
      'under XY lead (Y alone) the keys still sound');
    await page.keyboard.up('KeyA');
    await silent(page, 'the key up releases the voice under XY lead');
    for (const eg of ['eg1', 'eg2']) { // the gates taken explicitly: what silences the keys
      await tapJack(page, 'xy.gate:out');
      await tapJack(page, `${eg}.gate:in`);
    }
    await until(async () => {
      const c = (await dbg(page)).cables;
      return ['eg1.gate', 'eg2.gate'].every((to) => c.some((x) => x.from === 'xy.gate'
        && x.to === to));
    }, { ms: 10000, what: 'the pad\'s Gate is patched into EG 1 and EG 2' });
    await tabTo(page, 'panel');
    await page.locator('#osc-synth-preset').selectOption('init');
    const notice = page.locator('[data-osc="synth.keys-silent"]');
    await until(() => notice.isVisible(), { ms: 10000,
      what: 'the Panel tab says why the keys sound nothing' });
    const text = (await notice.textContent()).trim();
    await hold(page, 'KeyA');
    const quiet = await silent(page, 'the held key sounds nothing (the pad has the gates)');
    const said = await until(async () => {
      const t = await status();
      return /The keys sound nothing/.test(t) && t;
    }, { ms: 10000, what: 'the key says why it sounds nothing' });
    await page.keyboard.up('KeyA');
    await notice.locator('[data-xy-unpatch]').click();
    await until(async () => !(await dbg(page)).cables.some((c) => c.from.startsWith('xy.'))
      && !(await notice.count()), { ms: 10000,
      what: 'Unpatch the pad removes its cables and the notice' });
    await hold(page, 'KeyA');
    const on = await sound(page, (q) => q.rmsDb > -40, 'the keys play the voice again');
    await page.keyboard.up('KeyA');
    const off = await silent(page, 'the key up releases the voice');
    return { ok: /Unpatch the pad/.test(text), text, said, still: still.rmsDb,
      quiet: quiet.rmsDb, on: on.rmsDb, off: off.rmsDb };
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

  // K221: the step-sequencer strip above the face, found from the default view's picker.
  def('s-steps', async ({ page, size }) => {
    const press = (loc) => (size === 'phone' ? loc.tap() : loc.click());
    const strip = page.locator('[data-osc="synth.steps"]');
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    const notes = () => page.evaluate(() => {
      const m = window.OSCILLA.studio.model;
      const keys = window.OSCILLA.app.synthDebug().nodes.keys;
      const t = m.timeline.tracks.find((x) => x.kind === 'event' && x.target === keys);
      const c = t && m.timeline.clips.find((x) => x.trackId === t.id && x.kind === 'notes');
      return c ? c.payload.notes.map((n) => [n.at, n.note]) : null;
    });
    const hiddenFirst = !(await strip.isVisible()) && (await notes()) === null;
    // V635: on a phone the instrument row is folded behind the dock's More button.
    const more = page.locator('[data-osc="keyboard.more"]');
    if (await more.isVisible()) {
      await press(more);
      await until(() => page.locator('[data-osc="synth.pick"]').isVisible(),
        { ms: 5000, what: 'More unfolds the instrument row' });
    }
    await page.locator('#osc-synth-pick').focus();
    await page.keyboard.press('Enter');
    const item = page.locator('[data-osc="synth.pick.menu"] [data-pick="steps"]');
    await until(() => item.isVisible(), { ms: 5000,
      what: 'the picker lists Krokový sekvencer' });
    const d0 = await depth();
    // By the keyboard, as s-dock chooses: a pointer on the item outlives the menu it closes.
    await item.focus();
    await page.keyboard.press('Enter');
    await until(async () => (await strip.isVisible()) && (await depth()) === d0 + 1
      && JSON.stringify(await notes()) === '[]', { ms: 10000,
      what: 'the strip is added in one undo entry and shown above the face' });
    // Fitted once and settled: the same step count on two reads a frame apart.
    const cells = () => page.evaluate(() => new Promise((res) => requestAnimationFrame(() => res(
      document.querySelectorAll('[data-osc="synth.steps"] [role="gridcell"]').length))));
    let last = -1;
    const fitted = await until(async () => {
      const n = await cells();
      const still = n > 0 && n === last;
      last = n;
      return still ? n : null;
    }, { ms: 5000, what: 'the strip\'s step grid settles at one page size' });
    // Step 3: on the first page at every width (four steps a page at a phone's 390 px).
    const cell = strip.locator('[role="gridcell"][data-lane="0"][data-step="2"]');
    await cell.scrollIntoViewIfNeeded();
    await press(cell);
    await until(async () => JSON.stringify(await notes()) === '[[0.5,60]]', { ms: 5000,
      what: 'step 3 puts its note in the strip\'s clip' });
    // The transport plays it: the strip's playhead moves while the Studio plays.
    await page.evaluate(() => window.OSCILLA.app.studioPlay());
    const at = () => page.evaluate(() => {
      const c = document.querySelector('[data-osc="synth.steps"] [aria-current="step"]');
      return c ? Number(c.dataset.step) : null;
    });
    const first = await until(async () => { const v = await at(); return v === null ? null
      : { v }; }, { ms: 5000, what: 'the strip shows the playing step' });
    const moved = await until(async () => { const v = await at(); return v !== null
      && v !== first.v ? { v } : null; }, { ms: 5000, what: 'the strip\'s playing step moves' });
    await page.evaluate(() => window.OSCILLA.app.studioStop());
    const narrow = await page.evaluate(() => document.scrollingElement.scrollWidth
      - window.innerWidth);
    // K221 (2): the strip mounts the step-grid kind (ui/kinds/step-grid.js), the one the Drums
    // tab mounts (drums.cjs dr-mount): its root marker and its grid surface.
    const kind = await page.evaluate(() => {
      const g = document.querySelector('[data-osc="synth.steps"] [role="grid"]');
      const root = g && g.closest('[data-step-grid]');
      return { kind: root ? root.getAttribute('data-step-grid') : null,
        surface: !!g && g.hasAttribute('data-step-grid-surface') };
    });
    return { ok: hiddenFirst && narrow <= 0 && kind.kind === 'notes' && kind.surface,
      hiddenFirst, first: first.v, moved: moved.v, narrow, fitted, kind };
  });

  // K226: a step-voltage sequencer clocked by the panel's Keys Gate, its row A into VCO 1's
  // pitch, stepped by the Inspector's Krok button while the Studio plays (the timeline does not
  // own its clock input, so the live router takes the step): by pointer (a tap on the phone) and
  // by keyboard, each step's value reaches the running CV at once; after Stop a press arms the
  // transport and takes step 1 (oscilla-c3, 2026-11-11). The node and its cables go in
  // through the store (the actions the library and the connect picker dispatch, proven by their
  // own suites); the row's step grid is the kind's param-list lane (step-grid.cjs sg-list).
  def('s-svs', async ({ page, size }) => {
    const press = (loc) => (size === 'phone' ? loc.tap() : loc.click());
    const made = await page.evaluate(() => {
      const st = window.OSCILLA.studio.store;
      const n = window.OSCILLA.app.synthDebug().nodes;
      const add = st.dispatch({ type: 'NODE_ADD', nodeType: 'step-voltage-sequencer',
        position: { x: 40, y: 40 } });
      if (!add.ok) return { error: add.reason };
      const id = add.created.nodes[0];
      const e = [st.dispatch({ type: 'EDGE_ADD', from: { node: n.keys, port: 'gate' },
        to: { node: id, port: 'clock' } }), st.dispatch({ type: 'EDGE_ADD',
        from: { node: id, port: 'cvA' }, to: { node: n.vco1, port: 'pitch' },
        props: { depth: 1, polarity: 'bipolar', mapping: 'linear' } })];
      st.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [id] } });
      return { id, error: e.filter((r) => !r.ok).map((r) => r.reason).join('; ') || null };
    });
    if (made.error) return { ok: false, detail: `insert and cable: ${made.error}` };
    // The Inspector is the Studio's: open it there with the sequencer selected, and play.
    await page.evaluate(() => { window.location.hash = '#m=studio'; });
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'studio'),
      { ms: 10000, what: 'the Studio opens' });
    const tab = page.locator('[data-osc="studio.subview"][data-value="inspector"]');
    if (await tab.isVisible()) await press(tab);
    const step = page.locator('[data-osc="studio.inspector.svsStep"]');
    await until(() => step.isVisible(), { ms: 10000,
      what: 'the Inspector shows the sequencer\'s Krok button' });
    // R2-T5-7: the default document's timeline ends at 3 s and does not loop, shorter than this
    // check's own deadlines; on a loaded host the playback ended mid-check, the runtime dropped
    // the node and the CV read null. The check loops the timeline while it runs (undone after).
    const looped = await page.evaluate(() => window.OSCILLA.studio.store.dispatch({
      type: 'LOOP_SET', enabled: true, start: 0, end: 4 }).ok);
    if (!looped) return { ok: false, detail: 'the timeline could not be looped' };
    await page.evaluate(() => window.OSCILLA.app.studioPlay());
    await until(() => page.evaluate((id) => window.OSCILLA.studio.transport.playing
      && window.OSCILLA.studio.runtime.nodes.has(id), made.id), { ms: 10000,
      what: 'the Studio plays the sequencer' });
    const cv = () => page.evaluate((id) => {
      const h = window.OSCILLA.studio.runtime.nodes.get(id);
      const o = h && h.outputs && h.outputs.cvA;
      return o && o.offset ? o.offset.value : null;
    }, made.id);
    const holds = (want, what) => until(async () => {
      const v = await cv();
      return v !== null && Math.abs(v - want) < 1e-6 ? { v } : null;
    }, { ms: 5000, what });
    // Each press is proved by the step it announces ("Krok n", the Inspector's live region), not
    // by the value alone: step 1's value is the row's first, which the sequencer holds before
    // any step, so a press lost or refused (the region then says why) would shift every later
    // step by one (R2-T5-7).
    const said = () => page.evaluate(() => String(window.OSCILLA.app.studio.live || '')
      .replace(/\u200b/g, ''));
    const announced = async (n, what) => {
      let heard = '';
      try {
        await until(async () => ((heard = await said()) === `Krok ${n}` ? true : null),
          { ms: 5000, what: `${what}: the Inspector says Krok ${n}` });
      } catch (e) {
        throw new Error(`${e.message.split('\n')[0]}; it said "${heard}"`);
      }
    };
    // Row A by default, pitch role: 0, 0.25 (three semitones), 0.5, ...
    await press(step);
    await announced(1, 'Krok by pointer');
    await holds(0, 'Krok by pointer: row A holds step 1 (0)');
    await step.focus();
    await page.keyboard.press('Enter');
    await announced(2, 'Krok by keyboard');
    const second = await holds(0.25, 'Krok by keyboard: row A holds step 2 (0.25)');
    await page.keyboard.press('Enter');
    await announced(3, 'Krok again');
    const third = await holds(0.5, 'Krok again: row A holds step 3 (0.5)');
    await page.evaluate(() => window.OSCILLA.app.studioStop());
    await until(() => page.evaluate(() => !window.OSCILLA.studio.transport.playing),
      { ms: 10000, what: 'Stop stops the Studio' });
    // Stopped, a press arms the transport (as a key strike does, K104) and takes step 1.
    await press(step);
    await announced(1, 'Krok while stopped');
    const armed = await until(() => page.evaluate(() => window.OSCILLA.studio.transport.armed
      || null), { ms: 5000, what: 'Krok while stopped: the press armed the transport' });
    await holds(0, 'Krok while stopped: row A holds step 1 (0)');
    await page.evaluate(() => window.OSCILLA.studio.transport.disarm());
    await until(() => page.evaluate(() => !window.OSCILLA.studio.transport.playing),
      { ms: 10000, what: 'the armed transport disarms' });
    await page.evaluate(() => window.OSCILLA.studio.store.undo()); // the loop, as it was
    return { ok: true, second: second.v, third: third.v, armed };
  });

  // K225: the Studio's patch library inserts the Synth panel (a panel preset's Insert).
  def('s-libinsert', async ({ page, size }) => {
    const press = (loc) => (size === 'phone' ? loc.tap() : loc.click());
    const how = size === 'phone' ? 'touch' : 'pointer';
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    const dlg = page.locator('[data-osc="library"]');
    const offered = (what) => until(async () => !(await dbg(page)).present
      && await page.locator('[data-insert-panel]').isVisible(), { ms: 10000, what });
    const open = async () => {
      await press(page.locator('[data-osc="synth.library"]'));
      await until(() => dlg.isVisible(), { ms: 10000, what: 'the patch library opens' });
      await page.locator('[data-osc="library.instrument"]').selectOption('semi-mono');
    };
    const close = async () => {
      await press(page.locator('[data-osc="studio.saved.close"]'));
      await until(async () => !(await dlg.isVisible()), { ms: 5000, what: 'the library closes' });
    };
    // A changed document without the panel (the workspace's own insert undone, a node of the
    // user's): the Synth offers its own Insert, and the library offers a panel preset's.
    await page.evaluate(() => {
      const st = window.OSCILLA.studio.store;
      st.undo();
      st.dispatch({ type: 'NODE_ADD', nodeType: 'fm-voice', name: 'FM 2',
        position: { x: 0, y: 900 } });
    });
    await offered('the panel is gone and Insert is offered');
    await open();
    await press(page.locator('[data-entry="synth-bass"]'));
    const before = await depth();
    await press(page.locator('[data-osc="library.insert"]'));
    await until(async () => (await dbg(page)).present && (await depth()) === before + 1,
      { ms: 10000, what: `the library's Insert by ${how} puts the panel in, one undo entry` });
    const status = await page.locator('[data-osc="library.status"]').textContent();
    await close();
    // Keyboard: Undo, then the listbox's Enter on the Bass preset (not applicable: Insert).
    await page.evaluate(() => window.OSCILLA.studio.store.undo());
    await offered('Undo removes it');
    await open();
    await page.locator('[data-osc="library.list"]').focus();
    // The library keeps the entry last chosen: Home goes to the first (Init), the arrow to Bass.
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await until(async () => (await page.locator('[data-osc="library.name"]').textContent())
      === 'Bass', { ms: 5000, what: 'Home and the arrow reach Bass' });
    await page.keyboard.press('Enter');
    await until(async () => (await dbg(page)).present, { ms: 10000,
      what: 'Enter in the library inserts the panel' });
    const lpf = await page.evaluate(() => {
      const id = window.OSCILLA.app.synthDebug().nodes.lpf;
      return window.OSCILLA.studio.model.graph.nodes.find((n) => n.id === id).params.frequency;
    });
    await close();
    // Linked: the Studio graph draws the panel's nodes and normal edges.
    const nodes = Object.values((await dbg(page)).nodes).filter(Boolean);
    const normals = await page.evaluate(() => window.OSCILLA.studio.model.graph.edges
      .filter((e) => /-n\d+$/.test(e.id)).map((e) => e.id));
    await page.evaluate(() => { window.location.hash = 'm=studio'; });
    await until(() => page.evaluate(({ n, e }) => window.OSCILLA.app.workspace === 'studio'
      && n.every((id) => document.querySelector(`[data-node-id="${id}"]`))
      && e.every((id) => document.querySelector(`[data-edge-id="${id}"]`)), { n: nodes,
      e: normals }), { ms: 10000, what: 'the Studio graph draws the inserted panel' });
    await page.evaluate(() => { window.location.hash = 'm=synth'; });
    await until(async () => (await dbg(page)).present && await page.evaluate(() =>
      window.OSCILLA.app.workspace === 'synth'), { ms: 10000, what: 'the Synth shows the panel' });
    // Real-time: armed, a key sounds.
    await press(page.locator('[data-osc="synth.arm"]'));
    await until(async () => (await dbg(page)).armed, { ms: 10000, what: 'the Synth arms' });
    await hold(page, 'KeyA');
    const on = await sound(page, (q) => q.rmsDb > -40, 'a key sounds the inserted panel');
    await page.keyboard.up('KeyA');
    return { ok: lpf === 180 && /Master Output/.test(status), lpf, status, on: on.rmsDb,
      nodes: nodes.length };
  });

  // K214 (K061 criterion 3): the panel's normals across the Synth and the Studio.
  def('s-normals', async ({ page, size }) => {
    const press = (loc) => (size === 'phone' ? loc.tap() : loc.click());
    const how = size === 'phone' ? 'touch' : 'pointer';
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    const insertBtn = page.locator('[data-insert-panel]');
    const go = async (ws) => {
      await page.evaluate((w) => { window.location.hash = `m=${w}`; }, ws);
      await until(() => page.evaluate((w) => window.OSCILLA.app.workspace === w, ws),
        { ms: 10000, what: `the ${ws} workspace opens` });
    };
    const offered = (what) => until(async () => !(await dbg(page)).present
      && await insertBtn.isVisible(), { ms: 10000, what });
    const inserted = (what) => until(async () => (await dbg(page)).present, { ms: 10000, what });
    // Interactive: a changed document without the panel (the workspace's own insert undone, a
    // node of the user's) offers Insert; pointer (touch on the phone) and keyboard insert it.
    await page.evaluate(() => {
      const st = window.OSCILLA.studio.store;
      st.undo();
      st.dispatch({ type: 'NODE_ADD', nodeType: 'fm-voice', name: 'FM 2',
        position: { x: 0, y: 900 } });
    });
    await offered('the view offers Insert, the panel gone');
    await press(insertBtn);
    await inserted(`Insert by ${how} inserts the panel`);
    await page.evaluate(() => window.OSCILLA.studio.store.undo());
    await offered('Undo removes the panel and Insert is offered again');
    await insertBtn.focus();
    await page.keyboard.press('Enter');
    await inserted('Insert by keyboard inserts the panel');
    // Linked: the Studio graph shows the panel's nodes and its normal edges.
    const panelNodes = Object.values((await dbg(page)).nodes).filter(Boolean);
    const normalEdges = await page.evaluate(() => window.OSCILLA.studio.model.graph.edges
      .filter((e) => /-n\d+$/.test(e.id)).map((e) => e.id));
    const n2 = normalEdges.find((id) => id.endsWith('-n2'));
    await go('studio');
    await until(() => page.evaluate(({ nodes, edges }) => nodes.every((id) => document
      .querySelector(`[data-node-id="${id}"]`)) && edges.every((id) => document
      .querySelector(`[data-edge-id="${id}"]`)), { nodes: panelNodes, edges: normalEdges }),
    { ms: 10000, what: `the Studio graph draws ${panelNodes.length} panel nodes and `
      + `${normalEdges.length} normal edges` });
    // A normal deleted in the Studio (the graph's Delete is this one EDGE_REMOVE) stays deleted.
    await page.evaluate((id) => window.OSCILLA.studio.store.dispatch({ type: 'EDGE_REMOVE',
      edgeIds: [id] }), n2);
    await until(() => page.evaluate((id) => !document.querySelector(`[data-edge-id="${id}"]`),
      n2), { ms: 10000, what: 'the deleted normal leaves the Studio graph' });
    await go('synth');
    await face(page, 'bay');
    const restore = page.locator('[data-restore-normal="vco2.pitch"]');
    await until(() => restore.isVisible(), { ms: 10000,
      what: 'the Synth shows VCO 2 Pitch open with Restore normal' });
    const before = await depth();
    await press(restore);
    await until(async () => (await depth()) === before + 1 && await page.evaluate((id) => window
      .OSCILLA.studio.model.graph.edges.some((e) => e.id === id), n2),
    { ms: 10000, what: 'Restore normal restores it with its id in one history entry' });
    const live = page.locator('[data-osc="studio.live"]');
    await until(async () => (await live.getAttribute('aria-live')) === 'polite'
      && /obnoven/.test(await live.textContent()), { ms: 10000,
      what: 'the restored normal is announced in the polite live region' });
    // Real-time: armed, a Studio cable beside the normal sums with it (the jack is mixed);
    // Break normal takes the normal out of the running graph and the cable alone drives it.
    await page.locator('[data-osc="synth.arm"]').click();
    await until(async () => (await dbg(page)).armed, { ms: 10000, what: 'the Synth arms' });
    const cable = await page.evaluate(() => {
      const d = window.OSCILLA.app.synthDebug().nodes;
      const r = window.OSCILLA.studio.store.dispatch({ type: 'EDGE_ADD',
        from: { node: d.keys, port: 'velocity' }, to: { node: d.vco2, port: 'pitch' },
        props: { depth: 1, polarity: 'unipolar', mapping: 'linear', offset: 0 } });
      return r.ok ? r.created.edges[0] : null;
    });
    const edgeState = () => page.evaluate(({ c, n }) => {
      const rt = window.OSCILLA.studio.runtime;
      const st = (id) => (rt.edges.has(id) ? rt.edges.get(id).status : null);
      return { cable: st(c), normal: st(n) };
    }, { c: cable, n: n2 });
    await until(async () => { const e = await edgeState();
      return e.cable === 'active' && e.normal === 'active'; },
    { ms: 10000, what: 'the running graph holds the Studio cable and the normal' });
    const brk = page.locator('[data-break-normal="vco2.pitch"]');
    await until(() => brk.isVisible(), { ms: 10000, what: 'the Synth offers Break normal' });
    await press(brk);
    await until(async () => { const e = await edgeState();
      return e.cable === 'active' && e.normal === null; },
    { ms: 10000, what: 'Break normal drops the normal from the runtime edge list' });
    await hold(page, 'KeyA');
    const on = await sound(page, (q) => q.rmsDb > -45, 'the cable-driven voice sounds');
    await page.keyboard.up('KeyA');
    return { ok: !!cable, nodes: panelNodes.length, normals: normalEdges.length, on: on.rmsDb };
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
    return { ok: bad.length === 0 && seen.size === 10, controls: seen.size, bad: bad.slice(0, 14),
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
      && t.label >= 4.5 && t.wires === 6 + DEFAULT_CABLES && t.hw.nuts === t.hw.jacks
      && t.hw.jacks > 0 && t.hw.plugs === 2 * (6 + DEFAULT_CABLES) && t.hw.plates > 0
      && t.hw.screws === 2 * t.hw.plates)
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

  def('s-connect-escape', async ({ page }) => {
    await page.locator('[data-jack="mg.control:out"]').focus();
    await page.keyboard.press('Enter');
    const listed = () => page.evaluate(() => {
      const box = document.querySelector('[data-osc="synth.connect"]');
      return { hidden: box.hidden, patch: box.querySelectorAll('[data-connect-to]').length };
    });
    const open = await until(() => listed().then((l) => (!l.hidden && l.patch > 0 ? l : null)),
      { ms: 5000, what: 's-connect-escape: the connection list of MG CV opens' });
    // Escape is the playback bus's stopAll (C050), which ends the Synth's pending connect.
    await page.keyboard.press('Escape');
    const closed = await until(() => listed().then((l) => (l.hidden && l.patch === 0 ? l : null)),
      { ms: 5000, what: 's-connect-escape: Escape closes the connection list' })
      .catch(() => null);
    const before = (await dbg(page)).cables.length;
    await page.locator('[data-jack="lpf.frequency:in"]').focus();
    await page.keyboard.press('Enter');
    const after = await listed();
    const d = await dbg(page);
    const stale = d.cables.some((c) => c.from === 'mg.control' && c.to === 'lpf.frequency');
    // Enter on Cutoff opened its own list: a new connect, not the one Escape ended.
    await page.keyboard.press('Escape');
    return { ok: !!closed && !stale && d.cables.length === before && !after.hidden,
      open, closed, after, stale, cables: d.cables.length, before };
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
      const bar = document.querySelector('nav[aria-label="Sekce Synthu"]')
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
      const bar = document.querySelector('nav[aria-label="Sekce Synthu"]')
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
    // The declared jacks (62 since K022-3 hid the MG depth input) and both ends of each cable.
    const jacks = await panelJacks();
    if (reach.ends !== jacks + 2 * (6 + DEFAULT_CABLES) || reach.covered.length) {
      return { ok: false, detail: 'a jack or a cable end stays under the dock', reach, jacks };
    }
    await page.locator('[data-goto="lpf"]').tap();
    const chip = await page.evaluate(() => {
      const h = document.querySelector('#synth-m-lpf').getBoundingClientRect();
      const bar = document.querySelector('nav[aria-label="Sekce Synthu"]')
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
  && (sizeName === 'phone' ? PHONE_CHECKS.has(name) : name !== 's-mobile');

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
        const v = await bounded(fn({ page, context, base, size: sizeName }),
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

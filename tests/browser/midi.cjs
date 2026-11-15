#!/usr/bin/env node
// suite-pace: solo (note timing scheduled on the realtime audio clock and read from the analyser)
// OSCILLA MIDI support state (plan issue V501; ADR 0058 and its V500 note) on the built
// dist/index.html in chromium, firefox and webkit, from file:// and from the Pages-like
// sub-path http://127.0.0.1:<port>/oscilla/ (served locally on 127.0.0.1: it is not the Pages
// origin https://korczis.github.io, which this suite never loads). The one browser suite the
// M045 issues share.
//
//   node tests/browser/midi.cjs [--dist dist/index.html] [--browsers chromium,firefox,webkit]
//        [--origins file,http]   (or OSC_BROWSERS / OSC_ORIGINS through the harness)
//
// Every check belongs to one of two groups, named in its id and asserted first inside the page:
//   measured  a context with no MIDI init script: requestMIDIAccess is absent or [native code]
//             and the seam's marker is absent. Only these support a support claim; each names
//             the gate build (engine and version Playwright reports), the platform and the origin.
//   seam      a context with tests/browser/lib/midi-stub.cjs installed (the stub, or the spy that
//             only counts calls and calls through); the marker is present. These prove only that
//             the page handles a state ("handles (stubbed API)").
//
// Checks (asserted), per browser and origin:
//   midi-measured-load          the state at load is the one measured for the gate build and
//                               origin (darwin record of ADR 0058), with its exact copy
//   midi-measured-no-prompt     where the API exists, the permission query reads `prompt` both
//                               just after the load and again after the load's own read
//   midi-measured-connect       Connect MIDI where offered: Chromium settles to `denied`
//                               (NotAllowedError); Firefox over http shows `pending`, then
//                               `blocked` (SecurityError, 3-13 s); where the API is missing
//                               Connect MIDI is not offered. No error is reported by the page
//   midi-measured-grant         Chromium only: the `midi` grant reads `allowed` and Connect MIDI
//                               still ends `denied`; `midi` + `midi-sysex` reads `allowed` and
//                               resolves (`no-devices` on darwin); clearing the grant is `revoked`
//   midi-measured-stub-fidelity every member src/js/midi reads (midi-stub.cjs PAGE_READS) is held
//                               by the stub's objects as by MIDIAccess, MIDIInputMap and MIDIInput
//   midi-seam-no-request-at-load  the spy counts zero requestMIDIAccess calls after the load and
//                               at most one permission query, for `midi`; Connect MIDI then makes
//                               exactly one call, { sysex: false }
//   midi-seam-load              under the stub the page reads the query (WebKit's rejects: unknown)
//   (each midi-seam-* check below first asserts the seam group in its page, as the ones above do)
//   midi-seam-connect           by keyboard: pending, connected with the stub's self-naming device,
//                               a second input, one leaves (still connected), the last leaves
//                               (disconnected with its name), one plugs in (connected); the stub's
//                               midimessage carries a Uint8Array and a timeStamp
//   midi-seam-no-devices        a resolved access without inputs; a device plugged in connects
//   midi-seam-rejections        SecurityError blocked, NotAllowedError denied, NotSupportedError
//                               failed with the name; a newer request wins over an older one
//                               (polled until the older settlement has reached the page, and
//                               nothing listens to its access)
//   midi-seam-notes             V502 on K247's one instrument: synthetic MIDI events from the
//                               stub, the context forced to NOTES_RATE: a Note On plays the
//                               Studio transport (it holds the note, the analyser sounds, no
//                               voice of the page's own); velocity 127 and a chord of more than
//                               NOTE_POLYPHONY notes peak at or under the safety chain's ceiling
//                               (MAX_OUTPUT_GAIN); Note Off and velocity 0 leave the transport
//                               holding nothing and the output below -70 dB rel; a note at or
//                               above 0.95 x Nyquist sounds at most at the bound (the analyser's
//                               spectral peak; the voices clamp it), the note below it plays;
//                               held notes stop when their input is unplugged and on Escape; a
//                               held note sounds past the session safety limit while held and a
//                               window blur releases it (ADR 0062); the on-screen keys light a
//                               MIDI note while it sounds (K026); starting the sequencer
//                               releases held notes, a Note On while it plays is refused and said
//                               once (C036), and after it stops a note sounds again. The engine
//                               voice's own laws (velocity, polyphony, click-free automation)
//                               are unit/midi/notes.test.mjs's, on the fake audio context
//   midi-seam-sink              review of src/js/synth (S2), K247: a stub note held on the
//                               instrument in the Playground stops with the switch to the Synth
//                               (leaving ends the keys' armed run) and its late Note Off leaves
//                               nothing sounding; a note in the Synth then sounds and is freed
//   midi-seam-cc                V506: CC 64 holds a note on the instrument past its Note Off until the
//                               pedal comes up; a CC in the Playground moves no Synth knob; in
//                               the Synth CC 74 moves the LPF cutoff to its range's ends (0 -> 10
//                               Hz, 127 -> 20 kHz) and the Synth's status line names it
//   midi-seam-monitor           V507: two stub inputs named after a KeyLab mkII 61's ports (the
//                               stub's own name first) are listed in the Settings dialog with
//                               the device and each port's role; a Note On from the DAW port
//                               sounds nothing, one from the play port sounds; the monitor shows
//                               the play port's CC 74 as Enkodér 1, newest first, and Vymazat
//                               empties it
//   midi-seam-transport         V508: a stub DAW port (named after a KeyLab mkII 61's) presses
//                               Play (Note On 94): the Studio's transport plays and the monitor
//                               says so; a stub play port's Stop (FC) stops it; in the Sequencer
//                               a Start (FA) plays the sequence and Stop stops it; a stub clock
//                               at 120 BPM shows "Hodiny MIDI: 120.0 BPM" in the MIDI section
//   keys-one-keyboard           K178: with the stub device, the Playground, the Synth and the
//                               Studio take one octave, light and sound the same keys for QWERTY
//                               and MIDI, and release them on Escape and on a workspace switch
//   keyboard-everywhere         M086, K247: the same A plays the one instrument from the
//                               Playground (the Studio transport armed, no page voice), the Synth
//                               panel and the Studio graph (its Keys node), the keys docked in
//                               both; a key held in the Studio and released after leaving it
//                               stops, leaving disarms the keys' run, and the Studio sink's held
//                               map (synthDebug().sinkHeld) reads empty after leaving, the key
//                               still down and after its release (K175, S18)
//   keyboard-studio-held        K175, review S18 (af's criterion): A held on the Studio
//                               keyboard (the Synth panel's Keys, the Studio transport), the
//                               workspace switched to the Playground, then A up: the Studio
//                               sink's held map is empty, the transport holds no live note
//                               (its note census is idle) and the analyser falls below -70 dB
//                               rel (peak). Fails on 447bb27b (the note keeps sounding)
//   midi-seam-reroute           K173 (98's R6 on #410): in the Studio a stub Note On 60 sounds
//                               on the Synth panel's Keys (node A); the keys are re-routed to an
//                               FM voice (node B, METADATA_SET noteTarget); Note On 60 again
//                               reaches B, then two Note Offs: the analyser falls below -70 dB
//                               rel and the sink and the transport hold no note. With the
//                               sink's re-press release removed, A's note hangs and it fails
//   keys-insert-notice          K247, review C3-553-1: on a fresh page (the untouched default
//                               document, 6 nodes) a key in the Playground inserts the Synth
//                               panel into the Studio document and says K246's sentence once,
//                               as a warning notice with its own Zpět (a second key raises no
//                               second one); Zpět there undoes it (6 nodes, Master Output fed
//                               as before); the same in Measure
//   keyboard-qwerty             K026, no MIDI involved (a context without the seam, so it is in
//                               neither group and says nothing about MIDI support): the link
//                               #m=playground&kbd=1 arms the Playground; A, D and G held play C4,
//                               E4 and G4 on the one instrument (K247: the Studio transport holds
//                               three notes, no page voice) and the analysis views show it; held
//                               keys sound past the safety limit while held; releasing them, a
//                               window blur and Escape free every note; X / V raise the octave
//                               and the velocity and the readout says so, and so do the Octave
//                               and Velocity buttons, down and up; Space stays Hold to
//                               Play; a pointer on the on-screen C4 plays and lights it; disarmed,
//                               the keys play nothing; the Studio is armed on its own and plays
//   notes-own-the-scope         C024, in the keyboard-qwerty page: a held computer key alone
//                               owns the output; within 2 s ('notes own the scope') the bridge
//                               draws the notes owner, the canvas description names it and the
//                               status bar says PLAYING, names the same owner and shows the held
//                               note; within 2 s of the release all three name no owner; Hold
//                               to Play over a held key releases the notes and the instrument
//                               is the one owner all three name. Fails
//                               on c589955b (the keyboard overrode vizInputs, which outputOwner
//                               did not know)
//
// A gate build or platform not in the record (the CI runners, ubuntu-latest) is held to the
// states the ADR allows for it and prints what it measured on a RECORD line. There a Chromium
// request still `pending` at its deadline is a recorded outcome, not a failure: the check
// asserts the pending copy, the RECORD line says "pending at the <n> ms deadline", and
// midi-measured-revoke is the declared skip (no access to withdraw). On darwin, the record,
// the same request still pending fails.
//
// Loaded as a module (tests/unit/midi), it opens no run and exports its pure judgements.
'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { serveDist } = require('./lib/serve.cjs');
const { until, WaitTimeout } = require('./lib/wait.cjs');
const midiStub = require('./lib/midi-stub.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const RUN = require.main === module
  ? suite.open({ name: 'midi', browsers: arg('browsers'), origins: arg('origins'),
    defaultOrigins: ['file', 'http'] })
  : null;
const playwright = RUN ? RUN.playwright : null;

const LOAD_MS = 90000;       // the page has reported ready and stated a MIDI state
const SETTLE_MS = 30000;     // a request the stub or Chromium settles
const FIREFOX_MS = 60000;    // Firefox rejects after 3.0-12.9 s (32 runs, ADR 0058)
const STEP_MS = 15000;       // a state change the test drives through the stub
// The disarmed dock's one row (the owner's 'a third of the height'; Train 4's demo-song check).
const ONE_ROW_PX = 120;
/**
 * Take the focus out of the editors (an armed key pressed inside one is the editor's) by a click
 * on the keys' readout, a gesture on no control; where the room folds the docked keys (the
 * Studio, #444 keepsRoom) the readout is hidden, and the focus is put on the page itself.
 */
async function focusOffEditors(page) {
  const readout = page.locator('[data-osc="keyboard.readout"]');
  if (await readout.isVisible()) {
    await readout.click({ force: true });
    return;
  }
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  });
}
const DARWIN = process.platform === 'darwin';
// Off darwin (never measured) a Chromium request the platform leaves unanswered is recorded.
const PENDING_RECORDED = !DARWIN;

// The record of ADR 0058 (darwin arm64, Playwright 1.63.0): the state at load and after
// Connect MIDI without a grant. Off darwin, the states the table allows for that condition.
const MEASURED = {
  chromium: { load: { file: ['needs-permission'], http: ['needs-permission'] },
    connect: DARWIN ? ['denied'] : ['denied', 'failed'] },
  firefox: { load: { file: ['unsupported'], http: ['needs-permission'] },
    connect: ['blocked'] },
  webkit: { load: { file: ['unsupported'], http: ['unsupported'] }, connect: [] },
};
const GRANTED = DARWIN ? ['no-devices'] : ['no-devices', 'failed'];
const MIDI_ONLY = DARWIN ? ['denied'] : ['denied', 'failed'];
const SEAM_LOAD = { chromium: 'needs-permission', firefox: 'needs-permission', webkit: 'unknown' };
// midi-seam-notes forces the context to a rate whose 0.95 x Nyquist (10473.75 Hz) falls between
// two MIDI notes: 123 (9956 Hz) plays, NYQUIST_NOTE 124 (10548 Hz) is refused. The engine suite
// forces the same rate in all three gate builds.
const NOTES_RATE = 22050;
const NYQUIST_NOTE = 124;
const LIMIT_MARGIN_S = 2;    // a note at the safety limit is freed within its release + this
let NOTE_POLYPHONY;
let MAX_OUTPUT_GAIN; // the safety chain's ceiling (core/constants.js), loaded in main()
let MIDI_REFUSED;
let OUTPUT_OWNER_NAMES; // src/js/visualization/output-owner.js (C024)

// ------------------------------------------------------------------------- pure judgements
/**
 * How a request's poll ended. `m` is view()'s result (`timedOut` set when `settled` was not
 * reached by the deadline). With `pendingRecorded`, a request still `pending` at the deadline
 * is an accepted, recorded outcome ({ ok: true, pending: true }); without it, a failure.
 */
function judgeSettled(m, settled, { pendingRecorded = false } = {}) {
  if (!m.timedOut && settled.includes(m.state)) return { ok: true, pending: false };
  if (pendingRecorded && m.timedOut && m.state === 'pending') return { ok: true, pending: true };
  return { ok: false, pending: false };
}

/**
 * midi-measured-no-prompt: null where the page has no API (it queried nothing); otherwise the
 * query must read `prompt` just after the load and again after it.
 */
function judgeNoPrompt(atLoad, after) {
  if (atLoad.api !== 'function') return null;
  return { ok: atLoad.query === 'prompt' && after.query === 'prompt',
    detail: `${atLoad.query} after the load, then ${after.query}` };
}

/** What a RECORD line says the origin was: never the Pages origin itself. */
function originLabel(origin, url) {
  if (origin === 'file') return `file:// (${url})`;
  return `${url} (the Pages-like sub-path served locally on 127.0.0.1, `
    + 'not the Pages origin https://korczis.github.io)';
}

let midiText;
let failures = 0;
let passes = 0;

function check(leg, id, name, ok, detail = '') {
  RUN.tally(leg);
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} [${leg}] ${id}: ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

// ------------------------------------------------------------------------------ page helpers
async function openPage(browser, url, { init, permissions, also } = {}) {
  const context = await browser.newContext(permissions ? { permissions } : {});
  if (init) await context.addInitScript(init.fn, init.arg);
  if (also) await context.addInitScript(also.fn, also.arg);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(url, { waitUntil: 'load' });
  await until(() => page.evaluate(() => {
    const el = document.querySelector('[data-osc="midi.status"]');
    return document.documentElement.dataset.ready === 'true' && !!el && !!el.dataset.midiState;
  }), { ms: LOAD_MS, what: `${url}: the page is ready and states a MIDI support state` });
  return { context, page, errors };
}

const readMidi = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-osc="midi.status"]');
  const btn = document.querySelector('[data-osc="midi.connect"]');
  const row = document.querySelector('[data-osc="midi.actions"]');
  const app = window.OSCILLA && window.OSCILLA.engine;
  return { state: el.dataset.midiState || null, text: el.textContent.trim(),
    // Offered: the button and its whole actions row are shown (the row is what x-show hides).
    offered: !!btn && !!row && row.contains(btn) && row.style.display !== 'none'
      && btn.style.display !== 'none',
    lastError: app && app.lastError ? app.lastError.message : null,
    // The keys' insert of the Synth panel is said by a notice of its own (K247, C3-553-1, its
    // own Zpět): not a MIDI notification, and keys-insert-notice proves it.
    alerts: [...document.querySelectorAll('[data-osc="alerts"] .osc-toast')]
      .filter((el) => !el.querySelector('[data-osc="alert.undo"]')).length };
});

// What the page itself can see of MIDI: which group this context is in, and the platform.
const probe = (page) => page.evaluate(async () => {
  const fn = navigator.requestMIDIAccess;
  let query;
  try {
    const s = await navigator.permissions.query({ name: 'midi' });
    query = s.state;
  } catch (e) {
    query = `rejects ${e && e.name}`;
  }
  return {
    secure: window.isSecureContext,
    api: typeof fn,
    native: typeof fn === 'function'
      && Function.prototype.toString.call(fn).includes('[native code]'),
    marker: window.__oscMidiSeam ? window.__oscMidiSeam.kind : null,
    midiAccess: typeof MIDIAccess,
    query,
  };
});

function inGroup(p, group) {
  if (group === 'measured') return !p.marker && (p.api === 'undefined' || p.native);
  return !!p.marker && !p.native;
}

async function assertGroup(leg, id, page, group) {
  const p = await probe(page);
  check(leg, id, `runs in the ${group} group`, inGroup(p, group), JSON.stringify(p));
  return p;
}

async function openSettings(page) {
  await page.locator('[data-osc="action.settings"]').click();
  await until(() => page.evaluate(() => document.getElementById('osc-dlg-settings').open),
    { ms: STEP_MS, what: 'the Settings dialog opens' });
}

// The MIDI view once `pred` holds, polled against a named deadline; on expiry the view as it
// is, with the timeout, so the check that judges it fails with what the page showed.
async function view(page, pred, what, ms = STEP_MS) {
  try {
    return await until(async () => {
      const m = await readMidi(page);
      return pred(m) ? m : null;
    }, { ms, what });
  } catch (error) {
    if (!(error instanceof WaitTimeout)) throw error;
    return { ...await readMidi(page), timedOut: error.message };
  }
}

const stateIs = (page, states, what, ms = STEP_MS) => view(page,
  (m) => states.includes(m.state), what, ms);

const seam = (page, fn, ...a) => page.evaluate(([f, args]) => window.__oscMidiSeam[f](...args),
  [fn, a]);

// Runs in the page before the application (addInitScript), beside the stub: counts the
// oscillators the page starts and that have not ended, independently of the engine's own
// accounting, and the most whose scheduled [start, stop) intervals overlap; records the highest
// frequency scheduled on an oscillator and, since the last reset(), every gain automation that
// would click (a set to 0 from nonzero, an exponential ramp to 0 or below); and forces the
// context's sample rate to `cfg.sr`. It is test instrumentation, not part of the seam's marker.
function audioProbe(cfg) {
  const T = { oscs: [], maxFreq: 0, clicks: [] };
  const overlap = () => {
    const iv = T.oscs.filter((r) => r.startAt !== null)
      .map((r) => [r.startAt, r.stopAt === null ? Infinity : r.stopAt]);
    let most = 0;
    for (const [a] of iv) most = Math.max(most, iv.filter(([s, e]) => s <= a && a < e).length);
    return most;
  };
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Orig = window[name];
    if (!Orig || !cfg || !cfg.sr) continue;
    window[name] = class extends Orig {
      constructor(o) { super(Object.assign({}, o || {}, { sampleRate: cfg.sr })); }
    };
  }
  const BAC = window.BaseAudioContext || window.AudioContext;
  const freqs = new WeakSet();
  const create = BAC.prototype.createOscillator;
  BAC.prototype.createOscillator = function createOscillator(...a) {
    const o = create.apply(this, a);
    const rec = { started: false, ended: false, startAt: null, stopAt: null };
    T.oscs.push(rec);
    freqs.add(o.frequency);
    o.addEventListener('ended', () => { rec.ended = true; });
    const ctx = this;
    const start = o.start;
    o.start = function startProbe(when = 0, ...x) {
      rec.started = true;
      rec.startAt = Math.max(when, ctx.currentTime);
      return start.call(this, when, ...x);
    };
    // The last stop() before the node stops wins (Web Audio); one after it changes nothing.
    const stop = o.stop;
    o.stop = function stopProbe(when = 0) {
      const at = Math.max(when, ctx.currentTime);
      if (rec.stopAt === null || ctx.currentTime < rec.stopAt) rec.stopAt = at;
      return stop.call(this, when);
    };
    return o;
  };
  const P = AudioParam.prototype;
  const set = P.setValueAtTime;
  P.setValueAtTime = function setProbe(v, t) {
    if (freqs.has(this)) T.maxFreq = Math.max(T.maxFreq, v);
    else if (v === 0 && this.value !== 0) T.clicks.push(`setValueAtTime(0, ${t})`);
    return set.call(this, v, t);
  };
  const exp = P.exponentialRampToValueAtTime;
  P.exponentialRampToValueAtTime = function expProbe(v, t) {
    if (!(v > 0)) T.clicks.push(`exponentialRampToValueAtTime(${v}, ${t})`);
    return exp.call(this, v, t);
  };
  window.__oscMidiAudio = {
    live: () => T.oscs.filter((r) => r.started && !r.ended).length,
    started: () => T.oscs.filter((r) => r.started).length,
    maxFreq: () => T.maxFreq,
    clicks: () => T.clicks.slice(),
    overlap,
    reset() { T.clicks.length = 0; },
  };
}

// What the page sounds: the probe's live oscillators, the engine's own counts and the peak of
// the analyser's current window (the output after the ceiling).
const sound = (page) => page.evaluate(() => {
  const e = window.OSCILLA.engine;
  const A = window.__oscMidiAudio;
  let peak = 0;
  if (e.analyser) {
    const buf = new Float32Array(e.analyser.fftSize);
    e.analyser.getFloatTimeDomainData(buf);
    for (const x of buf) peak = Math.max(peak, Math.abs(x));
  }
  return { live: A.live(), started: A.started(), nodes: e.activeNodeCount,
    sources: e.activeSourceCount, notes: e.noteCount, voices: e.voices.size, peak,
    gain: e.gainLevel, state: e.state, rate: e.sampleRate, safe: e.safeMaximum,
    time: e.ctx ? e.ctx.currentTime : 0, maxFreq: A.maxFreq(), clicks: A.clicks(),
    overlap: A.overlap(),
    lastError: e.lastError ? e.lastError.message : null };
});

// The sound once `pred` holds, polled against a named deadline; on expiry as it is.
async function heard(page, pred, what, ms = STEP_MS) {
  try {
    return await until(async () => {
      const m = await sound(page);
      return pred(m) ? m : null;
    }, { ms, what });
  } catch (error) {
    if (!(error instanceof WaitTimeout)) throw error;
    return { ...await sound(page), timedOut: error.message };
  }
}

// ----------------------------------------------------------------------------- measured group
// A request's poll: settled where it ends in `settled`, else what judgeSettled makes of it.
async function settle(page, leg, settled, what, ms, pendingRecorded) {
  const m = await view(page, (v) => settled.includes(v.state), what, ms);
  return { m, g: judgeSettled(m, settled, { pendingRecorded }) };
}

async function measured(browser, b, origin, url, site) {
  const leg = `${b}/${origin}`;
  const build = `gate build ${b} ${browser.version()}, ${process.platform} ${process.arch}, `
    + `${origin}`;
  const where = originLabel(origin, url);
  const expected = MEASURED[b];
  const lenient = b === 'chromium' && PENDING_RECORDED;
  const pendingAt = (ms) => `pending at the ${ms} ms deadline`;

  // midi-measured-load, midi-measured-no-prompt
  {
    const id = 'midi-measured-load';
    const { context, page, errors } = await openPage(browser, url);
    try {
      const p = await assertGroup(leg, id, page, 'measured');
      const m = await view(page, (v) => v.offered === (p.api === 'function'),
        `${leg}: Connect MIDI is offered exactly where the API is`);
      console.log(`  RECORD [${leg}] ${JSON.stringify({ build, origin: where, ...p,
        state: m.state })}`);
      check(leg, id, `${build}: the state at load is ${expected.load[origin].join(' or ')}`,
        expected.load[origin].includes(m.state) && p.secure === true, m.state);
      check(leg, id, `${build}: the copy is the ADR's`, m.text === midiText(m.state, { site }),
        m.text);
      const np = judgeNoPrompt(p, await probe(page));
      if (np) {
        check(leg, 'midi-measured-no-prompt', `${build}: where the API exists the query reads `
          + 'prompt after the load, and still does', np.ok, np.detail);
      }
      check(leg, id, `${build}: Connect MIDI is offered exactly where the API is`,
        m.offered === (p.api === 'function'), JSON.stringify(m));
      check(leg, id, 'no console or page error at load', errors.length === 0, errors.join(' | '));
    } finally {
      await context.close();
    }
  }

  // midi-measured-connect
  {
    const id = 'midi-measured-connect';
    const { context, page, errors } = await openPage(browser, url);
    try {
      await assertGroup(leg, id, page, 'measured');
      await openSettings(page);
      const before = await readMidi(page);
      if (!before.offered) {
        check(leg, id, `${build}: Connect MIDI is not offered (${before.state})`,
          ['unsupported', 'insecure'].includes(before.state)
            && await page.locator('[data-osc="midi.connect"]').isHidden()
            && await page.locator('[data-osc="midi.actions"]').isHidden(), before.state);
      } else {
        const t0 = Date.now();
        await page.locator('[data-osc="midi.connect"]').click();
        if (b === 'firefox') {
          const p = await stateIs(page, ['pending', ...expected.connect],
            `${leg}: Firefox states pending after Connect MIDI`);
          check(leg, id, `${build}: pending while the browser has not answered`,
            p.state === 'pending' && p.text === midiText('pending', { site }),
            `${p.state} after ${Date.now() - t0} ms`);
        }
        const ms = b === 'firefox' ? FIREFOX_MS : SETTLE_MS;
        const { m, g } = await settle(page, leg, expected.connect,
          `${leg}: the request settles to ${expected.connect.join(' or ')}`, ms, lenient);
        const after = await probe(page);
        console.log(`  RECORD [${leg}] ${JSON.stringify({ build, origin: where,
          connect: g.pending ? pendingAt(ms) : m.state, ms: Date.now() - t0,
          query: after.query })}`);
        if (g.pending) {
          check(leg, id, `${build}: Connect MIDI is still ${pendingAt(ms)} (recorded off darwin), `
            + 'with the ADR\'s copy', m.text === midiText('pending', { site }), m.text);
        } else {
          const copyOk = m.state === 'failed'
            ? /^MIDI could not start on this computer \(the browser reported \w+\)\.$/.test(m.text)
            : m.text === midiText(m.state, { site });
          check(leg, id, `${build}: Connect MIDI ends ${m.state}, with the ADR's copy`,
            g.ok && copyOk, `${m.text} (${Date.now() - t0} ms)`);
        }
        check(leg, id, `${build}: the query no longer chooses the state (reads ${after.query})`,
          after.query === 'prompt', after.query);
      }
      const end = await readMidi(page);
      check(leg, id, 'the page reports no error and raises no notification for MIDI',
        !end.lastError && end.alerts === 0 && errors.length === 0,
        JSON.stringify({ lastError: end.lastError, alerts: end.alerts, errors }));
    } finally {
      await context.close();
    }
  }

  // midi-measured-grant
  if (b !== 'chromium') {
    RUN.skip(leg, 'midi-measured-grant', `${b}: Playwright's midi permission grants change the `
      + 'outcome in Chromium only (Firefox refuses the names; WebKit has no Web MIDI)');
  } else {
    const id = 'midi-measured-grant';
    {
      const { context, page } = await openPage(browser, url, { permissions: ['midi'] });
      try {
        await assertGroup(leg, id, page, 'measured');
        const m = await readMidi(page);
        check(leg, id, `${build}: the midi grant reads allowed at load`,
          m.state === 'allowed' && m.text === midiText('allowed', { site }), m.text);
        await openSettings(page);
        await page.locator('[data-osc="midi.connect"]').click();
        const { m: r, g } = await settle(page, leg, MIDI_ONLY, `${leg}: midi alone settles`,
          SETTLE_MS, lenient);
        console.log(`  RECORD [${leg}] ${JSON.stringify({ build, origin: where,
          midiOnly: g.pending ? pendingAt(SETTLE_MS) : r.state })}`);
        check(leg, id, `${build}: midi alone still ends `
          + `${g.pending ? pendingAt(SETTLE_MS) : r.state}`, g.ok
          && (!g.pending || r.text === midiText('pending', { site })), r.text);
      } finally {
        await context.close();
      }
    }
    const { context, page } = await openPage(browser, url,
      { permissions: ['midi', 'midi-sysex'] });
    try {
      await assertGroup(leg, id, page, 'measured');
      const m = await readMidi(page);
      check(leg, id, `${build}: midi + midi-sysex reads allowed at load`, m.state === 'allowed',
        m.text);
      await openSettings(page);
      await page.locator('[data-osc="midi.connect"]').click();
      const { m: r, g } = await settle(page, leg, GRANTED, `${leg}: the granted request settles`,
        SETTLE_MS, lenient);
      const outcome = g.pending ? pendingAt(SETTLE_MS) : r.state;
      console.log(`  RECORD [${leg}] ${JSON.stringify({ build, origin: where, granted: outcome,
        text: r.text })}`);
      if (g.pending) {
        check(leg, id, `${build}: the granted request is still ${outcome} (recorded off darwin), `
          + 'with the ADR\'s copy', r.text === midiText('pending', { site }), r.text);
      } else {
        check(leg, id, `${build}: the granted request ends ${r.state}`, g.ok
          && (r.state !== 'no-devices' || r.text === midiText('no-devices', { site })), r.text);
      }
      if (g.ok && r.state === 'no-devices') {
        await context.clearPermissions();
        const v = await stateIs(page, ['revoked'], `${leg}: a cleared grant is revoked`);
        check(leg, id, `${build}: clearing the grant reads revoked`,
          v.text === midiText('revoked', { site }), v.text);
      } else {
        RUN.skip(leg, 'midi-measured-revoke', `${build}: the granted request `
          + `${g.pending ? `was still ${outcome}` : `ended ${r.state}`}, so there is no access `
          + 'to withdraw');
      }
    } finally {
      await context.close();
    }
  }

  // midi-measured-stub-fidelity
  {
    const id = 'midi-measured-stub-fidelity';
    const { context, page } = await openPage(browser, url);
    try {
      const p = await probe(page);
      if (p.midiAccess !== 'function') {
        RUN.skip(leg, 'midi-measured-stub-fidelity',
          `${build}: no MIDIAccess interface to compare the stub with`);
      } else {
        check(leg, id, 'runs in the measured group', inGroup(p, 'measured'), JSON.stringify(p));
        const rows = await page.evaluate(midiStub.install,
          { dry: true, reads: midiStub.PAGE_READS });
        const off = rows.filter((r) => r.stub === 'missing' || r.stub !== r.real);
        check(leg, id, `${build}: the stub holds every member the page reads as the real `
          + 'interface does', rows.length > 0 && off.length === 0,
        JSON.stringify(off.length ? off : rows.map((r) => `${r.member}:${r.real}`)));
        const q = await probe(page);
        check(leg, id, 'the comparison installed nothing', inGroup(q, 'measured'),
          JSON.stringify(q));
      }
    } finally {
      await context.close();
    }
  }
}

// --------------------------------------------------------------------------------- seam group
async function seamChecks(browser, b, origin, url, site) {
  const leg = `${b}/${origin}`;
  const loadState = MEASURED[b].load[origin];

  // midi-seam-no-request-at-load (the spy calls through: the platform's own state)
  {
    const id = 'midi-seam-no-request-at-load';
    const { context, page } = await openPage(browser, url, { init: { fn: midiStub.spy } });
    try {
      const counts = await seam(page, 'counts'); // before probe(), whose own query is counted
      const p = await probe(page);
      check(leg, id, 'runs in the seam group (spy)', p.marker === 'spy'
        && (p.api === 'undefined' || !p.native), JSON.stringify(p));
      const m = await readMidi(page);
      const queriesExpected = p.api === 'function' ? 1 : 0;
      check(leg, id, 'loading the page calls requestMIDIAccess zero times',
        counts.requests.length === 0, JSON.stringify(counts));
      check(leg, id, `loading queries the midi permission ${queriesExpected} time(s) and nothing `
        + 'else', counts.queries.filter((n) => n === 'midi').length === queriesExpected
          && counts.queries.every((n) => n === 'midi'), JSON.stringify(counts.queries));
      check(leg, id, `handles (spied API): the state is the platform's (${m.state})`,
        loadState.includes(m.state), m.state);
      if (m.offered) {
        await openSettings(page);
        await page.locator('[data-osc="midi.connect"]').click();
        const after = await until(async () => {
          const c = await seam(page, 'counts');
          return c.requests.length ? c : null;
        }, { ms: STEP_MS, what: `${leg}: Connect MIDI calls requestMIDIAccess` });
        check(leg, id, 'Connect MIDI, the explicit action, calls it once with { sysex: false }',
          JSON.stringify(after.requests) === JSON.stringify([{ sysex: false }]),
          JSON.stringify(after.requests));
      }
    } finally {
      await context.close();
    }
  }

  const { context, page, errors } = await openPage(browser, url,
    { init: { fn: midiStub.install, arg: {} } });
  try {
    // midi-seam-load
    {
      const id = 'midi-seam-load';
      await assertGroup(leg, id, page, 'seam');
      const m = await view(page, (v) => v.state === SEAM_LOAD[b] && v.offered,
        `${leg}: the stubbed page states ${SEAM_LOAD[b]} and offers Connect MIDI`);
      check(leg, id, `handles (stubbed API): the query chooses ${SEAM_LOAD[b]} at load`,
        m.state === SEAM_LOAD[b] && m.text === midiText(SEAM_LOAD[b], { site }) && m.offered,
        m.text);
      check(leg, id, 'loading makes no request', (await seam(page, 'calls')).length === 0);
    }

    // midi-seam-connect (by keyboard)
    {
      const id = 'midi-seam-connect';
      await assertGroup(leg, id, page, 'seam');
      const NAME = midiStub.STUB_NAME;
      const SECOND = `${NAME} 2`;
      const THIRD = `${NAME} 3`;
      await openSettings(page);
      await page.locator('[data-osc="midi.connect"]').focus();
      await page.keyboard.press('Enter');
      const p = await stateIs(page, ['pending'], `${leg}: Enter on Connect MIDI states pending`);
      check(leg, id, 'handles (stubbed API): Enter on Connect MIDI asks once, { sysex: false }, '
        + 'and states pending', p.text === midiText('pending', { site })
          && JSON.stringify(await seam(page, 'calls')) === JSON.stringify([{ sysex: false }]),
      JSON.stringify(await seam(page, 'calls')));
      await seam(page, 'resolve', 0, [NAME]);
      const c = await stateIs(page, ['connected'], `${leg}: the stub device connects`);
      check(leg, id, 'handles (stubbed API): connected names the self-naming stub device',
        c.text === midiText('connected', { names: [NAME] }), c.text);
      await seam(page, 'plug', SECOND);
      const two = await view(page,
        (m) => m.text === midiText('connected', { names: [NAME, SECOND] }),
        `${leg}: a second input is listed`);
      check(leg, id, 'handles (stubbed API): a second input joins the names', !two.timedOut,
        two.text);
      await seam(page, 'unplug', NAME);
      const one = await view(page, (m) => m.text === midiText('connected', { names: [SECOND] }),
        `${leg}: one of two inputs leaves`);
      check(leg, id, 'handles (stubbed API): one of two leaves, still connected',
        !one.timedOut && one.state === 'connected', one.text);
      await seam(page, 'unplug', SECOND);
      const d = await stateIs(page, ['disconnected'], `${leg}: the last input leaves`);
      check(leg, id, 'handles (stubbed API): the last leaves, disconnected with its name',
        d.text === midiText('disconnected', { name: SECOND }), d.text);
      await seam(page, 'plug', THIRD);
      const back = await stateIs(page, ['connected'], `${leg}: a device plugged in connects`);
      check(leg, id, 'handles (stubbed API): a device plugged in after it connects',
        back.text === midiText('connected', { names: [THIRD] }), back.text);
      const msg = await page.evaluate((name) => {
        let got = null;
        const port = window.__oscMidiSeam.port(name);
        port.addEventListener('midimessage', (e) => {
          got = { data: [...e.data], u8: e.data instanceof Uint8Array, ts: typeof e.timeStamp };
        });
        window.__oscMidiSeam.message(name, [0x90, 60, 100]);
        return got;
      }, THIRD);
      check(leg, id, 'the stub input dispatches midimessage with a Uint8Array and a timeStamp',
        !!msg && msg.u8 && msg.ts === 'number' && msg.data.join() === '144,60,100',
        JSON.stringify(msg));
    }

    // midi-seam-no-devices
    {
      const id = 'midi-seam-no-devices';
      await assertGroup(leg, id, page, 'seam');
      await page.locator('[data-osc="midi.connect"]').click();
      await stateIs(page, ['pending'], `${leg}: Connect MIDI again starts a new request`);
      await seam(page, 'resolve', 1, []);
      const n = await stateIs(page, ['no-devices'], `${leg}: an access without inputs`);
      check(leg, id, 'handles (stubbed API): an access without inputs reads no-devices',
        n.text === midiText('no-devices', { site }), n.text);
      await seam(page, 'plug', midiStub.STUB_NAME);
      const c = await stateIs(page, ['connected'], `${leg}: a device after no-devices`);
      check(leg, id, 'handles (stubbed API): a device plugged in connects',
        c.text === midiText('connected', { names: [midiStub.STUB_NAME] }), c.text);
    }

    // midi-seam-rejections
    {
      const id = 'midi-seam-rejections';
      await assertGroup(leg, id, page, 'seam');
      let i = 2;
      for (const [name, state] of [['SecurityError', 'blocked'], ['NotAllowedError', 'denied'],
        ['NotSupportedError', 'failed']]) {
        await page.locator('[data-osc="midi.connect"]').click();
        await stateIs(page, ['pending'], `${leg}: request ${i} is pending`);
        await seam(page, 'reject', i, name);
        const r = await stateIs(page, [state], `${leg}: ${name} reads ${state}`);
        check(leg, id, `handles (stubbed API): ${name} reads ${state}`,
          r.text === midiText(state, { site, error: name }), r.text);
        i += 1;
      }
      await page.locator('[data-osc="midi.connect"]').click();
      await page.locator('[data-osc="midi.connect"]').click();
      await until(async () => (await seam(page, 'calls')).length === i + 2,
        { ms: STEP_MS, what: `${leg}: two more requests are made` });
      await seam(page, 'reject', i + 1, 'NotAllowedError');
      await stateIs(page, ['denied'], `${leg}: the newer request is denied`);
      await seam(page, 'resolve', i, [midiStub.STUB_NAME]);
      // The condition: the older request's settlement has reached the page (every reaction the
      // page attached to it has run), polled against a named deadline; only then is it judged.
      await until(() => seam(page, 'delivered', i),
        { ms: STEP_MS, what: `${leg}: the older request's resolution reaches the page` });
      const last = await readMidi(page);
      const stale = await seam(page, 'listening', i);
      check(leg, id, 'handles (stubbed API): an older request that resolves later is ignored',
        last.state === 'denied' && stale === 0,
        `${last.state}; ${stale} statechange listener(s) on the older access`);
      check(leg, id, 'the page reports no error and raises no notification for MIDI',
        !last.lastError && last.alerts === 0 && errors.length === 0,
        JSON.stringify({ lastError: last.lastError, alerts: last.alerts, errors }));
    }
  } finally {
    await context.close();
  }
}

// midi-seam-notes (V502): synthetic MIDI events from the stub sound through the AudioEngine.
async function seamNotes(browser, b, origin, url) {
  const leg = `${b}/${origin}`;
  const id = 'midi-seam-notes';
  const NAME = midiStub.STUB_NAME;
  const { context, page, errors } = await openPage(browser, url,
    { init: { fn: midiStub.install, arg: {} }, also: { fn: audioProbe, arg: { sr: NOTES_RATE } } });
  try {
    await assertGroup(leg, id, page, 'seam');
    await openSettings(page);
    await page.locator('[data-osc="midi.connect"]').click(); // the gesture also starts audio
    await stateIs(page, ['pending'], `${leg}: Connect MIDI asks`);
    await seam(page, 'resolve', 0, [NAME]);
    await stateIs(page, ['connected'], `${leg}: the stub device connects`);
    await page.keyboard.press('Escape'); // the dialog closes (Escape also frees nothing yet)
    const msg = (bytes) => seam(page, 'message', NAME, bytes);
    // K247: the notes play the one instrument, the Studio transport (its live notes and the
    // analyser), never an engine voice of the page's own (notes and voices stay 0).
    const sounding = (m) => m.state === 'running' && m.peak > 0.005 && m.notes === 0;
    const silent = async (what) => until(async () => {
      const [m, t] = [await sound(page), await instrument(page)];
      return m.peak < SILENT_PEAK && t.held.length === 0 && m.notes === 0 ? { ...m, ...t } : null;
    }, { ms: STEP_MS, what }).catch(async (error) => ({ ...await sound(page),
      ...await instrument(page), timedOut: error.message }));

    await msg([0x90, 60, 127]);
    const one = await heard(page, sounding, `${leg}: a Note On sounds on the instrument`);
    const t1 = await instrument(page);
    check(leg, id, 'handles (stubbed API): a Note On plays the one instrument (the Studio '
      + `transport holds it, ${one.rate} Hz context, the forced ${NOTES_RATE}), no page voice`,
    !one.timedOut && one.rate === NOTES_RATE && t1.playing && t1.held.includes(60)
      && one.voices === 0, JSON.stringify({ ...one, ...t1 }));
    // The instrument's voice may pass the user's master level (a resonant filter, K247); the
    // guarantee is the safety chain's ceiling, MAX_OUTPUT_GAIN, which the engine enforces (T001).
    check(leg, id, 'velocity 127 peaks at or under the output ceiling (MAX_OUTPUT_GAIN)',
      one.peak <= MAX_OUTPUT_GAIN + 1e-4, `peak ${one.peak} vs ${MAX_OUTPUT_GAIN}`);
    const lit = await page.evaluate(() => window.OSCILLA.app.kbdHeld);
    check(leg, id, 'the on-screen keys light the MIDI note while it sounds (K026)',
      lit === 'C4 (MIDI)', lit);

    // A chord of more notes than the Playground's old polyphony: the instrument's own voices.
    const chord = Array.from({ length: NOTE_POLYPHONY + 4 }, (_, i) => 48 + 2 * i);
    let loudest = 0;
    for (const n of chord) await msg([0x90, n, 127]);
    const full = await heard(page, (m) => { loudest = Math.max(loudest, m.peak); return sounding(m); },
      `${leg}: the chord sounds`);
    check(leg, id, `a chord of ${chord.length} notes peaks at or under the output ceiling`,
      !full.timedOut && loudest > 0 && loudest <= MAX_OUTPUT_GAIN + 1e-4,
      `${loudest} vs ${MAX_OUTPUT_GAIN}`);

    // Note Off and velocity 0 release everything.
    for (const [i, n] of [60, ...chord].entries()) {
      await msg(i % 2 ? [0x90, n, 0] : [0x80, n, 64]);
    }
    const gone = await silent(`${leg}: Note Off frees every note`);
    check(leg, id, 'Note Off and velocity 0 leave the instrument holding no note and the '
      + 'output below -70 dB rel', !gone.timedOut, JSON.stringify(gone));

    // The 0.95 x Nyquist bound of the running context: the instrument's voices clamp every
    // frequency to it (studio/adapters/engine-hooks.js clampFrequency), so a note above the bound
    // sounds at it, never above; read from the analyser's spectrum, as the oscillator probe does
    // not see a frequency set by automation.
    const peakHz = () => page.evaluate(() => {
      const e = window.OSCILLA.engine;
      const a = e.analyser;
      const bins = new Float32Array(a.frequencyBinCount);
      a.getFloatFrequencyData(bins);
      let at = 0;
      for (let i = 1; i < bins.length; i++) if (bins[i] > bins[at]) at = i;
      return { hz: at * e.sampleRate / a.fftSize, db: bins[at] };
    });
    const above = NYQUIST_NOTE;
    const safeHz = (await sound(page)).safe;
    const loudAt = async (note, what) => {
      await msg([0x90, note, 100]);
      await heard(page, sounding, what);
      const p = await until(async () => { const x = await peakHz(); return x.db > -100 ? x : null; },
        { ms: STEP_MS, what }).catch(peakHz);
      await msg([0x80, note, 0]);
      await silent(`${what}: released`);
      return p;
    };
    const hi = await loudAt(above, `${leg}: note ${above} sounds clamped`);
    const lo = await loudAt(above - 1, `${leg}: note ${above - 1} sounds`);
    const bin = NOTES_RATE / 2048; // the analyser's resolution at its smallest fftSize, a bound
    check(leg, id, `note ${above} (at or above 0.95 x Nyquist at ${NOTES_RATE} Hz) sounds at most `
      + `at the bound (${Math.round(safeHz)} Hz), ${above - 1} below it`,
    hi.hz <= safeHz + bin && lo.hz <= safeHz + bin && lo.hz > 1000,
    JSON.stringify({ hi, lo, safeHz }));

    // Unplugging with keys down, then Escape with keys down.
    await msg([0x90, 60, 100]);
    await msg([0x90, 67, 100]);
    await heard(page, sounding, `${leg}: two held notes sound`);
    await seam(page, 'unplug', NAME);
    const unplugged = await silent(`${leg}: unplugging frees the held notes`);
    check(leg, id, 'held notes stop when their input is unplugged', !unplugged.timedOut,
      JSON.stringify(unplugged));
    const SECOND = `${NAME} 2`;
    await seam(page, 'plug', SECOND);
    await stateIs(page, ['connected'], `${leg}: a device plugged in connects`);
    await seam(page, 'message', SECOND, [0x90, 64, 100]);
    await heard(page, sounding, `${leg}: the new input's note sounds`);
    await page.keyboard.press('Escape');
    const escaped = await silent(`${leg}: Escape frees the held note`);
    check(leg, id, 'a held note stops on Escape', !escaped.timedOut, JSON.stringify(escaped));

    // The session safety limit (ADR 0062): a held note sounds past it while its key is down;
    // a window blur (a Note Off may never come while another window has the focus) releases it.
    const { limitS, releaseS } = await page.evaluate(() => ({
      limitS: window.OSCILLA.app.safetyLimit, releaseS: window.OSCILLA.app.release / 1000 }));
    const sent = (await sound(page)).time;
    await seam(page, 'message', SECOND, [0x90, 72, 100]);
    const held = await heard(page, sounding, `${leg}: a held note sounds`);
    const past = await heard(page, (m) => m.time - sent > limitS + releaseS + LIMIT_MARGIN_S,
      `${leg}: the audio clock passes the safety limit`,
      (limitS + releaseS + LIMIT_MARGIN_S + 10) * 1000);
    const tPast = await instrument(page);
    check(leg, id, `a held note sounds past the session safety limit (${limitS} s) while held`,
      !held.timedOut && !past.timedOut && past.peak > 0.005 && tPast.held.includes(72),
      JSON.stringify({ sent, at: past.time, peak: past.peak, held: tPast.held, limitS }));
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const blurred = await silent(`${leg}: a window blur frees the held note`);
    check(leg, id, 'a window blur releases the held note', !blurred.timedOut,
      JSON.stringify(blurred));
    const end = await readMidi(page);
    check(leg, id, 'the page reports no error and raises no notification for MIDI notes',
      !end.lastError && end.alerts === 0 && errors.length === 0,
      JSON.stringify({ lastError: end.lastError, alerts: end.alerts, errors }));

    // The sequencer plays into the master outside the instrument (review of #261, P2-1, C036):
    // starting a sequence releases every held note, and while it plays a Note On is refused and
    // said once. It loops, so it is still playing however long the checks take.
    await page.evaluate(() => window.OSCILLA.app.setSafetyLimit(5));
    await seam(page, 'message', SECOND, [0x90, 60, 100]);
    await seam(page, 'message', SECOND, [0x90, 64, 100]);
    await until(async () => ((await instrument(page)).held.length === 2 ? true : null),
      { ms: STEP_MS, what: `${leg}: two held notes before the sequence` }).catch(() => null);
    const start = await page.evaluate(() => {
      const ed = window.OSCILLA.labs.sequencer.editor;
      ed.setLoop(true);
      return { started: ed.play() };
    });
    const hushed = await silent(`${leg}: starting the sequence frees the notes`)
      .then((x) => x, () => null);
    const tStart = await instrument(page);
    check(leg, id, 'starting the sequencer releases every held MIDI note',
      start.started === true && tStart.held.length === 0,
      JSON.stringify({ ...start, held: tStart.held, hushed: hushed && hushed.timedOut }));
    await page.evaluate((x) => window.OSCILLA.app.setSafetyLimit(x), limitS);
    await seam(page, 'message', SECOND, [0x90, 67, 100]);
    await seam(page, 'message', SECOND, [0x90, 69, 100]);
    const tDuring = await instrument(page); // read at once: a note let through would be held
    let said = null;
    try {
      said = await until(() => page.evaluate(() => {
        const t = [...document.querySelectorAll('[data-osc="alerts"] .osc-toast')]
          .filter((el) => !el.querySelector('[data-osc="alert.undo"]')) // the insert's (K247)
          .map((el) => el.textContent.replace(/\s+/g, ' ').trim());
        return t.length ? t : null;
      }), { ms: STEP_MS, what: `${leg}: the refused note is said` });
    } catch (error) {
      if (!(error instanceof WaitTimeout)) throw error;
    }
    const playing = await page.evaluate(() => window.OSCILLA.labs.sequencer.editor.playing);
    check(leg, id, 'while the sequencer plays a Note On is refused, and said once',
      playing === true && tDuring.held.length === 0 && !!said && said.length === 1
      && said[0].includes(MIDI_REFUSED.sequencer),
    JSON.stringify({ playing, held: tDuring.held, said }));
    await page.evaluate(() => window.OSCILLA.labs.sequencer.editor.stop());
    await seam(page, 'message', SECOND, [0x90, 72, 100]);
    const again = await heard(page, sounding, `${leg}: a note sounds once the sequence stopped`);
    check(leg, id, 'once the sequencer stops, a Note On sounds again', !again.timedOut,
      JSON.stringify({ peak: again.peak }));
    await seam(page, 'message', SECOND, [0x80, 72, 0]);
    const quiet = await silent(`${leg}: the sequence and the notes are freed`);
    check(leg, id, 'the sequence and the notes leave the instrument holding nothing and the '
      + 'output silent, with no error', !quiet.timedOut && !quiet.lastError
      && errors.length === 0, JSON.stringify({ ...quiet, errors }));
  } finally {
    await context.close();
  }
}

/** The one instrument's state (K247): the Studio transport's armed run and held notes. */
async function instrument(page) {
  return page.evaluate(() => {
    const t = window.OSCILLA.studio && window.OSCILLA.studio.transport;
    const held = t && typeof t.heldNotes === 'function' ? t.heldNotes() : [];
    return { armed: !!(t && t.armed), playing: !!(t && t.playing),
      held: held.map((h) => (typeof h === 'number' ? h : h.note)) };
  });
}

// midi-seam-sink (review of src/js/synth, S2; K247): a note-off goes where its note-on sounded.
// A note held on the one instrument in the Playground, then a switch to the Synth: leaving the
// Playground ends the keys' armed-only run (LEAVE_POLICY), so the note stops with the switch;
// its later Note Off finds it released and leaves nothing sounding, and a note in the Synth then
// sounds and is freed by its own Note Off.
async function seamSink(browser, b, origin, url) {
  const leg = `${b}/${origin}`;
  const id = 'midi-seam-sink';
  const NAME = midiStub.STUB_NAME;
  const { context, page, errors } = await openPage(browser, url,
    { init: { fn: midiStub.install, arg: {} }, also: { fn: audioProbe, arg: { sr: NOTES_RATE } } });
  try {
    await assertGroup(leg, id, page, 'seam');
    await openSettings(page);
    await page.locator('[data-osc="midi.connect"]').click(); // the gesture also starts audio
    await stateIs(page, ['pending'], `${leg}: Connect MIDI asks`);
    await seam(page, 'resolve', 0, [NAME]);
    await stateIs(page, ['connected'], `${leg}: the stub device connects`);
    await page.keyboard.press('Escape'); // the dialog closes before any note sounds
    await until(() => page.evaluate(() => !document.getElementById('osc-dlg-settings').open),
      { ms: STEP_MS, what: `${leg}: the Settings dialog closes` });
    const msg = (bytes) => seam(page, 'message', NAME, bytes);
    const ws = () => page.evaluate(() => window.OSCILLA.app.workspace);
    const quiet = (what) => until(async () => {
      const [m, t] = [await sound(page), await instrument(page)];
      return m.peak < SILENT_PEAK && !t.held.length ? { ...m, ...t } : null;
    }, { ms: STEP_MS, what }).catch(async (e) => ({ ...await sound(page),
      ...await instrument(page), timedOut: e.message }));
    const from = await ws();
    await msg([0x90, 60, 100]);
    const on = await heard(page, (m) => m.state === 'running' && m.peak > 0.005,
      `${leg}: a note sounds on the instrument in the Playground`);
    const tOn = await instrument(page);
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('synth'));
    await until(async () => (await ws()) === 'synth', { ms: STEP_MS,
      what: `${leg}: the Synth workspace opens` });
    const left = await quiet(`${leg}: leaving the Playground ends the keys' run`);
    await msg([0x80, 60, 0]);
    const after = await quiet(`${leg}: the late Note Off leaves nothing sounding`);
    check(leg, id, 'a note held on the instrument in the Playground stops with the switch to the '
      + 'Synth, and its late Note Off leaves nothing sounding', from === 'playground'
      && !on.timedOut && tOn.held.includes(60) && !left.timedOut && !after.timedOut,
    JSON.stringify({ from, on: on.peak, held: tOn.held, left, after }));
    await msg([0x90, 62, 100]);
    const synthOn = await heard(page, (m) => m.peak > 0.005, `${leg}: a note sounds in the Synth`);
    await msg([0x80, 62, 0]);
    const synthOff = await quiet(`${leg}: its Note Off frees it`);
    check(leg, id, 'in the Synth a note sounds on the same instrument and its Note Off frees it',
      !synthOn.timedOut && !synthOff.timedOut && errors.length === 0,
      JSON.stringify({ on: synthOn.peak, off: synthOff, errors }));
  } finally {
    await context.close();
  }
}

// midi-seam-cc (V506): the controller's pedal and knobs (src/js/midi/notes.js sustain,
// src/js/synth/midi-cc.js), driven through the stub device.
async function seamCc(browser, b, origin, url) {
  const leg = `${b}/${origin}`;
  const id = 'midi-seam-cc';
  const NAME = midiStub.STUB_NAME;
  const { context, page, errors } = await openPage(browser, url,
    { init: { fn: midiStub.install, arg: {} }, also: { fn: audioProbe, arg: { sr: NOTES_RATE } } });
  try {
    await assertGroup(leg, id, page, 'seam');
    await openSettings(page);
    await page.locator('[data-osc="midi.connect"]').click(); // the gesture also starts audio
    await stateIs(page, ['pending'], `${leg}: Connect MIDI asks`);
    await seam(page, 'resolve', 0, [NAME]);
    await stateIs(page, ['connected'], `${leg}: the stub device connects`);
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => !document.getElementById('osc-dlg-settings').open),
      { ms: STEP_MS, what: `${leg}: the Settings dialog closes` });
    const msg = (bytes) => seam(page, 'message', NAME, bytes);

    // The pedal: a Note Off under it leaves the note sounding; the pedal up releases it. The
    // note plays the one instrument (K247): the Studio transport holds it.
    await msg([0xb0, 64, 127]);
    await msg([0x90, 60, 100]);
    const on = await heard(page, (m) => m.state === 'running' && m.peak > 0.005,
      `${leg}: a note sounds on the instrument`);
    // The stub dispatches synchronously: after msg() the page has handled the message.
    const holding = async () => (await instrument(page)).held.filter((n) => n === 60).length;
    await msg([0x80, 60, 0]);
    const kept = await holding();
    await msg([0xb0, 64, 0]);
    const let_ = await holding();
    const freed = await heard(page, (m) => m.peak < SILENT_PEAK,
      `${leg}: the pedal up releases the note`);
    check(leg, id, 'CC 64 holds a note past its Note Off and its release frees it',
      !on.timedOut && kept === 1 && let_ === 0 && !freed.timedOut,
      JSON.stringify({ on: on.peak, kept, let: let_, freed: freed.peak }));

    // A knob: nothing in the Playground, the LPF cutoff in the Synth.
    const cutoff = () => page.evaluate(() => {
      const n = window.OSCILLA.studio.model.graph.nodes.find((x) => x.metadata
        && x.metadata.panel && x.metadata.panel.module === 'lpf');
      return n ? n.params.frequency : null;
    });
    const before = await cutoff();
    await msg([0xb0, 74, 0]);
    const still = await cutoff();
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('synth'));
    const shown = await until(async () => ((await cutoff()) !== null ? true : null),
      { ms: STEP_MS, what: `${leg}: the Synth panel is in the document` }).then(() => true,
      () => false);
    const start = await cutoff();
    await msg([0xb0, 74, 0]);
    const low = await until(async () => ((await cutoff()) === 10 ? true : null),
      { ms: STEP_MS, what: `${leg}: CC 74 = 0 sets the cutoff to 10 Hz` }).then(() => true,
      () => false);
    await msg([0xb0, 74, 127]);
    const high = await until(async () => ((await cutoff()) === 20000 ? true : null),
      { ms: STEP_MS, what: `${leg}: CC 74 = 127 sets the cutoff to 20 kHz` }).then(() => true,
      () => false);
    const status = await page.locator('[data-osc="synth.status"]').textContent();
    check(leg, id, 'a CC moves no Synth knob outside the Synth', still === before,
      JSON.stringify({ before, still }));
    check(leg, id, 'in the Synth CC 74 moves the LPF cutoff to both ends of its range',
      shown && start === 1200 && low && high, JSON.stringify({ start, low, high }));
    check(leg, id, 'the Synth\'s status line names the CC and the control',
      /CC 74 → LPF Cutoff/.test(status || ''), status);
    check(leg, id, 'no console or page error', errors.length === 0, errors.join(' | '));
  } finally {
    await context.close();
  }
}

// midi-seam-monitor (V507): see the header.
async function seamMonitor(browser, b, origin, url) {
  const leg = `${b}/${origin}`;
  const id = 'midi-seam-monitor';
  const PLAY = `${midiStub.STUB_NAME} · KeyLab mkII 61 MIDI`;
  const DAW = `${midiStub.STUB_NAME} · KeyLab mkII 61 DAW`;
  const { context, page, errors } = await openPage(browser, url,
    { init: { fn: midiStub.install, arg: {} }, also: { fn: audioProbe, arg: { sr: NOTES_RATE } } });
  try {
    await assertGroup(leg, id, page, 'seam');
    await openSettings(page);
    await page.locator('[data-osc="midi.connect"]').click(); // the gesture also starts audio
    await stateIs(page, ['pending'], `${leg}: Connect MIDI asks`);
    await seam(page, 'resolve', 0, [PLAY, DAW]);
    await stateIs(page, ['connected'], `${leg}: the two ports connect`);
    const list = page.locator('[data-osc="midi.devices"]');
    const rows = await until(async () => {
      const t = await list.evaluate((el) => (el.offsetParent ? el.innerText : ''));
      return /KeyLab mkII · \d+ ovladačů/.test(t) && /ovládání DAW/.test(t) && /hraní/.test(t)
        ? t : null;
    }, { ms: STEP_MS, what: `${leg}: the device list names the device and the roles` })
      .catch(() => null);
    check(leg, id, 'the MIDI section lists both ports with the device and their roles', !!rows,
      String(rows));
    const msg = (name, bytes) => seam(page, 'message', name, bytes);
    const live = async () => (await instrument(page)).held.length;
    await msg(DAW, [0x90, 94, 127]); // the DAW port's Play button: Mackie Control, not a note
    const dawNotes = await live();
    await msg(DAW, [0x80, 94, 0]);
    await msg(PLAY, [0x90, 60, 100]);
    const on = await heard(page, (m) => m.state === 'running' && m.peak > 0.005,
      `${leg}: the play port's note sounds`);
    const playNotes = await live();
    await msg(PLAY, [0x80, 60, 0]);
    check(leg, id, 'the DAW port sounds no note and the play port does',
      dawNotes === 0 && playNotes === 1 && !on.timedOut,
      JSON.stringify({ dawNotes, playNotes, on: on.peak }));
    await msg(PLAY, [0xb0, 74, 64]);
    const mon = page.locator('[data-osc="midi.monitor"] li');
    const first = await until(async () => {
      const t = await mon.first().textContent().catch(() => '');
      return /Enkodér 1 · CC 74 = 64/.test(t || '') ? t : null;
    }, { ms: STEP_MS, what: `${leg}: the monitor shows CC 74 as Enkodér 1` }).catch(() => null);
    const count = await mon.count();
    check(leg, id, 'the monitor shows the newest message first with its control',
      !!first && /KeyLab mkII 61/.test(first) && count >= 3, JSON.stringify({ first, count }));
    await page.locator('[data-osc="midi.monitor-clear"]').click();
    const cleared = await until(async () => ((await mon.count()) === 0 ? true : null),
      { ms: STEP_MS, what: `${leg}: Vymazat empties the monitor` }).then(() => true, () => false);
    check(leg, id, 'Vymazat empties the monitor', cleared, String(await mon.count()));
    check(leg, id, 'no console or page error', errors.length === 0, errors.join(' | '));
  } finally {
    await context.close();
  }
}

// midi-seam-transport (V508): see the header.
async function seamTransport(browser, b, origin, url) {
  const leg = `${b}/${origin}`;
  const id = 'midi-seam-transport';
  const DAW = `${midiStub.STUB_NAME} · KeyLab mkII 61 DAW`;
  const PLAY = `${midiStub.STUB_NAME} · Arturia BeatStep Pro Arturia BeatStepPro`;
  const { context, page, errors } = await openPage(browser, url,
    { init: { fn: midiStub.install, arg: {} }, also: { fn: audioProbe, arg: { sr: NOTES_RATE } } });
  try {
    await assertGroup(leg, id, page, 'seam');
    await openSettings(page);
    await page.locator('[data-osc="midi.connect"]').click(); // the gesture also starts audio
    await stateIs(page, ['pending'], `${leg}: Connect MIDI asks`);
    await seam(page, 'resolve', 0, [DAW, PLAY]);
    await stateIs(page, ['connected'], `${leg}: the two ports connect`);
    const msg = (name, bytes) => seam(page, 'message', name, bytes);
    const studioPlaying = () => page.evaluate(() => !!window.OSCILLA.app.studio.playing);
    const until2 = (fn, what) => until(async () => ((await fn()) ? true : null),
      { ms: STEP_MS, what }).then(() => true, () => false);
    // The clock first, with the dialog open: 25 ticks a beat apart at 120 BPM (the stub stamps
    // each message with its own time, so the tempo is read from the stamps).
    for (let i = 0; i < 25; i += 1) {
      await page.evaluate(([n, t]) => window.__oscMidiSeam.message(n, [0xf8], t), [PLAY,
        1000 + i * (500 / 24)]);
    }
    const shown = await until(async () => {
      const t = await page.locator('[data-osc="midi.clock"]').textContent().catch(() => '');
      return /Hodiny MIDI: 120\.0 BPM/.test(t || '') ? t : null;
    }, { ms: STEP_MS, what: `${leg}: the clock's tempo is shown` }).catch(() => null);
    check(leg, id, 'a MIDI clock at 120 BPM shows its tempo in the MIDI section', !!shown,
      String(shown));
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => !document.getElementById('osc-dlg-settings').open),
      { ms: STEP_MS, what: `${leg}: the Settings dialog closes` });
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('studio'));
    await msg(DAW, [0x90, 94, 127]); // the DAW port's Play button
    await msg(DAW, [0x80, 94, 0]);
    const played = await until2(studioPlaying, `${leg}: the DAW Play starts the Studio`);
    const row = await page.evaluate(() => window.OSCILLA.app.midiLog.map((r) => r.text));
    await msg(PLAY, [0xfc]); // a realtime Stop
    const stopped = await until2(async () => !(await studioPlaying()),
      `${leg}: Stop stops the Studio`);
    check(leg, id, 'a DAW port\'s Play starts the Studio\'s transport and a MIDI Stop stops it, '
      + 'the monitor saying what Play did', played && stopped
      && row.some((t) => / → Studio: přehrát od začátku$/.test(t)),
    JSON.stringify({ played, stopped, row: row.slice(0, 3) }));
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('sequencer'));
    const seqPlaying = () => page.evaluate(() => !!window.OSCILLA.labs.sequencer.editor.playing);
    await msg(PLAY, [0xfa]);
    const seqOn = await until2(seqPlaying, `${leg}: Start plays the sequence`);
    const studioIdle = !(await studioPlaying());
    await msg(PLAY, [0xfc]);
    const seqOff = await until2(async () => !(await seqPlaying()), `${leg}: Stop stops it`);
    check(leg, id, 'in the Sequencer a MIDI Start plays the sequence (not the Studio) and Stop '
      + 'stops it', seqOn && studioIdle && seqOff, JSON.stringify({ seqOn, studioIdle, seqOff }));
    check(leg, id, 'no console or page error', errors.length === 0, errors.join(' | '));
  } finally {
    await context.close();
  }
}

// keys-one-keyboard (K178, the owner's question of 2026-11-04: why does the keyboard behave
// differently in every workspace): with the stub MIDI device connected, the Playground, the Synth
// and the Studio (the Synth panel's nodes, visited first) each take the same octave (Z/X set once, in the Playground), light
// the same keys for QWERTY and MIDI, sound them, and release them the same way on Escape and on
// a workspace switch, leaving nothing held and nothing lit.
async function keysOneKeyboard(browser, b, origin, url) {
  const leg = `${b}/${origin}`;
  const id = 'keys-one-keyboard';
  const NAME = midiStub.STUB_NAME;
  const { context, page, errors } = await openPage(browser, url,
    { init: { fn: midiStub.install, arg: {} }, also: { fn: audioProbe, arg: { sr: NOTES_RATE } } });
  const app = (f) => page.evaluate(f);
  const go = async (ws) => {
    await page.evaluate((w) => window.OSCILLA.app.setWorkspace(w), ws);
    await until(() => page.evaluate((w) => window.OSCILLA.app.workspace === w
      && window.OSCILLA.app.kbdView === w, ws), { ms: STEP_MS, what: `${leg}: ${ws} opens` });
    if (!await app(() => window.OSCILLA.app.kbdArmedHere)) {
      await page.locator('[data-osc="keyboard.arm"]').click();
    }
    await focusOffEditors(page);
  };
  const held = () => app(() => window.OSCILLA.app.kbdHeld);
  const quiet = (what) => until(async () => ((await held()) === '' ? true : null),
    { ms: STEP_MS, what }).then(() => true, () => false);
  try {
    await openSettings(page);
    await page.locator('[data-osc="midi.connect"]').click();
    await stateIs(page, ['pending'], `${leg}: Connect MIDI asks`);
    await seam(page, 'resolve', 0, [NAME]);
    await stateIs(page, ['connected'], `${leg}: the stub device connects`);
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => !document.getElementById('osc-dlg-settings').open),
      { ms: STEP_MS, what: `${leg}: the Settings dialog closes` });
    const msg = (bytes) => seam(page, 'message', NAME, bytes);
    await go('playground');
    // The keyboard ignores keys while any modal is open (keyboard-ui.js modalOpen): the Settings
    // dialog's modal state may outlive its open attribute, so wait for what the keys wait for.
    await until(() => app(() => !document.querySelector(
      'dialog[open], [data-oscilla-modal][aria-modal="true"]')), { ms: STEP_MS,
      what: `${leg}: no modal holds the keys` });
    await page.keyboard.press('KeyX'); // one octave up, here only
    const rows = [];
    const order = ['playground', 'synth', 'studio'];
    for (const [i, ws] of order.entries()) {
      await go(ws);
      const base = await app(() => window.OSCILLA.app.kbdBase);
      await page.keyboard.down('KeyA');
      const qwerty = await until(async () => (await held()) || null,
        { ms: STEP_MS, what: `${leg}: A lights in ${ws}` }).catch(() => '');
      const qSound = await heard(page, (x) => x.peak > 0.005, `${leg}: A sounds in ${ws}`);
      await page.keyboard.up('KeyA');
      const qOff = await quiet(`${leg}: A unlit in ${ws}`);
      await msg([0x90, 64, 100]);
      const midi = await until(async () => (await held()) || null,
        { ms: STEP_MS, what: `${leg}: MIDI E4 lights in ${ws}` }).catch(() => '');
      await msg([0x80, 64, 0]);
      const mOff = await quiet(`${leg}: MIDI E4 unlit in ${ws}`);
      await page.keyboard.down('KeyA');
      await until(async () => (await held()) || null, { ms: STEP_MS,
        what: `${leg}: A held in ${ws}` }).catch(() => '');
      await page.keyboard.press('Escape');
      const esc = await quiet(`${leg}: Escape releases A in ${ws}`);
      await page.keyboard.up('KeyA');
      await go(ws); // Escape may have disarmed the keys
      await page.keyboard.down('KeyA');
      await until(async () => (await held()) || null, { ms: STEP_MS,
        what: `${leg}: A held again in ${ws}` }).catch(() => '');
      const next = order[(i + 1) % order.length];
      await page.evaluate((w) => window.OSCILLA.app.setWorkspace(w), next);
      const sw = await quiet(`${leg}: leaving ${ws} releases A`);
      await page.keyboard.up('KeyA');
      const silent = await heard(page, (x) => x.peak < 0.001, `${leg}: silent after ${ws}`);
      rows.push({ ws, base, qwerty, qSound: !qSound.timedOut, qOff, midi, mOff, esc, sw,
        silent: !silent.timedOut });
    }
    const want = { base: 72, qwerty: 'C5', qSound: true, qOff: true, midi: 'E4 (MIDI)',
      mOff: true, esc: true, sw: true, silent: true };
    const bad = rows.filter((r) => Object.entries(want).some(([k, v]) => r[k] !== v));
    check(leg, id, 'the Playground, the Synth and the Studio take the same octave, light and '
      + 'sound the same keys for QWERTY and MIDI, and release them on Escape and on a switch',
    bad.length === 0 && errors.length === 0, JSON.stringify({ bad, errors }));
  } finally {
    await context.close();
  }
}

// keyboard-everywhere (M086; the owner's report of 2026-11-03): the same computer key plays on
// the Playground, the Synth and the Studio through the one keyboard component, and the Studio's
// keys reach its graph (the Keys node, through the Studio transport), not the Playground voice.
async function keyboardEverywhere(browser, b, origin, url) {
  const leg = `${b}/${origin}`;
  const id = 'keyboard-everywhere';
  const { context, page, errors } = await openPage(browser, url, { also: { fn: audioProbe,
    arg: {} } });
  const go = async (ws) => {
    await page.evaluate((w) => window.OSCILLA.app.setWorkspace(w), ws);
    await until(() => page.evaluate((w) => window.OSCILLA.app.workspace === w
      && window.OSCILLA.app.kbdView === w, ws), { ms: STEP_MS, what: `${leg}: ${ws} opens` });
    const armed = await page.evaluate(() => window.OSCILLA.app.kbdArmedHere);
    if (!armed) await page.locator('[data-osc="keyboard.arm"]').click();
    await focusOffEditors(page);
  };
  const press = async (ws, pred) => {
    await page.keyboard.down('KeyA');
    const m = await heard(page, (x) => x.peak > 0.005 && pred(x), `${leg}: A sounds in ${ws}`);
    const docked = await page.evaluate(() => getComputedStyle(
      document.getElementById('osc-keyboard')).position);
    const t = await page.evaluate(() => {
      const tr = window.OSCILLA.studio && window.OSCILLA.studio.transport;
      return { armed: !!(tr && tr.armed), held: window.OSCILLA.app.kbdHeld };
    });
    await page.keyboard.up('KeyA');
    await until(async () => ((await instrument(page)).held.length === 0 ? true : null),
      { ms: STEP_MS, what: `${leg}: A released in ${ws}` }).catch(() => null);
    return { ...m, docked, ...t };
  };
  try {
    await go('playground');
    // K247: the Playground's A plays the one instrument (the Studio transport), no page voice.
    const pg = await press('playground', (x) => x.notes === 0);
    check(leg, id, 'A plays C4 on the one instrument from the Playground (the Studio transport '
      + 'armed, no voice of the page)', !pg.timedOut && pg.held === 'C4' && pg.armed
      && pg.notes === 0, JSON.stringify(pg));
    await go('synth');
    const sy = await press('synth', () => true);
    check(leg, id, 'the same A plays the Synth panel through the Studio transport, the keys '
      + 'docked', !sy.timedOut && sy.armed && sy.docked === 'fixed', JSON.stringify(sy));
    await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'BATCH',
      label: 'Keys', steps: [{ type: 'NODE_ADD', id: 'keys-e', nodeType: 'keys',
        position: { x: 0, y: 480 }, params: {} }] }));
    await go('studio');
    const st = await press('studio', (x) => x.notes === 0);
    check(leg, id, 'the same A plays the Studio graph (its Keys node, the transport armed), not '
      + 'the Playground voice, the keys docked as in the Synth',
    !st.timedOut && st.armed && st.notes === 0 && st.docked === 'fixed', JSON.stringify(st));
    // 21's R1 and R2: a key held in the Studio and released after leaving it stops the Studio
    // note, and leaving disarms the keys' run, so the Playground's keys are not refused after.
    await page.keyboard.down('KeyA');
    await heard(page, (x) => x.peak > 0.005, `${leg}: A held in the Studio sounds`);
    const sinkHeld = () => page.evaluate(() => window.OSCILLA.app.synthDebug().sinkHeld);
    // The node the held key went to is the Studio's routed note target (the Synth panel's own
    // Keys node once the panel was opened, K066) or its first notes node: a node of the graph.
    const inStudio = await page.evaluate(() => {
      const held = window.OSCILLA.app.synthDebug().sinkHeld;
      const ids = window.OSCILLA.studio.model.graph.nodes.map((n) => n.id);
      return { held, inGraph: held.every((h) => ids.includes(h.node)) };
    });
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('playground'));
    // K175 (S18): the sink's held map, read through the Synth's debug seam, empties on leaving
    // (the keyboard's workspace-change release and the sink's leave(), each through the node
    // the note went to), while the key is still down; it stays empty after the key-up.
    let leftHeld;
    try {
      leftHeld = await until(async () => {
        const h = await sinkHeld();
        return h.length === 0 ? { held: h } : null;
      }, { ms: STEP_MS, what: `${leg}: leaving the Studio empties the sink's held map` });
    } catch (error) {
      if (!(error instanceof WaitTimeout)) throw error;
      leftHeld = { held: await sinkHeld(), timedOut: error.message };
    }
    await page.keyboard.up('KeyA');
    const left = await heard(page, (x) => x.peak < 0.001, `${leg}: leaving the Studio silences A`);
    const tr = await page.evaluate(() => ({ armed: window.OSCILLA.studio.transport.armed,
      playing: window.OSCILLA.studio.transport.playing,
      sinkHeld: window.OSCILLA.app.synthDebug().sinkHeld }));
    check(leg, id, 'a key held in the Studio is released after leaving it, and leaving disarms '
      + 'the keys\' run (the transport no longer owns the output)',
    !left.timedOut && !tr.armed && !tr.playing, JSON.stringify({ peak: left.peak,
      armed: tr.armed, playing: tr.playing }));
    check(leg, id, 'the Studio sink\'s held map holds the key while it sounds in the Studio and '
      + 'is empty after leaving, the key still down and after its release (K175, S18)',
    inStudio.held.length === 1 && inStudio.held[0].note === 60 && inStudio.inGraph
      && !leftHeld.timedOut && tr.sinkHeld.length === 0,
    JSON.stringify({ inStudio, left: leftHeld, afterUp: tr.sinkHeld }));
    await go('playground');
    const pg2 = await press('playground', (x) => x.notes === 0);
    check(leg, id, 'after the Studio, the Playground\'s A sounds again (not refused)',
      !pg2.timedOut && pg2.held === 'C4' && pg2.armed, JSON.stringify(pg2));
    await go('studio');
    // Where the Studio's room folds the docked keys (#444 keepsRoom) the user unfolds them by
    // the handle first, as the check below needs the armed keys shown.
    // K224 K-3: only a folded dock is unfolded; a docked one is left as it is.
    const handle = page.locator('[data-osc="keyboard.handle"]');
    const folded = await page.evaluate(() => document.querySelector('[data-osc="keyboard"]')
      ?.getAttribute('data-dock-state') === 'collapsed');
    if (folded && await handle.isVisible()) await handle.click();
    // Disarmed in the Studio, the dock is one row and the keys hide, so the graph keeps its
    // height (the owner's 'a third of the height'; demo-song's node selection in Train 4).
    // The handle's row counts on top of the one row where the Studio's room folds the keys
    // (#444): it stays once the user unfolded them, armed or not, so they can fold them again.
    const dock = () => page.evaluate(() => {
      const handle = document.querySelector('[data-osc="keyboard.handle"]');
      return {
        h: Math.round(document.getElementById('osc-keyboard').getBoundingClientRect().height),
        keys: document.querySelector('[data-osc="keyboard.keys"]').getBoundingClientRect().height,
        handle: handle && !handle.hidden ? Math.round(handle.getBoundingClientRect().height) : 0,
        armed: window.OSCILLA.app.kbdArmedHere };
    });
    const armedDock = await until(async () => { const d = await dock(); return d.keys > 0 && d; },
      { ms: STEP_MS, what: `${leg}: the armed Studio shows its keys` }).catch(dock);
    await page.locator('[data-osc="keyboard.arm"]').click();
    let off = null;
    try {
      off = await until(async () => { const d = await dock(); return !d.armed && !d.keys && d; },
        { ms: STEP_MS, what: `${leg}: the Studio keys disarm and hide` });
    } catch (e) { off = { ...await dock(), timedOut: String(e && e.message) }; }
    // The Studio's content ends at the dock, not under it and not 55 px above it (the status
    // bar counted once): the view's content box bottom (its bottom less its padding) is at most
    // the dock's top and within 16 px of it (#osc-main's own padding), armed and disarmed.
    const fit = () => page.evaluate(() => {
      const v = document.getElementById('osc-view-studio');
      const pad = parseFloat(getComputedStyle(v).paddingBottom);
      return { content: Math.round(v.getBoundingClientRect().bottom - pad),
        dock: Math.round(document.getElementById('osc-keyboard').getBoundingClientRect().top) };
    });
    const fits = (f) => f.content <= f.dock + 1 && f.dock - f.content <= 16;
    const fitArmed = await fit();
    check(leg, id, 'disarmed in the Studio the keys hide and the dock is one row; armed they show',
      armedDock.keys > 0 && off.keys === 0 && off.h <= ONE_ROW_PX + off.handle
        && off.h < armedDock.h,
      JSON.stringify({ armedDock, off }));
    const fitOff = await fit();
    check(leg, id, 'the Studio content ends at the docked keys, armed and disarmed (nothing under '
      + 'the dock, the status bar counted once)', fits(fitArmed) && fits(fitOff),
    JSON.stringify({ fitArmed, fitOff }));
    check(leg, id, 'no page error', errors.length === 0, JSON.stringify(errors));
  } finally {
    await context.close();
  }
}

// keyboard-studio-held (K175, review S18; af's second-pass criterion): a key held on the
// Studio keyboard across a workspace switch is released on the Studio node it played. The
// run the Studio keys armed is not asserted here: leaving the Studio disarms it only with
// S19's fix (K176), so the census read is the live notes', not the runtime's node count.
const SILENT_PEAK = 10 ** (-70 / 20); // -70 dB rel
async function keyboardStudioHeld(browser, b, origin, url) {
  const leg = `${b}/${origin}`;
  const id = 'keyboard-studio-held';
  const { context, page, errors } = await openPage(browser, url, { also: { fn: audioProbe,
    arg: {} } });
  const go = async (ws) => {
    await page.evaluate((w) => window.OSCILLA.app.setWorkspace(w), ws);
    await until(() => page.evaluate((w) => window.OSCILLA.app.workspace === w
      && window.OSCILLA.app.kbdView === w, ws), { ms: STEP_MS, what: `${leg}: ${ws} opens` });
  };
  // The Studio's keys play the Synth panel's Keys (its first notes node): the Synth inserts it.
  const read = () => page.evaluate(() => {
    const app = window.OSCILLA.app;
    const sink = app.studioSink();
    const tr = window.OSCILLA.studio.transport;
    // held: the sink's [{ note, node }] (studio-sink.js heldNotes, the train C merge of K175)
    return { held: sink && typeof sink.heldNotes === 'function' ? sink.heldNotes() : null,
      notes: tr ? tr.heldNotes() : null };
  });
  try {
    await go('synth');
    await until(() => page.evaluate(() => window.OSCILLA.app.synthDebug().present),
      { ms: STEP_MS, what: `${leg}: the Synth panel is in the document` });
    await go('studio');
    const armed = await page.evaluate(() => window.OSCILLA.app.kbdArmedHere);
    if (!armed) await page.locator('[data-osc="keyboard.arm"]').click();
    await focusOffEditors(page);
    await page.keyboard.down('KeyA');
    const on = await heard(page, (x) => x.peak > 0.005, `${leg}: A held in the Studio sounds`);
    const during = await read();
    await go('playground');
    await page.keyboard.up('KeyA');
    const off = await heard(page, (x) => x.peak < SILENT_PEAK,
      `${leg}: A up after the switch falls below -70 dB rel`);
    const after = await until(async () => {
      const r = await read();
      return r.held && !r.held.length && r.notes && !r.notes.length && r;
    }, { ms: STEP_MS, what: `${leg}: the Studio sink and the transport hold no note` })
      .catch(read);
    check(leg, id, 'a key held on the Studio keyboard across a switch to the Playground is '
      + 'released on the Studio node: the sink and the transport hold no note, the analyser '
      + 'below -70 dB rel', !on.timedOut && !off.timedOut
      && Array.isArray(during.held) && during.held.length === 1 && during.held[0].note === 60
      && Array.isArray(after.held)
      && !after.held.length && Array.isArray(after.notes) && !after.notes.length
      && errors.length === 0,
    JSON.stringify({ on: on.peak, off: off.peak, during, after, errors }));
  } finally {
    await context.close();
  }
}

// midi-seam-reroute (K173, 98's R6 on #410): a note pressed twice across a re-route releases on
// both nodes it reached. A stub Note On 60 in the Studio sounds on the Synth panel's Keys (node
// A); the keys are re-routed to another notes node (B, METADATA_SET noteTarget, the picker's
// action); Note On 60 again, then Note Off 60 twice: nothing is left sounding, the sink and the
// transport hold no note. Before the fix (15d1bc67) the second Note On moved the held map to B
// and A's note hung.
async function seamReroute(browser, b, origin, url) {
  const leg = `${b}/${origin}`;
  const id = 'midi-seam-reroute';
  const NAME = midiStub.STUB_NAME;
  const { context, page, errors } = await openPage(browser, url,
    { init: { fn: midiStub.install, arg: {} }, also: { fn: audioProbe, arg: {} } });
  const go = async (ws) => {
    await page.evaluate((w) => window.OSCILLA.app.setWorkspace(w), ws);
    await until(() => page.evaluate((w) => window.OSCILLA.app.workspace === w, ws),
      { ms: STEP_MS, what: `${leg}: ${ws} opens` });
  };
  const read = () => page.evaluate(() => {
    const sink = window.OSCILLA.app.studioSink();
    const tr = window.OSCILLA.studio.transport;
    return { held: sink && typeof sink.heldNotes === 'function' ? sink.heldNotes() : null,
      notes: tr ? tr.heldNotes() : null };
  });
  try {
    await assertGroup(leg, id, page, 'seam');
    await openSettings(page);
    await page.locator('[data-osc="midi.connect"]').click(); // the gesture also starts audio
    await stateIs(page, ['pending'], `${leg}: Connect MIDI asks`);
    await seam(page, 'resolve', 0, [NAME]);
    await stateIs(page, ['connected'], `${leg}: the stub device connects`);
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => !document.getElementById('osc-dlg-settings').open),
      { ms: STEP_MS, what: `${leg}: the Settings dialog closes` });
    const msg = (bytes) => seam(page, 'message', NAME, bytes);
    await go('synth');
    await until(() => page.evaluate(() => window.OSCILLA.app.synthDebug().present),
      { ms: STEP_MS, what: `${leg}: the Synth panel is in the document` });
    await go('studio');
    await msg([0x90, 60, 100]);
    const on = await heard(page, (x) => x.peak > 0.005, `${leg}: Note On 60 sounds on node A`);
    const first = await read();
    await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'BATCH',
      label: 'Re-route the keys', steps: [
        { type: 'NODE_ADD', id: 'fm-k173', nodeType: 'fm-voice', position: { x: 0, y: 560 },
          params: {} },
        { type: 'METADATA_SET', noteTarget: 'fm-k173' }] }));
    await msg([0x90, 60, 100]);
    const second = await until(async () => {
      const r = await read();
      return r.held && r.held.length === 1 && r.held[0].node === 'fm-k173' ? r : null;
    }, { ms: STEP_MS, what: `${leg}: the second Note On 60 reaches node B` }).catch(read);
    await msg([0x80, 60, 0]);
    await msg([0x80, 60, 0]);
    const off = await heard(page, (x) => x.peak < SILENT_PEAK,
      `${leg}: after the re-route and two Note Offs nothing sounds (below -70 dB rel)`);
    const after = await until(async () => {
      const r = await read();
      return r.held && !r.held.length && r.notes && !r.notes.length && r;
    }, { ms: STEP_MS, what: `${leg}: the Studio sink and the transport hold no note` })
      .catch(read);
    const nodeA = first.held && first.held[0] ? first.held[0].node : null;
    check(leg, id, 'a note pressed twice across a re-route releases on both nodes it reached: '
      + 'nothing sounds after the two Note Offs, the sink and the transport hold no note (K173)',
    !on.timedOut && nodeA && nodeA !== 'fm-k173' && second.held && second.held.length === 1
      && second.held[0].node === 'fm-k173' && !off.timedOut && Array.isArray(after.held)
      && !after.held.length && Array.isArray(after.notes) && !after.notes.length
      && errors.length === 0,
    JSON.stringify({ on: on.peak, nodeA, second, off: off.peak, after, errors }));
  } finally {
    await context.close();
  }
}

// keyboard-qwerty (K026): the computer and on-screen keyboard play the same note voices.
// keys-insert-notice (K247, C3-553-1): see the header.
async function keysInsertNotice(browser, b, origin, url) {
  const leg = `${b}/${origin}`;
  const id = 'keys-insert-notice';
  const { context, page, errors } = await openPage(browser, `${url}#m=playground`,
    { also: { fn: audioProbe, arg: {} } });
  const doc = () => page.evaluate(() => {
    const m = window.OSCILLA.studio.model;
    const master = m.graph.nodes.find((n) => n.type === 'master');
    return { nodes: m.graph.nodes.length,
      feeds: m.graph.edges.filter((e) => master && e.to.node === master.id)
        .map((e) => e.from.node).sort() };
  });
  const notices = () => page.evaluate(() => [...document.querySelectorAll('[data-osc="alert"]')]
    .filter((el) => el.querySelector('[data-osc="alert.undo"]'))
    .map((el) => el.textContent.replace(/\s+/g, ' ').trim()));
  const go = async (ws) => {
    await page.evaluate((w) => window.OSCILLA.app.setWorkspace(w), ws);
    await until(() => page.evaluate((w) => window.OSCILLA.app.workspace === w, ws),
      { ms: STEP_MS, what: `${leg}: ${ws} opens` });
    await page.locator('#osc-main').click({ position: { x: 4, y: 4 } }); // a gesture
    await focusOffEditors(page);
  };
  try {
    const before = await doc();
    for (const ws of ['playground', 'measure']) {
      await go(ws);
      await page.keyboard.press('KeyA');
      await page.keyboard.press('KeyS'); // a second key: no second notice
      const said = await until(async () => {
        const n = await notices();
        return n.length ? n : null;
      }, { ms: STEP_MS, what: `${leg}: ${ws}: the insert is said` }).catch(() => []);
      const inserted = await doc();
      await page.locator('[data-osc="alert.undo"]').first().click();
      const undone = await until(async () => {
        const d = await doc();
        return d.nodes === before.nodes ? d : null;
      }, { ms: STEP_MS, what: `${leg}: ${ws}: Zpět undoes the insert` }).catch(doc);
      check(leg, id, `${ws}: a key inserts the Synth panel, says K246's sentence once with its `
        + 'own Zpět, and Zpět there gives the document back whole', before.nodes === 6
        && inserted.nodes > before.nodes && said.length === 1 && /Master Output/.test(said[0])
        && undone.nodes === before.nodes
        && JSON.stringify(undone.feeds) === JSON.stringify(before.feeds)
        && (await notices()).length === 0,
      JSON.stringify({ before, inserted: inserted.nodes, said, undone }));
    }
    check(leg, id, 'no console or page error', errors.length === 0, errors.join(' | '));
  } finally {
    await context.close();
  }
}

async function keyboardChecks(browser, b, origin, url) {
  const leg = `${b}/${origin}`;
  const id = 'keyboard-qwerty';
  const { context, page, errors } = await openPage(browser, `${url}#m=playground&kbd=1`,
    { also: { fn: audioProbe, arg: {} } });
  try {
    const kbd = () => page.evaluate(() => {
      const a = window.OSCILLA.app;
      return { workspace: a.workspace, armed: a.kbdArmedHere, held: a.kbdHeld,
        readout: a.kbdReadout, base: a.kbdBase, velocity: a.kbdVelocity,
        owner: a.outputOwner, playing: a.playing };
    });
    // What the scope draws (the bridge's owner), what its description says and what the status
    // bar names, read in one evaluate (C024).
    const scopeOwner = () => page.evaluate(() => {
      const a = window.OSCILLA.app;
      const host = document.querySelector('[data-osc-chart="waveform"]');
      const text = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.textContent.trim() : null;
      };
      return { owner: a.outputOwner, drawn: window.OSCILLA.viz.state.outputOwner,
        label: host ? host.getAttribute('aria-label') : null,
        state: text('[data-osc="status.label"]'), pattern: text('[data-osc="status.pattern"]'),
        // the status bar's state (its dot, anySounding) and the label statusLabel builds for it
        built: a.statusLabel, sounding: !!a.anySounding,
        dot: !!document.querySelector('#osc-status.is-playing'),
        frequency: text('[data-osc="status.frequency"]'), held: a.kbdHeld };
    });
    // K247: the keys play the one instrument; idle is the instrument holding nothing, the
    // output silent and no voice of the page's own.
    const idle = (m) => m.peak < SILENT_PEAK && m.notes === 0 && m.instHeld === 0;
    const heardI = async (pred, what, ms) => {
      try {
        return await until(async () => {
          const [m, t] = [await sound(page), await instrument(page)];
          const x = { ...m, instHeld: t.held.length, armedI: t.armed };
          return pred(x) ? x : null;
        }, { ms: ms || STEP_MS, what });
      } catch (error) {
        if (!(error instanceof WaitTimeout)) throw error;
        const [m, t] = [await sound(page), await instrument(page)];
        return { ...m, instHeld: t.held.length, timedOut: error.message };
      }
    };
    const k0 = await kbd();
    check(leg, id, 'the link #m=playground&kbd=1 arms the Playground keyboard',
      k0.workspace === 'playground' && k0.armed
        && /^Klávesy jsou připravené: /.test(k0.readout),
      JSON.stringify(k0));
    await page.locator('[data-osc="keyboard.readout"]').click(); // a gesture, on no control
    const CHORD = ['KeyA', 'KeyD', 'KeyG'];
    for (const k of CHORD) await page.keyboard.down(k);
    const chord = await heardI((m) => m.instHeld === 3 && m.peak > 0.005,
      `${leg}: A, D and G sound`);
    const k1 = await kbd();
    check(leg, id, 'A, D and G held play C4, E4 and G4 on the one instrument (the Studio '
      + 'transport holds three notes, no voice of the page)', !chord.timedOut
      && k1.held === 'C4, E4, G4' && chord.notes === 0,
    JSON.stringify({ held: k1.held, inst: chord.instHeld, notes: chord.notes }));
    check(leg, id, 'while notes sound, they own the output the analysis views show',
      k1.owner === 'notes' && !k1.playing, JSON.stringify(k1));
    const { limitS, releaseS } = await page.evaluate(() => ({
      limitS: window.OSCILLA.app.safetyLimit, releaseS: window.OSCILLA.app.release / 1000 }));
    const past = await heardI((m) => m.time - chord.time > limitS + releaseS
      + LIMIT_MARGIN_S, `${leg}: the audio clock passes the safety limit`,
    (limitS + releaseS + LIMIT_MARGIN_S + 10) * 1000);
    check(leg, id, `held keys sound past the session safety limit (${limitS} s) while held `
      + '(ADR 0062)', !past.timedOut && past.instHeld === 3 && past.peak > 0.005,
    JSON.stringify({ from: chord.time, at: past.time, inst: past.instHeld, peak: past.peak }));
    for (const k of CHORD) await page.keyboard.up(k);
    const up = await heardI(idle, `${leg}: releasing the keys frees the notes`);

    // C024: a held computer key alone owns the output; the drawing, the canvas description and
    // the status bar name the same owner, and all three clear after the release.
    const NOTES_OWN_MS = 2000;
    const name = OUTPUT_OWNER_NAMES.notes;
    const named = (o) => o.owner === 'notes' && o.drawn === 'notes'
      && !!o.label && o.label.includes(`(${name})`) && !/nehraje/.test(o.label)
      && o.sounding && o.dot && !!o.state && o.state === o.built
      && !!o.pattern && o.pattern.toLowerCase() === name.toLowerCase()
      && o.frequency === 'C4';
    const cleared = (o) => o.owner === null && o.drawn === null && o.held === ''
      && !!o.label && /nehraje/.test(o.label) && !o.sounding && !o.dot
      && !!o.state && o.state === o.built
      && !!o.pattern && o.pattern.toLowerCase() !== name.toLowerCase();
    const waitOwner = async (pred, what) => {
      try {
        return await until(async () => {
          const o = await scopeOwner();
          return pred(o) ? o : null;
        }, { ms: NOTES_OWN_MS, what });
      } catch (error) {
        if (!(error instanceof WaitTimeout)) throw error;
        return { timedOut: true, last: await scopeOwner() };
      }
    };
    await page.keyboard.down('KeyA');
    const owned = await waitOwner(named, `${leg}: notes own the scope`);
    check(leg, 'notes-own-the-scope', 'a held key alone: the scope draws the notes, and its '
      + 'description and the status bar name the same owner', !owned.timedOut,
    JSON.stringify(owned));
    await page.keyboard.up('KeyA');
    const freedOwner = await waitOwner(cleared, `${leg}: notes own the scope (released)`);
    check(leg, 'notes-own-the-scope', 'after the release the drawing, the description and the '
      + 'status bar name no owner', !freedOwner.timedOut, JSON.stringify(freedOwner));
    await heardI(idle, `${leg}: the key's note is freed`);
    // The newest action wins (C002 for the notes): Hold to Play over a held key releases the
    // notes, and the instrument is the one owner all three name.
    await page.keyboard.down('KeyA');
    await waitOwner(named, `${leg}: notes own the scope before Hold to Play`);
    await page.keyboard.down('Space');
    const took = await waitOwner((o) => o.owner === 'instrument' && o.drawn === 'instrument'
      && o.held === '' && !!o.label && !/\(noty\)|nehraje/.test(o.label)
      && o.pattern.toLowerCase() !== name.toLowerCase(),
    `${leg}: the instrument takes the output from the notes`);
    check(leg, 'notes-own-the-scope', 'Hold to Play over a held key releases the notes: the '
      + 'instrument is the one owner', !took.timedOut, JSON.stringify(took));
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyA');
    await heard(page, (m) => m.live === 0 && m.voices === 0 && m.notes === 0,
      `${leg}: Hold to Play and the key are let go`);
    check(leg, id, 'releasing the keys frees every note (the instrument holds none, silent)',
      !up.timedOut && (await kbd()).held === '', JSON.stringify(up));

    for (const [how, release] of [
      ['a window blur', () => page.evaluate(() => window.dispatchEvent(new Event('blur')))],
      ['Escape', () => page.keyboard.press('Escape')]]) {
      await page.keyboard.down('KeyS');
      await heardI((m) => m.instHeld === 1, `${leg}: S sounds before ${how}`);
      await release();
      const freed = await heardI(idle, `${leg}: ${how} frees the held key`);
      check(leg, id, `${how} releases a held key`, !freed.timedOut
        && (await kbd()).held === '', JSON.stringify(freed));
      await page.keyboard.up('KeyS');
    }

    await page.keyboard.press('KeyX');
    await page.keyboard.press('KeyV');
    const k2 = await kbd();
    check(leg, id, 'X raises the octave and V the velocity, and the readout says so',
      k2.base === 72 && k2.velocity === 120 && /hrají C5 až F6/.test(k2.readout)
      && /Síla úhozu 120/.test(k2.readout), JSON.stringify(k2));
    await page.keyboard.press('KeyZ');
    await page.keyboard.press('KeyC');
    // The on-screen buttons do what Z, X, C and V do (one path, kbdControl).
    await page.locator('[data-osc="keyboard.octave-up"]').click();
    await page.locator('[data-osc="keyboard.velocity-up"]').click();
    const kUp = await kbd();
    check(leg, id, 'Octave + and Velocity + raise the octave and the velocity, and the readout '
      + 'says so', kUp.base === 72 && kUp.velocity === 120 && /hrají C5 až F6/.test(kUp.readout)
      && /Síla úhozu 120/.test(kUp.readout), JSON.stringify(kUp));
    await page.locator('[data-osc="keyboard.octave-down"]').click();
    await page.locator('[data-osc="keyboard.velocity-down"]').click();
    const kDown = await kbd();
    check(leg, id, 'Octave - and Velocity - lower them back, and the readout says so',
      kDown.base === 60 && kDown.velocity === 100 && /Síla úhozu 100/.test(kDown.readout),
      JSON.stringify(kDown));
    await page.locator('[data-osc="keyboard.readout"]').click(); // focus leaves the buttons

    await page.keyboard.down('Space');
    let space = null;
    try {
      space = await until(async () => {
        const k = await kbd();
        return k.playing ? k : null;
      }, { ms: STEP_MS, what: `${leg}: Space starts Hold to Play` });
    } catch (error) {
      if (!(error instanceof WaitTimeout)) throw error;
    }
    check(leg, id, 'Space is never a keyboard key: it stays Hold to Play (ADR 0050)',
      !!space && space.held === '', JSON.stringify(space));
    await page.keyboard.up('Space');
    await heard(page, (m) => m.live === 0 && m.voices === 0, `${leg}: Hold to Play stops`);

    const canvas = page.locator('[data-osc="keyboard.keys"]');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    // C4 on the keys as drawn: 3 octaves from C3 (2 from C4 on a narrow canvas), white keys
    // only, near the bottom where no black key covers it.
    const at = await page.evaluate((w) => {
      const octaves = w < 560 ? 2 : 3;
      const first = octaves === 3 ? 48 : 60;
      const whites = [];
      for (let n = first; n <= first + 12 * octaves; n++) {
        if (![1, 3, 6, 8, 10].includes(n % 12)) whites.push(n);
      }
      return { x: (whites.indexOf(60) + 0.5) * (w / whites.length), y: 120 };
    }, box.width);
    await page.mouse.move(box.x + at.x, box.y + at.y);
    await page.mouse.down();
    const ptr = await heardI((m) => m.instHeld === 1 && m.peak > 0.005,
      `${leg}: a pointer on C4 sounds`);
    const k3 = await kbd();
    check(leg, id, 'a pointer on the on-screen C4 plays it and lights it',
      !ptr.timedOut && k3.held === 'C4', JSON.stringify({ held: k3.held, inst: ptr.instHeld }));
    await page.mouse.up();
    const ptrUp = await heardI(idle, `${leg}: the pointer up frees the note`);
    check(leg, id, 'the pointer up releases the note', !ptrUp.timedOut, JSON.stringify(ptrUp));

    await page.locator('[data-osc="keyboard.arm"]').click();
    await page.keyboard.down('KeyA');
    const offI = await instrument(page); // read at once: a note let through would be held
    const k4 = await kbd();
    check(leg, id, 'disarmed, the keys play nothing', offI.held.length === 0 && !k4.armed,
      JSON.stringify({ held: offI.held, armed: k4.armed }));
    await page.keyboard.up('KeyA');

    await page.evaluate(() => { window.location.hash = 'm=studio&kbd=1'; });
    await until(async () => ((await kbd()).workspace === 'studio' ? true : null),
      { ms: STEP_MS, what: `${leg}: the Studio link opens the Studio` });
    await focusOffEditors(page);
    await page.keyboard.down('KeyA');
    const studio = await heardI((m) => m.instHeld === 1, `${leg}: A sounds in the Studio`);
    const k5 = await kbd();
    check(leg, id, 'the Studio is armed on its own (#m=studio&kbd=1) and A plays C4 there',
      !studio.timedOut && k5.armed && k5.held === 'C4'
        && /^Klávesy jsou připravené: /.test(k5.readout),
      JSON.stringify(k5));
    await page.keyboard.up('KeyA');
    const end = await heardI(idle, `${leg}: the Studio note is freed`);
    check(leg, id, 'every note freed, with no error', !end.timedOut && !end.lastError
      && errors.length === 0, JSON.stringify({ ...end, errors }));
  } finally {
    await context.close();
  }
}

// ----------------------------------------------------------------------------------- the run
async function main() {
  ({ midiText } = await import(pathToFileURL(path.join(ROOT, 'src', 'js', 'midi',
    'support.js')).href));
  ({ NOTE_POLYPHONY } = await import(pathToFileURL(path.join(ROOT, 'src', 'js', 'audio',
    'audio-engine.js')).href));
  ({ MAX_OUTPUT_GAIN } = await import(pathToFileURL(path.join(ROOT, 'src', 'js', 'core',
    'constants.js')).href));
  ({ MIDI_REFUSED } = await import(pathToFileURL(path.join(ROOT, 'src', 'js', 'midi',
    'ui.js')).href));
  ({ OUTPUT_OWNER_NAMES } = await import(pathToFileURL(path.join(ROOT, 'src', 'js',
    'visualization', 'output-owner.js')).href));
  await RUN.ready();
  const server = RUN.origins.includes('http') ? await serveDist(DIST, { prefix: 'oscilla-midi-' })
    : null;
  try {
    for (const b of RUN.browsers) {
      const browser = await playwright[b].launch();
      console.log(`\n${b} (${browser.version()})`);
      try {
        for (const origin of RUN.origins) {
          const url = origin === 'http' ? server.url : pathToFileURL(DIST).href;
          // On file:// no site: midiText puts in its own.
          const site = origin === 'http' ? new URL(server.url).host : undefined;
          console.log(`  origin [${b}/${origin}] ${originLabel(origin, url)}`);
          try {
            await measured(browser, b, origin, url, site);
            await seamChecks(browser, b, origin, url, site);
            await seamNotes(browser, b, origin, url);
            await seamSink(browser, b, origin, url);
            await seamCc(browser, b, origin, url);
            await seamMonitor(browser, b, origin, url);
            await seamTransport(browser, b, origin, url);
            await keyboardChecks(browser, b, origin, url);
            await keysInsertNotice(browser, b, origin, url);
            await keyboardEverywhere(browser, b, origin, url);
            await keysOneKeyboard(browser, b, origin, url);
            await keyboardStudioHeld(browser, b, origin, url);
            await seamReroute(browser, b, origin, url);
          } catch (err) {
            check(`${b}/${origin}`, 'midi-run', 'run completed', false, err && err.stack);
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    if (server) server.close();
  }
  console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL PASS'} (${passes} checks passed)`);
  process.exit(failures ? 1 : 0);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { judgeSettled, judgeNoPrompt, originLabel, MEASURED, GRANTED, MIDI_ONLY,
  NOTES_RATE, NYQUIST_NOTE };

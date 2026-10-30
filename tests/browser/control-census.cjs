#!/usr/bin/env node
// OSCILLA control census (C021, PACK 03 "One Instrument, One Coherent State"): every control
// of every workspace has a row, and every row round-trips. dist/index.html from file:// in
// chromium, firefox and webkit.
//
//   node tests/browser/control-census.cjs [--dist dist/index.html] [--browsers chromium,...]
//                                         [--only <row id>,...] [--unrowed]
//
// The table is the census. A row names its control (a CSS selector), how it is driven, and the
// effect read back. There are four kinds:
//   drive     one control driven the way a user drives it, by pointer or by keyboard (a row per
//             input method), on a fresh page; then polled against a named wall-clock deadline
//             (rule project.bounded-test-timing) until the state it reaches holds where it
//             lives: the AudioEngine voice and its nodes, a lab stage, the sequencer model, the
//             Studio store, MEASURE, the instrument, the readouts, a dialog, a download. A row
//             with `audio` also reads the output level of one frequency on the engine's
//             post-chain analyser (a Goertzel filter on the time-domain block, at the context's
//             own sample rate) before and after.
//   family    a family of like controls (navigation items, tabs, disclosure buttons, fullscreen
//             buttons, citation links) driven member by member, by pointer and by keyboard,
//             with the effect every member must have (its workspace, its panel, its
//             aria-expanded and its region, the element it asks the browser to show full
//             screen, a link that opens a new tab without the page's opener).
//   delegated a control another browser suite drives and judges. The census checks that the
//             named suite still drives it: an action (click, fill, press, ...) on the line that
//             names the control or the line next to it, comments apart (the control-drive
//             ratchet's own reading, tests/unit/control-drive-baseline.test.mjs).
//   debt      a control nothing drives yet: it must be listed in
//             tests/unit/control-drive-baseline.json, the record that only shrinks. A debt row
//             whose control is no longer listed fails, so the row becomes a drive or a
//             delegated row in the change that pays it.
//
// Discovery. On a page of its own each leg visits every workspace and lists every element that
// is a control (a form field, a button, a link, an element with an interactive role or a tab
// stop), shown or not. A control that no row's selector matches fails the leg ("no row"); so
// does a delegated or debt row whose selector matches nothing ("stale row"). `--unrowed` prints
// the controls without a row and exits 1.
//
// Expected failures. A drive row that fails today because of a confirmed PACK 03 finding whose
// fix pull request is still open carries `xfail: { finding, issue, pr }` and reports XFAIL;
// when it passes it reports XPASS and fails the leg, so the mark goes in the change that lands
// the fix.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const suite = require('./lib/suite.cjs');
const { until, bounded } = require('./lib/wait.cjs');
const op = require('./lib/oscilla-page.cjs');
const seam = require('./lib/measure-seam.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const RUN = suite.open({ name: 'control-census', browsers: arg('browsers') });
const playwright = RUN.playwright;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const UNROWED = argv.includes('--unrowed');

const ROW_MS = 10000;  // deadline of one row's expectation (a glide is 15-50 ms of audio)
const RUN_MS = 60000;  // one loopback measurement on a loaded machine
const BASELINE = path.join(ROOT, 'tests', 'unit', 'control-drive-baseline.json');

// The browser's fullscreen is not available to a headless page: requestFullscreen is recorded
// (the element asked for) and resolved, so a fullscreen button is judged by what it asks for.
const FULLSCREEN_PROBE = () => {
  const asked = [];
  const ask = function ask() {
    asked.push(this.id || this.getAttribute('data-osc') || this.className || this.tagName);
    return Promise.resolve();
  };
  Element.prototype.requestFullscreen = ask;
  Element.prototype.webkitRequestFullscreen = ask;
  Object.defineProperty(window, '__oscFullscreenAsked', { value: () => asked.slice() });
};

// A browser without a usable clipboard (as file:// often is): the copy actions fall back to
// their dialog, which shows the link to copy by hand. Rows that judge the dialog run with it.
const NO_CLIPBOARD = () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { writeText: () => Promise.reject(new Error('clipboard refused')) } });
};
/** A copy action either copied (and says so) or opened its fallback dialog with the link. */
const copiedOrShown = (dialog, title) => (s) => s.dialogs.includes(dialog)
  || s.app.alerts.some((a) => title.test(a));

// ------------------------------------------------------------------------------ drivers
const D = {
  click: (sel) => async (page) => { await page.locator(sel).first().click(); },
  /** Focus, then one or more keys (the keyboard path of a button, radio, switch or slider). */
  keys: (sel, ...keys) => async (page) => {
    await page.locator(sel).first().focus();
    for (const k of keys) await page.keyboard.press(k);
  },
  /** A typed value committed with Enter (text fields commit on change). */
  type: (sel, text) => async (page) => {
    const l = page.locator(sel).first();
    await l.fill(text);
    await l.press('Enter');
  },
  /** Typed with the keyboard only: select all, type, Enter. */
  typeKeys: (sel, text) => async (page) => {
    await page.locator(sel).first().focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  },
  /** A slider moved by pointer: a click on the track at the fraction `at` of its width. */
  slide: (sel, at) => async (page) => {
    const l = page.locator(sel).first();
    await l.scrollIntoViewIfNeeded();
    const b = await l.boundingBox();
    await page.mouse.click(b.x + b.width * at, b.y + b.height / 2);
  },
  select: (sel, value) => async (page) => { await page.selectOption(sel, value); },
};

// ------------------------------------------------------------------------------ setups
// A setup puts the page in the state the row starts from. It may use the app's own actions:
// what a row judges is the control it drives, never its setup.
const S = {
  /** A latched, continuous sine at `hz`: a sounding voice the row can change. */
  latch: (hz = 1000) => async (page) => {
    await page.evaluate((f) => {
      const a = window.OSCILLA.app;
      a.setWaveform('sine');
      a.setFrequency(f);
      a.setContinuous(true);
      if (!a.latched) a.toggleLatch();
    }, hz);
    await until(() => page.evaluate(() => !!window.OSCILLA.engine.voice),
      { ms: ROW_MS, what: 'setup: the latched tone sounds' });
  },
  filterOn: (cfg) => (page) => page.evaluate((c) => {
    const f = window.OSCILLA.labs.filter;
    if (!f.config.enabled) document.querySelector('#osc-filter-enable').click();
    f.set(c);
  }, cfg),
  envelope: (on, adsr) => (page) => page.evaluate(([o, x]) => {
    const env = window.OSCILLA.labs.envelope;
    if (env.enabled !== o) document.querySelector('#osc-env-enable').click();
    if (x) env.set(x);
  }, [on, adsr]),
  dual: () => (page) => page.evaluate(() => {
    const a = window.OSCILLA.app;
    if (a.source !== 'dual') a.setDualSource(true);
  }),
  settings: () => (page) => page.evaluate(() => window.OSCILLA.app.openDialog('settings')),
  customRange: () => (page) => page.evaluate(() => {
    window.OSCILLA.app.openDialog('settings');
    window.OSCILLA.app.setRangeMode('custom');
  }),
  selectBlock: (id) => (page) => page.evaluate((b) => {
    const lab = window.OSCILLA.labs.sequencer;
    lab.editor.selectBlock(b);
    lab.render();
  }, id),
  pattern: () => (page) => page.click('#osc-source-pattern'),
  sweep: () => async (page) => {
    await page.click('#osc-source-pattern');
    await page.evaluate(() => window.OSCILLA.app.onPatternSelect('__sweep'));
  },
  openMenu: (sel) => (page) => page.click(sel),
  loopback: (values) => (page) => seam.loopback(page, values ? { values } : {}),
  /** A complete TEST CONTEXT loopback result in MEASURE (the result views' controls). */
  measured: () => async (page) => {
    await seam.loopback(page, { values: { duration: 1, repeats: 1, noiseCheckS: 0.5,
      preRollS: 0.25, postRollS: 0.5, gapS: 0.2 } });
    await page.click('#osc-measure-primary');
    await until(() => page.evaluate(() => window.OSCILLA.measure.state === 'READY'),
      { ms: RUN_MS, what: 'setup: the loopback setup check is READY' });
    await page.click('#osc-measure-primary');
    await until(() => page.evaluate(() => window.OSCILLA.measure.state === 'COMPLETE'),
      { ms: RUN_MS, what: 'setup: the loopback measurement completes' });
  },
  studioNode: (type) => async (page) => {
    const id = await page.evaluate((t) => window.OSCILLA.studio.model.graph.nodes
      .find((n) => n.type === t).id, type);
    await page.locator(`[data-osc="studio.graph.node"][data-node-id="${id}"]`).click();
    return id;
  },
  /** The Studio Inspector on the document (no selection). */
  studioSession: () => async (page) => {
    await page.locator('[data-osc="studio.graph.viewport"]').focus();
    await page.keyboard.press('Escape');
    await page.locator('#osc-si-studio-tempo').waitFor({ state: 'visible', timeout: ROW_MS });
  },
};
const seq = (...fns) => async (page) => { for (const f of fns) await f(page); };
const near = (x, y, tol) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= tol;

/** Run `click` and return the download it starts: { name, bytes }. */
async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: ROW_MS }), click()]);
  const p = await dl.path();
  return { name: dl.suggestedFilename(), bytes: p ? fs.statSync(p).size : 0 };
}
/** Run `click` and return the file chooser it opens: { multiple, accept }. */
async function chooser(page, click) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: ROW_MS }), click()]);
  const accept = await fc.element().evaluate((e) => e.getAttribute('accept'));
  return { multiple: fc.isMultiple(), accept };
}

// ------------------------------------------------------------------------------ the census
// drive rows: id (unique), ws (the workspace it is driven in), control (its selector), how
// ('pointer' | 'keyboard'), setup, act, expect(snapshot, before, page) => truthy, audio { hz,
// expect(dbAfter, dbBefore) }, xfail.
const ROWS = [];
const row = (r) => ROWS.push({ kind: 'drive', ...r });
const both = (r) => ['pointer', 'keyboard'].forEach((how) => row({ ...r, id: `${r.id}.${how}`,
  how, act: how === 'pointer' ? r.pointer : r.keyboard }));

// ---- Source (Playground; the same panel shows in Sequencer and Synthesis)
for (const w of ['square', 'triangle', 'sawtooth']) {
  row({ id: `source.wave.${w}.pointer`, ws: 'playground', control: `#osc-wave-${w}`,
    how: 'pointer', setup: S.latch(), act: D.click(`#osc-wave-${w}`),
    expect: (s) => s.app.waveform === w && s.engine.voice && s.engine.voice.wave === w
      // the status bar abbreviates (Sawtooth -> "Saw")
      && new RegExp(w.slice(0, 3), 'i').test(s.text.sbWave || '') });
}
row({ id: 'source.wave.sine.pointer', ws: 'playground', control: '#osc-wave-sine', how: 'pointer',
  setup: seq(S.latch(), D.click('#osc-wave-square')), act: D.click('#osc-wave-sine'),
  expect: (s) => s.app.waveform === 'sine' && s.engine.voice && s.engine.voice.wave === 'sine' });
row({ id: 'source.wave.keyboard', ws: 'playground', control: '#osc-wave-sine', how: 'keyboard',
  setup: S.latch(), act: D.keys('#osc-wave-sine', 'ArrowRight'),
  expect: (s) => s.app.waveform === 'square' && s.engine.voice && s.engine.voice.wave === 'square' });
both({ id: 'source.freqSlider', ws: 'playground', control: '#osc-freq-slider', setup: S.latch(440),
  pointer: D.slide('#osc-freq-slider', 0.8),
  keyboard: D.keys('#osc-freq-slider', 'ArrowRight', 'ArrowRight'),
  expect: (s, b) => s.app.frequency > b.app.frequency && s.engine.voice
    && near(s.engine.voice.freq, s.app.frequency, s.app.frequency * 0.02)
    && s.text.freq !== b.text.freq && s.text.sbFreq !== b.text.sbFreq });
for (const [k, r] of [['oct-up', 2], ['oct-down', 0.5], ['st-up', 2 ** (1 / 12)],
  ['st-down', 2 ** (-1 / 12)], ['10-up', 450 / 440], ['10-down', 430 / 440]]) {
  both({ id: `source.step.${k}`, ws: 'playground', control: `#osc-step-${k}`, setup: S.latch(440),
    pointer: D.click(`#osc-step-${k}`), keyboard: D.keys(`#osc-step-${k}`, 'Enter'),
    expect: (s) => near(s.app.frequency, 440 * r, 0.6) && s.engine.voice
      && near(s.engine.voice.freq, 440 * r, 1) });
}
row({ id: 'source.mode.note.pointer', ws: 'playground', control: '#osc-mode-note', how: 'pointer',
  act: D.click('#osc-mode-note'),
  expect: (s, b) => s.app.inputMode === 'note' && s.text.freqAlt !== b.text.freqAlt });
row({ id: 'source.mode.keyboard', ws: 'playground', control: '#osc-mode-freq', how: 'keyboard',
  act: D.keys('#osc-mode-freq', 'ArrowRight'), expect: (s) => s.app.inputMode === 'note' });
row({ id: 'source.mode.freq.pointer', ws: 'playground', control: '#osc-mode-freq',
  how: 'pointer', setup: D.click('#osc-mode-note'), act: D.click('#osc-mode-freq'),
  expect: (s) => s.app.inputMode === 'frequency' });
both({ id: 'source.gain', ws: 'playground', control: '#osc-gain',
  pointer: D.slide('#osc-gain', 0.2), keyboard: D.keys('#osc-gain', 'ArrowLeft', 'ArrowLeft'),
  expect: (s, b) => s.app.gainLevel < b.app.gainLevel && near(s.engine.gain, s.app.gainLevel,
    1e-6) && s.text.gain !== b.text.gain && s.text.sbGain !== b.text.sbGain });
both({ id: 'source.trigger', ws: 'playground', control: '#osc-trigger',
  pointer: D.click('#osc-trigger'), keyboard: D.keys('#osc-trigger', 'Enter'),
  expect: (s) => s.engine.voice && near(s.engine.voice.len, s.app.duration / 1000, 0.05) });
row({ id: 'source.hold.keyboard', ws: 'playground', control: '#osc-hold-play', how: 'keyboard',
  act: async (page) => { await page.focus('#osc-hold-play'); await page.keyboard.down('Space'); },
  expect: (s) => !!s.engine.voice && s.app.playing && /PLAY/i.test(s.text.sbState || '') });
row({ id: 'source.hold.pointer', ws: 'playground', control: '#osc-hold-play', how: 'pointer',
  act: async (page) => {
    const b = await page.locator('#osc-hold-play').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
  },
  expect: (s) => !!s.engine.voice && s.app.playing });
both({ id: 'source.kind.pattern', ws: 'playground', control: '#osc-source-pattern',
  pointer: D.click('#osc-source-pattern'), keyboard: D.keys('#osc-source-osc', 'ArrowRight'),
  expect: (s) => s.app.sourceKind === 'pattern' });
row({ id: 'source.kind.osc.pointer', ws: 'playground', control: '#osc-source-osc', how: 'pointer',
  setup: S.pattern(), act: D.click('#osc-source-osc'),
  expect: (s) => s.app.sourceKind === 'oscillator' });
row({ id: 'source.patternSelect.pointer', ws: 'playground', control: '#osc-pattern-select',
  how: 'pointer', setup: S.pattern(),
  act: async (page) => { const v = await page.$$eval('#osc-pattern-select option',
    (o) => o.map((x) => x.value)); await page.selectOption('#osc-pattern-select', v[2]); },
  expect: (s, b) => s.app.pattern !== b.app.pattern });
// the pattern parameters (one field per parameter of the chosen pattern; Tone shown here)
// (the Tone pattern's fields are the instrument's own frequency, duration, attack, release)
for (const [k, text, read] of [['frequency', '550', (s) => near(s.app.frequency, 550, 0.01)
  && s.engine.voice === null], ['duration', '300', (s) => s.app.duration === 300]]) {
  row({ id: `source.pattern.${k}.pointer`, ws: 'playground',
    control: `[data-osc="pattern.param"][data-key="${k}"]`, how: 'pointer', setup: S.pattern(),
    act: D.type(`[data-osc="pattern.param"][data-key="${k}"]`, text), expect: read });
}
row({ id: 'source.pattern.attack.keyboard', ws: 'playground',
  control: '[data-osc="pattern.param"]', how: 'keyboard', setup: S.pattern(),
  act: D.typeKeys('[data-osc="pattern.param"][data-key="attack"]', '25'),
  expect: (s) => s.app.attack === 25 });
row({ id: 'source.sweep.direction.pointer', ws: 'playground', control: '#sw-direction',
  how: 'pointer', setup: S.sweep(), act: D.select('#sw-direction', 'down'),
  expect: (s) => s.app.sweep.direction === 'down' });
row({ id: 'source.sweep.field.pointer', ws: 'playground', control: '[data-osc="sweep.param"]',
  how: 'pointer', setup: S.sweep(),
  act: D.type('[data-osc="sweep.param"][data-key="end"]', '2000'),
  expect: (s) => near(Number(s.app.sweep.end), 2000, 0.5) });

// ---- Device & limits
both({ id: 'device.continuous', ws: 'playground', control: '#osc-continuous-toggle',
  pointer: D.click('#osc-continuous-toggle'), keyboard: D.keys('#osc-continuous-toggle', 'Space'),
  expect: (s, b) => s.app.continuous !== b.app.continuous && s.aria.cont !== b.aria.cont });
// The chosen limit cuts a held note. PLAY is held as in source.hold.pointer (the pointer stays
// down until the context closes): a click releases the voice on its pointerup, and on WebKit
// the first start frees it before the first poll. The row judges the value chosen, not the
// limit as it is (an inert select keeps the 2 s default): one voice, limited, scheduled for
// the 0.5 s limit, whose sources stop within the limit plus the release, and which ends while
// the pointer is still down. The engine's own 'play' and 'ended' events are recorded, so a
// poll that comes late still reads the voice it missed.
const LIMIT_PROBE = () => {
  const e = window.OSCILLA.engine;
  const log = { plays: [], ended: [] };
  window.__oscCensusVoices = log;
  e.on((type, d) => {
    if (type === 'play' && e.voice) {
      log.plays.push({ id: d.id, start: d.start, end: d.end, limited: !!d.limited,
        len: e.voice.deadline - e.voice.t0 });
    }
    if (type === 'ended') log.ended.push(d.id);
  });
};
row({ id: 'device.safetyLimit.pointer', ws: 'playground', control: '#osc-safety-limit',
  how: 'pointer',
  act: async (page) => {
    await page.selectOption('#osc-safety-limit', '0.5');
    await page.evaluate(LIMIT_PROBE);
    const b = await page.locator('#osc-hold-play').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
  },
  read: () => window.__oscCensusVoices || null,
  expect: (s, b, x) => {
    const v = x && x.plays.length === 1 ? x.plays[0] : null;
    return s.app.safetyLimit === 0.5 && !!v && v.limited && v.len <= 0.55
      && v.end - v.start <= 0.5 + s.app.release / 1000 + 0.02
      && x.ended.includes(v.id) && s.engine.voice === null;
  } });

// ---- Analysis (the tabs, the scope and the spectrum options)
row({ id: 'analysis.pause.pointer', ws: 'analyzer', control: '#osc-viz-pause', how: 'pointer',
  act: D.click('#osc-viz-pause'), expect: (s, b) => s.app.vizPaused !== b.app.vizPaused });
row({ id: 'analysis.pause.keyboard', ws: 'analyzer', control: '#osc-viz-pause', how: 'keyboard',
  act: D.keys('#osc-viz-pause', 'Enter'), expect: (s, b) => s.app.vizPaused !== b.app.vizPaused });
row({ id: 'analysis.timeWindow.pointer', ws: 'analyzer', control: '#osc-time-window',
  how: 'pointer', act: async (page) => { const v = await page.$$eval('#osc-time-window option',
    (o) => o.map((x) => x.value)); await page.selectOption('#osc-time-window', v[v.length - 1]); },
  expect: (s, b) => s.app.timeWindowMs !== b.app.timeWindowMs });
row({ id: 'analysis.specScale.linear.pointer', ws: 'analyzer', control: '#osc-spec-linear',
  how: 'pointer', setup: D.click('#osc-atab-spectrum'), act: D.click('#osc-spec-linear'),
  expect: (s) => s.app.specScale === 'linear' });
row({ id: 'analysis.specScale.log.pointer', ws: 'analyzer', control: '#osc-spec-log',
  how: 'pointer', setup: seq(D.click('#osc-atab-spectrum'), D.click('#osc-spec-linear')),
  act: D.click('#osc-spec-log'), expect: (s) => s.app.specScale === 'log' });
row({ id: 'analysis.specMax.pointer', ws: 'analyzer', control: '#osc-spec-max', how: 'pointer',
  setup: D.click('#osc-atab-spectrum'),
  act: async (page) => { const v = await page.$$eval('#osc-spec-max option',
    (o) => o.map((x) => x.value)); await page.selectOption('#osc-spec-max', v[0]); },
  expect: (s, b, x) => x.specMax !== b.x.specMax, read: () => ({
    specMax: document.querySelector('#osc-spec-max').value }) });
row({ id: 'analysis.spgFreeze.pointer', ws: 'analyzer', control: '#osc-spg-freeze',
  how: 'pointer', setup: D.click('#osc-atab-spectrogram'), act: D.click('#osc-spg-freeze'),
  expect: (s, b) => s.aria.spgFreeze !== b.aria.spgFreeze });
for (const sel of ['#osc-spg-span-select', '#osc-spg-scale-select']) {
  row({ id: `analysis.${sel.slice(9, -7)}.pointer`, ws: 'analyzer', control: sel, how: 'pointer',
    setup: D.click('#osc-atab-spectrogram'),
    act: async (page) => { const v = await page.$$eval(`${sel} option`, (o) => o.map((x) =>
      x.value)); await page.selectOption(sel, v[v.length - 1]); },
    expect: (s, b, x) => x.v !== b.x.v, read: (q) => ({ v: document.querySelector(q).value }),
    readArg: sel });
}

// ---- Microphone (no device is granted here: the switch's refusal is the effect read back)
row({ id: 'mic.toggle.pointer', ws: 'analyzer', control: '#osc-mic-toggle', how: 'pointer',
  act: D.click('#osc-mic-toggle'),
  expect: (s, b, x) => x.mic !== b.x.mic || x.readout !== b.x.readout,
  // with a (fake) microphone it switches on; without one it says why: either is read back
  read: () => ({ mic: document.querySelector('#osc-mic-toggle').getAttribute('aria-pressed'),
    readout: document.querySelector('#osc-mic-detected').textContent.replace(/\s+/g, ' ')
      + window.OSCILLA.app.alerts.map((a) => a.title).join('|') }) });
row({ id: 'mic.settings.pointer', ws: 'analyzer', control: '#osc-mic-settings', how: 'pointer',
  act: D.click('#osc-mic-settings'), expect: (s) => s.dialogs.includes('osc-dlg-mic') });
for (const k of ['average', 'peakHold', 'freeze']) {
  row({ id: `mic.${k}.pointer`, ws: 'analyzer', control: `[data-osc="mic.${k}"]`, how: 'pointer',
    setup: D.click('#osc-mtab-compare'), act: D.click(`[data-osc="mic.${k}"]`),
    expect: (s, b, x) => x.v !== b.x.v, readArg: `[data-osc="mic.${k}"]`,
    read: (q) => { const e = document.querySelector(q);
      return { v: `${e.getAttribute('aria-pressed')}|${e.getAttribute('aria-checked')}|${
        e.checked}` }; } });
}

// ---- Filter Lab: the instrument's 1 kHz tone through the live insert
both({ id: 'filter.enable', ws: 'filter', control: '#osc-filter-enable',
  setup: seq(S.latch(1000), S.filterOn({ type: 'lowpass', frequency: 150 })),
  pointer: D.click('#osc-filter-enable'), keyboard: D.keys('#osc-filter-enable', 'Space'),
  expect: (s) => !s.filter.enabled && s.aria.filterOn === 'false',
  audio: { hz: 1000, expect: (a, b) => a - b > 20 } });
both({ id: 'filter.cutoffText', ws: 'filter', control: '#osc-filter-cutoff-value',
  setup: seq(S.latch(1000), S.filterOn({ type: 'lowpass', frequency: 8000 })),
  pointer: D.type('#osc-filter-cutoff-value', '150'),
  keyboard: D.typeKeys('#osc-filter-cutoff-value', '150'),
  expect: (s) => near(s.filter.frequency, 150, 0.5),
  audio: { hz: 1000, expect: (a, b) => b - a > 20 } });
both({ id: 'filter.cutoffSlider', ws: 'filter', control: '#osc-filter-cutoff',
  setup: seq(S.latch(1000), S.filterOn({ type: 'lowpass', frequency: 1000 })),
  pointer: D.slide('#osc-filter-cutoff', 0.02), keyboard: D.keys('#osc-filter-cutoff', 'Home'),
  expect: (s, b) => s.filter.frequency < b.filter.frequency && s.text.cutoff !== b.text.cutoff,
  audio: { hz: 1000, expect: (a, b) => b - a > 20 } });
for (const [t, fc, judge] of [['highpass', 5000, (a, b) => b - a > 20],
  ['notch', 1000, (a, b) => b - a > 40], ['bandpass', 1000, (a, b) => Math.abs(a - b) < 3],
  ['peaking', 1000, (a, b) => Math.abs(a - b) < 3]]) {
  both({ id: `filter.type.${t}`, ws: 'filter', control: `#osc-ftype-${t}`,
    setup: seq(S.latch(1000), S.filterOn({ type: 'lowpass', frequency: 20000 }),
      (page) => page.evaluate((f) => window.OSCILLA.labs.filter.set({ frequency: f }), fc)),
    pointer: D.click(`#osc-ftype-${t}`),
    // the radiogroup's roving focus: from Low-pass, ArrowRight n times
    keyboard: async (page) => {
      const n = ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking'].indexOf(t);
      await page.focus('#osc-ftype-lowpass');
      for (let i = 0; i < n; i++) await page.keyboard.press('ArrowRight');
    },
    expect: (s) => s.filter.type === t, audio: { hz: 1000, expect: judge } });
}
row({ id: 'filter.type.lowpass.pointer', ws: 'filter', control: '#osc-ftype-lowpass',
  how: 'pointer', setup: seq(S.latch(1000), S.filterOn({ frequency: 150 }),
    D.click('#osc-ftype-highpass')),
  act: D.click('#osc-ftype-lowpass'), expect: (s) => s.filter.type === 'lowpass',
  audio: { hz: 1000, expect: (a, b) => b - a > 20 } });
both({ id: 'filter.q', ws: 'filter', control: '#osc-filter-q',
  setup: seq(S.latch(1000), S.filterOn({ type: 'bandpass', frequency: 1000, Q: 0.707 })),
  pointer: D.slide('#osc-filter-q', 0.9),
  keyboard: D.keys('#osc-filter-q', 'ArrowRight', 'ArrowRight', 'ArrowRight'),
  expect: (s, b) => s.filter.Q > b.filter.Q && s.text.q !== b.text.q });
both({ id: 'filter.qText', ws: 'filter', control: '#osc-filter-q-value',
  setup: seq(S.latch(1000), S.filterOn({ type: 'bandpass', frequency: 3000, Q: 0.707 })),
  pointer: D.type('#osc-filter-q-value', '20'), keyboard: D.typeKeys('#osc-filter-q-value', '20'),
  expect: (s) => near(s.filter.Q, 20, 0.01), audio: { hz: 1000, expect: (a, b) => b - a > 15 } });
both({ id: 'filter.gain', ws: 'filter', control: '#osc-filter-gain',
  setup: seq(S.latch(1000), S.filterOn({ type: 'peaking', frequency: 1000, gain: 0 })),
  pointer: D.slide('#osc-filter-gain', 0.98), keyboard: D.keys('#osc-filter-gain', 'End'),
  expect: (s) => s.filter.gain > 20,
  // the master limiter caps what reaches the analyser (about +12 dB of a +24 dB boost)
  audio: { hz: 1000, expect: (a, b) => a - b > 6 } });

// ---- Envelope: an edit reaches the NEXT note (a held note: control-census-3, PR #310)
row({ id: 'envelope.sustain.nextNote.pointer', ws: 'synthesis', control: '#osc-env-sustain-value',
  how: 'pointer', setup: seq(S.envelope(true, { s: 0.6 }), S.latch(1000)),
  act: async (page) => {
    await D.type('#osc-env-sustain-value', '0.1')(page);
    await page.evaluate(() => window.OSCILLA.app.toggleLatch());
    await until(() => page.evaluate(() => !window.OSCILLA.app.playing), { ms: ROW_MS,
      what: 'envelope row: the first note ended' });
    await page.evaluate(() => window.OSCILLA.app.toggleLatch());
  },
  expect: (s) => near(s.envelope.s, 0.1, 1e-6) && s.app.playing,
  audio: { hz: 1000, expect: (a, b) => b - a > 12 } });
row({ id: 'envelope.sustain.heldNote.pointer', ws: 'synthesis', control: '#osc-env-sustain-value',
  how: 'pointer', setup: seq(S.envelope(true, { s: 0.6 }), S.latch(1000)),
  act: D.type('#osc-env-sustain-value', '0.1'), expect: (s) => near(s.envelope.s, 0.1, 1e-6),
  audio: { hz: 1000, expect: (a, b) => b - a > 12 },
  xfail: { finding: 'control-census-3', issue: 'C008', pr: 310 } });
row({ id: 'envelope.sustain.keyboard', ws: 'synthesis', control: '#osc-env-sustain',
  how: 'keyboard', setup: S.envelope(true, { s: 0.6 }),
  act: D.keys('#osc-env-sustain', 'ArrowLeft', 'ArrowLeft'),
  expect: (s) => near(s.envelope.s, 0.58, 1e-6) });
row({ id: 'envelope.sustainSlider.pointer', ws: 'synthesis', control: '#osc-env-sustain',
  how: 'pointer', setup: S.envelope(true, { s: 0.6 }), act: D.slide('#osc-env-sustain', 0.1),
  expect: (s) => s.envelope.s < 0.3 });
row({ id: 'envelope.sustainText.keyboard', ws: 'synthesis', control: '#osc-env-sustain-value',
  how: 'keyboard', setup: S.envelope(true, { s: 0.6 }),
  act: D.typeKeys('#osc-env-sustain-value', '0.3'), expect: (s) => near(s.envelope.s, 0.3, 1e-6) });
for (const k of ['attack', 'decay', 'release']) {
  row({ id: `envelope.${k}.pointer`, ws: 'synthesis', control: `#osc-env-${k}-value`,
    how: 'pointer', setup: S.envelope(true), act: D.type(`#osc-env-${k}-value`, '123 ms'),
    expect: (s) => near(s.envelope[k[0]], 0.123, 1e-6) });
  row({ id: `envelope.${k}.keyboard`, ws: 'synthesis', control: `#osc-env-${k}-value`,
    // a bare number is milliseconds, the field's unit
    how: 'keyboard', setup: S.envelope(true), act: D.typeKeys(`#osc-env-${k}-value`, '200'),
    expect: (s) => near(s.envelope[k[0]], 0.2, 1e-6) });
  both({ id: `envelope.${k}Slider`, ws: 'synthesis', control: `#osc-env-${k}`,
    setup: S.envelope(true), pointer: D.slide(`#osc-env-${k}`, 0.9),
    keyboard: D.keys(`#osc-env-${k}`, 'ArrowRight'),
    expect: (s, b) => s.envelope[k[0]] > b.envelope[k[0]] });
}
both({ id: 'envelope.enable', ws: 'synthesis', control: '#osc-env-enable',
  pointer: D.click('#osc-env-enable'), keyboard: D.keys('#osc-env-enable', 'Space'),
  expect: (s, b) => s.envelope.on !== b.envelope.on && s.aria.envOn === String(s.envelope.on) });

// ---- Additive
both({ id: 'additive.enable', ws: 'synthesis', control: '#osc-add-enable', setup: S.latch(500),
  pointer: D.click('#osc-add-enable'), keyboard: D.keys('#osc-add-enable', 'Space'),
  expect: (s, b) => s.additive.on !== b.additive.on
    && !!(s.engine.voice && s.engine.voice.periodicWave) === s.additive.on });
row({ id: 'additive.preset.pointer', ws: 'synthesis', control: '#osc-add-preset', how: 'pointer',
  act: D.select('#osc-add-preset', 'square'),
  expect: (s, b) => JSON.stringify(s.additive.partials) !== JSON.stringify(b.additive.partials) });
both({ id: 'additive.gain', ws: 'synthesis', control: '#osc-add-gain',
  pointer: D.slide('#osc-add-gain', 0.1), keyboard: D.keys('#osc-add-gain', 'ArrowLeft', 'ArrowLeft'),
  expect: (s, b) => JSON.stringify(s.additive.partials) !== JSON.stringify(b.additive.partials) });
row({ id: 'additive.gainText.pointer', ws: 'synthesis', control: '#osc-add-gain-value',
  how: 'pointer', act: D.type('#osc-add-gain-value', '-6'), readArg: '#osc-add-gain-value',
  read: (q) => ({ v: document.querySelector(q).value }),
  expect: (s, b, x) => /-6\.0 dB/.test(x.v)
    && JSON.stringify(s.additive.partials) !== JSON.stringify(b.additive.partials) });
row({ id: 'additive.harmonic.keyboard', ws: 'synthesis', control: '#osc-add-harmonic',
  how: 'keyboard', act: D.typeKeys('#osc-add-harmonic', '3'),
  expect: (s, b, x) => x.v === '3', readArg: '#osc-add-harmonic',
  read: (q) => ({ v: document.querySelector(q).value }) });
row({ id: 'additive.harmonicStep.pointer', ws: 'synthesis',
  control: '[data-osc="additive.harmonicStep"]', how: 'pointer',
  act: async (page) => { await page.locator('[data-osc="additive.harmonicStep"]').first().click(); },
  expect: (s, b, x) => x.v !== b.x.v, readArg: '#osc-add-harmonic',
  read: (q) => ({ v: document.querySelector(q).value }) });
row({ id: 'additive.phase.pointer', ws: 'synthesis', control: '#osc-add-phase', how: 'pointer',
  act: D.type('#osc-add-phase', '90'),
  expect: (s, b) => JSON.stringify(s.additive.partials) !== JSON.stringify(b.additive.partials) });
row({ id: 'additive.chart.keyboard', ws: 'synthesis', control: '#osc-chart-additive',
  how: 'keyboard', act: D.keys('#osc-chart-additive', 'ArrowRight'),
  expect: (s, b, x) => x.v !== b.x.v, readArg: '#osc-add-harmonic',
  read: (q) => ({ v: document.querySelector(q).value }) });

// ---- Dual oscillator (Synthesis)
both({ id: 'dual.enable', ws: 'synthesis', control: '#osc-dual-enable',
  pointer: D.click('#osc-dual-enable'), keyboard: D.keys('#osc-dual-enable', 'Space'),
  expect: (s) => s.app.source === 'dual' });
for (const side of ['a', 'b']) {
  row({ id: `dual.${side}.freq.pointer`, ws: 'synthesis', control: `#osc-dual-${side}-freq`,
    how: 'pointer', setup: seq(S.dual(), S.latch()), act: D.type(`#osc-dual-${side}-freq`, '330'),
    expect: (s) => s.app.dual[side].freq === 330 && s.engine.voice && s.engine.voice[side]
      && near(s.engine.voice[side].f, 330, 1) });
  both({ id: `dual.${side}.range`, ws: 'synthesis', control: `#osc-dual-${side}-range`,
    setup: seq(S.dual(), S.latch()), pointer: D.slide(`#osc-dual-${side}-range`, 0.9),
    keyboard: D.keys(`#osc-dual-${side}-range`, 'PageUp'),
    expect: (s, b) => s.app.dual[side].freq > b.app.dual[side].freq && s.engine.voice
      && s.engine.voice[side] && near(s.engine.voice[side].f, s.app.dual[side].freq
        * 2 ** (s.app.dual[side].detune / 1200), 1.5) });
  both({ id: `dual.${side}.gain`, ws: 'synthesis', control: `#osc-dual-${side}-gain`,
    setup: seq(S.dual(), S.latch()), pointer: D.slide(`#osc-dual-${side}-gain`, 0.02),
    keyboard: D.keys(`#osc-dual-${side}-gain`, 'Home'),
    expect: (s, b) => s.app.dual[side].gain < b.app.dual[side].gain && s.engine.voice
      && s.engine.voice[side] && s.engine.voice[side].g < 0.05 });
  both({ id: `dual.${side}.detune`, ws: 'synthesis', control: `#osc-dual-${side}-detune`,
    setup: seq(S.dual(), S.latch()), pointer: D.slide(`#osc-dual-${side}-detune`, 0.98),
    keyboard: D.keys(`#osc-dual-${side}-detune`, 'End'),
    expect: (s) => s.app.dual[side].detune > 90 && s.engine.voice && s.engine.voice[side]
      && near(s.engine.voice[side].f, s.app.dual[side].freq * 2 ** (s.app.dual[side].detune
        / 1200), 1) });
  row({ id: `dual.${side}.wave.pointer`, ws: 'synthesis', control: `#osc-dual-${side}-wave`,
    how: 'pointer', setup: seq(S.dual(), S.latch()),
    act: D.select(`#osc-dual-${side}-wave`, 'square'),
    expect: (s) => s.app.dual[side].wave === 'square' && s.engine.voice && s.engine.voice[side]
      && s.engine.voice[side].wave === 'square' });
  const L = side.toUpperCase();
  both({ id: `dual.level${L}`, ws: 'synthesis', control: `#osc-dual-level-${side}`,
    setup: seq(S.dual(), S.latch()), pointer: D.slide(`#osc-dual-level-${side}`, 0.01),
    keyboard: D.keys(`#osc-dual-level-${side}`, 'Home'),
    expect: (s) => s.app.dual[`level${L}`] < 0.02 && s.engine.voice && s.engine.voice[side]
      && s.engine.voice[side].g < 0.02 });
}
both({ id: 'dual.route.stereo', ws: 'synthesis', control: '#osc-dual-stereo', setup: S.dual(),
  pointer: D.click('#osc-dual-stereo'), keyboard: D.keys('#osc-dual-mono', 'ArrowRight'),
  expect: (s) => s.app.dual.stereo === true && s.phase.route === 'stereo' });
row({ id: 'dual.route.mono.pointer', ws: 'synthesis', control: '#osc-dual-mono', how: 'pointer',
  setup: seq(S.dual(), D.click('#osc-dual-stereo')), act: D.click('#osc-dual-mono'),
  expect: (s) => s.app.dual.stereo === false && s.phase.route === 'mono' });
row({ id: 'dual.binaural.pointer', ws: 'synthesis', control: '#osc-dual-binaural',
  how: 'pointer', setup: S.dual(), act: D.click('#osc-dual-binaural'),
  // binaural asks for headphones first: the confirmation dialog, or the binaural route
  expect: (s, b) => s.dialogs.includes('osc-dlg-headphones') || s.aria.binaural !== b.aria.binaural });
row({ id: 'dual.preset.pointer', ws: 'synthesis', control: '[data-osc="dual.preset"]',
  how: 'pointer', setup: S.dual(),
  // the fifth preset, 1000 + 1002 Hz (the first ones share A = 440 Hz with the default)
  act: async (page) => { await page.locator('[data-osc="dual.preset"]').nth(4).click(); },
  expect: (s) => s.app.dual.a.freq === 1000 && s.app.dual.b.freq === 1002 });

// ---- Phase & stereo (Compare)
both({ id: 'phase.offset', ws: 'compare', control: '#osc-phase-offset',
  pointer: D.type('#osc-phase-offset', '90'), keyboard: D.typeKeys('#osc-phase-offset', '90'),
  expect: (s) => s.phase.phaseDeg === 90 });
row({ id: 'phase.fa.pointer', ws: 'compare', control: '#osc-stereo-fa', how: 'pointer',
  setup: D.click('#osc-ptab-stereo'), act: D.type('#osc-stereo-fa', '300'),
  expect: (s) => s.app.dual.a.freq === 300 && s.phase.freqA === 300 });
row({ id: 'phase.fb.keyboard', ws: 'compare', control: '#osc-stereo-fb', how: 'keyboard',
  setup: D.click('#osc-ptab-stereo'), act: D.typeKeys('#osc-stereo-fb', '303'),
  expect: (s) => s.app.dual.b.freq === 303 && s.phase.freqB === 303 });
both({ id: 'phase.pan', ws: 'compare', control: '#osc-stereo-pan', setup: seq(S.dual(),
  D.click('#osc-ptab-stereo')), pointer: D.slide('#osc-stereo-pan', 0.98),
  keyboard: D.keys('#osc-stereo-pan', 'End'), expect: (s) => s.phase.pan > 0.9 });
row({ id: 'phase.split.pointer', ws: 'compare', control: '#osc-stereo-split', how: 'pointer',
  setup: seq(S.dual(), D.click('#osc-ptab-stereo')), act: D.click('#osc-stereo-split'),
  expect: (s) => s.phase.route === 'stereo' && s.app.dual.stereo });
row({ id: 'phase.mono.pointer', ws: 'compare', control: '#osc-stereo-mono', how: 'pointer',
  setup: seq(S.dual(), D.click('#osc-ptab-stereo'), D.click('#osc-stereo-split')),
  act: D.click('#osc-stereo-mono'), expect: (s) => s.phase.route === 'mono' && !s.app.dual.stereo });

// ---- Sequencer (Tempo: control-census-1, PR #266; the filter reaching it: control-census-2,
// PR #295)
both({ id: 'seq.play', ws: 'sequencer', control: '#osc-seq-play',
  pointer: D.click('#osc-seq-play'), keyboard: D.keys('#osc-seq-play', 'Enter'),
  expect: (s) => s.seq.playing && s.app.seqPlaying && s.aria.seqPlay === 'true',
  audio: { hz: 440, expect: (a, b) => a > b + 20 } });
both({ id: 'seq.stop', ws: 'sequencer', control: '#osc-seq-stop',
  setup: D.click('#osc-seq-play'), pointer: D.click('#osc-seq-stop'),
  keyboard: D.keys('#osc-seq-stop', 'Enter'),
  expect: (s) => !s.seq.playing && !s.app.seqPlaying && s.aria.seqPlay === 'false' });
both({ id: 'seq.start', ws: 'sequencer', control: '#osc-seq-start',
  pointer: D.click('#osc-seq-start'), keyboard: D.keys('#osc-seq-start', 'Enter'),
  expect: (s) => s.seq.playing });
both({ id: 'seq.loop', ws: 'sequencer', control: '#osc-seq-record',
  pointer: D.click('#osc-seq-record'), keyboard: D.keys('#osc-seq-record', 'Enter'),
  expect: (s, b) => s.seq.loop !== b.seq.loop && s.aria.seqLoop === String(s.seq.loop) });
row({ id: 'seq.tempo.model.pointer', ws: 'sequencer', control: '#osc-seq-tempo', how: 'pointer',
  act: D.select('#osc-seq-tempo', '60'), expect: (s) => s.seq.tempo === 60 && s.text.seqTempo === '60' });
row({ id: 'seq.tempo.model.keyboard', ws: 'sequencer', control: '#osc-seq-tempo',
  how: 'keyboard', act: async (page) => {
    // a native select by keyboard: the options' labels are numbers, typed as such
    await page.locator('#osc-seq-tempo').focus();
    await page.keyboard.type('140');
    await page.keyboard.press('Tab');
  }, expect: (s) => s.seq.tempo === 140 });
row({ id: 'seq.tempo.timing.pointer', ws: 'sequencer', control: '#osc-seq-tempo', how: 'pointer',
  act: D.select('#osc-seq-tempo', '60'),
  expect: (s, b) => s.seq.tempo === 60 && s.seq.totalMs !== b.seq.totalMs,
  xfail: { finding: 'control-census-1', issue: 'K001-K003', pr: 266 } });
row({ id: 'seq.filter.reaches.pointer', ws: 'sequencer', control: '#osc-filter-enable',
  how: 'pointer',
  setup: seq(S.filterOn({ type: 'lowpass', frequency: 150 }), (page) => page.evaluate(() => {
    const lab = window.OSCILLA.labs.sequencer;
    lab.editor.selectBlock('b1'); lab.editor.updateParam('freq', 1000);
    // the longest block the schema allows, so the change lands inside it
    lab.editor.updateParam('durationMs', 60000); lab.render();
    document.querySelector('#osc-filter-enable').click(); // the filter starts off
  }), (page) => page.click('#osc-seq-play')),
  act: (page) => page.evaluate(() => document.querySelector('#osc-filter-enable').click()),
  // still sounding (the block has not ended) AND attenuated as the instrument would be
  expect: (s) => s.seq.playing && s.filter.enabled,
  audio: { hz: 1000, expect: (a, b) => a > -100 && b - a > 20 },
  xfail: { finding: 'control-census-2', issue: 'C003', pr: 295 } });
for (const t of ['tone', 'silence', 'sweep', 'pulse', 'chirp', 'burst', 'siren', 'am', 'fm',
  'random']) {
  row({ id: `seq.add.${t}.pointer`, ws: 'sequencer',
    control: `[data-osc="seq.addType"][data-value="${t}"]`, how: 'pointer',
    setup: S.openMenu('#osc-seq-add'),
    act: D.click(`[data-osc="seq.addType"][data-value="${t}"]`),
    expect: (s, b) => s.seq.ids.length === b.seq.ids.length + 1
      && s.seq.blocks.find((x) => x.id === s.seq.selected).type === t });
}
row({ id: 'seq.add.keyboard', ws: 'sequencer', control: '#osc-seq-add', how: 'keyboard',
  act: async (page) => {
    await page.focus('#osc-seq-add');
    await page.keyboard.press('Enter');
    await until(() => page.evaluate(() => document.activeElement
      && document.activeElement.getAttribute('role') === 'menuitem'),
    { ms: ROW_MS, what: 'seq.add.keyboard: the Add block menu takes focus' });
    await page.keyboard.press('Enter');
  },
  expect: (s, b) => s.seq.ids.length === b.seq.ids.length + 1 });
both({ id: 'seq.moveLater', ws: 'sequencer', control: '#osc-seq-move-later',
  setup: S.selectBlock('b2'), pointer: D.click('#osc-seq-move-later'),
  keyboard: D.keys('#osc-seq-move-later', 'Enter'), expect: (s) => s.seq.ids.indexOf('b2') === 2 });
both({ id: 'seq.moveEarlier', ws: 'sequencer', control: '#osc-seq-move-earlier',
  setup: S.selectBlock('b2'), pointer: D.click('#osc-seq-move-earlier'),
  keyboard: D.keys('#osc-seq-move-earlier', 'Enter'),
  expect: (s) => s.seq.ids.indexOf('b2') === 0 });
both({ id: 'seq.delete', ws: 'sequencer', control: '#osc-seq-delete', setup: S.selectBlock('b3'),
  pointer: D.click('#osc-seq-delete'), keyboard: D.keys('#osc-seq-delete', 'Enter'),
  expect: (s) => !s.seq.ids.includes('b3') });
row({ id: 'seq.timeline.keyboard', ws: 'sequencer', control: '#osc-seq-timeline', how: 'keyboard',
  setup: S.selectBlock('b1'), act: D.keys('#osc-seq-timeline', 'ArrowRight'),
  expect: (s) => s.seq.selected === 'b2' });
for (const b of ['b1', 'b2', 'b3', 'b4', 'b5']) {
  row({ id: `seq.block.${b}.pointer`, ws: 'sequencer', control: `#osc-seq-block-${b}`,
    how: 'pointer', setup: S.selectBlock(b === 'b1' ? 'b2' : 'b1'),
    act: D.click(`#osc-seq-block-${b}`), expect: (s) => s.seq.selected === b });
}
both({ id: 'seq.field.start', ws: 'sequencer', control: '#osc-seq-start-hz',
  setup: S.selectBlock('b2'), pointer: D.type('#osc-seq-start-hz', '500'),
  keyboard: D.typeKeys('#osc-seq-start-hz', '500'),
  expect: (s) => s.seq.blocks.find((x) => x.id === 'b2').p.start === 500 });
both({ id: 'seq.field.end', ws: 'sequencer', control: '#osc-seq-end-hz', setup: S.selectBlock('b2'),
  pointer: D.type('#osc-seq-end-hz', '1000'), keyboard: D.typeKeys('#osc-seq-end-hz', '1000'),
  expect: (s) => s.seq.blocks.find((x) => x.id === 'b2').p.end === 1000 });
both({ id: 'seq.field.duration', ws: 'sequencer', control: '#osc-seq-duration',
  setup: S.selectBlock('b2'), pointer: D.type('#osc-seq-duration', '750'),
  keyboard: D.typeKeys('#osc-seq-duration', '750'),
  expect: (s) => s.seq.blocks.find((x) => x.id === 'b2').ms === 750 });
row({ id: 'seq.field.curve.pointer', ws: 'sequencer', control: '#osc-seq-curve', how: 'pointer',
  setup: S.selectBlock('b2'), act: D.select('#osc-seq-curve', 'linear'),
  expect: (s) => s.seq.blocks.find((x) => x.id === 'b2').p.curve === 'linear' });

// ---- the compact Studio transport in the Playground
row({ id: 'studio.compact.play.pointer', ws: 'playground',
  control: '[data-osc="studio.compact.play"]', how: 'pointer',
  act: D.click('[data-osc="studio.compact.play"]'),
  expect: (s) => s.studio.playing && s.studio.counts.runtimeNodes > 0 });
row({ id: 'studio.compact.stop.pointer', ws: 'playground',
  control: '[data-osc="studio.compact.stop"]', how: 'pointer',
  setup: D.click('[data-osc="studio.compact.play"]'),
  act: D.click('[data-osc="studio.compact.stop"]'),
  expect: (s) => !s.studio.playing && s.studio.counts.runtimeNodes === 0 });
row({ id: 'studio.compact.loop.pointer', ws: 'playground',
  control: '[data-osc="studio.compact.loop"]', how: 'pointer',
  act: D.click('[data-osc="studio.compact.loop"]'), expect: (s, b) => s.studio.loop !== b.studio.loop });
row({ id: 'studio.compact.expand.pointer', ws: 'playground',
  control: '[data-osc="studio.compact.expand"]', how: 'pointer',
  act: D.click('[data-osc="studio.compact.expand"]'), expect: (s) => s.workspace === 'studio' });
row({ id: 'studio.compact.node.pointer', ws: 'playground',
  control: '[data-osc="studio.compact.node"]', how: 'pointer',
  act: async (page) => { await page.locator('[data-osc="studio.compact.node"]').first().click(); },
  expect: (s) => (s.studio.selection.nodes || []).length === 1 });
row({ id: 'studio.compact.clip.pointer', ws: 'playground',
  control: '[data-osc="studio.compact.clip"]', how: 'pointer',
  act: async (page) => { await page.locator('[data-osc="studio.compact.clip"]').first().click(); },
  expect: (s) => (s.studio.selection.clips || []).length === 1 });

// ---- Studio: transport, tempo, document, graph and timeline views
both({ id: 'studio.play', ws: 'studio', control: '[data-osc="studio.play"]',
  pointer: D.click('[data-osc="studio.play"]'), keyboard: D.keys('[data-osc="studio.play"]', 'Enter'),
  expect: (s) => s.studio.playing && s.studio.counts.runtimeNodes > 0 });
row({ id: 'studio.stop.pointer', ws: 'studio', control: '[data-osc="studio.stop"]', how: 'pointer',
  setup: D.click('[data-osc="studio.play"]'), act: D.click('[data-osc="studio.stop"]'),
  expect: (s) => !s.studio.playing && s.studio.counts.runtimeNodes === 0
    && s.studio.counts.engineNodes === 0 });
// Return to start while playing: the playhead jumps back (the transport keeps playing)
const studioTime = () => { const m = /(\d+):(\d+(?:\.\d+)?)/.exec(document.querySelector(
  '[data-osc="studio.time"]').textContent);
return { t: m ? Number(m[1]) * 60 + Number(m[2]) : null }; };
row({ id: 'studio.return.pointer', ws: 'studio', control: '[data-osc="studio.return"]',
  how: 'pointer', setup: seq(D.click('[data-osc="studio.loop"]'), D.click('[data-osc="studio.play"]'),
    (page) => until(() => page.evaluate(studioTime).then((x) => x.t > 0.5),
      { ms: ROW_MS, what: 'setup: the Studio playhead passes 0.5 s' })),
  act: D.click('[data-osc="studio.return"]'), read: studioTime,
  expect: (s, b, x) => x.t !== null && x.t < b.x.t - 0.3 });
both({ id: 'studio.loop', ws: 'studio', control: '[data-osc="studio.loop"]',
  pointer: D.click('[data-osc="studio.loop"]'), keyboard: D.keys('[data-osc="studio.loop"]', 'Enter'),
  expect: (s, b) => s.studio.loop !== b.studio.loop && s.aria.studioLoop === String(s.studio.loop) });
both({ id: 'studio.tempo', ws: 'studio', control: '[data-osc="studio.tl.tempo"]',
  pointer: D.type('[data-osc="studio.tl.tempo"]', '90'),
  keyboard: D.typeKeys('[data-osc="studio.tl.tempo"]', '90'),
  expect: (s) => s.studio.tempo === 90 });
row({ id: 'studio.graph.node.pointer', ws: 'studio', control: '[data-osc="studio.graph.node"]',
  how: 'pointer', act: async (page) => { await S.studioNode('oscillator')(page); },
  expect: (s) => (s.studio.selection.nodes || []).length === 1 });
row({ id: 'studio.undo.pointer', ws: 'studio', control: '[data-osc="studio.undo"]', how: 'pointer',
  setup: async (page) => { const id = await S.studioNode('oscillator')(page);
    await D.type(`#osc-si-${id}-frequency`, '330')(page); },
  act: D.click('[data-osc="studio.undo"]'),
  expect: (s) => s.studio.nodes.find((n) => n.type === 'oscillator').params.frequency !== 330 });
row({ id: 'studio.redo.pointer', ws: 'studio', control: '[data-osc="studio.redo"]', how: 'pointer',
  setup: async (page) => { const id = await S.studioNode('oscillator')(page);
    await D.type(`#osc-si-${id}-frequency`, '330')(page);
    await page.click('[data-osc="studio.undo"]'); },
  act: D.click('[data-osc="studio.redo"]'),
  expect: (s) => s.studio.nodes.find((n) => n.type === 'oscillator').params.frequency === 330 });
row({ id: 'studio.inspector.param.pointer', ws: 'studio',
  control: '[data-osc="studio.inspector.param"]', how: 'pointer',
  setup: S.studioNode('oscillator'),
  act: async (page) => { const id = await page.evaluate(() => window.OSCILLA.studio.selection
    .nodes[0]); await D.type(`#osc-si-${id}-frequency`, '345')(page); },
  expect: (s) => s.studio.nodes.find((n) => n.type === 'oscillator').params.frequency === 345 });
row({ id: 'studio.session.notes.keyboard', ws: 'studio', control: '#osc-si-studio-notes',
  how: 'keyboard', setup: S.studioSession(),
  // a text area commits when it loses the focus
  act: async (page) => { await page.fill('#osc-si-studio-notes', 'census notes');
    await page.keyboard.press('Tab'); },
  expect: (s) => s.studio.notes === 'census notes' });
for (const [k, text, read] of [['title', 'Census title', (s) => s.studio.title === 'Census title'],
  ['tempo', '96', (s) => s.studio.tempo === 96]]) {
  row({ id: `studio.session.${k}.pointer`, ws: 'studio', control: `#osc-si-studio-${k}`,
    how: 'pointer', setup: S.studioSession(), act: D.type(`#osc-si-studio-${k}`, text),
    expect: read });
}
row({ id: 'studio.session.timeMode.pointer', ws: 'studio', control: '#osc-si-studio-timeMode',
  how: 'pointer', setup: S.studioSession(),
  act: async (page) => { const v = await page.$$eval('#osc-si-studio-timeMode option',
    (o) => o.map((x) => x.value)); const cur = await page.$eval('#osc-si-studio-timeMode',
    (e) => e.value); await page.selectOption('#osc-si-studio-timeMode', v.find((x) => x !== cur)); },
  expect: (s, b) => s.studio.timeMode !== b.studio.timeMode });
row({ id: 'studio.session.beats.pointer', ws: 'studio', control: '#osc-si-studio-beats',
  how: 'pointer', setup: S.studioSession(), act: D.type('#osc-si-studio-beats', '3'),
  expect: (s) => s.studio.sig && s.studio.sig[0] === 3 });
row({ id: 'studio.session.unit.pointer', ws: 'studio', control: '#osc-si-studio-unit',
  how: 'pointer', setup: S.studioSession(), act: D.select('#osc-si-studio-unit', '8'),
  expect: (s) => s.studio.sig && s.studio.sig[1] === 8 });
row({ id: 'studio.session.loop.pointer', ws: 'studio', control: '[data-osc="studio.inspector.loop"]',
  how: 'pointer', setup: S.studioSession(), act: D.click('[data-osc="studio.inspector.loop"]'),
  expect: (s, b) => s.studio.loop !== b.studio.loop });
for (const [k, text] of [['loopStart', '0.5'], ['loopEnd', '2.5']]) {
  row({ id: `studio.session.${k}.pointer`, ws: 'studio', control: `#osc-si-studio-${k}`,
    how: 'pointer', setup: seq(S.studioSession(), D.click('[data-osc="studio.inspector.loop"]')),
    act: D.type(`#osc-si-studio-${k}`, text),
    expect: (s) => near(s.studio[k], Number(text), 1e-6) });
}
for (const [k, mode] of [['seconds', 'seconds'], ['musical', 'musical']]) {
  row({ id: `studio.tl.mode.${k}.pointer`, ws: 'studio', control: `[data-osc="studio.tl.mode-${k}"]`,
    how: 'pointer', setup: D.click(`[data-osc="studio.tl.mode-${k === 'seconds' ? 'musical'
      : 'seconds'}"]`), act: D.click(`[data-osc="studio.tl.mode-${k}"]`),
    expect: (s) => s.studio.timeMode === mode });
}
row({ id: 'studio.tl.snap.pointer', ws: 'studio', control: '[data-osc="studio.tl.snap"]',
  how: 'pointer', act: async (page) => { const v = await page.$$eval(
    '[data-osc="studio.tl.snap"] option', (o) => o.map((x) => x.value));
  await page.selectOption('[data-osc="studio.tl.snap"]', v[v.length - 1]); },
  expect: (s, b, x) => x.v !== b.x.v,
  read: () => ({ v: document.querySelector('[data-osc="studio.tl.snap"]').value }) });
// the timeline's zoom is the editor's view: judged on the drawn width of a clip
const clipWidth = () => ({ w: Math.round(document.querySelector('[data-key^="clip:"]')
  .getBoundingClientRect().width) });
for (const [k, cmp] of [['zoom-in', (a, b) => a > b], ['zoom-out', (a, b) => a < b]]) {
  row({ id: `studio.tl.${k}.pointer`, ws: 'studio', control: `[data-osc="studio.tl.${k}"]`,
    how: 'pointer', act: D.click(`[data-osc="studio.tl.${k}"]`), read: clipWidth,
    expect: (s, b, x) => cmp(x.w, b.x.w) });
}
row({ id: 'studio.tl.zoom-fit.pointer', ws: 'studio', control: '[data-osc="studio.tl.zoom-fit"]',
  how: 'pointer', setup: seq(D.click('[data-osc="studio.tl.zoom-in"]'),
    D.click('[data-osc="studio.tl.zoom-in"]')),
  // Fit shows the whole timeline: every clip inside the scrolled view
  act: D.click('[data-osc="studio.tl.zoom-fit"]'),
  read: () => { const sc = document.querySelector('[data-osc="studio.tl.scroll"]')
    .getBoundingClientRect();
  const clips = [...document.querySelectorAll('[data-key^="clip:"]')]
    .map((c) => c.getBoundingClientRect());
  return { w: Math.round(clips[0].width), inside: clips.every((r) => r.right <= sc.right + 1
    && r.left >= sc.left - 1) }; },
  expect: (s, b, x) => x.w !== b.x.w && x.inside });
const details = () => { const d = document.querySelector('[data-osc="studio.tl.details"]');
  return { d: d && !d.hidden ? d.textContent.replace(/\s+/g, ' ') : '' }; };
for (const [k, title] of [['track', /Add track/], ['automate', /Automate a parameter/],
  ['loop-edit', /Loop region/]]) {
  row({ id: `studio.tl.${k}.pointer`, ws: 'studio', control: `[data-osc="studio.tl.${k}"]`,
    how: 'pointer', act: D.click(`[data-osc="studio.tl.${k}"]`), read: details,
    // the button opens the timeline's details form for it
    expect: (s, b, x) => title.test(x.d) });
}
row({ id: 'studio.tl.marker.pointer', ws: 'studio', control: '[data-osc="studio.tl.marker"]',
  how: 'pointer', act: D.click('[data-osc="studio.tl.marker"]'),
  expect: (s, b) => s.studio.markers === b.studio.markers + 1 });
row({ id: 'studio.tl.add-clip.pointer', ws: 'studio', control: '[data-osc="studio.tl.add-clip"]',
  how: 'pointer', act: async (page) => {
    await page.locator('[data-osc="studio.tl.add-clip"]').first().click(); },
  expect: (s, b) => s.studio.clips === b.studio.clips + 1 });
for (const [k, key] of [['loop-start', 'ArrowRight'], ['loop-end', 'ArrowLeft']]) {
  row({ id: `studio.tl.${k}.keyboard`, ws: 'studio', control: `[data-osc="studio.tl.${k}"]`,
    how: 'keyboard', act: D.keys(`[data-osc="studio.tl.${k}"]`, key),
    expect: (s, b) => s.studio.loopStart !== b.studio.loopStart
      || s.studio.loopEnd !== b.studio.loopEnd });
}
// the clips, automation points and per-track buttons the timeline renders
row({ id: 'studio.tl.clip.pointer', ws: 'studio', control: '[data-key^="clip:"]',
  how: 'pointer', act: async (page) => {
    await page.locator('[data-key^="clip:"]').first().click(); },
  expect: (s) => (s.studio.selection.clips || []).length === 1 });
row({ id: 'studio.tl.point.keyboard', ws: 'studio', control: '[data-key^="pt:"]',
  how: 'keyboard', act: async (page) => {
    await page.locator('[data-key^="pt:"]').last().focus();
    await page.keyboard.press('ArrowUp'); },
  expect: (s, b, x) => x.v !== b.x.v,
  read: () => ({ v: JSON.stringify(window.OSCILLA.studio.model.timeline.automation) }) });
row({ id: 'studio.tl.point-add.pointer', ws: 'studio', control: '[data-key^="lane-add:"]',
  how: 'pointer', act: async (page) => {
    await page.locator('[data-key^="lane-add:"]').first().click(); },
  expect: (s, b, x) => x.n > b.x.n,
  read: () => ({ n: window.OSCILLA.studio.model.timeline.automation
    .reduce((t, l) => t + (l.points || []).length, 0) }) });
row({ id: 'studio.tl.lane-remove.pointer', ws: 'studio',
  control: '[data-key^="lane-del:"]', how: 'pointer', act: async (page) => {
    await page.locator('[data-key^="lane-del:"]').first().click(); },
  expect: (s, b) => s.studio.automation === b.studio.automation - 1 });
row({ id: 'studio.tl.track-delete.pointer', ws: 'studio',
  control: '[data-key^="track-del:"]', how: 'pointer', act: async (page) => {
    await page.locator('[data-key^="track-del:"]').first().click(); },
  expect: (s, b) => s.studio.tracks === b.studio.tracks - 1 || s.dialogs.length > b.dialogs.length });
for (const [k, cmp] of [['zoomIn', (a, b) => a > b], ['zoomOut', (a, b) => a < b]]) {
  row({ id: `studio.graph.${k}.pointer`, ws: 'studio', control: `[data-osc="studio.graph.${k}"]`,
    how: 'pointer', act: D.click(`[data-osc="studio.graph.${k}"]`),
    expect: (s, b) => cmp(s.studio.zoom, b.studio.zoom) });
}
// The setup zooms in twice and ends when that zoom is the Studio model's: the editor commits
// its view 250 ms after the last change (graph-editor.js VIEW_COMMIT_MS), and a "before" read
// earlier is the framed view that Frame All restores, so an inert Frame All would still see
// the pending zoom land. The editor's own zoom is the one it applies to its world element.
const zoomCommitted = (what) => async (page) => {
  const live = (from) => {
    const w = document.querySelector('[data-osc="studio.graph.viewport"] .osc-sg-world');
    const z = Number(w.style.getPropertyValue('--osc-sg-z'));
    return from === null ? z : z > from && window.OSCILLA.studio.model.view.graph.zoom === z;
  };
  const z0 = await page.evaluate(live, null);
  await D.click('[data-osc="studio.graph.zoomIn"]')(page);
  await D.click('[data-osc="studio.graph.zoomIn"]')(page);
  await until(() => page.evaluate(live, z0),
    { ms: ROW_MS, what: `${what}: the setup's zoom in is the model's` });
};
for (const k of ['studio.frameAll', 'studio.graph.frameAll', 'studio.graph.frameSelection']) {
  row({ id: `${k}.pointer`, ws: 'studio', control: `[data-osc="${k}"]`, how: 'pointer',
    setup: seq(S.studioNode('oscillator'), zoomCommitted(`${k}.pointer`)),
    act: D.click(`[data-osc="${k}"]`),
    expect: (s, b, x) => x.v !== b.x.v,
    read: () => ({ v: JSON.stringify(window.OSCILLA.studio.model.view.graph) }) });
}
row({ id: 'studio.graph.minimapToggle.pointer', ws: 'studio',
  control: '[data-osc="studio.graph.minimapToggle"]', how: 'pointer',
  act: D.click('[data-osc="studio.graph.minimapToggle"]'),
  expect: (s, b, x) => x.v !== b.x.v, read: () => ({ v: !!document.querySelector(
    '[data-osc="studio.graph.minimap"]') && document.querySelector(
    '[data-osc="studio.graph.minimap"]').offsetParent !== null }) });
row({ id: 'studio.graph.minimap.pointer', ws: 'studio', control: '[data-osc="studio.graph.minimap"]',
  how: 'pointer', setup: D.click('[data-osc="studio.graph.minimapToggle"]'),
  act: async (page) => { const l = page.locator('[data-osc="studio.graph.minimap"]');
    const b = await l.boundingBox(); await page.mouse.click(b.x + 4, b.y + 4); },
  expect: (s, b, x) => x.v !== b.x.v,
  read: () => ({ v: JSON.stringify(window.OSCILLA.studio.model.view.graph) }) });

// ---- MEASURE: the setup fields, the level, the guided flow and the result views
for (const [f, text, key] of [['f1', '40', 'f1'], ['f2', '16000', 'f2'], ['duration', '4', 'duration'],
  ['repeats', '2', 'repeats']]) {
  row({ id: `measure.${f}.pointer`, ws: 'measure', control: `#osc-mf-${f}`, how: 'pointer',
    setup: S.loopback(), act: D.type(`#osc-mf-${f}`, text),
    expect: (s, b, x) => x.v === Number(text) && x.summary !== b.x.summary, readArg: key,
    read: (k) => ({ v: window.OSCILLA.app.meas.values[k],
      summary: document.querySelector('[data-osc="measure.step"][data-step="stimulus"]')
        .textContent.replace(/\s+/g, ' ') }) });
}
row({ id: 'measure.aggregation.pointer', ws: 'measure', control: '#osc-mf-aggregation',
  how: 'pointer', setup: S.loopback(), act: D.select('#osc-mf-aggregation', 'median'),
  expect: (s, b, x) => x.v === 'median', read: () => ({ v: window.OSCILLA.app.meas.values.aggregation }) });
for (const lvl of ['low', 'medium', 'high']) {
  row({ id: `measure.level.${lvl}.pointer`, ws: 'measure',
    control: `[data-osc="measure.level"][data-value="${lvl}"]`, how: 'pointer',
    setup: seq(S.loopback(), (page) => page.evaluate((l) => window.OSCILLA.app.measureSetValue(
      'level', l === 'low' ? 'medium' : 'low', 'choice'), lvl)),
    act: D.click(`[data-osc="measure.level"][data-value="${lvl}"]`),
    expect: (s, b, x) => x.v === lvl, read: () => ({ v: window.OSCILLA.app.meas.values.level }) });
}
both({ id: 'measure.expert', ws: 'measure', control: '[data-osc="measure.expert"]',
  setup: S.loopback(), pointer: D.click('[data-osc="measure.expert"]'),
  keyboard: D.keys('[data-osc="measure.expert"]', 'Space'),
  expect: (s, b) => s.measure.expert !== b.measure.expert });
row({ id: 'measure.primary.pointer', ws: 'measure', control: '#osc-measure-primary',
  how: 'pointer', setup: S.loopback({ duration: 1, repeats: 1, noiseCheckS: 0.5 }),
  act: D.click('#osc-measure-primary'), expect: (s) => s.measure.state === 'READY' });
row({ id: 'measure.stop.pointer', ws: 'measure', control: '#osc-measure-stop', how: 'pointer',
  setup: seq(S.loopback({ duration: 3, repeats: 1, noiseCheckS: 0.5 }),
    D.click('#osc-measure-primary'), (page) => until(() => page.evaluate(() =>
      window.OSCILLA.measure.state === 'READY'), { ms: RUN_MS, what: 'setup: READY' }),
    D.click('#osc-measure-primary'), (page) => until(() => page.evaluate(() =>
      window.OSCILLA.measure.state === 'MEASURING'), { ms: RUN_MS, what: 'setup: MEASURING' })),
  act: D.click('#osc-measure-stop'),
  expect: (s) => s.measure.state === 'ABORTED' && !s.measure.hasResult, timeout: RUN_MS });
row({ id: 'measure.inputDevice.pointer', ws: 'measure', control: '#osc-m-input-device',
  how: 'pointer', act: D.select('#osc-m-input-device', 'oscilla:test-context'),
  // TEST CONTEXT is entered from the device list and says what it is
  expect: (s, b, x) => x.v, read: () => ({ v: document.querySelector(
    '[data-osc="measure.testContext"]').offsetParent !== null }) });
// the result views (one TEST CONTEXT loopback result)
for (const t of ['response', 'ir', 'rta']) {
  row({ id: `measure.tab.${t}.pointer`, ws: 'measure', control: `#osc-m-tab-${t}`,
    how: 'pointer', setup: seq(S.measured(), D.click(`#osc-m-tab-${t === 'ir' ? 'rta' : 'ir'}`)),
    act: D.click(`#osc-m-tab-${t}`), expect: (s) => s.measure.tab === t, timeout: RUN_MS * 2 });
}
row({ id: 'measure.results.pointer', ws: 'measure', control: '#osc-m-smoothing', how: 'pointer',
  covers: ['#osc-m-normalization', '[data-osc="measure.quantity"]', '[data-osc="measure.irScale"]',
    '[data-osc="measure.irSpan"]', '[data-osc="measure.irNormalize"]',
    '[data-osc="measure.irWindow"]', '[data-osc="measure.rtaMode"]',
    '[data-osc="measure.rtaAveraging"]', '[data-osc="measure.rtaPeak"]',
    '[data-osc="measure.rtaFreeze"]', '[data-osc="measure.rtaReset"]',
    '[data-osc="measure.rtaLive"]'],
  setup: S.measured(), timeout: RUN_MS * 3,
  act: async (page) => {
    // every control of the result views, each judged on the view state it sets
    const v = (sel) => page.$$eval(`${sel} option`, (o) => o.map((x) => x.value));
    const sm = await v('#osc-m-smoothing');
    await page.selectOption('#osc-m-smoothing', sm[sm.length - 1]);
    const nm = await v('#osc-m-normalization');
    await page.selectOption('#osc-m-normalization', nm[nm.length - 1]);
    // the phase / magnitude switch is an expert view
    await page.click('[data-osc="measure.expert"]');
    await page.click('[data-osc="measure.quantity"][data-value="phase"]');
    await page.click('[data-osc="measure.quantity"][data-value="magnitude"]');
    await page.click('#osc-m-tab-ir');
    await page.click('[data-osc="measure.irScale"][data-value="db"]');
    await page.click('[data-osc="measure.irScale"][data-value="linear"]');
    for (const sp of ['direct', 'full', 'early']) {
      await page.click(`[data-osc="measure.irSpan"][data-value="${sp}"]`);
    }
    await page.click('[data-osc="measure.irNormalize"]');
    await page.click('[data-osc="measure.irWindow"]');
    await page.click('#osc-m-tab-rta');
    // the RTA's own controls act on the live analyser of the input (the loopback here)
    await page.click('[data-osc="measure.rtaLive"]');
    for (const m of ['fft', 'octave', 'third']) {
      await page.click(`[data-osc="measure.rtaMode"][data-value="${m}"]`);
    }
    for (const m of ['instant', 'slow', 'fast']) {
      await page.click(`[data-osc="measure.rtaAveraging"][data-value="${m}"]`);
    }
    await page.click('[data-osc="measure.rtaPeak"]');
    await page.click('[data-osc="measure.rtaFreeze"]');
    await page.click('[data-osc="measure.rtaReset"]');
  },
  read: () => { const v = window.OSCILLA.app.meas.view;
    return { set: v.smoothing > 0 && v.normalization !== 'none' && v.irNormalize && v.irWindow
      && v.rtaPeakHold && v.quantity === 'magnitude', live: !!window.OSCILLA.measure.liveRta }; },
  expect: (s, b, x) => x.set && x.live && s.measure.tab === 'rta'
    && s.measure.state === 'COMPLETE' });
row({ id: 'measure.save.pointer', ws: 'measure', control: '#osc-measure-save', how: 'pointer',
  setup: seq(S.measured(), D.type('#osc-m-name', 'census run'),
    (page) => page.fill('#osc-m-notes', 'n')),
  act: D.click('#osc-measure-save'), timeout: RUN_MS * 2,
  expect: (s, b, x) => x.saved, read: () => ({ saved: !!window.OSCILLA.app.meas.saved }) });
row({ id: 'measure.name.keyboard', ws: 'measure', control: '#osc-m-name', how: 'keyboard',
  setup: S.measured(), act: D.typeKeys('#osc-m-name', 'typed name'), timeout: RUN_MS * 2,
  expect: (s) => s.measure.name === 'typed name' });
row({ id: 'measure.notes.pointer', ws: 'measure', control: '#osc-m-notes', how: 'pointer',
  setup: S.measured(), act: (page) => page.fill('#osc-m-notes', 'census notes'),
  timeout: RUN_MS * 2,
  expect: (s, b, x) => x.v === 'census notes', read: () => ({ v: window.OSCILLA.app.meas.notes }) });
row({ id: 'measure.repeat.pointer', ws: 'measure', control: '[data-osc="measure.repeat"]',
  how: 'pointer', setup: S.measured(), act: D.click('[data-osc="measure.repeat"]'),
  timeout: RUN_MS * 2, expect: (s) => s.measure.state !== 'COMPLETE' || !s.measure.hasResult });
row({ id: 'measure.toExperiments.pointer', ws: 'measure',
  control: '[data-osc="measure.toExperiments"]', how: 'pointer', setup: S.measured(),
  act: D.click('[data-osc="measure.toExperiments"]'), timeout: RUN_MS * 2,
  expect: (s) => s.workspace === 'experiments' });

// ---- Settings dialog
row({ id: 'settings.a4.pointer', ws: 'playground', control: '#osc-set-a4', how: 'pointer',
  setup: seq((page) => page.click('#osc-mode-note'), S.settings()),
  act: D.type('#osc-set-a4', '432'),
  expect: (s, b) => s.app.a4 === 432 && s.text.freqAlt !== b.text.freqAlt });
row({ id: 'settings.duration.pointer', ws: 'playground', control: '#osc-set-duration',
  how: 'pointer', setup: S.settings(),
  act: async (page) => { await D.type('#osc-set-duration', '300')(page);
    await page.evaluate(() => { window.OSCILLA.app.closeDialog('settings');
      window.OSCILLA.app.trigger(); }); },
  expect: (s) => s.app.duration === 300 && s.engine.voice && near(s.engine.voice.len, 0.3, 0.02) });
row({ id: 'settings.attack.pointer', ws: 'playground', control: '#osc-set-attack', how: 'pointer',
  setup: S.settings(), act: D.type('#osc-set-attack', '50'), expect: (s) => s.app.attack === 50 });
row({ id: 'settings.release.keyboard', ws: 'playground', control: '#osc-set-release',
  how: 'keyboard', setup: S.settings(), act: D.typeKeys('#osc-set-release', '400'),
  expect: (s) => s.app.release === 400 });
row({ id: 'settings.range.pointer', ws: 'playground', control: '#osc-set-range', how: 'pointer',
  setup: S.settings(), act: D.select('#osc-set-range', 'advanced'),
  expect: (s, b) => s.app.rangeMode === 'advanced' && s.app.rangeMax > b.app.rangeMax });
row({ id: 'settings.customMin.pointer', ws: 'playground', control: '#osc-set-min', how: 'pointer',
  setup: S.customRange(), act: D.type('#osc-set-min', '100'), expect: (s) => s.app.rangeMin === 100 });
row({ id: 'settings.customMax.pointer', ws: 'playground', control: '#osc-set-max', how: 'pointer',
  setup: S.customRange(), act: D.type('#osc-set-max', '5000'), expect: (s) => s.app.rangeMax === 5000 });
row({ id: 'settings.reset.pointer', ws: 'playground', control: '[data-osc="settings.reset"]',
  how: 'pointer', setup: seq(S.settings(), D.type('#osc-set-a4', '432')),
  act: D.click('[data-osc="settings.reset"]'), expect: (s) => s.app.a4 === 440 });

// ---- Header, menus, actions, notices
both({ id: 'header.theme', ws: 'playground', control: '#osc-theme-toggle',
  pointer: D.click('#osc-theme-toggle'), keyboard: D.keys('#osc-theme-toggle', 'Enter'),
  expect: (s, b) => s.app.theme !== b.app.theme && s.themeAttr === s.app.theme });
both({ id: 'header.help', ws: 'playground', control: '#osc-help', pointer: D.click('#osc-help'),
  keyboard: D.keys('#osc-help', 'Enter'), expect: (s) => s.dialogs.includes('osc-dlg-help') });
row({ id: 'header.explore.pointer', ws: 'playground', control: '[data-osc="header.explore"]',
  how: 'pointer', setup: S.openMenu('#osc-overflow'), act: D.click('[data-osc="header.explore"]'),
  expect: (s) => s.app.explore === true && s.aria.hints });
row({ id: 'hints.close.pointer', ws: 'playground', control: '[data-osc="hints.close"]',
  how: 'pointer', setup: seq(S.openMenu('#osc-overflow'), D.click('[data-osc="header.explore"]')),
  act: D.click('[data-osc="hints.close"]'), expect: (s) => s.app.explore === false && !s.aria.hints });
row({ id: 'header.settings.keyboard', ws: 'playground', control: '[data-osc="header.settings"]',
  how: 'keyboard', setup: S.openMenu('#osc-overflow'),
  act: D.keys('[data-osc="header.settings"]', 'Enter'),
  expect: (s) => s.dialogs.includes('osc-dlg-settings') });
row({ id: 'header.shortcuts.pointer', ws: 'playground', control: '[data-osc="header.shortcuts"]',
  how: 'pointer', setup: S.openMenu('#osc-overflow'), act: D.click('[data-osc="header.shortcuts"]'),
  expect: (s) => s.dialogs.includes('osc-dlg-help') });
row({ id: 'header.about.pointer', ws: 'playground', control: '[data-osc="header.about"]',
  how: 'pointer', setup: S.openMenu('#osc-overflow'), act: D.click('[data-osc="header.about"]'),
  expect: (s) => s.workspace === 'about' });
row({ id: 'header.import.pointer', ws: 'playground', control: '[data-osc="config.import"]',
  how: 'pointer', setup: S.openMenu('#osc-overflow'),
  act: async (page) => { page.__got = await chooser(page, () => page.click(
    '[data-osc="config.import"]')); },
  expect: (s, b, x, page) => page.__got && /json/.test(page.__got.accept || '') });
row({ id: 'header.export.pointer', ws: 'playground', control: '[data-osc="config.export"]',
  how: 'pointer', setup: S.openMenu('#osc-overflow'),
  act: async (page) => { page.__got = await download(page, () => page.click(
    '[data-osc="config.export"]')); },
  expect: (s, b, x, page) => page.__got && /\.json$/.test(page.__got.name) && page.__got.bytes > 100 });
row({ id: 'safety.reopenMenu.pointer', ws: 'playground', control: '[data-osc="safety.reopenMenu"]',
  how: 'pointer', setup: S.openMenu('#osc-overflow'),
  act: D.click('[data-osc="safety.reopenMenu"]'),
  expect: (s, b, x) => x.shown, read: () => ({ shown: !window.OSCILLA.app.safetyCollapsed }) });
// the listening-safety notice as a first visit shows it (More and Less: phone width)
row({ id: 'safety.dismiss.pointer', ws: 'playground', control: '#osc-safety-dismiss',
  how: 'pointer', keepSafety: true, act: D.click('#osc-safety-dismiss'),
  expect: (s, b, x) => x.collapsed, read: () => ({ collapsed: window.OSCILLA.app.safetyCollapsed }) });
row({ id: 'safety.more.pointer', ws: 'playground', control: '.osc-safety-toggle', how: 'pointer',
  keepSafety: true, viewport: { width: 390, height: 844 }, act: D.click('.osc-safety-toggle'),
  expect: (s, b, x) => x.open && /Less/.test(x.label), read: () => ({
    open: window.OSCILLA.app.safetyExpanded,
    label: document.querySelector('.osc-safety-toggle').textContent }) });
for (const sel of ['#osc-safety-reopen', '#osc-safety-reopen-phone']) {
  row({ id: `safety.${sel.slice(1)}.pointer`, ws: 'playground', control: sel, how: 'pointer',
    viewport: sel.endsWith('phone') ? { width: 390, height: 844 } : undefined,
    act: async (page) => { await page.locator(sel).first().click(); },
    expect: (s, b, x) => x.shown, read: () => ({ shown: !window.OSCILLA.app.safetyCollapsed }) });
}
row({ id: 'export.menu.pointer', ws: 'playground', control: '#osc-export', how: 'pointer',
  act: D.click('#osc-export'), expect: (s, b, x) => x.v === 'true',
  read: () => ({ v: document.querySelector('#osc-export').getAttribute('aria-expanded') }) });
for (const [k, re] of [['wav', /\.wav$/], ['seqWav', /\.wav$/], ['png', /\.png$/],
  ['config', /\.json$/]]) {
  row({ id: `export.${k}.pointer`, ws: 'playground', control: `[data-osc="export.${k}"]`,
    how: 'pointer', setup: S.openMenu('#osc-export'), timeout: RUN_MS,
    act: async (page) => { page.__got = await download(page, () => page.click(
      `[data-osc="export.${k}"]`)); },
    expect: (s, b, x, page) => page.__got && re.test(page.__got.name) && page.__got.bytes > 44 });
}
row({ id: 'export.import.pointer', ws: 'playground', control: '[data-osc="export.import"]',
  how: 'pointer', setup: S.openMenu('#osc-export'),
  act: async (page) => { page.__got = await chooser(page, () => page.click(
    '[data-osc="export.import"]')); },
  expect: (s, b, x, page) => !!page.__got });
row({ id: 'export.url.pointer', ws: 'playground', control: '[data-osc="export.url"]',
  how: 'pointer', setup: S.openMenu('#osc-export'), act: D.click('[data-osc="export.url"]'),
  expect: copiedOrShown('osc-dlg-copy', /link copied/i) });
row({ id: 'copy.url.pointer', ws: 'playground', control: '[data-osc="copy.url"]', how: 'pointer',
  noClipboard: true, setup: seq(S.openMenu('#osc-export'), D.click('[data-osc="export.url"]')),
  act: D.click('[data-osc="copy.url"]'),
  expect: (s, b, x) => /#v=1/.test(x.v), read: () => ({ v: window.OSCILLA.app.copyUrl || '' }) });
row({ id: 'actions.toggle.pointer', ws: 'playground', control: '#osc-sb-actions-toggle',
  how: 'pointer', viewport: { width: 390, height: 844 }, act: D.click('#osc-sb-actions-toggle'),
  expect: (s, b, x) => x.v === 'true',
  read: () => ({ v: document.querySelector('#osc-sb-actions-toggle').getAttribute('aria-expanded') }) });
row({ id: 'status.play.pointer', ws: 'playground', control: '#osc-sb-play', how: 'pointer',
  viewport: { width: 390, height: 844 }, act: D.click('#osc-sb-play'),
  expect: (s) => !!s.engine.voice && s.app.playing });
row({ id: 'action.url.pointer', ws: 'playground', control: '#osc-act-url', how: 'pointer',
  act: D.click('#osc-act-url'), expect: copiedOrShown('osc-dlg-copy', /link copied/i) });
row({ id: 'action.screenshot.pointer', ws: 'playground', control: '#osc-act-screenshot',
  how: 'pointer', act: async (page) => { page.__got = await download(page, () => page.click(
    '#osc-act-screenshot')); },
  expect: (s, b, x, page) => page.__got && /\.png$/.test(page.__got.name) });
row({ id: 'action.exportAudio.pointer', ws: 'playground', control: '#osc-act-export-audio',
  how: 'pointer', timeout: RUN_MS, act: async (page) => { page.__got = await download(page,
    () => page.click('#osc-act-export-audio')); },
  expect: (s, b, x, page) => page.__got && /\.wav$/.test(page.__got.name) });
row({ id: 'action.savePreset.pointer', ws: 'playground', control: '#osc-act-save-preset',
  how: 'pointer', act: D.click('#osc-act-save-preset'), expect: (s) => s.dialogs.includes('osc-dlg-save') });
row({ id: 'action.settings.pointer', ws: 'playground', control: '#osc-act-settings',
  how: 'pointer', act: D.click('#osc-act-settings'),
  expect: (s) => s.dialogs.includes('osc-dlg-settings') });
row({ id: 'save.confirm.pointer', ws: 'playground', control: '[data-osc="save.confirm"]',
  how: 'pointer', setup: seq(D.click('#osc-act-save-preset'),
    (page) => page.fill('#osc-save-name', 'Census')),
  act: D.click('[data-osc="save.confirm"]'),
  expect: (s, b, x) => x.v, read: () => ({ v: (window.OSCILLA.app.customPresets || [])
    .some((p) => p.name === 'Census') }) });
row({ id: 'save.name.keyboard', ws: 'playground', control: '#osc-save-name', how: 'keyboard',
  setup: D.click('#osc-act-save-preset'), act: D.typeKeys('#osc-save-name', 'Keyed'),
  expect: (s, b, x) => x.v, read: () => ({ v: (window.OSCILLA.app.customPresets || [])
    .some((p) => p.name === 'Keyed') }) });

// ---- Presets and Learn
row({ id: 'presets.load.pointer', ws: 'presets', control: '[data-osc="presets.load"]',
  how: 'pointer', act: async (page) => { await page.locator('[data-osc="presets.load"]').nth(3)
    .click(); },
  expect: (s, b) => JSON.stringify(s.app) !== JSON.stringify(b.app) });
row({ id: 'presets.save.pointer', ws: 'presets', control: '[data-osc="presets.save"]',
  how: 'pointer', act: D.click('[data-osc="presets.save"]'),
  expect: (s) => s.dialogs.includes('osc-dlg-save') });
row({ id: 'presets.reset.pointer', ws: 'presets', control: '[data-osc="presets.reset"]',
  how: 'pointer', setup: (page) => page.evaluate(() => window.OSCILLA.app.setFrequency(1234)),
  act: D.click('[data-osc="presets.reset"]'), expect: (s) => s.app.frequency === 440 });
row({ id: 'presets.delete.pointer', ws: 'presets', control: '[data-osc="presets.delete"]',
  how: 'pointer', setup: seq(D.click('[data-osc="presets.save"]'),
    (page) => page.fill('#osc-save-name', 'Gone'), D.click('[data-osc="save.confirm"]'),
    D.click('#osc-ptab-cat-custom')),
  // two steps: Delete turns the button into Confirm, which deletes
  act: async (page) => {
    const del = page.locator('[data-osc="presets.delete"][aria-label="Delete Gone"]');
    await del.click();
    await page.locator('[data-osc="presets.delete"][aria-label="Confirm delete Gone"]').click();
  },
  expect: (s, b, x) => !x.v, read: () => ({ v: (window.OSCILLA.app.customPresets || [])
    .some((p) => p.name === 'Gone') }) });
row({ id: 'presets.clearHistory.pointer', ws: 'presets',
  control: '[data-osc="presets.clearHistory"]', how: 'pointer',
  setup: seq(async (page) => { await page.locator('[data-osc="presets.load"]').nth(2).click(); },
    D.click('#osc-ptab-cat-history')),
  act: D.click('[data-osc="presets.clearHistory"]'),
  expect: (s, b, x) => x.n === 0, read: () => ({ n: (window.OSCILLA.app.history || []).length }) });
row({ id: 'learn.example.pointer', ws: 'learn', control: '[data-osc="learn.example"]',
  how: 'pointer', act: async (page) => { await page.locator('[data-osc="learn.example"]').nth(2)
    .click(); },
  expect: (s, b) => s.app.learnTopic !== b.app.learnTopic || s.workspace !== 'learn'
    || JSON.stringify(s.app) !== JSON.stringify(b.app) });
row({ id: 'learn.demo.pointer', ws: 'learn', control: '[data-osc="learn.demo"]', how: 'pointer',
  act: async (page) => { await page.locator('[data-osc="learn.demo"]').first().click(); },
  expect: (s, b) => !!s.engine.voice || s.studio.playing || s.workspace !== b.workspace });

// ---- more header, dialogs and Studio dialogs
both({ id: 'header.overflow', ws: 'playground', control: '#osc-overflow',
  pointer: D.click('#osc-overflow'), keyboard: D.keys('#osc-overflow', 'Enter'),
  expect: (s, b, x) => x.v === 'true',
  read: () => ({ v: document.querySelector('#osc-overflow').getAttribute('aria-expanded') }) });
row({ id: 'headphones.confirm.pointer', ws: 'synthesis', control: '[data-osc="headphones.confirm"]',
  how: 'pointer', setup: seq(S.dual(), D.click('#osc-dual-binaural')),
  act: D.click('[data-osc="headphones.confirm"]'),
  expect: (s) => !s.dialogs.includes('osc-dlg-headphones') && s.aria.binaural === 'true' });
row({ id: 'studio.copyLink.dialog.pointer', ws: 'studio', control: '[data-osc="studio.linkUrl"]',
  how: 'pointer', covers: ['[data-osc="studio.linkDone"]'], noClipboard: true,
  act: async (page) => {
    await page.click('[data-osc="studio.copyLink"]');
    await until(() => page.evaluate(() => /#/.test(document.querySelector(
      '[data-osc="studio.linkUrl"]').value)), { ms: ROW_MS, what: 'the Studio link is shown' });
    await page.click('[data-osc="studio.linkDone"]');
  },
  expect: (s) => !s.dialogs.includes('osc-dlg-studio-link') });
row({ id: 'studio.find.pointer', ws: 'studio', control: '[data-osc="studio.find.search"]',
  how: 'keyboard', covers: ['[data-osc="studio.find.cancel"]'],
  act: async (page) => {
    await page.click('[data-osc="studio.find"]');
    await page.locator('[data-osc="studio.find.search"]').waitFor({ state: 'visible',
      timeout: ROW_MS });
    await page.keyboard.type('filter');
    await until(() => page.evaluate(() => /\d/.test(document.querySelector(
      '[data-osc="studio.find.status"]').textContent)), { ms: ROW_MS,
      what: 'the find dialog counts its matches' });
    await page.click('[data-osc="studio.find.cancel"]');
  },
  expect: (s) => !s.dialogs.includes('osc-dlg-studio-find') });
row({ id: 'studio.add.cancel.pointer', ws: 'studio', control: '[data-osc="studio.add.cancel"]',
  how: 'pointer', setup: async (page) => { await page.click('[data-osc="studio.add"]');
    await page.locator('[data-osc="studio.add.cancel"]').waitFor({ state: 'visible',
      timeout: ROW_MS }); },
  act: D.click('[data-osc="studio.add.cancel"]'),
  expect: (s, b) => !s.dialogs.includes('osc-dlg-studio-add') && s.studio.nodes.length
    === b.studio.nodes.length });
row({ id: 'studio.connect.cancel.keyboard', ws: 'studio',
  control: '[data-osc="studio.connect.cancel"]', how: 'keyboard',
  setup: async (page) => { await S.studioNode('oscillator')(page);
    await page.locator('[data-osc="studio.graph.viewport"]').focus();
    await page.keyboard.press('c');
    await page.locator('[data-osc="studio.connect.cancel"]').waitFor({ state: 'visible',
      timeout: ROW_MS }); },
  act: D.keys('[data-osc="studio.connect.cancel"]', 'Enter'),
  expect: (s, b) => !s.dialogs.includes('osc-dlg-studio-connect') && s.studio.edges
    === b.studio.edges });
row({ id: 'studio.graph.cancelConnect.pointer', ws: 'studio',
  control: '[data-osc="studio.graph.cancelConnect"]', how: 'pointer',
  setup: async (page) => { await page.locator('.osc-sg-port--out').first().click();
    await page.locator('[data-osc="studio.graph.cancelConnect"]').waitFor({ state: 'visible',
      timeout: ROW_MS }); },
  act: D.click('[data-osc="studio.graph.cancelConnect"]'),
  expect: (s, b, x) => !x.connecting, read: () => ({ connecting: !!document.querySelector(
    '.is-connecting') }) });
row({ id: 'studio.patch.save.pointer', ws: 'studio', control: '#osc-sp-desc', how: 'pointer',
  covers: ['#osc-sp-replace'],
  act: async (page) => {
    await S.studioNode('oscillator')(page);
    for (let i = 0; i < 2; i++) {
      await page.click('[data-osc="studio.inspector.savePatch"]');
      await page.fill('[data-osc="studio.patch.name"]', 'Census patch');
      await page.fill('#osc-sp-desc', 'one oscillator');
      if (i === 0) {
        // the description goes into the patch: its exported file carries it
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: ROW_MS }),
          page.click('[data-osc="studio.patch.export"]')]);
        page.__got = fs.readFileSync(await dl.path(), 'utf8');
      }
      await page.click('[data-osc="studio.patch.save"]');
      if (i === 1) {
        // the same name again: the save is held and the dialog offers to replace the patch
        await page.locator('#osc-sp-replace').waitFor({ state: 'visible', timeout: ROW_MS });
        await page.check('#osc-sp-replace');
        await page.click('[data-osc="studio.patch.save"]');
      }
      await until(() => page.evaluate(() => !document.querySelector(
        '#osc-dlg-studio-patch[open]')), { ms: ROW_MS, what: `the patch is saved (${i + 1})` });
    }
    await page.click('[data-osc="studio.open"]');
  },
  // the library lists the patch once (replaced, not doubled); the file carries the description
  expect: (s, b, x, page) => x.n === 1 && /"description":\s*"one oscillator"/.test(page.__got || ''),
  read: () => ({ n: [...document.querySelectorAll('#osc-dlg-studio-library li.osc-sp-row')]
    .filter((r) => /Census patch/.test(r.textContent)).length }) });
row({ id: 'experiments.import.pointer', ws: 'experiments', control: '[data-osc="exp.import"]',
  how: 'pointer', covers: ['#osc-exp-import-file'],
  act: async (page) => { page.__got = await chooser(page, () => page.click(
    '[data-osc="exp.import"]')); },
  expect: (s, b, x, page) => page.__got && /json/.test(page.__got.accept || '') });
row({ id: 'findings.import.pointer', ws: 'experiments', control: '[data-osc="fnd.import"]',
  how: 'pointer', covers: ['#osc-fnd-import-file'],
  act: async (page) => { page.__got = await chooser(page, () => page.click(
    '[data-osc="fnd.import"]')); },
  expect: (s, b, x, page) => !!page.__got });
row({ id: 'findings.new.pointer', ws: 'experiments', control: '[data-osc="fnd.new"]',
  how: 'pointer', covers: ['[data-osc="fnd.close"]', '#osc-fnd-notes'],
  act: async (page) => {
    await page.click('[data-osc="fnd.new"]');
    await page.locator('#osc-fnd-notes').waitFor({ state: 'visible', timeout: ROW_MS });
    await page.fill('#osc-fnd-notes', 'census');
    await page.click('[data-osc="fnd.close"]');
  },
  expect: (s) => !s.dialogs.includes('osc-dlg-finding') });
row({ id: 'measure.calImport.pointer', ws: 'measure', control: '[data-osc="measure.calImport"]',
  how: 'pointer', covers: ['#osc-measure-cal-file'],
  act: async (page) => { page.__got = await chooser(page, () => page.locator(
    '[data-osc="measure.calImport"]').first().click()); },
  expect: (s, b, x, page) => !!page.__got });

// ------------------------------------------------------------------------------ families
// A family row drives every member it finds, by pointer and by keyboard, in one page per
// workspace; `each(page, member)` returns null when the member round-trips, else the reason.
const FAMILIES = [];
const family = (f) => FAMILIES.push({ kind: 'family', ...f });

family({ id: 'nav.items', control: '[data-osc^="nav."]:not([data-osc^="nav-group"])',
  why: 'each navigation item opens its workspace and marks itself current',
  run: async (page) => {
    const bad = [];
    for (const ws of op.WORKSPACES) {
      await op.navTo(page, ws);
      const cur = await page.evaluate((w) => document.querySelector(`[data-osc="nav.${w}"]`)
        .getAttribute('aria-current'), ws);
      if (cur !== 'page') bad.push(`nav.${ws}: aria-current ${cur}`);
    }
    // keyboard: Enter on the focused item of a top-level workspace
    await page.locator('[data-osc="nav.playground"]').focus();
    await page.keyboard.press('Enter');
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'playground'),
      { ms: ROW_MS, what: 'nav.items: Enter on Playground opens it' });
    return { members: op.WORKSPACES.length, bad };
  } });
family({ id: 'nav.groups', control: '[id^="osc-nav-group-"], [data-osc^="nav-group."]',
  why: 'each navigation group opens by pointer and closes on Escape',
  run: async (page) => {
    const ids = await page.$$eval('[id^="osc-nav-group-"]', (e) => e.map((x) => x.id));
    const bad = [];
    for (const id of ids) {
      await page.click(`#${id}`);
      await until(() => page.evaluate((i) => document.getElementById(i)
        .getAttribute('aria-expanded') === 'true', id), { ms: ROW_MS, what: `${id} opens` });
      await page.keyboard.press('Escape');
      await until(() => page.evaluate((i) => document.getElementById(i)
        .getAttribute('aria-expanded') !== 'true', id), { ms: ROW_MS, what: `${id} closes` });
    }
    return { members: ids.length, bad };
  } });
family({ id: 'tabs', control: '[role="tab"]',
  why: 'each tab, clicked and then reached by Enter, is the selected one and shows its panel',
  run: async (page) => {
    const bad = [];
    let members = 0;
    for (const ws of op.WORKSPACES) {
      await op.navTo(page, ws);
      const tabs = await page.$$eval('[role="tab"]', (t) => t.filter((e) => e.offsetParent
        !== null && !e.closest('dialog')).map((e) => e.id).filter(Boolean));
      for (const id of tabs) {
        members++;
        for (const how of ['pointer', 'keyboard']) {
          if (how === 'pointer') await page.click(`#${id}`);
          else { await page.focus(`#${id}`); await page.keyboard.press('Enter'); }
          const r = await until(() => page.evaluate((i) => {
            const t = document.getElementById(i);
            const p = t.getAttribute('aria-controls');
            const panel = p ? document.getElementById(p) : null;
            return t.getAttribute('aria-selected') === 'true'
              && (!panel || panel.offsetParent !== null) ? { panel: p } : null;
          }, id), { ms: ROW_MS, what: `tab ${id} (${how}) selected with its panel shown` })
            .catch((e) => ({ err: e.message.split('\n')[0] }));
          if (r.err) bad.push(`${ws} ${id} ${how}: ${r.err}`);
        }
      }
    }
    return { members, bad };
  } });
family({ id: 'disclosure', control: '[data-osc$=".collapse"]',
  why: 'each panel collapse button flips aria-expanded and hides, then shows, its region',
  run: async (page) => {
    const bad = [];
    let members = 0;
    for (const ws of ['playground', 'analyzer', 'compare']) {
      await op.navTo(page, ws);
      const ids = await page.$$eval('[data-osc$=".collapse"]', (b) => b.filter((e) =>
        e.offsetParent !== null).map((e) => e.id));
      for (const id of ids) {
        members++;
        for (const how of ['pointer', 'keyboard']) {
          const before = await page.evaluate((i) => document.getElementById(i)
            .getAttribute('aria-expanded'), id);
          if (how === 'pointer') await page.click(`#${id}`);
          else { await page.focus(`#${id}`); await page.keyboard.press('Enter'); }
          const r = await until(() => page.evaluate(([i, was]) => {
            const b = document.getElementById(i);
            const now = b.getAttribute('aria-expanded');
            const reg = document.getElementById(b.getAttribute('aria-controls') || '');
            const shown = reg ? reg.offsetParent !== null || reg.getClientRects().length > 0 : null;
            return now !== was && (shown === null || shown === (now === 'true')) ? now : null;
          }, [id, before]), { ms: ROW_MS, what: `${id} (${how}) toggles its region` })
            .catch((e) => ({ err: e.message.split('\n')[0] }));
          if (r && r.err) bad.push(`${ws} ${id} ${how}: ${r.err}`);
        }
      }
    }
    return { members, bad };
  } });
row({ id: 'filter.page.pointer', ws: 'playground', control: '#osc-filter-fullscreen',
  how: 'pointer', act: D.click('#osc-filter-fullscreen'), expect: (s) => s.workspace === 'filter' });
row({ id: 'filter.page.keyboard', ws: 'filter', control: '#osc-filter-fullscreen',
  how: 'keyboard', act: D.keys('#osc-filter-fullscreen', 'Enter'),
  expect: (s) => s.workspace === 'playground' });
// the Filter Lab's corner button opens its page (above); the others ask for fullscreen
const FS = '[id$="-fullscreen"]:not(#osc-filter-fullscreen), '
  + '[data-osc$=".fullscreen"]:not([data-osc="filter.fullscreen"])';
family({ id: 'fullscreen', control: FS,
  why: 'each fullscreen button asks the browser to show its own panel full screen',
  init: FULLSCREEN_PROBE,
  run: async (page) => {
    const bad = [];
    let members = 0;
    for (const ws of ['analyzer', 'synthesis', 'studio']) {
      await op.navTo(page, ws);
      if (ws === 'analyzer') await page.click('#osc-atab-spectrogram');
      const sels = await page.$$eval(FS,
        (b) => b.filter((e) => e.offsetParent !== null).map((e) => (e.id ? `#${e.id}`
          : `[data-osc="${e.getAttribute('data-osc')}"]`)));
      for (const sel of sels) {
        members++;
        const n = (await page.evaluate(() => window.__oscFullscreenAsked())).length;
        await page.click(sel);
        const r = await until(() => page.evaluate((k) => {
          const a = window.__oscFullscreenAsked();
          return a.length > k ? a[a.length - 1] : null;
        }, n), { ms: ROW_MS, what: `${sel} asks for fullscreen` })
          .catch((e) => ({ err: e.message.split('\n')[0] }));
        if (r && r.err) bad.push(`${ws} ${sel}: ${r.err}`);
        await page.keyboard.press('Escape');
      }
    }
    return { members, bad };
  } });
family({ id: 'links.external', control: 'a[href^="http"]',
  why: 'each citation and About link opens a new tab without the opener (nothing is fetched '
    + 'by the page: the href is read, not followed)',
  run: async (page) => {
    const links = await page.$$eval('a[href^="http"]', (a) => a.map((e) => ({ href: e.href,
      target: e.target, rel: e.rel })));
    const bad = links.filter((l) => !/^https:/.test(l.href) || l.target !== '_blank'
      || !/noopener/.test(l.rel)).map((l) => `${l.href} target=${l.target} rel=${l.rel}`);
    return { members: links.length, bad };
  } });
family({ id: 'links.internal', control: 'a[href="#osc-main"], a[href^="mailto:"]',
  why: 'the skip link and the brand, by pointer and by Enter, take the page to the instrument; '
    + 'a mail link is a mailto',
  run: async (page) => {
    const bad = [];
    const links = await page.$$eval('a[href="#osc-main"]', (a) => a.map((e, i) => ({ i,
      href: e.getAttribute('href') })));
    for (const l of links) {
      // the skip link is shown when it has the focus: it is a keyboard path only
      const visible = await page.locator('a[href="#osc-main"]').nth(l.i).evaluate((e) =>
        e.getBoundingClientRect().width > 2 && !/sr-only|skip/.test(e.className));
      for (const how of visible ? ['pointer', 'keyboard'] : ['keyboard']) {
        await page.evaluate(() => { history.replaceState(null, '', location.pathname); });
        const loc = page.locator('a[href="#osc-main"]').nth(l.i);
        if (how === 'pointer') await loc.click();
        else { await loc.focus(); await page.keyboard.press('Enter'); }
        const ok = await until(() => page.evaluate((h) => location.hash === h
          || (document.activeElement && `#${document.activeElement.id}` === h), l.href),
        { ms: ROW_MS, what: `${l.href} link (${how}) reaches its target` }).catch(() => false);
        if (!ok) bad.push(`${l.href} ${how}`);
      }
    }
    const mail = await page.$$eval('a[href^="mailto:"]', (a) => a.map((e) => e.href));
    return { members: links.length + mail.length, bad };
  } });
family({ id: 'dialogs.dismiss', control: 'dialog .osc-dialog-actions button:not([data-osc])',
  init: NO_CLIPBOARD,
  why: 'each dialog closes by its own Cancel, Done or Close button and by Escape',
  run: async (page) => {
    const bad = [];
    let members = 0;
    const open = [['#osc-act-save-preset', 'osc-dlg-save'], ['#osc-act-url', 'osc-dlg-copy'],
      ['#osc-help', 'osc-dlg-help'], ['#osc-act-settings', 'osc-dlg-settings']];
    for (const [opener, id] of open) {
      for (const how of ['pointer', 'keyboard']) {
        await page.click(opener);
        await until(() => page.evaluate((d) => document.getElementById(d).open, id),
          { ms: ROW_MS, what: `${id} opens from ${opener}` });
        const btns = await page.$$eval(`#${id} .osc-dialog-actions button:not([data-osc])`,
          (b) => b.length);
        if (how === 'pointer' && btns) {
          members += btns;
          await page.locator(`#${id} .osc-dialog-actions button:not([data-osc])`).first().click();
        } else await page.keyboard.press('Escape');
        const shut = await until(() => page.evaluate((d) => !document.getElementById(d).open, id),
          { ms: ROW_MS, what: `${id} closes (${how})` }).catch(() => false);
        if (!shut) bad.push(`${id} stays open after ${how === 'pointer' ? 'its button' : 'Escape'}`);
      }
    }
    return { members, bad };
  } });

// ------------------------------------------------------------------------------ delegated and debt
// A delegated row names the suite that drives and judges the control; a debt row a control
// nothing drives yet, listed in tests/unit/control-drive-baseline.json.
const LEDGER = [];
const delegated = (control, by, why) => LEDGER.push({ kind: 'delegated', control, by, why });
const debt = (control, why) => LEDGER.push({ kind: 'debt', control, why });

// The Studio dialogs, library and graph editing (tests/browser/v31-studio-*.cjs)
for (const k of ['studio.back', 'studio.add', 'studio.copyLink', 'studio.templates', 'studio.open',
  'studio.save', 'studio.export', 'studio.renderWav', 'studio.keys', 'studio.find',
  'studio.library.search', 'studio.library.item', 'studio.graph.viewport', 'studio.template.open',
  'studio.add.search', 'studio.render.start', 'studio.render.cancel', 'studio.saved.close',
  'studio.patch.save', 'studio.patch.export']) {
  delegated(`[data-osc="${k}"]`, 'v31-studio-graph.cjs v31-studio-workflows.cjs '
    + 'v31-studio-links.cjs live-smoke.cjs', 'Studio editing, library and dialogs');
}
delegated('[data-osc="studio.import"]', 'v31-studio-workflows.cjs', 'project import');
delegated('#osc-studio-import-file', 'v31-studio-workflows.cjs', 'project import file');

// MEASURE: the guided flow's links and switches, calibration, level calibration and recipe link
for (const [c, by] of [['[data-osc="measure.recipeLink"]', 'v3-ui.cjs'], ['[data-osc="measure.choice"]', 'v3-ui.cjs'],
  ['[data-osc="measure.levelCal"]', 'app.cjs v3-ui.cjs'],
  ['[data-osc="measure.levelRemove"]', 'app.cjs'], ['[data-osc="levelCal.stop"]', 'v3-ui.cjs'],
  ['[data-osc="levelCal.manual"]', 'app.cjs v3-ui.cjs'], ['#osc-lc-obs', 'app.cjs v3-ui.cjs'],
  ['#osc-lc-cond', 'v3-ui.cjs'], ['[data-osc="levelCal.save"]', 'app.cjs v3-ui.cjs'],
  ['[data-osc="calConv.load"]', 'v3-ui.cjs'], ['[data-osc="measure.recipeLinkDone"]', 'v3-ui.cjs'],
  ['[data-osc="midi.connect"]', 'midi.cjs'], ['#osc-import-file', 'app.cjs'],
  ['#osc-chart-bio', 'labs.cjs']]) {
  delegated(c, by, 'MEASURE, calibration, MIDI and lab views');
}
// EXPERIMENTS and FINDINGS (tests/browser/v3-ui.cjs, app.cjs)
for (const [c, by] of [['[data-osc="def.new"]', 'v3-ui.cjs'],
  ['[data-osc="exp.compare"]', 'app.cjs v3-ui.cjs'], ['[data-osc="fnd.draftContinue"]', 'v3-ui.cjs'],
  ['[data-osc="fnd.draftDiscard"]', 'app.cjs'], ['[data-osc="exp.rename"]', 'app.cjs v3-ui.cjs'],
  ['[data-osc="exp.baseline"]', 'v3-ui.cjs'], ['[data-osc="exp.repeat"]', 'v3-ui.cjs'],
  ['[data-osc="exp.inspect"]', 'v3-ui.cjs'], ['[data-osc="exp.export"]', 'v3-ui.cjs'],
  ['[data-osc="exp.csvTransfer"]', 'v3-ui.cjs'], ['[data-osc="exp.delete"]', 'app.cjs v3-ui.cjs'],
  ['#osc-x-ev-hz', 'v3-ui.cjs'], ['[data-osc="exp.findingNew"]', 'app.cjs v3-ui.cjs'],
  ['[data-osc="exp.findingCompare"]', 'v3-ui.cjs'], ['[data-osc="exp.backToDetail"]', 'app.cjs'],
  ['#osc-exp-rename-name', 'navigation.cjs v3-ui.cjs'], ['[data-osc="exp.renameSave"]', 'v3-ui.cjs'],
  ['#osc-def-name', 'app.cjs v3-ui.cjs'], ['#osc-def-conditions', 'v3-ui.cjs'],
  ['#osc-def-min', 'v3-ui.cjs'], ['[data-osc="def.save"]', 'app.cjs v3-ui.cjs'],
  ['[data-osc="exp.deleteCancel"]', 'app.cjs v3-ui.cjs'],
  ['[data-osc="exp.deleteConfirm"]', 'v3-ui.cjs'], ['#osc-fnd-statement', 'app.cjs v3-ui.cjs'],
  ['#osc-fnd-status', 'v3-ui.cjs'], ['#osc-fnd-cmp-a', 'v3-ui.cjs'], ['#osc-fnd-cmp-b', 'v3-ui.cjs'],
  ['[data-osc="fnd.addCompare"]', 'v3-ui.cjs'], ['[data-osc="fnd.loadStored"]', 'app.cjs'],
  ['[data-osc="fnd.mine"]', 'app.cjs'], ['[data-osc="fnd.discard"]', 'app.cjs v3-ui.cjs'],
  ['[data-osc="fnd.save"]', 'app.cjs v3-ui.cjs'], ['[data-osc="fnd.deleteConfirm"]', 'app.cjs v3-ui.cjs'],
  ['[data-osc="studio.render.duration"]', 'v31-studio-workflows.cjs'],
  ['[data-osc="studio.patch.name"]', 'v31-studio-graph.cjs']]) {
  delegated(c, by, 'experiments, findings and the Studio render');
}
// Debt: needs a stored experiment, a finding, a calibration file or a long task; listed in
// tests/unit/control-drive-baseline.json until a suite drives it
for (const c of ['[data-osc="measure.setupToggle"]', '[data-osc="measure.switch"]',
  '[data-osc="measure.field"]', '[data-osc="measure.calExportCsv"]',
  '[data-osc="measure.calExportJson"]', '[data-osc="measure.calRemove"]',
  '[data-osc="measure.calUse"]', '[data-osc="measure.levelUse"]',
  '[data-osc="measure.clearDefinition"]', '[data-osc="fnd.export"]', '[data-osc="exp.duplicate"]',
  '[data-osc="exp.csvAggregate"]', '[data-osc="exp.csvIr"]', '[data-osc="studio.task.abort"]',
  '#osc-lc-hz', '#osc-lc-ref', '[data-osc="levelCal.capture"]',
  '[data-osc="measure.recipeLinkUrl"]', '#osc-def-notes', '[data-osc="def.useSetup"]',
  '#osc-fnd-run', '[data-osc="fnd.addRun"]', '[data-osc="fnd.deleteCancel"]']) {
  debt(c, 'needs a stored result, a finding, a calibration or a running task');
}

module.exports = { ROWS, FAMILIES, LEDGER };

// ------------------------------------------------------------------------------ runner side
function selKey(control) {
  const id = /^#([\w-]+)$/.exec(control);
  if (id) return `#${id[1]}`;
  const osc = /^\[data-osc="([^"]+)"\]/.exec(control);
  return osc ? osc[1] : null;
}

const DRIVE = new RegExp('\\.(click|fill|selectOption|press|check|uncheck|tap|dispatchEvent|'
  + 'focus|hover|setInputFiles|dragTo|type)\\(|keyboard\\.|mouse\\.|\\.value\\s*=[^=]'
  + '|new (Input|Mouse|Pointer|Keyboard)Event');
const fileCache = new Map();
function linesOf(f) {
  if (!fileCache.has(f)) {
    const p = path.join(__dirname, f);
    fileCache.set(f, fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n')
      .map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l)) : null);
  }
  return fileCache.get(f);
}
/** Does suite file `f` drive the control keyed `key` (the ratchet's reading)? */
function drives(f, key) {
  const lines = linesOf(f);
  if (!lines) return false;
  const names = key.startsWith('#') ? [key, `'${key.slice(1)}'`, `"${key.slice(1)}"`]
    : [`"${key}"`, `'${key}'`, `=${key}]`, `\\"${key}\\"`];
  return lines.some((l, i) => names.some((n) => l.includes(n))
    && DRIVE.test([lines[i - 1] || '', l, lines[i + 1] || ''].join('\n')));
}

/** The ledger's static checks: [problem]. */
function checkLedger() {
  const problems = [];
  const listed = new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).undriven);
  for (const r of LEDGER) {
    const key = selKey(r.control);
    if (!key) { problems.push(`${r.kind} ${r.control}: not keyed by an id or a data-osc value`);
      continue; }
    if (r.kind === 'delegated') {
      const files = r.by.split(/\s+/);
      if (!files.some((f) => drives(f, key))) {
        problems.push(`delegated ${r.control}: none of ${r.by} drives it any more`);
      }
    } else if (!listed.has(key)) {
      problems.push(`debt ${r.control}: not listed in tests/unit/control-drive-baseline.json `
        + '(driven now: make it a drive or a delegated row)');
    }
  }
  return problems;
}

/** Discover every control on a fresh page and match it to the rows: { unrowed, stale, n }. */
async function census(browser) {
  const { context, page } = await op.openApp(browser, { dist: DIST, audio: false });
  try {
    // a row covers its control and, for a row that drives several, the ones it lists
    const all = [...ROWS, ...FAMILIES, ...LEDGER];
    const sels = [];
    const owner = [];
    all.forEach((r, i) => [r.control, ...(r.covers || [])].forEach((c) => {
      sels.push(c);
      owner.push(i);
    }));
    const seen = new Map();
    const hits = new Set();
    for (const ws of op.WORKSPACES) {
      await op.navTo(page, ws);
      const found = await page.evaluate(op.discoverInPage, false);
      const match = await page.evaluate(op.matchInPage, sels);
      for (const c of found) {
        const m = match[c.index];
        if (m === null || m === undefined) {
          if (!seen.has(c.key)) seen.set(c.key, ws);
        } else hits.add(owner[m]);
      }
    }
    const ledgerStart = ROWS.length + FAMILIES.length;
    const stale = LEDGER.filter((r, i) => !hits.has(ledgerStart + i)).map((r) => r.control);
    return { unrowed: [...seen].map(([k, ws]) => `${k} (${ws})`), stale, n: seen.size };
  } finally { await context.close(); }
}

async function runRow(browser, r) {
  const { context, page, errors } = await op.openApp(browser, { dist: DIST, viewport: r.viewport,
    init: r.noClipboard ? [FULLSCREEN_PROBE, NO_CLIPBOARD] : FULLSCREEN_PROBE,
    keepSafety: !!r.keepSafety });
  try {
    if (r.ws !== 'playground') await op.navTo(page, r.ws);
    const read = () => (r.read ? page.evaluate(r.read, r.readArg) : Promise.resolve({}));
    if (r.setup) await r.setup(page);
    let dbBefore = null;
    if (r.audio) {
      // the setup's sound is steady (two readings in a row within 0.3 dB) before the "before"
      let prev = null;
      await until(async () => {
        const db = await op.toneDb(page, r.audio.hz);
        const steady = prev !== null && Math.abs(db - prev) < 0.3;
        prev = db;
        dbBefore = db;
        return steady;
      }, { ms: ROW_MS, what: `${r.id}: a steady level at ${r.audio.hz} Hz before the change`,
        every: 150 });
    }
    const before = { ...(await page.evaluate(op.snapshot)), x: await read() };
    await r.act(page);
    let last = null;
    let db = null;
    await until(async () => {
      last = await page.evaluate(op.snapshot);
      const x = await read();
      if (r.audio) db = await op.toneDb(page, r.audio.hz);
      return r.expect(last, before, x, page) && (!r.audio || r.audio.expect(db, dbBefore));
    }, { ms: r.timeout || ROW_MS, what: `${r.id} (${r.control}, ${r.how})` });
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
    return { ok: true, detail: r.audio ? { before: +dbBefore.toFixed(1), after: +db.toFixed(1) }
      : null };
  } catch (e) {
    return { ok: false, error: op.clip(String(e.message).split('\n')[0], 300) };
  } finally {
    await context.close().catch(() => {});
  }
}

async function runFamily(browser, f) {
  const { context, page, errors } = await op.openApp(browser, { dist: DIST, init: f.init });
  try {
    const r = await f.run(page);
    if (errors.length) r.bad.push(`page errors: ${errors.join(' | ')}`);
    if (!r.members) r.bad.push('no member found');
    return r.bad.length ? { ok: false, error: r.bad.slice(0, 6).join('; ') }
      : { ok: true, detail: { members: r.members } };
  } catch (e) {
    return { ok: false, error: op.clip(String(e.message).split('\n')[0], 300) };
  } finally {
    await context.close().catch(() => {});
  }
}

if (require.main === module) {
  (async () => {
    await RUN.ready();
    if (!fs.existsSync(DIST)) {
      console.error(`missing ${DIST}: run npm run build`);
      process.exit(2);
    }
    const ids = new Set();
    for (const r of [...ROWS, ...FAMILIES]) {
      if (ids.has(r.id)) throw new Error(`duplicate census row ${r.id}`);
      ids.add(r.id);
    }
    if (ONLY) {
      const unknown = [...ONLY].filter((n) => !ids.has(n));
      if (unknown.length) { console.error(`unknown row(s): ${unknown.join(', ')}`); process.exit(2); }
    }
    const ledger = checkLedger();
    let failed = 0;
    for (const name of RUN.browsers) {
      const browser = await playwright[name].launch(op.LAUNCH[name]);
      const t0 = Date.now();
      let n = 0;
      const tally = { PASS: 0, FAIL: 0, XFAIL: 0, XPASS: 0 };
      const report = (status, id, msg) => {
        n++;
        tally[status]++;
        console.log(`  ${status.padEnd(5)}  ${name} ${id}${msg ? `  ${msg}` : ''}`);
      };
      try {
        if (!ONLY || UNROWED) {
          const c = await bounded(census(browser), { ms: 240000, what: 'the control discovery' });
          if (UNROWED) {
            for (const k of c.unrowed) console.log(`  unrowed ${k}`);
            for (const k of c.stale) console.log(`  stale ${k}`);
            process.exitCode = 1;
            continue;
          }
          report(c.unrowed.length ? 'FAIL' : 'PASS', 'census:every-control-has-a-row',
            c.unrowed.length ? `${c.unrowed.length} control(s) with no row: ${c.unrowed
              .slice(0, 12).join(', ')}` : '');
          report(c.stale.length ? 'FAIL' : 'PASS', 'census:no-stale-row',
            c.stale.length ? `row(s) whose control is gone: ${c.stale.join(', ')}` : '');
          report(ledger.length ? 'FAIL' : 'PASS', 'census:ledger-holds',
            ledger.length ? ledger.join('; ') : `${LEDGER.length} delegated and debt row(s)`);
        }
        for (const f of FAMILIES) {
          if (ONLY && !ONLY.has(f.id)) continue;
          const r = await bounded(runFamily(browser, f), { ms: 300000, what: `family ${f.id}` });
          report(r.ok ? 'PASS' : 'FAIL', `family:${f.id}`, r.ok ? JSON.stringify(r.detail)
            : r.error);
        }
        for (const r of ROWS) {
          if (ONLY && !ONLY.has(r.id)) continue;
          const res = await bounded(runRow(browser, r), { ms: (r.timeout || ROW_MS) * 4 + 60000,
            what: `row ${r.id}` });
          const mark = r.xfail ? ` [expected failure: ${r.xfail.finding}, ${r.xfail.issue}, fix PR #${
            r.xfail.pr}]` : '';
          let status = res.ok ? 'PASS' : 'FAIL';
          if (r.xfail) status = res.ok ? 'XPASS' : 'XFAIL';
          report(status, `${r.id}${mark}`, res.ok ? (r.xfail ? 'the defect no longer reproduces: '
            + 'remove the expected-failure mark' : (res.detail ? JSON.stringify(res.detail) : ''))
            : res.error);
        }
      } finally {
        await browser.close();
      }
      RUN.reportLeg({ leg: name, checks: n });
      const bad = tally.FAIL + tally.XPASS;
      failed += bad;
      console.log(`${bad ? 'FAIL' : 'PASS'} ${name}: ${tally.PASS} pass, ${tally.XFAIL} expected `
        + `failure(s), ${tally.FAIL} fail, ${tally.XPASS} unexpected pass `
        + `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    }
    if (!UNROWED) {
      console.log(failed ? `${failed} FAILED` : 'ALL PASS');
      process.exitCode = failed ? 1 : 0;
    }
  })().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

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
//   s-wave     Square on VCO 1 (VCO 2 muted): the 2nd harmonic 30 dB+ below the 3rd; Pulse with a
//              typed width of 25 %: the 4th harmonic 30 dB+ below the 3rd
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
//              copied link; the link reopens the cable at the same depth and the MG sweeps the
//              cutoff on both pages (the 1-3 kHz band swings 10 dB+)
//   s-studio   Open in Studio: #m=studio, the panel's nodes selected, the same revision
//   s-escape   Escape releases a held note; leaving the workspace disarms: runtime census 0
//   s-preset   the Ring bell preset is one undo entry and moves the spectrum
//   s-mobile   390 x 844 with touch: no horizontal page scroll, every knob and jack box 44 px+,
//              a section chip lands its plate's heading below the sticky chip bar, the docked
//              keys are visible and a tap on them sounds
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { serveDist } = require('./lib/serve.cjs');
const { until, bounded } = require('./lib/wait.cjs');
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
const PHONE_CHECKS = new Set(['s-sound', 's-cable', 's-mobile']);
const LOAD_MS = 60000;
const SOUND_MS = 8000; // a note's attack, a knob change's glide and the analyser's smoothing
const CHECK_MS = 120000;
const C4 = 261.6256;

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
    && document.querySelector('[data-osc="synth.bay.svg"]'))),
  { ms: LOAD_MS, what: 'the Synth panel is rendered' });
  await page.locator('#osc-synth-title').click();
  return page;
}
const knob = (page, cid) => page.locator(`[data-knob="${cid}"]`);
async function keyKnob(page, cid, key) {
  await knob(page, cid).focus();
  await page.keyboard.press(key);
}
async function typeKnob(page, cid, text) {
  await knob(page, cid).focus();
  await page.keyboard.press('Enter');
  const input = page.locator('[data-osc="synth.panel"] input[type="text"]');
  await input.fill(text);
  await input.press('Enter');
}
const option = (page, cid, v) => page.locator(`[data-option="${cid}"][data-v="${v}"]`).click();
async function tapJack(page, id) {
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
    // Velocity 100 / 127 into a bipolar 1-octave depth: VCO 2 at 440 x 2^(2 x 100/127 - 1).
    const fixed = 440 * 2 ** (2 * (100 / 127) - 1);
    const peaks = [];
    for (const code of ['KeyA', 'KeyD']) {
      await hold(page, code);
      peaks.push((await sound(page, (q) => q.rmsDb > -45 && peakAt(q, fixed),
        `VCO 2 stays at ${fixed} Hz`)).rmsDb);
      await page.keyboard.up(code);
      await silent(page, 'the note releases');
    }
    await page.locator(`[data-remove-cable="${d.cables[0].id}"]`).click();
    await hold(page, 'KeyD');
    await sound(page, (q) => q.rmsDb > -45 && peakAt(q, C4 * 2 ** (4 / 12)),
      'VCO 2 tracks E4 again');
    await page.keyboard.up('KeyD');
    const after = await dbg(page);
    return { ok: model.includes(d.cables[0].id) && after.cables.length === 0, size, fixed, peaks };
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
    await typeKnob(page, 'mg.rate', '4');
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
    const hash = await page.evaluate(() => window.OSCILLA.app.synthCopyLink());
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
      === JSON.stringify(before.nodes) && after.sel.length === 14, before, after };
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

  def('s-preset', async ({ page }) => {
    await hold(page, 'KeyA');
    const a = await sound(page, (q) => q.rmsDb > -40, 'the init preset sounds');
    await page.keyboard.up('KeyA');
    await page.locator('[data-osc="synth.preset"]').selectOption('ring-bell');
    const label = await page.evaluate(() => window.OSCILLA.studio.model && document
      .querySelector('[data-osc="synth.status"]').textContent);
    await hold(page, 'KeyA');
    const b = await sound(page, (q) => q.rmsDb > -60 && Math.abs(bandDb(q, 600, 3000)
      - bandDb(a, 600, 3000)) > 3, 'the Ring bell preset changes the spectrum');
    await page.keyboard.up('KeyA');
    return { ok: /Ring bell/.test(label), label, before: bandDb(a, 600, 3000),
      after: bandDb(b, 600, 3000) };
  });

  def('s-mobile', async ({ page }) => {
    const m = await page.evaluate(() => {
      const small = [...document.querySelectorAll('[data-knob], [data-jack] rect, '
        + '[data-osc="synth.view"] button, [data-option]')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.width < 43.5 || r.height < 43.5);
      }).map((el) => el.getAttribute('data-knob') || el.getAttribute('data-option')
        || (el.parentNode && el.parentNode.getAttribute && el.parentNode.getAttribute('data-jack')));
      const kb = document.querySelector('[data-osc="keyboard.keys"]').getBoundingClientRect();
      return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth,
        small, kb: { top: kb.top, bottom: kb.bottom, h: window.innerHeight } };
    });
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
    return { ok: m.scroll <= m.inner && m.small.length === 0 && m.kb.bottom <= m.kb.h
      && m.kb.top > 0, ...m, chip, rmsDb: p.rmsDb };
  });
  return checks;
}

// ------------------------------------------------------------------------------ runner
async function runLeg(browserName, sizeName, base) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const results = {};
  try {
    for (const { name, fn } of defineChecks()) {
      if (ONLY && !ONLY.has(name)) continue;
      if (sizeName === 'phone' && !PHONE_CHECKS.has(name)) continue;
      if (sizeName === 'desktop' && name === 's-mobile') continue;
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
        for (const size of Object.keys(SIZES)) {
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

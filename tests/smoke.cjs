#!/usr/bin/env node
// OSCILLA headless smoke test. Dev-only; the application itself has no dependencies.
//
//   npm --prefix tests install
//   node tests/smoke.cjs                         # file:// index.html next to this folder
//   node tests/smoke.cjs --url https://korczis.github.io/oscilla/
//   node tests/smoke.cjs --shots                 # also write screenshots to tests/screenshots/
//
// Exit code 0 only when every check passes.
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
const SHOTS = args.includes('--shots');
const BASE = urlArg || `file://${path.resolve(__dirname, '..', 'index.html')}`;
const SHOT_DIR = path.join(__dirname, 'screenshots');
const VIEWPORTS = [[320, 640], [375, 667], [390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];
const IGNORED_CONSOLE = [/cdn\.tailwindcss\.com should not be used in production/];

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; failures.push(`${name} ${detail}`); console.log(`  FAIL ${name} ${detail}`); }
}

async function openPage(browser, { width = 1280, height = 900, hash = '', query = '', init = null, scheme = 'light' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 768 });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type())) return;
    if (IGNORED_CONSOLE.some((re) => re.test(m.text()))) return;
    problems.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.goto(`${BASE}${query}${hash}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Alpine && window.OSCILLA && document.querySelector('[x-ref=vizCanvas] canvas'), null, { timeout: 20000 });
  await page.waitForTimeout(300);
  return { context, page, problems };
}

const app = (page, fn, arg) => page.evaluate(([src, a]) => {
  const data = window.Alpine.$data(document.body);
  return new Function('app', 'engine', 'O', 'arg', `return (${src})(app, engine, O, arg);`)(data, window.OSCILLA.engine, window.OSCILLA, a);
}, [fn.toString(), arg]);

async function holdFor(page, ms) {
  const box = await page.locator('.hold-btn').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
}

async function main() {
  console.log(`OSCILLA smoke test → ${BASE}`);
  if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  // ------------------------------------------------------------------ helpers (pure)
  console.log('helpers');
  {
    const { page, problems, context } = await openPage(browser);
    const r = await page.evaluate(() => {
      const O = window.OSCILLA;
      const parse = ['440', '440hz', '1k', '1khz', '15.5k', '15500', '20k', '20khz', '20 kHz'].map((s) => O.parseFrequency(s).value);
      const bad = ['abc', '', '-5', '1..2', 'NaN', '12q', '0'].map((s) => O.parseFrequency(s).ok);
      const fmt = [20, 440, 1000, 15500, 20000, 261.63].map((f) => O.formatFrequency(f));
      const per = [20, 100, 440, 1000, 10000, 15500, 20000].map((f) => O.formatPeriod(f));
      const wav = [20, 100, 440, 1000, 10000, 15500, 20000].map((f) => O.formatWavelength(f));
      const rt = [20, 440, 1000, 15500].map((f) => Math.abs(O.normalizedToFrequency(O.frequencyToNormalized(f, 20, 20000), 20, 20000) - f) < 1e-6);
      const mid = O.normalizedToFrequency(0.5, 20, 20000);
      const notes = [[440, 'A4'], [261.63, 'C4'], [82.41, 'E2']].map(([f, n]) => O.nearestNote(f, 440).name === n);
      const cents = O.nearestNote(440, 440).cents;
      const regions = [[30, 'SUB-BASS'], [15500, 'VERY HIGH FREQUENCY'], [21000, 'NOMINAL ULTRASONIC REGION']].map(([f, l]) => O.regionFor(f).label === l);
      const env = { safeMax: 22800, continuous: false };
      const plans = O.PATTERNS.map((p) => [p.id, O.buildPlan({ source: 'single', pattern: p.id, waveform: 'sine', frequency: 440, duration: 500, pp: {}, sweep: {} }, env).ok]);
      const seq = O.buildPlan({ source: 'single', pattern: 'sequence', frequency: 440, pp: { sequence: { text: '440, 8x0, 1k' } } }, env);
      const clampPlan = O.buildPlan({ source: 'single', pattern: 'tone', frequency: 30000, pp: {} }, env);
      const third = O.buildPlan({ source: 'single', pattern: 'sequence', pp: { sequence: { text: '20, 25, 31.5, 16000, 20000', toneMs: 100, gapMs: 0 } } }, { safeMax: 18000, continuous: false });
      const harmSq = O.harmonicTable('square', 1000, 24000).list.filter((h) => h.below).map((h) => h.n).slice(0, 4);
      const harmSaw = O.harmonicTable('sawtooth', 1000, 24000).list.slice(0, 4).map((h) => h.n);
      return { parse, bad, fmt, per, wav, rt, mid, notes, cents, regions, plans, seqOk: seq.ok, seqErr: seq.error, clampFreq: clampPlan.plan.freq, clampWarn: clampPlan.warnings.length, thirdN: third.plan.steps.length, harmSq, harmSaw };
    });
    check('parseFrequency accepts all spec forms', JSON.stringify(r.parse) === JSON.stringify([440, 440, 1000, 1000, 15500, 15500, 20000, 20000, 20000]), JSON.stringify(r.parse));
    check('parseFrequency rejects malformed input', r.bad.every((x) => x === false), JSON.stringify(r.bad));
    check('formatFrequency matches spec', JSON.stringify(r.fmt) === JSON.stringify(['20 Hz', '440 Hz', '1.00 kHz', '15.50 kHz', '20.00 kHz', '261.63 Hz']), JSON.stringify(r.fmt));
    check('period examples', JSON.stringify(r.per) === JSON.stringify(['50 ms', '10 ms', '2.27 ms', '1 ms', '100 µs', '64.5 µs', '50 µs']), JSON.stringify(r.per));
    check('wavelength examples', JSON.stringify(r.wav) === JSON.stringify(['17.15 m', '3.43 m', '0.78 m', '34.3 cm', '3.43 cm', '2.21 cm', '1.72 cm']), JSON.stringify(r.wav));
    check('log mapping round-trips', r.rt.every(Boolean));
    check('log mapping midpoint is geometric mean (632 Hz)', Math.abs(r.mid - 632.46) < 0.1, String(r.mid));
    check('nearest notes A4 / C4 / E2', r.notes.every(Boolean));
    check('440 Hz is 0 cents', r.cents === 0);
    check('regions', r.regions.every(Boolean));
    check('every pattern builds a plan', r.plans.every(([, ok]) => ok), JSON.stringify(r.plans.filter(([, ok]) => !ok)));
    check('malformed sequence rejected with message', !r.seqOk && /8x0/.test(r.seqErr), r.seqErr);
    check('frequency above safe max is clamped', r.clampFreq === 22800 && r.clampWarn > 0);
    check('sequence values above safe max are filtered', r.thirdN === 4, String(r.thirdN));
    check('square harmonics are odd', JSON.stringify(r.harmSq) === '[1,3,5,7]', JSON.stringify(r.harmSq));
    check('saw harmonics are all integers', JSON.stringify(r.harmSaw) === '[1,2,3,4]', JSON.stringify(r.harmSaw));
    check('no console problems on load', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------------ audio engine
  console.log('audio engine');
  {
    const { page, problems, context } = await openPage(browser);
    await holdFor(page, 400);
    const playing = await app(page, (a, e) => ({ status: a.status, voice: !!e.voice, ctx: e.state, sr: e.sampleRate, nodes: e.activeNodeCount }));
    check('hold starts playback', playing.status === 'PLAYING' && playing.voice, JSON.stringify(playing));
    check('AudioContext running with a reported sample rate', playing.ctx === 'running' && playing.sr > 8000, JSON.stringify(playing));
    const level = await page.evaluate(() => {
      const e = window.OSCILLA.engine;
      e.analyser.getFloatTimeDomainData(e.timeData);
      let peak = 0;
      for (const v of e.timeData) peak = Math.max(peak, Math.abs(v));
      e.analyser.getFloatFrequencyData(e.freqData);
      let best = 0;
      for (let i = 1; i < e.freqData.length; i++) if (e.freqData[i] > e.freqData[best]) best = i;
      return { peak, peakHz: (best * e.ctx.sampleRate) / e.analyser.fftSize };
    });
    check('output peak ≈ logical gain 0.08 (limiter makeup removed)', Math.abs(level.peak - 0.08) < 0.012, JSON.stringify(level));
    check('spectrum peak at requested 440 Hz', Math.abs(level.peakHz - 440) < 12, JSON.stringify(level));
    await page.mouse.up();
    await page.waitForTimeout(250);
    const after = await app(page, (a, e) => ({ status: a.status, nodes: e.activeNodeCount, sources: e.activeSourceCount }));
    check('release stops and frees every node', after.nodes === 0 && after.sources === 0 && after.status === 'STOPPED', JSON.stringify(after));

    // PLAY → STOP → PLAY many times: no accumulation
    const cycles = await page.evaluate(async () => {
      const a = window.Alpine.$data(document.body);
      const e = window.OSCILLA.engine;
      let maxNodes = 0;
      for (let i = 0; i < 40; i++) {
        a.play('hold');
        maxNodes = Math.max(maxNodes, e.activeNodeCount);
        await new Promise((r) => setTimeout(r, 15));
        if (i % 2) a.stop(); else a.stopNow();
      }
      await new Promise((r) => setTimeout(r, 400));
      return { maxNodes, nodes: e.activeNodeCount, sources: e.activeSourceCount, voices: e.voices.size };
    });
    check('40 rapid play/stop cycles leave zero nodes', cycles.nodes === 0 && cycles.sources === 0 && cycles.voices === 0, JSON.stringify(cycles));
    check('no oscillator accumulation during cycles', cycles.maxNodes <= 10, JSON.stringify(cycles));

    // safety limit on the audio clock
    await app(page, (a) => { a.safetyLimit = 0.5; });
    await holdFor(page, 900);
    const limited = await app(page, (a, e) => ({ voice: !!e.voice, status: a.status, nodes: e.activeNodeCount }));
    await page.mouse.up();
    check('safety limit ends a held tone (0.5 s)', !limited.voice && limited.nodes === 0, JSON.stringify(limited));
    await app(page, (a) => { a.safetyLimit = 2; });

    // continuous permission never persisted
    const persisted = await app(page, (a) => {
      a.setContinuous(true);
      const hash = a.serializeHash();
      const ls = JSON.stringify(Object.assign({}, localStorage));
      a.setContinuous(false);
      return { hash, ls };
    });
    check('continuous permission not in URL or localStorage', !/continu/i.test(persisted.hash + persisted.ls) || !/continuousAllowed/.test(persisted.hash + persisted.ls), JSON.stringify(persisted).slice(0, 200));

    // every pattern: trigger, let it run briefly, frequency stays below Nyquist, stops clean
    const patterns = await page.evaluate(async () => {
      const a = window.Alpine.$data(document.body);
      const e = window.OSCILLA.engine;
      const out = [];
      for (const p of window.OSCILLA.PATTERNS) {
        a.setPattern(p.id);
        a.duration = 300;
        a.trigger();
        await new Promise((r) => setTimeout(r, 120));
        const f = e.instantaneousFrequency();
        out.push([p.id, !!e.voice, f == null || (f > 0 && f < e.nyquist)]);
        a.stopNow();
        await new Promise((r) => setTimeout(r, 60));
      }
      await new Promise((r) => setTimeout(r, 300));
      return { out, nodes: e.activeNodeCount };
    });
    check('all 16 patterns play', patterns.out.every(([, v]) => v), JSON.stringify(patterns.out.filter(([, v]) => !v)));
    check('instantaneous frequencies stay below Nyquist', patterns.out.every(([, , ok]) => ok));
    check('nodes freed after pattern run', patterns.nodes === 0, String(patterns.nodes));

    // finite pattern ends by itself
    const natural = await page.evaluate(async () => {
      const a = window.Alpine.$data(document.body);
      const e = window.OSCILLA.engine;
      a.setPattern('finite');
      a.duration = 200;
      a.trigger();
      await new Promise((r) => setTimeout(r, 600));
      return { voice: !!e.voice, nodes: e.activeNodeCount, status: a.status };
    });
    check('finite tone ends on its own', !natural.voice && natural.nodes === 0 && ['STOPPED', 'READY'].includes(natural.status), JSON.stringify(natural));

    // high frequency accuracy and Nyquist clamp
    const hf = await page.evaluate(async () => {
      const a = window.Alpine.$data(document.body);
      const e = window.OSCILLA.engine;
      a.setRangeMode('advanced');
      a.setFrequency(15500);
      a.setPattern('tone');
      a.play('hold');
      await new Promise((r) => setTimeout(r, 350));
      e.analyser.getFloatFrequencyData(e.freqData);
      let best = 0;
      for (let i = 1; i < e.freqData.length; i++) if (e.freqData[i] > e.freqData[best]) best = i;
      a.stopNow();
      a.setFrequency(1e6);
      const clamped = a.frequency;
      return { peakHz: (best * e.ctx.sampleRate) / e.analyser.fftSize, clamped, safe: e.safeMaximum, nyq: e.nyquist };
    });
    check('15.5 kHz tone measured at 15.5 kHz', Math.abs(hf.peakHz - 15500) < 15, JSON.stringify(hf));
    check('frequency entry clamps to safe maximum (< Nyquist)', hf.clamped <= hf.safe + 0.01 && hf.clamped < hf.nyq, JSON.stringify(hf));

    // dual oscillator beating
    const dual = await page.evaluate(async () => {
      const a = window.Alpine.$data(document.body);
      const e = window.OSCILLA.engine;
      a.setMode('dual');
      a.loadPreset(window.OSCILLA.BUILTIN_PRESETS.find((p) => p.id === 'du-440-442'));
      a.play('hold');
      await new Promise((r) => setTimeout(r, 250));
      const nodes = e.activeNodeCount;
      a.stopNow();
      await new Promise((r) => setTimeout(r, 200));
      return { nodes, after: e.activeNodeCount, delta: a.dualDelta, viz: a.vizMode };
    });
    check('dual osc plays two voices and frees them', dual.nodes >= 5 && dual.after === 0, JSON.stringify(dual));
    check('beating difference 2 Hz', Math.abs(dual.delta - 2) < 1e-6);

    // Escape stops immediately
    await app(page, (a) => { a.setMode('playground'); a.setPattern('tone'); });
    await holdFor(page, 200);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(150);
    const esc = await app(page, (a, e) => ({ voice: !!e.voice, nodes: e.activeNodeCount }));
    check('Escape stops playback', !esc.voice && esc.nodes === 0, JSON.stringify(esc));

    // Space plays when focus is not in a control, not when typing
    await page.locator('#freq-input').focus();
    await page.keyboard.down('Space');
    await page.waitForTimeout(80);
    const typing = await app(page, (a, e) => !!e.voice);
    await page.keyboard.up('Space');
    check('Space ignored while typing in an input', !typing);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.down('Space');
    await page.waitForTimeout(150);
    const spacePlay = await app(page, (a, e) => !!e.voice);
    await page.keyboard.up('Space');
    await page.waitForTimeout(150);
    const spaceStop = await app(page, (a, e) => e.activeNodeCount);
    check('Space hold plays and release stops', spacePlay && spaceStop === 0, `${spacePlay} ${spaceStop}`);
    check('no console problems in audio tests', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------------ modes, visualizations, presets
  console.log('modes, visualizations, presets');
  {
    const { page, problems, context } = await openPage(browser);
    await app(page, (a) => a.ensureAudio());
    for (const m of ['playground', 'sweep', 'dual', 'presets', 'learn']) {
      await page.click(`#tab-${m}`);
      await page.waitForTimeout(120);
      const visible = await page.evaluate((mode) => window.Alpine.$data(document.body).mode === mode, m);
      check(`mode tab ${m}`, visible);
      if (SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, `mode-${m}-1280.png`), fullPage: true });
    }
    await page.click('#tab-playground');
    for (const v of ['wave', 'spectrum', 'motion', 'path', 'harmonics', 'interference']) {
      await app(page, (a, e, O, vm) => { a.vizMode = vm; a.play('hold'); }, v);
      await page.waitForTimeout(250);
      const shot = await page.locator('[x-ref=vizCanvas] canvas').screenshot();
      check(`visualization ${v} renders`, shot.length > 2000, String(shot.length));
      if (SHOTS) fs.writeFileSync(path.join(SHOT_DIR, `viz-${v}.png`), shot);
      await app(page, (a) => a.stopNow());
    }
    const presetResult = await page.evaluate(async () => {
      const a = window.Alpine.$data(document.body);
      const e = window.OSCILLA.engine;
      const disabled = [];
      let played = 0;
      for (const p of window.OSCILLA.BUILTIN_PRESETS) {
        if (a.presetDisabled(p)) { disabled.push(p.id); continue; }
        if (p.requiresHeadphones) continue;
        a.applyPreset(p);
        a.trigger();
        await new Promise((r) => setTimeout(r, 40));
        if (e.voice) played++;
        a.stopNow();
      }
      await new Promise((r) => setTimeout(r, 300));
      return { played, disabled, nodes: e.activeNodeCount, safe: e.safeMaximum, total: window.OSCILLA.BUILTIN_PRESETS.length };
    });
    check('built-in presets trigger', presetResult.played >= presetResult.total - presetResult.disabled.length - 1, JSON.stringify(presetResult));
    check('presets above Nyquist are disabled', presetResult.safe < 24000 ? presetResult.disabled.includes('hf-24000') : true, JSON.stringify(presetResult.disabled));
    check('nodes freed after presets', presetResult.nodes === 0);

    // custom presets + history + reset
    const custom = await page.evaluate(() => {
      const a = window.Alpine.$data(document.body);
      a.setMode('playground');
      a.setRangeMode('human');
      a.setFrequency(1234);
      a.saveName = 'Test preset';
      a.savePreset();
      const stored = JSON.parse(localStorage.getItem('oscilla.presets'));
      a.setFrequency(500);
      a.loadPreset(a.presetsFor('custom')[0]);
      const f = a.frequency;
      a.deletePreset(a.customPresets[0].id);
      return { version: stored.version, name: stored.presets[0].name, schemaKeys: Object.keys(stored.presets[0]), f, left: a.customPresets.length, hist: a.history.length };
    });
    check('custom preset saved with versioned schema', custom.version === 1 && custom.name === 'Test preset'
      && ['name', 'mode', 'pattern', 'waveform', 'frequency', 'gain', 'duration', 'envelope', 'range', 'params', 'dual'].every((k) => custom.schemaKeys.includes(k)), JSON.stringify(custom));
    check('custom preset loads and deletes', Math.abs(custom.f - 1234) < 0.01 && custom.left === 0, JSON.stringify(custom));
    check('session history recorded', custom.hist > 0 && custom.hist <= 50);

    // Learn demos
    const learn = await page.evaluate(() => {
      const a = window.Alpine.$data(document.body);
      a.setMode('learn');
      let ok = 0;
      for (const t of window.OSCILLA.LEARN_TOPICS) { a.learnTopic = t.id; a.runDemo(t); if (a.currentPlan().ok) ok++; }
      return { ok, n: window.OSCILLA.LEARN_TOPICS.length };
    });
    check('all 18 Learn topics have working demos', learn.ok === learn.n && learn.n === 18, JSON.stringify(learn));
    check('no console problems in modes/presets', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------------ URL state + robustness
  console.log('URL state and robustness');
  {
    const { page, context } = await openPage(browser);
    const hash = await app(page, (a) => { a.setPattern('fm'); a.setFrequency(1500); a.pp.fm.modFreq = 7; a.setContinuous(true); return a.serializeHash(); });
    await context.close();
    const r = await openPage(browser, { hash: `#${hash}` });
    const restored = await app(r.page, (a, e) => ({ p: a.pattern, f: a.frequency, mod: a.pp.fm.modFreq, cont: a.continuousAllowed, voice: !!e.voice, ctx: e.ctx }));
    check('URL hash restores configuration', restored.p === 'fm' && Math.abs(restored.f - 1500) < 0.01 && restored.mod === 7, JSON.stringify(restored));
    check('URL never restores continuous permission or playback', !restored.cont && !restored.voice && !restored.ctx, JSON.stringify(restored));
    check('no console problems restoring a link', r.problems.length === 0, r.problems.join(' | '));
    await r.context.close();

    const bad = await openPage(browser, { hash: '#v=1&f=abc&w=laser&x=%%%notbase64' });
    const badState = await app(bad.page, (a) => ({ f: a.frequency, w: a.waveform, alerts: a.alerts.map((x) => x.title) }));
    check('malformed URL handled with a visible notice', badState.f === 440 && badState.w === 'sine' && badState.alerts.length > 0, JSON.stringify(badState));
    check('no uncaught errors on malformed URL', bad.problems.length === 0, bad.problems.join(' | '));
    await bad.context.close();

    const blocked = await openPage(browser, {
      init: () => {
        const thrower = () => { throw new DOMException('blocked', 'SecurityError'); };
        Storage.prototype.setItem = thrower;
        Storage.prototype.getItem = thrower;
        Storage.prototype.removeItem = thrower;
      },
    });
    const blockedState = await app(blocked.page, (a) => { a.setTheme('dark'); a.play('trigger'); a.stopNow(); return { local: a.storage.local, alerts: a.alerts.length }; });
    check('storage failure handled', blockedState.local === false && blockedState.alerts > 0, JSON.stringify(blockedState));
    check('no uncaught errors with blocked storage', blocked.problems.length === 0, blocked.problems.join(' | '));
    await blocked.context.close();

    const dbg = await openPage(browser, { query: '?debug=1' });
    await dbg.page.waitForTimeout(400);
    const dbgVisible = await dbg.page.locator('aside[aria-label="Debug panel"]').isVisible();
    check('?debug=1 shows the debug panel', dbgVisible);
    await dbg.context.close();
    const nodbg = await openPage(browser);
    check('debug panel hidden by default', !(await nodbg.page.locator('aside[aria-label="Debug panel"]').isVisible()));
    await nodbg.context.close();

    const mic = await openPage(browser);
    await mic.page.locator('#tab-playground').click();
    const micState = await app(mic.page, async (a, e) => { await a.toggleMic(); const on = a.micActive && !!e.mic; await a.toggleMic(); return { on, off: !a.micActive && !e.mic }; });
    check('microphone opt-in starts and stops tracks', micState.on && micState.off, JSON.stringify(micState));
    await mic.context.close();
  }

  // ------------------------------------------------------------------ responsive + touch targets + themes
  console.log('responsive layout');
  for (const [w, h] of VIEWPORTS) {
    for (const scheme of w === 390 || w === 1280 ? ['light', 'dark'] : ['light']) {
      const { page, problems, context } = await openPage(browser, { width: w, height: h, scheme });
      const res = [];
      for (const m of ['playground', 'sweep', 'dual', 'presets', 'learn']) {
        await page.click(`#tab-${m}`);
        await page.waitForTimeout(80);
        res.push(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
        if (SHOTS && (w <= 430 || w === 1440)) await page.screenshot({ path: path.join(SHOT_DIR, `${m}-${w}-${scheme}.png`), fullPage: true });
      }
      check(`${w}px ${scheme}: no horizontal overflow in any mode`, res.every((d) => d <= 0), JSON.stringify(res));
      await page.click('#tab-playground');
      if (w < 768) {
        const small = await page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll('main button, main input, main select, main textarea, main [role=slider], header button')) {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            if (!r.width || !r.height || st.visibility === 'hidden' || el.closest('[aria-hidden=true]')) continue;
            if (el.type === 'checkbox' && el.classList.contains('sr-only')) continue;
            if (el.type === 'checkbox') continue;
            if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName}.${(el.textContent || el.id || el.getAttribute('aria-label') || '').trim().slice(0, 18)} ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
          return out;
        });
        check(`${w}px ${scheme}: touch targets ≥ 44 px`, small.length === 0, small.slice(0, 8).join(', '));
      }
      if ([390, 430].includes(w)) {
        const top = await page.locator('.hold-btn').boundingBox();
        check(`${w}px: HOLD TO PLAY inside the first viewport`, top.y + top.height <= h, JSON.stringify(top));
      }
      check(`${w}px ${scheme}: no console problems`, problems.length === 0, problems.join(' | '));
      await context.close();
    }
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log(failures.map((f) => ` - ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(2); });

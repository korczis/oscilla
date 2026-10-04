#!/usr/bin/env node
// Post-deploy smoke against the PUBLIC site (needs the network, so it is not in release-gate;
// the Pages workflow runs it after the deployment is verified).
//
//   node tests/browser/live-smoke.cjs [--url https://korczis.github.io/oscilla/]
//     [--expect-version X.Y.Z] [--expect-commit <40-hex sha>] [--browsers chromium,firefox,webkit]
//
// Per browser, at 1536x1024:
//   boot           html[data-ready] set, no boot/lab error, no console error or page error
//   provenance     <script type="application/json" id="oscilla-build"> parses and has a version;
//                  window.OSCILLA.version === region.version (=== --expect-version if given);
//                  window.OSCILLA.build.commit === region.commit (=== --expect-commit if given)
//   status bar     reads "OSCILLA v<version>"
//   panels         every core panel is visible
//   hold           one real pointer press on HOLD produces output, release leaves 0 nodes
//   studio         STUDIO from the navigation; the Subtractive Synth opened from the template
//                  gallery renders 6 nodes and 5 cables; PLAY sounds, STOP leaves 0 engine,
//                  source and Studio runtime nodes (V3.1 public Studio smoke, plan V433)
//   measure        MEASURE from the navigation (V3 §230, plan V386): the guided flow renders
//                  (seven steps, "Check setup" enabled, Stop disabled, Frequency and Level
//                  indicators, result tabs, input panel); switched to TEST CONTEXT (the digital
//                  loopback of OSCILLA.measure.useLoopback, as the browser suites do) the setup
//                  check reaches READY with the TEST CONTEXT banner, and a reset leaves 0 engine,
//                  io nodes, sources, captures, ports and tracks
//   measurement sweep  the Measurement Sweep opened from the template gallery (V3.1 §270)
//                  renders its six nodes (Sweep, Master, Microphone and the Measurement nodes
//                  Calibration, Transfer Analyzer, Measurement Result) and 5 cables
//   no microphone  navigator.mediaDevices.getUserMedia is never called during the whole smoke
//                  (no permission prompt can block it; no physical microphone is needed)
// --url also takes a file:// URL of dist/index.html (a local dry run of the same checks).
// Firefox on a runner without a sound server needs the PulseAudio null sink (see ci.yml).
// Exit code 1 when any check fails in any browser.
'use strict';
const playwright = require('playwright');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const URL_ = arg('url', 'https://korczis.github.io/oscilla/');
const EXPECT_VERSION = arg('expect-version', '');
const EXPECT_COMMIT = arg('expect-commit', '');
const BROWSERS = arg('browsers', process.env.OSC_BROWSERS || 'chromium,firefox,webkit').split(',');
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } },
  webkit: {},
};
const PANELS = ['source', 'analysis', 'mic', 'device', 'spectrogram', 'sequencer', 'filter',
  'envelope', 'additive', 'phase', 'bio'].map((p) => `#osc-panel-${p}`);
// The Measurement Sweep template (src/js/studio/templates/measurement-sweep.js): node id -> the
// category label its card shows.
const SWEEP_NODES = { 'sweep-1': 'Source', 'master-1': 'Output', 'mic-1': 'Source',
  'cal-1': 'Measurement', 'transfer-1': 'Measurement', 'result-1': 'Measurement' };
// Short TEST CONTEXT recipe of the browser suites (tests/browser/v3-ui.cjs SHORT).
const SHORT = { duration: 1, repeats: 2, noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5,
  gapS: 0.2 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, test, ms) {
  const t0 = Date.now();
  let v = await fn();
  while (!test(v) && Date.now() - t0 < ms) {
    await sleep(40);
    v = await fn();
  }
  return v;
}

async function runOne(name) {
  const results = [];
  const check = (label, ok, detail) => results.push({ label, ok: !!ok, detail });
  const browser = await playwright[name].launch(LAUNCH[name]);
  try {
    const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // Count every microphone request: the smoke must never reach one (no prompt can block it).
    await page.addInitScript(() => {
      window.__oscGum = 0;
      const md = navigator.mediaDevices;
      if (md && md.getUserMedia) {
        const real = md.getUserMedia.bind(md);
        md.getUserMedia = (...a) => {
          window.__oscGum += 1;
          return real(...a);
        };
      }
    });
    const res = await page.goto(URL_, { waitUntil: 'load', timeout: 30000 });
    let ready = true;
    await page.waitForSelector('html[data-ready="true"]', { timeout: 20000 })
      .catch(() => { ready = false; });
    await sleep(500);
    const boot = await page.evaluate(() => ({
      osc: !!window.OSCILLA,
      labErrors: window.OSCILLA && window.OSCILLA.labErrors
        ? Object.keys(window.OSCILLA.labErrors) : [],
    }));
    // Firefox returns no response for a file:// navigation (a local dry run).
    const loaded = res ? res.ok() : URL_.startsWith('file:');
    check('boot', loaded && ready && boot.osc && !boot.labErrors.length,
      `http ${res && res.status()}, ready ${ready}, lab errors ${boot.labErrors.join(',') || 'none'}`);

    const prov = await page.evaluate(() => {
      const el = document.getElementById('oscilla-build');
      let region = null;
      let error = null;
      if (!el) error = 'no #oscilla-build region';
      else if (el.type !== 'application/json') error = `region type ${el.type}`;
      else {
        try { region = JSON.parse(el.textContent); } catch (e) { error = `invalid JSON: ${e.message}`; }
      }
      const b = window.OSCILLA && window.OSCILLA.build;
      return { region, error, version: window.OSCILLA && window.OSCILLA.version,
        build: b ? { version: b.version, commit: b.commit, channel: b.channel } : null };
    });
    const r = prov.region || {};
    check('provenance region parses', !prov.error && typeof r.version === 'string',
      prov.error || `version ${r.version}, channel ${r.channel}, commit ${r.commit}`);
    check('window.OSCILLA.version === region version'
      + (EXPECT_VERSION ? ` === ${EXPECT_VERSION}` : ''),
    prov.version && prov.version === r.version && (!EXPECT_VERSION || prov.version === EXPECT_VERSION),
    `runtime ${prov.version}, region ${r.version}`);
    check('window.OSCILLA.build.commit === region commit'
      + (EXPECT_COMMIT ? ` === ${EXPECT_COMMIT.slice(0, 7)}` : ''),
    prov.build && (prov.build.commit || null) === (r.commit || null)
      && (!EXPECT_COMMIT || prov.build.commit === EXPECT_COMMIT),
    `build ${prov.build ? prov.build.commit : 'missing window.OSCILLA.build'}, region ${r.commit}`);

    const sb = await page.evaluate(() => {
      const n = document.querySelector('.osc-statusbar .osc-sb-name');
      const v = document.querySelector('.osc-statusbar .osc-sb-version');
      return n && v ? `${n.textContent.trim()} ${v.textContent.trim()}` : null;
    });
    const want = `OSCILLA v${prov.version}`;
    check(`status bar reads "${want}"`, sb === want, `status bar "${sb}"`);

    const hidden = await page.evaluate((sels) => sels.filter((s) => {
      const el = document.querySelector(s);
      if (!el) return true;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return !(b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none');
    }), PANELS);
    check(`core panels visible (${PANELS.length})`, !hidden.length, hidden.join(', ') || 'all');

    const box = await page.locator('#osc-hold-play').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const playing = await until(() => page.evaluate(() => {
      const e = window.OSCILLA.engine;
      let pk = 0;
      if (e.analyser) {
        const d = new Float32Array(e.analyser.fftSize);
        e.analyser.getFloatTimeDomainData(d);
        for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
      }
      return { peak: pk, nodes: e.activeNodeCount, state: e.ctx && e.ctx.state };
    }), (v) => v.peak > 0.01 && v.nodes > 0, 3000);
    await page.mouse.up();
    const nodes = await until(() => page.evaluate(() => window.OSCILLA.engine.activeNodeCount),
      (n) => n === 0, 1500);
    check('HOLD press sounds, release leaves 0 nodes', playing.peak > 0.01 && playing.nodes > 0
      && nodes === 0, `peak ${playing.peak.toFixed(3)}, nodes while held ${playing.nodes}, `
      + `after ${nodes}, context ${playing.state}`);

    // MEASURE (V3 §230, plan V386): the workspace opens from the navigation and its guided flow
    // renders; the setup check runs in TEST CONTEXT (digital loopback, no microphone).
    await page.click('[data-osc="nav.measure"]');
    await page.waitForFunction(() => document.querySelector('#osc-app').dataset.mode === 'measure',
      null, { timeout: 5000 });
    await sleep(150);
    const mui = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const shown = (el) => !!el && el.getBoundingClientRect().width > 0
        && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden';
      const primary = q('#osc-measure-primary');
      const stop = q('#osc-measure-stop');
      return {
        view: shown(q('#osc-view-measure')),
        current: (q('[aria-current="page"]') || { dataset: {} }).dataset.osc,
        steps: [...document.querySelectorAll('[data-osc="measure.step"]')].filter(shown).length,
        primary: primary && shown(primary) ? primary.textContent.trim() : null,
        primaryEnabled: !!primary && !primary.disabled,
        stopDisabled: !!stop && shown(stop) && stop.disabled,
        indicators: ['freqIndicator', 'levelIndicator']
          .every((k) => shown(q(`[data-osc="measure.${k}"]`))),
        tabs: [...document.querySelectorAll('[data-osc="measure.tab"]')].filter(shown)
          .map((t) => t.dataset.value),
        input: shown(q('[data-osc="measure.inputFacts"]')),
        state: window.OSCILLA.measure.state,
      };
    });
    check('MEASURE opens; the guided flow and its controls render', mui.view
      && mui.current === 'nav.measure' && mui.steps === 7 && mui.primary === 'Check setup'
      && mui.primaryEnabled && mui.stopDisabled && mui.indicators && mui.tabs.length >= 3
      && mui.input && mui.state === 'IDLE',
    `view ${mui.view}, nav ${mui.current}, ${mui.steps} steps, primary "${mui.primary}" `
      + `${mui.primaryEnabled ? 'enabled' : 'disabled'}, stop disabled ${mui.stopDisabled}, `
      + `indicators ${mui.indicators}, tabs ${mui.tabs.join('/')}, input ${mui.input}, `
      + `state ${mui.state}`);
    const loop = await page.evaluate((values) => {
      const m = window.OSCILLA.measure;
      const ok = m.useLoopback();
      m.setValues(values);
      return ok;
    }, SHORT);
    const banner = await page.waitForSelector('[data-osc="measure.testContext"]',
      { state: 'visible', timeout: 3000 }).then(() => true, () => false);
    await page.click('#osc-measure-primary');
    await page.waitForFunction(() => ['READY', 'INVALID', 'ERROR']
      .includes(window.OSCILLA.measure.state), null, { timeout: 20000, polling: 50 })
      .catch(() => {});
    const setup = await page.evaluate(() => ({ state: window.OSCILLA.measure.state,
      kind: window.OSCILLA.measure.ioKind,
      primary: document.querySelector('#osc-measure-primary').textContent.trim() }));
    await page.evaluate(() => {
      const m = window.OSCILLA.measure;
      if (m.engine) m.engine.reset();
    });
    const zero = (c) => c.engineNodes === 0 && c.ioNodes === 0 && c.ioSources === 0
      && c.captures === 0 && c.ports === 0 && c.tracks === 0;
    const mc = await until(() => page.evaluate(() => window.OSCILLA.measure.counts()), zero, 3000);
    await page.evaluate(() => window.OSCILLA.measure.useMicrophone());
    check('MEASURE setup check in TEST CONTEXT reaches READY, reset leaves 0 nodes',
      loop && banner && setup.state === 'READY' && zero(mc),
    `loopback ${loop}, banner ${banner}, state ${setup.state} (io ${setup.kind}), primary `
      + `"${setup.primary}"; after reset: engine ${mc.engineNodes}, io ${mc.ioNodes}, sources `
      + `${mc.ioSources}, captures ${mc.captures}, ports ${mc.ports}, tracks ${mc.tracks}`);

    // STUDIO (V3.1, plan V433 §259): opened from the navigation, a template opened from the
    // gallery renders its graph, PLAY sounds through the Studio runtime, STOP leaves 0 nodes.
    await page.click('[data-osc="nav.studio"]');
    await page.waitForFunction(() => document.querySelector('#osc-app').dataset.mode === 'studio',
      null, { timeout: 5000 });
    await page.click('[data-osc="studio.templates"]');
    await page.click('[data-osc="studio.template.open"][data-template="subtractive-synth"]');
    const graph = await until(() => page.evaluate(() => ({
      nodes: document.querySelectorAll('#osc-view-studio .osc-sg-node').length,
      cables: document.querySelectorAll('#osc-view-studio .osc-sg-edge-line').length,
      title: (document.querySelector('[data-osc="studio.title"]') || {}).textContent || '',
      dialog: !!document.querySelector('dialog[open]') })),
    (v) => v.nodes === 6 && !v.dialog, 5000);
    check('STUDIO opens; the Subtractive Synth template renders 6 nodes, 5 cables',
      graph.nodes === 6 && graph.cables === 5 && graph.title === 'Subtractive Synth',
      `${graph.nodes} nodes, ${graph.cables} cables, "${graph.title}"`);
    await page.click('[data-osc="studio.play"]');
    const sounding = await until(() => page.evaluate(() => {
      const e = window.OSCILLA.engine;
      let pk = 0;
      if (e.analyser) {
        const d = new Float32Array(e.analyser.fftSize);
        e.analyser.getFloatTimeDomainData(d);
        for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
      }
      return { peak: pk, ...window.OSCILLA.studio.counts() };
    }), (v) => v.playing && v.runtimeNodes > 0 && v.peak > 0.005, 3000);
    await page.click('[data-osc="studio.stop"]');
    const released = await until(() => page.evaluate(() => window.OSCILLA.studio.counts()),
      (c) => !c.playing && c.engineNodes === 0 && c.engineSources === 0 && c.runtimeNodes === 0,
      3000);
    check('Studio PLAY sounds, STOP leaves 0 nodes', sounding.playing && sounding.peak > 0.005
      && released.engineNodes === 0 && released.engineSources === 0 && released.runtimeNodes === 0,
      `peak ${sounding.peak.toFixed(3)}, runtime nodes while playing ${sounding.runtimeNodes}; `
      + `after: engine ${released.engineNodes}, sources ${released.engineSources}, runtime `
      + `${released.runtimeNodes}`);

    // The Measurement Sweep template (V3.1 §270): opened from the gallery, its measurement
    // nodes render; nothing asks for the microphone (the Microphone node stays unavailable).
    await page.click('[data-osc="studio.templates"]');
    await page.click('[data-osc="studio.template.open"][data-template="measurement-sweep"]');
    const sweep = await until(() => page.evaluate(() => ({
      nodes: [...document.querySelectorAll('#osc-view-studio .osc-sg-node')].map((n) => ({
        id: n.dataset.nodeId,
        title: (n.querySelector('.osc-sg-title') || {}).textContent || '',
        cat: (n.querySelector('.osc-sg-cat') || {}).textContent || '',
        shown: n.getBoundingClientRect().width > 0 })),
      cables: document.querySelectorAll('#osc-view-studio .osc-sg-edge-line').length,
      title: (document.querySelector('[data-osc="studio.title"]') || {}).textContent || '',
      dialog: !!document.querySelector('dialog[open]') })),
    (v) => v.nodes.length === 6 && v.title === 'Measurement Sweep' && !v.dialog, 5000);
    const sweepIds = Object.keys(SWEEP_NODES);
    const ids = sweep.nodes.map((n) => n.id);
    check('the Measurement Sweep template renders its 6 nodes and 5 cables',
      sweep.title === 'Measurement Sweep' && ids.length === sweepIds.length
      && sweep.nodes.every((n) => n.shown && n.title && SWEEP_NODES[n.id] === n.cat)
      && sweep.cables === 5,
    `"${sweep.title}": ${sweep.nodes.map((n) => `${n.title} [${n.cat}]`).join(', ')}; `
      + `${sweep.cables} cables`);

    const gum = await page.evaluate(() => window.__oscGum);
    check('no microphone request (getUserMedia never called)', gum === 0, `${gum} call(s)`);

    check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | ') || 'none');
  } catch (e) {
    check('smoke ran to completion', false, String(e.message || e).split('\n')[0]);
  } finally {
    await browser.close();
  }
  return results;
}

(async () => {
  console.log(`live smoke ${URL_}${EXPECT_VERSION ? ` expect v${EXPECT_VERSION}` : ''}`
    + `${EXPECT_COMMIT ? ` @ ${EXPECT_COMMIT.slice(0, 7)}` : ''}`);
  let failed = 0;
  for (const b of BROWSERS) {
    const t0 = Date.now();
    const results = await runOne(b);
    const bad = results.filter((r) => !r.ok);
    failed += bad.length;
    console.log(`${bad.length ? 'FAIL' : 'PASS'} ${b}/live: ${results.length - bad.length}/`
      + `${results.length} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    for (const r of results) console.log(`   ${r.ok ? 'ok' : 'x '} ${r.label}: ${r.detail}`);
  }
  process.exit(failed ? 1 : 0);
})();

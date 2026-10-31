#!/usr/bin/env node
// OSCILLA first-screen entry-path inventory (plan P002, intent first-run-experience,
// critique deep-links-have-no-inventory) on the built dist/index.html in chromium, firefox and
// webkit, from file:// and from the GitHub Pages sub-path (http://127.0.0.1:<port>/oscilla/),
// every check on both.
//
//   node tests/browser/first-screen.cjs [--browsers chromium,firefox,webkit]
//        [--origins file,http] [--only name1,name2]   (or OSC_BROWSERS / OSC_ORIGINS)
//
// It records every way a visitor reaches the first screen, as it is before P002 changes the
// layout (Q004 option A), so that "every deep link resolves as before" is decidable: the same
// table has to pass unchanged after the layout change. It judges where an entry lands and what
// it restores, never where a panel sits.
//
// Checks (asserted, one per table row or path):
//   load:<id>       a fresh page opened at each ENTRIES address (the hash dispatcher of ADR 0045,
//                   the URL state keys of src/js/core/url-state*.js, among them `m` with the V1
//                   mode ids playground, sweep, dual, presets and learn, and the query flags
//                   ?mock=1, ?debug=1 and ?measure=loopback) opens the workspace the row names,
//                   the nav marks it, the address is the one the row names, the row's own state
//                   is restored, and nothing sounds (instrument, engine and Studio at rest)
//   link:<id>       the same hash set in a live Playground page (a link followed in the page)
//                   opens the same workspace with the same state; when the workspace changes,
//                   focus lands on a heading and Back returns to the Playground
//   direct-path     the bare address (and /oscilla/index.html over http) opens the Playground
//                   with HOLD TO PLAY and TRIGGER enabled in the first 1536x1024 viewport, the
//                   compact Studio shown and nothing sounding; at 390x844 the same address
//                   opens the Playground with both controls rendered
//   studio-widget   the Playground's Studio widget loads the ONE Studio document: its title, its
//                   signal path chips and its clip chips are the model's (claim compact-sync)
//   compact-studio  the compact Studio offers Play, Stop and Expand Studio; Expand opens STUDIO
//                   on the same document with focus in the graph, and Studio's Back returns to
//                   the Playground with focus on Expand Studio
//   skip-link       the first Tab stop of a fresh page (Option+Tab in WebKit, which tabs only
//                   to form fields without it) is the skip link, shown while focused;
//                   Enter moves focus to the main region with no history entry, and the
//                   workspace and the address stay as they were
//   first-play      the first press of HOLD TO PLAY on a fresh page sounds and its release
//                   leaves 0 engine nodes; the first TRIGGER on a fresh page sounds and ends by
//                   itself at 0 nodes; the compact Studio's Play sounds and its Stop leaves 0
//                   engine, source and runtime nodes
//   no-console-errors
//
// The first screen Q004 chose (option A: the Playground, lighter, with the measurement in view,
// no guided path; docs/first-screen-options.md section 5; claim first-screen-layout), on a
// first visit (fresh storage, the listening safety notice shown):
//   layout desktop  at 1536x1024 the h1 is the Q002 sentence, shown above every panel; the
//                   Playground shows exactly Source & Pattern, Signal analysis, Microphone
//                   Analyzer and Device & Limits side by side in that order, under them the
//                   Guided measurement row across the full width (seven steps, Check setup
//                   enabled, Frequency and Level UNCALIBRATED) entirely in the viewport, and
//                   under it the Pattern Sequencer with the compact Studio beside it, the
//                   compact Studio starting in the viewport with its whole signal path in view
//                   (no node behind a scroll); the Spectrogram panel, Filter Lab,
//                   Envelope, Additive Synthesis, Phase & Stereo, Bioacoustics and the other
//                   MEASURE panels are not shown, nor anything else (no guided path)
//   layout phone    at 390x844 (a phone: isMobile, hasTouch) the same order top to bottom: the
//                   sentence, Source & Pattern, Signal analysis, Guided measurement, the compact
//                   Studio; the six frequency steps and Mode folded behind Source & Pattern's
//                   own disclosures (open at 1536x1024, their summaries unseen), the steps shown
//                   once their summary is pressed; the measurement steps folded to the current
//                   one
//   layout primary  Check setup pressed on the Playground (?measure=loopback, TEST CONTEXT, so
//                   no microphone is asked for) opens MEASURE (#m=measure) with focus still on
//                   the button (WebKit: on the MEASURE view holding it), and the setup check
//                   runs there to READY
//   layout others   the rest of the product is where it was: MEASURE shows its seven panels
//                   with the sentence visually hidden, the Analyzer shows the Spectrogram panel,
//                   Synthesis the Envelope and Filter Lab the filter
//   layout widths   at 1280x800 and 1440x900, and at 1366x1024 under touch (a coarse pointer
//                   where the engine emulates one), no control of the first row's panels ends
//                   below its panel or under the measurement row, the compact Studio's signal
//                   path is in view whole, and HOLD TO PLAY, TRIGGER,
//                   Gain and the analysis scale and range controls take a press at their centre
//
// Waits are condition polls through lib/wait.cjs with a named wall-clock deadline (rule
// project.bounded-test-timing); the run goes through lib/suite.cjs (project.suite-harness).
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
const RUN = suite.open({ name: 'first-screen', browsers: arg('browsers'),
  origins: arg('origins'), defaultOrigins: ['file', 'http'] });
const playwright = RUN.playwright;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const want = (name) => !ONLY || ONLY.has(name);
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0,
    'media.autoplay.blocking_policy': 0, 'media.autoplay.block-webaudio': false } },
  webkit: {},
};

const READY_MS = 30000;
const NAV_MS = 10000;
const SOUND_MS = 5000;
const CHECK_MS = 180000;
const DESKTOP = { width: 1536, height: 1024 };
const PHONE = { width: 390, height: 844 };

// ------------------------------------------------------------------------------ the inventory
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// A MEASURE recipe as a link writes it (core/url-state-measure.js wire keys: d duration, n runs,
// nc noise check, pr pre-roll, po post-roll, g gap), built here so the format is under test.
const RECIPE = { duration: 1, repeats: 2, noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5,
  gapS: 0.2 };
const MR = b64({ v: 1, d: RECIPE.duration, n: RECIPE.repeats, nc: RECIPE.noiseCheckS,
  pr: RECIPE.preRollS, po: RECIPE.postRollS, g: RECIPE.gapS });
const recipeLoaded = (s) => Object.keys(RECIPE).every((k) => s.meas[k] === RECIPE[k]);
// An instrument link as core/url-state.js serializeHash writes it (v=1, m s p w f g d a r rm x).
const TONE = 'v=1&m=playground&s=single&p=tone&w=square&f=1000&g=0.05&d=300&a=10&r=30&rm=human';
const TEMPLATES = {
  'basic-tone': 'Basic Tone', 'subtractive-synth': 'Subtractive Synth',
  'sweep-sequence': 'Sweep Sequence', 'stereo-beat': 'Stereo Beat',
  'filter-automation': 'Filter Automation', 'measurement-sweep': 'Measurement Sweep',
};
const WORKSPACES = ['playground', 'measure', 'experiments', 'analyzer', 'filter', 'compare',
  'synthesis', 'sequencer', 'presets', 'learn', 'studio', 'about'];
const said = (s, re) => s.alerts.some((a) => re.test(a));

// One row per entry path. `hash` without '#'; `search` with '?'. `address` is location.hash
// after the load (default: the hash as given). `state` judges the row's own restored state.
// `link: false` keeps a row out of the in-page link pass (a query flag is not a link).
const ENTRIES = [
  { id: 'bare', hash: '', workspace: 'playground',
    state: (s) => s.source === 'single' && s.waveform === 'sine' && s.frequency === 440 },
  ...WORKSPACES.map((w) => ({ id: `m=${w}`, hash: `m=${w}`, workspace: w })),
  // V1 mode ids in `m` (APP_MODES): playground and presets and learn are workspaces too.
  { id: 'v1 m=sweep', hash: 'm=sweep', workspace: 'playground' },
  { id: 'v1 m=dual', hash: 'm=dual', workspace: 'synthesis' },
  { id: 'instrument tone', hash: TONE, workspace: 'playground',
    state: (s) => s.source === 'single' && s.waveform === 'square' && s.frequency === 1000
      && s.gain === 0.05 && s.duration === 300
      && said(s, /^info: Configuration restored from link: /) },
  { id: 'instrument bare f', hash: 'v=1&f=1234', workspace: 'playground',
    state: (s) => s.frequency === 1234 },
  { id: 'instrument sweep', hash: 'v=1&m=sweep&s=sweep&f=440', workspace: 'playground',
    state: (s) => s.source === 'sweep' },
  { id: 'instrument dual', hash: 'v=1&m=dual&s=dual&f=440', workspace: 'synthesis',
    state: (s) => s.source === 'dual' },
  { id: 'instrument presets', hash: 'v=1&m=presets&f=440', workspace: 'presets' },
  { id: 'instrument learn', hash: 'v=1&m=learn&f=440', workspace: 'learn' },
  { id: 'instrument gain capped', hash: 'v=1&m=playground&f=440&g=0.5', workspace: 'playground',
    state: (s) => s.gain === 0.08 && said(s, /^info: Gain kept at the default: /) },
  { id: 'instrument extras a4', hash: `v=1&m=playground&f=440&x=${b64({ a4: 432 })}`,
    workspace: 'playground', state: (s) => s.a4 === 432 },
  { id: 'measure recipe', hash: `mr=${MR}`, workspace: 'measure', state: recipeLoaded },
  { id: 'm=measure recipe', hash: `m=measure&mr=${MR}`, workspace: 'measure',
    state: recipeLoaded },
  { id: 'm=learn recipe', hash: `m=learn&mr=${MR}`, workspace: 'learn', state: recipeLoaded },
  ...Object.entries(TEMPLATES).map(([id, title]) => ({ id: `studio st=${id}`,
    hash: `m=studio&st=${id}`, workspace: 'studio',
    state: (s) => s.template === id && s.studioTitle === title && !s.dirty
      && said(s, /^info: Studio opened from the link: /) })),
  ...['graph', 'timeline', 'inspector'].map((v) => ({ id: `studio sv=${v}`,
    hash: `m=studio&sv=${v}`, workspace: 'studio', state: (s) => s.subview === v })),
  { id: 'studio st+sv', hash: 'm=studio&st=filter-automation&sv=timeline', workspace: 'studio',
    state: (s) => s.template === 'filter-automation' && s.subview === 'timeline' },
  { id: 'studio + recipe', hash: `m=studio&mr=${MR}`, workspace: 'studio', state: recipeLoaded },
  // A record this browser does not store: Experiments says so and the address drops the key.
  ...['exp', 'def', 'finding'].map((k) => ({ id: `record ${k} missing`,
    hash: `m=experiments&${k}=not-stored-${k}`, workspace: 'experiments',
    address: '#m=experiments', linkAddress: null,
    state: (s) => said(s, / not found/) })),
  { id: 'record exp without m', hash: 'exp=not-stored-2', workspace: 'experiments',
    address: '#m=experiments', linkAddress: null },
  // An in-page anchor is not a route: the first screen opens and the fragment stays.
  { id: 'anchor osc-main', hash: 'osc-main', workspace: 'playground', link: false },
  // Query flags (src/js/ui/app.js applyMockFlag, src/js/main.js debug, ui/measure.js TEST
  // CONTEXT, README "TEST CONTEXT" and "Recipe link").
  { id: '?mock=1', search: '?mock=1', hash: '', workspace: 'playground', link: false,
    state: (s) => s.mock },
  { id: '?debug=1', search: '?debug=1', hash: '', workspace: 'playground', link: false,
    state: (s) => s.debugPanel },
  { id: '?measure=loopback recipe', search: '?measure=loopback', hash: `mr=${MR}`,
    workspace: 'measure', link: false,
    state: (s) => s.testContext && s.measState === 'IDLE' && recipeLoaded(s) },
];

let failures = 0;
let passes = 0;
function check(leg, name, ok, detail = '') {
  RUN.tally(leg);
  if (ok) passes += 1; else failures += 1;
  const tail = !ok && detail ? ` — ${String(detail).slice(0, 1600)}` : '';
  console.log(`  ${ok ? 'PASS' : 'FAIL'} [${leg}] ${name}${tail}`);
}

// ------------------------------------------------------------------------------ page helpers
const H = {
  urlOf(base, search = '', hash = '') {
    const u = new URL(base);
    u.search = search;
    u.hash = hash ? `#${hash}` : '';
    return u.href;
  },
  async ready(page) {
    await page.waitForSelector('html[data-ready="true"]', { timeout: READY_MS });
    await until(() => page.evaluate(() => !!(window.OSCILLA.app && window.OSCILLA.app.studio
      && window.OSCILLA.app.studio.ready)), { ms: READY_MS, what: 'Studio ready' });
  },
  async open(context, url) {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: READY_MS });
    await H.ready(page);
    return page;
  },
  state: (page) => page.evaluate(() => {
    const a = window.OSCILLA.app;
    const st = window.OSCILLA.studio;
    const c = st.counts();
    const e = window.OSCILLA.engine;
    const shown = (el) => !!el && el.getClientRects().length > 0
      && getComputedStyle(el).visibility !== 'hidden';
    const cur = document.querySelector('.osc-nav [aria-current="page"]');
    const f = document.activeElement;
    const mv = (a.meas && a.meas.values) || {};
    return {
      workspace: a.workspace, dataMode: document.querySelector('#osc-app').dataset.mode,
      current: cur ? cur.dataset.osc : null, hash: location.hash, search: location.search,
      histLen: history.length,
      source: a.source, waveform: a.waveform, frequency: a.frequency, gain: a.gainLevel,
      duration: a.duration, a4: a.a4,
      template: st.templateId, studioTitle: a.studio.title, subview: a.studio.subview,
      dirty: st.dirty,
      meas: { duration: mv.duration, repeats: mv.repeats, noiseCheckS: mv.noiseCheckS,
        preRollS: mv.preRollS, postRollS: mv.postRollS, gapS: mv.gapS },
      measState: window.OSCILLA.measure && window.OSCILLA.measure.state,
      testContext: shown(document.querySelector('[data-osc="measure.testContext"]')),
      mock: document.documentElement.classList.contains('osc-mock'),
      debugPanel: shown(document.querySelector('[data-osc="debug.panel"]')),
      alerts: [...new Set([...a.alerts.map((x) => `${x.level}: ${x.title}: ${x.message}`),
        ...(window.__oscSaid || [])])],
      silent: !a.playing && !a.studio.playing && !c.playing && e.activeNodeCount === 0
        && c.engineNodes === 0 && c.engineSources === 0 && c.runtimeNodes === 0,
      focusHeading: !!f && /^H[1-4]$/.test(f.tagName),
      focus: f ? `${f.tagName}${f.id ? `#${f.id}` : ''}`
        + `${f.dataset && f.dataset.osc ? `[${f.dataset.osc}]` : ''}` : null,
    };
  }),
  /** The engine's output peak and its node count (the instrument and Studio share it). */
  sound: (page) => page.evaluate(() => {
    const e = window.OSCILLA.engine;
    let pk = 0;
    if (e.analyser) {
      const d = new Float32Array(e.analyser.fftSize);
      e.analyser.getFloatTimeDomainData(d);
      for (let i = 0; i < d.length; i += 1) pk = Math.max(pk, Math.abs(d[i]));
    }
    const c = window.OSCILLA.studio.counts();
    return { peak: pk, nodes: e.activeNodeCount, playing: !!window.OSCILLA.app.playing,
      studioPlaying: !!c.playing, engineNodes: c.engineNodes, engineSources: c.engineSources,
      runtimeNodes: c.runtimeNodes };
  }),
  /** Where the row lands: the workspace, its nav item and its own state; null until then. */
  landed(s, row) {
    return s.workspace === row.workspace && s.dataMode === row.workspace
      && s.current === `nav.${row.workspace}` && (!row.state || row.state(s));
  },
  verdict(s, row, address) {
    const wrong = [];
    if (s.workspace !== row.workspace) wrong.push(`workspace ${s.workspace}`);
    if (s.current !== `nav.${row.workspace}`) wrong.push(`aria-current ${s.current}`);
    if (row.state && !row.state(s)) wrong.push('row state not restored');
    if (address !== null && s.hash !== address) wrong.push(`address ${s.hash} (want ${address})`);
    if (!s.silent) wrong.push('something sounds');
    return wrong;
  },
  brief: (s) => JSON.stringify({ workspace: s.workspace, hash: s.hash, source: s.source,
    waveform: s.waveform, frequency: s.frequency, gain: s.gain, a4: s.a4,
    template: s.template, subview: s.subview, meas: s.meas, testContext: s.testContext,
    mock: s.mock, debug: s.debugPanel, alerts: s.alerts.slice(-3), focus: s.focus }),
  inViewport: (page, sel) => page.evaluate((q) => {
    const el = document.querySelector(q);
    if (!el) return { sel: q, missing: true };
    const r = el.getBoundingClientRect();
    return { sel: q, rendered: r.width > 0 && r.height > 0, enabled: !el.disabled,
      inView: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight
        && r.right <= window.innerWidth };
  }, sel),
  compact: (page) => page.evaluate(() => {
    const host = document.querySelector('[data-osc="studio.compact"]');
    const shown = (el) => !!el && el.getClientRects().length > 0
      && getComputedStyle(el).visibility !== 'hidden';
    const m = window.OSCILLA.studio.model;
    const ids = (sel, key) => (host ? [...host.querySelectorAll(sel)] : []).filter(shown)
      .map((b) => b.dataset[key]);
    const t = host && host.querySelector('[data-osc="studio.compact.title"]');
    return {
      shown: shown(host), title: t ? t.textContent.trim() : '', modelTitle: m.metadata.title,
      chips: ids('[data-osc="studio.compact.node"]', 'nodeId'),
      nodes: m.graph.nodes.map((n) => n.id),
      clipChips: ids('[data-osc="studio.compact.clip"]', 'clipId'),
      clips: m.timeline.clips.map((c) => c.id),
      controls: ['play', 'stop', 'expand'].filter((k) => shown(host
        && host.querySelector(`[data-osc="studio.compact.${k}"]`))),
    };
  }),
};
// What the page told the visitor: every notification it rendered, kept after the toast expires
// (info toasts leave after 6 s, which a loaded machine can spend before the first poll).
function recordNotices() {
  window.__oscSaid = [];
  const scan = () => {
    for (const t of document.querySelectorAll('[data-osc="alert"]')) {
      const level = (t.className.match(/osc-toast--(\w+)/) || [])[1] || '';
      const title = t.querySelector('strong');
      const msg = t.querySelector('span');
      if (!title || !title.textContent) continue;
      const text = `${level}: ${title.textContent}: ${msg ? msg.textContent : ''}`;
      if (!window.__oscSaid.includes(text)) window.__oscSaid.push(text);
    }
  };
  new MutationObserver(scan).observe(document, { subtree: true, childList: true,
    characterData: true });
}
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

// ------------------------------------------------------------------------------ checks
async function entryLoad(ctx) {
  for (const row of ENTRIES) {
    const name = `load:${row.id}`;
    if (!want('load') && !want(name)) continue;
    let page = null;
    try {
      page = await H.open(ctx.context, H.urlOf(ctx.base, row.search, row.hash));
      const s = await until(async () => {
        const st = await H.state(page);
        return H.landed(st, row) ? st : null;
      }, { ms: NAV_MS, what: `${name} lands on ${row.workspace}` })
        .catch(() => H.state(page));
      const address = row.address !== undefined ? row.address : (row.hash ? `#${row.hash}` : '');
      const wrong = H.verdict(s, row, address);
      if (row.search && s.search !== row.search) wrong.push(`query ${s.search}`);
      check(ctx.leg, name, !wrong.length, `${wrong.join('; ')} :: ${H.brief(s)}`);
    } catch (err) {
      check(ctx.leg, name, false, String(err && err.message).split('\n')[0]);
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }
}

async function entryLink(ctx) {
  const rows = ENTRIES.filter((r) => r.hash && r.link !== false);
  const page = await H.open(ctx.context, ctx.base);
  try {
    for (const row of rows) {
      const name = `link:${row.id}`;
      if (!want('link') && !want(name)) continue;
      try {
        await page.evaluate(() => {
          const a = window.OSCILLA.app;
          a.alerts = [];
          window.__oscSaid = [];
          a.setWorkspace('playground');
        });
        await until(async () => (await H.state(page)).workspace === 'playground',
          { ms: NAV_MS, what: `${name}: back on the Playground first` });
        await page.evaluate((h) => { location.hash = h; }, row.hash);
        const s = await until(async () => {
          const st = await H.state(page);
          return H.landed(st, row) ? st : null;
        }, { ms: NAV_MS, what: `${name} lands on ${row.workspace}` })
          .catch(() => H.state(page));
        const address = row.linkAddress !== undefined ? row.linkAddress : null;
        const wrong = H.verdict(s, row, address);
        if (!wrong.length && row.workspace !== 'playground') {
          // The heading takes focus on the next tick (app.js focusWorkspaceHeading).
          const f = await until(async () => (await H.state(page)).focusHeading,
            { ms: NAV_MS, what: `${name} focuses the ${row.workspace} heading` })
            .catch(() => false);
          if (!f) wrong.push(`focus on ${(await H.state(page)).focus}, not a heading`);
          const before = await page.evaluate(() => location.href);
          await page.evaluate(() => history.back());
          const back = await until(async () => {
            const st = await H.state(page);
            return st.workspace === 'playground' ? st : null;
          }, { ms: NAV_MS, what: `${name}: Back returns to the Playground` })
            .catch(() => null);
          if (!back) {
            wrong.push(`Back from ${before} -> ${(await H.state(page)).workspace}`);
          }
        }
        check(ctx.leg, name, !wrong.length, `${wrong.join('; ')} :: ${H.brief(s)}`);
      } catch (err) {
        check(ctx.leg, name, false, String(err && err.message).split('\n')[0]);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }
}

async function directPath(ctx) {
  const urls = [ctx.base];
  if (ctx.origin === 'http') urls.push(new URL('index.html', ctx.base).href);
  for (const url of urls) {
    const page = await H.open(ctx.context, url);
    try {
      const s = await H.state(page);
      const ctl = [];
      for (const sel of ['#osc-hold-play', '#osc-trigger']) ctl.push(await H.inViewport(page, sel));
      const c = await H.compact(page);
      const wrong = H.verdict(s, { workspace: 'playground' }, '');
      const badCtl = ctl.filter((x) => x.missing || !x.rendered || !x.enabled || !x.inView);
      if (badCtl.length) wrong.push(`controls ${JSON.stringify(badCtl)}`);
      if (!c.shown) wrong.push('compact Studio not shown');
      check(ctx.leg, `direct-path ${new URL(url).pathname.replace(/^.*\//, '/') || '/'}`
        + ' opens the Playground with HOLD TO PLAY and TRIGGER in view', !wrong.length,
      `${wrong.join('; ')} :: ${H.brief(s)}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
  const phone = await ctx.browser.newContext({ viewport: PHONE });
  await phone.addInitScript(recordNotices);
  ctx.watch(phone);
  try {
    const page = await H.open(phone, ctx.base);
    const s = await H.state(page);
    const ctl = [];
    for (const sel of ['#osc-hold-play', '#osc-trigger']) ctl.push(await H.inViewport(page, sel));
    const wrong = H.verdict(s, { workspace: 'playground' }, '');
    const badCtl = ctl.filter((x) => x.missing || !x.rendered || !x.enabled);
    if (badCtl.length) wrong.push(`controls ${JSON.stringify(badCtl)}`);
    check(ctx.leg, 'direct-path at 390x844 opens the Playground with HOLD TO PLAY and TRIGGER',
      !wrong.length, `${wrong.join('; ')} :: ${H.brief(s)}`);
  } finally {
    await phone.close().catch(() => {});
  }
}

async function studioWidget(ctx) {
  const page = await H.open(ctx.context, ctx.base);
  try {
    const ok = (c) => c.shown && c.nodes.length > 0 && c.title === c.modelTitle
      && sameSet(c.chips, c.nodes) && sameSet(c.clipChips, c.clips);
    const c = await until(async () => {
      const v = await H.compact(page);
      return ok(v) ? v : null;
    }, { ms: NAV_MS, what: 'the Studio widget shows the Studio document' })
      .catch(() => H.compact(page));
    check(ctx.leg, 'studio-widget loads the one Studio document (title, nodes, clips)', ok(c),
      JSON.stringify(c));
  } finally {
    await page.close().catch(() => {});
  }
}

async function compactStudio(ctx) {
  const page = await H.open(ctx.context, ctx.base);
  try {
    const c = await H.compact(page);
    const before = await H.state(page);
    await page.click('[data-osc="studio.compact.expand"]', { timeout: NAV_MS });
    const studioNow = async () => ({ ...(await H.state(page)),
      inGraph: await page.evaluate(() => {
        const g = document.querySelector('[data-osc="studio.graph"]');
        return !!g && g.contains(document.activeElement);
      }) });
    const inStudio = await until(async () => {
      const st = await studioNow();
      return st.workspace === 'studio' && st.inGraph ? st : null;
    }, { ms: NAV_MS, what: 'Expand Studio opens STUDIO with focus in the graph' })
      .catch(() => studioNow());
    await page.click('[data-osc="studio.back"]', { timeout: NAV_MS });
    const back = await until(async () => {
      const st = await H.state(page);
      return st.workspace === 'playground' && st.focus === 'BUTTON[studio.compact.expand]'
        ? st : null;
    }, { ms: NAV_MS, what: 'Studio Back returns to the Playground, focus on Expand Studio' })
      .catch(() => H.state(page));
    const wrong = [];
    if (!sameSet(c.controls, ['play', 'stop', 'expand'])) wrong.push(`controls ${c.controls}`);
    if (inStudio.workspace !== 'studio') wrong.push(`Expand -> ${inStudio.workspace}`);
    else if (!inStudio.inGraph) wrong.push(`focus after Expand ${inStudio.focus}`);
    if (inStudio.template !== before.template || inStudio.dirty) {
      wrong.push(`document changed: ${before.template} -> ${inStudio.template}`);
    }
    if (back.workspace !== 'playground' || back.focus !== 'BUTTON[studio.compact.expand]') {
      wrong.push(`Back -> ${back.workspace}, focus ${back.focus}`);
    }
    check(ctx.leg, 'compact-studio: Expand opens STUDIO on the same document, Back returns',
      !wrong.length, `${wrong.join('; ')} :: ${H.brief(inStudio)} / ${H.brief(back)}`);
  } finally {
    await page.close().catch(() => {});
  }
}

async function skipLink(ctx) {
  const page = await H.open(ctx.context, ctx.base);
  try {
    const before = await H.state(page);
    // WebKit (macOS) tabs only to form fields unless Option is held: Option+Tab is the keyboard
    // user's own path to links there (app.cjs, v31-studio-runtime.cjs).
    await page.keyboard.press(ctx.engine === 'webkit' ? 'Alt+Tab' : 'Tab');
    const first = await until(() => page.evaluate(() => {
      const f = document.activeElement;
      if (!f || f === document.body) return null;
      const r = f.getBoundingClientRect();
      return { skip: f.classList.contains('osc-skip'), href: f.getAttribute('href'),
        text: f.textContent.trim(), shown: r.width > 1 && r.height > 1 && r.top >= 0
          && r.bottom <= window.innerHeight };
    }), { ms: NAV_MS, what: 'the first Tab stop takes focus' }).catch(() => null);
    await page.keyboard.press('Enter');
    const after = await until(async () => {
      const st = await H.state(page);
      return st.focus === 'MAIN#osc-main' ? st : null;
    }, { ms: NAV_MS, what: 'Enter on the skip link moves focus to the main region' })
      .catch(() => H.state(page));
    const wrong = [];
    if (!first || !first.skip) wrong.push(`first Tab stop ${JSON.stringify(first)}`);
    else if (!first.shown || first.href !== '#osc-main') {
      wrong.push(`skip link ${JSON.stringify(first)}`);
    }
    if (after.focus !== 'MAIN#osc-main') wrong.push(`focus ${after.focus}`);
    if (after.histLen !== before.histLen) wrong.push(`history ${before.histLen}->${after.histLen}`);
    if (after.hash !== before.hash || after.workspace !== before.workspace) {
      wrong.push(`moved: ${before.workspace} ${before.hash} -> ${after.workspace} ${after.hash}`);
    }
    check(ctx.leg, 'skip-link is the first Tab stop and moves focus to the main region',
      !wrong.length, wrong.join('; '));
  } finally {
    await page.close().catch(() => {});
  }
}

async function firstPlay(ctx) {
  const quiet = (v) => v.nodes === 0 && !v.playing && !v.studioPlaying && v.engineNodes === 0
    && v.engineSources === 0 && v.runtimeNodes === 0;
  {
    const page = await H.open(ctx.context, ctx.base);
    try {
      const box = await page.locator('#osc-hold-play').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const on = await until(async () => {
        const v = await H.sound(page);
        return v.playing && v.peak > 0.01 && v.nodes > 0 ? v : null;
      }, { ms: SOUND_MS, what: 'the first HOLD TO PLAY press sounds' })
        .catch(() => H.sound(page));
      await page.mouse.up();
      const off = await until(async () => {
        const v = await H.sound(page);
        return quiet(v) ? v : null;
      }, { ms: SOUND_MS, what: 'HOLD TO PLAY released leaves 0 nodes' })
        .catch(() => H.sound(page));
      check(ctx.leg, 'first-play: HOLD TO PLAY sounds, release leaves 0 nodes',
        on.playing && on.peak > 0.01 && on.nodes > 0 && quiet(off),
        JSON.stringify({ on, off }));
    } finally {
      await page.close().catch(() => {});
    }
  }
  {
    const page = await H.open(ctx.context, ctx.base);
    try {
      await page.click('#osc-trigger', { timeout: NAV_MS });
      const on = await until(async () => {
        const v = await H.sound(page);
        return v.peak > 0.01 && v.nodes > 0 ? v : null;
      }, { ms: SOUND_MS, what: 'the first TRIGGER sounds' }).catch(() => H.sound(page));
      const off = await until(async () => {
        const v = await H.sound(page);
        return quiet(v) ? v : null;
      }, { ms: SOUND_MS, what: 'TRIGGER ends by itself at 0 nodes' })
        .catch(() => H.sound(page));
      check(ctx.leg, 'first-play: TRIGGER sounds and ends by itself at 0 nodes',
        on.peak > 0.01 && on.nodes > 0 && quiet(off), JSON.stringify({ on, off }));
    } finally {
      await page.close().catch(() => {});
    }
  }
  {
    const page = await H.open(ctx.context, ctx.base);
    try {
      await page.click('[data-osc="studio.compact.play"]', { timeout: NAV_MS });
      const on = await until(async () => {
        const v = await H.sound(page);
        return v.studioPlaying && v.runtimeNodes > 0 && v.peak > 0.005 ? v : null;
      }, { ms: SOUND_MS, what: 'the compact Studio Play sounds' }).catch(() => H.sound(page));
      await page.click('[data-osc="studio.compact.stop"]', { timeout: NAV_MS });
      const off = await until(async () => {
        const v = await H.sound(page);
        return quiet(v) ? v : null;
      }, { ms: SOUND_MS, what: 'the compact Studio Stop leaves 0 nodes' })
        .catch(() => H.sound(page));
      check(ctx.leg, 'first-play: the compact Studio Play sounds, Stop leaves 0 nodes',
        on.studioPlaying && on.runtimeNodes > 0 && on.peak > 0.005 && quiet(off),
        JSON.stringify({ on, off }));
    } finally {
      await page.close().catch(() => {});
    }
  }
}

// ------------------------------------------------------------------------------ Q004 layout
// The positioning sentence Q002 recorded (scripts/social-assets.mjs DESCRIPTION; the unit test
// tests/unit/positioning-consistency.test.mjs holds the two equal).
const SENTENCE = 'A zero-install, scientifically honest acoustic laboratory in your browser: '
  + 'generate, measure and reproduce sound experiments, and know how far each result can be '
  + 'trusted.';
// What the first screen shows (in its rows) and what leaves it, by element id.
const SHOWN = ['osc-panel-source', 'osc-panel-analysis', 'osc-panel-mic', 'osc-panel-device',
  'osc-measure-flow', 'osc-panel-sequencer', 'osc-panel-studio'];
const LEFT = ['osc-panel-spectrogram', 'osc-panel-filter', 'osc-panel-envelope',
  'osc-panel-additive', 'osc-panel-phase', 'osc-panel-bio', 'osc-panel-dual',
  'osc-measure-stimulus', 'osc-measure-input', 'osc-measure-quality', 'osc-measure-result',
  'osc-measure-setup', 'osc-measure-experiment'];
const PX = 2; // rows align within 2 px (sub-pixel layout differs between engines)

/** In-page: the boxes of the first screen's parts, the sentence and the measurement row. */
function layoutFacts() {
  const shown = (el) => !!el && el.getClientRects().length > 0
    && getComputedStyle(el).visibility !== 'hidden'
    && el.getBoundingClientRect().width > 1 && el.getBoundingClientRect().height > 1;
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  };
  const main = document.getElementById('osc-main');
  const h1 = main.querySelector('h1');
  // Every shown panel of the main region (a section card that is not inside another panel).
  const panels = [...main.querySelectorAll('section.osc-panel[id]')]
    .filter((p) => shown(p) && !p.parentElement.closest('section.osc-panel'))
    .map((p) => p.id);
  const boxes = {};
  for (const p of main.querySelectorAll('section[id]')) if (shown(p)) boxes[p.id] = box(p);
  const steps = [...document.querySelectorAll('[data-osc="measure.step"]')].filter(shown);
  const primary = document.querySelector('[data-osc="measure.primary"]');
  const ind = (k) => {
    const el = document.querySelector(`[data-osc="measure.${k}"]`);
    return shown(el) ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  };
  return {
    vw: window.innerWidth, vh: window.innerHeight, workspace: window.OSCILLA.app.workspace,
    safety: shown(document.getElementById('osc-safety')),
    h1: shown(h1) ? { text: h1.textContent.replace(/\s+/g, ' ').trim(), ...box(h1) } : null,
    panels, boxes,
    steps: steps.map((s) => ({ id: s.dataset.step, current: s.getAttribute('aria-current') })),
    stepsInDom: document.querySelectorAll('[data-osc="measure.step"]').length,
    primary: shown(primary) ? { text: primary.textContent.trim(), enabled: !primary.disabled }
      : null,
    freq: ind('freqIndicator'), level: ind('levelIndicator'),
    // The compact Studio's signal path: its whole width in view, no node behind a scroll.
    studioPath: (() => {
      const p = document.querySelector('#osc-panel-studio .osc-sc-path');
      return p ? { client: p.clientWidth, scroll: p.scrollWidth } : null;
    })(),
    // Source & Pattern's own disclosures: the six frequency steps and Mode.
    folds: ['osc-fine-fold', 'osc-mode-fold'].map((id) => {
      const d = document.getElementById(id);
      return { id, open: !!d && d.open, summary: !!d && shown(d.querySelector('summary')) };
    }),
  };
}

async function layoutDesktop(ctx) {
  const page = await H.open(ctx.context, ctx.base);
  try {
    const f = await page.evaluate(layoutFacts);
    const b = f.boxes;
    const wrong = [];
    if (!f.safety) wrong.push('not a first visit: the safety notice is not shown');
    if (!f.h1) wrong.push('the h1 is not shown');
    else if (f.h1.text !== SENTENCE) wrong.push(`h1 "${f.h1.text}"`);
    const extra = f.panels.filter((p) => !SHOWN.includes(p));
    const missing = SHOWN.filter((p) => !f.panels.includes(p));
    if (extra.length) wrong.push(`shown but not chosen: ${extra.join(', ')}`);
    if (missing.length) wrong.push(`chosen but not shown: ${missing.join(', ')}`);
    const left = LEFT.filter((p) => b[p]);
    if (left.length) wrong.push(`still on the first screen: ${left.join(', ')}`);
    if (!wrong.length) {
      const [src, ana, mic, dev] = ['osc-panel-source', 'osc-panel-analysis', 'osc-panel-mic',
        'osc-panel-device'].map((id) => b[id]);
      const flow = b['osc-measure-flow'];
      const seq = b['osc-panel-sequencer'];
      const st = b['osc-panel-studio'];
      const top = Math.min(src.top, ana.top, mic.top, dev.top);
      if (f.h1.bottom > top) wrong.push(`the h1 (bottom ${f.h1.bottom}) is not above the panels`);
      if ([ana, mic, dev].some((x) => Math.abs(x.top - src.top) > PX)
        || !(src.right <= ana.left && ana.right <= mic.left && mic.right <= dev.left)) {
        wrong.push('row 1 is not Source, Analysis, Microphone, Device side by side');
      }
      const row1 = Math.max(src.bottom, ana.bottom, mic.bottom, dev.bottom);
      if (flow.top < row1) wrong.push(`the measurement row (top ${flow.top}) overlaps row 1`);
      if (Math.abs(flow.left - src.left) > PX || Math.abs(flow.right - dev.right) > PX) {
        wrong.push(`the measurement row is not full width (${flow.left}-${flow.right}, row 1 `
          + `${src.left}-${dev.right})`);
      }
      if (flow.bottom > f.vh) {
        wrong.push(`the measurement row ends below the viewport (${flow.bottom} > ${f.vh})`);
      }
      if (Math.abs(seq.top - st.top) > PX || !(seq.right <= st.left)) {
        wrong.push('the Pattern Sequencer and the compact Studio are not side by side');
      }
      if (Math.min(seq.top, st.top) < flow.bottom) wrong.push('row 3 overlaps the measurement row');
      if (st.top >= f.vh) wrong.push(`the compact Studio starts below the viewport (${st.top})`);
    }
    if (!f.studioPath || f.studioPath.scroll > f.studioPath.client + 1) {
      wrong.push(`the compact Studio's signal path is clipped ${JSON.stringify(f.studioPath)}`);
    }
    if (f.steps.length !== 7) wrong.push(`${f.steps.length} measurement steps shown`);
    if (!f.primary || f.primary.text !== 'Check setup' || !f.primary.enabled) {
      wrong.push(`primary ${JSON.stringify(f.primary)}`);
    }
    if (!/UNCALIBRATED/.test(f.freq || '') || !/UNCALIBRATED/.test(f.level || '')) {
      wrong.push(`indicators ${f.freq} / ${f.level}`);
    }
    if (f.folds.some((d) => !d.open || d.summary)) {
      wrong.push(`the steps and Mode are not open as before: ${JSON.stringify(f.folds)}`);
    }
    check(ctx.leg, 'layout desktop: the sentence, then Source/Analysis/Microphone/Device, the '
      + 'measurement row in view, then Sequencer and compact Studio', !wrong.length,
    `${wrong.join('; ')} :: ${JSON.stringify({ h1: f.h1, panels: f.panels })}`);
  } finally {
    await page.close().catch(() => {});
  }
}

async function layoutPhone(ctx) {
  // Firefox has no mobile emulation (Playwright refuses isMobile there): a 390 px touch viewport.
  const phone = await ctx.browser.newContext({ viewport: PHONE, hasTouch: true,
    ...(ctx.engine === 'firefox' ? {} : { isMobile: true }) });
  await phone.addInitScript(recordNotices);
  ctx.watch(phone);
  try {
    const page = await H.open(phone, ctx.base);
    const f = await page.evaluate(layoutFacts);
    const b = f.boxes;
    const order = ['osc-panel-source', 'osc-panel-analysis', 'osc-measure-flow',
      'osc-panel-studio'];
    const wrong = [];
    if (!f.h1) wrong.push('the h1 is not shown');
    else if (f.h1.text !== SENTENCE) wrong.push(`h1 "${f.h1.text}"`);
    const missing = order.filter((p) => !b[p]);
    if (missing.length) wrong.push(`not shown: ${missing.join(', ')}`);
    const extra = f.panels.filter((p) => !order.includes(p));
    if (extra.length) wrong.push(`shown at 390 px but not chosen: ${extra.join(', ')}`);
    if (!wrong.length) {
      const tops = [f.h1.top, ...order.map((p) => b[p].top)];
      if (tops.some((t, i) => i > 0 && t < tops[i - 1])) {
        wrong.push(`not top to bottom: sentence, ${order.join(', ')} (${tops.join(', ')})`);
      }
    }
    if (f.steps.length !== 1 || f.steps[0].current !== 'step' || f.stepsInDom !== 7) {
      wrong.push(`steps not folded to the current one: ${JSON.stringify(f.steps)} of `
        + `${f.stepsInDom}`);
    }
    if (!f.primary || f.primary.text !== 'Check setup') {
      wrong.push(`primary ${JSON.stringify(f.primary)}`);
    }
    if (f.folds.some((d) => d.open || !d.summary)) {
      wrong.push(`the steps and Mode are not folded: ${JSON.stringify(f.folds)}`);
    }
    // Folded, they open from their own summary.
    await page.click('#osc-fine-fold > summary', { timeout: NAV_MS })
      .catch((e) => wrong.push(`the steps' summary: ${String(e.message).split('\n')[0]}`));
    const steps = await page.evaluate(() => [...document.querySelectorAll('[data-osc="source.step"]')]
      .filter((b) => b.getBoundingClientRect().height > 0).length);
    if (steps !== 6) wrong.push(`${steps} frequency steps shown after opening the disclosure`);
    check(ctx.leg, 'layout phone: the sentence, Source, Analysis, the measurement (current '
      + 'step), compact Studio, top to bottom', !wrong.length,
    `${wrong.join('; ')} :: ${JSON.stringify({ h1: f.h1, panels: f.panels, steps: f.steps })}`);
  } finally {
    await phone.close().catch(() => {});
  }
}

async function layoutPrimary(ctx) {
  const page = await H.open(ctx.context, H.urlOf(ctx.base, '?measure=loopback', ''));
  try {
    const before = await H.state(page);
    const wrong = [];
    await page.click('[data-osc="measure.primary"]', { timeout: NAV_MS })
      .catch((e) => wrong.push(`Check setup not pressable: ${String(e.message).split('\n')[0]}`));
    const now = async () => ({ ...(await H.state(page)),
      ready: await page.evaluate(() => window.OSCILLA.measure.state) });
    const s = await until(async () => {
      const st = await now();
      return st.workspace === 'measure' && st.ready === 'READY' ? st : null;
    }, { ms: READY_MS, what: 'Check setup from the Playground reaches READY in MEASURE' })
      .catch(() => now());
    if (before.workspace !== 'playground') wrong.push(`started in ${before.workspace}`);
    if (s.workspace !== 'measure' || s.hash !== '#m=measure') {
      wrong.push(`landed in ${s.workspace} ${s.hash}`);
    }
    if (s.ready !== 'READY') wrong.push(`measurement state ${s.ready}`);
    // Focus stays where the press was: on the button, or (WebKit, whose click does not focus a
    // button) on the MEASURE view that holds it, never dropped to <body>.
    if (!['BUTTON#osc-measure-primary[measure.primary]', 'SECTION#osc-view-measure[measure-view]']
      .includes(s.focus)) wrong.push(`focus ${s.focus}`);
    if (!s.testContext) wrong.push('the TEST CONTEXT banner is not shown');
    check(ctx.leg, 'layout primary: Check setup on the Playground opens MEASURE and runs there',
      !wrong.length, `${wrong.join('; ')} :: ${H.brief(s)}`);
  } finally {
    await page.close().catch(() => {});
  }
}

async function layoutOthers(ctx) {
  const rows = [
    { hash: 'm=measure', shown: ['osc-measure-flow', 'osc-measure-stimulus', 'osc-measure-input',
      'osc-measure-quality', 'osc-measure-result', 'osc-measure-setup',
      'osc-measure-experiment'] },
    { hash: 'm=analyzer', shown: ['osc-panel-spectrogram', 'osc-panel-analysis'],
      hidden: ['osc-measure-flow'] },
    { hash: 'm=synthesis', shown: ['osc-panel-envelope', 'osc-panel-additive'],
      hidden: ['osc-measure-flow'] },
    { hash: 'm=filter', shown: ['osc-panel-filter'], hidden: ['osc-measure-flow'] },
  ];
  for (const row of rows) {
    const page = await H.open(ctx.context, H.urlOf(ctx.base, '', row.hash));
    try {
      const f = await until(async () => {
        const v = await page.evaluate(layoutFacts);
        return v.workspace === row.hash.slice(2) ? v : null;
      }, { ms: NAV_MS, what: `#${row.hash} opens` }).catch(() => page.evaluate(layoutFacts));
      const wrong = [];
      const missing = row.shown.filter((p) => !f.boxes[p]);
      if (missing.length) wrong.push(`not shown: ${missing.join(', ')}`);
      const extra = (row.hidden || []).filter((p) => f.boxes[p]);
      if (extra.length) wrong.push(`shown: ${extra.join(', ')}`);
      if (f.h1) wrong.push('the sentence is shown (the workspace heading leads here)');
      check(ctx.leg, `layout others: #${row.hash} shows what it showed before`, !wrong.length,
        `${wrong.join('; ')} :: ${JSON.stringify(f.panels)}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
}

// Widths between the phone and the 1536 px reference, where the first row follows its content
// (integration.css, responsive.css Touch): nothing of row 1 may sit under the measurement row.
const WIDTHS = [
  { name: '1280x800', viewport: { width: 1280, height: 800 } },
  { name: '1440x900', viewport: { width: 1440, height: 900 } },
  { name: '1366x1024 touch', viewport: { width: 1366, height: 1024 }, touch: true },
];
const ROW1 = ['osc-panel-source', 'osc-panel-analysis', 'osc-panel-mic', 'osc-panel-device'];
const PRESSABLE = ['#osc-hold-play', '#osc-trigger', '#osc-gain', '#osc-spec-log',
  '#osc-spec-max'];

async function layoutWidths(ctx) {
  for (const w of WIDTHS) {
    // Firefox has no mobile emulation (Playwright refuses isMobile there): touch only.
    const c = await ctx.browser.newContext({ viewport: w.viewport, hasTouch: !!w.touch,
      ...(w.touch && ctx.engine !== 'firefox' ? { isMobile: true } : {}) });
    await c.addInitScript(recordNotices);
    ctx.watch(c);
    try {
      const page = await H.open(c, ctx.base);
      const f = await page.evaluate(({ row1 }) => {
        const shown = (el) => el.getClientRects().length > 0
          && getComputedStyle(el).visibility !== 'hidden';
        const flow = document.getElementById('osc-measure-flow').getBoundingClientRect();
        const spill = [];
        for (const id of row1) {
          const p = document.getElementById(id);
          const pb = p.getBoundingClientRect();
          for (const el of p.querySelectorAll('button, input, select, summary, [tabindex]')) {
            if (!shown(el)) continue;
            const b = el.getBoundingClientRect();
            if (b.height > 0 && (b.bottom > pb.bottom + 2 || b.bottom > flow.top + 2)) {
              spill.push(`${el.id || el.dataset.osc || el.tagName} ${Math.round(b.bottom)} > `
                + `${id} ${Math.round(pb.bottom)} / row ${Math.round(flow.top)}`);
            }
          }
        }
        // The compact Studio's signal path keeps its whole width in view (no node clipped).
        const sp = document.querySelector('#osc-panel-studio .osc-sc-path');
        if (!sp || sp.scrollWidth > sp.clientWidth + 1) {
          spill.push(`compact Studio path ${sp ? `${sp.scrollWidth} > ${sp.clientWidth}`
            : 'missing'}`);
        }
        return { spill, coarse: matchMedia('(pointer: coarse)').matches };
      }, { row1: ROW1 });
      const wrong = [...f.spill];
      for (const sel of PRESSABLE) {
        const hit = await page.evaluate((q) => {
          const el = document.querySelector(q);
          el.scrollIntoView({ block: 'center' });
          const b = el.getBoundingClientRect();
          const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          return !!at && (at === el || el.contains(at)) ? null
            : (at ? (at.id || at.className || at.tagName) : 'nothing');
        }, sel);
        if (hit) wrong.push(`${sel} is covered by ${hit}`);
      }
      check(ctx.leg, `layout widths ${w.name}${w.touch ? ` (coarse ${f.coarse})` : ''}: `
        + 'row 1 keeps its controls above the measurement row, the compact Studio path whole',
      !wrong.length,
      wrong.slice(0, 8).join('; '));
    } finally {
      await c.close().catch(() => {});
    }
  }
}

async function layout(ctx) {
  for (const [name, fn] of [['desktop', layoutDesktop], ['phone', layoutPhone],
    ['primary', layoutPrimary], ['others', layoutOthers], ['widths', layoutWidths]]) {
    try {
      await fn(ctx);
    } catch (err) {
      check(ctx.leg, `layout ${name} ran to completion`, false,
        String(err && err.message).split('\n')[0]);
    }
  }
}

const CHECKS = [
  ['load', entryLoad], ['link', entryLink], ['direct-path', directPath],
  ['studio-widget', studioWidget], ['compact-studio', compactStudio], ['skip-link', skipLink],
  ['first-play', firstPlay], ['layout', layout],
];

// ------------------------------------------------------------------------------ one leg
async function runLeg(name, origin, server) {
  const leg = `${name}/${origin}`;
  const base = server ? server.url : pathToFileURL(DIST).href;
  const browser = await playwright[name].launch(LAUNCH[name]);
  const errors = [];
  const watch = (context) => context.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  });
  const context = await browser.newContext({ viewport: DESKTOP });
  await context.addInitScript(recordNotices);
  watch(context);
  console.log(`\n${leg} (${browser.version()})`);
  const t0 = Date.now();
  try {
    for (const [id, fn] of CHECKS) {
      const rowWise = id === 'load' || id === 'link';
      if (!rowWise && !want(id)) continue;
      if (rowWise && ONLY && ![...ONLY].some((o) => o === id || o.startsWith(`${id}:`))) continue;
      const ctx = { leg, engine: name, origin, base, browser, context, watch };
      try {
        await bounded(fn(ctx), { ms: CHECK_MS * (rowWise ? 4 : 1), what: `${leg} ${id}` });
      } catch (err) {
        check(leg, `${id} ran to completion`, false, String(err && err.message).split('\n')[0]);
      }
      for (const p of context.pages()) await p.close().catch(() => {});
    }
    check(leg, 'no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  } finally {
    await browser.close();
  }
  console.log(`${leg}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

(async () => {
  await RUN.ready();
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  const server = RUN.origins.includes('http')
    ? await serveDist(DIST, { prefix: 'oscilla-first-screen-' }) : null;
  try {
    for (const b of RUN.browsers) {
      for (const o of RUN.origins) await runLeg(b, o, o === 'http' ? server : null);
    }
  } finally {
    if (server) server.close();
  }
  console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL PASS'} (${passes} checks passed)`);
  process.exit(failures ? 1 : 0);
})();

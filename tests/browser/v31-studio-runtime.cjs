#!/usr/bin/env node
// OSCILLA Studio runtime truth in the Inspector (ADR 0039): the built dist/index.html in
// chromium, firefox and webkit from file://. With nothing selected the Inspector's Runtime
// section says what runs, from runtime.js studioDivergence, runtime.applied() and the runtime
// and transport debugInfo diagnostics; node status lines carry the diagnostic code. The Trace
// section (ADR 0042) lists what each recent operation did, from core/trace.js steps.
//
//   node tests/browser/v31-studio-runtime.cjs [--browsers chromium,firefox,webkit]
//        [--only name1,name2] [--json out.json]   (or OSC_BROWSERS=...)
//
// Checks (asserted):
//   stopped-not-applied  a real h5 "Runtime" heading, the state in words ("Not applied ...
//                        press Play"), the details list: desired revision and short studio
//                        hash, nothing applied
//   play-running         PLAY: "Running", the applied revision is the store revision, a short
//                        plan hash and the applied time; the automation lane and its owned
//                        parameter are listed
//   edit-in-sync         an edit while playing: still Running, at the new revision
//   refused-edit         a live filter type change whose biquad cannot be created (one injected
//                        createBiquadFilter throw): refused, the node status line gives the why
//                        and the code (edit-refused); the Runtime diagnostics name Filter 1 and
//                        their button, reached and pressed with the keyboard alone, selects it
//                        and lands focus on the Inspector heading, never <body>
//   failed-play          a PLAY the runtime refuses: "Failed" with the reason, announced
//                        politely ("Runtime: Failed"); STOP state is "Not applied" again
//   phone                390 x 844 touch: the Inspector subview shows the Runtime section within
//                        the width (no horizontal overflow)
//   trace-edit           an edit while playing: the Trace section (a real h5 heading, an
//                        ordered list) shows it first as "<op> · Change ... Detune · committed,
//                        revision n"; opened from the keyboard (focus, Enter) its steps say in
//                        words that the runtime compiled, applied and scheduled Detune 7 cents
//                        at an audio time; with the oscillator selected its own Inspector lists
//                        the same op and not the PLAY that never named it
//   trace-stopped        an edit while stopped: its admit step says not-applied, playing false
//   trace-refused        the refused live filter type change: the filter's Trace lists the op
//                        as refused (prepare-failed) and its steps name edit-refused
//   trace-phone          390 x 844 touch: the Trace section with an open operation fits the
//                        width (no horizontal overflow)
//   trace-themes         step text keeps contrast >= 4.5:1 on its surface in dark and light
//   trace-one-fill       one live edit rebuilds the operation list once, after the operation
//                        has ended (never with a half-finished operation)
//   trace-focus          a focused operation pushed out of the list leaves focus on the
//                        Inspector heading, never on <body>
//   screenshots          tests/visual/out-studio/runtime-*.png (not committed)
//   no-console-errors
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DIST = path.resolve(__dirname, '..', '..', 'dist', 'index.html');
const OUT = path.resolve(__dirname, '..', 'visual', 'out-studio');
const RUN = suite.open({ name: 'v31-studio-runtime', browsers: arg('browsers') });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const JSON_OUT = arg('json', '');
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RT = '[data-osc="studio.inspector.runtime"]';
const TR = '[data-osc="studio.inspector.trace"]';

const H = {
  verdict: (conds) => {
    const failed = Object.keys(conds).filter((k) => !conds[k]);
    return { ok: failed.length === 0, failed };
  },
  until: async (fn, test, ms = 3000, step = 40) => {
    const t0 = Date.now();
    let v = await fn();
    while (!test(v) && Date.now() - t0 < ms) {
      await sleep(step);
      v = await fn();
    }
    return v;
  },
  frames: (page, n = 2) => page.evaluate((k) => new Promise((r) => {
    let i = 0;
    const f = () => (++i >= k ? r() : requestAnimationFrame(f));
    requestAnimationFrame(f);
  }), n),
  /** A fresh Subtractive Synth in the Studio workspace, stopped, nothing selected. */
  fresh: async (page) => {
    await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      const s = window.OSCILLA.studio;
      if (s.transport && s.transport.playing) await a.studioStop();
      a.alerts = [];
      if (a.workspace !== 'studio') a.setWorkspace('studio');
      a.studioLoadTemplate('subtractive-synth');
      s.store.dispatch({ type: 'SELECTION_CHANGE', selection: {} });
    });
    await page.waitForFunction(() => document.querySelector('#osc-app').dataset.mode === 'studio',
      null, { timeout: 10000 });
    await H.frames(page);
  },
  /** The Runtime section as a user and a developer read it. */
  runtime: (page) => page.evaluate((sel) => {
    const sec = document.querySelector(sel);
    if (!sec) return null;
    const st = sec.querySelector('[data-osc="studio.inspector.runtimeState"]');
    const rows = {};
    for (const d of sec.querySelectorAll('dl > div')) {
      rows[d.querySelector('dt').textContent] = d.querySelector('dd').textContent;
    }
    const list = sec.querySelector('[data-osc="studio.inspector.diagnostics"]');
    const r = sec.getBoundingClientRect();
    return {
      heading: (sec.querySelector('h5') || {}).textContent || null,
      state: st.dataset.state,
      text: st.textContent,
      error: st.classList.contains('is-error'),
      rows,
      diagnostics: list.hidden ? [] : [...list.querySelectorAll('li')].map((li) => li.textContent),
      buttons: list.hidden ? [] : [...list.querySelectorAll('button')].map((b) => b.textContent),
      visible: r.width > 0 && r.height > 0,
    };
  }, RT),
  /** The Trace section as a user reads it. */
  trace: (page) => page.evaluate((sel) => {
    const sec = document.querySelector(sel);
    if (!sec) return null;
    const r = sec.getBoundingClientRect();
    const list = sec.querySelector('ol');
    return {
      heading: (sec.querySelector('h5') || {}).textContent || null,
      note: sec.querySelector('p').textContent,
      list: list.tagName,
      ops: [...list.children].map((li) => ({ summary: li.querySelector('summary').textContent,
        open: li.querySelector('details').open,
        steps: [...li.querySelectorAll('details li')].map((x) => x.textContent) })),
      visible: r.width > 0 && r.height > 0,
    };
  }, TR),
  /** Open the first operation of the Trace section from the keyboard (focus, Enter). */
  openFirstOp: async (page) => {
    await page.focus(`${TR} summary`);
    await page.keyboard.press('Enter');
    await H.frames(page);
  },
  select: async (page, nodes) => {
    await page.evaluate((n) => window.OSCILLA.studio.store.dispatch({ type: 'SELECTION_CHANGE',
      selection: { nodes: n } }), nodes);
    await H.frames(page);
  },
  waitState: (page, state, ms = 3000) => H.until(() => H.runtime(page),
    (v) => v && v.state === state, ms),
  live: (page) => page.evaluate(() => (window.__rtLive || []).slice()),
  recordLive: (page) => page.evaluate(() => {
    if (window.__rtLive) { window.__rtLive.length = 0; return; }
    const log = [];
    window.__rtLive = log;
    for (const sel of ['[data-osc="studio.live"]', '[data-osc="studio.alert"]']) {
      const el = document.querySelector(sel);
      new MutationObserver(() => {
        const t = el.textContent.replace(/​/g, '');
        if (t) log.push(`${sel.includes('alert') ? 'alert' : 'live'}:${t}`);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    }
  }),
  /** The next createBiquadFilter on the engine's context throws (one shot). */
  failNextBiquad: (page) => page.evaluate(() => {
    const ctx = window.OSCILLA.engine.ctx;
    ctx.createBiquadFilter = function failing() {
      delete ctx.createBiquadFilter;
      throw new Error('injected biquad failure');
    };
  }),
};

function defineChecks() {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });

  def('stopped-not-applied', async ({ page }) => {
    await H.fresh(page);
    const rv = await H.runtime(page);
    const rev = await page.evaluate(() => window.OSCILLA.studio.store.getRevision());
    return { ...H.verdict({
      section: !!rv && rv.visible && rv.heading === 'Runtime',
      state: rv.state === 'not-applied' && /^Not applied · Nothing runs\. Press Play/.test(rv.text),
      desired: new RegExp(`^rev ${rev} · studio [0-9a-f]{8}$`).test(rv.rows.Desired || ''),
      applied: rv.rows.Applied === 'Nothing',
      noDiagnostics: rv.diagnostics.length === 0,
    }), rv };
  });

  def('play-running', async ({ page }) => {
    await H.fresh(page);
    await page.click('[data-osc="studio.play"]');
    const rv = await H.waitState(page, 'in-sync');
    const rev = await page.evaluate(() => window.OSCILLA.studio.store.getRevision());
    return { ...H.verdict({
      running: rv.state === 'in-sync' && rv.text === `Running · Revision ${rev} plays as edited.`,
      applied: new RegExp(`^rev ${rev} · plan [0-9a-f]{8} · \\d`).test(rv.rows.Applied || ''),
      lanes: rv.rows.Lanes === 'Filter 1 Cutoff',
      owned: /Filter 1 Cutoff/.test(rv.rows.Owned || ''),
      counts: rv.rows.Nodes === '6 ready · 0 degraded · 0 offline',
    }), rv, rev };
  });

  def('edit-in-sync', async ({ page }) => {
    const playing = await page.evaluate(() => window.OSCILLA.studio.transport.playing);
    if (!playing) {
      await H.fresh(page);
      await page.click('[data-osc="studio.play"]');
      await H.waitState(page, 'in-sync');
    }
    const r = await page.evaluate(() => window.OSCILLA.studio.store.dispatch({
      type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'Q', value: 3 }));
    await H.frames(page);
    const rv = await H.runtime(page);
    return { ...H.verdict({
      edited: r.ok,
      inSync: rv.state === 'in-sync' && rv.text.includes(`Revision ${r.revision} plays`),
      applied: (rv.rows.Applied || '').startsWith(`rev ${r.revision} · `),
    }), rv, revision: r.revision };
  });

  def('refused-edit', async ({ page, browserName }) => {
    await H.fresh(page);
    await page.click('[data-osc="studio.play"]');
    await H.waitState(page, 'in-sync');
    await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'SELECTION_CHANGE',
      selection: { nodes: ['filter-1'] } }));
    await H.frames(page);
    await H.failNextBiquad(page);
    const rev0 = await page.evaluate(() => window.OSCILLA.studio.store.getRevision());
    await page.selectOption('[data-osc="studio.inspector.param"][data-key="type"]', 'highpass');
    await H.frames(page);
    const after = await page.evaluate(() => ({
      revision: window.OSCILLA.studio.store.getRevision(),
      type: window.OSCILLA.studio.model.graph.nodes.find((n) => n.id === 'filter-1').params.type,
      status: (document.querySelector('[data-osc="studio.inspector.status"]') || {})
        .textContent || '',
    }));
    // Nothing selected: the Runtime section lists the refusal and names the node.
    await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'SELECTION_CHANGE',
      selection: {} }));
    await H.frames(page);
    const rv = await H.runtime(page);
    // Keyboard only: from the Inspector heading, Tab reaches the entity button; Enter selects.
    await page.evaluate(() => document.querySelector('[data-osc="studio.inspector.title"]')
      .focus());
    let reached = null;
    for (let i = 0; i < 4 && !reached; i += 1) {
      // WebKit's Tab skips buttons unless the user opts in; Alt+Tab is that opt-in (app.cjs).
      await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
      reached = await page.evaluate((sel) => {
        const a = document.activeElement;
        return a && a.closest(`${sel} [data-osc="studio.inspector.diagnostics"]`)
          && a.tagName === 'BUTTON' ? a.textContent : null;
      }, RT);
    }
    await page.screenshot({ path: path.join(OUT, `runtime-refused-${page.context().browser()
      .browserType().name()}.png`) });
    if (reached) await page.keyboard.press('Enter');
    await H.frames(page);
    const selected = await page.evaluate(() => ({
      nodes: [...window.OSCILLA.studio.selection.nodes],
      focus: document.activeElement === document.body ? 'body'
        : document.activeElement.getAttribute('data-osc'),
      title: document.querySelector('[data-osc="studio.inspector.title"]').textContent,
    }));
    const d = rv.diagnostics.find((t) => t.includes('edit-refused')) || '';
    return { ...H.verdict({
      refused: after.revision === rev0 && after.type === 'lowpass',
      statusWhy: /Edit refused: .*injected biquad failure.*\(edit-refused\)/.test(after.status),
      stillRunning: rv.state === 'in-sync',
      listed: /injected biquad failure.*\(edit-refused, transport\)/.test(d),
      names: rv.buttons.includes('Select Filter 1'),
      keyboard: reached === 'Select Filter 1',
      selects: selected.nodes.length === 1 && selected.nodes[0] === 'filter-1'
        && selected.title === 'Filter 1',
      focus: selected.focus === 'studio.inspector.title',
    }), after, rv, reached, selected };
  });

  def('failed-play', async ({ page }) => {
    await H.fresh(page);
    await H.recordLive(page);
    await H.failNextBiquad(page);
    await page.click('[data-osc="studio.play"]');
    const rv = await H.waitState(page, 'failed');
    const live = await H.live(page);
    // A working PLAY and STOP afterwards: Running, then Not applied again.
    await page.click('[data-osc="studio.play"]');
    const run = await H.waitState(page, 'in-sync');
    await page.click('[data-osc="studio.stop"]');
    const stopped = await H.waitState(page, 'not-applied');
    return { ...H.verdict({
      failed: rv.state === 'failed' && /^Failed · Play failed: injected biquad failure \(prepare-failed\)$/
        .test(rv.text) && rv.error,
      named: rv.buttons.includes('Select Filter 1'),
      announced: live.includes('live:Runtime: Failed'),
      recovered: run.state === 'in-sync' && run.diagnostics.length === 0,
      stopped: stopped.state === 'not-applied' && stopped.rows.Applied === 'Nothing',
    }), rv, live };
  });

  def('phone', async ({ browser, baseUrl, browserName }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true,
      isMobile: browserName !== 'firefox' });
    const page = await ctx.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'load' });
      await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
      await page.evaluate(() => { const a = window.OSCILLA.app; a.alerts = [];
        if (!a.safetyCollapsed) a.collapseSafety(); });
      await H.fresh(page);
      await page.evaluate(() => window.OSCILLA.app.studioSetSubview('inspector'));
      await H.frames(page);
      await page.evaluate((sel) => document.querySelector(sel).scrollIntoView(), RT);
      await page.evaluate((sel) => { document.querySelector(`${sel} details`).open = true; }, RT);
      await H.frames(page);
      const rv = await H.runtime(page);
      const fit = await page.evaluate((sel) => {
        const sec = document.querySelector(sel);
        const r = sec.getBoundingClientRect();
        return { left: r.left, right: r.right, vw: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          overflow: [...sec.querySelectorAll('*')].some((el) => el.scrollWidth
            > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') };
      }, RT);
      await page.screenshot({ path: path.join(OUT, `runtime-phone-${browserName}.png`) });
      return { ...H.verdict({
        shown: !!rv && rv.visible && rv.state === 'not-applied',
        within: fit.left >= 0 && fit.right <= fit.vw + 0.5 && fit.scroll <= fit.vw,
        noOverflow: !fit.overflow,
      }), rv, fit };
    } finally {
      await ctx.close();
    }
  });

  def('trace-edit', async ({ page }) => {
    await H.fresh(page);
    await page.click('[data-osc="studio.play"]');
    await H.waitState(page, 'in-sync');
    const r = await page.evaluate(() => window.OSCILLA.studio.store.dispatch({
      type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'detune', value: 7 }));
    await H.frames(page);
    await H.openFirstOp(page);
    const tr = await H.trace(page);
    const first = tr.ops[0] || { steps: [] };
    const has = (re) => first.steps.some((x) => re.test(x));
    await H.select(page, ['osc-1']);
    const node = await H.trace(page);
    const seam = await page.evaluate(() => {
      const t = window.OSCILLA.studio.trace;
      return { size: t.stats().size, frozen: Object.isFrozen(t.steps()[0]) };
    });
    await page.evaluate(() => window.OSCILLA.app.studioStop());
    return { ...H.verdict({
      section: !!tr && tr.visible && tr.heading === 'Trace' && tr.list === 'OL',
      newest: new RegExp(`^op-\\d+ · Change .+ Detune · committed, revision ${r.revision}$`)
        .test(first.summary || ''),
      keyboardOpen: first.open === true,
      compiled: has(new RegExp(`^runtime compile: compiled · rev ${r.revision} · `
        + 'plan [0-9a-f]{8}')),
      applied: has(new RegExp(`^runtime apply: applied · rev ${r.revision} · at [\\d.]+ s`)),
      scheduled: has(new RegExp(`^runtime param: scheduled · rev ${r.revision} · .+ Detune `
        + '7 cents, at [\\d.]+ s, via glide$')),
      admitted: has(/^transport admit: admitted/),
      filtered: !!node && node.ops.length >= 1 && node.ops[0].summary === first.summary
        && !node.ops.some((o) => /transport play/.test(o.summary)),
      unfilteredHasPlay: tr.ops.some((o) => /transport play · playing/.test(o.summary)),
      seam: seam.size > 0 && seam.frozen,
    }), first, nodeOps: node && node.ops.map((o) => o.summary), r: r.revision };
  });

  def('trace-stopped', async ({ page }) => {
    await H.fresh(page);
    const r = await page.evaluate(() => window.OSCILLA.studio.store.dispatch({
      type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'detune', value: 3 }));
    await H.frames(page);
    await H.openFirstOp(page);
    const first = (await H.trace(page)).ops[0] || { steps: [] };
    return { ...H.verdict({
      committed: /committed, revision \d+$/.test(first.summary || ''),
      notApplied: first.steps.some((x) => new RegExp(`^transport admit: not-applied · rev `
        + `${r.revision} · playing false`).test(x)),
      noRuntime: !first.steps.some((x) => /^runtime /.test(x)),
    }), first };
  });

  def('trace-refused', async ({ page }) => {
    await H.fresh(page);
    await page.click('[data-osc="studio.play"]');
    await H.waitState(page, 'in-sync');
    await H.select(page, ['filter-1']);
    await H.failNextBiquad(page);
    await page.selectOption('[data-osc="studio.inspector.param"][data-key="type"]', 'highpass');
    await H.frames(page);
    await H.openFirstOp(page);
    const tr = await H.trace(page);
    const first = tr.ops[0] || { steps: [] };
    await page.evaluate(() => window.OSCILLA.app.studioStop());
    return { ...H.verdict({
      listed: /^op-\d+ · Change .+ · refused \(prepare-failed\)$/.test(first.summary || ''),
      runtime: first.steps.some((x) => /^runtime apply: refused \(prepare-failed\)/.test(x)
        && /injected biquad failure/.test(x)),
      transport: first.steps.some((x) => /^transport admit: refused \(edit-refused\)/.test(x)),
      store: first.steps.some((x) => /^store commit: refused/.test(x)),
      nothingApplied: !first.steps.some((x) => /: applied|: scheduled/.test(x)),
    }), first };
  });

  def('trace-phone', async ({ browser, baseUrl, browserName }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true,
      isMobile: browserName !== 'firefox' });
    const page = await ctx.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'load' });
      await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
      await page.evaluate(() => { const a = window.OSCILLA.app; a.alerts = [];
        if (!a.safetyCollapsed) a.collapseSafety(); });
      await H.fresh(page);
      await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'NODE_PARAM_SET',
        nodeId: 'osc-1', key: 'detune', value: 5 }));
      await page.evaluate(() => window.OSCILLA.app.studioSetSubview('inspector'));
      await H.frames(page);
      await page.evaluate((sel) => document.querySelector(sel).scrollIntoView(), TR);
      await page.evaluate((sel) => { document.querySelector(`${sel} details`).open = true; }, TR);
      await H.frames(page);
      const tr = await H.trace(page);
      const fit = await page.evaluate((sel) => {
        const sec = document.querySelector(sel);
        const r = sec.getBoundingClientRect();
        return { left: r.left, right: r.right, vw: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          overflow: [...sec.querySelectorAll('*')].some((el) => el.getBoundingClientRect().right
            > r.right + 0.5 || (el.scrollWidth > el.clientWidth + 1
              && getComputedStyle(el).overflowX !== 'visible')) };
      }, TR);
      await page.screenshot({ path: path.join(OUT, `trace-phone-${browserName}.png`) });
      return { ...H.verdict({
        shown: !!tr && tr.visible && tr.ops.length > 0 && tr.ops[0].open,
        within: fit.left >= 0 && fit.right <= fit.vw + 0.5 && fit.scroll <= fit.vw,
        noOverflow: !fit.overflow,
      }), fit, first: tr && tr.ops[0] };
    } finally {
      await ctx.close();
    }
  });

  def('trace-themes', async ({ page, browserName }) => {
    await H.fresh(page);
    await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'NODE_PARAM_SET',
      nodeId: 'osc-1', key: 'detune', value: 4 }));
    await H.frames(page);
    await page.evaluate((sel) => { document.querySelector(`${sel} details`).open = true; }, TR);
    const measure = () => page.evaluate((sel) => {
      const parse = (x) => (x.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
      const lum = ([r, g, b]) => {
        const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92
          : ((x + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05); };
      const bgOf = (el) => {
        for (let e = el; e; e = e.parentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c.slice(0, 3);
        }
        return [255, 255, 255];
      };
      const sec = document.querySelector(sel);
      const els = [sec.querySelector('summary'), sec.querySelector('details li'),
        sec.querySelector('p')];
      return Math.min(...els.map((el) => ratio(parse(getComputedStyle(el).color).slice(0, 3),
        bgOf(el))));
    }, TR);
    const dark = await measure();
    const theme = (t) => page.evaluate((x) => {
      if (window.OSCILLA.app.theme !== x) window.OSCILLA.app.toggleTheme();
    }, t);
    await theme('light');
    await sleep(250); // the controls' 0.12 s colour transitions
    const light = await measure();
    await page.screenshot({ path: path.join(OUT, `trace-light-${browserName}.png`) });
    await theme('dark');
    return { ...H.verdict({ dark: dark >= 4.5, light: light >= 4.5 }), dark, light };
  });

  def('trace-one-fill', async ({ page }) => {
    await H.fresh(page);
    await page.click('[data-osc="studio.play"]');
    await H.waitState(page, 'in-sync');
    const r = await page.evaluate(() => new Promise((resolve) => {
      const list = document.querySelector('[data-osc="studio.inspector.traceOps"]');
      const seen = [];
      // One callback per batch of DOM changes: a fill is one batch, read once it is done.
      const obs = new MutationObserver(() => {
        seen.push(list.querySelector('summary').textContent);
      });
      obs.observe(list, { childList: true });
      window.OSCILLA.studio.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'osc-1',
        key: 'detune', value: 11 });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        obs.disconnect();
        resolve(seen);
      }));
    }));
    await page.evaluate(() => window.OSCILLA.app.studioStop());
    return { ...H.verdict({
      once: r.length === 1,
      complete: /Detune · committed, revision \d+$/.test(r[0] || ''),
    }), r };
  });

  def('trace-focus', async ({ page }) => {
    await H.fresh(page);
    await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'NODE_PARAM_SET',
      nodeId: 'osc-1', key: 'detune', value: 1 }));
    await H.frames(page);
    await page.focus(`${TR} summary`);
    const before = await page.evaluate(() => document.activeElement.getAttribute('data-key'));
    for (let i = 0; i < 13; i += 1) {
      await page.evaluate((v) => window.OSCILLA.studio.store.dispatch({ type: 'NODE_PARAM_SET',
        nodeId: 'osc-1', key: 'detune', value: v }), i + 2);
    }
    await H.frames(page);
    const after = await page.evaluate(() => ({
      body: document.activeElement === document.body,
      osc: document.activeElement.getAttribute('data-osc'),
      listed: [...document.querySelectorAll('[data-osc="studio.inspector.traceOps"] summary')]
        .length,
    }));
    return { ...H.verdict({
      focusedOp: /^trace:op-\d+$/.test(before || ''),
      notBody: !after.body,
      heading: after.osc === 'studio.inspector.title',
      capped: after.listed === 12,
    }), before, after };
  });

  def('screenshots', async ({ page, browserName }) => {
    await H.fresh(page);
    await page.click('[data-osc="studio.play"]');
    await H.waitState(page, 'in-sync');
    await page.evaluate((sel) => { document.querySelector(`${sel} details`).open = true; }, RT);
    await H.frames(page);
    await page.screenshot({ path: path.join(OUT, `runtime-desktop-${browserName}.png`) });
    await page.evaluate(() => window.OSCILLA.app.studioStop());
    return { ok: true };
  });

  def('no-console-errors', async ({ errors }) => ({ ok: errors.length === 0,
    errors: errors.slice(0, 8) }));
  return checks;
}

async function runOne(browserName, baseUrl) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const results = {};
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
  await page.mouse.click(5, 300); // a user gesture so the audio context may start
  await page.evaluate(() => { const a = window.OSCILLA.app; a.alerts = [];
    if (!a.safetyCollapsed) a.collapseSafety(); });
  for (const { name, fn } of defineChecks()) {
    if (ONLY && !ONLY.has(name) && name !== 'no-console-errors') continue;
    const t0 = Date.now();
    try {
      const v = await Promise.race([
        fn({ page, context, browser, errors, browserName, baseUrl }),
        sleep(60000).then(() => ({ ok: false, detail: 'timeout 60 s' })),
      ]);
      results[name] = { ...v, ms: Date.now() - t0 };
    } catch (e) {
      results[name] = { ok: false, detail: String(e.message || e).split('\n')[0],
        ms: Date.now() - t0 };
    }
  }
  try {
    await page.evaluate(() => window.OSCILLA.app.studioStop());
  } catch { /* page gone */ }
  await browser.close();
  return results;
}

(async () => {
  await RUN.ready();
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const all = {};
  let failed = 0;
  for (const b of BROWSERS) {
    const key = `${b}/file`;
    const t0 = Date.now();
    const res = await runOne(b, pathToFileURL(DIST).href);
    all[key] = res;
    const names = Object.keys(res);
    RUN.reportLeg({ leg: key, checks: names.length });
    const bad = names.filter((n) => !res[n].ok);
    failed += bad.length;
    console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/v31-studio-runtime: ${names.length
      - bad.length}/${names.length} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    for (const n of bad) {
      const why = res[n].failed ? `failed [${res[n].failed.join(', ')}] ` : '';
      console.log(`   x ${n}: ${why}${JSON.stringify(res[n]).slice(0, 1200)}`);
    }
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(all, null, 2)}\n`);
  process.exit(failed ? 1 : 0);
})();

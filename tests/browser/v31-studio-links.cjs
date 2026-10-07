#!/usr/bin/env node
// OSCILLA V3.1 Studio deep links and browser fullscreen (spec §133-§135, §199-§200; plan V422)
// on the built dist/index.html in chromium, firefox and webkit, from file:// and from a
// GitHub-Pages-like sub-path (http://127.0.0.1:<port>/oscilla/), every check on both.
//
//   node tests/browser/v31-studio-links.cjs [--browsers chromium,firefox,webkit]
//        [--origins file,http] [--only name1,name2] [--json out.json]   (or OSC_BROWSERS=...)
//
// Checks (asserted):
//   deep-link         a fresh page opened at `#m=studio&st=filter-automation&sv=timeline` lands in
//                     STUDIO with that template (unmodified) and the Timeline subview, says so,
//                     and starts nothing (transport stopped, 0 engine and runtime nodes); at
//                     390 px the Timeline is the one panel shown; `#m=studio` alone keeps the
//                     reference template
//   invalid-link      an unknown template / view at load is refused whole with a readable
//                     message and nothing changes (Playground, reference template); the same on
//                     hashchange inside Studio; `st` without `m=studio` is refused
//   no-overwrite      a link to another template while the document has unsaved changes does
//                     not replace it: the Templates dialog opens with the unsaved-changes note
//                     and the linked template named; its explicit Open replaces the document
//   copy-link         Copy link (the toolbar button) writes `#m=studio&st=<id>&sv=<view>` for an
//                     unmodified template (address bar, and clipboard or the link dialog); a
//                     fresh page opened at that URL lands on the same template and view; after
//                     an edit the link carries the workspace and view only and says why
//   fullscreen        the toolbar button is labelled and keyboard reachable; where the
//                     Fullscreen API exists it puts #osc-view-studio fullscreen (aria-pressed,
//                     the view fills the screen, the graph keeps a size, focus stays on the
//                     button) and back; leaving the workspace exits fullscreen; what Escape
//                     does in this browser is printed (the browser owns it, §135)
//   fullscreen-absent with the API removed (as on iPhone Safari) the button stays, aria-disabled,
//                     with the reason as its title, and a press says why instead of failing
//   no-console-errors
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist', 'index.html');
const RUN = suite.open({ name: 'v31-studio-links', browsers: arg('browsers'),
  origins: arg('origins'), defaultOrigins: ['file', 'http'] });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const ORIGINS = RUN.origins;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const JSON_OUT = arg('json', '');
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-studio-links-'));
  fs.mkdirSync(path.join(root, 'oscilla'));
  fs.copyFileSync(DIST, path.join(root, 'oscilla', 'index.html'));
  const port = 9600 + Math.floor(Math.random() * 300);
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1',
    '--directory', root], { stdio: 'ignore' });
  return { proc, root, url: `http://127.0.0.1:${port}/oscilla/` };
}

async function waitForServer(url) {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not yet */ }
    await sleep(100);
  }
  throw new Error(`server did not start: ${url}`);
}

// ------------------------------------------------------------------------------ page helpers
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
  /** A fresh page (a real load, not a hashchange) at `url`, ready. */
  open: async (ctx, url) => {
    const page = await ctx.context.newPage();
    page.setDefaultTimeout(15000);
    page.on('console', (m) => { if (m.type() === 'error') ctx.errors.push(m.text()); });
    page.on('pageerror', (e) => ctx.errors.push(`pageerror: ${e.message}`));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
    await H.until(() => page.evaluate(() => !!(window.OSCILLA.app
      && window.OSCILLA.app.studio.ready)), (v) => v);
    await H.frames(page);
    return page;
  },
  state: (page) => page.evaluate(() => {
    const a = window.OSCILLA.app;
    const s = window.OSCILLA.studio;
    const c = s.counts();
    return { workspace: a.workspace, mode: document.querySelector('#osc-app').dataset.mode,
      subview: a.studio.subview, templateId: s.templateId, title: a.studio.title,
      dirty: s.dirty, hash: window.location.hash,
      playing: c.playing, engineNodes: c.engineNodes, engineSources: c.engineSources,
      runtimeNodes: c.runtimeNodes, instrumentPlaying: !!a.playing,
      alerts: a.alerts.map((x) => `${x.level}: ${x.title}: ${x.message}`) };
  }),
  silent: (st) => !st.playing && !st.instrumentPlaying && st.engineNodes === 0
    && st.engineSources === 0 && st.runtimeNodes === 0,
  visiblePanels: (page) => page.evaluate(() => ['graph', 'timeline', 'inspector']
    .filter((v) => document.querySelector(`.osc-st-${v}`).offsetParent !== null)),
};

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });

  def('deep-link', async (ctx) => {
    const page = await H.open(ctx, `${ctx.baseUrl}#m=studio&st=filter-automation&sv=timeline`);
    await sleep(300); // anything that would start late has had its chance
    const st = await H.state(page);
    await page.close();
    // The phone layout: the linked subview is the one panel shown.
    const phone = await ctx.browser.newContext({ viewport: { width: 390, height: 844 } });
    const pctx = { ...ctx, context: phone };
    const p2 = await H.open(pctx, `${ctx.baseUrl}#m=studio&st=basic-tone&sv=inspector`);
    const phoneSt = await H.state(p2);
    const panels = await H.visiblePanels(p2);
    await phone.close();
    const p3 = await H.open(ctx, `${ctx.baseUrl}#m=studio`);
    const bare = await H.state(p3);
    await p3.close();
    return { ...H.verdict({
      studio: st.workspace === 'studio' && st.mode === 'studio',
      template: st.templateId === 'filter-automation' && st.title === 'Filter Automation'
        && !st.dirty,
      subview: st.subview === 'timeline',
      said: st.alerts.some((a) => /Studio opened from the link: Template Filter Automation, /
        .test(a) && /Nothing plays/.test(a)),
      silent: H.silent(st),
      phone: phoneSt.workspace === 'studio' && phoneSt.templateId === 'basic-tone'
        && phoneSt.subview === 'inspector' && panels.length === 1 && panels[0] === 'inspector'
        && H.silent(phoneSt),
      bare: bare.workspace === 'studio' && bare.templateId === 'subtractive-synth'
        && bare.subview === 'graph' && H.silent(bare),
    }), st, phone: { ...phoneSt, panels }, bare };
  });

  def('invalid-link', async (ctx) => {
    const page = await H.open(ctx, `${ctx.baseUrl}#m=studio&st=no-such-template&sv=mixer`);
    const st = await H.state(page);
    // Inside Studio, a bad link on hashchange changes nothing either.
    await page.evaluate(() => { const a = window.OSCILLA.app; a.alerts = [];
      a.setWorkspace('studio'); a.studioSetSubview('graph'); });
    await page.evaluate(() => { window.location.hash = '#m=studio&sv=timeline&sv=graph'; });
    const dup = await H.until(() => H.state(page), (s) => s.alerts.length > 0);
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    await page.evaluate(() => { window.location.hash = '#st=basic-tone'; });
    const noMode = await H.until(() => H.state(page), (s) => s.alerts.length > 0);
    await page.close();
    const refused = (s) => s.alerts.some((a) => /^warning: Studio link not applied: /.test(a)
      && /Nothing was changed\.$/.test(a));
    return { ...H.verdict({
      refusedAtLoad: refused(st) && st.alerts.some((a) => /unknown Studio template /.test(a)
        && /"no-such-template"/.test(a) && /unknown Studio view "mixer"/.test(a)),
      unchangedAtLoad: st.workspace === 'playground' && st.templateId === 'subtractive-synth'
        && st.subview === 'graph' && H.silent(st),
      refusedOnHashchange: refused(dup) && dup.alerts.some((a) => /"sv" appears more than once/
        .test(a)) && dup.subview === 'graph' && dup.templateId === 'subtractive-synth',
      needsMode: refused(noMode) && noMode.alerts.some((a) => /needs m=studio/.test(a))
        && noMode.templateId === 'subtractive-synth',
    }), st, dup, noMode };
  });

  def('no-overwrite', async (ctx) => {
    const page = await H.open(ctx, `${ctx.baseUrl}#m=studio&st=stereo-beat`);
    await page.evaluate(() => {
      const s = window.OSCILLA.studio;
      const n = s.model.graph.nodes[0];
      s.store.dispatch({ type: 'NODE_MOVE', nodeId: n.id,
        position: { x: n.position.x + 48, y: n.position.y } });
      window.OSCILLA.app.alerts = [];
    });
    const before = await H.state(page);
    await page.evaluate(() => { window.location.hash = '#m=studio&st=basic-tone'; });
    await page.waitForSelector('#osc-dlg-studio-templates[open]', { timeout: 15000 });
    await H.frames(page);
    const waiting = await H.state(page);
    const dialog = await page.evaluate(() => ({
      dirtyNote: document.querySelector('[data-osc="studio.templates.dirty"]')
        .offsetParent !== null,
      pending: document.querySelector('[data-osc="studio.templates.linkPending"]').textContent
        .replace(/\s+/g, ' ').trim(),
      pendingShown: document.querySelector('[data-osc="studio.templates.linkPending"]')
        .offsetParent !== null }));
    await page.click('[data-osc="studio.template.open"][data-template="basic-tone"]');
    await H.frames(page);
    const after = await H.state(page);
    await page.close();
    return { ...H.verdict({
      dirtyBefore: before.dirty && before.templateId === 'stereo-beat',
      notReplaced: waiting.templateId === 'stereo-beat' && waiting.dirty
        && waiting.title === before.title,
      told: dialog.dirtyNote && dialog.pendingShown && /asks for Basic Tone/.test(dialog.pending)
        && waiting.alerts.some((a) => /Studio link waits for you/.test(a)),
      explicitOpen: after.templateId === 'basic-tone' && !after.dirty && H.silent(after),
    }), before, waiting, dialog, after };
  });

  def('copy-link', async (ctx) => {
    if (ctx.browserName === 'chromium') {
      try {
        await ctx.context.grantPermissions(['clipboard-read', 'clipboard-write']);
      } catch { /* the dialog path is checked instead */ }
    }
    const page = await H.open(ctx, ctx.baseUrl);
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.setWorkspace('studio');
      a.studioLoadTemplate('sweep-sequence');
      a.studioSetSubview('timeline');
      a.alerts = [];
    });
    await H.frames(page);
    await page.focus('[data-osc="studio.copyLink"]');
    await page.keyboard.press('Enter');
    await H.until(() => page.evaluate(() => window.OSCILLA.app.studio.link), (v) => !!v);
    await H.frames(page);
    const copied = await page.evaluate(() => {
      const a = window.OSCILLA.app;
      const dlg = document.querySelector('#osc-dlg-studio-link[open]');
      return { href: window.location.href, link: a.studio.link, note: a.studio.linkNote,
        dialog: !!dlg, field: dlg ? document.querySelector('[data-osc="studio.linkUrl"]').value
          : null,
        toast: a.alerts.some((x) => x.title === 'Studio link copied') };
    });
    let clip = null;
    if (!copied.dialog) {
      clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    }
    await page.evaluate(() => {
      for (const d of document.querySelectorAll('dialog[open]')) d.close();
    });
    // Edited: the link names only the workspace and the view, and says why.
    await page.evaluate(() => {
      const s = window.OSCILLA.studio;
      const n = s.model.graph.nodes[0];
      s.store.dispatch({ type: 'NODE_MOVE', nodeId: n.id,
        position: { x: n.position.x + 48, y: n.position.y } });
      window.OSCILLA.app.studioSetSubview('inspector');
    });
    const edited = await page.evaluate(() => window.OSCILLA.app.studioCopyLink());
    await page.evaluate(() => {
      for (const d of document.querySelectorAll('dialog[open]')) d.close();
    });
    await page.close();
    const p2 = await H.open(ctx, copied.link);
    const reopened = await H.state(p2);
    await p2.close();
    const expected = '#m=studio&st=sweep-sequence&sv=timeline';
    return { ...H.verdict({
      written: copied.link.endsWith(expected) && copied.href === copied.link
        && copied.link.startsWith(ctx.baseUrl.split('#')[0]),
      delivered: (copied.dialog && copied.field === copied.link)
        || (copied.toast && (clip === null || clip === copied.link)),
      noted: /template Sweep Sequence in the Timeline view/.test(copied.note),
      roundTrip: reopened.workspace === 'studio' && reopened.templateId === 'sweep-sequence'
        && reopened.subview === 'timeline' && !reopened.dirty && H.silent(reopened),
      editedLink: !!edited && edited.url.endsWith('#m=studio&sv=inspector')
        && edited.templateId === null && /is not an unmodified template/.test(edited.note),
    }), copied: { ...copied, clip }, edited: edited && { url: edited.url, note: edited.note },
    reopened };
  });

  def('fullscreen', async (ctx) => {
    const page = await H.open(ctx, `${ctx.baseUrl}#m=studio`);
    const btn = '[data-osc="studio.fullscreen"]';
    const info = await page.evaluate((sel) => {
      const b = document.querySelector(sel);
      const r = b.getBoundingClientRect();
      return { api: !!(document.fullscreenEnabled || document.webkitFullscreenEnabled),
        label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'),
        disabled: b.getAttribute('aria-disabled'), visible: r.width > 0 && r.height > 0,
        tabbable: b.tabIndex >= 0 && !b.disabled };
    }, btn);
    if (!info.api) {
      await page.close();
      return { ...H.verdict({ labelled: info.label === 'Browser fullscreen',
        offeredAsUnavailable: info.disabled === 'true' && info.visible }), info,
      note: 'no Fullscreen API in this browser' };
    }
    const fsState = () => page.evaluate((sel) => {
      const view = document.getElementById('osc-view-studio');
      const el = document.fullscreenElement || document.webkitFullscreenElement;
      const r = view.getBoundingClientRect();
      const g = document.querySelector('[data-osc="studio.graph"]').getBoundingClientRect();
      const b = document.querySelector(sel);
      return { on: el === view, flag: window.OSCILLA.app.studio.fullscreen,
        pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'),
        focus: document.activeElement && document.activeElement.dataset
          ? document.activeElement.dataset.osc || document.activeElement.tagName : null,
        w: Math.round(r.width), h: Math.round(r.height), sw: window.innerWidth,
        sh: window.innerHeight, graphW: Math.round(g.width), graphH: Math.round(g.height) };
    }, btn);
    await page.focus(btn);
    await page.keyboard.press('Enter');
    const on = await H.until(fsState, (s) => s.on && s.flag);
    await H.frames(page, 3);
    const onLaid = await fsState();
    await page.keyboard.press('Enter'); // the same button, still focused, exits
    const off = await H.until(fsState, (s) => !s.on && !s.flag);
    // Leaving the workspace exits fullscreen (the hidden view must not stay fullscreen).
    await page.focus(btn);
    await page.keyboard.press('Enter');
    await H.until(fsState, (s) => s.on && s.flag);
    await page.evaluate(() => window.OSCILLA.app.studioBack());
    const left = await H.until(fsState, (s) => !s.on && !s.flag);
    // Escape belongs to the browser while fullscreen (§135): record what it does here.
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('studio'));
    await H.frames(page);
    await page.focus(btn);
    await page.keyboard.press('Enter');
    await H.until(fsState, (s) => s.on && s.flag);
    await page.evaluate(() => {
      window.__escSeen = 0;
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__escSeen += 1; },
        { capture: true });
    });
    await page.keyboard.press('Escape');
    const esc = await H.until(fsState, (s) => !s.on, 1500);
    const escSeen = await page.evaluate(() => window.__escSeen);
    await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen()
      : null)).catch(() => {});
    console.log(`   ${ctx.browserName}/${ctx.origin} Escape while fullscreen: `
      + `${esc.on ? 'stays fullscreen (synthetic key; the browser keeps its own Escape)'
        : 'exits fullscreen'}; the page ${escSeen ? 'also receives' : 'does not receive'} the key`);
    await page.close();
    return { ...H.verdict({
      labelled: info.label === 'Browser fullscreen' && info.pressed === 'false'
        && info.disabled === 'false' && info.visible && info.tabbable,
      entered: on.on && on.flag && on.pressed === 'true' && on.label === 'Exit browser fullscreen',
      fills: onLaid.w >= onLaid.sw - 2 && onLaid.h >= onLaid.sh - 2 && onLaid.graphW > 200
        && onLaid.graphH > 100,
      focusKept: on.focus === 'studio.fullscreen' && off.focus === 'studio.fullscreen',
      exited: !off.on && !off.flag && off.pressed === 'false',
      leavingExits: !left.on && !left.flag,
    }), info, on: onLaid, off, left, escapeExits: !esc.on, escapeReachesPage: escSeen > 0 };
  });

  def('fullscreen-absent', async (ctx) => {
    const page = await ctx.context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') ctx.errors.push(m.text()); });
    page.on('pageerror', (e) => ctx.errors.push(`pageerror: ${e.message}`));
    await page.addInitScript(() => {
      for (const k of ['requestFullscreen', 'webkitRequestFullscreen']) {
        try { delete Element.prototype[k]; } catch { /* not configurable */ }
        try { delete HTMLElement.prototype[k]; } catch { /* not configurable */ }
      }
    });
    await page.goto(`${ctx.baseUrl}#m=studio`, { waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
    await H.until(() => page.evaluate(() => !!(window.OSCILLA.app
      && window.OSCILLA.app.studio.ready)), (v) => v);
    await H.frames(page);
    const btn = await page.evaluate(() => {
      const b = document.querySelector('[data-osc="studio.fullscreen"]');
      const r = b.getBoundingClientRect();
      return { removed: typeof document.body.requestFullscreen !== 'function',
        disabled: b.getAttribute('aria-disabled'), title: b.getAttribute('title'),
        visible: r.width > 0 && r.height > 0 };
    });
    // aria-disabled keeps it focusable (the reason stays reachable); Enter says why.
    await page.focus('[data-osc="studio.fullscreen"]');
    await page.keyboard.press('Enter');
    await H.frames(page);
    const after = await page.evaluate(() => ({
      alerts: window.OSCILLA.app.alerts.map((a) => `${a.title}: ${a.message}`),
      fs: !!document.fullscreenElement, flag: window.OSCILLA.app.studio.fullscreen }));
    await page.close();
    return { ...H.verdict({
      apiRemoved: btn.removed,
      offeredWithReason: btn.disabled === 'true' && btn.visible
        && /does not offer fullscreen/.test(btn.title || ''),
      saysWhy: after.alerts.some((a) => /^Fullscreen not available: This browser does not/
        .test(a)) && !after.fs && !after.flag,
    }), btn, after };
  });

  def('no-console-errors', async ({ errors }) => ({ ok: errors.length === 0,
    errors: errors.slice(0, 8) }));
  return checks;
}

// ------------------------------------------------------------------------------ runner
async function runOne(browserName, origin, baseUrl) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 } });
  const errors = [];
  const results = {};
  for (const { name, fn } of defineChecks()) {
    if (ONLY && !ONLY.has(name) && name !== 'no-console-errors') continue;
    const t0 = Date.now();
    try {
      const v = await Promise.race([
        fn({ browser, context, errors, browserName, origin, baseUrl }),
        sleep(90000).then(() => ({ ok: false, detail: 'timeout 90 s' })),
      ]);
      results[name] = { ...v, ms: Date.now() - t0 };
    } catch (e) {
      results[name] = { ok: false, detail: String(e.message || e).split('\n')[0],
        ms: Date.now() - t0 };
    }
    for (const p of context.pages()) await p.close().catch(() => {});
  }
  await browser.close();
  return results;
}

(async () => {
  await RUN.ready();
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  const server = ORIGINS.includes('http') ? startServer() : null;
  if (server) await waitForServer(server.url);
  const all = {};
  let failed = 0;
  try {
    for (const b of BROWSERS) {
      for (const o of ORIGINS) {
        const base = o === 'file' ? pathToFileURL(DIST).href : server.url;
        const key = `${b}/${o}`;
        const t0 = Date.now();
        const res = await runOne(b, o, base);
        all[key] = res;
        const names = Object.keys(res);
        RUN.reportLeg({ leg: key, checks: names.length });
        const bad = names.filter((n) => !res[n].ok);
        failed += bad.length;
        console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/v31-studio-links: ${names.length
          - bad.length}/${names.length} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        for (const n of bad) {
          const why = res[n].failed ? `failed [${res[n].failed.join(', ')}] ` : '';
          console.log(`   x ${n}: ${why}${JSON.stringify(res[n]).slice(0, 1600)}`);
        }
      }
    }
  } finally {
    if (server) {
      server.proc.kill();
      fs.rmSync(server.root, { recursive: true, force: true });
    }
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(all, null, 2)}\n`);
  process.exit(failed ? 1 : 0);
})();

#!/usr/bin/env node
// OSCILLA V3.1 Studio workspace and graph editor gate: the built dist/index.html in chromium,
// firefox and webkit, from file:// (every check) and from a GitHub-Pages-like sub-path
// (http://127.0.0.1:<port>/oscilla/, the smoke checks). Spec §50-§80, §118-§141, §185,
// §194-§197, §206, §214-§215; plan V409-V413, V421-V423 UI, V426 UI, V428-V429.
//
//   node tests/browser/v31-studio-graph.cjs [--browsers chromium,firefox,webkit]
//        [--origins file,http] [--only name1,name2] [--json out.json]   (or OSC_BROWSERS=...)
//
// Every check starts from a shipped template (§256: templates are the fixtures) through the real
// UI path (studioLoadTemplate) and drives the editor with real pointer and keyboard input
// (page.mouse, page.keyboard, page.touchscreen); the model is read back through
// window.OSCILLA.studio (the ONE store). Checks (asserted):
//   controls-labelled    every interactive Studio control (view and dialogs, in every state
//                        that shows one) is visible somewhere, named and keyboard-reachable
//   nav-and-render       Studio sits before About; the Subtractive Synth renders 6 nodes, 5
//                        cables, typed port glyphs, the graph summary; no horizontal overflow
//   library-add          click inserts at the viewport centre, drag drops at the pointer (logical
//                        coordinates); undo / redo; one Master Output (the item is disabled)
//   node-drag            a mouse drag moves the node (snapped to the 8-unit grid), the attached
//                        cables follow, ONE history entry; undo restores the position exactly
//   cable-connect        drag from an output to a compatible input → EDGE_ADD, announced
//   cable-reject         audio output onto a control input → no edge, the type reason announced;
//                        an instantaneous feedback loop → refused with the §39 sentence
//   cable-to-blank       a cable dropped on blank canvas opens the picker of compatible types;
//                        choosing one adds the node AND the connection as one undo entry
//   select-delete-cable  clicking a cable selects it (Inspector: Connection); Delete removes it
//   multi-select         Shift-click, Shift-drag rectangle; Ctrl/Cmd C, V (new ids, offset,
//                        internal edges kept), Ctrl/Cmd D; Delete removes nodes and their edges;
//                        focus lands on a node, never on <body>
//   pan-zoom-frame       blank-canvas drag pans, wheel zooms at the pointer (logical point kept),
//                        buttons and F / A frame; view changes are not undoable and not dirty
//   inspector            typed cutoff "2.4k" → 2400 Hz; invalid text refused with the range;
//                        a slider drag is one history entry; AUTOMATE creates / reveals a lane;
//                        rename; clip start/duration
//   keyboard-connect     keyboard only: focus a node, C opens the list of compatible inputs,
//                        Enter connects; arrows nudge (one entry per key sequence)
//   focus-never-body     V431 review: Tab after a press that moved no focus selects the
//                        focused node (Delete removes it, not the old selection); undo /
//                        redo, a disabled Undo button, the timeline, the compact chips and
//                        Back never leave focus on <body>
//   escape-priority      Escape cancels a cable drag (no edge), then tap-connect mode, and
//                        only then stops audio (§185)
//   play-stop            PLAY starts the runtime on the engine, edits while playing re-apply,
//                        STOP / Escape release every node (0 engine nodes and sources);
//                        exclusivity: Playground play stops the Studio; the Playground still
//                        plays and stops afterwards
//   compact-sync         the Playground compact widget is the same store: a clip moved there
//                        (keyboard) is the clip the full Studio shows; a Filter added in the
//                        full Studio appears in the compact signal path; EXPAND opens Studio
//   templates            the gallery opens each template; Measurement Sweep shows the
//                        Microphone as unavailable/degraded with a reason (§171)
//   patches-files        save project locally, Open dialog lists it; export .oscilla-studio.json
//                        and re-import it (identical semantics); save a selection as a patch,
//                        insert it (undoable); malformed and hostile files are refused
//   mobile-tap-connect   375 x 812 touch: GRAPH / TIMELINE / INSPECTOR subviews; tap an output,
//                        tap a highlighted input → connected; 44 px toolbar targets
//   light-theme          node titles, port labels and cables keep contrast on the light theme
//   screenshots          tests/visual/out-studio/ (not committed): desktop, phone, light
//   no-console-errors
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DIST = path.resolve(__dirname, '..', '..', 'dist', 'index.html');
const OUT = path.resolve(__dirname, '..', 'visual', 'out-studio');
const BROWSERS = arg('browsers', process.env.OSC_BROWSERS || 'chromium,firefox,webkit').split(',');
const ORIGINS = arg('origins', 'file,http').split(',');
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const JSON_OUT = arg('json', '');
const HTTP_CHECKS = new Set(['nav-and-render', 'node-drag', 'cable-connect', 'play-stop',
  'patches-files', 'no-console-errors']);
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};
const FEEDBACK = 'Connection rejected: This would create an unsupported instantaneous audio '
  + 'feedback loop.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

function startServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-studio-'));
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
  /** Open the Studio workspace on a fresh template document. */
  fresh: async (page, id = 'subtractive-synth') => {
    await page.evaluate(async (tid) => {
      const a = window.OSCILLA.app;
      const s = window.OSCILLA.studio;
      if (s.transport && s.transport.playing) await a.studioStop();
      a.alerts = [];
      for (const d of document.querySelectorAll('dialog[open]')) d.close();
      if (a.workspace !== 'studio') a.setWorkspace('studio');
      a.studioLoadTemplate(tid);
    }, id);
    await page.waitForFunction(() => document.querySelector('#osc-app').dataset.mode === 'studio');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() =>
      requestAnimationFrame(r))));
    await page.evaluate(() => window.OSCILLA.studio.editor.frameAll());
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() =>
      requestAnimationFrame(r))));
  },
  model: (page) => page.evaluate(() => {
    const m = window.OSCILLA.studio.model;
    return { nodes: m.graph.nodes.map((n) => ({ id: n.id, type: n.type, x: n.position.x,
      y: n.position.y, name: n.metadata.name, params: n.params })),
    edges: m.graph.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, props: e.props })),
    clips: m.timeline.clips.map((c) => ({ id: c.id, start: c.start, duration: c.duration })),
    view: m.view.graph };
  }),
  sel: (page) => page.evaluate(() => {
    const s = window.OSCILLA.studio.selection;
    return { nodes: [...s.nodes], edges: [...s.edges], clips: [...s.clips] };
  }),
  undoDepth: (page) => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth),
  /** Screen centre of an element selected in the page. */
  center: (page, sel) => page.evaluate((q) => {
    const el = document.querySelector(q);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }, sel),
  port: (node, dir, port) => `.osc-sg-node[data-node-id="${node}"] .osc-sg-port[data-dir="${dir}"]`
    + `[data-port="${port}"] .osc-sg-glyph`,
  nodeTitle: (node) => `.osc-sg-node[data-node-id="${node}"] .osc-sg-title`,
  drag: async (page, a, b, steps = 12) => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + (b.x - a.x) / steps, a.y + (b.y - a.y) / steps);
    await page.mouse.move(b.x, b.y, { steps });
    await page.mouse.up();
    await sleep(60);
  },
  /** Record every text the two Studio live regions receive. */
  recordLive: (page) => page.evaluate(() => {
    if (window.__studioLive) { window.__studioLive.length = 0; return; }
    const log = [];
    window.__studioLive = log;
    for (const sel of ['[data-osc="studio.live"]', '[data-osc="studio.alert"]']) {
      const el = document.querySelector(sel);
      new MutationObserver(() => {
        const t = el.textContent.replace(/\u200b/g, '');
        if (t) log.push(t);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    }
  }),
  live: (page) => page.evaluate(() => (window.__studioLive || []).slice()),
  counts: (page) => page.evaluate(() => window.OSCILLA.studio.counts()),
  frames: (page, n = 2) => page.evaluate((k) => new Promise((r) => {
    let i = 0;
    const f = () => (++i >= k ? r() : requestAnimationFrame(f));
    requestAnimationFrame(f);
  }), n),
};

/**
 * In-page: every interactive [data-osc] control of the Studio view and the Studio dialogs, with
 * its accessible name, visibility and keyboard reachability (the app.cjs audit, scoped).
 */
function auditStudio() {
  const INTERACTIVE = 'button, input, select, textarea, a[href], [role="switch"], [role="tab"],'
    + ' [role="radio"], [tabindex]:not([tabindex="-1"])';
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const name = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => text(document.getElementById(id))).join(' ').trim();
      if (t) return t;
    }
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab && text(lab)) return text(lab);
    }
    const wrap = el.closest('label');
    if (wrap && text(wrap)) return text(wrap);
    if (['BUTTON', 'A'].includes(el.tagName) || el.getAttribute('role')) {
      if (text(el)) return text(el);
    }
    return el.title || '';
  };
  const visible = (el) => {
    if (el.closest('[hidden]') || el.closest('dialog:not([open])')) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const reachable = (el) => {
    if (el.tabIndex >= 0) return true;
    const role = el.getAttribute('role');
    return (role === 'radio' || role === 'tab') && [...el.parentElement.children]
      .some((x) => x.getAttribute('role') === role && x.tabIndex >= 0);
  };
  const out = [];
  document.querySelectorAll('#osc-view-studio [data-osc], [data-osc-studio-dialog] [data-osc]')
    .forEach((el) => {
      if (!el.matches(INTERACTIVE)) return;
      out.push({ osc: el.dataset.osc, name: name(el), visible: visible(el),
        reachable: reachable(el) });
    });
  return out;
}

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });

  def('controls-labelled', async ({ page }) => {
    await H.fresh(page);
    const seen = new Map();
    const collect = async () => {
      for (const c of await page.evaluate(auditStudio)) {
        const prev = seen.get(c.osc);
        seen.set(c.osc, { ...c, visible: c.visible || !!(prev && prev.visible),
          unnamed: (prev && prev.unnamed) || (c.visible && !c.name),
          unreachable: (prev && prev.unreachable) || (c.visible && !c.reachable) });
      }
    };
    const step = async (fn) => { await fn(); await H.frames(page); await collect(); };
    const close = () => page.evaluate(() => {
      for (const d of document.querySelectorAll('dialog[open]')) d.close();
    });
    await collect();
    await step(() => page.click(H.nodeTitle('filter-1')));
    await step(() => page.evaluate(() => window.OSCILLA.studio.store.dispatch({
      type: 'SELECTION_CHANGE', selection: { edges: ['edge-4'] } })));
    await step(() => page.evaluate(() => window.OSCILLA.studio.store.dispatch({
      type: 'SELECTION_CHANGE', selection: { clips: ['clip-1'] } })));
    await step(() => page.evaluate(() => window.OSCILLA.studio.store.dispatch({
      type: 'SELECTION_CHANGE', selection: { points: ['pt-1'] } })));
    await step(() => page.evaluate(() => window.OSCILLA.studio.store.dispatch({
      type: 'SELECTION_CHANGE', selection: { nodes: ['osc-1', 'env-1'] } })));
    await step(() => page.click(H.port('lfo-1', 'out', 'control'))); // tap-connect banner
    await page.keyboard.press('Escape');
    for (const open of ['studio.templates', 'studio.keys', 'studio.add', 'studio.find',
      'studio.renderWav']) {
      await step(() => page.click(`[data-osc="${open}"]`));
      await close();
    }
    // The task strip of a running render (its Abort button): a long render, aborted.
    await page.evaluate(() => { window.__auditRender = window.OSCILLA.app.studioRenderWav({
      duration: 60 }); });
    await step(() => Promise.resolve());
    await page.evaluate(() => { window.OSCILLA.app.studioAbortTask();
      return window.__auditRender; });
    await page.click(H.nodeTitle('filter-1'));
    await step(() => page.click('[data-osc="studio.inspector.connect"]'));
    await close();
    await page.click(H.nodeTitle('osc-1'));
    await step(() => page.click('[data-osc="studio.inspector.savePatch"]'));
    await page.fill('[data-osc="studio.patch.name"]', 'Audit');
    await page.click('[data-osc="studio.patch.save"]');
    await sleep(150);
    // The same name again: the explicit replace confirmation (§155).
    await page.click('[data-osc="studio.inspector.savePatch"]');
    await page.fill('[data-osc="studio.patch.name"]', 'Audit');
    await step(() => page.click('[data-osc="studio.patch.save"]'));
    await close();
    // A node with two outputs: the output choice of the connection dialog.
    await page.evaluate(() => {
      const s = window.OSCILLA.studio.store;
      const r = s.dispatch({ type: 'NODE_ADD', nodeType: 'sweep', position: { x: 40, y: 520 } });
      s.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: r.created.nodes } });
    });
    await H.frames(page);
    await step(() => page.click('[data-osc="studio.inspector.connect"]'));
    await close();
    // Copy link without a clipboard: the link dialog (V422).
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined,
      configurable: true }));
    await step(() => page.click('[data-osc="studio.copyLink"]'));
    await close();
    await page.click('[data-osc="studio.save"]');
    await sleep(150);
    await step(() => page.click('[data-osc="studio.open"]'));
    await sleep(150);
    await collect();
    await close();
    // Phone: the subview tabs.
    await page.setViewportSize({ width: 375, height: 812 });
    await sleep(150);
    await collect();
    await page.setViewportSize({ width: 1536, height: 1024 });
    await sleep(150);
    const all = [...seen.values()];
    const never = all.filter((c) => !c.visible).map((c) => c.osc);
    const unnamed = all.filter((c) => c.unnamed).map((c) => c.osc);
    const unreachable = all.filter((c) => c.unreachable).map((c) => c.osc);
    return { ...H.verdict({ audited: all.length >= 40, everyVisible: never.length === 0,
      named: unnamed.length === 0, reachable: unreachable.length === 0 }),
    count: all.length, never, unnamed, unreachable };
  });

  def('nav-and-render', async ({ page }) => {
    const nav = await page.evaluate(() => [...document.querySelectorAll('#osc-nav > li > a')]
      .map((a) => a.dataset.osc));
    await page.click('[data-osc="nav.studio"]');
    await H.fresh(page);
    const v = await page.evaluate(() => ({
      nodes: document.querySelectorAll('.osc-sg-node').length,
      edges: document.querySelectorAll('.osc-sg-edge').length,
      paths: [...document.querySelectorAll('.osc-sg-edge-line')].filter((p) =>
        /^M [\d.-]+ [\d.-]+ C /.test(p.getAttribute('d') || '')).length,
      control: !!document.querySelector('.osc-sg-edge.is-control.is-dashed'),
      shapes: [...new Set([...document.querySelectorAll('.osc-sg-glyph')].map((g) =>
        g.className.baseVal || g.className))].length,
      summary: document.querySelector('[data-osc="studio.graph.summary"]').textContent,
      title: document.querySelector('[data-osc="studio.title"]').textContent,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      current: document.querySelector('#osc-nav [aria-current="page"]').dataset.osc,
      visible: [...document.querySelectorAll('.osc-sg-node')].every((n) => {
        const r = n.getBoundingClientRect();
        const vp = document.querySelector('.osc-sg-viewport').getBoundingClientRect();
        return r.left >= vp.left - 1 && r.right <= vp.right + 1 && r.top >= vp.top - 1
          && r.bottom <= vp.bottom + 1;
      }),
    }));
    return { ...H.verdict({
      studioBeforeAbout: nav.at(-2) === 'nav.studio' && nav.at(-1) === 'nav.about',
      nodes: v.nodes === 6, edges: v.edges === 5 && v.paths === 5, controlDashed: v.control,
      glyphShapes: v.shapes >= 3, title: v.title === 'Subtractive Synth',
      summary: v.summary.startsWith('6 nodes, 5 connections. Signal path: Oscillator 1 to '
        + 'Envelope 1 to Filter 1 to Master.'),
      framed: v.visible, noOverflow: !v.overflow, current: v.current === 'nav.studio',
    }), v };
  });

  def('library-add', async ({ page }) => {
    await H.fresh(page);
    const n0 = (await H.model(page)).nodes.length;
    await page.click('[data-osc="studio.library.item"][data-type="gain"]');
    const m1 = await H.model(page);
    const added = m1.nodes.at(-1);
    const center = await page.evaluate(() => window.OSCILLA.studio.editor.centerPoint());
    const nearCenter = Math.abs(added.x + 84 - center.x) <= 8 && Math.abs(added.y + 18 - center.y)
      <= 8;
    const sel = await H.sel(page);
    // Drag the Pan item onto the graph: the node lands where it is dropped.
    const item = await H.center(page, '[data-osc="studio.library.item"][data-type="pan"]');
    const vp = await H.center(page, '.osc-sg-viewport');
    const drop = { x: vp.x - vp.w / 4, y: vp.y + vp.h / 4 };
    await H.drag(page, item, drop, 16);
    const m2 = await H.model(page);
    const pan = m2.nodes.at(-1);
    const dropLogical = await page.evaluate((p) => window.OSCILLA.studio.editor.clientToGraph(p.x,
      p.y), drop);
    const atDrop = pan.type === 'pan' && Math.abs(pan.x + 84 - dropLogical.x) <= 8
      && Math.abs(pan.y + 18 - dropLogical.y) <= 8;
    await page.click('[data-osc="studio.undo"]');
    const m3 = await H.model(page);
    await page.click('[data-osc="studio.redo"]');
    const m4 = await H.model(page);
    const masterDisabled = await page.evaluate(() => document.querySelector(
      '[data-osc="studio.library.item"][data-type="master"]').disabled);
    // Search filters the library; Enter adds the best match.
    await page.fill('[data-osc="studio.library.search"]', 'vcf');
    const results = await page.evaluate(() => [...document.querySelectorAll(
      '[data-osc="studio.library.item"]')].map((b) => b.dataset.type));
    await page.press('[data-osc="studio.library.search"]', 'Enter');
    const m5 = await H.model(page);
    await page.fill('[data-osc="studio.library.search"]', '');
    return { ...H.verdict({
      clickAdds: m1.nodes.length === n0 + 1 && added.type === 'gain', nearCenter,
      selected: sel.nodes.length === 1 && sel.nodes[0] === added.id,
      dropAdds: m2.nodes.length === n0 + 2, atDrop,
      undo: m3.nodes.length === n0 + 1, redo: m4.nodes.length === n0 + 2,
      oneMaster: masterDisabled, search: results[0] === 'filter',
      enterAdds: m5.nodes.at(-1).type === 'filter',
    }), added, center, pan, dropLogical };
  });

  def('node-drag', async ({ page }) => {
    await H.fresh(page);
    const before = (await H.model(page)).nodes.find((n) => n.id === 'lfo-1');
    const depth0 = await H.undoDepth(page);
    const d0 = await page.evaluate(() => document.querySelector(
      '.osc-sg-edge[data-edge-id="edge-4"] .osc-sg-edge-line').getAttribute('d'));
    const a = await H.center(page, H.nodeTitle('lfo-1'));
    const zoom = (await page.evaluate(() => window.OSCILLA.studio.editor.getView())).zoom;
    await H.drag(page, a, { x: a.x - 80, y: a.y + 40 }, 40);
    const after = (await H.model(page)).nodes.find((n) => n.id === 'lfo-1');
    const d1 = await page.evaluate(() => document.querySelector(
      '.osc-sg-edge[data-edge-id="edge-4"] .osc-sg-edge-line').getAttribute('d'));
    const depth1 = await H.undoDepth(page);
    const expectX = Math.round((before.x - 80 / zoom) / 8) * 8;
    const expectY = Math.round((before.y + 40 / zoom) / 8) * 8;
    await page.keyboard.press(`${MOD}+z`);
    const undone = (await H.model(page)).nodes.find((n) => n.id === 'lfo-1');
    return { ...H.verdict({
      moved: after.x === expectX && after.y === expectY,
      snapped: after.x % 8 === 0 && after.y % 8 === 0,
      cableFollows: d0 !== d1, oneEntry: depth1 === depth0 + 1,
      undoExact: undone.x === before.x && undone.y === before.y,
    }), before, after, expectX, expectY, zoom };
  });

  def('cable-connect', async ({ page }) => {
    await H.fresh(page);
    await H.recordLive(page);
    await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'NODE_ADD',
      nodeType: 'scope', position: { x: 640, y: 520 } }));
    await page.evaluate(() => window.OSCILLA.studio.editor.frameAll());
    await H.frames(page);
    const id = (await H.model(page)).nodes.at(-1).id;
    const a = await H.center(page, H.port('env-1', 'out', 'audio'));
    const b = await H.center(page, H.port(id, 'in', 'audio'));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 20, a.y + 10, { steps: 3 });
    await page.mouse.move(b.x, b.y, { steps: 10 });
    const during = await page.evaluate((nid) => ({
      compatible: !!document.querySelector(`.osc-sg-node[data-node-id="${nid}"] `
        + '.osc-sg-port.is-compatible'),
      dimmed: document.querySelectorAll('.osc-sg-port.is-incompatible').length,
      preview: (document.querySelector('.osc-sg-preview').getAttribute('d') || '').length > 0,
      banner: document.querySelector('[data-osc="studio.graph.banner"]').textContent,
    }), id);
    await page.mouse.up();
    await sleep(80);
    const m = await H.model(page);
    const edge = m.edges.find((e) => e.to.node === id);
    const live = await H.live(page);
    return { ...H.verdict({
      edge: !!edge && edge.from.node === 'env-1' && edge.from.port === 'audio',
      feedback: during.compatible && during.dimmed > 0 && during.preview,
      banner: /Release to connect to Scope 1/.test(during.banner),
      announced: live.some((t) => t === 'Connected Envelope 1 to Scope 1'),
      previewCleared: await page.evaluate(() => !document.querySelector('.osc-sg-preview')
        .getAttribute('d')),
    }), during, live: live.slice(-3) };
  });

  def('cable-reject', async ({ page }) => {
    await H.fresh(page);
    await H.recordLive(page);
    const e0 = (await H.model(page)).edges.length;
    const a = await H.center(page, H.port('osc-1', 'out', 'audio'));
    const b = await H.center(page, H.port('filter-1', 'in', 'Q'));
    await H.drag(page, a, b);
    const m1 = await H.model(page);
    // Feedback: Mixer → Gain, then Gain → Mixer by drag.
    const ids = await page.evaluate(() => {
      const s = window.OSCILLA.studio.store;
      const mix = s.dispatch({ type: 'NODE_ADD', nodeType: 'mixer', position: { x: 40, y: 520 } })
        .created.nodes[0];
      const gain = s.dispatch({ type: 'NODE_ADD', nodeType: 'gain', position: { x: 300, y: 560 } })
        .created.nodes[0];
      s.dispatch({ type: 'EDGE_ADD', from: { node: mix, port: 'audio' },
        to: { node: gain, port: 'audio' } });
      window.OSCILLA.studio.editor.frameAll();
      return { mix, gain };
    });
    await H.frames(page);
    const e1 = (await H.model(page)).edges.length;
    await H.drag(page, await H.center(page, H.port(ids.gain, 'out', 'audio')),
      await H.center(page, H.port(ids.mix, 'in', 'in2')));
    const m2 = await H.model(page);
    const live = await H.live(page);
    return { ...H.verdict({
      typeRefused: m1.edges.length === e0,
      typeReason: live.some((t) => t.startsWith('Connection rejected: Audio output cannot connect '
        + 'to a control input.')),
      feedbackRefused: m2.edges.length === e1,
      feedbackReason: live.some((t) => t.startsWith(FEEDBACK)),
    }), live: live.slice(-4) };
  });

  def('cable-to-blank', async ({ page }) => {
    await H.fresh(page);
    const m0 = await H.model(page);
    const depth0 = await H.undoDepth(page);
    const a = await H.center(page, H.port('lfo-1', 'out', 'control'));
    const vp = await H.center(page, '.osc-sg-viewport');
    await H.drag(page, a, { x: vp.x - vp.w / 2 + 40, y: vp.y + vp.h / 2 - 40 });
    await page.waitForSelector('#osc-dlg-studio-add[open]');
    const types = await page.evaluate(() => [...document.querySelectorAll(
      '[data-osc="studio.add.item"]')].map((b) => b.dataset.type));
    await page.fill('[data-osc="studio.add.search"]', 'gain');
    await page.press('[data-osc="studio.add.search"]', 'Enter');
    await sleep(80);
    const m1 = await H.model(page);
    const gain = m1.nodes.at(-1);
    const edge = m1.edges.find((e) => e.to.node === gain.id);
    const depth1 = await H.undoDepth(page);
    await page.evaluate(() => window.OSCILLA.app.studioUndo());
    const m2 = await H.model(page);
    return { ...H.verdict({
      onlyCompatible: types.includes('gain') && types.includes('oscillator')
        && !types.includes('spectrum') && !types.includes('master'),
      added: gain.type === 'gain' && m1.nodes.length === m0.nodes.length + 1,
      connected: !!edge && edge.from.node === 'lfo-1' && edge.to.port === 'gain',
      oneUndo: depth1 === depth0 + 1,
      undoBoth: m2.nodes.length === m0.nodes.length && m2.edges.length === m0.edges.length,
    }), types };
  });

  def('select-delete-cable', async ({ page }) => {
    await H.fresh(page);
    const pt = await page.evaluate(() => {
      const p = document.querySelector('.osc-sg-edge[data-edge-id="edge-1"] .osc-sg-edge-line');
      const len = p.getTotalLength();
      const q = p.getPointAtLength(len / 2);
      const m = p.getScreenCTM();
      return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f };
    });
    await page.mouse.click(pt.x, pt.y);
    const sel = await H.sel(page);
    const insp = await page.evaluate(() => ({
      title: (document.querySelector('[data-osc="studio.inspector.title"]') || {}).textContent,
      edge: (document.querySelector('[data-osc="studio.inspector.edge"]') || {}).textContent }));
    await page.keyboard.press('Delete');
    const m = await H.model(page);
    const focus = await page.evaluate(() => document.activeElement !== document.body);
    return { ...H.verdict({
      selected: sel.edges.length === 1 && sel.edges[0] === 'edge-1',
      inspector: insp.title === 'Connection' && /Oscillator 1 \/ Audio/.test(insp.edge || ''),
      deleted: !m.edges.some((e) => e.id === 'edge-1') && m.edges.length === 4,
      focusKept: focus,
    }), pt, insp };
  });

  def('multi-select', async ({ page }) => {
    await H.fresh(page);
    await page.click(H.nodeTitle('osc-1'));
    await page.click(H.nodeTitle('env-1'), { modifiers: ['Shift'] });
    const s1 = await H.sel(page);
    // Shift-drag a rectangle around the LFO and the Spectrum from blank canvas.
    const lfo = await page.evaluate(() => document.querySelector(
      '.osc-sg-node[data-node-id="lfo-1"]').getBoundingClientRect().toJSON());
    const spec = await page.evaluate(() => document.querySelector(
      '.osc-sg-node[data-node-id="spectrum-1"]').getBoundingClientRect().toJSON());
    await page.keyboard.down('Shift');
    await H.drag(page, { x: lfo.left - 12, y: Math.max(lfo.bottom, spec.bottom) + 14 },
      { x: spec.left + 30, y: lfo.top + 20 });
    await page.keyboard.up('Shift');
    const s2 = await H.sel(page);
    const m0 = await H.model(page);
    // Copy, paste, duplicate (osc-1 + env-1 with their internal edge).
    await page.click(H.nodeTitle('osc-1'));
    await page.click(H.nodeTitle('env-1'), { modifiers: ['Shift'] });
    await page.keyboard.press(`${MOD}+c`);
    await page.keyboard.press(`${MOD}+v`);
    const m1 = await H.model(page);
    const pasted = m1.nodes.slice(m0.nodes.length);
    const internal = m1.edges.filter((e) => pasted.some((n) => n.id === e.from.node)
      && pasted.some((n) => n.id === e.to.node));
    await page.keyboard.press(`${MOD}+d`);
    const m2 = await H.model(page);
    // Delete the duplicated pair: their edges go too, focus lands on a node.
    await page.keyboard.press('Delete');
    const m3 = await H.model(page);
    const focus = await page.evaluate(() => {
      const a = document.activeElement;
      return a ? (a.closest('.osc-sg-node') ? 'node' : a.tagName) : 'none';
    });
    const origOsc = m0.nodes.find((n) => n.id === 'osc-1');
    return { ...H.verdict({
      shiftClick: s1.nodes.length === 2 && s1.nodes.includes('osc-1') && s1.nodes.includes('env-1'),
      rectangle: s2.nodes.includes('lfo-1') && s2.nodes.includes('spectrum-1'),
      paste: pasted.length === 2 && internal.length === 1
        && pasted.every((n) => !m0.nodes.some((o) => o.id === n.id)),
      pasteOffset: pasted[0].x === origOsc.x + 24 && pasted[0].y === origOsc.y + 24,
      pasteNames: pasted.map((n) => n.name).join() === 'Oscillator 2,Envelope 2',
      duplicate: m2.nodes.length === m1.nodes.length + 2,
      deleteCascade: m3.nodes.length === m1.nodes.length && m3.edges.length === m1.edges.length,
      focusNode: focus === 'node',
    }), s1, s2, focus };
  });

  def('pan-zoom-frame', async ({ page }) => {
    await H.fresh(page);
    const v0 = await page.evaluate(() => window.OSCILLA.studio.editor.getView());
    const depth0 = await H.undoDepth(page);
    const vp = await page.evaluate(() => document.querySelector('.osc-sg-viewport')
      .getBoundingClientRect().toJSON());
    const blank = { x: vp.left + 20, y: vp.bottom - 20 };
    await H.drag(page, blank, { x: blank.x + 60, y: blank.y - 30 });
    const v1 = await page.evaluate(() => window.OSCILLA.studio.editor.getView());
    const target = { x: vp.left + vp.width / 2, y: vp.top + vp.height / 2 };
    const before = await page.evaluate((p) => window.OSCILLA.studio.editor.clientToGraph(p.x, p.y),
      target);
    await page.mouse.move(target.x, target.y);
    await page.mouse.wheel(0, -200);
    await sleep(100);
    const v2 = await page.evaluate(() => window.OSCILLA.studio.editor.getView());
    const after = await page.evaluate((p) => window.OSCILLA.studio.editor.clientToGraph(p.x, p.y),
      target);
    await page.click('[data-osc="studio.graph.zoomIn"]');
    const v3 = await page.evaluate(() => window.OSCILLA.studio.editor.getView());
    await page.click('[data-osc="studio.graph.frameAll"]');
    const v4 = await page.evaluate(() => window.OSCILLA.studio.editor.getView());
    await page.click(H.nodeTitle('master-1'));
    await page.keyboard.press('f');
    const v5 = await page.evaluate(() => window.OSCILLA.studio.editor.getView());
    await sleep(350); // the VIEW_SET commit is debounced (UI bookkeeping only)
    const dirty = await page.evaluate(() => window.OSCILLA.studio.dirty);
    const depth1 = await H.undoDepth(page);
    const zoomText = await page.evaluate(() => document.querySelector(
      '[data-osc="studio.graph.zoom"]').textContent);
    return { ...H.verdict({
      panned: Math.abs(v1.panX - v0.panX - 60) < 1 && Math.abs(v1.panY - v0.panY + 30) < 1,
      wheelZoom: v2.zoom > v1.zoom,
      pointerAnchored: Math.abs(after.x - before.x) < 0.5 && Math.abs(after.y - before.y) < 0.5,
      button: Math.abs(v3.zoom / v2.zoom - 1.2) < 1e-6 || v3.zoom === 2.5,
      frameAll: v4.zoom !== v3.zoom, frameSelection: v5.zoom > v4.zoom,
      notUndoable: depth1 === depth0, notDirty: dirty === false,
      zoomShown: zoomText === `${Math.round(v5.zoom * 100)} %`,
    }), v0, v1, v2, v3, v4, v5 };
  });

  def('inspector', async ({ page }) => {
    await H.fresh(page);
    await H.recordLive(page);
    await page.click(H.nodeTitle('filter-1'));
    const field = '[data-osc="studio.inspector.param"][data-key="frequency"]';
    await page.fill(field, '2.4k');
    await page.press(field, 'Enter');
    const f1 = (await H.model(page)).nodes.find((n) => n.id === 'filter-1').params.frequency;
    await page.fill(field, '5');
    await page.press(field, 'Enter');
    const f2 = (await H.model(page)).nodes.find((n) => n.id === 'filter-1').params.frequency;
    const err = await page.evaluate(() => {
      const e = document.querySelector('.osc-si-field[data-field="frequency"] .osc-si-error');
      return e && !e.hidden ? e.textContent : '';
    });
    // A slider drag is one history entry.
    const depth0 = await H.undoDepth(page);
    const slider = await page.evaluate(() => document.querySelector(
      '.osc-si-field[data-field="Q"] .osc-si-slider').getBoundingClientRect().toJSON());
    await H.drag(page, { x: slider.left + slider.width * 0.2, y: slider.top + slider.height / 2 },
      { x: slider.left + slider.width * 0.7, y: slider.top + slider.height / 2 }, 20);
    await sleep(80);
    const depth1 = await H.undoDepth(page);
    const q = (await H.model(page)).nodes.find((n) => n.id === 'filter-1').params.Q;
    // AUTOMATE (§102): creates the lane at the current value; on an automated parameter it
    // reveals the lane (selects its points).
    await page.click('.osc-si-field[data-field="Q"] [data-osc="studio.inspector.automate"]');
    const lane = await page.evaluate(() => window.OSCILLA.studio.model.timeline.automation
      .filter((l) => l.target.node === 'filter-1').map((l) => `${l.target.param}:${l.points.length}`));
    await page.click('.osc-si-field[data-field="frequency"] [data-osc="studio.inspector.automate"]');
    const revealed = (await H.sel(page)).nodes[0] === 'filter-1' && await page.evaluate(() =>
      window.OSCILLA.studio.selection.points.length === 2);
    await page.click(H.nodeTitle('filter-1'));
    // Rename.
    await page.fill('[data-osc="studio.inspector.name"]', 'HF Filter');
    await page.press('[data-osc="studio.inspector.name"]', 'Enter');
    const name = (await H.model(page)).nodes.find((n) => n.id === 'filter-1').name;
    const cardTitle = await page.evaluate(() => document.querySelector(
      '.osc-sg-node[data-node-id="filter-1"] .osc-sg-title').textContent);
    // Clip fallback (§141): start and duration as numbers.
    await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'SELECTION_CHANGE',
      selection: { clips: ['clip-2'] } }));
    await H.frames(page);
    await page.fill('[data-osc="studio.inspector.duration"]', '1.5');
    await page.press('[data-osc="studio.inspector.duration"]', 'Enter');
    const clip = (await H.model(page)).clips.find((c) => c.id === 'clip-2');
    const live = await H.live(page);
    return { ...H.verdict({
      typed: f1 === 2400, refused: f2 === 2400 && /Cutoff must be between 10 and/.test(err),
      sliderOneEntry: depth1 === depth0 + 1 && q !== 0.7071,
      renamed: name === 'HF Filter' && cardTitle === 'HF FILTER',
      clipDuration: clip.duration === 1.5,
      announced: live.includes('Changed Filter 1 Cutoff'),
      automate: lane.join() === 'frequency:2,Q:1', revealed,
    }), f1, f2, err, depth0, depth1, q, live: live.slice(-4) };
  });

  def('keyboard-connect', async ({ page }) => {
    await H.fresh(page);
    const id = await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'NODE_ADD',
      nodeType: 'meter', position: { x: 880, y: 160 } }).created.nodes[0]);
    await H.frames(page);
    // Keyboard only: Tab into the graph to Filter 1, C, Enter on the first compatible input.
    await page.focus('[data-osc="studio.graph.viewport"]');
    let focused = '';
    for (let i = 0; i < 10 && focused !== 'filter-1'; i++) {
      await page.keyboard.press('Tab');
      focused = await page.evaluate(() => {
        const n = document.activeElement.closest('.osc-sg-node');
        return n ? n.dataset.nodeId : '';
      });
    }
    const sel = await H.sel(page);
    await page.keyboard.press('c');
    await page.waitForSelector('#osc-dlg-studio-connect[open]');
    const list = await page.evaluate(() => [...document.querySelectorAll(
      '[data-osc="studio.connect.target"]')].map((b) => b.textContent));
    const firstFocused = await page.evaluate(() => document.activeElement.dataset.osc);
    const meterIndex = list.indexOf('Meter 1 / Audio input');
    for (let i = 0; i < meterIndex; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await sleep(80);
    const m = await H.model(page);
    const edge = m.edges.find((e) => e.from.node === 'filter-1' && e.to.node === id);
    const back = await page.evaluate(() => {
      const n = document.activeElement.closest && document.activeElement.closest('.osc-sg-node');
      return n ? n.dataset.nodeId : document.activeElement.tagName;
    });
    // Arrows nudge the selection; Shift x4; one history entry per key sequence.
    const x0 = m.nodes.find((n) => n.id === 'filter-1').x;
    const depth0 = await H.undoDepth(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const x1 = (await H.model(page)).nodes.find((n) => n.id === 'filter-1').x;
    const depth1 = await H.undoDepth(page);
    return { ...H.verdict({
      tabReachesNode: focused === 'filter-1', focusSelects: sel.nodes[0] === 'filter-1',
      dialogLists: meterIndex >= 0 && !list.some((t) => /Oscillator 1/.test(t)),
      focusInDialog: firstFocused === 'studio.connect.target',
      connected: !!edge, focusReturns: back === 'filter-1',
      nudged: x1 === x0 + 8 + 32, nudgeEntries: depth1 === depth0 + 2,
    }), list, focused, back, x0, x1 };
  });

  def('focus-never-body', async ({ page }) => {
    // V431 review U1, U3-U6 (docs/v31/review-v431.md): keyboard focus selects the focused node
    // even after a press that moved no focus; undo / redo, a disabled Undo button, the compact
    // chips and Back never leave focus on <body>.
    const where = () => page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return 'BODY';
      return a.dataset.nodeId ? `node:${a.dataset.nodeId}` : a.dataset.key ? `key:${a.dataset.key}`
        : a.dataset.osc || a.tagName.toLowerCase();
    });
    await H.fresh(page);
    // U1: canvas click, then a press on an input port (moves no focus), then Tab + Delete.
    const box = await page.$eval('.osc-sg-viewport', (v) => {
      const r = v.getBoundingClientRect();
      return { x: r.left + 20, y: r.bottom - 20 };
    });
    await page.mouse.click(box.x, box.y);
    const gain = await H.center(page, H.port('filter-1', 'in', 'gain'));
    await page.mouse.click(gain.x, gain.y);
    await H.frames(page);
    await page.keyboard.press('Tab');
    await H.frames(page);
    const tabbed = await where();
    const tabbedSel = (await H.sel(page)).nodes;
    await page.keyboard.press('Delete');
    await H.frames(page, 4);
    const ids = (await H.model(page)).nodes.map((n) => n.id);
    const tabbedId = tabbed.startsWith('node:') ? tabbed.slice(5) : null;
    // U3: undo that removes the focused (just added) node.
    await H.fresh(page);
    await page.focus('.osc-sg-viewport');
    await page.keyboard.press('n');
    await page.waitForSelector('#osc-dlg-studio-add[open] input');
    await page.keyboard.type('gain');
    await page.keyboard.press('Enter');
    await H.frames(page, 4);
    const added = await where();
    await page.keyboard.press(`${MOD}+z`);
    await H.frames(page, 4);
    const afterUndo = await where();
    // U4: the toolbar Undo button disables itself under focus.
    await H.fresh(page);
    await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'NODE_ADD',
      nodeType: 'gain', position: { x: 0, y: 600 } }));
    await H.frames(page);
    await page.focus('[data-osc="studio.undo"]');
    await page.keyboard.press('Enter');
    await H.frames(page, 4);
    const undoDisabled = await page.$eval('[data-osc="studio.undo"]', (b) => b.disabled);
    const afterUndoButton = await where();
    // U3 (timeline): undo a keyboard duplicate of the focused clip.
    await H.fresh(page);
    await page.focus('[data-key="clip:clip-1"]');
    await page.keyboard.press(`${MOD}+d`);
    await H.frames(page, 4);
    const dup = await where();
    await page.keyboard.press(`${MOD}+z`);
    await H.frames(page, 4);
    const afterClipUndo = await where();
    // U6: Back to the Playground; U5: compact node and clip chips keep focus when activated.
    await H.fresh(page);
    await page.focus('[data-osc="studio.back"]');
    await page.keyboard.press('Enter');
    await H.frames(page, 4);
    const afterBack = await where();
    await page.waitForSelector('[data-osc="studio.compact.node"]', { state: 'visible' });
    await page.focus('[data-osc="studio.compact.node"][data-node-id="filter-1"]');
    await page.keyboard.press('Enter');
    await H.frames(page, 3);
    const afterChip = await where();
    await page.focus('[data-osc="studio.compact.clip"]');
    await page.keyboard.press('Space');
    await H.frames(page, 3);
    const afterClipChip = await where();
    return { ...H.verdict({
      tabSelectsFocused: !!tabbedId && tabbedSel.length === 1 && tabbedSel[0] === tabbedId,
      deleteRemovesFocused: !!tabbedId && !ids.includes(tabbedId) && ids.includes('filter-1'),
      undoKeepsFocus: added.startsWith('node:') && afterUndo !== 'BODY',
      disabledUndoKeepsFocus: undoDisabled && afterUndoButton !== 'BODY',
      clipUndoKeepsFocus: dup.startsWith('key:clip:') && afterClipUndo !== 'BODY',
      backKeepsFocus: afterBack === 'studio.compact.expand',
      compactChipsKeepFocus: afterChip === 'node:filter-1'
        && afterClipChip === 'studio.compact.clip',
    }), tabbed, ids, afterUndo, afterUndoButton, afterClipUndo, afterBack, afterChip,
    afterClipChip };
  });

  def('escape-priority', async ({ page }) => {
    await H.fresh(page);
    const e0 = (await H.model(page)).edges.length;
    const a = await H.center(page, H.port('lfo-1', 'out', 'control'));
    const b = await H.center(page, H.port('osc-1', 'in', 'frequency'));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.keyboard.press('Escape');
    const gestureGone = await page.evaluate(() => !window.OSCILLA.studio.editor.hasGesture());
    await page.mouse.up();
    const e1 = (await H.model(page)).edges.length;
    // Tap-connect mode (a press without movement on an output) and Escape.
    await page.mouse.click(a.x, a.y);
    const tapping = await page.evaluate(() => window.OSCILLA.studio.editor.inSelectionMode());
    await page.keyboard.press('Escape');
    const tapGone = await page.evaluate(() => !window.OSCILLA.studio.editor.inSelectionMode());
    // Only now does Escape stop audio.
    await page.evaluate(() => window.OSCILLA.app.studioPlay());
    const playing = await H.until(() => H.counts(page), (c) => c.engineNodes > 0, 3000);
    await page.click(H.nodeTitle('master-1'));
    await page.keyboard.press('Escape');
    const stopped = await H.until(() => H.counts(page), (c) => c.engineNodes === 0
      && c.engineSources === 0 && !c.playing, 3000);
    return { ...H.verdict({
      cableCancelled: gestureGone && e1 === e0, tapMode: tapping, tapCancelled: tapGone,
      played: playing.engineNodes > 0, escapeStops: stopped.engineNodes === 0
        && stopped.engineSources === 0 && !stopped.playing,
    }), playing, stopped };
  });

  def('play-stop', async ({ page }) => {
    await H.fresh(page);
    await page.click('[data-osc="studio.play"]');
    const on = await H.until(() => H.counts(page), (c) => c.playing && c.runtimeNodes > 0, 3000);
    const pressed = await page.evaluate(() => document.querySelector('[data-osc="studio.play"]')
      .getAttribute('aria-pressed'));
    // Edits while playing reach the runtime (transactional apply).
    await page.evaluate(() => {
      const s = window.OSCILLA.studio.store;
      s.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'frequency', value: 1800 });
      const g = s.dispatch({ type: 'NODE_ADD', nodeType: 'meter', position: { x: 880, y: 340 } });
      s.dispatch({ type: 'EDGE_ADD', from: { node: 'env-1', port: 'audio' },
        to: { node: g.created.nodes[0], port: 'audio' } });
    });
    await sleep(250);
    const rt = await page.evaluate(() => window.OSCILLA.studio.runtime.debugInfo());
    const time = await page.evaluate(() => document.querySelector('[data-osc="studio.time"]')
      .textContent);
    await page.click('[data-osc="studio.stop"]');
    const off = await H.until(() => H.counts(page), (c) => !c.playing && c.engineNodes === 0
      && c.engineSources === 0 && c.runtimeNodes === 0, 3000);
    // Exclusivity: the Playground voice stops the Studio; the Playground still works after.
    await page.evaluate(() => window.OSCILLA.app.studioPlay());
    await H.until(() => H.counts(page), (c) => c.playing, 3000);
    await page.evaluate(() => { window.OSCILLA.app.setWorkspace('playground'); });
    await sleep(150);
    await page.evaluate(() => window.OSCILLA.app.statusPlay());
    const excl = await H.until(() => H.counts(page), (c) => !c.playing, 2000);
    const instrument = await page.evaluate(() => !!window.OSCILLA.app.isSounding);
    await page.evaluate(() => window.OSCILLA.app.stopNow());
    const quiet = await H.until(() => page.evaluate(() => window.OSCILLA.engine.activeNodeCount),
      (n) => n === 0, 3000);
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('studio'));
    return { ...H.verdict({
      started: on.playing && on.runtimeNodes > 0 && on.engineNodes > 0, pressed: pressed === 'true',
      applied: rt.compiledRevision !== null && rt.lastError === null && rt.modelNodeCount === 7,
      clock: /^\d\d:\d\d\.\d{3}$/.test(time) && time !== '00:00.000',
      released: off.engineNodes === 0 && off.engineSources === 0 && off.runtimeNodes === 0,
      exclusive: !excl.playing, playgroundPlays: instrument, playgroundStops: quiet === 0,
    }), on, off, rt: { state: rt.state, lastError: rt.lastError, warnings: rt.warnings },
    time };
  });

  def('compact-sync', async ({ page }) => {
    await H.fresh(page);
    const storeBefore = await page.evaluate(() => {
      window.__studioStore = window.OSCILLA.studio.store.current();
      return true;
    });
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('playground'));
    await sleep(150);
    const compact = await page.evaluate(() => ({
      chips: [...document.querySelectorAll('[data-osc="studio.compact.node"]')].map((b) =>
        b.textContent),
      clips: [...document.querySelectorAll('[data-osc="studio.compact.clip"]')].map((b) =>
        b.textContent),
      visible: document.querySelector('[data-osc="studio.compact"]').getBoundingClientRect()
        .height > 0,
    }));
    // Move a clip in Compact (keyboard), see it in the model the full Studio projects.
    await page.focus('[data-osc="studio.compact.clip"][data-clip-id="clip-2"]');
    await page.keyboard.press('ArrowRight');
    const clip = (await H.model(page)).clips.find((c) => c.id === 'clip-2');
    // Add a Filter in Full, see it in the compact signal path.
    await page.click('[data-osc="studio.compact.expand"]');
    await page.waitForFunction(() => document.querySelector('#osc-app').dataset.mode === 'studio');
    await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'SELECTION_CHANGE',
      selection: { clips: ['clip-2'] } }));
    await H.frames(page);
    const inspStart = await page.evaluate(() => document.querySelector(
      '[data-osc="studio.inspector.start"]').value);
    await page.click('[data-osc="studio.library.item"][data-type="filter"]');
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('playground'));
    await sleep(120);
    const chips2 = await page.evaluate(() => [...document.querySelectorAll(
      '[data-osc="studio.compact.node"]')].map((b) => b.textContent));
    // Selecting a chip in Compact selects it in the shared store.
    await page.click('[data-osc="studio.compact.node"][data-node-id="lfo-1"]');
    const sel = await H.sel(page);
    const same = await page.evaluate(() => window.OSCILLA.studio.store.current()
      === window.__studioStore);
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('studio'));
    return { ...H.verdict({
      storeBefore, compactShown: compact.visible,
      compactPath: compact.chips.join() === 'OSCILLATOR 1,ENVELOPE 1,FILTER 1,MASTER,LFO 1,SPECTRUM 1'
        || compact.chips.length === 6,
      compactClips: compact.clips.join() === 'Tone,Sweep',
      clipMoved: clip.start === 1.1, fullShowsIt: inspStart === '1.1',
      filterInCompact: chips2.length === 7 && chips2.includes('FILTER 2'),
      sharedSelection: sel.nodes.length === 1 && sel.nodes[0] === 'lfo-1',
      oneStore: same,
    }), compact, clip, inspStart, chips2 };
  });

  def('templates', async ({ page }) => {
    await H.fresh(page);
    await page.click('[data-osc="studio.templates"]');
    await page.waitForSelector('#osc-dlg-studio-templates[open]');
    const ids = await page.evaluate(() => [...document.querySelectorAll(
      '[data-osc="studio.template.open"]')].map((b) => b.dataset.template));
    const opened = {};
    for (const id of ids) {
      await page.evaluate((t) => window.OSCILLA.app.studioLoadTemplate(t), id);
      await H.frames(page);
      opened[id] = await page.evaluate(() => ({
        nodes: document.querySelectorAll('.osc-sg-node').length,
        model: window.OSCILLA.studio.model.graph.nodes.length,
        dirty: window.OSCILLA.studio.dirty, undo: window.OSCILLA.studio.store.canUndo() }));
    }
    await page.click('[data-osc="studio.templates"]');
    await page.click('[data-osc="studio.template.open"][data-template="measurement-sweep"]');
    await H.frames(page);
    const mic = await page.evaluate(() => {
      const n = document.querySelector('.osc-sg-node[data-node-id="mic-1"]');
      return { error: n.classList.contains('is-error'), flag: (n.querySelector(
        '[data-osc="studio.graph.flag"]') || {}).textContent, title: n.getAttribute('title') };
    });
    const closed = await page.evaluate(() => !document.querySelector(
      '#osc-dlg-studio-templates[open]'));
    return { ...H.verdict({
      six: ids.length === 6,
      allRender: ids.every((id) => opened[id].nodes === opened[id].model && opened[id].nodes > 0
        && !opened[id].dirty && !opened[id].undo),
      micDegraded: mic.error && mic.flag === 'Unavailable' && !!mic.title, closed,
    }), ids, mic };
  });

  def('patches-files', async ({ page }) => {
    await H.fresh(page);
    await H.recordLive(page);
    // Save locally, list it in Open.
    await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'NODE_MOVE',
      nodeId: 'osc-1', position: { x: 48, y: 160 } }));
    const dirty0 = await page.evaluate(() => window.OSCILLA.studio.dirty);
    await page.click('[data-osc="studio.save"]');
    await H.until(() => page.evaluate(() => window.OSCILLA.studio.dirty), (d) => d === false, 3000);
    await page.click('[data-osc="studio.open"]');
    await page.waitForSelector('#osc-dlg-studio-library[open] [data-osc="studio.saved.open"]');
    const saved = await page.evaluate(() => [...document.querySelectorAll('.osc-sp-row')]
      .map((r) => `${r.dataset.kind}:${r.dataset.id}`));
    await page.click('[data-osc="studio.saved.close"]');
    // Export then import the file: same semantics.
    const [download] = await Promise.all([page.waitForEvent('download'),
      page.click('[data-osc="studio.export"]')]);
    const fileName = download.suggestedFilename();
    const file = await download.path();
    const text = fs.readFileSync(file, 'utf8');
    const before = await page.evaluate(() => JSON.stringify(window.OSCILLA.studio.model.graph));
    await H.fresh(page, 'basic-tone');
    const imp = await page.evaluate((t) => window.OSCILLA.app.studioImportText(t), text);
    const after = await page.evaluate(() => JSON.stringify(window.OSCILLA.studio.model.graph));
    // Save a selection as a patch, insert it (undoable).
    await H.fresh(page);
    await page.click(H.nodeTitle('osc-1'));
    await page.click(H.nodeTitle('env-1'), { modifiers: ['Shift'] });
    await page.click('[data-osc="studio.inspector.savePatch"]');
    await page.waitForSelector('#osc-dlg-studio-patch[open]');
    await page.fill('[data-osc="studio.patch.name"]', 'Voice');
    await page.click('[data-osc="studio.patch.save"]');
    await H.until(() => page.evaluate(() => !document.querySelector('#osc-dlg-studio-patch[open]')),
      (x) => x, 3000);
    const n0 = (await H.model(page)).nodes.length;
    await page.click('[data-osc="studio.open"]');
    await page.waitForSelector('#osc-dlg-studio-library[open] [data-osc="studio.saved.insert"]');
    await page.click('[data-osc="studio.saved.insert"]');
    await sleep(150);
    const n1 = (await H.model(page)).nodes.length;
    await page.evaluate(() => window.OSCILLA.app.studioUndo());
    const n2 = (await H.model(page)).nodes.length;
    // Untrusted files are refused before anything changes.
    const m0 = await page.evaluate(() => JSON.stringify(window.OSCILLA.studio.model));
    const hostile = JSON.parse(text);
    hostile.graph.nodes[0].metadata.name = '<img src=x onerror=alert(1)>';
    hostile.graph.edges.push({ id: 'edge-99', from: { node: 'env-1', port: 'audio' },
      to: { node: 'osc-1', port: 'frequency' }, props: { muted: false } });
    const typed = JSON.parse(text);
    typed.graph.nodes[0].type = 'eval';
    const bad = [];
    for (const t of ['{ not json', '{"kind":"oscilla-studio","schemaVersion":1,"__proto__":{"x":1}}',
      JSON.stringify(hostile), JSON.stringify(typed)]) {
      bad.push(await page.evaluate((x) => window.OSCILLA.app.studioImportText(x).ok, t));
      await H.frames(page);
    }
    const m1 = await page.evaluate(() => JSON.stringify(window.OSCILLA.studio.model));
    const live = await H.live(page);
    return { ...H.verdict({
      dirtyAfterEdit: dirty0 === true,
      savedListed: saved.some((x) => x.startsWith('project:project-subtractive-synth')),
      fileName: fileName === 'subtractive-synth.oscilla-studio.json',
      roundTrip: imp && imp.ok && after === before,
      patchInserted: n1 === n0 + 2, patchUndo: n2 === n0,
      refused: bad.every((ok) => ok === false) && m0 === m1,
      refusedAnnounced: live.filter((t) => t.startsWith('Not imported')).length === 4,
      noInjection: await page.evaluate(() => !document.querySelector('.osc-studio img')),
    }), saved, fileName, live: live.slice(-4) };
  });

  def('mobile-tap-connect', async ({ browser, baseUrl }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true,
      isMobile: false });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(baseUrl);
      await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
      await page.evaluate(() => { const a = window.OSCILLA.app; a.alerts = [];
        if (!a.safetyCollapsed) a.collapseSafety(); });
      await H.fresh(page);
      const id = await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'NODE_ADD',
        nodeType: 'scope', position: { x: 240, y: 340 } }).created.nodes[0]);
      await page.evaluate(() => window.OSCILLA.studio.editor.frameAll());
      await H.frames(page);
      const tabs = await page.evaluate(() => [...document.querySelectorAll(
        '[data-osc="studio.subview"]')].map((t) => t.getBoundingClientRect().height));
      const a = await H.center(page, H.port('env-1', 'out', 'audio'));
      await page.touchscreen.tap(a.x, a.y);
      await sleep(100);
      const mode = await page.evaluate(() => ({
        on: window.OSCILLA.studio.editor.inSelectionMode(),
        banner: document.querySelector('[data-osc="studio.graph.banner"]').textContent,
        compat: document.querySelectorAll('.osc-sg-port.is-compatible').length }));
      const b = await H.center(page, H.port(id, 'in', 'audio'));
      await page.touchscreen.tap(b.x, b.y);
      await sleep(120);
      const m = await H.model(page);
      const edge = m.edges.find((e) => e.to.node === id);
      // Subviews: Inspector replaces the graph.
      await page.tap('[data-osc="studio.subview"][data-value="inspector"]');
      await sleep(80);
      const vis = await page.evaluate(() => ({
        graph: document.querySelector('.osc-st-graph').getBoundingClientRect().height,
        insp: document.querySelector('.osc-st-inspector').getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        small: [...document.querySelectorAll('.osc-st-bar button')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.width < 43.5 || r.height < 43.5);
        }).map((el) => el.dataset.osc),
      }));
      await page.screenshot({ path: path.join(OUT, `${baseUrl.startsWith('http') ? 'http-' : ''}`
        + `${page.context().browser().browserType().name()}-phone-inspector.png`) });
      await page.tap('[data-osc="studio.subview"][data-value="graph"]');
      return { ...H.verdict({
        tabs: tabs.length === 3 && tabs.every((hgt) => hgt >= 43.5),
        tapMode: mode.on && /^Connecting from Envelope 1 \/ Audio/.test(mode.banner)
          && mode.compat > 0,
        connected: !!edge && edge.from.node === 'env-1',
        subview: vis.graph === 0 && vis.insp > 0, noOverflow: !vis.overflow,
        touchTargets: vis.small.length === 0, noErrors: errors.length === 0,
      }), mode, vis, errors };
    } finally {
      await ctx.close();
    }
  });

  def('light-theme', async ({ page }) => {
    await H.fresh(page);
    await page.evaluate(() => { if (window.OSCILLA.app.theme !== 'light') window.OSCILLA.app.toggleTheme(); });
    await sleep(250); // the controls' 0.12 s colour transitions
    const c = await page.evaluate(() => {
      const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => {
        const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const node = document.querySelector('.osc-sg-node');
      const bg = parse(getComputedStyle(node).backgroundColor);
      const title = parse(getComputedStyle(node.querySelector('.osc-sg-title')).color);
      const port = parse(getComputedStyle(node.querySelector('.osc-sg-plabel')).color);
      const vpBg = parse(getComputedStyle(document.querySelector('.osc-sg-viewport')).backgroundColor);
      const line = parse(getComputedStyle(document.querySelector('.osc-sg-edge-line')).stroke);
      return { title: ratio(title, bg), port: ratio(port, bg), cable: ratio(line, vpBg) };
    });
    await page.screenshot({ path: path.join(OUT, `${page.context().browser().browserType().name()}`
      + '-desktop-light.png') });
    await page.evaluate(() => { if (window.OSCILLA.app.theme !== 'dark') window.OSCILLA.app.toggleTheme(); });
    return { ...H.verdict({ title: c.title >= 7, port: c.port >= 4.5, cable: c.cable >= 3 }), c };
  });

  def('screenshots', async ({ page, browserName }) => {
    await H.fresh(page);
    await page.click(H.nodeTitle('filter-1'));
    await page.mouse.move(2, 2);
    await page.screenshot({ path: path.join(OUT, `${browserName}-desktop.png`) });
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('playground'));
    await sleep(150);
    await page.evaluate(() => document.querySelector('[data-osc="studio.compact"]')
      .scrollIntoView({ block: 'end' }));
    await page.screenshot({ path: path.join(OUT, `${browserName}-compact.png`) });
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('studio'));
    return { ok: true };
  });

  def('no-console-errors', async ({ errors }) => ({ ok: errors.length === 0,
    errors: errors.slice(0, 8) }));
  return checks;
}

// ------------------------------------------------------------------------------ runner
async function runOne(browserName, origin, baseUrl) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 },
    acceptDownloads: true });
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
    if (origin === 'http' && !HTTP_CHECKS.has(name)) continue;
    const t0 = Date.now();
    try {
      const v = await Promise.race([
        fn({ page, context, browser, errors, browserName, origin, baseUrl }),
        sleep(60000).then(() => ({ ok: false, detail: 'timeout 60 s' })),
      ]);
      results[name] = { ...v, ms: Date.now() - t0 };
    } catch (e) {
      results[name] = { ok: false, detail: String(e.message || e).split('\n')[0],
        ms: Date.now() - t0 };
    }
    try {
      await page.mouse.up();
      await page.evaluate(() => {
        for (const d of document.querySelectorAll('dialog[open]')) d.close();
        window.OSCILLA.app.alerts = [];
      });
    } catch { /* page gone */ }
  }
  await browser.close();
  return results;
}

(async () => {
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
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
        const bad = names.filter((n) => !res[n].ok);
        failed += bad.length;
        console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/v31-studio-graph: ${names.length
          - bad.length}/${names.length} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        for (const n of bad) {
          const why = res[n].failed ? `failed [${res[n].failed.join(', ')}] ` : '';
          console.log(`   x ${n}: ${why}${JSON.stringify(res[n]).slice(0, 900)}`);
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

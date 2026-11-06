#!/usr/bin/env node
// K060: the Keys node in the Studio on the built dist/index.html in chromium, firefox and webkit
// at 1536 x 1024 (the touch add in a hasTouch page of the same size): linked, real-time and
// interactive. Every check reads the one store, the runtime's debugInfo or the page's own
// controls, each wait a condition poll with a named deadline (tests/browser/lib/wait.cjs).
//
//   node tests/browser/studio-keys.cjs [--browsers chromium,firefox,webkit] [--origins file,http]
//        [--only sk-add,sk-live]
//
// Checks:
//   sk-add     interactive: a Keys node is added by pointer (Add node, "keys", a click on the
//              first row), by keyboard (N on the graph, "keys", Enter) and by touch (a tap on
//              Add node, "keys", a tap on the first row): one more Keys node in the store each
//              time, one undo entry each, the new node selected
//   sk-ports   its outputs carry accessible names: the connect dialog (C on the focused node)
//              offers "<name> / Pitch control output" and "<name> / Gate trigger output", and
//              the graph's port elements are titled with the same port names
//   sk-linked  linked: the timeline's Add track form offers the Keys node as an event track's
//              target; the track added on it takes a gate event clip from its Add clip button
//              (one undo entry), and the Studio's note sink (the keys and MIDI path) is active
//              on the document, playing that Keys node
//   sk-live    real-time: a note sent through the Studio's note sink (app.studioSink(), the path
//              of the computer keyboard, the on-screen keys and MIDI) arms the transport and
//              reaches the runtime: debugInfo().notes shows A4 at pitch 0 with the gate open,
//              then A5 at 1 octave (last-note priority), its release back to A4 with the gate
//              still open, the last release closes the gate; after stop the runtime and engine
//              census is 0. On e51b169d debugInfo has no notes: it fails
//   no-console-errors
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
const RUN = suite.open({ name: 'studio-keys', browsers: arg('browsers'), origins: arg('origins'),
  defaultOrigins: ['file'] });
const playwright = RUN.playwright;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};
const VIEWPORT = { width: 1536, height: 1024 };
const LOAD_MS = 60000;
const UI_MS = 8000; // a dialog opening, a store commit and its render
const SOUND_MS = 10000; // the transport arming, the audio clock reaching the scheduled note
const CHECK_MS = 120000;
const ADD = '#osc-dlg-studio-add';

// ------------------------------------------------------------------------------ page helpers
async function openStudio(context, base) {
  const page = await context.newPage();
  await page.goto(`${base}#m=studio`);
  await until(() => page.evaluate(() => {
    const a = window.OSCILLA && window.OSCILLA.app;
    const s = window.OSCILLA && window.OSCILLA.studio;
    return !!(a && a.studio && a.studio.ready && s && s.editor && a.workspace === 'studio'
      && document.querySelector('[data-osc="studio.add"]'));
  }), { ms: LOAD_MS, what: 'the Studio workspace is ready' });
  await page.evaluate(() => {
    const a = window.OSCILLA.app;
    a.alerts = [];
    if (!a.safetyCollapsed && typeof a.collapseSafety === 'function') a.collapseSafety();
  });
  return page;
}
const keysIds = (page) => page.evaluate(() => window.OSCILLA.studio.model.graph.nodes
  .filter((n) => n.type === 'keys').map((n) => n.id));
const depth = (page) => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
const selected = (page) => page.evaluate(() => [...window.OSCILLA.studio.selection.nodes]);
const addOpen = (page) => page.evaluate((sel) => {
  const d = document.querySelector(sel);
  const row = d && d.querySelector('[data-osc="studio.add.item"]');
  return { open: !!(d && d.open), first: row ? row.dataset.type : null };
}, ADD);
/** One more Keys node than `before`, one more undo entry, the new node selected. */
async function addedKeys(page, before, d0, how) {
  return until(async () => {
    const ids = await keysIds(page);
    const fresh = ids.filter((id) => !before.includes(id));
    if (fresh.length !== 1) return null;
    const sel = await selected(page);
    const d = await depth(page);
    return d === d0 + 1 && sel.length === 1 && sel[0] === fresh[0] ? { id: fresh[0], depth: d }
      : null;
  }, { ms: UI_MS, what: `sk-add (${how}): one more Keys node, one undo entry, selected` });
}
async function listsKeys(page, how) {
  return until(async () => {
    const a = await addOpen(page);
    return a.open && a.first === 'keys' ? a : null;
  }, { ms: UI_MS, what: `sk-add (${how}): the quick add lists Keys first for "keys"` });
}
/** The first Keys node, added through the store when the page has none (a check run alone). */
async function someKeys(page) {
  const ids = await keysIds(page);
  if (ids.length) return ids[0];
  return page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'NODE_ADD',
    nodeType: 'keys', position: { x: 80, y: 80 } }).created.nodes[0]);
}
const notesOf = (page) => page.evaluate(() => {
  const rt = window.OSCILLA.studio.runtime;
  const d = rt ? rt.debugInfo() : null;
  return d && Array.isArray(d.notes) ? d.notes : null;
});

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });

  def('sk-add', async ({ page, context, base }) => {
    // Pointer: the Add node button, "keys", a click on the first row.
    let before = await keysIds(page);
    let d0 = await depth(page);
    await page.click('[data-osc="studio.add"]');
    await page.fill('[data-osc="studio.add.search"]', 'keys');
    await listsKeys(page, 'pointer');
    await page.click(`${ADD} [data-osc="studio.add.item"]`);
    const byPointer = await addedKeys(page, before, d0, 'pointer');
    // Keyboard: N on the graph, "keys", Enter.
    before = await keysIds(page);
    d0 = await depth(page);
    await page.focus('[data-osc="studio.graph.viewport"]');
    await page.keyboard.press('n');
    await until(() => page.evaluate(() => document.activeElement
      && document.activeElement.dataset.osc === 'studio.add.search'),
    { ms: UI_MS, what: 'sk-add (keyboard): N focuses the quick add search' });
    await page.keyboard.type('keys');
    await listsKeys(page, 'keyboard');
    await page.keyboard.press('Enter');
    const byKey = await addedKeys(page, before, d0, 'keyboard');
    // Touch: a hasTouch page, a tap on Add node, "keys", a tap on the first row.
    const touch = await context.browser().newContext({ viewport: VIEWPORT, hasTouch: true });
    let byTouch = null;
    try {
      const tp = await openStudio(touch, base);
      before = await keysIds(tp);
      d0 = await depth(tp);
      await tp.tap('[data-osc="studio.add"]');
      await tp.fill('[data-osc="studio.add.search"]', 'keys');
      await listsKeys(tp, 'touch');
      await tp.tap(`${ADD} [data-osc="studio.add.item"]`);
      byTouch = await addedKeys(tp, before, d0, 'touch');
    } finally {
      await touch.close();
    }
    return { ok: !!(byPointer && byKey && byTouch), byPointer, byKey, byTouch };
  });

  def('sk-ports', async ({ page }) => {
    const id = await someKeys(page);
    const name = await page.evaluate((k) => window.OSCILLA.studio.model.graph.nodes
      .find((n) => n.id === k).metadata.name, id);
    // The graph's port elements, titled with their accessible port names.
    const titles = await until(() => page.evaluate((k) => {
      const el = document.querySelector(`.osc-sg-node[data-node-id="${k}"]`);
      if (!el) return null;
      const t = (p) => {
        const e = el.querySelector(`.osc-sg-port[data-dir="out"][data-port="${p}"]`);
        return e ? e.getAttribute('title') : null;
      };
      return t('pitch') && t('gate') ? { pitch: t('pitch'), gate: t('gate') } : null;
    }, id), { ms: UI_MS, what: 'sk-ports: the Keys card shows its output ports' });
    // Keyboard: the node focused, C opens the connect dialog listing its outputs by name.
    await page.evaluate((k) => window.OSCILLA.studio.editor.focusNode(k), id);
    await until(() => page.evaluate((k) => {
      const a = document.activeElement;
      return !!(a && a.closest && a.closest('.osc-sg-node')
        && a.closest('.osc-sg-node').dataset.nodeId === k);
    }, id), { ms: UI_MS, what: 'sk-ports: the Keys node takes the focus' });
    await page.keyboard.press('c');
    const outs = await until(() => page.evaluate(() => {
      const d = document.querySelector('#osc-dlg-studio-connect');
      if (!d || !d.open) return null;
      const r = [...d.querySelectorAll('[data-osc="studio.connect.output"]')]
        .map((b) => b.textContent.trim());
      return r.length ? r : null;
    }), { ms: UI_MS, what: 'sk-ports: C opens the connect dialog with the outputs' });
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => !document.querySelector('#osc-dlg-studio-connect')
      .open), { ms: UI_MS, what: 'sk-ports: Escape closes the connect dialog' });
    const want = [`${name} / Pitch control output`, `${name} / Gate trigger output`];
    return { ok: want.every((w) => outs.includes(w))
      && titles.pitch.startsWith(`${name} pitch control output`)
      && titles.gate.startsWith(`${name} gate trigger output`), outs, titles };
  });

  def('sk-linked', async ({ page }) => {
    const id = await someKeys(page);
    // The timeline's Add track form offers the Keys node as an event track's target.
    await page.click('[data-osc="studio.tl.track"]');
    const options = await until(() => page.evaluate(() => {
      const s = document.querySelector('select[data-field="target"]');
      return s && s.options.length > 1 ? [...s.options].map((o) => o.value) : null;
    }), { ms: UI_MS, what: 'sk-linked: the Add track form lists its targets' });
    if (!options.includes(id)) {
      return { ok: false, detail: 'the Keys node is not offered', options };
    }
    await page.selectOption('select[data-field="target"]', id);
    const d0 = await depth(page);
    await page.click('[data-osc="studio.tl.d-add"]');
    const track = await until(() => page.evaluate((k) => {
      const t = window.OSCILLA.studio.model.timeline.tracks.find((x) => x.target === k);
      return t ? t.id : null;
    }, id), { ms: UI_MS, what: 'sk-linked: Add track adds an event track on the Keys node' });
    // Its Add clip button: a gate event clip on the Keys track, one undo entry.
    await page.click(`[data-key="track-add:${track}"]`);
    const clip = await until(() => page.evaluate((t) => {
      const c = window.OSCILLA.studio.model.timeline.clips.find((x) => x.trackId === t);
      return c ? { kind: c.kind, action: c.payload && c.payload.action } : null;
    }, track), { ms: UI_MS, what: 'sk-linked: Add clip adds a clip on the Keys track' });
    const d1 = await depth(page);
    // The note router: the Studio's note sink is active and plays this Keys node.
    const sink = await page.evaluate(() => {
      const a = window.OSCILLA.app;
      return typeof a.studioSink === 'function' && !!a.studioSink();
    });
    return { ok: options.includes(id) && clip.kind === 'event' && clip.action === 'gate'
      && d1 === d0 + 2 && sink, options, clip, depth: [d0, d1], sink };
  });

  def('sk-live', async ({ page }) => {
    await someKeys(page);
    const play = (kind, note) => page.evaluate(([k, n]) => {
      const s = window.OSCILLA.app.studioSink();
      if (!s) return { ok: false, reason: 'no sink' };
      return k === 'on' ? s.noteOn(n, 100) : { ok: s.noteOff(n) };
    }, [kind, note]);
    const reach = (pred, what) => until(async () => {
      const ns = await notesOf(page);
      const n = ns && ns.find((x) => pred(x));
      return n || null;
    }, { ms: SOUND_MS, what });
    const at = (oct) => (x) => Math.abs(x.pitch - oct) < 1e-6 && Math.abs(x.target - oct) < 1e-6;
    const on1 = await play('on', 69);
    const a4 = await reach((x) => x.note === 69 && x.gate && at(0)(x),
      'sk-live: A4 reaches the runtime pitch 0 with the gate open');
    const on2 = await play('on', 81);
    const a5 = await reach((x) => x.id === a4.id && x.note === 81 && x.gate && at(1)(x),
      'sk-live: A5 takes over at 1 octave (last-note priority)');
    await play('off', 81);
    const back = await reach((x) => x.id === a4.id && x.note === 69 && x.gate && at(0)(x),
      'sk-live: releasing A5 returns to the held A4, the gate still open');
    await play('off', 69);
    const closed = await reach((x) => x.id === a4.id && !x.gate,
      'sk-live: the last release closes the gate');
    await page.evaluate(() => window.OSCILLA.app.studioStop());
    const census = await until(async () => {
      const c = await page.evaluate(() => window.OSCILLA.studio.counts());
      return !c.playing && c.runtimeNodes === 0 && c.engineNodes === 0 ? c : null;
    }, { ms: SOUND_MS, what: 'sk-live: after stop the runtime and engine census is 0' });
    return { ok: !!(on1 && on1.ok !== false && on2 && on2.ok !== false && a4 && a5 && back
      && closed && census), a4, a5, back, closed, census };
  });

  def('no-console-errors', async ({ errors }) => ({ ok: errors.length === 0,
    errors: errors.slice(0, 4) }));
  return checks;
}

// ------------------------------------------------------------------------------ runner
async function runLeg(browserName, base) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const results = {};
  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const errors = [];
    context.on('page', (pg) => {
      pg.on('pageerror', (e) => errors.push(String(e)));
      pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    });
    const page = await openStudio(context, base);
    for (const { name, fn } of defineChecks()) {
      if (ONLY && !ONLY.has(name)) continue;
      const t0 = Date.now();
      try {
        const v = await bounded(fn({ page, context, base, browserName, errors }),
          { ms: CHECK_MS, what: `${name} finishes` });
        results[name] = { ...v, ms: Date.now() - t0 };
      } catch (e) {
        results[name] = { ok: false, detail: String(e.message || e).split('\n')[0],
          ms: Date.now() - t0 };
      }
    }
    await context.close().catch(() => {});
  } finally {
    await browser.close();
  }
  return results;
}

(async () => {
  const known = defineChecks().map((c) => c.name);
  const unknown = ONLY ? [...ONLY].filter((n) => !known.includes(n)) : [];
  if (unknown.length) {
    console.error(`unknown --only check(s) ${unknown.join(', ')}; known: ${known.join(', ')}`);
    process.exit(2);
  }
  await RUN.ready();
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  const server = RUN.origins.includes('http')
    ? await serveDist(DIST, { prefix: 'oscilla-studio-keys-' }) : null;
  let failed = 0;
  try {
    for (const b of RUN.browsers) {
      for (const o of RUN.origins) {
        const base = o === 'file' ? pathToFileURL(DIST).href : server.url;
        const key = `${b}/${o}`;
        const t0 = Date.now();
        const res = await runLeg(b, base);
        const names = Object.keys(res);
        RUN.reportLeg({ leg: key, checks: names.length });
        const bad = names.filter((n) => !res[n].ok);
        failed += bad.length;
        console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/studio-keys: ${names.length
          - bad.length}/${names.length} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        for (const n of names) {
          const line = JSON.stringify(res[n]).slice(0, 600);
          console.log(`   ${res[n].ok ? 'ok' : 'x '} ${n}: ${line}`);
        }
      }
    }
  } finally {
    if (server) server.close();
  }
  process.exit(failed ? 1 : 0);
})();

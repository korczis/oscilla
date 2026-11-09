#!/usr/bin/env node
// suite-pace: solo (gates judged on the running Envelope's VCA gain on the audio clock)
// K103: gates along TRIGGER edges, one fan-out live and scheduled, one ownership rule, on the
// built dist/index.html in chromium, firefox and webkit at 1536 x 1024 (the touch connection on a
// 390 x 844 touch phone): linked, real-time and interactive. The document is the
// Synth panel's (its Keys node, as steps.cjs opens it) plus a Step Modulator and an Envelope the
// check adds. An Envelope's gate is read from the runtime: the gain of its VCA (adapters/
// modulation.js envelope), tapped by a Meter so that it is rendered, rises when its gate opens
// and falls after its release. Every wait is a condition poll with a named deadline
// (tests/browser/lib/wait.cjs); no sample rate is assumed.
//
//   node tests/browser/studio-trigger-gates.cjs [--browsers chromium,firefox,webkit]
//        [--origins file,http] [--only tg-connect,tg-live]
//
// Checks:
//   tg-connect  interactive: the Keys Gate into a new Envelope's Gate is made in the Studio graph
//               by pointer (a drag from port to port), by keyboard (the Inspector's Connect…
//               dialog: the Gate output, the Envelope's Gate, Enter) and by touch (a tap on each
//               port, a 390 x 844 touch phone on the Graph subview); each makes one edge in one
//               undo entry
//   tg-live     linked and real-time, armed and stopped: the Keys Gate clocks a Step Modulator
//               whose Trigger gates the Envelope; QWERTY A opens that Envelope (its contour
//               rises above 0.5) and its key-up releases it (below 0.1)
//   tg-clip     linked, scheduled: a gate clip on the Keys node's track, looped, played by Play:
//               the same relay opens the Envelope while the timeline plays and the clip's end
//               releases it (below 0.1) while it still plays; census 0 after Stop
//   tg-owned    the one ownership rule: the Envelope also takes gate clips on its own track, so
//               while the timeline plays it is the timeline's; QWERTY A is refused there, the
//               refusal sentence (LIVE_NOTES_TEXT.timelineOwned) reaches the polite live region
//   no-console-errors
// On 08cd77a2 (chromium) tg-live and tg-clip fail (the Keys Gate stops at its first hop, no
// Step relay: the Envelope, gated by no one, opens at the graph's start and never closes) and
// tg-owned fails (no refusal; the key opens the timeline's Envelope).
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
const RUN = suite.open({ name: 'studio-trigger-gates', browsers: arg('browsers'),
  origins: arg('origins'), defaultOrigins: ['file'] });
const playwright = RUN.playwright;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};
const VIEWPORT = { width: 1536, height: 1024 };
const PHONE = { width: 390, height: 844 }; // the touch connection: a phone on the Graph subview
const LOAD_MS = 60000;
const UI_MS = 8000; // a store commit and its render, a dialog opening
const SOUND_MS = 15000; // the runtime starting, the audio clock reaching a gate
const CHECK_MS = 180000;

// ------------------------------------------------------------------------------ page helpers
async function openStudio(context, base) {
  const page = await context.newPage();
  await page.goto(`${base}#m=synth`);
  await until(() => page.evaluate(() => {
    const a = window.OSCILLA && window.OSCILLA.app;
    return !!(a && a.synthDebug && a.synthDebug().present && a.synthDebug().nodes.keys
      && window.OSCILLA.studio && window.OSCILLA.studio.store);
  }), { ms: LOAD_MS, what: 'the Synth panel is in the Studio document' });
  await page.evaluate(() => window.OSCILLA.app.setWorkspace('studio'));
  await until(() => page.evaluate(() => {
    const s = window.OSCILLA.studio;
    return !!(s && s.editor && s.transport && window.OSCILLA.app.workspace === 'studio'
      && document.querySelector('.osc-sg-node'));
  }), { ms: LOAD_MS, what: 'the Studio workspace is ready' });
  await page.evaluate(() => {
    const a = window.OSCILLA.app;
    a.alerts = [];
    if (!a.safetyCollapsed && typeof a.collapseSafety === 'function') a.collapseSafety();
  });
  return page;
}

/** Add `type` nodes (one store dispatch each); -> their ids, in order. */
const addNodes = (page, specs) => page.evaluate((list) => list.map(([type, x, y]) => {
  const r = window.OSCILLA.studio.store.dispatch({ type: 'NODE_ADD', nodeType: type,
    position: { x, y } });
  if (!r.ok) throw new Error(`add ${type}: ${r.reason}`);
  return r.created.nodes[0];
}), specs);
const dispatch = (page, action) => page.evaluate((a) => {
  const r = window.OSCILLA.studio.store.dispatch(a);
  if (!r.ok) throw new Error(`${a.type}: ${r.reason}`);
  return r.created || null;
}, action);
const keysId = (page) => page.evaluate(() => window.OSCILLA.app.synthDebug().nodes.keys);
/** A position just right of node `id` in the graph, so both fit one framed view on a phone. */
const beside = (page, id) => page.evaluate((n) => {
  const p = window.OSCILLA.studio.model.graph.nodes.find((x) => x.id === n).position;
  return [p.x + 240, p.y];
}, id);
const depth = (page) => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
const edgeOf = (page, from, fromPort, to, toPort) => page.evaluate((q) => window.OSCILLA.studio
  .model.graph.edges.find((e) => e.from.node === q.from && e.from.port === q.fromPort
    && e.to.node === q.to && e.to.port === q.toPort) || null,
{ from, fromPort, to, toPort });
const nameOf = (page, id) => page.evaluate((n) => window.OSCILLA.studio.model.graph.nodes
  .find((x) => x.id === n).metadata.name, id);
/**
 * The running Envelope's level: the gain its VCA holds now (null: not running). A Meter taps
 * the Envelope (relay below), so the browser renders it and the value follows its automation
 * (an unconnected node is not rendered in Chromium).
 */
const contour = (page, id) => page.evaluate((n) => {
  const rt = window.OSCILLA.studio.runtime;
  const h = rt && rt.nodes ? rt.nodes.get(n) : null;
  return h && h.inputs && h.inputs.audio ? h.inputs.audio.gain.value : null;
}, id);
const port = (node, dir, p) => `.osc-sg-node[data-node-id="${node}"] .osc-sg-port[data-dir="${dir}"]`
  + `[data-port="${p}"] .osc-sg-glyph`;
const center = (page, sel) => page.evaluate((q) => {
  const el = document.querySelector(q);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, sel);
/** Frame the two nodes in the graph (the user's F on a selection), then clear the selection. */
async function frame(page, a, b) {
  await page.evaluate(([x, y]) => {
    const s = window.OSCILLA.studio;
    s.store.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [x, y] } });
    s.editor.frameSelection();
    s.store.dispatch({ type: 'SELECTION_CHANGE', selection: {} });
    document.querySelector('.osc-sg-viewport').scrollIntoView({ block: 'center' });
  }, [a, b]);
  await until(async () => (await center(page, port(a, 'out', 'gate')))
    && (await center(page, port(b, 'in', 'gate'))), { ms: UI_MS, what: 'both ports are drawn' });
}
/** Every text the Studio's polite live region receives from now on. */
const recordPolite = (page) => page.evaluate(() => {
  window.__polite = [];
  const el = document.querySelector('[data-osc="studio.live"]');
  new MutationObserver(() => {
    const t = el.textContent.replace(/[​-‍⁠﻿]/g, '').trim();
    if (t) window.__polite.push(t);
  }).observe(el, { childList: true, characterData: true, subtree: true });
  return el.getAttribute('aria-live');
});
const polite = (page) => page.evaluate(() => (window.__polite || []).slice());
const blur = (page) => page.evaluate(() => {
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
});
async function stopAndCensus(page, what) {
  await page.evaluate(() => window.OSCILLA.app.studioStop());
  return until(async () => {
    const c = await page.evaluate(() => window.OSCILLA.studio.counts());
    return !c.playing && c.runtimeNodes === 0 && c.engineNodes === 0 ? c : null;
  }, { ms: SOUND_MS, what });
}
/**
 * The relay: Keys Gate -> Step Modulator Clock, Step Trigger -> a new Envelope's Gate, the
 * Envelope tapped by a new Meter (so it is rendered).
 */
async function relay(page) {
  const keys = await keysId(page);
  const [steps, env, meter] = await addNodes(page, [['step-modulator', 900, 700],
    ['envelope', 1100, 700], ['meter', 1300, 700]]);
  // A Meter taps the Envelope (an AnalyserNode, which the browser renders and pulls), so the
  // Envelope's VCA is rendered and its gain follows the gate; nothing new is heard.
  await dispatch(page, { type: 'EDGE_ADD', from: { node: env, port: 'audio' },
    to: { node: meter, port: 'audio' } });
  await dispatch(page, { type: 'EDGE_ADD', from: { node: keys, port: 'gate' },
    to: { node: steps, port: 'clock' } });
  await dispatch(page, { type: 'EDGE_ADD', from: { node: steps, port: 'trigger' },
    to: { node: env, port: 'gate' } });
  return { keys, steps, env };
}

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });

  def('tg-connect', async ({ page, context, base }) => {
    const keys = await keysId(page);
    const [env] = await addNodes(page, [['envelope', ...(await beside(page, keys))]]);
    const made = {};
    // Pointer: drag from the Keys Gate to the Envelope's Gate.
    await frame(page, keys, env);
    let d0 = await depth(page);
    const a = await center(page, port(keys, 'out', 'gate'));
    const b = await center(page, port(env, 'in', 'gate'));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + (b.x - a.x) / 12, a.y + (b.y - a.y) / 12);
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    made.pointer = !!(await until(() => edgeOf(page, keys, 'gate', env, 'gate'),
      { ms: UI_MS, what: 'tg-connect: the drag makes the Gate edge' }))
      && (await depth(page)) === d0 + 1;
    await page.evaluate(() => window.OSCILLA.studio.store.undo());
    await until(async () => !(await edgeOf(page, keys, 'gate', env, 'gate')),
      { ms: UI_MS, what: 'tg-connect: undo removes it' });
    // Keyboard: the Inspector's Connect… dialog on the Keys node.
    d0 = await depth(page);
    await page.evaluate((k) => window.OSCILLA.studio.store.dispatch({ type: 'SELECTION_CHANGE',
      selection: { nodes: [k] } }), keys);
    await until(() => page.$('[data-osc="studio.inspector.connect"]'),
      { ms: UI_MS, what: 'tg-connect: the Inspector offers Connect…' });
    await page.focus('[data-osc="studio.inspector.connect"]');
    await page.keyboard.press('Enter');
    const gateOut = '#osc-dlg-studio-connect[open] [data-osc="studio.connect.output"]'
      + '[data-port="gate"]';
    await until(() => page.$(gateOut), { ms: UI_MS, what: 'tg-connect: the dialog lists Gate' });
    // The dialog places its own focus as it opens: Enter on the Gate output is repeated until
    // that output is the checked one (Enter on the checked output changes nothing).
    await until(async () => {
      if ((await page.getAttribute(gateOut, 'aria-checked')) === 'true') return true;
      await page.focus(gateOut);
      await page.keyboard.press('Enter');
      return (await page.getAttribute(gateOut, 'aria-checked')) === 'true';
    }, { ms: UI_MS, what: 'tg-connect: Enter checks the Gate output' });
    const target = `#osc-dlg-studio-connect[open] [data-osc="studio.connect.target"]`
      + `[data-node="${env}"][data-port="gate"]`;
    await until(() => page.$(target), { ms: UI_MS,
      what: 'tg-connect: the Gate output offers the Envelope\'s Gate' });
    await page.focus(target);
    await page.keyboard.press('Enter');
    made.keyboard = !!(await until(() => edgeOf(page, keys, 'gate', env, 'gate'),
      { ms: UI_MS, what: 'tg-connect: Enter in the dialog makes the Gate edge' }))
      && (await depth(page)) === d0 + 1;
    // Touch: a tap on each port in a hasTouch page of its own.
    const touchCtx = await context.browser().newContext({ viewport: PHONE, hasTouch: true,
      isMobile: true });
    try {
      const tp = await openStudio(touchCtx, base);
      await tp.evaluate(() => window.OSCILLA.app.studioSetSubview('graph'));
      const tk = await keysId(tp);
      const [te] = await addNodes(tp, [['envelope', ...(await beside(tp, tk))]]);
      await frame(tp, tk, te);
      d0 = await depth(tp);
      const ta = await center(tp, port(tk, 'out', 'gate'));
      await tp.touchscreen.tap(ta.x, ta.y);
      const hit = await tp.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el ? `${el.tagName}.${el.getAttribute('class') || ''}` : null;
      }, ta);
      await until(() => tp.evaluate(() => window.OSCILLA.studio.editor.inSelectionMode()),
        { ms: UI_MS, what: `tg-connect: a tap on the Gate starts tap-connect (hit ${hit})` });
      const tb = await center(tp, port(te, 'in', 'gate'));
      await tp.touchscreen.tap(tb.x, tb.y);
      const hitB = await tp.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return `${x | 0},${y | 0} ${el ? `${el.tagName}.${el.getAttribute('class') || ''}` : null} `
          + `vh ${innerHeight} mode ${window.OSCILLA.studio.editor.inSelectionMode()}`;
      }, tb);
      made.touch = !!(await until(() => edgeOf(tp, tk, 'gate', te, 'gate'),
        { ms: UI_MS, what: `tg-connect: a tap on the Envelope's Gate makes the edge (${hitB})` }))
        && (await depth(tp)) === d0 + 1;
    } finally {
      await touchCtx.close();
    }
    await page.evaluate(() => {
      for (const dlg of document.querySelectorAll('dialog[open]')) dlg.close();
    });
    return { ok: made.pointer && made.keyboard && made.touch, made };
  });

  def('tg-live', async ({ page }) => {
    const r = await relay(page);
    await blur(page);
    await page.keyboard.down('KeyA');
    const open = await until(async () => {
      const v = await contour(page, r.env);
      return v !== null && v > 0.5 ? v : null;
    }, { ms: SOUND_MS, what: 'tg-live: QWERTY A opens the Envelope through the Step relay' });
    const held = await page.evaluate((k) => {
      const d = window.OSCILLA.studio.runtime.debugInfo();
      const s = d.notes.find((x) => x.id === k);
      return s ? s.gate : null;
    }, r.keys);
    await page.keyboard.up('KeyA');
    const closed = await until(async () => {
      const v = await contour(page, r.env);
      return v !== null && v < 0.1 ? true : null;
    }, { ms: SOUND_MS, what: 'tg-live: the key-up releases the relayed gate' });
    const armed = await page.evaluate(() => !!window.OSCILLA.studio.transport.armed);
    await stopAndCensus(page, 'tg-live: after stop the census is 0');
    return { ok: open > 0.5 && held === true && closed && armed, open, held, armed };
  });

  def('tg-clip', async ({ page }) => {
    const r = await relay(page);
    const track = (await dispatch(page, { type: 'TRACK_ADD', kind: 'event', target: r.keys }))
      .tracks[0];
    await dispatch(page, { type: 'CLIP_ADD', trackId: track, kind: 'event', start: 0,
      duration: 0.4, payload: { action: 'gate' } });
    await dispatch(page, { type: 'LOOP_SET', enabled: true, start: 0, end: 1 });
    await page.click('[data-osc="studio.play"]');
    const open = await until(async () => {
      const v = await contour(page, r.env);
      return v !== null && v > 0.5 ? v : null;
    }, { ms: SOUND_MS, what: 'tg-clip: the Keys gate clip opens the Envelope via the Step' });
    // And closes it at the clip's end (0.4 s of each 1 s pass): a gate, not an Envelope left
    // open from the graph's start.
    const closed = await until(async () => {
      const v = await contour(page, r.env);
      return v !== null && v < 0.1 ? true : null;
    }, { ms: SOUND_MS, what: 'tg-clip: the clip\'s end releases the relayed gate' });
    // The transport as the release left it: still playing the looped timeline (a release by the
    // timeline's end would read playing false), and what it says about itself otherwise.
    const state = await page.evaluate(() => {
      const t = window.OSCILLA.studio.transport;
      const d = t.debugInfo();
      return { playing: t.playhead().playing, armed: t.armed, loop: d.loop,
        lastError: d.lastError && d.lastError.code, warnings: d.warnings.slice(-2) };
    });
    const census = await stopAndCensus(page, 'tg-clip: after stop the census is 0');
    return { ok: open > 0.5 && closed && state.playing && !!census, open, state };
  });

  def('tg-owned', async ({ page }) => {
    const r = await relay(page);
    // The Envelope's own gate clips: while the timeline plays, its Gate is the timeline's.
    const track = (await dispatch(page, { type: 'TRACK_ADD', kind: 'event', target: r.env }))
      .tracks[0];
    await dispatch(page, { type: 'CLIP_ADD', trackId: track, kind: 'event', start: 0.9,
      duration: 0.05, payload: { action: 'gate' } });
    await dispatch(page, { type: 'LOOP_SET', enabled: true, start: 0, end: 1 });
    const name = await nameOf(page, r.env);
    const ariaLive = await recordPolite(page);
    await page.click('[data-osc="studio.play"]');
    await until(() => page.evaluate(() => window.OSCILLA.studio.transport.playhead().playing),
      { ms: SOUND_MS, what: 'tg-owned: Play plays the timeline' });
    await blur(page);
    await page.keyboard.down('KeyA');
    const said = await until(async () => {
      const all = await polite(page);
      return all.find((t) => t.includes(name) && /časová osa/.test(t)) || null;
    }, { ms: SOUND_MS, what: 'tg-owned: the refusal reaches the polite live region' });
    await page.keyboard.up('KeyA');
    const census = await stopAndCensus(page, 'tg-owned: after stop the census is 0');
    return { ok: ariaLive === 'polite' && !!said && !!census, said, ariaLive };
  });

  def('no-console-errors', async ({ errors }) => ({ ok: errors.length === 0,
    errors: errors.slice(0, 3) }));
  return checks;
}

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
    for (const { name, fn } of defineChecks()) {
      if (ONLY && !ONLY.has(name) && name !== 'no-console-errors') continue;
      const t0 = Date.now();
      // Each check opens its own page on a fresh Synth document.
      let page = null;
      try {
        page = name === 'no-console-errors' ? null : await openStudio(context, base);
        const v = await bounded(fn({ page, context, base, browserName, errors }),
          { ms: CHECK_MS, what: `${name} finishes` });
        results[name] = { ...v, ms: Date.now() - t0 };
      } catch (e) {
        results[name] = { ok: false, detail: String(e.message || e).split('\n')[0],
          ms: Date.now() - t0 };
      }
      if (page) await page.close().catch(() => {});
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
    ? await serveDist(DIST, { prefix: 'oscilla-trigger-gates-' }) : null;
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
        console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/studio-trigger-gates: ${names.length
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

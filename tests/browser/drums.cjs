#!/usr/bin/env node
// suite-pace: solo (the drum steps and pads are judged by the engine's sounding sources and the transport on the audio clock, with deadlines)
// K222: the Synth's Drums tab (#m=synth&yt=drums) on the built dist/index.html in chromium,
// firefox and webkit at 1536 x 1024 (a mouse) and 390 x 844 (hasTouch): the step-grid kind
// (W008) over a notes clip on the panel's percussion engine (a25cbce9: a notes clip plays there),
// with a pad per row. Linked, real-time and interactive; every check reads the one store, the
// engine census or the page's own controls, and every wait is a condition poll with a named
// deadline (lib/wait.cjs). No sample rate is assumed.
//
//   node tests/browser/drums.cjs [--browsers chromium,firefox,webkit] [--origins file,http]
//        [--only dr-mount,dr-steps]
//
// Checks:
//   dr-mount    the tab makes its clip on request (one undo entry): a role=grid of six rows
//               named in Czech (Kopák ... Tom střední), gridcells named "Kopák, krok 1, vypnuto",
//               16 steps a page at 1536 px and 8 at 390 px, every one inside its card, no
//               horizontal page scroll; a reload keeps yt=drums and the Drums tab selected
//               (#osc-synth-tab-drums); the document itself is in memory until V604
//   dr-steps    interactive: a step by pointer (the mouse, or touch pointers at 390 px), by keys
//               (arrows and Enter) and a drag along a row: each one CLIP_UPDATE whose note is in
//               the clip within 'step note in model' (2 s), one undo entry each
//   dr-linked   linked: Open in Studio selects the same clip in the Studio at the same revision
//   dr-play     real-time: Play runs the Studio transport, aria-current=step moves within
//               'step playhead moves' (3 s) and the hit sounds (the percussion engine's voices
//               above 0) within 'drum step sounds' (3 s); at 390 px (8 a page) the grid follows
//               the step to its page ('step playhead follows to its page', 3 s) and a page the
//               user turns back holds while the playhead advances two steps (R2-K222-1); Stop
//               clears it
//   dr-end      the transport stops by itself after the bar and the Play button says Přehrát
//               again with aria-pressed false (review R2-K222-2)
//   dr-pad      a pad pressed (pointer, or Enter on it) sounds its row within 'drum pad sounds'
//               (2 s) and the hit ends with no voice left
//   dr-padplay  a pad strike arms the transport; one press of Play (a click, a tap at 390 px)
//               then starts the timeline and the next stops it (review R2-K222-5)
//   dr-record   K223: the Record switch (role=switch) on, Play, three pads struck in the pass and
//               Stop: three notes in the clip within 'take in model' (2 s) as one undo entry, and
//               one Undo removes all three; the switch off again (the R key on the desktop)
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
const RUN = suite.open({ name: 'drums', browsers: arg('browsers'), origins: arg('origins'),
  defaultOrigins: ['file'] });
const playwright = RUN.playwright;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};
const SIZES = [
  { name: 'desktop', viewport: { width: 1536, height: 1024 }, touch: false, steps: 16 },
  { name: 'phone', viewport: { width: 390, height: 844 }, touch: true, steps: 8 },
];
const LOAD_MS = 60000;
const UI_MS = 8000; // a render after a store commit
const NOTE_MS = 2000; // 'step note in model'
const PLAYHEAD_MS = 3000; // 'step playhead moves'
const SOUND_MS = 3000; // the transport arming and the audio clock reaching the hit
const END_MS = 12000; // one bar at the tempo, the look-ahead and the stop on a loaded host
const CHECK_MS = 120000;
const ROWS = ['Kopák', 'Virbl', 'Tlesk', 'Hi-hat zavřený', 'Hi-hat otevřený', 'Tom střední'];
const GRID = '[data-drums-grid] [role="grid"]';
const CELL = `${GRID} [role="gridcell"]`;

// ------------------------------------------------------------------------------ page helpers
async function openDrums(context, base) {
  const page = await context.newPage();
  await page.goto(`${base}#m=synth&yt=drums`);
  await until(() => page.evaluate(() => {
    const a = window.OSCILLA && window.OSCILLA.app;
    return !!(a && a.workspace === 'synth' && document.querySelector('[data-drums-body]'));
  }), { ms: LOAD_MS, what: 'the Synth opens on its Drums tab' });
  await page.evaluate(() => {
    const a = window.OSCILLA.app;
    a.alerts = [];
    if (!a.safetyCollapsed && typeof a.collapseSafety === 'function') a.collapseSafety();
  });
  return page;
}
/** The Drums clip: made by its button when the document has none; its id. */
async function drumClip(page) {
  const make = page.locator('[data-drums-new]');
  if (await make.count()) await make.click();
  await until(() => page.evaluate((sel) => {
    const g = document.querySelector(sel);
    if (!g || !g.getClientRects().length) return false;
    const row = g.querySelectorAll('[role="row"]:first-child [role="gridcell"]').length;
    return row === (g.clientWidth >= 16 * 44 - 15 + 88 ? 16 : g.clientWidth >= 345 ? 8 : 4);
  }, GRID), { ms: UI_MS, what: 'the Drums grid is shown and fitted' });
  return page.evaluate(() => window.OSCILLA.studio.model.timeline.clips
    .find((c) => c.kind === 'notes').id);
}
const notesOf = (page, id) => page.evaluate((cid) => window.OSCILLA.studio.model.timeline.clips
  .find((c) => c.id === cid).payload.notes.map((n) => [n.at, n.note]), id);
const undoDepth = (page) => page.evaluate(() => window.OSCILLA.studio.store.debugInfo()
  .undoDepth);
/** The percussion engine's sounding voices (its runtime handle; the panel's oscillators run
 *  whenever the transport is armed or playing, so the engine-wide census says nothing here). */
const sources = (page) => page.evaluate(() => {
  const s = window.OSCILLA.studio;
  const perc = s.model.graph.nodes.find((n) => n.type === 'perc-voice');
  const h = perc && s.runtime && s.runtime.nodes && s.runtime.nodes.get(perc.id);
  return h && h.info && typeof h.info.voices === 'function' ? h.info.voices() : 0;
});
const clearClip = (page, id) => page.evaluate((cid) => window.OSCILLA.studio.store.dispatch({
  type: 'CLIP_UPDATE', clipId: cid, payload: { notes: [] } }), id);

/** `sel` (the grid, else the cell a stroke starts on) centred in view and still for two reads
 *  in a row: a settling layout moves it, and the Synth's sticky bar covers a row near the top. */
async function settle(page, sel = GRID) {
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
  let last = '';
  await until(async () => {
    const at = await page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return `${Math.round(r.left)},${Math.round(r.top)}`;
    }, GRID);
    const still = at === last;
    last = at;
    return still;
  }, { ms: UI_MS, what: 'the Drums grid holds still' });
}
const centre = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, sel);

/** A pointer sequence on the page: the mouse, or a finger's pointer events on a phone. */
async function stroke(page, points, touch) {
  if (!touch) {
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 4 });
    await page.mouse.up();
    return;
  }
  // Playwright drives no held touch drag in every engine: the pointer events a finger sends.
  await page.evaluate((pts) => {
    const fire = (type, p) => {
      const t = document.elementFromPoint(p.x, p.y);
      if (t) t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true,
        composed: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: p.x,
        clientY: p.y, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    };
    fire('pointerdown', pts[0]);
    for (const p of pts.slice(1)) fire('pointermove', p);
    fire('pointerup', pts[pts.length - 1]);
  }, points);
}

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });

  def('dr-mount', async ({ page, size, base }) => {
    const depth = await undoDepth(page);
    const id = await drumClip(page);
    const made = (await undoDepth(page)) - depth;
    await settle(page);
    const info = await page.evaluate((sel) => {
      const g = document.querySelector(sel);
      const card = g.closest('[data-drums]').getBoundingClientRect();
      const cells = [...g.querySelectorAll('[role="gridcell"]')];
      const rects = cells.map((c) => c.getBoundingClientRect());
      return { heads: [...g.querySelectorAll('[role="rowheader"]')].map((h) => h.textContent
        .trim()), row: g.querySelectorAll('[role="row"]:first-child [role="gridcell"]').length,
      name: cells[0].getAttribute('aria-label'),
      cut: rects.filter((r) => r.left < card.left - 0.5 || r.right > card.right + 0.5).length,
      small: rects.filter((r) => r.width < 43.5 || r.height < 43.5).length,
      scroll: document.scrollingElement.scrollWidth - window.innerWidth };
    }, GRID);
    // A reload keeps the tab (the address carries yt=drums). The Studio document lives in
    // memory until V604, so the clip is made again there (the integration map's reloadDebt).
    await page.reload();
    await until(() => page.evaluate(() => !!document.querySelector('[data-drums-body]')),
      { ms: LOAD_MS, what: 'dr-mount: a reload opens the Drums tab again' });
    await drumClip(page);
    const hash = await page.evaluate(() => window.location.hash);
    // The Drums tab of the Synth's tab strip is the selected one (synth.tab, value drums).
    const selected = await page.evaluate(() => document.querySelector('#osc-synth-tab-drums')
      .getAttribute('aria-selected'));
    return { ok: made === 1 && JSON.stringify(info.heads) === JSON.stringify(ROWS)
      && info.row === size.steps && info.name === 'Kopák, krok 1, vypnuto' && info.cut === 0
      && info.small === 0 && info.scroll <= 0 && !!id && /yt=drums/.test(hash)
      && selected === 'true', made, selected,
    ...info, hash, base: !!base };
  });

  def('dr-steps', async ({ page, size }) => {
    const id = await drumClip(page);
    await clearClip(page, id);
    await settle(page, `${CELL}[data-lane="1"][data-step="4"]`);
    const d0 = await undoDepth(page);
    // A pointer (or a finger) on the snare row's fifth step.
    await stroke(page, [await centre(page, `${CELL}[data-lane="1"][data-step="4"]`)],
      size.touch);
    const one = await until(async () => {
      const n = await notesOf(page, id);
      return n.length === 1 ? n : null;
    }, { ms: NOTE_MS, what: 'step note in model (a tap)' });
    // Keys: the focus is on that step; ArrowRight then Enter puts the next one on.
    await page.locator(`${CELL}[data-lane="1"][data-step="4"]`).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    const two = await until(async () => {
      const n = await notesOf(page, id);
      return n.length === 2 ? n : null;
    }, { ms: NOTE_MS, what: 'step note in model (arrows and Enter)' });
    // A drag along the kick row paints steps 1-4.
    await settle(page, `${CELL}[data-lane="0"][data-step="0"]`);
    const pts = [];
    for (let s = 0; s < 4; s += 1) {
      pts.push(await centre(page, `${CELL}[data-lane="0"][data-step="${s}"]`));
    }
    await stroke(page, pts, size.touch);
    const six = await until(async () => {
      const n = await notesOf(page, id);
      return n.length === 6 ? n : null;
    }, { ms: NOTE_MS, what: 'step note in model (a drag)' });
    const entries = (await undoDepth(page)) - d0;
    await page.evaluate(() => window.OSCILLA.studio.store.undo());
    const undone = await until(async () => ((await notesOf(page, id)).length === 2 ? true : null),
      { ms: UI_MS, what: 'dr-steps: one undo takes the drag back' });
    return { ok: JSON.stringify(one) === '[[1,62]]' && JSON.stringify(two) === '[[1,62],[1.25,62]]'
      && six.filter((n) => n[1] === 60).length === 4 && entries === 3 && undone, one, two,
    entries };
  });

  def('dr-linked', async ({ page }) => {
    const id = await drumClip(page);
    const rev = await page.evaluate(() => window.OSCILLA.studio.store.getRevision());
    await page.locator('[data-osc="synth.drums.studio"]').click();
    const there = await until(() => page.evaluate(() => {
      const a = window.OSCILLA.app;
      const s = window.OSCILLA.studio;
      return a.workspace === 'studio' ? { clips: s.selection.clips, rev: s.store.getRevision() }
        : null;
    }), { ms: UI_MS, what: 'dr-linked: Open in Studio opens the Studio' });
    await page.goto(page.url().replace(/#.*$/, '#m=synth&yt=drums'));
    await until(() => page.evaluate(() => !!document.querySelector('[data-drums-body]')),
      { ms: LOAD_MS, what: 'dr-linked: back on the Drums tab' });
    return { ok: JSON.stringify(there.clips) === JSON.stringify([id]) && there.rev === rev,
      ...there, rev };
  });

  def('dr-play', async ({ page, size }) => {
    const id = await drumClip(page);
    await page.evaluate((cid) => window.OSCILLA.studio.store.dispatch({ type: 'CLIP_UPDATE',
      clipId: cid, payload: { notes: [0, 1, 2, 3].map((b) => ({ at: b, note: 60, len: 0.25,
        vel: 0.9 })) } }), id);
    await page.locator('[data-drums-play]').click();
    const current = () => page.evaluate((sel) => {
      const c = document.querySelector(`${sel}[aria-current="step"]`);
      return c ? Number(c.dataset.step) : null;
    }, CELL);
    const first = await until(async () => {
      const s = await current();
      return s === null ? null : { s };
    }, { ms: PLAYHEAD_MS, what: 'step playhead moves' });
    const moved = await until(async () => {
      const s = await current();
      return s !== null && s !== first.s ? { s } : null;
    }, { ms: PLAYHEAD_MS, what: 'step playhead moves' });
    const sounded = await until(async () => ((await sources(page)) > 0 ? true : null),
      { ms: SOUND_MS, what: 'drum step sounds' });
    // A page narrower than the clip follows the playing step (review R2-W8-7): at 390 px the
    // second page's steps light in turn.
    const followed = size.steps >= 16 ? true : await until(async () => {
      const s = await current();
      return s !== null && s >= size.steps ? s : null;
    }, { ms: PLAYHEAD_MS, what: 'step playhead follows to its page' });
    // Review R2-K222-1: a page the user turns while it plays holds. Measured on the clock: the
    // label stays on page 1 while the transport's playhead advances two steps.
    let held = true;
    if (size.steps < 16) {
      await page.locator('[data-drums-grid] [data-step-page="-1"]').click();
      const t0 = await page.evaluate(() => window.OSCILLA.studio.transport.playhead().position);
      const stepS = 0.25 * 60 / (await page.evaluate(() => window.OSCILLA.studio.model.transport
        .tempo));
      held = await until(async () => {
        const r = await page.evaluate(() => ({
          label: document.querySelector('[data-drums-grid] [data-step-page-label]').textContent,
          at: window.OSCILLA.studio.transport.playhead().position }));
        if (!/^Stránka 1 /.test(r.label)) throw new Error(`the turned page did not hold: ${r.label}`);
        return r.at - t0 >= 2 * stepS ? r : null;
      }, { ms: PLAYHEAD_MS, what: 'a page turned while playing holds for two steps' });
    }
    await page.locator('[data-drums-play]').click(); // Stop
    const quiet = await until(async () => ((await current()) === null
      && (await sources(page)) === 0 ? true : null),
    { ms: SOUND_MS, what: 'dr-play: Stop clears the step and leaves no voice' });
    return { ok: !!(first && moved && sounded && followed && held && quiet), first: first.s,
      moved: moved.s, followed, held: !!held };
  });

  def('dr-end', async ({ page }) => {
    // Review R2-K222-2: the transport stops by itself after the bar; the Play button says so.
    await drumClip(page);
    const btn = '[data-drums-play]';
    await page.locator(btn).click();
    await until(() => page.evaluate(() => window.OSCILLA.studio.transport.playing),
      { ms: SOUND_MS, what: 'dr-end: Play starts the transport' });
    const stopped = await until(async () => (await page.evaluate(() => window.OSCILLA.studio
      .transport.playing) ? null : true), { ms: END_MS, what: 'dr-end: the bar ends' });
    const said = await until(() => page.evaluate((sel) => {
      const b = document.querySelector(sel);
      return b.textContent.trim() === 'Přehrát' && b.getAttribute('aria-pressed') === 'false'
        ? b.textContent.trim() : null;
    }, btn), { ms: UI_MS, what: 'dr-end: the Play button says Přehrát after the bar' });
    return { ok: !!(stopped && said), said };
  });

  def('dr-pad', async ({ page, size }) => {
    await drumClip(page);
    const pad = page.locator('[data-drum-pad="0"]');
    await pad.scrollIntoViewIfNeeded();
    if (size.touch) {
      const p = await centre(page, '[data-drum-pad="0"]');
      await page.evaluate((pt) => {
        const t = document.elementFromPoint(pt.x, pt.y);
        t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 11,
          pointerType: 'touch', isPrimary: true, clientX: pt.x, clientY: pt.y, buttons: 1 }));
      }, p);
    } else {
      await pad.focus();
      await page.keyboard.down('Enter');
    }
    const sounded = await until(async () => ((await sources(page)) > 0 ? true : null),
      { ms: SOUND_MS, what: 'drum pad sounds' });
    if (size.touch) {
      const p = await centre(page, '[data-drum-pad="0"]');
      await page.evaluate((pt) => {
        const t = document.elementFromPoint(pt.x, pt.y);
        t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 11,
          pointerType: 'touch', isPrimary: true, clientX: pt.x, clientY: pt.y, buttons: 0 }));
      }, p);
    } else {
      await page.keyboard.up('Enter');
    }
    const quiet = await until(async () => ((await sources(page)) === 0 ? true : null),
      { ms: SOUND_MS, what: 'dr-pad: the kick ends with no voice left' });
    return { ok: !!(sounded && quiet) };
  });

  def('dr-padplay', async ({ page, size }) => {
    // Review R2-K222-5: a pad strike arms the transport (K104: playing true, the timeline not);
    // one press of Play must then start the timeline, not disarm it.
    await drumClip(page);
    const pad = page.locator('[data-drum-pad="0"]');
    await pad.scrollIntoViewIfNeeded();
    await pad.focus();
    await page.keyboard.press('Enter');
    const armed = await until(() => page.evaluate(() => {
      const t = window.OSCILLA.studio.transport;
      return t.armed && !t.playhead().playing ? true : null;
    }), { ms: SOUND_MS, what: 'dr-padplay: the pad strike arms the transport' });
    const play = page.locator('[data-drums-play]');
    if (size.touch) await play.tap(); else await play.click();
    const started = await until(() => page.evaluate(() => {
      const t = window.OSCILLA.studio.transport;
      return t.playing && !t.armed && t.playhead().playing ? true : null;
    }), { ms: SOUND_MS, what: 'dr-padplay: one press of Play starts the timeline' });
    if (size.touch) await play.tap(); else await play.click();
    const stopped = await until(() => page.evaluate(() => (window.OSCILLA.studio.transport
      .playhead().playing ? null : true)), { ms: SOUND_MS,
      what: 'dr-padplay: the next press stops it' });
    return { ok: !!(armed && started && stopped) };
  });

  def('dr-record', async ({ page, size }) => {
    // K223: Record beside Play. Armed and playing, three pad hits in one pass are three notes in
    // the clip once the take ends (Stop), as one undo entry that one Undo removes.
    const id = await drumClip(page);
    await clearClip(page, id);
    const depth = () => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    const press = async (sel) => {
      await page.locator(sel).scrollIntoViewIfNeeded();
      if (size.touch) await page.locator(sel).tap(); else await page.locator(sel).click();
    };
    const strike = async (i) => {
      const sel = `[data-drum-pad="${i}"]`;
      await page.locator(sel).scrollIntoViewIfNeeded();
      if (!size.touch) {
        await page.focus(sel);
        await page.keyboard.press('Enter');
        return;
      }
      const p = await centre(page, sel);
      for (const type of ['pointerdown', 'pointerup']) {
        await page.evaluate(({ pt, ty }) => {
          document.elementFromPoint(pt.x, pt.y).dispatchEvent(new PointerEvent(ty, {
            bubbles: true, pointerId: 12, pointerType: 'touch', isPrimary: true, clientX: pt.x,
            clientY: pt.y, buttons: ty === 'pointerdown' ? 1 : 0 }));
        }, { pt: p, ty: type });
      }
    };
    const sw = '[data-drums-bar] [data-notes-record]'; // the Studio Inspector has one too
    const role = await page.getAttribute(sw, 'role');
    await press(sw);
    const armed = await until(async () => ((await page.getAttribute(sw, 'aria-checked'))
      === 'true' ? true : null), { ms: UI_MS, what: 'dr-record: the Record switch is on' });
    await press('[data-drums-play]');
    await until(() => page.evaluate(() => (window.OSCILLA.studio.transport.playhead().playing
      ? true : null)), { ms: SOUND_MS, what: 'dr-record: Play plays the timeline' });
    const before = await depth();
    for (const i of [0, 1, 3]) await strike(i);
    await press('[data-drums-play]'); // Stop: the take ends
    const take = await until(async () => {
      const n = await notesOf(page, id);
      return n.length === 3 ? n : null;
    }, { ms: NOTE_MS, what: 'take in model' });
    const one = (await depth()) === before + 1;
    await page.evaluate(() => window.OSCILLA.studio.store.undo());
    const undone = await until(async () => ((await notesOf(page, id)).length === 0 ? true : null),
      { ms: NOTE_MS, what: 'dr-record: one Undo removes the take' });
    // Off: the R key on the desktop (ui/keys/clients.js notes.record), a tap on the phone.
    if (size.touch) await press(sw);
    else {
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await page.keyboard.press('KeyR');
    }
    const off = await until(async () => ((await page.getAttribute(sw, 'aria-checked'))
      === 'false' ? true : null), { ms: UI_MS, what: 'dr-record: the Record switch is off' });
    return { ok: role === 'switch' && !!(armed && take && one && undone && off),
      notes: take, one };
  });

  def('no-console-errors', async ({ errors }) => ({ ok: errors.length === 0,
    errors: errors.slice(0, 4) }));
  return checks;
}

// ------------------------------------------------------------------------------ runner
async function runLeg(browserName, base, size) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const results = {};
  try {
    const context = await browser.newContext({ viewport: size.viewport, hasTouch: size.touch });
    const errors = [];
    context.on('page', (pg) => {
      pg.on('pageerror', (e) => errors.push(String(e)));
      pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    });
    const page = await openDrums(context, base);
    for (const { name, fn } of defineChecks()) {
      if (ONLY && !ONLY.has(name)) continue;
      const t0 = Date.now();
      try {
        const v = await bounded(fn({ page, context, base, browserName, errors, size }),
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
    ? await serveDist(DIST, { prefix: 'oscilla-drums-' }) : null;
  let failed = 0;
  try {
    for (const b of RUN.browsers) {
      for (const o of RUN.origins) {
        const base = o === 'file' ? pathToFileURL(DIST).href : server.url;
        for (const size of SIZES) {
          const key = `${b}/${o}/${size.name}`;
          const t0 = Date.now();
          const res = await runLeg(b, base, size);
          const names = Object.keys(res);
          RUN.reportLeg({ leg: key, checks: names.length });
          const bad = names.filter((n) => !res[n].ok);
          failed += bad.length;
          console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/drums: ${names.length
            - bad.length}/${names.length} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
          for (const n of names) {
            const line = JSON.stringify(res[n]).slice(0, 600);
            console.log(`   ${res[n].ok ? 'ok' : 'x '} ${n}: ${line}`);
          }
        }
      }
    }
  } finally {
    if (server) server.close();
  }
  process.exit(failed ? 1 : 0);
})();

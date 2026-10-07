#!/usr/bin/env node
// OSCILLA V3.1 Studio timeline gate: the timeline editor, transport strip, automation lanes and
// compact timeline of the built dist/index.html in chromium, firefox and webkit, each from
// file:// AND from a GitHub-Pages-like sub-path (http://127.0.0.1:<port>/oscilla/).
//
//   node tests/browser/v31-studio-timeline.cjs [--browsers chromium,firefox,webkit]
//        [--origins file,http] [--only name1,name2] [--json out.json] [--screens]
//   (or OSC_BROWSERS=...)
//
// The editor under test is the one the STUDIO workspace mounts ([data-osc="studio.timeline"]) on
// the page's ONE Studio document: the canonical store, runtime and transport that
// window.OSCILLA.studio observes (rule project.studio-model-is-canonical; ledger W7a). No second
// store or transport is built for the suite. Each check opens a fresh Subtractive Synth through
// the template gallery's own action (the §257 reference: Source track with Tone 0-1 s and Sweep
// 1-3 s, filter cutoff lane 500 Hz → 8 kHz), which also empties the undo history. What the
// editor announces is read where a screen reader gets it: the workspace's live regions.
//
// Checks per browser and origin (asserted):
//   mount               tracks, clips, lane, points, ruler ticks, loop handles, accessible labels
//   clip-drag           pointer drag moves a clip by the snapped amount, one CLIP_MOVE committed at
//                       release; Escape mid-drag cancels (model unchanged); undo restores
//   clip-resize         end-handle drag resizes; dragging below the block minimum is clamped and
//                       says why; the start edge never moves
//   clip-keyboard       Arrow = one grid step, Shift+Arrow = a tenth, Enter opens the details,
//                       typed start / duration commit, Escape returns focus to the clip,
//                       Ctrl+D duplicates, Delete removes and focus moves to the neighbour, every
//                       step announced
//   create-split        add a clip from the track header and by double-click; S splits the sweep at
//                       the playhead into two sweeps meeting at the cut frequency; one undo
//   automation          double-click adds a point; drag moves it; ↑ nudges the value; numeric
//                       entry "2 kHz"; curve choice; Delete removes; lane scale is logarithmic
//   loop-markers        M adds a marker at the playhead, ←/→ move it, L toggles the loop, loop
//                       handle by keyboard, ruler click locates the transport
//   playback            Space plays, the playhead element follows transport.playhead(), the
//                       workspace header shows Playing, an edit during playback goes through the
//                       transport's edit path (decisions recorded), Space stops: 0 engine nodes
//                       and sources
//   escape-priority     while playing: Escape first cancels a drag (audio continues), then closes
//                       the details, then stops audio (0 nodes); the Playground plays afterwards
//   workspace           the page holds ONE timeline editor, on the Studio document: its clips are
//                       the model's, the header is the one transport on screen, a key moves the
//                       model's clip, Space plays the Studio transport and not the Playground
//                       instrument, Escape stops it (0 nodes)
//   compact             the Playground's compact Studio shows the same document: a clip
//                       duplicated in the timeline appears as a clip chip, and undo removes it
//   layout              no horizontal page overflow at 320, 375, 768, 1024, 1280 and 1536 px;
//                       light theme text contrast >= 4.5:1 on its surfaces
//   touch-targets       coarse pointer: buttons and handles >= 44 px
//   no-console-errors
// --screens writes PNGs to tests/visual/out-studio/ (not committed).
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { until } = require('./lib/wait.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DIST = path.resolve(__dirname, '..', '..', 'dist', 'index.html');
const RUN = suite.open({ name: 'v31-studio-timeline', browsers: arg('browsers'),
  origins: arg('origins'), defaultOrigins: ['file', 'http'] });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const ORIGINS = RUN.origins;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const JSON_OUT = arg('json', '');
const SCREENS = argv.includes('--screens');
const SHOTS = path.resolve(__dirname, '..', 'visual', 'out-studio');

const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

function startServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-v31tl-'));
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
// The workspace's timeline host, and the editor it mounts there (section.osc-stl, the one
// timeline editor of the page: the `workspace` check asserts there is no other).
const TL = '[data-osc="studio.timeline"]';

/**
 * Record what the STUDIO workspace announces: every text its polite and assertive live regions
 * take (the invisible suffix that makes a repeated sentence announce again is dropped).
 */
async function listen(page) {
  await page.evaluate(() => {
    if (window.__said) return;
    window.__said = [];
    for (const sel of ['[data-osc="studio.live"]', '[data-osc="studio.alert"]']) {
      const region = document.querySelector(sel);
      new MutationObserver(() => {
        const text = region.textContent.replace(/[​-‍⁠﻿]/g, '').trim();
        if (text) window.__said.push(text);
      }).observe(region, { childList: true, characterData: true, subtree: true });
    }
  });
}

/**
 * A fresh Subtractive Synth in the STUDIO workspace: the template gallery's Open action
 * (app.studioLoadTemplate is the button's own handler) on the canonical store, the playhead
 * returned to the start, the timeline in view and nothing announced yet.
 */
async function fresh(page, { template = 'subtractive-synth' } = {}) {
  await page.evaluate(() => {
    const a = window.OSCILLA.app;
    if (a.workspace !== 'studio') a.setWorkspace('studio');
  });
  await page.waitForFunction((tl) => document.querySelector('#osc-app').dataset.mode === 'studio'
    && !!window.OSCILLA.app.studio.ready
    && !!document.querySelector(`${tl} [data-osc="studio.tl.root"]`), TL, { timeout: 10000 });
  await listen(page);
  // A check that failed with the details panel open must not leave it to the next one.
  const open = await page.evaluate((tl) => {
    const d = document.querySelector(`${tl} [data-osc="studio.tl.details"]`);
    if (!d || d.hidden) return false;
    const field = d.querySelector('input, select, button');
    if (field) field.focus();
    return true;
  }, TL);
  if (open) await page.keyboard.press('Escape');
  await page.evaluate(async (id) => {
    const O = window.OSCILLA;
    if (O.studio.transport.playing) await O.studio.transport.stop();
    if (!O.app.studioLoadTemplate(id)) throw new Error(`template ${id} did not open`);
    O.studio.transport.returnToStart();
  }, template);
  await until(() => page.evaluate((tl) => {
    const st = window.OSCILLA.studio;
    const root = document.querySelector(`${tl} [data-osc="studio.tl.root"]`);
    const details = root.querySelector('[data-osc="studio.tl.details"]');
    return st.store.debugInfo().undoDepth === 0 && !st.transport.playing
      && st.transport.playhead().position === 0 && (!details || details.hidden)
      && root.querySelectorAll('.osc-stl-clip').length === st.model.timeline.clips.length
      && st.model.timeline.clips.length > 0;
  }, TL), { ms: 5000, what: 'a fresh template is rendered by the workspace timeline' });
  await page.evaluate((tl) => {
    document.querySelector(tl).scrollIntoView({ block: 'center' });
    window.__said.length = 0;
  }, TL);
}

const H = {
  model: (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.OSCILLA.studio.model))),
  clip: async (page, id) => (await H.model(page)).timeline.clips.find((c) => c.id === id) || null,
  rect: (page, sel) => page.evaluate((s) => {
    const n = document.querySelector(s);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2,
      cy: r.y + r.height / 2 };
  }, sel),
  focus: (page, sel) => page.evaluate((s) => document.querySelector(s).focus(), sel),
  key: async (page, k) => { await page.keyboard.press(k); await sleep(40); },
  said: (page) => page.evaluate(() => window.__said.slice()),
  /** What was announced, once every pattern has been heard (bounded; never throws). */
  heard: (page, patterns, ms = 2000) => H.until(() => H.said(page),
    (said) => patterns.every((re) => said.some((t) => re.test(t))), ms),
  counts: (page) => page.evaluate(() => ({ nodes: window.OSCILLA.engine.activeNodeCount,
    sources: window.OSCILLA.engine.activeSourceCount,
    playing: window.OSCILLA.studio.transport.playing })),
  /** The playhead as the transport reports it and as the editor drew it (px from 0 s). */
  playhead: (page) => page.evaluate((tl) => {
    const el = document.querySelector(`${tl} [data-osc="studio.tl.playhead"]`);
    const m = /translateX\(([-\d.]+)px\)/.exec(el.style.transform || '');
    return { p: window.OSCILLA.studio.transport.playhead().position, x: m ? Number(m[1]) : null };
  }, TL),
  until: async (fn, test, ms = 4000, step = 40) => {
    const t0 = Date.now();
    let v = await fn();
    while (!test(v) && Date.now() - t0 < ms) {
      await sleep(step);
      v = await fn();
    }
    return v;
  },
  active: (page) => page.evaluate(() => (document.activeElement && document.activeElement.dataset
    ? document.activeElement.dataset.key || document.activeElement.tagName : null)),
  drag: async (page, from, to, steps = 8) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(from.x + (to.x - from.x) * i / steps,
        from.y + (to.y - from.y) * i / steps);
      await sleep(10);
    }
    await page.mouse.up();
    await sleep(60);
  },
  stop: (page) => page.evaluate(() => {
    const st = window.OSCILLA && window.OSCILLA.studio;
    return st && st.transport ? st.transport.stop() : null;
  }),
};

function result(failed, extra) {
  const bad = Object.entries(failed).filter(([, ok]) => !ok).map(([k]) => k);
  return { ok: bad.length === 0, failed: bad, ...extra };
}

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  return [
    { name: 'mount', fn: async ({ page }) => {
      await fresh(page);
      const v = await page.evaluate(() => {
        const r = document.querySelector('.osc-stl');
        const clips = [...r.querySelectorAll('.osc-stl-clip')];
        return {
          clips: clips.map((c) => ({ id: c.dataset.clip, label: c.getAttribute('aria-label'),
            left: parseFloat(c.style.left), width: parseFloat(c.style.width),
            tab: c.tabIndex })),
          lanes: r.querySelectorAll('.osc-stl-row--lane').length,
          points: r.querySelectorAll('.osc-stl-pt').length,
          curve: (r.querySelector('.osc-stl-lane-curve') || {}).getAttribute
            ? r.querySelector('.osc-stl-lane-curve').getAttribute('d').length : 0,
          ticks: r.querySelectorAll('.osc-stl-tick.is-major').length,
          loopHandles: r.querySelectorAll('[role="slider"]').length,
          heads: [...r.querySelectorAll('.osc-stl-hname')].map((n) => n.textContent),
          region: r.getAttribute('role'),
          inHost: !!r.closest('[data-osc="studio.timeline"]'),
          time: document.querySelector('[data-osc="studio.time"]').textContent,
          laneScale: r.querySelector('.osc-stl-hrow--lane .osc-stl-chip').textContent,
        };
      });
      const c2 = v.clips.find((c) => c.id === 'clip-2') || {};
      return result({
        clips: v.clips.length === 2,
        positions: near(c2.left, 100, 0.5) && near(c2.width, 199, 0.5),
        label: /Pattern clip Sweep .* on Source, 1\.000 s to 3\.000 s/.test(c2.label || ''),
        tabbable: v.clips.every((c) => c.tab === 0),
        lane: v.lanes === 1 && v.points === 2 && v.curve > 10,
        logScale: /LOG Hz/.test(v.laneScale),
        ticks: v.ticks >= 4,
        loop: v.loopHandles === 2,
        heads: v.heads.includes('Source') && v.heads.some((h) => /Cutoff|Frequency/.test(h)),
        region: v.region === 'region' && v.inHost,
        clock: v.time === '00:00.000',
      }, { v });
    } },

    { name: 'clip-drag', fn: async ({ page }) => {
      await fresh(page);
      const r = await H.rect(page, '.osc-stl [data-clip="clip-2"]');
      // +0.53 s at 100 px/s with the 0.1 s grid -> 1.5 s.
      await H.drag(page, { x: r.cx, y: r.cy }, { x: r.cx + 53, y: r.cy });
      const moved = await H.clip(page, 'clip-2');
      const said = await H.heard(page, [/Moved pattern clip to 1\.500 s on Source/]);
      const undoDepth = await page.evaluate(() => window.OSCILLA.studio.store.debugInfo()
        .undoDepth);
      // Escape mid-drag cancels.
      const r2 = await H.rect(page, '.osc-stl [data-clip="clip-2"]');
      await page.mouse.move(r2.cx, r2.cy);
      await page.mouse.down();
      await page.mouse.move(r2.cx + 40, r2.cy, { steps: 5 });
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await sleep(60);
      const afterEsc = await H.clip(page, 'clip-2');
      const transform = await page.evaluate(() => document.querySelector(
        '.osc-stl [data-clip="clip-2"]')
        .style.transform);
      // Undo from the keyboard (focus is on the clip).
      await H.focus(page, '.osc-stl [data-clip="clip-2"]');
      await H.key(page, process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
      const undone = await H.clip(page, 'clip-2');
      return result({
        moved: near(moved.start, 1.5) && moved.trackId === 'track-1',
        oneEntry: undoDepth === 1,
        announced: said.some((s) => /Moved pattern clip to 1\.500 s on Source/.test(s)),
        escCancels: near(afterEsc.start, 1.5) && !transform,
        undo: near(undone.start, 1),
      }, { moved: moved.start, afterEsc: afterEsc.start, undone: undone.start, said });
    } },

    { name: 'clip-resize', fn: async ({ page }) => {
      await fresh(page);
      const r = await H.rect(page, '.osc-stl [data-clip="clip-1"]');
      // End handle: 1.0 s -> 0.6 s.
      await H.drag(page, { x: r.x + r.w - 3, y: r.cy }, { x: r.x + r.w - 43, y: r.cy });
      const c1 = await H.clip(page, 'clip-1');
      // Below the tone minimum: clamped, start never moves.
      const r2 = await H.rect(page, '.osc-stl [data-clip="clip-1"]');
      await page.mouse.move(r2.x + r2.w - 3, r2.cy);
      await page.mouse.down();
      await page.mouse.move(r2.x - 30, r2.cy, { steps: 6 });
      const chip = await page.evaluate(() => {
        const n = document.querySelector('.osc-stl .osc-stl-dragchip');
        return { hidden: n.hidden, text: n.textContent, bad: n.dataset.bad };
      });
      await page.mouse.up();
      await sleep(60);
      const c1b = await H.clip(page, 'clip-1');
      return result({
        resized: near(c1.duration, 0.6) && near(c1.start, 0),
        clampedChip: !chip.hidden && /Duration limited/.test(chip.text) && chip.bad === 'true',
        clamped: c1b.duration > 0 && c1b.duration <= 0.1 && near(c1b.start, 0),
      }, { c1, c1b, chip });
    } },

    { name: 'clip-keyboard', fn: async ({ page }) => {
      await fresh(page);
      await H.focus(page, '.osc-stl [data-clip="clip-2"]');
      await H.key(page, 'ArrowRight');
      const a = await H.clip(page, 'clip-2');
      await H.key(page, 'Shift+ArrowRight');
      const b = await H.clip(page, 'clip-2');
      await H.key(page, 'Enter');
      const det = await page.evaluate(() => ({
        open: !document.querySelector('.osc-stl [data-osc="studio.tl.details"]').hidden,
        focus: document.activeElement.dataset.field }));
      await page.fill('.osc-stl [data-osc="studio.tl.details"] [data-field="start"]', '2.5');
      await page.press('.osc-stl [data-osc="studio.tl.details"] [data-field="start"]', 'Enter');
      await sleep(60);
      await page.fill('.osc-stl [data-osc="studio.tl.details"] [data-field="duration"]', '1.25');
      await page.press('.osc-stl [data-osc="studio.tl.details"] [data-field="duration"]', 'Tab');
      await sleep(60);
      const c = await H.clip(page, 'clip-2');
      await H.key(page, 'Escape');
      const back = await H.active(page);
      const closed = await page.evaluate(() => document.querySelector(
        '.osc-stl [data-osc="studio.tl.details"]').hidden);
      await H.key(page, process.platform === 'darwin' ? 'Meta+d' : 'Control+d');
      const dup = (await H.model(page)).timeline.clips;
      const dupFocus = await H.active(page);
      await H.key(page, 'Delete');
      const afterDel = (await H.model(page)).timeline.clips;
      const delFocus = await H.active(page);
      const said = await H.heard(page, [/Moved pattern clip to 1\.100 s/, /Duplicated clip/,
        /Deleted/]);
      return result({
        arrow: near(a.start, 1.1),
        shift: near(b.start, 1.11),
        detailsOpen: det.open && det.focus === 'start',
        typed: near(c.start, 2.5) && near(c.duration, 1.25),
        escReturns: closed && back === 'clip:clip-2',
        duplicate: dup.length === 3 && dupFocus === `clip:${dup[2].id}`
          && near(dup[2].start, 3.75),
        deleted: afterDel.length === 2 && /^clip:/.test(delFocus || '')
          && delFocus !== `clip:${dup[2].id}`,
        announced: said.some((s) => /Moved pattern clip to 1\.100 s/.test(s))
          && said.some((s) => /Duplicated clip/.test(s)) && said.some((s) => /Deleted/.test(s)),
      }, { a: a.start, b: b.start, det, c, back, dupFocus, delFocus, said });
    } },

    { name: 'create-split', fn: async ({ page }) => {
      await fresh(page);
      await page.click('.osc-stl [data-key="track-add:track-1"]');
      await sleep(60);
      const m1 = await H.model(page);
      const added = m1.timeline.clips.find((c) => !['clip-1', 'clip-2'].includes(c.id));
      // Double-click an empty spot at 6.0 s.
      const row = await H.rect(page, '.osc-stl .osc-stl-row--track');
      const content = await H.rect(page, '.osc-stl .osc-stl-content');
      await page.mouse.dblclick(content.x + 600, row.cy);
      await sleep(80);
      const m2 = await H.model(page);
      const at6 = m2.timeline.clips.find((c) => near(c.start, 6));
      // Split the 220 -> 880 log sweep at 2.0 s (the halfway point: 440 Hz).
      await page.evaluate(() => window.OSCILLA.studio.transport.locate(2));
      await H.focus(page, '.osc-stl [data-clip="clip-2"]');
      await H.key(page, 's');
      const m3 = await H.model(page);
      const left = m3.timeline.clips.find((c) => c.id === 'clip-2');
      const right = m3.timeline.clips.find((c) => c.kind === 'pattern' && near(c.start, 2)
        && c.payload.blockType === 'sweep');
      const undo = await page.evaluate(() => window.OSCILLA.studio.store.undo());
      const m4 = await H.model(page);
      return result({
        headerAdd: !!added && near(added.start, 3) && added.payload.blockType === 'tone',
        dblclickAdd: !!at6 && near(at6.duration, 1),
        splitLeft: near(left.duration, 1) && near(left.payload.params.end, 440, 1e-6),
        splitRight: !!right && near(right.duration, 1) && near(right.payload.params.start, 440,
          1e-6) && right.payload.params.end === 880,
        oneUndo: undo.ok && /^Split pattern clip/.test(undo.label)
          && m4.timeline.clips.length === m2.timeline.clips.length
          && near(m4.timeline.clips.find((c) => c.id === 'clip-2').duration, 2),
      }, { added, at6, left, right, undo });
    } },

    { name: 'automation', fn: async ({ page }) => {
      await fresh(page);
      const lane = await H.rect(page, '.osc-stl .osc-stl-row--lane');
      const content = await H.rect(page, '.osc-stl .osc-stl-content');
      await page.mouse.dblclick(content.x + 150, lane.y + lane.h / 2);
      await sleep(80);
      const m1 = await H.model(page);
      const pts = m1.timeline.automation[0].points;
      const added = pts.find((p) => !['pt-1', 'pt-2'].includes(p.id));
      const focus1 = await H.active(page);
      // Drag it +0.5 s.
      const pr = await H.rect(page, `.osc-stl [data-point="${added.id}"]`);
      await H.drag(page, { x: pr.cx, y: pr.cy }, { x: pr.cx + 50, y: pr.cy });
      const moved = (await H.model(page)).timeline.automation[0].points
        .find((p) => p.id === added.id);
      await H.focus(page, `.osc-stl [data-point="${added.id}"]`);
      await H.key(page, 'ArrowUp');
      const up = (await H.model(page)).timeline.automation[0].points.find((p) => p.id === added.id);
      await H.key(page, 'Enter');
      await page.fill('.osc-stl [data-osc="studio.tl.details"] [data-field="value"]', '2 kHz');
      await page.press('.osc-stl [data-osc="studio.tl.details"] [data-field="value"]', 'Enter');
      await sleep(60);
      await page.selectOption('.osc-stl [data-osc="studio.tl.details"] [data-field="curve"]',
        'exponential');
      await sleep(60);
      const typed = (await H.model(page)).timeline.automation[0].points
        .find((p) => p.id === added.id);
      const curveOpts = await page.evaluate(() => [...document.querySelectorAll(
        '.osc-stl [data-osc="studio.tl.details"] [data-field="curve"] option')]
        .map((o) => o.value));
      await H.key(page, 'Escape');
      await H.focus(page, `.osc-stl [data-point="${added.id}"]`);
      await H.key(page, 'Delete');
      const after = (await H.model(page)).timeline.automation[0].points;
      return result({
        added: !!added && near(added.time, 1.5, 0.051) && added.value > 500,
        focused: focus1 === `pt:lane-1:${added && added.id}`,
        dragged: near(moved.time, added.time + 0.5, 0.051),
        nudged: up.value > moved.value && near(up.time, moved.time),
        typed: near(typed.value, 2000, 1e-6) && typed.curve === 'exponential',
        curves: curveOpts.join() === 'step,linear,exponential',
        deleted: after.length === 2,
      }, { added, moved, up, typed, curveOpts });
    } },

    { name: 'loop-markers', fn: async ({ page }) => {
      await fresh(page);
      await page.evaluate(() => window.OSCILLA.studio.transport.locate(1.2));
      await H.focus(page, '.osc-stl [data-clip="clip-1"]');
      await H.key(page, 'm');
      const m1 = await H.model(page);
      const mk = m1.timeline.markers[0];
      const focus = await H.active(page);
      await H.key(page, 'ArrowRight');
      const mk2 = (await H.model(page)).timeline.markers[0];
      await H.key(page, 'l');
      const loopOn = (await H.model(page)).timeline.loop;
      await H.focus(page, '.osc-stl [data-key="loop:end"]');
      await H.key(page, 'ArrowLeft');
      const loop2 = (await H.model(page)).timeline.loop;
      // Ruler click at 2.5 s locates the transport.
      const ruler = await H.rect(page, '.osc-stl .osc-stl-ruler');
      const content = await H.rect(page, '.osc-stl .osc-stl-content');
      await page.mouse.click(content.x + 250, ruler.y + ruler.h - 4);
      await sleep(60);
      const ph = await page.evaluate(() => window.OSCILLA.studio.transport.playhead());
      const phX = (await H.until(() => H.playhead(page), (h) => near(h.x, 250, 0.6), 1000)).x;
      // ] jumps to the next marker (none after 2.5 s), [ to the previous one.
      await H.focus(page, '.osc-stl [data-clip="clip-1"]');
      await H.key(page, '[');
      const ph2 = await page.evaluate(() => window.OSCILLA.studio.transport.playhead());
      return result({
        marker: !!mk && near(mk.time, 1.2) && focus === `marker:${mk.id}`,
        markerMove: near(mk2.time, 1.3),
        loop: loopOn.enabled === true,
        loopKey: near(loop2.end, loopOn.end - 0.1),
        locate: near(ph.position, 2.5) && near(phX, 250, 0.6),
        markerNav: near(ph2.position, 1.3),
      }, { mk, mk2, loopOn, loop2, ph, phX, ph2 });
    } },

    { name: 'playback', fn: async ({ page }) => {
      await fresh(page);
      await H.focus(page, '.osc-stl [data-clip="clip-1"]');
      await H.key(page, ' ');
      const playing = await H.until(() => H.counts(page), (c) => c.playing, 2000);
      await sleep(500);
      const s1 = await H.playhead(page);
      await sleep(300);
      // The header is the one transport on screen: its PLAY key reads Playing.
      const s2 = { ...await H.playhead(page), state: await page.evaluate(() => document
        .querySelector('[data-osc="studio.play"]').getAttribute('aria-pressed')) };
      // Edit during playback: move the sweep one step later.
      await H.focus(page, '.osc-stl [data-clip="clip-2"]');
      await H.key(page, 'ArrowRight');
      const dbg = await page.evaluate(() => {
        const d = window.OSCILLA.studio.transport.debugInfo();
        return { decisions: d.decisions.length, kinds: [...new Set(d.decisions
          .map((x) => x.decision))] };
      });
      const nodesWhile = (await H.counts(page)).nodes;
      await H.key(page, ' ');
      const after = await H.until(() => H.counts(page),
        (c) => !c.playing && c.nodes === 0 && c.sources === 0, 3000);
      const said = await H.heard(page, [/^Playing from/, /^Stopped$/]);
      return result({
        playing: playing.playing && s2.state === 'true',
        advances: s2.p > s1.p && s1.p > 0.2,
        follows: near(s2.x / 100, s2.p, 0.12),
        editPath: dbg.decisions > 0,
        sounding: nodesWhile > 0,
        stopped: !after.playing && after.nodes === 0 && after.sources === 0,
        announced: said.some((s) => /^Playing from/.test(s)) && said.includes('Stopped'),
      }, { s1, s2, dbg, after, said });
    } },

    { name: 'escape-priority', fn: async ({ page }) => {
      await fresh(page);
      await page.click('[data-osc="studio.play"]');
      await H.until(() => H.counts(page), (c) => c.playing, 2000);
      const r = await H.rect(page, '.osc-stl [data-clip="clip-2"]');
      await page.mouse.move(r.cx, r.cy);
      await page.mouse.down();
      await page.mouse.move(r.cx + 40, r.cy, { steps: 5 });
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await sleep(80);
      const afterGesture = await H.counts(page);
      const clip = await H.clip(page, 'clip-2');
      await H.focus(page, '.osc-stl [data-clip="clip-2"]');
      await H.key(page, 'Enter');
      await H.key(page, 'Escape');
      const afterPopup = await H.counts(page);
      const closed = await page.evaluate(() => document.querySelector(
        '.osc-stl [data-osc="studio.tl.details"]').hidden);
      await H.key(page, 'Escape');
      const stopped = await H.until(() => H.counts(page),
        (c) => !c.playing && c.nodes === 0 && c.sources === 0, 3000);
      // The Playground keeps working: a latched voice plays and stops cleanly.
      await page.evaluate(() => window.OSCILLA.app.setWorkspace('playground'));
      await page.evaluate(() => window.OSCILLA.app.play('hold'));
      const pg = await H.until(() => page.evaluate(() => ({ playing: window.OSCILLA.app.playing,
        nodes: window.OSCILLA.engine.activeNodeCount })), (v) => v.playing && v.nodes > 0, 2000);
      await page.evaluate(() => window.OSCILLA.app.stopNow());
      const pgStop = await H.until(() => H.counts(page), (c) => c.nodes === 0 && c.sources === 0,
        3000);
      return result({
        gestureFirst: afterGesture.playing && near(clip.start, 1),
        popupSecond: afterPopup.playing && closed,
        stopThird: !stopped.playing && stopped.nodes === 0 && stopped.sources === 0,
        playground: pg.playing && pg.nodes > 0 && pgStop.nodes === 0,
      }, { afterGesture, afterPopup, stopped, pg, pgStop });
    } },

    { name: 'workspace', fn: async ({ page }) => {
      // The page holds ONE timeline editor, the STUDIO workspace's, on the ONE Studio document:
      // there is no second store or transport for it to disagree with (ledger W7a).
      await fresh(page);
      const v0 = await page.evaluate((w) => {
        const host = document.querySelector(w);
        const st = window.OSCILLA.studio;
        return { roots: document.querySelectorAll('[data-osc="studio.tl.root"]').length,
          inHost: host.querySelectorAll('[data-osc="studio.tl.root"]').length,
          clips: [...host.querySelectorAll('.osc-stl-clip')].map((c) => c.dataset.clip),
          modelClips: st.model.timeline.clips.map((c) => c.id),
          visible: host.getBoundingClientRect().height > 0,
          // one transport on screen: the header's; the embedded strip keeps mode and tempo
          tlKeys: host.querySelectorAll('[data-osc="studio.tl.play"], [data-osc="studio.tl.time"]')
            .length,
          headerPlay: document.querySelectorAll('[data-osc="studio.play"]').length,
          tempo: host.querySelectorAll('[data-osc="studio.tl.tempo"]').length };
      }, TL);
      const start = (await H.clip(page, 'clip-2')).start;
      await H.focus(page, '.osc-stl [data-clip="clip-2"]');
      await H.key(page, 'ArrowRight');
      const moved = await page.evaluate(() => ({
        model: window.OSCILLA.studio.model.timeline.clips.find((c) => c.id === 'clip-2').start,
        left: parseFloat(document.querySelector('.osc-stl [data-clip="clip-2"]').style.left) }));
      await H.key(page, ' ');
      const playing = await H.until(() => page.evaluate(() => ({
        studio: window.OSCILLA.studio.transport.playing,
        instrument: window.OSCILLA.app.playing })), (x) => x.studio, 2000);
      await sleep(300);
      await H.key(page, 'Escape');
      const stopped = await H.until(() => page.evaluate(() => window.OSCILLA.studio.counts()),
        (c) => !c.playing && c.engineNodes === 0 && c.engineSources === 0, 3000);
      return result({
        oneInstance: v0.roots === 1 && v0.inHost === 1 && v0.visible,
        oneTransport: v0.tlKeys === 0 && v0.headerPlay === 1 && v0.tempo === 1,
        projection: v0.clips.length > 0 && v0.clips.join() === v0.modelClips.join(),
        keyMovesModel: near(moved.model, start + 0.1) && near(moved.left, (start + 0.1) * 100, 0.5),
        spacePlaysStudio: playing.studio && !playing.instrument,
        escapeStops: !stopped.playing && stopped.engineNodes === 0 && stopped.engineSources === 0,
      }, { v0, start, moved, playing, stopped });
    } },

    { name: 'compact', fn: async ({ page }) => {
      // The Playground's compact Studio is a second view of the same document (§127-§129): an
      // edit made in the timeline is the clip chip it shows, and so is its undo.
      await fresh(page);
      await H.focus(page, '.osc-stl [data-clip="clip-2"]');
      await H.key(page, process.platform === 'darwin' ? 'Meta+d' : 'Control+d');
      const dup = (await H.model(page)).timeline.clips.map((c) => c.id);
      await page.evaluate(() => window.OSCILLA.app.setWorkspace('playground'));
      const view = () => page.evaluate(() => {
        const host = document.querySelector('[data-osc="studio.compact"]');
        const shown = (el) => !!el && el.getBoundingClientRect().width > 0
          && el.getBoundingClientRect().height > 0;
        const m = window.OSCILLA.studio.model;
        return { shown: shown(host),
          title: (host.querySelector('[data-osc="studio.compact.title"]') || {}).textContent,
          modelTitle: m.metadata.title,
          chips: [...host.querySelectorAll('[data-osc="studio.compact.clip"]')].filter(shown)
            .map((c) => c.dataset.clipId),
          clips: m.timeline.clips.map((c) => c.id) };
      });
      const same = (v, n) => v.shown && v.chips.length === n
        && [...v.chips].sort().join() === [...v.clips].sort().join();
      const after = await H.until(view, (v) => same(v, 3), 3000);
      const undo = await page.evaluate(() => window.OSCILLA.studio.store.undo());
      const undone = await H.until(view, (v) => same(v, 2), 3000);
      return result({
        duplicated: dup.length === 3,
        follows: same(after, 3) && after.chips.includes(dup[2]),
        title: after.title === after.modelTitle && /Subtractive Synth/.test(after.title || ''),
        undo: undo.ok && same(undone, 2) && !undone.chips.includes(dup[2]),
      }, { dup, after, undo, undone });
    } },

    { name: 'layout', fn: async ({ page }) => {
      const out = {};
      let ok = true;
      for (const w of [320, 375, 768, 1024, 1280, 1536]) {
        await page.setViewportSize({ width: w, height: 900 });
        await fresh(page);
        await sleep(60);
        const v = await page.evaluate(() => {
          const r0 = document.querySelector('.osc-stl');
          const r = r0.getBoundingClientRect();
          const host = r0.closest('[data-osc="studio.timeline"]');
          return { page: document.documentElement.scrollWidth, inner: window.innerWidth,
            right: Math.round(r.right), host: host.scrollWidth - host.clientWidth };
        });
        out[w] = v;
        if (v.page > v.inner || v.right > v.inner || v.host > 0) ok = false;
      }
      await page.setViewportSize({ width: 1536, height: 1024 });
      // Light theme: text on its own surface >= 4.5:1. Measured with reduced motion, the app's
      // own path that shortens every transition to 0.01 ms (base.css): on CI WebKit a reading
      // taken before the theme's colour transitions had started agreed with the next one and
      // failed at time 1.1:1, help 3.41:1, although the settled colours pass.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await fresh(page);
      // Colours are measured once the theme has settled: a style flush and two frames (so the
      // theme change has started its transitions, e.g. .osc-btn's 0.12 s colour transition),
      // then every running animation finished, then two consecutive readings that agree
      // (mid-change values flaked on WebKit in CI: time 1.1:1, help 3.41:1).
      // Only animations with a finite end are awaited, and never longer than 2 s: under reduced
      // motion Firefox holds one whose finished promise never resolves, and an unbounded wait
      // ran the check into its 60 s timeout.
      const settle = () => page.evaluate(async () => {
        void document.body.offsetHeight;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const finite = document.getAnimations().filter((a) => {
          const end = a.effect && a.effect.getComputedTiming().endTime;
          return Number.isFinite(end);
        });
        await Promise.race([
          Promise.all(finite.map((a) => a.finished.catch(() => null))),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
      });
      const measure = () => page.evaluate(() => {
        const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const lum = ([r, g, b]) => {
          const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92
            : ((v + 0.055) / 1.055) ** 2.4; };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const bgOf = (n) => {
          for (let e = n; e; e = e.parentElement) {
            const b = getComputedStyle(e).backgroundColor;
            if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return rgb(b);
          }
          return [255, 255, 255];
        };
        const ratio = (sel) => {
          const n = document.querySelector(`.osc-stl ${sel}`);
          const a = lum(rgb(getComputedStyle(n).color));
          const b = lum(bgOf(n));
          return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
        };
        return { time: ratio('[data-osc="studio.tl.time"]'),
          head: ratio('.osc-stl-hname'), tick: ratio('.osc-stl-ticklabel'),
          clip: ratio('[data-clip="clip-1"] .osc-block-name'),
          sweep: ratio('[data-clip="clip-2"] .osc-block-name'),
          help: ratio('.osc-stl-help') };
      });
      let contrast = null;
      for (let i = 0; i < 20; i++) {
        await settle();
        const next = await measure();
        if (contrast && JSON.stringify(next) === JSON.stringify(contrast)) break;
        contrast = next;
      }
      await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      await page.emulateMedia({ reducedMotion: null });
      const light = Object.values(contrast).every((r) => r >= 4.5);
      return result({ noOverflow: ok, light }, { out, contrast });
    } },

    { name: 'touch-targets', fn: async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 },
        hasTouch: true, isMobile: true });
      const page = await context.newPage();
      await page.goto(currentBase, { waitUntil: 'load' });
      await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
      await fresh(page);
      const v = await page.evaluate(() => {
        const coarse = matchMedia('(pointer: coarse)').matches;
        const small = [];
        const sel = '.osc-stl button, .osc-stl select, .osc-stl input, .osc-stl .osc-stl-pt, '
          + '.osc-stl .osc-stl-loop-h';
        for (const n of document.querySelectorAll(sel)) {
          const r = n.getBoundingClientRect();
          if (!r.width) continue;
          if (r.height < 43.5 || (n.matches('.osc-icon-btn, .osc-stl-pt') && r.width < 43.5)) {
            small.push(`${n.dataset.osc || n.dataset.key || n.className}: ${Math.round(r.width)}x`
              + `${Math.round(r.height)}`);
          }
        }
        const overflow = document.documentElement.scrollWidth > innerWidth;
        return { coarse, small: small.slice(0, 12), overflow };
      });
      if (SCREENS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${currentKey}-390-touch.png`) });
      }
      await context.close();
      return result({ coarse: v.coarse, targets: v.small.length === 0, noOverflow: !v.overflow },
        { v });
    } },
  ];
}

let currentBase = '';
let currentKey = '';

async function screens(page) {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const [w, theme] of [[1536, 'dark'], [1536, 'light'], [390, 'dark']]) {
    await page.setViewportSize({ width: w, height: w > 600 ? 1024 : 844 });
    if (theme === 'light') {
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    }
    await fresh(page);
    await page.evaluate(() => {
      const { store, transport } = window.OSCILLA.studio;
      store.dispatch({ type: 'MARKER_ADD', kind: 'sweep', time: 1, label: 'Sweep' });
      store.dispatch({ type: 'LOOP_SET', enabled: true, start: 0.5, end: 2.5 });
      transport.locate(1.75);
      store.dispatch({ type: 'SELECTION_CHANGE', selection: { clips: ['clip-2'] } });
    });
    await sleep(200);
    await page.screenshot({ path: path.join(SHOTS, `${currentKey}-${w}-${theme}.png`) });
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  }
  await page.setViewportSize({ width: 1536, height: 1024 });
}

async function runOne(browserName, origin, baseUrl) {
  currentBase = baseUrl;
  currentKey = `${browserName}-${origin}`;
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
  await page.evaluate(() => {
    const a = window.OSCILLA.app;
    a.alerts = [];
    if (!a.safetyCollapsed) a.collapseSafety();
  });
  const checks = [...defineChecks(), { name: 'no-console-errors',
    fn: async () => ({ ok: errors.length === 0, errors: errors.slice(0, 5) }) }];
  for (const { name, fn } of checks) {
    if (ONLY && !ONLY.has(name) && name !== 'no-console-errors') continue;
    const t0 = Date.now();
    try {
      const v = await Promise.race([fn({ page, context, browser, errors, browserName, origin }),
        sleep(60000).then(() => ({ ok: false, detail: 'timeout 60 s' }))]);
      results[name] = { ...v, ms: Date.now() - t0 };
    } catch (e) {
      results[name] = { ok: false, detail: String(e.message || e).split('\n')[0],
        ms: Date.now() - t0 };
    }
    try { await H.stop(page); } catch { /* page gone */ }
  }
  if (SCREENS) {
    try { await screens(page); } catch (e) { console.log(`screens: ${e.message}`); }
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
        console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/v31-studio-timeline: `
          + `${names.length - bad.length}/${names.length} checks `
          + `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        for (const n of bad) {
          const why = res[n].failed ? `failed [${res[n].failed.join(', ')}] ` : '';
          console.log(`   x ${n}: ${why}${JSON.stringify(res[n]).slice(0, 1200)}`);
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

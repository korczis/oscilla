#!/usr/bin/env node
// K068: notes clips PLAY on the audio clock, on the built dist/index.html in chromium, firefox and
// webkit at 1536 x 1024 (the touch checks in a hasTouch page of the same size): linked,
// real-time and interactive. Every check reads the one store, the transport's or the runtime's
// debugInfo or the page's own controls; each wait is a condition poll with a named deadline
// (tests/browser/lib/wait.cjs), and no sample rate is assumed (every time is the audio clock's).
//
//   node tests/browser/steps.cjs [--browsers chromium,firefox,webkit] [--origins file,http]
//        [--only st-linked,st-realtime]
//
// Checks:
//   st-linked    linked: the Synth workspace's panel (its Keys node) takes a notes clip with a
//                grid on an event track in the Studio timeline (one undo entry each); Play in
//                the Studio plays it on the panel: the Keys node's gate onsets advance in the
//                runtime debugInfo and the engine sounds; with the Synth workspace shown the
//                same transport keeps playing the panel (onsets still advance) and its playhead
//                keeps advancing, the same transport.playhead() read from both workspaces. The
//                Synth workspace has no playhead of its own: the check reads the shared
//                transport's position from both, and names that gap in its result
//   st-realtime  real-time: the playing step index the transport reports (debugInfo().steps)
//                follows transport.playhead() through at least four distinct steps; a tempo
//                typed into the tempo spinbutton while playing changes the onset interval the
//                runtime debugInfo measures, from a sixteenth at 120 BPM to one at 60 BPM
//   st-keys      interactive: Play and Stop by pointer, Space on the graph and touch; Tap by
//                pointer and Enter (one series: a fourth tap sets the tempo with one undo entry,
//                clamped to the tempo range, since the taps come faster than 300 BPM) and by
//                touch in a hasTouch page; after each stop the engine and runtime census is 0
//   st-a11y      the transport group's buttons (Play, Stop, Return to start, Loop), the tempo
//                spinbutton and Tap tempo are in the accessibility tree with their names
//   no-console-errors
// On b7a5c9f7 st-linked and st-realtime fail (a notes clip with a grid is refused, nothing plays
// it) and st-keys fails at its first Tap (the strip has no Tap tempo button).
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
const RUN = suite.open({ name: 'steps', browsers: arg('browsers'), origins: arg('origins'),
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
const UI_MS = 8000; // a store commit, its render, a workspace switch
const SOUND_MS = 15000; // the transport starting, the audio clock reaching the next onsets
const CHECK_MS = 180000;
const TAP = 'button[aria-label="Tap tempo"]';
/** The timeline's strip of the time mode, the tempo and Tap (transport-bar.js, keys: false). */
const strip = (page) => page.getByRole('group', { name: 'Timeline time mode and tempo' });

// ------------------------------------------------------------------------------ page helpers
async function openStudio(context, base) {
  const page = await context.newPage();
  // The Synth workspace first: it puts its panel (and its Keys node) into the Studio document.
  await page.goto(`${base}#m=synth`);
  await until(() => page.evaluate(() => {
    const a = window.OSCILLA && window.OSCILLA.app;
    return !!(a && a.synthDebug && a.synthDebug().present && a.synthDebug().nodes.keys
      && window.OSCILLA.studio && window.OSCILLA.studio.store);
  }), { ms: LOAD_MS, what: 'the Synth panel is in the Studio document' });
  await showStudio(page);
  await page.evaluate(() => {
    const a = window.OSCILLA.app;
    a.alerts = [];
    if (!a.safetyCollapsed && typeof a.collapseSafety === 'function') a.collapseSafety();
  });
  return page;
}
async function showStudio(page) {
  await page.evaluate(() => window.OSCILLA.app.setWorkspace('studio'));
  await until(() => page.evaluate(() => {
    const s = window.OSCILLA.studio;
    return !!(s && s.editor && s.transport && window.OSCILLA.app.workspace === 'studio'
      && document.querySelector('[data-osc="studio.play"]')
      && document.querySelector('[data-osc="studio.tl.tempo"]'));
  }), { ms: LOAD_MS, what: 'the Studio workspace is ready' });
}
async function showSynth(page) {
  await page.evaluate(() => window.OSCILLA.app.setWorkspace('synth'));
  await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'synth'
    && !document.getElementById('osc-view-synth').hidden),
  { ms: UI_MS, what: 'the Synth workspace is shown' });
}
const depth = (page) => page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
const playingNow = (page) => page.evaluate(() => !!window.OSCILLA.studio.transport.playing);

/**
 * A notes clip with a grid on the panel's Keys node: an event track on it and the clip (16
 * sixteenths, 4 beats), each one store dispatch, and the loop over the clip so that it plays on.
 * -> { keys, clipId, depths: [before, after track, after clip] }
 */
function addSteps(page) {
  return page.evaluate(() => {
    const s = window.OSCILLA.studio;
    const keys = window.OSCILLA.app.synthDebug().nodes.keys;
    const d0 = s.store.debugInfo().undoDepth;
    const must = (r, what) => {
      if (!r.ok) throw new Error(`${what}: ${r.reason}`);
      return r;
    };
    must(s.store.dispatch({ type: 'TRANSPORT_SET', tempo: 120 }), 'tempo');
    const track = must(s.store.dispatch({ type: 'TRACK_ADD', kind: 'event', target: keys }),
      'track').created.tracks[0];
    const d1 = s.store.debugInfo().undoDepth;
    const notes = Array.from({ length: 16 }, (_, i) => ({ at: i * 0.25, note: 57 + (i % 4) * 3,
      len: 0.15, vel: i % 4 === 0 ? 1 : 0.6 }));
    const clipId = must(s.store.dispatch({ type: 'CLIP_ADD', trackId: track, kind: 'notes',
      startBeats: 0, durationBeats: 4, payload: { notes,
        grid: { stepBeats: 0.25, swing: 0, seed: 1 } } }), 'notes clip').created.clips[0];
    const d2 = s.store.debugInfo().undoDepth;
    const clip = s.store.getModel().timeline.clips.find((c) => c.id === clipId);
    must(s.store.dispatch({ type: 'LOOP_SET', enabled: true, start: clip.start,
      end: clip.start + clip.duration }), 'loop');
    return { keys, clipId, depths: [d0, d1, d2] };
  });
}
/** The Keys node's note state in the runtime debugInfo (onsets, interval), or null. */
const keysState = (page, keys) => page.evaluate((k) => {
  const rt = window.OSCILLA.studio.runtime;
  const d = rt ? rt.debugInfo() : null;
  return d && Array.isArray(d.notes) ? d.notes.find((x) => x.id === k) || null : null;
}, keys);
/** RMS of the engine's analyser after the safety chain, in dB re full scale. */
const rmsDb = (page) => page.evaluate(() => {
  const an = window.OSCILLA.engine.analyser;
  const buf = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(buf);
  let s = 0;
  for (const v of buf) s += v * v;
  return 10 * Math.log10(s / buf.length + 1e-20);
});
/** Onsets of the Keys node later than `after` (audio time) reach `count`. */
async function onsetsAfter(page, keys, after, count, what) {
  return until(async () => {
    const st = await keysState(page, keys);
    const n = st ? st.onsets.filter((t) => t > after).length : 0;
    return n >= count ? st : null;
  }, { ms: SOUND_MS, what });
}
const clock = (page) => page.evaluate(() => window.OSCILLA.engine.ctx.currentTime);
async function stopAndCensus(page, what) {
  await page.evaluate(() => window.OSCILLA.app.studioStop());
  return until(async () => {
    const c = await page.evaluate(() => window.OSCILLA.studio.counts());
    return !c.playing && c.runtimeNodes === 0 && c.engineNodes === 0 ? c : null;
  }, { ms: SOUND_MS, what });
}

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });
  let steps = null;
  const ensureSteps = async (page) => {
    if (!steps) steps = await addSteps(page);
    return steps;
  };

  def('st-linked', async ({ page }) => {
    const s = await ensureSteps(page);
    const [d0, d1, d2] = s.depths;
    await page.click('[data-osc="studio.play"]');
    await until(() => playingNow(page), { ms: SOUND_MS, what: 'st-linked: Play starts' });
    const t0 = await clock(page);
    const inStudio = await onsetsAfter(page, s.keys, t0, 3,
      'st-linked: the panel\'s Keys node plays the clip in the Studio');
    let loudest = -Infinity;
    await until(async () => {
      loudest = Math.max(loudest, await rmsDb(page));
      return loudest > -50;
    }, { ms: SOUND_MS, what: 'st-linked: the panel sounds (analyser RMS above -50 dB)' });
    const studioHead = await page.evaluate(() => window.OSCILLA.studio.transport.playhead());
    await showSynth(page);
    const t1 = await clock(page);
    const inSynth = await onsetsAfter(page, s.keys, t1, 3,
      'st-linked: with the Synth workspace shown, the same transport plays the panel on');
    const synthHead = await until(async () => {
      const p = await page.evaluate(() => window.OSCILLA.studio.transport.playhead());
      return p.playing && p.pass > studioHead.pass ? p : null;
    }, { ms: SOUND_MS, what: 'st-linked: the shared playhead advances to the next loop pass' });
    const playingInSynth = await playingNow(page);
    await showStudio(page);
    const census = await stopAndCensus(page, 'st-linked: after stop the census is 0');
    return { ok: d1 === d0 + 1 && d2 === d1 + 1 && !!inStudio && loudest > -50 && !!inSynth
      && playingInSynth && !!synthHead && !!census,
    undo: [d0, d1, d2], loudestDb: Number(loudest.toFixed(1)), studioHead, synthHead,
    gap: 'the Synth workspace shows no playhead of its own; both read transport.playhead()' };
  });

  def('st-realtime', async ({ page }) => {
    const s = await ensureSteps(page);
    await page.click('[data-osc="studio.play"]');
    await until(() => playingNow(page), { ms: SOUND_MS, what: 'st-realtime: Play starts' });
    // The step index follows the playhead: each sample reads both in one evaluate.
    const seen = new Set();
    const wrong = [];
    await until(async () => {
      const x = await page.evaluate((id) => {
        const t = window.OSCILLA.studio.transport;
        const m = window.OSCILLA.studio.model;
        const ph = t.playhead();
        const st = t.debugInfo().steps.find((q) => q.clipId === id);
        const c = m.timeline.clips.find((q) => q.id === id);
        const per = c.payload.grid.stepBeats * 60 / m.transport.tempo;
        return { step: st ? st.step : null, pos: st ? st.position : null,
          want: st ? Math.floor((st.position - c.start) / per + 1e-9) : null, ph };
      }, s.clipId);
      if (!x.ph.playing) return false; // the audio clock has not reached baseTime yet
      if (x.step === null || x.step !== x.want) wrong.push(x);
      else seen.add(x.step);
      return seen.size >= 4;
    }, { ms: SOUND_MS, what: 'st-realtime: four distinct steps follow transport.playhead()',
      every: 30 });
    // A tempo change while playing: typed into the spinbutton, the onset interval follows.
    const before = await onsetsAfter(page, s.keys, await clock(page), 2,
      'st-realtime: onsets at 120 BPM');
    const tempo = strip(page).getByRole('spinbutton', { name: /Tempo/ });
    await tempo.fill('60');
    await tempo.press('Enter');
    await tempo.dispatchEvent('change');
    const after = await until(async () => {
      const st = await keysState(page, s.keys);
      return st && st.interval !== null && Math.abs(st.interval - 0.25) < 1e-3 ? st : null;
    }, { ms: SOUND_MS, what: 'st-realtime: the onset interval becomes a sixteenth at 60 BPM' });
    const model = await page.evaluate(() => window.OSCILLA.studio.model.transport.tempo);
    const census = await stopAndCensus(page, 'st-realtime: after stop the census is 0');
    await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'TRANSPORT_SET',
      tempo: 120 }));
    return { ok: wrong.length === 0 && seen.size >= 4
      && Math.abs(before.interval - 0.125) < 1e-3 && !!after && model === 60 && !!census,
    steps: [...seen], wrong: wrong.slice(0, 2), intervals: [before.interval, after.interval] };
  });

  def('st-keys', async ({ page, context, base }) => {
    await ensureSteps(page);
    // Play and Stop: pointer.
    await page.click('[data-osc="studio.play"]');
    await until(() => playingNow(page), { ms: SOUND_MS, what: 'st-keys: Play by pointer' });
    await page.click('[data-osc="studio.stop"]');
    const byPointer = await until(async () => !(await playingNow(page)),
      { ms: SOUND_MS, what: 'st-keys: Stop by pointer' });
    await stopAndCensus(page, 'st-keys: the census is 0 after a pointer stop');
    // Space on the graph: play, then stop.
    await page.focus('[data-osc="studio.graph.viewport"]');
    await page.keyboard.press('Space');
    await until(() => playingNow(page), { ms: SOUND_MS, what: 'st-keys: Space plays' });
    await page.keyboard.press('Space');
    const bySpace = await until(async () => !(await playingNow(page)),
      { ms: SOUND_MS, what: 'st-keys: Space stops' });
    // Tap: pointer, Enter, pointer, Enter: one series, one TRANSPORT_SET.
    const d0 = await depth(page);
    const taps = [];
    const tap = page.locator(TAP);
    for (const how of ['pointer', 'Enter', 'pointer', 'Enter']) {
      if (how === 'pointer') await tap.click();
      else {
        await tap.focus();
        await page.keyboard.press('Enter');
      }
      taps.push(await tap.getAttribute('data-taps'));
    }
    const tapped = await until(() => page.evaluate(() => {
      const s = window.OSCILLA.studio;
      return { tempo: s.model.transport.tempo, depth: s.store.debugInfo().undoDepth };
    }).then((x) => (x.tempo !== 120 ? x : null)), { ms: UI_MS,
      what: 'st-keys: the fourth tap sets the tempo' });
    const max = await page.evaluate(() => Number(document.querySelector(
      '[data-osc="studio.tl.tempo"]').max));
    await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'TRANSPORT_SET',
      tempo: 120 }));
    // Touch: a hasTouch page; Play, Stop and four taps on Tap.
    const touch = await context.browser().newContext({ viewport: VIEWPORT, hasTouch: true });
    let byTouch = null;
    try {
      const tp = await openStudio(touch, base);
      await tp.tap('[data-osc="studio.play"]');
      await until(() => playingNow(tp), { ms: SOUND_MS, what: 'st-keys: Play by touch' });
      await tp.tap('[data-osc="studio.stop"]');
      await until(async () => !(await playingNow(tp)), { ms: SOUND_MS,
        what: 'st-keys: Stop by touch' });
      const t0 = await depth(tp);
      for (let i = 0; i < 4; i += 1) await tp.tap(TAP);
      byTouch = await until(() => tp.evaluate(() => {
        const s = window.OSCILLA.studio;
        return { tempo: s.model.transport.tempo, depth: s.store.debugInfo().undoDepth };
      }).then((x) => (x.tempo !== 120 ? { ...x, before: t0 } : null)), { ms: UI_MS,
        what: 'st-keys: four taps by touch set the tempo' });
    } finally {
      await touch.close();
    }
    return { ok: !!byPointer && !!bySpace && taps.join(',') === '1,2,3,0'
      && tapped.depth === d0 + 1 && tapped.tempo === max && !!byTouch
      && byTouch.depth === byTouch.before + 1 && byTouch.tempo === max,
    taps, tapped, max, byTouch };
  });

  def('st-a11y', async ({ page }) => {
    const header = page.getByRole('group', { name: 'Transport', exact: true });
    const names = ['Play the Studio', 'Stop', 'Return to start', 'Loop'];
    const counts = {};
    for (const name of names) {
      counts[name] = await header.getByRole('button', { name, exact: true }).count();
    }
    counts.tempo = await strip(page).getByRole('spinbutton', { name: /Tempo/ }).count();
    counts.tap = await strip(page).getByRole('button', { name: 'Tap tempo', exact: true }).count();
    const tree = await header.ariaSnapshot();
    return { ok: Object.values(counts).every((c) => c === 1)
      && names.every((n) => tree.includes(`button "${n}"`)), counts };
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
      if (await playingNow(page).catch(() => false)) {
        await page.evaluate(() => window.OSCILLA.app.studioStop()).catch(() => {});
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
    ? await serveDist(DIST, { prefix: 'oscilla-steps-' }) : null;
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
        console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/steps: ${names.length
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

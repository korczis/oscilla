#!/usr/bin/env node
// The demo song as a vertical slice (plan issue K058): one user journey through every part of
// OSCILLA that exists, on the built dist/index.html from file:// in chromium, firefox and
// webkit. The song is "Lantern in the Slag Yard", an original piece (src/js/studio/templates/
// demo-song-score.js), opened as the Studio template "Demo song".
//
//   node tests/browser/demo-song.cjs [--browsers chromium,firefox,webkit]   (or OSC_BROWSERS)
//
// The journey, in the order a user takes it; each step drives the page's own controls:
//   midi-connect        Settings, Connect MIDI: the MIDI test seam (tests/browser/lib/
//                       midi-stub.cjs; "handles (stubbed API)") resolves the request and the page
//                       states `connected` with the stub's self-naming input
//   midi-riff           the first two bars of the bass riff as Note On / Note Off through the
//                       stub: the page reports no error and the MIDI state stays connected
//   song-open           Templates, Open "Demo song: Lantern in the Slag Yard": 18 nodes, 744
//                       tempo-linked clips on five tracks, 7 section markers, 96 BPM, clean
//   tempo               the Inspector's Tempo field (nothing selected) at 120 BPM moves every
//                       clip (the song ends at 88 s) and the timeline strip shows it; 96 restores
//   drums               the Kick, Snare and Hats tracks hold the song's drum hits, and the Kick
//                       track's Add clip control adds one more hit at the playhead (one undo)
//   tone                Lead voice: waveform sawtooth; Lead filter: Q 6, both typed in the
//                       Inspector and in the model; undo restores the template's values
//   automation          the build automation is on the timeline (bass cutoff, lead LFO rate, the
//                       outro fade); Automate on the Bass filter's cutoff shows its lane
//   play                PLAY: the transport plays, the engine counts nodes and sources, the main
//                       output is not silent, and every lane of the song plays
//   views               while it plays: the Analyzer's scope data is not silent, its spectrum
//                       holds the bass band well above its idle level, and its spectrogram draws
//                       the bass rows away from their idle colour
//   playhead            the timeline playhead the editor draws follows the transport position
//   stop-restart        STOP leaves 0 engine nodes, sources and runtime nodes; PLAY plays again;
//                       STOP is quiet again
//   save-reload         Save, reload, Projects, Open: the opened model serializes equal to the
//                       saved one
//   wav                 Render WAV: the download is a WAV of the song's length (110 s plus the
//                       render's lead and fade), not silent, peak below 0 dBFS
//   no-errors           no page error or console error during the journey
//
// Expected failures. A step that needs work that has not landed runs and is expected to fail;
// it is printed XFAIL with the plan issue or pull request that fills it, counted as a check,
// and never skipped. When that work lands the step passes, prints XPASS and fails the suite
// until its mark is removed from EXPECTED below.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { until } = require('./lib/wait.cjs');
const midiStub = require('./lib/midi-stub.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const RUN = suite.open({ name: 'demo-song', browsers: arg('browsers') });
const playwright = RUN.playwright;

const LOAD_MS = 90000;      // the page reports ready
const STEP_MS = 15000;      // a control the journey drives takes effect
const PLAY_MS = 20000;      // PLAY of a 744-clip song reaches a running graph
const NOTE_MS = 3000;       // a MIDI note would have made the engine count a node by then
const RENDER_MS = 300000;   // the 110 s offline render, encoded and downloaded (13 s on a Mac)
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0,
    'media.autoplay.blocking_policy': 0, 'media.autoplay.block-webaudio': false } },
  webkit: {},
};
const SONG_TITLE = 'Demo song: Lantern in the Slag Yard';
// The step marks: the work each expected failure waits for. Remove a mark when it lands.
const EXPECTED = Object.freeze({
  'midi-notes-sound': 'V502 (pull request #261): MIDI notes sound through the AudioEngine',
  'midi-records': 'V505: a MIDI performance records into an editable track; a MIDI note '
    + 'playing a Studio voice has no plan yet (K058 gap G2)',
  'drum-accents': 'K058 gap G4 (no plan yet): a Studio clip has no level, so velocity is lost',
  'drive-knob': 'K012 (pull request #267): the Drive node',
  'resonance-lane': 'K058 gap G10 (no plan yet): the Studio does not automate a filter Q',
  'node-views-draw': 'K016: the Scope, Spectrum, Spectrogram and Meter node cards paint live',
  'keyboard-view': 'K026 and V504: a keyboard or note view beside the views',
  'restore-last': 'V604: after a reload the Studio offers back the last working draft',
});

let failures = 0;
let passes = 0;
let xfails = 0;

function check(leg, id, name, ok, detail = '') {
  RUN.tally(leg);
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} [${leg}] ${id}: ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

// An expected failure: `fn` returns { ok, detail } as a check would. It runs every time.
async function expected(leg, id, name, fn) {
  RUN.tally(leg);
  const why = EXPECTED[id];
  let r;
  try {
    r = await fn();
  } catch (err) {
    r = { ok: false, detail: String((err && err.message) || err).slice(0, 300) };
  }
  if (r.ok) {
    failures += 1;
    console.log(`  XPASS [${leg}] ${id}: ${name} — it passes now; remove its mark (${why})`);
  } else {
    xfails += 1;
    console.log(`  XFAIL [${leg}] ${id}: ${name} — expected until ${why}`
      + `${r.detail ? `; ${r.detail}` : ''}`);
  }
}

// ------------------------------------------------------------------------------ page helpers
const counts = (page) => page.evaluate(() => window.OSCILLA.studio.counts());
const model = (page) => page.evaluate(() => window.OSCILLA.studio.model);
const live = (page) => page.evaluate(() => (window.__demoLive || []).slice());
const frame = (page) => page.evaluate(() => new Promise((r) => {
  requestAnimationFrame(() => requestAnimationFrame(() => r(true)));
}));

async function ready(page, what) {
  await until(() => page.evaluate(() => document.documentElement.dataset.ready === 'true'
    && !!(window.OSCILLA && window.OSCILLA.app)), { ms: LOAD_MS, what });
}

async function recordLive(page) {
  await page.evaluate(() => {
    const log = [];
    window.__demoLive = log;
    for (const sel of ['[data-osc="studio.live"]', '[data-osc="studio.alert"]']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      new MutationObserver(() => {
        const t = el.textContent.replace(/​/g, '').trim();
        if (t) log.push(t);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    }
  });
}

async function studio(page, leg) {
  if (await page.evaluate(() => document.querySelector('#osc-app').dataset.mode) !== 'studio') {
    await page.locator('[data-osc="nav.studio"]').first().click();
  }
  await until(() => page.evaluate(() => document.querySelector('#osc-app').dataset.mode
    === 'studio' && !!window.OSCILLA.studio && !!window.OSCILLA.studio.store),
  { ms: STEP_MS, what: `${leg}: the Studio workspace opens` });
}

/** The Analyzer workspace, from its Analyze menu in the header. */
async function analyzer(page, leg) {
  await page.locator('[data-osc="nav-group.analyze"]').first().click();
  await page.locator('[data-osc="nav.analyzer"]').first().click();
  await until(() => page.evaluate(() => document.querySelector('#osc-app').dataset.mode
    === 'analyzer'), { ms: STEP_MS, what: `${leg}: the Analyzer workspace opens` });
}

/** Type into a field like a user: select its text, type, commit with Enter. */
async function type(page, selector, text) {
  const field = page.locator(selector).first();
  await field.click({ clickCount: 3 });
  await field.fill(text);
  await field.press('Enter');
}

/** Select a node by clicking its card in the graph. */
async function selectNode(page, leg, id) {
  await page.locator(`.osc-sg-node[data-node-id="${id}"] .osc-sg-title`).first().click();
  await until(() => page.evaluate((nid) => {
    const sel = window.OSCILLA.studio.store.getSelection();
    return sel.nodes.length === 1 && sel.nodes[0] === nid;
  }, id), { ms: STEP_MS, what: `${leg}: ${id} is the one selected node` });
}

async function clearSelection(page) {
  await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'SELECTION_CHANGE',
    selection: { nodes: [] } }));
}

const param = (m, nodeId, key) => m.graph.nodes.find((n) => n.id === nodeId).params[key];
const songEnd = (m) => Math.round(Math.max(...m.timeline.clips.map((c) => c.start + c.duration))
  * 1000) / 1000;

// What the Analyzer shows of the main output: the scope's time data, the spectrum and the
// spectrogram, read from the views' own sources (the visualization bridge, the main output
// analyser, the spectrogram's plot canvas). The spectrogram is a ring buffer, so its rows are
// read whole: `lit` counts the pixels of the 80, 110 and 220 Hz rows (the bass and kick) that
// differ from `floor`, the colour of its empty plot.
const analyzerView = (page, floor = null) => page.evaluate((fl) => {
  const viz = window.OSCILLA.viz;
  viz.pull();
  const td = viz.state.live.timeData;
  let acc = 0;
  if (td) for (let i = 0; i < td.length; i++) acc += td[i] * td[i];
  const rms = td ? Math.sqrt(acc / td.length) : 0;
  const spec = viz.outputSpectrum();
  const rate = viz.state.live.sampleRate;
  let bass = -Infinity;
  if (spec && rate) {
    const binHz = rate / 2 / spec.length;
    // timing-allow: counts spectrum bins between 40 and 400 Hz, not audio frames
    for (let i = Math.floor(40 / binHz); i <= Math.ceil(400 / binHz); i++) {
      if (spec[i] > bass) bass = spec[i];
    }
  }
  const sg = window.OSCILLA.labs && window.OSCILLA.labs.spectrogram
    ? window.OSCILLA.labs.spectrogram.view : null;
  let lit = null;
  let empty = null;
  if (sg && sg.plotCanvas && sg.plotRect && sg.plotRect.w > 0) {
    const c = sg.plotCanvas;
    const g = c.getContext('2d');
    const dpr = c.width / sg.plotRect.w;
    empty = Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3));
    const ref = fl || empty;
    lit = 0;
    for (const f of [80, 110, 220]) {
      const row = g.getImageData(0, Math.round(sg.yForFrequency(f) * dpr), c.width, 1).data;
      for (let i = 0; i < row.length; i += 4) {
        const d = Math.max(Math.abs(row[i] - ref[0]), Math.abs(row[i + 1] - ref[1]),
          Math.abs(row[i + 2] - ref[2]));
        if (d > 20) lit += 1;
      }
    }
  }
  return { rms, bass: Number.isFinite(bass) ? bass : null, lit, empty };
}, floor);

// The 16-bit PCM WAV the Studio downloads: format, length and level from its samples.
function wavStats(buf) {
  const b = Buffer.from(buf);
  const fmt = b.indexOf('fmt ');
  const data = b.indexOf('data');
  const channels = b.readUInt16LE(fmt + 10);
  const sampleRate = b.readUInt32LE(fmt + 12);
  const bits = b.readUInt16LE(fmt + 22);
  const bytes = b.readUInt32LE(data + 4);
  const start = data + 8;
  const end = Math.min(b.length, start + bytes);
  let peak = 0;
  let acc = 0;
  let n = 0;
  for (let o = start; o + 1 < end; o += 2) {
    const v = Math.abs(b.readInt16LE(o)) / 32768;
    if (v > peak) peak = v;
    acc += v * v;
    n += 1;
  }
  return { riff: b.toString('ascii', 0, 4), wave: b.toString('ascii', 8, 12), channels,
    sampleRate, bits, seconds: bytes / (channels * (bits / 8)) / sampleRate,
    peakDbfs: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    rmsDbfs: n && acc > 0 ? 10 * Math.log10(acc / n) : -Infinity };
}

// ------------------------------------------------------------------------------ the journey
async function journey(browser, leg) {
  const context = await browser.newContext({ acceptDownloads: true,
    viewport: { width: 1536, height: 1024 } });
  await context.addInitScript(midiStub.install, {});
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  const url = pathToFileURL(DIST).href;
  try {
    await page.goto(url, { waitUntil: 'load' });
    await ready(page, `${leg}: the page is ready`);

    // 1. MIDI through the test seam (handles (stubbed API)).
    await page.locator('[data-osc="action.settings"]').click();
    await until(() => page.evaluate(() => document.getElementById('osc-dlg-settings').open),
      { ms: STEP_MS, what: `${leg}: the Settings dialog opens` });
    await page.locator('[data-osc="midi.connect"]').click();
    await until(() => page.evaluate(() => window.__oscMidiSeam.calls().length === 1),
      { ms: STEP_MS, what: `${leg}: Connect MIDI asks for access once` });
    await page.evaluate((n) => window.__oscMidiSeam.resolve(0, [n]), midiStub.STUB_NAME);
    const midi = await until(() => page.evaluate(() => {
      const el = document.querySelector('[data-osc="midi.status"]');
      return el.dataset.midiState === 'connected' && el.textContent.trim();
    }), { ms: STEP_MS, what: `${leg}: the MIDI state reads connected` });
    check(leg, 'midi-connect', 'handles (stubbed API): Connect MIDI reaches connected with the '
      + 'stub input', midi.includes(midiStub.STUB_NAME), midi);
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => !document.getElementById('osc-dlg-settings').open),
      { ms: STEP_MS, what: `${leg}: the Settings dialog closes` });

    // 2. The riff as MIDI notes. The first note is held until the engine would count it.
    const bars = [[33, 110], [33, 78], [40, 100], [45, 104], [43, 100], [40, 88],
      [33, 110], [33, 78], [38, 100], [39, 98], [40, 110], [43, 96]];
    const before = await page.evaluate(() => window.OSCILLA.engine.activeNodeCount);
    await page.evaluate(([n, v, name]) => window.__oscMidiSeam.message(name, [0x90, n, v]),
      [bars[0][0], bars[0][1], midiStub.STUB_NAME]);
    await expected(leg, 'midi-notes-sound', 'a MIDI Note On sounds through the AudioEngine',
      async () => {
        try {
          const n = await until(() => page.evaluate((b) => {
            const c = window.OSCILLA.engine.activeNodeCount;
            return c > b && c;
          }, before), { ms: NOTE_MS, what: `${leg}: a MIDI note makes the engine count a node` });
          return { ok: n > before, detail: `${n} engine nodes` };
        } catch (err) {
          return { ok: false, detail: `${before} engine nodes before, none added (${err.message})` };
        }
      });
    for (const [i, [n, v]] of bars.entries()) {
      if (i > 0) {
        await page.evaluate(([nn, vv, name]) => window.__oscMidiSeam.message(name,
          [0x90, nn, vv]), [n, v, midiStub.STUB_NAME]);
      }
      await page.evaluate(([nn, name]) => window.__oscMidiSeam.message(name, [0x80, nn, 0]),
        [n, midiStub.STUB_NAME]);
    }
    const afterRiff = await page.evaluate(() => ({
      state: document.querySelector('[data-osc="midi.status"]').dataset.midiState,
      lastError: window.OSCILLA.engine.lastError ? window.OSCILLA.engine.lastError.message
        : null }));
    check(leg, 'midi-riff', 'handles (stubbed API): 12 riff notes reach the page without an '
      + 'error', afterRiff.state === 'connected' && !afterRiff.lastError && !errors.length,
      JSON.stringify(afterRiff));

    // 3. The song, from the Templates dialog.
    await studio(page, leg);
    await recordLive(page);
    const clipsBefore = (await model(page)).timeline.clips.length;
    await expected(leg, 'midi-records', 'the MIDI riff is recorded into the Studio', async () => {
      const m = await model(page);
      return { ok: m.timeline.clips.length > clipsBefore,
        detail: `${m.timeline.clips.length} clips, as before the riff` };
    });
    await page.locator('[data-osc="studio.templates"]').first().click();
    await until(() => page.evaluate(() => document.getElementById('osc-dlg-studio-templates')
      .open), { ms: STEP_MS, what: `${leg}: the Templates dialog opens` });
    const listed = await page.evaluate(() => [...document.querySelectorAll(
      '#osc-dlg-studio-templates .osc-st-tpl-title')].map((h) => h.textContent));
    await page.locator('[data-osc="studio.template.open"][data-template="demo-song"]').click();
    const song = await until(async () => {
      const m = await model(page);
      return m.metadata.title === SONG_TITLE && m;
    }, { ms: STEP_MS, what: `${leg}: the demo song opens` });
    const dirty = await page.evaluate(() => window.OSCILLA.studio.dirty);
    const tracks = {};
    for (const c of song.timeline.clips) tracks[c.trackId] = (tracks[c.trackId] || 0) + 1;
    check(leg, 'song-open', 'Templates, Open "Demo song": the whole song as one Studio document',
      listed.includes(SONG_TITLE) && song.graph.nodes.length === 18
        && song.timeline.clips.length === 744 && song.timeline.tracks.length === 5
        && song.timeline.clips.every((c) => !!c.musical) && song.timeline.markers.length === 7
        && song.transport.tempo === 96 && song.transport.timeMode === 'musical' && !dirty,
      `${song.graph.nodes.length} nodes, ${song.timeline.clips.length} clips ${
        JSON.stringify(tracks)}, ${song.timeline.markers.map((x) => x.label).join(' | ')}, ${
        song.transport.tempo} BPM, dirty ${dirty}`);

    // 4. Tempo.
    await clearSelection(page);
    await type(page, '[data-osc="studio.inspector.tempo"]', '120');
    const fast = await until(async () => {
      const m = await model(page);
      return m.transport.tempo === 120 && m;
    }, { ms: STEP_MS, what: `${leg}: the typed tempo reaches the model` });
    const strip = await page.evaluate(() => document.querySelector('[data-osc="studio.tl.tempo"]')
      .value || document.querySelector('[data-osc="studio.tl.tempo"]').textContent);
    await type(page, '[data-osc="studio.inspector.tempo"]', '96');
    const back = await until(async () => {
      const m = await model(page);
      return m.transport.tempo === 96 && m;
    }, { ms: STEP_MS, what: `${leg}: the tempo returns to 96 BPM` });
    check(leg, 'tempo', 'the Inspector tempo moves every tempo-linked clip',
      songEnd(fast) === 88 && String(strip).includes('120') && songEnd(back) === 110,
      `ends at ${songEnd(fast)} s at 120 BPM (strip ${String(strip).trim()}), ${songEnd(back)} s `
        + 'at 96 BPM');

    // 5. Drums.
    const kicks = (m) => m.timeline.clips.filter((c) => c.trackId === 'track-kick').length;
    const k0 = kicks(back);
    await page.locator('[data-osc="studio.tl.add-clip"][data-key="track-add:track-kick"]').click();
    const added = await until(async () => {
      const m = await model(page);
      return kicks(m) === k0 + 1 && m;
    }, { ms: STEP_MS, what: `${leg}: Add clip puts one more hit on the Kick track` });
    await page.locator('[data-osc="studio.undo"]').first().click();
    const undone = await until(async () => {
      const m = await model(page);
      return kicks(m) === k0 && m;
    }, { ms: STEP_MS, what: `${leg}: undo removes the added hit` });
    check(leg, 'drums', 'the drum tracks hold the song\'s hits; Add clip adds one, undo removes it',
      k0 === 135 && tracks['track-snare'] === 107 && tracks['track-hat'] === 160
        && kicks(added) === 136 && kicks(undone) === 135, `kick ${k0}, snare ${
        tracks['track-snare']}, hats ${tracks['track-hat']}`);
    await expected(leg, 'drum-accents', 'the drum hits carry their velocities (accents)',
      async () => {
        const m = await model(page);
        const hit = m.timeline.clips.find((c) => c.trackId === 'track-snare');
        const level = hit && (hit.level ?? (hit.payload && hit.payload.level));
        return { ok: typeof level === 'number', detail: 'a snare clip has no level field' };
      });

    // 6. The synth tone and the filter.
    await page.locator('[data-osc="studio.frameAll"]').first().click();
    await selectNode(page, leg, 'lead-osc');
    await page.locator('[data-osc="studio.inspector.param"][data-key="waveform"]').first()
      .selectOption('sawtooth');
    await selectNode(page, leg, 'lead-filter');
    await type(page, '[data-osc="studio.inspector.param"][data-key="Q"]', '6');
    const toned = await until(async () => {
      const m = await model(page);
      return param(m, 'lead-osc', 'waveform') === 'sawtooth' && param(m, 'lead-filter', 'Q') === 6
        && m;
    }, { ms: STEP_MS, what: `${leg}: the waveform and Q edits reach the model` });
    check(leg, 'tone', 'Lead voice sawtooth and Lead filter Q 6 through the Inspector',
      !!toned, `${param(toned, 'lead-osc', 'waveform')}, Q ${param(toned, 'lead-filter', 'Q')}`);
    await expected(leg, 'drive-knob', 'a Drive node can be added for the driven tone',
      async () => {
        await page.locator('[data-osc="studio.add"]').first().click();
        const found = await until(() => page.evaluate(() => document.querySelectorAll(
          '[data-osc="studio.add.item"]').length > 0 && [...document.querySelectorAll(
          '[data-osc="studio.add.item"]')].map((b) => b.dataset.type)),
        { ms: STEP_MS, what: `${leg}: the Add node list opens` });
        await page.keyboard.press('Escape');
        return { ok: found.includes('drive'), detail: `${found.length} node types, no drive` };
      });

    // 7. The build automation. Automate on a parameter that has a lane shows that lane.
    const lanes = (m) => m.timeline.automation.map((l) => `${l.target.node}.${l.target.param}`);
    const songLanes = lanes(toned);
    await selectNode(page, leg, 'bass-filter');
    await page.locator('[data-osc="studio.inspector.automate"][data-key="frequency"]').click();
    const cutoff = toned.timeline.automation.find((l) => l.id === 'lane-cutoff');
    const shown = await until(() => page.evaluate((n) => {
      const sel = window.OSCILLA.studio.store.getSelection();
      return (sel.points || []).length === n && sel.points;
    }, cutoff.points.length), { ms: STEP_MS,
      what: `${leg}: Automate on the cutoff shows its lane` });
    check(leg, 'automation', 'the build lanes are on the timeline; Automate on the cutoff shows '
      + 'its lane', ['bass-filter.frequency', 'lead-lfo.rate', 'main-mix.level1',
      'main-mix.level2', 'main-mix.level3'].every((l) => songLanes.includes(l))
      && shown.length === cutoff.points.length, `${songLanes.join(', ')}; ${shown.length} `
      + 'cutoff points selected');
    await expected(leg, 'resonance-lane', 'the bass filter Q can be automated for the build',
      async () => {
        const r = await page.evaluate(() => ({
          offered: !!document.querySelector('[data-osc="studio.inspector.automate"]'
            + '[data-key="Q"]'),
          note: [...document.querySelectorAll('[data-osc="studio.inspector.no-automate"]')]
            .map((n) => n.textContent.trim()).find((t) => /Q/.test(t)) || '' }));
        return { ok: r.offered, detail: r.note || 'no Automate control on Q' };
      });

    // 8. PLAY. First the Analyzer as it is before anything plays: its empty spectrogram.
    await analyzer(page, leg);
    const pre = await until(async () => {
      const v = await analyzerView(page);
      return v.lit !== null && v;
    }, { ms: STEP_MS, what: `${leg}: the Analyzer's spectrogram is mounted` });
    await studio(page, leg);
    await clearSelection(page);
    await page.locator('[data-osc="studio.play"]').first().click();
    const playing = await until(async () => {
      const c = await counts(page);
      return c.playing && c.runtimeNodes > 0 && c.engineNodes > 0 && c;
    }, { ms: PLAY_MS, what: `${leg}: PLAY runs the song's graph` });
    const sounding = await until(async () => {
      const v = await analyzerView(page);
      return v.rms > 0.002 && v;
    }, { ms: STEP_MS, what: `${leg}: the main output is not silent` });
    const tr = await page.evaluate(() => {
      const d = window.OSCILLA.studio.transport.debugInfo();
      return { unplayed: (d.unplayed || []).map((u) => u.id), position: d.position };
    });
    check(leg, 'play', 'PLAY: the engine counts the graph, the output sounds, the song\'s lanes '
      + 'play', playing.engineSources > 0 && sounding.rms > 0.002
      && !tr.unplayed.some((id) => /^lane-(cutoff|lfo-rate|fade-)/.test(id)),
    `${playing.engineNodes} engine nodes, ${playing.engineSources} sources, ${
      playing.runtimeNodes} runtime nodes, RMS ${sounding.rms.toFixed(4)}; not played: ${
      tr.unplayed.join(', ') || 'none'}`);
    await expected(leg, 'node-views-draw', 'the Studio\'s Scope, Spectrum and Spectrogram node '
      + 'cards draw what plays', async () => {
      const drawn = await page.evaluate(() => ['scope-1', 'spectrum-1', 'spectrogram-1']
        .map((id) => document.querySelectorAll(`.osc-sg-node[data-node-id="${id}"] canvas`)
          .length));
      return { ok: drawn.every((n) => n > 0), detail: `canvases per card ${drawn.join(', ')}` };
    });

    // The timeline playhead, read as the editor draws it, against the transport.
    const drawn = () => page.evaluate(() => new Promise((resolve) => {
      const el = document.querySelector('[data-osc="studio.tl.playhead"]');
      const seen = new MutationObserver(() => {
        seen.disconnect();
        const m = /translateX\(([-\d.]+)px\)/.exec(el.style.transform || '');
        resolve({ p: window.OSCILLA.studio.transport.playhead().position,
          x: m ? Number(m[1]) : null });
      });
      seen.observe(el, { attributes: true, attributeFilter: ['style'] });
    }));
    const h1 = await until(async () => {
      const d = await drawn();
      return d.p > 0.5 && d.x !== null && d;
    }, { ms: STEP_MS, what: `${leg}: the editor draws the playhead past 0.5 s` });
    const h2 = await until(async () => {
      const d = await drawn();
      return d.p > h1.p + 0.5 && d.x !== null && d;
    }, { ms: STEP_MS, what: `${leg}: the drawn playhead advances 0.5 s further` });
    const scale = (h2.x - h1.x) / (h2.p - h1.p);
    check(leg, 'playhead', 'the timeline playhead follows the transport position',
      scale > 0 && Math.abs((h1.x / h1.p) - scale) / scale < 0.05,
      `${h1.p.toFixed(3)} s at ${h1.x.toFixed(1)} px, ${h2.p.toFixed(3)} s at ${
        h2.x.toFixed(1)} px`);
    await expected(leg, 'keyboard-view', 'a keyboard or note view shows the notes the playhead '
      + 'plays', async () => {
      const keys = await page.evaluate(() => document.querySelectorAll(
        '[data-osc^="studio.keyboard"], [data-osc^="keyboard."], [data-osc^="midi.notes"]').length);
      return { ok: keys > 0, detail: 'no keyboard or note view in the page' };
    });

    // The Analyzer's views while the song plays, against their idle state after it.
    await analyzer(page, leg);
    const busy = await until(async () => {
      const v = await analyzerView(page, pre.empty);
      return v.rms > 0.002 && v.bass !== null && v.lit > 0 && v;
    }, { ms: STEP_MS, what: `${leg}: the Analyzer reads the playing song` });

    // 9. STOP and PLAY again.
    await studio(page, leg);
    const quiet = async (what) => until(async () => {
      const c = await counts(page);
      return !c.playing && c.engineNodes === 0 && c.engineSources === 0 && c.runtimeNodes === 0
        && c;
    }, { ms: STEP_MS, what });
    await page.locator('[data-osc="studio.stop"]').first().click();
    const q1 = await quiet(`${leg}: STOP leaves no node`);
    await analyzer(page, leg);
    // After STOP the scope falls silent and the spectrum's bass band decays (the analyser
    // smooths it) to 30 dB below its playing level.
    const idle = await until(async () => {
      const v = await analyzerView(page, pre.empty);
      return v.rms < 1e-4 && (v.bass === null || v.bass < busy.bass - 30) && v;
    }, { ms: STEP_MS, what: `${leg}: the Analyzer reads silence after STOP` });
    check(leg, 'views', 'the Analyzer\'s scope, spectrum and spectrogram show the song',
      busy.rms > 0.002 && idle.rms < 1e-4 && busy.bass > -80 && pre.lit === 0 && busy.lit > 0,
      `scope RMS ${busy.rms.toFixed(4)} playing, ${idle.rms.toExponential(1)} stopped; `
        + `40-400 Hz peak ${busy.bass.toFixed(1)} dB playing, ${idle.bass === null ? 'none'
          : idle.bass.toFixed(1)} dB stopped; spectrogram 80/110/220 Hz rows: ${pre.lit} lit `
        + `pixels before PLAY, ${busy.lit} while playing`);
    await studio(page, leg);
    await page.locator('[data-osc="studio.play"]').first().click();
    const p2 = await until(async () => {
      const c = await counts(page);
      return c.playing && c.runtimeNodes > 0 && c;
    }, { ms: PLAY_MS, what: `${leg}: PLAY plays again` });
    await page.locator('[data-osc="studio.stop"]').first().click();
    const q2 = await quiet(`${leg}: the second STOP leaves no node`);
    check(leg, 'stop-restart', 'STOP leaves 0 nodes and sources, PLAY plays again, STOP again',
      !!q1 && !!p2 && !!q2, `${p2.runtimeNodes} runtime nodes on the second PLAY`);

    // 10. Save, reload, open from Projects.
    await page.locator('[data-osc="studio.save"]').first().click();
    const saved = await until(() => page.evaluate(() => !window.OSCILLA.studio.dirty
      && window.OSCILLA.studio.projectId && { id: window.OSCILLA.studio.projectId,
      text: JSON.stringify(window.OSCILLA.studio.model),
      persistent: window.OSCILLA.app.studio.persistent }), { ms: STEP_MS,
      what: `${leg}: Save stores the project` });
    await page.reload({ waitUntil: 'load' });
    await ready(page, `${leg}: the page is ready after the reload`);
    await studio(page, leg);
    await expected(leg, 'restore-last', 'after a reload the Studio offers back the saved song',
      async () => {
        const m = await model(page);
        return { ok: m.metadata.title === SONG_TITLE,
          detail: `the Studio opened "${m.metadata.title}"` };
      });
    if (!saved.persistent) {
      RUN.skip(leg, 'save-reload', 'the Studio library is not persistent in this browser here');
    } else {
      await page.locator('[data-osc="studio.open"]').first().click();
      await page.getByRole('button', { name: `Open ${SONG_TITLE}` }).first().click();
      const reopened = await until(async () => {
        const m = await model(page);
        return m.metadata.title === SONG_TITLE && m.timeline.clips.length === 744
          && JSON.stringify(m);
      }, { ms: STEP_MS, what: `${leg}: Projects, Open loads the saved song` });
      check(leg, 'save-reload', 'Save, reload, Projects, Open: the same model',
        reopened === saved.text, `${saved.id}, ${reopened.length} characters`);
    }

    // 11. Render WAV.
    await page.locator('[data-osc="studio.renderWav"]').first().click();
    await until(() => page.evaluate(() => document.getElementById('osc-dlg-studio-render').open),
      { ms: STEP_MS, what: `${leg}: the Render WAV dialog opens` });
    const t0 = Date.now();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: RENDER_MS }),
      page.locator('[data-osc="studio.render.start"]').click(),
    ]);
    const file = await download.path();
    const wav = wavStats(fs.readFileSync(file));
    check(leg, 'wav', 'Render WAV: the whole song, not silent, below full scale',
      wav.riff === 'RIFF' && wav.wave === 'WAVE' && wav.channels === 2 && wav.bits === 16
        && wav.seconds > 110 && wav.seconds < 111 && wav.peakDbfs > -40 && wav.peakDbfs < 0
        && wav.rmsDbfs > -60,
      `${download.suggestedFilename()}: ${wav.seconds.toFixed(3)} s, ${wav.sampleRate} Hz, ${
        wav.channels} ch, peak ${wav.peakDbfs.toFixed(1)} dBFS, RMS ${wav.rmsDbfs.toFixed(1)} dBFS, ${
        ((Date.now() - t0) / 1000).toFixed(1)} s`);

    check(leg, 'no-errors', 'no page error or console error', errors.length === 0,
      errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}

async function main() {
  await RUN.ready();
  for (const b of RUN.browsers) {
    const browser = await playwright[b].launch(LAUNCH[b]);
    console.log(`\n${b} (${browser.version()})`);
    try {
      await journey(browser, b);
    } catch (err) {
      check(b, 'journey', 'the journey completed', false, err && err.stack);
    } finally {
      await browser.close();
    }
  }
  console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL PASS'} (${passes} checks passed, ${
    xfails} expected failure(s))`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

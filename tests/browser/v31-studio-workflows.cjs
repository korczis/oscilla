#!/usr/bin/env node
// suite-pace: solo (live input and the realtime analyser judged against short deadlines)
// OSCILLA V3.1 Studio workflows the evidence audit found missing, on the built dist/index.html in
// chromium, firefox and webkit, from file:// (every check) and from a GitHub-Pages-like sub-path
// (http://127.0.0.1:<port>/oscilla/, the smoke checks). Spec §78, §105-§110, §145, §250-§251;
// plan V413, V424, V425, V427, V428, V431.
//
//   node tests/browser/v31-studio-workflows.cjs [--browsers chromium,firefox,webkit]
//        [--origins file,http] [--only name1,name2] [--json out.json]   (or OSC_BROWSERS=...)
//
// Checks (asserted):
//   transport-inspector  nothing selected: the Inspector shows tempo, time signature, time mode,
//                        loop and length; typed tempo, beats, beat unit and the loop switch are
//                        store actions (the timeline transport strip shows the same tempo),
//                        a refused tempo is announced and reverted, undo restores (V413)
//   graph-search         `/` from the graph opens Find with the field focused; typing and Enter
//                        selects, frames and focuses the node (inside the viewport); the Find
//                        button opens it too and Escape returns focus to the button (V428)
//   render-wav           Render WAV on Basic Tone downloads a 16-bit WAV at the plan's 48 kHz
//                        stereo, frames = duration × rate; a second render is byte-identical;
//                        progress shows in the task strip; Abort (the strip's button) drops a
//                        render without a download; Measurement Sweep is refused with the live
//                        Microphone limitation (V427)
//   measure-from-studio  on the TEST CONTEXT loopback: PLAY of a (shortened) Measurement Sweep
//                        hands the derived recipe to the MeasurementEngine at the first
//                        measurement clip; MEASURE runs PREFLIGHT … COMPLETE; the experiment is
//                        saved with the Studio block (studioHash of the model that ran, the
//                        measured path without the unconnected Oscillator added to the graph,
//                        ledger D3, the recipe derived from the topology, TEST CONTEXT runs);
//                        Studio PLAY is
//                        refused while the measurement owns the output; Escape aborts a second
//                        run; 0 engine, Studio runtime and capture nodes after each (V424, V425)
//   measure-level-refused  a Master Output level other than MEASURE's output level: PLAY of the
//                        measurement clip is refused and the reason (both levels) shows in the
//                        Studio's measurement note and the alert region; set equal, the same
//                        PLAY runs MEASURE to COMPLETE and the note says it was saved (#197 R-4,
//                        plan E019)
//   large-graph-render   the 100-node / 200-edge fixture imported through the UI path renders
//                        100 node cards and 200 cables within BROWSER_BUDGETS.importMs; one edit
//                        (store dispatch + every projection) and Frame All within
//                        BROWSER_BUDGETS.editMs (median of 9; tests/unit/fixtures/
//                        v31-large-studio.mjs, docs/v31/performance.md); L (tidy all 100 nodes,
//                        median of 9) within its own BROWSER_BUDGETS.tidyMs, derived from
//                        measurement; every budgeted field is printed against its budget
//                        (browserBudgetReport), so a miss names both; L and M (8 selected
//                        cables, then all 200) each reach the projections as one store event
//                        (K009); M is printed, not budgeted: it is one validated store action
//                        per cable; the numbers are printed (V431)
//   sequence-import      a configuration saved with Export config opens through the Studio
//                        Import button as one event track of N pattern clips (one per block of
//                        its sequence) playing a Sequence node, clean, and announced; a damaged
//                        sequence is refused with its reason and leaves the document unchanged;
//                        the track exported as a V2 sequence equals the configuration's (K004)
//   deleted-project-detaches  Save, Open that project, Delete + Confirm delete: the document is
//                        detached (no project id), counts as unsaved (the indicator shows), the
//                        announcement says so; Templates then shows its unsaved-changes note and
//                        a template link waits instead of replacing the graph (v4.0 workspace
//                        audit: before, the graph was replaced unasked and the work was lost)
//   mic-allow            a Microphone node is off with an "Allow microphone" action in the
//                        Inspector; a denied request (getUserMedia stubbed to NotAllowedError)
//                        keeps it off with the actionable text in an alert; an allowed request
//                        (keyboard: Enter on the action) stops its probe stream, turns the node
//                        on, and PLAY opens the input (live status ready); STOP stops the node's
//                        tracks and leaves 0 engine nodes (v4.0 closure audit F2, F8)
//   mic-reopen-playing   while the Studio plays: the browser denies the input at PLAY (the node
//                        says why, "Allow microphone again"); Allow again (Enter) reopens it and
//                        announces it open; its track then ends by itself (mic-ended) and Allow
//                        again reopens it once more; a denial is announced once, not as success
//                        (PR #119 review D1)
//   render-wav-busy      while a render runs Render WAV is aria-disabled, still focusable, and
//                        described by a visible reason; activating it opens nothing and says why
//                        (PR #119 review, F10)
//   template-pack        each template of the K014 pack (TEMPLATE_PACK_IDS, read from
//                        src/js/studio/templates/index.js) opens clean through the Templates
//                        dialog and through its link #m=studio&st=<id>, and Render WAV at the
//                        dialog's default duration (the timeline) downloads a WAV whose RMS is
//                        above -50 dBFS (it sounds) and whose sample peak is at or below
//                        MAX_OUTPUT_GAIN (core/constants.js, 0.25 = -12.0 dBFS): the engine's
//                        output ceiling, the Master Output level's top, which the live chain
//                        flattens every sample beyond and the offline render (no ceiling) must
//                        stay under on its own. The rate is the WAV header's, never assumed.
//                        Spectra (project.no-fake-science: the Learn texts' claims, from the
//                        WAV): a Hann-windowed DFT at the exact line frequencies over a steady
//                        stretch (wavLine). Ring Mod, first note A3 = 220 Hz against 470 Hz:
//                        the 220 Hz line is at least 20 dB below 250 Hz and 690 Hz (the gain
//                        really swings negative). FM Chime, first strike: 440 ± 616·k Hz
//                        (176, 1056, 1672 Hz) stand 20 dB above the floor between the lines,
//                        and the first and second upper sidebands over the carrier are
//                        J1(1)/J0(1) and J2(1)/J0(1) within 1 dB (the text's index 1; the
//                        lines at 440 ± 616·k do not coincide)
//   armed-play-refused   armed (transport.arm, as the Synth keys arm it): the runtime runs, the
//                        transport bar shows the armed indicator and Play is NOT pressed (K104:
//                        Play shows the timeline, the indicator the keys; the owner's 'STOP keeps
//                        it armed', 2026-11-03); a PLAY refused through the transport's Inject
//                        hook debugRefuseNextPlay (its output claim; it refuses outside TEST
//                        CONTEXT, entered by measure.useLoopback): Play stays released, the
//                        armed run ends, the reason is in the alert region, the runtime census
//                        is 0, and an edit after it leaves the Inspector 'not-applied', never
//                        'behind' (K169)
//   inspector-press-kept (T7, K226 R2-T5-7) a step-voltage sequencer clocked by a Keys Gate,
//                        selected, the Studio playing: a mouse press on the Inspector's Krok
//                        button with an edit that rebuilds the node view (a connection out of the
//                        sequencer) between its down and its up still steps it ("Krok 1" in the
//                        live region), and the deferred rebuild runs after it (the button is a
//                        new element); before the fix the press was lost
//   no-console-errors
'use strict';
const { serveDist } = require('./lib/serve.cjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isDeepStrictEqual } = require('node:util');
const suite = require('./lib/suite.cjs');
const { until } = require('./lib/wait.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist', 'index.html');
const RUN = suite.open({ name: 'v31-studio-workflows', browsers: arg('browsers'),
  origins: arg('origins'), defaultOrigins: ['file', 'http'] });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const ORIGINS = RUN.origins;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const JSON_OUT = arg('json', '');
const HTTP_CHECKS = new Set(['graph-search', 'render-wav', 'no-console-errors']);
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esm = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

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
      a.studio.warning = '';
    }, id);
    await page.waitForFunction(() => document.querySelector('#osc-app').dataset.mode === 'studio',
      null, { timeout: 15000 });
    await H.frames(page);
    await page.evaluate(() => window.OSCILLA.studio.editor.frameAll());
    await H.frames(page);
  },
  /** Record every text the two Studio live regions receive. */
  recordLive: (page) => page.evaluate(() => {
    if (window.__studioLive) { window.__studioLive.length = 0; return; }
    const log = [];
    window.__studioLive = log;
    for (const sel of ['[data-osc="studio.live"]', '[data-osc="studio.alert"]']) {
      const el = document.querySelector(sel);
      new MutationObserver(() => {
        const t = el.textContent.replace(/​/g, '');
        if (t) log.push(t);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    }
  }),
  live: (page) => page.evaluate(() => (window.__studioLive || []).slice()),
  counts: (page) => page.evaluate(() => {
    const c = window.OSCILLA.studio.counts();
    const m = window.OSCILLA.measure.counts();
    return { ...c, ioNodes: m.ioNodes, ioSources: m.ioSources, captures: m.captures };
  }),
  quiet: (page) => H.until(() => H.counts(page), (c) => !c.playing && c.engineNodes === 0
    && c.engineSources === 0 && c.runtimeNodes === 0 && c.ioNodes === 0 && c.ioSources === 0
    && c.captures === 0, 5000),
  /** Type into a field like a user (select all, type, commit with Enter). */
  type: async (page, sel, text) => {
    await page.click(sel, { clickCount: 3 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await H.frames(page);
  },
};

/** Sample peak and RMS (dBFS) of a 16-bit PCM WAV, every channel, with its rate and length. */
function wavLevels(buf) {
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
  return { channels, sampleRate, bits, seconds: bytes / (channels * (bits / 8)) / sampleRate,
    peak, peakDbfs: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    rmsDbfs: n && acc > 0 ? 10 * Math.log10(acc / n) : -Infinity };
}

/** The channel-mean samples of a 16-bit PCM WAV and its rate. */
function wavMono(buf) {
  const b = Buffer.from(buf);
  const fmt = b.indexOf('fmt ');
  const data = b.indexOf('data');
  const channels = b.readUInt16LE(fmt + 10);
  const sampleRate = b.readUInt32LE(fmt + 12);
  const start = data + 8;
  const frames = Math.floor(Math.min(b.length - start, b.readUInt32LE(data + 4))
    / (2 * channels));
  const x = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let v = 0;
    for (let c = 0; c < channels; c++) v += b.readInt16LE(start + 2 * (i * channels + c));
    x[i] = v / channels / 32768;
  }
  return { x, sampleRate };
}

/**
 * Amplitude (dBFS) of the line at `hz` in [t0, t1) s of `wav`: a Hann-windowed DFT evaluated at
 * that exact frequency (not at the nearest bin), scaled so a full-scale sine reads 0 dB.
 */
function wavLine(wav, hz, t0, t1) {
  const i0 = Math.round(t0 * wav.sampleRate);
  const n = Math.round((t1 - t0) * wav.sampleRate);
  let re = 0;
  let im = 0;
  let wsum = 0;
  for (let k = 0; k < n; k++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1));
    const ph = (2 * Math.PI * hz * k) / wav.sampleRate;
    re += w * wav.x[i0 + k] * Math.cos(ph);
    im -= w * wav.x[i0 + k] * Math.sin(ph);
    wsum += w;
  }
  const a = (2 * Math.hypot(re, im)) / wsum;
  return a > 0 ? 20 * Math.log10(a) : -Infinity;
}

/** Bessel function of the first kind J_n(x), by its power series (small x). */
function besselJ(n, x) {
  let sum = 0;
  let term = (x / 2) ** n;
  for (let k = 1; k <= n; k++) term /= k;
  for (let m = 0; m < 30; m++) {
    sum += term;
    term *= -((x / 2) ** 2) / ((m + 1) * (m + 1 + n));
  }
  return sum;
}

function wavInfo(buf) {
  const b = Buffer.from(buf);
  const fmt = b.indexOf('fmt ');
  const data = b.indexOf('data');
  return { riff: b.toString('ascii', 0, 4), wave: b.toString('ascii', 8, 12),
    channels: b.readUInt16LE(fmt + 10), sampleRate: b.readUInt32LE(fmt + 12),
    bits: b.readUInt16LE(fmt + 22), dataBytes: b.readUInt32LE(data + 4),
    sha256: crypto.createHash('sha256').update(b).digest('hex') };
}

// ------------------------------------------------------------------------------ checks
function defineChecks(fx) {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });

  def('transport-inspector', async ({ page }) => {
    await H.fresh(page);
    await H.recordLive(page);
    await page.evaluate(() => window.OSCILLA.studio.store.dispatch({ type: 'SELECTION_CHANGE',
      selection: { nodes: [] } }));
    await H.frames(page);
    const shown = await page.evaluate(() => {
      const q = (k) => document.querySelector(`[data-osc="studio.inspector.${k}"]`);
      return { transport: !!q('transport'), tempo: q('tempo') && q('tempo').value,
        beats: q('beats') && q('beats').value, unit: q('unit') && q('unit').value,
        mode: q('timeMode') && q('timeMode').value,
        loop: q('loop') && q('loop').getAttribute('aria-checked'),
        length: q('length') && q('length').textContent,
        tempoLabel: document.querySelector('label[for="osc-si-studio-tempo"]').textContent };
    });
    const depth0 = await page.evaluate(() => window.OSCILLA.studio.store.debugInfo().undoDepth);
    await H.type(page, '[data-osc="studio.inspector.tempo"]', '96');
    await H.type(page, '[data-osc="studio.inspector.beats"]', '3');
    await page.selectOption('[data-osc="studio.inspector.unit"]', '8');
    await page.click('[data-osc="studio.inspector.loop"]');
    await H.frames(page);
    const after = await page.evaluate(() => {
      const m = window.OSCILLA.studio.model;
      const strip = document.querySelector('[data-osc="studio.tl.tempo"]');
      return { tempo: m.transport.tempo, sig: m.transport.timeSignature,
        loop: m.timeline.loop.enabled,
        strip: strip ? strip.value : null,
        depth: window.OSCILLA.studio.store.debugInfo().undoDepth,
        loopChecked: document.querySelector('[data-osc="studio.inspector.loop"]')
          .getAttribute('aria-checked') };
    });
    await H.type(page, '[data-osc="studio.inspector.tempo"]', '5');
    const refused = await page.evaluate(() => ({
      tempo: window.OSCILLA.studio.model.transport.tempo,
      field: document.querySelector('[data-osc="studio.inspector.tempo"]').value }));
    const live = await H.live(page);
    await page.evaluate(() => document.activeElement.blur()); // a focused field keeps its text
    for (let i = 0; i < 4; i++) await page.evaluate(() => window.OSCILLA.app.studioUndo());
    await H.frames(page);
    const undone = await page.evaluate(() => {
      const m = window.OSCILLA.studio.model;
      return { tempo: m.transport.tempo, sig: m.transport.timeSignature,
        loop: m.timeline.loop.enabled,
        field: document.querySelector('[data-osc="studio.inspector.tempo"]').value };
    });
    return { ...H.verdict({
      shown: shown.transport && shown.tempo === '120' && shown.beats === '4' && shown.unit === '4'
        && shown.mode === 'seconds' && /s$/.test(shown.length || '')
        && shown.tempoLabel === 'Tempo',
      edited: after.tempo === 96 && after.sig[0] === 3 && after.sig[1] === 8 && after.loop
        && after.loopChecked === 'true',
      oneEntryEach: after.depth === depth0 + 4,
      oneStore: after.strip === null || after.strip === '96',
      refused: refused.tempo === 96 && refused.field === '96'
        && live.some((t) => /^Tempo must be \d+-\d+ BPM\.$/.test(t)),
      announced: live.includes('Changed tempo'),
      undone: undone.tempo === 120 && undone.sig[0] === 4 && undone.sig[1] === 4 && !undone.loop
        && undone.field === '120',
    }), shown, after, refused, undone, live: live.slice(-6) };
  });

  def('graph-search', async ({ page }) => {
    await H.fresh(page);
    await H.recordLive(page);
    await page.focus('[data-osc="studio.graph.viewport"]');
    await page.keyboard.press('/');
    await page.waitForSelector('#osc-dlg-studio-find[open]', { timeout: 15000 });
    await H.frames(page);
    const opened = await page.evaluate(() => ({
      focused: document.activeElement && document.activeElement.dataset.osc,
      items: document.querySelectorAll('[data-osc="studio.find.item"]').length,
      status: document.querySelector('[data-osc="studio.find.status"]').textContent }));
    await page.keyboard.type('lfo');
    const filtered = await page.evaluate(() => [...document.querySelectorAll(
      '[data-osc="studio.find.item"]')].map((b) => b.dataset.node));
    await page.keyboard.press('Enter');
    await H.frames(page, 4);
    const found = await page.evaluate(() => {
      const el = document.activeElement;
      const vp = document.querySelector('[data-osc="studio.graph.viewport"]')
        .getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { dialog: !!document.querySelector('#osc-dlg-studio-find[open]'),
        selection: [...window.OSCILLA.studio.selection.nodes], focusedNode: el.dataset.nodeId,
        inside: r.left >= vp.left - 1 && r.right <= vp.right + 1 && r.top >= vp.top - 1
          && r.bottom <= vp.bottom + 1,
        dirty: window.OSCILLA.studio.dirty };
    });
    // The Find button from the keyboard (WebKit does not focus a clicked button); Escape
    // returns focus to it; nothing matched is said in words.
    await page.focus('[data-osc="studio.find"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#osc-dlg-studio-find[open]', { timeout: 15000 });
    await H.frames(page);
    await page.keyboard.type('zzz');
    const none = await page.evaluate(() => document.querySelector('[data-osc="studio.find.status"]')
      .textContent);
    await page.keyboard.press('Escape');
    await H.frames(page, 3);
    const back = await page.evaluate(() => ({
      dialog: !!document.querySelector('#osc-dlg-studio-find[open]'),
      focused: document.activeElement && document.activeElement.dataset.osc }));
    const live = await H.live(page);
    return { ...H.verdict({
      opened: opened.focused === 'studio.find.search' && opened.items === 6
        && /^6 nodes match\.$/.test(opened.status),
      filtered: filtered.length === 1 && filtered[0] === 'lfo-1',
      selected: !found.dialog && found.selection.length === 1 && found.selection[0] === 'lfo-1',
      focused: found.focusedNode === 'lfo-1', framed: found.inside, notDirty: !found.dirty,
      announced: live.some((t) => t.startsWith('Found LFO 1')),
      noneSaid: none === 'No node matches “zzz”.',
      focusBack: !back.dialog && back.focused === 'studio.find',
    }), opened, filtered, found, back, live: live.slice(-4) };
  });

  def('render-wav', async ({ page }) => {
    await H.fresh(page, 'basic-tone');
    await H.recordLive(page);
    // Progress: record every task-strip state the page shows.
    await page.evaluate(() => {
      window.__task = [];
      const el = document.querySelector('[data-osc="studio.task"]');
      new MutationObserver(() => {
        const t = el.querySelector('[data-osc="studio.task.text"]').textContent;
        if (t && getComputedStyle(el).display !== 'none') window.__task.push(t);
      }).observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
    });
    // The dialog: a graph without a timeline is offered RENDER_DEFAULT_S; a bad duration is
    // refused in words and the dialog stays.
    await page.click('[data-osc="studio.renderWav"]');
    await page.waitForSelector('#osc-dlg-studio-render[open]', { timeout: 15000 });
    await H.frames(page);
    const form = await page.evaluate(() => ({
      duration: document.querySelector('[data-osc="studio.render.duration"]').value,
      format: document.querySelector('[data-osc="studio.render.format"]').textContent,
      note: document.querySelector('[data-osc="studio.render.note"]').textContent,
      focused: document.activeElement && document.activeElement.dataset.osc }));
    await page.fill('[data-osc="studio.render.duration"]', '0');
    await page.click('[data-osc="studio.render.start"]');
    await H.frames(page);
    const bad = await page.evaluate(() => ({
      open: !!document.querySelector('#osc-dlg-studio-render[open]'),
      error: document.querySelector('[data-osc="studio.render.error"]').textContent }));
    await page.fill('[data-osc="studio.render.duration"]', '1.5');
    const files = [];
    for (let i = 0; i < 2; i++) {
      if (i > 0) {
        await page.click('[data-osc="studio.renderWav"]');
        await page.waitForSelector('#osc-dlg-studio-render[open]', { timeout: 15000 });
        await page.fill('[data-osc="studio.render.duration"]', '1.5');
      }
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }),
        page.focus('[data-osc="studio.render.duration"]')
          .then(() => page.keyboard.press('Enter'))]);
      const p = await dl.path();
      files.push({ name: dl.suggestedFilename(), info: wavInfo(fs.readFileSync(p)) });
      await H.until(() => page.evaluate(() => window.OSCILLA.studio.rendering), (r) => !r, 5000);
    }
    const progress = await page.evaluate(() => window.__task.slice());
    // Abort through the strip's button while the render runs (it is shown at once).
    const abort = await page.evaluate(async () => {
      let downloads = 0;
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function click() {
        if (this.download) downloads += 1; else orig.call(this);
      };
      try {
        const p = window.OSCILLA.app.studioRenderWav({ duration: 1.5 });
        for (let i = 0; i < 4; i++) await Promise.resolve();
        const btn = document.querySelector('[data-osc="studio.task.abort"]');
        const visible = !!btn && btn.getBoundingClientRect().width > 0;
        btn.click();
        const r = await p;
        return { visible, aborted: !!r.aborted, ok: r.ok, downloads };
      } finally {
        HTMLAnchorElement.prototype.click = orig;
      }
    });
    await H.frames(page);
    const stripAfter = await page.evaluate(() => `${getComputedStyle(
      document.querySelector('[data-osc="studio.task"]')).display} ${JSON.stringify(
      window.OSCILLA.app.studio.task)}`);
    // A Studio with a live input: the dialog states the limitation and cannot render.
    await H.fresh(page, 'measurement-sweep');
    await page.click('[data-osc="studio.renderWav"]');
    await page.waitForSelector('#osc-dlg-studio-render[open]', { timeout: 15000 });
    await H.frames(page);
    const refused = await page.evaluate(async () => {
      const limits = [...document.querySelectorAll('[data-osc="studio.render.limits"] li')]
        .map((li) => li.textContent);
      const disabled = document.querySelector('[data-osc="studio.render.start"]').disabled;
      document.querySelector('[data-osc="studio.render.cancel"]').click();
      const r = await window.OSCILLA.app.studioRenderWav();
      return { limits, disabled, ok: r.ok, reason: r.reason };
    });
    const live = await H.live(page);
    const [a, b] = files;
    const frames = a.info.dataBytes / (a.info.channels * 2);
    return { ...H.verdict({
      form: form.duration === '2' && /^48 kHz · stereo · 16-bit WAV/.test(form.format)
        && /no timeline/.test(form.note) && form.focused === 'studio.render.duration',
      badRefused: bad.open && bad.error === 'Give a duration in seconds.',
      downloaded: a.name === 'basic-tone.wav' && a.info.riff === 'RIFF' && a.info.wave === 'WAVE',
      // timing-allow: the WAV header of the offline render, whose rate the dialog states
      format: a.info.sampleRate === 48000 && a.info.channels === 2 && a.info.bits === 16,
      length: frames === 72000,
      deterministic: a.info.sha256 === b.info.sha256,
      progress: progress.length > 0 && progress.every((t) => /^\d{1,3} %$/.test(t)),
      announced: live.some((t) => t.startsWith('Rendered basic-tone.wav: 1.50 s, 48000 Hz')),
      abortShown: abort.visible, aborted: abort.aborted && !abort.ok && abort.downloads === 0
        && live.includes('WAV render aborted'), stripHidden: stripAfter.startsWith('none '),
      refused: refused.disabled && refused.limits.some((t) => /live input/.test(t))
        && !refused.ok && /live input/.test(refused.reason || ''),
    }), form, bad, files, frames, progress: progress.slice(0, 12), abort, stripAfter, refused,
    live: live.slice(-5) };
  });

  def('measure-from-studio', async ({ page }) => {
    await page.evaluate(() => {
      const m = window.OSCILLA.measure;
      m.useLoopback({ type: 'biquad', filter: 'lowpass', frequency: 2000, Q: Math.SQRT1_2 });
    });
    await H.fresh(page, 'measurement-sweep');
    await H.recordLive(page);
    await page.evaluate(() => {
      const s = window.OSCILLA.studio.store;
      for (const a of [
        { type: 'NODE_PARAM_SET', nodeId: 'sweep-1', key: 'duration', value: 1 },
        { type: 'NODE_PARAM_SET', nodeId: 'sweep-1', key: 'level', value: 0.25 },
        // The shortened pass stays the one the engine runs: back to back, the capture from
        // pre-roll to tail (V272 review A8).
        { type: 'CLIP_RESIZE', clipId: 'clip-1', duration: 0.25 },
        { type: 'CLIP_MOVE', clipId: 'clip-2', start: 0.25 },
        { type: 'CLIP_RESIZE', clipId: 'clip-3', start: 0.75, duration: 1 },
        { type: 'CLIP_MOVE', clipId: 'clip-4', start: 1.75 },
        { type: 'CLIP_MOVE', clipId: 'clip-5', start: 2.75 },
        { type: 'CLIP_RESIZE', clipId: 'clip-6', start: 0.25, duration: 2.5 },
        // Ledger D3: a node the measurement never reads; recorded, outside the measured path.
        { type: 'NODE_ADD', nodeType: 'oscillator', position: { x: 600, y: 420 },
          params: { frequency: 440 } },
      ]) {
        const r = s.dispatch(a);
        if (!r.ok) throw new Error(r.reason);
      }
    });
    const modelText = await page.evaluate(() => JSON.stringify(window.OSCILLA.studio.model));
    await page.click('[data-osc="studio.play"]');
    const during = await H.until(() => page.evaluate(() => ({
      run: window.OSCILLA.studio.measurementRun.state, state: window.OSCILLA.measure.state,
      strip: getComputedStyle(document.querySelector('[data-osc="studio.task"]')).display,
      label: document.querySelector('[data-osc="studio.task"] .osc-st-task-label').textContent })),
    (v) => v.state === 'MEASURING', 10000, 20);
    const refusedPlay = await page.evaluate(() => window.OSCILLA.app.studioPlay());
    const done = await H.until(() => page.evaluate(() => {
      const r = window.OSCILLA.studio.measurementRun;
      return { run: r.state, text: r.text, id: r.experimentId, state: window.OSCILLA.measure.state,
        history: window.OSCILLA.measure.history };
    }), (v) => v.run === 'done' || v.run === 'failed', 30000, 50);
    const quiet1 = await H.quiet(page);
    const exp = done.id ? await page.evaluate(async (id) => {
      const e = window.OSCILLA.experiments.get(id);
      return e ? { name: e.name, studio: e.studio, recipe: e.recipe,
        sampleRate: e.measurement ? e.measurement.sampleRate : null,
        runs: e.measurement ? e.measurement.runs.map((r) => r.testContext || null) : [],
        configHash: e.provenance && e.provenance.configHash } : null;
    }, done.id) : null;
    // Node side: the hash of the model that ran and the recipe its topology describes.
    const { normalizeStudio, studioHash } = await esm('src/js/studio/schema.js');
    const { recipeFromStudio, measuredPath } = await esm('src/js/studio/provenance.js');
    const { measuredPathHash } = await esm('src/js/experiments/hash.js');
    const model = normalizeStudio(JSON.parse(modelText));
    const path = measuredPath(model);
    const osc = model.graph.nodes.find((n) => n.type === 'oscillator');
    const m = exp && exp.studio ? exp.studio.measured : null;
    const sr = await page.evaluate(() => window.OSCILLA.engine.ctx.sampleRate);
    const derived = recipeFromStudio(model, { sampleRate: sr });
    // A second run aborted by Escape mid-measurement.
    await page.evaluate(() => window.OSCILLA.app.studioPlay());
    await H.until(() => page.evaluate(() => window.OSCILLA.measure.state),
      (s) => s === 'MEASURING' || s === 'NOISE_CHECK', 10000, 20);
    await page.keyboard.press('Escape');
    const aborted = await H.until(() => page.evaluate(() => ({
      run: window.OSCILLA.studio.measurementRun.state,
      text: window.OSCILLA.studio.measurementRun.text, state: window.OSCILLA.measure.state })),
    (v) => v.run === 'failed' && v.state === 'ABORTED', 8000, 50);
    const quiet2 = await H.quiet(page);
    const live = await H.live(page);
    await page.evaluate(() => window.OSCILLA.measure.useMicrophone());
    return { ...H.verdict({
      handedOff: during.state === 'MEASURING' && during.run === 'running'
        && during.strip !== 'none' && during.label === 'Measuring from Studio',
      exclusive: refusedPlay === false
        && live.some((t) => /measurement owns the output/.test(t)),
      complete: done.run === 'done' && done.state === 'COMPLETE'
        && ['PREFLIGHT', 'NOISE_CHECK', 'MEASURING', 'ANALYZING', 'COMPLETE']
          .every((s) => done.history.includes(s)),
      saved: !!exp && exp.name === 'Measurement Sweep (Studio)'
        && live.some((t) => t.startsWith('Measurement saved as experiment')),
      studioBlock: !!exp && !!exp.studio && exp.studio.studioHash === studioHash(model)
        && exp.studio.schemaVersion === model.schemaVersion,
      measuredPath: !!m && !!path && !!osc && m.v === 1
        && JSON.stringify([m.nodes, m.edges, m.clips])
          === JSON.stringify([path.nodes, path.edges, path.clips])
        && !m.nodes.includes(osc.id) && exp.studio.execution.nodes.some((n) => n.id === osc.id)
        && m.hash === measuredPathHash(exp.studio.execution, m),
      recipe: !!exp && derived.ok
        && JSON.stringify(exp.recipe.stimulus) === JSON.stringify(derived.recipe.stimulus)
        && exp.recipe.analysis.noiseCheckS === 0.25,
      testContext: !!exp && exp.runs.length > 0 && exp.runs.every((t) => t && t.label),
      released: quiet1.engineNodes === 0 && quiet1.runtimeNodes === 0 && quiet1.ioNodes === 0
        && quiet1.captures === 0,
      escapeAborts: aborted.run === 'failed' && aborted.state === 'ABORTED'
        && aborted.text === 'Measurement aborted.',
      releasedAfterAbort: quiet2.engineNodes === 0 && quiet2.runtimeNodes === 0
        && quiet2.ioNodes === 0 && quiet2.captures === 0,
    }), during, done: { ...done, history: done.history.join(' → ') }, exp: exp && { name: exp.name,
      hash: exp.studio && exp.studio.studioHash.slice(0, 12), stimulus: exp.recipe.stimulus,
      measured: m && m.nodes },
    derived: derived.ok ? derived.recipe.stimulus : derived.reason, aborted, quiet1, quiet2,
    live: live.slice(-8) };
  });

  // #197 R-4 (plan E019): the hand-off compares the Master Output level with the level MEASURE
  // plays at (src/js/ui/studio/workspace.js passes outputLevel: cmp.gainLevel). The refusal is
  // read from the page, as the user sees it: the Studio's measurement note and the alert region.
  def('measure-level-refused', async ({ page }) => {
    const note = () => page.evaluate(() => {
      const el = document.querySelector('[data-osc="studio.measureNote"]');
      return { shown: !!el && el.getClientRects().length > 0,
        text: el ? el.textContent.trim() : '', run: window.OSCILLA.studio.measurementRun.state,
        state: window.OSCILLA.measure.state, history: window.OSCILLA.measure.history };
    });
    // The note a run ends with: refused, saved, failed or aborted.
    const settled = (what) => until(async () => {
      const n = await note();
      return n.shown && /^Measurement (not run|saved|did not complete|aborted)/.test(n.text)
        ? n : null;
    }, { ms: 30000, what });
    const quiet = (what) => until(async () => {
      const c = await H.counts(page);
      return !c.playing && c.engineNodes === 0 && c.engineSources === 0 && c.runtimeNodes === 0
        && c.ioNodes === 0 && c.ioSources === 0 && c.captures === 0 ? c : null;
    }, { ms: 5000, what });
    const setLevel = (level) => page.evaluate((v) => {
      const r = window.OSCILLA.studio.store.dispatch({ type: 'NODE_PARAM_SET',
        nodeId: 'master-1', key: 'level', value: v });
      if (!r.ok) throw new Error(r.reason);
    }, level);
    await page.evaluate(() => window.OSCILLA.measure.useLoopback({ type: 'biquad',
      filter: 'lowpass', frequency: 2000, Q: Math.SQRT1_2 }));
    await H.fresh(page, 'measurement-sweep');
    await H.recordLive(page);
    await page.evaluate(() => {
      const s = window.OSCILLA.studio.store;
      for (const a of [
        { type: 'NODE_PARAM_SET', nodeId: 'sweep-1', key: 'duration', value: 1 },
        { type: 'NODE_PARAM_SET', nodeId: 'sweep-1', key: 'level', value: 0.25 },
        { type: 'CLIP_RESIZE', clipId: 'clip-1', duration: 0.25 },
        { type: 'CLIP_MOVE', clipId: 'clip-2', start: 0.25 },
        { type: 'CLIP_RESIZE', clipId: 'clip-3', start: 0.75, duration: 1 },
        { type: 'CLIP_MOVE', clipId: 'clip-4', start: 1.75 },
        { type: 'CLIP_MOVE', clipId: 'clip-5', start: 2.75 },
        { type: 'CLIP_RESIZE', clipId: 'clip-6', start: 0.25, duration: 2.5 },
      ]) {
        const r = s.dispatch(a);
        if (!r.ok) throw new Error(r.reason);
      }
    });
    // MEASURE's output level, and a Master Output level other than it.
    const gain = await page.evaluate(() => window.OSCILLA.app.gainLevel);
    const foreign = Math.abs(gain - 0.05) > 0.01 ? 0.05 : 0.12;
    await setLevel(foreign);
    const h0 = (await note()).history.length;
    await page.click('[data-osc="studio.play"]');
    const refused = await settled('the measurement note after PLAY with a foreign Master level');
    await page.evaluate(() => window.OSCILLA.app.studioStop());
    const quiet1 = await quiet('0 nodes after the refused measurement and STOP');
    // The same Studio with the Master Output at MEASURE's level runs.
    await setLevel(gain);
    await page.click('[data-osc="studio.play"]');
    const ran = await settled('the measurement note after PLAY with the Master at MEASURE level');
    const quiet2 = await quiet('0 nodes after the measurement at an equal level');
    const live = await H.live(page);
    await page.evaluate(() => window.OSCILLA.measure.useMicrophone());
    // The template names its Master Output node "Master".
    const reason = `Master shows level ${foreign}, but the measurement plays at ${gain}, `
      + 'the output level MEASURE uses';
    return { ...H.verdict({
      levelsDiffer: Number.isFinite(gain) && Math.abs(gain - foreign) > 1e-3,
      refused: refused.run === 'failed' && refused.text.startsWith('Measurement not run: ')
        && refused.text.includes(reason),
      notMeasured: !refused.history.slice(h0).some((s) => s === 'PREFLIGHT' || s === 'MEASURING'),
      announced: live.includes(refused.text),
      released: !!quiet1,
      equalRuns: ran.run === 'done' && ran.state === 'COMPLETE'
        && ran.text.startsWith('Measurement saved as experiment'),
      releasedAfterRun: !!quiet2,
    }), gain, foreign, refused: { ...refused, history: refused.history.slice(h0) },
    ran: { ...ran, history: ran.history.slice(-5) }, live: live.slice(-6) };
  });

  // Connected records (ADR 0048): a run measured from a saved project names it (the hash
  // recomputed over the project as it loads), Studio's Projects and patches dialog names the run
  // back, the links go both ways, and a change outside the measured path keeps only the
  // measured-path connection.
  def('connections-from-studio', async ({ page }) => {
    await page.evaluate(() => window.OSCILLA.measure.useLoopback({ type: 'biquad',
      filter: 'lowpass', frequency: 2000, Q: Math.SQRT1_2 }));
    await H.fresh(page, 'measurement-sweep');
    const project = await page.evaluate(async () => {
      const s = window.OSCILLA.studio.store;
      for (const a of [
        { type: 'NODE_PARAM_SET', nodeId: 'sweep-1', key: 'duration', value: 1 },
        { type: 'NODE_PARAM_SET', nodeId: 'sweep-1', key: 'level', value: 0.25 },
        { type: 'CLIP_RESIZE', clipId: 'clip-1', duration: 0.25 },
        { type: 'CLIP_MOVE', clipId: 'clip-2', start: 0.25 },
        { type: 'CLIP_RESIZE', clipId: 'clip-3', start: 0.75, duration: 1 },
        { type: 'CLIP_MOVE', clipId: 'clip-4', start: 1.75 },
        { type: 'CLIP_MOVE', clipId: 'clip-5', start: 2.75 },
        { type: 'CLIP_RESIZE', clipId: 'clip-6', start: 0.25, duration: 2.5 },
      ]) {
        const r = s.dispatch(a);
        if (!r.ok) throw new Error(r.reason);
      }
      const saved = await window.OSCILLA.app.studioSave();
      return saved ? { id: saved.id, name: saved.name } : null;
    });
    await page.evaluate(() => window.OSCILLA.app.studioPlay());
    const done = await H.until(() => page.evaluate(() => {
      const r = window.OSCILLA.studio.measurementRun;
      return { run: r.state, id: r.experimentId };
    }), (v) => v.run === 'done' || v.run === 'failed', 30000, 50);
    const items = (sel) => page.evaluate((q) => [...document.querySelectorAll(q)].map((x) => ({
      state: x.dataset.state, relation: x.dataset.relation,
      href: (x.querySelector('a') || { getAttribute: () => null }).getAttribute('href'),
      text: x.textContent.replace(/\s+/g, ' ').trim() })), sel);
    const RUN = '[data-osc="exp.connections"] li.osc-x-cn-item';
    const res = { project, done };
    if (!project || !done.id) return { ok: false, failed: ['measured'], ...res };
    // 1. The run's connected records name the stored project.
    await page.evaluate((id) => { location.hash = `#m=experiments&exp=${id}`; }, done.id);
    res.up = await H.until(() => items(RUN), (l) => l.some((c) => c.relation === 'studio-graph'),
      15000);
    // 2. Following it opens Studio's dialog at that project, its runs listed.
    await page.click(`${RUN}[data-relation="studio-graph"] a`);
    const ROW = `[data-osc="studio.saved.list"] [data-id="${project.id}"]`;
    res.dialog = await H.until(() => page.evaluate((row) => {
      const d = document.getElementById('osc-dlg-studio-library');
      const r = document.querySelector(row);
      const det = r && r.querySelector('details');
      return { ws: window.OSCILLA.app.workspace, open: !!d && d.open, details: !!det && det.open,
        focusInRow: !!r && r.contains(document.activeElement),
        focus: { tag: document.activeElement.tagName,
          label: document.activeElement.getAttribute('aria-label') },
        openLabel: r ? r.querySelector('[data-osc="studio.saved.open"]')
          .getAttribute('aria-label') : null,
        items: det ? [...det.querySelectorAll('li.osc-x-cn-item')].map((x) => ({
          state: x.dataset.state, relation: x.dataset.relation,
          text: x.textContent.replace(/\s+/g, ' ').trim() })) : [] };
    }, ROW), (x) => x.open && x.items.length > 0, 15000);
    // 3. The run link in the dialog goes back to the run.
    await page.click(`${ROW} [data-osc="studio.saved.cnxLink"]`);
    res.back = await H.until(() => page.evaluate(() => ({
      ws: window.OSCILLA.app.workspace,
      id: window.OSCILLA.app.exps.detail ? window.OSCILLA.app.exps.detail.id : null,
      dialog: document.getElementById('osc-dlg-studio-library').open })),
    (x) => x.ws === 'experiments' && x.id && !x.dialog, 8000);
    // 4. A node the measurement does not read, added and saved: only the measured path matches.
    await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      a.setWorkspace('studio');
      const r = window.OSCILLA.studio.store.dispatch({ type: 'NODE_ADD', nodeType: 'oscillator',
        position: { x: 600, y: 420 }, params: { frequency: 440 } });
      if (!r.ok) throw new Error(r.reason);
      await a.studioSave();
    });
    await page.evaluate((id) => { location.hash = `#m=experiments&exp=${id}`; }, done.id);
    res.after = await H.until(() => items(RUN), (l) => l.some((c) => c.relation === 'studio-path'),
      15000);
    // Review 1 of #151, items 3 and 8. The dialog lists the experiment; it is then deleted behind
    // this view (as another tab would); the dialog's link is not followed: the dialog stays, says
    // why, and its list is read again.
    await page.evaluate(async (pid) => {
      window.OSCILLA.app.setWorkspace('studio');
      await window.OSCILLA.app.studioShowProject(pid);
    }, project.id);
    // (An experiment an earlier check measured from the same path may be listed too.)
    const mine = (c) => !!c.href && c.href.endsWith(`exp=${done.id}`);
    res.listed = await H.until(() => items(`${ROW} li.osc-x-cn-item`),
      (l) => l.some((c) => mine(c) && c.state === 'present'), 15000);
    await page.evaluate(async (id) => {
      await window.OSCILLA.experiments.store().delete(id);
      window.OSCILLA.app.alerts = [];
    }, done.id);
    await page.click(`${ROW} a[data-osc="studio.saved.cnxLink"][href$="exp=${done.id}"]`);
    res.refused = await H.until(() => page.evaluate(({ row, id }) => {
      const r = document.querySelector(row);
      return { ws: window.OSCILLA.app.workspace,
        dialog: document.getElementById('osc-dlg-studio-library').open,
        status: r ? r.querySelector('details [role="status"]').textContent : '',
        links: r ? [...r.querySelectorAll('[data-osc="studio.saved.cnxLink"]')]
          .filter((a) => a.getAttribute('href').endsWith(`exp=${id}`)).length : -1,
        alerts: window.OSCILLA.app.alerts.map((a) => `${a.title}: ${a.message || ''}`) };
    }, { row: ROW, id: done.id }), (x) => /was not opened/.test(x.status) && x.links === 0,
    15000);
    // Open over unsaved changes asks first: the first press changes nothing (the document; its
    // view, still fitted, follows the viewport when the dialog's status shows: K170).
    // The view itself is asserted by v31-studio-graph view-zoom (K170).
    res.unsaved = await page.evaluate(async (row) => {
      const s = window.OSCILLA.studio.store;
      const r0 = s.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'sweep-1', key: 'duration',
        value: 2 });
      const before = JSON.stringify({ ...window.OSCILLA.studio.model, view: null });
      document.querySelector(`${row} [data-osc="studio.saved.open"]`).click();
      return { dispatched: r0.ok, dirty: window.OSCILLA.app.studio.dirty, before };
    }, ROW);
    res.asked = await H.until(() => page.evaluate((row) => {
      const b = document.querySelector(`${row} [data-osc="studio.saved.open"]`);
      const st = document.querySelector('[data-osc="studio.saved.error"]');
      return { text: b ? b.textContent : '', label: b ? b.getAttribute('aria-label') : '',
        status: st && !st.hidden ? st.textContent : '',
        dialog: document.getElementById('osc-dlg-studio-library').open,
        model: JSON.stringify({ ...window.OSCILLA.studio.model, view: null }) };
    }, ROW), (x) => x.text === 'Replace unsaved changes', 8000);
    await page.evaluate(() => window.OSCILLA.app.closeModal('osc-dlg-studio-library'));
    // Leave nothing behind: the run and the project.
    await page.evaluate(async ({ run, pid }) => {
      const st = await window.OSCILLA.experiments.store();
      await st.delete(run);
      const lib = await window.OSCILLA.app.studioLibrary();
      await lib.remove(pid);
      await window.OSCILLA.app.experimentsRefresh();
      location.hash = '#m=studio';
      window.OSCILLA.app.alerts = [];
    }, { run: done.id, pid: project.id });
    const g = res.up.find((c) => c.relation === 'studio-graph') || {};
    const d = res.dialog.items.find((c) => c.relation === 'measured-graph') || {};
    const p = res.after.find((c) => c.relation === 'studio-path') || {};
    return { ...H.verdict({
      measured: done.run === 'done',
      upstream: g.state === 'present' && g.text.includes(`Studio project "${project.name}"`)
        && /Field: studio\.studioHash, on this experiment\./.test(g.text),
      dialog: res.dialog.ws === 'studio' && res.dialog.open && res.dialog.details
        && res.dialog.focusInRow && d.state === 'present'
        && /Field: studio\.studioHash, on that experiment\./.test(d.text),
      back: res.back.id === done.id,
      measuredPath: p.state === 'present' && /Field: studio\.measured\.hash/.test(p.text)
        && !res.after.some((c) => c.relation === 'studio-graph'),
      // The focus target names the project and is not a button that replaces the graph.
      focusNamed: res.dialog.focus.tag === 'SUMMARY'
        && res.dialog.focus.label === `Connected records of ${project.name}`
        && res.dialog.openLabel === `Open ${project.name}`,
      linkRefused: res.refused.ws === 'studio' && res.refused.dialog === true
        && res.refused.links === 0 && /was not opened/.test(res.refused.status)
        && res.refused.alerts.some((t) => /Experiment not opened: .*no longer stored here/.test(t)),
      openAsks: res.unsaved.dispatched && res.unsaved.dirty === true && res.asked.dialog === true
        && res.asked.model === res.unsaved.before
        && /^Replace the unsaved changes in Studio with /.test(res.asked.label)
        && /Studio has unsaved changes/.test(res.asked.status),
    }), ...res, unsaved: { ...res.unsaved, before: undefined },
    asked: { ...res.asked, model: undefined } };
  });

  def('large-graph-render', async ({ page, browserName }) => {
    await H.fresh(page);
    const t = await page.evaluate(async (text) => {
      const a = window.OSCILLA.app;
      const s = window.OSCILLA.studio;
      const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
      const t0 = performance.now();
      const r = a.studioImportText(text);
      await raf();
      await raf();
      const importMs = performance.now() - t0;
      const info = s.editor.debugInfo();
      const cards = document.querySelectorAll('.osc-sg-node').length;
      const cables = document.querySelectorAll('.osc-sg-edge-line').length;
      const med = (xs) => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)];
      const edit = [];
      const move = [];
      const frame = [];
      for (let i = 0; i < 9; i++) {
        let t1 = performance.now();
        s.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'filter-12', key: 'frequency',
          value: 600 + 10 * i });
        edit.push(performance.now() - t1);
        t1 = performance.now();
        s.store.dispatch({ type: 'NODE_MOVE', nodeId: 'osc-7', position: { x: 16 * i, y: 960 } });
        move.push(performance.now() - t1);
        t1 = performance.now();
        s.editor.frameAll();
        frame.push(performance.now() - t1);
      }
      // K009: L moves every node, M mutes the selected cables; one store event each.
      let events = 0;
      const off = s.store.subscribe(() => { events += 1; });
      const counted = (fn) => {
        events = 0;
        const t2 = performance.now();
        fn();
        return { ms: performance.now() - t2, events };
      };
      // L median of 9 (undone between, untimed), as the edits above are medians of 9.
      const tidies = [];
      let tidied = true;
      for (let i = 0; i < 9; i++) {
        tidies.push(counted(() => s.editor.tidy()));
        tidied = tidied && s.store.debugInfo().lastAction.label === 'Tidy the graph';
        if (i < 8) s.store.undo();
      }
      const tidy = { ms: med(tidies.map((x) => x.ms)),
        events: Math.max(...tidies.map((x) => x.events)) };
      const edges = s.store.getModel().graph.edges.map((e) => e.id);
      const pick = edges.filter((_, i) => i % 25 === 0);
      s.store.dispatch({ type: 'SELECTION_CHANGE', selection: { edges: pick } });
      const mute = counted(() => s.editor.toggleMute());
      const muted = s.store.getModel().graph.edges.filter((e) => e.props.muted).length;
      s.store.dispatch({ type: 'SELECTION_CHANGE', selection: { edges } });
      const muteAll = counted(() => s.editor.toggleMute());
      off();
      const tidyMs = tidy.ms;
      const muteMs = mute.ms;
      const muteAllMs = muteAll.ms;
      const oneEvent = [tidy, mute, muteAll].every((x) => x.events === 1);
      return { ok: r.ok, importMs, nodes: info.nodes, edges: info.edges, cards, cables,
        editMs: med(edit), moveMs: med(move), frameMs: med(frame), tidied, tidyMs,
        picked: pick.length, muted, muteMs, muteAllMs, oneEvent };
    }, fx.largeText);
    // Each budgeted field against its budget, printed always and carried in the result, so
    // a miss is diagnosable from the CI log (the runner prints a failed check's result).
    const budgets = fx.budgetReport(t, fx.budgets);
    const within = Object.fromEntries(budgets.map((x) => [x.field, x.within]));
    const budgetVsMeasured = budgets.map((x) => x.text).join('; ');
    console.log(`   ${browserName} budget vs measured: ${budgetVsMeasured}`);
    console.log(`   ${browserName} 100 nodes / 200 edges: import+render `
      + `${t.importMs.toFixed(1)} ms, `
      + `edit ${t.editMs.toFixed(2)} ms, move ${t.moveMs.toFixed(2)} ms, frame all `
      + `${t.frameMs.toFixed(2)} ms (median of 9); L ${t.tidyMs.toFixed(1)} ms (median of 9), M on `
      + `${t.picked} cables ${t.muteMs.toFixed(1)} ms, on all ${t.edges} `
      + `${t.muteAllMs.toFixed(1)} ms`);
    return { ...H.verdict({
      imported: t.ok && t.nodes === 100 && t.edges === 200 && t.cards === 100 && t.cables === 200,
      importBudget: within.importMs,
      editBudget: within.editMs && within.moveMs && within.frameMs,
      tidyBudget: t.tidied === true && within.tidyMs,
      muteSelected: t.picked === 8 && t.muted === 8,
      oneProjectionUpdate: t.oneEvent === true,
    }), budgetVsMeasured, t };
  });

  def('sequence-import', async ({ page }) => {
    // A configuration saved the way a user saves one (Export config), with the Sequencer's
    // sequence in it, then opened through the Studio Import button (plan K004).
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('sequencer'));
    await until(() => page.evaluate(() => !!window.OSCILLA.labs.sequencer),
      { ms: 15000, what: 'sequence-import: the Sequencer lab is mounted' });
    await H.fresh(page);
    await H.recordLive(page);
    const [cfgDl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }),
      page.evaluate(() => { window.OSCILLA.app.exportConfig(); })]);
    const cfgText = fs.readFileSync(await cfgDl.path(), 'utf8');
    const cfg = JSON.parse(cfgText);
    const n = cfg.sequencer && Array.isArray(cfg.sequencer.blocks) ? cfg.sequencer.blocks.length
      : -1;
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }),
      page.click('[data-osc="studio.import"]')]);
    await chooser.setFiles({ name: cfgDl.suggestedFilename(), mimeType: 'application/json',
      buffer: Buffer.from(cfgText) });
    const opened = await until(() => page.evaluate(() => {
      const m = window.OSCILLA.studio.model;
      if (m.metadata.title !== 'Configuration sequence') return null;
      const track = m.timeline.tracks[0];
      const target = track && m.graph.nodes.find((x) => x.id === track.target);
      return { tracks: m.timeline.tracks.length, kind: track && track.kind,
        target: target && target.type, clips: m.timeline.clips.length,
        pattern: m.timeline.clips.filter((c) => c.kind === 'pattern'
          && c.trackId === track.id).length,
        tempo: m.transport.tempo, dirty: window.OSCILLA.studio.dirty,
        model: JSON.stringify({ ...m, view: null }) };
    }), { ms: 15000, what: 'sequence-import: the saved config opens in Studio' });
    // A damaged sequence is refused: the document stays as it is and the reason is shown. The
    // document is compared without its view: the warning changes the graph viewport's height,
    // and a view still in fit mode fits it again (K170; presentation only).
    // The view itself is asserted by v31-studio-graph view-zoom (K170).
    const bad = { ...cfg, sequencer: { ...cfg.sequencer, blocks: 'none' } };
    await page.setInputFiles('#osc-studio-import-file', { name: 'damaged.json',
      mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
    const refusal = await until(() => page.evaluate(() => {
      const a = window.OSCILLA.app;
      return a.studio.warning.startsWith('Not imported') ? { warning: a.studio.warning,
        model: JSON.stringify({ ...window.OSCILLA.studio.model, view: null }) } : null;
    }), { ms: 15000, what: 'sequence-import: the damaged file is refused' });
    // The track goes back out as the V2 sequence the configuration held.
    const [seqDl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }),
      page.evaluate(() => { window.OSCILLA.app.studioExportTrackSequence(); })]);
    const exported = JSON.parse(fs.readFileSync(await seqDl.path(), 'utf8'));
    const live = await H.live(page);
    return { ...H.verdict({
      savedConfig: cfg.kind === 'oscilla-config' && n > 0,
      oneTrack: opened.tracks === 1 && opened.kind === 'event' && opened.target === 'sequence',
      nPatternClips: opened.clips === n && opened.pattern === n,
      tempo: opened.tempo === cfg.sequencer.tempoBpm,
      clean: opened.dirty === false,
      announced: live.includes(`Imported the configuration file's V2 sequence: ${n} pattern `
        + `clip${n === 1 ? '' : 's'} on one track`),
      refused: refusal.warning === 'Not imported: sequencer.blocks: The sequence blocks are not '
        + 'a list; the file is refused.',
      unchanged: refusal.model === opened.model,
      exported: /\.sequence\.json$/.test(seqDl.suggestedFilename())
        && isDeepStrictEqual(exported, cfg.sequencer),
    }), n, opened: { ...opened, model: undefined }, warning: refusal.warning,
    live: live.slice(-4) };
  });

  def('deleted-project-detaches', async ({ page }) => {
    await H.fresh(page);
    await H.recordLive(page);
    const id = await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      const s = await a.studioSave();
      return s && s.id;
    });
    // Open it through the library, as a user does.
    await page.evaluate(() => window.OSCILLA.app.studioOpenLibrary());
    const row = (osc) => `[data-osc="studio.saved.list"] [data-id="${id}"] [data-osc="${osc}"]`;
    await page.click(row('studio.saved.open'));
    await H.frames(page);
    const opened = await page.evaluate(() => ({ projectId: window.OSCILLA.studio.projectId,
      dirty: window.OSCILLA.studio.dirty }));
    await page.evaluate(() => window.OSCILLA.app.studioOpenLibrary());
    await page.click(row('studio.saved.delete'));
    await page.waitForFunction((sel) => {
      const b = document.querySelector(sel);
      return b && b.textContent === 'Confirm delete';
    }, row('studio.saved.delete'), { timeout: 15000 });
    await page.click(row('studio.saved.delete'));
    await H.until(() => page.evaluate(() => window.OSCILLA.studio.projectId), (v) => v === null);
    await H.frames(page);
    const after = await page.evaluate(async () => {
      const s = window.OSCILLA.studio;
      const lib = await s.library();
      const el = document.querySelector('[data-osc="studio.dirty"]');
      return { projectId: s.projectId, dirty: s.dirty, projects: (await lib.list({
        kind: 'oscilla-studio' })).length, indicator: !!el && el.getClientRects().length > 0 };
    });
    const live = await H.live(page);
    await page.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) {
      d.close(); } });
    // Templates warns before replacing; a template link waits for an explicit Open.
    await page.evaluate(() => window.OSCILLA.app.studioOpenTemplates());
    await H.frames(page);
    const note = await page.evaluate(() => {
      const el = document.querySelector('[data-osc="studio.templates.dirty"]');
      return !!el && el.getClientRects().length > 0;
    });
    await page.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) {
      d.close(); } });
    const link = await page.evaluate(() => {
      const before = window.OSCILLA.studio.model;
      const r = window.OSCILLA.app.studioApplyLinkHash('#m=studio&st=basic-tone');
      return { r, kept: window.OSCILLA.studio.model === before,
        pending: window.OSCILLA.app.studio.linkPending };
    });
    await page.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) {
      d.close(); } });
    return { ...H.verdict({
      saved: !!id && opened.projectId === id && opened.dirty === false,
      detached: after.projectId === null && after.projects === 0,
      unsaved: after.dirty === true && after.indicator,
      announced: live.some((t) => /open project was deleted from this browser; the graph is still /
        .test(t) && /unsaved/.test(t)),
      templatesWarn: note,
      linkWaits: link.r === true && link.kept && link.pending === 'Basic Tone',
    }), id, opened, after, link, live: live.slice(-3) };
  });

  def('mic-allow', async ({ page }) => {
    await H.fresh(page);
    await H.recordLive(page);
    // getUserMedia stubbed: a real MediaStream of a helper context (no device, no prompt).
    await page.evaluate(() => {
      const md = navigator.mediaDevices || {};
      if (!navigator.mediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true });
      }
      window.__mic = { mode: 'deny', streams: [] };
      md.getUserMedia = async () => {
        if (window.__mic.mode === 'deny') {
          throw new DOMException('Permission denied', 'NotAllowedError');
        }
        const C = window.AudioContext || window.webkitAudioContext;
        window.__mic.ctx ||= new C();
        const c = window.__mic.ctx;
        const o = c.createOscillator();
        const d = c.createMediaStreamDestination();
        o.connect(d);
        o.start();
        window.__mic.streams.push(d.stream);
        return d.stream;
      };
      const s = window.OSCILLA.studio;
      const add = (nodeType) => s.store.dispatch({ type: 'NODE_ADD', nodeType,
        position: { x: 40, y: 600 } }).created.nodes[0];
      const mic = add('microphone');
      const sp = add('spectrum');
      s.store.dispatch({ type: 'EDGE_ADD', from: { node: mic, port: 'audio' },
        to: { node: sp, port: 'audio' } });
      s.store.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [mic] } });
      window.__mic.id = mic;
    });
    await H.frames(page);
    const btn = '[data-osc="studio.inspector.allowMic"]';
    const status = () => page.evaluate(() => {
      const el = document.querySelector('[data-osc="studio.inspector.status"]');
      const b = document.querySelector('[data-osc="studio.inspector.allowMic"]');
      const err = document.querySelector('[data-osc="studio.inspector.micError"]');
      return { status: el ? el.textContent : '', button: b ? b.textContent : null,
        error: err ? err.textContent : null, errorRole: err ? err.getAttribute('role') : null,
        allowed: window.OSCILLA.studio.runtime.options.inputPermission };
    });
    const off = await status();
    await page.click(btn);
    const denied = await H.until(status, (v) => !!v.error);
    await page.evaluate(() => { window.__mic.mode = 'allow'; });
    await page.focus(btn);
    await page.keyboard.press('Enter');
    const allowed = await H.until(status, (v) => v.allowed && v.button === null);
    const probe = await page.evaluate(() => window.__mic.streams.map((x) => x.getTracks()
      .every((t) => t.readyState === 'ended')));
    await page.evaluate(() => window.OSCILLA.app.studioPlay());
    const live = await H.until(() => page.evaluate(() => {
      const h = window.OSCILLA.studio.runtime.nodes.get(window.__mic.id);
      return { status: h ? h.status : null, analyser: !!(h && h.info.analyser),
        streams: window.__mic.streams.length };
    }), (v) => v.status === 'ready', 4000);
    await page.evaluate(() => window.OSCILLA.app.studioStop());
    const quiet = await H.quiet(page);
    const ended = await page.evaluate(() => window.__mic.streams.map((x) => x.getTracks()
      .every((t) => t.readyState === 'ended')));
    const said = await H.live(page);
    await page.evaluate(() => {
      window.OSCILLA.studio.runtime.setOptions({ inputPermission: false });
      if (window.__mic.ctx) window.__mic.ctx.close();
    });
    return { ...H.verdict({
      offWithAction: off.button === 'Allow microphone' && /mic-off/.test(off.status)
        && /Allow microphone in the Inspector/.test(off.status) && off.allowed === false,
      deniedSaysWhy: /permission was denied/.test(denied.error || '') && denied.errorRole === 'alert'
        && denied.allowed === false,
      allowedOn: allowed.allowed === true && allowed.button === null
        && !/mic-off/.test(allowed.status),
      probeReleased: probe.length === 1 && probe[0] === true,
      openedOnPlay: live.status === 'ready' && live.analyser && live.streams === 2,
      stoppedTracks: ended.length === 2 && ended.every(Boolean),
      zeroNodes: quiet.engineNodes === 0 && quiet.runtimeNodes === 0,
      announced: said.some((t) => /Microphone allowed/.test(t)),
    }), off, denied, allowed, probe, live, ended, quiet };
  });

  def('mic-reopen-playing', async ({ page }) => {
    await H.fresh(page);
    await H.recordLive(page);
    await page.evaluate(() => {
      const md = navigator.mediaDevices || {};
      if (!navigator.mediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true });
      }
      window.__mic = { mode: 'deny', streams: [] };
      md.getUserMedia = async () => {
        if (window.__mic.mode === 'deny') {
          throw new DOMException('Permission denied', 'NotAllowedError');
        }
        const C = window.AudioContext || window.webkitAudioContext;
        window.__mic.ctx ||= new C();
        const c = window.__mic.ctx;
        const o = c.createOscillator();
        const d = c.createMediaStreamDestination();
        o.connect(d);
        o.start();
        window.__mic.streams.push(d.stream);
        return d.stream;
      };
      const s = window.OSCILLA.studio;
      const add = (nodeType) => s.store.dispatch({ type: 'NODE_ADD', nodeType,
        position: { x: 40, y: 600 } }).created.nodes[0];
      const mic = add('microphone');
      const sp = add('spectrum');
      s.store.dispatch({ type: 'EDGE_ADD', from: { node: mic, port: 'audio' },
        to: { node: sp, port: 'audio' } });
      s.store.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [mic] } });
      window.__mic.id = mic;
      // Allowed earlier (as after an Allow while stopped): PLAY asks the browser for the node.
      s.runtime.setOptions({ inputPermission: true });
    });
    await page.evaluate(() => window.OSCILLA.app.studioPlay());
    const btn = '[data-osc="studio.inspector.allowMic"]';
    const view = () => page.evaluate(() => {
      const h = window.OSCILLA.studio.runtime.nodes.get(window.__mic.id);
      const b = document.querySelector('[data-osc="studio.inspector.allowMic"]');
      const st = document.querySelector('[data-osc="studio.inspector.status"]');
      return { code: h ? h.code || null : null, status: h ? h.status : null,
        button: b ? b.textContent : null, line: st ? st.textContent : '',
        streams: window.__mic.streams.length };
    });
    const denied = await H.until(view, (v) => v.code === 'mic-error' && v.button !== null);
    // Allow again, from the keyboard: the browser allows the probe and the node's request now.
    await page.evaluate(() => { window.__mic.mode = 'allow'; });
    await page.focus(btn);
    await page.keyboard.press('Enter');
    const reopened = await H.until(view, (v) => v.status === 'ready' && v.button === null);
    const saidOpen = await H.until(() => H.live(page), (l) => l.some((t) => /Microphone open/
      .test(t)));
    // The node's track ends by itself (device unplugged): mic-ended, Allow again reopens.
    await page.evaluate(() => {
      const st = window.__mic.streams.at(-1); // none when the input never reopened
      for (const t of st ? st.getTracks() : []) t.dispatchEvent(new Event('ended'));
    });
    const ended = await H.until(view, (v) => v.code === 'mic-ended' && v.button !== null);
    await page.click(btn);
    const again = await H.until(view, (v) => v.status === 'ready' && v.button === null);
    // A request the browser refuses is not announced as success; the alert says why.
    await page.evaluate(() => { window.__mic.mode = 'deny'; });
    await page.evaluate(() => {
      const st = window.__mic.streams.at(-1);
      for (const t of st ? st.getTracks() : []) t.dispatchEvent(new Event('ended'));
    });
    await H.until(view, (v) => v.code === 'mic-ended');
    await H.recordLive(page);
    await page.click(btn);
    const refused = await H.until(() => page.evaluate(() => {
      const e = document.querySelector('[data-osc="studio.inspector.micError"]');
      return e ? e.textContent : '';
    }), (t) => /denied/.test(t));
    const saidAfter = await H.live(page);
    await page.evaluate(() => window.OSCILLA.app.studioStop());
    const quiet = await H.quiet(page);
    await page.evaluate(() => {
      window.OSCILLA.studio.runtime.setOptions({ inputPermission: false });
      if (window.__mic.ctx) window.__mic.ctx.close();
    });
    return { ...H.verdict({
      deniedSaysWhy: denied.button === 'Allow microphone again'
        && /permission was denied/.test(denied.line),
      reopenedOnAllow: reopened.status === 'ready' && reopened.streams >= 2,
      announcedOpen: saidOpen.some((t) => /Microphone open/.test(t)),
      endedOffered: ended.button === 'Allow microphone again',
      reopenedAfterEnd: again.status === 'ready',
      refusalNotSuccess: /permission was denied/.test(refused)
        && !saidAfter.some((t) => /Microphone open|Microphone allowed/.test(t))
        && !saidAfter.some((t) => /permission was denied/.test(t)), // the alert, not twice
      zeroNodes: quiet.engineNodes === 0 && quiet.runtimeNodes === 0,
    }), denied, reopened, ended, again, refused, saidAfter, quiet };
  });

  def('render-wav-busy', async ({ page }) => {
    await H.fresh(page, 'basic-tone');
    await H.recordLive(page);
    // A task in progress as the strip shows it (a real render of this graph ends too quickly to
    // be caught reliably): the button reads only studio.task.
    await page.evaluate(() => { const a = window.OSCILLA.app;
      a.studio.task = { active: true, kind: 'render', label: 'Rendering WAV', pct: 40,
        text: '40 %', abortable: false }; });
    await H.frames(page);
    const btn = '[data-osc="studio.renderWav"]';
    const state = await page.evaluate((sel) => {
      const b = document.querySelector(sel);
      const id = b.getAttribute('aria-describedby');
      const why = id ? document.getElementById(id) : null;
      return { disabled: b.disabled, aria: b.getAttribute('aria-disabled'),
        why: why ? why.textContent : null,
        visible: !!why && why.getClientRects().length > 0 };
    }, btn);
    await page.focus(btn);
    const focused = await page.evaluate((sel) => document.activeElement
      === document.querySelector(sel), btn);
    await page.keyboard.press('Enter');
    await H.frames(page);
    const opened = await page.evaluate(() => !!document.querySelector(
      '#osc-dlg-studio-render[open]'));
    const said = await H.live(page);
    await page.evaluate(() => { const a = window.OSCILLA.app;
      a.studio.task = { active: false, kind: '', label: '', pct: null, text: '',
        abortable: false }; });
    const after = await H.until(() => page.evaluate((sel) => document.querySelector(sel)
      .getAttribute('aria-disabled'), btn), (v) => v === 'false');
    return { ...H.verdict({
      ariaDisabled: state.aria === 'true' && state.disabled === false,
      reasonVisible: /unavailable while a Studio task runs \(Rendering WAV\)/
        .test(state.why || '') && state.visible,
      focusable: focused,
      nothingOpened: !opened,
      saidWhy: said.some((t) => /Render WAV is unavailable/.test(t)),
      availableAfter: after === 'false',
    }), state, said: said.slice(-2) };
  });

  def('template-pack', async ({ page }) => {
    const { ids, titles, cap, rmsFloorDb } = fx.pack;
    const shown = (id, what) => until(() => page.evaluate((tid) => {
      const s = window.OSCILLA.studio;
      return s.templateId === tid && !s.dirty ? { title: s.model.metadata.title,
        hash: window.location.hash, workspace: window.OSCILLA.app.workspace } : null;
    }, id), { ms: 10000, what });
    const rows = {};
    // The claims the Learn texts make, judged from each WAV (see the header). Times are inside
    // the first note or strike (0-0.5 s and 0-0.7 s of the timeline), after the fade-in.
    const dbs = (w, list, t0, t1) => Object.fromEntries(list.map((hz) => [hz,
      Number(wavLine(w, hz, t0, t1).toFixed(1))]));
    const spectra = {
      'ring-mod': { measure: (w) => dbs(w, [220, 250, 690], 0.1, 0.45) },
      'fm-chime': { measure: (w) => dbs(w, [176, 440, 1056, 1672, 300, 620, 1300, 1500], 0.05,
        0.45) },
    };
    for (const id of ids) {
      // 1. Templates, Open, from another document.
      await H.fresh(page, 'basic-tone');
      await page.click('[data-osc="studio.templates"]');
      const open = `#osc-dlg-studio-templates[open] [data-osc="studio.template.open"]`
        + `[data-template="${id}"]`;
      await until(() => page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        return !!btn && btn.getBoundingClientRect().width > 0;
      }, open), { ms: 10000, what: `template-pack: the Templates dialog offers ${id}` });
      await page.click(open);
      const dialog = await shown(id, `template-pack: ${id} opens from the Templates dialog`);
      // 2. The link, followed in the page.
      await H.fresh(page, 'basic-tone');
      await page.evaluate((h) => { window.location.hash = h; }, `m=studio&st=${id}`);
      const link = await shown(id, `template-pack: ${id} opens from #m=studio&st=${id}`);
      // 3. Render WAV at the dialog's default duration.
      await page.click('[data-osc="studio.renderWav"]');
      await page.waitForSelector('#osc-dlg-studio-render[open]', { timeout: 15000 });
      const duration = await page.evaluate(() => document.querySelector(
        '[data-osc="studio.render.duration"]').value);
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }),
        page.click('[data-osc="studio.render.start"]')]);
      const bytes = fs.readFileSync(await dl.path());
      const wav = wavLevels(bytes);
      if (spectra[id]) spectra[id].lines = spectra[id].measure(wavMono(bytes));
      await until(() => page.evaluate(() => !window.OSCILLA.studio.rendering),
        { ms: 10000, what: `template-pack: the ${id} render ends` });
      rows[id] = { dialog: dialog.title === titles[id], link: link.title === titles[id]
          && link.workspace === 'studio', file: dl.suggestedFilename() === `${id}.wav`,
        duration, seconds: Number(wav.seconds.toFixed(3)), sampleRate: wav.sampleRate,
        peakDbfs: Number(wav.peakDbfs.toFixed(2)), rmsDbfs: Number(wav.rmsDbfs.toFixed(2)),
        sounds: wav.rmsDbfs > rmsFloorDb, underCap: wav.peak > 0 && wav.peak <= cap };
    }
    const bad = (k) => ids.filter((id) => !rows[id][k]);
    const ring = spectra['ring-mod'].lines;
    const fm = spectra['fm-chime'].lines;
    const fmFloor = Math.max(fm[300], fm[620], fm[1300], fm[1500]);
    const j1OverJ0Db = 20 * Math.log10(besselJ(1, 1) / besselJ(0, 1));
    const j2OverJ0Db = 20 * Math.log10(besselJ(2, 1) / besselJ(0, 1));
    return { ...H.verdict({
      dialog: bad('dialog').length === 0, link: bad('link').length === 0,
      file: bad('file').length === 0, sounds: bad('sounds').length === 0,
      underCap: bad('underCap').length === 0,
      ringNoCarrier: ring[220] <= ring[250] - 20 && ring[220] <= ring[690] - 20,
      fmSidebands: [176, 1056, 1672].every((hz) => fm[hz] >= fmFloor + 20),
      fmIndex: Math.abs(fm[1056] - fm[440] - j1OverJ0Db) <= 1
        && Math.abs(fm[1672] - fm[440] - j2OverJ0Db) <= 1,
    }), ring, fm: { ...fm, floor: fmFloor, j1OverJ0Db: Number(j1OverJ0Db.toFixed(2)),
      j2OverJ0Db: Number(j2OverJ0Db.toFixed(2)) },
    capDbfs: Number((20 * Math.log10(cap)).toFixed(2)), rmsFloorDb, rows };
  });

  // K169: a PLAY refused while armed stops the armed run and says so, and the next edit is not
  // stranded 'behind'. The refusal is forced through the transport's Inject hook
  // (transport.debugRefuseNextPlay: the next PLAY's output claim is refused), which works only
  // in TEST CONTEXT (ADR 0052): the page enters it as the other Inject users do
  // (measure.useLoopback) and leaves it after. PLAY is the compact widget's (app.studioPlay),
  // which plays while armed.
  def('armed-play-refused', async ({ page }) => {
    // Outside TEST CONTEXT first (an earlier check may have left the page in it).
    const outside = await page.evaluate(() => {
      const m = window.OSCILLA.measure;
      return { left: m.useMicrophone(), loopback: window.OSCILLA.app.meas.loopback,
        hook: window.OSCILLA.studio.transport.debugRefuseNextPlay() };
    });
    await page.evaluate(() => window.OSCILLA.measure.useLoopback());
    await H.fresh(page);
    await H.recordLive(page);
    const view = () => page.evaluate(() => {
      const s = window.OSCILLA.studio;
      const c = s.counts();
      const st = document.querySelector('[data-osc="studio.inspector.runtimeState"]');
      const e = s.transport.debugInfo().lastError;
      const badge = document.querySelector('[data-osc="studio.armed"]');
      return { ...c, armed: s.transport.armed,
        badge: !!badge && getComputedStyle(badge).display !== 'none',
        pressed: document.querySelector('[data-osc="studio.play"]').getAttribute('aria-pressed'),
        inspector: st ? st.dataset.state : null, lastError: e ? e.code : null };
    });
    const armedOk = await page.evaluate(() => window.OSCILLA.studio.transport.arm().ok);
    const armed = await until(async () => {
      const v = await view();
      // K104: an armed run is shown by the armed indicator; Play is pressed only while the
      // timeline plays (before K104 an armed run showed Play pressed).
      return v.armed && v.runtimeState === 'running' && v.badge && v.pressed === 'false'
        ? v : null;
    }, { ms: 5000, what: 'armed-play-refused: the armed run runs, shown armed, Play not pressed' });
    const played = await page.evaluate(() => ({
      hook: window.OSCILLA.studio.transport.debugRefuseNextPlay(),
      ok: window.OSCILLA.app.studioPlay() }));
    // An edit after the refused PLAY; nothing selected, the Inspector shows its Runtime state.
    const edit = await page.evaluate(() => {
      const st = window.OSCILLA.studio.store;
      const r = st.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'frequency',
        value: 900 });
      st.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [] } });
      return { ok: r.ok, reason: r.reason || null };
    });
    const said = 'Studio did not start: The audio output is in use by another program.';
    const after = await until(async () => {
      const v = await view();
      const live = await H.live(page);
      return v.pressed === 'false' && !v.playing && !v.armed && !v.badge
        && v.runtimeState === 'idle'
        && v.runtimeNodes === 0 && v.runtimeSources === 0 && v.engineNodes === 0
        && v.engineSources === 0 && v.inspector !== null && v.inspector !== 'behind'
        && live.includes(said) ? { ...v, live } : null;
    }, { ms: 5000, what: 'armed-play-refused: Play released, the reason said, census 0, '
      + 'the Inspector not behind' });
    await page.evaluate(() => window.OSCILLA.measure.useMicrophone());
    return { ...H.verdict({
      hookRefusedOutside: outside.left && !outside.loopback && outside.hook === false,
      armed: armedOk && !!armed,
      refused: played.hook === true && played.ok === false,
      edited: edit.ok,
      released: after.pressed === 'false' && !after.playing && !after.armed && !after.badge,
      census0: after.runtimeNodes === 0 && after.engineNodes === 0
        && after.engineSources === 0,
      announced: after.live.includes(said),
      notBehind: after.inspector === 'not-applied',
      refusalKept: after.lastError === 'claim-refused',
    }), outside, armed, edit, after: { ...after, live: after.live.slice(-3) } };
  });

  // T7 (K226 R2-T5-7): an Inspector rebuild between a press's down and up must not drop it.
  def('inspector-press-kept', async ({ page }) => {
    await H.fresh(page);
    const made = await page.evaluate(() => {
      const st = window.OSCILLA.studio.store;
      const add = (nodeType, x) => {
        const r = st.dispatch({ type: 'NODE_ADD', nodeType, position: { x, y: 600 } });
        return r.ok ? r.created.nodes[0] : null;
      };
      const keys = add('keys', 40);
      const svs = add('step-voltage-sequencer', 240);
      const e = keys && svs && st.dispatch({ type: 'EDGE_ADD', from: { node: keys, port: 'gate' },
        to: { node: svs, port: 'clock' } });
      // A loop: the template's timeline is shorter than this check's deadlines (R2-T5-7).
      st.dispatch({ type: 'LOOP_SET', enabled: true, start: 0, end: 4 });
      st.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: svs ? [svs] : [] } });
      return { keys, svs, ok: !!(e && e.ok), reason: e ? e.reason || null : 'no node' };
    });
    if (!made.ok) return { ok: false, detail: `the sequencer and its clock: ${made.reason}` };
    const tab = page.locator('[data-osc="studio.subview"][data-value="inspector"]');
    if (await tab.isVisible()) await tab.click();
    const sel = '[data-osc="studio.inspector.svsStep"]';
    await until(() => page.locator(sel).isVisible(), { ms: 10000,
      what: 'inspector-press-kept: the Inspector shows the Krok button' });
    await page.evaluate(() => window.OSCILLA.app.studioPlay());
    await until(() => page.evaluate((id) => window.OSCILLA.studio.transport.playing
      && window.OSCILLA.studio.runtime.nodes.has(id), made.svs), { ms: 10000,
    what: 'inspector-press-kept: the Studio plays the sequencer' });
    await H.recordLive(page);
    await page.evaluate((s) => { window.__krokButton = document.querySelector(s); }, sel);
    const b = await page.locator(sel).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    // Mid-press: a connection out of the sequencer changes the node view's rebuild key.
    const edit = await page.evaluate((id) => {
      const st = window.OSCILLA.studio.store;
      const r = st.dispatch({ type: 'EDGE_ADD', from: { node: id, port: 'cvB' },
        to: { node: 'filter-1', port: 'frequency' } });
      return { ok: r.ok, reason: r.reason || null };
    }, made.svs);
    await page.mouse.up();
    let heard = [];
    const stepped = await until(async () => ((heard = await H.live(page)).includes('Krok 1')
      ? true : null), { ms: 5000, what: 'inspector-press-kept: the press steps the sequencer '
      + '(Krok 1) although the node view rebuilt mid-press' }).catch(() => false);
    const rebuilt = await until(() => page.evaluate((s) => {
      const now = document.querySelector(s);
      return !!now && now !== window.__krokButton;
    }, sel), { ms: 5000, what: 'inspector-press-kept: the deferred rebuild runs after the '
      + 'press' }).catch(() => false);
    await page.evaluate(() => window.OSCILLA.app.studioStop());
    return { ...H.verdict({ edited: edit.ok, stepped, rebuilt }), edit,
      heard: heard.slice(-4) };
  });

  def('no-console-errors', async ({ errors }) => ({ ok: errors.length === 0,
    errors: errors.slice(0, 8) }));
  return checks;
}

// ------------------------------------------------------------------------------ runner
async function runOne(browserName, origin, baseUrl, fx) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 },
    acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const results = {};
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
  await page.mouse.click(5, 300); // a user gesture so the audio context may start
  await page.evaluate(() => { const a = window.OSCILLA.app; a.alerts = [];
    if (!a.safetyCollapsed) a.collapseSafety(); });
  for (const { name, fn } of defineChecks(fx)) {
    if (ONLY && !ONLY.has(name) && name !== 'no-console-errors') continue;
    if (origin === 'http' && !HTTP_CHECKS.has(name)) continue;
    const t0 = Date.now();
    try {
      const v = await Promise.race([
        fn({ page, context, browser, errors, browserName, origin, baseUrl }),
        sleep(90000).then(() => ({ ok: false, detail: 'timeout 90 s' })),
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
  await RUN.ready();
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  // The §145 fixture, built through the store in Node, exported as a project file.
  const { normalizeStudio } = await esm('src/js/studio/schema.js');
  const { createIdGenerator, createStudioStore } = await esm('src/js/studio/actions.js');
  const { exportProjectFile } = await esm('src/js/studio/library.js');
  const { BROWSER_BUDGETS, browserBudgetReport, buildLargeStudio } = await esm(
    'tests/unit/fixtures/v31-large-studio.mjs');
  const empty = normalizeStudio({ metadata: { title: 'Large graph (100 nodes)' } });
  const store = createStudioStore(empty, { idGenerator: createIdGenerator(empty) });
  buildLargeStudio(store);
  // The K014 template pack and the output ceiling its renders must stay under.
  const { TEMPLATE_PACK_IDS, getTemplate } = await esm('src/js/studio/templates/index.js');
  const { MAX_OUTPUT_GAIN } = await esm('src/js/core/constants.js');
  const pack = { ids: [...TEMPLATE_PACK_IDS], cap: MAX_OUTPUT_GAIN, rmsFloorDb: -50,
    titles: Object.fromEntries(TEMPLATE_PACK_IDS.map((id) => [id, getTemplate(id).title])) };
  const fx = { largeText: exportProjectFile(store.getModel()).text, budgets: BROWSER_BUDGETS,
    budgetReport: browserBudgetReport, pack };

  const server = ORIGINS.includes('http') ? await serveDist(DIST, { prefix: 'oscilla-studio-wf-' }) : null;
  const all = {};
  let failed = 0;
  try {
    for (const b of BROWSERS) {
      for (const o of ORIGINS) {
        const base = o === 'file' ? pathToFileURL(DIST).href : server.url;
        const key = `${b}/${o}`;
        const t0 = Date.now();
        const res = await runOne(b, o, base, fx);
        all[key] = res;
        const names = Object.keys(res);
        RUN.reportLeg({ leg: key, checks: names.length });
        const bad = names.filter((n) => !res[n].ok);
        failed += bad.length;
        console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/v31-studio-workflows: ${names.length
          - bad.length}/${names.length} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        for (const n of bad) {
          const why = res[n].failed ? `failed [${res[n].failed.join(', ')}] ` : '';
          console.log(`   x ${n}: ${why}${JSON.stringify(res[n]).slice(0, 1400)}`);
        }
      }
    }
  } finally {
    if (server) {
      server.close();
    }
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(all, null, 2)}\n`);
  process.exit(failed ? 1 : 0);
})();

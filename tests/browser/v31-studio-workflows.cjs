#!/usr/bin/env node
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
//   large-graph-render   the 100-node / 200-edge fixture imported through the UI path renders
//                        100 node cards and 200 cables within BROWSER_BUDGETS.importMs; one edit
//                        (store dispatch + every projection) and Frame All within
//                        BROWSER_BUDGETS.editMs (median of 9; tests/unit/fixtures/
//                        v31-large-studio.mjs, docs/v31/performance.md); the numbers are printed
//                        (V431)
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
//   no-console-errors
'use strict';
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
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
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist', 'index.html');
const BROWSERS = arg('browsers', process.env.OSC_BROWSERS || 'chromium,firefox,webkit').split(',');
const ORIGINS = arg('origins', 'file,http').split(',');
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

function startServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-studio-wf-'));
  fs.mkdirSync(path.join(root, 'oscilla'));
  fs.copyFileSync(DIST, path.join(root, 'oscilla', 'index.html'));
  const port = 9300 + Math.floor(Math.random() * 300);
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
    await page.waitForFunction(() => document.querySelector('#osc-app').dataset.mode === 'studio');
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
    await page.waitForSelector('#osc-dlg-studio-find[open]');
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
    await page.waitForSelector('#osc-dlg-studio-find[open]');
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
    await page.waitForSelector('#osc-dlg-studio-render[open]');
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
        await page.waitForSelector('#osc-dlg-studio-render[open]');
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
    await page.waitForSelector('#osc-dlg-studio-render[open]');
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
        { type: 'CLIP_RESIZE', clipId: 'clip-1', duration: 0.25 },
        { type: 'CLIP_RESIZE', clipId: 'clip-3', duration: 1 },
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
        { type: 'CLIP_RESIZE', clipId: 'clip-3', duration: 1 },
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
    await page.evaluate((id) => { location.hash = `#m=experiments&run=${id}`; }, done.id);
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
    await page.evaluate((id) => { location.hash = `#m=experiments&run=${id}`; }, done.id);
    res.after = await H.until(() => items(RUN), (l) => l.some((c) => c.relation === 'studio-path'),
      15000);
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
        && /Field: studio\.studioHash, on this run\./.test(g.text),
      dialog: res.dialog.ws === 'studio' && res.dialog.open && res.dialog.details
        && res.dialog.focusInRow && d.state === 'present'
        && /Field: studio\.studioHash, on that run\./.test(d.text),
      back: res.back.id === done.id,
      measuredPath: p.state === 'present' && /Field: studio\.measured\.hash/.test(p.text)
        && !res.after.some((c) => c.relation === 'studio-graph'),
    }), ...res };
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
      return { ok: r.ok, importMs, nodes: info.nodes, edges: info.edges, cards, cables,
        editMs: med(edit), moveMs: med(move), frameMs: med(frame) };
    }, fx.largeText);
    console.log(`   ${browserName} 100 nodes / 200 edges: import+render `
      + `${t.importMs.toFixed(1)} ms, `
      + `edit ${t.editMs.toFixed(2)} ms, move ${t.moveMs.toFixed(2)} ms, frame all `
      + `${t.frameMs.toFixed(2)} ms (median of 9)`);
    return { ...H.verdict({
      imported: t.ok && t.nodes === 100 && t.edges === 200 && t.cards === 100 && t.cables === 200,
      importBudget: t.importMs <= fx.budgets.importMs,
      editBudget: t.editMs <= fx.budgets.editMs && t.moveMs <= fx.budgets.editMs
        && t.frameMs <= fx.budgets.editMs,
    }), t };
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
    }, row('studio.saved.delete'));
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
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  // The §145 fixture, built through the store in Node, exported as a project file.
  const { normalizeStudio } = await esm('src/js/studio/schema.js');
  const { createIdGenerator, createStudioStore } = await esm('src/js/studio/actions.js');
  const { exportProjectFile } = await esm('src/js/studio/library.js');
  const { BROWSER_BUDGETS, buildLargeStudio } = await esm(
    'tests/unit/fixtures/v31-large-studio.mjs');
  const empty = normalizeStudio({ metadata: { title: 'Large graph (100 nodes)' } });
  const store = createStudioStore(empty, { idGenerator: createIdGenerator(empty) });
  buildLargeStudio(store);
  const fx = { largeText: exportProjectFile(store.getModel()).text, budgets: BROWSER_BUDGETS };

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
        const res = await runOne(b, o, base, fx);
        all[key] = res;
        const names = Object.keys(res);
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
      server.proc.kill();
      fs.rmSync(server.root, { recursive: true, force: true });
    }
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(all, null, 2)}\n`);
  process.exit(failed ? 1 : 0);
})();

#!/usr/bin/env node
// suite-pace: shared (search, routes, dialogs and focus; audio read only as a kept tone, no clock)
// U130: the command palette (src/js/ui/palette.js), on dist from file:// in chromium, firefox
// and webkit, each check at 1536x1024 and at 390x844 with touch, on its own fresh page:
//
//   ctrl-k@size          Ctrl+K (and Cmd+K, Meta+K) opens it from every workspace of the
//                        registry (WORKSPACE_IDS) and from a focused text field, focus in its
//                        combobox; Escape closes it and focus returns to where it was
//   lfo@size             typing "lfo" lists the Synth's MG / LFO module and the LFO node first;
//                        the combobox points at the active option (aria-activedescendant),
//                        ArrowDown moves it, End and Home reach the last and the first row
//   template@size        "first patch" then Enter opens Studio with that template: the Studio
//                        model's template id (window.OSCILLA.studio.templateId) is first-patch
//   settings@size        the action "Nastavení" opens the Settings dialog, and the component
//                        Připojit MIDI opens the same dialog, where the MIDI section stands
//   escape-sound@size    with a latched tone sounding, Escape closes the palette and the tone
//                        sounds on (status PLAYING, the engine's active sources); a second
//                        Escape, the page's, stops it
//   header-enter@desktop the navbar's workspace search: "seq" and Enter opens the palette with
//                        that text and the Sequencer first; Enter there opens the Sequencer
//   compare-link@size    #m=compare opens the microphone panel's Compare tab (the registry's
//                        `enter`, the deep link of surface mic.tab:compare)
//   compare@size         the palette's Porovnání entry does the same
//   rows@size            every row is at least 44 px tall (a phone's touch target)
//   axe@size             axe-core finds no critical or serious violation on the open palette
//   walk@size            the link-walk: every entry of the palette's index, executed through
//                        paletteRun on the page, reaches its target, judged per kind (below).
//                        Bound: the whole index is walked at 1536x1024; at 390x844 the first
//                        WALK_PHONE entries of each kind (every kind, a sample of the long ones),
//                        so a leg stays under the CI job's bound.
//
// Every wait is a condition poll with a named wall-clock deadline (lib/wait.cjs until()).
//
//   node tests/browser/palette.cjs [--browsers chromium,firefox,webkit] [--only id,...]

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const suite = require('./lib/suite.cjs');
const { until, WaitTimeout } = require('./lib/wait.cjs');
const op = require('./lib/oscilla-page.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const RUN = suite.open({ name: 'palette', browsers: arg('browsers') });
const playwright = RUN.playwright;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const SIZES = { desktop: { width: 1536, height: 1024 }, phone: { width: 390, height: 844 } };
const UI_MS = 8000;      // a key or a click reaching Alpine's next render
const STEP_MS = 15000;   // a route, a template load, a dialog opening on a loaded machine
const WALK_PHONE = 4;    // entries of each kind walked at the phone size
const WALK_MS = 6000;    // one walked entry reaching its target
const { WORKSPACE_IDS } = require('../../src/js/ui/shell.js');

/** What the palette shows now. Runs in the page. */
function readPalette() {
  const dlg = document.getElementById('osc-dlg-palette');
  const input = document.querySelector('[data-osc="palette.input"]');
  const opts = [...document.querySelectorAll('[data-osc="palette.list"] [role="option"]')];
  const active = input && input.getAttribute('aria-activedescendant');
  const a = document.activeElement;
  return { open: !!(dlg && dlg.open), app: window.OSCILLA.app.paletteOpen,
    query: input ? input.value : null, focusInput: a === input,
    focus: a ? (a.getAttribute('data-osc') || a.id || a.tagName) : null,
    entries: opts.map((o) => o.dataset.entry), active,
    activeEntry: (opts.find((o) => o.id === active) || {}).dataset?.entry || null,
    heights: opts.slice(0, 12).map((o) => o.getBoundingClientRect().height),
    workspace: window.OSCILLA.app.workspace, role: input && input.getAttribute('role'),
    status: (document.getElementById('palette-status') || {}).textContent || '' };
}
const read = (page) => page.evaluate(readPalette);

/** Poll `read` until `ok`; the last value read, with timedOut when the deadline passed. */
async function settle(page, ok, what, { ms = UI_MS, fn = readPalette } = {}) {
  let last = null;
  try {
    await until(async () => { last = await page.evaluate(fn); return ok(last); },
      { ms, what: `palette: ${what}` });
    return last;
  } catch (e) {
    if (!(e instanceof WaitTimeout)) throw e;
    return { ...last, timedOut: true, what };
  }
}

async function openPage(browser, name, size, hash = '#m=playground') {
  const phone = size === 'phone';
  return op.openApp(browser, { dist: DIST, hash, viewport: SIZES[size],
    contextOptions: phone ? { hasTouch: true, ...(name === 'firefox' ? {} : { isMobile: true }) }
      : {} });
}

/** Open with Ctrl+K from a neutral spot (the page title), the palette's input focused. */
async function openByKey(page, chord = 'Control+KeyK') {
  await page.keyboard.press(chord);
  return settle(page, (s) => s.open && s.app && s.focusInput && s.focus === 'palette.input',
    `${chord} opens the palette`);
}

const CHECKS = [];
const def = (id, fn, { sizes = Object.keys(SIZES), hash } = {}) => {
  for (const size of sizes) CHECKS.push({ id: `${id}@${size}`, size, fn, hash });
};
/** The microphone panel's tab, as the shell holds it and as its tab shows it. Runs in the page. */
function micTab() {
  const t = document.querySelector('[data-osc="mic.tab"][data-value="compare"]');
  return { tab: window.OSCILLA.app.tabs.mic, workspace: window.OSCILLA.app.workspace,
    selected: t ? t.getAttribute('aria-selected') : null };
}

def('ctrl-k', async ({ page }) => {
  const from = [];
  for (const ws of WORKSPACE_IDS) {
    await page.evaluate((w) => window.OSCILLA.app.setWorkspace(w), ws);
    await settle(page, (s) => s.workspace === ws, `workspace ${ws}`);
    await page.evaluate(() => {
      const t = document.querySelector('[data-osc="page.title"]');
      if (t) { t.setAttribute('tabindex', '-1'); t.focus(); }
    });
    const opened = await openByKey(page, ws === 'studio' ? 'Meta+KeyK' : 'Control+KeyK');
    await page.keyboard.press('Escape');
    const closed = await settle(page, (s) => !s.open && !s.app && s.focus === 'page.title',
      `Escape closes it in ${ws} and focus returns to the page title`);
    from.push({ ws, opened: !opened.timedOut, closed: !closed.timedOut, focus: closed.focus,
      ...(opened.timedOut ? { read: { open: opened.open, app: opened.app, focus: opened.focus } }
        : {}) });
  }
  // From a focused text field (a pattern or lab field holds text focus): Ctrl+K still opens.
  await page.evaluate(() => window.OSCILLA.app.setWorkspace('filter'));
  await settle(page, (s) => s.workspace === 'filter', 'workspace filter');
  const field = await page.evaluate(() => {
    const el = [...document.querySelectorAll('input[type="text"], input[type="number"]')]
      .find((x) => x.getClientRects().length && !x.closest('dialog'));
    if (el) el.focus();
    return el ? (el.id || el.getAttribute('data-osc')) : null;
  });
  const fromText = await openByKey(page);
  await page.keyboard.press('Control+KeyK');
  const toggled = await settle(page, (s) => !s.open, 'Ctrl+K again closes it');
  const ok = from.every((f) => f.opened && f.closed) && !!field && !fromText.timedOut
    && !toggled.timedOut;
  return { ok, from: from.filter((f) => !f.opened || !f.closed), field,
    fromText: fromText.timedOut ? fromText : 'opened', toggled: !toggled.timedOut };
});

def('lfo', async ({ page }) => {
  await openByKey(page);
  await page.keyboard.type('lfo');
  const s = await settle(page, (x) => x.query === 'lfo' && x.entries.length > 1,
    'typing lfo lists results');
  const top = (s.entries || []).slice(0, 2).sort();
  const firstActive = s.activeEntry === (s.entries || [])[0];
  await page.keyboard.press('ArrowDown');
  const down = await settle(page, (x) => x.activeEntry === x.entries[1], 'ArrowDown moves');
  await page.keyboard.press('End');
  const end = await settle(page, (x) => x.activeEntry === x.entries[x.entries.length - 1],
    'End reaches the last row');
  await page.keyboard.press('Home');
  const home = await settle(page, (x) => x.activeEntry === x.entries[0], 'Home the first');
  const ok = top.join() === ['module:mg', 'node:lfo'].join() && firstActive && s.role === 'combobox'
    && !down.timedOut && !end.timedOut && !home.timedOut && /výsled/.test(s.status);
  return { ok, top, firstActive, status: s.status, role: s.role };
});

def('template', async ({ page }) => {
  await openByKey(page);
  await page.keyboard.type('first patch');
  const s = await settle(page, (x) => x.entries[0] === 'template:first-patch',
    'the First Patch template leads');
  await page.keyboard.press('Enter');
  const opened = await settle(page, (x) => x.workspace === 'studio' && x.templateId === 'first-patch'
    && !x.open, 'Enter opens Studio with the First Patch template', { ms: STEP_MS,
    fn: () => ({ workspace: window.OSCILLA.app.workspace,
      templateId: window.OSCILLA.studio && window.OSCILLA.studio.templateId,
      open: document.getElementById('osc-dlg-palette').open, hash: location.hash }) });
  return { ok: !s.timedOut && !opened.timedOut, opened };
});

def('settings', async ({ page }) => {
  const dialogOpen = () => ({ settings: document.getElementById('osc-dlg-settings').open,
    palette: document.getElementById('osc-dlg-palette').open,
    midi: (() => {
      const el = document.querySelector('[data-osc="midi.status"]');
      return !!el && el.getClientRects().length > 0;
    })() });
  await openByKey(page);
  await page.keyboard.type('nastavení');
  await settle(page, (x) => x.entries.includes('action:header.settings'),
    'Nastavení lists the Settings action');
  await page.click('#palette-list [data-entry="action:header.settings"]');
  const settings = await settle(page, (x) => x.settings && !x.palette,
    'the Settings action opens the Settings dialog', { fn: dialogOpen, ms: STEP_MS });
  await page.evaluate(() => document.getElementById('osc-dlg-settings').close());
  await settle(page, (x) => !x.settings, 'Settings closed', { fn: dialogOpen });
  await openByKey(page);
  await page.keyboard.type('stav midi');
  await settle(page, (x) => x.entries[0] === 'component:midi.status', 'Stav MIDI leads');
  await page.keyboard.press('Enter');
  const midi = await settle(page, (x) => x.settings && !x.palette && x.midi,
    'Stav MIDI opens Settings with the MIDI section shown', { fn: dialogOpen, ms: STEP_MS });
  return { ok: !settings.timedOut && !midi.timedOut, settings, midi };
});

def('escape-sound', async ({ page }) => {
  const sound = () => ({ playing: !!window.OSCILLA.app.playing,
    sources: window.OSCILLA.engine.activeSourceCount, status: window.OSCILLA.app.status,
    open: document.getElementById('osc-dlg-palette').open });
  await page.evaluate(() => {
    const a = window.OSCILLA.app;
    a.setContinuous(true);
    if (!a.latched) a.toggleLatch();
  });
  const playing = await settle(page, (x) => x.playing && x.sources > 0 && x.status === 'PLAYING',
    'the latched tone plays', { fn: sound, ms: STEP_MS });
  await openByKey(page);
  await page.keyboard.press('Escape');
  const kept = await settle(page, (x) => !x.open && x.playing && x.sources > 0
    && x.status === 'PLAYING', 'Escape closes the palette and the tone sounds on', { fn: sound });
  await page.keyboard.press('Escape');
  const stopped = await settle(page, (x) => !x.playing && x.sources === 0,
    'the page\'s Escape then stops it', { fn: sound, ms: STEP_MS });
  return { ok: !playing.timedOut && !kept.timedOut && !stopped.timedOut, kept, stopped };
});

def('header-enter', async ({ page }) => {
  await page.fill('[data-osc="header.search"]', 'seq');
  await page.press('[data-osc="header.search"]', 'Enter');
  const s = await settle(page, (x) => x.open && x.query === 'seq' && x.focusInput
    && x.entries[0] === 'place:sequencer', 'Enter in the navbar search opens the palette');
  await page.keyboard.press('Enter');
  const went = await settle(page, (x) => !x.open && x.workspace === 'sequencer',
    'Enter there opens the Sequencer', { ms: STEP_MS });
  return { ok: !s.timedOut && !went.timedOut, s, went };
}, { sizes: ['desktop'] });

def('compare-link', async ({ page }) => {
  const linked = await settle(page, (x) => x.workspace === 'compare' && x.tab === 'compare',
    '#m=compare opens the microphone panel\'s Compare tab', { fn: micTab, ms: STEP_MS });
  return { ok: !linked.timedOut, linked };
}, { hash: '#m=compare' });

def('compare', async ({ page }) => {
  await openByKey(page);
  await page.keyboard.type('porovnání');
  await settle(page, (x) => x.entries[0] === 'place:compare', 'Porovnání leads');
  await page.keyboard.press('Enter');
  const run = await settle(page, (x) => x.workspace === 'compare' && x.tab === 'compare',
    'the palette\'s Porovnání opens it on the Compare tab', { fn: micTab, ms: STEP_MS });
  return { ok: !run.timedOut, run };
});

def('rows', async ({ page }) => {
  await openByKey(page);
  const s = await settle(page, (x) => x.heights.length > 5, 'the list shows rows');
  const ok = s.heights.every((h) => h >= 43.5);
  return { ok, heights: s.heights };
});

def('axe', async ({ page }) => {
  const source = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  await page.addScriptTag({ content: source });
  await openByKey(page);
  await page.keyboard.type('lfo');
  await settle(page, (x) => x.entries.length > 1, 'results to audit');
  const violations = await page.evaluate(async () => {
    const r = await window.axe.run(document.getElementById('osc-dlg-palette'),
      { resultTypes: ['violations'] });
    return r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
  return { ok: violations.length === 0, violations };
});

// ------------------------------------------------------------------------------ the link-walk
/** Every entry of the page's own index, with what the walk judges of each. Runs in the page. */
function walkPlan() {
  const a = window.OSCILLA.app;
  a.paletteShow();
  const all = a.paletteResults();
  a.paletteClose({ focus: false });
  return all.map((e) => ({ id: e.id, kind: e.kind, key: e.key, label: e.label,
    target: JSON.parse(JSON.stringify(e.target)) }));
}

/** Put the page back between two entries: dialogs and menus closed, the drawer shut. */
function walkReset() {
  const a = window.OSCILLA.app;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  if (typeof a.closeMenus === 'function') a.closeMenus();
  if (a.drawerOpen && typeof a.closeDrawer === 'function') a.closeDrawer();
  window.__u130Clicked = [];
  a.announceText = '';
  if (!window.__u130Click) {
    window.__u130Click = true;
    document.addEventListener('click', (e) => {
      const el = e.target && e.target.closest && e.target.closest('[data-osc]');
      if (el) window.__u130Clicked.push(el.getAttribute('data-osc'));
    }, true);
  }
  return true;
}

/** Run one entry through the palette, as Enter on its row does. Runs in the page. */
function walkRun(id) {
  const a = window.OSCILLA.app;
  a.paletteShow();
  const e = a.paletteEntry(id);
  return e ? a.paletteRun(e) : 'missing';
}

/** Whether entry `p` reached its target, with what was read. Runs in the page. */
function walkJudge(p) {
  const a = window.OSCILLA.app;
  const S = window.OSCILLA.studio;
  const shown = (el) => {
    const r = el && el.getClientRects().length ? el.getBoundingClientRect() : null;
    return !!r && (r.width > 0 || r.height > 0);
  };
  const open = (id) => !!(document.getElementById(id) || {}).open;
  const active = document.activeElement;
  const t = p.target;
  const pal = open('osc-dlg-palette');
  let ok = false;
  let got = { workspace: a.workspace };
  switch (p.kind) {
    case 'place': ok = a.workspace === p.key; break;
    case 'template':
      got = { ...got, templateId: S && S.templateId };
      ok = a.workspace === 'studio' && S && S.templateId === p.key; break;
    case 'record': ok = a.workspace === 'experiments'; break;
    case 'tab': got.tab = a.synth && a.synth.tab;
      // the Synth link's tab
      ok = a.workspace === 'synth' && got.tab === p.key; break;
    case 'module': {
      const card = document.querySelector(`[data-module="${p.key}"]`);
      got = { ...got, tab: a.synth && a.synth.tab, inCard: !!card && card.contains(active) };
      ok = a.workspace === 'synth' && got.tab === t.tab && got.inCard; break;
    }
    case 'synth-preset': got.preset = a.synth && a.synth.preset;
      ok = a.workspace === 'synth' && got.preset === p.key; break;
    case 'preset': got = { ...got, loaded: a.loadedLabel, pending: a.pendingPreset && a.pendingPreset.id,
      headphones: open('osc-dlg-headphones') };
      ok = a.workspace === 'presets' && (got.loaded === p.label
        || (got.pending === p.key && got.headphones)
        || (typeof a.presetDisabled === 'function'
          && a.presetDisabled(window.OSCILLA.BUILTIN_PRESETS.find((x) => x.id === p.key))));
      break;
    case 'riff': {
      const search = document.querySelector('[data-osc="library.search"]');
      const sel = document.querySelector('[data-osc="library.list"] [aria-selected="true"]');
      got = { lib: open('osc-dlg-studio-library'), query: search && search.value,
        selected: sel && sel.textContent };
      ok = got.lib && got.query === t.query && !!got.selected && got.selected.includes(t.query);
      break;
    }
    case 'learn': {
      const card = document.querySelector(`[data-topic="${p.key}"]`);
      got = { ...got, topic: a.learnTopic, inCard: !!card && card.contains(active) };
      ok = a.workspace === 'learn' && got.topic === p.key && got.inCard; break;
    }
    case 'node': {
      const first = document.querySelector('[data-osc="studio.add.item"]');
      got = { ...got, add: open('osc-dlg-studio-add'), first: first && first.dataset.type };
      ok = a.workspace === 'studio' && got.add && got.first === p.key; break;
    }
    case 'action': got.clicked = window.__u130Clicked; ok = got.clicked.includes(p.key); break;
    case 'component': {
      const els = [...t.reveal, ...t.parents].flatMap((h) => [...document.querySelectorAll(
        `[data-osc=${JSON.stringify(h)}]`)]);
      const el = els.find(shown);
      const home = els[0] && els[0].closest('[data-osc-modes]');
      got = { ...got, present: els.length > 0, shown: !!el,
        // Focused, or, in a dialog its owner opened, focus inside that dialog (the patch
        // library gives its list focus when it opens, as it does for every opener).
        focused: !!el && (el === active || el.contains(active)
          || (!!el.closest('dialog') && el.closest('dialog').contains(active))),
        home: home ? home.dataset.oscModes : null, said: a.announceText || '' };
      const own = p.key.startsWith('palette');
      // Shown and focused where it stands (the palette's own parts: the palette open again);
      // or built but hidden in this state (a filter type without gain, a ceiling not acting, a
      // MIDI device list without MIDI), the page stands where it lives and says so; or not
      // built by the page in this state, the page says so and stands on the workspace its id
      // names (or stays where it was).
      ok = (got.shown && (got.focused || own))
        || (got.present && !got.shown && /není vidět/.test(got.said)
          && (!got.home || got.home.split(/\s+/).includes(a.workspace)))
        || (!got.present && (!t.fallback || a.workspace === t.fallback)
          && /tento prvek/.test(got.said));
      if (own) return { ok: ok && pal, ...got, result: 'shown', palette: pal };
      got.result = got.shown ? 'shown' : got.present ? 'hidden' : 'absent';
      break;
    }
    default: ok = false;
  }
  return { ok: ok && !pal, ...got, palette: pal };
}

def('walk', async ({ page, browser, name, size }) => {
  const plan = await page.evaluate(walkPlan);
  const kinds = {};
  const pick = plan.filter((p) => {
    kinds[p.kind] = (kinds[p.kind] || 0) + 1;
    return size === 'desktop' || kinds[p.kind] <= WALK_PHONE;
  });
  const failed = [];
  const results = { shown: 0, hidden: 0, absent: 0 };
  // Each kind on a fresh page: an entry's target is judged from the state a user reaching it
  // would be in, not from the one the previous kind left (a template replaces the Studio
  // document the Synth panel lives in).
  for (const kind of Object.keys(kinds)) {
    const ctx = await openPage(browser, name, size);
    try {
      for (const p of pick.filter((x) => x.kind === kind)) {
        await ctx.page.evaluate(walkReset);
        const did = await ctx.page.evaluate(walkRun, p.id);
        let last = null;
        try {
          await until(async () => { last = await ctx.page.evaluate(walkJudge, p); return last.ok; },
            { ms: WALK_MS, what: `palette walk: ${p.id} reaches its target` });
        } catch (e) {
          if (!(e instanceof WaitTimeout)) throw e;
          failed.push({ id: p.id, did, last });
          console.log(`   walk miss ${p.id} (${did}): ${op.clip(JSON.stringify(last), 300)}`);
        }
        if (p.kind === 'component' && last) results[last.result] += 1;
      }
      if (ctx.errors.length) failed.push({ kind, errors: ctx.errors });
    } finally { await ctx.context.close(); }
  }
  return { ok: failed.length === 0, walked: pick.length, of: plan.length, counts: kinds,
    components: results, failed: failed.slice(0, 12) };
});

async function runBrowser(name) {
  const browser = await playwright[name].launch(op.LAUNCH[name] || {});
  const failures = [];
  let checks = 0;
  try {
    for (const c of CHECKS) {
      if (ONLY && !ONLY.has(c.id) && !ONLY.has(c.id.split('@')[0])) continue;
      const t0 = Date.now();
      const ctx = await openPage(browser, name, c.size, c.hash);
      let v;
      try {
        await ctx.page.evaluate(() => {
          const t = document.querySelector('[data-osc="page.title"]');
          if (t) { t.setAttribute('tabindex', '-1'); t.focus(); }
        });
        v = await c.fn({ page: ctx.page, browser, name, size: c.size });
        if (ctx.errors.length) v = { ...v, ok: false, errors: ctx.errors };
      } catch (e) {
        v = { ok: false, error: String(e && e.stack || e).split('\n').slice(0, 4).join(' | ') };
      } finally { await ctx.context.close(); }
      checks += 1;
      RUN.tally(name);
      const line = `${v.ok ? 'PASS' : 'FAIL'} ${name}/${c.id} (${((Date.now() - t0) / 1000)
        .toFixed(1)} s)`;
      console.log(line);
      if (!v.ok || c.id.startsWith('walk')) console.log(`   ${op.clip(JSON.stringify(v), 3000)}`);
      if (!v.ok) failures.push(`${name}/${c.id}`);
    }
  } finally { await browser.close(); }
  return { checks, failures };
}

(async () => {
  await RUN.ready();
  let failed = [];
  for (const b of RUN.browsers) {
    const { failures } = await runBrowser(b);
    failed = failed.concat(failures);
  }
  console.log(failed.length ? `FAIL palette: ${failed.join(', ')}` : 'ALL PASS palette');
  process.exit(failed.length ? 1 : 0);
})();

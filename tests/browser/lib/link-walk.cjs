// The one link walker of the browser suites (K075; lane A's P07 census, UX audit links.md):
// the page helpers tests/browser/link-integrity.cjs reads routes and links with, and walkRow,
// which follows one row of the integration map (tests/browser/integration-map.json) and
// records what it saw. judgeRow turns that record into failures; it is pure, so
// tests/unit/integration-map.test.mjs holds it to mutated records (a target at another Studio
// revision, a reload that loses the target state) without a browser.
//
//   const walk = require('./lib/link-walk.cjs');
//   await context.addInitScript(walk.probe);          // count AudioContexts and getUserMedia
//   const obs = await walk.walkRow(context, base, row); // one row, every activation mode
//   const { failures, known } = walk.judgeRow(row, obs, { reloadDebt });
//
// Every wait is a condition poll through lib/wait.cjs until() with a named wall-clock deadline
// (rule project.bounded-test-timing); the suites that use it run through lib/suite.cjs.
'use strict';

const { until } = require('./wait.cjs');

const READY_MS = 30000;
const NAV_MS = 10000;
const TRAVERSE_MS = 5000;
/** The deadline a row's target state must appear within after its control is activated. */
const TARGET_MS = 10000;
/** The workspaces that show the one Studio document (its graph is their state). */
const STUDIO_HOSTS = Object.freeze(['studio', 'synth']);
const MODES = Object.freeze(['pointer', 'keyboard', 'touch']);
/** The row sources whose target takes focus (lane A's P07 census). */
const FOCUS_SOURCES = Object.freeze(['related', 'panel', 'about', 'learn', 'empty', 'home']);

/** Installed before the app loads: count what could start sound or the microphone. */
function probe() {
  window.__oscAudit = { ctx: 0, gum: 0 };
  const wrap = (name) => {
    const C = window[name];
    if (!C) return;
    window[name] = class extends C {
      constructor(...a) { super(...a); window.__oscAudit.ctx += 1; }
    };
  };
  wrap('AudioContext');
  wrap('webkitAudioContext');
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const g = md.getUserMedia.bind(md);
    md.getUserMedia = (...a) => { window.__oscAudit.gum += 1; return g(...a); };
  }
}

// ------------------------------------------------------------------------------ page helpers
const H = {
  async ready(page) {
    await page.waitForSelector('html[data-ready="true"]', { timeout: READY_MS });
    await until(() => page.evaluate(() => !!(window.OSCILLA.app && window.OSCILLA.app.studio
      && window.OSCILLA.app.studio.ready)), { ms: READY_MS, what: 'Studio ready' });
  },
  state: (page) => page.evaluate(() => {
    const a = window.OSCILLA.app;
    const el = document.activeElement;
    const cur = document.querySelector('#osc-nav [aria-current="page"]');
    const nav = document.querySelector('#osc-nav');
    return { workspace: a.workspace, hash: location.hash, href: location.href,
      current: cur ? cur.dataset.osc : null, histLen: history.length,
      navVisible: !!nav && nav.getClientRects().length > 0,
      focusHeading: !!el && /^H[1-4]$/.test(el.tagName) };
  }),
  async open(context, base, hash) {
    const page = await context.newPage();
    await page.goto(hash ? `${base}#${hash}` : base, { waitUntil: 'load', timeout: READY_MS });
    await H.ready(page);
    return page;
  },
  async at(page, workspace, what) {
    return until(async () => {
      const s = await H.state(page);
      return s.workspace === workspace ? s : null;
    }, { ms: NAV_MS, what });
  },
  /** Back / Forward and the state once the address has changed. */
  async traverse(page, dir) {
    const before = await page.evaluate(() => location.href);
    await page.evaluate((d) => (d === 'back' ? history.back() : history.forward()), dir);
    await until(() => page.evaluate((b) => location.href !== b, before),
      { ms: TRAVERSE_MS, what: `history.${dir}() changes the address` });
    // The router answers popstate synchronously; one frame lets Alpine render it.
    await page.evaluate(() => new Promise((r) => { requestAnimationFrame(() => r()); }));
    return H.state(page);
  },
  /**
   * The state once a refused or repaired link has been applied: the workspace `w`, none of
   * `gone` in the address, and the address `expect` (without '#') when one is named. The poll
   * ends on the asserted condition itself (project.bounded-test-timing). null at the deadline.
   */
  async settled(page, w, gone, expect, what) {
    return until(async () => {
      const s = await H.state(page);
      const q = new URLSearchParams(s.hash.replace(/^#/, ''));
      const ends = expect === null || (typeof expect === 'function' ? expect(q)
        : s.hash === `#${expect}`);
      return s.workspace === w && !gone.some((k) => q.has(k)) && ends ? s : null;
    }, { ms: NAV_MS, what }).catch(() => null);
  },
  /** The warnings shown now (the notice stack, core/instrument.js notify). */
  warnings: (page) => page.evaluate(() => window.OSCILLA.app.alerts
    .filter((a) => a.level === 'warning' || a.level === 'error').map((a) => a.title)),
  /** Let n animation frames pass (Alpine applies a change, the layout settles). */
  frames: (page, n = 2) => page.evaluate((k) => new Promise((r) => {
    const step = (i) => (i ? requestAnimationFrame(() => step(i - 1)) : r());
    step(k);
  }), n),
  async setWorkspace(page, w) {
    await page.evaluate((x) => window.OSCILLA.app.setWorkspace(x), w);
    return H.at(page, w, `setWorkspace(${w})`);
  },
  async navTo(page, w) {
    const item = `[data-osc="nav.${w}"]`;
    const group = await page.evaluate((s) => {
      const el = document.querySelector(s);
      const g = el && el.closest('[data-osc-nav-group]');
      return g && el.offsetParent === null ? g.dataset.oscNavGroup : null;
    }, item);
    if (group) await page.click(`[data-osc="nav-group.${group}"]`);
    await page.click(item);
    return H.at(page, w, `nav to ${w}`);
  },
  links: (page) => page.evaluate(() => [...document.querySelectorAll('a[href]')]
    .filter((a) => a.getClientRects().length > 0)
    .map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target'),
      rel: a.getAttribute('rel') || '', text: a.textContent.replace(/\s+/g, ' ').trim(),
      anchorOk: a.getAttribute('href').startsWith('#') && !a.getAttribute('href').includes('=')
        ? !!document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)))
        : null }))),
  /** The page header's rendered Related links, in order. */
  related: (page) => page.evaluate(() => [...document.querySelectorAll(
    '[data-osc="page.related"] [data-osc="page.relatedLink"]')]
    .filter((a) => a.getClientRects().length > 0).map((a) => a.getAttribute('href'))),
  /** The visible workspace links of the content (<main>) and the breadcrumb's root. */
  contentLinks: (page) => page.evaluate(() => [...document.querySelectorAll(
    'main a[href^="#m="], [data-osc="page.home"]')].filter((a) => a.getClientRects().length > 0)
    .map((a) => a.getAttribute('href'))),
  /** In-content controls (outside header and status bar) that name another workspace. */
  exits: (page) => page.evaluate(() => {
    const NAV = /setWorkspace|studioExpand|studioBack|experimentsShowInMeasure|experimentsRepeat|experimentsDefRun|runLearnDemo|connectionsFollow|findingsOpenRef|synthOpenStudio/;
    return [...document.querySelectorAll('main button, main a[href^="#m="]')]
      .filter((el) => el.getClientRects().length > 0)
      .filter((el) => el.tagName === 'A' || NAV.test(el.getAttribute('@click') || '')
        || el.dataset.osc === 'studio.compact.expand')
      .map((el) => el.dataset.osc || el.textContent.trim());
  }),
};

// ------------------------------------------------------------------------------ one row
/** What a row's target is judged on: the workspace, the address and the Studio store. */
function readState(page) {
  return page.evaluate(() => {
    const a = window.OSCILLA.app;
    const s = window.OSCILLA.studio;
    const el = document.activeElement;
    return { workspace: a.workspace, hash: location.hash,
      ready: document.documentElement.dataset.ready === 'true' && !!(a.studio && a.studio.ready),
      revision: s && s.store ? s.store.getRevision() : null,
      nodes: s && s.model ? s.model.graph.nodes.length : null,
      template: s ? s.templateId || null : null,
      synthLink: (a.synth && a.synth.link) || null,
      synthPreset: (a.synth && a.synth.preset) || null,
      audit: { ...window.__oscAudit }, voice: !!window.OSCILLA.engine.voice,
      playing: !!a.playing,
      focus: el ? (el.id || (el.dataset && el.dataset.osc) || el.tagName) : null,
      focusOk: !!el && (/^H[1-4]$/.test(el.tagName)
        || !!el.closest('[data-osc-modes], main section')) };
  });
}

const hashKeys = (hash) => new URLSearchParams(String(hash || '').replace(/^#/, ''));

/** Is the row's target state shown? (the condition the deadline is polled on) */
function targetShown(row, s, source) {
  if (!s.ready || s.workspace !== row.to) return false;
  if (row.template && s.template !== row.template) return false;
  if (row.studio === 'converted' && !(s.revision > source.revision)) return false;
  if (row.produces && row.produces.key && !hashKeys(s.hash).has(row.produces.key)) return false;
  if (row.produces && row.produces.read && !s.synthLink) return false;
  if (row.studio === 'patch' && s.synthPreset !== hashKeys(row.href).get('yp')) return false;
  return true;
}

/** The control, visible and outside the sidebar unless it is a sidebar item; marks it. */
async function findControl(page, row) {
  // A menu's item: open the menu unless it is open already (its button toggles it).
  if (row.opener && !await page.locator(row.selector).filter({ visible: true }).count()) {
    await page.locator(row.opener).filter({ visible: true }).first().click({ timeout: NAV_MS });
  }
  const found = await until(() => page.evaluate(({ sel, text }) => {
    for (const x of document.querySelectorAll('[data-osc-walk]')) x.removeAttribute('data-osc-walk');
    const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length > 0
      && (!e.closest('#osc-sidebar') || /^nav\./.test(e.dataset.osc || ''))
      && (!text || e.textContent.includes(text)));
    if (!el) return null;
    el.setAttribute('data-osc-walk', '1');
    return { marker: el.getAttribute('data-osc-link'),
      disabled: el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled'),
      name: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim() };
  }, { sel: row.selector, text: row.text || null }), { ms: NAV_MS,
    what: `${row.id}: the control ${row.selector} is shown` }).catch(() => null);
  if (!found) return null;
  // Its role in the accessibility tree: the marked element is the one getByRole finds.
  const roleCount = await page.getByRole(row.role).and(page.locator('[data-osc-walk="1"]'))
    .count();
  return { ...found, roleOk: roleCount === 1 };
}

async function activate(page, mode) {
  const loc = page.locator('[data-osc-walk="1"]');
  // script: the element's own click(), without the pointer that unlocks audio (main.js), so
  // a link is shown to start no AudioContext (lane A's P07 census).
  if (mode === 'script') await loc.evaluate((el) => el.click());
  else if (mode === 'pointer') await loc.click({ timeout: NAV_MS });
  else if (mode === 'keyboard') {
    await loc.focus();
    await page.keyboard.press('Enter');
  } else await loc.tap({ timeout: NAV_MS });
}

/** Open the row's source (its setup run), and return the source state. */
async function openSource(context, base, row) {
  const page = await context.newPage();
  if (row.viewport) await page.setViewportSize(row.viewport);
  await page.goto(`${base}#${row.setup ? row.setup.open : `m=${row.from}`}`,
    { waitUntil: 'load', timeout: READY_MS });
  await H.ready(page);
  for (const sel of (row.setup && row.setup.click) || []) {
    await page.locator(sel).filter({ visible: true }).first().click({ timeout: NAV_MS });
  }
  const source = await until(async () => {
    const s = await readState(page);
    return s.ready && s.workspace === row.from ? s : null;
  }, { ms: NAV_MS, what: `${row.id}: the source ${row.from} is shown` });
  return { page, source };
}

/** One activation: the control, then the target state within TARGET_MS. */
async function activation(page, row, mode, source) {
  const control = await findControl(page, row);
  if (!control) return { control: null };
  const t0 = Date.now();
  await activate(page, mode);
  const target = await until(async () => {
    const s = await readState(page);
    return targetShown(row, s, source) ? s : null;
  }, { ms: TARGET_MS, what: `${row.id}: target state after ${mode}` }).catch(() => null);
  return { control, target: target || await readState(page), shown: !!target,
    ms: Date.now() - t0, source };
}

/**
 * Walk one row in every mode: { modes: { pointer, keyboard, touch }, back, forward, reload }.
 * The first activation also walks Back, Forward and a reload of the target (or, for a row
 * that produces a link, the produced address opened and reloaded); keyboard and touch each
 * start from the source again (Back, or a fresh source where a setup made it).
 */
async function walkRow(context, base, row, { modes = MODES } = {}) {
  const obs = { modes: {}, back: null, forward: null, reload: null };
  let { page, source } = await openSource(context, base, row);
  try {
    for (const mode of modes) {
      if (mode !== modes[0]) {
        if (row.setup) {
          await page.close();
          ({ page, source } = await openSource(context, base, row));
        } else if (!row.produces) {
          await page.evaluate(() => history.back());
          source = await until(async () => {
            const s = await readState(page);
            return s.ready && s.workspace === row.from ? s : null;
          }, { ms: NAV_MS, what: `${row.id}: Back to ${row.from} before ${mode}` })
            .catch(() => null);
          if (!source) { obs.modes[mode] = { control: null, lost: 'source' }; continue; }
        } else {
          // A produced link is judged from an address without it, and a cleared readout.
          await page.evaluate((from) => {
            history.replaceState(history.state, '', `${location.href.split('#')[0]}#m=${from}`);
            if (window.OSCILLA.app.synth) window.OSCILLA.app.synth.link = '';
          }, row.from);
          source = await readState(page);
        }
      }
      const a = await activation(page, row, mode, source);
      obs.modes[mode] = a;
      if (mode !== modes[0] || !a.control || !a.shown) continue;
      if (!row.produces) {
        obs.back = await H.traverse(page, 'back').catch(() => null);
        if (obs.back) {
          await H.at(page, row.from, `${row.id}: Back to ${row.from}`).catch(() => null);
          obs.back = await H.state(page);
          await page.evaluate(() => history.forward());
          obs.forward = await H.at(page, row.to, `${row.id}: Forward to ${row.to}`)
            .catch(() => null);
        }
      } else if (row.produces.read) {
        // The produced link, followed in this page (a link), then reloaded (a deep link).
        const url = a.target.synthLink;
        await page.evaluate((u) => { location.href = u; }, url);
      }
      await page.reload({ waitUntil: 'load', timeout: READY_MS });
      await H.ready(page);
      obs.reload = await until(async () => {
        const s = await readState(page);
        return s.ready && s.workspace === row.to ? s : null;
      }, { ms: NAV_MS, what: `${row.id}: the target after a reload` })
        .catch(() => readState(page));
    }
  } finally {
    await page.close();
  }
  return obs;
}

// ------------------------------------------------------------------------------ the judge
/**
 * The failures of one walked row, and the known ones (a reload listed in reloadDebt that does
 * not restore the target: the row's owning issue fixes it). Pure.
 */
function judgeRow(row, obs, { reloadDebt = [] } = {}) {
  const failures = [];
  const known = [];
  const f = (m) => failures.push(`${row.id}: ${m}`);
  const [first] = Object.keys(obs.modes || {});
  for (const [mode, a] of Object.entries(obs.modes || {})) {
    if (a.lost) { f(`${mode}: the source was not shown again (${a.lost})`); continue; }
    if (!a.control) { f(`${mode}: the control ${row.selector} is not shown`); continue; }
    if (mode === first) {
      const kinds = String(a.control.marker || '').split(/\s+/);
      if (!kinds.includes(row.kind)) f(`the control is marked ${a.control.marker}, not ${row.kind}`);
      if (!a.control.roleOk) f(`the control is not a ${row.role} in the accessibility tree`);
      if (a.control.disabled || a.control.name.length < 3) {
        f(`the control is disabled or unnamed (${JSON.stringify(a.control.name)})`);
      }
    }
    const t = a.target;
    if (!a.shown) {
      f(`${mode}: the target state was not shown within ${TARGET_MS} ms (at ${t.workspace} `
        + `${t.hash}, template ${t.template})`);
      continue;
    }
    const s = a.source;
    if (row.studio === 'same' && t.revision !== s.revision) {
      f(`${mode}: the Studio store is at revision ${t.revision}, the source showed ${s.revision}`);
    }
    if (row.studio === 'voice' && !(t.revision === s.revision || t.revision === s.revision + 1)) {
      f(`${mode}: the Studio store moved from revision ${s.revision} to ${t.revision}; entering `
        + 'the Synth adds at most its voice');
    }
    if (row.studio === 'patch' && !(t.revision >= s.revision)) {
      f(`${mode}: the Studio store went back from revision ${s.revision} to ${t.revision}`);
    }
    if (t.audit && t.audit.gum) f(`${mode}: the microphone was asked for`);
    if (mode === 'script' && t.audit && t.audit.ctx) f('following the link created an AudioContext');
    if (!row.sounds && (t.voice || t.playing)) f(`${mode}: a voice sounds`);
    // Focus as lane A's P07 census judged it: a link from the page's content (the sidebar
    // keeps focus on its item; a declared control is judged by its own suite).
    if (mode === first && FOCUS_SOURCES.includes(row.source) && !row.sounds && !t.focusOk) {
      f(`focus is on ${t.focus}, not the target's heading or view`);
    }
  }
  const p = (obs.modes || {})[first];
  if (p && p.shown) {
    if (!row.produces) {
      if (!obs.back || obs.back.workspace !== row.from) {
        f(`Back went to ${obs.back && obs.back.workspace}, not ${row.from}`);
      }
      if (!obs.forward) f(`Forward did not return to ${row.to}`);
    }
    const r = obs.reload;
    const lost = [];
    if (!r || r.workspace !== row.to) lost.push(`workspace ${r && r.workspace}`);
    else {
      const want = row.produces && row.produces.read ? null : p.target.hash;
      if (want !== null && r.hash !== want) lost.push(`address ${r.hash} (was ${want})`);
      if (row.produces && row.produces.key && !hashKeys(r.hash).has(row.produces.key)) {
        lost.push(`${row.produces.key}= in the address`);
      }
      if (row.template && r.template !== row.template) lost.push(`template ${r.template}`);
      if (STUDIO_HOSTS.includes(row.to) && r.nodes !== p.target.nodes) {
        lost.push(`Studio document of ${p.target.nodes} nodes (now ${r.nodes})`);
      }
      if (r.audit && (r.audit.ctx || r.audit.gum)) lost.push('silence (audio or microphone at load)');
    }
    const debt = reloadDebt.find((d) => d.row === row.id);
    if (lost.length && debt) known.push(`${row.id}: a reload loses ${lost.join(', ')} (${debt.issue})`);
    else if (lost.length) f(`a reload loses the target state: ${lost.join(', ')}`);
    else if (debt) f(`a reload now restores the target: remove the row from reloadDebt`);
  }
  return { failures, known };
}

module.exports = { H, probe, walkRow, judgeRow, readState, targetShown, MODES, STUDIO_HOSTS,
  READY_MS, NAV_MS, TRAVERSE_MS, TARGET_MS };

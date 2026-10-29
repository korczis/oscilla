#!/usr/bin/env node
// OSCILLA link integrity on the built dist/index.html (UX audit 2026-10-29, links.md), in
// chromium, firefox and webkit, from file:// and from the Pages sub-path
// (http://127.0.0.1:<port>/oscilla/), every check on both.
//
//   node tests/browser/link-integrity.cjs [--dist dist/index.html]
//        [--browsers chromium,firefox,webkit] [--origins file,http] [--only a,b]
//
// Checks (asserted):
//   hrefs           every <a href> the page renders, in every workspace, is a known kind:
//                   `#m=<workspace id>`, an in-page anchor whose target exists, a record link
//                   (`#m=experiments&exp|def|finding=<id>`), `mailto:` or `https:`; never `#`,
//                   empty, `javascript:` or `http:`. Every target=_blank link has
//                   rel="noopener noreferrer" and says "(opens in a new tab)" to a screen reader.
//   nav-hrefs       each nav item's href is its own workspace's address (`#m=<id>`).
//   routes-load     a fresh page at each ROUTES hash opens its workspace, the nav marks it
//                   aria-current, and a reload keeps the workspace and the address.
//   routes-link     the same hash set in a live page opens the workspace and moves focus to its
//                   heading; Back returns to the Playground and Forward re-opens the workspace.
//   garbage         each GARBAGE hash, followed as a link, leaves the user in a workspace with the
//                   nav visible, raises no page error, keeps no refused key in the address and,
//                   where the row names one, ends on the canonical address (an unknown or
//                   duplicate m=, an unreadable or partly invalid instrument link: links.md B4,
//                   B5).
//   garbage-reload  the same hashes opened in a fresh page end on the same address, and a reload
//                   of that address raises no warning again (B4, B5).
//   missing-record  a link to an experiment, definition or finding not stored here opens
//                   Experiments and leaves no record key in the address (B3).
//   titles          every workspace has a document title of its own (B9), the same after a
//                   reload.
//   headings        a link to each workspace moves focus to a heading no other workspace gets
//                   (B11: Compare got the Analyzer's).
//   history-walk    the nav walk through all twelve workspaces is one entry each; Back x11 and
//                   Forward x11 visit them in order.
//   exits           every workspace shows the nav (a way onward) and at least one in-content
//                   control that leads to another workspace, except the ones in NO_EXIT_OK.
//   actions         the cross-workspace controls (ACTIONS) land where their label says.
//   no-console-errors
//
// Waits are condition polls through lib/wait.cjs with a named wall-clock deadline (rule
// project.bounded-test-timing); the run goes through lib/suite.cjs (project.suite-harness).
'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { serveDist } = require('./lib/serve.cjs');
const { until } = require('./lib/wait.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const RUN = suite.open({ name: 'link-integrity', browsers: arg('browsers'),
  origins: arg('origins'), defaultOrigins: ['file', 'http'] });
const playwright = RUN.playwright;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const want = (name) => !ONLY || ONLY.has(name);

const READY_MS = 30000;
const NAV_MS = 10000;
const TRAVERSE_MS = 5000;

const WORKSPACES = ['playground', 'measure', 'experiments', 'analyzer', 'filter', 'compare',
  'synthesis', 'sequencer', 'presets', 'learn', 'studio', 'about'];
const TEMPLATES = ['basic-tone', 'subtractive-synth', 'sweep-sequence', 'stereo-beat',
  'filter-automation', 'measurement-sweep'];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const RECIPE = b64({ v: 1, f1: 50, f2: 12000 });

// [hash, workspace]
const ROUTES = [
  ['', 'playground'],
  ...WORKSPACES.map((w) => [`m=${w}`, w]),
  ['m=sweep', 'playground'],
  ['m=dual', 'synthesis'],
  ...TEMPLATES.map((t) => [`m=studio&st=${t}`, 'studio']),
  ...['graph', 'timeline', 'inspector'].map((v) => [`m=studio&sv=${v}`, 'studio']),
  [`mr=${RECIPE}`, 'measure'],
  [`m=learn&mr=${RECIPE}`, 'learn'],
  ['m=experiments&exp=not-stored-1', 'experiments'],
  ['exp=not-stored-2', 'experiments'],
  ['v=1&f=1000', 'playground'],
];
// [hash, workspace (from the Playground or a fresh load), keys that must not stay in the
//  address, the address it must end on: a hash without '#', a predicate over its parameters, or
//  null (not judged), the warnings a fresh page at it shows: each once, no other]
const PAGE = 'Page link not applied';
const GARBAGE = [
  ['m=bogus', 'playground', [], 'm=playground', [PAGE]],
  ['m=', 'playground', [], 'm=playground', [PAGE]],
  ['m=STUDIO', 'playground', [], 'm=playground', [PAGE]],
  ['m=about&m=learn', 'playground', [], 'm=playground', [PAGE]],
  ['m=measure&m=measure', 'measure', [], 'm=measure', []],
  ['m=studio&st=nope', 'playground', ['st'], 'm=playground', ['Studio link not applied']],
  ['m=studio&sv=bogus', 'playground', ['sv'], 'm=playground', ['Studio link not applied']],
  ['st=basic-tone', 'playground', ['st'], 'm=playground', ['Studio link not applied']],
  ['mr=%%%garbage', 'playground', ['mr'], 'm=playground', ['Recipe link not applied']],
  [`mr=${b64({ v: 1, f1: 9000, f2: 100 })}`, 'playground', ['mr'], 'm=playground',
    ['Recipe link not applied']],
  ['m=experiments&exp=../../etc', 'experiments', ['exp'], 'm=experiments',
    ['Record link not applied']],
  ['v=1&x=notbase64!!', 'playground', ['v', 'x'], 'm=playground', ['Link could not be read']],
  // Partly invalid: rewritten to the values restored, never kept with the invalid ones.
  ['v=1&f=-5&g=99', 'playground', [], (q) => q.get('v') === '1' && q.get('f') !== '-5'
    && q.get('g') !== '99', ['Link partly restored']],
  ['no-such-anchor', 'playground', [], null],
  ['%E0%A4%A', 'playground', [], null],
  [`m=${'a'.repeat(5000)}`, 'playground', [], 'm=playground', [PAGE]],
];
// [name, from, selector, expected workspace]
const ACTIONS = [
  ['header About', 'playground', '[data-osc="header.about"]', 'about',
    '[data-osc="header.overflow"]'],
  ['Measure → Experiments', 'measure', '[data-osc="measure.toExperiments"]', 'experiments'],
  ['Studio Back', 'studio', '[data-osc="studio.back"]', 'playground'],
  ['compact Studio Expand', 'playground', '[data-osc="studio.compact.expand"]', 'studio'],
  ['Filter Lab open', 'playground', '#osc-filter-fullscreen', 'filter'],
  ['Learn demo', 'learn', '[data-osc="learn.demo"]', 'playground'],
];
// Workspaces whose only way onward is the nav today (links.md, "dead ends"). Shrinks only.
// `experiments` (B12, its empty lists name Measure without a link) is owned by the cross-links
// pull request (P1, branch feat/cross-links-and-honest-link-labels), which removes it here.
const NO_EXIT_OK = new Set(['analyzer', 'compare', 'synthesis', 'presets', 'about',
  'experiments']);
// Rendered links that do not yet say they open a new tab (B10: the Bioacoustics citations,
// src/js/labs/bioacoustics.js), owned by the cross-links pull request. Each is reported as
// KNOWN, never skipped silently; a listed href that is healed fails the run until it is removed
// from here, so the list only shrinks.
const NEW_TAB_HINT_DEBT = new Set([
  'https://pubmed.ncbi.nlm.nih.gov/17203911/',
  'https://www.researchgate.net/publication/220008865',
  'https://doi.org/10.1016/0378-5955(85)90100-5',
  'https://doi.org/10.1016/s0378-5955(96)00208-0',
  'https://doi.org/10.1126/science.7367876',
  'https://acousticstoday.org/wp-content/uploads/2015/11/Dolphin-Biosonar-Research.pdf',
]);
const ALLOWED_HREF = [
  /^#m=[a-z]+$/,
  /^#m=experiments&(exp|def|finding)=[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
  /^mailto:[^@\s]+@[^@\s]+$/,
  /^https:\/\/[^\s]+$/,
];

let failures = 0;
let passes = 0;
function check(leg, name, ok, detail = '') {
  RUN.tally(leg);
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} [${leg}] ${name}${!ok && detail ? ` — ${detail}` : ''}`);
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
    const cur = document.querySelector('.osc-nav [aria-current="page"]');
    const nav = document.querySelector('.osc-nav');
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
  /** In-content controls (outside header and status bar) that name another workspace. */
  exits: (page) => page.evaluate(() => {
    const NAV = /setWorkspace|studioExpand|studioBack|experimentsShowInMeasure|experimentsRepeat|experimentsDefRun|runLearnDemo|connectionsFollow|findingsOpenRef/;
    return [...document.querySelectorAll('main button, main a[href^="#m="]')]
      .filter((el) => el.getClientRects().length > 0)
      .filter((el) => el.tagName === 'A' || NAV.test(el.getAttribute('@click') || '')
        || el.dataset.osc === 'studio.compact.expand')
      .map((el) => el.dataset.osc || el.textContent.trim());
  }),
};

// ------------------------------------------------------------------------------ one leg
async function runLeg(name, origin) {
  const leg = `${name}/${origin}`;
  const server = origin === 'http' ? await serveDist(DIST, { prefix: 'oscilla-links-' }) : null;
  const base = server ? server.url : pathToFileURL(DIST).href;
  const browser = await playwright[name].launch();
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 } });
  const errors = [];
  context.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  });
  console.log(`\n${leg} (${browser.version()})`);
  try {
    if (want('hrefs') || want('nav-hrefs') || want('exits')) {
      const page = await H.open(context, base, '');
      const bad = [];
      const exitsOf = {};
      const debtSeen = new Set();
      const debtHealed = new Set();
      for (const w of WORKSPACES) {
        await H.setWorkspace(page, w);
        for (const l of await H.links(page)) {
          const known = ALLOWED_HREF.some((re) => re.test(l.href)) || l.anchorOk === true;
          const blank = l.target === '_blank';
          if (!known) bad.push(`${w}: unknown href ${JSON.stringify(l.href)} (${l.text})`);
          if (blank && !/noopener/.test(l.rel)) bad.push(`${w}: ${l.href} lacks rel=noopener`);
          const hinted = /opens in a new tab/i.test(l.text);
          if (blank && !hinted && NEW_TAB_HINT_DEBT.has(l.href)) debtSeen.add(l.href);
          else if (blank && !hinted) bad.push(`${w}: ${l.href} does not say it opens a new tab`);
          else if (NEW_TAB_HINT_DEBT.has(l.href)) debtHealed.add(l.href);
        }
        exitsOf[w] = { nav: (await H.state(page)).navVisible, exits: await H.exits(page) };
      }
      if (want('hrefs')) {
        if (debtSeen.size) {
          console.log(`  KNOWN [${leg}] ${debtSeen.size} citation link(s) lack the new-tab hint `
            + '(B10, NEW_TAB_HINT_DEBT; owned by the cross-links pull request)');
        }
        check(leg, 'every rendered href is a known kind', !bad.length, bad.join(' | '));
        check(leg, 'NEW_TAB_HINT_DEBT lists only links that still lack the hint',
          !debtHealed.size, `remove ${[...debtHealed].join(', ')} from NEW_TAB_HINT_DEBT`);
      }
      if (want('nav-hrefs')) {
        const navHrefs = await page.evaluate(() => [...document.querySelectorAll('[data-osc^="nav."]')]
          .filter((a) => a.tagName === 'A').map((a) => [a.dataset.osc.slice(4), a.getAttribute('href')]));
        const wrong = navHrefs.filter(([w, h]) => h !== `#m=${w}`);
        check(leg, 'each nav href names its own workspace',
          navHrefs.length === WORKSPACES.length && !wrong.length, JSON.stringify(wrong));
      }
      if (want('exits')) {
        const dead = WORKSPACES.filter((w) => !exitsOf[w].nav
          || (!exitsOf[w].exits.length && !NO_EXIT_OK.has(w)));
        const healed = [...NO_EXIT_OK].filter((w) => exitsOf[w].exits.length);
        check(leg, 'every workspace has a way onward', !dead.length, JSON.stringify(dead));
        check(leg, 'NO_EXIT_OK lists only workspaces that still lack an in-content exit',
          !healed.length, `remove ${healed.join(', ')} from NO_EXIT_OK`);
      }
      await page.close();
    }

    if (want('routes-load')) {
      const wrong = [];
      for (const [hash, w] of ROUTES) {
        const page = await H.open(context, base, hash);
        const s1 = await H.state(page);
        await page.reload({ waitUntil: 'load', timeout: READY_MS });
        await H.ready(page);
        const s2 = await H.state(page);
        const nav = WORKSPACES.includes(w) ? `nav.${w}` : null;
        if (s1.workspace !== w) wrong.push(`#${hash} opened ${s1.workspace}, not ${w}`);
        else if (s1.current !== nav) wrong.push(`#${hash}: aria-current on ${s1.current}`);
        if (s2.workspace !== s1.workspace || s2.hash !== s1.hash) {
          wrong.push(`#${hash}: reload ${s1.workspace} ${s1.hash} -> ${s2.workspace} ${s2.hash}`);
        }
        await page.close();
      }
      check(leg, `${ROUTES.length} routes open their workspace and survive a reload`,
        !wrong.length, wrong.join(' | '));
    }

    if (want('routes-link') || want('garbage') || want('headings')) {
      const page = await H.open(context, base, '');
      const wrong = [];
      const lists = [];
      const headingOf = {};
      if (want('routes-link') || want('headings')) lists.push(['link', ROUTES.filter(([h]) => h)]);
      if (want('garbage')) lists.push(['garbage', GARBAGE]);
      for (const [kind, list] of lists) {
        for (const [hash, w, refusedKeys = [], expect = null] of list) {
          await H.setWorkspace(page, 'playground');
          await page.evaluate((h) => { location.hash = h; }, hash);
          const s = kind === 'link' ? await H.at(page, w, `#${hash.slice(0, 40)} opens ${w}`)
            .catch(() => null) : await H.settled(page, w, refusedKeys, expect,
            `garbage #${hash.slice(0, 40)}`);
          if (!s) {
            const at = await H.state(page);
            wrong.push(`${kind} #${hash.slice(0, 40)} did not settle in ${w}: ${at.workspace} `
              + `${at.hash.slice(0, 60)}`);
            continue;
          }
          if (kind === 'link' && w !== 'playground') {
            // The heading takes focus on the next tick (app.js focusWorkspaceHeading).
            const f = await until(async () => {
              const st = await H.state(page);
              return st.focusHeading ? st : null;
            }, { ms: NAV_MS, what: `#${hash.slice(0, 40)} focuses the ${w} heading` })
              .catch(() => null);
            if (f && WORKSPACES.includes(w) && hash === `m=${w}`) {
              headingOf[w] = await page.evaluate(() => document.activeElement.id
                || document.activeElement.textContent.trim());
            }
            if (!f) {
              const at = await page.evaluate(() => {
                const el = document.activeElement;
                return el ? `${el.tagName}${el.id ? `#${el.id}` : ''}${el.dataset && el.dataset.osc ? `[${el.dataset.osc}]` : ''}` : null;
              });
              wrong.push(`#${hash.slice(0, 40)}: focus on ${at}, not the ${w} heading`);
            }
          }
          if (kind === 'garbage') {
            if (!s.navVisible) wrong.push(`garbage #${hash.slice(0, 40)}: nav hidden`);
          }
          if (kind === 'link' && w !== 'playground') {
            const back = await H.traverse(page, 'back');
            if (back.workspace !== 'playground') wrong.push(`#${hash}: Back -> ${back.workspace}`);
            const fwd = await H.traverse(page, 'forward');
            if (fwd.workspace !== w) wrong.push(`#${hash}: Forward -> ${fwd.workspace}`);
          }
        }
      }
      if (want('headings')) {
        const ids = WORKSPACES.filter((w) => w !== 'playground').map((w) => [w, headingOf[w]]);
        const twice = ids.filter(([w, h]) => !h || ids.some(([x, g]) => x !== w && g === h));
        check(leg, 'a link to each workspace focuses a heading of its own', !twice.length,
          JSON.stringify(twice));
      }
      if (want('routes-link')) {
        check(leg, 'routes as links open, focus the heading, and walk Back / Forward',
          !wrong.some((x) => !x.startsWith('garbage')), wrong.filter((x) => !x.startsWith('garbage')).join(' | '));
      }
      if (want('garbage')) {
        check(leg, `${GARBAGE.length} garbage hashes fail gracefully`,
          !wrong.some((x) => x.startsWith('garbage')), wrong.filter((x) => x.startsWith('garbage')).join(' | '));
      }
      await page.close();
    }

    if (want('garbage-reload')) {
      // A fresh page at each judged GARBAGE hash says what it refused or repaired, each warning
      // once (an unknown or conflicting m= gets "Page link not applied", a repeated one none),
      // ends on the same address as the link did, and a reload of it raises no warning: a
      // notice the user has seen is not repeated (B4, B5).
      const wrong = [];
      for (const [hash, w, gone, expect, warns] of GARBAGE.filter((g) => g[3] !== null)) {
        const page = await H.open(context, base, hash);
        const what = `fresh #${hash.slice(0, 40)}`;
        const s = await H.settled(page, w, gone, expect, what);
        if (!s) {
          const at = await H.state(page);
          wrong.push(`${what} ended on ${at.workspace} ${at.hash.slice(0, 60)}`);
        } else {
          // The address is rewritten after the refusing domain has notified, so the settled
          // address is the condition the warnings are read at.
          const first = (await H.warnings(page)).sort();
          if (JSON.stringify(first) !== JSON.stringify([...warns].sort())) {
            wrong.push(`${what}: warned ${JSON.stringify(first)}, not ${JSON.stringify(warns)}`);
          }
          await page.reload({ waitUntil: 'load', timeout: READY_MS });
          await H.ready(page);
          const again = await H.state(page);
          const warned = await H.warnings(page);
          if (again.hash !== s.hash) wrong.push(`${what}: reload ${s.hash} -> ${again.hash}`);
          if (warned.length) wrong.push(`${what}: reload warns again (${warned.join(', ')})`);
        }
        await page.close();
      }
      check(leg, 'a refused or repaired address survives a reload without a second warning',
        !wrong.length, wrong.join(' | '));
    }

    if (want('titles')) {
      // Each workspace names itself in the document title (B9), switched to and reloaded.
      const page = await H.open(context, base, '');
      const titleOf = {};
      for (const w of WORKSPACES) {
        await H.setWorkspace(page, w);
        titleOf[w] = await page.evaluate(() => document.title);
      }
      const shared = WORKSPACES.filter((w) => WORKSPACES.some((x) => x !== w
        && titleOf[x] === titleOf[w]));
      await page.close();
      const reloaded = await H.open(context, base, 'm=filter');
      const filterTitle = await reloaded.evaluate(() => document.title);
      await reloaded.close();
      check(leg, 'every workspace has a document title of its own',
        !shared.length && filterTitle === titleOf.filter && /Filter Lab/.test(filterTitle),
        JSON.stringify({ shared: shared.map((w) => [w, titleOf[w]]), filterTitle }));
    }

    if (want('missing-record')) {
      // A link to a record this browser does not store opens Experiments with a notice; the
      // address must not keep the record key, or every reload repeats the notice (it is
      // rewritten at load and for exp=, not for def= / finding= as a link: links.md B3).
      const page = await H.open(context, base, '');
      const kept = [];
      for (const key of ['exp', 'def', 'finding']) {
        await H.setWorkspace(page, 'playground');
        await page.evaluate((h) => { location.hash = h; }, `m=experiments&${key}=not-stored-${key}`);
        const s = await H.at(page, 'experiments', `missing ${key} link opens Experiments`);
        const q = await until(async () => {
          const h = await page.evaluate(() => location.hash);
          return new URLSearchParams(h.replace(/^#/, '')).has(key) ? null : h;
        }, { ms: NAV_MS, what: `missing ${key} link leaves the address` }).catch(() => null);
        if (!q) kept.push(`${key}: ${s.hash}`);
      }
      check(leg, 'a link to a record not stored here is not kept in the address',
        !kept.length, kept.join(' | '));
      await page.close();
    }

    if (want('history-walk')) {
      const page = await H.open(context, base, '');
      const h0 = (await H.state(page)).histLen;
      for (const w of WORKSPACES.slice(1)) await H.navTo(page, w);
      const h1 = (await H.state(page)).histLen;
      const back = [];
      for (let i = 0; i < WORKSPACES.length - 1; i += 1) back.push((await H.traverse(page, 'back')).workspace);
      const fwd = [];
      for (let i = 0; i < WORKSPACES.length - 1; i += 1) fwd.push((await H.traverse(page, 'forward')).workspace);
      check(leg, 'one history entry per workspace switch', h1 - h0 === WORKSPACES.length - 1,
        `${h1 - h0}`);
      check(leg, 'Back x11 and Forward x11 visit the workspaces in order',
        JSON.stringify(back) === JSON.stringify(WORKSPACES.slice(0, -1).reverse())
        && JSON.stringify(fwd) === JSON.stringify(WORKSPACES.slice(1)),
        JSON.stringify({ back, fwd }));
      await page.close();
    }

    if (want('actions')) {
      const page = await H.open(context, base, '');
      const wrong = [];
      for (const [label, from, selector, to, opener] of ACTIONS) {
        await H.setWorkspace(page, from);
        if (opener) await page.click(opener);
        await page.click(selector, { timeout: NAV_MS });
        const s = await H.at(page, to, `${label} opens ${to}`).catch(() => null);
        if (!s) wrong.push(`${label}: did not open ${to}`);
      }
      check(leg, `${ACTIONS.length} cross-workspace controls land where they say`,
        !wrong.length, wrong.join(' | '));
      await page.close();
    }

    check(leg, 'no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  } catch (err) {
    check(leg, 'run completed', false, err && err.stack);
  } finally {
    await browser.close();
    if (server) server.close();
  }
}

(async () => {
  await RUN.ready();
  for (const b of RUN.browsers) {
    for (const o of RUN.origins) await runLeg(b, o);
  }
  console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL PASS'} (${passes} checks passed)`);
  process.exit(failures ? 1 : 0);
})();

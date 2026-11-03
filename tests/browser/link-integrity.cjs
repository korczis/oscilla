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
//   history-walk    the nav walk through every workspace is one entry each; Back and Forward,
//                   once per step, visit them in order.
//   exits           every workspace has a way onward derived from the registry (lane A wave 3,
//                   src/js/ui/shell.js WORKSPACE_REGISTRY related): the page header renders
//                   exactly its related pages, at least one, each an address routeOfHash sends
//                   to that workspace; and every workspace shows the nav and at least one
//                   in-content control that leads to another workspace, except the ones in
//                   NO_EXIT_OK.
//   actions         the cross-workspace controls (ACTIONS) land where their label says: the
//                   header About, Measure → Experiments, the compact Studio and its Back, the
//                   Filter Lab back, a Learn demo, every link of About's workspace list and
//                   every Synth link of Filter Lab, Synthesis, the Sequencer and Presets.
//   related-census  P07 (lane A wave 3): every route of the registry's related pages and of
//                   the panel and content links (counterparts.js PANEL_LINKS, CONTENT_LINKS),
//                   from each workspace that shows it, walked as its rows of the integration map
//                   (K075, tests/browser/integration-map.json) by the one walker
//                   (lib/link-walk.cjs walkRow, judgeRow): the visible link is enabled and named,
//                   activating it opens an initialized target (the workspace, ready; a Studio
//                   template applied) with focus on its heading or inside its view, Back
//                   returns to the source and Forward to the target, and a fresh page at the
//                   address (a deep link) opens the target too; no AudioContext is created and
//                   no getUserMedia called (the link is activated by script, without the pointer
//                   that unlocks audio, main.js), and no voice sounds. Keyboard activation (Enter
//                   on the first strip link) opens its target without sound or microphone.
//   journey-18      (pack G 18) every Learn concept's tool link opens its working workspace,
//                   initialized, with no AudioContext created, no getUserMedia and no voice;
//                   one link per topic of cross-links.js LEARN_TOOLS, none dead.
//   journey-19      (pack G 19) About's version is package.json's (the build's BUILD.label) and
//                   its "What comes next" lists src/data/roadmap.json's milestones in order with
//                   their done and required counts.
//   journey-20      (pack G 20) on lane A's pages (Filter Lab, Synthesis, Sequencer, Presets,
//                   Learn, About) and the shell, at 1536x1024 and 390x844, in their states (every
//                   Presets category, an export running), every shown disabled control states a
//                   visible reason (aria-describedby to shown text, or a shown [data-osc-reason]
//                   inside it) and sits beside an enabled way onward (a shown link or button in
//                   its row or menu).
//   no-console-errors
//
// Waits are condition polls through lib/wait.cjs with a named wall-clock deadline (rule
// project.bounded-test-timing); the run goes through lib/suite.cjs (project.suite-harness).
'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const fs = require('node:fs');
const { serveDist } = require('./lib/serve.cjs');
const { until } = require('./lib/wait.cjs');
// The one walker (K075): the page helpers, the audio probe, and walkRow / judgeRow, which the
// integration map's suite drives over every row of tests/browser/integration-map.json.
const walk = require('./lib/link-walk.cjs');

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

const { READY_MS, NAV_MS, H } = walk;
const MAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'integration-map.json'), 'utf8'));

// The workspaces and the Studio templates are read from their sources at start (loadModel):
// ui/app.js WORKSPACES (Synth after Studio, Q019) and studio/templates STUDIO_TEMPLATES (#287
// added the demo song), so a list written here cannot go stale.
const WORKSPACES = [];
const TEMPLATES = [];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const RECIPE = b64({ v: 1, f1: 50, f2: 12000 });

// [hash, workspace]; filled by loadModel once WORKSPACES and TEMPLATES are known.
const ROUTES = [];
// Opening Synth instantiates its voice into the one Studio document (#329), which then holds
// unsaved changes, so a later Studio template link meets the unsaved-work question first; its
// route is walked last, after the template links.
const routesOf = () => [
  ['', 'playground'],
  ...WORKSPACES.filter((w) => w !== 'synth').map((w) => [`m=${w}`, w]),
  ['m=sweep', 'playground'],
  ['m=dual', 'synthesis'],
  ...TEMPLATES.map((t) => [`m=studio&st=${t}`, 'studio']),
  ...['graph', 'timeline', 'inspector'].map((v) => [`m=studio&sv=${v}`, 'studio']),
  [`mr=${RECIPE}`, 'measure'],
  [`m=learn&mr=${RECIPE}`, 'learn'],
  ['m=experiments&exp=not-stored-1', 'experiments'],
  ['exp=not-stored-2', 'experiments'],
  ['v=1&f=1000', 'playground'],
  ...WORKSPACES.filter((w) => w === 'synth').map((w) => [`m=${w}`, w]),
];

async function loadModel() {
  const src = (...p) => pathToFileURL(path.join(__dirname, '..', '..', 'src', 'js', ...p)).href;
  WORKSPACES.push(...(await import(src('ui', 'app.js'))).WORKSPACES);
  TEMPLATES.push(...(await import(src('studio', 'templates', 'index.js'))).STUDIO_TEMPLATES
    .map((t) => t.id));
  ROUTES.push(...routesOf());
  ACTIONS.push(...WORKSPACES.filter((w) => w !== 'about').map((w) => [`About list → ${w}`,
    'about', `[data-osc="about.open.${w}"]`, w]));
  // The registry's related pages: each address must route to its workspace (the app's own
  // routeOfHash), and each Related link of the page header is a cross-workspace control.
  // The strip shows the related pages the content does not already link to (cross-links.js
  // pageRelatedOf); every related page is shown once, in the strip or in the content.
  const { WORKSPACE_REGISTRY, relatedHref } = await import(src('ui', 'shell.js'));
  const { pageRelatedOf } = await import(src('ui', 'cross-links.js'));
  const { routeOfHash } = await import(src('ui', 'navigation.js'));
  for (const w of WORKSPACE_REGISTRY) {
    const hrefs = (w.related || []).map(relatedHref);
    REGISTRY_RELATED[w.id] = hrefs;
    RELATED[w.id] = pageRelatedOf(w.id).map(relatedHref);
    for (const [i, r] of (w.related || []).entries()) {
      const route = routeOfHash(hrefs[i]);
      if (!route || route.workspace !== r.id || route.badRoute) {
        RELATED_BAD.push(`${w.id}: ${hrefs[i]} routes to ${route && route.workspace}`);
      }
      // A Studio template address opens its template dialog in the Studio (the cross-links
      // suite follows those); a workspace address in the strip is clicked here.
      if (!r.hash && RELATED[w.id].includes(hrefs[i])) {
        ACTIONS.push([`${w.id} Related → ${r.id}`, w.id,
          `[data-osc="page.relatedLink"][href="${hrefs[i]}"]`, r.id]);
      }
    }
  }
  const { COUNTERPARTS, PANEL_LINKS, CONTENT_LINKS } = await import(src('ui', 'counterparts.js'));
  JOURNEY.learnTools = (await import(src('ui', 'cross-links.js'))).LEARN_TOOLS;
  JOURNEY.version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  JOURNEY.roadmap = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'roadmap.json'),
    'utf8')).milestones.map((m) => [m.id, `${m.done} of ${m.required} done`]);
  {
    const rows = new Map();
    const add = (from, ref) => {
      const href = `#m=${ref}`;
      const route = routeOfHash(href);
      const tpl = /&st=([a-z0-9-]+)/.exec(ref);
      rows.set(`${from} ${href}`, [from, href, route && route.workspace, tpl ? tpl[1] : null]);
    };
    for (const w of WORKSPACE_REGISTRY) {
      for (const r of w.related || []) add(w.id, relatedHref(r).slice(3));
    }
    for (const l of [...PANEL_LINKS, ...CONTENT_LINKS]) for (const f of l.from) add(f, l.to);
    CENSUS.push(...rows.values());
  }
  for (const c of COUNTERPARTS.filter((x) => x.osc)) {
    for (const w of c.from) {
      ACTIONS.push([`${w} → ${c.workspace}`, w, `[data-osc="${c.osc[w]}"]`, c.workspace]);
    }
  }
  // A Studio template's deep link (#294, #278: "Open ... in Studio"), any shipped template.
  ALLOWED_HREF.push(new RegExp(`^#m=studio&st=(${TEMPLATES.join('|')})$`));
}
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
// P07 census rows, [from, href, target workspace, template or null], read at start.
const CENSUS = [];
// Pack G journeys: the Learn tools (cross-links.js LEARN_TOOLS), the package version and the
// committed roadmap, read at start.
const JOURNEY = { learnTools: {}, version: null, roadmap: [] };
// The registry's related addresses per workspace, and the ones that do not route there.
const RELATED = {};
const REGISTRY_RELATED = {};
const RELATED_BAD = [];
// [name, from, selector, expected workspace]
const ACTIONS = [
  ['header About', 'playground', '[data-osc="header.about"]', 'about',
    '[data-osc="header.overflow"]'],
  ['Measure → Experiments', 'measure', '[data-osc="measure.toExperiments"]', 'experiments'],
  // Studio Back returns to the workspace Studio was opened from (studio.backTo): opened by the
  // compact Studio's Expand on the Playground, it returns there.
  ['compact Studio Expand', 'playground', '[data-osc="studio.compact.expand"]', 'studio'],
  ['Studio Back', 'studio', '[data-osc="studio.back"]', 'playground'],
  // The lighter Playground (#278) leaves the Filter Lab to its workspace, where the same
  // control is named "Back to the Playground" (#294 U010).
  ['Filter Lab back', 'filter', '#osc-filter-fullscreen', 'playground'],
  ['Learn demo', 'learn', '[data-osc="learn.demo"]', 'playground'],
  // A1 connect, appended by loadModel from their sources: every workspace link of About's list
  // (ui/app.js WORKSPACES) and every counterpart link written in a workspace's own panel
  // (ui/counterparts.js COUNTERPARTS: Filter Lab, Synthesis, the Sequencer and Presets to the
  // Synth).
];
// Workspaces whose only way onward is the nav today (links.md, "dead ends"). Shrinks only.
// The cross-links pull request (#294) and #273 gave Analyzer, Compare, Synthesis and
// Experiments (B12, its empty lists now link to Measure) an in-content exit; A1 connect gave
// Presets its Synth link and About its workspace list, each entry a link.
const NO_EXIT_OK = new Set([]);
// Rendered links that do not yet say they open a new tab (B10: the Bioacoustics citations,
// src/js/labs/bioacoustics.js), owned by the cross-links pull request. Each is reported as
// KNOWN, never skipped silently; a listed href that is healed fails the run until it is removed
// from here, so the list only shrinks.
// Empty since the cross-links pull request (#294) gave the citations their hint.
const NEW_TAB_HINT_DEBT = new Set([]);
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
  await context.addInitScript(walk.probe);

  try {
    if (want('hrefs') || want('nav-hrefs') || want('exits')) {
      const page = await H.open(context, base, '');
      const bad = [];
      const exitsOf = {};
      const debtSeen = new Set();
      const debtHealed = new Set();
      for (const w of WORKSPACES) {
        await H.setWorkspace(page, w);
        if (w === 'experiments') {
          // Its empty lists lead to Measure (#294, B12) once the stored records have loaded.
          // Loaded, and the view shows it: rows, or the empty list's Measure link.
          await until(() => page.evaluate(() => {
            const e = window.OSCILLA.app.exps;
            const link = document.querySelector('[data-osc="exp.toMeasure"]');
            return !!e.loaded && (e.rows.length > 0 || !!(link && link.getClientRects().length));
          }), { ms: NAV_MS, what: 'exits: the Experiments lists load and are shown' });
        }
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
        exitsOf[w] = { nav: (await H.state(page)).navVisible, exits: await H.exits(page),
          related: await until(async () => {
            const r = await H.related(page);
            return JSON.stringify(r) === JSON.stringify(RELATED[w]) ? r : null;
          }, { ms: NAV_MS, what: `exits: ${w}'s Related strip is rendered` })
            .catch(() => H.related(page)),
          content: await H.contentLinks(page) };
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
        const unrelated = WORKSPACES.filter((w) => !(REGISTRY_RELATED[w] || []).length
          || JSON.stringify(exitsOf[w].related) !== JSON.stringify(RELATED[w])
          || REGISTRY_RELATED[w].some((h) => !exitsOf[w].related.includes(h)
            && !exitsOf[w].content.includes(h))
          || exitsOf[w].related.some((h) => exitsOf[w].content.includes(h)))
          .map((w) => `${w}: strip ${JSON.stringify(exitsOf[w].related)} (want `
            + `${JSON.stringify(RELATED[w] || [])}), content ${JSON.stringify(exitsOf[w].content)}`
            + `, registry ${JSON.stringify(REGISTRY_RELATED[w] || [])}`);
        check(leg, 'every workspace shows each related page once, in its strip or its content',
          !unrelated.length && !RELATED_BAD.length, [...unrelated, ...RELATED_BAD].join(' | '));
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
          // The last link's heading keeps focus (the Sequencer's is shown in the Playground too),
          // so only a heading the link itself focuses may satisfy the focus poll below.
          await page.evaluate((h) => { document.activeElement?.blur(); location.hash = h; }, hash);
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
      check(leg, `Back x${WORKSPACES.length - 1} and Forward x${WORKSPACES.length - 1} visit the `
        + 'workspaces in order',
        JSON.stringify(back) === JSON.stringify(WORKSPACES.slice(0, -1).reverse())
        && JSON.stringify(fwd) === JSON.stringify(WORKSPACES.slice(1)),
        JSON.stringify({ back, fwd }));
      await page.close();
    }

    if (want('related-census')) {
      const bad = [];
      const read = (page) => page.evaluate(() => {
        const a = window.OSCILLA.app;
        const el = document.activeElement;
        return { workspace: a.workspace, ready: document.documentElement.dataset.ready,
          studio: !!(a.studio && a.studio.ready), audit: window.__oscAudit,
          voice: !!window.OSCILLA.engine.voice, playing: !!a.playing,
          focus: el ? (el.id || el.dataset.osc || el.tagName) : null,
          focusOk: !!el && (/^H[1-4]$/.test(el.tagName)
            || !!el.closest('[data-osc-modes], main section')) };
      });
      // Each census route is a row of the integration map (K075), walked by the one walker
      // (lib/link-walk.cjs walkRow) with the element's own click(): the control shown, enabled
      // and named, its target initialized and focused, Back and Forward, a reload of the
      // address (a deep link) at the same target state with no AudioContext or microphone at
      // load, and no AudioContext, microphone or voice from the click. The integration map's
      // suite walks the same rows by pointer, keyboard and touch.
      let walked = 0;
      for (const [from, href] of CENSUS) {
        // The rows a fresh page at the source shows: a row whose source needs a setup, a menu
        // or a phone width is the integration map suite's (its setup is a pointer gesture,
        // which unlocks audio before the link is followed).
        const rows = [...MAP.rows, ...MAP.declared].filter((r) => r.from === from
          && r.href === href && !r.walk && !r.setup && !r.opener && !r.viewport);
        if (!rows.length) { bad.push(`${from} ${href}: no row of the integration map`); continue; }
        for (const row of rows) {
          const obs = await walk.walkRow(context, base, row, { modes: ['script'] })
            .catch((e) => ({ modes: { script: { control: null } }, error: e.message }));
          const judged = walk.judgeRow(row, obs, { reloadDebt: MAP.reloadDebt });
          for (const k of judged.known) console.log(`  KNOWN [${leg}] ${k}`);
          bad.push(...judged.failures, ...(obs.error ? [`${row.id}: ${obs.error}`] : []));
          walked += 1;
        }
      }
      // Keyboard: Enter on the first strip link of the Playground.
      {
        const page = await H.open(context, base, 'm=playground');
        const first = page.locator('[data-osc="page.relatedLink"]').first();
        const to = (await first.getAttribute('data-to'));
        await first.focus();
        await page.keyboard.press('Enter');
        const r = await H.at(page, to, `census: Enter opens ${to}`).catch(() => null);
        const after = await read(page);
        if (!r || after.audit.gum || after.voice || after.playing) {
          bad.push(`keyboard Enter on ${to}: ${JSON.stringify(after)}`);
        }
        await page.close();
      }
      check(leg, `related-census: ${CENSUS.length} related and panel routes (${walked} rows of `
        + 'the integration map) open an initialized target, focused, with Back and Forward, as '
        + 'deep links too, and start no sound or microphone',
      !bad.length, bad.slice(0, 8).join(' | '));
    }

    if (want('journey-18')) {
      const bad = [];
      const page0 = await H.open(context, base, 'm=learn');
      const links = await page0.evaluate(() => [...document.querySelectorAll(
        '[data-osc="learn.tool"]')].filter((a) => a.getClientRects().length > 0)
        .map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim() })));
      await page0.close();
      const want18 = Object.keys(JOURNEY.learnTools).length;
      if (links.length !== want18) {
        bad.push(`${links.length} tool links, LEARN_TOOLS has ${want18}`);
      }
      for (const [i, l] of links.entries()) {
        const to = l.href.replace('#m=', '');
        const page = await H.open(context, base, 'm=learn');
        await page.evaluate((k) => document.querySelectorAll('[data-osc="learn.tool"]')[k]
          .click(), i);
        const r = await until(async () => {
          const v = await page.evaluate(() => ({ ws: window.OSCILLA.app.workspace,
            ready: document.documentElement.dataset.ready, audit: window.__oscAudit,
            voice: !!window.OSCILLA.engine.voice, playing: !!window.OSCILLA.app.playing }));
          return v.ws === to && v.ready === 'true' ? v : null;
        }, { ms: NAV_MS, what: `journey-18: ${l.text}` }).catch(() => null);
        if (!r) bad.push(`${l.text} (${l.href}) is dead`);
        else if ((r.audit && (r.audit.ctx || r.audit.gum)) || r.voice || r.playing) {
          bad.push(`${l.text}: sound or microphone ${JSON.stringify(r)}`);
        }
        await page.close();
      }
      check(leg, `journey-18: ${links.length} Learn tool links open their working workspace, `
        + 'none dead, no sound or microphone', !bad.length, bad.slice(0, 6).join(' | '));
    }

    if (want('journey-19')) {
      const page = await H.open(context, base, 'm=about');
      const r = await until(() => page.evaluate(() => {
        const v = document.querySelector('[data-osc="about.version"]');
        const ms = [...document.querySelectorAll('[data-osc="about.next.milestone"]')]
          .map((li) => [li.dataset.milestone, li.querySelector('b').textContent.trim()]);
        const version = v && v.textContent.trim();
        return version && ms.length ? { version, ms } : null;
      }), { ms: NAV_MS, what: 'journey-19: About rendered' }).catch(() => null);
      await page.close();
      const ok = !!r && r.version.includes(JOURNEY.version)
        && JSON.stringify(r.ms) === JSON.stringify(JOURNEY.roadmap);
      check(leg, `journey-19: About shows version ${JOURNEY.version} (package.json) and the `
        + `${JOURNEY.roadmap.length} milestones of src/data/roadmap.json`, ok, JSON.stringify(r));
    }

    if (want('journey-20')) {
      const bad = [];
      let seen = 0;
      const audit = (page, where) => page.evaluate((w) => {
        const shown = (el) => !!el && el.getClientRects().length > 0
          && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]');
        const ws = window.OSCILLA.app.workspace;
        const inScope = (el) => !el.closest('main') || !!el.closest(
          `[data-osc-modes~="${ws}"]:not(.osc-p-source):not(.osc-p-analysis)`);
        const out = [];
        for (const el of document.querySelectorAll('button, input, select, textarea, [role]')) {
          if (!(el.disabled || el.getAttribute('aria-disabled') === 'true')) continue;
          if (!shown(el) || !inScope(el)) continue;
          const by = el.getAttribute('aria-describedby');
          const desc = by && document.getElementById(by);
          const reason = (shown(desc) && desc.textContent.trim().length >= 8)
            || [...el.querySelectorAll('[data-osc-reason]')].some(shown);
          const row = el.closest('li, [role="menu"], .osc-sb-actions, .osc-panel-header, form')
            || el.parentElement;
          const alt = [...row.querySelectorAll('a[href], button')].some((x) => x !== el
            && shown(x) && !x.disabled && x.getAttribute('aria-disabled') !== 'true');
          out.push({ where: w, osc: el.dataset.osc || el.id, reason, alt });
        }
        return out;
      }, where);
      for (const vp of [{ width: 1536, height: 1024 }, { width: 390, height: 844 }]) {
        const page = await H.open(context, base, '');
        await page.setViewportSize(vp);
        const results = [];
        for (const w of ['filter', 'synthesis', 'sequencer', 'presets', 'learn', 'about']) {
          await H.setWorkspace(page, w);
          results.push(...await audit(page, `${w}@${vp.width}`));
          if (w === 'presets') {
            for (const c of await page.evaluate(() => window.OSCILLA.app.PRESET_CATEGORIES
              .map((x) => x.id))) {
              await page.evaluate((id) => { window.OSCILLA.app.presetTab = id; }, c);
              await H.frames(page);
              results.push(...await audit(page, `presets/${c}@${vp.width}`));
            }
          }
        }
        // The shell's export actions while an export runs.
        await page.evaluate(() => { window.OSCILLA.app.exportBusy = true; });
        if (vp.width > 600) {
          await page.click('[data-osc="header.export"]');
          await H.frames(page);
          results.push(...await audit(page, `export menu busy@${vp.width}`));
          await page.keyboard.press('Escape');
        }
        results.push(...await audit(page, `status bar busy@${vp.width}`));
        await page.evaluate(() => { window.OSCILLA.app.exportBusy = false; });
        seen += results.length;
        for (const x of results) if (!x.reason || !x.alt) bad.push(JSON.stringify(x));
        await page.close();
      }
      check(leg, `journey-20: ${seen} disabled controls on lane A's pages and the shell state a `
        + 'visible reason beside a way onward', seen > 0 && !bad.length,
      bad.slice(0, 6).join(' | '));
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
  await loadModel();
  for (const b of RUN.browsers) {
    for (const o of RUN.origins) await runLeg(b, o);
  }
  console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL PASS'} (${passes} checks passed)`);
  process.exit(failures ? 1 : 0);
})();

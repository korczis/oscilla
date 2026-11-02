#!/usr/bin/env node
// The current interface against the audit of 2026-10-28 (intent ui-current, docs/ui-audit.md).
// U005 introduced it; U003, U004, U006, U007 and U008 extend it with their workspaces.
//
// Empty area, as the audit defines it: points on a 24 px grid between the header's bottom edge
// and the status bar's top edge, each probed with elementFromPoint; a point is empty when it hits
// only the page background (html, body), main, the app root or a workspace container (the
// wrappers the focus layouts turn into display: contents, a workspace view). It measures layout,
// not whether the content is useful.
//
// Checks (dist/index.html from file://):
// - 1536x1024: at most EMPTY_LIMIT of the Analyzer and of the Compare workspace is empty
//   (A05, A07: Compare left its lower third empty);
// - 390x844: neither workspace overflows sideways, the page nor a visible panel;
// - both sizes: Analyzer and Compare show the links to their counterparts (ui/counterparts.js):
//   "RTA in Measure" (#m=measure) and "Compare saved experiments" (#m=experiments); the
//   Playground does not show them;
// - 1536x1024: a click on "RTA in Measure" opens MEASURE on its RTA tab, and a click on "Compare
//   saved experiments" opens Experiments.
// - phone-whole (the owner's criterion ui-current#phone-whole): every workspace of ui/app.js
//   WORKSPACES, opened on a fresh page at its address (#m=<id>) at 390x844 on a phone (hasTouch,
//   isMobile but in Firefox, which has no mobile emulation; a coarse pointer in all three), with
//   reduced motion (the app's own scroll lands at once) and the listening notice already
//   dismissed this session (a first-visit notice, at most 44 px on a phone):
//     share    its own work covers at least WORK_SHARE of the viewport height on the first
//              screen: the union of the visible elements that list the workspace in
//              data-osc-modes (on the Playground, the panels that list it and the measurement
//              row; elsewhere without Source & Pattern and Signal analysis, the Playground's
//              panels), gaps of up to WORK_GAP px between them bridged, clipped to the viewport;
//     covered  no interactive element is covered: scrolled to the centre of the view,
//              elementFromPoint at its centre hits it, a descendant, or its wrapping label
//              (unrendered elements, checkVisibility() false, and a centre still outside a
//              clipping ancestor are off screen, not covered);
//     font     no visible text is under FONT_MIN px: every rendered element with a text node
//              of its own and every form control, by computed font size (SVG text scaled by its
//              screen matrix; canvas text is not in the DOM and not read);
//     target   every interactive element is at least TOUCH_MIN px, or a TOUCH_MIN px square on
//              its centre lands on it (layout.cjs measureTouch's rule; range inputs: height);
//     reopen   the listening notice's reopen control ([data-osc="safety.reopen"]) is shown and
//              takes a tap at its centre: hiding a workspace's panels never hides the way back
//              to the safety notice;
//     labels   every shown Pattern Sequencer block name reads whole (its text is no wider than
//              its box): on a phone the lane draws the shortest block at least
//              TIMELINE_OPTIONS.phoneBlockPx wide and scrolls.
//   PHONE_WHOLE_DEBT lists the workspace measures still short, each with its reason; a listed
//   one is reported KNOWN, an unlisted failure fails, and a listed one that passes fails until
//   it is removed, so the list only shrinks.
//
// Every wait is a condition poll with a named wall-clock deadline (tests/browser/lib/wait.cjs);
// the poll ends on the predicate the check judges.
//
//   node tests/browser/ui-current.cjs [--browsers chromium,firefox,webkit]   (or OSC_BROWSERS)

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { until, WaitTimeout } = require('./lib/wait.cjs');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const RUN = suite.open({ name: 'ui-current', browsers: arg('browsers') });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const URL = pathToFileURL(path.resolve(__dirname, '../../dist/index.html')).href;
const DESKTOP = { width: 1536, height: 1024 };
const PHONE = { width: 390, height: 844 };
// The share of a workspace that may be empty at 1536x1024 (acceptance of U005).
const EMPTY_LIMIT = 0.25;
// The workspaces held to the limit; a later issue adds the ones it lays out.
const FILLED_WORKSPACES = ['analyzer', 'compare'];
const COUNTERPART_LINKS = [
  { osc: 'counterpart.measure-rta', href: '#m=measure' },
  { osc: 'counterpart.experiments', href: '#m=experiments' },
];
const COUNTERPART_WORKSPACES = ['analyzer', 'compare'];
const SETTLE_MS = 10000;
const READY_MS = 30000;

// ---- phone-whole (ui-current#phone-whole), see the header ----
const WORK_SHARE = 2 / 3;
const WORK_GAP = 16;
const FONT_MIN = 12;
const TOUCH_MIN = 44;
// sessionStorage key of the dismissed listening notice (src/js/core/constants.js safetySeen).
const SAFETY_SEEN = 'oscilla.safetyNoticeCollapsed';
const PHONE_MEASURES = ['share', 'covered', 'font', 'target', 'reopen', 'labels'];
// "<workspace>:<measure>" -> why it is still short and whose lane fixes it. Only shrinks.
const PHONE_WHOLE_DEBT = new Map([
  ['studio:font', 'the Studio editor\'s graph, library and timeline labels are 9-10.5 px '
    + '(studio.css, studio-timeline.css: SMALL_FONT_DEBT of tests/unit/phone-font-floor.test.mjs); '
    + 'its node and lane geometry is sized to them: the Studio lane'],
  ['synth:font', 'the Synth panel draws its bay labels in SVG at font-size 10 '
    + '(src/js/synth/view/bay.js) and labels its knobs with text-[11px] (src/js/synth/view/'
    + 'face.js: SMALL_TEXT_CLASS_DEBT of the same test): the Synth lane'],
]);
// The workspaces, read from ui/app.js at start (loadWorkspaces), so the list cannot go stale.
const WORKSPACES = [];

async function loadWorkspaces() {
  const app = pathToFileURL(path.resolve(__dirname, '../../src/js/ui/app.js')).href;
  WORKSPACES.push(...(await import(app)).WORKSPACES);
}

/**
 * In the page: the four phone-whole measures of workspace `ws` (see the header). The view's
 * scroll is read first and restored after the covered scan, so the share is the first screen.
 */
function phoneWhole({ ws, gap, touchMin }) {
  const app = document.getElementById('osc-app');
  const main = document.querySelector('.osc-main');
  const vh = window.innerHeight;
  const shown = (el) => {
    if (!el.getClientRects().length) return false;
    // A closed <details> keeps its content's boxes in some engines (content-visibility: hidden
    // on its slot): checkVisibility() says it is not rendered.
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const label = (el) => {
    const anchor = el.parentElement && el.parentElement.closest('[id]');
    return el.id || (el.dataset && el.dataset.osc)
      || `${anchor ? `${anchor.id}>` : ''}${el.tagName}${el.classList && el.classList[0]
        ? `.${el.classList[0]}` : ''}`;
  };

  // share
  const PLAYGROUND_PANELS = '.osc-p-source, .osc-p-analysis';
  const listed = [...document.querySelectorAll('[data-osc-modes]')]
    .filter((el) => el.dataset.oscModes.split(/\s+/).includes(ws));
  const own = (ws === 'playground'
    ? [...listed, document.getElementById('osc-view-measure')]
    : listed.filter((el) => !el.matches(PLAYGROUND_PANELS))).filter((el) => el && shown(el));
  const spans = own.map((el) => el.getBoundingClientRect())
    .map((r) => [Math.max(0, r.top), Math.min(vh, r.bottom)]).filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let cur = null;
  for (const [a, b] of spans) {
    if (cur && a <= cur[1] + gap) cur[1] = Math.max(cur[1], b);
    else {
      if (cur) covered += cur[1] - cur[0];
      cur = [a, b];
    }
  }
  if (cur) covered += cur[1] - cur[0];
  const share = covered / vh;
  const lead = own.map((el) => ({ el, top: el.getBoundingClientRect().top }))
    .sort((a, b) => a.top - b.top)[0];

  // font
  let minFont = { px: Infinity, what: null };
  const fontOf = (el, px) => {
    if (px < minFont.px) minFont = { px, what: `${label(el)} "${(el.textContent || el.value || '')
      .trim().slice(0, 24)}"` };
  };
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('.osc-sr-only, [hidden], template, script, style, dialog:not([open])')) continue;
    const control = el.matches('input:not([type=hidden]):not([type=range]):not([type=checkbox])'
      + ':not([type=radio]):not([type=file]), select, textarea');
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!control && !text) continue;
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    let px = parseFloat(getComputedStyle(el).fontSize);
    if (el instanceof SVGElement && el.getScreenCTM) {
      const m = el.getScreenCTM();
      if (m) px *= Math.hypot(m.a, m.b);
    }
    fontOf(el, px);
  }

  // covered and target
  const SEL = 'button, a[href], select, textarea, summary, '
    + 'input:not([type=hidden]):not([type=file]), [role=button], [role=tab], [role=radio], '
    + '[role=switch], [role=menuitem], [role=checkbox], [role=slider]';
  const scrollTop = main.scrollTop;
  const pageTop = document.scrollingElement.scrollTop;
  const hits = (el, x, y) => {
    const hit = document.elementFromPoint(x, y);
    if (!hit) return false;
    if (hit === el || el.contains(hit)) return true;
    const wrap = hit.closest('label, .osc-toggle');
    return !!(wrap && wrap.contains(el));
  };
  const coveredList = [];
  const small = [];
  let minTarget = { px: Infinity, what: null };
  let tested = 0;
  for (const el of document.querySelectorAll(SEL)) {
    if (el.closest('[hidden], dialog:not([open]), .osc-sr-only, .osc-skip, .osc-stepper-keys')) {
      continue;
    }
    if (!shown(el) || getComputedStyle(el).pointerEvents === 'none') continue;
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) continue;
    tested += 1;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // A centre still outside a clipping ancestor (a snapping strip that settles on its nearest
    // snap point) is off screen, not covered: the strip's own scroll reaches it.
    const clipped = (() => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const c = a.getBoundingClientRect();
        if (cx < c.left || cx > c.right || cy < c.top || cy > c.bottom) return true;
      }
      return false;
    })();
    if (!clipped && !hits(el, cx, cy)) {
      const hit = document.elementFromPoint(cx, cy);
      coveredList.push(`${label(el)} under ${hit ? label(hit) : 'nothing'}`);
    }
    const range = el.type === 'range';
    const size = range ? r.height : Math.min(r.width, r.height);
    if (size < touchMin - 0.5) {
      const h = touchMin / 2 - 1;
      const pts = range ? [[cx, cy - h], [cx, cy + h]]
        : [[cx - h, cy - h], [cx + h, cy - h], [cx - h, cy + h], [cx + h, cy + h]];
      if (!pts.every(([x, y]) => hits(el, x, y))) {
        small.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        if (size < minTarget.px) minTarget = { px: size, what: label(el) };
      }
    }
  }
  main.scrollTop = scrollTop;
  document.scrollingElement.scrollTop = pageTop;
  // labels: every Pattern Sequencer block's name reads whole (no ellipsis) where it is shown
  const cut = [...document.querySelectorAll('.osc-p-sequencer .osc-block-name')]
    .filter((el) => shown(el) && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1)
    .map((el) => `${el.textContent.trim()} ${el.clientWidth}/${el.scrollWidth} px`);
  // reopen: a shown safety.reopen control that a tap at its centre reaches
  const reopen = [...document.querySelectorAll('[data-osc="safety.reopen"]')]
    .filter((el) => shown(el) && el.getBoundingClientRect().width >= 2)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.id, hit: hits(el, r.left + r.width / 2, r.top + r.height / 2) };
    });
  return {
    mode: app.dataset.mode, coarse: matchMedia('(pointer: coarse)').matches, vh,
    share, lead: lead ? label(lead.el) : null, own: own.length, tested, reopen, cut,
    minFont: { px: Number.isFinite(minFont.px) ? Math.round(minFont.px * 100) / 100 : null,
      what: minFont.what },
    covered: coveredList, small,
    minTarget: { px: Number.isFinite(minTarget.px) ? Math.round(minTarget.px) : null,
      what: minTarget.what },
  };
}

/** Which phone-whole measures a reading passes. */
function phoneVerdicts(m, ws) {
  return {
    share: m.mode === ws && m.share >= WORK_SHARE,
    covered: m.mode === ws && m.covered.length === 0,
    font: m.mode === ws && m.minFont.px !== null && m.minFont.px >= FONT_MIN - 0.01,
    target: m.mode === ws && m.small.length === 0,
    reopen: m.mode === ws && m.reopen.some((r) => r.hit),
    labels: m.mode === ws && m.cut.length === 0,
  };
}

/**
 * In the page: the empty share of the workspace in view (see the header) and what the share
 * was measured on. `mode` is the workspace the app root shows.
 */
function emptyArea() {
  const STEP = 24;
  const header = document.querySelector('.osc-header');
  const status = document.querySelector('.osc-statusbar');
  const app = document.getElementById('osc-app');
  const top = header.getBoundingClientRect().bottom;
  const bottom = status.getBoundingClientRect().top;
  const containers = new Set([document.documentElement, document.body, app,
    document.querySelector('.osc-main'),
    ...document.querySelectorAll('.osc-top, .osc-top-left, .osc-top-right, .osc-row1-left, '
      + '.osc-row1-right, .osc-row3, .osc-workspace, .osc-view')]);
  let points = 0;
  let empty = 0;
  for (let y = top + STEP / 2; y < bottom; y += STEP) {
    for (let x = STEP / 2; x < window.innerWidth; x += STEP) {
      points += 1;
      const hit = document.elementFromPoint(x, y);
      if (!hit || containers.has(hit)) empty += 1;
    }
  }
  return { mode: app.dataset.mode, points, empty, share: points ? empty / points : 1 };
}

/** In the page: sideways overflow of the page and of every visible panel of the workspace. */
function sidewaysOverflow() {
  const de = document.documentElement;
  const main = document.querySelector('.osc-main');
  const out = [];
  if (de.scrollWidth > de.clientWidth + 1) out.push(`page ${de.scrollWidth} > ${de.clientWidth}`);
  if (main.scrollWidth > main.clientWidth + 1) {
    out.push(`main ${main.scrollWidth} > ${main.clientWidth}`);
  }
  for (const p of document.querySelectorAll('.osc-panel')) {
    const r = p.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(p).display === 'none') continue;
    if (r.left < -1 || r.right > window.innerWidth + 1) {
      out.push(`${p.id || p.className} spans ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
  }
  return { mode: document.getElementById('osc-app').dataset.mode, out };
}

/** In the page: each counterpart link, whether it is shown and where it points. */
function counterpartLinks(links) {
  return links.map(({ osc }) => {
    const a = document.querySelector(`[data-osc="${osc}"]`);
    if (!a) return { osc, present: false, shown: false, href: null };
    const r = a.getBoundingClientRect();
    const shown = r.width > 0 && r.height > 0 && !a.closest('[hidden]')
      && getComputedStyle(a).visibility !== 'hidden';
    return { osc, present: true, shown, href: a.getAttribute('href'), text: a.textContent.trim() };
  });
}

async function openPage(browser, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(URL);
  await page.waitForFunction(() => window.OSCILLA && window.OSCILLA.app, null, { timeout: 15000 });
  return page;
}

async function setWorkspace(page, ws) {
  await page.evaluate((w) => window.OSCILLA.app.setWorkspace(w), ws);
  await until(() => page.evaluate((w) => document.getElementById('osc-app').dataset.mode === w,
    ws), { ms: SETTLE_MS, what: `ui-current: workspace ${ws} shown` });
}

/** Poll `measure` until `ok(value)`; the last value read is returned either way. */
async function pollFor(measure, ok, what) {
  let last = null;
  try {
    await until(async () => {
      last = await measure();
      return ok(last);
    }, { ms: SETTLE_MS, what });
    return { ok: true, last };
  } catch (error) {
    if (!(error instanceof WaitTimeout)) throw error;
    return { ok: false, last, error: error.message };
  }
}

async function runOne(name) {
  const browser = await playwright[name].launch();
  const failures = [];
  let checks = 0;
  const check = (id, ok, detail) => {
    checks += 1;
    RUN.tally(name);
    if (!ok) failures.push(`${id}: ${detail}`);
  };
  try {
    // ---- 1536x1024: the workspaces fill the viewport and show their counterparts ----
    const page = await openPage(browser, DESKTOP);
    for (const ws of FILLED_WORKSPACES) {
      await setWorkspace(page, ws);
      const r = await pollFor(() => page.evaluate(emptyArea),
        (m) => m.mode === ws && m.share <= EMPTY_LIMIT, `ui-current: ${ws} empty share`);
      const m = r.last || {};
      check(`empty-area-${ws}`, r.ok, `${(100 * (m.share ?? 1)).toFixed(1)} % of ${ws} is empty `
        + `(${m.empty}/${m.points} points), above ${100 * EMPTY_LIMIT} %`);
      console.log(`  ${name} ${ws} 1536x1024: ${(100 * (m.share ?? 1)).toFixed(1)} % empty`);
    }
    for (const ws of [...COUNTERPART_WORKSPACES, 'playground']) {
      await setWorkspace(page, ws);
      const want = COUNTERPART_WORKSPACES.includes(ws);
      const r = await pollFor(() => page.evaluate(counterpartLinks, COUNTERPART_LINKS),
        (links) => links.every((l) => l.present && l.shown === want
          && l.href === COUNTERPART_LINKS.find((c) => c.osc === l.osc).href),
        `ui-current: counterpart links ${want ? 'shown' : 'hidden'} in ${ws}`);
      check(`counterparts-${ws}-desktop`, r.ok, JSON.stringify(r.last));
    }

    // A plain click on "RTA in Measure" opens MEASURE on its RTA tab.
    await setWorkspace(page, 'analyzer');
    await page.click('[data-osc="counterpart.measure-rta"]');
    const rta = await pollFor(() => page.evaluate(() => ({
      workspace: window.OSCILLA.app.workspace, tab: window.OSCILLA.app.meas.tab,
      address: window.location.hash,
    })), (s) => s.workspace === 'measure' && s.tab === 'rta',
    'ui-current: RTA in Measure opens the RTA tab');
    check('counterpart-opens-measure-rta', rta.ok, JSON.stringify(rta.last));

    // A plain click on "Compare saved experiments" opens Experiments.
    await setWorkspace(page, 'compare');
    await page.click('[data-osc="counterpart.experiments"]');
    const exp = await pollFor(() => page.evaluate(() => window.OSCILLA.app.workspace),
      (w) => w === 'experiments', 'ui-current: Compare saved experiments opens Experiments');
    check('counterpart-opens-experiments', exp.ok, `workspace ${exp.last}`);
    await page.close();

    // ---- 390x844: nothing overflows sideways; the counterparts are shown ----
    const phone = await openPage(browser, PHONE);
    for (const ws of FILLED_WORKSPACES) {
      await setWorkspace(phone, ws);
      const r = await pollFor(() => phone.evaluate(sidewaysOverflow),
        (m) => m.mode === ws && m.out.length === 0, `ui-current: ${ws} at 390 px within the width`);
      check(`no-sideways-overflow-${ws}`, r.ok, (r.last && r.last.out || []).join('; '));
      if (COUNTERPART_WORKSPACES.includes(ws)) {
        const l = await pollFor(() => phone.evaluate(counterpartLinks, COUNTERPART_LINKS),
          (links) => links.every((x) => x.present && x.shown),
          `ui-current: counterpart links shown in ${ws} at 390 px`);
        check(`counterparts-${ws}-phone`, l.ok, JSON.stringify(l.last));
      }
    }
    await phone.close();

    // ---- phone-whole: every workspace at 390x844 under a coarse pointer ----
    // Firefox has no mobile emulation (Playwright refuses isMobile there): touch only.
    const ctx = await browser.newContext({ viewport: PHONE, hasTouch: true,
      reducedMotion: 'reduce', ...(name === 'firefox' ? {} : { isMobile: true }) });
    await ctx.addInitScript((key) => {
      try { sessionStorage.setItem(key, '1'); } catch { /* storage refused: notice shown */ }
    }, SAFETY_SEEN);
    const seen = new Set();
    for (const ws of WORKSPACES) {
      const p = await ctx.newPage();
      await p.goto(`${URL}#m=${ws}`);
      await until(() => p.evaluate((w) => document.documentElement.dataset.ready === 'true'
        && !!window.OSCILLA && !!window.OSCILLA.app
        && document.getElementById('osc-app').dataset.mode === w, ws),
      { ms: READY_MS, what: `ui-current: phone-whole ${ws} opened at #m=${ws}` });
      const r = await pollFor(() => p.evaluate(phoneWhole,
        { ws, gap: WORK_GAP, touchMin: TOUCH_MIN }),
      (m) => Object.entries(phoneVerdicts(m, ws))
        .every(([k, ok]) => ok || PHONE_WHOLE_DEBT.has(`${ws}:${k}`)),
      `ui-current: phone-whole ${ws}`);
      await p.close();
      const m = r.last;
      check(`phone-whole-coarse-${ws}`, !!(m && m.coarse), 'pointer: coarse not emulated');
      const v = m ? phoneVerdicts(m, ws) : {};
      const detail = {
        share: m && `${(100 * m.share).toFixed(1)} % of ${m.vh} px is ${ws}'s own work `
          + `(${m.own} elements, led by ${m.lead}), under ${(100 * WORK_SHARE).toFixed(1)} %`,
        covered: m && m.covered.slice(0, 6).join('; '),
        font: m && `smallest text ${m.minFont.px} px (${m.minFont.what}), under ${FONT_MIN} px`,
        labels: m && `sequencer block names cut short: ${m.cut.slice(0, 6).join('; ')}`,
        reopen: m && `no reopen control for the safety notice is shown and reachable: `
          + `${JSON.stringify(m.reopen)}`,
        target: m && `${m.small.length} of ${m.tested} targets under ${TOUCH_MIN} px: `
          + `${m.small.slice(0, 6).join('; ')}`,
      };
      for (const k of PHONE_MEASURES) {
        const key = `${ws}:${k}`;
        if (PHONE_WHOLE_DEBT.has(key)) {
          seen.add(key);
          check(`phone-whole-${k}-${ws}`, !v[k], `${key} passes now: remove it from `
            + 'PHONE_WHOLE_DEBT');
          if (!v[k]) {
            console.log(`  KNOWN ${name} ${key}: ${detail[k]} (${PHONE_WHOLE_DEBT.get(key)})`);
          }
        } else {
          check(`phone-whole-${k}-${ws}`, !!v[k], detail[k] || 'no reading');
        }
      }
      if (m) {
        console.log(`  ${name} ${ws} 390x844 coarse: own work ${(100 * m.share).toFixed(1)} % `
          + `(led by ${m.lead}), smallest text ${m.minFont.px} px, ${m.covered.length} covered, `
          + `${m.small.length}/${m.tested} small targets`);
      }
    }
    check('phone-whole-debt-current', [...PHONE_WHOLE_DEBT.keys()].every((k) => seen.has(k)),
      `PHONE_WHOLE_DEBT names a workspace that is not one: ${[...PHONE_WHOLE_DEBT.keys()]
        .filter((k) => !seen.has(k)).join(', ')}`);
    await ctx.close();
  } finally {
    await browser.close();
  }
  return { checks, failures };
}

(async () => {
  await RUN.ready();
  await loadWorkspaces();
  let failed = 0;
  for (const b of BROWSERS) {
    const t0 = Date.now();
    const { checks, failures } = await runOne(b);
    failed += failures.length;
    console.log(`${failures.length ? 'FAIL' : 'PASS'} ${b}/ui-current: `
      + `${checks - failures.length}/${checks} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    for (const f of failures) console.log(`   x ${f}`);
  }
  process.exit(failed ? 1 : 0);
})();

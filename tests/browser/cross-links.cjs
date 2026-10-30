#!/usr/bin/env node
// OSCILLA cross-links and honest link labels (U010; UX link audit 2026-10-29, links.md) on the
// built dist/index.html in chromium, firefox and webkit, from file:// and from the Pages sub-path
// (http://127.0.0.1:<port>/oscilla/), every check on both.
//
//   node tests/browser/cross-links.cjs [--dist dist/index.html]
//        [--browsers chromium,firefox,webkit] [--origins file,http] [--only a,b]
//
// Every link is checked as a round trip: it is activated by pointer, by keyboard (Enter on the
// focused control) and by touch (a tap), it opens its workspace with the state it names, focus
// lands on that workspace's heading (never on <body>), Back returns to where it was followed
// from and Forward opens it again. Checks (asserted):
//   labels          (B6, B7, B8) the skip link says "Skip to main content"; the "?" button is
//                   named "Keyboard shortcuts" and opens that dialog; the logo keeps the
//                   product's name, its title says "Home: the Playground", and it goes to the
//                   Playground from another workspace, Back returns
//   filter-toggle   (B1) the Filter Lab ⤢ button is named "Open the Filter Lab page" on the
//                   Playground and opens Filter Lab; there it is named "Back to the Playground"
//                   and returns to the Playground
//   measure-to-experiments  (B2) Measure's "Open Experiments" opens Experiments with focus on
//                   the Experiments heading; Back returns to Measure
//   empty-states    (B12, P1) with nothing stored, Experiments' empty lists lead to Measure
//                   ("Open Measure", "Set up a measurement in Measure"), the empty Findings list
//                   moves focus to the Saved experiments list (no history entry), and the empty
//                   Presets history leads to the Playground
//   lab-studio      (P3) Filter Lab, Synthesis (two), the Sequencer and Measure each link to the
//                   shipped Studio template that does their job; the link is hidden on the
//                   Playground grid; Studio opens with that template and its Back button names
//                   and returns to the lab (P8)
//   seq-pattern     (P4) the Sequencer's "Open this pattern in Studio" opens a Studio document
//                   made from the Sequencer's own pattern (one clip per block, title
//                   "Sequencer pattern"), focus on the Studio heading, Back returns to the
//                   Sequencer and Forward reopens Studio; with unsaved Studio changes nothing
//                   is replaced, the Sequencer stays and the notice says why
//   studio-back     (P8, one-way link 1) Expand in the Sequencer's compact Studio, then the
//                   Studio's Back, returns to the Sequencer, named so, focus not on <body>
//   learn-tool      (P5, one-way link 2) a Learn topic's "Open <tool>" opens the tool; its
//                   notice carries "Back to the lesson: <topic>", which returns to Learn with
//                   the topic current; a topic without a tool has no link
//   learn-demo-back (one-way link 2) a Learn demo's notice carries the way back to the lesson;
//                   left untouched it still closes on its own (the notices are in flow)
//   citations       (B10) every Bioacoustics citation link names its source, not the raw URL,
//                   says "(opens in a new tab)" in its accessible name, keeps rel=noopener and
//                   carries the URL as its title
//   no-console-errors
//
// Waits are condition polls through lib/wait.cjs with a named wall-clock deadline, ending on the
// predicate the next assertion judges (rule project.bounded-test-timing); the run goes through
// lib/suite.cjs (project.suite-harness).
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
const RUN = suite.open({ name: 'cross-links', browsers: arg('browsers'),
  origins: arg('origins'), defaultOrigins: ['file', 'http'] });
const playwright = RUN.playwright;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const want = (name) => !ONLY || ONLY.has(name);

const READY_MS = 30000;
const NAV_MS = 10000;
// src/js/core/instrument.js ACTION_NOTICE_MS: a notice with a link closes on its own after it.
const ACTION_NOTICE_MS = 15000;
const INPUTS = ['pointer', 'keyboard', 'touch'];

// [data-osc, the workspace that shows it, Studio template id, template title, Back label]
const LAB_STUDIO = [
  ['filter.toStudio', 'filter', 'filter-automation', 'Filter Automation', 'Back to Filter Lab'],
  ['envelope.toStudio', 'synthesis', 'subtractive-synth', 'Subtractive Synth',
    'Back to Synthesis'],
  ['dual.toStudio', 'synthesis', 'stereo-beat', 'Stereo Beat', 'Back to Synthesis'],
  ['seq.toStudioTemplate', 'sequencer', 'sweep-sequence', 'Sweep Sequence',
    'Back to the Sequencer'],
  ['measure.toStudio', 'measure', 'measurement-sweep', 'Measurement Sweep', 'Back to Measure'],
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
  async open(context, base, hash = '') {
    const page = await context.newPage();
    await page.goto(hash ? `${base}#${hash}` : base, { waitUntil: 'load', timeout: READY_MS });
    await H.ready(page);
    return page;
  },
  /** Workspace, address, history length and where focus is (a heading of `w`, <body>, …). */
  state: (page, w = null) => page.evaluate((ws) => {
    const a = window.OSCILLA.app;
    const el = document.activeElement;
    const shown = (x) => !!x && x.getClientRects().length > 0;
    let headingOf = false;
    if (el && /^H[1-4]$/.test(el.tagName) && shown(el) && ws) {
      if (ws === 'playground') headingOf = el.matches('#osc-main > h1');
      else {
        const owner = el.closest('[data-osc-modes]');
        headingOf = !!owner && owner.dataset.oscModes.split(/\s+/).includes(ws);
      }
    }
    return { workspace: a.workspace, hash: location.hash, histLen: history.length,
      focusTag: el ? el.tagName : null, focusBody: !el || el === document.body,
      focusOsc: el && el.dataset ? el.dataset.osc || null : null, headingOf,
      studioTitle: a.studio ? a.studio.title : null, learnTopic: a.learnTopic };
  }, w),
  /** Poll until `pred(state)` holds; the state, or null at the deadline. */
  async until(page, w, pred, what) {
    return until(async () => {
      const s = await H.state(page, w);
      return pred(s) ? s : null;
    }, { ms: NAV_MS, what }).catch(() => null);
  },
  /** Arrive in `w` with focus on its heading (a link, Back / Forward). */
  arrived(page, w, what) {
    return H.until(page, w, (s) => s.workspace === w && s.headingOf, what);
  },
  async setWorkspace(page, w) {
    await page.evaluate((x) => window.OSCILLA.app.setWorkspace(x), w);
    return H.until(page, w, (s) => s.workspace === w, `setWorkspace(${w})`);
  },
  /** Activate a control by pointer, keyboard (focus, then Enter) or touch (a tap). */
  async activate(page, selector, input) {
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout: NAV_MS });
    if (input === 'keyboard') {
      await el.focus({ timeout: NAV_MS });
      await page.keyboard.press('Enter');
    } else if (input === 'touch') {
      await el.tap({ timeout: NAV_MS });
    } else {
      await el.click({ timeout: NAV_MS });
    }
  },
  /** Back or Forward, then the state once the workspace is `w` with focus on its heading. */
  async traverse(page, dir, w) {
    await page.evaluate((d) => (d === 'back' ? history.back() : history.forward()), dir);
    return H.arrived(page, w, `history.${dir}() opens ${w} and focuses its heading`);
  },
  name: (page, selector) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    return {
      label: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      text: el.textContent.replace(/\s+/g, ' ').trim(),
      href: el.getAttribute('href'),
      shown: el.getClientRects().length > 0,
    };
  }, selector),
  /**
   * A link followed from `from` lands on `to` (state `ok(s)`), focus on its heading; Back
   * returns to `from`, Forward to `to` again. Problems are pushed to `wrong`.
   */
  async roundTrip(page, { label, from, to, selector, input, ok = () => true, backTo = from },
    wrong) {
    const at = await H.setWorkspace(page, from);
    if (!at) { wrong.push(`${label} (${input}): could not open ${from}`); return null; }
    await H.activate(page, selector, input);
    const s = await H.until(page, to, (x) => x.workspace === to && x.headingOf && ok(x),
      `${label} (${input}) opens ${to}`);
    if (!s) {
      const now = await H.state(page, to);
      wrong.push(`${label} (${input}): ${JSON.stringify(now)}`);
      return null;
    }
    const back = await H.traverse(page, 'back', backTo);
    if (!back) wrong.push(`${label} (${input}): Back did not return to ${backTo}`);
    const fwd = await H.traverse(page, 'forward', to);
    if (!fwd || !ok(fwd)) wrong.push(`${label} (${input}): Forward did not reopen ${to}`);
    return s;
  },
};

// ------------------------------------------------------------------------------ one leg
async function runLeg(name, origin) {
  const leg = `${name}/${origin}`;
  const server = origin === 'http' ? await serveDist(DIST, { prefix: 'oscilla-xlinks-' }) : null;
  const base = server ? server.url : pathToFileURL(DIST).href;
  const browser = await playwright[name].launch();
  // hasTouch: the same page takes pointer clicks, keys and taps (a touch laptop).
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 },
    hasTouch: true });
  const errors = [];
  context.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  });
  console.log(`\n${leg} (${browser.version()})`);
  try {
    if (want('labels')) {
      const page = await H.open(context, base);
      const skip = await H.name(page, '.osc-skip');
      const help = await H.name(page, '[data-osc="header.help"]');
      const brand = await H.name(page, '.osc-brand');
      check(leg, 'the skip link, the "?" button and the logo say what they do',
        skip && skip.text === 'Skip to main content'
        && help && help.label === 'Keyboard shortcuts' && help.title === 'Keyboard shortcuts'
        && brand && brand.href === '#m=playground' && /OSCILLA/.test(brand.label)
        && brand.title === 'Home: the Playground',
        JSON.stringify({ skip, help, brand }));
      const wrong = [];
      for (const input of INPUTS) {
        await H.roundTrip(page, { label: 'logo', from: 'measure', to: 'playground',
          selector: '.osc-brand', input }, wrong);
      }
      check(leg, 'the logo goes home and Back returns (pointer, keyboard, touch)',
        !wrong.length, wrong.join(' | '));
      const opened = [];
      for (const input of INPUTS) {
        await H.activate(page, '[data-osc="header.help"]', input);
        const dlg = await until(() => page.evaluate(() => {
          const d = document.querySelector('dialog[open]');
          return d ? d.getAttribute('aria-labelledby') && document.getElementById(
            d.getAttribute('aria-labelledby')).textContent.trim() : null;
        }), { ms: NAV_MS, what: `"?" (${input}) opens a dialog` }).catch(() => null);
        opened.push(dlg);
        await page.keyboard.press('Escape');
        await until(() => page.evaluate(() => !document.querySelector('dialog[open]')),
          { ms: NAV_MS, what: 'the shortcuts dialog closes on Escape' });
      }
      check(leg, 'the "Keyboard shortcuts" button opens the keyboard shortcuts dialog',
        opened.every((t) => t && /keyboard shortcuts/i.test(t)), JSON.stringify(opened));
      await page.close();
    }

    if (want('filter-toggle')) {
      const page = await H.open(context, base);
      const wrong = [];
      const sel = '#osc-filter-fullscreen';
      for (const input of INPUTS) {
        await H.setWorkspace(page, 'playground');
        const onGrid = await H.name(page, sel);
        if (!onGrid || onGrid.label !== 'Open the Filter Lab page') {
          wrong.push(`Playground: ${JSON.stringify(onGrid)}`);
        }
        await H.activate(page, sel, input);
        const inLab = await H.until(page, 'filter', (s) => s.workspace === 'filter',
          `⤢ (${input}) opens Filter Lab`);
        if (!inLab) { wrong.push(`${input}: ⤢ did not open Filter Lab`); continue; }
        const there = await until(async () => {
          const n = await H.name(page, sel);
          return n && n.label === 'Back to the Playground' && n.title === n.label ? n : null;
        }, { ms: NAV_MS, what: 'the ⤢ button is renamed in Filter Lab' }).catch(() => null);
        if (!there) wrong.push(`Filter Lab: ${JSON.stringify(await H.name(page, sel))}`);
        await H.activate(page, sel, input);
        const home = await H.until(page, 'playground', (s) => s.workspace === 'playground',
          `⤢ (${input}) in Filter Lab returns to the Playground`);
        if (!home) wrong.push(`${input}: ⤢ in Filter Lab did not return to the Playground`);
        const back = await H.traverse(page, 'back', 'filter');
        if (!back) wrong.push(`${input}: Back did not return to Filter Lab`);
      }
      check(leg, 'the Filter Lab ⤢ button names where it goes and goes there (B1)',
        !wrong.length, wrong.join(' | '));
      await page.close();
    }

    if (want('measure-to-experiments')) {
      const page = await H.open(context, base);
      const wrong = [];
      const label = await H.name(page, '[data-osc="measure.toExperiments"]');
      if (!label || label.text !== 'Open Experiments') wrong.push(JSON.stringify(label));
      for (const input of INPUTS) {
        await H.roundTrip(page, { label: 'Open Experiments', from: 'measure', to: 'experiments',
          selector: '[data-osc="measure.toExperiments"]', input }, wrong);
      }
      check(leg, 'Measure\'s "Open Experiments" lands focus on the Experiments heading (B2)',
        !wrong.length, wrong.join(' | '));
      await page.close();
    }

    if (want('empty-states')) {
      // A fresh context: nothing stored, which is how every new user meets Experiments.
      const fresh = await browser.newContext({ viewport: { width: 1536, height: 1024 },
        hasTouch: true });
      fresh.on('page', (p) => {
        p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      });
      const page = await H.open(fresh, base, 'm=experiments');
      await until(() => page.evaluate(() => window.OSCILLA.app.exps.loaded),
        { ms: NAV_MS, what: 'the Experiments lists load' });
      const wrong = [];
      for (const [osc, input] of [['exp.toMeasure', 'pointer'], ['def.toMeasure', 'keyboard'],
        ['exp.toMeasure', 'touch']]) {
        await H.roundTrip(page, { label: osc, from: 'experiments', to: 'measure',
          selector: `[data-osc="${osc}"]`, input }, wrong);
      }
      // Findings, empty: the link moves focus to the Saved experiments list, in place.
      for (const input of INPUTS) {
        await H.setWorkspace(page, 'experiments');
        const before = await H.state(page, 'experiments');
        await H.activate(page, '[data-osc="fnd.toExperiments"]', input);
        const s = await until(() => page.evaluate(() => document.activeElement
          && document.activeElement.id), { ms: NAV_MS,
          what: `fnd.toExperiments (${input}) focuses the Saved experiments list` })
          .catch(() => null);
        const after = await H.state(page, 'experiments');
        if (s !== 'osc-exp-list') wrong.push(`fnd.toExperiments (${input}): focus on ${s}`);
        if (after.hash !== before.hash || after.histLen !== before.histLen
          || after.workspace !== 'experiments') {
          wrong.push(`fnd.toExperiments (${input}): ${JSON.stringify({ before, after })}`);
        }
      }
      // Presets ▸ History, nothing played in this page view (a fresh page).
      const presets = await H.open(fresh, base, 'm=presets');
      await presets.click('[data-osc="presets.tab"][data-value="history"]', { timeout: NAV_MS });
      for (const input of INPUTS) {
        await H.roundTrip(presets, { label: 'presets.toPlayground', from: 'presets',
          to: 'playground', selector: '[data-osc="presets.toPlayground"]', input }, wrong);
      }
      check(leg, 'the empty Experiments, Findings and Presets lists lead to the next step '
        + '(B12, P1)', !wrong.length, wrong.join(' | '));
      await presets.close();
      await page.close();
      await fresh.close();
    }

    if (want('lab-studio')) {
      const wrong = [];
      let i = 0;
      for (const [osc, from, template, title, backName] of LAB_STUDIO) {
        // One page per template: a later template link over an earlier one is the unsaved-work
        // case (links.md: the Templates dialog), which v31-studio-links.cjs owns.
        const page = await H.open(context, base);
        const input = INPUTS[i % INPUTS.length];
        i += 1;
        const sel = `[data-osc="${osc}"]`;
        if (from !== 'measure') {
          await H.setWorkspace(page, 'playground');
          const grid = await H.name(page, sel);
          if (grid && grid.shown) wrong.push(`${osc} is shown on the Playground grid`);
        }
        await H.setWorkspace(page, from);
        const link = await H.name(page, sel);
        if (!link || link.href !== `#m=studio&st=${template}`
          || link.text !== `Open ${title} in Studio`) {
          wrong.push(`${osc}: ${JSON.stringify(link)}`);
        }
        const s = await H.roundTrip(page, { label: osc, from, to: 'studio', selector: sel, input,
          ok: (x) => x.studioTitle === title }, wrong);
        if (s) {
          const back = await until(async () => {
            const n = await H.name(page, '[data-osc="studio.back"]');
            return n && n.label === backName && n.title === backName ? n : null;
          }, { ms: NAV_MS, what: `Studio Back is named "${backName}"` }).catch(() => null);
          if (!back) {
            wrong.push(`${osc}: Studio Back ${JSON.stringify(await H.name(page,
              '[data-osc="studio.back"]'))}, not "${backName}"`);
          } else {
            await H.activate(page, '[data-osc="studio.back"]', input);
            const home = await H.until(page, from, (x) => x.workspace === from && !x.focusBody,
              `Studio Back (${input}) returns to ${from}`);
            if (!home) wrong.push(`${osc}: Studio Back did not return to ${from}`);
          }
        }
        await page.close();
      }
      check(leg, `${LAB_STUDIO.length} labs open their Studio template, and Studio's Back `
        + 'returns to the lab (P3, P8)', !wrong.length, wrong.join(' | '));
    }

    if (want('seq-pattern')) {
      const wrong = [];
      const sel = '[data-osc="seq.toStudio"]';
      for (const input of INPUTS) {
        const page = await H.open(context, base);
        await H.setWorkspace(page, 'sequencer');
        const blocks = await page.evaluate(() => {
          const sq = window.OSCILLA.labs.sequencer;
          return sq ? sq.editor.model.blocks.length : null;
        });
        const link = await H.name(page, sel);
        if (!link || link.href !== '#m=studio' || link.text !== 'Open this pattern in Studio') {
          wrong.push(`${input}: ${JSON.stringify(link)}`);
        }
        const s = await H.roundTrip(page, { label: 'seq.toStudio', from: 'sequencer',
          to: 'studio', selector: sel, input,
          ok: (x) => x.studioTitle === 'Sequencer pattern' }, wrong);
        if (s) {
          const clips = await page.evaluate(() => window.OSCILLA.studio.model.timeline.clips
            .length);
          if (clips !== blocks) {
            wrong.push(`${input}: ${clips} clips for ${blocks} Sequencer blocks`);
          }
          if (clips < 1) wrong.push(`${input}: no pattern clip in the Studio document`);
        }
        // Unsaved Studio changes: the pattern does not replace them.
        await page.evaluate(() => {
          const st = window.OSCILLA.studio;
          const n = st.model.graph.nodes[0];
          st.store.dispatch({ type: 'NODE_MOVE', nodeId: n.id,
            position: { x: n.position.x + 48, y: n.position.y } });
          window.OSCILLA.app.alerts = [];
        });
        const dirty = await until(() => page.evaluate(() => window.OSCILLA.studio.dirty),
          { ms: NAV_MS, what: 'the Studio document is unsaved after a move' }).catch(() => false);
        await H.setWorkspace(page, 'sequencer');
        await H.activate(page, sel, input);
        const kept = await until(() => page.evaluate(() => {
          const a = window.OSCILLA.app;
          const told = a.alerts.find((x) => x.title === 'Pattern not opened'
            && /unsaved changes/.test(x.message));
          return told ? { workspace: a.workspace, dirty: window.OSCILLA.studio.dirty } : null;
        }), { ms: NAV_MS, what: `the pattern (${input}) waits for unsaved Studio changes` })
          .catch(() => null);
        if (!dirty || !kept || kept.workspace !== 'sequencer' || !kept.dirty) {
          wrong.push(`${input}: unsaved Studio changes ${JSON.stringify({ dirty, kept })}`);
        }
        await page.close();
      }
      check(leg, 'the Sequencer opens its own pattern in Studio, and never over unsaved '
        + 'changes (P4)', !wrong.length, wrong.join(' | '));
    }

    if (want('studio-back')) {
      const page = await H.open(context, base);
      const wrong = [];
      for (const input of INPUTS) {
        await H.setWorkspace(page, 'sequencer');
        await H.activate(page, '[data-osc="studio.compact.expand"]', input);
        const s = await H.until(page, 'studio', (x) => x.workspace === 'studio',
          `Expand (${input}) in the Sequencer opens Studio`);
        if (!s) { wrong.push(`${input}: Expand did not open Studio`); continue; }
        const n = await until(async () => {
          const x = await H.name(page, '[data-osc="studio.back"]');
          return x && x.label === 'Back to the Sequencer' && x.text === 'Sequencer' ? x : null;
        }, { ms: NAV_MS, what: 'Studio Back names the Sequencer' }).catch(() => null);
        if (!n) {
          wrong.push(`${input}: ${JSON.stringify(await H.name(page, '[data-osc="studio.back"]'))}`);
        }
        await H.activate(page, '[data-osc="studio.back"]', input);
        const home = await H.until(page, 'sequencer',
          (x) => x.workspace === 'sequencer' && !x.focusBody,
          `Studio Back (${input}) returns to the Sequencer with focus on a control`);
        if (!home) wrong.push(`${input}: Back did not return to the Sequencer`);
        const back = await H.traverse(page, 'back', 'studio');
        if (!back) wrong.push(`${input}: history Back did not reopen Studio`);
        const fwd = await H.traverse(page, 'forward', 'sequencer');
        if (!fwd) wrong.push(`${input}: Forward did not return to the Sequencer`);
      }
      check(leg, 'Studio opened from the Sequencer goes back to the Sequencer (P8)',
        !wrong.length, wrong.join(' | '));
      await page.close();
    }

    if (want('learn-tool')) {
      const page = await H.open(context, base);
      const wrong = [];
      const tools = await page.evaluate(async () => {
        window.OSCILLA.app.setWorkspace('learn');
        return [...document.querySelectorAll('#osc-view-learn .osc-learn-item')].map((li) => {
          const a = li.querySelector('[data-osc="learn.tool"]');
          return { title: li.querySelector('h3').textContent.trim(),
            href: a ? a.getAttribute('href') : null, text: a ? a.textContent.trim() : null };
        });
      });
      const withTool = tools.filter((t) => t.href);
      if (withTool.length < 5 || withTool.length === tools.length) {
        wrong.push(`tool links on ${withTool.length} of ${tools.length} topics`);
      }
      const cases = [['Harmonics', 'analyzer'], ['Beating', 'synthesis'],
        ['Speaker limitations', 'measure']];
      for (let k = 0; k < cases.length; k += 1) {
        const [topic, ws] = cases[k];
        const input = INPUTS[k];
        const t = withTool.find((x) => x.title === topic);
        if (!t || t.href !== `#m=${ws}`) { wrong.push(`${topic}: ${JSON.stringify(t)}`); continue; }
        await H.setWorkspace(page, 'learn');
        const sel = `#osc-view-learn .osc-learn-item:has(> h3:text-is("${topic}")) `
          + '[data-osc="learn.tool"]';
        await H.activate(page, sel, input);
        const s = await H.arrived(page, ws, `${topic} (${input}) opens ${ws}`);
        if (!s) { wrong.push(`${topic} (${input}): did not open ${ws}`); continue; }
        const action = await until(() => page.evaluate(() => {
          const a = document.querySelector('[data-osc="alert.action"]');
          return a && a.getClientRects().length ? a.textContent.trim() : null;
        }), { ms: NAV_MS, what: `${topic}: the notice offers the way back` }).catch(() => null);
        if (action !== `Back to the lesson: ${topic}`) {
          wrong.push(`${topic}: notice action ${JSON.stringify(action)}`);
          continue;
        }
        await H.activate(page, '[data-osc="alert.action"]', input);
        const back = await H.until(page, 'learn', (x) => x.workspace === 'learn' && x.headingOf,
          `${topic} (${input}): the notice returns to Learn`);
        if (!back) { wrong.push(`${topic} (${input}): the notice did not return to Learn`); continue; }
        const topicId = await page.evaluate((tt) => {
          const li = [...document.querySelectorAll('#osc-view-learn .osc-learn-item')]
            .find((x) => x.querySelector('h3').textContent.trim() === tt);
          return li && li.classList.contains('is-current');
        }, topic);
        if (!topicId) wrong.push(`${topic}: not the current lesson after the way back`);
        const gone = await until(() => page.evaluate(() =>
          !document.querySelector('[data-osc="alert.action"]')),
        { ms: NAV_MS, what: 'the followed notice is dismissed' }).catch(() => null);
        if (!gone) wrong.push(`${topic}: the followed notice stayed`);
        const hb = await H.traverse(page, 'back', ws);
        if (!hb) wrong.push(`${topic}: Back from the lesson did not return to ${ws}`);
      }
      check(leg, 'Learn topics open their tool and the notice leads back to the lesson (P5)',
        !wrong.length, wrong.join(' | '));
      await page.close();
    }

    if (want('learn-demo-back')) {
      const page = await H.open(context, base);
      const wrong = [];
      for (const input of INPUTS) {
        await H.setWorkspace(page, 'learn');
        await H.activate(page, '#osc-view-learn .osc-learn-item:has(> h3:text-is("Frequency")) '
          + '[data-osc="learn.demo"]', input);
        const s = await H.until(page, 'playground', (x) => x.workspace === 'playground',
          `Demo (${input}) opens the Playground`);
        if (!s) { wrong.push(`${input}: the demo did not open the Playground`); continue; }
        const action = await until(() => page.evaluate(() => {
          const a = document.querySelector('[data-osc="alert.action"]');
          return a && a.getClientRects().length ? a.textContent.trim() : null;
        }), { ms: NAV_MS, what: 'the demo notice offers the way back' }).catch(() => null);
        if (!action || !/^Back to the lesson: /.test(action)) {
          wrong.push(`${input}: notice action ${JSON.stringify(action)}`);
          continue;
        }
        await H.activate(page, '[data-osc="alert.action"]', input);
        const back = await H.arrived(page, 'learn', `demo notice (${input}) returns to Learn`);
        if (!back) wrong.push(`${input}: the demo notice did not return to Learn`);
        const hb = await H.traverse(page, 'back', 'playground');
        if (!hb) wrong.push(`${input}: Back did not return to the demo`);
      }
      // The notices are in flow: one that never closed would push the page down until
      // dismissed. Untouched (focus on Hold to Play, the pointer away), it closes on its own.
      await H.setWorkspace(page, 'learn');
      await H.activate(page, '#osc-view-learn .osc-learn-item:has(> h3:text-is("Frequency")) '
        + '[data-osc="learn.demo"]', 'keyboard');
      const offered = await until(() => page.evaluate(() =>
        !!document.querySelector('[data-osc="alert.action"]')),
      { ms: NAV_MS, what: 'the demo notice offers the way back' }).catch(() => false);
      await page.mouse.move(2, 1020);
      const closed = offered && await until(() => page.evaluate(() =>
        !document.querySelector('[data-osc="alert.action"]')),
      { ms: ACTION_NOTICE_MS + NAV_MS, what: 'the untouched demo notice closes on its own' })
        .catch(() => false);
      if (!closed) wrong.push(`the untouched demo notice did not close (offered ${offered})`);
      check(leg, 'a Learn demo leads back to its lesson (one-way link 2)',
        !wrong.length, wrong.join(' | '));
      await page.close();
    }

    if (want('citations')) {
      const page = await H.open(context, base);
      await H.setWorkspace(page, 'compare');
      const links = await until(() => page.evaluate(() => {
        const all = [...document.querySelectorAll('#osc-bio-source-list a')];
        return all.length ? all.map((a) => ({ href: a.getAttribute('href'),
          text: a.textContent.trim(), title: a.getAttribute('title'),
          target: a.getAttribute('target'), rel: a.getAttribute('rel') || '',
          named: a.getAttribute('aria-label') || a.textContent.trim() })) : null;
      }), { ms: NAV_MS, what: 'the Bioacoustics sources list renders' }).catch(() => []);
      const bad = (links || []).filter((l) => l.text.includes('://')
        || !/\(opens in a new tab\)$/.test(l.named) || l.title !== l.href
        || l.target !== '_blank' || !/noopener/.test(l.rel));
      check(leg, `${(links || []).length} citation links name their source and say they open `
        + 'a new tab (B10)', links && links.length >= 5 && !bad.length,
      JSON.stringify(bad.slice(0, 3)));
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

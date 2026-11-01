// The first screen the owner chose (plan P002, Q004 option A, intent first-run-experience,
// claim first-screen-layout): a lighter Playground with the measurement row in view and no
// guided path, in the words of the Q002 positioning sentence. This file holds the parts of the
// decision that the shell markup and the MEASURE adapter decide; tests/browser/first-screen.cjs
// (check `layout`) proves where the parts sit in Chromium, Firefox and WebKit.
//
//   - the page's h1 is the positioning sentence, visible on the Playground (hidden elsewhere,
//     where each workspace's own heading leads), and stands above every panel;
//   - the Playground's Guided measurement row is MEASURE's own panel, not a copy: the shell has
//     one Guided measurement panel and one primary action, and the MEASURE view that holds it is
//     shown on the Playground too;
//   - in document order, so that reading and Tab order follow the rows: the sentence, the row of
//     Source & Pattern, Signal analysis, Microphone Analyzer and Device & Limits, the
//     measurement row, then the Pattern Sequencer with the compact Studio beside it;
//   - on a phone Source & Pattern folds its six frequency steps and Mode behind its own
//     disclosures, which stay open from 768 px and follow the width (foldOnPhone);
//   - the measurement runs in MEASURE: the primary action pressed on the Playground opens
//     MEASURE before it runs, so the quality, the result and Stop are in view; an action that
//     cannot run moves nobody.
//
//   node --test tests/unit/first-screen-layout.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DESCRIPTION } from '../../scripts/social-assets.mjs';
import { createMeasureUi } from '../../src/js/ui/measure.js';
// A namespace import: on a tree without PHONE_QUERY the tests fail one by one, not at link time.
import * as appUi from '../../src/js/ui/app.js';

const { createOscillaUi } = appUi;

const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '');
const flat = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** The <main> element's markup. */
function mainMarkup() {
  const start = html.indexOf('<main');
  const end = html.indexOf('</main>');
  assert.ok(start >= 0 && end > start, 'src/index.html has one <main>');
  return html.slice(start, end);
}

/** Offset of the first match of `re` in `s`, failing with `what` when there is none. */
function at(s, re, what) {
  const m = re.exec(s);
  assert.ok(m, `${what} not found`);
  return m.index;
}

test('the page h1 is the Q002 sentence, shown on the Playground, above every panel', () => {
  const main = mainMarkup();
  const h1s = [...main.matchAll(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/g)];
  assert.equal(h1s.length, 1, 'one h1 in the main region');
  const [whole, attrs, body] = h1s[0];
  assert.equal(flat(body), DESCRIPTION, 'the h1 says the positioning sentence, verbatim');
  const cls = (attrs.match(/\sclass="([^"]*)"/) || [])[1] || '';
  assert.ok(!/\bosc-sr-only\b/.test(cls), 'the h1 is not hidden by its static class');
  const bound = (attrs.match(/\s:class="([^"]*)"/) || [])[1] || '';
  assert.match(bound, /'osc-sr-only':\s*workspace\s*!==\s*'playground'/,
    'outside the Playground the h1 is visually hidden, the workspace heading leads');
  assert.ok(main.indexOf(whole) < at(main, /<section\b[^>]*class="osc-panel\b/, 'a panel'),
    'the h1 stands before the first panel');
});

test('the measurement row is MEASURE\'s one Guided measurement panel, shown on the Playground',
  () => {
    assert.equal([...html.matchAll(/\bid="osc-measure-flow"/g)].length, 1,
      'one Guided measurement panel');
    assert.equal([...html.matchAll(/data-osc="measure\.primary"/g)].length, 1,
      'one primary measurement action');
    const view = html.match(/<section\b[^>]*\bid="osc-view-measure"[^>]*>/);
    assert.ok(view, 'the MEASURE view');
    const hidden = (view[0].match(/\s:hidden="([^"]*)"/) || [])[1] || '';
    for (const [workspace, shown] of [['measure', true], ['playground', true],
      ['experiments', false], ['analyzer', false], ['studio', false], ['about', false]]) {
      // The binding is an Alpine expression over `workspace` alone.
      // eslint-disable-next-line no-new-func
      const isHidden = Function('workspace', `return (${hidden});`)(workspace);
      assert.equal(!isHidden, shown, `the MEASURE view is ${shown ? 'shown' : 'hidden'} in `
        + `${workspace} (:hidden="${hidden}")`);
    }
  });

test('document order follows the rows: sentence, generate and listen, measure, then pattern '
  + 'and Studio', () => {
  const main = mainMarkup();
  const pos = (id) => at(main, new RegExp(`\\bid="${id}"`), id);
  const order = ['osc-panel-source', 'osc-panel-analysis', 'osc-panel-mic', 'osc-panel-device',
    'osc-view-measure', 'osc-panel-sequencer', 'osc-panel-studio'];
  const at1 = order.map(pos);
  assert.deepEqual([...at1].sort((a, b) => a - b), at1, `in this order: ${order.join(', ')}`);
  assert.ok(at(main, /<h1\b/, 'h1') < at1[0], 'the sentence comes first');
  // Nothing that leaves the first screen stands between the sequencer and the compact Studio.
  const between = main.slice(at1[5], at1[6]);
  assert.ok(!/<section\b[^>]*\bid="osc-panel-(?!sequencer)/.test(between),
    'the compact Studio follows the Pattern Sequencer');
});

/** The MEASURE adapter composed as main.js composes it (no DOM; tests/unit/v4-*.test.mjs). */
function makeMeasure(workspace) {
  const cmp = {};
  const part = createMeasureUi({ engine: { init() {}, activeNodeCount: 0 }, stopPlayback() {},
    loopback: true, build: null });
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(part));
  const calls = [];
  Object.assign(cmp, { workspace, notify() {}, $nextTick: (f) => f && f(), openModal() {},
    closeModal() {},
    setWorkspace(mode) { calls.push(mode); this.workspace = mode; } });
  cmp.measureInit();
  return { cmp, calls };
}

test('the primary action pressed on the Playground opens MEASURE before it runs', async () => {
  const { cmp, calls } = makeMeasure('playground');
  // An action with no side effect outside the adapter (the flow's own 'acknowledge').
  cmp.meas.flow = { ...cmp.meas.flow, primaryAction: { id: 'acknowledge', enabled: true } };
  await cmp.measureRunPrimary();
  assert.deepEqual(calls, ['measure'], 'MEASURE opened once');
  assert.equal(cmp.workspace, 'measure');
});

test('Repeat pressed on the Playground opens MEASURE before it measures; Cancel stays put',
  async () => {
    // A COMPLETE result outlives leaving MEASURE (only an active run is aborted), so the
    // Playground's measurement row can offer "Repeat (new experiment)" as a secondary action.
    const { cmp, calls } = makeMeasure('playground');
    let measuredIn = null;
    cmp.measureRepeat = async function measureRepeat() { measuredIn = this.workspace; };
    await cmp.measureRunSecondary('repeat');
    assert.deepEqual(calls, ['measure'], 'MEASURE opened once');
    assert.equal(measuredIn, 'measure', 'the repeat runs in MEASURE, not unseen on the Playground');

    const inMeasure = makeMeasure('measure');
    inMeasure.cmp.measureRepeat = async () => {};
    await inMeasure.cmp.measureRunSecondary('repeat');
    assert.deepEqual(inMeasure.calls, [], 'no workspace switch from MEASURE itself');

    const cancel = makeMeasure('playground');
    await cancel.cmp.measureRunSecondary('stop');
    assert.deepEqual(cancel.calls, [], 'Cancel needs no workspace: it stops in place');
  });

test('in MEASURE the primary action runs in place, and a disabled one moves nobody', async () => {
  const inMeasure = makeMeasure('measure');
  inMeasure.cmp.meas.flow = { ...inMeasure.cmp.meas.flow,
    primaryAction: { id: 'acknowledge', enabled: true } };
  await inMeasure.cmp.measureRunPrimary();
  assert.deepEqual(inMeasure.calls, [], 'no workspace switch from MEASURE itself');

  const off = makeMeasure('playground');
  off.cmp.meas.flow = { ...off.cmp.meas.flow,
    primaryAction: { id: 'preflight', enabled: false, reason: 'busy' } };
  await off.cmp.measureRunPrimary();
  assert.deepEqual(off.calls, [], 'a disabled action leaves the visitor on the Playground');
  assert.equal(off.cmp.workspace, 'playground');
});

test('Source & Pattern folds the six steps and Mode behind its own disclosures', () => {
  const src = html.slice(html.indexOf('id="osc-panel-source"'), html.indexOf('id="osc-panel-analysis"'));
  for (const [id, what] of [['osc-fine-fold', /data-osc="source\.step"/g],
    ['osc-mode-fold', /data-osc="source\.inputMode"/g]]) {
    const m = src.match(new RegExp(`<details id="${id}"([^>]*)>([\\s\\S]*?)</details>`));
    assert.ok(m, `${id} is a disclosure of Source & Pattern`);
    assert.match(m[1], /\sopen\b/, `${id} is open before the script runs`);
    assert.match(m[1], /x-init="foldOnPhone\(\$el\)"/, `${id} follows the width`);
    assert.match(m[2], /^\s*<summary>/, `${id} starts with its summary`);
    assert.ok((m[2].match(what) || []).length >= 2, `${id} holds its controls`);
  }
  assert.equal((src.match(/data-osc="source\.step"/g) || []).length, 6, 'six frequency steps');
});

test('foldOnPhone: folded below 768 px, open from 768 px, following the width', () => {
  const listeners = [];
  const mq = { matches: true, addEventListener: (type, f) => listeners.push([type, f]) };
  const seen = [];
  const prev = globalThis.window;
  globalThis.window = { matchMedia: (q) => { seen.push(q); return mq; } };
  try {
    const ui = createOscillaUi({});
    const el = { open: true };
    ui.foldOnPhone(el);
    assert.deepEqual(seen, [appUi.PHONE_QUERY]);
    assert.equal(appUi.PHONE_QUERY, '(max-width: 767.98px)', 'the phone width of responsive.css');
    assert.equal(el.open, false, 'folded on a phone');
    assert.equal(listeners.length, 1);
    assert.equal(listeners[0][0], 'change');
    mq.matches = false;
    listeners[0][1]();
    assert.equal(el.open, true, 'open once the width is 768 px or more');
    mq.matches = true;
    listeners[0][1]();
    assert.equal(el.open, false, 'folded again on a phone');
  } finally {
    globalThis.window = prev;
  }
  const bare = createOscillaUi({});
  const el = { open: true };
  bare.foldOnPhone(el); // no window here: the markup's own state (open) stays
  assert.equal(el.open, true);
});

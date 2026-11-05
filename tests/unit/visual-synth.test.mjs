// F013 W1: the SYN visual reference (scripts/visual-synth.mjs, tests/visual/synth/) is the one
// the plan agreed, held without a browser: the Synth workspace's Panel, Engines and XY tabs at
// desktop 1536x1024 and phone 390x844, in the dark and the light theme, a patch bay of six cables
// (one from each source colour, the s-look pairs of tests/browser/synth.cjs) seen whole, a gate
// on absolute pixel counts (a 1 px change to a plate or a knob fails; the 0.5 % tolerance of the
// other references let it pass), references per environment written only by the script, and the
// harness wired into `npm run test:visual` and the CI visual job like scripts/visual-studio.mjs.
//
// The bounds are derived, not asserted: each view's bound is NOISE_FACTOR times the largest count
// its own stability runs showed (references.json, environments.<env>.noise, written by
// --measure-noise), above a floor. The record at this acceptance (the W1b chain: the adoption
// with the synth-theme core's S9/S10 and the knob's W1c, chromium 153.0.8010.12), the largest
// count over every view, at threshold 0.05 / 0:
//   STABILITY darwin-arm64 15 / 206 (10 runs), linux-x64 14 / 204 (10 runs)
// (Train 6 re-accepted all 16 views: K167's flush chip bar moved each 7 px up, and every capture
// pins the status bar's version label; before it, W1b's hardware look, the rack bay with nuts
// and plugs, re-accepted ten views; its noisiest
// is desktop-bay-light, linux 50 / 1167 over 20 runs; before it, darwin 0 / 145 and linux
// 8 / 169 over 10 runs; W1b on the look of dev-53's 40fc071d measured darwin 0 / 154 over 10
// runs and linux 8 / 248 over 20; W1b's first acceptance measured darwin 0 / 338 and linux
// 2 / 92 over 10 runs each, against the references of b1eb3e6d; one global faint bound of
// 1000 px followed from the 338.)
// The seeded mutations, each built into a scratch dist and recorded per view and environment by
// --record-seed (environments.<env>.seeds), are the standing proof that the bounds still catch a
// small edit: SEEDS below names the views each must fail, and the test fails when any of them
// stops exceeding its view's bound by SEED_MARGIN, so a looser factor, floor or noise fails it.
// The Synth layout check (b0's G2: 44 px targets, a 12 px font floor, no overflow at the phone
// size) lives in tests/browser/layout.cjs and is held here by its declarations, and its
// small-text ratchet and failure lines by their own functions, read out of the script (it runs a
// browser on load); the ratchet is judged on a map built here, never on the live entries.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync }
  from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/visual-synth.mjs');
const REF_DIR = path.join(ROOT, 'tests/visual/synth');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const load = async () => {
  assert.ok(existsSync(SCRIPT), 'scripts/visual-synth.mjs exists');
  return import('../../scripts/visual-synth.mjs');
};

// An RGBA buffer `w` x `h` of one grey, with `paint(x, y)` returning another grey or undefined.
const png = async (w, h, grey, paint = () => undefined) => {
  const { PNG } = (await import('pngjs')).default;
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const g = paint(x, y) ?? grey;
      p.data.set([g, g, g, 255], 4 * (y * w + x));
    }
  }
  return PNG.sync.write(p);
};

test('the gate counts pixels, not a percentage: a 1 px edit to a plate or knob fails', async () => {
  // Review of fd4abde6: 0.5 % of a desktop view (~7,800 px), pixelmatch at 0.12 without the
  // anti-aliased pixels, passed a knob pointer 1 px wider, plate screws moved 1 px and the
  // brushed finish removed. A colour difference is counted at a small threshold with the
  // anti-aliased pixels, and a faint one (any change of any channel) at threshold 0.
  const m = await load();
  assert.equal(m.MAX_MISMATCH_PCT, undefined, 'no percentage tolerance');
  assert.equal(m.MAX_FAINT_PX, undefined, 'no global faint bound');
  assert.equal(m.DIFF_THRESHOLD, 0.05);
  const src = read('scripts/visual-synth.mjs');
  assert.match(src, /\{ threshold: DIFF_THRESHOLD, includeAA: true \}/);
  assert.match(src, /\{ threshold: 0, includeAA: true \}/);
  assert.doesNotMatch(src, /includeAA: false/);
  // Judged on counts against the view's bounds: one pixel over either fails, a size change
  // always does, and a view without bounds fails closed.
  const b = { px: 24, faint: 64 };
  assert.equal(m.judge({ n: 24, faint: 64 }, b), null);
  assert.match(m.judge({ n: 25, faint: 25 }, b), /^25 px differ \(limit 24 at threshold 0\.05\)/);
  assert.match(m.judge({ n: 0, faint: 65 }, b),
    /^65 px differ faintly \(limit 64 at threshold 0\)/);
  assert.match(m.judge({ n: null, faint: null, note: 'size 1536x2204 vs 1536x2100' }, b),
    /size 1536x2204 vs 1536x2100/);
  assert.match(m.judge({ n: 0, faint: 0 }, null),
    /^no bounds: fewer than 10 stability runs recorded for this view/);
  // The compare itself, on pictures: a 5x5 block repainted is 25 colour pixels (fails); a broad
  // one-level shift (the brushed finish's size of change) is faint only and fails on its count.
  const base = await png(64, 64, 128);
  const same = m.diffPx(base, await png(64, 64, 128));
  assert.deepEqual([same.n, same.faint], [0, 0]);
  const block = m.diffPx(base, await png(64, 64, 128, (x, y) => (x < 5 && y < 5 ? 40 : undefined)));
  assert.ok(block.n >= 25 && m.judge(block, b), `a 5x5 block fails (${block.n} px)`);
  const shift = m.diffPx(base, await png(64, 64, 128, (x, y) => (y % 2 ? 129 : undefined)));
  assert.equal(shift.n, 0, 'a one-level shift is under the colour threshold');
  assert.equal(shift.faint, 64 * 32, 'and every shifted pixel is counted faintly');
  assert.match(m.judge(shift, b), /px differ faintly/);
});

// The status bar's version label changes with every release (one minor bump moved 488 px of
// desktop-panel-dark, 447 of them the tagline and readout shifted by its width): each capture
// pins it to one text first, so a release passes SYN and the status bar around it is still
// compared (b0, Train 6; the dist runs are in the Train 6 body).
test('the version label is pinned before each capture; nothing else in the page is', async () => {
  const m = await load();
  assert.deepEqual(m.PINNED_TEXT, [['[data-osc="status.version"]', 'v0.0.0']]);
  assert.match(read('src/index.html'),
    /<span class="osc-sb-version" data-osc="status\.version" x-text="'v' \+ BUILD\.label"/);
  const src = read('scripts/visual-synth.mjs');
  const capture = src.slice(src.indexOf("await ev('clear the notices'"),
    src.indexOf("const s = await ev('inspect the view'"));
  assert.match(capture, /pinText\.toString\(\)[\s\S]*PINNED_TEXT/,
    'the capture pins the release text after the notices clear and before the inspection');
  assert.match(capture, /release texts pinned/, 'a label not found fails the capture closed');
  // pinText sets exactly the pinned elements, each one, and nothing beside them.
  const el = (text) => ({ textContent: text });
  const version = el('v1.0.0-a');
  const tagline = el('Interactive Sound & Frequency Lab');
  const doc = { querySelectorAll: (q) => (q === '[data-osc="status.version"]' ? [version] : []) };
  assert.equal(m.pinText(doc, m.PINNED_TEXT), 1);
  assert.equal(version.textContent, 'v0.0.0');
  assert.equal(tagline.textContent, 'Interactive Sound & Frequency Lab');
  assert.equal(m.pinText({ querySelectorAll: () => [] }, m.PINNED_TEXT), 0);
});

test('each view has its own bounds, derived from its own recorded noise', async () => {
  // Review of b1eb3e6d (N1): one faint bound of 1000 px, set by the 338 px one desktop view
  // showed once, let a screw cap 0.5 px narrower through every panel view.
  const m = await load();
  assert.equal(m.NOISE_RUNS, 10);
  assert.equal(m.NOISE_FACTOR, 3);
  assert.equal(m.DIFF_FLOOR_PX, 24);
  assert.equal(m.FAINT_FLOOR_PX, 96);
  // A bound is the factor times the view's largest observed count, never below its floor, and
  // none without enough runs.
  assert.equal(m.bounds(undefined), null);
  assert.equal(m.bounds({ runs: 9, px: 0, faint: 0 }), null);
  assert.deepEqual(m.bounds({ runs: 10, px: 0, faint: 1 }), { px: 24, faint: 96 });
  assert.deepEqual(m.bounds({ runs: 10, px: 2, faint: 338 }), { px: 24, faint: 1014 });
  assert.deepEqual(m.bounds({ runs: 20, px: 9, faint: 40 }), { px: 27, faint: 120 });
  assert.match(read('tests/README.md'), new RegExp("each bound is 3 x the largest count of that "
    + "view's stability runs, at least 24 and 96 px"));
  const meta = JSON.parse(readFileSync(path.join(REF_DIR, 'references.json'), 'utf8'));
  const header = read('tests/unit/visual-synth.test.mjs').match(/^\/\/ {3}STABILITY (.*)$/m)[1];
  for (const env of ['darwin-arm64', 'linux-x64']) {
    const noise = meta.environments[env].noise;
    // Every view of the environment is measured, from at least NOISE_RUNS runs.
    for (const v of m.VIEWS) {
      const n = noise[v.id];
      assert.ok(n, `${env} ${v.id} has recorded stability runs`);
      assert.ok(n.runs >= m.NOISE_RUNS && Number.isInteger(n.px) && Number.isInteger(n.faint),
        `${env} ${v.id}: ${JSON.stringify(n)}`);
      assert.ok(m.bounds(n), `${env} ${v.id} has bounds`);
    }
    // The header states the record: the largest counts over every view of each environment.
    const px = Math.max(...m.VIEWS.map((v) => noise[v.id].px));
    const faint = Math.max(...m.VIEWS.map((v) => noise[v.id].faint));
    const runs = Math.min(...m.VIEWS.map((v) => noise[v.id].runs));
    assert.ok(header.includes(`${env} ${px} / ${faint} (${runs} runs)`),
      `the header's record of ${env} is ${px} / ${faint} over ${runs} runs: ${header}`);
    // Per view: the quiet views are held tighter than the noisiest one.
    const faints = m.VIEWS.map((v) => m.bounds(noise[v.id]).faint);
    assert.ok(Math.min(...faints) < Math.max(...faints)
      || Math.max(...faints) === m.FAINT_FLOOR_PX,
      `${env}: per-view faint bounds ${faints.join(', ')}`);
  }
});

test('the views are desktop and phone x Panel, Engines, XY x dark, light, plus the whole bay',
  async () => {
    const { VIEWS } = await load();
    const tabViews = VIEWS.filter((v) => !v.bay);
    const want = [];
    for (const [size, width, height] of [['desktop', 1536, 1024], ['phone', 390, 844]]) {
      for (const tab of ['panel', 'engines', 'xy']) {
        for (const theme of ['dark', 'light']) {
          want.push({ id: `${size}-${tab}-${theme}`, width, height, tab, theme });
        }
      }
    }
    assert.deepEqual(tabViews.map(({ id, width, height, tab, theme }) =>
      ({ id, width, height, tab, theme })), want);
    // The six cables span more than one viewport at the agreed heights (706 px from the Keys row
    // to the VCA row, under a docked keyboard), so the bay is seen whole in its own views at the
    // agreed widths, one per size and theme, each failing closed unless all 12 ends are visible.
    const bay = VIEWS.filter((v) => v.bay);
    assert.deepEqual(bay.map((v) => `${v.id} ${v.width} ${v.tab} ${v.theme}`), [
      'desktop-bay-dark 1536 panel dark', 'desktop-bay-light 1536 panel light',
      'phone-bay-dark 390 panel dark', 'phone-bay-light 390 panel light']);
    // At 1536x1400 and 390x1400 the docked keyboard covered six to eight of the 21 bay plates
    // (review of fd4abde6), and at 1536x2100 it held S&H's SMOOTH switch (review of b1eb3e6d):
    // a bay view's height is derived, not pinned. It opens at the size's height and grows until
    // the lowest edge it shows (the bay's card, its plates, every module card whose top is above
    // the dock) sits BAY_MARGIN above the dock, so a longer bay makes a taller picture.
    const { nextBayHeight, BAY_MARGIN } = await load();
    assert.deepEqual(bay.map((v) => `${v.id} ${v.width}x${v.height}`), [
      'desktop-bay-dark 1536x1024', 'desktop-bay-light 1536x1024',
      'phone-bay-dark 390x844', 'phone-bay-light 390x844']);
    assert.equal(BAY_MARGIN, 8);
    // Measured at 1536x2100 (darwin): the module grid ends at 1839, the dock's top is at 1743.
    assert.equal(nextBayHeight(2100, { bottom: 1839, dock: 1743 }), 2204);
    assert.equal(nextBayHeight(2204, { bottom: 1839, dock: 1847 }), 2204, 'settled');
    // A seventh cable listed lengthens the bay: the view grows by as much, so its picture's size
    // differs from the reference's and the compare fails on it.
    assert.equal(nextBayHeight(2204, { bottom: 1839 + 36, dock: 1847 }), 2240);
    const src = read('scripts/visual-synth.mjs');
    assert.ok(src.includes('const next = nextBayHeight(height, '
      + "await ev('measure what the bay view shows', bayExtent));"));
    assert.match(src, /the bay view's height did not settle: /);
    assert.match(src, /page\.setViewportSize\(\{ width: view\.width, height \}\)/);
    assert.equal(new Set(VIEWS.map((v) => v.id)).size, VIEWS.length, 'view ids are unique');
  });

test('a bay view fails closed unless the bay card, every plate and every module card shown sit '
  + 'above the dock', async () => {
  const src = read('scripts/visual-synth.mjs');
  assert.match(src, /querySelectorAll\('\[data-plate\]'\)/);
  assert.match(src, /bay plates not seen whole above the docked keyboard: /);
  assert.match(src, /if \(s\.plates\.length\) problems\.push\(/);
  // The module cards the view shows (drawn, top above the dock) are judged too (N2: on the
  // desktop S&H and OUTPUT ended at 1839 under a dock at 1743, and the check named only plates).
  assert.ok(src.includes('...modules.map((m) => out(m, '
    + "`module card ${m.getAttribute('data-module')}`))"));
  assert.match(src, /querySelectorAll\('#osc-view-synth \[data-module\]'\)/);
  // The header and the README state what the view holds, not the 12 cable ends alone.
  assert.match(src, /every plate of the bay \(\[data-plate\]\)/);
  assert.match(src, /and every module card shown \(\[data-module\]\)/);
  assert.match(read('tests/README.md'), new RegExp('every bay plate \\(`\\[data-plate\\]`\\), '
    + "every module card shown and the bay's card above the docked keyboard"));
});

test('each phone tab view shows its tab content above the docked keyboard, and a knob moves it',
  async () => {
    // At 390x844 the docked keyboard starts at y=483, so the first screen of a tab is the header
    // and the tab strip only: no phone tab view held a module, knob or the XY pad (F013 review).
    const { VIEWS, CONTENT } = await load();
    assert.deepEqual(CONTENT, { panel: '[data-module]', engines: '[data-module]',
      xy: '[data-osc="synth.xy.pad"]' });
    for (const v of VIEWS) {
      const phoneTab = !v.bay && v.width < 600;
      assert.equal(v.content, phoneTab ? CONTENT[v.tab] : null, `${v.id} scrolls to its content`);
      assert.equal(v.knob, phoneTab && v.tab !== 'xy', `${v.id} turns a knob it shows`);
    }
    const src = read('scripts/visual-synth.mjs');
    assert.ok(src.includes('else if (view.content) await ev(`scroll ${view.content} to the top`, '
      + 'scrollToTop, view.content);'));
    // Fails closed: the content under the chip nav, under the dock or covered; no knob seen whole;
    // a turned knob that keeps its value, scrolls the view or changes no pixel.
    for (const why of [/is under the chip nav/, /is under the docked keyboard/,
      /is covered at its top edge/, /no knob is seen whole above the docked keyboard/,
      /kept its value/, /scrolled the view/, /changed no pixel of the view/]) {
      assert.match(src, why);
    }
  });

test('the bay holds the six s-look cables, one from each source colour', async () => {
  const { CABLES } = await load();
  assert.deepEqual(CABLES, [['keys.velocity', 'vco2.tune'], ['vco1.audio', 'ring.modulator'],
    ['vco2.audio', 'mix.in4'], ['ring.audio', 'mix.in3'], ['noise.audio', 'mix.in1'],
    ['mix.audio', 'vca.audio']]);
  const sLook = read('tests/browser/synth.cjs');
  for (const [a, b] of CABLES) {
    assert.ok(sLook.includes(`['${a}', '${b}']`), `s-look patches ${a} -> ${b} too`);
  }
});

// A fake page: its wait rejects as Playwright's does (a TimeoutError, or another error), and its
// evaluate answers the observation, or throws when `seen` is an Error.
const fakePage = (seen) => ({ evaluate: async (fn, arg) => {
  if (seen instanceof Error) throw seen;
  return typeof seen === 'function' ? seen(arg) : seen;
} });
const timeout = (ms) => Object.assign(new Error(`page.waitForFunction: Timeout ${ms}ms exceeded.`),
  { name: 'TimeoutError' });

test('a wait that times out names the view, the wait, its deadline and what it last saw',
  async () => {
    const { namedWait } = await load();
    const page = fakePage({ ring: '#66798d', drawn: 0 });
    await assert.rejects(namedWait(page, 'phone-panel-dark', 'theme redraw',
      async (t) => { throw timeout(t); }, { observe: () => null, timeout: 15000 }),
    { message: 'SYN phone-panel-dark: theme redraw timed out after 15000ms '
      + '({"ring":"#66798d","drawn":0})' });
    // The observation is evaluated with the wait's own argument.
    await assert.rejects(namedWait(fakePage((a) => ({ wanted: a })), 'desktop-bay-light',
      'bay face shown', async () => { throw timeout(250); }, { observe: () => null, arg: 'bay',
        timeout: 250 }),
    { message: 'SYN desktop-bay-light: bay face shown timed out after 250ms ({"wanted":"bay"})' });
    // A timeout without a name (an older Playwright) is still a timeout; no observer says so.
    await assert.rejects(namedWait(fakePage(null), 'phone-xy-light', 'app ready',
      async () => { throw new Error('Timeout 15000ms exceeded.'); }),
    { message: 'SYN phone-xy-light: app ready timed out after 15000ms (nothing observed)' });
  });

test('a wait that fails otherwise names the view, the wait and the cause; a broken observer too',
  async () => {
    const { namedWait } = await load();
    await assert.rejects(namedWait(fakePage(new Error('Execution context was destroyed\nstack')),
      'phone-bay-dark', 'no CSS transition running',
      async () => { throw new Error('Target page, context or browser has been closed\nlog'); },
      { observe: () => null, timeout: 15000 }),
    { message: 'SYN phone-bay-dark: no CSS transition running failed after 15000ms '
      + '(observation failed: Execution context was destroyed): Target page, context or browser '
      + 'has been closed' });
    // A wait that holds returns its value untouched.
    assert.equal(await namedWait(fakePage(null), 'v', 'w', async () => 7), 7);
  });

test('a page step that stalls fails by its deadline, naming the view and the step', async () => {
  // Review of b1eb3e6d (N4): page.evaluate (frames() and every other read of the page), a key
  // press and a pointer move take no deadline of their own, so a stalled page hung the run.
  const { deadline, step, namedWait } = await load();
  const never = new Promise(() => {});
  await assert.rejects(deadline(never, 20), { name: 'TimeoutError',
    message: 'Timeout 20ms exceeded.' });
  assert.equal(await deadline(Promise.resolve(3), 20), 3);
  await assert.rejects(step(fakePage(null), 'desktop-bay-dark', 'two animation frames',
    () => never, { timeout: 30 }),
  { message: 'SYN desktop-bay-dark: two animation frames timed out after 30ms '
    + '(nothing observed)' });
  // A failed wait's observation is bounded too: the page may be the thing that stalled.
  const stalled = { evaluate: () => never };
  await assert.rejects(namedWait(stalled, 'phone-xy-dark', 'app ready',
    async () => { throw timeout(15000); }, { observe: () => null, observeTimeout: 20 }),
  { message: 'SYN phone-xy-dark: app ready timed out after 15000ms (observation failed: '
    + 'Timeout 20ms exceeded.)' });
  // Every page.evaluate, key press, pointer move and resize of the harness is a step's act (or
  // the observation's bounded evaluate), on the line that starts it.
  const src = read('scripts/visual-synth.mjs');
  const acts = src.split('\n').filter((l) => /page\.(evaluate|keyboard\.|mouse\.|setViewportSize)/
    .test(l) && !/^\s*(\/\/|\/?\*)/.test(l));
  assert.ok(acts.length >= 7, `the harness acts on the page (${acts.length})`);
  for (const l of acts) {
    assert.match(l, /\(\) => page\.|deadline\(page\.evaluate\(observe, arg\), observeTimeout\)/,
      `no deadline: ${l.trim()}`);
  }
  assert.match(src, /const ev = \(name, fn, arg\) => step\(page, id, name, \(\) => page\.evaluate/);
  assert.match(src, /const frames = \(page, view\) => step\(page, view, 'two animation frames',/);
});

test('every wait of the harness goes through namedWait, and the W1 signals are read by hook',
  async () => {
    const { CABLES, FREE_JACK } = await load();
    const src = read('scripts/visual-synth.mjs');
    // Each Playwright wait is the run callback of a namedWait: (timeout) => page.<wait>(...).
    // Every call that waits on the page (any waitFor*, goto, screenshot, a focus with a deadline)
    // is on the line of a namedWait run callback and passes its deadline; no fixed sleep.
    const waitCall = /\.(waitFor\w*|goto|screenshot)\(|\.focus\(\{ timeout/;
    const lines = src.split('\n').filter((l) => waitCall.test(l) && !/^\s*(\/\/|\*)/.test(l));
    assert.ok(lines.length >= 9, `the harness waits (${lines.length})`);
    for (const l of lines) {
      assert.match(l, /\(timeout\) => page\./, `outside namedWait: ${l.trim()}`);
      assert.match(l, /\{ (?:[\w: ]+, )?timeout \}|, timeout \}/, `no deadline: ${l.trim()}`);
    }
    assert.doesNotMatch(src, /waitForTimeout/);
    assert.match(src, /throw new Error\(`SYN \$\{view\}: \$\{wait\} \$\{timedOut \? 'timed out'/);
    // The theme redraw reads the free jack's ring through its data-ring hook (W1's jack.js), not
    // a child index, and that jack is one no cable patches.
    assert.doesNotMatch(src, /nth-child/);
    assert.match(src, /\[data-jack="\$\{v\.free\}"\] \[data-ring\]/);
    // One redraw check: the wait and its observation are the same function.
    assert.doesNotMatch(src, /function redrawn\(/);
    assert.match(src, /return v\.observe \? state : ok;/);
    assert.equal(FREE_JACK, 'mg.rate:in');
    assert.ok(!CABLES.flat().some((p) => FREE_JACK.startsWith(`${p}:`)), 'the ring jack is free');
    // Below xl the bay is its own face (V636): patched through its chip, and a jack that cannot
    // take focus fails closed instead of letting Enter patch nothing.
    assert.match(src, /if \(faced\) await showFace\(page, id, 'bay'\);/);
    assert.match(src, /if \(faced && !view\.bay\) await showFace\(page, id, 'panel'\);/);
    assert.match(src, /did not take focus/);
    // A hidden cable end names what covers it.
    assert.match(src, /return `\$\{id\} \(under /);
  });

// A run of runViews on a temporary reference directory: `shots` maps a view id to what its
// capture returns (a function may throw), each picture written to `out` as the harness does.
const tmpRun = async (opts, shots, { version = '153.0.8010.12', meta } = {}) => {
  const m = await load();
  const dir = mkdtempSync(path.join(tmpdir(), 'syn-'));
  const refDir = path.join(dir, 'refs');
  const out = path.join(dir, 'out');
  mkdirSync(refDir);
  mkdirSync(out);
  const metaFile = path.join(refDir, 'references.json');
  if (meta) writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  const views = m.VIEWS.slice(0, 3);
  const old = await png(10, 10, 10);
  for (const v of views) writeFileSync(path.join(refDir, `test-env-${v.id}.png`), old);
  const captureView = async (v) => {
    const shot = shots[v.id];
    const r = typeof shot === 'function' ? await shot(v) : shot;
    const file = path.join(out, `current-${v.id}.png`);
    writeFileSync(file, r.png || await png(10, 10, 200));
    return { file, errors: [], problems: [], probe: null, fit: null, height: v.height, ...r };
  };
  const files = () => Object.fromEntries(readdirSync(refDir).sort()
    .map((f) => [f, readFileSync(path.join(refDir, f)).toString('base64')]));
  const before = files();
  let result;
  let error;
  try {
    result = await m.runViews({ views, only: views.map((v) => v.id), out, update: false,
      noise: 0, seed: null, ...opts }, { captureView, version, env: 'test-env', refDir, metaFile });
  } catch (e) {
    error = e;
  }
  return { m, views, refDir, metaFile, before, after: files(), result, error, old };
};
const META = (views, extra = {}) => ({ schema: 1, environments: { 'test-env': {
  browser: '153.0.8010.12', engine: 'additive', cables: [],
  views: views.map((v) => `${v.id} ${v.width}x${v.height}`), noise: {}, seeds: {}, ...extra } } });

test('accepting writes nothing unless every view captures: no partial update', async () => {
  // Review of b1eb3e6d (N3): a failure at view k left views 1..k-1 overwritten and
  // references.json not, out of step with them.
  const { VIEWS } = await load();
  const three = VIEWS.slice(0, 3);
  const meta = META(three);
  for (const third of [() => { throw new Error('SYN x: theme redraw timed out after 15000ms'); },
    { problems: ['2 cables drawn in the bay, not 6'] }, { errors: ['ReferenceError: x'] }]) {
    const r = await tmpRun({ update: true }, { [three[0].id]: {}, [three[1].id]: {},
      [three[2].id]: third }, { meta });
    assert.match(String(r.error && r.error.message), /nothing accepted$/);
    assert.deepEqual(r.after, r.before, 'no reference and no manifest changed, no .tmp left');
  }
  // When every view captures, every picture and the manifest are written, and the noise and seed
  // counts of the accepted views (measured against the pictures they replace) are dropped.
  const noise = { [three[0].id]: { runs: 10, px: 0, faint: 3 }, [VIEWS[5].id]: { runs: 10, px: 0,
    faint: 4 } };
  const seeds = { s: { change: 'c', views: { [three[1].id]: { px: 9, faint: 9 },
    [VIEWS[5].id]: { px: 5, faint: 5 } } } };
  const ok = await tmpRun({ update: true }, { [three[0].id]: {}, [three[1].id]: {},
    [three[2].id]: { height: 900 } }, { meta: META(three, { noise, seeds }) });
  assert.equal(ok.error, undefined);
  for (const v of three) {
    assert.notEqual(ok.after[`test-env-${v.id}.png`], ok.before[`test-env-${v.id}.png`]);
  }
  const written = JSON.parse(readFileSync(ok.metaFile, 'utf8')).environments['test-env'];
  assert.equal(written.views[2], `${three[2].id} ${three[2].width}x900`, 'the captured height');
  assert.deepEqual(written.noise, { [VIEWS[5].id]: { runs: 10, px: 0, faint: 4 } });
  assert.deepEqual(written.seeds.s.views, { [VIEWS[5].id]: { px: 5, faint: 5 } });
  assert.ok(!Object.keys(ok.after).some((f) => f.endsWith('.tmp')));
});

test('a view that throws is a failure of that view, and the gate goes on to the next', async () => {
  const { VIEWS } = await load();
  const three = VIEWS.slice(0, 3);
  const noise = Object.fromEntries(three.map((v) => [v.id, { runs: 10, px: 0, faint: 0 }]));
  const r = await tmpRun({}, { [three[0].id]: () => { throw new Error('SYN v: stalled\nstack'); },
    [three[1].id]: {}, [three[2].id]: {} }, { meta: META(three, { noise }) });
  assert.equal(r.error, undefined);
  assert.equal(r.result.ok, false);
  assert.equal(r.result.failures[0], `${three[0].id}: capture failed: SYN v: stalled`);
  // The next views were captured and judged (a changed picture fails on its count).
  assert.ok(r.result.failures.some((f) => f.startsWith(`${three[2].id}: `)
    && /px differ/.test(f)), r.result.failures.join('\n'));
  assert.deepEqual(r.after, r.before, 'the gate writes nothing');
});

test('--measure-noise records the largest count per view over its runs, or nothing', async () => {
  const { VIEWS } = await load();
  const three = VIEWS.slice(0, 3);
  // The second view differs from its reference by one level on every third run: its largest
  // count over the ten runs is kept.
  let k = 0;
  const same = async () => ({ png: await png(10, 10, 10) });
  const r = await tmpRun({ noise: 10 }, { [three[0].id]: same, [three[2].id]: same,
    [three[1].id]: async () => ((k += 1) % 3 === 0 ? { png: await png(10, 10, 11) } : same()) },
  { meta: META(three) });
  assert.equal(r.error, undefined);
  const noise = JSON.parse(readFileSync(r.metaFile, 'utf8')).environments['test-env'].noise;
  assert.deepEqual(noise, { [three[0].id]: { runs: 10, px: 0, faint: 0 },
    [three[1].id]: { runs: 10, px: 0, faint: 100 }, [three[2].id]: { runs: 10, px: 0, faint: 0 } });
  // A run that fails writes no noise at all; nor does a build other than the references'.
  const bad = await tmpRun({ noise: 10 }, { [three[0].id]: same, [three[1].id]: same,
    [three[2].id]: { problems: ['the parked pointer hovers BUTTON'] } }, { meta: META(three) });
  assert.match(String(bad.error && bad.error.message), /nothing recorded$/);
  assert.deepEqual(bad.after, bad.before);
  const other = await tmpRun({ noise: 10 }, {}, { meta: META(three), version: '154.0.0.1' });
  assert.match(String(other.error && other.error.message), /re-accept them before measuring/);
  // The modes are one at a time, and a number of runs is a positive integer.
  const { parseArgs } = await load();
  assert.deepEqual(parseArgs(['dist', '--measure-noise', '10']).refused, []);
  assert.match(parseArgs(['--measure-noise', '0']).refused[0], /a number of runs/);
  assert.match(parseArgs(['--update-reference', '--measure-noise', '3']).refused[0], /one mode/);
  assert.match(parseArgs(['--record-seed', 'x']).refused[0], /--change/);
  assert.deepEqual(parseArgs(['/s/dist/index.html', '--record-seed', 'screw', '--change', 'r 3.7'])
    .seed, { name: 'screw', change: 'r 3.7' });
  assert.equal(parseArgs(['--record-seed', 'screw', '--change', 'r', '/s/d.html']).target,
    '/s/d.html');
});

test('an unknown view is refused before a browser starts', async () => {
  await load();
  const r = spawnSync(process.execPath, [SCRIPT, 'dist', '--view', 'nope'], { encoding: 'utf8',
    timeout: 20000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown view\(s\) nope; views: desktop-panel-dark,/);
});

// The size a PNG declares in its IHDR chunk.
const pngSize = (file) => {
  const b = readFileSync(file);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
};

test('every accepted environment lists every view at the size of its reference', async () => {
  const { VIEWS, ENGINE, CABLES } = await load();
  const meta = JSON.parse(readFileSync(path.join(REF_DIR, 'references.json'), 'utf8'));
  assert.equal(meta.schema, 1);
  assert.match(meta.note, /written only by node scripts\/visual-synth\.mjs --update-reference/);
  // F013 holds both environments: the Mac and the CI container (linux-x64).
  for (const env of ['darwin-arm64', 'linux-x64']) {
    assert.ok(meta.environments[env], `${env} is accepted`);
  }
  for (const [env, e] of Object.entries(meta.environments)) {
    assert.match(e.browser, /^\d+\.\d+\.\d+\.\d+$/, `${env} records its Chromium build`);
    assert.equal(e.engine, ENGINE, `${env} records the Engines tab's engine`);
    assert.deepEqual(e.cables, CABLES.map(([a, b]) => `${a} -> ${b}`));
    assert.deepEqual(e.views.map((x) => x.split(' ')[0]), VIEWS.map((v) => v.id));
    for (const [i, v] of VIEWS.entries()) {
      const file = path.join(REF_DIR, `${env}-${v.id}.png`);
      assert.ok(existsSync(file), `${env}-${v.id}.png`);
      const [w, h] = e.views[i].split(' ')[1].split('x').map(Number);
      assert.equal(w, v.width, `${env} ${v.id} width`);
      // A tab view is the size's own; a bay view's height is derived, taller than the size's.
      if (v.bay) assert.ok(h > v.height, `${env} ${v.id} grew to ${h}`);
      else assert.equal(h, v.height, `${env} ${v.id} height`);
      assert.equal(pngSize(file), `${w}x${h}`, `${env}-${v.id}.png is the listed size`);
    }
  }
});

/**
 * The seeded mutations, each a one-line change built into a scratch dist and recorded per view
 * by --record-seed, with the views each must fail in every environment. A seed fails a view
 * when a count exceeds that view's bound times SEED_MARGIN (on the colour count or the faint).
 */
const SEEDS = {
  // The pointer 1 px wider: every view that shows a knob whole.
  'knob-pointer-wider': ['desktop-panel-dark', 'desktop-panel-light', 'desktop-engines-dark',
    'desktop-engines-light', 'phone-panel-dark', 'phone-panel-light', 'phone-engines-dark',
    'phone-engines-light', 'desktop-bay-dark', 'desktop-bay-light'],
  // Each screw 1 px lower: the phone module cards' plates and the desktop bay's.
  'screw-lower': ['phone-panel-dark', 'phone-panel-light', 'desktop-bay-dark', 'desktop-bay-light'],
  // The brushed finish removed: faint only, in the dark theme above all (in the light one it is
  // a few levels, seen on the phone panel and the desktop bay).
  'no-brushed-finish': ['desktop-panel-dark', 'desktop-engines-dark', 'phone-panel-dark',
    'phone-panel-light', 'phone-engines-dark', 'desktop-bay-dark', 'desktop-bay-light'],
  // The screw cap 0.5 px narrower (N1): the bay views and the phone panel views.
  'screw-cap-narrower': ['phone-panel-dark', 'phone-panel-light', 'desktop-bay-dark',
    'desktop-bay-light'],
};

/**
 * Which count of each seed must exceed its bound on its own, by SEED_MARGIN: `px` (the colour
 * count at DIFF_THRESHOLD) for the edits that move an edge, the screw cap included (on the
 * cross-head screw of V5 it moves 56 px or more at 0.05 where one global faint bound let it
 * through every panel view, N1), and `faint` (threshold 0) for the finish, which moves no pixel
 * at 0.05. So a looser floor or factor of either bound fails here, not only both at once.
 */
const SEED_COUNTS = { 'knob-pointer-wider': ['px'], 'screw-lower': ['px'],
  'no-brushed-finish': ['faint'], 'screw-cap-narrower': ['px'] };

test('every seeded mutation still fails its views by a margin over their bounds', async () => {
  const m = await load();
  assert.equal(m.SEED_MARGIN, 1.5);
  const meta = JSON.parse(readFileSync(path.join(REF_DIR, 'references.json'), 'utf8'));
  // N1: the screw cap 0.5 px narrower fails the desktop bay views and a panel view.
  const screw = SEEDS['screw-cap-narrower'];
  assert.ok(screw.includes('desktop-bay-dark') && screw.includes('desktop-bay-light')
    && screw.some((v) => /-panel-/.test(v)), 'the screw cap seed fails the bay and a panel view');
  for (const env of ['darwin-arm64', 'linux-x64']) {
    const e = meta.environments[env];
    assert.deepEqual(Object.keys(e.seeds).sort(), Object.keys(SEEDS).sort(), `${env} seeds`);
    assert.deepEqual(Object.keys(SEED_COUNTS).sort(), Object.keys(SEEDS).sort());
    for (const [name, views] of Object.entries(SEEDS)) {
      const seed = e.seeds[name];
      assert.match(seed.change, /^src\/js\/\S+\.js: .+ -> .+/, `${name} says what it changed`);
      for (const id of views) {
        const c = seed.views[id];
        const b = m.bounds(e.noise[id]);
        assert.ok(c && b, `${env} ${name} ${id} is recorded and bounded`);
        for (const k of SEED_COUNTS[name]) {
          assert.ok(c[k] > m.SEED_MARGIN * b[k], `${env} ${name} ${id}: ${k} ${c[k]} px vs `
            + `its bound ${b[k]} x ${m.SEED_MARGIN} (counts ${c.px} / ${c.faint})`);
        }
      }
    }
  }
});

test('npm run test:visual runs the harness and CI uploads its output on failure', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['test:visual'], /&& node scripts\/visual-synth\.mjs dist$/);
  const ci = read('.github/workflows/ci.yml');
  const job = ci.slice(ci.indexOf('\n  visual:'), ci.indexOf('\n  knowledge:'));
  assert.match(job, /run: npm run test:visual/);
  assert.match(job, /tests\/visual\/out-synth\//);
  assert.match(read('.gitignore'), /tests\/visual\/out\*\//);
});

test('the layout check judges the Synth workspace at the phone size', () => {
  const src = read('tests/browser/layout.cjs');
  assert.match(src, /const SYNTH_PHONE = \[390, 844\];/);
  assert.match(src, /const SYNTH_TABS = \['panel', 'engines', 'xy'\];/);
  assert.match(src, /const FONT_MIN = 12;/);
  assert.match(src, /function measureFonts\(/);
  assert.match(src, /measureTouch, \[TOUCH_MIN, SYNTH_TARGETS\]/);
  assert.match(src, /measureView, 'synth'/);
  assert.match(src, /const KNOWN_SMALL_FONTS = new Map\(/);
});

// The layout script runs its browsers when loaded, so its pure parts are read out of it.
const layoutPart = (re) => {
  const m = read('tests/browser/layout.cjs').match(re);
  assert.ok(m, `layout.cjs holds ${re}`);
  return m[0];
};
const fontJudge = () => new Function(`${layoutPart(/function judgeFonts\([\s\S]*?\n\}/)}
return judgeFonts;`)();

test('a known small text is judged by its count per tab, and the count is a ratchet', () => {
  // Judged on a map built here, so the test holds judgeFonts whatever the live entries of
  // layout.cjs's KNOWN_SMALL_FONTS are (they ratchet down to none; review of b1eb3e6d, B1).
  const judgeFonts = fontJudge();
  const span = 'synth.modules span 11px';
  const li = 'synth.xy.pad li 10px';
  const known = new Map([
    [span, { panel: 3, engines: 2, xy: 1, where: 'synth/view/face.js: test entry' }],
    [li, { panel: 0, engines: 0, xy: 4, where: 'ui/kinds/xy-pad.js: test entry' }],
  ]);
  const today = (tab) => Object.fromEntries([...known].filter(([, k]) => k[tab] > 0)
    .map(([key, k]) => [key, k[tab]]));
  for (const tab of ['panel', 'engines', 'xy']) {
    assert.deepEqual(judgeFonts(today(tab), tab, known, 12), { bad: [], fewer: [] });
  }
  // The review's seeded input: face.js's collapse caret from text-xs to text-[11px] adds one
  // more 'synth.modules span 11px' per module card, a listed kind; it must fail.
  assert.deepEqual(judgeFonts({ ...today('panel'), [span]: 4 }, 'panel', known, 12).bad,
    [`text ${span} (4, 3 known on this tab) < 12 px`]);
  // An unlisted kind fails; a listed one drawn less often asks for its count to be lowered.
  assert.deepEqual(judgeFonts({ ...today('xy'), 'synth.bay h3 9px': 2 }, 'xy', known, 12).bad,
    ['text synth.bay h3 9px (2) < 12 px']);
  const fewer = { ...today('xy') };
  delete fewer[li];
  assert.deepEqual(judgeFonts(fewer, 'xy', known, 12), { bad: [], fewer: [`${li} xy: 4 -> 0`] });
  // With nothing known, any small text fails: the empty map is the floor of the ratchet.
  assert.deepEqual(judgeFonts({ [span]: 1 }, 'panel', new Map(), 12),
    { bad: [`text ${span} (1) < 12 px`], fewer: [] });
  // Only the declaration of the live map is held, and the message that lowers it.
  const src = read('tests/browser/layout.cjs');
  assert.match(src, /const KNOWN_SMALL_FONTS = new Map\(/);
  assert.match(src, /KNOWN_SMALL_FONTS fell \(fixed\? lower these counts/);
});

test('a failure line cut short says how many failures it left out', () => {
  const firstOf = new Function(`${layoutPart(/const firstOf = [\s\S]*?;\n/)}return firstOf;`)();
  const bad = Array.from({ length: 11 }, (_, i) => `f${i}`);
  assert.equal(firstOf(bad, 8), 'f0; f1; f2; f3; f4; f5; f6; f7 (+3 more)');
  assert.equal(firstOf(bad.slice(0, 8), 8), 'f0; f1; f2; f3; f4; f5; f6; f7');
  const src = read('tests/browser/layout.cjs');
  assert.doesNotMatch(src, /bad\.slice\(0, \d+\)\.join/, 'no failure line cuts silently');
  assert.match(src, /failures\.push\(`synth \$\{w\}x\$\{h\} \$\{tab\}: \$\{firstOf\(bad, 8\)\}`\)/);
});

test('the redraw waits for a drawn cable per cable the document has, never a literal six',
  async () => {
    const { redrawState } = await load();
    assert.equal(typeof redrawState, 'function', 'scripts/visual-synth.mjs exports redrawState');
    // K183's default Synth document holds its own Y cable: six patched make seven.
    const page = ({ cables, drawn }) => {
      const saved = { document: globalThis.document, window: globalThis.window,
        getComputedStyle: globalThis.getComputedStyle };
      globalThis.document = { documentElement: { dataset: { theme: 'dark' } },
        querySelector: () => ({ getAttribute: () => '#66798d' }),
        querySelectorAll: () => ({ length: drawn }) };
      globalThis.getComputedStyle = () => ({ getPropertyValue: () => ' #66798d ' });
      globalThis.window = { OSCILLA: { app: { synthDebug: () => ({ tab: 'panel',
        cables: Array.from({ length: cables }, (_, i) => ({ from: `a${i}`, to: `b${i}` })) }) } } };
      return () => Object.assign(globalThis, saved);
    };
    const v = { theme: 'dark', tab: 'panel', free: 'mg.rate:in', cables: 7 };
    for (const [cables, drawn, ok, why] of [[7, 7, true, 'seven cables, seven drawn'],
      [7, 6, false, 'one not drawn yet'], [6, 6, false, 'the patch is not complete'],
      [8, 8, false, 'a cable the capture does not expect']]) {
      const restore = page({ cables, drawn });
      try {
        assert.equal(redrawState(v), ok, why);
        assert.deepEqual([redrawState({ ...v, observe: true }).drawn,
          redrawState({ ...v, observe: true }).cables], [drawn, cables]);
      } finally { restore(); }
    }
    const src = read('scripts/visual-synth.mjs');
    assert.doesNotMatch(src, /drawn (?:===|!==) 6\b/, 'no literal count of drawn cables');
  });

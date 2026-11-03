// F013 W1: the SYN visual reference (scripts/visual-synth.mjs, tests/visual/synth/) is the one
// the plan agreed, held without a browser: the Synth workspace's Panel, Engines and XY tabs at
// desktop 1536x1024 and phone 390x844, in the dark and the light theme, a patch bay of six cables
// (one from each source colour, the s-look pairs of tests/browser/synth.cjs) seen whole, a 0.5 %
// pixel tolerance, references per environment written only by the script, and the harness wired
// into `npm run test:visual` and the CI visual job like scripts/visual-studio.mjs. The Synth
// layout check (b0's G2: 44 px targets, a 12 px font floor, no overflow at the phone size) lives
// in tests/browser/layout.cjs and is held here by its declarations, and its small-text ratchet
// and failure lines by their own functions, read out of the script (it runs a browser on load).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

test('the tolerance is 0.5 % of pixels, as in the other visual references', async () => {
  const m = await load();
  assert.equal(m.MAX_MISMATCH_PCT, 0.5);
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
    for (const v of bay) assert.ok(v.height > (v.width < 600 ? 844 : 1024), `${v.id} is taller`);
    assert.equal(new Set(VIEWS.map((v) => v.id)).size, VIEWS.length, 'view ids are unique');
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
    assert.match(src,
      /else if \(view\.content\) await page\.evaluate\(scrollToTop, view\.content\);/);
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

test('an unknown view is refused before a browser starts', async () => {
  await load();
  const r = spawnSync(process.execPath, [SCRIPT, 'dist', '--view', 'nope'], { encoding: 'utf8',
    timeout: 20000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown view\(s\) nope; views: desktop-panel-dark,/);
});

test('every accepted environment lists every view, and every listed reference exists', async () => {
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
    assert.deepEqual(e.views, VIEWS.map((v) => `${v.id} ${v.width}x${v.height}`));
    for (const v of VIEWS) {
      assert.ok(existsSync(path.join(REF_DIR, `${env}-${v.id}.png`)), `${env}-${v.id}.png`);
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
const KNOWN_RE = /const KNOWN_SMALL_FONTS = new Map\([\s\S]*?\n\]\);/;
const fontJudge = () => new Function(`${layoutPart(KNOWN_RE)}
${layoutPart(/function judgeFonts\([\s\S]*?\n\}/)}
return { KNOWN_SMALL_FONTS, judgeFonts };`)();

test('each known small text records its count per tab, and the count is a ratchet', () => {
  const { KNOWN_SMALL_FONTS: known, judgeFonts } = fontJudge();
  assert.ok(known.size > 0);
  for (const [key, k] of known) {
    for (const tab of ['panel', 'engines', 'xy']) {
      assert.ok(Number.isInteger(k[tab]) && k[tab] >= 0, `${key} counts the ${tab} tab`);
    }
    assert.ok(k.panel + k.engines + k.xy > 0, `${key} is drawn somewhere, or it is removed`);
    assert.match(k.where, /\.js: /);
  }
  const today = (tab) => Object.fromEntries([...known].filter(([, k]) => k[tab] > 0)
    .map(([key, k]) => [key, k[tab]]));
  for (const tab of ['panel', 'engines', 'xy']) {
    assert.deepEqual(judgeFonts(today(tab), tab, known, 12), { bad: [], fewer: [] });
  }
  // The review's seeded input: face.js's collapse caret from text-xs to text-[11px] adds one
  // more 'synth.modules span 11px' per module card, a listed kind; it must fail.
  const span = 'synth.modules span 11px';
  const more = { ...today('panel'), [span]: known.get(span).panel + 1 };
  assert.deepEqual(judgeFonts(more, 'panel', known, 12).bad,
    [`text ${span} (${known.get(span).panel + 1}, ${known.get(span).panel} known on this tab) `
      + '< 12 px']);
  // An unlisted kind fails; a listed one drawn less often asks for its count to be lowered.
  assert.deepEqual(judgeFonts({ ...today('xy'), 'synth.bay h3 9px': 2 }, 'xy', known, 12).bad,
    ['text synth.bay h3 9px (2) < 12 px']);
  const fewer = { ...today('xy') };
  delete fewer['synth.xy.pad li 10px'];
  assert.deepEqual(judgeFonts(fewer, 'xy', known, 12),
    { bad: [], fewer: [`synth.xy.pad li 10px xy: ${known.get('synth.xy.pad li 10px').xy} -> 0`] });
  const src = read('tests/browser/layout.cjs');
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

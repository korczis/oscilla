// The synth layer's legend measure (src/js/ui/synth/legend.js) against measured text (LEG-1):
// legendWidth laid "Minor pentatonic" out 99.84 units wide where DejaVu Sans Bold, the
// ubuntu-26.04 runner's system-ui, draws it 115.79, so the XY Mode dial's legend left its
// plate by 1.4 px in every engine there. tests/unit/fixtures/legend-widths.json holds the width
// of every legend the registry can draw, at 12 px in the panel's legend font, weights 400 and
// 600, in chromium, firefox and webkit on macOS, Ubuntu 24.04 and Ubuntu 26.04 (its own fonts,
// with DejaVu Sans, with Noto Sans). The estimate with its margin holds every one, every
// character of every legend has its own measured width, the margin is about twice the worst
// overrun of the bare table, and the module stays pure (no DOM, no font metrics read).
//   node --test tests/unit/ui-synth-legend.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import * as L from '../../src/js/ui/synth/legend.js';
import { NUMBERED_MIN } from '../../src/js/ui/synth/switch.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const FIXTURE = JSON.parse(readFileSync(join(ROOT, 'tests/unit/fixtures/legend-widths.json'),
  'utf8'));

/** Every legend the registry can draw: each enum's and boolean's option labels, each
 *  "n · label" of a dial of NUMBERED_MIN or more options, and a numbered dial's numerals. */
function registryLegends() {
  const out = new Set(['Off', 'On']);
  let most = 0;
  for (const def of NODE_REGISTRY.list()) {
    for (const p of Object.values(def.params || {})) {
      if (p.type !== 'enum' || !Array.isArray(p.options)) continue;
      most = Math.max(most, p.options.length);
      p.options.forEach(([, label], i) => {
        out.add(String(label));
        if (p.options.length >= NUMBERED_MIN) out.add(`${i + 1} · ${label}`);
      });
    }
  }
  for (let i = 1; i <= most; i++) out.add(String(i));
  return [...out].sort();
}

test('the fixture measures every legend the registry can draw, in each font set', () => {
  const legends = registryLegends();
  assert.ok(legends.length > 100, `${legends.length} legends`);
  assert.deepEqual(FIXTURE.weights, [400, 600]);
  assert.equal(FIXTURE.px, L.LEGEND_PX);
  const ids = FIXTURE.sets.map((s) => s.id);
  for (const p of ['macos', 'noble', 'resolute', 'resolute-dejavu', 'resolute-noto']) {
    for (const e of ['chromium', 'firefox', 'webkit']) {
      assert.ok(ids.includes(`${p}-${e}`), `${p} in ${e} is measured`);
    }
  }
  for (const s of FIXTURE.sets) {
    const missing = legends.filter((l) => !(Array.isArray(s.widths[l])
      && s.widths[l].length === 2 && s.widths[l].every((w) => w > 0)));
    assert.deepEqual(missing, [], `${s.id}: legends not measured`);
  }
});

test('legendWidth holds every measured legend, both weights, in every engine and font', () => {
  const short = [];
  let rows = 0;
  for (const s of FIXTURE.sets) {
    for (const [text, ws] of Object.entries(s.widths)) {
      const est = L.legendWidth(text, FIXTURE.px);
      ws.forEach((w, i) => {
        rows += 1;
        if (est < w) {
          short.push(`${s.id} "${text}" at ${FIXTURE.weights[i]}: ${est} < ${w} (${s.font})`);
        }
      });
    }
  }
  assert.ok(rows > 4000, `${rows} measured widths`);
  assert.deepEqual(short.slice(0, 12), [], `${short.length} widths over the estimate`);
  // A legend's size scales its estimate: twice the size, twice the width (to the rounding).
  for (const t of ['Minor pentatonic', 'Off', 'G#']) {
    const one = L.legendWidth(t, 12);
    assert.ok(Math.abs(L.legendWidth(t, 24) - 2 * one) <= 0.02, t);
    assert.equal(L.legendWidth(t), one, `${t}: LEGEND_PX by default`);
  }
});

test('every character of every legend has its own measured width; the fallback is wider', () => {
  const unknown = new Set();
  for (const l of registryLegends()) for (const ch of l) if (!L.LEGEND_GLYPHS.includes(ch)) {
    unknown.add(ch);
  }
  assert.deepEqual([...unknown], [], 'characters drawn at the fallback width');
  // A character the table lacks is laid out wider than any it has.
  const widest = Math.max(...[...L.LEGEND_GLYPHS].map((ch) => L.legendWidth(ch)));
  assert.ok(L.legendWidth('一') >= widest, 'an unmeasured character takes the widest');
  assert.equal(L.legendWidth(''), 0);
  assert.equal(Object.is(L.legendWidth(''), -0), false);
});

test('the margin is about twice the worst overrun of the bare table', () => {
  assert.ok(L.LEGEND_MARGIN > 0 && L.LEGEND_MARGIN < 0.5, String(L.LEGEND_MARGIN));
  let worst = 0;
  for (const s of FIXTURE.sets) {
    for (const [text, ws] of Object.entries(s.widths)) {
      const bare = L.legendWidth(text, 1200) / 100 / (1 + L.LEGEND_MARGIN);
      for (const w of ws) worst = Math.max(worst, w / bare - 1);
    }
  }
  assert.ok(worst > 0, `the bare table's worst overrun, ${worst}`);
  assert.ok(L.LEGEND_MARGIN >= 2 * worst - 1e-9, `${L.LEGEND_MARGIN} under twice ${worst}`);
  assert.ok(L.LEGEND_MARGIN <= 2 * worst + 0.02, `${L.LEGEND_MARGIN} over about twice ${worst}`);
});

test('legend.js stays pure: no DOM, no canvas, no font read', () => {
  const src = readFileSync(join(ROOT, 'src/js/ui/synth/legend.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /document\.|window\.|getComputedStyle|measureText|canvas|\bimport\b/,
    'legend.js reads nothing at run time');
});

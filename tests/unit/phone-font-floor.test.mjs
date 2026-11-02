// The phone layout contract (owner criterion ui-current#phone-whole, wave 2 of the page audit),
// as far as the stylesheets decide it without a browser. tests/browser/ui-current.cjs
// (`phone-whole`) measures the rendered result at 390x844 under a coarse pointer.
//
// - Font floor: below a 768 px viewport no text is under 12 px. tokens.css defines
//   --osc-fs-floor (12 px there, 0 px from 768 px); every --osc-fs-* token resolves to at least
//   12 px at a phone width and to its desktop value (DESKTOP_FS, the visual identity's sizes)
//   from 768 px; every px font size under 12 px in src/styles is max(<size>,
//   var(--osc-fs-floor)), and every Tailwind text-[<n>px] under 12 px in src/index.html and
//   src/js is listed debt (SMALL_FONT_DEBT, SMALL_TEXT_CLASS_DEBT: each entry names its owner,
//   is still small, and the lists only shrink).
// - Own panels first (responsive.css, below 1280 px): a workspace other than the Playground
//   shows only the panels it lists in data-osc-modes, each lab workspace of src/index.html is
//   in the rule that shows them, and Source & Pattern and Signal analysis are ordered after
//   every other panel there; no rule shows them in every workspace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const FLOOR = 12;
const PHONE_WIDTHS = [320, 360, 390, 430, 767, 767.98];
const WIDE_WIDTHS = [768, 1024, 1279, 1280, 1536, 1920];

// The desktop sizes of the type scale (tokens.css, calibrated on reference.png): from 768 px
// they are unchanged by the floor.
const DESKTOP_FS = {
  '2xs': 10, xs: 10.5, sm: 11.5, md: 12.5, lg: 13, xl: 14.25, nav: 13, tab: 10.6, control: 11,
  readout: 40, 'readout-unit': 22,
};

// Font sizes under 12 px that the floor does not reach yet, by "<file> <selector>": the Studio
// editor's own graph, library and timeline labels (the Studio lane; its node and lane geometry is
// sized to them). Only shrinks: a listed entry that is floored or gone fails until removed.
const SMALL_FONT_DEBT = new Set([
  'src/styles/studio.css .osc-sg-cat',
  'src/styles/studio.css .osc-sg-flag',
  'src/styles/studio.css .osc-sg-title',
  'src/styles/studio.css .osc-sg-port',
  'src/styles/studio.css .osc-si-h5',
  'src/styles/studio.css .osc-sl-cat',
  'src/styles/studio.css .osc-sl-ghost',
  'src/styles/studio-timeline.css .osc-stl-chip',
  'src/styles/studio-timeline.css .osc-stl-marker',
  'src/styles/studio-timeline.css .osc-stl-flag',
]);

// Tailwind text-[<n>px] classes under 12 px, by file: the Synth panel faces (the Synth lane).
// Only shrinks, as above.
const SMALL_TEXT_CLASS_DEBT = new Set(['src/js/synth/view/face.js']);

/** The body of the first `@media <query> {` block of `css`, braces matched. */
function mediaBlock(css, query) {
  const head = `@media ${query} {`;
  const start = css.indexOf(head);
  assert.ok(start >= 0, `no ${head}`);
  let depth = 1;
  let i = start + head.length;
  for (; i < css.length && depth; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
  }
  return css.slice(start + head.length, i - 1);
}

/** The flat rules of a block (no nested at-rules): [{ selectors: [..], decls: { prop: v } }]. */
function rules(block) {
  const out = [];
  for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    out.push({ selectors, decls });
  }
  return out;
}

/** --osc-fs-floor at a viewport width, from its one accepted form (a clamp step). */
function floorAt(value, vw) {
  const m = /^clamp\(0px,\s*calc\(\((\d+(?:\.\d+)?)px - 100vw\) \* (\d+)\),\s*(\d+(?:\.\d+)?)px\)$/
    .exec(value);
  assert.ok(m, `--osc-fs-floor is not clamp(0px, calc((<w>px - 100vw) * <k>), <f>px): ${value}`);
  const [, w, k, f] = m.map(Number);
  return Math.min(f, Math.max(0, (w - vw) * k));
}

/** A font size value at a viewport width: <n>px, or max(<n>px, var(--osc-fs-floor)). */
function sizeAt(value, floor) {
  const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
  if (px) return Number(px[1]);
  const max = /^max\((\d+(?:\.\d+)?)px,\s*var\(--osc-fs-floor\)\)$/.exec(value);
  assert.ok(max, `not a px size nor max(<px>, var(--osc-fs-floor)): ${value}`);
  return Math.max(Number(max[1]), floor);
}

const tokens = stripComments(read('src/styles/tokens.css'));
const rootDecls = Object.assign({}, ...rules(tokens).filter((r) => r.selectors.includes(':root'))
  .map((r) => r.decls));

test('--osc-fs-floor is 12 px below a 768 px viewport and 0 px from 768 px', () => {
  const v = rootDecls['--osc-fs-floor'];
  assert.ok(v, 'tokens.css :root defines no --osc-fs-floor');
  for (const w of PHONE_WIDTHS) assert.equal(floorAt(v, w), FLOOR, `at ${w} px`);
  for (const w of WIDE_WIDTHS) assert.equal(floorAt(v, w), 0, `at ${w} px`);
});

test('every --osc-fs-* token is at least 12 px on a phone and its desktop size from 768 px', () => {
  const floorValue = rootDecls['--osc-fs-floor'];
  const names = Object.keys(rootDecls)
    .filter((k) => /^--osc-fs-/.test(k) && k !== '--osc-fs-floor');
  assert.deepEqual(names.map((n) => n.slice('--osc-fs-'.length)).sort(),
    Object.keys(DESKTOP_FS).sort(), 'the type scale names changed: update DESKTOP_FS');
  for (const n of names) {
    const desktop = DESKTOP_FS[n.slice('--osc-fs-'.length)];
    for (const w of PHONE_WIDTHS) {
      const s = sizeAt(rootDecls[n], floorAt(floorValue, w));
      assert.ok(s >= FLOOR, `${n} is ${s} px at ${w} px, under ${FLOOR} px`);
    }
    for (const w of WIDE_WIDTHS) {
      assert.equal(sizeAt(rootDecls[n], floorAt(floorValue, w)), desktop, `${n} at ${w} px`);
    }
  }
});

test('every px font size under 12 px in src/styles takes the floor, or is listed debt', () => {
  const found = new Set();
  const bad = [];
  for (const f of readdirSync(join(ROOT, 'src/styles')).filter((x) => x.endsWith('.css'))) {
    const rel = `src/styles/${f}`;
    const css = stripComments(read(rel));
    for (const m of css.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().replace(/\s+/g, ' ');
      for (const d of m[2].matchAll(/font-size:\s*([^;]+)/g)) {
        const v = d[1].trim();
        const px = /^(\d+(?:\.\d+)?)px$/.exec(v);
        if (!px || Number(px[1]) >= FLOOR) continue;
        const key = `${rel} ${selector}`;
        found.add(key);
        if (!SMALL_FONT_DEBT.has(key)) bad.push(`${key}: ${v}`);
      }
    }
  }
  assert.deepEqual(bad, [], 'write max(<size>, var(--osc-fs-floor))');
  const healed = [...SMALL_FONT_DEBT].filter((k) => !found.has(k));
  assert.deepEqual(healed, [], 'no longer under 12 px: remove from SMALL_FONT_DEBT');
});

test('no Tailwind text-[<n>px] under 12 px in the markup or scripts, but listed debt', () => {
  const files = ['src/index.html'];
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (rel.endsWith('.js')) files.push(rel);
    }
  };
  walk('src/js');
  const small = new Set();
  for (const f of files) {
    for (const m of read(f).matchAll(/\btext-\[(\d+(?:\.\d+)?)px\]/g)) {
      if (Number(m[1]) < FLOOR) small.add(f);
    }
  }
  assert.deepEqual([...small].filter((f) => !SMALL_TEXT_CLASS_DEBT.has(f)), [],
    'use text-xs (12 px) or larger');
  assert.deepEqual([...SMALL_TEXT_CLASS_DEBT].filter((f) => !small.has(f)), [],
    'no longer small: remove from SMALL_TEXT_CLASS_DEBT');
});

// ---------------------------------------------------------------------------- own panels first
const responsive = stripComments(read('src/styles/responsive.css'));
const below1280 = rules(mediaBlock(responsive, '(max-width: 1279.98px)'));
const PLAYGROUND_PANELS = ['.osc-p-source', '.osc-p-analysis'];

/** The lab workspaces: the data-osc-modes of the panels of src/index.html, but the Playground. */
function labWorkspaces() {
  const html = read('src/index.html');
  const modes = new Set();
  for (const m of html.matchAll(/<section class="osc-panel[^"]*"[^>]*?data-osc-modes="([^"]+)"/g)) {
    for (const w of m[1].split(/\s+/)) if (w !== 'playground') modes.add(w);
  }
  return [...modes].sort();
}

test('below 1280 px a workspace but the Playground shows only the panels it lists', () => {
  const hide = below1280.find((r) => r.decls.display === 'none' && r.selectors
    .includes('.osc-app:not([data-mode="playground"]) .osc-panel[data-osc-modes]'));
  assert.ok(hide, 'no rule hides the unlisted panels outside the Playground below 1280 px');
  const shown = new Set(below1280.filter((r) => r.decls.display === 'flex')
    .flatMap((r) => r.selectors));
  const labs = labWorkspaces();
  assert.ok(labs.length >= 5, labs.join());
  for (const w of labs) {
    assert.ok(shown.has(`.osc-app[data-mode="${w}"] .osc-panel[data-osc-modes~="${w}"]`),
      `${w}: its panels are not shown below 1280 px`);
  }
});

test('below 1280 px the Playground panels follow every workspace panel outside the Playground',
  () => {
    const orders = [];
    for (const r of below1280) {
      if (r.decls.order === undefined) continue;
      for (const s of r.selectors) orders.push({ s, order: Number(r.decls.order) });
    }
    const lead = orders.filter((o) => PLAYGROUND_PANELS.some((p) => o.s.includes(p)));
    const rest = orders.filter((o) => /\.osc-p-[\w-]+$/.test(o.s) && !lead.includes(o));
    assert.equal(lead.length, PLAYGROUND_PANELS.length, JSON.stringify(lead));
    const last = Math.max(...rest.map((o) => o.order));
    for (const o of lead) {
      assert.ok(o.s.startsWith('.osc-app:not([data-mode="playground"]) '),
        `${o.s}: ordered in every workspace, the Playground's own included`);
      assert.ok(o.order > last, `${o.s}: order ${o.order} does not follow ${last}`);
    }
  });

test('no rule of responsive.css shows Source & Pattern or Signal analysis in every workspace',
  () => {
    const all = rules(responsive.replace(/@media[^{]*\{/g, ''));
    const forced = all.filter((r) => r.decls.display && r.decls.display !== 'none')
      .flatMap((r) => r.selectors)
      .filter((s) => PLAYGROUND_PANELS.some((p) => s.includes(p)) && !s.includes('[data-mode='));
    assert.deepEqual(forced, []);
  });

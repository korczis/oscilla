// Every class selector in src/styles must have a producer in the markup or the application
// code, so dead CSS cannot accumulate (completion ledger P2 "five dead CSS classes").
//
// A producer is the class name as a whole token (bounded by characters that cannot continue a
// class name) in src/index.html or src/js/**, outside comments: a class attribute, an Alpine
// :class string, a classList call, an h()/s() class option or a lookup table all write the name
// out. Names that only exist after string construction (`osc-block--${type}`, 'is-' + status)
// or that the build or a vendor library adds (Lucide icons, uPlot) cannot be found that way, so
// they are listed in DYNAMIC below, each with the code that builds it and the domain its
// variable part comes from; the list is checked against the source so it cannot outlive its
// builders.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MEASUREMENT_ROLES } from '../../src/js/measurement/views/common.js';
import { BLOCK_TYPES } from '../../src/js/sequencer/model.js';
import { PORT_VISUALS } from '../../src/js/studio/ports.js';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const NAME_CHAR = '[\\w-]';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokenRe = (name) => new RegExp(`(^|[^\\w-])${escapeRe(name)}(?!${NAME_CHAR})`);

/** Selector preludes of a stylesheet: comments dropped, @media/@supports entered, @keyframes
 * and other at-rule blocks skipped, declaration blocks skipped. */
function selectorsOf(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  let i = 0;
  const skipBlock = () => {
    for (let depth = 1; depth && i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
    }
  };
  const walk = () => {
    while (i < src.length) {
      const open = src.indexOf('{', i);
      const close = src.indexOf('}', i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) return;
      const prelude = src.slice(i, open).replace(/@import[^;]*;/g, '').trim();
      i = open + 1;
      if (/^@(media|supports|container|layer)\b/.test(prelude)) walk();
      else if (prelude.startsWith('@')) skipBlock();
      else { out.push(prelude); skipBlock(); }
    }
  };
  walk();
  return out;
}

/** Class names a selector prelude matches on; attribute values (`[class*="x"]`) are not classes. */
function classesOf(selector) {
  const bare = selector.replace(/"[^"]*"|'[^']*'/g, '""');
  return [...bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
}

/** Source text with comments removed: HTML comments, JS block comments and line comments that
 * start a line or follow whitespace (so `https://` inside a string survives). */
function stripComments(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

const ROOT_PATH = fileURLToPath(ROOT);
function filesUnder(rel) {
  return readdirSync(new URL(rel, ROOT), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => `${e.parentPath.slice(ROOT_PATH.length)}/${e.name}`);
}

const STYLE_FILES = filesUnder('src/styles').filter((f) => f.endsWith('.css')).sort();
const PRODUCER_FILES = ['src/index.html', ...filesUnder('src/js').sort()];
const producerText = new Map(PRODUCER_FILES.map((f) => [f, stripComments(read(f))]));
const allProducers = [...producerText.values()].join('\n');

/** class name -> the stylesheets whose selectors use it */
function styledClasses() {
  const classes = new Map();
  for (const f of STYLE_FILES) {
    for (const sel of selectorsOf(read(f))) {
      for (const c of classesOf(sel)) {
        if (!classes.has(c)) classes.set(c, new Set());
        classes.get(c).add(f.replace('src/styles/', ''));
      }
    }
  }
  return classes;
}

const lower = (xs) => xs.map((x) => x.toLowerCase());

// Class names that exist only after construction. `builder` is the exact source text that
// builds them, in `file`; `domain` is where the variable part comes from (imported when the
// source exports it, otherwise the literals the code assigns, which must appear quoted in src).
const DYNAMIC = [
  {
    prefix: 'osc-block--',
    values: ['am', 'burst', 'chirp', 'fm', 'pulse', 'random', 'silence', 'siren', 'sweep', 'tone'],
    builder: { file: 'src/js/labs/sequencer-panel.js', text: 'osc-block--${r.type}' },
    domain: BLOCK_TYPES,
    why: 'sequencer blocks and Studio pattern clips are coloured by their block type',
  },
  {
    prefix: 'osc-sg-glyph--',
    values: ['circle', 'diamond', 'square', 'triangle'],
    builder: { file: 'src/js/ui/studio/graph-editor.js', text: 'osc-sg-glyph--${p.shape}' },
    domain: Object.values(PORT_VISUALS).map((v) => v.shape),
    why: 'a Studio port glyph has the shape of its port type (PORT_VISUALS)',
  },
  {
    prefix: 'osc-sg-port--',
    values: ['in', 'out'],
    builder: { file: 'src/js/ui/studio/graph-editor.js', text: 'osc-sg-port--${p.direction}' },
    why: 'a Studio port is an input or an output',
  },
  {
    prefix: 'is-',
    values: ['analysis', 'audio', 'control', 'trigger'],
    builder: { file: 'src/js/ui/studio/graph-editor.js', text: 'is-${p.type.toLowerCase()}' },
    domain: lower(Object.keys(PORT_VISUALS)),
    why: 'Studio ports, edges and compact links carry their port type, lower-cased',
  },
  {
    prefix: 'osc-stl-clip--',
    values: ['event', 'measurement'],
    builder: { file: 'src/js/ui/studio/timeline-view.js', text: 'osc-stl-clip--${clip.kind}' },
    why: 'a timeline clip that is not a pattern is styled by its kind',
  },
  {
    prefix: 'osc-toast--',
    values: ['error', 'success', 'warning'],
    builder: { file: 'src/index.html', text: ":class=\"'osc-toast--' + a.level\"" },
    why: 'a toast is styled by its alert level',
  },
  {
    prefix: 'is-',
    values: ['blocked', 'done', 'todo', 'warn'],
    builder: { file: 'src/index.html', text: ":class=\"'is-' + s.status\"" },
    why: 'a MEASURE step carries its status (and a note its severity, \'is-\' + n.severity)',
  },
  {
    prefix: 'is-',
    values: ['calibrated', 'derived', 'observed', 'requested', 'warning'],
    builder: { file: 'src/index.html', text: ":class=\"'is-' + en.role\"" },
    domain: Object.keys(MEASUREMENT_ROLES),
    why: 'a MEASURE legend swatch carries its measurement colour role',
  },
  {
    packer: { file: 'scripts/pack-single-file.mjs', text: 'class="lucide"' },
    marker: { file: 'src/index.html', text: '<!-- @icon:' },
    names: ['lucide'],
    why: 'the packer replaces each <!-- @icon:<name> --> marker with an inline Lucide SVG of '
      + 'class "lucide" (the marker is a comment, so the token search cannot see it)',
  },
  {
    vendor: 'node_modules/uplot/dist/uPlot.min.css',
    names: ['u-legend', 'u-select'],
    why: 'uPlot creates these elements itself and styles them in its own stylesheet',
  },
];

const dynamicNames = (entry) => entry.names || entry.values.map((v) => entry.prefix + v);

test('the selector parser reads class names from selectors only', () => {
  const css = `@import "./x.css";
    /* .commented { } */
    .a, .b:not(.c) > .d::before { width: 1.5em; background: url(x.png); }
    @media (max-width: 767px) { .e .f { margin: .5rem; } }
    @keyframes spin { from { opacity: .2; } to { opacity: 1; } }
    .g:not([class*="osc-block--"]) { color: red; }`;
  const classes = selectorsOf(css).flatMap(classesOf);
  assert.deepEqual(classes, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(stripComments('a // .x\nb /* .y */ c <!-- .z --> "https://u"'),
    'a \nb   c   "https://u"');
});

test('every class selector in src/styles has a producer in src/index.html or src/js', () => {
  const allowed = new Set(DYNAMIC.flatMap(dynamicNames));
  const orphans = [];
  for (const [name, files] of styledClasses()) {
    if (allowed.has(name) || tokenRe(name).test(allProducers)) continue;
    orphans.push(`.${name} (${[...files].join(', ')})`);
  }
  assert.deepEqual(orphans.sort(), [],
    'CSS classes with no producer: delete the rules, or, when the name is built at runtime, '
    + 'add it to DYNAMIC with the code that builds it');
});

test('the DYNAMIC allowlist is exact: each builder exists, each name is styled, each value is '
  + 'in its domain', () => {
  const styled = styledClasses();
  for (const entry of DYNAMIC) {
    for (const name of dynamicNames(entry)) {
      assert.ok(styled.has(name), `DYNAMIC lists .${name}, which no rule in src/styles uses`);
    }
    if (entry.vendor) {
      const vendorCss = read(entry.vendor);
      for (const name of entry.names) {
        assert.ok(tokenRe(`.${name}`).test(vendorCss), `${entry.vendor} does not style .${name}`);
      }
      continue;
    }
    if (entry.packer) {
      assert.ok(read(entry.packer.file).includes(entry.packer.text),
        `${entry.packer.file} no longer writes ${entry.packer.text}`);
      assert.ok(read(entry.marker.file).includes(entry.marker.text),
        `${entry.marker.file} has no ${entry.marker.text} marker left`);
      continue;
    }
    const { file, text } = entry.builder;
    assert.ok(producerText.get(file).includes(text), `${file} no longer builds "${text}"`);
    assert.ok(text.includes(entry.prefix), `builder "${text}" does not write ${entry.prefix}`);
    for (const v of entry.values) {
      if (entry.domain) {
        assert.ok(entry.domain.includes(v), `${entry.prefix}${v}: "${v}" is not in its domain`);
      } else {
        assert.match(allProducers, new RegExp(`['"]${escapeRe(v)}['"]`, 'i'),
          `${entry.prefix}${v}: src never assigns "${v}"`);
      }
    }
  }
});

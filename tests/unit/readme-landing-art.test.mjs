// The README landing's artwork and diagram stay honest and self-contained.
//   node --test tests/unit/readme-landing-art.test.mjs
//
// What the landing is held to:
//   - the tagline "See sound. Shape frequency." follows the positioning sentence (Q002), never
//     precedes it, so the opening paragraph stays the sentence;
//   - every image README shows from docs/assets exists, has non-empty alt text, and is an SVG
//     with a <title> and a <desc>, no script, no event handler, no foreign object, no external
//     reference (only the SVG namespace URI) and no font file;
//   - an illustration says on its face that it is not a measurement, and README says so too;
//   - every colour an illustration uses is a colour of src/styles/tokens.css (OSCILLA's palette);
//   - README carries at least one native GitHub `mermaid` block with a flowchart, and every
//     edge of it ends on a node that block declares.
// The checks run on broken fixtures too, so they cannot pass by finding nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const SENTENCE = 'A zero-install, scientifically honest acoustic laboratory in your browser';
const TAGLINE = 'See sound. Shape frequency.';
const SVG_NS = 'http://www.w3.org/2000/svg';
const TOKENS = readFileSync(join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8').toLowerCase();

export function offPaletteColours(svg, tokens = TOKENS) {
  const colours = new Set((svg.match(/#[0-9a-fA-F]{6}\b/g) || []).map((c) => c.toLowerCase()));
  return [...colours].filter((c) => !tokens.includes(c)).sort();
}

function readmeImages(markdown) {
  return [...markdown.matchAll(/!\[([^\]]*)\]\((docs\/assets\/[^)\s]+)\)/g)]
    .map(([, alt, path]) => ({ alt, path }));
}

export function svgFailures(svg) {
  const failures = [];
  if (!/<title[^>]*>[^<]+<\/title>/.test(svg)) failures.push('no <title>');
  if (!/<desc[^>]*>[^<]+<\/desc>/.test(svg)) failures.push('no <desc>');
  if (/<script\b/i.test(svg)) failures.push('a <script>');
  if (/\son[a-z]+\s*=/i.test(svg)) failures.push('an event handler attribute');
  if (/<foreignObject\b/i.test(svg)) failures.push('a <foreignObject>');
  if (/@font-face|\.woff2?\b|\.ttf\b|\.otf\b/i.test(svg)) failures.push('a font file');
  const urls = [...svg.matchAll(/(?:https?:)?\/\/[^\s"')<>]+/g)].map((m) => m[0]);
  for (const url of urls) if (url !== SVG_NS) failures.push(`an external reference ${url}`);
  if (/(?:href|src)\s*=\s*["'](?!#)/i.test(svg)) failures.push('a non-local href or src');
  if (!/not a measurement/i.test(svg)) failures.push('no "not a measurement" label');
  return failures;
}

export function mermaidFailures(markdown) {
  const blocks = [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length === 0) return ['no mermaid block'];
  const failures = [];
  for (const block of blocks) {
    if (!/^\s*(flowchart|graph)\s+(LR|RL|TB|TD|BT)\b/m.test(block)) {
      failures.push('a mermaid block without a flowchart header');
      continue;
    }
    const declared = new Set([...block.matchAll(/\b([a-z][a-zA-Z0-9_]*)\s*\[/g)].map((m) => m[1]));
    const edges = [...block.matchAll(
      /^\s*([a-z][a-zA-Z0-9_]*)\s*(?:\[[^\]]*\])?\s*(?:-->|-\.->)\s*(?:\|[^|]*\|\s*)?([a-z][a-zA-Z0-9_]*)/gm,
    )];
    if (edges.length === 0) failures.push('a flowchart without edges');
    for (const [, from, to] of edges) {
      for (const id of [from, to]) {
        if (!declared.has(id)) failures.push(`an edge to an undeclared node ${id}`);
      }
    }
  }
  return failures;
}

test('the tagline follows the positioning sentence', () => {
  const s = README.indexOf(SENTENCE);
  const t = README.indexOf(TAGLINE);
  assert.ok(s >= 0, 'README carries the positioning sentence');
  assert.ok(t > s, 'README carries the tagline after the sentence');
});

test('every docs/assets image README shows exists, has alt text and is a clean SVG', () => {
  const images = readmeImages(README);
  assert.ok(images.length > 0, 'README shows at least one docs/assets image');
  for (const { alt, path } of images) {
    assert.ok(alt.trim().length >= 40, `${path} has descriptive alt text`);
    assert.ok(existsSync(join(ROOT, path)), `${path} exists`);
    assert.ok(path.endsWith('.svg'), `${path} is an SVG`);
    const svg = readFileSync(join(ROOT, path), 'utf8');
    assert.deepEqual(svgFailures(svg), [], path);
    assert.deepEqual(offPaletteColours(svg), [], `${path} uses only colours of src/styles/tokens.css`);
  }
  assert.match(README, /illustration[^.]*not (?:a )?measure/i, 'README says the art is not measured');
});

test('README carries a native mermaid flowchart whose edges end on declared nodes', () => {
  assert.deepEqual(mermaidFailures(README), []);
});

test('the checkers refuse broken fixtures', () => {
  const good = `<svg xmlns="${SVG_NS}"><title>t</title><desc>d</desc><text>not a measurement</text></svg>`;
  assert.deepEqual(svgFailures(good), []);
  assert.ok(svgFailures(good.replace('<title>t</title>', '')).includes('no <title>'));
  assert.ok(svgFailures(good.replace('</svg>', '<script>x()</script></svg>')).includes('a <script>'));
  assert.ok(svgFailures(good.replace('<text>', '<text onclick="x()">')).length > 0);
  assert.ok(svgFailures(good.replace('</svg>', '<image href="https://example.com/a.png"/></svg>')).length > 0);
  assert.ok(svgFailures(good.replace('not a measurement', 'a measurement')).length > 0);
  assert.deepEqual(offPaletteColours('<rect fill="#020B15"/>', '--osc-bg: #020b15;'), []);
  assert.deepEqual(offPaletteColours('<rect fill="#ffb020"/>', '--osc-bg: #020b15;'), ['#ffb020']);
  assert.deepEqual(mermaidFailures('no diagram'), ['no mermaid block']);
  assert.ok(mermaidFailures('```mermaid\nflowchart LR\n  a["A"] --> b\n```').length > 0);
  assert.deepEqual(mermaidFailures('```mermaid\nflowchart LR\n  a["A"] -->|"x"| b["B"]\n```'), []);
});

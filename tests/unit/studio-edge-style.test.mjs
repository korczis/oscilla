// G004: one edge style table for the full Studio graph and the Playground's compact Studio, and
// compact cables that end at their ports. studio.css holds one rule per signal type whose
// selector list names both views (.osc-sg-edge.is-<type> .osc-sg-edge-line and
// .osc-sc-link.is-<type>; AUDIO is the base rule .osc-sg-edge-line, .osc-sc-link); a port type
// of the compatibility matrix without its rule fails here instead of being drawn as AUDIO.
// portAnchor() of graph-geometry.js places a chip's inputs on its left edge and outputs on its
// right at (index + 1) / (count + 1) of its height, from the registry's port lists, so the LFO's
// CONTROL cable into the Filter's cutoff ends at a different point than the Envelope's AUDIO
// cable into the Filter's audio input (Subtractive Synth).
//   node --test tests/unit/studio-edge-style.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PORT_TYPE_LIST, PORT_VISUALS, typeCompatibility } from '../../src/js/studio/ports.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { STUDIO_TEMPLATES, templateModel } from '../../src/js/studio/templates/index.js';
import { cablesInto, compactView } from '../../src/js/ui/studio/compact.js';
import { cablePath, portAnchor } from '../../src/js/ui/studio/graph-geometry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const CSS = read('src/styles/studio.css');

/** Top-level rules of a stylesheet: { selectors: [text], decls: { prop: value } }. */
function rules(text) {
  const t = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let depth = 0;
  let buf = '';
  let current = null;
  for (const c of t) {
    if (c === '{') {
      depth += 1;
      if (depth === 1 && !buf.trim().startsWith('@')) {
        current = { selectors: buf.split(',').map((x) => x.trim().replace(/\s+/g, ' ')),
          decls: {} };
        out.push(current);
      } else if (depth === 1) current = null;
      buf = '';
    } else if (c === '}') {
      if (current && depth === 1 && buf.includes(':')) addDecl(current, buf);
      depth -= 1;
      if (depth === 0) current = null;
      buf = '';
    } else if (c === ';') {
      if (current && depth === 1) addDecl(current, buf);
      buf = '';
    } else buf += c;
  }
  return out;
}
function addDecl(rule, text) {
  const i = text.indexOf(':');
  if (i > 0) rule.decls[text.slice(0, i).trim()] = text.slice(i + 1).trim();
}

const GRAPH_BASE = '.osc-sg-edge-line';
const COMPACT_BASE = '.osc-sc-link';
const graphSel = (type) => `.osc-sg-edge.is-${type.toLowerCase()} .osc-sg-edge-line`;
const compactSel = (type) => `.osc-sc-link.is-${type.toLowerCase()}`;
/** A selector of the compact view's cables (not .osc-sc-links, the svg that holds them). */
const COMPACT_CABLE = /\.osc-sc-link(?![\w-])/;

/**
 * The edge style table read from the stylesheet: type -> { rule, both } for every type, or a
 * problem text. AUDIO is the base rule and must not have an .is-audio rule of its own; every
 * other type has exactly one rule, and it names both views.
 */
function styleTable(types, sheet = rules(CSS)) {
  const table = new Map();
  const problems = [];
  for (const type of types) {
    const own = sheet.filter((r) => r.selectors.includes(graphSel(type))
      || r.selectors.includes(compactSel(type)));
    if (type === 'AUDIO') {
      const base = sheet.filter((r) => r.selectors.includes(GRAPH_BASE)
        || r.selectors.includes(COMPACT_BASE));
      if (own.length) problems.push('AUDIO has an .is-audio rule beside the base rule');
      if (base.length !== 1) {
        problems.push(`AUDIO: ${base.length} base rules, expected one for both views`);
        continue;
      }
      table.set(type, { rule: base[0], both: base[0].selectors.includes(GRAPH_BASE)
        && base[0].selectors.includes(COMPACT_BASE) });
      continue;
    }
    if (own.length !== 1) {
      problems.push(`${type}: ${own.length} edge style rules, expected exactly one`);
      continue;
    }
    table.set(type, { rule: own[0], both: own[0].selectors.includes(graphSel(type))
      && own[0].selectors.includes(compactSel(type)) });
  }
  return { table, problems };
}

/** The port types of the compatibility matrix: its rows, each compatible with itself. */
const MATRIX_TYPES = PORT_TYPE_LIST.filter((t) => typeCompatibility(t, t) === null
  && PORT_TYPE_LIST.every((u) => u === t || typeof typeCompatibility(t, u) === 'string'));

test('every port type of the compatibility matrix has exactly one edge style', () => {
  assert.deepEqual(MATRIX_TYPES, ['AUDIO', 'CONTROL', 'TRIGGER', 'ANALYSIS']);
  // Every port the registry defines is of a matrix type, so every cable has a style.
  for (const def of NODE_REGISTRY.list()) {
    for (const p of [...def.inputs, ...def.outputs]) {
      assert.ok(MATRIX_TYPES.includes(p.type), `${def.type}.${p.id}: type ${p.type}`);
    }
  }
  const { table, problems } = styleTable(MATRIX_TYPES);
  assert.deepEqual(problems, []);
  assert.equal(table.size, MATRIX_TYPES.length);
  // Distinguishable without colour alone: each type its own stroke and dash pattern.
  const looks = MATRIX_TYPES.map((t) => `${table.get(t).rule.decls.stroke}|${
    table.get(t).rule.decls['stroke-dasharray'] || 'solid'}`);
  assert.equal(new Set(looks).size, looks.length, looks.join(', '));
  for (const t of MATRIX_TYPES.filter((x) => x !== 'AUDIO')) {
    assert.ok(table.get(t).rule.decls['stroke-dasharray'], `${t} has a dash pattern`);
  }
});

test('a port type the table lacks fails instead of being drawn as AUDIO', () => {
  const { table, problems } = styleTable([...MATRIX_TYPES, 'EVENT']);
  assert.equal(table.has('EVENT'), false);
  assert.deepEqual(problems, ['EVENT: 0 edge style rules, expected exactly one']);
  // A compact-only twin of a type is a second style: the table refuses it.
  const twin = rules(`${CSS}\n.osc-sc-link.is-control { stroke-dasharray: 5 3; }\n`);
  assert.deepEqual(styleTable(MATRIX_TYPES, twin).problems,
    ['CONTROL: 2 edge style rules, expected exactly one']);
});

test('the graph and the embedded Studio read the same rule, with the graph\'s values', () => {
  const { table } = styleTable(MATRIX_TYPES);
  for (const t of MATRIX_TYPES) assert.equal(table.get(t).both, true, `${t} names both views`);
  const audio = table.get('AUDIO').rule.decls;
  assert.equal(audio.stroke, 'var(--osc-blue-trace)');
  assert.equal(audio['stroke-width'], '1.5');
  assert.equal(table.get('CONTROL').rule.decls['stroke-dasharray'], '6 4');
  assert.equal(table.get('TRIGGER').rule.decls['stroke-dasharray'], '2 3');
  assert.equal(table.get('ANALYSIS').rule.decls['stroke-dasharray'], '9 3 2 3');
  // Muted is one rule for both views as well.
  const muted = rules(CSS).filter((r) => r.selectors.includes('.osc-sc-link.is-muted')
    || r.selectors.includes('.osc-sg-edge.is-muted .osc-sg-edge-line'));
  assert.equal(muted.length, 1);
  assert.equal(muted[0].selectors.length, 2);
  // No rule styles a compact cable alone (no second, compact-only width or dash).
  const alone = rules(CSS).filter((r) => r.selectors.some((x) => COMPACT_CABLE.test(x))
    && !r.selectors.some((x) => x.includes('.osc-sg-edge')));
  assert.deepEqual(alone.map((r) => r.selectors.join(', ')), []);
  // Both views put the type's class on the cable from the same port type.
  assert.match(read('src/js/ui/studio/graph-editor.js'),
    /class', `osc-sg-edge is-\$\{v\.type\.toLowerCase\(\)\}/);
  assert.match(read('src/js/ui/studio/compact.js'),
    /class: `osc-sc-link is-\$\{l\.type\.toLowerCase\(\)\}/);
  // Every cable of every shipped template has a style in the table.
  for (const tpl of STUDIO_TEMPLATES) {
    for (const l of compactView(templateModel(tpl.id), {}).path.links) {
      assert.ok(table.has(l.type), `${tpl.id} ${l.id}: ${l.type}`);
    }
  }
});

/** The edge legend of docs/v31/user-guide.md: lowercased first cell -> second cell. */
function guideLegend(text) {
  const at = text.indexOf('| Signal type | Cable |');
  assert.ok(at >= 0, 'the user guide has the edge legend');
  const rows = new Map();
  for (const line of text.slice(at).split('\n').slice(2)) {
    if (!line.startsWith('|')) break;
    const [name, cable] = line.split('|').slice(1, 3).map((x) => x.trim());
    rows.set(name.toLowerCase(), cable);
  }
  return rows;
}

test('the user guide\'s edge legend says what the style table draws', () => {
  // Typed once in the guide, checked here: each type's colour, its PORT_VISUALS cable word
  // (the Inspector's name for it) and its dash numbers in the stylesheet's order.
  const legend = guideLegend(read('docs/v31/user-guide.md'));
  const { table } = styleTable(MATRIX_TYPES);
  const nums = (s) => (s.match(/\d+(?:\.\d+)?/g) || []).join(' ');
  const colour = (stroke) => /--osc-([a-z]+)/.exec(stroke)[1];
  for (const t of MATRIX_TYPES) {
    const row = legend.get(t.toLowerCase());
    assert.ok(row, `${t} has a legend row`);
    const { decls } = table.get(t).rule;
    assert.ok(row.startsWith(`${colour(decls.stroke)}, ${PORT_VISUALS[t].cable}`), `${t}: ${row}`);
    assert.equal(nums(row), decls['stroke-dasharray'] || '', `${t} dash numbers`);
  }
  const muted = rules(CSS).find((r) => r.selectors.includes('.osc-sc-link.is-muted'));
  assert.equal(nums(legend.get('muted (any type)')), muted.decls['stroke-dasharray']);
  assert.equal(legend.size, MATRIX_TYPES.length + 1, 'no row the table does not draw');
});

const CHIP = Object.freeze({ x: 100, y: 40, w: 80, h: 24 });

test('portAnchor ends the Filter\'s cutoff and audio cables at different points', () => {
  const v = compactView(templateModel('subtractive-synth'), {});
  const into = v.path.links.filter((l) => l.to === 'filter-1');
  const audio = into.find((l) => l.type === 'AUDIO');
  const control = into.find((l) => l.type === 'CONTROL');
  assert.deepEqual([audio.id, audio.toPort, control.id, control.toPort],
    ['edge-2', 'audio', 'edge-4', 'frequency']);
  const filter = NODE_REGISTRY.get(v.path.nodes.find((n) => n.id === 'filter-1').type);
  const a = portAnchor(CHIP, filter, 'in', audio.toPort);
  const c = portAnchor(CHIP, filter, 'in', control.toPort);
  assert.equal(a.x, CHIP.x, 'inputs are on the left edge');
  assert.equal(c.x, CHIP.x);
  assert.notEqual(a.y, c.y, 'the CONTROL and AUDIO ends differ');
  // (index + 1) / (count + 1): the audio input first, then the cutoff's PARAMETER row.
  const ids = filter.inputs.map((p) => p.id);
  const n = ids.length + 1;
  assert.equal(a.y, CHIP.y + CHIP.h * (ids.indexOf('audio') + 1) / n);
  assert.equal(c.y, CHIP.y + CHIP.h * (ids.indexOf('frequency') + 1) / n);
  assert.equal(filter.inputs[ids.indexOf('frequency')].role, 'PARAMETER');
  assert.ok(c.y > a.y, 'the parameter row is below the audio input');
  // Outputs on the right edge.
  const lfo = NODE_REGISTRY.get('lfo');
  const o = portAnchor(CHIP, lfo, 'out', control.fromPort);
  assert.equal(o.x, CHIP.x + CHIP.w);
  assert.equal(o.y, CHIP.y + CHIP.h * (lfo.outputs.findIndex((p) => p.id === control.fromPort)
    + 1) / (lfo.outputs.length + 1));
});

test('portAnchor: no ports, an unknown port, ten inputs', () => {
  const mid = { x: CHIP.x, y: CHIP.y + CHIP.h / 2 };
  assert.deepEqual(portAnchor(CHIP, { inputs: [], outputs: [] }, 'in', 'audio'), mid);
  assert.deepEqual(portAnchor(CHIP, null, 'in', 'audio'), mid);
  assert.deepEqual(portAnchor(CHIP, { inputs: [{ id: 'a' }] }, 'in', 'nope'), mid);
  assert.deepEqual(portAnchor(CHIP, { outputs: [] }, 'out', 'audio'),
    { x: CHIP.x + CHIP.w, y: CHIP.y + CHIP.h / 2 });
  assert.deepEqual(portAnchor(null, null, 'in', 'x'), { x: 0, y: 0 });
  const ten = { inputs: Array.from({ length: 10 }, (_, i) => ({ id: `in-${i}` })), outputs: [] };
  const ys = ten.inputs.map((p) => portAnchor(CHIP, ten, 'in', p.id).y);
  for (let i = 0; i < ys.length; i += 1) {
    assert.ok(Math.abs(ys[i] - (CHIP.y + CHIP.h * (i + 1) / 11)) < 1e-9);
    assert.ok(ys[i] > CHIP.y && ys[i] < CHIP.y + CHIP.h, 'inside the chip');
    if (i) assert.ok(ys[i] > ys[i - 1], 'in port order');
  }
  assert.equal(new Set(ys).size, 10);
});

test('a short compact cable between ports at two heights stays inside the gap', () => {
  // The graph's 40-unit handle would loop a 22 px cable past both chips; compact.js passes 4.
  assert.equal(cablePath(0, 0, 22, 10, 4), 'M 0 0 C 11 0, 11 10, 22 10');
  assert.equal(cablePath(0, 0, 22, 10), 'M 0 0 C 40 0, -18 10, 22 10', 'the graph default');
  assert.match(read('src/js/ui/studio/compact.js'), /cablePath\(p\.x, p\.y, q\.x, q\.y, 4\)/);
});

test('selecting a cable\'s target chip states the cable\'s type', () => {
  const m = templateModel('subtractive-synth');
  const said = cablesInto(m, 'filter-1');
  assert.match(said, /^Audio cable\. Connection from Envelope 1 /);
  assert.match(said, /Control cable\. Connection from LFO 1 .*Filter 1 cutoff/);
  assert.equal(cablesInto(m, 'osc-1'), '', 'a chip without cables in says nothing more');
});

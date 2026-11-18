// The Studio node registry's authoring check (src/js/studio/registry.js validateNodeDefinition,
// createNodeRegistry, validateParamValue, summarize): every rule a node definition must keep
// names the definition and the field it breaks, one sentence per fault, from a valid definition
// (the Filter's) broken one field at a time; a registry built from a faulty or duplicated
// definition throws with every fault; an id parameter's value and an unknown parameter type are
// judged; a summary that throws falls back to the display name.
//   node --test tests/unit/studio-registry-definition-check.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NODE_DEFINITIONS, NODE_REGISTRY, createNodeRegistry, validateNodeDefinition, validateParamValue,
} from '../../src/js/studio/registry.js';

const FILTER = NODE_DEFINITIONS.find((d) => d.type === 'filter');

/** A copy of the Filter's raw definition that a case may break without touching the original. */
function filterDef(edit = () => {}) {
  const d = { ...FILTER, aliases: [...FILTER.aliases], params: FILTER.params.map((p) => ({ ...p })),
    inputs: (FILTER.inputs || []).map((p) => ({ ...p })),
    outputs: (FILTER.outputs || []).map((p) => ({ ...p })),
    capabilities: { ...FILTER.capabilities }, help: { ...FILTER.help } };
  edit(d);
  return d;
}
const param = (d, key) => d.params.find((p) => p.key === key);

test('the Filter\'s definition is valid as written and as completed', () => {
  assert.deepEqual(validateNodeDefinition(filterDef()), []);
  assert.deepEqual(validateNodeDefinition(NODE_REGISTRY.get('filter')), []);
  assert.deepEqual(validateNodeDefinition(null), ['definition is not an object']);
  assert.deepEqual(validateNodeDefinition('filter'), ['definition is not an object']);
});

const CASES = [
  ['an invalid type id', (d) => { d.type = 'Bad Type'; }, 'Bad Type: invalid type id'],
  ['no display name', (d) => { d.displayName = ''; }, 'filter: missing displayName'],
  ['an invalid id prefix', (d) => { d.idPrefix = 'Filter-1'; }, 'filter: invalid idPrefix'],
  ['an unknown category', (d) => { d.category = 'toys'; }, 'filter: unknown category'],
  ['an empty alias', (d) => { d.aliases.push(''); }, 'filter: aliases must be non-empty strings'],
  ['aliases not a list', (d) => { d.aliases = 'lowpass'; },
    'filter: aliases must be non-empty strings'],
  ['a duplicate parameter', (d) => { d.params.push({ ...param(d, 'enabled') }); },
    'filter: duplicate parameter enabled'],
  ['an invalid parameter key', (d) => { param(d, 'enabled').key = '1st'; },
    'filter: invalid parameter key 1st'],
  ['an unknown parameter type', (d) => { param(d, 'enabled').type = 'string'; },
    'filter: enabled: unknown parameter type'],
  ['a parameter without a label', (d) => { param(d, 'enabled').label = ''; },
    'filter: enabled: missing label'],
  ['an empty numeric range', (d) => { Object.assign(param(d, 'gain'), { min: 3, max: 3 }); },
    'filter: gain: needs a finite range'],
  ['a list without length bounds', (d) => {
    d.params.push({ key: 'steps', type: 'list', label: 'Steps', min: 0, max: 1, minLength: 4,
      maxLength: 2, default: [0, 0, 0] });
  }, 'filter: steps: needs list length bounds'],
  ['an enum without options', (d) => { param(d, 'type').options = []; },
    'filter: type: needs options'],
  ['a log scale reaching zero', (d) => { param(d, 'Q').min = 0; },
    'filter: Q: a log scale needs min > 0'],
  ['an automated enum', (d) => { param(d, 'slope').automatable = true; },
    'filter: slope: only numeric parameters can be automated or modulated'],
  ['a soft range outside the range', (d) => { param(d, 'frequency').softRange = [1, 20000]; },
    'filter: frequency: softRange outside the range'],
  ['a lane range outside the range', (d) => { param(d, 'Q').laneRange = [0.1, 1e6]; },
    'filter: Q: laneRange outside the range'],
  ['a default outside the range', (d) => { param(d, 'gain').default = 1e9; },
    `filter: gain: default must be between ${param(FILTER, 'gain').min} and `
      + `${param(FILTER, 'gain').max}`],
  ['a modulation depth wider than the range', (d) => { param(d, 'gain').modDepth = 1e9; },
    'filter: gain: modDepth exceeds the range'],
  ['an output marked as input', (d) => { d.outputs[0].direction = 'in'; },
    'filter: port audio has wrong direction'],
  ['a duplicate output port', (d) => { d.outputs.push({ ...d.outputs[0] }); },
    'filter: duplicate out port audio'],
  ['a signal input named like a modulatable parameter', (d) => {
    d.inputs.push({ ...d.inputs.find((p) => p.role !== 'PARAMETER'), id: 'gain' });
  }, 'filter: port id gain collides'],
  ['an invalid compiler key', (d) => { d.compiler = 'filters'; },
    'filter: missing or invalid compiler key'],
  ['an invalid reuse key', (d) => { d.reuses = ['no-hash.js']; },
    'filter: invalid reuse no-hash.js'],
  ['an unknown clip kind', (d) => { d.clipKinds = ['video']; }, 'filter: unknown clip kind video'],
  ['a capability that is not a boolean', (d) => { d.capabilities.offline = 'yes'; },
    'filter: capability offline missing'],
  ['a missing help field', (d) => { delete d.help.constraints; },
    'filter: help.constraints missing'],
  ['a non-positive instance limit', (d) => { d.maxInstances = 0; },
    'filter: maxInstances must be a positive integer'],
  ['no summary', (d) => { delete d.summary; }, 'filter: missing summary formatter'],
  ['an empty summary', (d) => { d.summary = () => ''; },
    'filter: summary of the defaults is empty'],
  ['a summary that throws', (d) => { d.summary = () => { throw new Error('bad'); }; },
    'filter: summary throws: bad'],
];

for (const [what, edit, message] of CASES) {
  test(`a definition with ${what} is refused: "${message}"`, () => {
    const errors = validateNodeDefinition(filterDef(edit));
    assert.ok(errors.includes(message), `${message} not in ${JSON.stringify(errors)}`);
  });
}

test('a registry of a faulty or duplicated definition throws with every fault', () => {
  assert.throws(() => createNodeRegistry([filterDef(), filterDef()]),
    { name: 'TypeError', message: 'createNodeRegistry: filter: duplicate type' });
  assert.throws(() => createNodeRegistry([filterDef((d) => {
    d.displayName = '';
    d.maxInstances = -1;
  })]), { message: 'createNodeRegistry: filter: missing displayName; filter: maxInstances must '
    + 'be a positive integer' });
  const one = createNodeRegistry([filterDef()]);
  assert.equal(one.list().length, 1);
  assert.equal(one.get('filter').displayName, FILTER.displayName);
});

test('an id parameter: null only when nullable, otherwise the pattern decides', () => {
  const id = { type: 'id', pattern: /^[a-z]+-\d+$/, nullable: false };
  assert.equal(validateParamValue(id, null), 'must not be empty');
  assert.equal(validateParamValue({ ...id, nullable: true }, null), null);
  assert.equal(validateParamValue(id, 'osc-1'), null);
  assert.equal(validateParamValue(id, 'Osc 1'), 'has an invalid format');
  assert.equal(validateParamValue(id, 7), 'has an invalid format');
  assert.equal(validateParamValue({ type: 'colour' }, 'red'), 'unknown parameter type');
});

test('summarize names an unknown node and falls back to the display name when it throws', () => {
  const R = createNodeRegistry([filterDef()]);
  assert.equal(R.summarize(null), 'Unknown node type');
  assert.equal(R.summarize({ type: 'gain', params: {} }), 'Unknown node type');
  assert.equal(typeof R.summarize({ type: 'filter', params: {} }), 'string');
  // The definition's summary is validated on the defaults; a value it cannot format falls back.
  const throwing = createNodeRegistry([filterDef((d) => {
    d.summary = (p) => { if (p.frequency === 1234) throw new Error('nope'); return 'Filter'; };
  })]);
  assert.equal(throwing.summarize({ type: 'filter', params: { frequency: 1234 } }),
    FILTER.displayName);
  assert.equal(throwing.summarize({ type: 'filter', params: {} }), 'Filter');
});

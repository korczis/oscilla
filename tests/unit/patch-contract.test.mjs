// The patch contract coverage matrix (plan K164; the owner's program B of 2026-11-03): derived
// from the registry, every port and parameter field declared, defaulted or missing; the table is
// current; and the missing counts only fall (tests/unit/patch-contract-baseline.json).
//
//   node --test tests/unit/patch-contract.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pc = await import('../../scripts/patch-contract.mjs').catch(() => ({}));
const { NODE_REGISTRY } = await import('../../src/js/studio/registry.js');
const ports = await import('../../src/js/studio/ports.js');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const port = (o) => ({ id: 'audio', direction: 'in', type: 'AUDIO', role: 'SIGNAL',
  multiple: false, required: false, ...o });
const param = (o) => ({ key: 'gain', type: 'number', unit: 'dB', default: 0, min: -60, max: 0,
  scale: 'linear', automatable: true, modulatable: false, ...o });
const fixture = (defs) => ({ list: () => defs });

test('the matrix counts every node type, port and parameter of the registry', () => {
  assert.equal(typeof pc.contractMatrix, 'function');
  const m = pc.contractMatrix(NODE_REGISTRY);
  const defs = NODE_REGISTRY.list();
  assert.equal(m.types, defs.length);
  assert.equal(m.ports, defs.reduce((n, d) => n + d.inputs.length + d.outputs.length, 0));
  assert.equal(m.params, defs.reduce((n, d) => n + d.params.length, 0));
  for (const [f, c] of Object.entries(m.port)) {
    const applies = f === 'unconnected' ? defs.reduce((n, d) => n + d.inputs.length, 0) : m.ports;
    assert.equal(c.declared + c.defaulted + c.missing, applies, `port.${f} covers every port`);
  }
  assert.equal(m.param.live.declared + m.param.live.defaulted + m.param.live.missing, m.params);
});

test('declared, defaulted and missing apart; a field that does not apply is not counted', () => {
  const m = pc.contractMatrix(fixture([
    { type: 'a', inputs: [port({ channels: 1, rate: 'audio', unconnected: 'silent', monitor: true,
      compact: true, version: 1 })], outputs: [port({ direction: 'out', channels: 2 })],
    params: [param({ live: 'immediate' }), param({ key: 'mode', type: 'enum',
      options: [['x', 'X']], unit: '', scale: undefined, live: 'note', defaulted: ['live'] }),
    param({ key: 'on', type: 'boolean', default: undefined, min: undefined, max: undefined })] },
    { type: 'b', inputs: [port({ role: 'PARAMETER', param: { key: 'cut' }, rate: 'control',
      defaulted: ['rate'] })], outputs: [], params: [param({ key: 'cut', modulatable: true,
      unit: undefined })] },
  ]));
  assert.deepEqual(m.port.channels, { declared: 2, defaulted: 0, missing: 1 });
  assert.deepEqual(m.port.rate, { declared: 1, defaulted: 1, missing: 1 }, 'a parameter port is '
    + 'derived, and a named default is defaulted');
  assert.deepEqual(m.port.unconnected, { declared: 1, defaulted: 0, missing: 1 }, 'outputs: n/a');
  assert.deepEqual(m.param.live, { declared: 1, defaulted: 1, missing: 2 });
  assert.deepEqual(m.param.range, { declared: 3, defaulted: 0, missing: 0 }, 'a switch has none');
  assert.deepEqual(m.param.mapping.missing, 0, 'a choice has no mapping');
  assert.deepEqual(m.param.unit, { declared: 3, defaulted: 0, missing: 1 });
  assert.deepEqual(m.param.default, { declared: 3, defaulted: 0, missing: 1 });
  assert.deepEqual(m.missing['param.unit'], ['b']);
  const counts = pc.missingCounts(m);
  assert.equal(counts['port.version'], 2);
  assert.equal(counts['param.live'], 2);
});

test('compatibility is a type x type table from canConnect, with fan-in and fan-out', () => {
  const c = pc.compatibilityMatrix(ports, NODE_REGISTRY);
  const pairs = ports.PORT_TYPE_LIST.reduce((n, t) => n + ports.ROLES_BY_TYPE[t].length, 0);
  assert.equal(c.rows.length, pairs * pairs, 'every role pair');
  const row = (f, fr, t, tr) => c.rows.find((r) => r.from === f && r.fromRole === fr
    && r.to === t && r.toRole === tr);
  assert.equal(row('AUDIO', 'SIGNAL', 'AUDIO', 'TAP').allowed, true);
  assert.equal(row('CONTROL', 'SIGNAL', 'AUDIO', 'SIGNAL').code, 'type-mismatch');
  assert.equal(row('ANALYSIS', 'REFERENCE', 'ANALYSIS', 'OBSERVED').code, 'role-mismatch');
  assert.ok(c.rows.filter((r) => !r.allowed).every((r) => r.reason), 'every refusal says why');
  const inputs = NODE_REGISTRY.list().reduce((n, d) => n + d.inputs.length, 0);
  assert.equal(c.fanIn.many + c.fanIn.one, inputs);
  assert.equal(c.fanOut, true);
});

test('the table is derived and current', () => {
  const table = readFileSync(`${ROOT}${pc.TABLE}`, 'utf8');
  assert.equal(table, pc.contractTable(pc.contractMatrix(NODE_REGISTRY),
    pc.compatibilityMatrix(ports, NODE_REGISTRY)),
    'stale: run node scripts/patch-contract.mjs --write');
  const run = (...a) => spawnSync(process.execPath, ['scripts/patch-contract.mjs', ...a],
    { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run('--check').status, 0);
  assert.equal(run('--bogus').status, 2);
});

test('missing contract fields only fall (the ratchet)', () => {
  const base = JSON.parse(readFileSync(`${ROOT}tests/unit/patch-contract-baseline.json`, 'utf8'))
    .counts;
  const now = pc.missingCounts(pc.contractMatrix(NODE_REGISTRY));
  assert.deepEqual(Object.keys(now).sort(), Object.keys(base).sort(), 'the same fields');
  const grown = Object.entries(now).filter(([f, n]) => n > base[f]).map(([f, n]) =>
    `${f}: ${n} > ${base[f]}`);
  assert.deepEqual(grown, [], 'a port or parameter without its contract: declare the field');
  const stale = Object.entries(now).filter(([f, n]) => n < base[f]).map(([f, n]) =>
    `${f}: ${n} < ${base[f]} (lower the baseline)`);
  assert.deepEqual(stale, [], 'a count fell: lower its baseline entry in the same change');
});

// The patch contract coverage matrix (plan K164; the owner's program B of 2026-11-03): derived
// from the registry, every port and parameter field declared, defaulted or missing; the table is
// current; and the missing counts only fall (tests/unit/patch-contract-baseline.json): against
// the working tree's baseline, and against every committed version of it on the base branch's
// first-parent chain (never a commit of the branch), so a change that raises a count in the
// registry and in the baseline together is refused. Outside CI a missing history skips that
// check; in CI (the unit job checks out with fetch-depth: 0) a git failure, a shallow clone, a
// missing base or an empty history of a base that holds the baseline fails it.
//
//   node --test tests/unit/patch-contract.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
// CI as the history test reads it: GITHUB_ACTIONS=true.
const inCi = (env = process.env) => env.GITHUB_ACTIONS === 'true';
// The working-tree ratchet: the counts now against a baseline's counts.
const ratchet = (now, base) => ({
  fields: [Object.keys(now).sort(), Object.keys(base).sort()],
  grown: Object.entries(now).filter(([f, n]) => n > base[f]).map(([f, n]) =>
    `${f}: ${n} > ${base[f]}`),
  stale: Object.entries(now).filter(([f, n]) => n < base[f]).map(([f, n]) =>
    `${f}: ${n} < ${base[f]} (lower the baseline)`),
});

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
  const { fields, grown, stale } = ratchet(now, base);
  assert.deepEqual(fields[0], fields[1], 'the same fields');
  assert.deepEqual(grown, [], 'a port or parameter without its contract: declare the field');
  assert.deepEqual(stale, [], 'a count fell: lower its baseline entry in the same change');
});

test('missing contract fields only fall against every version of the baseline on the base', (t) => {
  assert.equal(typeof pc.baselineHistory, 'function');
  const history = pc.baselineHistory();
  const gate = pc.historyGate(history, inCi());
  if (gate.verdict === 'fail') assert.fail(gate.reason);
  if (gate.verdict === 'skip') { t.skip(gate.reason); return; }
  if (gate.verdict === 'introduce') { t.diagnostic(gate.reason); return; }
  const problems = pc.historyProblems(pc.missingCounts(pc.contractMatrix(NODE_REGISTRY)),
    history.versions);
  t.diagnostic(`${history.versions.length} committed version(s) of ${pc.BASELINE} on `
    + `${history.base} from the fork ${history.fork} judged`);
  assert.deepEqual(problems, [], 'a missing count rose above the base\'s history; declare the '
    + `field instead:\n  ${problems.join('\n  ')}`);
});

test('mutation: a port without channels, its baseline raised too, is refused by history', () => {
  assert.equal(typeof pc.historyProblems, 'function');
  const defs = NODE_REGISTRY.list();
  const [first, ...rest] = defs;
  const raisedRegistry = fixture([{ ...first, outputs: [...first.outputs,
    port({ id: 'extra', direction: 'out' })] }, ...rest]);
  const now = pc.missingCounts(pc.contractMatrix(raisedRegistry));
  const was = JSON.parse(readFileSync(`${ROOT}${pc.BASELINE}`, 'utf8')).counts;
  assert.equal(now['port.channels'], was['port.channels'] + 1, 'the mutation raises the count');
  const refused = ratchet(now, was);
  assert.deepEqual(refused.grown, ['channels', 'rate', 'monitor', 'compact', 'version'].map((f) =>
    `port.${f}: ${now[`port.${f}`]} > ${was[`port.${f}`]}`), 'the unraised baseline refuses it');
  const raisedBaseline = { ...was };
  for (const f of ['channels', 'rate', 'monitor', 'compact', 'version']) {
    raisedBaseline[`port.${f}`] += 1;
  }
  const passed = ratchet(now, raisedBaseline);
  assert.deepEqual([passed.fields[0], passed.grown, passed.stale],
    [passed.fields[1], [], []], 'the working-tree ratchet alone lets the raised baseline through');
  assert.deepEqual(pc.historyProblems(now, [{ sha: 'main1', counts: was }]),
    [`port.channels: ${now['port.channels']} missing, above ${was['port.channels']} at main1`,
      ...['rate', 'monitor', 'compact', 'version'].map((f) =>
        `port.${f}: ${now[`port.${f}`]} missing, above ${was[`port.${f}`]} at main1`)]);
  assert.deepEqual(pc.historyProblems(was, [{ sha: 'main1', counts: was }]), [], 'equal passes');
  const fewer = { ...was, 'port.channels': was['port.channels'] - 1 };
  assert.deepEqual(pc.historyProblems(fewer, [{ sha: 'main1', counts: was }]), [], 'falls pass');
  assert.deepEqual(pc.historyProblems(was, [{ sha: 'b2', counts: was },
    { sha: 'a1', counts: fewer }]),
  [`port.channels: ${was['port.channels']} missing, above ${fewer['port.channels']} at a1`],
  'every earlier version binds, not only the newest');
  const { 'port.channels': gone, ...dropped } = was;
  assert.deepEqual(pc.historyProblems(dropped, [{ sha: 'a1', counts: was }]),
    [`port.channels: ${gone} missing at a1, no longer counted`], 'debt never vanishes unfilled');
  assert.deepEqual(pc.historyProblems({ ...was, 'port.new': 3 }, [{ sha: 'a1', counts: was }]),
    [], 'a field no earlier version counted is new');
});

test('fixture: the history gate fails in CI without history, and skips only outside CI', () => {
  assert.equal(typeof pc.historyGate, 'function');
  assert.equal(pc.historyGate({ error: 'a shallow clone' }, true).verdict, 'fail');
  assert.equal(pc.historyGate({ error: 'a shallow clone' }, false).verdict, 'skip');
  assert.equal(pc.historyGate({ versions: [], baseHolds: true }, true).verdict, 'fail');
  assert.equal(pc.historyGate({ versions: [], baseHolds: true }, false).verdict, 'skip');
  assert.equal(pc.historyGate({ versions: [], baseHolds: false, base: 'main', fork: 'f' }, true)
    .verdict, 'introduce');
  assert.equal(pc.historyGate({ versions: [{ sha: 'a1', counts: {} }] }, true).verdict, 'judge');
  assert.equal(pc.baseBranch({ GITHUB_BASE_REF: 'release' }), 'release');
  assert.equal(pc.baseBranch({}), 'main');
});

// A scratch git repository removed after the test: { dir, git, commit, at }.
const scratchRepo = (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'osc-patch-contract-history-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commit = (files, message) => {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), text);
    }
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const at = (channels) => ({ [pc.BASELINE]: `${JSON.stringify({ note: 'n', counts: {
    'port.channels': channels, 'param.live': 5 } }, null, 2)}\n` });
  return { dir, git, commit, at };
};

test('fixture: only the base branch chain is judged, never the branch\'s own commits', (t) => {
  assert.equal(typeof pc.baselineHistory, 'function');
  const { dir, git, commit, at } = scratchRepo(t);
  const judge = (counts) => {
    const history = pc.baselineHistory({ root: dir, base: 'main' });
    const gate = pc.historyGate(history, true);
    return { gate: gate.verdict, history, problems: gate.verdict === 'judge'
      ? pc.historyProblems(counts, history.versions) : [] };
  };
  git('init', '-q', '-b', 'main');
  commit({ 'README.md': 'base\n' }, 'base without a baseline');
  git('checkout', '-q', '-b', 'k164');
  assert.equal(judge({ 'port.channels': 9 }).gate, 'introduce', 'the base holds none');
  commit(at(9), 'the branch introduces the baseline');
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '--no-edit', 'k164');
  git('checkout', '-q', '-b', 'raise');
  const own = commit(at(10), 'a pull request raises the count in the registry and the baseline');
  const raised = judge({ 'port.channels': 10, 'param.live': 5 });
  assert.equal(raised.gate, 'judge');
  assert.ok(!raised.history.versions.some((v) => own.startsWith(v.sha)), 'never its own commit');
  assert.deepEqual(raised.problems,
    [`port.channels: 10 missing, above 9 at ${raised.history.versions[0].sha}`]);
  git('checkout', '-q', 'main');
  commit({ 'README.md': 'the base moves on\n' }, 'base change');
  git('checkout', '-q', 'raise');
  git('merge', '-q', '--no-edit', 'main');
  assert.equal(judge({ 'port.channels': 10, 'param.live': 5 }).problems.length, 1,
    'merging the base does not make the branch\'s raise part of the base\'s history');
  commit(at(8), 'it fills a field instead');
  assert.deepEqual(judge({ 'port.channels': 8, 'param.live': 5 }).problems, []);
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '--no-edit', 'raise');
  git('checkout', '-q', '-b', 'next');
  assert.deepEqual(judge({ 'port.channels': 9, 'param.live': 5 }).problems.map((p) =>
    p.replace(/ at \w+$/, '')), ['port.channels: 9 missing, above 8'],
  'once landed, the lower count binds every later change');
});

test('fixture: a depth-limited clone fails loudly in CI and never judges a cut history', (t) => {
  assert.equal(typeof pc.baselineHistory, 'function');
  const { dir, git, commit, at } = scratchRepo(t);
  git('init', '-q', '-b', 'main');
  for (const n of [12, 11, 10]) commit(at(n), `the baseline falls to ${n}`);
  git('checkout', '-q', '-b', 'k164');
  commit({ 'README.md': 'a change\n' }, 'a change on the branch');
  const clone = (name, ...flags) => {
    const into = path.join(dir, '..', `${path.basename(dir)}-${name}`);
    t.after(() => rmSync(into, { recursive: true, force: true }));
    const r = spawnSync('git', ['clone', '-q', '--no-local', ...flags, '--branch', 'k164',
      `file://${dir}`, into], { encoding: 'utf8' });
    assert.equal(r.status, 0, `git clone ${flags.join(' ')}: ${r.stderr}`);
    return into;
  };
  const ci = inCi({ GITHUB_ACTIONS: 'true' });
  const full = pc.baselineHistory({ root: clone('full'), base: 'main' });
  assert.equal(pc.historyGate(full, ci).verdict, 'judge');
  assert.equal(full.versions.length, 3, 'the full clone reads every version');
  const cut = pc.baselineHistory({ root: clone('shallow', '--depth', '2', '--no-single-branch'),
    base: 'main' });
  assert.deepEqual(pc.historyGate(cut, ci), { verdict: 'fail', reason: 'git failed in CI: a '
    + 'shallow clone: the base branch history is cut (fetch-depth: 0)' },
  `a cut history was judged: ${JSON.stringify(cut)}`);
  assert.equal(pc.historyGate(cut, false).verdict, 'skip', 'outside CI the same clone skips');
});

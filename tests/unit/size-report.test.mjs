// scripts/size-report.mjs (plan issue E009): the CI step summary of dist/index.html's raw and
// gzip size, the headroom to the budget of scripts/build-config.mjs and the change from the
// merge base's build. The arithmetic is checked on fixed inputs, the sizes against an
// independent measurement (Buffer.byteLength and the gzip of scripts/verify-dist.mjs), and the
// program on fixture repositories, run as the CI step runs it.
//   node --test tests/unit/size-report.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { gitRepo } from './fixtures/git-repo.mjs';
import { BUDGET } from '../../scripts/build-config.mjs';
import { verifyHtml } from '../../scripts/verify-dist.mjs';
import {
  GZIP_THRESHOLD_BYTES, formatReport, groupBytes, measure, sizeReport,
} from '../../scripts/size-report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'size-report.mjs');

const ENV = { ...process.env };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete ENV[k];

function run(repo, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, '--repo', repo.dir, ...args],
    { encoding: 'utf8', env: ENV });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

/** Deterministic text gzip cannot shrink much: printable bytes from a xorshift32 generator. */
function noise(n, seed = 1) {
  let x = seed;
  let s = '';
  for (let i = 0; i < n; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    s += String.fromCharCode(33 + (x % 94));
  }
  return s;
}

const page = (body) => `<!doctype html><html><head><title>t</title></head><body>${body}`
  + '</body></html>\n';

test('groupBytes groups thousands with a space and keeps the sign', () => {
  assert.equal(groupBytes(0), '0');
  assert.equal(groupBytes(999), '999');
  assert.equal(groupBytes(1000), '1 000');
  assert.equal(groupBytes(2610384), '2 610 384');
  assert.equal(groupBytes(-1234), '-1 234');
  assert.equal(groupBytes(1234, { signed: true }), '+1 234');
  assert.equal(groupBytes(-1234, { signed: true }), '-1 234');
  assert.equal(groupBytes(0, { signed: true }), '0');
});

test('measure gives the byte length and the gzip size verify-dist checks against the budget',
  () => {
    const html = page(`<p>${'é'.repeat(300)}</p>${noise(2000)}`);
    const m = measure(Buffer.from(html));
    assert.equal(m.raw, Buffer.byteLength(html));
    assert.equal(m.gzip, gzipSync(Buffer.from(html), { level: 9 }).length);
    const v = verifyHtml(html);
    assert.equal(m.raw, v.raw);
    assert.equal(m.gzip, v.gzip);
  });

test('sizeReport: headroom is budget minus size, the change is head minus base', () => {
  const budget = { rawBytes: 10_000, gzipBytes: 4_000 };
  const r = sizeReport({ head: { raw: 7_500, gzip: 3_100 }, base: { raw: 7_000, gzip: 2_950 },
    budget, threshold: 100 });
  assert.deepEqual(r.size, { raw: 7_500, gzip: 3_100 });
  assert.deepEqual(r.budget, budget);
  assert.deepEqual(r.headroom, { raw: 2_500, gzip: 900 });
  assert.deepEqual(r.change, { raw: 500, gzip: 150 });
  assert.equal(r.aboveThreshold, true, 'a 150 B gzip growth is above a 100 B threshold');

  const shrink = sizeReport({ head: { raw: 6_000, gzip: 2_000 }, base: { raw: 7_000, gzip: 2_950 },
    budget, threshold: 100 });
  assert.deepEqual(shrink.change, { raw: -1_000, gzip: -950 });
  assert.equal(shrink.aboveThreshold, false);

  const at = sizeReport({ head: { raw: 7_100, gzip: 3_050 }, base: { raw: 7_000, gzip: 2_950 },
    budget, threshold: 100 });
  assert.equal(at.aboveThreshold, false, 'exactly the threshold is not more than it');

  const over = sizeReport({ head: { raw: 10_500, gzip: 4_200 }, base: { raw: 7_000, gzip: 2_950 },
    budget, threshold: 100 });
  assert.deepEqual(over.headroom, { raw: -500, gzip: -200 }, 'over the budget reads negative');
});

test('the threshold is 1 % of the gzip budget of scripts/build-config.mjs', () => {
  assert.equal(GZIP_THRESHOLD_BYTES, BUDGET.gzipBytes / 100);
});

test('formatReport prints the four numbers, the commits, the threshold and the decisions', () => {
  const budget = { rawBytes: 3_500_000, gzipBytes: 1_000_000 };
  const r = sizeReport({ head: { raw: 2_610_384, gzip: 751_494 },
    base: { raw: 2_600_000, gzip: 740_000 }, budget, threshold: 10_000 });
  const md = formatReport(r, { head: '1111111aaaa', base: '2222222bbbb' });
  assert.match(md, /^### dist\/index\.html size/m);
  assert.match(md, /\| size \(head `1111111`\) \| 2 610 384 B \| 751 494 B \|/);
  assert.match(md, /\| budget \(scripts\/build-config\.mjs\) \| 3 500 000 B \| 1 000 000 B \|/);
  assert.match(md, /\| headroom \| 889 616 B \(25\.4 %\) \| 248 506 B \(24\.9 %\) \|/);
  assert.match(md, /\| merge base `2222222` \| 2 600 000 B \| 740 000 B \|/);
  assert.match(md, /\| change from the merge base \| \+10 384 B \| \+11 494 B \|/);
  assert.match(md, /more than 10 000 B gzip/);
  assert.match(md, /above the threshold/);
  assert.match(md, /names where the bytes come from/);
  assert.match(md, /not a gate/);
  assert.match(md, /#114/);
  assert.match(md, /ADR 0013/);

  const small = sizeReport({ head: { raw: 2_600_100, gzip: 740_050 },
    base: { raw: 2_600_000, gzip: 740_000 }, budget, threshold: 10_000 });
  const smallMd = formatReport(small, { head: '1111111', base: '2222222' });
  assert.match(smallMd, /\| change from the merge base \| \+100 B \| \+50 B \|/);
  assert.match(smallMd, /within the threshold/);
  assert.doesNotMatch(smallMd, /above the threshold/);
});

test('the program compares the head\'s dist with the merge base\'s, not the base branch tip',
  () => {
    const repo = gitRepo('oscilla-size-report-');
    try {
      const baseHtml = page(`<p>${noise(3000, 7)}</p>`);
      const mb = repo.commit('base', { 'dist/index.html': baseHtml });
      repo.branch('pr');
      const headHtml = page(`<p>${noise(3000, 7)}</p><p>${noise(500, 9)}</p>`);
      const head = repo.commit('pr grows dist', { 'dist/index.html': headHtml });
      repo.git('checkout', '-q', 'main');
      repo.commit('main moves on', { 'dist/index.html': page(noise(9000, 3)) });
      repo.git('checkout', '-q', 'pr');

      const r = run(repo, '--base-branch', 'main');
      assert.equal(r.status, 0, r.err);
      const h = measure(Buffer.from(headHtml));
      const b = measure(Buffer.from(baseHtml));
      const g = (n, o) => groupBytes(n, o);
      const s = (n) => groupBytes(n, { signed: true });
      const rows = [
        `| size (head \`${head.slice(0, 7)}\`) | ${g(h.raw)} B | ${g(h.gzip)} B |`,
        `| merge base \`${mb.slice(0, 7)}\` | ${g(b.raw)} B | ${g(b.gzip)} B |`,
        `| change from the merge base | ${s(h.raw - b.raw)} B | ${s(h.gzip - b.gzip)} B |`,
      ];
      for (const row of rows) assert.ok(r.out.includes(row), `${row}\nin\n${r.out}`);
      assert.ok(r.out.includes(`| headroom | ${g(BUDGET.rawBytes - h.raw)} B `), r.out);
      assert.ok(h.raw > b.raw && h.gzip > b.gzip, 'the fixture grows');
      assert.match(r.out, /within the threshold/);
    } finally {
      repo.dispose();
    }
  });

test('the program names a growth above the threshold', () => {
  const repo = gitRepo('oscilla-size-report-');
  try {
    repo.commit('base', { 'dist/index.html': page('<p>small</p>') });
    repo.branch('pr');
    repo.commit('pr adds incompressible bytes', {
      'dist/index.html': page(`<p>${noise(GZIP_THRESHOLD_BYTES * 2, 5)}</p>`),
    });
    const r = run(repo, '--base-branch', 'main', '--head', 'HEAD');
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /above the threshold/);
  } finally {
    repo.dispose();
  }
});

test('the program refuses when a build is missing and on an unknown argument', () => {
  const repo = gitRepo('oscilla-size-report-');
  try {
    repo.commit('base without dist', { 'README.md': 'x\n' });
    repo.branch('pr');
    repo.commit('pr adds dist', { 'dist/index.html': page('<p>x</p>') });
    const missing = run(repo, '--base-branch', 'main');
    assert.equal(missing.status, 1);
    assert.match(missing.err, /dist\/index\.html/);
    assert.match(missing.err, /merge base/);

    const unknown = run(repo, '--bogus');
    assert.equal(unknown.status, 2);
    assert.match(unknown.err, /unknown argument --bogus/);

    const help = run(repo, '--help');
    assert.equal(help.status, 0);
    assert.match(help.out, /usage: node scripts\/size-report\.mjs/);
  } finally {
    repo.dispose();
  }
});

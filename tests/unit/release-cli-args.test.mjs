// R-4 of the #198 review: a release script parses its arguments against an explicit list.
// `--help` / `-h` prints the usage and exits 0; an unknown flag, or a flag missing its value,
// exits 2 with a clear message; both before any git, file, npm or network action. Before the
// fix `release:prepare --help` (or a typo such as `--dryrun`) on a clean tree ran a REAL
// prepare: it bumped package.json and ran the gate.
// Every script is driven through its exported function with a git and a shell that throw on
// any call and record it, on a fixture package.json that must stay byte-identical: nothing
// here can bump, tag, push or write.
//   node --test tests/unit/release-cli-args.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as analyze from '../../scripts/release-analyze.mjs';
import * as cadence from '../../scripts/release-cadence.mjs';
import * as prepare from '../../scripts/release-prepare.mjs';
import * as publish from '../../scripts/release-publish.mjs';
import * as record from '../../scripts/release-record.mjs';

const PKG = `${JSON.stringify({ name: 'oscilla', version: '3.3.3' }, null, 2)}\n`;

/** A fixture checkout, a git and a shell that refuse every call, and the captured output. */
function harness() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'oscilla-cli-args-'));
  writeFileSync(path.join(root, 'package.json'), PKG);
  const calls = [];
  const refuse = (what) => (...args) => {
    calls.push(`${what} ${JSON.stringify(args)}`);
    throw new Error(`argument parsing must act before ${what} ${JSON.stringify(args)}`);
  };
  const out = [];
  return {
    root, calls, out, run: refuse('git'), sh: refuse('sh'),
    log: (l) => out.push(String(l)), err: (l) => out.push(String(l)),
    untouched: () => readFileSync(path.join(root, 'package.json'), 'utf8') === PKG,
  };
}

/** Run `fn` with console.log / console.error captured into `h.out` (release:prepare logs). */
async function captured(h, fn) {
  const real = { log: console.log, error: console.error };
  console.log = h.log;
  console.error = h.err;
  try {
    return await fn();
  } finally {
    Object.assign(console, real);
  }
}

/** Each script's entry point, given argv and a harness; resolves to the exit code. */
const SCRIPTS = {
  'release:prepare': (argv, h) => captured(h, () => prepare.main(argv, h.root, h.run,
    { PATH: process.env.PATH })),
  'release:publish': (argv, h) => publish.publish({ argv, root: h.root, run: h.run, sh: h.sh,
    log: h.log, sleep: async () => {}, clock: () => 0, receipt: null,
    fingerprint: { version: '3.3.3', sourceDigest: 'd'.repeat(64), distSha256: 'e'.repeat(64),
      gateTree: 'a'.repeat(64) } }),
  'release:record': (argv, h) => record.main({ argv, root: h.root, run: h.run, log: h.log,
    err: h.err, io: { run: h.sh } }),
  'release:analyze': (argv, h) => {
    assert.equal(typeof analyze.main, 'function', 'release-analyze exports main()');
    return analyze.main({ argv, root: h.root, run: h.run, log: h.log, err: h.err });
  },
  'release-cadence': (argv, h) => cadence.main({ argv, root: h.root, run: h.run, sh: h.sh,
    log: h.log, err: h.err, now: 0 }),
};

/** Each script answers --help and -h, also after its documented flags. */
const HELP = {
  'release:prepare': [['--dry-run', '--prerelease', '--help'], ['--preid', 'beta', '-h']],
  'release:publish': [['--yes', '--help'], ['--pages-timeout', '5', '-h']],
  'release:record': [['--version', '3.4.0', '--help'], ['--complete', '-h']],
  'release:analyze': [['--json', '--help'], ['--prerelease', '-h']],
  'release-cadence': [['--issue', '--help'], ['--max-age-hours', '12', '-h']],
};
/** [argv, the argument the refusal names] per script; --help does not excuse an unknown flag. */
const UNKNOWN = {
  'release:prepare': [[['--dryrun'], '--dryrun'], [['--dry-run', '--yes'], '--yes'],
    [['--preid=rc'], '--preid=rc'], [['dry-run'], 'dry-run'], [['--help', '--bogus'], '--bogus']],
  'release:publish': [[['--yse'], '--yse'], [['--dry-run'], '--dry-run'],
    [['--yes', '--force'], '--force'], [['--help', '--bogus'], '--bogus']],
  'release:record': [[['--versoin', '3.4.0'], '--versoin'],
    [['--version', '3.4.0', '--write'], '--write'], [['--help', '--bogus'], '--bogus']],
  'release:analyze': [[['--jsno'], '--jsno'], [['--prerelease', '--yes'], '--yes'],
    [['--help', '--bogus'], '--bogus']],
  'release-cadence': [[['--isue'], '--isue'], [['--report', '--max-age', '24'], '--max-age'],
    [['--help', '--bogus'], '--bogus']],
};
/** [argv, the flag left without its value] per script. */
const MISSING_VALUE = {
  'release:prepare': [[['--preid'], '--preid'], [['--prerelease', '--preid', '--dry-run'],
    '--preid'], [['--no-rc-because'], '--no-rc-because'],
  [['--no-rc-because', '--dry-run'], '--no-rc-because']],
  'release:publish': [[['--pages-timeout'], '--pages-timeout'],
    [['--pages-timeout', '--yes'], '--pages-timeout']],
  'release:record': [[['--version'], '--version']],
  'release:analyze': [[['--prerelease', '--preid'], '--preid']],
  'release-cadence': [[['--max-age-hours'], '--max-age-hours'],
    [['--max-age-hours', '--issue'], '--max-age-hours']],
};

async function expectRefused(name, argv, re) {
  const h = harness();
  let code;
  try {
    code = await SCRIPTS[name](argv, h);
  } catch (e) {
    assert.fail(`${name} ${argv.join(' ')} acted before refusing: ${e.message}`);
  }
  const text = h.out.join('\n');
  assert.equal(code, 2, `${name} ${argv.join(' ')} exits 2: ${text}`);
  assert.match(text, re, `${name} ${argv.join(' ')} says why`);
  assert.match(text, /usage:/, `${name} ${argv.join(' ')} prints its usage`);
  assert.deepEqual(h.calls, [], `${name} ${argv.join(' ')} ran nothing`);
  assert.ok(h.untouched(), `${name} ${argv.join(' ')} left package.json alone`);
}

test('release scripts refuse an unknown flag and answer --help without acting (R-4 of #198)',
  async () => {
    for (const name of Object.keys(SCRIPTS)) {
      for (const help of [['--help'], ['-h'], ...HELP[name]]) {
        const h = harness();
        let code;
        try {
          code = await SCRIPTS[name](help, h);
        } catch (e) {
          assert.fail(`${name} ${help.join(' ')} acted instead of printing its usage: `
            + e.message);
        }
        const text = h.out.join('\n');
        assert.equal(code, 0, `${name} ${help.join(' ')} exits 0: ${text}`);
        assert.match(text, /usage:/, `${name} ${help.join(' ')} prints its usage`);
        assert.deepEqual(h.calls, [], `${name} ${help.join(' ')} ran nothing`);
        assert.ok(h.untouched(), `${name} ${help.join(' ')} left package.json alone`);
      }
      for (const [argv, bad] of UNKNOWN[name]) {
        await expectRefused(name, argv, new RegExp(`unknown argument ${bad}(\\s|$)`));
      }
      for (const [argv, flag] of MISSING_VALUE[name]) {
        await expectRefused(name, argv, new RegExp(`${flag} needs a value`));
      }
    }
  });

test('R-4 of #198: release:publish refuses a --pages-timeout that is not a positive number',
  async () => {
    for (const v of ['soon', '0', 'NaN']) {
      await expectRefused('release:publish', ['--pages-timeout', v],
        /--pages-timeout needs a positive number of minutes/);
    }
  });

test('R-4 of #198: the documented flags still parse and reach the script', async () => {
  // release:prepare --dry-run (with each documented flag) reaches git: parsing let it through.
  for (const argv of [['--dry-run'], ['--dry-run', '--prerelease'],
    ['--dry-run', '--prerelease', '--preid', 'beta'], ['--dry-run', '--no-rc-because', '0050']]) {
    const h = harness();
    await assert.rejects(SCRIPTS['release:prepare'](argv, h), /must act before git/,
      argv.join(' '));
    assert.match(h.calls[0], /^git \[\["status"/, argv.join(' '));
    assert.ok(h.untouched());
  }
  for (const argv of [[], ['--yes'], ['--pages-timeout', '45'],
    ['--yes', '--pages-timeout', '5']]) {
    const h = harness();
    await assert.rejects(SCRIPTS['release:publish'](argv, h), /must act before git/,
      argv.join(' '));
    assert.equal(h.calls.length, 1, argv.join(' '));
  }
  for (const argv of [[], ['--json'], ['--prerelease', '--preid', 'beta']]) {
    const h = harness();
    // lastReleaseTag() reads a refused git as "no tag", then readCommits() hits it again
    const code = await SCRIPTS['release:analyze'](argv, h);
    assert.equal(code, 1, argv.join(' '));
    assert.ok(h.calls.length >= 1, argv.join(' '));
  }
  for (const argv of [[], ['--report'], ['--json', '--issue', '--max-age-hours', '12']]) {
    const h = harness();
    const code = await SCRIPTS['release-cadence'](argv, h);
    assert.equal(code, argv.includes('--report') ? 0 : 2, `${argv.join(' ')}: ${h.out}`);
    assert.match(h.out.join('\n'), /no v\* tag is reachable/);
  }
});

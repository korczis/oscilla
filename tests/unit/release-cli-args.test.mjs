// R-4 of the #198 review: a release script parses its arguments against an explicit list.
// `--help` / `-h` prints the usage and exits 0; an unknown flag, or a flag missing its value,
// exits 2 with a clear message; both before any git, file, npm or network action. Before the
// fix `release:prepare --help` (or a typo such as `--dryrun`) on a clean tree ran a REAL
// prepare: it bumped package.json and ran the gate.
// Every script is driven through its exported function with a git and a shell that throw on
// any call and record it, on a fixture package.json that must stay byte-identical: nothing
// here can bump, tag, push or write.
// #199: release:stamp and release:verify-deploy keep the same contract (R-3); a negative value
// reaches the script's own check instead of reading as a missing value (R-1); an empty value is
// refused rather than replaced by a default (R-2); and every fixture is removed (R-4).
//   node --test tests/unit/release-cli-args.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as analyze from '../../scripts/release-analyze.mjs';
import * as cadence from '../../scripts/release-cadence.mjs';
import * as prepare from '../../scripts/release-prepare.mjs';
import * as publish from '../../scripts/release-publish.mjs';
import * as record from '../../scripts/release-record.mjs';
import * as stamp from '../../scripts/stamp-build.mjs';
import * as verifyDeploy from '../../scripts/verify-deploy.mjs';

const PKG = `${JSON.stringify({ name: 'oscilla', version: '3.3.3' }, null, 2)}\n`;

/**
 * Run `fn` with a fixture checkout, a git and a shell that refuse every call, and the captured
 * output; resolves to what `fn` returns. The fixture directory is removed when `fn` settles,
 * also when it throws (R-4 of #199).
 */
async function harness(fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'oscilla-cli-args-'));
  try {
    writeFileSync(path.join(root, 'package.json'), PKG);
    const calls = [];
    const refuse = (what) => (...args) => {
      calls.push(`${what} ${JSON.stringify(args)}`);
      throw new Error(`argument parsing must act before ${what} ${JSON.stringify(args)}`);
    };
    const out = [];
    return await fn({
      root, calls, out, run: refuse('git'), sh: refuse('sh'),
      log: (l) => out.push(String(l)), err: (l) => out.push(String(l)),
      untouched: () => readFileSync(path.join(root, 'package.json'), 'utf8') === PKG,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
  'release:stamp': (argv, h) => {
    assert.equal(typeof stamp.main, 'function', 'stamp-build exports main()');
    return stamp.main({ argv, root: h.root, run: h.run, env: {}, log: h.log, err: h.err });
  },
  'release:verify-deploy': (argv, h) => {
    assert.equal(typeof verifyDeploy.main, 'function', 'verify-deploy exports main()');
    return verifyDeploy.main({ argv, root: h.root, run: h.run, env: {}, log: h.log,
      err: h.err });
  },
};

/** Each script answers --help and -h, also after its documented flags. */
const HELP = {
  'release:prepare': [['--dry-run', '--prerelease', '--help'], ['--preid', 'beta', '-h']],
  'release:publish': [['--yes', '--help'], ['--pages-timeout', '5', '-h']],
  'release:record': [['--version', '3.4.0', '--help'], ['--complete', '-h']],
  'release:analyze': [['--json', '--help'], ['--prerelease', '-h']],
  'release-cadence': [['--issue', '--help'], ['--max-age-hours', '12', '-h']],
  'release:stamp': [['dist/index.html', 'out.html', '--help'],
    ['--commit', 'a'.repeat(40), '--no-source-check', '-h']],
  'release:verify-deploy': [['--commit', 'origin/main', '--help'], ['--no-assets', '-h']],
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
  'release:stamp': [[['--comit', 'x'], '--comit'], [['in.html', 'out.html', 'third'], 'third'],
    [['--yes'], '--yes'], [['--help', '--bogus'], '--bogus']],
  'release:verify-deploy': [[['--atempts', '1'], '--atempts'], [['https://x/'], 'https://x/'],
    [['--no-assets', '--yes'], '--yes'], [['--help', '--bogus'], '--bogus']],
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
  'release:stamp': [[['--commit'], '--commit'], [['--release', '--distance', '1'], '--release']],
  'release:verify-deploy': [[['--url'], '--url'], [['--commit', '--no-assets'], '--commit']],
};
/** [argv, the flag given an empty value] per script that parses with parseFlags (R-2 of #199). */
const EMPTY_VALUE = {
  'release:prepare': [[['--prerelease', '--preid', ''], '--preid'],
    [['--no-rc-because', ''], '--no-rc-because']],
  'release:publish': [[['--pages-timeout', ''], '--pages-timeout']],
  'release:analyze': [[['--prerelease', '--preid', ''], '--preid']],
  'release-cadence': [[['--max-age-hours', ''], '--max-age-hours']],
  'release:stamp': [[['--commit', ''], '--commit']],
  'release:verify-deploy': [[['--url', ''], '--url']],
};

async function expectRefused(name, argv, re) {
  await harness(async (h) => {
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
  });
}

test('release scripts refuse an unknown flag and answer --help without acting (R-4 of #198)',
  async () => {
    for (const name of Object.keys(SCRIPTS)) {
      for (const help of [['--help'], ['-h'], ...HELP[name]]) {
        await harness(async (h) => {
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
        });
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
    // '-5' is a negative number, not a missing value (R-1 of #199)
    for (const v of ['soon', '0', 'NaN', '-5', '-0.5']) {
      await expectRefused('release:publish', ['--pages-timeout', v],
        /--pages-timeout needs a positive number of minutes/);
    }
  });

test('R-4 of #198: the documented flags still parse and reach the script', async () => {
  // release:prepare --dry-run (with each documented flag) reaches git: parsing let it through.
  for (const argv of [['--dry-run'], ['--dry-run', '--prerelease'],
    ['--dry-run', '--prerelease', '--preid', 'beta'], ['--dry-run', '--no-rc-because', '0050']]) {
    await harness(async (h) => {
      await assert.rejects(SCRIPTS['release:prepare'](argv, h), /must act before git/,
        argv.join(' '));
      assert.match(h.calls[0], /^git \[\["status"/, argv.join(' '));
      assert.ok(h.untouched());
    });
  }
  for (const argv of [[], ['--yes'], ['--pages-timeout', '45'],
    ['--yes', '--pages-timeout', '5']]) {
    await harness(async (h) => {
      await assert.rejects(SCRIPTS['release:publish'](argv, h), /must act before git/,
        argv.join(' '));
      assert.equal(h.calls.length, 1, argv.join(' '));
    });
  }
  for (const argv of [[], ['--json'], ['--prerelease', '--preid', 'beta']]) {
    await harness(async (h) => {
      // lastReleaseTag() reads a refused git as "no tag", then readCommits() hits it again
      const code = await SCRIPTS['release:analyze'](argv, h);
      assert.equal(code, 1, argv.join(' '));
      assert.ok(h.calls.length >= 1, argv.join(' '));
    });
  }
  for (const argv of [[], ['--report'], ['--json', '--issue', '--max-age-hours', '12']]) {
    await harness(async (h) => {
      const code = await SCRIPTS['release-cadence'](argv, h);
      assert.equal(code, argv.includes('--report') ? 0 : 2, `${argv.join(' ')}: ${h.out}`);
      assert.match(h.out.join('\n'), /no v\* tag is reachable/);
    });
  }
  // release:stamp and release:verify-deploy with their documented flags reach git (R-3 of #199)
  for (const [name, argv] of [['release:stamp', []],
    ['release:stamp', ['dist/index.html', 'out.html', '--channel', 'production']],
    ['release:stamp', ['--no-source-check', '--release', 'after-tag', '--distance', '-1']],
    ['release:verify-deploy', []], ['release:verify-deploy', ['--attempts', '1', '--delay', '0',
      '--no-assets', '--no-cache-bust', '--url', 'https://example.invalid']]]) {
    await harness(async (h) => {
      const code = await SCRIPTS[name](argv, h);
      assert.equal(code, 1, `${name} ${argv.join(' ')}: ${h.out}`);
      assert.match(h.calls[0] || '', /^git \[\["rev-parse","HEAD"\]\]/,
        `${name} ${argv.join(' ')}`);
      assert.doesNotMatch(h.out.join('\n'), /usage:/, `${name} ${argv.join(' ')}`);
    });
  }
});

test('R-2 of #199: a value flag given an empty value is refused, never replaced by a default',
  async () => {
    for (const name of Object.keys(EMPTY_VALUE)) {
      for (const [argv, flag] of EMPTY_VALUE[name]) {
        await expectRefused(name, argv, new RegExp(`${flag} needs a non-empty value`));
      }
    }
  });

test('R-3 of #199: release:verify-deploy refuses a bad --attempts or --delay as a usage error',
  async () => {
    for (const argv of [['--attempts', '0'], ['--attempts', '1.5'], ['--delay', '-1'],
      ['--delay', 'soon']]) {
      await expectRefused('release:verify-deploy', argv, /--(attempts|delay) must be/);
    }
  });

test('R-4 of #199: harness() removes the fixture it created, also when the case throws',
  async () => {
    let root;
    const value = await harness(async (h) => {
      root = h.root;
      assert.ok(existsSync(path.join(h.root, 'package.json')), 'the fixture exists while used');
      return 'returned';
    });
    assert.equal(value, 'returned', 'harness() resolves to what the case returns');
    assert.equal(typeof root, 'string', 'harness() ran the case');
    assert.equal(existsSync(root), false, `${root} was removed`);
    let thrown;
    await assert.rejects(harness(async (h) => {
      thrown = h.root;
      throw new Error('a failing case');
    }), /a failing case/);
    assert.equal(typeof thrown, 'string', 'harness() ran the failing case');
    assert.equal(existsSync(thrown), false, `${thrown} was removed after the case threw`);
  });

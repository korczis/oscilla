// A throwaway git repository for the tests of scripts that read history (fail-first,
// review-verdict): hermetic (no global or system config, no hooks, no signing), on a `main`
// branch, removed by the caller with `dispose()`.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete ENV[k];

export function gitRepo(prefix = 'oscilla-fixture-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  const git = (...args) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'core.hooksPath=/dev/null',
      '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: ENV });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  return {
    dir,
    git,
    /** Write files ({ path: text }), commit them, return the commit. */
    commit(message, files) {
      for (const [rel, text] of Object.entries(files)) {
        const abs = path.join(dir, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, text);
      }
      git('add', '-A');
      git('commit', '-q', '--allow-empty', '-m', message);
      return git('rev-parse', 'HEAD');
    },
    branch(name) {
      git('checkout', '-q', '-b', name);
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

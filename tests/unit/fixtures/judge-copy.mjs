// The judge copy as a job's `judge` step makes it (.github/workflows/ci.yml, metadata.yml):
// the entries manifestOf() keeps of the base commit's .github/scripts/ and scripts/, written
// blob by blob with their mode, the manifest and .base-commit beside them (review of #255,
// R30). tests/unit/judge-isolation.test.mjs proves the step writes the same.

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { digestOf, manifestOf, MANIFEST, TREE_ENTRY } from '../../../scripts/judge-isolation.mjs';

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete ENV[k];

/** Extract `commit` of the repository `repo` into `dir` as the `judge` step does: the digest. */
export function extractJudge(repo, commit, dir) {
  const { text } = manifestOf(repo, commit);
  for (const line of text.split('\n').slice(1).filter(Boolean)) {
    const [, mode, oid, file] = TREE_ENTRY.exec(line);
    const to = path.join(dir, file);
    mkdirSync(path.dirname(to), { recursive: true });
    const blob = spawnSync('git', ['-C', repo, 'cat-file', 'blob', oid], { env: ENV });
    if (blob.status !== 0) throw new Error(`git cat-file blob ${oid}: ${blob.stderr}`);
    writeFileSync(to, blob.stdout);
    if (mode === '100755') chmodSync(to, 0o755);
  }
  writeFileSync(path.join(dir, MANIFEST), text);
  writeFileSync(path.join(dir, '.base-commit'), `${commit}\n`);
  return digestOf(text);
}

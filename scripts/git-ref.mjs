// The commit a pull-request rule takes as its base (scripts/fail-first.mjs,
// scripts/review-verdict.mjs, scripts/pr-metadata.mjs), named so that nothing else can answer
// for it. git resolves a short name by trying refs/<n>, refs/tags/<n>, refs/heads/<n>,
// refs/remotes/<n> in that order, and CI checks out with every tag, so a pushed tag named
// origin/main would shadow the remote-tracking branch origin/main (review of #255, R2).
// .github/scripts/base-rule.sh passes refs/remotes/origin/<base>; these programs refuse a name
// that more than one ref answers, in its short or its full form, rather than guess.

import { spawnSync } from 'node:child_process';

const KINDS = ['tags', 'heads', 'remotes'];
const FULL_SHA = /^[0-9a-f]{40}$/;
// a plain ref name, as a short or a full name: no revision expression (~ ^ @ : ..)
const NAME = /^(?!.*\.\.)[\w][\w./-]*$/;

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

const exists = (repo, ref) => git(repo, ['show-ref', '--verify', '--quiet', ref]) !== null;

/** The refs git would try for a short name, in its order. */
export function candidates(name) {
  return [`refs/${name}`, ...KINDS.map((k) => `refs/${k}/${name}`), `refs/remotes/${name}/HEAD`];
}

/** The short name of a full ref name under refs/tags, refs/heads or refs/remotes, or null. */
function shortOf(ref) {
  const m = /^refs\/(?:tags|heads|remotes)\/(.+)$/.exec(ref);
  return m ? m[1] : null;
}

/**
 * The full commit name of `ref` in `repo`. A full 40-hex name is itself; a full ref name
 * (refs/...) must exist as exactly that ref; a short name must be answered by exactly one ref.
 * Either way, when another ref answers the same short name, or a ref is named like the commit,
 * this throws: the name is ambiguous. Any other expression (HEAD, HEAD~1, an abbreviated
 * commit) is left to `git rev-parse`.
 */
export function commitOf(repo, ref) {
  const name = String(ref ?? '');
  const ambiguous = (what) => new Error(`${name} is ambiguous: ${what}; name the base by its`
    + ' full ref (refs/remotes/origin/<branch>) or its full commit name, and remove the other');
  let target = name;
  if (FULL_SHA.test(name)) {
    const named = candidates(name).filter((c) => exists(repo, c));
    if (named.length) throw ambiguous(`${named.join(', ')} has the same name`);
  } else if (name.startsWith('refs/') && NAME.test(name)) {
    if (!exists(repo, name)) throw new Error(`${name} does not exist (git show-ref --verify)`);
    const short = shortOf(name);
    const others = short ? candidates(short).filter((c) => c !== name && exists(repo, c)) : [];
    if (others.length) throw ambiguous(`${others.join(', ')} shadows its short name ${short}`);
  } else if (NAME.test(name) && name !== 'HEAD') {
    const found = candidates(name).filter((c) => exists(repo, c));
    if (found.length > 1) throw ambiguous(`${found.join(', ')} all answer it`);
    if (found.length === 1) target = found[0];
  }
  const sha = git(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options',
    `${target}^{commit}`]);
  if (!sha) throw new Error(`${name} names no commit in ${repo}`);
  return sha;
}

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

/**
 * Whether `name` is a ref name, short or full, by git's rules (git check-ref-format, one level
 * allowed): any character but the ASCII controls, space, ~ ^ : ? * [ \ and DEL, no `..`, no
 * `@{`, not `@`, no empty, `.`-led or `.lock` component, no trailing `.`. So `+`, `@`, `,`
 * and non-ASCII letters are in it (review of #255, R13), and a revision expression is not.
 */
export function isRefName(name) {
  if (!name || name === '@' || /[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false;
  if (name.includes('..') || name.includes('@{') || name.endsWith('.')) return false;
  return name.split('/').every((c) => c && !c.startsWith('.') && !c.endsWith('.lock'));
}

// a ref name followed by ancestry or peel steps (`origin/main~1`, `main^0`, `v1^{commit}`):
// the name is checked like any other, and the steps applied to its commit
const STEPS = /^([^~^]+)((?:~\d*|\^(?:\d+|\{[a-z]*\})?)+)$/;

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
 * this throws: the name is ambiguous. A ref name with ancestry or peel steps after it
 * (`origin/main~1`) is its name checked so, then the steps. Any other expression (HEAD,
 * HEAD~1, an abbreviated commit, `@{u}`) is left to `git rev-parse`. An annotated tag is
 * peeled to its commit; a name of anything but a commit throws.
 */
export function commitOf(repo, ref) {
  const name = String(ref ?? '');
  const steps = STEPS.exec(name);
  if (steps && isRefName(steps[1]) && steps[1] !== 'HEAD') {
    return peel(repo, `${commitOf(repo, steps[1])}${steps[2]}`, name);
  }
  const ambiguous = (what) => new Error(`${name} is ambiguous: ${what}; name the base by its`
    + ' full ref (refs/remotes/origin/<branch>) or its full commit name, and remove the other');
  let target = name;
  if (FULL_SHA.test(name)) {
    const named = candidates(name).filter((c) => exists(repo, c));
    if (named.length) throw ambiguous(`${named.join(', ')} has the same name`);
  } else if (name.startsWith('refs/') && isRefName(name)) {
    if (!exists(repo, name)) throw new Error(`${name} does not exist (git show-ref --verify)`);
    const short = shortOf(name);
    const others = short ? candidates(short).filter((c) => c !== name && exists(repo, c)) : [];
    if (others.length) throw ambiguous(`${others.join(', ')} shadows its short name ${short}`);
  } else if (isRefName(name) && name !== 'HEAD') {
    const found = candidates(name).filter((c) => exists(repo, c));
    if (found.length > 1) throw ambiguous(`${found.join(', ')} all answer it`);
    if (found.length === 1) target = found[0];
  }
  return peel(repo, target, name);
}

/** The commit `rev` names, peeled (`^{commit}`), or a throw that names `name`. */
function peel(repo, rev, name) {
  const sha = git(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options',
    `${rev}^{commit}`]);
  if (!sha) throw new Error(`${name} names no commit in ${repo}`);
  return sha;
}

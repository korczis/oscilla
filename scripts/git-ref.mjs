// The commit a pull-request rule takes as its base (scripts/fail-first.mjs,
// scripts/review-verdict.mjs, scripts/pr-metadata.mjs), named so that nothing else can answer
// for it. git resolves a short name by trying refs/<n>, refs/tags/<n>, refs/heads/<n>,
// refs/remotes/<n> in that order, and CI checks out with every tag, so a pushed tag named
// origin/main would shadow the remote-tracking branch origin/main (review of #255, R2).
// .github/scripts/base-rule.sh passes refs/remotes/origin/<base>; these programs refuse a name
// that more than one ref answers, in its short or its full form, rather than guess.
//
// Every git call of a judge (these, and those of scripts/fail-first.mjs) goes through
// judgeGit() (review of #255, round 8): with GIT_NO_REPLACE_OBJECTS=1, so a ref under
// refs/replace/ never answers for the commit it names; GIT_CONFIG_GLOBAL=/dev/null and
// GIT_CONFIG_NOSYSTEM=1, so no user or system configuration is read; no other GIT_* variable
// of the caller (GIT_DIR, GIT_INDEX_FILE, GIT_CONFIG_PARAMETERS, ...); and `-c` overrides of
// the repository's own configuration for what could start a program on a read
// (core.fsmonitor, core.hooksPath, core.pager; a diff runs with --no-ext-diff). What the
// repository's .git holds is read before any child of the judge runs, so nothing of the pull
// request has written it.

import { spawnSync } from 'node:child_process';

/** The environment settings of every git call of a judge. */
export const JUDGE_GIT_ENV = Object.freeze({ GIT_NO_REPLACE_OBJECTS: '1',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

/** The `-c` settings of every git call of a judge: the repository's config starts nothing. */
export const JUDGE_GIT_CONFIG = Object.freeze(['-c', 'core.fsmonitor=false',
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.pager=cat']);

/** `base` without any GIT_* variable, with JUDGE_GIT_ENV. */
export function gitEnv(base = process.env) {
  const env = Object.fromEntries(Object.entries(base).filter(([k]) => !/^GIT_/i.test(k)));
  return { ...env, ...JUDGE_GIT_ENV };
}

/** `git -C <repo> <args>` as a judge runs it: spawnSync's result. */
export function judgeGit(repo, args, opts = {}) {
  return spawnSync('git', [...JUDGE_GIT_CONFIG, '-C', repo, ...args],
    { encoding: 'utf8', ...opts, env: gitEnv(opts.env) });
}

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

/**
 * A revision as [name, suffix]: the longest leading part that can be a ref name (up to the
 * first ~ ^ : or `@{`), and the rest: ancestry and peel steps (`~1`, `^0`, `^{commit}`,
 * `^{/message}`), a reflog or upstream entry (`@{1}`, `@{u}`) or a path (`:file`). Any suffix
 * counts, not a list of forms, so a shadowed name is checked whatever follows it (review of
 * #255, R13).
 */
export function splitRevision(rev) {
  const m = /[~^:]|@\{/.exec(rev);
  return m ? [rev.slice(0, m.index), rev.slice(m.index)] : [rev, ''];
}

function git(repo, args) {
  const r = judgeGit(repo, args);
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
 * this throws: the name is ambiguous. A ref name with anything after it (`origin/main~1`,
 * `origin/main^{/fix}`, `origin/main@{1}`, splitRevision) is its name checked so, then the
 * suffix applied to the one ref it names. Any other expression (HEAD, HEAD~1, an abbreviated
 * commit, `@{u}`) is left to `git rev-parse`. An annotated tag is peeled to its commit; a name
 * of anything but a commit throws.
 */
export function commitOf(repo, ref) {
  const name = String(ref ?? '');
  const [prefix, suffix] = splitRevision(name);
  if (suffix && isRefName(prefix) && prefix !== 'HEAD') {
    return peel(repo, `${qualified(repo, prefix)}${suffix}`, name);
  }
  return peel(repo, qualified(repo, name), name);
}

/**
 * The one name `name` stands for: itself when it is a full commit name or a full ref name,
 * the one ref that answers a short name (or the name itself when none does, for git to
 * resolve), or a throw when more than one ref answers it.
 */
function qualified(repo, name) {
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
  return target;
}

/** The commit `rev` names, peeled (`^{commit}`), or a throw that names `name`. */
function peel(repo, rev, name) {
  const sha = git(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options',
    `${rev}^{commit}`]);
  if (!sha) throw new Error(`${name} names no commit in ${repo}`);
  return sha;
}

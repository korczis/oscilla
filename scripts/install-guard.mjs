#!/usr/bin/env node
// What `npm ci --ignore-scripts` would run or fetch of a pull request, refused before it runs.
//
//   node scripts/install-guard.mjs [--repo <dir>] [--before-install]   # exit 1, a line each
//
// The fail-first judge (scripts/fail-first.mjs, the base commit's copy) installs the pull
// request's packages itself, as a child, before it runs the PR's tests, and calls guard()
// in-process first; --ignore-scripts turns off lifecycle scripts only: npm still clones a git
// dependency and runs its `prepare` (review of #255, R17), and still spawns the helper
// programs a project .npmrc names, `git=./evil.sh` among them (R18). Either can rewrite the
// judge or write $GITHUB_ENV and $GITHUB_PATH for the steps after it. package.json, the
// lockfile and .npmrc are not guarded paths, so this program reads them as the pull request
// left them, from the judge's own copy of the base commit, and refuses:
//   lockfile   no package-lock.json (or npm-shrinkwrap.json), a lockfileVersion below 2, an
//              entry whose `resolved` is not a tarball of https://registry.npmjs.org/ (git,
//              file, http, another host, none), one without a sha512 `integrity`, a link
//              (`link: true`, a directory of the checkout), and a bundled entry (`inBundle`)
//              that its parent's tarball is not shown to carry: a bundled package arrives
//              inside the tarball of its bundler, so that sha512 checks it (Tailwind 4's
//              @tailwindcss/oxide-wasm32-wasi bundles six, review of #255, R29), but npm
//              installs one the tarball lacks from the entry's own `version` (`file:<dir>`
//              runs that directory's prepare under --ignore-scripts, R34). So a bundled entry
//              passes only when its name (its folder) is in the `bundleDependencies` of the
//              lock entry it is nested in, that entry is a registry tarball with a sha512 or
//              itself such a bundled entry (R36: arborist's getBundler names the outermost
//              bundler, so the top registry parent's sha512 checks the nested bundle, and the
//              entry that lists a package is the one whose directory holds it), its `version`
//              is an exact semver and it records no resolved, integrity, link or other source
//              field and no other package's name: if the tarball does lack it, all npm can do
//              is fetch that name at that version from the registry (R34)
//   manifest   a package.json with bundleDependencies / bundledDependencies (a bundled
//              dependency has no lockfile entry) or workspaces (packages of the checkout), a
//              dependency or an `overrides` value or key, nested ones included, whose spec is
//              not the registry's (below)
//   npmrc      a .npmrc anywhere in the checkout with a key outside NPMRC_KEYS: helper
//              programs (git, script-shell, shell, node-options, onload-script, ...), other
//              registries (registry, @scope:registry, replace-registry-host), strict-ssl=false
//              and every key not listed; ignore-scripts other than true
//   entries    in every lock entry, the root entry "" included, each spec of its
//              dependencies, optionalDependencies, peerDependencies and devDependencies maps,
//              as package.json's (npm resolves an edge whose spec its locked package does not
//              satisfy, and clones a git spec there under --ignore-scripts too: round 4, R17),
//              and a bundleDependencies or workspaces list in an entry
//   specs      every spec, package.json's, the overrides' (keys too) and the lock entries', is
//              classified by npm-package-arg, the one inside the runner's own npm (the npm
//              beside the node running this program, loaded by absolute path, never from the
//              pull request's node_modules or the working directory; none there: every spec
//              is refused). Accepted: the types version, range and tag, and an alias whose
//              target is a registry name with one of those; an overrides value `$<name>`
//              refers to a root dependency, itself checked. Anything else (git, directory,
//              file, remote, an alias of those, a spec it cannot read) is refused: a
//              hand-written grammar kept drifting from npm's (`D:evil`, `.evil`,
//              `@scope/name@^1` are directories to npm: R24, R32, R35)
//   npmrc      any carriage return: npm's ini splits lines on [\r\n]+, so a key after a lone
//              CR is a line of its own to npm (round 4, R18)
//   modules    with --before-install (the judge's install), any node_modules at the
//              checkout's root: the install has not run yet, so the pull request committed
//              it, and a symbolic link there makes npm ci empty what it points to (R25)
// So nothing is resolved outside the registry, and what comes from it is checked against the
// lockfile's sha512: the guard trusts the registry and those hashes (esbuild's platform
// binary is such a package), and the registry alone for a bundled package a tarball would
// lack (an exact name and version, no install script run). Tested by
// tests/unit/install-guard.test.mjs and the replay of the judge jobs in
// tests/unit/base-rule.test.mjs.
//
// Exit 0: nothing refused. Exit 1: refused. Exit 2: usage.

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGISTRY = 'https://registry.npmjs.org/';
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies',
  'peerDependencies'];
/** The npm-package-arg types of a registry spec; an alias is one when its target is (R35). */
const REGISTRY_TYPES = new Set(['version', 'range', 'tag']);
/** What in a lock entry names a source of its own; a bundled entry carries none (R34). */
const SOURCE_FIELDS = ['resolved', 'integrity', 'link', 'from', '_resolved', '_integrity',
  '_from'];
/** Where npm-package-arg resolves a path spec: no directory, only the type is read. */
const NOWHERE = path.join(path.sep, 'install-guard', 'nowhere');
/**
 * The keys a project .npmrc may set: none of them makes npm run a program, fetch from
 * another host or skip a check. Compared after lower-casing and `_` to `-`.
 */
export const NPMRC_KEYS = new Set(['audit', 'audit-level', 'color', 'engine-strict', 'fund',
  'ignore-scripts', 'legacy-peer-deps', 'loglevel', 'package-lock', 'prefer-offline',
  'progress', 'save', 'save-exact', 'save-prefix', 'strict-peer-deps', 'update-notifier']);

const requireAbsolute = createRequire(import.meta.url);
const TOOLS = new Map();

/**
 * npm-package-arg and semver from the npm that ships with the node `nodePath` (by default the
 * node running this program, process.execPath: in CI the node the judge step recorded and
 * starts the judge with), loaded by absolute path from `<node dir>/../lib/node_modules/npm`,
 * never resolved from the working directory or a node_modules of the pull request (review of
 * #255, R35). `{ problem }` when that npm or its npm-package-arg is not there: every spec is
 * then refused.
 */
export function npmTools(nodePath = process.execPath) {
  const key = String(nodePath);
  if (!TOOLS.has(key)) TOOLS.set(key, loadTools(key));
  return TOOLS.get(key);
}

function loadTools(nodePath) {
  const root = path.resolve(path.dirname(nodePath), '..', 'lib', 'node_modules', 'npm');
  try {
    if (!path.isAbsolute(nodePath)) throw new Error(`${nodePath} is not an absolute path`);
    const own = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (own.name !== 'npm') throw new Error(`${root}/package.json names ${own.name}, not npm`);
    const npa = requireAbsolute(path.join(root, 'node_modules', 'npm-package-arg'));
    const semver = requireAbsolute(path.join(root, 'node_modules', 'semver'));
    if (typeof npa !== 'function' || typeof npa.resolve !== 'function'
      || typeof semver.parse !== 'function') {
      throw new Error('not npm-package-arg and semver');
    }
    return { npa, semver, root, npm: own.version };
  } catch (e) {
    return { problem: `no npm-package-arg in the npm of ${nodePath} (${root}: ${e.message}),`
      + ' so no spec can be classified: refused' };
  }
}

/**
 * Why a dependency spec is not one npm resolves from the registry, or null: npm-package-arg
 * of the runner's npm (npmTools) classifies it as npm does an edge `name`@`spec`, and only
 * the types version, range and tag pass, and an alias whose target is a registry name with
 * one of those (R35; R24, R32 were hand-written cases of this).
 */
export function nonRegistrySpec(spec, { name, tools = npmTools() } = {}) {
  if (tools.problem) return tools.problem;
  if (typeof spec !== 'string') return 'is not a version';
  let r;
  try {
    r = tools.npa.resolve(name || undefined, spec, NOWHERE);
  } catch (e) {
    return `is no spec npm reads as the registry's (npm-package-arg: ${e.message})`;
  }
  if (REGISTRY_TYPES.has(r.type)) return null;
  if (r.type === 'alias') {
    const sub = r.subSpec;
    if (sub && sub.registry && sub.name && REGISTRY_TYPES.has(sub.type)) return null;
    return `is an alias of a ${sub?.type} spec, not of a registry name (npm-package-arg)`;
  }
  return `is a ${r.type} spec to npm (npm-package-arg), not a registry version, range, tag`
    + ' or alias of one';
}

/** Whether `v` is an exact semver as written: no range, no `v`, no `=`, no spaces (R34). */
function exactVersion(v, tools) {
  if (typeof v !== 'string') return false;
  const parsed = tools.semver.parse(v);
  if (!parsed) return false;
  return v === parsed.version + (parsed.build.length ? `+${parsed.build.join('.')}` : '');
}

/** Why a lock entry is not a registry tarball checked by a sha512 integrity, or null. */
function tarballProblem(entry) {
  const resolved = typeof entry.resolved === 'string' ? entry.resolved : '';
  if (!resolved.startsWith(REGISTRY) || !/\.tgz$/.test(new URL(resolved, REGISTRY).pathname)) {
    return `resolves to ${resolved || '(nothing)'}, not a tarball of ${REGISTRY}`;
  }
  if (new URL(resolved).host !== 'registry.npmjs.org') {
    return `resolves to ${resolved}, not ${REGISTRY}`;
  }
  return null;
}

/** Why a lock entry's integrity is not a sha512 its download is checked against, or null. */
function integrityProblem(entry) {
  const integrity = String(entry.integrity ?? '').trim().split(/\s+/).filter(Boolean);
  if (integrity.length && integrity.every((h) => INTEGRITY.test(h))) return null;
  return `has ${integrity.length ? `integrity ${entry.integrity}` : 'no integrity'},`
    + ' not a sha512 the download is checked against';
}

/** The names a lock entry's bundle list holds (npm reads `true` as all its dependencies). */
function bundleList(entry) {
  const bd = entry.bundleDependencies ?? entry.bundledDependencies;
  if (bd === true) return Object.keys(entry.dependencies ?? {});
  return Array.isArray(bd) ? bd.filter((n) => typeof n === 'string') : [];
}

/**
 * Why the bundled (inBundle) lock entry `key` is not shown to arrive inside a registry
 * tarball that a sha512 checks, or null (review of #255, R29, R34, R36). Its holder is the
 * entry whose directory holds it (`a/node_modules/b` holds `a/node_modules/b/node_modules/c`;
 * a scoped folder `@s/n` is one name). Accepted only when:
 *   the holder is a registry tarball with a sha512, or itself a bundled entry accepted by
 *   this rule (R36: arborist's getBundler returns the outermost bundler, so the bytes of a
 *   nested bundle are in the top registry parent's tarball and that sha512 checks them);
 *   its folder name is in the holder's bundleDependencies (a package npm pack puts in a
 *   tarball is one the packed package lists; a dependency deduped into a bundle that no list
 *   names is refused, which is stricter than npm);
 *   its version is an exact semver, and it records no resolved, integrity, link or other
 *   source field and no other package's name: npm installs a bundled package the tarball
 *   lacks from that entry (a `file:<dir>` version runs that directory's prepare under
 *   --ignore-scripts), so at worst it fetches that name at that version from the registry.
 */
function bundleProblem(packages, key, tools) {
  const entry = packages[key];
  const cut = key.lastIndexOf('/node_modules/');
  if (cut < 0) return 'only the root (the checkout) encloses it';
  const at = key.slice(0, cut);
  const folder = key.slice(cut + '/node_modules/'.length);
  const holder = packages[at];
  if (!holder || typeof holder !== 'object') return `${at}, which would hold it, has no entry`;
  if (holder.link) return `its bundling parent ${at} is a link of the checkout`;
  if (holder.inBundle) {
    const up = bundleProblem(packages, at, tools);
    if (up) return `the bundled ${at} that holds it is refused (${up})`;
  } else {
    const unchecked = tarballProblem(holder) || integrityProblem(holder);
    if (unchecked) {
      return `its bundling parent ${at} ${unchecked}: no sha512 checks what it brings`;
    }
  }
  if (!bundleList(holder).includes(folder)) {
    return `${folder} is not in the bundleDependencies of ${at}: nothing shows that its tarball`
      + ' carries it, and npm installs a bundled package it lacks from the entry\'s version';
  }
  if (!exactVersion(entry.version, tools)) {
    return `its version ${JSON.stringify(entry.version)} is not an exact semver (npm installs a`
      + ' bundled package its parent lacks from it)';
  }
  const source = SOURCE_FIELDS.filter((f) => f in entry);
  if (source.length) return `it records ${source.join(', ')}: a bundled package has no source`;
  if ('name' in entry && entry.name !== folder) return `it names another package (${entry.name})`;
  return null;
}

/**
 * The refusals of the dependency maps and lists of one manifest or lock entry `pkg`;
 * `bundles`: a bundle list is allowed, since `pkg` is a registry tarball checked by sha512,
 * or a bundled entry inside one, that carries its bundled packages inside (R29, R36).
 */
function specProblems(pkg, at, { bundles = false, tools }) {
  const out = [];
  for (const k of ['bundleDependencies', 'bundledDependencies']) {
    if (k in pkg && !bundles) out.push(`${at}: ${k} (a bundled dependency has no lockfile entry)`);
  }
  if ('workspaces' in pkg) out.push(`${at}: workspaces (packages installed from the checkout)`);
  for (const field of DEPENDENCY_FIELDS) {
    const deps = pkg[field];
    if (deps === undefined) continue;
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
      out.push(`${at}: ${field} is not a map of names to versions`);
      continue;
    }
    for (const [dep, spec] of Object.entries(deps)) {
      const why = nonRegistrySpec(spec, { name: dep, tools });
      if (why) out.push(`${at}: ${field}.${dep} = ${JSON.stringify(spec)} ${why}`);
    }
  }
  return out;
}

/** The refusals of a lockfile's text (`name` the file's); `tools`: npmTools(). */
export function lockfileProblems(text, name = 'package-lock.json', { tools = npmTools() } = {}) {
  if (tools.problem) return [`${name}: ${tools.problem}`];
  let lock;
  try {
    lock = JSON.parse(text);
  } catch (e) {
    return [`${name}: not JSON (${e.message})`];
  }
  if (!lock || typeof lock !== 'object') return [`${name}: not a lockfile`];
  if (!(Number(lock.lockfileVersion) >= 2) || !lock.packages || typeof lock.packages !== 'object') {
    return [`${name}: lockfileVersion ${lock.lockfileVersion} has no packages map (2 or 3 needed)`];
  }
  const out = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    const at = `${name}: ${key || '(the root entry "")'}`;
    if (!entry || typeof entry !== 'object') {
      out.push(`${at} is no entry`);
      continue;
    }
    const bundled = key !== '' && !entry.link && entry.inBundle
      ? bundleProblem(lock.packages, key, tools) : null;
    const checked = key !== '' && !entry.link && (entry.inBundle ? !bundled
      : !tarballProblem(entry) && !integrityProblem(entry));
    // the specs inside the entry: an edge npm finds unsatisfied it resolves again (R17)
    out.push(...specProblems(entry, at, { bundles: checked, tools }));
    if (key === '') continue;
    if (entry.link) {
      out.push(`${at} links ${entry.resolved ?? 'a directory'} of the checkout (link: true)`);
      continue;
    }
    if (entry.inBundle) {
      if (bundled) out.push(`${at} is bundled (inBundle), and ${bundled}`);
      continue;
    }
    const where = tarballProblem(entry);
    if (where) out.push(`${at} ${where}`);
    const hash = integrityProblem(entry);
    if (hash) out.push(`${at} ${hash}`);
  }
  return out;
}

/** The refusals of a package.json's text (`name` the file's); `tools`: npmTools(). */
export function manifestProblems(text, name = 'package.json', { tools = npmTools() } = {}) {
  if (tools.problem) return [`${name}: ${tools.problem}`];
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch (e) {
    return [`${name}: not JSON (${e.message})`];
  }
  if (!pkg || typeof pkg !== 'object') return [`${name}: not a manifest`];
  const out = specProblems(pkg, name, { tools });
  // as arborist's OverrideSet reads them: a key is an argument `name[@spec]`, a value (or a
  // "." key) the spec for that name, `$<name>` a reference to a root dependency's spec
  const walk = (value, at, dep) => {
    if (typeof value === 'string') {
      if (value.startsWith('$')) {
        if (!/^\$[\w@/.-]+$/.test(value)) {
          out.push(`${name}: ${at} = ${JSON.stringify(value)} is no root dependency reference`);
        }
        return;
      }
      const why = nonRegistrySpec(value, { name: dep, tools });
      if (why) out.push(`${name}: ${at} = ${JSON.stringify(value)} ${why}`);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (k === '.') {
          walk(v, `${at}.${k}`, dep);
          continue;
        }
        let keyName;
        let why = null;
        try {
          const key = tools.npa(k, NOWHERE);
          keyName = key.name;
          if (!keyName) why = 'names no package';
          else if (!REGISTRY_TYPES.has(key.type)) {
            why = `is a ${key.type} spec to npm (npm-package-arg), not the registry`;
          }
        } catch (e) {
          why = `is no spec npm reads (npm-package-arg: ${e.message})`;
        }
        if (why) out.push(`${name}: ${at} key ${JSON.stringify(k)} ${why}`);
        walk(v, `${at}.${k}`, keyName);
      }
    } else if (value !== undefined && value !== null) {
      out.push(`${name}: ${at} = ${JSON.stringify(value)} is not a version`);
    }
  };
  if ('overrides' in pkg) walk(pkg.overrides, 'overrides', undefined);
  return out;
}

/** The refusals of an .npmrc's text (`name` the file's). */
export function npmrcProblems(text, name = '.npmrc') {
  const out = [];
  // npm's ini splits on [\r\n]+: a lone CR starts a line npm reads and a \r?\n split does not
  // (round 4, R18), so a CR anywhere is refused and the lines are npm's
  if (String(text).includes('\r')) {
    out.push(`${name}: a carriage return (npm's ini starts a new line at it)`);
  }
  String(text).split(/[\r\n]+/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || /^[;#]/.test(line)) return;
    const at = `${name}:${i + 1}`;
    if (/^\[.*\]$/.test(line)) {
      out.push(`${at}: a section ${line} (npm reads its keys too)`);
      return;
    }
    const eq = line.indexOf('=');
    const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
    const key = unquote(eq < 0 ? line : line.slice(0, eq)).replace(/\[\]$/, '');
    const value = eq < 0 ? 'true' : unquote(line.slice(eq + 1));
    const norm = key.toLowerCase().replace(/_/g, '-');
    if (!NPMRC_KEYS.has(norm)) {
      const what = /(^|:)registry$/.test(norm) || norm === 'replace-registry-host'
        ? 'names another registry' : norm === 'strict-ssl' ? 'turns a TLS check off or on'
          : /^(git|script-shell|shell|node-options|onload-script|editor|browser|viewer)$/.test(norm)
            ? 'names a program npm runs' : 'is not one the guard knows to be harmless';
      out.push(`${at}: ${key} ${what} (allowed: ${[...NPMRC_KEYS].join(', ')})`);
    } else if (norm === 'ignore-scripts' && value.toLowerCase() !== 'true') {
      out.push(`${at}: ignore-scripts=${value} would run lifecycle scripts`);
    }
  });
  return out;
}

/** Every .npmrc of the checkout, outside .git and node_modules, relative to `repo`. */
function npmrcFiles(repo) {
  const found = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.name === '.npmrc') found.push(p);
      else if (e.isDirectory() && !lstatSync(p).isSymbolicLink()) walk(p);
    }
  };
  walk(repo);
  return found.map((p) => path.relative(repo, p)).sort();
}

/**
 * Every refusal for the checkout at `repo`; `beforeInstall`: the install has not run, so any
 * node_modules there is the pull request's (R25); `nodePath`: the node whose npm classifies
 * the specs (npmTools; the running node by default, which in CI is the recorded one, R35).
 */
export function guard(repo, { beforeInstall = false, nodePath = process.execPath } = {}) {
  const tools = npmTools(nodePath);
  const out = [];
  if (tools.problem) out.push(tools.problem);
  const modules = path.join(repo, 'node_modules');
  let stat = null;
  try {
    stat = lstatSync(modules);
  } catch {
    // none: what a fresh checkout has
  }
  if (stat && beforeInstall) {
    out.push(stat.isSymbolicLink()
      ? 'node_modules is a symbolic link: npm ci would empty the directory it points to'
      : 'node_modules exists before the install: the pull request committed it');
  }
  const read = (rel) => readFileSync(path.join(repo, rel), 'utf8');
  const locks = ['npm-shrinkwrap.json', 'package-lock.json']
    .filter((f) => existsSync(path.join(repo, f)));
  if (!locks.length) out.push('no package-lock.json: npm ci would have nothing to check');
  if (!tools.problem) {
    for (const f of locks) out.push(...lockfileProblems(read(f), f, { tools }));
  }
  if (existsSync(path.join(repo, 'package.json'))) {
    if (!tools.problem) {
      out.push(...manifestProblems(read('package.json'), 'package.json', { tools }));
    }
  } else {
    out.push('no package.json');
  }
  for (const f of npmrcFiles(repo)) {
    const stat = lstatSync(path.join(repo, f));
    if (stat.isSymbolicLink()) out.push(`${f}: a symbolic link (npm reads where it points)`);
    else out.push(...npmrcProblems(read(f), f));
  }
  return out;
}

const isMain = process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  let repo = process.cwd();
  let beforeInstall = false;
  while (argv.length) {
    const a = argv.shift();
    if (a === '--repo' && argv.length) repo = path.resolve(argv.shift());
    else if (a === '--before-install') beforeInstall = true;
    else {
      console.error(`install-guard: unknown argument ${a}`);
      console.error('usage: node scripts/install-guard.mjs [--repo <dir>] [--before-install]');
      process.exit(2);
    }
  }
  const problems = guard(repo, { beforeInstall });
  for (const p of problems) console.log(`::error::install-guard: ${p}`);
  if (problems.length) {
    console.log(`install-guard: REFUSED, ${problems.length} problem(s): npm ci would run or`
      + ' fetch something of the pull request outside the registry');
    process.exit(1);
  }
  console.log('install-guard: the install fetches only registry tarballs checked by sha512,'
    + ' and no .npmrc names a program');
}

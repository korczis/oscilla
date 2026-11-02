// docs/EXTENDING.md ("Hack and extend OSCILLA") and the README landing name real code
// (claims extending-guide-checked and readme-landing-links-route, plan issue E028).
//   node --test tests/unit/extending-guide.test.mjs
//
// What the guide is held to:
//   - every inline code span that is a repository path exists, and every `project.<rule>` span
//     names a rule file under .ai/repo/rules/project; `path#name` names an export of
//     that module (read statically: export declarations and export lists in ES modules,
//     module.exports and exports.x in CommonJS); a path with a <placeholder> exists up to the
//     directory before it;
//   - every `npm run <script>` and `npm test`, inline or in a bash block, is a package.json
//     script, and every file a `node <file>` command runs exists;
//   - every relative Markdown link target exists, and an in-page #anchor names a heading;
//   - every import and require of a js block resolves, from the path the block's first comment
//     line declares, to a file that exports each imported name, or to another block of the
//     guide that declares that path (the file the guide asks you to create) and exports it;
//   - the Studio node example is imported as written and compiles through the real registry,
//     compiler and adapter contract, and the guide's test of it passes as printed.
// The checker is run on a broken fixture too, so it cannot pass by finding nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { NODE_DEFINITIONS, createNodeRegistry } from '../../src/js/studio/registry.js';
import { NODE_ADAPTERS } from '../../src/js/studio/adapters/nodes.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
import { createStudioModel } from '../../src/js/studio/schema.js';
import { edge, node } from '../../src/js/studio/templates/data.js';
import { routeOfHash } from '../../src/js/ui/navigation.js';
import { decodeRecipeLink } from '../../src/js/core/url-state-measure.js';
import { decodeStudioLink } from '../../src/js/core/url-state-studio.js';
import { parseClaims } from './claims-parse.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GUIDE = 'docs/EXTENDING.md';
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const PAGES = 'https://korczis.github.io/oscilla/';

// ---------------------------------------------------------------- the checker

const PATH_SPAN = new RegExp('^(?:(?:\\.ai|\\.github|dist|docs|scripts|site|src|tests)/\\S*'
  + '|(?:README|CLAUDE|AGENTS|GEMINI)\\.md|package\\.json)$');
const NPM = /\bnpm (run ([\w:-]+)|test)\b/g;
const RULE_SPAN = /^project\.[a-z][a-z0-9-]*$/;
const RULES_DIR = '.ai/repo/rules/project';

/** The Markdown without its fenced blocks, and the blocks with their info string. */
export function splitFences(md) {
  const blocks = [];
  const prose = md.replace(/^```(\w*)[^\n]*\n([\s\S]*?)^```\s*$/gm, (_, lang, body) => {
    blocks.push({ lang, body });
    return '';
  });
  return { prose, blocks };
}

/** GitHub's heading anchor. */
export const slug = (heading) => heading.trim().toLowerCase().replace(/<[^>]+>/g, '')
  .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

const exportListNames = (list) => list.split(',').map((x) => x.trim()).filter(Boolean)
  .map((x) => (x.includes(' as ') ? x.split(/\s+as\s+/)[1] : x).trim());

/** The names an import list takes from its module (`a as b` imports a). */
const importedNames = (list) => list.split(',').map((x) => x.trim().split(/\s+as\s+/)[0])
  .filter(Boolean);

/** Whether the module text exports `name` (static reading; see the header). */
export function exportsName(text, name, file) {
  const n = name.replace(/[$]/g, '\\$');
  if (file.endsWith('.cjs')) {
    if (new RegExp(`\\bexports\\.${n}\\s*=`).test(text)) return true;
    const m = text.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/);
    return !!m && m[1].split(',').map((x) => x.split(':')[0].trim()).includes(name);
  }
  if (name === 'default') return /^export default\b/m.test(text);
  if (new RegExp(`^export\\s+(?:async\\s+)?(?:function\\*?|class|const|let|var)\\s+${n}\\b`, 'm')
    .test(text)) return true;
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    if (exportListNames(m[1]).includes(name)) return true;
  }
  return false;
}

/**
 * Problems of one Markdown document at `docPath` against the tree at `root` with the package
 * scripts `scripts`. Empty when every reference holds.
 */
export function checkGuide(md, { root = ROOT, docPath = GUIDE, scripts }) {
  const problems = [];
  const exists = (p) => existsSync(join(root, p));
  const text = (p) => readFileSync(join(root, p), 'utf8');
  const checkPath = (ref, where) => {
    const [p, name] = ref.split('#');
    const cut = p.search(/[<*]/);
    if (cut >= 0) {
      const dir = p.slice(0, p.lastIndexOf('/', cut));
      if (!exists(dir)) problems.push(`${where}: ${ref}: directory ${dir} does not exist`);
      return;
    }
    const declared = !exists(p) && declaredBlocks.get(p);
    if (!exists(p) && !declared) { problems.push(`${where}: ${ref}: no such file`); return; }
    if (name && !exportsName(declared || text(p), name, p)) {
      problems.push(`${where}: ${ref}: ${p} does not export ${name}`);
    }
  };
  const checkScripts = (s, where) => {
    for (const m of s.matchAll(NPM)) {
      const script = m[2] || 'test';
      if (!Object.hasOwn(scripts, script)) {
        problems.push(`${where}: npm script ${script} is missing`);
      }
    }
  };
  const checkNodeCommand = (s, where) => {
    const m = s.match(/(?:^|\s)node\s+(?:--test\s+)?(\S+\.(?:c?js|mjs))/);
    if (m) checkPath(m[1], where);
  };
  const { prose, blocks } = splitFences(md);
  // A js example that declares a path the tree does not have yet is the file the guide asks you
  // to create: prose and other examples may name it, and its exports are read from the block.
  const declaredBlocks = new Map(blocks.filter((b) => b.lang === 'js')
    .map((b) => [(b.body.match(/^\/\/\s*(\S+\.(?:c?js|mjs))\b/) || [])[1], b.body])
    .filter(([p]) => p));
  for (const [, span] of prose.matchAll(/`([^`\n]+)`/g)) {
    if (PATH_SPAN.test(span)) checkPath(span, 'span');
    if (RULE_SPAN.test(span)) {
      const name = span.slice('project.'.length);
      const files = existsSync(join(root, RULES_DIR)) ? readdirSync(join(root, RULES_DIR)) : [];
      if (!files.some((f) => new RegExp(`^${name}\\.v\\d+\\.md$`).test(f))) {
        problems.push(`span: rule ${span} has no file under ${RULES_DIR}`);
      }
    }
    checkScripts(span, 'span');
    if (/^node\s/.test(span)) checkNodeCommand(span, 'span');
  }
  const anchors = new Set([...md.matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, h]) => slug(h)));
  for (const [, target] of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/.test(target)) continue;
    if (target.startsWith('#')) {
      if (!anchors.has(target.slice(1))) problems.push(`link: ${target}: no such heading`);
      continue;
    }
    const p = normalize(join(dirname(docPath), target.split('#')[0])).replace(/\\/g, '/');
    if (!exists(p)) problems.push(`link: ${target}: ${p} does not exist`);
  }
  for (const { lang, body } of blocks) {
    if (lang === 'bash' || lang === 'sh') {
      for (const line of body.split('\n')) {
        checkScripts(line, 'bash');
        checkNodeCommand(line, 'bash');
      }
      continue;
    }
    if (lang !== 'js') continue;
    const declared = (body.match(/^\/\/\s*(\S+\.(?:c?js|mjs))\b/) || [])[1];
    if (!declared) {
      problems.push('js block: the first line does not declare its path');
      continue;
    }
    const imports = [
      ...[...body.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)]
        .map(([, names, spec]) => ({ names: importedNames(names), spec })),
      ...[...body.matchAll(/const\s*\{([^}]*)\}\s*=\s*require\('([^']+)'\)/g)]
        .map(([, names, spec]) => ({ names: exportListNames(names), spec })),
      ...[...body.matchAll(/const\s+\w+\s*=\s*require\('(\.[^']+)'\)/g)]
        .map(([, spec]) => ({ names: [], spec })),
    ];
    for (const { names, spec } of imports) {
      if (!spec.startsWith('.')) continue;
      const file = normalize(join(dirname(declared), spec)).replace(/\\/g, '/');
      const source = exists(file) ? text(file) : declaredBlocks.get(file);
      if (source === undefined) {
        problems.push(`${declared}: ${spec}: ${file} does not exist`);
        continue;
      }
      for (const name of names) {
        if (!exportsName(source, name, file)) {
          problems.push(`${declared}: ${spec} does not export ${name}`);
        }
      }
    }
  }
  return problems;
}

const SCRIPTS = JSON.parse(read('package.json')).scripts;

/** The js block after `<!-- extending-guide:example <id> -->`. */
function example(md, id) {
  const at = md.indexOf(`<!-- extending-guide:example ${id} -->`);
  assert.ok(at >= 0, `the guide marks the ${id} example`);
  const m = md.slice(at).match(/```js\n([\s\S]*?)^```/m);
  assert.ok(m, `the ${id} example is a js block`);
  return m[1];
}

/**
 * A js block's source as the module it declares itself to be: relative imports resolved from
 * that path, and an import of a path in `modules` (path -> URL) sent to that URL instead.
 */
function blockSource(body, modules = {}) {
  const declared = body.match(/^\/\/\s*(\S+)/)[1];
  const base = pathToFileURL(join(ROOT, declared));
  return body.replace(/from '(\.[^']+)'/g, (_, spec) => {
    const file = normalize(join(dirname(declared), spec)).replace(/\\/g, '/');
    return `from '${modules[file] || new URL(spec, base).href}'`;
  });
}

const dataUrl = (src) => `data:text/javascript,${encodeURIComponent(src).replace(/'/g, '%27')}`;

/** Import a js block as the module it declares itself to be. */
const importBlock = (body) => import(dataUrl(blockSource(body)));

// ---------------------------------------------------------------- the guide

test('every file, export, link and npm script the guide names exists', () => {
  const md = read(GUIDE);
  assert.match(md, /^# Hack and extend OSCILLA$/m);
  assert.deepEqual(checkGuide(md, { scripts: SCRIPTS }), []);
});

test('the guide covers each kind of extension and the rules, each as its own section', () => {
  const md = read(GUIDE);
  for (const h of ['Add a Studio node', 'Templates', 'Add a lab or a workspace',
    'Add a chart or visualization', 'Add a browser check', 'The single-file build',
    'The rules a change satisfies']) {
    assert.match(md, new RegExp(`^#{2,3} ${h}$`, 'm'), h);
  }
  for (const rule of ['fail-first.v1.md', 'review-verdict.v1.md', 'no-fake-science.v2.md',
    'single-file-deliverable.v2.md', 'audio-engine-discipline.v2.md']) {
    assert.ok(md.includes(`../.ai/repo/rules/project/${rule}`), `links ${rule}`);
  }
});

test('the checker refuses a missing file, export, script, link and import (mutation)', () => {
  const broken = [
    '# T', '', '`src/js/nope.js` and `src/js/studio/registry.js#noSuchExport`,',
    '`npm run no-such-script`, [gone](nope.md) and [here](#nowhere), `project.no-such-rule`.', '',
    '```js', '// src/js/studio/nodes/x.js', "import { noSuchPort } from '../ports.js';", '```', '',
    '```js', '// src/js/studio/nodes/y.js', "import { gone } from './x.js';", '```', '',
    '```bash', 'node tests/browser/no-such-suite.cjs', '```', '',
  ].join('\n');
  const problems = checkGuide(broken, { scripts: SCRIPTS });
  for (const re of [/src\/js\/nope\.js: no such file/, /does not export noSuchExport/,
    /no-such-script is missing/, /docs\/nope\.md does not exist/, /#nowhere: no such heading/,
    /does not export noSuchPort/, /no-such-suite\.cjs: no such file/,
    /rule project\.no-such-rule has no file/, /nodes\/y\.js: \.\/x\.js does not export gone/]) {
    assert.ok(problems.some((p) => re.test(p)), `${re} in ${JSON.stringify(problems)}`);
  }
  // x.js is not in the tree, but the first block declares it: y.js's import of it resolves.
  assert.ok(!problems.some((p) => /x\.js does not exist/.test(p)), problems.join('\n'));
  assert.equal(problems.length, 9, problems.join('\n'));
  // The static export reader sees each export form the guide relies on.
  assert.ok(exportsName('export const A = 1;', 'A', 'x.js'));
  assert.ok(exportsName('export async function b() {}', 'b', 'x.js'));
  assert.ok(exportsName('const c = 1;\nexport { c as d };', 'd', 'x.js'));
  assert.ok(!exportsName('const c = 1;\nexport { c as d };', 'c', 'x.js'));
  assert.ok(exportsName('export default [1];', 'default', 'x.js'));
  assert.ok(exportsName('module.exports = {\n  open,\n  until: u,\n};', 'until', 'x.cjs'));
  assert.ok(!exportsName('// export const A = 1;', 'A', 'x.js'));
});

test('the example node compiles through the real registry, compiler and adapter contract',
  async () => {
    const { polarity, polarityAdapter } = await importBlock(example(read(GUIDE), 'studio-node'));
    const registry = createNodeRegistry([...NODE_DEFINITIONS, polarity]);
    const def = registry.get('polarity');
    assert.ok(def, 'the registry holds the example type');
    assert.deepEqual(registry.defaults('polarity'), { inverted: true });
    assert.equal(registry.summarize({ type: 'polarity', params: { inverted: false } }),
      'Unchanged');
    assert.ok(registry.search('phase flip').some((d) => d.type === 'polarity'));
    assert.throws(() => createNodeRegistry([...NODE_DEFINITIONS, { ...polarity, compiler: 'x' }]),
      /polarity: missing or invalid compiler key/);

    const model = createStudioModel({ graph: {
      nodes: [node('osc-1', 'oscillator', 0, 0), node('pol-1', 'polarity', 200, 0),
        node('master-1', 'master', 400, 0)],
      edges: [edge('e1', 'osc-1', 'audio', 'pol-1', 'audio'),
        edge('e2', 'pol-1', 'audio', 'master-1', 'audio')],
    } }, { registry });
    const engine = { isSupported: () => true };
    const adapters = { ...NODE_ADAPTERS, polarity: polarityAdapter };
    const plan = compileStudio(model, { engine, registry, adapters });
    assert.equal(plan.ok, true, JSON.stringify(plan.errors));
    assert.deepEqual(plan.order, ['osc-1', 'pol-1', 'master-1']);
    const pn = plan.nodes.get('pol-1');
    assert.equal(pn.status, 'ready', pn.reason);
    assert.equal(pn.adapter, polarityAdapter);
    assert.deepEqual([...plan.edges.values()].map((e) => [e.kind, e.status]),
      [['audio', 'active'], ['audio', 'active']]);

    // What the guide says happens without the adapter, or with another key: an explicit
    // status, never a throw.
    const none = compileStudio(model, { engine, registry, adapters: NODE_ADAPTERS });
    assert.equal(none.nodes.get('pol-1').code, 'no-adapter');
    const other = compileStudio(model, { engine, registry,
      adapters: { ...adapters, polarity: { ...polarityAdapter, compiler: 'audio/x.js#y' } } });
    assert.equal(other.nodes.get('pol-1').code, 'adapter-mismatch');
    // A connection the ports refuse never reaches the compiler.
    const bad = createStudioModel({ graph: {
      nodes: [node('lfo-1', 'lfo', 0, 0), node('pol-1', 'polarity', 200, 0)],
      edges: [edge('e1', 'lfo-1', 'control', 'pol-1', 'audio')],
    } }, { registry });
    assert.equal(compileStudio(bad, { engine, registry, adapters }).ok, false);

    // The adapter builds one gain through the engine's accounting, at -1 or 1.
    const tracked = [];
    const gainNode = () => ({ gain: { value: 1, setValueAtTime(v) { this.value = v; } } });
    const ctx = { currentTime: 0, createGain: gainNode };
    const acct = { track: (n) => { tracked.push(n); return n; } };
    for (const [inverted, gain] of [[true, -1], [false, 1]]) {
      tracked.length = 0;
      const h = polarityAdapter.create({ ctx, acct, params: { inverted } });
      assert.equal(tracked.length, 1, 'every node goes through acct.track');
      assert.equal(h.inputs.audio, tracked[0]);
      assert.equal(h.outputs.audio, tracked[0]);
      assert.equal(tracked[0].gain.value, gain);
      assert.equal(h.status, 'ready');
    }
    assert.deepEqual(polarityAdapter.structural, ['inverted']);
  });

test('the example node test passes as printed, against the example node', () => {
  const md = read(GUIDE);
  const nodeBody = example(md, 'studio-node');
  const nodePath = nodeBody.match(/^\/\/\s*(\S+)/)[1];
  const src = blockSource(example(md, 'studio-node-test'),
    { [nodePath]: dataUrl(blockSource(nodeBody)) });
  assert.ok(src.includes(dataUrl(blockSource(nodeBody))), 'the test imports the example node');
  // Its own process, as `node --test tests/unit/my-node.test.mjs` would run it; the parent
  // runner's context variable is dropped so the child reports as a plain test file.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', src],
    { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /^# pass 1$/m);
  assert.match(run.stdout, /^# fail 0$/m);
});

// ---------------------------------------------------------------- the README landing

/** The README from its opening to its first second-level heading. */
const landing = () => {
  const md = read('README.md');
  return md.slice(0, md.indexOf('\n## '));
};

test('each README landing link opens what its text names', () => {
  const text = landing();
  const links = [...text.matchAll(/\]\((https:\/\/korczis\.github\.io\/oscilla\/#[^)\s]+)\)/g)]
    .map(([, url]) => url.slice(PAGES.length));
  assert.equal(links.length, 3, 'three deep links');
  const [play, measure, studio] = links;
  assert.deepEqual(routeOfHash(play), { workspace: 'playground', owner: 'workspace' });
  assert.equal(routeOfHash(measure).workspace, 'measure');
  const recipe = decodeRecipeLink(new URLSearchParams(measure.slice(1)).get('mr'));
  assert.equal(recipe.ok, true, JSON.stringify(recipe.errors));
  assert.deepEqual(recipe.values, { duration: 3, repeats: 2 });
  assert.match(text, /two 3-second log sweeps/);
  assert.equal(routeOfHash(studio).workspace, 'studio');
  assert.deepEqual(decodeStudioLink(studio),
    { ok: true, templateId: 'subtractive-synth', subview: 'graph' });
  assert.match(text, /Subtractive Synth template/);
  assert.ok(text.includes(`<${PAGES}>`), 'the landing links the live page');
});

test('the landing cites only guaranteed claims and points to the extending guide', () => {
  const text = landing();
  const claims = new Map(parseClaims(read('docs/CLAIMS.yaml')).map((c) => [c.id, c]));
  const cited = [...text.matchAll(/\(claims? ([^)]*)\)/g)]
    .flatMap(([, list]) => [...list.matchAll(/`([a-z0-9-]+)`/g)].map(([, id]) => id));
  assert.ok(cited.length >= 8, `claims cited: ${cited}`);
  for (const id of cited) {
    assert.equal(claims.get(id)?.status, 'guaranteed', `${id} is a guaranteed claim`);
  }
  assert.ok(text.includes('](docs/EXTENDING.md)'), 'the landing links docs/EXTENDING.md');
  assert.ok(cited.includes('extending-guide-checked'));
  assert.ok(cited.includes('readme-landing-links-route'));
});

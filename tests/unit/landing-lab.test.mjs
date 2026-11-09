// The generated landing at /oscilla/lab/ (plan P014, owner decision Q107; claim lab-landing).
// scripts/landing.mjs builds it from the facts of the checkout (scripts/facts.mjs); the Pages
// workflow publishes it beside the app and scripts/verify-deploy.mjs proves the live copy equals
// a regeneration. Here:
//   - two generations are byte-identical (verify-deploy relies on it);
//   - the page is Czech (lang="cs") and loads nothing from another origin: every src/href of a
//     script, link, img, iframe, source, video, audio, embed or object is relative or data:, and
//     every absolute <a> link goes to the repository on GitHub or to the Pages site;
//   - every workspace of the registry has a card linking ../#m=<id>;
//   - no <iframe> exists in the HTML: the frame is created only on a press;
//   - every chart of CHARTS exists with <title> and <desc>, inlined in the page byte for byte;
//   - a registry id without Czech copy fails the generator (a fake workspace, a fake engine);
//   - checkLabFile of verify-deploy names a file that differs from its regeneration;
//   - expectedLab regenerates a commit behind HEAD from that commit's own tree (a fixture repo
//     whose two commits carry different generators), and a commit without the generator
//     deployed no landing (null), so the release task's closing check works after main moves.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARTS, collectFacts } from '../../scripts/facts.mjs';
import { generateLanding } from '../../scripts/landing.mjs';
import { CSP } from '../../scripts/landing/page.mjs';
import { checkLabFile, expectedLab } from '../../scripts/verify-deploy.mjs';
import { WORKSPACE_REGISTRY } from '../../src/js/ui/shell.js';
import { ENGINE_MODULES } from '../../src/js/synth/panels/engines.js';

const FACTS = await collectFacts({ git: true });
const FILES = await generateLanding({ facts: FACTS });
const HTML = FILES.get('index.html').toString('utf8');
const MARKUP = HTML.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>');
const clone = (x) => JSON.parse(JSON.stringify(x));
const ALLOWED_LINK = new RegExp('^https://(github\\.com/korczis/oscilla(/|$)'
  + '|korczis\\.github\\.io/oscilla/)');

test('two generations from the same checkout are byte-identical', async () => {
  const again = await generateLanding();
  assert.deepEqual([...again.keys()], [...FILES.keys()]);
  for (const [name, body] of FILES) assert.ok(again.get(name).equals(body), name);
  assert.ok(FILES.has('index.html'));
  assert.ok([...FILES.keys()].some((k) => k.startsWith('shots/') && k.endsWith('.png')));
});

test('the page is Czech and loads nothing from another origin', () => {
  assert.match(HTML, /<html lang="cs"/);
  assert.ok(HTML.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`));
  assert.match(CSP, /default-src 'none'/);
  const LOAD = new RegExp('<(script|link|img|iframe|source|video|audio|embed|object)\\b'
    + '[^>]*?\\s(?:src|href|data|srcset)="([^"]*)"', 'gi');
  const loads = [...MARKUP.matchAll(LOAD)];
  assert.ok(loads.length > 5, 'the page has images and an icon');
  for (const [, tag, url] of loads) {
    assert.ok(!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url) || url.startsWith('data:'),
      `<${tag}> loads ${url}`);
  }
  for (const [, url] of MARKUP.matchAll(/<a\b[^>]*?\shref="([^"]*)"/gi)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) assert.match(url, ALLOWED_LINK, url);
  }
  const css = (/<style>([\s\S]*?)<\/style>/.exec(HTML) || [])[1];
  assert.ok(css && css.length > 1000, 'Tailwind is inlined');
  assert.doesNotMatch(css, /@import|url\(\s*["']?(?:https?:)?\/\//i);
});

test('every workspace of the registry has a card linking into the app', () => {
  for (const w of WORKSPACE_REGISTRY) {
    assert.ok(MARKUP.includes(`href="../#m=${w.id}" class=`)
      && MARKUP.includes(`data-workspace="${w.id}"`), `card for ${w.id}`);
  }
  for (const e of ENGINE_MODULES) {
    assert.ok(MARKUP.includes(`href="../#m=synth&amp;yt=engines&amp;ye=${e.id}"`), e.id);
  }
});

test('no iframe exists before a press; the start buttons and the frame host do', () => {
  assert.doesNotMatch(HTML, /<iframe/i);
  assert.match(MARKUP, /data-frame-start="frame-tab-playground"/);
  assert.match(MARKUP, /<div data-frame-host hidden/);
});

test('every chart of CHARTS exists with a title and a description and is inlined', () => {
  assert.ok(CHARTS.length >= 5);
  for (const name of CHARTS) {
    const svg = FILES.get(`charts/${name}.svg`)?.toString('utf8');
    assert.ok(svg, `charts/${name}.svg`);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, new RegExp(`<title id="oscilla-chart-${name}-t">[^<]+</title>`));
    assert.match(svg, new RegExp(`<desc id="oscilla-chart-${name}-d">[^<]+</desc>`));
    assert.ok(HTML.includes(svg.trim()), `${name} inlined byte for byte`);
  }
});

test('mutation: a registry id without Czech copy fails the generator', async () => {
  const ws = clone(FACTS);
  ws.workspaces.items.push({ ...ws.workspaces.items[0], id: 'fake-workspace' });
  await assert.rejects(generateLanding({ facts: ws }),
    /no Czech copy for workspace "fake-workspace"/);
  const en = clone(FACTS);
  en.engines.items.push({ id: 'fake-engine', label: 'FAKE' });
  await assert.rejects(generateLanding({ facts: en }), /no Czech copy for engine "fake-engine"/);
});

test('mutation: verify-deploy names a lab file that differs from its regeneration', () => {
  const expected = FILES.get('charts/plan.svg');
  const ok = { name: 'charts/plan.svg', status: 200, contentType: 'image/svg+xml',
    body: expected, expected };
  assert.deepEqual(checkLabFile(ok), []);
  assert.match(checkLabFile({ ...ok, body: Buffer.concat([expected, Buffer.from('x')]) })[0],
    /^lab: charts\/plan\.svg .* differs from its regeneration/);
  assert.match(checkLabFile({ ...ok, status: 404 })[0], /HTTP 404/);
  assert.match(checkLabFile({ ...ok, contentType: 'text/plain' })[0], /content-type/);
});

test('expectedLab regenerates a commit behind HEAD from its own tree, never from HEAD', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-lab-fixture-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  const stub = (tag) => 'export async function generateLanding({ commit }) {\n'
    + `  return new Map([['index.html', Buffer.from('${tag} ' + commit)]]);\n}\n`;
  try {
    git('init', '--quiet');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'user.name', 'fixture');
    writeFileSync(path.join(dir, 'README.md'), 'before the landing\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'before');
    const before = git('rev-parse', 'HEAD');
    mkdirSync(path.join(dir, 'scripts'));
    writeFileSync(path.join(dir, 'scripts', 'landing.mjs'), stub('old'));
    git('add', '-A');
    git('commit', '--quiet', '-m', 'old generator');
    const old = git('rev-parse', 'HEAD');
    writeFileSync(path.join(dir, 'scripts', 'landing.mjs'), stub('new'));
    git('add', '-A');
    git('commit', '--quiet', '-m', 'new generator');
    const head = git('rev-parse', 'HEAD');

    const atHead = await expectedLab({ root: dir, commit: head });
    assert.equal(atHead.get('index.html').toString(), `new ${head}`);
    const behind = await expectedLab({ root: dir, commit: old });
    assert.equal(behind.get('index.html').toString(), `old ${old}`);
    assert.equal(await expectedLab({ root: dir, commit: before }), null);
    assert.equal(git('worktree', 'list').split('\n').length, 1, 'the temporary worktree is removed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
//   - the P015 dashboards: the sections Co přinesla která verze, Roadmapa, Průzkumník tvrzení
//     and Rozhodnutí (ADR) exist with their nav entries; the changelog has a card per release
//     tag, the unreleased changes and the newest CHANGELOG_FULL_RELEASES (8) list their commits
//     and older ones link GitHub's compare view instead (the page stays under its ceiling,
//     1 000 000 characters since P016), each plan-id chip links an issue file that exists and
//     each PR link its number; the claims explorer holds a row for every claim with its
//     status and area and links its source, implementation and test, and its filter controls
//     stay hidden without the script;
//     the roadmap lists every milestone; the ADR table every ADR; the hero counts commits and
//     ADRs;
//   - the P016 trends: the sections Dluh, který jen klesá and Revize a jejich nálezy exist with
//     their nav entries; a card per ratchet baseline the facts find, each linking its file, the
//     test that enforces it (a test that reads that file) and its rule (a file that exists);
//     a review row per record, newest first, each linking its pull request, with every open
//     P0 or P1 named; every chart card names the source of its fact group; a ratchet without
//     Czech copy fails the generator; the absent ledger of a release reads as absent;
//   - expectedLab regenerates a commit behind HEAD from that commit's own tree (a fixture repo
//     whose two commits carry different generators), and a commit without the generator
//     deployed no landing (null), so the release task's closing check works after main moves.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARTS, REPO_ROOT, collectFacts } from '../../scripts/facts.mjs';
import { esc } from '../../scripts/landing/charts.mjs';
import { CHANGELOG_FULL_RELEASES, RATCHET_COPY } from '../../scripts/landing/copy.mjs';
import { generateLanding, ruleFileOf } from '../../scripts/landing.mjs';
import { CHART_GROUP, CSP, LINK_SHA } from '../../scripts/landing/page.mjs';
import { chartTable } from '../../scripts/landing/charts.mjs';
import { readFileSync } from 'node:fs';
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

const section = (id) => {
  const at = MARKUP.indexOf(`<section id="${id}"`);
  assert.ok(at >= 0, `section #${id}`);
  return MARKUP.slice(at, MARKUP.indexOf('</section>', at));
};
const REF = FACTS.git.head.slice(0, LINK_SHA);
const BLOB = new RegExp(`^https://github\\.com/korczis/oscilla/blob/${REF}/(.+)$`);

test('the P015 dashboards exist, each with its nav entry and its source named', () => {
  for (const [id, heading] of [['zmeny', 'Co přinesla která verze'], ['roadmapa', 'Roadmapa'],
    ['tvrzeni', 'Průzkumník tvrzení'], ['adr', 'Rozhodnutí (ADR)']]) {
    assert.ok(section(id).includes(`>${heading}</h2>`), heading);
    assert.match(MARKUP, new RegExp(`<a href="#${id}" class=`), `nav #${id}`);
  }
  assert.ok(section('zmeny').includes(esc(FACTS.releaseChanges.source)), 'changelog source');
  assert.ok(section('tvrzeni').includes(esc(FACTS.claims.areaRule)), 'area rule');
  const top = section('top');
  assert.match(top, /commitů<\/dd>/);
  assert.match(top, /rozhodnutí \(ADR\)<\/dd>/);
});

test('the changelog has a card per release tag, with plan-id chips and PR links that resolve',
  () => {
    const z = section('zmeny');
    const cards = [...z.matchAll(/<details class="lab-rel [^"]*" data-release="([^"]+)"/g)]
      .map((m) => m[1]);
    const tags = FACTS.releaseChanges.items.map((r) => r.tag).reverse();
    assert.ok(tags.length > 10, `release tags: ${tags.length}`);
    assert.deepEqual(cards.filter((c) => c.startsWith('v')), tags, 'newest first, every tag');
    let chips = 0;
    for (const [, url] of z.matchAll(/<a href="([^"]+\/\.ai\/repo\/project\/issues\/[^"]+)"/g)) {
      const rel = BLOB.exec(url)?.[1];
      assert.ok(rel && existsSync(path.join(REPO_ROOT, rel)), `${url} names an existing issue`);
      chips += 1;
    }
    assert.ok(chips > 0, 'plan-id chips exist');
    const prs = FACTS.releaseChanges.items.flatMap((r) => r.prs);
    for (const n of prs.slice(-20)) assert.ok(z.includes(`/pull/${n}">#${n}</a>`), `PR #${n}`);
    // CHANGELOG_FULL_RELEASES: the unreleased changes and the newest releases list each commit
    // once; an older release links its compare view instead and lists none.
    assert.equal(CHANGELOG_FULL_RELEASES, 8);
    const items = FACTS.releaseChanges.items.slice().reverse();
    const full = items.slice(0, CHANGELOG_FULL_RELEASES);
    const commits = full.reduce((n, r) => n + r.commits, 0)
      + (FACTS.releaseChanges.unreleased?.commits ?? 0);
    assert.equal(z.split('/commit/').length - 1, commits, 'every listed commit once');
    assert.ok(z.includes(`u ${CHANGELOG_FULL_RELEASES} nejnovějších vydání`), 'rule stated');
    const card = (tag) => {
      const at = z.indexOf(`data-release="${tag}"`);
      return z.slice(at, z.indexOf('</details>\n', at));
    };
    for (const r of full) assert.doesNotMatch(card(r.tag), /data-commits-elsewhere/, r.tag);
    for (const r of items.slice(CHANGELOG_FULL_RELEASES)) {
      const c = card(r.tag);
      assert.doesNotMatch(c, /\/commit\//, `${r.tag} lists no commit`);
      assert.match(c, /data-commits-elsewhere>Jednotlivé commity: viz <a /, r.tag);
      const link = r.from ? `/compare/${r.from}...${r.tag}"` : `/commits/${r.tag}"`;
      assert.ok(c.includes(link), `${r.tag} links ${link}`);
      for (const id of r.planIds) assert.ok(c.includes(`/issues/${id}.yaml"`), `${r.tag} ${id}`);
      for (const n of r.prs) assert.ok(c.includes(`/pull/${n}"`), `${r.tag} #${n}`);
    }
    // The ceiling, in characters of index.html: 850 000 at P015 (812 145 measured). P016 adds
    // five charts inline with their table views (about 80 kB), the ten ratchet cards (21 kB)
    // and the review table of every record (32 kB), after dropping each chart mark's duplicated
    // data-tip attribute (19 kB): 940 150 characters (946 655 B, 119 963 B gzip, which is what
    // Pages sends) measured on 2026-11-10, so the ceiling is 1 000 000. The cap on the
    // changelog's listed commits stays as P015 set it.
    assert.ok(HTML.length <= 1_000_000,
      `index.html is ${HTML.length} characters (ceiling 1 000 000)`);
  });

test('the claims explorer has a row per claim, linking its source, code and test', () => {
  const t = section('tvrzeni');
  assert.match(t, /<div data-claims-controls hidden /, 'filters hidden until the script runs');
  assert.match(t, /<input type="search" id="claims-q"/);
  for (const c of FACTS.claims.items) {
    const at = t.indexOf(`<tr data-claim="${c.id}" data-status="${c.status}" `
      + `data-area="${c.area}"`);
    assert.ok(at >= 0, `row ${c.id}`);
    const row = t.slice(at, t.indexOf('</tr>', at));
    for (const p of [c.source, c.implementation, c.test].filter((x) => x && x !== '-')) {
      assert.ok(row.includes(`/blob/${REF}/${p}"`), `${c.id} links ${p}`);
    }
  }
  for (const area of Object.keys(FACTS.claims.byArea)) {
    assert.ok(t.includes(`<option value="${area}">`), `area filter ${area}`);
  }
});

test('the roadmap lists every milestone under its intents, and the ADR table every ADR', () => {
  const r = section('roadmapa');
  for (const i of FACTS.roadmap.items) assert.ok(r.includes(`data-intent="${i.id}"`), i.id);
  for (const ms of FACTS.plan.items) {
    assert.ok(r.includes(`/blob/${REF}/.ai/repo/project/milestones/${ms.id}.yaml"`),
      ms.id);
  }
  assert.match(r, /<div data-roadmap-controls hidden /);
  const a = section('adr');
  for (const x of FACTS.adrs.items) {
    assert.ok(a.includes(`/blob/${REF}/${x.path}"`), x.path);
  }
});

test('the P016 sections exist with their nav entries, each naming its source', () => {
  for (const [id, heading] of [['dluh', 'Dluh, který jen klesá'],
    ['revize', 'Revize a jejich nálezy']]) {
    assert.ok(section(id).includes(`>${heading}</h2>`), heading);
    assert.match(MARKUP, new RegExp(`<a href="#${id}" class=`), `nav #${id}`);
  }
  assert.ok(section('dluh').includes(esc(FACTS.ratchets.source)), 'ratchets source');
  assert.ok(section('dluh').includes(esc(FACTS.ratchets.rule)), 'ratchets derivation');
  assert.ok(section('revize').includes(esc(FACTS.reviews.dateSource)), 'review dates source');
  const g = section('grafy');
  assert.match(g, /Nic se neodhaduje, neinterpoluje ani nedopočítává/);
  for (const name of CHARTS) {
    const group = FACTS[CHART_GROUP[name]];
    assert.ok(group?.source, `${name}: fact group ${CHART_GROUP[name]}`);
    const at = g.indexOf(`data-chart="${name}"`);
    const card = g.slice(at, g.indexOf('</figure>', at));
    assert.ok(card.includes(`<p class="lab-src">Zdroj: <code>${esc(group.source)}`), name);
  }
});

test('a card per ratchet baseline, linking its file, its enforcing test and its rule', () => {
  const d = section('dluh');
  const rule = ruleFileOf(REPO_ROOT);
  assert.ok(FACTS.ratchets.items.length >= 8, `ratchets: ${FACTS.ratchets.items.length}`);
  for (const it of FACTS.ratchets.items) {
    const at = d.indexOf(`data-ratchet="${it.file}"`);
    assert.ok(at >= 0, `card ${it.file}`);
    const card = d.slice(at, d.indexOf('</article>', at));
    const c = RATCHET_COPY[it.file];
    assert.ok(card.includes(`>${esc(c.name)}</h3>`), it.file);
    assert.ok(card.includes(`/blob/${REF}/${it.file}"`), `${it.file} links itself`);
    assert.ok(card.includes(`/blob/${REF}/${c.test}"`), `${it.file} links ${c.test}`);
    assert.ok(readFileSync(path.join(REPO_ROOT, c.test), 'utf8')
      .includes(path.basename(it.file)), `${c.test} reads ${it.file}`);
    if (c.rule) {
      const file = rule(c.rule);
      assert.ok(existsSync(path.join(REPO_ROOT, file)), file);
      assert.ok(card.includes(`/blob/${REF}/${file}"`), `${it.file} links ${file}`);
    }
    assert.ok(card.includes(it.rises === 0 ? '>jen klesá</span>' : 'nárůst'), `${it.file} rises`);
  }
  assert.throws(() => rule('project.no-such-rule'), /has no file/);
});

test('the review table has a row per record, newest first, naming every open P0 and P1', () => {
  const r = section('revize');
  const row = new RegExp('<tr><th scope="row"><a href="https://github\\.com/korczis/oscilla/'
    + 'pull/(\\d+)">', 'g');
  const prs = [...r.matchAll(row)].map((m) => Number(m[1]));
  assert.deepEqual(prs, FACTS.reviews.items.map((x) => x.pr).reverse());
  const open = FACTS.reviews.items.reduce((n, x) => n + x.openBySeverity.P0
    + x.openBySeverity.P1, 0);
  const named = [...r.matchAll(/>(\d+) P[01] otevřený</g)].reduce((n, m) => n + Number(m[1]), 0);
  assert.equal(named, open, 'every open P0 and P1 is named in its row');
  assert.ok(r.includes(`>${FACTS.reviews.totals.reviews}</dt>`), 'the record count');
});

test('a release whose tree has no claims ledger reads as absent in the trend, not as zero', () => {
  const facts = clone(FACTS);
  facts.claimsPerRelease.items[0] = { ...facts.claimsPerRelease.items[0], present: false,
    total: null, byStatus: null };
  const t = chartTable('claims-trend', facts);
  assert.equal(t.rows[t.rows.length - 1][t.head.length - 1], 'soubor chybí');
  assert.ok(t.rows[t.rows.length - 1].slice(1, -1).every((c) => c === 'chybí'));
});

test('mutation: a ratchet baseline without Czech copy fails the generator', async () => {
  const f = clone(FACTS);
  f.ratchets.items.push({ ...f.ratchets.items[0], file: 'tests/unit/new-debt-baseline.json' });
  await assert.rejects(generateLanding({ facts: f }),
    /no Czech copy for ratchet "tests\/unit\/new-debt-baseline\.json"/);
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

    // A foreign worktree whose directory is momentarily missing: its record must survive.
    const foreign = path.join(dir, '..', `${path.basename(dir)}-foreign`);
    git('worktree', 'add', '--detach', '--quiet', foreign, before);
    rmSync(foreign, { recursive: true, force: true });
    const records = () => git('worktree', 'list', '--porcelain').split('\n')
      .filter((l) => l.startsWith('worktree ')).length;
    assert.equal(records(), 2);

    const atHead = await expectedLab({ root: dir, commit: head });
    assert.equal(atHead.get('index.html').toString(), `new ${head}`);
    const behind = await expectedLab({ root: dir, commit: old });
    assert.equal(behind.get('index.html').toString(), `old ${old}`);
    assert.equal(await expectedLab({ root: dir, commit: before }), null);
    assert.equal(records(), 2, 'the temporary worktree is removed and the foreign one kept');
    assert.match(git('worktree', 'list', '--porcelain'), /-foreign/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

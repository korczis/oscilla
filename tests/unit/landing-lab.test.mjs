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
//     1 200 000 characters since P017), each plan-id chip links an issue file that exists and
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
//   - the P017 review audit (facts injected, so the repository's own audits do not decide it):
//     with an audit the reviews section shows its header (file, date, base commit, auditors,
//     scope), a row per open P0-P2 finding with its Czech class, the evidence in English, the
//     fixed commit and the plan issue linked, the class filter (hidden without the script) and
//     the P3 block naming the unclassified remainder, and the reviews chart gains the audit
//     panel; with no audit it says "zatím žádný audit", keeps P016's counts and chart;
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
    // changelog's listed commits stays as P015 set it. P017's review audit adds about 50 000
    // characters with the first audit (63 open P0-P2 rows, their evidence 23 000): 992 166
    // characters measured on 2026-11-10 with audit-2026-11-10.yaml in the tree (949 149 B
    // without it), its rows' cells styled once by .lab-au rather than per row. That leaves
    // under 8 000 characters for the next verdicts, releases and audits, so the ceiling is
    // 1 200 000; plan P018 splits the heavy sections (changelog, claims, reviews) into
    // sub-pages instead of raising it again.
    assert.ok(HTML.length <= 1_200_000,
      `index.html is ${HTML.length} characters (ceiling 1 200 000)`);
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

// A review audit injected into the repository's facts: one finding of each class.
function auditFacts() {
  const f = clone(FACTS);
  const issue = '.ai/repo/project/issues/P016.yaml';
  const row = (pr, id, severity, cls, extra) => ({ source: `${pr}.yaml#${id}`, pr, id, severity,
    title: `title ${id}`, class: cls, audit: '.ai/repo/reviews/audit-2026-11-10.yaml',
    auditDate: '2026-11-10', evidence: null, issue: null, issueFile: null, commit: null,
    ...extra });
  f.reviewAudits = {
    source: '.ai/repo/reviews/audit-*.yaml (review-audit/v1) + .ai/repo/reviews/<pr>.yaml',
    rule: 'fixture rule', commitRule: 'fixture commit rule', severities: ['P0', 'P1', 'P2'],
    classes: ['open', 'fixed', 'superseded', 'unaudited'],
    audits: [{ file: '.ai/repo/reviews/audit-2026-11-10.yaml', schema: 'review-audit/v1',
      date: '2026-11-10', base: 'b8bfd3b613b9e4aac63267343c14bd1ee91f2a02', baseKnown: true,
      auditors: ['oscilla-c3', 'rev-seat-2'], scope: 'open findings of severity P0-P2',
      summary: { p0_p2: 4 } }],
    perFinding: [
      row(164, 'R1-P2-4b', 'P2', 'open', { evidence: 'still open <here>', issue: 'P016',
        issueFile: issue }),
      row(303, 'R-1', 'P1', 'fixed', { evidence: '9898b9e2 fix(audio): clamp',
        commit: '9898b9e2ab12cd34ef56ab78cd90ef12ab34cd56' }),
      row(304, 'R-2', 'P2', 'fixed', { evidence: 'fixed in prose' }),
      row(425, 'R1', 'P1', 'superseded', { evidence: '#425 closed unmerged' }),
      row(512, 'R2-511-9', 'P2', 'unaudited', { audit: null, auditDate: null }),
    ],
    unaudited: ['512.yaml#R2-511-9'], orphans: [{ source: '99.yaml#X', pr: 99, id: 'X',
      class: 'fixed', audit: '.ai/repo/reviews/audit-2026-11-10.yaml' }],
    split: { open: 1, fixed: 2, superseded: 1, unaudited: 1, total: 5 },
    bySeverity: {}, p3: { audit: '.ai/repo/reviews/audit-2026-11-10.yaml', total: 435,
      open: 318, byClass: { fixed: 9, superseded: 5, open: 17, unclassified: 287 },
      signals: { named_nowhere: 141 }, sample: 31 },
  };
  return f;
}

const sectionOf = (html, id) => {
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>');
  const at = markup.indexOf(`<section id="${id}"`);
  return markup.slice(at, markup.indexOf('</section>', at));
};

test('the reviews section shows the latest audit and its classes of every open P0-P2', async () => {
  const f = auditFacts();
  const files = await generateLanding({ facts: f });
  const r = sectionOf(files.get('index.html').toString('utf8'), 'revize');
  const audit = r.slice(r.indexOf('data-audit>'));
  assert.ok(audit.length > 0 && r.includes('data-audit>'), 'the audit block');
  assert.ok(audit.includes('>audit-2026-11-10.yaml</a>'), 'the audit file');
  assert.match(audit, /<time datetime="2026-11-10">10\.\s11\.\s2026<\/time>/, 'its date');
  assert.ok(audit.includes('href="https://github.com/korczis/oscilla/commit/'
    + 'b8bfd3b613b9e4aac63267343c14bd1ee91f2a02"'), 'its base links the commit');
  assert.ok(audit.includes('<code class="text-xs">oscilla-c3</code>, '
    + '<code class="text-xs">rev-seat-2</code>'), 'its auditors');
  assert.ok(audit.includes('<dd lang="en" class="font-medium text-gray-900 dark:text-white">'
    + 'open findings of severity P0-P2</dd>'), 'its scope');
  const rows = [...audit.matchAll(/<tr data-class="([a-z]+)">([\s\S]*?)<\/tr>/g)];
  assert.deepEqual(rows.map((m) => m[1]),
    ['open', 'fixed', 'fixed', 'superseded', 'unaudited']);
  const [open, fixed, prose, superseded, unaudited] = rows.map((m) => m[2]);
  for (const [cells, pr, label] of [[open, 164, 'Stále otevřené'], [fixed, 303, 'Opraveno'],
    [superseded, 425, 'Nahrazeno'], [unaudited, 512, 'Neauditováno']]) {
    assert.ok(cells.includes(`<a href="https://github.com/korczis/oscilla/pull/${pr}">#${pr}</a>`),
      `${pr} links its pull request`);
    assert.ok(cells.includes(`>${label}</span>`), `${pr}: ${label}`);
  }
  assert.ok(open.includes('<td lang="en">still open &lt;here&gt;</td>'), 'evidence as written');
  assert.match(open, new RegExp(`<a href="https://github\\.com/korczis/oscilla/blob/${REF}/`
    + '\\.ai/repo/project/issues/P016\\.yaml">P016</a>'), 'an open finding links its issue');
  assert.ok(fixed.includes('<a href="https://github.com/korczis/oscilla/commit/9898b9e2ab12">'
    + '9898b9e</a>'), 'a fixed finding links its commit');
  assert.ok(prose.includes('důkaz neuvádí commit z main'), 'a fixed finding without one says so');
  assert.ok(audit.includes('commit: <code>fixture commit rule</code>'), 'the commit rule');
  assert.ok(unaudited.includes('Žádný audit tento nález nejmenuje. Ve verdiktu: '
    + '<span lang="en">title R2-511-9</span>'), 'an unaudited finding shows its verdict title');
  assert.match(audit, /<div data-audit-controls hidden class="lab-filter/);
  for (const [v, label, n] of [['', 'Vše', 5], ['open', 'Stále otevřené', 1],
    ['fixed', 'Opraveno', 2], ['superseded', 'Nahrazeno', 1], ['unaudited', 'Neauditováno', 1]]) {
    assert.ok(audit.includes(`data-audit-filter="${v}" aria-pressed="${v === ''}">${label} `
      + `<span>${n}</span></button>`), `chip ${label}`);
  }
  assert.match(audit, /neklasifikováno 287<\/strong>/, 'the P3 remainder is named');
  assert.ok(audit.includes('<code class="text-xs">99.yaml#X</code>'), 'the orphan is named');
  assert.match(audit, /Záznamy revizí jsou historické: stav nálezu v nich zůstává/);
  assert.ok(r.includes(`>${f.reviews.totals.reviews}</dt>`), 'P016\'s counts stay');
  const svg = files.get('charts/reviews.svg').toString('utf8');
  assert.match(svg, /Otevřené P0–P2 podle auditu z 10\.\s11\.\s2026/);
  assert.match(svg, /Stále otevřené 1<\/text>/);
  assert.match(svg, /Opraveno 2<\/text>/);
  assert.ok(files.get('index.html').length <= 1_200_000, 'inside the page ceiling');
});

test('with no audit the section says so and keeps P016\'s counts and chart', async () => {
  const f = auditFacts();
  f.reviewAudits = { ...f.reviewAudits, audits: [], p3: null, orphans: [] };
  const files = await generateLanding({ facts: f });
  const r = sectionOf(files.get('index.html').toString('utf8'), 'revize');
  assert.match(r, /data-audit-none>/);
  assert.match(r, /zatím žádný audit/);
  assert.doesNotMatch(r, /data-audit>|<tr data-class=/);
  assert.ok(r.includes(`>${f.reviews.totals.reviews}</dt>`), 'the record count');
  const svg = files.get('charts/reviews.svg').toString('utf8');
  assert.doesNotMatch(svg, /podle auditu/);
  const p016 = clone(FACTS);
  delete p016.reviewAudits;
  const { renderCharts } = await import('../../scripts/landing/charts.mjs');
  assert.equal(svg, renderCharts(p016).reviews, 'the chart is P016\'s, byte for byte');
});

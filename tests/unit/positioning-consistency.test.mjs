// The one positioning sentence stands in every long self-description OSCILLA has, and the
// product name stands in every title surface (intent product-direction, criterion
// positioning-consistent; claim positioning-sentence-consistent). The sentence has two
// renderings, one source each in scripts/social-assets.mjs: Q002's English (DESCRIPTION_EN) on
// the developer surfaces (README's opening line, package.json's description) and Q113's Czech
// (DESCRIPTION) on the app's own surfaces (the meta, og and twitter descriptions, the About
// lede; Q104: the app's visible text is Czech).
//
// A self-description is checked for containment, not equality: surfaces differ in length, so
// each carries the sentence verbatim and stays within DESCRIPTION_MAX characters, the part of a
// description link previews and search results show. A title surface carries the name within
// TITLE_MAX characters. Every surface the discovery below finds is either checked or exempt
// with its reason, so a new self-description cannot appear unnoticed.
//
// The shell markup is read from src/index.html (and src/partials, should it exist) until E005's
// shared reader of the assembled shell lands; the generated Open Graph and Twitter tags are
// read from the dist head, which is what Pages serves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { shellMarkup } from './fixtures/shell-markup.mjs';
import * as social from '../../scripts/social-assets.mjs';

export const SENTENCE = 'Vědecky poctivá akustická laboratoř v prohlížeči bez instalace: '
  + 'generujte, měřte a opakujte zvukové experimenty a zjistěte, nakolik lze kterému výsledku '
  + 'věřit.';
export const SENTENCE_EN = 'A zero-install, scientifically honest acoustic laboratory in your '
  + 'browser: generate, measure and reproduce sound experiments, and know how far each result '
  + 'can be trusted.';
export const NAME = 'OSCILLA · Interactive Sound & Frequency Lab';
export const DESCRIPTION_MAX = 200;
export const TITLE_MAX = 70;

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

/** Visible text: comments and tags dropped, entities decoded, whitespace collapsed. */
export function text(markup) {
  return markup
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every self-description and title surface of one piece of markup, keyed `<origin> <what>`:
 * the <title>, each <meta> whose name or property ends in `description` or `title`, the About
 * lede, and each aria-label that names OSCILLA as a lab or laboratory.
 */
export function markupSurfaces(origin, markup) {
  const found = [];
  for (const m of markup.matchAll(/<title>([\s\S]*?)<\/title>/g)) {
    found.push({ key: `${origin} <title>`, value: text(m[1]) });
  }
  for (const m of markup.matchAll(/<meta\s+(name|property)="([^"]+)"\s+content="([^"]*)"\s*>/g)) {
    if (/(^|:)(description|title)$/.test(m[2])) {
      found.push({ key: `${origin} meta ${m[2]}`, value: text(m[3]) });
    }
  }
  for (const m of markup.matchAll(/<p\b[^>]*data-osc="about\.lede"[^>]*>([\s\S]*?)<\/p>/g)) {
    found.push({ key: `${origin} About lede`, value: text(m[1]) });
  }
  for (const m of markup.matchAll(/<p\b[^>]*class="osc-about-lede"[^>]*>([\s\S]*?)<\/p>/g)) {
    if (!/data-osc="about\.lede"/.test(m[0]) && !/data-osc="about\.jobs"/.test(m[0])) {
      found.push({ key: `${origin} About lede (unmarked)`, value: text(m[1]) });
    }
  }
  for (const m of markup.matchAll(/aria-label="([^"]*)"/g)) {
    const v = text(m[1]);
    if (/OSCILLA/.test(v) && /\blab(oratory)?\b/i.test(v)) {
      found.push({ key: `${origin} aria-label ${v}`, value: v, kind: 'brand' });
    }
  }
  return found;
}

/** README.md's opening line: the first paragraph after the heading that is not a badge. */
export function readmeOpening(md) {
  const paragraphs = md.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const opening = paragraphs.find((p) => !p.startsWith('#') && !p.startsWith('[!['));
  return (opening || '').replace(/\s+/g, ' ');
}

/** Everything the test can discover in the tree, with its current value where it has one. */
function discover() {
  const shell = shellMarkup();
  const dist = read('dist/index.html');
  const distHead = dist.slice(0, dist.indexOf('</head>'));
  const surfaces = [
    ...markupSurfaces('src', shell),
    ...markupSurfaces('dist', distHead),
    { key: 'README.md opening line', value: readmeOpening(read('README.md')) },
    { key: 'package.json description', value: JSON.parse(read('package.json')).description },
    { key: 'scripts/social-assets.mjs DESCRIPTION', value: social.DESCRIPTION },
    { key: 'scripts/social-assets.mjs DESCRIPTION_EN', value: social.DESCRIPTION_EN },
  ];
  // Files that could carry a self-description: every root Markdown file and every file under
  // site/ (published beside index.html by the Pages workflow).
  const files = [
    ...readdirSync(root).filter((f) => f.endsWith('.md')),
    ...readdirSync(new URL('site/', root)).map((f) => `site/${f}`),
  ];
  for (const f of files) {
    if (!surfaces.some((s) => s.key.startsWith(`${f} `))) surfaces.push({ key: f, value: null });
  }
  return surfaces;
}

// The app's own surfaces carry the Czech sentence; the developer surfaces Q002's English.
const DESCRIPTIONS = [
  'src meta description', 'src meta og:description', 'src meta twitter:description',
  'src About lede',
  'dist meta description', 'dist meta og:description', 'dist meta twitter:description',
  'scripts/social-assets.mjs DESCRIPTION',
];
const DESCRIPTIONS_EN = [
  'README.md opening line', 'package.json description', 'scripts/social-assets.mjs DESCRIPTION_EN',
];
const TITLES = [
  'src <title>', 'src meta og:title', 'src meta twitter:title',
  'dist <title>', 'dist meta og:title', 'dist meta twitter:title',
  `src aria-label ${NAME}`,
];

// Surfaces that are not checked, each with its reason.
export const EXEMPT = {
  'site/og-image.png': 'a screenshot of the running app; it carries no copy of its own',
  'site/apple-touch-icon.png': 'the wave mark as a home-screen icon; it carries no copy',
  'CLAUDE.md': 'an operating contract for workers, not a self-description to users',
  'AGENTS.md': 'an operating contract for workers, not a self-description to users',
  'GEMINI.md': 'an operating contract for workers (generated by majordomus update), not a '
    + 'self-description to users',
  // Not in the tree, so never discovered: the committer sets it with
  // `gh repo edit korczis/oscilla --description` followed by SENTENCE_EN, and P003's evidence
  // records that.
  'GitHub repository description': 'lies outside the tree; set by gh repo edit, recorded as '
    + 'evidence on P003',
};

/** Every failure of `surfaces` against the sentence, the name and the limits. */
export function failures(surfaces, {
  sentence = SENTENCE, sentenceEn = SENTENCE_EN, name = NAME, descriptions = DESCRIPTIONS,
  descriptionsEn = DESCRIPTIONS_EN, titles = TITLES, exempt = EXEMPT,
} = {}) {
  const out = [];
  const byKey = new Map(surfaces.map((s) => [s.key, s]));
  for (const [label, x] of [['the sentence', sentence], ['the English sentence', sentenceEn]]) {
    if (x.length > DESCRIPTION_MAX) {
      out.push(`${label} is ${x.length} characters, over ${DESCRIPTION_MAX}`);
    }
  }
  if (name.length > TITLE_MAX) out.push(`the name is ${name.length} characters, over ${TITLE_MAX}`);
  for (const [keys, want, label] of [[descriptions, sentence, 'the sentence'],
    [descriptionsEn, sentenceEn, 'the English sentence']]) {
    for (const key of keys) {
      const s = byKey.get(key);
      if (!s) { out.push(`${key}: not found`); continue; }
      if (typeof s.value !== 'string' || !s.value.includes(want)) {
        out.push(`${key}: does not contain ${label} (${JSON.stringify(s.value)})`);
      } else if (s.value.length > DESCRIPTION_MAX) {
        out.push(`${key}: ${s.value.length} characters, over ${DESCRIPTION_MAX}`);
      }
    }
  }
  for (const key of titles) {
    const s = byKey.get(key);
    if (!s) { out.push(`${key}: not found`); continue; }
    if (typeof s.value !== 'string' || !s.value.includes(name)) {
      out.push(`${key}: does not carry the name (${JSON.stringify(s.value)})`);
    } else if (s.value.length > TITLE_MAX) {
      out.push(`${key}: ${s.value.length} characters, over ${TITLE_MAX}`);
    }
  }
  for (const s of surfaces) {
    if (!descriptions.includes(s.key) && !descriptionsEn.includes(s.key)
      && !titles.includes(s.key) && !(s.key in exempt)) {
      out.push(`${s.key}: a surface neither checked nor exempt (${JSON.stringify(s.value)})`);
    }
  }
  return out;
}

test('every self-description contains the sentence within 200 characters', () => {
  const surfaces = discover();
  const fails = failures(surfaces);
  assert.deepEqual(fails, [], fails.join('\n'));
});

test('the sentences are the ones Q002 and Q113 recorded and each fits a description', () => {
  const q002 = read('.ai/repo/project/issues/Q002.yaml');
  assert.ok(q002.includes(SENTENCE_EN), 'SENTENCE_EN differs from the decision recorded on Q002');
  const q113 = read('.ai/repo/project/issues/Q113.yaml');
  assert.ok(q113.includes(SENTENCE), 'SENTENCE differs from the Czech rendering Q113 recorded');
  for (const x of [SENTENCE, SENTENCE_EN]) {
    assert.ok(x.length <= DESCRIPTION_MAX, `${x.length} characters`);
  }
});

test('scripts/social-assets.mjs exports both, and the generated block uses the Czech', () => {
  assert.equal(social.DESCRIPTION, SENTENCE);
  assert.equal(social.DESCRIPTION_EN, SENTENCE_EN);
  assert.ok(social.socialBlock(Buffer.from('x')).includes(
    '<meta property="og:locale" content="cs_CZ">'), 'the og locale is the language it carries');
  const block = social.socialBlock(Buffer.from('x'));
  assert.ok(block.includes(`<meta property="og:description" content="${SENTENCE}">`));
  assert.ok(block.includes(`<meta name="twitter:description" content="${SENTENCE}">`));
});

// The README copy between the sentence and the level-2 heading "## What it does". The heading is
// matched as a whole line: a deeper heading that contains the words ("### What it does today")
// must not end the window before the jobs it introduces.
export function readmeJobsWindow(md) {
  const start = md.indexOf(SENTENCE_EN);
  const heading = md.search(/^## What it does[ \t]*$/m);
  if (start < 0 || heading < 0 || heading < start) return null;
  return md.slice(start + SENTENCE_EN.length, heading);
}

test('README and About follow the sentence with concrete jobs, never "measure a speaker"', () => {
  const md = read('README.md');
  const after = readmeJobsWindow(md);
  assert.ok(after, 'README carries the sentence and, after it, the heading "## What it does"');
  assert.match(after, /speaker, room and microphone chain/);
  assert.match(after, /Studio/);
  const shell = shellMarkup();
  const jobs = shell.match(/<p\b[^>]*data-osc="about\.jobs"[^>]*>([\s\S]*?)<\/p>/);
  assert.ok(jobs, 'the About jobs paragraph follows the lede');
  assert.ok(shell.indexOf('data-osc="about.jobs"') > shell.indexOf('data-osc="about.lede"'));
  assert.match(text(jobs[1]), /speaker, room and microphone chain/);
  for (const copy of [after, text(jobs[1])]) {
    // An observed response is the whole chain's, never the speaker's alone.
    assert.doesNotMatch(copy, /\bmeasur\w* (a|your|the) speaker\b(?!,)/i);
  }
  assert.ok(shell.includes('<p class="osc-about-tagline">See sound. Shape frequency.</p>'));
});

// Mutations: the checker refuses each kind of drift the criterion names.
test('mutation: a change to any one checked surface fails', () => {
  const surfaces = discover();
  for (const key of [...DESCRIPTIONS, ...DESCRIPTIONS_EN, ...TITLES]) {
    const changed = surfaces.map((s) => (s.key === key
      ? { ...s, value: `_${s.value.slice(1)}` } : s));
    assert.notDeepEqual(failures(changed), [], `a changed ${key} passes`);
    const removed = surfaces.filter((s) => s.key !== key);
    assert.notDeepEqual(failures(removed), [], `a missing ${key} passes`);
  }
});

test('mutation: the jobs window reaches past a deeper "What it does" heading', () => {
  const md = `# X\n\n${SENTENCE_EN}\n\n### What it does today\n\n- measure your speaker\n\n## What it does\n\nmore`;
  const window = readmeJobsWindow(md);
  assert.ok(window.includes('measure your speaker'), 'the jobs under a ### heading are inside the window');
  assert.match(window, /\bmeasur\w* (a|your|the) speaker\b(?!,)/i);
  assert.equal(readmeJobsWindow(md.replace('## What it does\n', '## Elsewhere\n')), null);
});

test('mutation: a sentence or a surface over 200 characters fails', () => {
  const surfaces = discover();
  const long = `${SENTENCE} ${'x'.repeat(DESCRIPTION_MAX)}`;
  const padded = surfaces.map((s) => (DESCRIPTIONS.includes(s.key) ? { ...s, value: long } : s));
  assert.ok(failures(padded, { sentence: long }).some((f) => /the sentence is \d+ characters/
    .test(f)));
  const one = surfaces.map((s) => (s.key === 'README.md opening line'
    ? { ...s, value: long } : s));
  assert.ok(failures(one).some((f) => f.startsWith('README.md opening line:')));
});

test('mutation: each language only on its own surfaces (Q113)', () => {
  const surfaces = discover();
  const swap = (key, value) => surfaces.map((s) => (s.key === key ? { ...s, value } : s));
  assert.ok(failures(swap('src About lede', SENTENCE_EN))
    .some((f) => f.startsWith('src About lede: does not contain the sentence')),
  'Q002\'s English on an app surface passes');
  assert.ok(failures(swap('README.md opening line', SENTENCE))
    .some((f) => f.startsWith('README.md opening line: does not contain the English sentence')),
  'the Czech rendering on a developer surface passes');
});

test('mutation: a title surface over 70 characters fails', () => {
  const surfaces = discover();
  const long = `${NAME} ${'x'.repeat(TITLE_MAX)}`;
  const one = surfaces.map((s) => (s.key === 'dist meta og:title' ? { ...s, value: long } : s));
  assert.ok(failures(one).some((f) => f.startsWith('dist meta og:title:')));
});

test('mutation: a surface neither checked nor exempt fails', () => {
  const surfaces = [...discover(), { key: 'src meta og:image:title', value: 'OSCILLA' }];
  assert.ok(failures(surfaces).some((f) => f.includes('neither checked nor exempt')));
  const extra = markupSurfaces('src', '<meta name="description" content="x">'
    + '<span aria-label="OSCILLA laboratory"></span><p class="osc-about-lede">y</p>');
  assert.deepEqual(extra.map((s) => s.key),
    ['src meta description', 'src About lede (unmarked)', 'src aria-label OSCILLA laboratory']);
  const unexempt = { ...EXEMPT };
  delete unexempt['CLAUDE.md'];
  assert.ok(failures(discover(), { exempt: unexempt }).some((f) => f.startsWith('CLAUDE.md:')));
});

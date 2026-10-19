// The origin and the pace the About view tells are the ones Q005 decided against the recorded
// history (intent product-direction, criterion public-story-sourced; claim
// about-origin-sourced; knowledge records oscilla-origin-in-the-transcripts and
// built-in-one-night-is-wall-clock):
//
// - Origin starts from the documented start: an anti-bark ad promising "ultrasound through
//   any phone's speaker" that only dogs hear, the physics point that a phone tone around
//   15-16 kHz is audible and is not ultrasound, the reply "this can be knocked together in
//   one HTML5", and the lab it grew into that night. The browser-laboratory question is only
//   the framing the project grew into, never its start. The company behind the ad is neither
//   named nor characterised, the copy gives no frequency as the vendor's, and it tells no
//   personal motive.
// - "Built in one night." and its 5 h 51 min stay, qualified as wall-clock time with several
//   AI workers in parallel, and About cites no figure the records do not measure.
//
// If the owner overrides Q005, this test follows the owner's decision. The shell markup is read
// from src/index.html (and src/partials, should it exist) until E005's shared reader of the
// assembled shell lands.
//   node --test tests/unit/about-origin.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

/** The shell markup: src/index.html, then any build-time partials (E005), in name order. */
function shellMarkup() {
  const parts = [read('src/index.html')];
  const dir = new URL('src/partials/', root);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.html')).sort()) {
      parts.push(read(`src/partials/${f}`));
    }
  }
  return parts.join('\n');
}

/** Visible text: comments and tags dropped, entities and typographic quotes plain. */
function text(markup) {
  return markup
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&(?:quot|ldquo|rdquo);|[“”]/g, '"')
    .replace(/&(?:#39|apos|lsquo|rsquo);|[‘’]/g, '\'')
    .replace(/&(?:ndash|mdash);|[–—]/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The markup of the element that opens at `open` and closes at the first `close` after it. */
function block(markup, open, close) {
  const at = markup.indexOf(open);
  if (at < 0) return null;
  const end = markup.indexOf(close, at);
  return end < 0 ? null : markup.slice(at, end);
}

export const START = [
  ['the anti-bark ad', /\ban anti-bark ad\b/],
  ['what the ad promised', /"ultrasound through any phone's speaker"/],
  ['that only dogs would hear it', /\bonly dogs\b/],
  ['the reply', /"this can be knocked together in one HTML5"/],
  ['the lab it grew into that night', /\bthat night it grew into a lab\b/],
];
export const PHYSICS = /\b15-16 kHz is audible to many people, and it is not ultrasound\b/;
export const QUESTION =
  /how much of an acoustic laboratory could live entirely inside a web browser\?/;
export const QUALIFIER = /\b5 h 51 min of wall-clock time, with several AI workers in parallel\b/;

/**
 * What the copy must not say anywhere in About: the company or product behind the ad, a
 * characterisation of it, a frequency given as the vendor's, and figures the knowledge
 * records do not measure.
 */
export const UNSOURCED = [
  ['the product behind the ad', /\bbark button\b/i],
  ['a characterisation of the vendor',
    /\b(?:scam|fraud\w*|phishing|subscriptions?|vendor|company|1 ?999|Kč|free today)\b/i],
  ['a frequency as the vendor\'s', /\b15[.,]5 ?kHz\b/i],
  ['the 75 captured prompts', /\b75\b[^.]{0,40}\b(?:prompts?|sessions?|captures?|records?)\b/i],
  ['the 1 358/2 test run', /\b1[ ,.]?358\b/],
  ['a line count', /\b\d[\d ,.]*k?\s*(?:LOC|lines(?: of code)?)\b/i],
  ['an hour count other than the measured interval', /\b(?:six|seven|6|7) hours\b/i],
];

/** The problems of the origin and pace About tells, one string each; [] when it follows Q005. */
export function storyProblems(markup) {
  const view = block(markup, 'id="osc-view-about"', '</main>');
  if (!view) return ['the About view is missing'];
  const origin = block(view, 'aria-labelledby="osc-about-origin"', '</section>');
  const night = block(view, 'aria-labelledby="osc-about-night-title"', '</ol>');
  if (!origin) return ['the Origin block is missing'];
  if (!night) return ['the one-night statement is missing'];
  const problems = [];

  const paras = [...origin.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => text(m[1]));
  const first = paras[0] || '';
  if (!/^OSCILLA began with an anti-bark ad\b/.test(first)) {
    problems.push(`Origin does not open with the documented start: "${first.slice(0, 80)}"`);
  }
  for (const [what, re] of START) {
    if (!re.test(first)) problems.push(`the start does not tell ${what}`);
  }
  if (!PHYSICS.test(first)) {
    problems.push('the start lacks the physics point on the 15-16 kHz tone');
  }
  if (/\bsimple question\b|\bbegan with (?:a|the) question\b/i.test(text(origin))) {
    problems.push('Origin tells the simple question as the start');
  }
  const framing = paras.findIndex((p) => QUESTION.test(p));
  if (framing === 0) problems.push('the browser-laboratory question is in the start');
  else if (framing < 0) problems.push('the browser-laboratory question is not kept as framing');
  else if (!/\bgrew into\b/.test(paras[framing])) {
    problems.push('the browser-laboratory question is not framed as what the project grew into');
  }
  if (/\b(?:I|[Mm]y|[Mm]e|[Mm]ine)\b/.test(text(origin))) {
    problems.push('Origin tells a personal story');
  }

  const pace = text(night);
  if (!/\bBuilt in one night\. Not built as a throwaway\./.test(pace)) {
    problems.push('the one-night statement changed');
  }
  if (!QUALIFIER.test(pace)) {
    problems.push('the pace statement lacks the wall-clock and parallel-workers qualifier');
  }

  const about = text(view);
  for (const [what, re] of UNSOURCED) {
    const m = about.match(re);
    if (m) problems.push(`About cites ${what}: "${m[0]}"`);
  }
  return problems;
}

const shell = shellMarkup();

test('About tells the origin and the pace Q005 decided', () => {
  assert.deepEqual(storyProblems(shell), []);
});

test('mutation: the copy before Q005, or a drift from it, is named', () => {
  const swap = (from, to) => {
    const v = shell.replace(from, to);
    assert.notEqual(v, shell, `${from} is in the shell`);
    return storyProblems(v);
  };
  // The Origin and pace the merge base shipped.
  const opening = new RegExp('(<h3 class="osc-about-h" id="osc-about-origin">[\\s\\S]*?</h3>)'
    + '\\s*<p>[\\s\\S]*?</p>\\s*<p>[\\s\\S]*?</p>');
  const before = swap(opening,
    '$1\n<p>OSCILLA began with a simple question: how much of an acoustic laboratory could live\n'
    + '  entirely inside a web browser?</p>');
  assert.ok(before.includes('Origin tells the simple question as the start'), before.join('; '));
  assert.ok(before.includes('the browser-laboratory question is in the start'), before.join('; '));
  assert.deepEqual(swap(' of wall-clock time, with several AI workers in parallel', ''),
    ['the pace statement lacks the wall-clock and parallel-workers qualifier']);
  assert.deepEqual(swap('with several AI workers', 'with one programmer'),
    ['the pace statement lacks the wall-clock and parallel-workers qualifier']);
  const named = swap('an anti-bark ad promising', 'an anti-bark Bark Button ad promising');
  assert.ok(named.includes('About cites the product behind the ad: "Bark Button"'),
    named.join('; '));
  assert.ok(named.includes('the start does not tell the anti-bark ad'), named.join('; '));
  assert.deepEqual(swap('15–16 kHz is audible', '15.5 kHz is audible'),
    ['the start lacks the physics point on the 15-16 kHz tone',
      'About cites a frequency as the vendor\'s: "15.5 kHz"']);
  assert.deepEqual(swap('Not built as a throwaway.</span>',
    'Not built as a throwaway.</span> 75 AI sessions, 35k lines of code.'),
  ['About cites the 75 captured prompts: "75 AI sessions"',
    'About cites a line count: "35k lines of code"']);
  assert.deepEqual(swap('What it grew into asks', 'It asks'),
    ['the browser-laboratory question is not framed as what the project grew into']);
  assert.deepEqual(swap('Its author\'s reply', 'My reply'), ['Origin tells a personal story']);
});

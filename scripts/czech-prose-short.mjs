#!/usr/bin/env node
// The short English the app still shows (plan U098, rule project.czech-prose, Q104): labels,
// buttons, headings, aria-labels and one- or two-word announcements ('Restore normal',
// 'CABLES', 'Connection cancelled.'), which the sentence measure (scripts/czech-prose.mjs
// isEnglishProse: three or more words, two English function words) cannot see. A second count
// per file, with its own baseline that only falls (tests/unit/czech-prose-short-baseline.json,
// judged by tests/unit/czech-prose-short.test.mjs).
//
// A text is short English when it is not already a sentence the first measure counts, has no
// Czech letter, has the shape of visible text (letters, spaces and sentence punctuation; a lone
// word only Capitalized or IN CAPITALS), is not code-shaped (camelCase, a key name, an event
// name) and holds an English word of the UI vocabulary below that is not one of the technical
// terms the rule lets stand inside Czech text (Studio, MIDI, patch, ...).
//
//   node scripts/czech-prose-short.mjs            the counts per file
//   node scripts/czech-prose-short.mjs --write    rewrite the baseline (only lower it)
//   isShortEnglish(text) -> boolean
//   htmlShort(html) / moduleShort(source) -> [text]
//   shortCounts(root) -> { file: count }

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lexJs } from './ui-catalog/scan.mjs';
import { ROOT, isEnglishProse } from './czech-prose.mjs';

export const SHORT_BASELINE_REL = 'tests/unit/czech-prose-short-baseline.json';
const CZECH = /[áčďéěíňóřšťúůýž]/i;

/** English words of UI text: the verbs of controls and the nouns of what they act on. */
export const ENGLISH = new Set(`
  a about add added all an and apply applied are arm armed attack back be bypass bypassed
  by cable cables cancel cancelled change changed changes choose clear close closed connect
  connected connection copied copy cutoff dark decay delete depth detune disabled disarm
  disarmed done drag edit empty enabled engine engines envelope error export failed file
  filter for frequency from gain help hide import in input inputs insert inserted is it its
  keys keyboard level library light link load loaded loading loop more move name new next
  no none normal not nothing of off on open or output outputs paste patched pause play
  played playing playhead position preset presets previous project projects random rate
  ready record release remove removed reset restore restored save saved search sections
  select selected settings shape show smooth spread start step steps stop stopped sustain
  the this to type undo unsaved value values wave waveform with yes
`.split(/\s+/).filter(Boolean));

/** Terms that stay as they are inside Czech text (rule project.czech-prose): never counted. */
export const TERMS = new Set(`
  studio synth midi patch lfo vco vca eg hpf lpf fm am xy hi-hat mg s&h rta fft wav csv png
  json db hz khz ms dsp oscilla flowbite
`.split(/\s+/).filter(Boolean));

/** Key and event names: code, never shown as a sentence of their own. */
const CODE_WORDS = new Set(['Enter', 'Escape', 'Delete', 'Backspace', 'Tab', 'Home', 'End',
  'Space', 'Shift', 'Control', 'Alt', 'Meta', 'PageUp', 'PageDown', 'ArrowLeft',
  'ArrowRight', 'ArrowUp', 'ArrowDown', 'ContextMenu', 'Insert']);

/** Whether `text` is short English the app shows (see the header). */
/** Class lists and id templates: a utility class (text-gray-900, dark:bg-…) or an id built
 *  around a template (osc-si-${id}-name) is code, never text. */
const CODE_SHAPE = /(?:^|\s)(?:[a-z]+:)+[a-z]|\b(?:osc|text|bg|border|ring|focus|hover|flex|grid|rounded|p[xytrbl]?|m[xytrbl]?|gap|[wh]|min|max|shadow|font|items|justify|leading|tracking|inset|top|left|right|bottom|z|opacity|outline|transition|duration|select|cursor|pointer|overflow|whitespace|truncate|shrink|grow|basis|aria|data)-[a-z0-9[]|-\$\{|\}-/;

export function isShortEnglish(text) {
  if (CODE_SHAPE.test(String(text))) return false;
  const t = String(text).replace(/\$\{[^}]*\}/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (t.length < 2 || CZECH.test(t) || isEnglishProse(t)) return false;
  if (/^[0-9a-f]{16,}$/i.test(t)) return false; // a hex digest
  if (!/^[A-Za-z][A-Za-z0-9 ,.:;!?'’()&/+–-]*$/.test(t)) return false; // the shape of text
  if (CODE_WORDS.has(t) || /[a-z][A-Z]/.test(t)) return false; // a key name, camelCase
  if (!/\s/.test(t) && !/[.!?]$/.test(t) && !/^([A-Z][a-z]+|[A-Z]{2,})$/.test(t)) return false;
  const words = t.toLowerCase().match(/[a-z][a-z'&-]*/g) || [];
  const live = words.filter((w) => !TERMS.has(w));
  return live.length > 0 && live.some((w) => ENGLISH.has(w));
}

/** The short English of an HTML template: text nodes and user-facing attributes. */
export function htmlShort(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  for (const m of body.matchAll(/>([^<>]+)</g)) if (isShortEnglish(m[1])) out.push(m[1].trim());
  for (const m of body.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"]+)"/g)) {
    if (isShortEnglish(m[1])) out.push(m[1]);
  }
  return out;
}

/** The short English among a module's string literals and templates (scan.mjs lexJs). */
export function moduleShort(source) {
  return lexJs(source).strings.map((s) => s.text).filter((t) => isShortEnglish(t));
}

function jsFiles(root, dir) {
  return readdirSync(path.join(root, dir)).flatMap((n) => {
    const rel = path.join(dir, n);
    if (statSync(path.join(root, rel)).isDirectory()) return jsFiles(root, rel);
    return n.endsWith('.js') ? [rel] : [];
  });
}

/** { file: count } of short English the app shows, files with none left out. */
export function shortCounts(root = ROOT) {
  const counts = {};
  const html = htmlShort(readFileSync(path.join(root, 'src/index.html'), 'utf8')).length;
  if (html) counts['src/index.html'] = html;
  for (const f of jsFiles(root, 'src/js').sort()) {
    const n = moduleShort(readFileSync(path.join(root, f), 'utf8')).length;
    if (n) counts[f.split(path.sep).join('/')] = n;
  }
  return counts;
}

export function main(argv = process.argv.slice(2), root = ROOT) {
  const counts = shortCounts(root);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (argv.includes('--write')) {
    writeFileSync(path.join(root, SHORT_BASELINE_REL), `${JSON.stringify({ note: 'Short English '
      + 'the app still shows, per file: labels, buttons, headings and short announcements the '
      + 'sentence measure cannot see (scripts/czech-prose-short.mjs, plan U098, rule '
      + 'project.czech-prose, Q104). A count only falls and a file not listed has none. Lower it '
      + 'in the change that translates; never raise it.', total, counts }, null, 2)}\n`);
  }
  console.log(`czech-prose-short: ${total} short English text(s) in `
    + `${Object.keys(counts).length} file(s)`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main();

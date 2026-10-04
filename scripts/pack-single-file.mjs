// Assemble ONE static HTML file from the source template, compiled CSS, verbatim vendor scripts
// and the app bundle. Pure string work: no timestamps, no paths, no randomness.
//
// Template markers (each exactly once; icons any number of times):
//   <!-- @inline-css -->    -> <style>…</style>
//   <!-- @inline-js -->     -> vendor <script>s in order, the analysis library <script
//                              data-analysis> when given (o.analysis), then the app <script>
//   <!-- @icon:<name> -->   -> inline SVG from lucide-static/icons/<name>.svg
//   <!-- @build-info -->    -> the one metadata region (o.buildInfo, rendered by
//                              release-metadata.mjs renderRegion); required when given
//
// Every script is a CLASSIC script (never type=module) placed where the marker is (end of
// <body>), so it runs synchronously after the DOM it needs, from file:// and from any sub-path.
//
// Before the markers are replaced, the template markup is compacted (compactMarkup): developer
// comments are dropped (KEPT_COMMENTS is the allow-list of the ones that stay) and the leading
// indentation of every markup line is removed. Neither changes what renders; see compactMarkup.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// Text inside <script>/<style> must not end the element early, and "<!--" inside a script can
// switch the HTML tokenizer into the "script data escaped" state.
export function guardRawText(text, tag, label) {
  let out = text;
  if (new RegExp(`</${tag}`, 'i').test(out)) {
    if (tag !== 'script') throw new Error(`${label}: contains </${tag}; refusing to inline`);
    out = out.replace(/<\/script/gi, '<\\/script');
  }
  if (out.includes('<!--')) throw new Error(`${label}: contains "<!--"; refusing to inline`);
  return out;
}

// The root attributes every Lucide icon carries. inlineIcon refuses an icon whose root differs,
// because the inlined copy keeps only class and viewBox and relies on these values:
//   - xmlns: inline SVG in HTML takes its namespace from the parser, the attribute is inert;
//   - width/height: dropped only for an icon nested in a <symbol viewBox="0 0 24 24">, where a
//     nested <svg> without them is 100 % of that 24 x 24 viewBox, i.e. the same 24 x 24;
//   - the paint attributes (LUCIDE_PAINT): restated once as `:where(.lucide) { … }` at the start
//     of the author styles (src/styles/base.css). A zero-specificity rule ahead of every other
//     author rule that paints an SVG has the cascade position of a presentation attribute, so
//     every icon paints as before; tests/unit/pack-single-file.test.mjs pins that rule.
export const LUCIDE_PAINT = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
};
const LUCIDE_ROOT = {
  xmlns: 'http://www.w3.org/2000/svg', width: '24', height: '24', viewBox: '0 0 24 24',
  ...LUCIDE_PAINT,
};

/**
 * A Lucide icon as compact decorative inline SVG.
 * @param {string} name  icon file name in lucide-static/icons
 * @param {{ nested?: boolean }} [o]  nested: the icon sits in a <symbol viewBox="0 0 24 24">
 */
export function inlineIcon(name, { nested = false } = {}) {
  const svg = readFileSync(require.resolve(`lucide-static/icons/${name}.svg`), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+\/>/g, '/>')
    .replace(/>\s+</g, '><')
    .trim();
  const open = /^<svg\b([^>]*)>/.exec(svg);
  if (!open) throw new Error(`lucide icon ${name}: no <svg> root`);
  const attrs = Object.fromEntries([...open[1].matchAll(/([\w:-]+)="([^"]*)"/g)]
    .map((a) => [a[1], a[2]]));
  const expected = { class: `lucide lucide-${name}`, ...LUCIDE_ROOT };
  if (JSON.stringify(Object.keys(attrs).sort()) !== JSON.stringify(Object.keys(expected).sort())
    || Object.keys(expected).some((k) => attrs[k] !== expected[k])) {
    throw new Error(`lucide icon ${name}: unexpected root attributes ${open[1].trim()}`);
  }
  const size = nested ? '' : ' width="24" height="24"';
  return `<svg aria-hidden="true" focusable="false" class="lucide"${size} viewBox="0 0 24 24">`
    + svg.slice(open[0].length);
}

// ------------------------------------------------------------------------------- compaction
// The template's HTML comments that survive compaction. Every other comment in src/index.html is
// a note for developers and is dropped from dist. The banner, the third-party notice and the
// build-metadata region are not template comments: pack() adds them after compaction, so they
// are never candidates for removal.
export const KEPT_COMMENTS = [
  // Packer markers (@inline-css, @inline-js, @build-info, @icon:<name>): pack() replaces them
  // below, so they must still be there when it looks. scripts/visual-compare.mjs and
  // tests/browser/labs.cjs replace @inline-css/@inline-js themselves, but they read
  // src/index.html, never the packed output.
  /^<!-- @(?:inline-css|inline-js|build-info|icon:[a-z0-9-]+) -->$/,
  // Generated-region markers (<!-- name:begin … --> / <!-- name:end -->): `npm run social`
  // (scripts/social-assets.mjs) rewrites the block between social:begin and social:end, and
  // tests/unit/social-meta.test.mjs finds that block, markers included, in the dist <head>.
  // The pattern covers any later region of the same form.
  /^<!-- [a-z][\w-]*:(?:begin|end)\b[^\n]*-->$/,
  // Licence and notice comments: a comment carrying a licence must reach the shipped file.
  /^<!--!|@license|@preserve|SPDX-License-Identifier|\bcopyright\b/i,
];

export const isKeptComment = (comment) => KEPT_COMMENTS.some((re) => re.test(comment));

// Elements whose text is raw (script, style) or preformatted (pre, textarea): copied verbatim.
// No CSS in src/styles gives static markup white-space: pre/pre-wrap/pre-line/break-spaces (the
// one white-space: pre rule, .osc-chip-readout--stack, styles a chip built by JS);
// tests/unit/pack-single-file.test.mjs fails if such a class reaches src/index.html.
const VERBATIM = '<(script|style|textarea|pre)\\b(?:[^>"\']|"[^"]*"|\'[^\']*\')*>'
  + '[\\s\\S]*?</\\1\\s*>';
const MARKUP = new RegExp([
  '<!--[\\s\\S]*?-->', // comment
  VERBATIM,
  '<[a-zA-Z/!](?:[^>"\']|"[^"]*"|\'[^\']*\')*>', // tag (or doctype)
].join('|'), 'gi');

// A line break and the indentation around it. Spaces and tabs only: \s would also eat U+00A0.
const LINE_BREAK = /[ \t]*\n[ \t\n]*/g;

/** A start/end tag with each line break between its attributes reduced to "\n"; quoted
 * attribute values are kept verbatim. */
const compactTag = (tag) => tag.replace(/("[^"]*"|'[^']*')|[ \t]*\n[ \t\n]*/g,
  (m, quoted) => quoted || '\n');

/**
 * Template markup without developer comments and without indentation. Rendering is unchanged:
 *   - a dropped comment renders nothing; the text on both sides of it is joined, as the DOM
 *     shows it anyway;
 *   - in text, a line break with the spaces and tabs around it becomes one "\n". All static
 *     markup collapses whitespace (white-space normal, nowrap or pre-line), which renders that
 *     "\n" exactly like the original run, and a whitespace-only text node stays one;
 *   - inside a tag only the whitespace between attributes changes, never an attribute value;
 *   - <script>, <style>, <textarea> and <pre> are copied verbatim.
 * @param {string} html
 * @returns {string}
 */
export function compactMarkup(html) {
  let out = '';
  let text = '';
  let last = 0;
  const flush = (token) => {
    out += text.replace(LINE_BREAK, '\n') + token;
    text = '';
  };
  MARKUP.lastIndex = 0;
  let m;
  while ((m = MARKUP.exec(html))) {
    text += html.slice(last, m.index);
    last = MARKUP.lastIndex;
    const token = m[0];
    if (token.startsWith('<!--')) {
      if (isKeptComment(token)) flush(token);
      // A dropped comment leaves the text on both sides as one run, compacted as one.
    } else {
      flush(m[1] ? token : compactTag(token));
    }
  }
  text += html.slice(last);
  flush('');
  return out;
}

// An icon marker that is the whole content of a 24 x 24 <symbol> (see inlineIcon `nested`).
const ICON_IN_SYMBOL = new RegExp('(<symbol\\b[^>]*\\bviewBox="0 0 24 24"[^>]*>)'
  + '<!-- @icon:([a-z0-9-]+) -->(?=</symbol>)', 'g');

function replaceOnce(html, marker, replacement) {
  const count = html.split(marker).length - 1;
  if (count !== 1) throw new Error(`template marker ${marker} found ${count} times, expected 1`);
  // Function replacer: a string replacement would expand `$&`, `$'`, `$1`… in minified code.
  return html.replace(marker, () => replacement);
}

/**
 * @param {object} o
 * @param {string} o.template  source HTML containing the markers
 * @param {string} o.css       compiled, minified CSS
 * @param {string} o.js        app bundle (IIFE)
 * @param {string} [o.analysis]  the analysis library (scripts/build-analysis-worker.mjs), placed
 *   before the app, whose bundle imports it through its global; its element text is also the
 *   analysis Worker's script (analysis-runner.js), so it is first-party code and inlined once
 * @param {{id: string, code: string}[]} [o.vendors]  verbatim vendor scripts, in load order
 * @param {string} [o.notice]  third-party notice, emitted as an HTML comment after the doctype
 * @param {string} [o.banner]  one-line HTML comment emitted first after the doctype
 * @param {string} [o.buildInfo]  complete metadata <script type="application/json"> element
 * @param {(name: string) => string} [o.icon]  icon resolver (injectable for tests)
 * @returns {string} the complete HTML document
 */
export function pack({
  template, css, js, analysis = '', vendors = [], notice = '', banner = '', buildInfo = '',
  icon = inlineIcon,
}) {
  if (!/^<!doctype html>/i.test(template)) throw new Error('template must start with a doctype');
  let html = compactMarkup(template)
    .replace(ICON_IN_SYMBOL, (_, symbol, name) => symbol + icon(name, { nested: true }))
    .replace(/<!-- @icon:([a-z0-9-]+) -->/g, (_, name) => icon(name));
  if (html.includes('<!-- @icon:')) throw new Error('malformed icon marker');

  const style = `<style>${guardRawText(css, 'style', 'css')}</style>`;
  html = replaceOnce(html, '<!-- @inline-css -->', style);

  const scripts = vendors.map(({ id, code }) => (
    `<script data-vendor="${id}" data-sha256="${sha256(code)}">`
    + `${guardRawText(code, 'script', id)}</script>`
  ));
  if (analysis) {
    scripts.push(`<script data-analysis>${guardRawText(analysis, 'script', 'analysis library')}`
      + '</script>');
  }
  scripts.push(`<script data-app>${guardRawText(js, 'script', 'app bundle')}</script>`);
  html = replaceOnce(html, '<!-- @inline-js -->', scripts.join('\n'));

  if (buildInfo) {
    if (!/^<script type="application\/json" id="[\w-]+">[^<]*<\/script>$/.test(buildInfo)) {
      throw new Error('buildInfo must be one inert application/json <script> element');
    }
    html = replaceOnce(html, '<!-- @build-info -->', buildInfo);
  } else if (html.includes('<!-- @build-info -->')) {
    throw new Error('template has a <!-- @build-info --> marker but no buildInfo was given');
  }

  if (notice) {
    // HTML comments may contain "--" but never "-->", "--!>" or "<!--".
    if (/-->|--!>|<!--/.test(notice)) throw new Error('notice text would break the HTML comment');
    html = html.replace(/^<!doctype html>\r?\n?/i, (m) => `${m.trimEnd()}\n<!--\n${notice}\n-->\n`);
  }
  if (banner) {
    const inner = banner.slice(4, -3);
    if (!/^<!-- [^\n]* -->$/.test(banner) || /-->|--!>|<!--/.test(inner)) {
      throw new Error('banner must be a single-line HTML comment');
    }
    html = html.replace(/^<!doctype html>\r?\n?/i, (m) => `${m.trimEnd()}\n${banner}\n`);
  }
  return html.endsWith('\n') ? html : `${html}\n`;
}

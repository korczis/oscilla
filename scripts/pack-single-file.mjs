// Assemble ONE static HTML file from the source template, compiled CSS, verbatim vendor scripts
// and the app bundle. Pure string work: no timestamps, no paths, no randomness.
//
// Template markers (each exactly once; icons any number of times):
//   <!-- @inline-css -->    -> <style>…</style>
//   <!-- @inline-js -->     -> vendor <script>s in order, then the app <script>
//   <!-- @icon:<name> -->   -> inline SVG from lucide-static/icons/<name>.svg
//
// Every script is a CLASSIC script (never type=module) placed where the marker is (end of
// <body>), so it runs synchronously after the DOM it needs, from file:// and from any sub-path.
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

export function inlineIcon(name) {
  const svg = readFileSync(require.resolve(`lucide-static/icons/${name}.svg`), 'utf8');
  return svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace('<svg ', '<svg aria-hidden="true" focusable="false" ')
    .replace(/\s+\/>/g, '/>')
    .replace(/>\s+</g, '><')
    .trim();
}

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
 * @param {{id: string, code: string}[]} [o.vendors]  verbatim vendor scripts, in load order
 * @param {string} [o.notice]  third-party notice, emitted as an HTML comment after the doctype
 * @param {(name: string) => string} [o.icon]  icon resolver (injectable for tests)
 * @returns {string} the complete HTML document
 */
export function pack({ template, css, js, vendors = [], notice = '', icon = inlineIcon }) {
  if (!/^<!doctype html>/i.test(template)) throw new Error('template must start with a doctype');
  let html = template.replace(/<!-- @icon:([a-z0-9-]+) -->/g, (_, name) => icon(name));
  if (html.includes('<!-- @icon:')) throw new Error('malformed icon marker');

  const style = `<style>${guardRawText(css, 'style', 'css')}</style>`;
  html = replaceOnce(html, '<!-- @inline-css -->', style);

  const scripts = vendors.map(({ id, code }) => (
    `<script data-vendor="${id}" data-sha256="${sha256(code)}">`
    + `${guardRawText(code, 'script', id)}</script>`
  ));
  scripts.push(`<script data-app>${guardRawText(js, 'script', 'app bundle')}</script>`);
  html = replaceOnce(html, '<!-- @inline-js -->', scripts.join('\n'));

  if (notice) {
    // HTML comments may contain "--" but never "-->", "--!>" or "<!--".
    if (/-->|--!>|<!--/.test(notice)) throw new Error('notice text would break the HTML comment');
    html = html.replace(/^<!doctype html>\r?\n?/i, (m) => `${m.trimEnd()}\n<!--\n${notice}\n-->\n`);
  }
  return html.endsWith('\n') ? html : `${html}\n`;
}

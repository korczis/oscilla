// project.visual-identity-lock v4 (Q071, the owner's decision of 2026-11-02: the whole app as a
// restrained old-school modular). Static guards, each a pure function proved by a seeded
// violation below (the "mutation" tests), then run on the tree:
//
//   app-wide, every file under src/:
//     - no product or maker name (BRANDS), no logo but OSCILLA's (osc-logo*);
//     - no image file, no bitmap data: URI but the touch icon of src/index.html, no remote url();
//     - no glassmorphism, no gradient text, no animated gradient;
//     - a glow (a shadow with no offset) only on a data-led element, at most 6 px, never on text;
//     - every data-led / data-needle element names an interpolated data-source and state;
//     - src/styles/base.css keeps the global prefers-reduced-motion guard;
//     - every Tailwind colour key but primary maps to a var(--osc-*) token tokens.css defines;
//     - the hardware vocabulary (wood, brushed, anodis, screw, jack-nut, sheen, cheek, data-led,
//       data-needle, data-hw) appears only in THEME_DIRS, so no surface is skinned outside the
//       judged layer (af's review of 2026-11-02, P2-A); rivets appear nowhere, the layer included;
//     - the palette of tokens.css equals its reviewed snapshot (visual-identity-palette.json);
//     - the hardware intensity keys of tailwind.config.cjs stay within their bounds;
//   the theme layer (THEME_DIRS: src/js/synth/view now; src/js/ui/synth and src/js/ui/cable,
//   the shared synth-theme layer, once they exist):
//     - no colour literal, colour function, named colour, literal paint, arbitrary Tailwind
//       colour or url() but an in-SVG fragment; every --osc-* token it names exists;
//     - animate-* only behind motion-safe:, a script or SVG animation only in a file that checks
//       prefers-reduced-motion; "SPL" only in a file that reads the calibration state;
//     - (layer directories only) no literal opacity, alpha or shadow: the intensity keys are read.
//
// While src/js/ui/synth/ and src/js/ui/cable/ do not exist, their guards pass vacuously and the
// test says so in its output; once one exists it must hold a module and every guard is strict.
//   node --test tests/unit/visual-identity-lock-v4.test.mjs
// After a reviewed palette change: OSC_PALETTE_WRITE=1 node --test <this file> rewrites the
// snapshot; the diff of tests/unit/visual-identity-palette.json is what the reviewer judges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const p = join(dir, f);
  return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
});

const TEXT = /\.(m?js|cjs|html|css|json|svg|md|txt)$/;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|ico|tiff?|heic)$/i;
const SRC_PATHS = walk('src');
const SRC = SRC_PATHS.filter((p) => TEXT.test(p)).map((p) => [p, read(p)]);
const TOKENS_CSS = read('src/styles/tokens.css');

export const THEME_DIRS = ['src/js/synth/view', 'src/js/ui/synth', 'src/js/ui/cable'];
// The shared synth-theme layer's homes (F013); the guards turn strict on each once it exists.
export const LAYER_DIRS = ['src/js/ui/synth', 'src/js/ui/cable'];
const inDirs = (p, dirs) => dirs.some((d) => p === d || p.startsWith(`${d}/`));

/** Removes // line comments and block comments (strings that hold // stay, e.g. a URL). */
export const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
const lineOf = (text, i) => text.slice(0, i).split('\n').length;

// --- app-wide guards ------------------------------------------------------------------------

export const BRANDS = new RegExp('\\b(' + [
  'arturia', 'moog', 'minimoog', 'buchla', 'korg', 'kaoss\\w*', 'roland', 'behringer',
  'elektron', 'oberheim', 'sequential circuits', 'prophet-?\\d+', 'doepfer', 'eurorack',
  'make noise', 'mutable instruments', 'intellijel', 'erica synths', 'tiptop audio', 'befaco',
  'pittsburgh modular', 'serge modular', 'teenage engineering', 'waldorf', 'novation', 'clavia',
  'nord (?:lead|modular|stage)', 'yamaha', 'ableton', 'bitwig', 'native instruments',
  'reaktor', 'max/msp', "cycling ?'?74", 'node-red', 'react ?flow', 'xyflow',
].join('|') + ')\\b', 'i');

/** Product and maker names anywhere in src, comments included. */
export function brandNames(files) {
  const out = [];
  for (const [p, text] of files) {
    const m = BRANDS.exec(text);
    if (m) out.push(`${p}:${lineOf(text, m.index)}: names "${m[0]}"`);
  }
  return out;
}

/** Every identifier that names a logo is OSCILLA's (osc-logo*); the bare word is prose. */
export function foreignLogos(files) {
  const out = [];
  for (const [p, text] of files) {
    for (const m of text.matchAll(/[\w-]*(?:logo|Logo|LOGO)[\w-]*/g)) {
      if (m[0] === 'logo' || m[0] === 'Logo' || m[0].startsWith('osc-logo')) continue;
      out.push(`${p}:${lineOf(text, m.index)}: logo "${m[0]}"`);
    }
  }
  return out;
}

/** No image file, no bitmap data: URI but the touch icon, no remote url(). */
export function bitmaps(paths, files) {
  const out = paths.filter((p) => IMAGE.test(p)).map((p) => `${p}: an image file`);
  for (const [p, text] of files) {
    for (const m of text.matchAll(/data:image\/(?!svg\+xml)[\w.+-]+/g)) {
      const line = text.split('\n')[lineOf(text, m.index) - 1];
      if (p === 'src/index.html' && /<link rel="apple-touch-icon"/.test(line)) continue;
      out.push(`${p}:${lineOf(text, m.index)}: a bitmap data URI`);
    }
    const remote = /url\(\s*['"]?(?:https?:)?\/\//i.exec(text);
    if (remote) out.push(`${p}:${lineOf(text, remote.index)}: a remote url()`);
  }
  return out;
}

/** Simple CSS rules ({ } without nesting), with @keyframes blocks kept whole. */
function cssBlocks(text) {
  const out = [];
  for (const m of text.matchAll(/@keyframes\s+[\w-]+\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)) {
    out.push({ selector: '@keyframes', body: m[1], index: m.index });
  }
  for (const m of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim(), body: m[2], index: m.index });
  }
  return out;
}

/** Glassmorphism, gradient text, an animated gradient. */
export function frills(files) {
  const out = [];
  for (const [p, raw] of files) {
    const text = stripComments(raw);
    const glass = /\bbackdrop-(?:blur|filter|saturate|brightness|contrast)\b/.exec(text);
    if (glass) out.push(`${p}:${lineOf(text, glass.index)}: glassmorphism (${glass[0]})`);
    const clip = /\bbg-clip-text\b|background-clip\s*:\s*text/.exec(text);
    if (clip) out.push(`${p}:${lineOf(text, clip.index)}: gradient text (${clip[0]})`);
    for (const [i, line] of text.split('\n').entries()) {
      if (/\banimate-[\w-[\]]+/.test(line) && /gradient/.test(line)) {
        out.push(`${p}:${i + 1}: an animated gradient (animate-* beside a gradient)`);
      }
    }
    for (const b of cssBlocks(text)) {
      if (b.selector === '@keyframes' && /\bbackground/.test(b.body)) {
        out.push(`${p}:${lineOf(text, b.index)}: @keyframes moves a background`);
      } else if (/\banimation(?:-name)?\s*:/.test(b.body) && /gradient\(/.test(b.body)) {
        out.push(`${p}:${lineOf(text, b.index)}: an animated gradient`);
      }
    }
  }
  return out;
}

const PX = (v) => {
  const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(v);
  if (!m) return null;
  return Number(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1);
};
/** Splits a shadow list at top-level commas and returns each layer's numbers. */
export function shadowLayers(value) {
  const layers = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { layers.push(cur); cur = ''; } else cur += ch;
  }
  layers.push(cur);
  return layers.map((l) => l.replace(/var\([^)]*\)|\w+\([^)]*\)/g, ' ').trim().split(/\s+/)
    .map(PX).filter((n) => n !== null));
}
/** A layer with no offset and a blur or spread is a glow; returns its reach in px, or 0. */
export function glowReach(value) {
  let reach = 0;
  for (const n of shadowLayers(value)) {
    const [x = 0, y = 0, blur = 0, spread = 0] = n;
    if (x === 0 && y === 0 && blur > 0) reach = Math.max(reach, blur + Math.max(spread, 0));
  }
  return reach;
}
export const GLOW_MAX_PX = 6;
// Recorded before v4, and only shrinks: the legacy status lamp of the shell glows 8 px while
// audio sounds (real state: anySounding). It is kept until the shell's status line is migrated
// to Pro; an entry that no longer matches fails, so it is removed with the rule it names.
export const GLOW_DEBT = new Map([
  ['src/styles/components.css', '.osc-status.is-playing .osc-status-dot'],
]);

/** The markup tag around index i, or its line when i is not inside a tag. */
function around(text, i) {
  const lt = text.lastIndexOf('<', i);
  const gt = text.lastIndexOf('>', i - 1);
  if (lt > gt && i - lt < 600) {
    const end = text.indexOf('>', i);
    return text.slice(lt, end < 0 ? text.length : end + 1);
  }
  const s = text.lastIndexOf('\n', i) + 1;
  const e = text.indexOf('\n', i);
  return text.slice(s, e < 0 ? text.length : e);
}

/** A glow only on a data-led element, at most GLOW_MAX_PX, never on text. */
export function glows(files, debt = null) {
  const out = [];
  const debtSeen = new Set();
  for (const [p, raw] of files) {
    const text = stripComments(raw);
    const found = [];
    for (const b of p.endsWith('.css') ? cssBlocks(text) : []) {
      for (const m of b.body.matchAll(/\b(box-shadow|text-shadow|filter)\s*:\s*([^;]+)/g)) {
        const val = m[1] === 'filter' ? (m[2].match(/drop-shadow\(([^)]*\)?[^)]*)\)/) || [])[1]
          : m[2];
        if (val) found.push({ kind: m[1], val, ctx: b.selector, index: b.index });
      }
    }
    if (!p.endsWith('.css')) {
      const rx = new RegExp(String.raw`\b(text-shadow|box-shadow)\s*:\s*([^;"'${'`'}]+)`
        + String.raw`|drop-shadow\(([^)]*\)?[^)]*)\)`
        + String.raw`|(?:^|[\s"'${'`'}:])(shadow|drop-shadow)-\[([^\]]+)\]`, 'g');
      for (const m of text.matchAll(rx)) {
        const kind = m[1] || (m[3] !== undefined ? 'drop-shadow' : m[4]);
        const val = (m[2] || m[3] || m[5] || '').replace(/_/g, ' ');
        found.push({ kind, val, ctx: around(text, m.index), index: m.index });
      }
      for (const m of text.matchAll(/<feDropShadow\b[^>]*>/g)) {
        const at = (n) => Number((m[0].match(new RegExp(`\\b${n}="([-\\d.]+)"`)) || [])[1] || 0);
        if (at('dx') === 0 && at('dy') === 0 && at('stdDeviation') > 0) {
          found.push({ kind: 'feDropShadow', val: `0 0 ${at('stdDeviation') * 2}px`,
            ctx: around(text, m.index), index: m.index });
        }
      }
    }
    for (const f of found) {
      const reach = glowReach(f.val);
      if (!reach) continue;
      const where = `${p}:${lineOf(text, f.index)}`;
      if (debt && GLOW_DEBT.get(p) === f.ctx) { debtSeen.add(p); continue; }
      if (f.kind === 'text-shadow') out.push(`${where}: glowing text (${f.val.trim()})`);
      else if (!/data-led\b/.test(f.ctx)) out.push(`${where}: a glow off an LED (${f.val.trim()})`);
      else if (reach > GLOW_MAX_PX) {
        out.push(`${where}: an LED glow of ${reach}px > ${GLOW_MAX_PX}px`);
      }
    }
  }
  for (const [p, sel] of debt || []) {
    if (!debtSeen.has(p)) out.push(`${p}: the recorded glow ${sel} is gone (GLOW_DEBT)`);
  }
  return out;
}

const BOUND = (attr) => new RegExp(`(?:^|\\s)(?:${attr}="\\$\\{|:${attr}="|x-bind:${attr}=")`);
/** Every data-led / data-needle element binds data-source and its state, never a literal. */
export function unboundIndicators(files) {
  const out = [];
  for (const [p, raw] of files) {
    if (p.endsWith('.css')) continue;
    const text = stripComments(raw);
    for (const m of text.matchAll(/(?<=\s)data-(led|needle)(?![\w-])/g)) {
      const lt = text.lastIndexOf('<', m.index);
      if (lt < 0 || text.lastIndexOf('>', m.index) > lt) continue;
      const tag = around(text, m.index);
      const state = m[1] === 'led' ? 'data-lit' : 'data-value';
      const where = `${p}:${lineOf(text, m.index)}: data-${m[1]}`;
      if (!BOUND('data-source').test(tag)) out.push(`${where} names no bound data-source`);
      if (!BOUND(state).test(tag)) out.push(`${where} carries no bound ${state}`);
    }
  }
  return out;
}

/** base.css keeps the global guard that stills every transition and animation. */
export function reducedMotionGuard(baseCss) {
  const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(baseCss);
  if (!m) return ['src/styles/base.css: no @media (prefers-reduced-motion: reduce) block'];
  const out = [];
  if (!/animation-duration\s*:/.test(m[1])) out.push('base.css: the guard leaves animations');
  if (!/transition-duration\s*:/.test(m[1])) out.push('base.css: the guard leaves transitions');
  if (!/\*\s*,|^\s*\*/m.test(m[1])) out.push('base.css: the guard is not global (*)');
  return out;
}

/** The text of the `colors: { ... }` blocks of a Tailwind configuration. */
function colourBlocks(configText) {
  const out = [];
  for (const m of configText.matchAll(/\bcolors\s*:\s*\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < configText.length && depth; i += 1) {
      if (configText[i] === '{') depth += 1;
      if (configText[i] === '}') depth -= 1;
    }
    out.push(configText.slice(m.index + m[0].length, i - 1));
  }
  return out;
}
/**
 * Every Tailwind colour key but primary (the Pro accent, `primary: colors.blue`) is a
 * 'var(--osc-*)' token that tokens.css defines, or an object of them. Read as text, so the
 * check needs no installed Tailwind.
 */
export function tailwindColours(configText, tokensCss) {
  const out = [];
  for (const block of colourBlocks(configText.replace(/^\s*\/\/.*$/gm, ''))) {
    for (const m of block.matchAll(/['"]var\((--[\w-]+)\)['"]/g)) {
      if (!m[1].startsWith('--osc-')) out.push(`colors: ${m[1]} is not an OSCILLA token`);
      else if (!tokensCss.includes(`${m[1]}:`)) out.push(`colors: ${m[1]} is not in tokens.css`);
    }
    const rest = block.replace(/\bprimary\s*:\s*colors\.blue\s*,?/, '')
      .replace(/['"]var\(--[\w-]+\)['"]/g, '').replace(/['"]?[\w-]+['"]?\s*:/g, '')
      .replace(/[{},\s]/g, '');
    if (rest) out.push(`colors: a value that is not a var(--osc-*) token: ${rest.slice(0, 80)}`);
  }
  return out;
}

// --- theme-layer guards ---------------------------------------------------------------------

const NAMED = ['aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque',
  'black', 'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue',
  'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan',
  'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki',
  'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon',
  'darkseagreen', 'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise',
  'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick',
  'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod',
  'gray', 'green', 'greenyellow', 'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory',
  'khaki', 'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
  'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink',
  'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey',
  'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon',
  'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen',
  'mediumslateblue', 'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue',
  'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab',
  'orange', 'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise',
  'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple',
  'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown',
  'seagreen', 'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey',
  'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet',
  'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen'];
const PAINT_KEY = '(?:fill|stroke|stop-color|color|background)';
const NAMED_VALUE = new RegExp(`(['"\`]|\\b${PAINT_KEY}[=:]\\s*["']?)(${
  NAMED.join('|')})(['"\`;\\s])`, 'i');

/** No colour but an OSCILLA token in the theme layer; every token named exists. */
export function themeColours(files, tokensCss) {
  const out = [];
  for (const [p, raw] of files) {
    const text = stripComments(raw).replace(/^\s*\*.*$/gm, '');
    const hit = (rx, what) => {
      const m = rx.exec(text);
      if (m) out.push(`${p}:${lineOf(text, m.index)}: ${what} (${m[0].trim()})`);
    };
    hit(/#[0-9a-f]{3,8}\b(?![-\w])/i, 'a hex colour');
    hit(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i, 'a colour function');
    hit(/url\((?!#|\$\{)/i, 'a url() other than a fragment');
    hit(/\b(?:fill|stroke|stop-color|flood-color)="(?!\$\{|none|url\(#|currentColor)/,
      'a literal paint');
    hit(/-\[(?:#|rgb|hsl|oklch|color)/i, 'an arbitrary Tailwind colour');
    hit(/var\(--(?!osc-)[\w-]+\)/, 'a custom property that is not an OSCILLA token');
    const named = NAMED_VALUE.exec(text);
    if (named) out.push(`${p}:${lineOf(text, named.index)}: the named colour ${named[2]}`);
    for (const m of text.matchAll(/--osc-[\w-]+/g)) {
      if (!tokensCss.includes(`${m[0]}:`)) out.push(`${p}: ${m[0]} is not in tokens.css`);
    }
  }
  return out;
}

/** Motion in the theme layer honours prefers-reduced-motion. */
export function themeMotion(files) {
  const out = [];
  for (const [p, raw] of files) {
    const text = stripComments(raw);
    for (const m of text.matchAll(/(\S*?)\banimate-[\w-]+/g)) {
      if (!/motion-safe:$/.test(m[1])) {
        out.push(`${p}:${lineOf(text, m.index)}: ${m[0]} without motion-safe:`);
      }
    }
    const js = /\.animate\(|<animate(?:Transform|Motion)?\b|requestAnimationFrame\(/.exec(text);
    if (js && !/prefers-reduced-motion/.test(text)) {
      out.push(`${p}:${lineOf(text, js.index)}: ${js[0]} in a file that never checks `
        + 'prefers-reduced-motion');
    }
  }
  return out;
}

/** A skin never implies SPL: "SPL" only in a file that reads the calibration state. */
export function themeSpl(files) {
  return files.filter(([, t]) => /\bSPL\b/.test(stripComments(t))
    && !/calibrat/i.test(stripComments(t))).map(([p]) => `${p}: SPL without the calibration`);
}

// --- where the hardware look may be drawn ---------------------------------------------------

export const HW_VOCAB =
  /wood|brushed|anodis|screw|jack-nut|sheen|cheek|data-led|data-needle|data-hw/i;
// path -> the one reason a match outside THEME_DIRS is legitimate. Empty at v4 (nothing in src
// matched on 2026-11-02); an entry only shrinks, and a stale one fails.
export const HW_ALLOW = new Map();
const HW_SCANNED = /\.(m?js|css|html)$/;

/** The hardware vocabulary only under THEME_DIRS (outside comments), so no skin escapes. */
export function hardwareOutsideLayer(files, allow = HW_ALLOW) {
  const out = [];
  const seen = new Set();
  for (const [p, raw] of files) {
    if (!HW_SCANNED.test(p) || inDirs(p, THEME_DIRS)) continue;
    const text = stripComments(raw);
    const m = new RegExp(HW_VOCAB.source, 'gi').exec(text);
    if (!m) continue;
    if (allow.has(p)) { seen.add(p); continue; }
    out.push(`${p}:${lineOf(text, m.index)}: "${m[0]}" outside the synth-theme layer `
      + `(${THEME_DIRS.join(', ')})`);
  }
  for (const p of allow.keys()) if (!seen.has(p)) out.push(`${p}: stale HW_ALLOW entry`);
  return out;
}

/** Rivets are not among Q071's options and v3 banned them: nowhere, the layer included. */
export function rivets(files) {
  const out = [];
  for (const [p, raw] of files) {
    const text = stripComments(raw);
    const m = /rivet/i.exec(text);
    if (m) out.push(`${p}:${lineOf(text, m.index)}: a rivet ("${m[0]}"); rivets stay banned`);
  }
  return out;
}

// --- the palette and the intensity bounds ----------------------------------------------------

export const PALETTE_SNAPSHOT = 'tests/unit/visual-identity-palette.json';
const COLOUR_VALUE = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/i;

/** Every custom property of tokens.css whose value is a colour, per selector. */
export function palette(tokensCss) {
  const out = {};
  for (const b of cssBlocks(tokensCss.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    if (b.selector === '@keyframes') continue;
    for (const m of b.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) {
      const value = m[2].trim().replace(/\s+/g, ' ');
      if (!COLOUR_VALUE.test(value)) continue;
      (out[b.selector] ||= {})[m[1]] = value;
    }
  }
  return out;
}

/** Differences between the reviewed snapshot and the palette now, one string each. */
export function paletteDiff(snapshot, now) {
  const out = [];
  for (const sel of new Set([...Object.keys(snapshot), ...Object.keys(now)])) {
    const a = snapshot[sel] || {};
    const b = now[sel] || {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[k] !== b[k]) out.push(`${sel} ${k}: ${a[k] ?? '(none)'} -> ${b[k] ?? '(none)'}`);
    }
  }
  return out;
}

// The hardware intensity keys of tailwind.config.cjs and their bounds (rule v4, "decent").
// tokens.css cannot gain a declaration (project.ui-uses-flowbite-pro's ratchet), so they are
// Tailwind theme keys the layer reads as classes (opacity-hw-sheen, w-hw-wood, shadow-hw-led).
export const HW_BOUNDS = [
  { scope: 'opacity', key: 'hw-sheen', max: 0.25, unit: '' },
  { scope: 'opacity', key: 'hw-texture', max: 0.08, unit: '' },
  { scope: 'width', key: 'hw-wood', max: 16, unit: 'px' },
  { scope: 'boxShadow', key: 'hw-led', max: GLOW_MAX_PX, unit: 'glow px' },
];

/** Each intensity key exists and stays within its bound. */
export function hwIntensity(configText) {
  const out = [];
  for (const { scope, key, max, unit } of HW_BOUNDS) {
    const block = new RegExp(`\\b${scope}\\s*:\\s*\\{([^}]*)\\}`).exec(configText);
    const m = block && new RegExp(`['"]${key}['"]\\s*:\\s*['"]([^'"]+)['"]`).exec(block[1]);
    if (!m) { out.push(`${scope}.${key}: not declared`); continue; }
    let v;
    if (scope === 'boxShadow') {
      v = glowReach(m[1]);
      if (!/currentColor|var\(--osc-/.test(m[1])) out.push(`${scope}.${key}: colour not a token`);
    } else v = PX(m[1]);
    if (v === null || !(v > 0) || v > max) {
      out.push(`${scope}.${key}: ${m[1]} not in (0, ${max}] ${unit}`);
    }
  }
  return out;
}

/** In the layer's own directories, no literal opacity, alpha or shadow: the keys are read. */
export function layerIntensityLiterals(files) {
  const out = [];
  for (const [p, raw] of files) {
    if (!inDirs(p, LAYER_DIRS)) continue;
    const text = stripComments(raw);
    const m = new RegExp(String.raw`\b(?:bg-|text-|border-)?opacity-\[|\/\[0?\.\d`
      + String.raw`|\b(?:drop-)?shadow-\[|\bopacity\s*:\s*0?\.\d|box-shadow\s*:|\bw-\[`)
      .exec(text);
    if (m) out.push(`${p}:${lineOf(text, m.index)}: a literal intensity (${m[0]}), not a hw-* key`);
  }
  return out;
}

function themeFiles() {
  const present = THEME_DIRS.filter((d) => existsSync(join(ROOT, d)));
  const absent = THEME_DIRS.filter((d) => !present.includes(d));
  const files = present.flatMap(walk).filter((p) => /\.(m?js|css|svg|html)$/.test(p))
    .map((p) => [p, read(p)]);
  return { present, absent, files };
}

// --- the rule -------------------------------------------------------------------------------

test('rule project.visual-identity-lock v4 is in force, v3 is not, and it names this test', () => {
  const dir = '.ai/repo/rules/project';
  assert.ok(existsSync(join(ROOT, dir, 'visual-identity-lock.v4.md')), 'the v4 rule file');
  const v4 = read(`${dir}/visual-identity-lock.v4.md`);
  assert.match(v4, /^version: 4$/m);
  assert.match(v4, /^status: active$/m);
  assert.match(v4, /tests: \[[^\]]*tests\/unit\/visual-identity-lock-v4\.test\.mjs/);
  assert.match(v4, /Celá appka jako synth/);
  assert.match(v4,
    /keep it decent, but\s+real \(no gen z fancy frills\), old school modulars like ""/);
  assert.match(read(`${dir}/visual-identity-lock.v3.md`), /^status: deprecated$/m);
});

// --- the tree -------------------------------------------------------------------------------

test('src names no product or maker, and the only logo is OSCILLA\'s', () => {
  assert.ok(SRC.length > 50, `src read: ${SRC.length} files`);
  assert.deepEqual(brandNames(SRC), []);
  assert.deepEqual(foreignLogos(SRC), []);
});

test('src holds no bitmap but the touch icon, and no remote image', () => {
  assert.deepEqual(bitmaps(SRC_PATHS, SRC), []);
});

test('no glassmorphism, gradient text or animated gradient anywhere in src', () => {
  assert.deepEqual(frills(SRC), []);
});

test('a glow is drawn only on an LED, within 6 px, and text never glows', () => {
  assert.deepEqual(glows(SRC, GLOW_DEBT), []);
});

test('every LED and needle names its state source and binds its state', () => {
  assert.deepEqual(unboundIndicators(SRC), []);
});

test('the global prefers-reduced-motion guard of base.css stands', () => {
  assert.deepEqual(reducedMotionGuard(read('src/styles/base.css')), []);
});

test('every Tailwind colour key but primary maps to an OSCILLA token', () => {
  const config = read('tailwind.config.cjs');
  assert.match(config, /\bprimary\s*:\s*colors\.blue\b/, 'the Pro primary is configured');
  assert.deepEqual(tailwindColours(config, TOKENS_CSS), []);
});

test('the theme layer draws only from tokens, moves only behind reduced motion, implies no SPL',
  (t) => {
    const { present, absent, files } = themeFiles();
    assert.ok(present.includes('src/js/synth/view'), 'the Synth panel view is judged');
    for (const d of LAYER_DIRS.filter((x) => present.includes(x))) {
      assert.ok(files.some(([p]) => p.startsWith(`${d}/`) && p.endsWith('.js')),
        `${d} exists and holds no module`);
    }
    for (const d of absent) {
      const msg = `VACUOUS: ${d}/ does not exist yet; its theme-layer guards pass vacuously and `
        + 'turn strict once it does (project.visual-identity-lock v4).';
      t.diagnostic(msg);
      console.log(`# ${msg}`);
    }
    t.diagnostic(`judged: ${files.map(([p]) => p).join(', ')}`);
    assert.deepEqual(themeColours(files, TOKENS_CSS), []);
    assert.deepEqual(themeMotion(files), []);
    assert.deepEqual(themeSpl(files), []);
    assert.deepEqual(layerIntensityLiterals(files), []);
  });

test('the hardware look is drawn only in the synth-theme layer, and rivets nowhere', () => {
  assert.deepEqual(hardwareOutsideLayer(SRC), []);
  assert.deepEqual(rivets(SRC), []);
});

test('the palette of tokens.css equals its reviewed snapshot', (t) => {
  const now = palette(TOKENS_CSS);
  assert.ok(Object.keys(now[':root'] || {}).length > 20, 'the dark palette is read');
  if (process.env.OSC_PALETTE_WRITE === '1') {
    writeFileSync(join(ROOT, PALETTE_SNAPSHOT), `${JSON.stringify(now, null, 2)}\n`);
    t.diagnostic(`wrote ${PALETTE_SNAPSHOT}`);
  }
  const diff = paletteDiff(JSON.parse(read(PALETTE_SNAPSHOT)), now);
  assert.deepEqual(diff, [], 'the palette changed (a colourway is the owner\'s and the '
    + `reviewer's call): ${diff.join('; ')}. If it is intended, rewrite ${PALETTE_SNAPSHOT} `
    + 'with OSC_PALETTE_WRITE=1 in a commit a reviewer judges.');
});

test('the hardware intensity keys stay within their bounds', (t) => {
  assert.deepEqual(hwIntensity(read('tailwind.config.cjs')), []);
  if (!LAYER_DIRS.some((d) => existsSync(join(ROOT, d)))) {
    const msg = 'VACUOUS: no layer directory yet, so no file reads the hw-* keys; '
      + 'layerIntensityLiterals turns strict with the layer (project.visual-identity-lock v4).';
    t.diagnostic(msg);
    console.log(`# ${msg}`);
  }
});

// --- mutation proofs: every guard catches a seeded violation and passes its clean twin ------

const caught = (fn, bad, good, ...rest) => {
  assert.ok(fn(bad, ...rest).length > 0, `${fn.name} misses ${JSON.stringify(bad).slice(0, 160)}`);
  assert.deepEqual(fn(good, ...rest), [], `${fn.name} flags its clean twin`);
};
const f = (p, text) => [[p, text]];

test('mutation: brand names and foreign logos are caught', () => {
  for (const name of ['Arturia', 'a Moog ladder', 'buchla', 'Make Noise', 'Eurorack',
    'Native Instruments', 'React Flow', 'Prophet-5', 'Doepfer']) {
    caught(brandNames, f('src/js/ui/synth/plate.js', `// after ${name}`),
      f('src/js/ui/synth/plate.js', '// after an old-school modular'));
  }
  caught(foreignLogos, f('src/index.html', '<svg class="vendor-logo"></svg>'),
    f('src/index.html', '<svg class="osc-logo"></svg> the logo goes home; dialogOpen()'));
});

test('mutation: a bitmap, a bitmap data URI and a remote image are caught', () => {
  assert.ok(bitmaps(['src/js/ui/synth/wood.jpg'], []).length > 0);
  caught((files) => bitmaps([], files),
    f('src/js/ui/synth/plate.js', "const wood = 'data:image/jpeg;base64,AAAA';"),
    f('src/js/ui/synth/plate.js', "const grain = 'data:image/svg+xml,<svg/>';"));
  caught((files) => bitmaps([], files),
    f('src/styles/x.css', '.p { background: url(https://example.org/brushed.png); }'),
    f('src/styles/x.css', '.p { background: url(#grain); }'));
  assert.deepEqual(bitmaps([], f('src/index.html',
    '<link rel="apple-touch-icon" sizes="180x180" href="data:image/png;base64,AA">')), []);
  assert.ok(bitmaps([], f('src/index.html', '<img src="data:image/png;base64,AA">')).length > 0);
});

test('mutation: glassmorphism, gradient text and an animated gradient are caught', () => {
  const ok = f('src/js/ui/synth/plate.js', '`<div class="bg-gradient-to-b rounded-lg">`');
  caught(frills, f('src/js/ui/synth/plate.js', '`<div class="backdrop-blur-md">`'), ok);
  caught(frills, f('src/js/ui/synth/label.js', '`<b class="bg-clip-text text-transparent">`'), ok);
  caught(frills, f('src/js/ui/synth/plate.js',
    '`<div class="bg-gradient-to-r animate-pulse">`'), ok);
  caught(frills,
    f('src/styles/x.css', '@keyframes shimmer { from { background-position: 0 0; } '
      + 'to { background-position: 100% 0; } }'),
    f('src/styles/x.css', '@keyframes draw { from { clip-path: inset(0 100% 0 0); } '
      + 'to { clip-path: inset(0); } }'));
  caught(frills,
    f('src/styles/x.css', '.p { background: linear-gradient(var(--osc-a), var(--osc-b)); '
      + 'animation: s 2s infinite; }'),
    f('src/styles/x.css', '.p { background: linear-gradient(var(--osc-a), var(--osc-b)); }'));
});

test('mutation: a glow off an LED, an over-glow and glowing text are caught', () => {
  assert.equal(glowReach('0 0 0 2px var(--osc-focus)'), 0, 'a focus ring is not a glow');
  assert.equal(glowReach('0 2px 4px var(--osc-bg)'), 0, 'a soft drop shadow is not a glow');
  assert.equal(glowReach('0 0 4px var(--osc-green)'), 4);
  const led = '`<span data-led data-source="${src}" data-lit="${on}" '
    + 'class="shadow-[0_0_4px_var(--osc-green)]"></span>`';
  caught(glows, f('src/js/ui/synth/knob.js',
    '`<span class="shadow-[0_0_4px_var(--osc-green)]"></span>`'), f('src/js/ui/synth/led.js', led));
  caught(glows, f('src/js/ui/synth/led.js', led.replace('0_0_4px', '0_0_16px')),
    f('src/js/ui/synth/led.js', led));
  caught(glows, f('src/styles/x.css', '.lbl { text-shadow: 0 0 6px var(--osc-cyan); }'),
    f('src/styles/x.css', '.lbl { text-shadow: 0 1px 0 var(--osc-bg); }'));
  caught(glows, f('src/styles/x.css', '.jack { box-shadow: 0 0 12px var(--osc-cyan); }'),
    f('src/styles/x.css', '[data-led][data-lit="true"] { box-shadow: 0 0 4px var(--osc-green); }'));
  const sel = '.osc-status.is-playing .osc-status-dot';
  const lamp = `${sel} {\n  box-shadow: 0 0 8px var(--osc-green);\n}`;
  assert.deepEqual(glows(f('src/styles/components.css', lamp), GLOW_DEBT), [], 'recorded debt');
  assert.ok(glows(f('src/styles/components.css', lamp.replace('is-playing', 'is-idle')),
    GLOW_DEBT).length >= 2, 'a new glow beside the debt fails, and so does a stale entry');
  caught(glows, f('src/js/ui/cable/cable.js',
    '`<feDropShadow dx="0" dy="0" stdDeviation="3"/>`'),
  f('src/js/ui/cable/cable.js', '`<feDropShadow dx="0" dy="2" stdDeviation="1.5"/>`'));
});

test('mutation: an LED or a needle with a literal or no state source is caught', () => {
  const good = '`<span data-led data-source="${source}" data-lit="${lit}"></span>`';
  caught(unboundIndicators, f('src/js/ui/synth/led.js', '`<span data-led data-lit="true"></span>`'),
    f('src/js/ui/synth/led.js', good));
  caught(unboundIndicators,
    f('src/js/ui/synth/led.js', '`<span data-led data-source="engine" data-lit="${lit}"></span>`'),
    f('src/js/ui/synth/led.js', good));
  caught(unboundIndicators,
    f('src/index.html', '<i data-needle data-source="level" data-value="0.7"></i>'),
    f('src/index.html', '<i data-needle :data-source="meter.source" :data-value="meter.v"></i>'));
  assert.deepEqual(unboundIndicators(f('src/js/ui/synth/led.js',
    "document.querySelectorAll('[data-led]');")), [], 'a selector is not an element');
});

test('mutation: the reduced-motion guard and the Tailwind token map are held', () => {
  const guard = '@media (prefers-reduced-motion: reduce) {\n  *,\n  *::before {\n'
    + '    transition-duration: 0.01ms !important;\n    animation-duration: 0.01ms !important;\n'
    + '  }\n}\n';
  assert.deepEqual(reducedMotionGuard(guard), []);
  assert.ok(reducedMotionGuard('').length > 0);
  assert.ok(reducedMotionGuard(guard.replace(/ *animation-duration.*\n/, '')).length > 0);
  const tokens = '--osc-surface-3: #000;';
  const cfg = (c) => `theme: { extend: {\n colors: {\n primary: colors.blue,\n ${c}\n },\n } }`;
  const good = cfg("plate: 'var(--osc-surface-3)', wood: { DEFAULT: 'var(--osc-surface-3)' },");
  for (const bad of ["plate: '#3a3f4a',", 'plate: colors.amber,',
    "wood: { DEFAULT: 'var(--osc-wood)' },", "plate: 'var(--tw-plate)',",
    "plate: 'rgb(var(--osc-surface-3))',"]) {
    caught((c) => tailwindColours(c, tokens), cfg(bad), good);
  }
});

test('mutation: a colour literal or an unknown token in the theme layer is caught', () => {
  const tokens = '--osc-cyan: x; --osc-surface-1: y;';
  const ok = f('src/js/ui/synth/plate.js',
    '`<rect fill="${t.plate}" class="bg-[var(--osc-surface-1)]"/>` // --osc-cyan');
  for (const bad of ["const c = '#a07040';", 'const c = `rgb(${r},0,0)`;',
    '`<rect fill="saddlebrown"/>`', "const wood = 'sienna';", 'class="bg-[#8b5a2b]"',
    'background: url(wood.svg);', 'fill: var(--wood-tone);', "const t = '--osc-walnut';"]) {
    caught((files) => themeColours(files, tokens), f('src/js/ui/synth/plate.js', bad), ok);
  }
});

test('mutation: motion without a reduced-motion guard is caught', () => {
  caught(themeMotion, f('src/js/ui/synth/led.js', '`<span class="animate-pulse"></span>`'),
    f('src/js/ui/synth/led.js', '`<span class="motion-safe:animate-pulse"></span>`'));
  caught(themeMotion, f('src/js/ui/cable/cable.js', 'el.animate([{ opacity: 0 }], 200);'),
    f('src/js/ui/cable/cable.js', "if (!matchMedia('(prefers-reduced-motion: reduce)').matches) "
      + 'el.animate([{ opacity: 0 }], 200);'));
  caught(themeMotion, f('src/js/ui/synth/meter.js', '`<animateTransform attributeName="x"/>`'),
    f('src/js/ui/synth/meter.js', '`<g transform="rotate(${deg})"/>`'));
});

test('mutation: a needle labelled SPL without the calibration is caught', () => {
  caught(themeSpl, f('src/js/ui/synth/meter.js', '`<text>dB SPL</text>`'),
    f('src/js/ui/synth/meter.js', '`<text>${cal.calibrated ? "dB SPL" : "dB rel"}</text>`'));
});

test('mutation: the hardware look outside the layer, and a rivet anywhere, are caught', () => {
  const ok = f('src/js/ui/synth/plate.js', '`<div class="w-hw-wood" data-hw="cheek"></div>`');
  assert.deepEqual(hardwareOutsideLayer(ok), [], 'inside the layer');
  for (const [p, bad] of [
    ['src/js/ui/studio/graph-view.js', '`<div class="bg-wood-grain"></div>`'],
    ['src/styles/measure.css', '.knob { --plate-sheen: 0.2; }'],
    ['src/index.html', '<span class="screw-head"></span>'],
    ['src/js/ui/measure.js', '`<i data-led data-source="${s}" data-lit="${on}"></i>`'],
    ['src/js/ui/app.js', "const finish = 'anodised';"],
    ['src/js/ui/workbench.js', '`<i data-hw="nut"></i>`']]) {
    caught(hardwareOutsideLayer, f(p, bad), f(p, '`<div class="rounded-lg"></div>`'));
  }
  assert.deepEqual(hardwareOutsideLayer(f('src/js/ui/app.js', '// a wood note')), [],
    'a comment is not a skin');
  assert.ok(hardwareOutsideLayer([], new Map([['src/x.js', 'why']])).length > 0, 'stale allow');
  caught(rivets, f('src/js/ui/synth/plate.js', '`<circle class="rivet"/>`'),
    f('src/js/ui/synth/plate.js', '`<circle class="screw"/>`'));
});

test('mutation: a palette change and an intensity beyond its bound are caught', () => {
  const css = ':root {\n  --osc-bg: #0b1220;\n  --osc-touch: 44px;\n}\n'
    + '[data-theme="light"] {\n  --osc-bg: #e9eef4;\n}\n';
  const snap = palette(css);
  assert.deepEqual(snap, { ':root': { '--osc-bg': '#0b1220' },
    '[data-theme="light"]': { '--osc-bg': '#e9eef4' } });
  assert.deepEqual(paletteDiff(snap, palette(css)), []);
  assert.equal(paletteDiff(snap, palette(css.replace('#0b1220', '#8b5a2b'))).length, 1);
  assert.equal(paletteDiff(snap, palette(`${css}:root { --osc-wood: #8b5a2b; }`)).length, 1);
  const cfg = (o) => `opacity: { 'hw-sheen': '${o.sheen ?? '0.12'}', 'hw-texture': '0.04' },\n`
    + `width: { 'hw-wood': '0.75rem' },\n`
    + `boxShadow: { 'hw-led': '${o.led ?? '0 0 4px currentColor'}' },`;
  assert.deepEqual(hwIntensity(cfg({})), []);
  assert.ok(hwIntensity(cfg({ sheen: '0.6' })).length > 0, 'sheen 0.6');
  assert.ok(hwIntensity(cfg({ led: '0 0 14px currentColor' })).length > 0, 'glow 14 px');
  assert.ok(hwIntensity(cfg({ led: '0 0 4px #39ff14' })).length > 0, 'a neon literal');
  assert.ok(hwIntensity("opacity: { 'hw-sheen': '0.1' }").length > 0, 'a missing key');
  caught(layerIntensityLiterals, f('src/js/ui/synth/plate.js', '`<i class="opacity-[0.6]"></i>`'),
    f('src/js/ui/synth/plate.js', '`<i class="opacity-hw-sheen"></i>`'));
  caught(layerIntensityLiterals,
    f('src/js/ui/cable/cable.js', '`<i class="shadow-[0_0_20px_var(--osc-cyan)]"></i>`'),
    f('src/js/ui/cable/cable.js', '`<i class="shadow-hw-led text-osc-green"></i>`'));
});

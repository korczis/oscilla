#!/usr/bin/env node
// Static release gate for dist/index.html (the file:// and GitHub Pages artifact).
//
// Fails when the file
//   - is not the only file in dist/ (a .nojekyll marker is tolerated),
//   - references any local or remote resource (src/href/srcset/poster/data/url()/@import,
//     <link href>, <base>, meta refresh) other than data: URLs and #fragments; <a href> may
//     point to absolute http(s)/mailto/tel destinations because following a link loads nothing,
//   - contains a module, importmap or external script (type=module, src=),
//   - in first-party script (each <script> and each inline handler or Alpine directive
//     attribute of any tag, <link>, <script> and <style> included) contains a refused form
//     (FORBIDDEN_JS). Refused: exactly these forms, as written or escaped (read again with
//     \uXXXX, \u{...} and \xXX decoded, decodeJsEscapes, except that an escape decoding to a
//     quote ', " or `, a backslash or a line terminator (\n, \r, U+2028, U+2029) stays as
//     written).
//     Here `_` is optional whitespace, a space is one or more whitespace characters, a word is
//     bounded as \b bounds it, a quote is ', " or `, and a URL literal is a quote, `_`, then
//     //, http:// or https:// (any case); each form is pinned as failing by the "refused" test
//     of tests/unit/verify-dist.test.mjs:
//       fetch_( not after `.`, a word character or $, and window.fetch, self.fetch and
//         globalThis.fetch (as words); import_( not after `.`, a word character or $; the words
//         import.meta, XMLHttpRequest, serviceWorker, sendBeacon, localhost and 127.0.0.1; the
//         word importScripts then _(; the words new Worker_(, new SharedWorker_( and
//         addModule_( then `_` and a quote not followed by data: or blob:; the words
//         new WebSocket_( and new EventSource_(;
//       eval not next to a word character or $, and the string literal 'eval' (any quote);
//       Function_( not after a word character or $ (Function(...), new Function(...)), the
//         string literal 'Function' (any quote; self['Function']), and .constructor_(_ then a
//         quote;
//       the word setTimeout or setInterval (so also window.setTimeout) then _(_ and a quote;
//       .src, .href, .srcset or .poster (any case; not after the word location, a navigation)
//         then _=_ and a URL literal;
//       the word setAttribute_(, the word setAttributeNS_( then text with no comma or
//         parenthesis and a comma, or the word attribute_(; then `_`, a quoted src, href,
//         srcset, poster, data or xlink:href (any case), _,_ and a URL literal;
//       the word url( (any case) then `_`, an optional backslash, an optional quote, `_` and
//         //, http:// or https://;
//       the words new Image_( then text with no parenthesis, )_.src_=_ and anything but a quote
//         followed by data: or blob:; the words new Audio_( or new Video_( then `_` and
//         anything but ) or a quote followed by data: or blob:;
//       < then a tag name (a letter first; any case; not a or area) and a whitespace character,
//         then within the tag (no < or >) a resource attribute (src, srcset, href, poster, data,
//         action, formaction, background, xlink:href, imagesrcset, lowsrc, longdesc, ping,
//         manifest, codebase, archive; on a and area only ping) not after a word character,
//         : or -, then _=_, an optional backslash, an optional quote, `_` and //, http:// or
//         https:// (any case);
//       [_ a quoted fetch _] on anything; and the word window, self, globalThis, top, parent or
//         frames then _[_ and either a string literal with no quote or ] in it followed by _+,
//         or a backtick then ${ with no backtick or ] between (window["fe"+"tch"], whatever
//         name the key builds).
//     Everything else is not held by this scan. Examples (not exhaustive; each is pinned as
//     passing in the "documented limits: examples of forms this scan does not refuse" test): a
//     URL held in or loaded through a variable, or assembled at run time; an API name (fetch,
//     eval, a p5 API) assembled at run time (const k='fe'+'tch'; window[k]); the Function
//     constructor as Function.call/apply/bind, Reflect.construct(Function, ...),
//     new (Function)(...), const F=Function, Function`...`, Function/**/(...),
//     Function?.(...), a computed ['constructor'] key, .constructor( given a variable, an
//     AsyncFunction taken from a prototype; a timer as setTimeout/setInterval.call/apply,
//     window['setTimeout'], setTimeout(('f()')), setTimeout(/**/'f()'), setTimeout?.('f()'),
//     const t=setTimeout; t('f()'), a timer given a variable string; fetch as top.fetch(...),
//     fetch?.(...), fetch/**/(...), const w=window; w['fe'+'tch'](...); a quote spelt as an
//     escape where a refused form needs one (x="url(\x27//t.example/p.png\x27)",
//     x="<img src=\x22//t.example/p.gif\x22>", \u0022 likewise); markup with a resource
//     URL built at run time and handed to p5's createDiv/html(); script inside an iframe
//     srcdoc (not a first-party script above). Runtime network loads are held by R041 (the
//     browser request guard, planned on chore/plan-coherence-hardening), not by this scan,
//   - embeds a vendor with a NETWORK_PRIMITIVES occurrence (fetch, XMLHttpRequest, a DOM URL
//     sink, a CSS url(), open()/location, ..., an i18n loadPath) outside its VENDOR_NETWORK
//     sites, or whose inventoried site is reachable: the vendor references its entry more often
//     than the inventory proves, or first-party script uses the vendor API that reaches it.
//     Refused (firstPartyUse): exactly these forms, as written or escaped: the name not next to
//     a word character or $ (for a 'call' entry, then `_`, an optional ?._, and ( or ._call,
//     ._apply or ._bind; for a 'url' entry, then `_`, an optional ?._, (_ and a quote not
//     followed by data: or blob:); the name as a string literal (any quote); a + chain of
//     string literals (any quote) and names, or a template literal with ${, whose literal
//     pieces are all parts of the name, three or more characters in all.
//     Everything else is not held by this scan. Examples (not exhaustive; pinned as passing
//     in the "documented limits" test): p[['load','Image'].join('')], a prefix search of
//     Object.keys, const c=p.cursor;c(x) and p.cursor?.call(p,x) (cursor is a 'call' entry),
//   - carries a source map reference,
//   - embeds a vendor script that is not byte-identical to the pinned package file,
//   - lacks the third-party notice for every vendor and every build-time package
//     (BUILD_TIME_ASSETS: the Lucide icons, and tailwindcss and flowbite, whose compiled CSS is
//     in the <style>, ADR 0061),
//   - exceeds the raw or gzip size budget,
//   - (provenance, verifyProvenance) lacks the top-of-file banner or the ONE metadata region,
//     or the region does not parse, is not a build-time "source" record, or names a version or
//     source digest other than package.json and the recomputed digest of the build inputs.
//
//   node scripts/verify-dist.mjs [--dist path/to/index.html]
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { guardRawText } from './pack-single-file.mjs';
import { BUDGET, BUILD_TIME_ASSETS, DIST_HTML, VENDOR_SCRIPTS } from './build-config.mjs';
import {
  computeSourceDigest, findRegion, readBanner, readVersion, validateRecord,
} from './release-metadata.mjs';

const require = createRequire(import.meta.url);

const URL_ATTRS = new Set([
  'src', 'href', 'srcset', 'poster', 'data', 'action', 'formaction', 'xlink:href', 'background',
  'manifest', 'ping', 'imagesrcset', 'lowsrc', 'longdesc', 'codebase', 'archive',
]);
const NAV_TAGS = new Set(['a', 'area']);
const OK_SCRIPT_TYPES = new Set(['', 'text/javascript', 'application/javascript']);
const DATA_SCRIPT_TYPES = new Set(['application/json', 'application/ld+json', 'text/plain']);

// [pattern, message]. Applied to first-party (non-vendor) executable script text.
//
// Workers and worklets from data: URLs pass, and that is still ONE runtime file: the analysis
// Worker's script is the analysis library (scripts/build-analysis-worker.mjs, gap M10; ADR 0026
// resolution note of 2026-10-04), the first-party inline <script data-analysis> that also runs on
// the page before the app; analysis-runner.js starts the Worker from
// `data:text/javascript;charset=utf-8,<that element's text>` (workerDataUrl), the way the capture
// worklet starts from its embedded text. Nothing is requested from a path or a server, and
// because the Worker's script is a first-party script of the page it is scanned by every
// pattern below like the app script (an importScripts or fetch in the Worker fails here like one
// in the page).
const FORBIDDEN_JS = [
  [/(^|[^.\w$])import\s*\(/, 'dynamic import()'],
  [/\bimport\.meta\b/, 'import.meta (module-only)'],
  [/(^|[^.\w$])fetch\s*\(|\b(window|self|globalThis)\.fetch\b/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bserviceWorker\b/, 'service worker'],
  [/\bimportScripts\s*\(/, 'importScripts()'],
  [/\bnew\s+(?:Shared)?Worker\s*\(\s*(['"`])(?!data:|blob:)/, 'worker loaded from a path'],
  [/\baddModule\s*\(\s*(['"`])(?!data:|blob:)/, 'worklet loaded from a path'],
  [/\bnew\s+(?:WebSocket|EventSource)\s*\(/, 'WebSocket/EventSource'],
  [/\bsendBeacon\b/, 'navigator.sendBeacon'],
  [/\blocalhost\b|\b127\.0\.0\.1\b/, 'localhost reference'],
  // Code made from a string at run time defeats any static scan (R040 review 2). Refused:
  // exactly these forms, as written or escaped (`_` is optional whitespace, a quote ', " or `):
  // eval not next to a word character or $, and the string literal 'eval'; Function_( not
  // after a word character or $ (Function(...), new Function(...)), the string literal
  // 'Function', and .constructor_(_ then a quote; the word setTimeout or setInterval (so also
  // window.setTimeout) then _(_ and a quote.
  // Everything else is not held by this scan. Examples (not exhaustive; pinned as passing in
  // the "documented limits: examples of forms this scan does not refuse" test):
  // Function.call/apply/bind, Reflect.construct(Function, ...), new (Function)(...),
  // const F=Function, Function`...`, Function/**/(...), Function?.(...), a computed
  // ['constructor'] key, .constructor(variable), an AsyncFunction taken from a prototype;
  // setTimeout/setInterval.call/apply, window['setTimeout'], setTimeout(('f()')),
  // setTimeout(/**/'f()'), setTimeout?.('f()'), const t=setTimeout, a timer given a variable
  // string. R041 (the browser request guard) holds the runtime loads such code could make.
  [/(?<![\w$])eval(?![\w$])|(['"`])eval\1/, 'eval'],
  [/(?<![\w$])Function\s*\(|(['"`])Function\1|\.constructor\s*\(\s*['"`]/,
    'the Function constructor'],
  [/\b(?:setTimeout|setInterval)\s*\(\s*['"`]/, 'a timer given a string (setTimeout/setInterval)'],
  // Runtime loads through the DOM (R040): each of these ran with rc=0 before. A static scan sees
  // literals only (read with their escapes decoded, decodeJsEscapes), and refuses exactly the
  // forms the file header lists; everything else is not held (for example a URL held in or
  // loaded through a variable, or assembled at run time), which is why the constructors that
  // load whatever they are given are refused unless the argument is a data:/blob: literal.
  // location.href is a navigation (as an <a href> is a destination), not a resource load.
  [/(?<!\blocation)\.(?:src|href|srcset|poster)\s*=\s*(['"`])\s*(?:https?:)?\/\//i,
    'an absolute URL assigned to .src/.href/.srcset/.poster'],
  // setAttribute, setAttributeNS and p5.Element.attribute(name, value), which calls it.
  [new RegExp('(?:\\bsetAttribute(?:NS\\s*\\([^,()]*,|\\s*\\()|\\battribute\\s*\\()\\s*([\'"`])'
    + '(?:src|href|srcset|poster|data|xlink:href)\\1\\s*,\\s*([\'"`])\\s*(?:https?:)?\\/\\/', 'i'),
  'an absolute URL set by setAttribute/attribute(src/href/srcset/poster/data)'],
  // A CSS url() in a script string (el.style.backgroundImage, p5.Element.style, a <style> text).
  [/\burl\(\s*\\?(['"`]?)\s*(?:https?:)?\/\//i,
    'an absolute URL in a CSS url() of a script string'],
  [/\bnew\s+Image\s*\([^()]*\)\s*\.src\s*=\s*(?!(['"`])(?:data|blob):)/,
    'new Image().src from anything but a data:/blob: literal'],
  [/\bnew\s+(?:Audio|Video)\s*\(\s*(?!\)|(['"`])(?:data|blob):)/,
    'new Audio()/Video() from anything but a data:/blob: literal'],
  // A resource attribute inside an HTML string (innerHTML, insertAdjacentHTML, a template).
  // <a>/<area> href is a destination, not a load, as in markup; their ping is a load.
  [new RegExp('<(?:(?!(?:a|area)[\\s/>])[a-z][\\w:-]*\\s[^<>]*?(?<![\\w:-])(?:src|srcset|href'
    + '|poster|data|action|formaction|background|xlink:href|imagesrcset|lowsrc|longdesc|ping'
    + '|manifest|codebase|archive)|(?:a|area)\\s[^<>]*?(?<![\\w:-])ping)\\s*=\\s*\\\\?["\'`]?'
    + '\\s*(?:https?:)?\\/\\/', 'i'), 'an absolute URL in a resource attribute of an HTML string'],
  // A literal ["fetch"] on anything, or a global's member whose key is built from strings.
  [new RegExp('\\[\\s*([\'"`])fetch\\1\\s*\\]|\\b(?:window|self|globalThis|top|parent|frames)'
    + '\\s*\\[\\s*(?:([\'"`])[^\'"`\\]]*\\2\\s*\\+|`[^`\\]]*\\$\\{)'),
  'computed fetch (window["fe"+"tch"], x["fetch"])'],
];

// The network sites of every pinned vendor (R040). Vendor code is verified by identity, not by
// the FORBIDDEN_JS scan, so each place in a vendor that hands a URL to the browser through one
// of the NETWORK_PRIMITIVES is listed here, with the proof that the shipped page never reaches
// it or the reason (`why`) the shipped page cannot reach the network through it:
//   - `markers`: verbatim fragments of the site in the vendor bytes, each found exactly once
//     (or [fragment, n]: exactly n times). Every NETWORK_PRIMITIVES occurrence in the vendor
//     must fall inside a marker of this inventory, so a new site in a vendor upgrade (or a stale
//     inventory) fails until it is listed and proven;
//   - `refs` [pattern, n, entry]: the site's entry is referenced exactly n times in the vendor
//     (its definition and export), so no vendor code calls, aliases or exports it further;
//   - `firstParty`: the vendor API whose use reaches the site; firstPartyUse refuses these
//     forms of its use in first-party script (listed exactly in the file header): for a name
//     alone a reference by that name, for [name, 'call'] a call by that name, for
//     [name, 'url'] such a call given a string other than a data:/blob: literal, and for each
//     a string-literal key naming it or a key assembled from its fragments by a + chain or a
//     template literal. Other uses are not held (examples: p[['load','Image'].join('')],
//     const c=p.cursor;c(x), p.cursor?.call(p,x));
//   - `why`: for a site no first-party API is refused for, why the shipped page cannot reach the
//     network through it (it runs only on a first-party value FORBIDDEN_JS scans, or it loads
//     nothing from the network).
// HTML handed to innerHTML/insertAdjacentHTML is not a primitive: markup the vendor builds is
// held by the "resource attribute in an HTML string" primitive, and markup first-party script
// passes in (p5's createDiv, html(), ...) is first-party script that FORBIDDEN_JS scans.
//
// p5@1.11.3 carries the i18next HTTP backend with a loadPath on cdn.jsdelivr.net. Only the
// translator's initialize() starts it; the unminified build calls it from init.js, the minified
// build that ships here replaces that call by Promise.resolve() (`n=Promise.resolve()`), and
// the module is private to the bundle (no global exposes it), so the count of 2 is the proof.
// The rest of p5's sites were enumerated from the 1.11.3 bytes by NETWORK_PRIMITIVES itself.
const P5_HTTP_DO = ['httpDo', 'httpGet', 'httpPost', 'loadJSON', 'loadStrings', 'loadXML',
  'loadTable', 'loadBytes', 'loadShader', 'loadModel'];
const P5_FETCH_API = [...P5_HTTP_DO, 'loadImage'];
const URL_ATTR_NAMES = 'src|href|srcset|poster|data|action|formaction|background|xlink:href'
  + '|ping|manifest|imagesrcset|lowsrc|longdesc|codebase|archive';
export const NETWORK_PRIMITIVES = [
  [/(?<![\w$])fetch\s*\(/g, 'fetch('],
  [/\bXMLHttpRequest\b/g, 'XMLHttpRequest'],
  [/\bsendBeacon\b/g, 'sendBeacon'],
  [/\b(?:WebSocket|EventSource)\b/g, 'WebSocket/EventSource'],
  [/\bimportScripts\s*\(/g, 'importScripts('],
  [/\bloadPath\b/g, 'loadPath'],
  [/\.(?:src|href|srcset|poster)\s*=(?!=)/g, 'a .src/.href/.srcset/.poster assignment'],
  [new RegExp(`\\bsetAttribute(?:NS\\s*\\([^,()]*,|\\s*\\()\\s*(?:(['"])(?:${URL_ATTR_NAMES})\\1`
    + '|(?![\'"]))', 'g'), 'setAttribute of a URL attribute or of a computed name'],
  [/\bnew\s+(?:Image|Audio|Video)\b/g, 'new Image/Audio/Video'],
  [/(?<!\bnew\s+)\burl\(|@import\b/gi, 'a CSS url()/@import'],
  [new RegExp('(?<![\\w$])open\\s*\\(|\\blocation\\.href\\s*=(?!=)|(?<![\\w$.])location=(?!=)'
    + '|\\blocation\\.(?:assign|replace)\\s*\\(', 'g'), 'open()/a location change'],
  [new RegExp(`(?<![\\w:.$-])(?:${URL_ATTR_NAMES})\\s*=\\s*\\\\?["']`, 'g'),
    'a resource attribute in an HTML string'],
  [/\bsrcdoc\b/g, 'srcdoc'],
  [/\.style\s*\[\s*(?!['"])|\.setProperty\s*\(|\bcssText\b/g, 'a computed CSS property'],
];
export const VENDOR_NETWORK = new Map([['p5', [
  {
    site: 'the i18next HTTP backend (translations from cdn.jsdelivr.net)',
    markers: ['loadPath:"https://cdn.jsdelivr.net/npm/p5/translations/',
      'var o=this.options.loadPath', 'Promise.race([fetch(e,t)'],
    refs: [/(?<![\w$])initialize(?![\w$])/g, 2, "the translator's initialize()"],
  },
  {
    site: 'loadImage',
    markers: ['mode:"cors"});return fetch(o,e)', '((t=new Image).onload=function(){',
      '(t.crossOrigin="Anonymous"),t.src=o)'],
    firstParty: ['loadImage'],
  },
  {
    site: 'httpDo (fetch, and JSONP by a <script src>)',
    markers: [':fetch(p))',
      'document.createElement("script"));n.setAttribute("src",""+a+u+"="+r)'],
    firstParty: P5_HTTP_DO,
  },
  { site: 'loadModel (HEAD)', markers: ['fetch(t,{method:"HEAD"})'], firstParty: ['loadModel'] },
  {
    site: 'loadFont (opentype.js load, and an @font-face url())',
    markers: ['kr(e,t){var r=new XMLHttpRequest;r.open("get",e,!0)',
      '"\\n@font-face {\\nfont-family: ".concat(r,";\\nsrc: url(")'],
    firstParty: ['loadFont'],
  },
  {
    site: 'the whatwg-fetch polyfill behind every fetch site',
    markers: ['n=new XMLHttpRequest;n.onload', 'n.open(t.method,t.url,!0)'],
    firstParty: P5_FETCH_API,
  },
  { site: 'createImg', markers: ['(r.crossOrigin=o[2]),r.src=o[0]'], firstParty: ['createImg'] },
  {
    site: 'createVideo/createAudio (<source src>)',
    markers: ['c=document.createElement("source");c.setAttribute("src",u)'],
    firstParty: ['createVideo', 'createAudio'],
  },
  {
    site: 'cursor() given an image URL (a CSS url())',
    markers: ['"url(".concat(e,") ")'],
    firstParty: [['cursor', 'call']],
  },
  {
    site: 'downloadFile() given a URL (<a href download> clicked)',
    markers: ['((o=document.createElement("a")).href=e,o.download=r'],
    // p5's own callers (save*, saveCanvas, saveFrames, saveGif, writeFile) pass a Blob or a
    // canvas data: URL; the app has a downloadFile of its own, so the bare name is not refused.
    firstParty: [['downloadFile', 'url']],
  },
  {
    site: 'the p5.MediaElement src setter',
    markers: ['var r=document.createElement("source");r.src=e,o.appendChild(r),n.elt.src=e'],
    why: 'runs only on a first-party .src assignment to a p5.MediaElement, which FORBIDDEN_JS '
      + 'reads as any .src assignment (an absolute URL literal is refused)',
  },
  {
    site: "createCapture's <video>",
    markers: ['d.srcObject=t:d.src=window.URL.createObjectURL(t)}catch(e){d.src=t}'],
    why: "the camera's MediaStream (srcObject, or its blob: URL), never a network URL",
  },
  {
    site: 'createA',
    markers: ['return o.href=e,o.innerHTML=t'],
    why: 'a link destination, as an <a href> in markup; following it is navigation, not a load',
  },
  {
    site: 'FileSaver saveAs (downloadFile given a Blob)',
    markers: ['u.href=o,u.download=r', 'a.open(e,"_blank")||(a.location.href=e)',
      '!t&&a.open(o,"_blank")||(a.location.href=o)'],
    why: 'a blob: or data: URL of the Blob it is given',
  },
  {
    site: "opentype.js Font.download",
    markers: ['e.addEventListener("writeend",function(){location.href=r.toURL()}'],
    why: "a filesystem: URL of the font's own bytes, on a font only loadFont makes",
  },
  {
    site: 'p5.Element.attribute',
    markers: ['this.elt.setAttribute(e,t),this)', 'this.elt.childNodes[r].setAttribute(e,t)'],
    why: "the caller's own attribute; FORBIDDEN_JS refuses a first-party absolute URL to it",
  },
  {
    site: 'p5.Element.style',
    markers: ['this.elt.style[n[0].trim()]=n[1].trim())}}else this.elt.style[e]=t'],
    why: "the caller's own CSS; FORBIDDEN_JS refuses a first-party absolute CSS url()",
  },
  {
    site: 'p5.XML',
    markers: ['o.setAttribute(r[n].nodeName,r[n].nodeValue)', 'this.DOM.setAttribute(e,t)'],
    why: 'nodes of an XML document (document.implementation.createDocument), which load nothing',
  },
  {
    site: "core-js's Object.create fallback",
    markers: ['e=c("iframe"),t="java"+h+":",e.style.display="none",u.appendChild(e),'
      + 'e.src=String(t),(t=e.contentWindow.document).open()'],
    why: 'a javascript: URL and an inline script (document.F=Object) in a hidden iframe',
  },
  {
    site: "core-js's URL polyfill",
    markers: ['u||(o.href=m.call(o)'],
    why: 'a field of a URL object, not an element',
  },
  {
    site: 'WebGL source fields',
    markers: ['this.size=e,this.src=t,this.dst=r', 'this.src=t,this.glTex=void 0'],
    why: "fields of a RenderBuffer and a Texture (an attribute name, a texture's image object)",
  },
  {
    site: "the accessible text table's shape links",
    markers: [['<a href="#\'.concat(e,"shape")', 3]],
    why: 'in-page #fragment links',
  },
]]]);

const nameRe = (name) => name.replace(/[$]/g, '\\$');

// A key assembled from literal fragments of `name`: a + chain of string literals (any quote)
// and names, or a template literal with ${, whose every literal piece is part of the name,
// three or more characters in all ("load"+"Image", `load`+"Image", `load${x}`,
// "lo"+k+"Image"). A name built otherwise at run time is outside a static scan.
const CONCAT = new RegExp('(?:([\'"`])(?:(?!\\1)[^\\\\\\n]|\\\\.)*\\1|[\\w$.]+)'
  + '(?:\\s*\\+\\s*(?:([\'"`])(?:(?!\\2)[^\\\\\\n]|\\\\.)*\\2|[\\w$.]+))+|`[^`]*\\$\\{[^`]*`', 'g');
function assembledName(body, names) {
  for (const m of body.matchAll(CONCAT)) {
    const pieces = m[0].startsWith('`') && !/^`(?:[^`\\]|\\.)*`\s*\+/.test(m[0])
      ? m[0].slice(1, -1).split(/\$\{[^}]*\}/)
      : [...m[0].matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)]
        .flatMap((s) => (s[1] === '`' ? s[2].split(/\$\{[^}]*\}/) : [s[2]]));
    const lit = pieces.filter(Boolean);
    if (lit.join('').length < 3) continue;
    const name = names.find((n) => lit.every((p) => n.includes(p)));
    if (name) return { name, index: m.index };
  }
  return null;
}

/**
 * Where first-party script uses a vendor API that reaches a network site, or null.
 * @param {string} body
 * @param {string | [string, 'call' | 'url']} entry  see VENDOR_NETWORK `firstParty`
 * @returns {{index: number, form: string} | null}
 */
export function firstPartyUse(body, entry) {
  const [name, form = 'any'] = typeof entry === 'string' ? [entry] : entry;
  const n = nameRe(name);
  const forms = {
    any: [new RegExp(`(?<![\\w$])${n}(?![\\w$])`), `a reference to ${name}`],
    call: [new RegExp(`(?<![\\w$])${n}\\s*(?:\\?\\.\\s*)?(?:\\(|\\.\\s*(?:call|apply|bind)\\b)`),
      `a call of ${name}()`],
    url: [new RegExp(`(?<![\\w$])${n}\\s*(?:\\?\\.\\s*)?\\(\\s*(['"\`])(?!data:|blob:)`),
      `${name}() given a URL`],
  };
  const [re, what] = forms[form];
  const direct = body.match(re);
  if (direct) return { index: direct.index, form: what };
  const literal = body.match(new RegExp(`(['"\`])${n}\\1`));
  if (literal) return { index: literal.index, form: `a computed key "${name}"` };
  const assembled = assembledName(body, [name]);
  if (assembled) return { index: assembled.index, form: `a key assembled to ${name}` };
  return null;
}

const markerOf = (marker) => (typeof marker === 'string' ? [marker, 1] : marker);

/**
 * Problems of one vendor's network inventory against its verbatim code.
 * @param {string} id  "pkg@version"
 * @param {string} code
 * @param {Map<string, object[]>} inventory
 */
export function vendorNetworkProblems(id, code, inventory = VENDOR_NETWORK) {
  const sites = inventory.get(id.slice(0, id.lastIndexOf('@'))) || [];
  const problems = [];
  const spans = [];
  for (const { site, markers, refs, firstParty, why } of sites) {
    if (!refs && !firstParty?.length && !why) {
      problems.push(`vendor ${id}: ${site} has no proof (refs, firstParty or why)`);
    }
    for (const marker of markers) {
      const [text, n] = markerOf(marker);
      let seen = 0;
      for (let at = code.indexOf(text); at >= 0; at = code.indexOf(text, at + 1)) {
        spans.push([at, at + text.length]);
        seen += 1;
      }
      if (seen === 0) problems.push(`vendor ${id}: ${site} marker not found (stale inventory)`);
      else if (seen !== n) {
        problems.push(`vendor ${id}: ${site} marker found ${seen} times, the inventory names ${n}`);
      }
    }
    if (refs) {
      const [re, n, entry] = refs;
      const seen = (code.match(re) || []).length;
      if (seen !== n) {
        problems.push(`vendor ${id}: ${site} is reachable: ${entry} is referenced ${seen} `
          + `times, the inventory proves ${n} (definition and export)`);
      }
    }
  }
  for (const [re, what] of NETWORK_PRIMITIVES) {
    for (const m of code.matchAll(re)) {
      if (spans.some(([a, b]) => m.index >= a && m.index < b)) continue;
      problems.push(`vendor ${id}: ${what} at ${m.index} is in no VENDOR_NETWORK site: `
        + `…${code.slice(Math.max(0, m.index - 40), m.index + 40)}…`);
    }
  }
  return problems;
}

const TOKEN = new RegExp([
  '<!--[\\s\\S]*?-->',                                              // comment
  '<(script|style)\\b((?:[^>"\']|"[^"]*"|\'[^\']*\')*)>([\\s\\S]*?)</\\1\\s*>', // raw text element
  '<([a-zA-Z][\\w:-]*)\\b((?:[^>"\']|"[^"]*"|\'[^\']*\')*)/?>',     // start tag
].join('|'), 'g');

function parseAttrs(src) {
  const attrs = new Map();
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(src))) attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

function isInert(url, { nav = false } = {}) {
  const v = url.trim();
  if (v === '' || v.startsWith('#') || /^data:/i.test(v)) return true;
  return nav && /^(https?:|mailto:|tel:)/i.test(v);
}

// A url() in either quote style (the other quote may occur inside: mini-svg-data-uri's SVGs
// carry xmlns='…' inside url("…")), or unquoted; each quote style is matched on its own.
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s'"()]*))\s*\)/gi;
const CSS_STRING = /"([^"]*)"|'([^']*)'/g;

// Characters the reference scan reads as syntax. Escaped, the browser takes them as part of a
// name or a string (\( never opens a function, \" never ends a string), so the decoded copy
// writes them percent-encoded and keeps the scan's view of the structure the browser's.
const CSS_SYNTAX = /["'()\\@\s]/u;

/**
 * A copy of a stylesheet with its CSS escapes decoded (CSS Syntax 3, "consume an escaped code
 * point"): `\` and 1-6 hex digits with one optional whitespace after, `\` and any other
 * character, and `\` before a newline (a line continuation, dropped). A decoded character the
 * scan treats as syntax is written as %XX instead, so `\75 rl(` reads as `url(`, `@\69mport` as
 * `@import` and `\69mage-set(` as `image-set(`, as the browser reads them, while an escaped
 * quote or parenthesis cannot end a string or open a function. Code point 0, surrogates and
 * values past U+10FFFF become U+FFFD. The copy is only scanned, never emitted.
 * @param {string} css
 */
export function decodeCssEscapes(css) {
  const pct = (ch) => [...Buffer.from(ch, 'utf8')]
    .map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join('');
  return css.replace(/\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|(\r\n|[\n\r\f])|([\s\S]))/g,
    (_, hex, newline, other) => {
      if (newline !== undefined) return '';
      let ch = other;
      if (hex !== undefined) {
        const cp = parseInt(hex, 16);
        ch = cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)
          ? '\ufffd' : String.fromCodePoint(cp);
      }
      return CSS_SYNTAX.test(ch) ? pct(ch) : ch;
    });
}

// Characters the JS scan reads as the structure of a string: decoded, they would end or open
// one where the browser sees only a character inside it, so their escapes are kept.
const JS_SYNTAX = /["'`\\\n\r\u2028\u2029]/u;

/**
 * A copy of script text with its JS escapes decoded: `\uXXXX`, `\u{X...}` and `\xXX`, which
 * spell the same identifier (`p.loadImage`) or string (`p['load\x49mage']`) as the
 * plain characters. Any other `\` pair (`\\`, `\n`, `\'`) is kept as it is, so `\\u0049` stays
 * a backslash and text, and an escape that decodes to a quote, a backslash or a line terminator
 * is kept, so the scan's view of where strings start and end stays the browser's. The copy is
 * only scanned, never emitted.
 * @param {string} js
 */
export function decodeJsEscapes(js) {
  return js.replace(/\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|[\s\S])/g,
    (all, braced, u4, x2) => {
      const hex = braced ?? u4 ?? x2;
      if (hex === undefined) return all;
      const cp = parseInt(hex, 16);
      if (cp > 0x10ffff) return all;
      const ch = String.fromCodePoint(cp);
      return JS_SYNTAX.test(ch) ? all : ch;
    });
}

// The script of an inline event handler (onclick, onerror, ...) or an Alpine directive (x-*,
// @event, :binding): Alpine evaluates each with its Function constructor, so it is first-party
// script like a <script>.
const CODE_ATTR = /^(?:on[a-z]+|x-[\w:.-]+|@[\w:.-]+|:[\w:.-]+)$/;
const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(quot|apos|amp|lt|gt));/g;
const NAMED = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' };
const decodeEntities = (text) => text.replace(ENTITY, (all, dec, hex, name) => {
  if (name) return NAMED[name];
  const cp = parseInt(dec ?? hex, dec ? 10 : 16);
  return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
});

/**
 * Problems of one first-party script (FORBIDDEN_JS), read raw and with its escapes decoded.
 * @param {string} body
 * @param {string} where
 */
function scriptProblems(body, where) {
  const copies = [...new Set([decodeJsEscapes(body), body])];
  const problems = [];
  for (const [re, what] of FORBIDDEN_JS) {
    for (const copy of copies) {
      const hit = copy.match(re);
      if (!hit) continue;
      const context = copy.slice(Math.max(0, hit.index - 40), hit.index + 40);
      problems.push(`${where} uses ${what}: …${context}…`);
      break;
    }
  }
  return { problems, copies };
}

/**
 * Every reference a stylesheet makes: the target of each url(), the bare strings inside each
 * image-set() / -webkit-image-set() (which takes them as well as url()), and the number of
 * url( openings the scan could not parse, so nothing is skipped in silence. It scans the
 * stylesheet with its escapes decoded (decodeCssEscapes), so an escape does not hide one.
 * @param {string} source
 * @returns {{urls: string[], imageSet: string[], unparsed: number}}
 */
export function cssReferences(source) {
  const css = decodeCssEscapes(source);
  const urls = [];
  for (const m of css.matchAll(CSS_URL)) urls.push(m[1] ?? m[2] ?? m[3]);
  const unparsed = (css.match(/url\(/gi) || []).length - urls.length;
  const imageSet = [];
  for (const m of css.matchAll(/image-set\(/gi)) {
    // The argument list up to its closing parenthesis, skipping strings and nested url().
    let depth = 1;
    let i = m.index + m[0].length;
    let args = '';
    while (i < css.length && depth > 0) {
      const c = css[i];
      if (c === '"' || c === "'") {
        const end = css.indexOf(c, i + 1);
        const stop = end < 0 ? css.length : end + 1;
        args += css.slice(i, stop);
        i = stop;
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      if (depth > 0) args += c;
      i += 1;
    }
    const bare = args.replace(CSS_URL, '');
    for (const s of bare.matchAll(CSS_STRING)) imageSet.push(s[1] ?? s[2]);
  }
  return { urls, imageSet, unparsed };
}

// CSS may reference data: URLs (and #fragments) only (isInert). The flowbite plugin emits data:
// SVGs only (mini-svg-data-uri, forms: true included), so ADR 0061 adds no allowance; every
// url() and image-set() string is examined, whichever quote it uses and whatever CSS escape
// spells it (review #253, R-7). Entity-encoded style attributes, SVG presentation attributes
// that take url() and data:text/css stylesheets are not scanned here (R-9, a follow-up).
function cssProblems(css, where) {
  const out = [];
  if (/@import\b/i.test(decodeCssEscapes(css))) out.push(`${where}: CSS @import (must be bundled)`);
  const { urls, imageSet, unparsed } = cssReferences(css);
  for (const u of urls) {
    if (!isInert(u)) out.push(`${where}: CSS url(${u.slice(0, 60)}) is not a data: URL`);
  }
  for (const u of imageSet) {
    if (!isInert(u)) out.push(`${where}: CSS image-set("${u.slice(0, 60)}") is not a data: URL`);
  }
  if (unparsed > 0) out.push(`${where}: ${unparsed} CSS url( the scan cannot parse`);
  return out;
}

// The attribute of a tag that has a rule of its own and is not read again below: a <link>'s
// href and a <script>'s src.
const OWN_RULE = { link: 'href', script: 'src' };

/**
 * Problems of one tag's attributes, read alike on every tag (<link>, <script> and <style>
 * included): its style attribute as CSS, each inline handler or Alpine directive as
 * first-party script (its readings are added to appBodies), and each URL attribute.
 * @param {string} tag
 * @param {Map<string, string>} attrs
 * @param {string[][]} appBodies
 */
function attributeProblems(tag, attrs, appBodies) {
  const problems = [];
  for (const [name, value] of attrs) {
    if (name === 'style') problems.push(...cssProblems(value, `<${tag} style>`));
    if (CODE_ATTR.test(name)) {
      const code = decodeEntities(value);
      const scanned = scriptProblems(code, `first-party script in <${tag} ${name}>`);
      problems.push(...scanned.problems);
      appBodies.push(scanned.copies);
      // A binding of a URL attribute (:src, x-bind:href) to an absolute URL literal.
      const bound = name.replace(/^(?:x-bind)?:/, '');
      if (bound !== name && URL_ATTRS.has(bound)
        && scanned.copies.some((c) => /(['"`])\s*(?:https?:)?\/\//i.test(c))) {
        problems.push(`<${tag} ${name}="${value.slice(0, 80)}"> binds an absolute URL`);
      }
      continue;
    }
    if (!URL_ATTRS.has(name) || OWN_RULE[tag] === name) continue;
    const values = name.endsWith('srcset')
      ? value.split(',').map((s) => s.trim().split(/\s+/)[0])
      : [value];
    for (const v of values) {
      if (!isInert(v, { nav: NAV_TAGS.has(tag) && name === 'href' })) {
        problems.push(`<${tag} ${name}="${v.slice(0, 80)}"> references a file`);
      }
    }
  }
  return problems;
}

/**
 * Pure check of an HTML document. Returns a list of problems (empty = pass).
 * @param {string} html
 * @param {object} [opts]
 * @param {Map<string, string>} [opts.vendors]  vendor id ("p5@1.11.3") -> expected verbatim code
 * @param {{rawBytes: number, gzipBytes: number}} [opts.budget]
 * @param {string[]} [opts.notices]  "pkg@version" of the build-time packages the notice must name
 * @param {Map<string, object[]>} [opts.vendorNetwork]  package -> its network sites (R040)
 */
export function verifyHtml(html, {
  vendors = new Map(), budget = BUDGET, notices = [], vendorNetwork = VENDOR_NETWORK,
} = {}) {
  const problems = [];
  const seenVendors = new Set();
  const appBodies = [];
  let appScripts = 0;

  if (!/^<!doctype html>/i.test(html)) problems.push('document does not start with a doctype');
  if (!/<meta\s+charset=["']?utf-8/i.test(html)) problems.push('missing <meta charset="utf-8">');
  if (/sourceMappingURL\s*=/.test(html)) problems.push('source map reference (sourceMappingURL)');

  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(html))) {
    if (m[0].startsWith('<!--')) continue;

    if (m[1]) { // <script> / <style> with raw text
      const tag = m[1].toLowerCase();
      const attrs = parseAttrs(m[2]);
      const body = m[3];
      // Its attributes are read like every other tag's; its body and src have rules of their own.
      problems.push(...attributeProblems(tag, attrs, appBodies));
      if (tag === 'style') {
        problems.push(...cssProblems(body, '<style>'));
        continue;
      }
      if (attrs.has('src')) problems.push(`external script src="${attrs.get('src')}"`);
      const type = (attrs.get('type') || '').toLowerCase();
      if (DATA_SCRIPT_TYPES.has(type)) continue;
      if (!OK_SCRIPT_TYPES.has(type)) {
        problems.push(`script type="${type}" (only classic scripts are allowed)`);
        continue;
      }
      if (attrs.has('nomodule')) problems.push('nomodule script');
      const vendorId = attrs.get('data-vendor');
      if (vendorId !== undefined) {
        seenVendors.add(vendorId);
        const expected = vendors.get(vendorId);
        if (expected === undefined) problems.push(`unknown vendor script ${vendorId}`);
        else if (guardRawText(expected, 'script', vendorId) !== body) {
          problems.push(`vendor script ${vendorId} is not byte-identical to the pinned file`);
        }
        problems.push(...vendorNetworkProblems(vendorId, body, vendorNetwork));
        continue; // vendor code is verified by identity and its network inventory, not by scan
      }
      appScripts += 1;
      const scanned = scriptProblems(body, 'first-party script');
      problems.push(...scanned.problems);
      appBodies.push(scanned.copies);
      continue;
    }

    const tag = m[4].toLowerCase();
    const attrs = parseAttrs(m[5]);
    if (tag === 'script' || tag === 'style') {
      problems.push(`unterminated <${tag}>`);
      continue;
    }
    if (tag === 'base') problems.push('<base> element changes URL resolution');
    // A <link>'s href has its own rule; its other attributes (inline handlers, Alpine
    // directives, style, the other resource attributes) are read like every other tag's.
    if (tag === 'link') {
      const href = attrs.get('href') || '';
      if (!isInert(href)) problems.push(`<link rel="${attrs.get('rel')}" href="${href}">`);
    }
    if (tag === 'meta' && /refresh/i.test(attrs.get('http-equiv') || '')) {
      problems.push('meta refresh');
    }
    problems.push(...attributeProblems(tag, attrs, appBodies));
  }
  if (appScripts === 0) problems.push('no first-party script found');
  for (const id of seenVendors) {
    for (const { site, firstParty = [] } of vendorNetwork.get(id.slice(0, id.lastIndexOf('@')))
      || []) {
      for (const entry of firstParty) {
        for (const copies of appBodies) {
          for (const body of copies) {
            const hit = firstPartyUse(body, entry);
            if (!hit) continue;
            const context = body.slice(Math.max(0, hit.index - 40), hit.index + 40);
            problems.push(`first-party script reaches vendor ${id} ${site} by ${hit.form}: `
              + `…${context}…`);
            break;
          }
        }
      }
    }
  }

  const htmlTag = html.search(/<html[\s>]/i);
  const head = htmlTag < 0 ? html.slice(0, html.indexOf('-->') + 3) : html.slice(0, htmlTag);
  for (const id of vendors.keys()) {
    if (!seenVendors.has(id)) problems.push(`vendor script ${id} missing`);
  }
  for (const id of [...vendors.keys(), ...notices]) {
    if (!head.includes(`== ${id} - `)) problems.push(`third-party notice for ${id} missing`);
  }

  const raw = Buffer.byteLength(html);
  const gzip = gzipSync(html, { level: 9 }).length;
  if (raw > budget.rawBytes) problems.push(`size ${raw} B exceeds raw budget ${budget.rawBytes} B`);
  if (gzip > budget.gzipBytes) {
    problems.push(`gzip size ${gzip} B exceeds budget ${budget.gzipBytes} B`);
  }
  return { problems, raw, gzip, appScripts, vendors: [...seenVendors] };
}

/**
 * Provenance of a built (unstamped) dist: banner and metadata region against the expected
 * product version and source digest. Returns a list of problems (empty = pass).
 * @param {string} html
 * @param {{ version: string, sourceDigest: string, allowStamped?: boolean }} expected
 */
export function verifyProvenance(html, { version, sourceDigest, allowStamped = false }) {
  const problems = [];
  const banner = readBanner(html);
  if (banner === null) problems.push('top-of-file banner comment missing');
  else if (banner !== version) problems.push(`banner names v${banner}, package.json is ${version}`);
  let record;
  try {
    ({ record } = findRegion(html));
  } catch (e) {
    problems.push(e.message);
    return problems;
  }
  problems.push(...validateRecord(record));
  if (record.version !== version) {
    problems.push(`region version ${record.version} != package.json ${version}`);
  }
  if (record.sourceDigest !== sourceDigest) {
    problems.push(`region sourceDigest ${record.sourceDigest} != recomputed ${sourceDigest}`);
  }
  if (!allowStamped && record.channel !== 'source') {
    problems.push(`committed dist must be unstamped (channel "source"), found "${record.channel}"`);
  }
  return problems;
}

/** "pkg@version" of every BUILD_TIME_ASSETS package, at its installed (pinned) version. */
export function buildTimeNotices(resolve = require.resolve) {
  return BUILD_TIME_ASSETS.map((pkg) => (
    `${pkg}@${JSON.parse(readFileSync(resolve(`${pkg}/package.json`), 'utf8')).version}`));
}

export function pinnedVendors(resolve = require.resolve) {
  return new Map(VENDOR_SCRIPTS.map(({ pkg, file }) => {
    const version = JSON.parse(readFileSync(resolve(`${pkg}/package.json`), 'utf8')).version;
    const code = readFileSync(resolve(file), 'utf8').replace(/\r\n/g, '\n').trim();
    return [`${pkg}@${version}`, code];
  }));
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const i = process.argv.indexOf('--dist');
  const file = path.resolve(root, i > 0 ? process.argv[i + 1] : DIST_HTML);
  const problems = [];
  if (i < 0) {
    const extra = readdirSync(path.dirname(file))
      .filter((f) => !['index.html', '.nojekyll'].includes(f));
    if (extra.length) {
      problems.push(`dist/ must contain only index.html; found ${extra.join(', ')}`);
    }
  }
  const html = readFileSync(file, 'utf8');
  const result = verifyHtml(html, { vendors: pinnedVendors(), notices: buildTimeNotices() });
  problems.push(...result.problems);
  const version = readVersion(root);
  const sourceDigest = computeSourceDigest(root);
  problems.push(...verifyProvenance(html, { version, sourceDigest }));
  const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
  console.log(`${path.relative(root, file)}: raw ${kib(result.raw)} / ${kib(BUDGET.rawBytes)}, `
    + `gzip ${kib(result.gzip)} / ${kib(BUDGET.gzipBytes)}; app scripts ${result.appScripts}; `
    + `vendors ${result.vendors.join(', ') || 'none'} (verified byte-identical)`);
  if (problems.length) {
    for (const p of problems) console.error(`  FAIL ${p}`);
    process.exit(1);
  }
  console.log('  PASS no file/remote references; first-party script, as written and escaped, '
    + 'has none of the forms the header lists as refused (among them fetch( not after a dot, '
    + 'import(, serviceWorker, the identifier eval, Function(, setTimeout/setInterval( with a '
    + 'string literal first, a URL literal handed to a DOM runtime load); everything else is '
    + 'not held by this scan (examples in the header; R041 holds runtime loads); every vendor '
    + 'network site inventoried (its API refused, unreachable, or listed with its reason); '
    + 'budget ok');
  console.log(`  PASS provenance: banner and metadata region name v${version}, `
    + `source digest ${sourceDigest} (recomputed), channel "source"`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

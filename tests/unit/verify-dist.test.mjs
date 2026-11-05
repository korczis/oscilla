import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import * as verifyDist from '../../scripts/verify-dist.mjs';

// A namespace import, so that on a base without the R040 exports each case fails by itself.
const {
  cssReferences, decodeCssEscapes, firstPartyUse, NETWORK_PRIMITIVES, pinnedVendors,
  VENDOR_NETWORK, vendorNetworkProblems, verifyHtml,
} = verifyDist;

const VENDOR = 'window.lib=function(){return fetch("x")};';
const vendors = new Map([['lib@1.0.0', VENDOR]]);
const budget = { rawBytes: 100_000, gzipBytes: 50_000 };
// The fixture vendor's one network site, inventoried as VENDOR_NETWORK inventories p5's.
const vendorNetwork = new Map([['lib', [
  { site: 'lib()', markers: ['return fetch("x")'], firstParty: ['lib'] },
]]]);

function doc({ head = '', body = '', app = 'console.log(1);', vendor = VENDOR } = {}) {
  return '<!doctype html>\n<!--\nnotice\n== lib@1.0.0 - MIT\n-->\n'
    + '<html><head><meta charset="utf-8">'
    + `${head}<style>body{color:red}</style></head><body>${body}`
    + `<script data-vendor="lib@1.0.0">${vendor}</script>`
    + `<script data-app>${app}</script></body></html>`;
}
const check = (html, opts = {}) => verifyHtml(html, {
  vendors, budget, vendorNetwork, ...opts,
}).problems;
const fails = (html, re) => {
  const problems = check(html);
  assert.ok(problems.some((p) => re.test(p)), `expected ${re} in ${JSON.stringify(problems)}`);
};

test('a clean single-file document passes', () => {
  const body = '<a href="https://example.org/">x</a><a href="#top">t</a>'
    + '<img src="data:image/png;base64,AA" alt="">'
    + '<svg><use href="#i"></use></svg><script type="application/json">{"a":1}</script>';
  assert.deepEqual(check(doc({ head: '<link rel="icon" href="data:,">', body })), []);
});

test('vendor code is exempt from the pattern scan but must be byte-identical', () => {
  assert.deepEqual(check(doc()), []); // the vendor contains fetch()
  fails(doc({ vendor: `${VENDOR} ` }), /not byte-identical/);
  const renamed = doc().replace('data-vendor="lib@1.0.0"', 'data-vendor="lib@2.0.0"');
  fails(renamed, /unknown vendor|missing/);
});

test('module, importmap and external scripts fail', () => {
  fails(doc({ body: '<script type="module">1</script>' }), /type="module"/);
  fails(doc({ body: '<script type="importmap">{}</script>' }), /type="importmap"/);
  fails(doc({ body: '<script src="./app.js"></script>' }), /external script/);
});

test('runtime loading in first-party script fails', () => {
  fails(doc({ app: 'fetch("./data.json")' }), /fetch/);
  fails(doc({ app: 'window.fetch(u)' }), /fetch/);
  fails(doc({ app: 'import("./chunk.js")' }), /dynamic import/);
  fails(doc({ app: 'const u=import.meta.url' }), /import\.meta/);
  fails(doc({ app: 'navigator.serviceWorker.register("sw.js")' }), /service worker/);
  fails(doc({ app: 'new Worker("./w.js")' }), /worker loaded from a path/);
  fails(doc({ app: 'ctx.audioWorklet.addModule("./w.js")' }), /worklet loaded from a path/);
  fails(doc({ app: 'new XMLHttpRequest()' }), /XMLHttpRequest/);
  fails(doc({ app: 'new WebSocket("ws://x")' }), /WebSocket/);
  fails(doc({ app: 'x="http://localhost:4000"' }), /localhost/);
});

test('data: worklets and method names that merely contain "import"/"fetch" pass', () => {
  const app = 'ctx.audioWorklet.addModule(`data:text/javascript,${s}`)';
  assert.deepEqual(check(doc({ app })), []);
  // The analysis Worker (M10): a string-embedded script started from a data: URL.
  const worker = 'const W="self.onmessage=e=>postMessage(e.data)";'
    + 'new Worker(`data:text/javascript;charset=utf-8,${encodeURIComponent(W)}`)';
  assert.deepEqual(check(doc({ app: worker })), []);
  fails(doc({ app: 'const W="importScripts(\'x.js\')";new Worker("data:,"+W)' }),
    /importScripts/);
  assert.deepEqual(check(doc({ app: 'a.import(1);b.prefetch(2);c.fetchAll(3)' })), []);
});

test('file and remote references fail', () => {
  fails(doc({ head: '<link rel="stylesheet" href="app.css">' }), /<link/);
  fails(doc({ head: '<link rel="preconnect" href="https://cdn.example">' }), /<link/);
  fails(doc({ head: '<base href="/oscilla/">' }), /<base>/);
  fails(doc({ body: '<img src="logo.png" alt="">' }), /<img src/);
  fails(doc({ body: '<img srcset="a.png 1x, data:image/png;base64,AA 2x" alt="">' }), /srcset/);
  fails(doc({ body: '<a href="docs/index.html">d</a>' }), /<a href/);
  fails(doc({ body: '<a href="/oscilla/">root-relative</a>' }), /<a href/);
  fails(doc({ body: '<div style="background:url(bg.png)"></div>' }), /url\(bg\.png\)/);
  fails(doc({ head: '<style>@import "x.css";</style>' }), /@import/);
  fails(doc({ head: '<style>.a{background:url("img/a.svg")}</style>' }), /url\(img\/a\.svg\)/);
  fails(doc({ head: '<meta http-equiv="refresh" content="0;url=x">' }), /meta refresh/);
});

test('a CSS url() quoted with one quote and holding the other is examined (F001)', () => {
  const css = (rule) => doc({ head: `<style>${rule}</style>` });
  fails(css(`.a{background:url("https://evil.example/x'.png")}`), /evil\.example/);
  fails(css(`.a{background:url("https://evil.example/a.png?x='1'")}`), /evil\.example/);
  fails(css(`.a{background:url('https://evil.example/a.png?x="1"')}`), /evil\.example/);
  fails(css('@font-face{font-family:x;src:url("https://fonts.gstatic.com/a\'b.woff2")}'),
    /fonts\.gstatic/);
  fails(css('.a{background:url( https://evil.example/x.png )}'), /evil\.example/);
  // image-set() and -webkit-image-set() take bare strings as well as url().
  fails(css('.a{background:image-set("https://evil.example/x.png" 1x)}'), /image-set/);
  fails(css(".a{background:-webkit-image-set('img/a.png' 1x)}"), /image-set/);
  // A url( the scan cannot parse is a problem, never silently skipped.
  const broken = '.a{background:url("https://evil.example/x.png)}';
  fails(css(broken), /1 CSS url\( the scan cannot parse/);
  assert.equal(cssReferences(broken).unparsed, 1, 'exactly the one url( is unparsed');
  // The flowbite plugin's data: URIs (mini-svg-data-uri, the other quote inside) pass.
  assert.deepEqual(check(css(".a{background-image:url(\"data:image/svg+xml,%3csvg xmlns='"
    + "http://www.w3.org/2000/svg'%3e%3c/svg%3e\")}")), []);
  assert.deepEqual(check(css('.a{background:image-set("data:image/png;base64,AA" 1x)}')), []);
  assert.deepEqual(check(css('.a{fill:url(#grad)}')), []);
});

test('CSS escapes do not hide a url(), image-set() or @import (F001 review R-7)', () => {
  const css = (rule) => doc({ head: `<style>${rule}</style>` });
  // A hex escape (with its optional trailing space) or a character escape in the function name
  // or the at-keyword is the same token to the browser.
  fails(css('.a{background:\\75 rl(https://evil.example/x.png)}'), /evil\.example/);
  fails(css('.a{background:\\000075rl("https://evil.example/x.png")}'), /evil\.example/);
  fails(css('.a{background:u\\rl(https://evil.example/x.png)}'), /evil\.example/);
  fails(css('@\\69mport "https://evil.example/a.css";'), /@import/);
  fails(css('@\\import url(x.css);'), /@import/);
  fails(css('.a{background:\\69mage-set("https://evil.example/x.png" 1x)}'), /image-set/);
  // Escapes inside the URL are decoded too, and an escaped quote does not end the string.
  fails(css('.a{background:url("ht\\74ps://evil.example/x.png")}'), /evil\.example/);
  fails(css('.a{background:url("https://evil.example/\\"x.png")}'), /evil\.example/);
  assert.deepEqual(check(css('.a{background:url("\\64 ata:image/png;base64,AA")}')), []);
  assert.deepEqual(check(css('.a{background:url("data:image/svg+xml,a\\"b")}')), []);
  // Escaped selectors and content strings (Tailwind's .lg\:w-16, a glyph) stay clean.
  assert.deepEqual(check(css('.lg\\:w-16{width:4rem}.b:after{content:"\\2014\\""}')), []);
  // An escaped "(" is part of the name, not a function opening, as in the browser.
  assert.deepEqual(check(css('.url\\(x\\){color:red}')), []);
  assert.equal(decodeCssEscapes('\\75 rl(\\28 \\"\\\n'), 'url(%28%22');
});

test('source maps, missing notice and malformed markup fail', () => {
  fails(doc({ app: '1\n//# sourceMappingURL=app.js.map' }), /source map/);
  fails(doc().replace('== lib@1.0.0 - MIT', ''), /notice/);
  fails(`${doc()}<script>unterminated`, /unterminated/);
  // Mid-document, the parser swallows the following markup into the script: still a failure.
  assert.ok(check(doc({ body: '<script>unterminated' })).length > 0);
  fails(doc().replace('<meta charset="utf-8">', ''), /charset/);
});

test('size budget is enforced', () => {
  fails(doc({ app: `/*${'x'.repeat(120_000)}*/` }), /raw budget/);
  const tiny = { rawBytes: 1e6, gzipBytes: 10 };
  const { problems } = verifyHtml(doc(), { vendors, budget: tiny });
  assert.ok(problems.some((p) => /gzip size/.test(p)));
});

// R040: each of these five forms passed verify-dist (rc=0) at 68b117f3.
test('a script element given an absolute src fails, and so does any absolute .src/.href (R040)',
  () => {
    fails(doc({ app: 'const s=document.createElement("script");'
      + 's.src="https://cdn.example/x.js";document.head.append(s)' }), /\.src\/\.href/);
    fails(doc({ app: "l.href = '//cdn.example/a.css'" }), /\.src\/\.href/);
    fails(doc({ app: 'v.poster=`https://t.example/${id}.jpg`' }), /\.src\/\.href/);
    fails(doc({ app: 'i.srcset="https://t.example/a.png 2x"' }), /\.src\/\.href/);
    fails(doc({ app: 's.setAttribute("src","https://cdn.example/x.js")' }), /setAttribute/);
    // A data: or #fragment target, and a link to a variable, stay clean.
    const app = 'a.href=u;a.href="#top";i.src="data:image/png;base64,AA"';
    assert.deepEqual(check(doc({ app })), []);
  });

test('new Image().src from anything but a data:/blob: literal fails (R040)', () => {
  fails(doc({ app: 'new Image().src="https://t.example/p.gif?u="+id' }), /new Image\(\)\.src/);
  fails(doc({ app: 'new Image(1, 1).src = u' }), /new Image\(\)\.src/);
  assert.deepEqual(check(doc({ app: 'new Image().src="data:image/png;base64,AA"' })), []);
});

test('new Audio(url) and new Video(url) fail unless given a data:/blob: literal (R040)', () => {
  fails(doc({ app: 'new Audio(url).play()' }), /new Audio\(\)\/Video\(\)/);
  fails(doc({ app: 'new Audio("https://t.example/a.mp3")' }), /new Audio\(\)\/Video\(\)/);
  fails(doc({ app: 'new Video(u)' }), /new Audio\(\)\/Video\(\)/);
  // An empty Audio(), a data: one and an AudioWorkletNode or AudioContext stay clean.
  const app = 'new Audio();new Audio("data:audio/wav;base64,AA");'
    + 'new AudioWorkletNode(c,"x");new AudioContext()';
  assert.deepEqual(check(doc({ app })), []);
});

test('an absolute URL in a resource attribute of an HTML string fails (R040)', () => {
  const html = /resource attribute of an HTML string/;
  fails(doc({ app: 'el.insertAdjacentHTML("beforeend","<img src=https://t.example/p.gif>")' }),
    html);
  fails(doc({ app: 'el.innerHTML=\'<img alt="" src="https://t.example/p.gif">\'' }), html);
  fails(doc({ app: 'el.innerHTML=`<video poster=\'//t.example/a.jpg\'></video>`' }), html);
  fails(doc({ app: 'el.innerHTML="<link rel=stylesheet href=\\"https://cdn.example/a.css\\">"' }),
    html);
  fails(doc({ app: 'el.innerHTML=\'<a href="#x" ping="https://t.example/p">x</a>\'' }), html);
  // A link destination, an SVG namespace, a data- attribute and a data: image stay clean.
  const app = 'el.innerHTML=\'<a href="https://doi.org/10.1/x" target="_blank">d</a>'
    + '<svg xmlns="http://www.w3.org/2000/svg"></svg><b data-src="https://x.example/">b</b>'
    + '<img src="data:image/png;base64,AA" alt="">\'';
  assert.deepEqual(check(doc({ app })), []);
});

test('a computed fetch fails: window["fe"+"tch"], a template key and x["fetch"] (R040)', () => {
  const computed = /computed fetch/;
  fails(doc({ app: 'window["fe"+"tch"]("https://t.example/")' }), computed);
  fails(doc({ app: 'globalThis[`fe${"tch"}`](u)' }), computed);
  fails(doc({ app: "self['fetch'](u)" }), computed);
  fails(doc({ app: 'const g=window;g["fetch"](u)' }), computed);
  // A global's member under an identifier key (the storage probe, the analysis source) is clean.
  assert.deepEqual(check(doc({ app: 'window[e];globalThis[gZ];o["fetchAll"]' })), []);
});

test('a vendor network site outside the inventory, or a stale marker, fails (R040)', () => {
  // The default inventory does not know the fixture vendor: its fetch( is in no site.
  assert.ok(verifyHtml(doc(), { vendors, budget }).problems
    .some((p) => /vendor lib@1\.0\.0: fetch\( at \d+ is in no VENDOR_NETWORK site/.test(p)));
  const stale = new Map([['lib', [{ site: 'lib()', markers: ['return fetch("y")'] }]]]);
  assert.ok(verifyHtml(doc(), { vendors, budget, vendorNetwork: stale }).problems
    .some((p) => /lib\(\) marker not found \(stale inventory\)/.test(p)));
  // First-party script calling the entry API reaches the vendor's site.
  fails(doc({ app: 'window.lib()' }), /first-party script reaches vendor lib@1\.0\.0 lib\(\)/);
});

const [[P5_ID, P5]] = [...pinnedVendors()];
const p5Doc = (vendor, app = 'console.log(1);') => '<!doctype html>\n<!--\nnotice\n'
  + `== ${P5_ID} - LGPL\n-->\n<html><head><meta charset="utf-8"></head><body>`
  + `<script data-vendor="${P5_ID}">${vendor}</script><script data-app>${app}</script>`
  + '</body></html>';
const p5Check = (vendor, app) => verifyHtml(p5Doc(vendor, app), {
  vendors: new Map([[P5_ID, vendor]]), budget: { rawBytes: 1e8, gzipBytes: 1e8 },
}).problems;

test('every network string in the pinned p5 is inventoried and unreachable (R040)', () => {
  assert.match(P5_ID, /^p5@/);
  assert.deepEqual(vendorNetworkProblems(P5_ID, P5), []);
  assert.deepEqual(p5Check(P5), []);
  // The i18next HTTP backend's loadPath is in the bytes, and nothing calls initialize().
  assert.ok(P5.includes('loadPath:"https://cdn.jsdelivr.net/npm/p5/translations/'));
  assert.ok(P5.includes('e("./internationalization");var n=Promise.resolve();'),
    'the minified init.js waits on Promise.resolve(), not on the translator');
  for (const { firstParty = [] } of VENDOR_NETWORK.get('p5')) {
    for (const entry of firstParty) {
      const api = typeof entry === 'string' ? entry : entry[0];
      assert.ok(p5Check(P5, `p.${api}("https://t.example/x.json")`)
        .some((p) => p.includes('reaches vendor p5@')),
      `a first-party ${api}() reaches the vendor`);
    }
  }
});

test('a p5 whose init calls the translator\'s initialize() is refused (R040)', () => {
  // The unminified build's init.js: Promise.all([documentReady, initTranslator()]).
  const calling = P5.replace('e("./internationalization");var n=Promise.resolve();',
    'var I=e("./internationalization"),n=(0,I.initialize)();');
  assert.notEqual(calling, P5);
  const refused = /i18next HTTP backend .* is reachable: the translator's initialize\(\) is ref/;
  const problems = p5Check(calling);
  assert.ok(problems.some((p) => refused.test(p) && / 3 times/.test(p)), 'the call is refused');
  // A new fetch site appended to the vendor is refused too.
  assert.ok(p5Check(`${P5};fetch("https://cdn.example/x")`)
    .some((p) => /fetch\( at \d+ is in no VENDOR_NETWORK site/.test(p)));
});

test('attribute()/setAttributeNS() and a CSS url() in a script string fail (R040 review)', () => {
  fails(doc({ app: 'img.attribute("src","https://t.example/p.gif")' }), /setAttribute\/attribute/);
  fails(doc({ app: 'u.setAttributeNS(null,"href","https://t.example/s.svg#i")' }),
    /setAttribute\/attribute/);
  const css = /CSS url\(\) of a script string/;
  fails(doc({ app: 'a.style.backgroundImage="url(https://t.example/b.png)"' }), css);
  fails(doc({ app: "el.style('background', 'url(\"//t.example/b.png\")')" }), css);
  // A navigation, a data: url() and an attribute that loads nothing stay clean.
  const app = 'location.href="https://example.org/";a.style.backgroundImage="url(data:,)";'
    + 'b.attribute("title","https://example.org/")';
  assert.deepEqual(check(doc({ app })), []);
});

// Every site of the p5 inventory that names a first-party API, one family at a time.
const P5_SITES = VENDOR_NETWORK.get('p5');
const families = P5_SITES.filter(({ firstParty }) => firstParty?.length);
const entries = (site) => site.firstParty.map((e) => (typeof e === 'string' ? [e, 'any'] : e));
const usesOf = (api, form) => {
  const arg = '"https://t.example/x"';
  const uses = [`${api}(${arg})`, `p.${api}(${arg})`, `this.${api}(${arg})`,
    `p["${api}"](${arg})`, `p[\`${api}\`](${arg})`,
    `p["${api.slice(0, 2)}"+"${api.slice(2)}"](${arg})`,
    `p[\`${api.slice(0, 3)}\${k}\`](${arg})`, `p?.${api}(${arg})`];
  if (form !== 'url') uses.push(`p.${api}.call(p,${arg})`);
  if (form === 'any') uses.push(`const f=p.${api};f(${arg})`);
  return uses;
};

test('each p5 API family is refused in every first-party form (R040 review)', () => {
  // The p5@1.11.3 APIs whose use reaches a network site, enumerated from its bytes; a name
  // dropped from the inventory (or a form weakened) fails here.
  const refused = new Map(families.flatMap(entries));
  assert.deepEqual([...refused].sort(), [
    ['createAudio', 'any'], ['createImg', 'any'], ['createVideo', 'any'], ['cursor', 'call'],
    ['downloadFile', 'url'], ['httpDo', 'any'], ['httpGet', 'any'], ['httpPost', 'any'],
    ['loadBytes', 'any'], ['loadFont', 'any'], ['loadImage', 'any'], ['loadJSON', 'any'],
    ['loadModel', 'any'], ['loadShader', 'any'], ['loadStrings', 'any'], ['loadTable', 'any'],
    ['loadXML', 'any'],
  ]);
  for (const site of families) {
    for (const [api, form] of entries(site)) {
      for (const app of usesOf(api, form)) {
        const refused = p5Check(P5, app).some((p) => p.includes(`reaches vendor ${P5_ID} `));
        assert.ok(refused, `${site.site}: ${app} is refused`);
      }
    }
  }
});

test('the call-only and URL-only forms leave the app\'s own words alone (R040 review)', () => {
  // uPlot's cursor object, p5's noCursor() and the app's own downloadFile(blob) pass.
  const app = 'let n=e.cursor.points;p.noCursor();t.downloadFile(vR(_.patch));'
    + 'const o={downloadFile:i};d.downloadFile("data:text/plain,x")';
  assert.deepEqual(p5Check(P5, app), []);
  assert.equal(firstPartyUse(app, ['cursor', 'call']), null);
  assert.equal(firstPartyUse(app, ['downloadFile', 'url']), null);
  assert.ok(firstPartyUse('p.cursor(p.HAND)', ['cursor', 'call']));
  assert.ok(firstPartyUse('t.downloadFile(`https://x/${f}`)', ['downloadFile', 'url']));
});

test('mutation: each family\'s refusal and each site\'s markers are load-bearing (R040)', () => {
  for (const site of P5_SITES) {
    // Without the site, a primitive of the shipped p5 lies in no site.
    const without = new Map([['p5', P5_SITES.filter((s) => s !== site)]]);
    assert.ok(vendorNetworkProblems(P5_ID, P5, without)
      .some((p) => / is in no VENDOR_NETWORK site/.test(p)), `${site.site} covers a primitive`);
  }
  for (const site of families) {
    for (const [api] of entries(site)) {
      // Without the API in any site, its direct call passes again.
      const stripped = new Map([['p5', P5_SITES.map((s) => ({
        ...s,
        firstParty: s.firstParty?.filter((e) => (typeof e === 'string' ? e : e[0]) !== api),
        why: s.why || 'mutated',
      }))]]);
      const problems = verifyHtml(p5Doc(P5, `p.${api}("https://t.example/x")`), {
        vendors: new Map([[P5_ID, P5]]), budget: { rawBytes: 1e8, gzipBytes: 1e8 },
        vendorNetwork: stripped,
      }).problems;
      assert.deepEqual(problems, [], `${api} is refused only by its own entry`);
    }
  }
});

test('the p5 primitives cover DOM sinks, CSS url() and navigation, not only fetch (R040)', () => {
  const kinds = NETWORK_PRIMITIVES.map(([, what]) => what);
  for (const k of ['fetch(', 'XMLHttpRequest', 'a .src/.href/.srcset/.poster assignment',
    'setAttribute of a URL attribute or of a computed name', 'new Image/Audio/Video',
    'a CSS url()/@import', 'open()/a location change', 'a resource attribute in an HTML string',
    'a computed CSS property']) assert.ok(kinds.includes(k), k);
  // The sites the review found unlisted are each refused when appended to the vendor.
  for (const added of ['r.src=o[0]', 'c.setAttribute("src",u)', 'n.setAttribute(e,t)',
    'document.head.append(new Image)', 's.style.cursor="url("+e+")"', 'window.open(u)',
    'x.innerHTML=\'<img src="\'+u+\'">\'', 'e.style[k]=v']) {
    assert.ok(p5Check(`${P5};${added}`).some((p) => / is in no VENDOR_NETWORK site/.test(p)),
      `${added} appended to p5 is refused`);
  }
});

test('a marker count other than the inventory\'s, or a site without proof, fails (R040)', () => {
  const twice = `${VENDOR}${VENDOR}`;
  const once = new Map([['lib', [{ site: 'lib()', markers: ['return fetch("x")'], why: 'w' }]]]);
  assert.ok(vendorNetworkProblems('lib@1.0.0', twice, once)
    .some((p) => /marker found 2 times, the inventory names 1/.test(p)));
  const counted = new Map([['lib', [{ site: 'lib()', markers: [['return fetch("x")', 2]],
    why: 'w' }]]]);
  assert.deepEqual(vendorNetworkProblems('lib@1.0.0', twice, counted), []);
  const bare = new Map([['lib', [{ site: 'lib()', markers: ['return fetch("x")'] }]]]);
  assert.ok(vendorNetworkProblems('lib@1.0.0', VENDOR, bare)
    .some((p) => /lib\(\) has no proof/.test(p)));
});

test('the committed dist passes with the R040 forms and the p5 inventory in force', () => {
  const html = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');
  const { problems } = verifyHtml(html, { vendors: pinnedVendors(), notices: [] });
  assert.deepEqual(problems, []);
});

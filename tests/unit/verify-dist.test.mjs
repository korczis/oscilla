import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyHtml } from '../../scripts/verify-dist.mjs';

const VENDOR = 'window.lib=function(){return fetch("x")};';
const vendors = new Map([['lib@1.0.0', VENDOR]]);
const budget = { rawBytes: 100_000, gzipBytes: 50_000 };

function doc({ head = '', body = '', app = 'console.log(1);', vendor = VENDOR } = {}) {
  return '<!doctype html>\n<!--\nnotice\n== lib@1.0.0 - MIT\n-->\n'
    + '<html><head><meta charset="utf-8">'
    + `${head}<style>body{color:red}</style></head><body>${body}`
    + `<script data-vendor="lib@1.0.0">${vendor}</script>`
    + `<script data-app>${app}</script></body></html>`;
}
const check = (html, opts = {}) => verifyHtml(html, { vendors, budget, ...opts }).problems;
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

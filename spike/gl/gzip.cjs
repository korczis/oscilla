#!/usr/bin/env node
// Y001 spike (branch spike/gl-views, never merged): what each backend would add to the single
// file's gzip budget, and whether the shipped p5@1.11.3 block already carries the WEBGL renderer.
//
//   node spike/gl/gzip.cjs [--dist dist/index.html] [--out <dir>] [--commit <sha>]
//
// Per backend module (spike/gl/backends/raw-gl.js, canvas2d.js): esbuild 0.28 (node_modules)
// bundle + minify (format esm, target es2020, as one module), then
//   standalone   gzip level 9 of the minified module alone (node:zlib, as verify-dist measures;
//                `gzip -9 -c | wc -c` is printed beside it as a cross-check)
//   marginal     gzip -9 of dist/index.html with the minified module inserted before its last
//                </script>, minus gzip -9 of dist/index.html: what the module would cost inside
//                the shipped page, where gzip shares context with the rest
// p5gl.js is reported too (it only calls window.p5, so its bytes are the glue alone). The p5
// check: node_modules/p5/lib/p5.min.js and dist/index.html are searched for the WEBGL renderer
// (RendererGL, the WEBGL constant, a webgl2 getContext path), and the version banner.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), 'y001')));
const COMMIT = arg('commit', (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { return null; }
})());

const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const gzCli = (buf) => {
  try {
    return Number(execFileSync('sh', ['-c', 'gzip -9 -c | wc -c'], { input: buf }).toString()
      .trim());
  } catch { return null; }
};

(async () => {
  const html = fs.readFileSync(DIST);
  const htmlStr = html.toString('utf8');
  const baseGz = gz(html);
  const cut = htmlStr.lastIndexOf('</script>');
  const out = { commit: COMMIT, command: `node spike/gl/gzip.cjs ${argv.join(' ')}`.trim(),
    esbuild: require('esbuild/package.json').version, dist: path.relative(ROOT, DIST),
    distBytes: html.length, distGzip9: baseGz, modules: {} };
  for (const name of ['raw-gl', 'canvas2d', 'p5gl']) {
    const r = await esbuild.build({ entryPoints: [path.join(__dirname, 'backends', `${name}.js`)],
      bundle: true, minify: true, format: 'esm', target: 'es2020', write: false,
      logLevel: 'silent' });
    const code = Buffer.from(r.outputFiles[0].text);
    // Inside the page the module is not an ES module: drop the export statement.
    const inner = r.outputFiles[0].text.replace(/export\s*\{[^}]*\};?\s*$/, '');
    const withMod = Buffer.from(htmlStr.slice(0, cut) + inner + htmlStr.slice(cut));
    out.modules[name] = { minifiedBytes: code.length, gzip9: gz(code), gzip9Cli: gzCli(code),
      marginalGzip9InDist: gz(withMod) - baseGz };
  }
  const p5min = fs.readFileSync(require.resolve('p5/lib/p5.min.js'), 'utf8');
  const has = (s) => ({ RendererGL: s.includes('RendererGL'), WEBGL: /WEBGL\s*:\s*"webgl"/.test(s)
    || s.includes('"webgl"'), webgl2: s.includes('webgl2') });
  out.p5 = { package: require('p5/package.json').version,
    banner: (p5min.match(/p5\.js v[0-9.]+/) || [null])[0], minBytes: Buffer.byteLength(p5min),
    minBuild: has(p5min), distBlock: has(htmlStr),
    distCarriesP5Banner: htmlStr.includes((p5min.match(/p5\.js v[0-9.]+/) || ['@@'])[0]) };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'gzip.json'), `${JSON.stringify(out, null, 2)}\n`);
  for (const [k, v] of Object.entries(out.modules)) {
    console.log(`${k.padEnd(9)} min ${v.minifiedBytes} B, gzip-9 ${v.gzip9} B (cli ${v.gzip9Cli}),`
      + ` marginal in dist ${v.marginalGzip9InDist} B`);
  }
  console.log(`dist gzip-9 ${baseGz} B; p5 ${out.p5.package} ${out.p5.banner}: min build `
    + `${JSON.stringify(out.p5.minBuild)}, dist ${JSON.stringify(out.p5.distBlock)}`);
})().catch((e) => { console.error(e); process.exit(1); });

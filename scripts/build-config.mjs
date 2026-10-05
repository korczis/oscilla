// Single source of truth shared by build.mjs and verify-dist.mjs.

export const SRC_HTML = 'src/index.html';
export const JS_ENTRY = 'src/js/main.js';
export const CSS_ENTRY = 'src/styles/main.css';
export const DIST_HTML = 'dist/index.html';

// Browsers the bundle is lowered for (esbuild syntax + CSS lowering, e.g. CSS nesting).
export const TARGETS = ['es2020', 'chrome105', 'edge105', 'firefox110', 'safari16'];

// Vendor libraries shipped VERBATIM as their own classic <script> (in this order) and exposed to
// the bundle through a window global. p5 is LGPL-2.1: keeping the official build unmodified and
// separable lets a recipient replace it, and lets verify-dist check it byte-for-byte.
export const VENDOR_SCRIPTS = [
  {
    pkg: 'p5',
    file: 'p5/lib/p5.min.js',
    global: 'p5',
    source: 'https://github.com/processing/p5.js/tree/v{version}',
    reason: 'LGPL-2.1: unmodified, replaceable; contains fetch() for loadJSON/httpDo (unused)',
  },
];

// Packages whose content ends up in dist/ without being imported by the JS bundle.
export const BUILD_TIME_ASSETS = ['lucide-static'];

// Size budget for dist/index.html (bytes). p5.min.js alone is ~1.03 MiB raw / ~244 KiB gzip.
// V3 (MEASURE, EXPERIMENTS) raised it from 2 000 000 / 560 000 after measuring the contributors
// (spec §129; esbuild metafile, minified): measurement modules 101 KB, measurement views 59 KB,
// experiments 56 KB, calibration 17 KB, the two UI adapters 28 KB, their charts 6 KB, plus about
// 46 KB of workspace markup and 15 KB of CSS (+332 KB raw over the V2 release).
// V3.1 (STUDIO, spec §216) raised it from 2 250 000 / 630 000 after measuring the contributors
// (esbuild metafile, minified): the Studio model, compiler, runtime, transport and templates
// (src/js/studio, bundled once the workspace imports them) about 187 KB; the workspace, graph
// editor, inspector, library, compact widget and patches (src/js/ui/studio) 95 KB; the timeline,
// transport and automation editors 66 KB; about 14 KB of markup and 42 KB of CSS. The integrated
// dist measured 2 559 785 B raw / 724 680 B gzip (+413 KB raw over V3.0); the budget keeps the
// V3 headroom of about 5 %.
// V3.7 raised it from 2 700 000 / 760 000 by owner decision (2026-10-05), as a stopgap: the V3.7
// release measured 2 610 384 B raw / 751 494 B gzip, too little for the next slices. p5 is
// ~245 KB of the gzip, while the views call only about 28 of its 2D drawing functions; replacing
// it is the deferred alternative. Raw follows gzip at the measured ratio (3.47), so gzip stays
// the binding limit.
export const BUDGET = {
  rawBytes: 3_500_000,
  gzipBytes: 1_000_000,
};

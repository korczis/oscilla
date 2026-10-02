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
export const BUDGET = {
  rawBytes: 2_000_000,
  gzipBytes: 560_000,
};

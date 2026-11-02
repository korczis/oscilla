// Single source of truth shared by build.mjs and verify-dist.mjs.

export const SRC_HTML = 'src/index.html';
export const JS_ENTRY = 'src/js/main.js';
export const CSS_ENTRY = 'src/styles/main.css';
// The one Tailwind entry (ADR 0061) and its config; compiled after the legacy CSS (build.mjs).
export const TAILWIND_ENTRY = 'src/styles/tailwind.css';
export const TAILWIND_CONFIG = 'tailwind.config.cjs';

// OSCILLA's dark theme is data-theme="dark" on <html> (never class="dark"). tailwind.config.cjs
// points the dark: variant at it, but the flowbite plugin hard-codes a .dark ancestor whatever
// darkMode says (its tooltip arrows; with forms: true, F002, its form controls too).
export const DARK_THEME_SELECTOR = '[data-theme="dark"]';
// A .dark class in a selector: not the escaped dark: variant class (.dark\:bg-opacity-80).
const DARK_CLASS = /\.dark(?![\w\\-])/g;

/**
 * PostCSS plugin run after Tailwind (build.mjs): rewrites every .dark class in a selector to
 * DARK_THEME_SELECTOR, so the plugin's dark rules follow OSCILLA's theme.
 */
export function darkThemeSelector() {
  return {
    postcssPlugin: 'oscilla-dark-theme-selector',
    Rule(rule) {
      DARK_CLASS.lastIndex = 0;
      if (!DARK_CLASS.test(rule.selector)) return;
      rule.selectors = rule.selectors.map((sel) => sel.replace(DARK_CLASS, DARK_THEME_SELECTOR));
    },
  };
}
darkThemeSelector.postcss = true;
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

// Packages whose content ends up in dist/ without being imported by the JS bundle: the Lucide
// icons, and the CSS Tailwind generates with the flowbite plugin (tailwind.config.cjs). The
// third-party notice names each, and verify-dist requires it there.
export const BUILD_TIME_ASSETS = ['flowbite', 'lucide-static', 'tailwindcss'];

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
// On 2026-10-29 the owner raised the gzip budget from 1 000 000 to 1 200 000, replacing the #114
// stopgap (plan issue E027; ADR 0012 note): main at b67d1e5 measured 2 839 952 B raw / 820 005 B
// gzip. Raw follows in proportion, from 3 500 000 to 4 200 000 (measured ratio 3.46), so gzip
// stays the binding limit. Replacing p5 stays the deferred alternative (ADR 0013).
// F001 (ADR 0061) compiles Tailwind with the flowbite plugin into the <style> and bundles five
// flowbite components (drawer, dropdown, collapse, tooltip, tabs, with @popperjs/core) into the
// app script, within the budget. Both sides are measured as verify-dist and size-report measure
// (bytes, and node:zlib gzipSync at level 9): before (main cdda563)
// 2 839 952 B raw / 823 309 B gzip, after 2 902 810 B raw / about 837 740 B gzip
// (+62 858 B raw, about +14 431 B gzip): about 12 KB of compiled CSS (the classes the five
// components add at run time included), 47 KB of components and 3 KB of licence text in the
// notice. The gzip figure is "about" because this file is an
// input of the source digest that dist carries: writing a figure here changes the digest and so
// moves gzip by a few bytes (raw does not move: the digest has a fixed length).
export const BUDGET = {
  rawBytes: 4_200_000,
  gzipBytes: 1_200_000,
};

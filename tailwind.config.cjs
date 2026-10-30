// Tailwind for OSCILLA (ADR 0061, issue F001): compiled at build time by scripts/build.mjs
// through Tailwind's PostCSS API from src/styles/tailwind.css, and emitted after the legacy CSS
// in the one <style> of dist/index.html. Nothing is fetched at run time.
//
// The theme is the Flowbite Pro admin dashboard's (the flowbite-pro reference, section 0):
//   - primary and the surface grays are OSCILLA's own scales (below), in the Pro class names;
//   - transitionProperty width, which the sidebar's transition-width needs;
//   - Inter first in the sans stack, then the system stack of src/styles/tokens.css. No font is
//     downloaded: Inter applies only where it is installed.
// darkMode follows OSCILLA's own two-state theme (data-theme="dark" | "light" on <html>) and
// never the media query. Dark is every theme but light: tokens.css is dark on :root and light
// only on [data-theme="light"], and ui/theme.js reads an absent attribute as dark, so the dark:
// variant matches unless the element is in [data-theme="light"] (review #330 F3: on
// [data-theme="dark"] alone the shell turned light under the dark legacy text when the
// attribute was absent). :not(:where(...)) adds no specificity, as the selector strategy's
// :where() did. The flowbite plugin's own dark rules hard-code a .dark ancestor instead;
// scripts/build.mjs rewrites it to the same theme (darkThemeSelector,
// scripts/build-config.mjs), as OSCILLA never sets class="dark".
//
// The colours are OSCILLA's (rule project.visual-identity-lock v2, issue F002): primary is its
// blue interaction accent (600 is --osc-blue, 700 the deeper fill that carries white text at
// 4.8:1, 400 the focus and link blue) and the surface greys are its cockpit: in the dark theme
// the Pro shell's gray-800 bars are the header navy, gray-900 the page, gray-700 the borders and
// the hover inset; in the light theme gray-50 is the page and gray-200 the borders, as in
// src/styles/tokens.css. The Pro class lists are unchanged; only the palette they read is ours.
//
// Preflight and the flowbite plugin's form base styles are on (F002): the Pro shell's borders,
// buttons and the search field need them (the border trap of review #253, R-3). They stay out
// of the legacy interface's way because src/styles/tailwind.css compiles the whole base inside
// the cascade layer tailwind-base: the legacy stylesheets are unlayered, so every legacy rule
// wins over every base rule whatever their specificity or order (input[type="range"] thumbs and
// body's line-height included), and the base only fills what the legacy CSS leaves unsaid.
// Tailwind's utilities stay unlayered and after the legacy CSS, as F001 placed them.
//
// Order: this file lands only after #250 is on main (ADR 0061, rule
// project.ui-uses-flowbite-pro and the ratchet tests/unit/ui-flowbite-pro.test.mjs). Until
// then the ADR it cites does not exist on main.
const SYSTEM_SANS = ['system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto',
  'sans-serif'];
const SYSTEM_MONO = ['ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'];

/** OSCILLA's blue accent as the Pro primary scale. */
const PRIMARY = {
  50: '#eef6ff', 100: '#d9eaff', 200: '#b5d7ff', 300: '#80bcff', 400: '#4da3ff',
  500: '#1a88ff', 600: '#007afd', 700: '#006ee6', 800: '#00468c', 900: '#002f5e', 950: '#001b38',
};
/** OSCILLA's cockpit surfaces as the Pro gray scale (light end: tokens.css light theme). */
const GRAY = {
  50: '#e9eef4', 100: '#e4eaf2', 200: '#d3dbe6', 300: '#c3cddb', 400: '#94a9bd',
  500: '#52657a', 600: '#33465b', 700: '#142233', 800: '#061220', 900: '#020b15', 950: '#01060c',
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  // src/partials joins these globs when E005 creates it (whichever of E005 and F001 lands second).
  // Tailwind reads every word of these files, comments and identifiers included, so it also
  // emits utilities no element uses yet (.hidden, .table, .collapse, .!block from a JavaScript
  // `!block`, ...). They follow the legacy CSS in the cascade, so a legacy class of the same
  // name would lose to them: tests/unit/ui-flowbite-pro-build.test.mjs refuses any class that
  // both the legacy CSS and the compiled Tailwind define.
  //
  // The five components src/js/ui/flowbite.js bundles add classes at run time from their own
  // source (the drawer backdrop's bg-gray-900/50, its placement and overflow-hidden classes, the
  // tooltip's opacity-0/100, the tabs' active and inactive classes), so the one file of each
  // that holds them is scanned too: exactly those five, so modal, datepicker and the other
  // components' classes stay out. package-lock.json pins these files, so the source digest,
  // which reads tailwind.config.cjs and the lock, still covers them. The build test reads every
  // class they add and requires it in dist (review #253, R-1).
  content: {
    relative: true,
    files: [
      './src/index.html',
      './src/js/**/*.js',
      './node_modules/flowbite/lib/esm/components/{drawer,dropdown,collapse,tooltip,tabs}/index.js',
    ],
  },
  darkMode: ['variant', '&:not(:where([data-theme="light"], [data-theme="light"] *))'],
  // Classes the Pro shell's script toggles (sidebar collapse and the dropdown/backdrop states):
  // they never appear literally in the markup it starts from.
  safelist: [
    'w-64', 'w-1/2', 'rounded-l-lg', 'rounded-r-lg', 'bg-gray-200', 'grid-cols-4', 'grid-cols-7',
    'h-6', 'leading-6', 'h-9', 'leading-9', 'shadow-lg', 'lg:w-16', 'lg:ml-16', 'lg:hidden',
    'lg:absolute', 'pl-11', 'px-4', 'space-x-4',
  ],
  theme: {
    extend: {
      colors: {
        primary: PRIMARY,
        gray: GRAY,
      },
      fontFamily: {
        sans: ['Inter', ...SYSTEM_SANS],
        body: ['Inter', ...SYSTEM_SANS],
        mono: SYSTEM_MONO,
      },
      transitionProperty: {
        width: 'width',
      },
    },
  },
  plugins: [require('flowbite/plugin')({ forms: true })],
};

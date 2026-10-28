// Tailwind for OSCILLA (ADR 0061, issue F001): compiled at build time by scripts/build.mjs
// through Tailwind's PostCSS API from src/styles/tailwind.css, and emitted after the legacy CSS
// in the one <style> of dist/index.html. Nothing is fetched at run time.
//
// The theme is the Flowbite Pro admin dashboard's (the flowbite-pro reference, section 0):
//   - primary is the Tailwind blue scale, surfaces use the gray palette;
//   - transitionProperty width, which the sidebar's transition-width needs;
//   - Inter first in the sans stack, then the system stack of src/styles/tokens.css. No font is
//     downloaded: Inter applies only where it is installed.
// darkMode follows OSCILLA's own two-state theme (data-theme="dark" | "light" on <html>), so the
// dark: variant matches [data-theme="dark"] and never the media query. The flowbite plugin's
// own dark rules hard-code a .dark ancestor instead; scripts/build.mjs rewrites it to
// [data-theme="dark"] (darkThemeSelector, scripts/build-config.mjs), as OSCILLA never sets
// class="dark".
//
// Preflight is off and the flowbite plugin runs with forms: false: its form base styles restyle
// every input, select, checkbox, radio and range by element selector, so the legacy interface
// would no longer render as before. F002 turns them on with the migration.
const colors = require('tailwindcss/colors');

const SYSTEM_SANS = ['system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto',
  'sans-serif'];
const SYSTEM_MONO = ['ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'];

/** @type {import('tailwindcss').Config} */
module.exports = {
  // src/partials joins these globs when E005 creates it (whichever of E005 and F001 lands second).
  // Tailwind reads every word of these files, comments and identifiers included, so it also
  // emits utilities no element uses yet (.hidden, .table, .collapse, .!block from a JavaScript
  // `!block`, ...). They follow the legacy CSS in the cascade, so a legacy class of the same
  // name would lose to them: tests/unit/ui-flowbite-pro-build.test.mjs refuses any class that
  // both the legacy CSS and the compiled Tailwind define.
  content: {
    relative: true,
    files: ['./src/index.html', './src/js/**/*.js'],
  },
  darkMode: ['selector', '[data-theme="dark"]'],
  corePlugins: {
    preflight: false,
  },
  // Classes the Pro shell's script toggles (sidebar collapse and the dropdown/backdrop states):
  // they never appear literally in the markup it starts from.
  safelist: [
    'w-64', 'w-1/2', 'rounded-l-lg', 'rounded-r-lg', 'bg-gray-200', 'grid-cols-4', 'grid-cols-7',
    'h-6', 'leading-6', 'h-9', 'leading-9', 'shadow-lg', 'bg-opacity-50', 'dark:bg-opacity-80',
    'lg:w-16', 'lg:ml-16', 'lg:hidden', 'lg:absolute', 'pl-11', 'px-4', 'space-x-4',
  ],
  theme: {
    extend: {
      colors: {
        primary: colors.blue,
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
  plugins: [require('flowbite/plugin')({ forms: false })],
};

// The Flowbite Pro class lists the page's markup repeats, named once (owner, 2026-11-03: reused,
// DRY). A surface binds one through Alpine (the :class binding PRO.btnSecondary) instead of
// repeating the list in src/index.html, which keeps the Pro migration from turning the
// legacy-debt ratchet into a size ratchet. Tailwind compiles these because its content globs read src/js/**/*.js.
const BTN = 'inline-flex items-center justify-center px-3 text-sm font-medium rounded-lg '
  + 'min-h-9 [@media(pointer:coarse)]:min-h-11 focus:outline-none focus:ring-4';
// Pro's extra-small size, for a dense toolbar whose other controls are 24 px (the Studio
// timeline's): 24 px on a fine pointer, still 44x44 on a coarse one (a short label such as Tap
// was 39 px wide at 768x1024 touch, tests/browser/layout.cjs).
const BTN_XS = 'inline-flex items-center justify-center px-2 text-xs font-medium rounded-lg '
  + 'min-h-6 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 '
  + 'focus:outline-none focus:ring-4';
// The one Pro page frame (PRO_STRUCTURE.page of scripts/ui-flowbite-pro-measure.mjs).
const PAGE = 'px-4 pt-6';
// Below md the frame's top is 8 px, as <main>'s was before F002: a phone's first screen keeps
// its controls (the Playground's HOLD above the fold at 375 x 667, qa safety-notice).
const PHONE_TOP = 'max-md:!pt-2';
const SECONDARY = 'text-gray-900 bg-white border border-gray-200 hover:bg-gray-100 '
  + 'hover:text-primary-700 focus:ring-gray-100 dark:bg-gray-800 dark:text-gray-400 '
  + 'dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 dark:focus:ring-gray-700';

export const PRO = Object.freeze({
  /** Pro primary button (white on primary-700, 4.5:1 in both themes). */
  btnPrimary: `${BTN} text-white bg-primary-700 hover:bg-primary-800 focus:ring-primary-300 `
    + 'disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-700 '
    + 'dark:hover:bg-primary-800 dark:focus:ring-primary-800',
  /** Pro secondary (alternative) button. */
  btnSecondary: `${BTN} ${SECONDARY}`,
  /** Pro info alert, dismissible (K246: the Synth's insert notice). */
  alertInfo: 'flex items-start gap-3 p-4 mb-3 text-sm rounded-lg text-primary-800 bg-primary-50 '
    + 'dark:bg-gray-800 dark:text-primary-400',
  /** The alert's close button: 32 px, 44 px under a coarse pointer. */
  alertClose: 'ms-auto -mx-1.5 -my-1.5 inline-flex shrink-0 items-center justify-center w-8 h-8 '
    + '[@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11 p-1.5 rounded-lg '
    + 'text-primary-500 bg-primary-50 hover:bg-primary-200 focus:outline-none focus:ring-2 '
    + 'focus:ring-primary-400 dark:bg-gray-800 dark:text-primary-400 dark:hover:bg-gray-700',
  /** Pro dropdown panel (absolute under its button; the caller adds left-0 or right-0). */
  menu: 'absolute z-50 py-1 mt-2 bg-white rounded-lg shadow-lg w-72 top-full dark:bg-gray-700',
  /** Pro dropdown item, 44 px tall. */
  menuItem: 'flex items-center w-full px-4 py-2 text-sm text-left text-gray-700 min-h-11 '
    + 'hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-600 dark:hover:text-white',
  /** Pro secondary button, extra small (a 24 px toolbar; 44x44 on a coarse pointer). */
  btnSecondaryXs: `${BTN_XS} ${SECONDARY}`,
  /** Pro text link, 44 px tall on a coarse pointer. Dark text is primary-400: primary-500 is
   *  3.99:1 on a dark card, under WCAG AA 4.5:1 (U103, found by E054's axe pass). */
  link: 'inline-flex items-center text-sm font-medium min-h-9 [@media(pointer:coarse)]:min-h-11 '
    + 'text-primary-700 hover:underline dark:text-primary-400',
  /** A Pro card in a list or grid. */
  card: 'flex flex-col justify-between gap-3 p-4 bg-white border rounded-lg shadow-sm '
    + 'dark:bg-gray-800',
  /** The resting border of a card, and the border of the current one. */
  cardIdle: 'border-gray-200 dark:border-gray-700',
  cardCurrent: 'border-primary-600 dark:border-primary-500',
  /** Pro underline tab: the base, the selected and the resting state. */
  tab: 'inline-block px-4 border-b-2 rounded-t-lg min-h-11',
  tabOn: 'text-primary-700 border-primary-700 dark:text-primary-500 dark:border-primary-500',
  tabOff: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 '
    + 'dark:text-gray-400 dark:hover:text-gray-300',
  /** The one Pro page frame every workspace stands in (owner decision Q110): a view of its own
   *  binds PRO.pageView on its root through :class, where the Pro measure reads it; <main> carries
   *  it for a workspace whose panels stand in its grid (shell.js mainFrameOf). The page's
   *  visible title is the page header's alone. */
  page: PAGE,
  /** The frame with its bottom gutter and the phone's 8 px top: what every view of its own
   *  binds (the Synth, whose bottom keeps the docked keys' band, binds PRO.pageDocked). */
  pageView: `${PAGE} pb-6 ${PHONE_TOP}`,
  /** The Studio's frame: an editor that fills the viewport keeps an 8 px gutter on a phone, so
   *  its 44 px controls fit (the step grid's eight steps at 390 px, the graph's view controls
   *  at 320 px) and its header actions stay clear of the docked keys' handle at 375 px. */
  pageEditor: `${PAGE} pb-6 max-md:!px-2 ${PHONE_TOP}`,
  /** The Synth's frame: the docked keys play it, so on a phone its top is 12 px and its insert
   *  alert stays above the dock at 320 px (U108, oscilla-c3's Q090 criterion). */
  pageDocked: `${PAGE} max-md:!pt-3`,
});

/** The Alpine part: PRO for the markup's :class bindings. */
export function proClassesPart() {
  return { PRO };
}

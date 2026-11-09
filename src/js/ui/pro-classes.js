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
  /** Pro secondary button, extra small (a 24 px toolbar; 44x44 on a coarse pointer). */
  btnSecondaryXs: `${BTN_XS} ${SECONDARY}`,
  /** Pro text link, 44 px tall on a coarse pointer. */
  link: 'inline-flex items-center text-sm font-medium min-h-9 [@media(pointer:coarse)]:min-h-11 '
    + 'text-primary-700 hover:underline dark:text-primary-500',
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
  /** A page's heading. */
  pageTitle: 'mb-4 text-xl font-semibold text-gray-900 sm:text-2xl dark:text-white',
});

/** The Alpine part: PRO for the markup's :class bindings. */
export function proClassesPart() {
  return { PRO };
}

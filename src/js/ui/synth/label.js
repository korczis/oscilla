// The synth-theme layer's text (plan F013, W1): a module plate's labels, values and notes in
// one place, so every surface that takes the layer prints the same type. Text is never smaller
// than 12 px (text-xs) on any breakpoint: the floor the phone check holds (V634, V636). The
// colours are Pro greys chosen for the plate gradient (surface-3 to surface-1): gray-600 is
// 6.2:1 on its light top and gray-400 5.8:1 or more on the dark one (4.5:1 for small text).
//
//   LABEL   a control's label, uppercase and tracked
//   VALUE   a control's value, tabular numerals
//   NOTE    a plate's note and the module's display name
//   CHIP    a value the panel fixes, as a quiet chip
//   BTN     a panel's outline button (Remove a cable, Patch the pad): Pro's outline style on its
//           own surface, so the browser's default grey never shows (2.10:1 in dark before)

export const LABEL = 'text-xs font-semibold uppercase tracking-wide text-gray-600 '
  + 'dark:text-gray-400';
export const VALUE = 'font-mono text-xs tabular-nums text-gray-900 dark:text-white';
export const NOTE = 'text-xs text-gray-600 dark:text-gray-400';
export const CHIP = 'rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 '
  + 'dark:text-gray-300';
export const BTN = 'rounded-lg px-3 h-11 text-xs font-medium text-primary-700 bg-white '
  + 'border border-solid border-primary-600 hover:bg-primary-50 focus:outline-none '
  + 'focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-gray-800 dark:text-primary-400 '
  + 'dark:hover:bg-gray-700';

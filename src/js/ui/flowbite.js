// Flowbite's interactive components (ADR 0061, issue F001), bundled into the app script. ADR
// 0061 and its rule arrive with #250, which lands on main before this file does. Only
// the five the Pro shell uses are imported: drawer (the sidebar), dropdown (navbar menus),
// collapse (sidebar groups), tooltip and tabs. Each module registers its data-* attribute API
// (data-drawer-target, data-dropdown-toggle, data-collapse-toggle, data-tooltip-target,
// data-tabs-toggle); nothing else of flowbite enters the bundle, so modal, carousel, datepicker
// and the rest stay out.
//
// The components read the DOM once, when initialised, so they start after Alpine has rendered:
// on 'alpine:initialized', which Alpine.start() dispatches once its first pass over the
// document is done. An element is driven either by Alpine state or by a data-*-toggle
// attribute, never both (issue F001, item (4)); the check that refuses an element with both
// arrives with item (8), in tests/unit/ui-flowbite-pro.test.mjs after #250.
//
// What the modules leave on window: each imported module assigns its class and initialiser
// (window.Collapse, Drawer, Dropdown, Tabs, Tooltip and initCollapses, initDrawers,
// initDropdowns, initTabs, initTooltips) and the shared registry window.FlowbiteInstances. They
// are flowbite's own surface, not part of window.OSCILLA.
//
// The components start once. Markup rendered later (x-if, x-for, the Studio's DOM builders)
// gets no instance until initFlowbite() runs again over it; F002 decides where that happens.
import { initCollapses } from 'flowbite/lib/esm/components/collapse';
import { initDrawers } from 'flowbite/lib/esm/components/drawer';
import { initDropdowns } from 'flowbite/lib/esm/components/dropdown';
import { initTabs } from 'flowbite/lib/esm/components/tabs';
import { initTooltips } from 'flowbite/lib/esm/components/tooltip';

/** The initialisers of the components the shell uses, in the order they run. */
export const FLOWBITE_COMPONENTS = Object.freeze({
  drawer: initDrawers,
  dropdown: initDropdowns,
  collapse: initCollapses,
  tooltip: initTooltips,
  tabs: initTabs,
});

/** Initialise every component of FLOWBITE_COMPONENTS on the current document. */
export function initFlowbite() {
  for (const init of Object.values(FLOWBITE_COMPONENTS)) init();
}

/**
 * Initialise the components once Alpine has rendered. Call before Alpine.start().
 * @param {Document} [doc]
 */
export function startFlowbiteAfterAlpine(doc = document) {
  doc.addEventListener('alpine:initialized', initFlowbite, { once: true });
}

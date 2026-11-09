// The instrument kind declarations (plan issue W001): one defineKind declaration per kind of
// kinds.js that has a view, each added in the slice of its first consumer (W001's 2026-11-07
// amendment). The list tests/unit/ui-kinds.test.mjs holds to the contract. No runtime module
// imports it (rule 5: no module interprets a declaration; each view handles its own events).
//
//   KIND_DECLARATIONS   [frozen kind declaration], one per kind, in kind order

import stepGrid from './step-grid.js';

export const KIND_DECLARATIONS = Object.freeze([stepGrid]);

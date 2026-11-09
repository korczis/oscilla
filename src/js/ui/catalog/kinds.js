// The closed list of component kinds of the UI catalogue (plan issue G001, ADR 0081 decision 3).
// Pure constants: a kind is added here only together with its interface and the contract test
// that every declaration of the kind passes. An instrument kind (plan issue W001) is a name of
// this same list: its interface is one defineKind declaration in kinds/ (kind.js), held by
// tests/unit/ui-kinds.test.mjs, and each joins here in the slice of its first consumer.
//
//   KINDS                  every kind a declaration may name
//   STATE_NONE_KINDS       the kinds that may own no value ({ none: '<reason>' } as their state)
//   EFFECT_REQUIRED_KINDS  the kinds that must say what activating them does when they own none
//   EFFECT_TYPES           the keys an effect may have, exactly one per effect

export const KINDS = Object.freeze(['param', 'switch', 'choice', 'transport', 'action',
  'readout', 'empty', 'open', 'fullscreen', 'panel', 'workspace', 'node-face', 'edge', 'clip',
  'step-grid']);

export const STATE_NONE_KINDS = Object.freeze(['action', 'open', 'readout', 'panel',
  'workspace']);

export const EFFECT_REQUIRED_KINDS = Object.freeze(['action', 'open']);

export const EFFECT_TYPES = Object.freeze(['route', 'dialog', 'download', 'command', 'focus']);

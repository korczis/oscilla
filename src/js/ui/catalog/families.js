// The control families of the UI catalogue (plan issues G021-G026, milestone M123; the owner's
// order of 2026-11-04 and 2026-11-05: one parametrized implementation per family, reused, no
// parallel ones). Pure constants.
//
// A family has ONE model module (its state, value mapping, keys, ARIA and feel) and any number
// of skins that draw that model (the synth layer's hardware look, the Pro look). A skin imports
// the model and holds no value logic of its own. `model: null` is a family whose one model is
// still to be chosen by its slice; until then every implementer of it is a listed duplicate.
//
// Every module that implements a family says so in a marker comment among its first lines:
//   // ui-family: <id> model
//   // ui-family: <id> skin <name>
//   // ui-family: <id> not: <reason>    a signature match that is not the family (a domain view)
// scripts/ui-catalog/families.mjs finds the implementers by those markers and by each family's
// source signature, so a module cannot leave a family by omitting the marker;
// tests/unit/ui-families.test.mjs refuses a second model, an unmarked implementer or a skin that
// redoes the model's value logic, unless tests/unit/ui-families-baseline.json lists it with the
// slice that removes it (the baseline only shrinks).

export const FAMILIES = Object.freeze({
  knob: Object.freeze({ slice: 'G022', model: 'src/js/synth/view/knob.js',
    what: 'a rotary value control: value to angle, drag, keys, typed entry, valuetext' }),
  slider: Object.freeze({ slice: 'G023', model: null,
    what: 'a linear value control: value to track position and fill' }),
  switch: Object.freeze({ slice: 'G023', model: null,
    what: 'an on/off switch or a radio group of options' }),
  'patch-bay': Object.freeze({ slice: 'G024', model: 'src/js/ui/patch/patch-bay.js',
    what: 'jacks and the cables between them' }),
  keyboard: Object.freeze({ slice: 'G025', model: 'src/js/midi/keyboard.js',
    what: 'the piano keys: key layout, held notes, octave and velocity' }),
  'app-shell': Object.freeze({ slice: 'G026', model: 'src/js/ui/shell.js',
    what: 'the navbar, the sidebar navigation and the page header' }),
  // The modelers (the owner's order of 2026-11-05: one ADSR envelope modeler and one filter
  // modeler, bus-connected into the Studio, the Synth, the sequencer and the labs). The model is
  // the law the sound follows, so every curve drawn of it is the curve that plays.
  envelope: Object.freeze({ slice: 'G027', model: 'src/js/audio/envelope.js',
    what: 'the ADSR curve law the voice schedules, and every drawing or editor of it' }),
  'filter-response': Object.freeze({ slice: 'G028', model: 'src/js/audio/filters.js',
    what: 'the filter stage and its magnitude response, live or computed' }),
});

export const FAMILY_IDS = Object.freeze(Object.keys(FAMILIES));

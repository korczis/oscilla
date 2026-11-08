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
//   // ui-family: <id> part <name>      a pure helper of the model (the model imports it)
//   // ui-family: <id> not: <reason>    a signature match that is not the family (a domain view)
// scripts/ui-catalog/families.mjs finds the implementers by those markers and by each family's
// source signature, so a module cannot leave a family by omitting the marker;
// tests/unit/ui-families.test.mjs refuses a second model, an unmarked implementer or a skin that
// redoes the model's value logic, unless tests/unit/ui-families-baseline.json lists it with the
// slice that removes it (the baseline only shrinks).

export const FAMILIES = Object.freeze({
  knob: Object.freeze({ slice: 'G022', model: 'src/js/ui/synth/knob.js',
    what: 'otočný ovladač hodnoty: hodnota na úhel, tažení, klávesy, zadání číslem, '
      + 'valuetext' }),
  slider: Object.freeze({ slice: 'G023', model: null,
    what: 'lineární ovladač hodnoty: hodnota na polohu a výplň dráhy' }),
  switch: Object.freeze({ slice: 'G023', model: null,
    what: 'vypínač nebo skupina přepínačů s volbami' }),
  'patch-bay': Object.freeze({ slice: 'G024', model: 'src/js/ui/patch/patch-bay.js',
    what: 'konektory a kabely mezi nimi' }),
  keyboard: Object.freeze({ slice: 'G025', model: 'src/js/midi/keyboard.js',
    what: 'klávesy piana: rozložení kláves, držené noty, oktáva a dynamika' }),
  'app-shell': Object.freeze({ slice: 'G026', model: 'src/js/ui/shell.js',
    what: 'horní lišta, boční navigace a záhlaví stránky' }),
  // The modelers (the owner's order of 2026-11-05: one ADSR envelope modeler and one filter
  // modeler, bus-connected into the Studio, the Synth, the sequencer and the labs). The model is
  // the law the sound follows, so every curve drawn of it is the curve that plays.
  envelope: Object.freeze({ slice: 'G027', model: 'src/js/audio/envelope.js',
    what: 'zákon křivky ADSR, který hlas plánuje, a každé její vykreslení či editor' }),
  'filter-response': Object.freeze({ slice: 'G028', model: 'src/js/audio/filters.js',
    what: 'filtrový stupeň a jeho amplitudová odezva, živá nebo vypočtená' }),
  // The oscilla-pad (the owner's order of 2026-11-05: no copy of a hardware pad): one
  // two-parameter surface, OSCILLA's own, whose looks are skins of one model.
  pad: Object.freeze({ slice: 'G030', model: 'src/js/ui/kinds/xy-pad.js',
    what: 'oscilla-pad: dva deklarované parametry na jedné ploše, jeho ukazatel a klávesy' }),
});

export const FAMILY_IDS = Object.freeze(Object.keys(FAMILIES));

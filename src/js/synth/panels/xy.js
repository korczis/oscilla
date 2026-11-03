// The XY tab of the Synth (plan K097): the XY pad as a module of the Synth panel declaration
// (panels/semi-mono.js composes it), so its face, jacks, cables, links and Restore module come
// from the same generated code as every other module. It has no normals: a cable from its Pitch
// and Gate into the voice replaces the keyboard's (an XY preset patches them, synth/xy.js), and
// its Y drives the timbre target its cable names.

export const XY_TAB = Object.freeze({ id: 'xy', label: 'XY', title: 'XY performance pad',
  description: 'Touch the pad to play the panel: X picks a step of the scale, Y drives the '
    + 'timbre control its cable feeds, and the gate is open while the pad is touched. An XY '
    + 'preset is a panel patch with its scale.' });

export const XY_MODULE = Object.freeze({ id: 'xy', label: 'XY PAD', node: 'xy-pad',
  tab: XY_TAB.id });

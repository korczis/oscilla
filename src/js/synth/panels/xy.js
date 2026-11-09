// The XY tab of the Synth (plan K097, K183): the XY pad as a module of the Synth panel
// declaration (panels/semi-mono.js composes it), so its face, jacks, cables, links and Restore
// module come from the same generated code as every other module. It has no normals. The pad is
// one more note input of the keys (K183, midi/notes.js source 'kbd-xy'): a touch presses the
// scale note under X, so no Pitch or Gate cable is needed and the keyboard's normals keep
// sounding. Its X and Y are performance controls (`adds`): a cable from them adds to what is
// normalled at the jack it feeds rather than replacing it (synth/normals.js), so the default Y
// cable into LPF Cutoff (synth/xy.js xyInsertAction) leaves the filter's EG 2 and MG normals and
// their amount knobs as they were. A cable from its Pitch or Gate replaces the keyboard's, as
// any cable does (no built-in XY preset patches them, K183 review F3).

export const XY_TAB = Object.freeze({ id: 'xy', label: 'XY', title: 'XY performance pad',
  description: 'Touch the pad to play the voice the keys play: X picks a note of the scale, Y '
    + 'drives the timbre control its cable feeds, and the note holds while the pad is touched. '
    + 'An XY preset is a panel patch with its scale.' });

export const XY_MODULE = Object.freeze({ id: 'xy', label: 'XY PAD', node: 'xy-pad',
  tab: XY_TAB.id, adds: Object.freeze(['x', 'y']) });

/**
 * Pad L of the Synth face (plan K220, Q103): a second xy-pad node of the panel, on the Panel tab
 * under the face, that plays no notes. Its X and Y are CONTROL outputs normalled to the LPF and
 * HPF cutoffs (panels/semi-mono.js n25, n26; log, unipolar), so a touch sweeps a band and a cable
 * from or into either jack replaces the normal as any cable does (project.typed-ports). Its scale
 * parameters are fixed (a parameter pad has no scale): its card shows its jacks only. Resonance
 * waits for K232 (a low-pass Q is no CV target yet). It is `optional`: a performance surface
 * whose absence leaves every signal path playing (the cutoffs keep their knobs and the keys'
 * normals), so a document without it, one made before K220 or one it was removed from, has no
 * PAD L (the PADY card offers to add it) and is never told a module was removed (review
 * C1-K220-1 of oscilla-c1: the graph cannot tell the two apart).
 */
export const XYL_MODULE = Object.freeze({ id: 'xyl', label: 'PAD L', node: 'xy-pad',
  tab: 'panel', optional: true, fixed: Object.freeze({ mode: 'chromatic', key: 'C', octave: 3, span: 1,
    glide: 0 }) });

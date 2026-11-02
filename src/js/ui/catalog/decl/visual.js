// Declarations: the visual components (rule project.visual-components-framed). Each one is a
// chart, scope, curve, meter, canvas or drawing, declared `visual: true`, so the one frame
// (src/js/ui/catalog/frame.js) wraps the element whose data-osc is its id: full screen, a menu
// when it declares fullscreenControls, and a size class from its own box. The runtime imports
// this file alone (catalog/visuals.js), so the page bundles the visual part of the catalogue and
// not the rest. Trace: scripts/ui-catalog/trace/visual.mjs (and the trace file of the family
// that already owned an id: keyboard, studio-compact, synth).

import { defineComponent } from '../define.js';

const visual = (id, label, docs, extra = {}) => defineComponent({ id, kind: 'panel', label,
  docs, state: { none: 'a framed view that draws a signal and owns no value' }, visual: true,
  ...extra });

export default [
  visual('analysis', 'Signal analysis', 'Draws the waveform, spectrum, spectrogram, harmonics '
    + 'and signal path of the output, one tab at a time.', {
    fullscreenControls: [{
      id: 'analysis.fsPause',
      kind: 'switch',
      label: 'Pause animation',
      docs: 'Pauses or resumes the animation of the analysis views while they fill the screen.',
      state: 'ui.vizPaused',
    }],
  }),
  visual('spectrogram', 'Spectrogram', 'Scrolls the live spectrogram of the output on the '
    + 'Analyzer, time against frequency.'),
  visual('mic', 'Microphone Analyzer', 'Draws the microphone spectrum against the generator '
    + 'target, with its peaks.'),
  visual('measure.resultView', 'Measurement result', 'Draws the measured frequency response, '
    + 'impulse response and RTA of the run shown.'),
  visual('seq.panel', 'Pattern Sequencer', 'Draws the pattern timeline with its ruler, '
    + 'blocks and playhead.'),
  visual('filter.lab', 'Filter Lab', 'Draws the magnitude response of the filter the engine '
    + 'computes, beside its controls.'),
  visual('envelope', 'Envelope (ADSR)', 'Draws the attack, decay, sustain and release '
    + 'envelope as a draggable graph.'),
  visual('additive', 'Additive Synthesis', 'Draws the amplitudes of the first ten harmonics as '
    + 'editable bars.'),
  visual('phase', 'Phase & Stereo', 'Draws signals A and B and their Lissajous figure.'),
  visual('bio', 'Bioacoustics', 'Draws the approximate hearing ranges of species against the '
    + 'tone that plays.'),
  visual('exp.detailView', 'Experiment', 'Draws the frequency response of the saved experiment '
    + 'that is open.'),
  visual('exp.compareView', 'Compare', 'Draws the overlay, difference and impulse responses of '
    + 'two compared experiments.'),
  defineComponent({
    id: 'keyboard',
    kind: 'panel',
    label: 'Keyboard',
    docs: 'Holds the computer-keyboard controls and the on-screen keys of the view in sight.',
    state: { none: 'the panel holds the keys and owns no value' },
    visual: true,
  }),
  defineComponent({
    id: 'studio.compact',
    kind: 'panel',
    label: 'Studio',
    docs: 'Shows the open Studio document beside the instrument, with its own transport.',
    state: { none: 'the panel shows the document and owns no value' },
    visual: true,
  }),
  defineComponent({
    id: 'synth.bay',
    kind: 'panel',
    label: 'Patch bay',
    docs: 'Groups the jacks, the connect list and the cables of the voice.',
    state: { none: 'the section groups the patching views and owns no value' },
    in: 'synth.panel',
    visual: true,
  }),
  defineComponent({
    id: 'peeper',
    kind: 'panel',
    label: 'Peeper',
    docs: 'Watches one tap point of the signal at any time, on every page, like a small scope.',
    state: 'ui.peeper',
    visual: true,
    fullscreenControls: [{
      id: 'peeper.fsWindow',
      kind: 'choice',
      label: 'Window',
      docs: 'Steps the time window the peeper draws through 5, 10, 20 and 50 ms.',
      state: 'ui.peeper',
    }],
  }),
];

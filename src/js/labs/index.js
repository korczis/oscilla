// Mount every lab controller and chart panel on the OSCILLA shell.
//
// Engine adapter (injected; the engine is not part of this module):
//   getContext()          → AudioContext | null
//   getSampleRate()       → number | null
//   getAnalyser()         → AnalyserNode | null   main output analyser
//   getMicAnalyser()      → AnalyserNode | null   (optional; the mic lab makes its own otherwise)
//   requestedFrequency()  → Hz | null
//   isPlaying()           → boolean
//   onChange(cb)          → called when any of the above changes; may return an unsubscribe
// Optional extras the controllers use when present:
//   getDestination()      → AudioNode the sequencer plays into (default ctx.destination)
//   getStereoRouter()     → audio/stereo.js router while stereo plays (Phase & Stereo live data)
//   ensureContext()       → Promise<AudioContext> created in the current user gesture (mic)
//   attachMicrophone(stream) → AnalyserNode, detachMicrophone()   engine-owned mic graph
//   getA4()               → A4 tuning in Hz (octave-C markers of the spectrum; default 440)
//
// Controllers share state with Alpine only through plain objects and the shell's `osc:ui`
// events; each exposes { update(state), dispose() } plus its own API.

import { mount as mountAnalysis } from './analysis.js';
import { mount as mountFilter } from './filter-lab.js';
import { mount as mountEnvelope } from './envelope.js';
import { mount as mountAdditive } from './additive.js';
import { mount as mountPhase } from './phase-stereo.js';
import { mount as mountBio } from './bioacoustics.js';
import { mount as mountMic } from './mic-analyzer.js';
import { mount as mountSequencer } from './sequencer-panel.js';
import { mount as mountSpectrogram } from '../charts/spectrogram-panel.js';
import { mount as mountDevice } from '../charts/device-panel.js';

/**
 * mountLabs(rootEl, adapter, { onSelectRange }) → { analysis, spectrogram, device, mic, filter,
 *   envelope, additive, phase, bio, sequencer, update(state), dispose() }
 * update(state) forwards state[name] to each controller's update().
 */
export function mountLabs(rootEl, adapter, options = {}) {
  const labs = {
    analysis: mountAnalysis(rootEl, adapter),
    spectrogram: mountSpectrogram(rootEl, adapter),
    device: mountDevice(rootEl, adapter),
    mic: mountMic(rootEl, adapter),
    filter: mountFilter(rootEl, adapter),
    envelope: mountEnvelope(rootEl, adapter),
    additive: mountAdditive(rootEl, adapter),
    phase: mountPhase(rootEl, adapter),
    bio: mountBio(rootEl, adapter, { onSelectRange: options.onSelectRange }),
    sequencer: mountSequencer(rootEl, adapter),
  };
  return {
    ...labs,
    update(state = {}) {
      for (const [name, lab] of Object.entries(labs)) {
        if (state[name] !== undefined) lab.update(state[name]);
      }
    },
    dispose() {
      for (const lab of Object.values(labs)) lab.dispose();
    },
  };
}

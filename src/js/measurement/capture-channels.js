// T039 (307.yaml#R5): the capture recorder takes every channel of its input. The recorder
// node's options and the capture window's per-channel writer; pure, no Web Audio here (split
// from capture.js, its source-size cap; capture.js re-exports both).

/**
 * The recorder node's options (T039): it takes every channel of the input ('max', no mixing)
 * and its processor makes the analysed mono downmix itself, by the speakers rules the node used
 * to apply, so a clip on one channel of a stereo input is checked on that channel.
 */
export const CAPTURE_NODE_OPTIONS = Object.freeze({
  numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: Object.freeze([1]),
  channelCount: 1, channelCountMode: 'max', channelInterpretation: 'speakers',
});


/**
 * Writes a chunk's per-channel samples into a capture window (T039): `w.channels` is one
 * array per input channel, made at the first multichannel chunk, the frames placed as
 * writeWindow places the downmix. A chunk with no channels, or with another channel count,
 * than the window already holds drops the record (null): the window is judged on its downmix.
 */
export function writeCaptureChannels(w, frame, channels) {
  if (w.channels === null) return;
  const k = channels ? channels.length : 0;
  if (w.channels === undefined) {
    if (!k) { w.channels = null; return; }
    w.channels = Array.from({ length: k }, () => new Float32Array(w.frames));
  } else if (w.channels.length !== k) {
    w.channels = null;
    return;
  }
  const a = Math.max(frame, w.startFrame);
  const b = Math.min(frame + channels[0].length, w.endFrame);
  if (b <= a) return;
  for (let c = 0; c < k; c++) {
    w.channels[c].set(channels[c].subarray(a - frame, b - frame), a - w.startFrame);
  }
}

/**
 * The Web Audio "speakers" downmix to mono of `len` frames of the channels `x` into `o`: 2
 * channels 0.5 (L + R), 4 0.25 (L + R + SL + SR), 6 (5.1) sqrt(0.5) (L + R) + C + 0.5 (SL + SR),
 * any other count channel 0 (discrete). The one copy: the worklet embeds this source and the
 * ScriptProcessor fallback calls it, so both analyse what the one-channel node made (T039).
 * Self-contained (no outer name), since its text runs in the AudioWorkletGlobalScope.
 */
export function speakersMono(x, len, o) {
  const k = x.length;
  for (let i = 0; i < len; i++) {
    o[i] = k === 2 ? 0.5 * (x[0][i] + x[1][i])
      : k === 4 ? 0.25 * (x[0][i] + x[1][i] + x[2][i] + x[3][i])
        : k === 6 ? Math.SQRT1_2 * (x[0][i] + x[1][i]) + x[2][i] + 0.5 * (x[4][i] + x[5][i])
          : x[0][i];
  }
  return o;
}

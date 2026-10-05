// Microphone acquisition for analysis only: the stream goes to its own analyser and never to the
// destination; nothing is recorded. Extracted from V1 AudioEngine.startMic/stopMic and the
// error mapping of oscillaApp.toggleMic (index.html@36f4b47), ported to index.html@a7b7a23 (a
// failed graph setup stops every track; stopping clears track handlers and disconnects the
// analyser too). Texts unchanged.
// The analysis modules (peak detector, compare, spectrogram) consume mic.analyser.

/** Shown when the microphone starts. V1: oscillaApp.toggleMic (index.html@a7b7a23) */
export const MIC_PRIVACY_NOTICE = 'Analysis only: audio is not recorded, stored or uploaded. Levels are relative, not calibrated.';

/** V1: AudioEngine.startMic (index.html@a7b7a23) */
export const MIC_UNAVAILABLE_TEXT = 'Microphone input is not available here (it needs HTTPS or a local file in a supporting browser).';

/** Whether getUserMedia exists (insecure contexts and some file:// browsers lack it). */
export function hasMicrophoneApi(navigatorLike) {
  return !!(navigatorLike && navigatorLike.mediaDevices
    && typeof navigatorLike.mediaDevices.getUserMedia === 'function');
}

/** Ask for the raw microphone stream. V1: AudioEngine.startMic (index.html@a7b7a23) */
export function requestMicrophoneStream(mediaDevices) {
  return mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
}

/** Default AnalyserNode FFT size of the microphone analysis (V2 mic lab, V3 live RTA). */
export const MIC_ANALYSER_FFT_SIZE = 8192;

/**
 * Configure an AnalyserNode the way the microphone analysis uses it: fftSize (8192),
 * smoothingTimeConstant (0.6; it affects getFloatFrequencyData only, never the time-domain
 * samples), dB range −140 … 0. Returns the node. Shared by buildMicrophoneGraph and the V3
 * live-RTA input tap (measurement/capture.js openLiveTap).
 */
export function configureAnalyser(analyser, options = {}) {
  analyser.fftSize = options.fftSize || MIC_ANALYSER_FFT_SIZE;
  analyser.smoothingTimeConstant = options.smoothingTimeConstant != null
    ? options.smoothingTimeConstant : 0.6;
  analyser.minDecibels = -140;
  analyser.maxDecibels = 0;
  return analyser;
}

/**
 * The analysis graph of an open stream on ctx: { stream, source, analyser, freqData }. Throws
 * if the graph cannot be built (the caller stops the tracks).
 * V1: AudioEngine.startMic, graph part (index.html@a7b7a23)
 * V2 options: { track(node) (engine accounting), fftSize (8192), smoothingTimeConstant (0.6) }.
 */
export function buildMicrophoneGraph(ctx, stream, options = {}) {
  const track = options.track || ((n) => n);
  const source = track(ctx.createMediaStreamSource(stream));
  const analyser = configureAnalyser(track(ctx.createAnalyser()), options);
  source.connect(analyser); // analysis only: never connected to the destination, never recorded
  return { stream, source, analyser, freqData: new Float32Array(analyser.frequencyBinCount) };
}

/** Stop every track of a stream, never throwing. V1: AudioEngine.startMic failure path */
export function stopStreamTracks(stream) {
  for (const t of stream.getTracks()) {
    t.onended = null;
    try { t.stop(); } catch (e) { /* ignore */ }
  }
}

/**
 * Open the microphone into an analyser on ctx: { stream, source, analyser, freqData }. If the
 * graph cannot be built, every track is stopped before the error propagates.
 */
export async function openMicrophone(ctx, mediaDevices) {
  const stream = await requestMicrophoneStream(mediaDevices);
  try {
    return buildMicrophoneGraph(ctx, stream);
  } catch (e) {
    stopStreamTracks(stream);
    throw e;
  }
}

/**
 * Ask for microphone permission without keeping the input open (Studio's Allow microphone): the
 * same request as openMicrophone, whose stream's tracks are stopped at once. Resolves true;
 * rejects with the getUserMedia error (micErrorMessage gives its text). The node that needs the
 * input opens its own stream through openMicrophone when it runs.
 */
export async function requestMicrophonePermission(mediaDevices) {
  stopStreamTracks(await requestMicrophoneStream(mediaDevices));
  return true;
}

/** Stop every track and disconnect. V1: AudioEngine.stopMic (index.html@a7b7a23) */
export function closeMicrophone(mic) {
  stopStreamTracks(mic.stream);
  try { mic.source.disconnect(); } catch (e) { /* ignore */ }
  try { mic.analyser.disconnect(); } catch (e) { /* ignore */ }
}

/** User-facing text for a getUserMedia failure. V1: oscillaApp.toggleMic (index.html@a7b7a23) */
export function micErrorMessage(e) {
  const name = e && e.name;
  const msg = name === 'NotAllowedError' || name === 'SecurityError'
    ? 'Microphone permission was denied. You can allow it in the browser’s site settings.'
    : name === 'NotFoundError' ? 'No microphone was found.'
      : (e && e.message) || 'The microphone could not be opened.';
  return msg;
}

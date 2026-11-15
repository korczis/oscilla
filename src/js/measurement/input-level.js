// The level of a capture window (C033), for capture.js: the setup check's background reading
// and its probe. Pure.

/**
 * { peak, rmsDb } of a capture window (dB re digital full scale; -Infinity for digital
 * silence). `received`: the frames the window was given (98 F5); a lost block leaves zeros,
 * which would pull the RMS down, so the mean is over the frames received; none: rmsDb null.
 */
export function levelOf(samples, received = samples.length) {
  let s = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    s += v * v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  const n = Math.min(samples.length, Math.max(0, Number(received) || 0));
  if (!n) return { peak, rmsDb: null };
  const rms = Math.sqrt(s / n);
  return { peak, rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity };
}

// The probe tap API stub, mirrored from src/js/studio/probe.js of branch feat/v616-probe-tap
// (oscilla-26, 2a94dc6a, not on main yet): the same exports, names, points and behaviour, so the
// peeper is built against the contract without importing a guarded path or stacking on that
// branch. When V616 lands, the swap is ONE import line in src/js/main.js (marked there):
// `from './ui/peeper/probe-stub.js'` becomes `from './studio/probe.js'`, and this file goes.
//
//   windowSamples(windowMs, sampleRate) -> the power of two an AnalyserNode accepts (32..32768)
//   windowMsOf(window, sampleRate) -> the ms that window spans
//   createProbeStub({ sampleRate = 48000, hz = 440, budget = 4 } = {}) -> probe
//     probe.points() -> [{ id, kind, label, nodeId? }]
//     probe.tap(id, { windowMs }) -> lease { id, read(buf?), retarget(id), release() }
//       windowMs is the ONLY window option; read() returns window (samples) and the actual
//       windowMs; over `budget` leases a lease reads live: false, reason 'budget', never a frame
//     probe.active() -> { analysers, leases }
//
// Window: windowMs is the only window option. It is converted with the sample rate of the
// context to the next power of two an AnalyserNode accepts (32..32768 samples), and read()
// reports the window it chose, in samples and in ms. A view never assumes a sample rate.

/** The window, in samples, an AnalyserNode uses for `windowMs` at `sampleRate`. */
export function windowSamples(windowMs, sampleRate) {
  const want = Math.max(1, Math.ceil((Math.max(0, Number(windowMs) || 0) / 1000) * sampleRate));
  let n = 32;
  while (n < want && n < 32768) n *= 2;
  return n;
}

/** The ms a window of `window` samples spans at `sampleRate`. */
export function windowMsOf(window, sampleRate) {
  return (window / sampleRate) * 1000;
}

export const STUB_POINTS = Object.freeze([
  Object.freeze({ id: 'output:master', kind: 'audio', label: 'Output' }),
  Object.freeze({ id: 'node:osc-1/audio', kind: 'audio', label: 'Oscillator 1 · Audio',
    nodeId: 'osc-1' }),
  Object.freeze({ id: 'node:filter-1/audio', kind: 'audio', label: 'Filter 1 · Audio',
    nodeId: 'filter-1' }),
  Object.freeze({ id: 'node:lfo-1/control', kind: 'control', label: 'LFO 1 · Control',
    nodeId: 'lfo-1' }),
]);

/**
 * A probe with the contract's shape and deterministic data: every point reads a sine of `hz`
 * (the control point a tenth of it) at the injected sample rate, marked stub: true. For views
 * and their tests until createProbe lands; never wired to sound.
 */
export function createProbeStub({ sampleRate = 48000, hz = 440, budget = 4 } = {}) {
  const leases = new Set();
  const ids = new Set(STUB_POINTS.map((p) => p.id));
  let frameNo = 0;
  const probe = {
    points: () => STUB_POINTS.slice(),
    tap(id, { windowMs = 20 } = {}) {
      if (!ids.has(id)) throw new Error(`probe: no tap point ${JSON.stringify(id)}`);
      const window = windowSamples(windowMs, sampleRate);
      const lease = {
        id,
        read(buf) {
          if (!leases.has(lease)) {
            return { frame: null, sampleRate, window, windowMs: windowMsOf(window, sampleRate),
              at: null, live: false, reason: 'released', stub: true };
          }
          const frame = buf && buf.length === window ? buf : new Float32Array(window);
          const f = lease.id.endsWith('/control') ? hz / 10 : hz;
          const t0 = frameNo * window;
          for (let i = 0; i < window; i++) {
            frame[i] = Math.sin((2 * Math.PI * f * (t0 + i)) / sampleRate);
          }
          frameNo += 1;
          return { frame, sampleRate, window, windowMs: windowMsOf(window, sampleRate),
            at: ((t0 + window) / sampleRate), live: true, stub: true };
        },
        retarget(next) {
          if (!ids.has(next)) throw new Error(`probe: no tap point ${JSON.stringify(next)}`);
          lease.id = next;
          return lease;
        },
        release() { leases.delete(lease); },
      };
      if (leases.size >= budget) {
        return { ...lease, read: () => ({ frame: null, sampleRate, window,
          windowMs: windowMsOf(window, sampleRate), at: null, live: false, reason: 'budget',
          stub: true }), release() {} };
      }
      leases.add(lease);
      return lease;
    },
    active: () => ({ analysers: new Set([...leases].map((l) => l.id)).size, leases: leases.size }),
    stub: true,
  };
  return probe;
}

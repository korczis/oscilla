// The probe stub of the peeper shell (the probe tap API of V616/V621, oscilla-26, stub contract
// of 2026-11-02): createProbeStub() has exactly the documented shape of createProbe(), so the
// peeper is built against it before src/js/studio/probe.js lands, and the composition root swaps
// one for the other. points() is a fixed list; read() gives a deterministic sine at the injected
// sample rate, marked stub: true, so a view can say it is not the engine's signal.
//
//   createProbeStub({ sampleRate = 48000, hz = 440, budget = 4 } = {}) -> probe
//   probe.points() -> [{ id, kind, label, nodeId?, edgeId? }]
//   probe.tap(id, { windowMs }) -> lease { read(buf?), retarget(id), release() }
//   probe.active() -> { analysers, leases }
//   windowSamples(windowMs, sampleRate) -> the power of two an AnalyserNode accepts (32..32768)
//
// Taps on one point share one analyser (a refcount); over `budget` analysers a lease reads
// live: false, reason 'budget', never a fake frame.

export const STUB_POINTS = Object.freeze([
  Object.freeze({ id: 'output:master', kind: 'audio', label: 'Output (master)' }),
  Object.freeze({ id: 'node:osc-1/out', kind: 'audio', label: 'Oscillator 1 out',
    nodeId: 'osc-1' }),
  Object.freeze({ id: 'node:filter-1/out', kind: 'audio', label: 'Filter 1 out',
    nodeId: 'filter-1' }),
  Object.freeze({ id: 'node:env-1/out', kind: 'control', label: 'Envelope 1 out',
    nodeId: 'env-1' }),
  Object.freeze({ id: 'edge:edge-1', kind: 'audio', label: 'Cable osc-1 to filter-1',
    edgeId: 'edge-1' }),
]);

/** The power-of-two window an AnalyserNode accepts for `windowMs` at `sampleRate`. */
export function windowSamples(windowMs, sampleRate) {
  const want = Math.max(1, Math.ceil((Number(windowMs) || 0) / 1000 * sampleRate));
  let n = 32;
  while (n < want && n < 32768) n *= 2;
  return n;
}

export function createProbeStub({ sampleRate = 48000, hz = 440, budget = 4 } = {}) {
  const refs = new Map(); // point id -> lease count (one analyser per point)
  let leases = 0;
  let reads = 0;
  const known = (id) => STUB_POINTS.some((p) => p.id === id);
  const order = () => [...refs.keys()];
  const take = (id) => refs.set(id, (refs.get(id) || 0) + 1);
  const drop = (id) => {
    const n = (refs.get(id) || 0) - 1;
    if (n > 0) refs.set(id, n); else refs.delete(id);
  };

  return {
    stub: true,
    points: () => STUB_POINTS.map((p) => ({ ...p })),
    tap(id, { windowMs = 20 } = {}) {
      if (!known(id)) throw new Error(`probe: no tap point ${id}`);
      let point = id;
      let open = true;
      take(point);
      leases += 1;
      const window = windowSamples(windowMs, sampleRate);
      return {
        read(buf) {
          if (!open) return { live: false, reason: 'stopped', stub: true };
          if (order().indexOf(point) >= budget) {
            return { live: false, reason: 'budget', stub: true, sampleRate, window,
              windowMs: window / sampleRate * 1000 };
          }
          const frame = buf instanceof Float32Array && buf.length === window ? buf
            : new Float32Array(window);
          const t0 = reads * window / sampleRate;
          reads += 1;
          const amp = point.startsWith('node:env') ? 0.5 : 0.8;
          for (let i = 0; i < window; i += 1) {
            frame[i] = amp * Math.sin(2 * Math.PI * hz * (t0 + i / sampleRate));
          }
          return { frame, sampleRate, window, windowMs: window / sampleRate * 1000,
            at: t0 + window / sampleRate, live: true, stub: true };
        },
        retarget(next) {
          if (!open || next === point) return;
          if (!known(next)) throw new Error(`probe: no tap point ${next}`);
          drop(point);
          point = next;
          take(point);
        },
        release() {
          if (!open) return;
          open = false;
          drop(point);
          leases -= 1;
        },
        get point() { return point; },
      };
    },
    active: () => ({ analysers: Math.min(refs.size, budget), leases }),
  };
}

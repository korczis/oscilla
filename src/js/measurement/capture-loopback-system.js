// The synthetic system of the TEST CONTEXT digital loopback (createLoopbackIo, capture.js):
// a biquad, a gain, a delay or a custom build placed between the master chain tap and the
// recorder. Split from capture.js (its source-size cap, T039).

/** Describe and build a synthetic loopback system on ctx (TEST CONTEXT). */
export function buildLoopbackSystem(ctx, system, reg) {
  const made = [];
  const register = (n) => { made.push(n); return reg(n); };
  const out = buildSystemNodes(ctx, system, register);
  return { ...out, nodes: made };
}

function buildSystemNodes(ctx, system, register) {
  const s = system || { type: 'biquad' };
  if (s.type === 'biquad') {
    const f = register(ctx.createBiquadFilter());
    f.type = s.filter || 'lowpass';
    f.frequency.value = s.frequency != null ? s.frequency : 1000;
    f.Q.value = s.Q != null ? s.Q : Math.SQRT1_2;
    f.gain.value = s.gain != null ? s.gain : 0;
    return { input: f, output: f, node: f, describe: { type: 'biquad', filter: f.type,
      frequency: f.frequency.value, Q: f.Q.value, gain: f.gain.value } };
  }
  if (s.type === 'gain') {
    const g = register(ctx.createGain());
    g.gain.value = s.gain != null ? s.gain : 1;
    return { input: g, output: g, node: g, describe: { type: 'gain', gain: g.gain.value } };
  }
  if (s.type === 'delay') {
    const d = register(ctx.createDelay(Math.max(1, (s.delayS || 0) * 2)));
    d.delayTime.value = s.delayS || 0;
    const g = register(ctx.createGain());
    g.gain.value = s.gain != null ? s.gain : 1;
    d.connect(g);
    return { input: d, output: g, node: d, describe: { type: 'delay', delayS: s.delayS || 0,
      gain: g.gain.value } };
  }
  if (s.type === 'custom' && typeof s.build === 'function') {
    const b = s.build(ctx, register);
    return { input: b.input, output: b.output, node: b.node || null,
      describe: { type: 'custom', ...(b.describe || {}) } };
  }
  throw new TypeError(`neznámý typ smyčkového systému: ${s.type}`); // Czech: Q104 ratchet
}

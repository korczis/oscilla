// Shared helpers of the Studio node adapters (adapters/nodes.js holds the adapter contract and
// the NODE_ADAPTERS table; each category's adapters live in adapters/<category>.js, as the
// registry's node definitions live in nodes/<category>.js). Pure helpers: no node is created
// here.

/** Glide of a parameter change: the engine's live-update time constant (updateLive, τ 15 ms). */
export const PARAM_TAU_S = 0.015;

export const BIPOLAR = Object.freeze([-1, 1]);
export const UNIPOLAR = Object.freeze([0, 1]);

/** Write `value` to `param` now (immediate) or glide to it (τ PARAM_TAU_S); report w[key]. */
export function setParam(param, value, immediate, now, w, key) {
  if (immediate) param.setValueAtTime(value, now);
  else param.setTargetAtTime(value, now, PARAM_TAU_S);
  if (w) w[key] = value;
}

/** update()'s report: every key of `keys` present in `changed` acted on as `how`. */
export const did = (w, changed, keys, how) => {
  for (const k of keys) if (w && k in changed) w[k] = how;
};

/** Whether the runtime lets the adapter write parameter `key` (not driven by another owner). */
export const free = (owned, key) => !(owned && owned.has(key));

/** modTarget for a parameter with one linear AudioParam and no logarithmic input. */
export const linearOnly = (param) => (key, mapping) => (mapping === 'log'
  ? { reason: `${key} has no logarithmic modulation input` } : { param, scale: 1 });

/** A handle with no audio nodes (degraded, offline-only or analysis data). */
export function inertHandle(status, reason, info = {}) {
  return {
    inputs: {}, outputs: {}, outputRange: {},
    modTarget: (key) => ({ reason: reason || `${key} is not available` }),
    applyBase() {}, update() {}, stop() {}, dispose() {},
    info, status, reason,
  };
}

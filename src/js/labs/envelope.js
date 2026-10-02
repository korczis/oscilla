// Envelope (ADSR) controller: owns the ADSR state (seconds, sustain 0…1), binds the shell's
// Attack/Decay/Sustain/Release fields and sliders, the power toggle and the draggable graph
// (charts/envelope-graph.js). The engine reads lab.adsr when it schedules a voice
// (audio/envelope.js applyAdsr) and subscribes with lab.onChange to follow edits.

import { createEnvelopeGraph } from '../charts/envelope-graph.js';
import { ADSR_LIMITS, clampAdsr } from '../charts/drag-math.js';
import {
  formatDuration,
  parseDurationS,
  parseNumber,
  logSliderToValue,
  valueToLogSlider,
} from '../charts/axes.js';
import { on, onUi, bindSwitch, setSlider, setField } from './dom.js';

export const ADSR_DEFAULTS = Object.freeze({ a: 0.01, d: 0.1, s: 0.6, r: 0.3 });

const TIME_KEYS = {
  a: { slider: '#osc-env-attack', text: '#osc-env-attack-value' },
  d: { slider: '#osc-env-decay', text: '#osc-env-decay-value' },
  r: { slider: '#osc-env-release', text: '#osc-env-release-value' },
};

/** mount(rootEl, adapter) → lab { adsr, enabled, set(patch), onChange(fn), update, dispose } */
export function mount(rootEl) {
  const q = (sel) => rootEl.querySelector(sel);
  const listeners = new Set();
  let adsr = { ...ADSR_DEFAULTS };
  const sustainSlider = q('#osc-env-sustain');
  const sustainText = q('#osc-env-sustain-value');
  const host = q('#osc-chart-envelope');
  const graph = host ? createEnvelopeGraph(host, { adsr, onChange: (next) => set(next, 'graph') })
    : null;

  function sync(source) {
    for (const [k, sel] of Object.entries(TIME_KEYS)) {
      const [lo, hi] = ADSR_LIMITS[k];
      setSlider(q(sel.slider), valueToLogSlider(adsr[k], lo, hi), formatDuration(adsr[k]));
      setField(q(sel.text), formatDuration(adsr[k]));
    }
    setSlider(sustainSlider, adsr.s.toFixed(2), adsr.s.toFixed(2));
    setField(sustainText, adsr.s.toFixed(2).replace(/0$/, ''));
    if (graph && source !== 'graph') graph.setAdsr(adsr);
  }

  function set(patch, source) {
    adsr = clampAdsr({ ...adsr, ...patch });
    sync(source);
    for (const fn of listeners) fn({ ...adsr }, enable.value);
    return { ...adsr };
  }

  const enable = bindSwitch(q('#osc-env-enable'), (v) => {
    if (graph) graph.setEnabled(v);
    for (const fn of listeners) fn({ ...adsr }, v);
  });

  const offs = [enable.dispose];
  for (const [k, sel] of Object.entries(TIME_KEYS)) {
    const [lo, hi] = ADSR_LIMITS[k];
    const slider = q(sel.slider);
    const text = q(sel.text);
    offs.push(on(slider, 'input', () => {
      set({ [k]: logSliderToValue(Number(slider.value), lo, hi) });
    }));
    offs.push(on(text, 'change', () => {
      const s = parseDurationS(text.value);
      if (s != null) set({ [k]: s });
      else setField(text, formatDuration(adsr[k]));
    }));
  }
  offs.push(on(sustainSlider, 'input', () => set({ s: Number(sustainSlider.value) })));
  offs.push(on(sustainText, 'change', () => {
    const v = parseNumber(sustainText.value);
    if (v != null) set({ s: v > 1 ? v / 100 : v }); // "60" is read as 60 %
    else setField(sustainText, adsr.s.toFixed(2));
  }));
  offs.push(onUi(rootEl, (d) => {
    if (d.kind === 'theme' && graph) graph.refreshTheme();
  }));

  if (graph) graph.setEnabled(q('#osc-env-enable') ? enable.value : true);
  sync();

  return {
    graph,
    get adsr() {
      return { ...adsr };
    },
    get enabled() {
      return q('#osc-env-enable') ? enable.value : true;
    },
    set,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    update(state = {}) {
      if (state.adsr) set(state.adsr);
      if (state.enabled != null) {
        enable.set(!!state.enabled, true);
        if (graph) graph.setEnabled(!!state.enabled);
      }
    },
    dispose() {
      offs.forEach((f) => f());
      if (graph) graph.dispose();
      listeners.clear();
    },
  };
}

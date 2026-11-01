// Envelope (ADSR) controller: owns the ADSR state (seconds, sustain 0…1), binds the shell's
// Attack/Decay/Sustain/Release fields and sliders, the power toggle and the draggable graph
// (charts/envelope-graph.js). main.js hands lab.adsr to every play (audio/lab-play-options.js)
// and, through lab.onChange, to the sounding voice (followEnvelopeLab -> engine.setAdsr).
// A listener's third argument says whether the edit is still settling (#296 R-7): a slider's
// 'input' and a graph pointermove are, the slider's 'change', the graph's pointerup, a typed
// field, the power switch and update() are not, so a drag reaches the voice as one edit.
// The keyboard (#296 R-9): a range input fires 'input' and 'change' for every arrow step, a
// press or an auto-repeat, so while a key is down on a slider both settle; the keyup commits
// once KEY_COMMIT_MS later unless another keydown comes first (a run of presses is one edit,
// like a held key), and leaving the slider (blur) commits at once.
// Of the edits made while a note is held, the release also reaches main.js's labRev ->
// engine.setNoteOffRelease, which letting go of that note then uses (C009).

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

/** How long after the last keyup on a slider its keyboard steps commit (#296 R-9). */
export const KEY_COMMIT_MS = 250;

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
  let graphSettling = false;
  const graph = host ? createEnvelopeGraph(host, { adsr, onChange: (next) => {
    graphSettling = true;
    set(next, 'graph', true);
  } }) : null;

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

  function set(patch, source, settling = false) {
    adsr = clampAdsr({ ...adsr, ...patch });
    sync(source);
    for (const fn of listeners) fn({ ...adsr }, enable.value, { settling });
    return { ...adsr };
  }

  const enable = bindSwitch(q('#osc-env-enable'), (v) => {
    if (graph) graph.setEnabled(v);
    for (const fn of listeners) fn({ ...adsr }, v, { settling: false });
  });

  // The graph's drag ends on its canvas (pointer capture), and the event bubbles to the host.
  const graphDone = () => {
    if (!graphSettling) return;
    graphSettling = false;
    set({}, 'graph');
  };
  const offs = [enable.dispose, on(host, 'pointerup', graphDone),
    on(host, 'pointercancel', graphDone)];

  // A slider: 'input' settles, 'change' commits, except while the keyboard steps it (R-9).
  function bindSlider(slider, read) {
    if (!slider) return;
    let keying = false;
    let dirty = false;
    let timer = null;
    const disarm = () => {
      if (timer != null) clearTimeout(timer);
      timer = null;
    };
    const commit = () => {
      disarm();
      keying = false;
      if (!dirty) return;
      dirty = false;
      set(read());
    };
    const edit = (settling) => {
      if (keying) dirty = true;
      set(read(), undefined, settling || keying);
    };
    offs.push(on(slider, 'keydown', () => {
      disarm();
      keying = true;
    }));
    offs.push(on(slider, 'keyup', () => {
      if (!keying) return;
      disarm();
      timer = setTimeout(commit, KEY_COMMIT_MS);
    }));
    offs.push(on(slider, 'blur', commit));
    offs.push(on(slider, 'input', () => edit(true)));
    offs.push(on(slider, 'change', () => edit(false)));
    offs.push(disarm);
  }

  for (const [k, sel] of Object.entries(TIME_KEYS)) {
    const [lo, hi] = ADSR_LIMITS[k];
    const slider = q(sel.slider);
    const text = q(sel.text);
    bindSlider(slider, () => ({ [k]: logSliderToValue(Number(slider.value), lo, hi) }));
    offs.push(on(text, 'change', () => {
      const s = parseDurationS(text.value);
      if (s != null) set({ [k]: s });
      else setField(text, formatDuration(adsr[k]));
    }));
  }
  bindSlider(sustainSlider, () => ({ s: Number(sustainSlider.value) }));
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
    /** The keyboard commit window (ms, #296 R-9), for the checks that judge it. */
    keyCommitMs: KEY_COMMIT_MS,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    update(state = {}) {
      if (state.adsr) set(state.adsr);
      if (state.enabled != null) {
        const changed = !!state.enabled !== enable.value;
        enable.set(!!state.enabled, true);
        if (graph) graph.setEnabled(!!state.enabled);
        // A programmatic switch (config import) notifies like a click (status flags, path).
        if (changed) {
          for (const fn of listeners) fn({ ...adsr }, enable.value, { settling: false });
        }
      }
    },
    dispose() {
      offs.forEach((f) => f());
      if (graph) graph.dispose();
      listeners.clear();
    },
  };
}

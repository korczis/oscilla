// Fixture for tests/browser/knob.cjs (plan K206): the shipped Synth panel knob on a fixture
// store, bundled with esbuild (IIFE) into one classic <script> of the fixture page. Nothing here
// draws or handles a knob: the panel is the shipped Synth part (src/js/synth/ui.js
// createSynthUi), which renders the face (view/face.js), the knob skin (view/knob.js) and the
// ARIA position (ui/synth/knob.js), and binds the pointer, wheel, double-click and key events.
// M123: one implementation per control kind; the fixture builds no second knob.
//
// The fixture store is the one Studio store (studio/actions.js) holding the reference template
// plus the Synth panel, as tests/unit/synth-fixture.mjs builds it, and it persists every change
// to localStorage under STORE_KEY (serializeStudio), so a reload opens the same model: the knob
// is bound to a store that keeps its value, which the Synth workspace itself does not (s-dock:
// "Reload keeps nothing").
//
// The page exposes window.K206 for the runner: model() the stored parameter value of a control
// ('lpf.frequency' -> the LPF node's frequency), stored() the value read back from localStorage,
// expect(cid) what the knob of that control must show for the stored value (its ARIA position,
// its aria-valuetext and its visible value, from the shipped knob model), depth() the store's
// undo depth.

import PANEL from '../../../src/js/synth/panels/semi-mono.js';
import { createSynthUi } from '../../../src/js/synth/ui.js';
import { createIdGenerator, createStudioStore } from '../../../src/js/studio/actions.js';
import { normalizeStudio, serializeStudio } from '../../../src/js/studio/schema.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../../src/js/studio/templates/index.js';
import { knobModel } from '../../../src/js/synth/view/knob.js';
import { ariaAttrs } from '../../../src/js/ui/synth/knob.js';

const STORE_KEY = 'oscilla.k206.fixture-store';

function storedModel() {
  try {
    const text = localStorage.getItem(STORE_KEY);
    return text ? normalizeStudio(JSON.parse(text)) : null;
  } catch (e) {
    return null;
  }
}

function openStore() {
  const listeners = new Set();
  const onChange = (event) => {
    localStorage.setItem(STORE_KEY, serializeStudio(event.model));
    listeners.forEach((fn) => fn(event));
  };
  const kept = storedModel();
  const model = kept || templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model), onChange });
  if (!kept) {
    const r = store.dispatch(PANEL.instantiate(store.getModel(), { at: { x: 0, y: 600 } }));
    if (!r.ok) throw new Error(`K206 fixture: the panel was refused: ${r.reason}`);
  }
  const handle = Object.create(store, { subscribe: { value: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  } } });
  return { store, handle, restored: !!kept };
}

const { store, handle, restored } = openStore();
const live = document.querySelector('[data-k206="live"]');
const announce = (text) => { live.textContent = text; };
// No transport: the knob's contract is the model and its DOM, not sound (synth.cjs judges that).
const part = createSynthUi({ get: () => ({ handle, transport: null }), announce });
const watchers = {};
const cmp = Object.assign(part, {
  workspace: 'synth', theme: 'light', ensureAudio() {},
  $nextTick(fn) { if (fn) queueMicrotask(fn); },
  $watch(prop, fn) { watchers[prop] = fn; },
});
cmp.synthInit();
watchers.workspace('synth'); // entering the workspace renders the panel (requestAnimationFrame)

const paramOf = (cid) => {
  const [mid, key] = cid.split('.');
  const node = PANEL.resolve(store.getModel()).get(mid);
  return node ? node.params[key] : undefined;
};

window.K206 = {
  restored,
  model: paramOf,
  stored(cid) {
    const m = storedModel();
    if (!m) return undefined;
    const [mid, key] = cid.split('.');
    const node = PANEL.resolve(m).get(mid);
    return node ? node.params[key] : undefined;
  },
  expect(cid) {
    const [mid, key] = cid.split('.');
    const c = PANEL.faceOf(mid).find((x) => x.key === key);
    const v = paramOf(cid);
    const km = knobModel(c.param);
    const a = ariaAttrs(v, c.param, () => km.text(v));
    return { value: v, now: a['aria-valuenow'], text: a['aria-valuetext'], shown: km.format(v),
      unit: c.param.unit, initial: c.initial };
  },
  depth: () => store.debugInfo().undoDepth,
};

// The XY pad's one shared mount (plan K167, over K097): every node and edge the pad's surface
// edits, and every path that releases what it holds. The Synth workspace's XY tab
// (view/xy-tab.js) calls it, and the live landing composes the same mount rather than a second
// wiring. No other file builds the pad's cables (tests/unit/xy-wiring.test.mjs greps the
// sources); synth/library.js only lists and loads whole patches of the one patch catalog.
//
//   mountSynthXy(host, { store, transport, panel, owner, app, arm, say, jackName, dispatch,
//     buttonClass, phone, mountPad }) -> { view, owner, release(reason), destroy() }
//     store      the Studio store handle (getModel, dispatch): the one writer of the document
//     transport  the Studio transport, or a function returning it (late-bound: null before
//                audio); the pad plays live notes on it, never the model
//     owner      who owns the mount, default 'synth' (the Synth workspace); a later target
//                owned by 'landing' is released by Stop like this one, never by the Synth
//                panel's own live updates
//     app        the Alpine component: its root's `osc:ui` 'mode' event (a workspace leave)
//                and its outputOwner (the audio owner); optional
//     arm()      the first touch arms the instrument (synth/ui.js synthArm), true when it plays
//     phone()    a coarse pointer on a narrow viewport (default: matchMedia PHONE_QUERY)
//     mountPad   the pad kind's mount (ui/kinds/xy-pad.js mountXyPad; a seam for unit tests)
//   view.destroy() releases and removes every subscription; a second destroy changes nothing.
//   xyVoiceAction(model, panel) -> { action } | { reason }   Patch the pad into the voice
//   xyPresetAction(model, panel, id) -> { action } | { reason }   a built-in XY preset
//
// The pad talks to what it plays through one small internal interface, the target:
//   target = { owner, output, wire(slot, ctx) -> spec | null, unwire(), live(kind, x, y),
//              arm(), release(reason) -> released }
//   spec   = { params, steps, deg(i), scale, target, lead, disabled }
// The document's Synth panel (documentTarget) is the only implementation: its controls edit
// the StudioModel, one BATCH and one undo entry each, and it plays the panel's xy-pad node
// through transport.live. The four release paths are the mount's, never a target's: transport
// Stop (its 'state' event with playing false), leaving the workspace (`osc:ui` 'mode' on the
// app root), the audio owner moving away from the target's output (app.outputOwner) and page
// hide (the pad kind's own pagehide and visibility listeners). Each closes the pad's gate and
// then sends the router's all-off (studio/live-notes.js through transport.live), so a lost
// note-off never leaves a voice held. No window listener and no key binding is added here.
//
// Phone first open: on a coarse pointer and a narrow viewport an unpatched pad is patched into
// the voice once per document store, with the XY lead's scale and target (the voice() BATCH,
// one undo entry), stated in visible text with one first action, "Touch the pad to play". Nothing
// arms and nothing sounds before that touch (project.a-phone-sounds).

import { mountXyPad } from '../../ui/kinds/xy-pad.js';
import { xyDegree } from '../../studio/nodes/instrument.js';
import { SCALE_LABELS } from '../../core/music.js';
import {
  XY_RECIPES, XY_VOICE, xyCablesAction, xyPatchAction, xyPatched, xyPresetPatch, xyTarget,
  xyTargetAction, xyTargets,
} from '../xy.js';
import { esc } from './face.js';

export const XY_TEXT = Object.freeze({
  unpatched: 'The pad is not patched into the voice: choose an XY preset, or Patch the pad into '
    + 'the voice.',
  missing: 'The XY pad is not in this Studio document: press Add the XY pad first.',
  voiced: "The XY pad plays the voice: its cables replace the keyboard's pitch and gate normals.",
  first: 'Touch the pad to play. Nothing sounds until you do.',
  defaulted: "The XY pad is patched into the voice with the XY lead's scale and target. Undo "
    + "gives the keyboard its pitch and gate back.",
});
export const XY_LEAD = XY_RECIPES.find((r) => r.id === 'xy-lead');
export const PHONE_QUERY = '(pointer: coarse) and (max-width: 767.98px)';
export const XY_OWNER = 'synth';
const HOME = Object.freeze({ synth: 'synth' }); // the workspace an owner's mount lives in
const SELECT = 'h-11 rounded-lg border border-solid border-gray-300 bg-gray-50 px-3 text-sm '
  + 'text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white';
const BUTTON = 'rounded-lg px-3 h-11 text-xs font-medium text-primary-700 border border-solid '
  + 'border-primary-600 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 '
  + 'focus-visible:ring-primary-500 dark:text-primary-400 dark:hover:bg-gray-700';

const CURSORS = new WeakMap(); // store -> the pad's cursor: performance state, never the model
const DEFAULTED = new WeakSet(); // stores whose pad had its phone default (once, then undoable)
const OWNER_HUBS = new WeakMap(); // app -> listeners of outputOwner: one $watch per app

let mounts = 0;

/** Patch the pad into the voice: Pitch and Gate, and Y into the XY lead's target if Y has none. */
export function xyVoiceAction(model, panel) {
  const pairs = xyTarget(model, panel) ? XY_VOICE : [...XY_VOICE, ['xy.y', XY_LEAD.y]];
  return xyCablesAction(model, panel, pairs);
}

/** A built-in XY preset as one BATCH (xy.js: the recipe's patch on the document's panel). */
export function xyPresetAction(model, panel, id) {
  const recipe = XY_RECIPES.find((x) => x.id === id);
  if (!recipe) return { reason: `There is no XY preset "${id}".` };
  try {
    return xyPatchAction(model, panel, xyPresetPatch(model, panel, recipe));
  } catch (e) {
    return { reason: e.message };
  }
}

function onOwner(app, fn) {
  if (!app || typeof app.$watch !== 'function') return () => {};
  let hub = OWNER_HUBS.get(app);
  if (!hub) {
    hub = new Set();
    OWNER_HUBS.set(app, hub);
    // Alpine's $watch cannot be undone: one per app, fanned out to the live mounts.
    app.$watch('outputOwner', (now) => { for (const f of [...hub]) f(now); });
  }
  hub.add(fn);
  return () => hub.delete(fn);
}

const defaultPhone = () => typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches;

/** The document's Synth panel as the pad's target (the only target today). */
function documentTarget({ store, panel, transport, owner, arm, say, jackName, dispatch,
  buttonClass }) {
  const model = () => store.getModel();
  const pad = () => panel.resolve(model()).get('xy');
  const offs = [];
  const act = (a, done) => {
    if (a.reason) say(a.reason, true);
    else if (dispatch(a.action).ok && done) say(done);
  };
  const on = (el, type, fn) => {
    if (!el) return;
    el.addEventListener(type, fn);
    offs.push(() => el.removeEventListener(type, fn));
  };
  let steps = 1;
  return {
    owner,
    output: 'studio', // the panel sounds through the Studio transport
    /** Render the controls into `slot` and return what the pad shows, or null without a pad. */
    wire(slot, { phone }) {
      if (!pad()) return null;
      if (phone && !xyPatched(model(), panel) && !DEFAULTED.has(store)) {
        DEFAULTED.add(store);
        act(xyVoiceAction(model(), panel), XY_TEXT.defaulted);
      }
      const m = model();
      const to = xyTarget(m, panel);
      const patched = xyPatched(m, panel);
      slot.innerHTML = '<label for="synth-xy-y" class="text-sm text-gray-700 dark:text-gray-300">'
        + `Y drives</label><select id="synth-xy-y" data-osc="synth.xy.target" class="${SELECT}">`
        + `<option value="">Nothing</option>${xyTargets(panel).map((t) => `<option value=`
        + `"${t.id}"${t.id === to ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}`
        + '</select>' + (patched ? '' : `<button type="button" data-xy-voice="" `
          + `class="${buttonClass}">Patch the pad into the voice</button>`);
      on(slot.querySelector('[data-xy-voice]'), 'click',
        () => act(xyVoiceAction(model(), panel), XY_TEXT.voiced));
      const s = slot.querySelector('[data-osc="synth.xy.target"]');
      on(s, 'change', () => act(xyTargetAction(model(), panel, s.value || null),
        s.value ? `Y drives ${s.selectedOptions[0].text}.` : 'Y drives nothing.'));
      const p = pad().params;
      steps = xyDegree(1, p).steps;
      return { params: p, steps, deg: (i) => xyDegree((i + 0.5) / steps, p),
        scale: `${p.key} ${SCALE_LABELS[p.mode]}`, target: to ? jackName(to) : 'nothing',
        lead: p.mode === XY_LEAD.scale.mode && p.key === XY_LEAD.scale.key && to === XY_LEAD.y,
        disabled: patched ? null : XY_TEXT.unpatched };
    },
    unwire() {
      while (offs.length) offs.pop()();
    },
    live(kind, x, y) {
      const t = transport();
      const n = pad();
      return t && t.playing && n ? t.live(n.id, { kind, x: (x + 0.5) / steps, y }) : null;
    },
    arm,
    /** The router's release (live-notes.js all-off): whatever the pad's node still holds. */
    release() {
      const t = transport();
      const n = pad();
      return t && t.playing && n ? t.live(n.id, { kind: 'all-off' }).released || 0 : 0;
    },
  };
}

export function mountSynthXy(host, { store, transport = null, panel, owner = XY_OWNER, app = null,
  arm = null, say = () => {}, jackName = (id) => String(id), dispatch = null,
  buttonClass = BUTTON, phone = defaultPhone, mountPad = mountXyPad } = {}) {
  const tp = () => (typeof transport === 'function' ? transport() : transport);
  const target = documentTarget({ store, panel, transport: tp, owner, say, jackName,
    buttonClass, dispatch: dispatch || ((a) => store.dispatch(a)),
    arm: arm || (() => {
      const t = tp();
      return !!t && (t.playing || t.arm().ok);
    }) });
  const uid = `synth-xy-${(mounts += 1)}`;
  const offs = [];
  let view = null;
  let destroyed = false;
  let heard = null; // the transport whose Stop this mount listens to
  let offHeard = () => {};

  /** Close the pad's gate, then the router's all-off: nothing the pad held stays held. */
  function release(reason) {
    if (destroyed) return 0;
    const gated = !!(view && view.model.gated);
    if (gated) view.model.end(reason); // onGate(false): off, then the router's all-off
    else target.release(reason);
    return gated ? 1 : 0;
  }

  // ---- the four release paths (the mount's, never the target's)
  function listenStop() { // transport Stop: its 'state' event with playing false
    const t = tp();
    if (!t || t === heard || typeof t.on !== 'function') return;
    offHeard();
    heard = t;
    offHeard = t.on((type, d) => {
      if (type === 'state' && d && d.playing === false) release('stop');
    });
  }
  listenStop();
  const root = app && app.$root;
  if (root && typeof root.addEventListener === 'function') { // leaving the workspace
    const home = HOME[owner] || app.workspace;
    const leave = (e) => {
      const d = e.detail || {};
      if (d.kind === 'mode' && d.value !== home) release('leave');
    };
    root.addEventListener('osc:ui', leave);
    offs.push(() => root.removeEventListener('osc:ui', leave));
  }
  offs.push(onOwner(app, (now) => { // the audio owner moves away from the target's output
    if (now !== target.output) release('owner');
  }));
  // Page hide: the pad kind's own pagehide and visibilitychange listeners end the gate with
  // reason 'hide', which onGate below routes through the same release.

  // ---- the surface
  host.innerHTML = '<div class="flex flex-wrap items-center gap-2" data-xy-controls=""></div>'
    + '<p class="mt-2 text-sm text-gray-700 dark:text-gray-300" data-xy-default=""></p>'
    + `<p id="${uid}-first" class="mt-1 text-sm font-semibold text-gray-900 dark:text-white" `
    + 'data-xy-first="" hidden></p><div class="mt-3" data-osc="synth.xy.pad"></div>'
    + '<p data-osc="synth.xy.readout" class="mt-2 min-h-[1.25rem] font-mono text-sm '
    + 'text-gray-700 dark:text-gray-300"></p>';
  const spec = target.wire(host.querySelector('[data-xy-controls]'), { phone: !!phone() });
  const box = host.querySelector('[data-osc="synth.xy.pad"]');
  if (spec && box) {
    const { steps, deg, scale, target: to, params: p } = spec;
    const stated = host.querySelector('[data-xy-default]');
    stated.textContent = `${spec.lead ? 'Default: ' : ''}${scale} over ${p.span} oct from `
      + `${p.key}${p.octave}; Y drives ${to}${spec.lead ? " (the XY lead's scale and target)"
        : ''}.`;
    const first = host.querySelector('[data-xy-first]');
    if (!spec.disabled) {
      first.textContent = XY_TEXT.first;
      first.hidden = false;
    }
    const out = host.querySelector('[data-osc="synth.xy.readout"]');
    const live = (kind, v) => {
      const r = target.live(kind, v.x, v.y);
      const d = deg(v.x);
      out.textContent = `${d.name} · degree ${d.degree} of ${scale} · Y ${Math.round(v.y * 100)}`
        + ` % → ${to}${r && r.held ? ' · gate open' : ''}`;
      return r;
    };
    const was = CURSORS.get(store);
    let pos = was && was.x < steps ? was : { x: Math.floor(steps / 2), y: 0.5 };
    const keep = (v) => {
      pos = v;
      CURSORS.set(store, v);
    };
    view = mountPad(box, {
      label: `XY pad: pitch in ${scale}, Y to ${to}`,
      description: `X is the pitch: ${steps} steps of ${scale} over ${p.span} oct from `
        + `${p.key}${p.octave}, low at the left. Y drives ${to}, low at the bottom. Arrows `
        + 'move the cursor; hold Enter, or touch, to sound it; Escape releases.',
      describedBy: spec.disabled ? [] : [`${uid}-first`],
      cells: Array.from({ length: steps }, (_, i) => ({ label: String(deg(i).degree),
        root: deg(i).degree === 1 })),
      disabled: spec.disabled,
      x: { key: 'x', label: 'Pitch', type: 'integer', min: 0, max: steps - 1, step: 1,
        default: Math.floor(steps / 2) },
      y: { key: 'y', label: `Y: ${to}`, type: 'number', min: 0, max: 1, default: 0.5 },
      value: pos,
      text: { x: (i) => `${deg(i).name}, degree ${deg(i).degree}`,
        y: (v) => `${Math.round(v * 100)} % to ${to}` },
      onPreview(v) {
        keep(v);
        live('move', v);
      },
      onGate(open, v, reason) {
        keep(v);
        if (open) {
          const t = tp();
          // The first touch arms the instrument, as the first key does (synth/ui.js synthArm).
          if (!(t && t.playing) && !target.arm()) return;
          listenStop(); // the transport may exist only from this touch on
          live('on', v);
          return;
        }
        live('off', v);
        if (reason !== 'release') target.release(reason);
      },
    });
    live('move', pos);
  }

  return {
    get view() { return view; },
    owner,
    release,
    destroy() {
      if (destroyed) return;
      if (view) view.destroy(); // the kind ends a held gate ('hide'): onGate releases it
      else target.release('destroy');
      destroyed = true;
      view = null;
      offHeard();
      while (offs.length) offs.pop()();
      target.unwire();
    },
  };
}

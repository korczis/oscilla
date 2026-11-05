// The XY pad's one shared mount (plan K167, over K097): every node and edge the pad's surface
// edits, and every path that releases what it holds. The Synth workspace's XY tab
// (view/xy-tab.js) calls it, and the live landing composes the same mount rather than a second
// wiring. No other file builds the pad's cables (tests/unit/xy-wiring.test.mjs greps the
// sources); synth/library.js only lists and loads whole patches of the one patch catalog.
//
//   mountSynthXy(host, { store, transport, panel, owner, app, arm, say, jackName, dispatch,
//     buttonClass, phone, mountPad, sampleRate }) -> { view, owner, release(reason), destroy() }
//     store      the Studio store handle (getModel, dispatch): the one writer of the document
//     transport  the Studio transport, or a function returning it (late-bound: null before
//                audio); the pad plays live notes on it, never the model
//     owner      who owns the mount, default 'synth' (the Synth workspace); a later target
//                owned by 'landing' (its home: the landing) is released by Stop like this one,
//                never by the Synth panel's own live updates
//     app        the Alpine component: its root's `osc:ui` 'mode' event (a workspace leave)
//                and its outputOwner (the audio owner); optional
//     arm()      the first touch arms the instrument (synth/ui.js synthArm): true, or the
//                reason it did not ({ ok: false, reason, said } | reason | false); the reason
//                is said (assertively, unless `said`) and shown on the line that describes the
//                pad, so a refused touch is never silent (project.no-silent-feedback)
//     phone()    a coarse pointer on a narrow viewport (default: matchMedia PHONE_QUERY)
//     mountPad   the pad kind's mount (ui/kinds/xy-pad.js mountXyPad; a seam for unit tests)
//     sampleRate()  the running AudioContext's rate, null before one exists (default: none);
//                Y's value is sized at its 0.95 x Nyquist (xyYReading), else at the provisional
//                44.1 kHz, and a value the compiler holds there says so with the rate it used
//   view.destroy() releases and removes every subscription; a second destroy changes nothing.
//   xyVoiceAction(model, panel) -> { action } | { reason }   Patch the pad into the voice
//   xyPresetAction(model, panel, id) -> { action } | { reason }   a built-in XY preset
//
// The pad talks to what it plays through one small internal interface, the target:
//   target = { owner, output, wire(slot, ctx) -> spec | null, unwire(), live(kind, x, y),
//              arm() -> true | refusal, release(reason) -> released }
//   spec   = { params, steps, deg(i), scale, target, lead, disabled, offer }
// The document's Synth panel (documentTarget) is the only implementation: its controls edit
// the StudioModel, one BATCH and one undo entry each, and it plays the panel's xy-pad node
// through transport.live. The four release paths are the mount's, never a target's: transport
// Stop (its 'state' event with playing false), leaving the workspace (`osc:ui` 'mode' on the
// app root), the audio owner moving away from the target's output (app.outputOwner; a change
// to no owner at all is the Stop's, released as 'stop') and page
// hide (the pad kind's own pagehide and visibility listeners). Each closes the pad's gate and
// then sends the router's all-off (studio/live-notes.js through transport.live), so a lost
// note-off never leaves a voice held. No window listener and no key binding is added here.
//
// The pad's view (S3) is what the pad sends, drawn: each X cell is labelled by the note of
// xyDegree, the function the runtime adapter quantises X with, at the x the mount sends for
// that cell (xyCellX); Y's readout is what its target plays at y, xyYReading's at(y) (the
// compiler's own computeBases at the context's Nyquist limit, every cable's constant part in
// it) in the target knob's own text (knob.js), "held" when the compiler scaled Y's excursion
// down to stay at or below 0.95 x Nyquist; the Y ends are at(0) and at(1), read again on each
// drawn frame. The readout line sits above the pad, clear of the docked keyboard.
//   xyCellX(i, steps) -> the x (0..1) the mount sends for cell i: its centre
//
// Phone first open (a coarse pointer, a narrow viewport): opening the tab edits nothing (no
// BATCH, no history entry, no dirty document). An unpatched pad states what its one first
// action does, Patch the pad into the voice (the primary button there: the XY lead's scale and
// target, one undo entry); a patched pad states its default and "Touch the pad to play".
// Nothing arms and nothing sounds before that touch (project.a-phone-sounds).

import { mountXyPad } from '../../ui/kinds/xy-pad.js';
import { xyDegree } from '../../studio/nodes/instrument.js';
import { NOTE_NAMES, SCALE_LABELS } from '../../core/music.js';
import { SAFE_NYQUIST_FACTOR_TEXT } from '../../core/constants.js';
import {
  XY_RECIPES, XY_VOICE, xyCablesAction, xyPatchAction, xyPatched, xyPresetPatch, xyTarget,
  xyTargetAction, xyTargets, xyYReading,
} from '../xy.js';
import { limitBoundText } from '../../studio/compiler.js';
import { esc } from './face.js';
import { knobModel } from './knob.js';

export const XY_TEXT = Object.freeze({
  unpatched: 'The pad is not patched into the voice: choose an XY preset, or Patch the pad into '
    + 'the voice.',
  missing: 'The XY pad is not in this Studio document: press Add the XY pad first.',
  voiced: "The XY pad plays the voice: its cables replace the keyboard's pitch and gate normals.",
  first: 'Touch the pad to play. Nothing sounds until you do.',
  refused: 'The instrument did not start, so the pad plays nothing.',
});
export const XY_LEAD = XY_RECIPES.find((r) => r.id === 'xy-lead');
export const PHONE_QUERY = '(pointer: coarse) and (max-width: 767.98px)';
export const XY_OWNER = 'synth';
// The workspace an owner's mount lives in: leaving it releases the pad.
const HOME = Object.freeze({ synth: 'synth', landing: 'landing' });
const SELECT = 'h-11 rounded-lg border border-solid border-gray-300 bg-gray-50 px-3 text-sm '
  + 'text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white';
const PRIMARY = 'h-11 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white '
  + 'hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300';
const BUTTON = 'rounded-lg px-3 h-11 text-xs font-medium text-primary-700 border border-solid '
  + 'border-primary-600 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 '
  + 'focus-visible:ring-primary-500 dark:text-primary-400 dark:hover:bg-gray-700';

/** The x the mount sends for cell i of `steps`: the cell's centre (what xyDegree quantises). */
export const xyCellX = (i, steps) => (i + 0.5) / steps;

const CURSORS = new WeakMap(); // store -> the pad's cursor: performance state, never the model
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
  buttonClass, sampleRate }) {
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
      const m = model(); // read only: opening the pad edits nothing
      const to = xyTarget(m, panel);
      const patched = xyPatched(m, panel);
      slot.innerHTML = '<label for="synth-xy-y" class="text-sm text-gray-700 dark:text-gray-300">'
        + `Y drives</label><select id="synth-xy-y" data-osc="synth.xy.target" class="${SELECT}">`
        + `<option value="">Nothing</option>${xyTargets(panel).map((t) => `<option value=`
        + `"${t.id}"${t.id === to ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}`
        + '</select>' + (patched ? '' : `<button type="button" data-xy-voice="" `
          + `class="${phone ? PRIMARY : buttonClass}">Patch the pad into the voice</button>`);
      on(slot.querySelector('[data-xy-voice]'), 'click',
        () => act(xyVoiceAction(model(), panel), XY_TEXT.voiced));
      const s = slot.querySelector('[data-osc="synth.xy.target"]');
      on(s, 'change', () => act(xyTargetAction(model(), panel, s.value || null),
        s.value ? `Y drives ${s.selectedOptions[0].text}.` : 'Y drives nothing.'));
      const p = pad().params;
      steps = xyDegree(1, p).steps;
      const next = to || XY_LEAD.y; // Y's target once the pad is patched (xyVoiceAction)
      const scale = `${p.key} ${SCALE_LABELS[p.mode]}`;
      const lead = p.mode === XY_LEAD.scale.mode && p.key === XY_LEAD.scale.key
        && next === XY_LEAD.y;
      const range = `${scale} over ${p.span} oct from ${p.key}${p.octave}`;
      const tag = lead ? " (the XY lead's scale and target)" : '';
      // What Y's target plays, read from the document and the context's rate at each reading.
      let seen = { m: null, sr: null, r: null };
      const reading = () => {
        const now = model();
        const sr = sampleRate() || null;
        if (now !== seen.m || sr !== seen.sr) {
          seen = { m: now, sr, r: xyYReading(now, panel, { sampleRate: sr }) };
        }
        return seen.r;
      };
      return { params: p, steps, deg: (i) => xyDegree(xyCellX(i, steps), p), scale, reading,
        target: to ? jackName(to) : 'nothing', lead,
        disabled: patched ? null : XY_TEXT.unpatched,
        stated: patched ? `${lead ? 'Default: ' : ''}${range}; Y drives ${jackName(to)}${tag}.`
          : `Patch the pad into the voice to play it: ${range}, Y driving ${jackName(next)}`
            + `${tag}. Its cables replace the keyboard's pitch and gate; Undo gives them back.` };
    },
    unwire() {
      while (offs.length) offs.pop()();
    },
    live(kind, x, y) {
      const t = transport();
      const n = pad();
      return t && t.playing && n ? t.live(n.id, { kind, x: xyCellX(x, steps), y }) : null;
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
  buttonClass = BUTTON, phone = defaultPhone, mountPad = mountXyPad,
  sampleRate = () => null } = {}) {
  const tp = () => (typeof transport === 'function' ? transport() : transport);
  const target = documentTarget({ store, panel, transport: tp, owner, say, jackName,
    buttonClass, sampleRate, dispatch: dispatch || ((a) => store.dispatch(a)),
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

  /** arm()'s answer as { ok, reason, said }. */
  const armed = () => {
    const r = target.arm();
    if (r === true || (r && r.ok === true)) return { ok: true };
    return { ok: false, reason: (typeof r === 'string' && r) || (r && r.reason)
      || XY_TEXT.refused, said: !!(r && r.said) };
  };

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
    // No owner at all follows a Stop (which released already): it is the Stop's, never 'owner'.
    if (now !== target.output) release(now === null ? 'stop' : 'owner');
  }));
  // Page hide: the pad kind's own pagehide and visibilitychange listeners end the gate with
  // reason 'hide', which onGate below routes through the same release.

  // ---- the surface
  host.innerHTML = '<div class="flex flex-wrap items-center gap-2" data-xy-controls=""></div>'
    + '<p class="mt-2 text-sm text-gray-700 dark:text-gray-300" data-xy-default=""></p>'
    + `<p id="${uid}-first" class="mt-1 text-sm font-semibold text-gray-900 dark:text-white" `
    + 'data-xy-first="" hidden></p>'
    // The readout above the pad, where the docked keyboard never covers it (S3), its lines
    // reserved (3 on a phone, 2 from sm, 1 from lg) so that a longer reading never moves the
    // pad under the finger.
    + '<p data-osc="synth.xy.readout" class="mt-2 min-h-[3.75rem] font-mono text-sm '
    + 'text-gray-700 sm:min-h-[2.5rem] lg:min-h-[1.25rem] dark:text-gray-300"></p>'
    + '<div class="mt-2" data-osc="synth.xy.pad"></div>';
  const spec = target.wire(host.querySelector('[data-xy-controls]'), { phone: !!phone() });
  const box = host.querySelector('[data-osc="synth.xy.pad"]');
  if (spec && box) {
    const { steps, deg, scale, target: to, params: p, reading } = spec;
    /**
     * What Y's target plays at y, in the target knob's text; '' when Y drives nothing. `why`:
     * 'line' names the bound a held value stays under and its rate, 'aria' as the Inspector
     * writes it (limitBoundText), 'ring' only "held", 'end' the value alone.
     */
    const yValue = (y, why = 'ring') => {
      const r = reading();
      if (!r) return '';
      const v = r.at(y);
      const text = knobModel(r.param).text(v);
      const past = v > r.param.max || v < r.param.min ? 'past its range' : '';
      const held = r.limited && r.cap && why !== 'end';
      const nyq = held && r.cap.bound === 'nyquist';
      const before = nyq && r.provisional ? ' until audio starts' : '';
      if (why === 'aria') {
        return `${text}${past ? ` (${past})` : ''}${held ? `, held at or below ${limitBoundText({
          cap: r.cap.value, bound: r.cap.bound, sampleRate: r.sampleRate })}${before
          ? `,${before}` : ''}` : ''}`;
      }
      const rate = `${Number((r.sampleRate / 1000).toFixed(3))} kHz`;
      const how = !held ? '' : why === 'ring' ? 'held' : nyq
        ? `held ≤ ${SAFE_NYQUIST_FACTOR_TEXT} × Nyquist at ${rate}${before}`
        : 'held ≤ the top of its range';
      const notes = [past, how].filter(Boolean).join(', ');
      return notes ? `${text} (${notes})` : text;
    };
    const others = () => {
      const r = reading();
      return r && r.others ? `, and ${r.others} more cable${r.others > 1 ? 's' : ''} into it`
        : '';
    };
    const ends = reading() ? () => [yValue(0, 'end'), yValue(1, 'end')] : null;
    host.querySelector('[data-xy-default]').textContent = spec.stated;
    const first = host.querySelector('[data-xy-first]');
    if (!spec.disabled) {
      first.textContent = XY_TEXT.first;
      first.hidden = false;
    }
    /** A refused arm: said, and shown on the line that describes the pad, until one plays. */
    const refused = (why) => {
      first.textContent = why;
      first.hidden = false;
      first.setAttribute('data-xy-refused', '');
    };
    const accepted = () => {
      if (!first.hasAttribute('data-xy-refused')) return;
      first.removeAttribute('data-xy-refused');
      first.textContent = XY_TEXT.first;
    };
    const out = host.querySelector('[data-osc="synth.xy.readout"]');
    const live = (kind, v) => {
      const r = target.live(kind, v.x, v.y);
      const d = deg(v.x);
      const yv = yValue(v.y, 'line');
      out.textContent = `${d.name} · degree ${d.degree} of ${scale} · Y ${Math.round(v.y * 100)}`
        + ` % → ${to}${yv ? ` ${yv}` : ''}`; // the gate: the pad's LED
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
      // Each cell's note, as the runtime quantises its x: the full name where the row has room,
      // else on the roots (the key at each octave) and the note letter between them.
      cells: Array.from({ length: steps }, (_, i) => {
        const d = deg(i);
        const root = d.degree === 1;
        return { label: steps <= 15 || root ? d.name : NOTE_NAMES[((d.note % 12) + 12) % 12],
          root };
      }),
      disabled: spec.disabled,
      x: { key: 'x', label: 'Pitch', type: 'integer', min: 0, max: steps - 1, step: 1,
        default: Math.floor(steps / 2) },
      y: { key: 'y', label: `Y: ${to}`, type: 'number', min: 0, max: 1, default: 0.5 },
      value: pos,
      text: { x: (i) => `${deg(i).name}, degree ${deg(i).degree}`,
        y: (v) => {
          const yv = yValue(v, 'aria');
          return `${Math.round(v * 100)} % to ${to}${yv ? `: ${yv}${others()}` : ''}`;
        } },
      readout: { x: (i) => deg(i).name, y: (v) => (yValue(v) ? `${to} ${yValue(v)}` : null),
        yEnds: ends },
      onPreview(v) {
        keep(v);
        live('move', v);
      },
      onGate(open, v, reason) {
        keep(v);
        if (open) {
          const t = tp();
          // The first touch arms the instrument, as the first key does (synth/ui.js synthArm).
          if (!(t && t.playing)) {
            const a = armed();
            if (!a.ok) {
              if (!a.said) say(a.reason, true);
              refused(a.reason);
              view.model.end('refused'); // the touch holds nothing: the gate closes again
              return;
            }
          }
          accepted();
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

// The Synth workspace's XY tab (plan K097): a Flowbite Pro card holding the XY pad kind
// (ui/kinds/xy-pad.js) over the panel's xy-pad node, the "Y drives" target and the button that
// patches the pad into the voice. Every edit is one store dispatch through synth/xy.js; the pad
// itself plays live notes on the transport (studio/live-notes.js), never the model. Composed by
// synth/ui.js, which renders the card into the panel view and mounts the pad after it.
//
//   createXyTab({ panel, get, host, nodes, model, dispatch, say, jackName, tab, showTab, BTN,
//     cmp }) -> { presets, has(id), html(), mount(), destroy(), preset(id) }

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
});
const SELECT = 'h-11 rounded-lg border border-solid border-gray-300 bg-gray-50 px-3 text-sm '
  + 'text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white';

export function createXyTab({ panel, get, host, nodes, model, dispatch, say, jackName, tab,
  showTab, BTN, cmp }) {
  let view = null; // the mounted pad, re-mounted with the panel
  let pos = null; // its cursor across re-renders: performance state, never the model

  function html() {
    const card = '<section class="bg-white rounded-lg shadow dark:bg-gray-800 mb-3 p-3" '
      + 'data-osc="synth.xy" aria-labelledby="synth-xy-title"><h3 id="synth-xy-title" '
      + 'class="text-sm font-bold tracking-widest text-gray-900 dark:text-white">XY PAD</h3>';
    if (!nodes().get('xy')) {
      return `${card}<p class="mt-2 text-sm text-gray-700 dark:text-gray-300">This Studio `
        + 'document has no XY pad.</p><button type="button" data-restore-module="xy" '
        + `class="${BTN} mt-2">Add the XY pad</button></section>`;
    }
    const to = xyTarget(model(), panel);
    return `${card}<div class="mt-2 flex flex-wrap items-center gap-2"><label for="synth-xy-y" `
      + 'class="text-sm text-gray-700 dark:text-gray-300">Y drives</label><select '
      + `id="synth-xy-y" data-osc="synth.xy.target" class="${SELECT}"><option value="">`
      + `Nothing</option>${xyTargets(panel).map((t) => `<option value="${t.id}"`
      + `${t.id === to ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select>`
      + (xyPatched(model(), panel) ? '' : `<button type="button" data-xy-voice="" class="${BTN}">`
        + 'Patch the pad into the voice</button>')
      + '</div><div class="mt-3" data-osc="synth.xy.pad"></div><p data-osc="synth.xy.readout" '
      + 'class="mt-2 min-h-[1.25rem] font-mono text-sm text-gray-700 dark:text-gray-300"></p>'
      + '</section>';
  }

  function destroy() {
    if (view) view.destroy();
    view = null;
  }

  function act(a, done) {
    if (a.reason) say(a.reason, true);
    else if (dispatch(a.action).ok && done) say(done);
  }

  function voice() {
    const pairs = xyTarget(model(), panel) ? XY_VOICE : [...XY_VOICE, ['xy.y', 'lpf.frequency']];
    act(xyCablesAction(model(), panel, pairs), XY_TEXT.voiced);
  }

  /** The pad over the xy-pad node: X its scale steps, Y the target its Y cable feeds. */
  function mount() {
    destroy();
    const card = tab() === 'xy' && host().querySelector('[data-osc="synth.xy"]');
    if (card) {
      const v = card.querySelector('[data-xy-voice]');
      if (v) v.addEventListener('click', voice);
      const s = card.querySelector('[data-osc="synth.xy.target"]');
      if (s) {
        s.addEventListener('change', () => act(xyTargetAction(model(), panel, s.value || null),
          s.value ? `Y drives ${s.selectedOptions[0].text}.` : 'Y drives nothing.'));
      }
    }
    const box = card && card.querySelector('[data-osc="synth.xy.pad"]');
    const pad = box && nodes().get('xy');
    if (!pad) return;
    const p = pad.params;
    const steps = xyDegree(1, p).steps;
    const deg = (i) => xyDegree((i + 0.5) / steps, p);
    const to = xyTarget(model(), panel);
    const target = to ? jackName(to) : 'nothing';
    const scale = `${p.key} ${SCALE_LABELS[p.mode]}`;
    const out = card.querySelector('[data-osc="synth.xy.readout"]');
    const live = (kind, v) => {
      const t = get().transport;
      const n = nodes().get('xy');
      const r = t && t.playing && n ? t.live(n.id, { kind, x: (v.x + 0.5) / steps, y: v.y })
        : null;
      const d = deg(v.x);
      out.textContent = `${d.name} · degree ${d.degree} of ${scale} · Y ${Math.round(v.y * 100)}`
        + ` % → ${target}${r && r.held ? ' · gate open' : ''}`;
      return r;
    };
    pos = pos && pos.x < steps ? pos : { x: Math.floor(steps / 2), y: 0.5 };
    view = mountXyPad(box, {
      label: `XY pad: pitch in ${scale}, Y to ${target}`,
      description: `X is the pitch: ${steps} steps of ${scale} over ${p.span} oct from `
        + `${p.key}${p.octave}, low at the left. Y drives ${target}, low at the bottom. Arrows `
        + 'move the cursor; hold Enter, or touch, to sound it; Escape releases.',
      cells: Array.from({ length: steps }, (_, i) => ({ label: String(deg(i).degree),
        root: deg(i).degree === 1 })),
      disabled: xyPatched(model(), panel) ? null : XY_TEXT.unpatched,
      x: { key: 'x', label: 'Pitch', type: 'integer', min: 0, max: steps - 1, step: 1,
        default: Math.floor(steps / 2) },
      y: { key: 'y', label: `Y: ${target}`, type: 'number', min: 0, max: 1, default: 0.5 },
      value: pos,
      text: { x: (i) => `${deg(i).name}, degree ${deg(i).degree}`,
        y: (v) => `${Math.round(v * 100)} % to ${target}` },
      onPreview(v) {
        pos = v;
        live('move', v);
      },
      onGate(open, v) {
        pos = v;
        const t = get().transport;
        // The first touch arms the Synth, as the first key does (synth/ui.js synthArm).
        if (open && !(t && t.playing) && !cmp().synthArm()) return;
        live(open ? 'on' : 'off', v);
      },
    });
    live('move', pos);
  }

  function preset(id) {
    if (!nodes().get('xy')) {
      say(XY_TEXT.missing, true);
      return false;
    }
    const recipe = XY_RECIPES.find((x) => x.id === id);
    let a;
    try {
      a = xyPatchAction(model(), panel, xyPresetPatch(model(), panel, recipe));
    } catch (e) {
      a = { reason: e.message };
    }
    if (a.reason) {
      say(a.reason, true);
      return false;
    }
    const done = dispatch(a.action);
    if (done.ok) {
      showTab('xy');
      cmp().synth.preset = id;
      say(`XY preset ${recipe.name}.`);
    }
    return done.ok;
  }

  return {
    presets: XY_RECIPES.map((r) => ({ id: r.id, title: r.name, tab: 'xy' })),
    has: (id) => XY_RECIPES.some((r) => r.id === id),
    html,
    mount,
    destroy,
    preset,
  };
}

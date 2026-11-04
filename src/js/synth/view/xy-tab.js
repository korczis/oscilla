// The Synth workspace's XY tab (plan K097, K167): a Flowbite Pro card over the panel's xy-pad
// node. Its wiring, the pad, the "Y drives" target, Patch the pad into the voice, the presets'
// BATCH and every release path, is the one shared mount of view/xy-wiring.js (mountSynthXy),
// which the live landing calls too; this file keeps none of its own. Composed by synth/ui.js,
// which renders the card into the panel view and mounts the pad after it.
//
// While the panel's keys sound nothing (xy.js keysSilence: the pad's cables replaced their gate
// normals), the Panel tab says why above its cards, with Unpatch the pad, one BATCH (review S8,
// project.no-inert-surfaces); on the XY tab the pad plays, and a key says it (notes-sink.js).
//
//   createXyTab({ panel, get, host, nodes, model, dispatch, say, jackName, tab, showTab, BTN,
//     cmp }) -> { presets, has(id), html(), mount(), destroy(), preset(id) }
//     html() is the tab's markup: the notice on the Panel tab, the card on XY

import { KEYS_SILENT, XY_RECIPES, keysSilence, xyUnpatchAction } from '../xy.js';
import { XY_TEXT, mountSynthXy, xyPresetAction } from './xy-wiring.js';
import { esc } from './face.js';

export { XY_TEXT };

export function createXyTab({ panel, get, host, nodes, model, dispatch, say, jackName, tab,
  showTab, BTN, cmp }) {
  let mounted = null; // the shared mount, re-made with the panel

  /** The Panel tab's notice while the keys sound nothing, with Unpatch the pad when the pad's
   *  cables are the cause (on the XY tab the pad plays, and a key says the same). */
  function silence() {
    const q = tab() === 'panel' ? keysSilence(model(), panel) : null;
    const undo = q && q.pad ? `<button type="button" data-xy-unpatch="" class="${BTN}">`
      + 'Unpatch the pad</button>' : '';
    return q ? '<div class="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-yellow-50 p-3 '
      + 'text-sm text-yellow-800 dark:bg-gray-800 dark:text-yellow-300" role="alert" '
      + `data-osc="synth.keys-silent"><p>${esc(q.reason)}</p>${undo}</div>` : '';
  }

  function unpatchPad() {
    const a = xyUnpatchAction(model(), panel);
    if (a.reason) say(a.reason, true);
    else if (dispatch(a.action).ok) say(KEYS_SILENT.unpatched);
  }

  function html() {
    if (tab() !== 'xy') return silence();
    const card = '<section class="bg-white rounded-lg shadow dark:bg-gray-800 mb-3 p-3" '
      + 'data-osc="synth.xy" aria-labelledby="synth-xy-title"><h3 id="synth-xy-title" '
      + 'class="text-sm font-bold tracking-widest text-gray-900 dark:text-white">XY PAD</h3>';
    if (!nodes().get('xy')) {
      return `${card}<p class="mt-2 text-sm text-gray-700 dark:text-gray-300">This Studio `
        + 'document has no XY pad.</p><button type="button" data-restore-module="xy" '
        + `class="${BTN} mt-2">Add the XY pad</button></section>`;
    }
    return `${card}<div class="mt-2" data-xy-body=""></div></section>`;
  }

  function destroy() {
    if (mounted) mounted.destroy();
    mounted = null;
  }

  /**
   * The first touch arms the Synth (synth/ui.js synthArm). A refusal synthArm said itself is
   * passed on as said; one it did not say is the mount's to say.
   */
  function arm() {
    const c = cmp();
    if (!c) return false;
    c.synth.status = ''; // what synthArm says lands here
    if (c.synthArm()) return true;
    const said = !!c.synth.status;
    return { ok: false, reason: c.synth.status, said };
  }

  function mount() {
    destroy();
    const u = host() && host().querySelector('[data-xy-unpatch]');
    if (u) u.addEventListener('click', unpatchPad);
    const body = tab() === 'xy' && host().querySelector('[data-osc="synth.xy"] [data-xy-body]');
    if (!body || !nodes().get('xy')) return;
    const c = cmp();
    mounted = mountSynthXy(body, { store: get().handle, transport: () => get().transport, panel,
      owner: 'synth', app: c, arm, say, jackName, dispatch, buttonClass: BTN });
  }

  function preset(id) {
    if (!nodes().get('xy')) {
      say(XY_TEXT.missing, true);
      return false;
    }
    const recipe = XY_RECIPES.find((x) => x.id === id);
    const a = xyPresetAction(model(), panel, id);
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

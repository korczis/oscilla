// The two performance pads under the Synth face (plan K220, Q103): one card on the Panel tab
// below the module plates, pad L beside pad R from lg and stacked below it. One pad
// implementation serves both (ui/kinds/xy-pad.js, the xy-pad node of the Studio model): pad R
// is the panel's `xy` module through the XY tab's own shared mount (xy-wiring.js mountSynthXy:
// X a note of the scale, Y the touch's velocity), with its scale picker beside it; pad L is the
// `xyl` module, which plays no notes: its X and Y reach its node through transport.live and its
// typed normals carry them to the LPF and HPF cutoffs (panels/semi-mono.js n25, n26), so a cable
// replaces either as any cable does. Both release on Stop, on leaving the workspace and when the
// audio owner moves away (xy-wiring.js padReleasePaths), and on blur, page hide and Escape (the
// kind's own listeners). Pad R here claims no notes, so the docked keyboard stays (K171 is the
// XY tab's).
//
//   padTargets, mountPadL, PADS_TEXT: xy-wiring.js's (the pad kind's one mount site), re-exported
//   createPads({ panel, get, host, nodes, dispatch, say, jackName, tab, cmp, arm })
//     -> { html(), mount(), destroy(), release(reason) }   html() is '' off the Panel tab

import { NOTE_NAMES, SCALE_LABELS, SCALE_MODES } from '../../core/music.js';
import { esc } from './face.js';
import { PADS_TEXT, mountPadL, mountSynthXy, padTargets } from './xy-wiring.js';

export { PADS_TEXT, mountPadL, padTargets };


const CARD = 'bg-white rounded-lg shadow dark:bg-gray-800 mt-3 p-3';
const H = 'text-sm font-bold tracking-widest text-gray-900 dark:text-white';
const SELECT = 'h-11 rounded-lg border border-solid border-gray-300 bg-gray-50 px-3 text-sm '
  + 'text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white';
const LABEL = 'text-sm text-gray-700 dark:text-gray-300';
const TOGGLE = 'h-11 min-w-11 px-4 text-sm font-medium text-gray-900 bg-white border border-solid '
  + 'border-gray-200 hover:bg-gray-100 aria-pressed:bg-primary-600 aria-pressed:text-white '
  + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-gray-800 '
  + 'dark:text-white dark:border-gray-600 dark:hover:bg-gray-700';

export function createPads({ panel, get, host, nodes, dispatch, say, jackName, tab, cmp, arm }) {
  let left = null;
  let right = null;
  let shown = 'l'; // the pad shown below lg (review R2-K220-2)

  const missing = (id) => {
    const label = panel.module(id).label;
    return `<p class="mt-2 ${LABEL}">${esc(PADS_TEXT.missing(label))}</p><button type="button" `
      + `data-restore-module="${id}" class="mt-2 rounded-lg bg-primary-600 px-4 h-11 text-sm `
      + 'font-medium text-white focus:outline-none focus-visible:ring-2 '
      + `focus-visible:ring-primary-500">${esc(PADS_TEXT.restore(label))}</button>`;
  };
  const scalePicker = (p) => '<div class="mt-2 flex flex-wrap items-center gap-2" '
    + 'data-osc="synth.pads.r.scale">'
    + `<label for="synth-pad-r-key" class="${LABEL}">Tónina</label>`
    + `<select id="synth-pad-r-key" data-pad-param="key" class="${SELECT}">`
    + NOTE_NAMES.map((n) => `<option value="${n}"${n === p.key ? ' selected' : ''}>${n}</option>`)
      .join('')
    + `</select><label for="synth-pad-r-mode" class="${LABEL}">Stupnice</label>`
    + `<select id="synth-pad-r-mode" data-pad-param="mode" class="${SELECT}">`
    + Object.keys(SCALE_MODES).map((m) => `<option value="${m}"${m === p.mode ? ' selected' : ''}`
      + `>${esc(SCALE_LABELS[m])}</option>`).join('')
    + '</select></div>';

  function html() {
    if (tab() !== 'panel') return '';
    const r = nodes().get('xy');
    const l = nodes().get('xyl');
    return `<section class="${CARD}" data-osc="synth.pads" aria-labelledby="synth-pads-title">`
      + `<h3 id="synth-pads-title" class="${H}">${PADS_TEXT.title}</h3>`
      + `<p class="mt-1 ${LABEL}">${PADS_TEXT.intro}</p>`
      // Below lg one pad at a time, chosen here (review R2-K220-2: on a phone the two never fit
      // the screen together); from lg both, side by side.
      + '<div class="mt-2 inline-flex rounded-lg shadow-sm lg:hidden" role="group" '
      + `aria-label="${PADS_TEXT.choose}" data-osc="synth.pads.toggle">`
      + ['l', 'r'].map((k, i) => `<button type="button" data-pad-show="${k}" `
        + `aria-pressed="${k === shown}" class="${TOGGLE} ${i ? 'rounded-e-lg' : 'rounded-s-lg'}">`
        + `PAD ${k.toUpperCase()}</button>`).join('') + '</div>'
      + '<div class="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-2">'
      + `<div data-osc="synth.pads.l" class="${shown === 'l' ? '' : 'max-lg:hidden'}">`
      + '<h4 class="text-xs font-bold tracking-widest '
      + `text-gray-900 dark:text-white">${esc(panel.module('xyl').label)}</h4>`
      + (l ? '<div class="mt-2" data-pad-body=""></div>' : missing('xyl')) + '</div>'
      + `<div data-osc="synth.pads.r" class="${shown === 'r' ? '' : 'max-lg:hidden'}">`
      + '<h4 class="text-xs font-bold tracking-widest text-gray-900 dark:text-white">PAD R</h4>'
      // The scale row below the surface, so pad R's surface sits near pad L's (R2-K220-2).
      + (r ? `<div class="mt-2" data-pad-body=""></div>${scalePicker(r.params)}`
        : missing('xy')) + '</div></div></section>';
  }

  function destroy() {
    if (left) left.destroy();
    if (right) right.destroy();
    left = null;
    right = null;
  }

  function mount() {
    destroy();
    const root = tab() === 'panel' && host().querySelector('[data-osc="synth.pads"]');
    if (!root) return;
    const app = cmp();
    const store = get().handle;
    const transport = () => get().transport;
    const lb = root.querySelector('[data-osc="synth.pads.l"] [data-pad-body]');
    if (lb) left = mountPadL(lb, { store, transport, panel, app, arm, say, jackName });
    const rb = root.querySelector('[data-osc="synth.pads.r"] [data-pad-body]');
    if (rb) {
      right = mountSynthXy(rb, { store, transport, panel, owner: 'synth', app, arm, say,
        jackName, dispatch, claim: false, sampleRate: () => get().sampleRate || null });
    }
    for (const b of root.querySelectorAll('[data-pad-show]')) {
      b.addEventListener('click', () => {
        shown = b.getAttribute('data-pad-show');
        for (const x of root.querySelectorAll('[data-pad-show]')) {
          x.setAttribute('aria-pressed', String(x === b));
        }
        const cols = { l: root.querySelector('[data-osc="synth.pads.l"]'),
          r: root.querySelector('[data-osc="synth.pads.r"]') };
        for (const k of ['l', 'r']) cols[k].classList.toggle('max-lg:hidden', k !== shown);
      });
    }
    for (const s of root.querySelectorAll('[data-pad-param]')) {
      s.addEventListener('change', () => {
        const n = nodes().get('xy');
        const key = s.getAttribute('data-pad-param');
        if (!n || n.params[key] === s.value) return;
        const p = { ...n.params, [key]: s.value };
        if (dispatch({ type: 'NODE_PARAM_SET', nodeId: n.id, key, value: s.value }).ok) {
          say(PADS_TEXT.scale(p.key, SCALE_LABELS[p.mode] || p.mode));
        }
      });
    }
  }

  return { html, mount, destroy, release: (why) => [left, right].reduce((k, m) => k
    + (m ? m.release(why) : 0), 0) };
}

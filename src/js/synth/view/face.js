// A Synth module plate (plan K058, K062): generated from panel.faceOf / fixedOf, so no knob has
// hand-written markup. A Flowbite Pro card holds it; inside, the instrument face is OSCILLA's own
// domain view (knob SVGs, a two-token plate gradient), coloured from tokens only.
//
//   plateHtml({ panel, module, node, model, tokens, collapsed }) -> markup string
//   controlState(panel, module, node, model, control) -> { value, disabled, reason }
//   platesShown({ panel, tab, engine, resolved, model }) -> [module]   the plates of a tab: its
//     modules (on Engines, the chosen one), after any module of another tab that is removed and
//     breaks a normal (an engine gone from the shared chain silences what is before it)

import { choiceLayout, choiceSvg, knobModel, knobSvg, selectorSvg } from './knob.js';
import { ariaAttrs } from '../../ui/synth/knob.js';
import { amountEdges, amountReason, brokenByRemoval, switchEdges } from '../normals.js';
import { CHIP, LABEL, NOTE, VALUE } from '../../ui/synth/label.js';
import { plateSvg } from '../../ui/synth/plate.js';
import { displayHtml } from '../../ui/synth/display.js';

export function platesShown({ panel, tab, engine, resolved, model }) {
  const own = tab === 'engines' ? [panel.module(engine)].filter(Boolean) : panel.modulesOf(tab);
  const gone = brokenByRemoval(model, panel).map((r) => panel.module(r.module))
    .filter((m) => !own.includes(m) && !resolved.get(m.id));
  return [...gone, ...own];
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;',
  '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Random (S&H) controls a patched Clock overrides (nodes/modulation.js random help). */
const SH_CLOCKED = Object.freeze({
  rate: 'Rate applies without a clock; Clock is patched (normalled to the keyboard gate), so '
    + 'each gate steps the value.',
  smooth: 'Smooth applies without a clock; Clock is patched, so each value is held until the '
    + 'next gate.',
});

/**
 * The XY pad's Glide while its Pitch output feeds no cable (K183 review N6), naming the panel's
 * keyboard module by the label the panel draws on it (review of PR 428 NF2: KEYBOARD, not KEYS).
 */
export const xyGlideIdle = (keys) => 'Glide tvaruje vlastní výstup Pitch XY padu, z něhož '
  + `nevede žádný kabel: noty padu kloužou podle Glide modulu ${keys}, jako noty z klávesnice `
  + 'počítače.';

/** Why a control on this face does nothing now, or null (project.no-inert-surfaces (b)). */
export function controlReason(module, node, control, model, panel) {
  if (control.kind === 'amount') return amountReason(model, panel, control.amount);
  if (control.kind === 'cable') return null; // a cable switch patches or removes its cable
  // The node type's own rule (nodes/engines.js `inactive`): data, beside its parameters.
  const own = typeof module.def.inactive === 'function'
    ? module.def.inactive(node.params, control.key) : null;
  if (own) return own;
  if (module.node === 'vco' && control.key === 'width' && node.params.waveform !== 'pulse') {
    return 'Pulse width applies to the pulse wave; choose Pulse to use it.';
  }
  if (module.node === 'ring' && control.key === 'depth' && node.params.mode !== 'am') {
    return 'Depth applies to AM; ring modulation is the full product.';
  }
  // K183 review N6: the pad's notes go through the keys, whose Glide shapes their legato; the
  // pad's own Glide shapes only its Pitch output, live only where a cable leaves it.
  if (module.node === 'xy-pad' && control.key === 'glide'
    && !model.graph.edges.some((e) => e.from.node === node.id && e.from.port === 'pitch')) {
    const keys = panel && typeof panel.module === 'function' ? panel.module('keys') : null;
    return xyGlideIdle(keys && keys.label ? keys.label : 'keyboard');
  }
  if (module.node === 'random' && SH_CLOCKED[control.key]
    && model.graph.edges.some((e) => e.to.node === node.id && e.to.port === 'trigger')) {
    return SH_CLOCKED[control.key];
  }
  return null;
}

export function controlValue(control, node, model, panel) {
  if (control.kind === 'cable') return switchEdges(model, panel, control.cable).length > 0;
  if (control.kind !== 'amount') return node.params[control.key];
  const e = amountEdges(model, panel, control.amount)[0];
  return e ? e.props.depth : 0;
}

// The plate's type and plate are the synth-theme layer's (ui/synth/label.js, plate.js, F013 W1).

/** The accessible name of a control: its module heading, then its own label ("LPF Cutoff"). */
const named = (cid) => `aria-labelledby="synth-m-${cid.split('.')[0]} ${cid}-label"`;
const why = (cid, reason) => (reason ? `<span class="sr-only" id="${cid}-why">${esc(reason)}</span>`
  : '');

const disabled = (cid, reason) => (reason
  ? ` aria-disabled="true" aria-describedby="${cid}-why"` : '');

/** A knob: the layer's (view/knob.js knobSvg), its ARIA N003's position 0..1000 with the value
 *  and unit as text (ariaAttrs), its focus ring the drawing's, shown on keyboard focus. The
 *  readout is one line: the value with a short physical unit only (knobModel format). */
export function knobHtml(cid, c, value, reason, tokens) {
  const a = ariaAttrs(value, c.param);
  return `<div class="flex w-20 flex-col items-center gap-1" data-control="${cid}">`
    + `<span class="${LABEL} text-center leading-tight" id="${cid}-label">${esc(c.label)}</span>`
    + `<div role="${a.role}" tabindex="0" data-knob="${cid}" ${named(cid)} `
    + `aria-valuemin="${a['aria-valuemin']}" aria-valuemax="${a['aria-valuemax']}" `
    + `aria-valuenow="${a['aria-valuenow']}" aria-valuetext="${esc(a['aria-valuetext'])}" `
    + `aria-orientation="vertical"${disabled(cid, reason)} `
    + 'class="group h-16 w-16 cursor-ns-resize touch-none select-none rounded-full outline-none">'
    + `${knobSvg({ uid: cid, value, param: c.param, tokens, disabled: !!reason })}</div>`
    + `<output class="${VALUE} whitespace-nowrap" data-value="${cid}">`
    + `${esc(knobModel(c.param).format(value))}`
    + `</output>${why(cid, reason)}</div>`;
}

const SEG = 'h-11 min-w-[2.75rem] px-2 text-xs font-medium border border-solid '
  + 'border-gray-300 dark:border-gray-600 first:rounded-l-lg last:rounded-r-lg -ml-px first:ml-0 '
  + 'focus:z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
// White on primary-600 is 5.2:1; on primary-500 it was 3.68:1, under the 4.5:1 text floor.
const SEG_ON = 'bg-primary-600 text-white';
const SEG_OFF = 'bg-white text-gray-900 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-200 '
  + 'dark:hover:bg-gray-600';

/** A choice's option: an invisible 44 px radio over its legend (the legend is the drawing's
 *  silk-screened text), its name that legend for a screen reader. It shows only its target: a
 *  thin ring on hover and Pro's focus ring on keyboard focus, both inside its box. */
const RADIO = 'block h-full w-full rounded-md border-0 bg-transparent p-0 text-xs '
  + 'hover:ring-1 hover:ring-inset hover:ring-gray-400 dark:hover:ring-gray-500 '
  + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset '
  + 'focus-visible:ring-primary-500';

/** A choice (V8 of the SYN review): ONE control, the layer's switch by its position count (a
 *  lever for two, a slide for three or four, a detented rotary for five to eight, a rotary with
 *  a window for nine to twelve), drawn at 1:1 with its legends round it as panel text, so no
 *  legend group can wrap (V9). A dial wider than the narrowest plate (CHOICE_MAX_PX) has its
 *  legends packed below it (view/knob.js choiceLayout), so every choice fits every plate at
 *  every width. Each option is a radio button over its legend at the layout's 44 px hit box,
 *  named by that legend (a packed grid's "n · label"); the drawing itself takes no press.
 *  The radios run in the drawn order (review of W1c, finding 1): a lever's and a slide's top
 *  to bottom (the core draws option 0 at the bottom), a dial's clockwise, a grid's row by row,
 *  so Tab and a screen reader meet the top legend first. The group is one tab stop (finding
 *  2): the checked radio has tabindex 0, every other -1 (or the first drawn, if none is). */
function switchHtml(cid, c, value, reason, tokens) {
  const L = choiceLayout(c.param);
  const b = L.box;
  const drawn = L.style === 'toggle' || L.style === 'slide'
    ? [...L.options].sort((p, q) => p.legend.y - q.legend.y) : L.options;
  const stop = drawn.find((o) => o.value === value) || drawn[0];
  const radios = drawn.map((o) => `<foreignObject x="${o.hit.x}" y="${o.hit.y}" `
    + `width="${o.hit.width}" height="${o.hit.height}"><button type="button" role="radio" `
    + `aria-checked="${o.value === value}" data-option="${cid}" data-v="${esc(o.value)}" `
    + `tabindex="${o === stop ? 0 : -1}" `
    + `class="${RADIO} ${reason ? 'cursor-not-allowed' : 'cursor-pointer'}">`
    + `<span class="sr-only">${esc(o.legend.text)}</span></button></foreignObject>`).join('');
  return `<div class="flex flex-col gap-1" data-control="${cid}">`
    + `<span class="${LABEL}" id="${cid}-label">${esc(c.label)}</span>`
    + `<svg viewBox="${b.x} ${b.y} ${b.width} ${b.height}" width="${b.width}" height="${b.height}" `
    + `role="radiogroup" ${named(cid)}${disabled(cid, reason)} class="shrink-0 overflow-visible" `
    + `data-style="${L.style}">`
    + `${choiceSvg({ value, param: c.param, tokens, disabled: !!reason })}${radios}</svg>`
    + `${why(cid, reason)}</div>`;
}

/** A toggle: the layer's two-position switch at its state, beside its On/Off button. */
function toggleHtml(cid, c, value, reason, tokens) {
  return `<div class="flex flex-col gap-1" data-control="${cid}">`
    + `<span class="${LABEL}" id="${cid}-label">${esc(c.label)}</span>`
    + '<div class="flex items-center gap-2">'
    + `${selectorSvg({ value: !!value, param: c.param, tokens, disabled: !!reason })}`
    + `<button type="button" aria-pressed="${!!value}" data-toggle="${cid}" `
    + `${named(cid)}${disabled(cid, reason)} class="${SEG} rounded-lg `
    + `${value ? SEG_ON : SEG_OFF}">${value ? 'On' : 'Off'}</button></div>`
    + `${why(cid, reason)}</div>`;
}

/**
 * A readout derived from the parameters (the node type's `facts`, nodes/engines.js): computed,
 * never observed, and labelled so (project.no-fake-science).
 */
function factsHtml(m, node) {
  if (typeof m.def.facts !== 'function') return '';
  return displayHtml({ id: m.id, text: m.def.facts(node.params) });
}

/**
 * The plate of one module: header, face controls, locked values and the module's note. The
 * header is a disclosure button (K062): a collapsed card keeps its label and a one-line
 * summary from the registry; its jacks stay on the patch bay.
 */
export function plateHtml({ panel, module: m, node, model, tokens, collapsed = false }) {
  const hid = `synth-m-${m.id}`;
  const bid = `synth-b-${m.id}`;
  const summary = node && typeof m.def.summary === 'function' ? m.def.summary(node.params) : '';
  const head = `<header class="relative flex items-center justify-between gap-2 px-1 pt-1">`
    + `<h3 id="${hid}" class="text-sm font-bold tracking-widest text-gray-900 dark:text-white">`
    + `<button type="button" data-collapse="${m.id}" aria-expanded="${!collapsed}" `
    + `aria-controls="${bid}" class="flex h-11 items-center gap-2 rounded-lg border-0 `
    + 'bg-transparent px-2 tracking-widest text-gray-900 hover:text-primary-600 '
    + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-white '
    + 'dark:hover:text-primary-400">'
    + `<span aria-hidden="true" class="text-xs">${collapsed ? '▸' : '▾'}</span>${esc(m.label)}`
    + `</button></h3><span class="px-2 ${NOTE}">`
    + `${esc(m.def.displayName)}</span></header>`;
  const bg = plateSvg({ id: m.id, tokens });
  if (!node) {
    const row = model ? brokenByRemoval(model, panel).find((r) => r.module === m.id) : null;
    return `<section class="relative overflow-hidden bg-white rounded-lg shadow dark:bg-gray-800" `
      + `aria-labelledby="${hid}" data-module="${m.id}">${bg}${head}`
      + '<p class="relative px-3 pb-3 text-sm text-gray-600 dark:text-gray-300">This module was '
      + 'removed in Studio'
      + (row ? `, so its normals no longer reach ${esc(row.jacks.join(', '))}` : '')
      + '. <button type="button" class="font-medium text-primary-600 underline '
      + `dark:text-primary-400" data-restore-module="${m.id}">Restore module</button></p>`
      + '</section>';
  }
  if (collapsed) {
    return `<section class="relative overflow-hidden bg-white rounded-lg shadow dark:bg-gray-800" `
      + `aria-labelledby="${hid}" data-module="${m.id}">${bg}${head}<p id="${bid}" `
      + 'class="relative px-3 pb-3 text-xs text-gray-700 dark:text-gray-300" '
      + `data-summary="${m.id}">${esc(summary || m.def.displayName)}</p></section>`;
  }
  const controls = panel.faceOf(m.id).map((c) => {
    const cid = `${m.id}.${c.key}`;
    const value = controlValue(c, node, model, panel);
    const reason = controlReason(m, node, c, model, panel);
    if (c.kind === 'switch') return switchHtml(cid, c, value, reason, tokens);
    if (c.kind === 'toggle' || c.kind === 'cable') { // K229: a cable switch is a toggle
      return toggleHtml(cid, c, value, reason, tokens);
    }
    if (c.kind === 'list') {
      return `<p class="${VALUE}">${esc(c.label)}: ${value.length} values (edit in Studio)</p>`;
    }
    return knobHtml(cid, c, value, reason, tokens);
  }).join('');
  const fixed = panel.fixedOf(m.id).map((f) => {
    const p = m.params.find((x) => x.key === f.key);
    const shown = p.type === 'enum' ? (p.options.find((o) => o[0] === f.value) || [0, f.value])[1]
      : knobModel(p).format(f.value);
    return `<span class="${CHIP}" title="Fixed by the panel">${esc(f.label)} `
      + `${esc(shown)}</span>`;
  }).join('');
  return '<section class="relative overflow-hidden bg-white rounded-lg shadow '
    + 'dark:bg-gray-800" '
    + `aria-labelledby="${hid}" data-module="${m.id}">${bg}${head}<div id="${bid}">`
    + `<div class="relative flex flex-wrap items-start gap-x-2 gap-y-3 px-3 pb-3 pt-2">`
    + `${controls}</div>`
    + (fixed || m.note ? `<div class="relative flex flex-wrap items-center gap-1 px-3 pb-3">`
      + `${fixed}${m.note ? `<span class="${NOTE}">`
      + `${esc(m.note)}</span>` : ''}</div>` : '')
    + factsHtml(m, node)
    + '</div></section>';
}

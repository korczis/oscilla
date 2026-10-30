// A Synth module plate (plan K058, K062): generated from panel.faceOf / fixedOf, so no knob has
// hand-written markup. A Flowbite Pro card holds it; inside, the instrument face is OSCILLA's own
// domain view (knob SVGs, a two-token plate gradient), coloured from tokens only.
//
//   plateHtml({ panel, module, node, model, tokens, reasons }) -> markup string
//   controlState(panel, module, node, model, control) -> { value, disabled, reason }

import { knobModel, knobSvg } from './knob.js';
import { amountEdges, amountReason } from '../normals.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;',
  '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Why a control on this face does nothing now, or null (project.no-inert-surfaces (b)). */
export function controlReason(module, node, control, model, panel) {
  if (control.kind === 'amount') return amountReason(model, panel, control.amount);
  if (module.node === 'vco' && control.key === 'width' && node.params.waveform !== 'pulse') {
    return 'Pulse width applies to the pulse wave; choose Pulse to use it.';
  }
  if (module.node === 'ring' && control.key === 'depth' && node.params.mode !== 'am') {
    return 'Depth applies to AM; ring modulation is the full product.';
  }
  return null;
}

export function controlValue(control, node, model, panel) {
  if (control.kind !== 'amount') return node.params[control.key];
  const e = amountEdges(model, panel, control.amount)[0];
  return e ? e.props.depth : 0;
}

const LABEL = 'text-[11px] font-semibold uppercase tracking-wide text-gray-500 '
  + 'dark:text-gray-400';
const VALUE = 'font-mono text-xs tabular-nums text-gray-900 dark:text-white';

function knobHtml(cid, c, value, reason, tokens) {
  const m = knobModel(c.param);
  const dis = reason ? ` aria-disabled="true" aria-describedby="${cid}-why"` : '';
  return `<div class="flex w-20 flex-col items-center gap-1" data-control="${cid}">`
    + `<span class="${LABEL} text-center leading-tight" id="${cid}-label">${esc(c.label)}</span>`
    + `<div role="slider" tabindex="0" data-knob="${cid}" aria-labelledby="${cid}-label" `
    + `aria-valuemin="${c.param.min}" aria-valuemax="${c.param.max}" aria-valuenow="${value}" `
    + `aria-valuetext="${esc(m.text(value))}" aria-orientation="vertical"${dis} `
    + 'class="h-16 w-16 cursor-ns-resize touch-none select-none rounded-full outline-none '
    + 'focus-visible:ring-2 focus-visible:ring-primary-500">'
    + `${knobSvg({ uid: cid, value, param: c.param, tokens, disabled: !!reason })}</div>`
    + `<output class="${VALUE}" data-value="${cid}">${esc(m.format(value))}</output>`
    + (reason ? `<span class="sr-only" id="${cid}-why">${esc(reason)}</span>` : '')
    + '</div>';
}

const SEG = 'h-11 min-w-[2.75rem] px-2 text-xs font-medium border border-solid '
  + 'border-gray-300 dark:border-gray-600 first:rounded-l-lg last:rounded-r-lg -ml-px first:ml-0 '
  + 'focus:z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const SEG_ON = 'bg-primary-600 text-white dark:bg-primary-500';
const SEG_OFF = 'bg-white text-gray-900 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-200 '
  + 'dark:hover:bg-gray-600';

function switchHtml(cid, c, value) {
  const opts = c.param.options.map(([v, label]) => `<button type="button" role="radio" `
    + `aria-checked="${v === value}" data-option="${cid}" data-v="${esc(v)}" `
    + `class="${SEG} ${v === value ? SEG_ON : SEG_OFF}">${esc(label)}</button>`).join('');
  return `<div class="flex flex-col gap-1" data-control="${cid}">`
    + `<span class="${LABEL}" id="${cid}-label">${esc(c.label)}</span>`
    + `<div role="radiogroup" aria-labelledby="${cid}-label" class="flex flex-wrap">${opts}</div>`
    + '</div>';
}

function toggleHtml(cid, c, value) {
  return `<div class="flex flex-col gap-1" data-control="${cid}">`
    + `<span class="${LABEL}" id="${cid}-label">${esc(c.label)}</span>`
    + `<button type="button" aria-pressed="${!!value}" data-toggle="${cid}" `
    + `aria-labelledby="${cid}-label" class="${SEG} rounded-lg ${value ? SEG_ON : SEG_OFF}">`
    + `${value ? 'On' : 'Off'}</button></div>`;
}

/** The plate of one module: header, face controls, locked values and the module's note. */
export function plateHtml({ panel, module: m, node, model, tokens }) {
  const hid = `synth-m-${m.id}`;
  const head = `<header class="relative flex items-baseline justify-between gap-2 px-3 pt-2">`
    + `<h3 id="${hid}" class="text-sm font-bold tracking-widest text-gray-900 dark:text-white">`
    + `${esc(m.label)}</h3><span class="text-[11px] text-gray-500 dark:text-gray-400">`
    + `${esc(m.def.displayName)}</span></header>`;
  const bg = '<svg class="absolute inset-0 h-full w-full" preserveAspectRatio="none" '
    + 'aria-hidden="true" focusable="false"><defs>'
    + `<linearGradient id="pg-${m.id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${tokens.plateHi}"/>`
    + `<stop offset="1" stop-color="${tokens.plateLo}"/></linearGradient></defs>`
    + `<rect width="100%" height="100%" fill="url(#pg-${m.id})"/></svg>`;
  if (!node) {
    return `<section class="relative overflow-hidden bg-white rounded-lg shadow dark:bg-gray-800" `
      + `aria-labelledby="${hid}" data-module="${m.id}">${bg}${head}`
      + '<p class="relative px-3 pb-3 text-sm text-gray-600 dark:text-gray-300">This module was '
      + 'removed in Studio. <button type="button" class="font-medium text-primary-600 underline '
      + `dark:text-primary-400" data-restore-module="${m.id}">Restore module</button></p>`
      + '</section>';
  }
  const controls = panel.faceOf(m.id).map((c) => {
    const cid = `${m.id}.${c.key}`;
    const value = controlValue(c, node, model, panel);
    if (c.kind === 'switch') return switchHtml(cid, c, value);
    if (c.kind === 'toggle') return toggleHtml(cid, c, value);
    if (c.kind === 'list') {
      return `<p class="${VALUE}">${esc(c.label)}: ${value.length} values (edit in Studio)</p>`;
    }
    return knobHtml(cid, c, value, controlReason(m, node, c, model, panel), tokens);
  }).join('');
  const fixed = panel.fixedOf(m.id).map((f) => {
    const p = m.params.find((x) => x.key === f.key);
    const shown = p.type === 'enum' ? (p.options.find((o) => o[0] === f.value) || [0, f.value])[1]
      : knobModel(p).format(f.value);
    return `<span class="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 `
      + `dark:bg-gray-700 dark:text-gray-300" title="Fixed by the panel">${esc(f.label)} `
      + `${esc(shown)}</span>`;
  }).join('');
  return `<section class="relative overflow-hidden bg-white rounded-lg shadow dark:bg-gray-800" `
    + `aria-labelledby="${hid}" data-module="${m.id}">${bg}${head}`
    + `<div class="relative flex flex-wrap items-start gap-x-2 gap-y-3 px-3 pb-3 pt-2">`
    + `${controls}</div>`
    + (fixed || m.note ? `<div class="relative flex flex-wrap items-center gap-1 px-3 pb-3">`
      + `${fixed}${m.note ? `<span class="text-[11px] text-gray-500 dark:text-gray-400">`
      + `${esc(m.note)}</span>` : ''}</div>` : '')
    + '</section>';
}

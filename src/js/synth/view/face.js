// A Synth module plate (plan K058, K062): generated from panel.faceOf / fixedOf, so no knob has
// hand-written markup. A Flowbite Pro card holds it; inside, the instrument face is OSCILLA's own
// domain view (knob SVGs, a two-token plate gradient), coloured from tokens only.
//
//   plateHtml({ panel, module, node, model, tokens, collapsed }) -> markup string
//   controlState(panel, module, node, model, control) -> { value, disabled, reason }
//   platesShown({ panel, tab, engine, resolved, model }) -> [module]   the plates of a tab: its
//     modules (on Engines, the chosen one), after any module of another tab that is removed and
//     breaks a normal (an engine gone from the shared chain silences what is before it)

import { knobModel, knobSvg } from './knob.js';
import { amountEdges, amountReason, brokenByRemoval } from '../normals.js';

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

/** Why a control on this face does nothing now, or null (project.no-inert-surfaces (b)). */
export function controlReason(module, node, control, model, panel) {
  if (control.kind === 'amount') return amountReason(model, panel, control.amount);
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
  if (module.node === 'random' && SH_CLOCKED[control.key]
    && model.graph.edges.some((e) => e.to.node === node.id && e.to.port === 'trigger')) {
    return SH_CLOCKED[control.key];
  }
  return null;
}

export function controlValue(control, node, model, panel) {
  if (control.kind !== 'amount') return node.params[control.key];
  const e = amountEdges(model, panel, control.amount)[0];
  return e ? e.props.depth : 0;
}

// Labels sit on the plate gradient (surface-3 to surface-1): gray-600 is 6.2:1 on its light top,
// gray-400 5.8:1 or more on the dark one (4.5:1 for small text).
const LABEL = 'text-[11px] font-semibold uppercase tracking-wide text-gray-600 '
  + 'dark:text-gray-400';
const VALUE = 'font-mono text-xs tabular-nums text-gray-900 dark:text-white';

/** The accessible name of a control: its module heading, then its own label ("LPF Cutoff"). */
const named = (cid) => `aria-labelledby="synth-m-${cid.split('.')[0]} ${cid}-label"`;
const why = (cid, reason) => (reason ? `<span class="sr-only" id="${cid}-why">${esc(reason)}</span>`
  : '');

function knobHtml(cid, c, value, reason, tokens) {
  const m = knobModel(c.param);
  const dis = reason ? ` aria-disabled="true" aria-describedby="${cid}-why"` : '';
  return `<div class="flex w-20 flex-col items-center gap-1" data-control="${cid}">`
    + `<span class="${LABEL} text-center leading-tight" id="${cid}-label">${esc(c.label)}</span>`
    + `<div role="slider" tabindex="0" data-knob="${cid}" ${named(cid)} `
    + `aria-valuemin="${c.param.min}" aria-valuemax="${c.param.max}" aria-valuenow="${value}" `
    + `aria-valuetext="${esc(m.text(value))}" aria-orientation="vertical"${dis} `
    + 'class="h-16 w-16 cursor-ns-resize touch-none select-none rounded-full outline-none '
    + 'focus-visible:ring-2 focus-visible:ring-primary-500">'
    + `${knobSvg({ uid: cid, value, param: c.param, tokens, disabled: !!reason })}</div>`
    + `<output class="${VALUE}" data-value="${cid}">${esc(m.format(value))}</output>`
    + `${why(cid, reason)}</div>`;
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
    + `<div role="radiogroup" ${named(cid)} class="flex flex-wrap">${opts}</div>`
    + '</div>';
}

function toggleHtml(cid, c, value, reason) {
  const dis = reason ? ` aria-disabled="true" aria-describedby="${cid}-why"` : '';
  return `<div class="flex flex-col gap-1" data-control="${cid}">`
    + `<span class="${LABEL}" id="${cid}-label">${esc(c.label)}</span>`
    + `<button type="button" aria-pressed="${!!value}" data-toggle="${cid}" `
    + `${named(cid)}${dis} class="${SEG} rounded-lg ${value ? SEG_ON : SEG_OFF}">`
    + `${value ? 'On' : 'Off'}</button>${why(cid, reason)}</div>`;
}

/**
 * A readout derived from the parameters (the node type's `facts`, nodes/engines.js): computed,
 * never observed, and labelled so (project.no-fake-science).
 */
function factsHtml(m, node) {
  if (typeof m.def.facts !== 'function') return '';
  return '<p class="relative px-3 pb-3 text-[11px] leading-snug text-gray-600 '
    + `dark:text-gray-300" data-facts="${m.id}"><span class="font-semibold">Computed from the `
    + `settings:</span> ${esc(m.def.facts(node.params))}</p>`;
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
    + `aria-controls="${bid}" class="flex h-11 items-center gap-2 rounded-lg px-2 `
    + 'tracking-widest focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">'
    + `<span aria-hidden="true" class="text-xs">${collapsed ? '▸' : '▾'}</span>${esc(m.label)}`
    + '</button></h3><span class="px-2 text-[11px] text-gray-600 dark:text-gray-400">'
    + `${esc(m.def.displayName)}</span></header>`;
  const bg = '<svg class="absolute inset-0 h-full w-full" preserveAspectRatio="none" '
    + 'aria-hidden="true" focusable="false"><defs>'
    + `<linearGradient id="pg-${m.id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${tokens.plateHi}"/>`
    + `<stop offset="1" stop-color="${tokens.plateLo}"/></linearGradient></defs>`
    + `<rect width="100%" height="100%" fill="url(#pg-${m.id})" stroke="none"/></svg>`;
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
    if (c.kind === 'switch') return switchHtml(cid, c, value);
    const reason = controlReason(m, node, c, model, panel);
    if (c.kind === 'toggle') return toggleHtml(cid, c, value, reason);
    if (c.kind === 'list') {
      return `<p class="${VALUE}">${esc(c.label)}: ${value.length} values (edit in Studio)</p>`;
    }
    return knobHtml(cid, c, value, reason, tokens);
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
    + `aria-labelledby="${hid}" data-module="${m.id}">${bg}${head}<div id="${bid}">`
    + `<div class="relative flex flex-wrap items-start gap-x-2 gap-y-3 px-3 pb-3 pt-2">`
    + `${controls}</div>`
    + (fixed || m.note ? `<div class="relative flex flex-wrap items-center gap-1 px-3 pb-3">`
      + `${fixed}${m.note ? `<span class="text-[11px] text-gray-600 dark:text-gray-400">`
      + `${esc(m.note)}</span>` : ''}</div>` : '')
    + factsHtml(m, node)
    + '</div></section>';
}

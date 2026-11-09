// The Synth patch bay (plan K063; design §3, §5): the generic patch bay of ui/patch/patch-bay.js
// over the panel's modules, in panel order. This file adapts the panel to the bay's source
// shape and keeps the names ui.js and the tests use.
//
//   panelSource(panel) -> { groups, nameOf }   every module with its jacks (panel.jacksOf)
//   bayLayout(panel, width), baySvg({ panel, ... }), jackLabel(panel, jack, state, verdict)
//   cableItem(cable, toState, { jackName, item, btn }) -> one row of the CABLES list: the
//     cable, ", přičítá se k normálům" where its target jack sums (K183), and its Remove button
//   connectListHtml({ pending, verdicts, cables, jackName, jackOf, item, btn }) -> the connection
//     list of a pending jack (K063): its cables to remove, the jacks that take the cable, the
//     refused ones with the validator's sentence, and Cancel
//   cableListHtml({ cables, states, gone, mixed, open, jackName, mixedText, item, btn }) -> the
//     CABLES list: each cable, each module gone in the Studio, each mixed and open normal, or
//     the empty-list sentence

import { patchLayout, patchSvg, portLabel } from '../../ui/patch/patch-bay.js';
import { esc } from './face.js';

export {
  BAY_TEXT, JACK_HIT, JACK_PITCH, LABEL_MAX, ROW_PITCH, cablePath, shortLabel,
} from '../../ui/patch/patch-bay.js';

const sources = new WeakMap();
export function panelSource(panel) {
  if (!sources.has(panel)) {
    sources.set(panel, { get groups() {
      return panel.modules.map((m) => ({ id: m.id, label: m.label, jacks: panel.jacksOf(m.id) }));
    }, nameOf: (id) => panel.module(id).label });
  }
  return sources.get(panel);
}

export const bayLayout = (panel, width) => patchLayout(panelSource(panel), width);
export const baySvg = ({ panel, ...rest }) => patchSvg({ source: panelSource(panel), ...rest });
export const jackLabel = (panel, j, st, verdict = null) => portLabel(panelSource(panel), j, st,
  verdict);

export function cableItem(c, toState, { jackName, item, btn }) {
  const from = esc(jackName(c.from));
  const to = esc(jackName(c.to));
  return `<li class="${item}"><span>${from} → ${to}${toState === 'summing'
    ? ', přičítá se k normálům' : ''}</span><button type="button" class="${btn}" `
    + `data-remove-cable="${esc(c.id)}" aria-label="Odpojit kabel ${from} → ${to}">Odpojit`
    + '</button></li>';
}

export function connectListHtml({ pending, verdicts, cables, jackName, jackOf, item, btn }) {
  const a = jackOf(pending);
  if (!a) return '';
  const name = (k) => `${jackName(k)} ${jackOf(k).direction === 'in' ? 'vstup' : 'výstup'}`;
  const ok = [...verdicts].filter(([, v]) => v.ok).map(([k]) => `<li class="${item}">`
    + `<span>${esc(name(k))}</span><button type="button" class="${btn}" data-connect-to=`
    + `"${esc(k)}" aria-label="Patch ${esc(jackName(pending))} to ${esc(name(k))}">Patch`
    + '</button></li>').join('');
  const no = [...verdicts].filter(([, v]) => !v.ok).map(([k, v]) => '<li class="py-1 text-xs '
    + `text-gray-600 dark:text-gray-400"><s>${esc(name(k))}</s>: ${esc(v.reason)}</li>`)
    .join('');
  const mine = cables.filter((c) => `${c.from}:out` === pending || `${c.to}:in` === pending)
    .map((c) => `<li class="${item}"><span>${esc(jackName(c.from))} → ${esc(jackName(c.to))}`
    + `</span><button type="button" class="${btn}" data-remove-cable="${esc(c.id)}">Odpojit `
    + 'kabel</button></li>').join('');
  return `<h4 class="mt-3 text-xs font-bold tracking-widest text-gray-900 dark:text-white" `
    + `id="synth-connect-title">PROPOJIT Z ${esc(name(pending).toUpperCase())}</h4>`
    + '<ul class="divide-y divide-gray-200 dark:divide-gray-700" '
    + `aria-labelledby="synth-connect-title">${mine}${ok}${no}</ul>`
    + `<button type="button" class="${btn} mt-2" data-connect-cancel="">Cancel</button>`;
}

export function cableListHtml({ cables, states, gone, mixed, open, jackName, mixedText, item,
  btn }) {
  return cables.map((c) => cableItem(c, states.get(`${c.to}:in`), { jackName, item, btn }))
    .join('')
    + gone.map((r) => `<li class="${item}" data-gone="${r.module}"><span>${esc(r.label)} `
    + `odstraněn ve Studiu, bez signálu: ${esc(r.jacks.join(', '))}</span><button `
    + `type="button" class="${btn}" data-restore-module="${r.module}">Obnovit modul`
    + '</button></li>').join('')
    + mixed.map((j) => `<li class="${item}"><span>${esc(jackName(j))}: ${mixedText}`
    + `</span><button type="button" class="${btn}" data-break-normal="${esc(j)}">`
    + 'Rozpojit normál</button></li>').join('')
    + open.map((j) => `<li class="${item}"><span>${esc(jackName(j))}: bez signálu, normál `
    + `odstraněn ve Studiu</span><button type="button" class="${btn}" `
    + `data-restore-normal="${esc(j)}">Obnovit normál</button></li>`).join('')
    + (cables.length || open.length || mixed.length || gone.length ? ''
      : `<li class="${item}">Žádné kabely: každý vstup hraje svůj normál. `
      + 'Táhněte z jednoho konektoru na druhý, nebo klepněte na dva konektory.</li>');
}

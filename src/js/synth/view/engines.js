// The Engines tab's own markup and wording (plan K090-K092, K121-K123), split from synth/ui.js:
// pure functions of the panel and the state they are given, no DOM and no store.
//
//   CHIP                                          the chip classes of the section and engine bars
//   enginePickerHtml({ panel, ids, on, resolved }) -> markup   the engine radio group, then the
//                                                  blocked engines, each with its reason; `on`
//                                                  null (the keys play a node outside the
//                                                  engines, picker.js playedEngine): none
//                                                  checked, and a sentence says so
//   droppedText(node, dropped) -> sentence         what a note left out above 0.95 × Nyquist

import { esc } from './face.js';
import { ENGINE_BLOCKED } from '../panels/engines.js';
import { SAFE_NYQUIST_FACTOR_TEXT } from '../../core/constants.js';

export const CHIP = 'snap-start shrink-0 rounded-full border border-solid px-3 h-11 text-xs '
  + 'font-semibold tracking-wide';

export function enginePickerHtml({ panel, ids, on, resolved }) {
  return '<div role="radiogroup" aria-label="Engine the keys play" class="flex shrink-0 '
    + 'gap-2 lg:flex-wrap">' + ids.map((id) => {
    const x = panel.module(id);
    const sel = id === on;
    return `<button type="button" role="radio" aria-checked="${sel}" data-engine="${id}" `
      + `class="${CHIP} ${sel ? 'border-primary-600 bg-primary-600 text-white '
        + 'dark:bg-primary-500' : 'border-gray-300 bg-white text-gray-800 '
        + 'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'}">${esc(x.label)}`
      + `${resolved.get(id) ? '' : ' (removed)'}</button>`;
  }).join('') + '</div>' + ENGINE_BLOCKED.map((b) => `<button type="button" aria-disabled="true" `
    + `aria-describedby="synth-blocked-${b.id}" data-blocked="${b.id}" class="${CHIP} `
    + 'cursor-not-allowed border-dashed border-gray-300 bg-gray-100 text-gray-500 '
    + `dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400">${esc(b.label)}<span `
    + `class="sr-only" id="synth-blocked-${b.id}">${esc(b.reason)}</span></button>`).join('')
    + (on ? '' : `<p class="${CHIP} flex items-center border-transparent font-normal `
      + 'text-gray-700 dark:text-gray-300" data-osc="synth.engine-elsewhere">'
      + `${ELSEWHERE}</p>`);
}

/** The Engines tab while the keys play a node outside its engines (review S4). */
export const ELSEWHERE = 'Klávesy hrají uzel zvolený tlačítkem Hraje vedle klavíru; chcete-li '
  + 'hrát engine, zvolte ho zde.';

/** The status sentence for a note that left `dropped` items out (FM operators, AM's modulator). */
export function droppedText(node, dropped) {
  const limit = `${SAFE_NYQUIST_FACTOR_TEXT} × digitální Nyquistovou mezí`;
  if (node.type === 'fm-voice') {
    return `Operátory nad ${limit} vynechané z této noty: ${dropped}.`;
  }
  if (node.type === 'am-voice') {
    return `Modulátor je nad ${limit}: tato nota ${node.params.mode === 'ring'
      ? 'mlčí (kruhová modulace)' : 'hraje jen nosnou'}.`;
  }
  return `Harmonické nad ${limit} vypuštěné z této noty: ${dropped}.`;
}

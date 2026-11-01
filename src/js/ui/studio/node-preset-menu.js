// The Inspector's node preset dropdown (plan K020): a Flowbite Pro dropdown (a menu button and
// its role=menu) of studio/node-presets.js nodePresets for the node's type: the factory presets,
// then the person's saved one-node patches of that type, read when the menu opens. Choosing one
// dispatches its PATCH_REPLACE { onto }: the node's parameters only, one undo entry, every edge
// kept. Arrows move, Enter chooses, Escape closes and returns focus to the button.
//
//   presetMenu(view, svc) -> element    svc: { store, announce, userPatches() -> Promise<[{ id,
//                                         patch }]>, openLibrary() (the K102 patch library) }

import { nodePresetAction, nodePresets } from '../../studio/node-presets.js';
import { announceAction } from '../../studio/a11y.js';
import { h, replaceChildren } from './graph-dom.js';

const BTN = 'inline-flex h-11 items-center gap-1 rounded-lg border border-solid border-gray-300 '
  + 'bg-white px-3 text-sm font-medium text-gray-900 hover:bg-gray-100 focus:outline-none '
  + 'focus-visible:ring-2 focus-visible:ring-primary-300 dark:border-gray-600 dark:bg-gray-800 '
  + 'dark:text-white dark:hover:bg-gray-700';
const ITEM = 'flex h-11 w-full items-center justify-between gap-2 border-0 bg-transparent px-4 '
  + 'text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none '
  + 'dark:text-gray-200 dark:hover:bg-gray-600 dark:focus:bg-gray-600';

export function presetMenu(view, svc) {
  const menuId = `osc-si-${view.id}-presets`;
  const menu = h('ul', { id: menuId, role: 'menu', hidden: true, 'aria-label': 'Presets',
    'data-osc': 'studio.inspector.presets.menu',
    class: 'absolute left-0 z-40 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg bg-white py-2 '
      + 'shadow dark:bg-gray-700' });
  const button = h('button', { type: 'button', class: BTN, 'aria-haspopup': 'menu',
    'aria-expanded': 'false', 'aria-controls': menuId, 'data-key': 'studio.inspector.presets',
    'data-osc': 'studio.inspector.presets', text: 'Presets' });
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
  const close = (focus) => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus();
  };
  const choose = (entry) => {
    close(true);
    const model = svc.store.getModel();
    const r = nodePresetAction(model, view.id, entry);
    const res = r.action ? svc.store.dispatch(r.action) : { ok: false, reason: r.reason };
    svc.announce(res.ok ? `Preset ${entry.name}` : announceAction(res), { assertive: !res.ok });
  };
  const fill = (user) => {
    const list = nodePresets(view.type, { user });
    const row = (e) => h('li', { role: 'none' }, [h('button', { type: 'button', role: 'menuitem',
      class: ITEM, 'data-preset': e.id, onClick: () => choose(e) }, [
      h('span', { text: e.name }),
      h('span', { class: 'text-xs text-gray-500 dark:text-gray-400',
        text: e.source === 'user' ? 'Saved' : 'Factory' })])]);
    const more = svc.openLibrary ? h('li', { role: 'none' }, [h('button', { type: 'button',
      role: 'menuitem', class: ITEM, 'data-osc': 'studio.inspector.presets.library',
      text: 'Open the patch library…', onClick: () => { close(false); svc.openLibrary(); } })])
      : null;
    replaceChildren(menu, [...list.map(row), more]);
  };
  button.addEventListener('click', async () => {
    if (!menu.hidden) {
      close(false);
      return;
    }
    fill([]);
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    items()[0].focus();
    const user = await svc.userPatches().catch(() => []);
    if (!menu.hidden && user.length) {
      fill(user);
      items()[0].focus();
    }
  });
  menu.addEventListener('keydown', (e) => {
    const all = items();
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (step) {
      e.preventDefault();
      all[(all.indexOf(document.activeElement) + step + all.length) % all.length].focus();
    }
  });
  return h('div', { class: 'relative mb-3', 'data-osc': 'studio.inspector.presetsBox' },
    [button, menu]);
}

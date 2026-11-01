// The patch library (plan K102): ONE tagged browser of studio/patch-catalog.js, shared by the
// Synth workspace and the Studio: one mount, one store, in the Studio's existing Projects and
// patches dialog (no second dialog; the saved records stay listed there for Open, Export and
// Delete). A Flowbite Pro section with a search input, an instrument and a tag select (exact filters), a role=listbox of the
// patches (arrows, Home, End; Enter loads the active one the first way it offers) and the
// active patch's actions: Apply (its parameters onto the nodes it names), Insert (new nodes;
// the keys then play it) and Replace graph. Every action is one dispatch, one undo entry; a
// refusal shows the store's sentence and changes nothing. Text is set through textContent.
//
//   mountPatchBrowser(host, svc) -> { open({ instrument, from }), refresh() }
//     svc: { store, userPatches() -> Promise<[{ id, patch }]>, target() -> node id | null,
//            announce(text, { assertive }), show() -> Promise (opens the dialog holding host),
//            applied(result, entry, mode, from) }

import { browseView, catalogEntries, entryAction } from '../studio/patch-catalog.js';
import { announceAction } from '../studio/a11y.js';
import { h, replaceChildren } from './studio/graph-dom.js';

const FIELD = 'h-11 rounded-lg border border-solid border-gray-300 bg-gray-50 px-3 text-sm '
  + 'text-gray-900 focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 '
  + 'dark:bg-gray-700 dark:text-white';
const BTN = 'h-11 rounded-lg px-4 text-sm font-medium focus:outline-none focus-visible:ring-2 '
  + 'focus-visible:ring-primary-300 aria-disabled:opacity-50';
const PRIMARY = `${BTN} bg-primary-600 text-white hover:bg-primary-700`;
const SECONDARY = `${BTN} border border-solid border-gray-300 bg-white text-gray-900 `
  + 'hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-white '
  + 'dark:hover:bg-gray-700';
const MODES = Object.freeze([['apply', 'Apply'], ['insert', 'Insert'], ['replace',
  'Replace graph']]);

export function mountPatchBrowser(host, svc) {
  let entries = null; // read at the first open: no catalog work at page load
  let active = null;
  let from = 'studio';
  const f = { instrument: '', tag: '', query: '' };
  const status = h('p', { role: 'status', 'data-osc': 'library.status',
    class: 'min-h-[1.25rem] text-sm text-gray-700 dark:text-gray-300' });
  const search = h('input', { type: 'search', class: `${FIELD} w-full sm:w-56`,
    placeholder: 'Search patches', 'aria-label': 'Search patches', 'data-osc': 'library.search',
    autocomplete: 'off' });
  const inst = h('select', { class: FIELD, 'aria-label': 'Instrument',
    'data-osc': 'library.instrument' });
  const tag = h('select', { class: FIELD, 'aria-label': 'Tag', 'data-osc': 'library.tag' });
  const list = h('ul', { role: 'listbox', tabindex: '0', 'aria-label': 'Patches',
    'data-osc': 'library.list', class: 'max-h-80 overflow-y-auto rounded-lg border border-solid '
      + 'border-gray-200 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 '
      + 'dark:border-gray-700' });
  const detail = h('div', { 'data-osc': 'library.detail', class: 'flex flex-col gap-2' });
  replaceChildren(host, h('section', { class: 'mt-4 flex flex-col gap-3 border-0 border-t '
    + 'border-solid border-gray-200 pt-4 dark:border-gray-700', 'data-osc': 'library',
  'aria-labelledby': 'osc-patch-library-title' }, [
    h('h3', { id: 'osc-patch-library-title', tabindex: '-1', class: 'text-lg font-semibold '
      + 'text-gray-900 dark:text-white', text: 'Patch library' }),
    h('p', { class: 'text-sm text-gray-600 dark:text-gray-300', text: 'Factory and saved '
      + 'patches of every instrument. Apply sets the parameters of the nodes a patch names, '
      + 'Insert adds new nodes, Replace graph replaces the whole graph; each is one undo step.' }),
    h('div', { class: 'flex flex-wrap gap-2', role: 'group', 'aria-label': 'Filters' },
      [search, inst, tag]),
    h('div', { class: 'grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_16rem]' },
      [list, detail]),
    status]));

  const view = () => browseView(entries || (entries = catalogEntries()), svc.store.getModel(),
    { ...f, target: svc.target() });
  const options = (sel, all, items, value) => replaceChildren(sel, [h('option', { value: '',
    text: all }), ...items.map((x) => h('option', { value: x.id, text: `${x.label || x.id} (${
    x.count})`, selected: x.id === value }))]);

  function load(item, mode) {
    const r = entryAction(svc.store.getModel(), item, mode, { target: svc.target() });
    const res = r.action ? svc.store.dispatch(r.action) : { ok: false, reason: r.reason };
    const text = res.ok ? `${MODES.find((m) => m[0] === mode)[1]}: ${item.name}.`
      : announceAction(res);
    status.textContent = res.ok ? text : res.reason;
    svc.announce(text, { assertive: !res.ok });
    if (res.ok && typeof svc.applied === 'function') svc.applied(res, item, mode, from);
    render();
    return res;
  }

  function renderDetail(item) {
    if (!item) {
      replaceChildren(detail, h('p', { class: 'text-sm text-gray-500 dark:text-gray-400',
        text: 'No patch matches these filters.' }));
      return;
    }
    replaceChildren(detail, [
      h('h3', { class: 'text-base font-semibold text-gray-900 dark:text-white', text: item.name,
        'data-osc': 'library.name' }),
      h('p', { class: 'text-sm text-gray-600 dark:text-gray-300', text: `${item.instrumentLabel}`
        + ` · ${item.source === 'user' ? 'Saved' : 'Factory'} · ${item.tags.join(', ')}` }),
      item.inUse ? h('p', { 'data-osc': 'library.inUse', class: 'w-fit rounded bg-green-100 '
        + 'px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 '
        + 'dark:text-green-300', text: 'In use in this Studio' }) : null,
      item.reason ? h('p', { class: 'text-sm text-gray-600 dark:text-gray-300',
        'data-osc': 'library.reason', text: item.reason }) : null,
      h('div', { class: 'flex flex-wrap gap-2' }, MODES.filter(([m]) => item.modes.includes(m))
        .map(([m, label], i) => h('button', { type: 'button', 'data-mode': m,
          'data-osc': `library.${m}`, class: i ? SECONDARY : PRIMARY, text: label,
          'aria-disabled': m === 'apply' && !item.applicable ? 'true' : null,
          onClick: () => (m === 'apply' && !item.applicable ? (status.textContent = item.reason)
            : load(item, m)) }))),
    ]);
  }

  function render() {
    const v = view();
    options(inst, 'Every instrument', v.instruments, f.instrument);
    options(tag, 'Every tag', v.tags, f.tag);
    if (!v.items.some((x) => x.id === active)) active = v.items.length ? v.items[0].id : null;
    replaceChildren(list, v.items.map((x) => h('li', { role: 'option', id: `osc-lib-${x.id}`,
      'aria-selected': String(x.id === active), 'data-entry': x.id,
      class: `flex h-11 cursor-pointer items-center justify-between gap-2 px-3 text-sm ${
        x.id === active ? 'bg-primary-50 font-semibold text-primary-700 dark:bg-gray-700 '
        + 'dark:text-primary-400' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 '
        + 'dark:hover:bg-gray-700'}`,
      onClick: () => { active = x.id; render(); list.focus(); } }, [
      h('span', { text: x.name }),
      h('span', { class: 'text-xs text-gray-500 dark:text-gray-400', text: `${
        x.inUse ? 'in use · ' : ''}${x.instrumentLabel}` })])));
    if (active) list.setAttribute('aria-activedescendant', `osc-lib-${active}`);
    else list.removeAttribute('aria-activedescendant');
    renderDetail(v.items.find((x) => x.id === active) || null);
  }

  search.addEventListener('input', () => { f.query = search.value; render(); });
  inst.addEventListener('change', () => { f.instrument = inst.value; render(); });
  tag.addEventListener('change', () => { f.tag = tag.value; render(); });
  list.addEventListener('keydown', (e) => {
    const items = view().items;
    const i = items.findIndex((x) => x.id === active);
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (next !== undefined && items.length) {
      e.preventDefault();
      active = items[Math.max(0, Math.min(items.length - 1, next))].id;
      render();
      const el = list.querySelector('[aria-selected="true"]');
      if (el) el.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && i >= 0) {
      e.preventDefault();
      const x = items[i];
      load(x, x.applicable ? 'apply' : x.modes.find((m) => m !== 'apply'));
    }
  });

  async function refresh() {
    const user = await svc.userPatches().catch(() => []);
    entries = catalogEntries({ user });
    render();
  }

  return {
    async open({ instrument = '', from: who = 'studio' } = {}) {
      from = who;
      f.instrument = instrument;
      status.textContent = '';
      render();
      await svc.show();
      list.focus();
      list.scrollIntoView({ block: 'nearest' });
      await refresh();
    },
    refresh,
  };
}

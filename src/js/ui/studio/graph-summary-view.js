// The Inspector's graph summary (plan K168): the summarizeGraphModel of studio/a11y.js rendered
// whole, as the Flowbite Pro accordion of the Studio card (nothing selected). One group per
// section that has something to say (signal paths, not connected, modulation, triggers,
// analysis, measurement), one line per item, every node a button that selects it in the graph
// and frames and focuses it there (the Find node path, svc.onReveal); a sounding node no path
// reaches is flagged and offers Connect…, which opens the connection list of its output port
// (svc.onFix) and patches nothing until a target is chosen there. A group longer than
// SUMMARY_SHOWN lists its first items and "Show all (M)" lists the rest in place: the data is
// never cut, only disclosed progressively. Nothing is derived here: the paths and groups are
// a11y.js's (one derivation); this module only lays them out. Text through textContent only
// (graph-dom.js h), never HTML: node names are untrusted (§238).
//
//   mountGraphSummary(svc) -> { el, update(summary) }    svc: { onReveal(nodeId),
//                                                         onFix(nodeId, portId) }
//   Each control has a data-key, so a rebuilt summary (the graph changed) keeps the focus of
//   the control that had it; the open groups and the fully listed ones survive a rebuild.

import { h, replaceChildren } from './graph-dom.js';

/** Items a group lists before its "Show all (M)" button. */
export const SUMMARY_SHOWN = 8;
/** Groups open when the summary is first shown. */
export const SUMMARY_OPEN = Object.freeze(['signal', 'unconnected']);

const HEAD = 'flex w-full items-center gap-3 border-0 bg-transparent px-3 py-3 text-left '
  + 'text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none '
  + 'focus-visible:ring-2 focus-visible:ring-primary-300 dark:text-gray-300 '
  + 'dark:hover:bg-gray-700 dark:focus-visible:ring-primary-800';
const NODE = 'max-w-full break-words rounded border-0 bg-transparent px-0.5 py-0.5 text-left '
  + 'font-medium text-primary-700 underline-offset-2 hover:underline focus:outline-none '
  + 'focus-visible:ring-2 focus-visible:ring-primary-300 dark:text-primary-400 '
  // a node link is a touch target: 44 px tall on a coarse pointer (V634's touch-target rule)
  + '[@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:min-h-11 '
  + '[@media(pointer:coarse)]:items-center';
const SMALL_BTN = 'inline-flex min-h-6 items-center rounded-lg border border-solid border-gray-300 '
  + 'bg-white px-3 py-1 text-xs font-medium text-gray-900 hover:bg-gray-100 focus:outline-none '
  + 'focus-visible:ring-2 focus-visible:ring-primary-300 dark:border-gray-600 dark:bg-gray-800 '
  + 'dark:text-white dark:hover:bg-gray-700';
const BADGE = 'rounded px-1.5 py-0.5 text-xs font-medium';
const GRAY = 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
const GRAY_BADGE = `${BADGE} ${GRAY}`;
const COUNT = `rounded-full px-2 py-0.5 text-xs font-medium ${GRAY}`;
const RED_BADGE = `${BADGE} bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300`;
const SEP = 'border-t border-solid border-gray-200 dark:border-gray-700';
const LINE = 'break-words text-sm leading-6 text-gray-700 dark:text-gray-300';

const ID = 'studio-graph-summary';

function chevron(open) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `h-3 w-3 shrink-0 transition-transform${open ? ' rotate-180' : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('viewBox', '0 0 10 6');
  svg.setAttribute('fill', 'none');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('d', 'M9 5 5 1 1 5');
  svg.appendChild(p);
  return svg;
}

/** The groups the summary shows: the signal group always, every other one with items. */
const shownSections = (summary) => summary.sections.filter((s) => s.id === 'signal'
  || s.items.length);

export function mountGraphSummary(svc) {
  const open = new Set(SUMMARY_OPEN);
  const full = new Set(); // groups listing every item
  const el = h('section', { 'aria-labelledby': `${ID}-title`, class: 'mb-3',
    'data-osc': 'studio.inspector.summary' });
  let last = null;

  function nodeButton(section, item, n, i) {
    return h('button', { type: 'button', class: NODE, 'data-osc': 'studio.inspector.summaryNode',
      'data-node': n.id, 'data-key': `summary:${section.id}:${item.key}:${i}`,
      title: `Select ${n.name} in the graph`, text: n.name,
      onClick: () => svc.onReveal(n.id) });
  }

  function line(section, item) {
    const children = item.parts.map((p, i) => (typeof p === 'string' ? p
      : nodeButton(section, item, p, i)));
    if (item.muted) children.push(' ', h('span', { class: GRAY_BADGE, text: 'muted' }));
    if (section.id === 'unconnected') {
      const n = item.nodes[0];
      children.push(' ', h('span', { class: RED_BADGE, text: 'not heard' }));
      if (item.port) {
        children.push(' ', h('button', { type: 'button', class: SMALL_BTN,
          'data-osc': 'studio.inspector.summaryFix', 'data-node': n.id, 'data-port': item.port,
          'data-key': `summary:fix:${n.id}`, 'aria-label': `Connect ${n.name}…`,
          text: 'Connect…', onClick: () => svc.onFix(n.id, item.port) }));
      }
    }
    return h('li', { class: LINE, 'data-item': item.key }, children);
  }

  function body(section) {
    const all = full.has(section.id) || section.items.length <= SUMMARY_SHOWN;
    const items = all ? section.items : section.items.slice(0, SUMMARY_SHOWN);
    const kids = [];
    if (section.note) kids.push(h('p', { class: LINE, text: section.note }));
    if (items.length) {
      kids.push(h('ul', { class: 'm-0 list-none space-y-2 p-0',
        'aria-label': section.label }, items.map((it) => line(section, it))));
    }
    if (section.omitted) {
      kids.push(h('p', { class: 'mt-2 text-xs text-gray-600 dark:text-gray-400',
        text: `${section.omitted} more paths are not listed (more than ${
          section.items.length}).` }));
    }
    if (section.items.length > SUMMARY_SHOWN) {
      kids.push(h('button', { type: 'button', class: `${SMALL_BTN} mt-2`,
        'data-osc': 'studio.inspector.summaryAll', 'data-section': section.id,
        'data-key': `summary:all:${section.id}`, 'aria-controls': `${ID}-${section.id}-body`,
        text: all ? `Show the first ${SUMMARY_SHOWN}` : `Show all (${section.items.length})`,
        onClick: () => {
          if (all) full.delete(section.id);
          else full.add(section.id);
          draw();
          // The first item that was not listed takes focus when the group grows.
          const next = !all && el.querySelector(`#${ID}-${section.id}-body li:nth-child(${
            SUMMARY_SHOWN + 1}) button`);
          if (next) next.focus();
        } }));
    }
    return kids;
  }

  function group(section, first) {
    const isOpen = open.has(section.id);
    const headId = `${ID}-${section.id}-head`;
    const bodyId = `${ID}-${section.id}-body`;
    const count = section.id === 'signal' ? section.total : section.items.length;
    const button = h('button', { type: 'button', class: HEAD, 'aria-expanded': String(isOpen),
      'aria-controls': bodyId, 'data-osc': 'studio.inspector.summaryGroup',
      'data-section': section.id, 'data-key': `summary:group:${section.id}`,
      onClick: () => {
        if (open.has(section.id)) open.delete(section.id);
        else open.add(section.id);
        draw();
      } }, [
      h('span', { class: 'min-w-0 flex-1 break-words', text: section.label }),
      h('span', { class: COUNT, text: String(count) }),
      chevron(isOpen)]);
    return [
      h('h6', { id: headId, class: `m-0${first ? '' : ` ${SEP}`}` }, [button]),
      h('div', { id: bodyId, role: 'region', 'aria-labelledby': headId, hidden: !isOpen,
        class: `${SEP} px-3 py-3` }, isOpen ? body(section) : []),
    ];
  }

  /** Rebuild from the last summary, keeping the focus of the control that had it (data-key). */
  function draw() {
    const summary = last;
    if (!summary) return;
    const active = document.activeElement;
    const key = active && el.contains(active) ? active.getAttribute('data-key') : null;
    const sections = shownSections(summary);
    const kids = [h('h5', { id: `${ID}-title`, class: 'mb-2 mt-0 text-xs font-semibold '
      + 'uppercase tracking-wide text-gray-900 dark:text-white', text: 'Graph summary' })];
    if (!summary.counts.nodes) {
      kids.push(h('p', { class: LINE, text: 'Empty Studio: no nodes.' }));
    } else {
      kids.push(h('div', { class: 'overflow-hidden rounded-lg border border-solid '
        + 'border-gray-200 dark:border-gray-700', 'data-osc': 'studio.inspector.summaryGroups' },
      sections.flatMap((s, i) => group(s, i === 0))));
    }
    replaceChildren(el, kids);
    if (key) {
      const again = el.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (again) again.focus();
    }
  }

  let drawn = '';
  return {
    el,
    /** Show `summary` (a summarizeGraphModel result); a no-op when nothing it shows changed. */
    update(summary) {
      last = summary;
      const sig = JSON.stringify([summary.counts, summary.sections.map((s) => [s.id, s.label,
        s.note, s.total, s.omitted, s.items.map((it) => [it.key, it.text, it.muted, it.port])])]);
      if (sig === drawn) return el;
      drawn = sig;
      draw();
      return el;
    },
  };
}

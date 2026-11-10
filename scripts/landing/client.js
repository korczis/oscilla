// The one script of the generated landing at /oscilla/lab/ (plan P014, owner decision Q107),
// bundled by scripts/landing.mjs with esbuild (IIFE) and inlined. It never fetches anything.
// Flowbite's own components drive the tabs (the playable frame's deep links), the modal (the
// screenshot lightbox) and the collapse (the phone menu); this file adds only what they lack:
//   - the theme toggle (prefers-color-scheme until the visitor picks one; the pick is kept in
//     localStorage when the browser allows it, and the page works without it);
//   - the playable frame: no <iframe> exists until the visitor presses a start button, so the
//     app (and its audio) cannot start before that press; a tab switch while the frame is live
//     changes only the frame's fragment, so the one app routes to the new workspace;
//   - the lightbox's previous/next, arrow keys and focus handling around Flowbite's modal;
//   - the charts' readout: hover, or focus a chart and move with the arrow keys;
//   - the claims explorer's search and its status and area filters (without the script the
//     table shows every claim and the controls stay hidden);
//   - the roadmap's filter by milestone status (likewise hidden without the script);
//   - the review audit's filter by class (likewise).
import Collapse from 'flowbite/lib/esm/components/collapse';
import Modal from 'flowbite/lib/esm/components/modal';
import Tabs from 'flowbite/lib/esm/components/tabs';

const THEME_KEY = 'oscilla-lab-theme';
const root = document.documentElement;
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

function storedTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function applyTheme(dark) {
  root.classList.toggle('dark', dark);
  for (const b of $$('[data-theme-toggle]')) {
    b.setAttribute('aria-pressed', String(dark));
    b.setAttribute('aria-label', dark ? 'Přepnout na světlý motiv' : 'Přepnout na tmavý motiv');
  }
}

function initTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  applyTheme(root.classList.contains('dark'));
  media.addEventListener('change', (e) => { if (!storedTheme()) applyTheme(e.matches); });
  for (const b of $$('[data-theme-toggle]')) {
    b.addEventListener('click', () => {
      const dark = !root.classList.contains('dark');
      applyTheme(dark);
      try {
        localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
      } catch { /* the choice lasts for this page only */ }
    });
  }
}

function initMenu() {
  const toggle = $('[data-lab-menu-toggle]');
  const menu = $('#lab-menu');
  if (!toggle || !menu) return;
  const collapse = new Collapse(menu, toggle);
  for (const a of $$('a', menu)) {
    a.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 1279px)').matches) collapse.collapse();
    });
  }
}

// Arrow keys, Home and End among the tabs of a tablist (WAI-ARIA tabs), selection on focus.
function roving(list, select) {
  list.addEventListener('keydown', (e) => {
    const tabs = $$('[role="tab"]', list);
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const keys = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1,
      Home: 0, End: tabs.length - 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const next = tabs[(keys[e.key] + tabs.length) % tabs.length];
    next.focus();
    select(next);
  });
}

function initFrame() {
  const section = $('[data-lab-frame]');
  if (!section) return;
  const list = $('[role="tablist"]', section);
  const host = $('[data-frame-host]', section);
  const appHref = section.dataset.appHref;
  const tabs = $$('[role="tab"]', list);
  let frame = null;
  let current = tabs[0].dataset.frameHash;
  const items = tabs.map((t) => ({ id: t.id, triggerEl: t,
    targetEl: document.getElementById(t.getAttribute('aria-controls')) }));
  const tabsUi = new Tabs(list, items, {
    defaultTabId: tabs[0].id,
    onShow: (inst) => {
      const tab = inst.getActiveTab().triggerEl;
      for (const t of tabs) {
        t.setAttribute('aria-selected', String(t === tab));
        t.tabIndex = t === tab ? 0 : -1;
      }
      current = tab.dataset.frameHash;
      if (frame) {
        frame.src = `${appHref}${current}`;
        frame.title = `OSCILLA: ${tab.dataset.frameName}`;
      }
    },
  });
  roving(list, (t) => tabsUi.show(t.id));
  const stop = $('[data-frame-stop]', section);
  const stopRow = $('[data-frame-stop-row]', section);
  const start = (tab) => {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.setAttribute('allow', 'microphone; midi; autoplay');
      frame.className = 'block h-full w-full border-0 bg-gray-950';
      host.append(frame);
    }
    current = tab.dataset.frameHash;
    frame.title = `OSCILLA: ${tab.dataset.frameName}`;
    frame.src = `${appHref}${current}`;
    section.dataset.live = 'true';
    host.hidden = false;
    stopRow.hidden = false;
    for (const p of $$('[data-frame-poster]', section)) p.hidden = true;
    frame.focus();
  };
  for (const b of $$('[data-frame-start]', section)) {
    b.addEventListener('click', () => start(document.getElementById(b.dataset.frameStart)));
  }
  stop.addEventListener('click', () => {
    // Removing the frame unloads the app, which ends its audio.
    frame?.remove();
    frame = null;
    delete section.dataset.live;
    host.hidden = true;
    stopRow.hidden = true;
    for (const p of $$('[data-frame-poster]', section)) p.hidden = false;
    $('[role="tab"][aria-selected="true"]', list)?.focus();
  });
}

function initLightbox() {
  const el = $('#lab-lightbox');
  const shots = $$('[data-shot]');
  if (!el || !shots.length) return;
  const img = $('[data-lightbox-img]', el);
  const caption = $('[data-lightbox-caption]', el);
  const count = $('[data-lightbox-count]', el);
  let index = 0;
  let opener = null;
  const show = (i) => {
    index = (i + shots.length) % shots.length;
    const s = shots[index];
    img.src = s.dataset.full;
    img.alt = s.dataset.alt;
    img.width = Number(s.dataset.width) || 0;
    img.height = Number(s.dataset.height) || 0;
    caption.textContent = s.dataset.caption;
    count.textContent = `${index + 1} / ${shots.length}`;
  };
  const modal = new Modal(el, {
    placement: 'center', backdrop: 'dynamic', closable: true,
    onHide: () => opener?.focus(),
  });
  shots.forEach((s, i) => s.addEventListener('click', () => {
    opener = s;
    show(i);
    modal.show();
    $('[data-lightbox-close]', el).focus();
  }));
  $('[data-lightbox-prev]', el).addEventListener('click', () => show(index - 1));
  $('[data-lightbox-next]', el).addEventListener('click', () => show(index + 1));
  $('[data-lightbox-close]', el).addEventListener('click', () => modal.hide());
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
    else if (e.key === 'Tab') {
      // Keep focus inside the open dialog.
      const f = $$('button', el).filter((b) => !b.disabled);
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

function initCharts() {
  const tip = $('#lab-chart-tip');
  if (!tip) return;
  const place = (box, target) => {
    const r = target.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    tip.hidden = false;
    const w = tip.offsetWidth;
    let left = r.left + r.width / 2 - b.left - w / 2;
    left = Math.max(4, Math.min(left, b.width - w - 4));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, r.top - b.top - tip.offsetHeight - 8)}px`;
  };
  for (const box of $$('[data-chart-box]')) {
    const svg = $('svg', box);
    const marks = $$('.mark', svg);
    if (!marks.length) continue;
    let active = -1;
    const show = (i) => {
      marks.forEach((m) => m.removeAttribute('data-active'));
      active = i;
      const m = marks[i];
      m.setAttribute('data-active', 'true');
      box.append(tip);
      const text = m.querySelector('title').textContent;
      tip.textContent = text;
      place(box, m.lastElementChild || m);
      box.querySelector('[data-chart-live]').textContent = text;
    };
    const hide = () => {
      marks.forEach((m) => m.removeAttribute('data-active'));
      tip.hidden = true;
    };
    marks.forEach((m, i) => {
      m.addEventListener('pointerenter', () => show(i));
      m.addEventListener('pointerleave', hide);
    });
    svg.setAttribute('tabindex', '0');
    svg.addEventListener('focus', () => show(active < 0 ? marks.length - 1 : active));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      const keys = { ArrowRight: active + 1, ArrowDown: active + 1, ArrowLeft: active - 1,
        ArrowUp: active - 1, Home: 0, End: marks.length - 1 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      show((keys[e.key] + marks.length) % marks.length);
    });
  }
}

// Lower case, without diacritics, so "mereni" finds "měření".
const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function initClaims() {
  const section = $('[data-claims]');
  if (!section) return;
  const controls = $('[data-claims-controls]', section);
  const q = $('#claims-q', section);
  const status = $('#claims-status', section);
  const area = $('#claims-area', section);
  const count = $('[data-claims-count]', section);
  const empty = $('[data-claims-empty]', section);
  const rows = $$('tr[data-claim]', section).map((tr) => ({ tr, text: fold(tr.textContent) }));
  const apply = () => {
    const words = fold(q.value).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const r of rows) {
      const ok = (!status.value || r.tr.dataset.status === status.value)
        && (!area.value || r.tr.dataset.area === area.value)
        && words.every((w) => r.text.includes(w));
      r.tr.hidden = !ok;
      if (ok) shown += 1;
    }
    empty.hidden = shown > 0;
    count.textContent = `Zobrazeno ${shown} z ${rows.length} tvrzení.`;
  };
  q.addEventListener('input', apply);
  status.addEventListener('change', apply);
  area.addEventListener('change', apply);
  controls.hidden = false;
}

function initRoadmap() {
  const section = $('[data-roadmap]');
  if (!section) return;
  const controls = $('[data-roadmap-controls]', section);
  const buttons = $$('[data-roadmap-filter]', controls);
  const cards = $$('[data-intent]', section);
  const apply = (value) => {
    for (const b of buttons) {
      b.setAttribute('aria-pressed', String(b.dataset.roadmapFilter === value));
    }
    for (const card of cards) {
      let shown = 0;
      for (const li of $$('li[data-status]', card)) {
        li.hidden = Boolean(value) && li.dataset.status !== value;
        if (!li.hidden) shown += 1;
      }
      $('[data-intent-empty]', card).hidden = shown > 0;
      card.hidden = shown === 0;
    }
  };
  for (const b of buttons) b.addEventListener('click', () => apply(b.dataset.roadmapFilter));
  controls.hidden = false;
}

// The review audit's filter by class (Vše / Stále otevřené / Opraveno / Nahrazeno /
// Neauditováno); hidden without the script, when the table shows every finding.
const AUDIT_NAMES = { '': 'všechny třídy', open: 'stále otevřené', fixed: 'opraveno',
  superseded: 'nahrazeno', unaudited: 'neauditováno' };

function initAudit() {
  const block = $('[data-audit]');
  if (!block) return;
  const controls = $('[data-audit-controls]', block);
  const buttons = $$('[data-audit-filter]', controls);
  const rows = $$('tr[data-class]', block);
  const empty = $('[data-audit-empty]', block);
  const count = $('[data-audit-count]', block);
  const apply = (value) => {
    let shown = 0;
    for (const b of buttons) {
      b.setAttribute('aria-pressed', String(b.dataset.auditFilter === value));
    }
    for (const tr of rows) {
      tr.hidden = Boolean(value) && tr.dataset.class !== value;
      if (!tr.hidden) shown += 1;
    }
    empty.hidden = shown > 0;
    count.textContent = `Zobrazeno ${shown} z ${rows.length} nálezů: `
      + `${AUDIT_NAMES[value] ?? value}.`;
  };
  for (const b of buttons) b.addEventListener('click', () => apply(b.dataset.auditFilter));
  controls.hidden = false;
}

initTheme();
initMenu();
initFrame();
initLightbox();
initCharts();
initClaims();
initRoadmap();
initAudit();

// The SYNTH workspace (plan K058-K066, K103-K106 parts): the Synth panel's DOM/Alpine adapter,
// composed into the Studio part (ui/studio/workspace.js), which owns the ONE store and ONE
// transport. The panel projects the StudioModel (project.studio-model-is-canonical): knobs
// dispatch NODE_PARAM_SET, amounts and cables one BATCH each, and it re-reads the model after
// every change, so a Studio edit shows here and nothing is repaired behind the user's back.
//
// Audio: keyboard, on-screen keys and MIDI play the panel through synthSink() (midi/notes.js
// route): the first note arms the transport, transport.live drives the Keys node; the Studio's
// keys take studioSink() (studio-sink.js), one path on any document. Leave, Esc,
// page hide and STOP disarm; a measurement owning the output refuses it.
//
// Tabs (Q019): Panel holds the mono voice, Engines the poly engines; the keys play Keys
// or the chosen engine via one sink; a tab change releases held notes.
//
//   createSynthUi({ get, setupAudio, announce }) -> the component part
//     get() -> { handle, transport }   the workspace's store and transport (late-bound)

import SEMI_MONO from './panels/semi-mono.js';
import { PRESETS, presetAction, presetOf, presetValues } from './presets.js';
import { playedEngine, routedNode } from './picker.js';
import { createDock } from './dock.js';
import { SYNTH_TEXT, feedNames, insertAction, insertDecision } from './insert.js';
import {
  STATE_TEXT, amountEdges, breakNormals, brokenByRemoval, jackReason, jackState, panelCables,
  patchCable, restoreNormals, setAmount, unpatch,
} from './normals.js';
import { linkAction, linkOf } from './link.js';
import { splitJack } from './panel.js';
import { esc, plateHtml, platesShown } from './view/face.js';
import { knobModel, knobSvg } from './view/knob.js';
import { createGestures } from './gestures.js';
import { bayLayout, baySvg, cablePath } from './view/bay.js';
import { panelTokens } from './view/tokens.js';
import { NODE_REGISTRY } from '../studio/registry.js';
import { canConnect } from '../studio/ports.js';
import { decodeSynthLink, encodeSynthLink } from '../core/url-state-synth.js';
import { ENGINE_BLOCKED } from './panels/engines.js';
import { CHIP, enginePickerHtml } from './view/engines.js';
import { createXyTab } from './view/xy-tab.js';
import { createStudioSink } from './studio-sink.js';
import { BTN } from '../ui/synth/label.js';
import { applyFace, faceChips, faceClass } from './view/faces.js';
import { createArmedFollow } from './armed-follow.js';
import { createSynthNotes } from './notes-sink.js';

export const SYNTH_PANEL = SEMI_MONO;
export { SYNTH_TEXT, insertDecision };
const DRAG_PX = 4;

export function createSynthUi({ get, setupAudio = () => {}, announce = () => {},
  registry = NODE_REGISTRY } = {}) {
  const panel = SEMI_MONO;
  let cmp = null;
  let shape = '';
  let knob = null; // an active knob drag
  let cable = null; // an active cable drag
  let pending = null; // tap-tap connect: the first jack
  let selected = null; // a selected cable id
  let layout = null;
  let face = 'panel'; // below xl: the module cards or the patch bay (view/faces.js)
  // Folded cards (K062): page view state, never in history, the hash or storage (the
  // README's privacy inventory lists no Synth key); a reload expands them.
  let collapsed = new Set();

  const ENGINE_IDS = panel.modulesOf('engines').map((m) => m.id);
  const tab = () => (cmp ? cmp.synth.tab : 'panel');
  const engineId = () => playedEngine(model(), panel, cmp && ENGINE_IDS.includes(cmp.synth
    .engine) ? cmp.synth.engine : ENGINE_IDS[0], registry);
  /** The module the keys play now: Keys on the Panel tab, the chosen engine on Engines. */
  const playedModule = () => (tab() === 'engines' ? engineId() : 'keys');
  /** The node the keys play: the one routed by the picker (K066), else the tab's module. */
  const played = () => routedNode(model(), registry) || nodes().get(playedModule());
  const handle = () => get().handle;
  // synth.armed follows the transport's own flag (armed-follow.js; review S1).
  const { syncArmed, follow } = createArmedFollow(() => get().transport, () => cmp);
  const transport = () => {
    setupAudio();
    return follow(get().transport);
  };
  const model = () => handle().getModel();
  const nodes = () => panel.resolve(model());
  const present = () => !!nodes().get('keys');
  const host = () => document.querySelector('[data-osc="synth.panel"]');
  const say = (text, assertive = false) => {
    if (cmp) cmp.synth.status = text;
    announce(text, { assertive });
  };
  const studioSink = createStudioSink({ get, setupAudio, say, registry,
    ensureAudio: () => cmp && cmp.ensureAudio && cmp.ensureAudio() });
  const dispatch = (action) => {
    const r = handle().dispatch(action);
    if (!r.ok) say(r.reason, true);
    return r;
  };
  /** A jack's friendly name ('VCO 1 Audio'), as its accessible name starts. */
  const jackName = (id) => {
    const { module, port } = splitJack(String(id).split(':')[0]);
    const m = panel.module(module);
    const j = m && m.jacks.find((x) => x.port === port);
    return m && j ? `${m.label} ${j.label}` : String(id);
  };

  /** Insert the panel when the document has none (insert.js insertAction: by itself where
   *  insertDecision allows it, else only `explicit`); the notice names the feed it took. */
  function ensurePanel(opts) {
    if (present()) return true;
    const before = model();
    const r = insertAction(before, panel, opts);
    const ok = !!r.action && dispatch(r.action).ok;
    // Opening the Synth on a fresh document is not the user's edit: the Studio stays clean, so
    // a template link afterwards is not refused for unsaved changes (first-screen link:studio).
    const tracker = get().dirty;
    if (ok && !(opts && opts.explicit) && tracker) tracker.rebaseFresh(before, model());
    if (ok || !r.action) say(ok ? r.text : r.reason);
    return ok;
  }

  // ------------------------------------------------------------------ controls

  const controlOf = (cid) => {
    const [mid, key] = cid.split('.');
    const c = panel.faceOf(mid).find((x) => x.key === key);
    return c ? { mid, key, c, node: nodes().get(mid) } : null;
  };
  const valueOf = (x) => (x.c.kind === 'amount'
    ? ((amountEdges(model(), panel, x.c.amount)[0] || { props: { depth: 0 } }).props.depth)
    : x.node.params[x.key]);

  function setControl(cid, value) {
    gestures.flush();
    const x = controlOf(cid);
    if (!x || !x.node) return null;
    if (x.c.kind === 'amount') {
      const a = setAmount(model(), panel, x.c.amount, value);
      return a ? dispatch(a) : null;
    }
    return dispatch({ type: 'NODE_PARAM_SET', nodeId: x.node.id, key: x.key, value });
  }

  // Knob drags and the wheel (gestures.js): the panel's state through these four.
  const gestures = createGestures({ controlOf, valueOf, setControl, handle, say,
    label: (x) => `Change ${panel.module(x.mid).label} ${x.c.label}` });

  // ------------------------------------------------------------------ cables

  /** A jack by its key ('module.port:in' | ':out'): a port id may name an input and an output. */
  const jackOf = (key) => {
    const { module } = splitJack(key);
    return panel.jacksOf(module).find((j) => j.key === key) || null;
  };
  const portOf = (j) => registry.port(panel.module(j.module).node, j.port, j.direction);
  /**
   * Every other jack's verdict for a cable from or to `id`: { ok, reason } from the typed-port
   * validator, then the panel's own refusals (normals.js patchCable: a jack where the cable
   * would do nothing). A feedback loop is judged by the store at the drop, with its sentence.
   */
  function verdictsFor(id) {
    const a = jackOf(id);
    const out = new Map();
    if (!a) return out;
    const m = model();
    for (const mod of panel.modules) {
      for (const j of panel.jacksOf(mod.id)) {
        if (j.direction === a.direction) continue;
        if (j.module === a.module) {
          out.set(j.key, { ok: false, reason: 'A module cannot patch into itself.' });
          continue;
        }
        const [s, t] = a.direction === 'out' ? [portOf(a), portOf(j)] : [portOf(j), portOf(a)];
        const v = canConnect(s, t);
        if (!v.allowed) { out.set(j.key, { ok: false, reason: v.reason }); continue; }
        const to = a.direction === 'out' ? j.id : a.id;
        const why = jackReason(m, panel, to);
        out.set(j.key, why ? { ok: false, reason: why } : { ok: true, reason: null });
      }
    }
    return out;
  }
  const compatibleWith = (id) => new Set([...verdictsFor(id)].filter(([, v]) => v.ok)
    .map(([k]) => k));

  function connect(a, b) {
    const ja = jackOf(a);
    const jb = jackOf(b);
    if (!ja || !jb || ja.direction === jb.direction) return say(SYNTH_TEXT.direction, true);
    const [from, to] = ja.direction === 'out' ? [ja.id, jb.id] : [jb.id, ja.id];
    const r = patchCable(model(), panel, from, to, { registry });
    if (r.reason) return say(r.reason, true);
    const done = dispatch(r.action);
    if (done.ok) say(`Patched ${jackName(from)} to ${jackName(to)}.`);
    return done;
  }

  function tapJack(id) {
    if (!pending) {
      pending = id;
      const n = compatibleWith(id).size;
      say(`Connecting from ${jackName(id)}: ${n} jacks can take the cable. Choose one in the `
        + 'connection list below the patch bay or on the bay, or the same jack to cancel.');
    } else if (pending === id) {
      pending = null;
      say('Connection cancelled.');
    } else {
      const from = pending;
      pending = null;
      connect(from, id);
    }
    renderBay();
  }

  function userCables() {
    return panelCables(model(), panel).map((c) => {
      const { port } = splitJack(c.from);
      const p = registry.port(panel.module(c.fromModule).node, port, 'out');
      return { ...c, type: p ? p.type : 'AUDIO' };
    });
  }

  // ------------------------------------------------------------------ rendering

  const ITEM = 'flex items-center justify-between gap-2 py-1 text-xs text-gray-700 '
    + 'dark:text-gray-300';

  /**
   * The connection list of a pending jack (K063): the jacks that can take the cable, then the
   * refused ones with the validator's sentence, then Remove for each cable on the jack.
   */
  function connectList(m, verdicts, cables) {
    const a = jackOf(pending);
    if (!a) return '';
    const name = (k) => `${jackName(k)} ${jackOf(k).direction === 'in' ? 'input' : 'output'}`;
    const ok = [...verdicts].filter(([, v]) => v.ok).map(([k]) => `<li class="${ITEM}">`
      + `<span>${esc(name(k))}</span><button type="button" class="${BTN}" data-connect-to=`
      + `"${esc(k)}" aria-label="Patch ${esc(jackName(pending))} to ${esc(name(k))}">Patch`
      + '</button></li>').join('');
    const no = [...verdicts].filter(([, v]) => !v.ok).map(([k, v]) => '<li class="py-1 text-xs '
      + `text-gray-600 dark:text-gray-400"><s>${esc(name(k))}</s>: ${esc(v.reason)}</li>`)
      .join('');
    const mine = cables.filter((c) => `${c.from}:out` === pending || `${c.to}:in` === pending)
      .map((c) => `<li class="${ITEM}"><span>${esc(jackName(c.from))} → ${esc(jackName(c.to))}`
      + `</span><button type="button" class="${BTN}" data-remove-cable="${esc(c.id)}">Remove `
      + 'cable</button></li>').join('');
    return `<h4 class="mt-3 text-xs font-bold tracking-widest text-gray-900 dark:text-white" `
      + `id="synth-connect-title">CONNECT FROM ${esc(name(pending).toUpperCase())}</h4>`
      + '<ul class="divide-y divide-gray-200 dark:divide-gray-700" '
      + `aria-labelledby="synth-connect-title">${mine}${ok}${no}</ul>`
      + `<button type="button" class="${BTN} mt-2" data-connect-cancel="">Cancel</button>`;
  }

  function renderBay() {
    const el = host();
    const box = el && el.querySelector('[data-osc="synth.bay.canvas"]');
    if (!box || !present()) return;
    const tokens = panelTokens(el);
    layout = bayLayout(panel, box.clientWidth || 320);
    const m = model();
    const states = new Map();
    for (const mod of panel.modules) {
      for (const j of panel.jacksOf(mod.id)) {
        if (j.direction === 'in') states.set(j.key, jackState(m, panel, j.id));
      }
    }
    const cables = userCables();
    for (const c of cables) states.set(`${c.from}:out`, 'patched');
    const verdicts = pending ? verdictsFor(pending) : new Map();
    box.innerHTML = baySvg({ panel, layout, cables, states, pending, tokens, selected, verdicts,
      compatible: new Set([...verdicts].filter(([, v]) => v.ok).map(([k]) => k)) });
    const conn = el.querySelector('[data-osc="synth.connect"]');
    if (conn) {
      conn.innerHTML = pending ? connectList(m, verdicts, cables) : '';
      conn.hidden = !pending;
    }
    const list = el.querySelector('[data-osc="synth.cables"]');
    const gone = brokenByRemoval(m, panel); // open because a module is gone: Restore module
    const goneJacks = new Set(gone.flatMap((r) => r.jacks));
    const jacksIn = (st) => [...states].filter(([, s]) => s === st).map(([k]) => k.split(':')[0])
      .filter((j) => !goneJacks.has(j));
    const open = jacksIn('open');
    const mixed = jacksIn('mixed');
    if (list) {
      list.innerHTML = cables.map((c) => `<li class="${ITEM}"><span>${esc(jackName(c.from))} → `
        + `${esc(jackName(c.to))}</span><button type="button" class="${BTN}" data-remove-cable=`
        + `"${esc(c.id)}" aria-label="Remove cable ${esc(jackName(c.from))} to `
        + `${esc(jackName(c.to))}">Remove</button></li>`).join('')
        + gone.map((r) => `<li class="${ITEM}" data-gone="${r.module}"><span>${esc(r.label)} `
        + `removed in Studio: ${esc(r.jacks.join(', '))} open</span><button type="button" `
        + `class="${BTN}" data-restore-module="${r.module}">Restore module</button></li>`).join('')
        + mixed.map((j) => `<li class="${ITEM}"><span>${esc(jackName(j))}: ${STATE_TEXT.mixed}`
        + `</span><button type="button" class="${BTN}" data-break-normal="${esc(j)}">`
        + 'Break normal</button></li>').join('')
        + open.map((j) => `<li class="${ITEM}"><span>${esc(jackName(j))}: open, normal removed `
        + `in Studio</span><button type="button" class="${BTN}" data-restore-normal="${esc(j)}">`
        + 'Restore normal</button></li>').join('')
        + (cables.length || open.length || mixed.length || gone.length ? ''
          : `<li class="${ITEM}">No cables: every jack plays its normal. Drag from one jack to `
          + 'another, or tap two jacks.</li>');
    }
  }

  // The plates fill the column they are given, not the viewport: as many as fit at 264 px (a
  // choice's widest dial, CHOICE_MAX_PX 234, plus the plate's 12 px pads), so the Pro shell's
  // sidebar and the patch bay beside them never squeeze a plate under its widest control.
  const PLATE_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,16.5rem),1fr))] gap-3';
  function renderAll() {
    const el = host();
    if (!el || !cmp) return;
    const focus = document.activeElement;
    const keep = focus && el.contains(focus) ? ['data-knob', 'data-option', 'data-toggle',
      'data-jack', 'data-collapse', 'data-fold-all', 'data-xy-surface', 'data-xy-axis']
      .map((a) => [a, focus.getAttribute(a),
      focus.getAttribute('data-v')])
      .find(([, v]) => v) : null;
    if (!present()) {
      xy.destroy();
      const cuts = panel.cutsOf(model());
      el.innerHTML = '<div class="bg-white rounded-lg shadow dark:bg-gray-800 p-6 text-sm '
        + 'text-gray-700 dark:text-gray-300"><p>This Studio document has no Synth panel.</p>'
        + (cuts.length ? `<p class="mt-2" data-osc="synth.insert-cuts">`
          + `${esc(SYNTH_TEXT.takes(feedNames(model(), cuts)))}</p>` : '')
        + '<button type="button" data-insert-panel="" class="mt-3 rounded-lg bg-primary-600 px-4 '
        + 'h-11 font-medium text-white focus:outline-none focus-visible:ring-2 '
        + `focus-visible:ring-primary-500">Insert the ${esc(panel.title)}</button></div>`;
      shape = 'empty';
      return;
    }
    const m = model();
    const res = nodes();
    const tokens = panelTokens(el);
    const engines = tab() === 'engines';
    const shown = platesShown({ panel, tab: tab(), engine: engineId(), resolved: res, model: m });
    const chips = engines ? enginePickerHtml({ panel, ids: ENGINE_IDS, on: engineId(),
      resolved: res }) : shown.map((x) => `<button type="button" `
      + `data-goto="${x.id}" class="${CHIP} border-gray-300 bg-white text-gray-800 `
      + `dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200">${esc(x.label)}</button>`)
      .join('');
    const plates = shown.map((x) => plateHtml({ panel, module: x, node: res.get(x.id),
      model: m, tokens, collapsed: collapsed.has(x.id) })).join('');
    const fold = 'rounded-lg px-3 h-11 text-xs font-medium text-gray-900 bg-white border '
      + 'border-solid border-gray-200 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 '
      + 'focus-visible:ring-primary-500 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 '
      + 'dark:hover:bg-gray-700';
    el.innerHTML = `<nav aria-label="${engines ? 'Synth engines' : 'Synth sections'}" `
      + 'class="sticky top-0 z-20 -mx-4 mb-3 flex snap-x snap-mandatory gap-2 overflow-x-auto '
      + `bg-gray-50 px-4 py-2 dark:bg-gray-900 ${engines ? 'lg:flex-wrap' : 'xl:hidden'}" `
      + `>${faceChips(face)}${chips}</nav>`
      + '<div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">'
      + `<div data-face-of="panel" class="${faceClass(face, 'panel')}">`
      + '<div class="mb-2 flex gap-2" role="group" aria-label="Module cards">'
      + `<button type="button" class="${fold}" data-fold-all="open">Expand all</button>`
      + `<button type="button" class="${fold}" data-fold-all="closed">Collapse all</button></div>`
      + xy.html()
      + `<div class="${engines ? 'grid grid-cols-1 gap-3' : PLATE_GRID}" `
      + `data-osc="synth.modules">${plates}</div></div>`
      + '<section class="bg-white rounded-lg shadow dark:bg-gray-800 self-start p-3 '
      + `xl:sticky xl:top-4 ${faceClass(face, 'bay')}" data-face-of="bay" `
      + 'aria-labelledby="synth-bay-title" data-osc="synth.bay" '
      + 'data-module="bay"><h3 id="synth-bay-title" class="text-sm font-bold tracking-widest '
      + 'text-gray-900 dark:text-white">PATCH BAY</h3><p class="mt-1 text-xs text-gray-500 '
      + 'dark:text-gray-400">Every input is normalled: it plays with no cable. A cable into a '
      + 'jack replaces its normal; removing the cable restores it.</p>'
      + '<div class="mt-2 w-full" data-osc="synth.bay.canvas"></div>'
      + '<div data-osc="synth.connect" hidden></div>'
      + '<h4 class="mt-3 text-xs font-bold tracking-widest text-gray-900 dark:text-white" '
      + 'id="synth-cables-title">CABLES</h4>'
      + '<ul class="mt-1 divide-y divide-gray-200 dark:divide-gray-700" data-osc="synth.cables" '
      + 'aria-labelledby="synth-cables-title"></ul></section></div>';
    shape = shapeOf();
    renderBay();
    xy.mount();
    const chosen = engines && el.querySelector('[data-engine][aria-checked="true"]');
    if (chosen) chosen.parentElement.parentElement.scrollLeft = chosen.offsetLeft - 16;
    if (keep) {
      // A choice keeps focus on its checked option (focus follows the selection).
      const again = keep[0] === 'data-option'
        ? el.querySelector(`[data-option="${keep[1]}"][aria-checked="true"]`)
          || el.querySelector(`[data-option="${keep[1]}"][data-v="${keep[2]}"]`)
        : el.querySelector(`[${keep[0]}="${keep[1]}"]`);
      if (again) again.focus({ preventScroll: true });
    }
  }

  /** Show one face below xl without rebuilding the view; the bay is laid out again at the
   *  width it now has. */
  function showFace(f) {
    const el = host();
    if (!el) return;
    face = f;
    applyFace(el, f);
    if (f === 'bay') renderBay();
  }

  const shapeOf = () => {
    const m = model();
    return `${m.graph.nodes.map((n) => n.id).join()}|${m.graph.edges.length}`;
  };

  /** One knob in place (a drag keeps its pointer capture on the same element). */
  function updateKnob(cid) {
    const el = host();
    const box = el && el.querySelector(`[data-knob="${cid}"]`);
    const x = controlOf(cid);
    if (!box || !x || !x.node) return;
    const v = valueOf(x);
    const km = knobModel(x.c.param);
    box.innerHTML = knobSvg({ uid: cid, value: v, param: x.c.param, tokens: panelTokens(el) });
    gestures.aria(box, v, x.c.param, km.text(v));
    const out = el.querySelector(`[data-value="${cid}"]`);
    if (out) out.textContent = km.format(v);
  }

  function refresh() {
    dock.sync();
    follow(get().transport);
    if (!cmp || cmp.workspace !== 'synth') return;
    syncArmed();
    if (knob) updateKnob(knob.cid);
    else if (!cable) renderAll();
  }

  // ------------------------------------------------------------------ events

  function onPointerDown(e) {
    const k = e.target.closest('[data-knob]');
    if (k) {
      const x = controlOf(k.dataset.knob);
      if (!x || !x.node) return;
      if (k.getAttribute('aria-disabled') === 'true') {
        const why = document.getElementById(`${k.dataset.knob}-why`);
        say(why ? why.textContent : 'This control is disabled.');
        return;
      }
      e.preventDefault();
      k.setPointerCapture(e.pointerId);
      knob = gestures.press(k.dataset.knob, x, e);
      handle().beginGesture(`Change ${panel.module(x.mid).label} ${x.c.label}`);
      return;
    }
    const j = e.target.closest('[data-jack]');
    if (j) {
      e.preventDefault();
      const svg = j.ownerSVGElement;
      svg.setPointerCapture(e.pointerId);
      cable = { from: j.dataset.jack, x: e.clientX, y: e.clientY, moved: false, svg };
    }
  }

  const svgPoint = (svg, e) => {
    const r = svg.getBoundingClientRect();
    const k = layout ? layout.width / r.width : 1;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  };

  function onPointerMove(e) {
    if (knob) {
      gestures.drag(knob, e);
      return;
    }
    if (!cable) return;
    if (Math.hypot(e.clientX - cable.x, e.clientY - cable.y) > DRAG_PX) cable.moved = true;
    const a = layout && layout.jacks.get(cable.from);
    const live = cable.svg.querySelector('[data-live-cable]');
    if (a && live && cable.moved) live.setAttribute('d', cablePath(a, svgPoint(cable.svg, e)));
  }

  function onPointerUp(e) {
    if (knob) {
      const { moved } = knob;
      handle().endGesture();
      knob = null;
      // A press without a move changes nothing and leaves the knob's nodes in place, so a
      // double-click lands on the same target (Chromium needs the same node for both clicks).
      if (moved) renderAll();
      return;
    }
    if (!cable) return;
    const c = cable;
    cable = null;
    if (!c.moved) {
      tapJack(c.from);
      return;
    }
    const p = svgPoint(c.svg, e);
    let best = null;
    for (const [id, q] of layout.jacks) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < 26 && (!best || d < best.d)) best = { id, d };
    }
    if (best && best.id !== c.from) connect(c.from, best.id);
    renderAll();
  }

  function onClick(e) {
    const t = e.target.closest('[data-option],[data-toggle],[data-goto],[data-cable],'
      + '[data-remove-cable],[data-restore-normal],[data-restore-module],[data-insert-panel],'
      + '[data-engine],[data-blocked],[data-break-normal],[data-connect-to],[data-connect-cancel],'
      + '[data-collapse],[data-fold-all],[data-face]');
    if (!t) return;
    const d = t.dataset;
    if (d.engine) {
      allOff();
      dock.unroute();
      showTab('engines', d.engine);
      say(`${panel.module(d.engine).label}: the keys play this engine.`);
    } else if (d.blocked) {
      const b = ENGINE_BLOCKED.find((x) => x.id === d.blocked);
      if (b) say(b.reason);
    } else if (d.option) {
      if (gestures.refused(t, d.option)) return;
      const x = controlOf(d.option);
      const o = x && x.c.param.options.find((v) => String(v[0]) === d.v);
      if (o) setControl(d.option, o[0]);
    } else if (d.toggle) {
      const x = controlOf(d.toggle);
      if (t.getAttribute('aria-disabled') === 'true') {
        const why = document.getElementById(`${d.toggle}-why`);
        say(why ? why.textContent : 'This control is disabled.');
      } else if (x) setControl(d.toggle, !valueOf(x));
    } else if (d.face) {
      showFace(d.face);
      const first = host().querySelector('[data-osc="synth.modules"] [data-module]');
      gotoSection(d.face === 'bay' ? 'bay' : first && first.dataset.module);
      const again = host().querySelector(`[data-face="${d.face}"]`);
      if (again) again.focus({ preventScroll: true });
    } else if (d.goto) {
      if (face !== 'panel') showFace('panel');
      gotoSection(d.goto);
    } else if (d.cable) {
      selected = selected === d.cable ? null : d.cable;
      say(selected ? 'Cable selected: Delete removes it.' : 'Cable deselected.');
      renderBay();
    } else if (d.removeCable) {
      const r = unpatch(model(), panel, d.removeCable);
      pending = null;
      if (r.reason) say(r.reason, true);
      else if (dispatch(r.action).ok) say('Cable removed; the normal is restored.');
    } else if (d.restoreNormal) {
      const r = restoreNormals(model(), panel, d.restoreNormal);
      if (r.reason) say(r.reason);
      else dispatch(r.action);
    } else if (d.breakNormal) {
      const r = breakNormals(model(), panel, d.breakNormal);
      if (r.reason) say(r.reason);
      else if (dispatch(r.action).ok) say(`The normal of ${jackName(d.breakNormal)} is broken.`);
    } else if (d.connectTo) {
      const from = pending;
      pending = null;
      if (from) connect(from, d.connectTo);
      renderAll();
      const j = host().querySelector(`[data-jack="${d.connectTo}"]`);
      if (j) j.focus({ preventScroll: true });
    } else if ('connectCancel' in d) {
      const j = pending;
      pending = null;
      say('Connection cancelled.');
      renderBay();
      const again = j && host().querySelector(`[data-jack="${j}"]`);
      if (again) again.focus({ preventScroll: true });
    } else if (d.collapse) {
      if (collapsed.has(d.collapse)) collapsed.delete(d.collapse);
      else collapsed.add(d.collapse);
      renderAll();
    } else if (d.foldAll) {
      collapsed = d.foldAll === 'closed' ? new Set(panel.modules.map((x) => x.id)) : new Set();
      renderAll();
    } else if (d.restoreModule) {
      restoreModule(d.restoreModule);
    } else if ('insertPanel' in d) {
      ensurePanel({ explicit: true });
    }
  }

  /**
   * A section chip: the module's plate scrolled to the top of the view and then down past the
   * sticky chip bar, so its heading is not under the bar; focus moves to the plate.
   */
  function gotoSection(mid) {
    const el = host();
    const target = el && el.querySelector(`[data-module="${mid}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: 'auto' });
    const bar = el.querySelector('nav[aria-label="Synth sections"]');
    const r = bar ? bar.getBoundingClientRect() : null;
    const over = r && r.height ? r.bottom + 8 - target.getBoundingClientRect().top : 0;
    let s = target.parentElement;
    while (s && s !== document.body && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) {
      s = s.parentElement;
    }
    if (over > 0) (s && s !== document.body ? s : window).scrollBy(0, -over);
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }

  function restoreModule(mid) {
    const m = panel.module(mid);
    const vals = presetValues(panel, presetOf('init'))[mid];
    const steps = [{ type: 'NODE_ADD', id: panel.nodeIdOf(mid), nodeType: m.node,
      params: vals, name: m.label, panel: { id: panel.instance, module: mid },
      position: { x: 0, y: 0 } }];
    const res = nodes();
    for (const n of panel.normals) {
      const a = splitJack(n.from);
      const b = splitJack(n.to);
      if (a.module !== mid && b.module !== mid) continue;
      const other = a.module === mid ? b.module : a.module;
      if (!res.get(other)) continue;
      const id = (x) => (x === mid ? panel.nodeIdOf(mid) : res.get(x).id);
      if (model().graph.edges.some((e) => e.id === n.edgeId)) continue;
      steps.push({ type: 'EDGE_ADD', id: n.edgeId, from: { node: id(a.module), port: a.port },
        to: { node: id(b.module), port: b.port }, props: n.props });
    }
    dispatch({ type: 'BATCH', label: `Restore ${m.label}`, steps });
  }

  function onKeyDown(e) {
    const k = e.target.closest && e.target.closest('[data-knob]');
    if (k) {
      const x = controlOf(k.dataset.knob);
      if (!x || !x.node || k.getAttribute('aria-disabled') === 'true') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        typeValue(k.dataset.knob);
        return;
      }
      const v = knobModel(x.c.param).key(valueOf(x), e.key, e.shiftKey);
      if (v === null) return;
      e.preventDefault();
      e.stopPropagation();
      setControl(k.dataset.knob, v);
      return;
    }
    if (gestures.choiceKey(e, host())) return;
    const j = e.target.closest && e.target.closest('[data-jack]');
    if (j && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.stopPropagation();
      tapJack(j.dataset.jack);
      const again = host().querySelector(`[data-jack="${j.dataset.jack}"]`);
      if (again) again.focus({ preventScroll: true });
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      const r = unpatch(model(), panel, selected);
      selected = null;
      if (!r.reason) dispatch(r.action);
    }
  }

  function typeValue(cid) {
    const out = host().querySelector(`[data-value="${cid}"]`);
    const x = controlOf(cid);
    if (!out || !x) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = knobModel(x.c.param).format(valueOf(x));
    input.setAttribute('aria-label', `${panel.module(x.mid).label} ${x.c.label}, type a value`);
    input.className = 'w-20 rounded border border-solid border-gray-300 bg-gray-50 px-1 text-xs '
      + 'text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white';
    out.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) {
        const r = knobModel(x.c.param).parse(input.value);
        if (!r.ok) say(r.reason, true);
        else setControl(cid, r.value);
      }
      renderAll();
      const k = host().querySelector(`[data-knob="${cid}"]`);
      if (k) k.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') finish(true);
      if (ev.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  function onDoubleClick(e) {
    const k = e.target.closest('[data-knob]');
    const x = k && controlOf(k.dataset.knob);
    if (!x || !x.node || k.getAttribute('aria-disabled') === 'true') return;
    setControl(k.dataset.knob, x.c.kind === 'amount' ? 0 : x.c.initial);
  }


  // K097 XY tab
  const xy = createXyTab({ panel, get, host, nodes, model, dispatch, say, jackName, tab, showTab,
    BTN, cmp: () => cmp });

  // ------------------------------------------------------------------ notes

  const { noteOn, noteOff, allOff, disarm } = createSynthNotes({ get, transport, ensurePanel,
    cmp: () => cmp, say, played, playedModule, present, nodes, panel, ENGINE_IDS, syncArmed });

  // ------------------------------------------------------------------ links

  function linkNow() {
    return encodeSynthLink({ ...linkOf(model(), panel, cmp.synth.preset), tab: tab(),
      engine: tab() === 'engines' ? engineId() : null });
  }

  function applyLink(link) {
    if (!ensurePanel()) return false;
    showTab(link.tab || 'panel', link.engine);
    if (!link.preset && !link.values.length && !link.cables.length) return true;
    const r = dispatch(linkAction(model(), panel, link, { registry }));
    if (r.ok && link.preset) cmp.synth.preset = link.preset;
    return r.ok;
  }

  /** Show tab `id` (and engine `eng` on Engines); held notes are released first. */
  function showTab(id, eng = null) {
    if (!cmp) return;
    const next = panel.tabs.some((x) => x.id === id) ? id : 'panel';
    if (next !== cmp.synth.tab || (eng && eng !== cmp.synth.engine)) allOff();
    cmp.synth.tab = next;
    const p = presetOf(cmp.synth.preset);
    if (!p || p.tab !== next) cmp.synth.preset = ''; // the menu lists this tab's presets
    if (eng && ENGINE_IDS.includes(eng)) cmp.synth.engine = eng;
    const info = panel.tabs.find((x) => x.id === next);
    cmp.synth.title = info.title;
    cmp.synth.description = info.description;
    dock.sync();
    requestAnimationFrame(renderAll);
  }

  const dock = createDock({ panel, registry, cmp: () => cmp, model, present, played,
    ensurePanel, dispatch, say, allOff });

  // ------------------------------------------------------------------ the part

  return {
    synth: {
      title: panel.title,
      description: panel.description,
      tabs: panel.tabs.map((x) => ({ id: x.id, label: x.label })),
      tab: 'panel',
      engine: ENGINE_IDS[0],
      presets: [...PRESETS, ...xy.presets].map((p) => ({ id: p.id, title: p.title, tab: p.tab })),
      preset: 'init',
      armed: false,
      status: '',
      link: '',
      dock: dock.state(), // K066, beside the piano (synth/dock.js)
    },

    synthInit() {
      cmp = this;
      follow(get().transport);
      dock.sync();
      handle().subscribe(() => queueMicrotask(refresh));
      const el = document.querySelector('[data-osc="synth-view"]');
      if (el) {
        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('pointermove', onPointerMove);
        el.addEventListener('pointerup', onPointerUp);
        // A cancelled pointer (the browser took the gesture) is neither a tap nor a drop.
        el.addEventListener('pointercancel', (e) => {
          if (cable) { cable = null; renderBay(); }
          onPointerUp(e);
        });
        el.addEventListener('click', onClick);
        el.addEventListener('dblclick', onDoubleClick);
        el.addEventListener('wheel', gestures.wheel, { passive: false });
        el.addEventListener('keydown', onKeyDown);
      }
      this.$watch('workspace', (ws, old) => {
        if (old === 'synth' && ws !== 'synth') {
          pending = null;
          disarm(false);
        }
        if (ws === 'synth') {
          syncArmed();
          ensurePanel();
          requestAnimationFrame(renderAll);
        }
      });
      this.$watch('theme', () => { if (this.workspace === 'synth') renderAll(); });
      window.addEventListener('resize', () => { if (this.workspace === 'synth') renderBay(); });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.workspace === 'synth') {
          pending = null;
          disarm(true);
        }
      });
      if (typeof this.navRegister === 'function') {
        this.navRegister('synth', (hash) => this.synthApplyLinkHash(hash));
      }
    },

    /** The note sink of src/js/midi/notes.js in this workspace (one path for every player). */
    synthSink() {
      return { noteOn, noteOff, allOff };
    },
    studioSink: () => studioSink.active(),

    synthArm() {
      const t = transport();
      if (!t || !ensurePanel()) return false;
      if (typeof this.ensureAudio === 'function') this.ensureAudio();
      const r = t.arm();
      if (!r.ok) say(r.code === 'claim-refused' ? SYNTH_TEXT.refused : r.reason, true);
      else say(SYNTH_TEXT.armed);
      this.synth.armed = !!t.armed;
      return r.ok;
    },

    synthDisarm() {
      return disarm(true);
    },

    synthPreset(id) {
      if (!ensurePanel()) return false;
      if (xy.has(id)) return xy.preset(id);
      const r = presetAction(model(), panel, id);
      if (r.reason) { say(r.reason, true); return false; }
      const done = dispatch(r.action);
      if (done.ok) {
        const p = presetOf(id);
        this.synth.preset = id;
        if (p.engine) showTab('engines', p.engine);
        say(`Preset ${p.title}.`);
      }
      return done.ok;
    },

    ...dock.methods,

    /** The tab strip (Panel | Engines). */
    synthTab(id) {
      showTab(id);
      return this.synth.tab;
    },

    synthOpenStudio() {
      const ids = [...nodes().values()].filter(Boolean).map((n) => n.id);
      handle().dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: ids } });
      this.setWorkspace('studio');
    },

    synthCopyLink() {
      const hash = linkNow();
      const url = `${window.location.href.split('#')[0]}#${hash}`;
      this.synth.link = url;
      try {
        navigator.clipboard.writeText(url).then(() => say('Synth link copied.'),
          () => say('Copy the link below; the clipboard is not available here.'));
      } catch (e) {
        say('Copy the link below; the clipboard is not available here.');
      }
      return hash;
    },

    /** The hash dispatcher's Synth domain (ui/navigation.js): null, true or false (refused). */
    synthApplyLinkHash(hash) {
      const r = decodeSynthLink(hash, panel, PRESETS);
      if (!r) return null;
      if (!r.ok) {
        say(r.reason, true);
        return false;
      }
      const ok = applyLink(r.link);
      const p = ok && presetOf(r.link.preset); // a link is answered (surface-census routes)
      if (ok && this.notify) this.notify('info', 'Synth opened from the link',
        `${p ? p.title : this.synth.title}. Nothing plays until you play a note.`);
      return ok;
    },

    /** Test and debug reads (window.OSCILLA.app.synthDebug(); not a contract). */
    synthDebug() {
      const t = get().transport;
      const on = present() ? played() : null;
      return { present: present(), armed: !!(t && t.armed), held: t ? t.heldNotes() : [],
        sinkHeld: studioSink.heldNotes(), // the Studio sink's held map (K175, S18)
        tab: tab(), engine: engineId(), played: on ? on.id : null,
        voices: t && on && typeof t.liveVoices === 'function' ? t.liveVoices(on.id) : 0,
        nodes: Object.fromEntries([...nodes()].map(([k, n]) => [k, n ? n.id : null])),
        cables: userCables(), link: present() ? linkNow() : '' };
    },
  };
}

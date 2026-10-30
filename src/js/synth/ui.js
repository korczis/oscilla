// The SYNTH workspace (plan K058-K066, K103 part, K104, K106 part): the DOM/Alpine adapter of the
// Synth panel, composed into the Studio part (ui/studio/workspace.js), which owns the ONE store
// and the ONE transport. The panel is a projection of the StudioModel (rule
// project.studio-model-is-canonical): knobs dispatch NODE_PARAM_SET, amounts and cables one
// BATCH each, and it re-reads the model after every change, so an edit made in Studio shows
// here and nothing is ever repaired behind the user's back.
//
// Audio: the keyboard, the on-screen keys and MIDI play the panel through ONE path, synthSink()
// (src/js/midi/notes.js `route`): the first note arms the transport (transport.arm: the Synth's
// nodes only, no timeline), then transport.live drives the Keys node. Leaving the workspace,
// Escape, page hide and STOP disarm; a measurement owning the output refuses the arm.
//
//   createSynthUi({ get, setupAudio, announce }) -> the component part
//     get() -> { handle, transport }   the workspace's store handle and transport (late-bound)

import SEMI_MONO from './panels/semi-mono.js';
import { PRESETS, presetAction, presetOf, presetValues } from './presets.js';
import {
  amountEdges, jackState, panelCables, patchCable, restoreNormals, setAmount, unpatch,
} from './normals.js';
import { linkAction, linkOf } from './link.js';
import { splitJack } from './panel.js';
import { esc, plateHtml } from './view/face.js';
import { knobModel, knobSvg, stepOption } from './view/knob.js';
import { bayLayout, baySvg, cablePath } from './view/bay.js';
import { panelTokens } from './view/tokens.js';
import { NODE_REGISTRY } from '../studio/registry.js';
import { canConnect } from '../studio/ports.js';
import { decodeSynthLink, encodeSynthLink } from '../core/url-state-synth.js';

export const SYNTH_PANEL = SEMI_MONO;
export const SYNTH_TEXT = Object.freeze({
  inserted: `Inserted the ${SEMI_MONO.title} into the Studio document; it feeds Master Output. `
    + 'Undo removes it.',
  armed: 'Synth armed: the keys play the panel.',
  disarmed: 'Synth disarmed: no note sounds.',
  refused: 'The Synth did not arm: the output belongs to the measurement. Stop it first (Esc).',
  direction: 'A cable runs from an output jack to an input jack.',
});
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

  const handle = () => get().handle;
  const transport = () => {
    setupAudio();
    return get().transport;
  };
  const model = () => handle().getModel();
  const nodes = () => panel.resolve(model());
  const present = () => !!nodes().get('keys');
  const host = () => document.querySelector('[data-osc="synth.panel"]');
  const say = (text, assertive = false) => {
    if (cmp) cmp.synth.status = text;
    announce(text, { assertive });
  };
  const dispatch = (action) => {
    const r = handle().dispatch(action);
    if (!r.ok) say(r.reason, true);
    return r;
  };

  function ensurePanel() {
    if (present()) return true;
    const m = model();
    const ys = m.graph.nodes.map((n) => n.position.y);
    const at = { x: 0, y: (ys.length ? Math.max(...ys) : 0) + 240 };
    const r = dispatch(panel.instantiate(m, { at }));
    if (r.ok) say(SYNTH_TEXT.inserted);
    return r.ok;
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
    const x = controlOf(cid);
    if (!x || !x.node) return null;
    if (x.c.kind === 'amount') {
      const a = setAmount(model(), panel, x.c.amount, value);
      return a ? dispatch(a) : null;
    }
    return dispatch({ type: 'NODE_PARAM_SET', nodeId: x.node.id, key: x.key, value });
  }

  // ------------------------------------------------------------------ cables

  /** A jack by its key ('module.port:in' | ':out'): a port id may name an input and an output. */
  const jackOf = (key) => {
    const { module } = splitJack(key);
    return panel.jacksOf(module).find((j) => j.key === key) || null;
  };
  const portOf = (j) => registry.port(panel.module(j.module).node, j.port, j.direction);
  function compatibleWith(id) {
    const a = jackOf(id);
    const out = new Set();
    if (!a) return out;
    for (const m of panel.modules) {
      for (const j of panel.jacksOf(m.id)) {
        if (j.direction === a.direction || j.module === a.module) continue;
        const [s, t] = a.direction === 'out' ? [portOf(a), portOf(j)] : [portOf(j), portOf(a)];
        if (canConnect(s, t).allowed) out.add(j.key);
      }
    }
    return out;
  }

  function connect(a, b) {
    const ja = jackOf(a);
    const jb = jackOf(b);
    if (!ja || !jb || ja.direction === jb.direction) return say(SYNTH_TEXT.direction, true);
    const [from, to] = ja.direction === 'out' ? [ja.id, jb.id] : [jb.id, ja.id];
    const r = patchCable(model(), panel, from, to, { registry });
    if (r.reason) return say(r.reason, true);
    const done = dispatch(r.action);
    if (done.ok) say(`Patched ${from} to ${to}.`);
    return done;
  }

  function tapJack(id) {
    if (!pending) {
      pending = id;
      say(`Connecting from ${jackOf(id).id}: choose a highlighted jack, or the same jack to `
        + 'cancel.');
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
    box.innerHTML = baySvg({ panel, layout, cables, states, pending, tokens, selected,
      compatible: pending ? compatibleWith(pending) : new Set() });
    const list = el.querySelector('[data-osc="synth.cables"]');
    const open = [...states].filter(([, s]) => s === 'open').map(([k]) => k.split(':')[0]);
    const item = 'flex items-center justify-between gap-2 py-1 text-xs text-gray-700 '
      + 'dark:text-gray-300';
    const btn = 'rounded-lg px-3 h-9 text-xs font-medium text-primary-700 border border-solid '
      + 'border-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-gray-700';
    if (list) {
      list.innerHTML = cables.map((c) => `<li class="${item}"><span>${esc(c.from)} → `
        + `${esc(c.to)}</span><button type="button" class="${btn}" data-remove-cable=`
        + `"${esc(c.id)}">Remove</button></li>`).join('')
        + open.map((j) => `<li class="${item}"><span>${esc(j)}: open, normal removed in Studio`
        + `</span><button type="button" class="${btn}" data-restore-normal="${esc(j)}">`
        + 'Restore normal</button></li>').join('')
        + (cables.length || open.length ? '' : `<li class="${item}">No cables: every jack plays `
        + 'its normal. Drag from one jack to another, or tap two jacks.</li>');
    }
  }

  const PLATE_GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4';
  function renderAll() {
    const el = host();
    if (!el || !cmp) return;
    const focus = document.activeElement;
    const keep = focus && el.contains(focus) ? ['data-knob', 'data-option', 'data-toggle',
      'data-jack'].map((a) => [a, focus.getAttribute(a), focus.getAttribute('data-v')])
      .find(([, v]) => v) : null;
    if (!present()) {
      el.innerHTML = '<div class="bg-white rounded-lg shadow dark:bg-gray-800 p-6 text-sm '
        + 'text-gray-700 dark:text-gray-300"><p>This Studio document has no Synth panel.</p>'
        + '<button type="button" data-insert-panel="" class="mt-3 rounded-lg bg-primary-600 px-4 '
        + `h-11 font-medium text-white">Insert the ${esc(panel.title)}</button></div>`;
      shape = 'empty';
      return;
    }
    const m = model();
    const res = nodes();
    const tokens = panelTokens(el);
    const chips = panel.modules.map((x) => `<button type="button" data-goto="${x.id}" class="`
      + 'snap-start shrink-0 rounded-full border border-solid border-gray-300 bg-white px-3 h-11 '
      + 'text-xs font-semibold tracking-wide text-gray-800 dark:border-gray-600 dark:bg-gray-800 '
      + `dark:text-gray-200">${esc(x.label)}</button>`).join('');
    const plates = panel.modules.map((x) => plateHtml({ panel, module: x, node: res.get(x.id),
      model: m, tokens })).join('');
    el.innerHTML = '<nav aria-label="Synth sections" class="sticky top-0 z-20 -mx-4 mb-3 flex '
      + 'snap-x snap-mandatory gap-2 overflow-x-auto bg-gray-50 px-4 py-2 dark:bg-gray-900 '
      + `xl:hidden">${chips}<button type="button" data-goto="bay" class="snap-start shrink-0 `
      + 'rounded-full border border-solid border-primary-600 px-3 h-11 text-xs font-semibold '
      + 'text-primary-700 dark:text-primary-400">PATCH BAY</button></nav>'
      + '<div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">'
      + `<div class="${PLATE_GRID}" data-osc="synth.modules">${plates}</div>`
      + '<section class="bg-white rounded-lg shadow dark:bg-gray-800 self-start p-3 '
      + 'xl:sticky xl:top-4" aria-labelledby="synth-bay-title" data-osc="synth.bay" '
      + 'data-module="bay"><h3 id="synth-bay-title" class="text-sm font-bold tracking-widest '
      + 'text-gray-900 dark:text-white">PATCH BAY</h3><p class="mt-1 text-xs text-gray-500 '
      + 'dark:text-gray-400">Every input is normalled: it plays with no cable. A cable into a '
      + 'jack replaces its normal; removing the cable restores it.</p>'
      + '<div class="mt-2 w-full" data-osc="synth.bay.canvas"></div>'
      + '<ul class="mt-2 divide-y divide-gray-200 dark:divide-gray-700" data-osc="synth.cables">'
      + '</ul></section></div>';
    shape = shapeOf();
    renderBay();
    if (keep) {
      const sel = keep[0] === 'data-option' ? `[data-option="${keep[1]}"][data-v="${keep[2]}"]`
        : `[${keep[0]}="${keep[1]}"]`;
      const again = el.querySelector(sel);
      if (again) again.focus({ preventScroll: true });
    }
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
    box.setAttribute('aria-valuenow', String(v));
    box.setAttribute('aria-valuetext', km.text(v));
    const out = el.querySelector(`[data-value="${cid}"]`);
    if (out) out.textContent = km.format(v);
  }

  function refresh() {
    if (!cmp || cmp.workspace !== 'synth') return;
    const t = get().transport;
    cmp.synth.armed = !!(t && t.armed);
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
      knob = { cid: k.dataset.knob, y: e.clientY, v: valueOf(x), param: x.c.param, el: k };
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
      const v = knobModel(knob.param).drag(knob.v, e.clientY - knob.y, e.shiftKey);
      const x = controlOf(knob.cid);
      if (x && v !== valueOf(x)) setControl(knob.cid, v);
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
      handle().endGesture();
      knob = null;
      renderAll();
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
      + '[data-remove-cable],[data-restore-normal],[data-restore-module],[data-insert-panel]');
    if (!t) return;
    const d = t.dataset;
    if (d.option) {
      const x = controlOf(d.option);
      const o = x && x.c.param.options.find((v) => String(v[0]) === d.v);
      if (o) setControl(d.option, o[0]);
    } else if (d.toggle) {
      const x = controlOf(d.toggle);
      if (t.getAttribute('aria-disabled') === 'true') {
        const why = document.getElementById(`${d.toggle}-why`);
        say(why ? why.textContent : 'This control is disabled.');
      } else if (x) setControl(d.toggle, !valueOf(x));
    } else if (d.goto) {
      gotoSection(d.goto);
    } else if (d.cable) {
      selected = selected === d.cable ? null : d.cable;
      say(selected ? 'Cable selected: Delete removes it.' : 'Cable deselected.');
      renderBay();
    } else if (d.removeCable) {
      const r = unpatch(model(), panel, d.removeCable);
      if (r.reason) say(r.reason, true);
      else if (dispatch(r.action).ok) say('Cable removed; the normal is restored.');
    } else if (d.restoreNormal) {
      const r = restoreNormals(model(), panel, d.restoreNormal);
      if (r.reason) say(r.reason);
      else dispatch(r.action);
    } else if (d.restoreModule) {
      restoreModule(d.restoreModule);
    } else if ('insertPanel' in d) {
      ensurePanel();
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
    const o = e.target.closest && e.target.closest('[data-option]');
    if (o && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      const x = controlOf(o.dataset.option);
      e.preventDefault();
      const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
      setControl(o.dataset.option, stepOption(x.c.param, valueOf(x), dir));
      const again = host().querySelector(`[data-option="${o.dataset.option}"][aria-checked="true"]`);
      if (again) again.focus({ preventScroll: true });
      return;
    }
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
    if (!x || !x.node) return;
    setControl(k.dataset.knob, x.c.kind === 'amount' ? 0 : x.c.initial);
  }

  // ------------------------------------------------------------------ notes

  function noteOn(note, velocity) {
    const t = transport();
    if (!t || !ensurePanel()) return { ok: false, reason: 'no-audio' };
    if (cmp && typeof cmp.ensureAudio === 'function') cmp.ensureAudio();
    if (!t.playing) {
      const r = t.arm();
      if (!r.ok) {
        say(r.code === 'claim-refused' ? SYNTH_TEXT.refused : r.reason, true);
        return { ok: false, reason: 'measurement' };
      }
      say(SYNTH_TEXT.armed);
      if (cmp) cmp.synth.armed = !!t.armed;
    }
    return t.live(nodes().get('keys').id, { kind: 'on', note, velocity });
  }

  function noteOff(note) {
    const t = get().transport;
    const k = present() ? nodes().get('keys') : null;
    return t && k ? t.live(k.id, { kind: 'off', note }).ok : false;
  }

  function allOff() {
    const t = get().transport;
    const k = present() ? nodes().get('keys') : null;
    if (!t || !k || !t.playing) return 0;
    return t.live(k.id, { kind: 'all-off' }).released || 0;
  }

  function disarm(reason) {
    const t = get().transport;
    if (!t || !t.armed) return Promise.resolve(null);
    const p = t.disarm();
    if (cmp) cmp.synth.armed = false;
    if (reason) say(SYNTH_TEXT.disarmed);
    return p;
  }

  // ------------------------------------------------------------------ links

  function linkNow() {
    return encodeSynthLink(linkOf(model(), panel, cmp.synth.preset));
  }

  function applyLink(link) {
    if (!ensurePanel()) return false;
    const r = dispatch(linkAction(model(), panel, link, { registry }));
    if (r.ok && link.preset) cmp.synth.preset = link.preset;
    return r.ok;
  }

  // ------------------------------------------------------------------ the part

  return {
    synth: {
      title: panel.title,
      description: panel.description,
      presets: PRESETS.map((p) => ({ id: p.id, title: p.title })),
      preset: 'init',
      armed: false,
      status: '',
      link: '',
    },

    synthInit() {
      cmp = this;
      handle().subscribe(() => queueMicrotask(refresh));
      const el = document.querySelector('[data-osc="synth-view"]');
      if (el) {
        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('pointermove', onPointerMove);
        el.addEventListener('pointerup', onPointerUp);
        el.addEventListener('pointercancel', onPointerUp);
        el.addEventListener('click', onClick);
        el.addEventListener('dblclick', onDoubleClick);
        el.addEventListener('keydown', onKeyDown);
      }
      this.$watch('workspace', (ws, old) => {
        if (old === 'synth' && ws !== 'synth') {
          pending = null;
          disarm(false);
        }
        if (ws === 'synth') {
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
      const r = presetAction(model(), panel, id);
      if (r.reason) { say(r.reason, true); return false; }
      const done = dispatch(r.action);
      if (done.ok) {
        this.synth.preset = id;
        say(`Preset ${presetOf(id).title}.`);
      }
      return done.ok;
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
      const l = r.link;
      if (!l.preset && !l.values.length && !l.cables.length) return true;
      return applyLink(l);
    },

    /** Test and debug reads (window.OSCILLA.app.synthDebug(); not a contract). */
    synthDebug() {
      const t = get().transport;
      return { present: present(), armed: !!(t && t.armed), held: t ? t.heldNotes() : [],
        nodes: Object.fromEntries([...nodes()].map(([k, n]) => [k, n ? n.id : null])),
        cables: userCables(), link: present() ? linkNow() : '' };
    },
  };
}

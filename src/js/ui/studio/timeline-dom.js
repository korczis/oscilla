// Small DOM helpers of the Studio timeline editors (no framework, no reactive state). Icons use
// the page's existing sprite (#i-play, #i-stop, #i-plus, #i-trash, #i-close, ...) or a 24x24
// stroke path drawn in the sprite's own style; colours come only from the tokens (CSS).

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * el('div', { class: 'x', dataset: { key: 'a' }, on: { click: fn }, text: 'Hi' }, children)
 * Attributes with null / undefined / false are skipped; true sets an empty attribute.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style') node.setAttribute('style', v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === 'value') node.value = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** An <svg> using a sprite symbol (decorative). */
export function spriteIcon(id) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

/** Stroke paths (24x24, currentColor) for glyphs the sprite does not have. */
const PATHS = Object.freeze({
  return: 'M6 5v14M19 5.5L9 12l10 6.5z',
  loop: 'M17 2.5l3 3-3 3M4 11V9.5a4 4 0 0 1 4-4h12M7 21.5l-3-3 3-3M20 13v1.5a4 4 0 0 1-4 4H4',
  marker: 'M6 21V4h11l-2.5 4L17 12H6',
  zoomIn: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM20 20l-4.8-4.8M10.5 7.5v6M7.5 10.5h6',
  zoomOut: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM20 20l-4.8-4.8M7.5 10.5h6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  split: 'M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5',
  duplicate: 'M8 8h11v11H8zM5 16V5h11',
  lane: 'M3 18c4 0 5-12 9-12s5 12 9 12',
  track: 'M4 6h16M4 12h16M4 18h16',
});

/** An inline stroke icon from PATHS (decorative). */
export function pathIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', PATHS[name] || '');
  svg.append(p);
  return svg;
}

/** An SVG element (namespaced). */
export function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  return node;
}

/** <select> wrapped in the OSCILLA select primitive; options [{ id, label }]. */
export function selectBox(options, value, attrs = {}, wrapClass = '') {
  const sel = el('select', attrs, options.map((o) => el('option', { value: o.id,
    text: o.label })));
  sel.value = value;
  return el('div', { class: `osc-select${wrapClass ? ` ${wrapClass}` : ''}` }, [sel]);
}

/** Set an attribute only when it changed (avoids needless DOM writes). */
export function setAttr(node, name, value) {
  const v = String(value);
  if (node.getAttribute(name) !== v) node.setAttribute(name, v);
}

/** Set text only when it changed. */
export function setText(node, text) {
  const v = String(text);
  if (node.textContent !== v) node.textContent = v;
}

/** True for coarse (touch) pointers: 44 px targets, tap-to-select before a drag. */
export function coarsePointer() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

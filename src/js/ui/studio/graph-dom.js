// Small DOM helpers of the Studio views. Text is always set through textContent and attributes
// through setAttribute, never innerHTML: node names, patch names and imported labels are
// untrusted plain text (spec §238).

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * h('button', { class: 'osc-btn', type: 'button', 'data-osc': 'x', onClick: fn }, ['Text'])
 * Attributes with a function value whose name starts with "on" become listeners; `false`,
 * `null` and `undefined` attributes are omitted; children are nodes or strings (text).
 */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

/** The SVG counterpart of h(). */
export function s(tag, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (typeof v === 'function' && k.startsWith('on')) {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'text') {
      el.textContent = String(v);
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
}

function append(el, children) {
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number'
      ? document.createTextNode(String(c)) : c);
  }
}

/** A <svg><use href="#id"/></svg> icon from the page's sprite. */
export function icon(id, cls = 'osc-ico') {
  return s('svg', { class: cls, 'aria-hidden': 'true', focusable: 'false' },
    [s('use', { href: `#${id}` })]);
}

/** Replace every child of el. */
export function replaceChildren(el, children) {
  while (el.firstChild) el.removeChild(el.firstChild);
  append(el, children);
}

/** Set an attribute only when it changes (avoids needless style/ARIA invalidation). */
export function setAttr(el, name, value) {
  if (value === null || value === undefined || value === false) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
    return;
  }
  const v = value === true ? '' : String(value);
  if (el.getAttribute(name) !== v) el.setAttribute(name, v);
}

/** Set textContent only when it changes. */
export function setText(el, text) {
  const t = String(text ?? '');
  if (el.textContent !== t) el.textContent = t;
}

/** True on a coarse (touch) primary pointer. */
export function coarsePointer() {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch (e) {
    return false;
  }
}

/** True when the user asked for reduced motion (§71, §248). */
export function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

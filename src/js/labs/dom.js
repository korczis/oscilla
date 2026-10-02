// Small DOM helpers shared by the lab controllers (framework-free). Controllers bind the
// shell's existing elements; they never restyle them (colours stay in the CSS tokens).

/** addEventListener that returns its own remover. */
export function on(el, type, fn, opts) {
  if (!el) return () => {};
  el.addEventListener(type, fn, opts);
  return () => el.removeEventListener(type, fn, opts);
}

/** Listen to the shell's `osc:ui` events ({ kind, key, value }) bubbling to rootEl. */
export function onUi(rootEl, fn) {
  return on(rootEl, 'osc:ui', (e) => fn(e.detail || {}));
}

/** Set textContent only when it changes (minimal DOM writes from render loops). */
export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/** Set an attribute only when it changes. */
export function setAttr(el, name, value) {
  if (!el) return;
  const v = String(value);
  if (el.getAttribute(name) !== v) el.setAttribute(name, v);
}

/** Fill percentage the shell's .osc-slider track uses (same formula as ui/app.js). */
export function sliderFillPct(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const v = Number(input.value);
  if (!(max > min) || !Number.isFinite(v)) return '0%';
  return `${Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)).toFixed(2)}%`;
}

/** Set a range input's value programmatically and keep its filled track and valuetext. */
export function setSlider(input, value, valueText) {
  if (!input) return;
  const s = String(value);
  if (input.value !== s) input.value = s;
  input.style.setProperty('--osc-fill', sliderFillPct(input));
  if (valueText != null) setAttr(input, 'aria-valuetext', valueText);
}

/** Set a text/number input unless the user is editing it right now. */
export function setField(input, text) {
  if (!input || document.activeElement === input) return;
  const s = String(text);
  if (input.value !== s) input.value = s;
}

/**
 * Bind a toggle button (role=switch with aria-checked, or aria-pressed). Clicking flips it and
 * calls onChange(value). Returns { value, set(v, silent), dispose }.
 */
export function bindSwitch(el, onChange, { attr } = {}) {
  if (!el) return { value: false, set() {}, dispose() {} };
  const name = attr || (el.hasAttribute('aria-pressed') ? 'aria-pressed' : 'aria-checked');
  const api = {
    get value() {
      return el.getAttribute(name) === 'true';
    },
    set(v, silent = false) {
      setAttr(el, name, v ? 'true' : 'false');
      el.classList.toggle('is-on', !!v);
      if (!silent && onChange) onChange(!!v);
    },
    dispose: () => {},
  };
  api.dispose = on(el, 'click', () => api.set(!api.value));
  return api;
}

/** data-value of the active (.is-active / aria-checked / aria-selected) child of a group. */
export function activeValue(rootEl, selector) {
  const items = [...rootEl.querySelectorAll(selector)];
  const act = items.find((el) => el.classList.contains('is-active')
    || el.getAttribute('aria-checked') === 'true'
    || el.getAttribute('aria-selected') === 'true');
  return act ? act.dataset.value : null;
}

/** Subscribe to adapter.onChange if present; returns an unsubscribe function. */
export function onAdapterChange(adapter, fn) {
  if (!adapter || typeof adapter.onChange !== 'function') return () => {};
  const off = adapter.onChange(fn);
  return typeof off === 'function' ? off : () => {};
}

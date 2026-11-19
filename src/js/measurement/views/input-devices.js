// Input device choice of the MEASURE setup (spec §29 step 1 "input device", §52, §88; plan
// V322). Pure: the DOM adapter (src/js/ui/measure.js) passes navigator.mediaDevices
// .enumerateDevices() results in and renders the options.
//
// Rules:
//   - The default is the default: value '' means "no deviceId", i.e. getUserMedia picks the
//     browser's / system's default input exactly as before V322.
//   - The list is read only after the microphone permission was granted (a setup check, the
//     live RTA or a reference capture opened the input): before that browsers hide labels and
//     often ids, so nothing useful can be listed.
//   - Labels are the browser's (§52): an input whose label is not exposed is listed as
//     "Input <n> (label not exposed by the browser)", never with an invented name. The
//     pseudo-devices 'default' and 'communications' (Chromium) are not separate inputs and are
//     left out; the "Default input" option covers them.
//   - A chosen input that is no longer listed (unplugged, disabled) stays selected and is shown
//     as "— not available" with a readable message: nothing switches to another microphone
//     silently; the setup check then says the device cannot be opened (capture.js
//     INPUT_DEVICE_UNAVAILABLE_TEXT) until the user chooses another input or the default.
//   - The raw deviceId lives only in the page (the option values); experiments store it hashed
//     (experiments/schema.js normalizeInput, calibration/device-id.js).
//   - TEST CONTEXT is a choice of this list (ledger W7b, ADR 0052): the last option, "TEST
//     CONTEXT · digital loopback (no microphone)", is the same as `?measure=loopback`. It is
//     not a device: it is selected while the loopback is on, choosing any input leaves it, and
//     it needs no microphone, so the choice stays enabled where the browser offers none.
//
//   inputDeviceList(devices) -> [{ id, label, labelExposed }]
//   inputDeviceView({ devices, selectedId, selectedLabel, enumerated, loopback, available })
//     -> { options: [{ value, label, missing, testContext? }], selected, missing, message,
//          status }

export const DEFAULT_INPUT_VALUE = '';
export const DEFAULT_INPUT_LABEL = 'Výchozí vstup (volí prohlížeč a systém)';
/** Chromium's aliases of real inputs; not separate devices. */
export const PSEUDO_INPUT_IDS = Object.freeze(['default', 'communications']);
export const INPUT_LIST_LIMIT = 32;
/** The option value of TEST CONTEXT; never a deviceId (a device with this id is not listed). */
export const TEST_CONTEXT_INPUT_VALUE = 'oscilla:test-context';
/** What follows the label of a selected input the browser no longer lists. */
export const GONE_SUFFIX = ' — není k dispozici';
export const TEST_CONTEXT_INPUT_LABEL = 'TESTOVACÍ KONTEXT · digitální smyčka (bez mikrofonu)';

const clean = (s) => String(s || '').replace(/[\s\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 120);

/** The real audio inputs of an enumerateDevices() result (see the header). */
export function inputDeviceList(devices) {
  const out = [];
  const seen = new Set();
  for (const d of Array.isArray(devices) ? devices : []) {
    if (!d || d.kind !== 'audioinput') continue;
    const id = typeof d.deviceId === 'string' ? d.deviceId : '';
    if (!id || PSEUDO_INPUT_IDS.includes(id) || id === TEST_CONTEXT_INPUT_VALUE
      || seen.has(id)) continue;
    seen.add(id);
    const label = clean(d.label);
    out.push({ id, label: label || `Vstup ${out.length + 1} (název prohlížeč nesděluje)`,
      labelExposed: !!label });
    if (out.length >= INPUT_LIST_LIMIT) break;
  }
  return out;
}

/** The view model of the input choice (see the header). */
export function inputDeviceView({ devices = [], selectedId = null, selectedLabel = null,
  enumerated = false, loopback = false, available = true } = {}) {
  const list = inputDeviceList(devices);
  // While TEST CONTEXT is on, the input chosen before it is remembered, not in use.
  const selected = loopback ? TEST_CONTEXT_INPUT_VALUE : selectedId || DEFAULT_INPUT_VALUE;
  const options = [{ value: DEFAULT_INPUT_VALUE, label: DEFAULT_INPUT_LABEL, missing: false },
    ...list.map((d) => ({ value: d.id, label: d.label, missing: false }))];
  const gone = !!selectedId && enumerated && !list.some((d) => d.id === selectedId);
  const missing = gone && !loopback;
  const name = clean(selectedLabel) || 'Zvolený vstup';
  const who = clean(selectedLabel) ? `„${clean(selectedLabel)}“` : 'Zvolený vstup';
  if (selectedId && !list.some((d) => d.id === selectedId)) {
    options.push({ value: selectedId, label: gone ? `${name}${GONE_SUFFIX}` : name,
      missing: gone });
  }
  options.push({ value: TEST_CONTEXT_INPUT_VALUE, label: TEST_CONTEXT_INPUT_LABEL,
    missing: false, testContext: true });
  let status;
  if (loopback) {
    status = 'Smyčka TESTOVACÍHO KONTEXTU: nepoužívá se žádné vstupní zařízení. Volbou vstupu '
      + 'TESTOVACÍ KONTEXT opustíte; co se v něm naměřilo, se vymaže.';
  } else if (!available) {
    status = 'Tento prohlížeč tu nenabízí žádný mikrofonní vstup; TESTOVACÍ KONTEXT žádný '
      + 'nepotřebuje.';
  } else if (!enumerated) {
    status = 'Spusťte kontrolu nastavení, aby se vstupy vypsaly (prohlížeč je ukáže až po '
      + 'povolení mikrofonu); do té doby se použije výchozí vstup.';
  } else if (!list.length) status = 'Prohlížeč kromě výchozího nevypisuje žádný vstup.';
  else status = `Vstupy vypsané prohlížečem: ${list.length}.`;
  return {
    options,
    selected,
    missing,
    message: missing ? `${who} už není k dispozici (odpojen nebo vypnut). Zvolte jiný `
      + 'vstup nebo výchozí vstup; nic se nepřepne samo.' : null,
    status,
  };
}

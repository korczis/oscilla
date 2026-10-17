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
export const DEFAULT_INPUT_LABEL = 'Default input (chosen by the browser and system)';
/** Chromium's aliases of real inputs; not separate devices. */
export const PSEUDO_INPUT_IDS = Object.freeze(['default', 'communications']);
export const INPUT_LIST_LIMIT = 32;
/** The option value of TEST CONTEXT; never a deviceId (a device with this id is not listed). */
export const TEST_CONTEXT_INPUT_VALUE = 'oscilla:test-context';
export const TEST_CONTEXT_INPUT_LABEL = 'TEST CONTEXT · digital loopback (no microphone)';

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
    out.push({ id, label: label || `Input ${out.length + 1} (label not exposed by the browser)`,
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
  const name = clean(selectedLabel) || 'The selected input';
  const who = clean(selectedLabel) ? `"${clean(selectedLabel)}"` : 'The selected input';
  if (selectedId && !list.some((d) => d.id === selectedId)) {
    options.push({ value: selectedId, label: gone ? `${name} — not available` : name,
      missing: gone });
  }
  options.push({ value: TEST_CONTEXT_INPUT_VALUE, label: TEST_CONTEXT_INPUT_LABEL,
    missing: false, testContext: true });
  let status;
  if (loopback) {
    status = 'TEST CONTEXT loopback: no input device is used. Choose an input to leave TEST '
      + 'CONTEXT; what was measured in it is cleared.';
  } else if (!available) {
    status = 'This browser offers no microphone input here; TEST CONTEXT needs none.';
  } else if (!enumerated) {
    status = 'Run the setup check to list the inputs (the browser shows them only after the '
      + 'microphone permission); until then the default input is used.';
  } else if (!list.length) status = 'The browser lists no input besides the default.';
  else status = `${list.length} input${list.length === 1 ? '' : 's'} listed by the browser.`;
  return {
    options,
    selected,
    missing,
    message: missing ? `${who} is no longer available (unplugged or disabled). Choose another `
      + 'input or the default input; nothing is switched for you.' : null,
    status,
  };
}

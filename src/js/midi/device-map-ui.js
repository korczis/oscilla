// The MIDI section's device map (plan issue V509): what midi/ui.js hands the Settings dialog for
// each connected known controller, built by midi/device-map.js from the derived profile.
//
// What a CC moves is named from the Synth panel's own declaration through synth/midi-cc.js
// ccControl, the function the Synth's status line and undo label use (one name, review C3 on
// V509's plan): the panel the slot reaches when it is in the document, so the map reads the same
// whether or not the user has opened the Synth yet.
//
//   createDeviceMaps({ devices }) -> {
//     map(id, bank)       the deviceMap of device `id` in `bank` (cached per device and bank)
//     litKey(device, m)   the key of the control that sent decoded message `m`, or null
//   }

import { actsOf, deviceMap, litKey } from './device-map.js';
import { ccControl } from '../synth/midi-cc.js';
import SEMI_MONO from '../synth/panels/semi-mono.js';

/** The Synth panel's controls as its declaration has them (every face control present). */
const PANEL_DEPS = Object.freeze({
  faceOf: SEMI_MONO.faceOf,
  played: () => 'keys',
  controlOf: (cid) => {
    const [mid, key] = String(cid).split('.');
    const c = SEMI_MONO.faceOf(mid).find((x) => x.key === key);
    return c ? { mid, node: { id: mid }, c } : null;
  },
});

export const PANEL_ACTS = actsOf({ ccControl: (cc) => ccControl(cc, PANEL_DEPS) });

export function createDeviceMaps({ devices }) {
  const cache = new Map();
  const byId = new Map((devices || []).map((d) => [d.id, d]));
  return {
    map(id, bank) {
      const device = byId.get(id);
      if (!device) return { id, name: '', banks: [], bank: null, groups: [] };
      const k = `${id}#${bank || ''}`;
      if (!cache.has(k)) cache.set(k, deviceMap(device, { bank, acts: PANEL_ACTS }));
      return cache.get(k);
    },
    litKey: (device, m) => (device ? litKey(device, m) : null),
  };
}

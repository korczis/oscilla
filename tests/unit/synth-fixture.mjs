// A Studio store holding the reference template plus the Synth panel (shared by the synth-*
// unit tests; not a test file itself).
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel, REFERENCE_TEMPLATE_ID } from '../../src/js/studio/templates/index.js';

export function panelStore() {
  const st = createStudioStore(templateModel(REFERENCE_TEMPLATE_ID),
    { idGenerator: createIdGenerator() });
  const r = st.dispatch(PANEL.instantiate(st.getModel(), { at: { x: 0, y: 600 } }));
  assert.equal(r.ok, true, r.reason);
  return st;
}

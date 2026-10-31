// K066 (part): every Synth preset is data that validates, stays in the panel's ranges, keeps an
// audio path to the output and applies as ONE BATCH (one history entry).
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { PRESETS, presetAction, presetValues } from '../../src/js/synth/presets.js';
import { validateParamValue } from '../../src/js/studio/registry.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
import { liveModel } from '../../src/js/studio/live-notes.js';
import { panelStore } from './synth-fixture.mjs';

test('five panel presets and the engine presets, every value valid for its narrowed parameter',
  () => {
  assert.deepEqual(PRESETS.filter((p) => p.tab === 'panel').map((p) => p.id),
    ['init', 'bass', 'lead', 'sweep', 'ring-bell']);
  // PR B (K090-K092, K121, K123): one tab per preset; an engine preset names its engine module.
  for (const p of PRESETS.filter((x) => x.tab === 'engines')) {
    assert.equal(PANEL.module(p.engine).tab, 'engines', p.id);
    for (const k of Object.keys(p.values)) assert.equal(k.split('.')[0], p.engine, `${p.id} ${k}`);
  }
  for (const p of PRESETS) {
    const v = presetValues(PANEL, p);
    for (const m of PANEL.modules) {
      for (const param of m.params) {
        assert.equal(validateParamValue(param, v[m.id][param.key]), null,
          `${p.id} ${m.id}.${param.key}`);
      }
    }
    for (const [id, d] of Object.entries(p.amounts)) {
      const a = PANEL.amounts.find((x) => x.id === id);
      assert.ok(a && d >= a.range[0] && d <= a.range[1], `${p.id} ${id}`);
    }
  }
});

test('each preset is one BATCH, one undo entry, and the result still compiles', () => {
  for (const p of PRESETS) {
    const st = panelStore();
    const r = presetAction(st.getModel(), PANEL, p.id);
    assert.equal(r.action.type, 'BATCH');
    const done = st.dispatch(r.action);
    assert.equal(done.ok, true, `${p.id}: ${done.reason}`);
    assert.equal(compileStudio(liveModel(st.getModel())).ok, true, p.id);
    if (done.changed) assert.match(st.undoLabel(), /^Preset /);
  }
  assert.match(presetAction(panelStore().getModel(), PANEL, 'x').reason, /no preset/);
});

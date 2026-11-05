// C024 (coherent-state one-output-owner): the output-owner table (src/js/ui/output-owner.js)
// refuses every claim while a measurement or a microphone level-reference capture holds the
// output, and the riff audition is refused by the same table and claims under its own name.
// Before this, a reference capture refused the MIDI and keyboard notes (midi/ui.js 'reference')
// but not claimOutput('instrument') nor the audition, whose voices were claimed as 'instrument',
// and Studio PLAY (ui/studio/workspace.js onClaimOutput) checked only the measurement.
//   node --test tests/unit/output-owner-one-table.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as oo from '../../src/js/ui/output-owner.js';
import { AUDITION_OPTIONS } from '../../src/js/studio/riffs/audition.js';
import { registerRiffSource } from '../../src/js/studio/riffs/source.js';
import { catalogEntries } from '../../src/js/studio/patch-catalog.js';
import { measureLifecyclePart } from '../../src/js/ui/measure/session.js';
import { claimStudioOutput } from '../../src/js/ui/studio/workspace.js';

/** A component whose measurement and reference probes the test sets. */
function component({ measuring = false, reference = false, playing = false, seq = false } = {}) {
  const log = [];
  const editor = { playing: seq, stop() { log.push('seq.stop'); this.playing = false; } };
  const cmp = {
    playing, seqPlaying: seq, alerts: [], studio: false,
    measureOwnsOutput: () => measuring,
    measureReferenceOwnsOutput: () => reference,
    notify(kind, title, text) { this.alerts.push({ kind, title, text }); },
    stopNow() { log.push('instrument.stopNow'); },
    studioOwnsOutput() { return this.studio; },
    studioStop() { log.push('studio.stop'); },
  };
  const owner = oo.createOutputOwner({ app: () => cmp, sequencer: () => editor });
  return { owner, cmp, log };
}

test('a microphone level-reference capture refuses claimOutput(instrument), stops nothing', () => {
  const { owner, cmp, log } = component({ reference: true, seq: true });
  const answer = owner.claimOutput('instrument');
  assert.notEqual(answer, true, 'the instrument does not take the output during the capture');
  assert.equal(answer, oo.REFERENCE_REFUSAL);
  assert.deepEqual(log, [], 'a refused claim stops nothing');
  assert.deepEqual(cmp.alerts.map((a) => [a.title, a.text]),
    [['Level reference capture', oo.REFERENCE_REFUSAL]]);
  // the sequencer is refused by the same row
  assert.equal(component({ reference: true }).owner.claimOutput('sequencer'),
    oo.REFERENCE_REFUSAL);
});

test('the refusals are one ordered table: the measurement first, then the reference', () => {
  assert.deepEqual(oo.OUTPUT_REFUSALS.map((r) => [r.owner, r.probe]),
    [['measurement', 'measureOwnsOutput'], ['reference', 'measureReferenceOwnsOutput']]);
  assert.equal(oo.outputRefusalOf(null), null);
  assert.equal(oo.outputRefusalOf({}), null, 'a component without the probes refuses nothing');
  assert.equal(oo.outputRefusalOf(component().cmp), null);
  assert.equal(oo.outputRefusalOf(component({ measuring: true, reference: true }).cmp).text,
    oo.OUTPUT_REFUSAL);
  assert.equal(oo.outputRefusalOf(component({ reference: true }).cmp).owner, 'reference');
});

test('MEASURE reports the reference capture as the owner only for a microphone input', () => {
  const probe = (ctx) => measureLifecyclePart({ me: null, charts: {}, ...ctx }, {}, {})
    .measureReferenceOwnsOutput();
  assert.equal(probe({ refCapture: { io: {} }, ioKind: 'microphone' }), true);
  // the loopback TEST CONTEXT captures the instrument's own output: it must stay playable
  assert.equal(probe({ refCapture: { io: {} }, ioKind: 'loopback' }), false);
  assert.equal(probe({ refCapture: null, ioKind: 'microphone' }), false);
});

test('the riff audition claims the output as audition, not as the instrument', () => {
  assert.equal(oo.playOwnerOf({ ...AUDITION_OPTIONS, riff: 'mirrorball-octaves' }), 'audition');
  assert.equal(oo.playOwnerOf({ mode: 'hold' }), 'instrument');
  assert.equal(oo.playOwnerOf(undefined), 'instrument');
  assert.ok(Object.hasOwn(oo.OUTPUT_YIELDS, AUDITION_OPTIONS.owner),
    'the audition is a row of the owner table');
  const { owner } = component({ seq: true });
  assert.equal(owner.claimOutput('audition'), true);
  assert.throws(() => owner.claimOutput('nobody'), /unknown owner/);
});

test('the audition is refused by the table during a reference capture, before any stop', () => {
  const log = [];
  const engine = { on: () => () => {}, voice: null,
    play: () => { log.push('play'); return { id: 1 }; }, stopAll: () => log.push('stopAll') };
  let reference = true;
  let measuring = false;
  const cmp = { measureOwnsOutput: () => measuring, measureReferenceOwnsOutput: () => reference };
  registerRiffSource({ engine, stopPlayback: () => log.push('stopPlayback'),
    outputRefusalOf: oo.outputRefusalOf }, cmp);
  const entry = catalogEntries({}).find((e) => e.id === 'riff-mirrorball-octaves');
  assert.ok(entry && entry.audition, 'the riff entry carries its audition');
  const busy = entry.audition.ctl.start('mirrorball-octaves');
  assert.equal(busy.ok, false, 'Listen is refused while the reference is captured');
  assert.equal(busy.reason, oo.REFERENCE_REFUSAL);
  assert.deepEqual(log, [], 'nothing stopped, nothing played');
  reference = false;
  measuring = true;
  assert.equal(entry.audition.ctl.start('mirrorball-octaves').reason, oo.OUTPUT_REFUSAL,
    'a measurement refuses it with the table\'s sentence');
  measuring = false;
  assert.equal(entry.audition.ctl.start('mirrorball-octaves').ok, true);
  assert.deepEqual(log, ['stopPlayback', 'play']);
  registerRiffSource(); // leave no source holding this test's engine
});

test('main.js wires the table: the play guard claims playOwnerOf, the Studio gets refusals', () => {
  const main = readFileSync(new URL('../../src/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /claimOutput\(playOwnerOf\(o\)\) !== true/);
  assert.doesNotMatch(main, /claimOutput\('instrument'\)/);
  assert.match(main, /createStudioUi\(\{[^}]*\boutputRefusalOf\b/);
});

test('Studio PLAY is refused by the same table during a reference capture, before any stop', () => {
  const said = [];
  const stops = [];
  const announce = (text, opts) => said.push([text, !!(opts && opts.assertive)]);
  const svc = { outputRefusalOf: oo.outputRefusalOf, stopPlayback: (c) => stops.push(c) };
  const reference = component({ reference: true }).cmp;
  assert.equal(claimStudioOutput(reference, svc, announce), false,
    'the Studio does not take the output while the reference is captured');
  assert.deepEqual(said, [[oo.REFERENCE_REFUSAL, true]]);
  assert.deepEqual(stops, [], 'a refused PLAY stops nothing');
  said.length = 0;
  assert.equal(claimStudioOutput(component({ measuring: true, reference: true }).cmp, svc,
    announce), false);
  assert.deepEqual(said, [[oo.OUTPUT_REFUSAL, true]], 'the measurement row comes first');
  said.length = 0;
  const free = component().cmp;
  assert.equal(claimStudioOutput(free, svc, announce), true);
  assert.deepEqual(said, []);
  assert.deepEqual(stops, [free], 'a granted PLAY stops every other owner');
  assert.equal(claimStudioOutput(null, svc, announce), true, 'no component, nothing to refuse');
  // the workspace hands this claim to the transport, not a check of its own
  const ws = readFileSync(new URL('../../src/js/ui/studio/workspace.js', import.meta.url),
    'utf8');
  assert.match(ws, /onClaimOutput: \(\) => claimStudioOutput\(ctx\.cmp, svc, announce\)/);
});

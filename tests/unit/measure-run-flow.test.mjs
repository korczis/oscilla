// MEASURE's run flow (src/js/ui/measure/run.js createRun, measureFlowPart, measureRecipeLinkPart;
// V355, V424; ledger C1): a setup check or a measurement that fails says so (an aborted one says
// nothing); a level calibration with no known input is checked against the input first; a setup
// that differs from the loaded definition is named; the primary and secondary actions open
// MEASURE and dispatch; a Studio recipe run resolves { ok, state, ... } and never rejects; expert
// mode, the setup values and the level edit the recipe and reset a READY check; the recipe link is
// encoded into this page's URL, copied (or shown in a dialog), and applied from a hash only when
// it is new, valid and no measurement runs. On fake engine, io and component objects.
//   node --test tests/unit/measure-run-flow.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRun, measureFlowPart, measureRecipeLinkPart,
} from '../../src/js/ui/measure/run.js';
import { FIELD_DEFAULTS, recipeValues } from '../../src/js/ui/measure/constants.js';
import { encodeRecipeLink, recipeParamOf } from '../../src/js/core/url-state-measure.js';
import { MEASUREMENT_STATES as S } from '../../src/js/measurement/state-machine.js';
import { createLevelCalibration } from '../../src/js/calibration/level.js';

function fakeEngine({ preflight = () => Promise.resolve(), measure = () => Promise.resolve(null),
  state = S.IDLE } = {}) {
  return { state, resets: 0, preflights: 0, measures: [],
    reset() { this.resets += 1; this.state = S.IDLE; },
    preflight(recipe, opts) { this.preflights += 1; return preflight(recipe, opts); },
    measure(recipe, opts) { this.measures.push({ recipe, opts }); return measure(recipe, opts); } };
}

function harness({ engine = fakeEngine(), cal = { useLevel: false }, inputKnown = true } = {}) {
  const notes = [];
  const counts = { refresh: 0, stopLive: 0, rebuildAll: 0, stopPlayback: 0, init: 0 };
  const recipe = { id: 'setup-recipe' };
  const ctx = { me: engine, refCapture: null, levelCal: null, definition: null, repeatOf: null,
    pending: null, shown: null, result: null };
  const svc = { engine: { init() { counts.init += 1; } },
    stopPlayback() { counts.stopPlayback += 1; } };
  const ops = {
    refresh() { counts.refresh += 1; },
    stopLive() { counts.stopLive += 1; },
    ensureEngine: () => engine,
    rebuildAll() { counts.rebuildAll += 1; },
    recipeNow: () => recipe,
    calibrationInput: () => null,
    inputKnown: () => inputKnown,
    setupIsDefinition: () => false,
  };
  const cmp = { notify: (kind, title, text) => notes.push({ kind, title, text }),
    meas: { busy: false, saved: true, savedId: 'x', notes: '', values: { ...FIELD_DEFAULTS },
      cal, expert: false, view: { quantity: 'magnitude' }, flow: { primaryAction: null },
      recipeLinkErrors: [], recipeLink: null, stimulusText: 'Log sweep 20 Hz–20 kHz' } };
  const run = createRun(ctx, svc, ops);
  return { ctx, svc, ops, cmp, run, notes, counts, engine, recipe };
}

test('a setup check that fails says so; an aborted one says nothing', async () => {
  const bad = harness({ engine: fakeEngine({ preflight: () => Promise.reject(new Error('No input')),
    state: S.COMPLETE }) });
  await bad.run.runPreflight(bad.cmp);
  assert.equal(bad.engine.resets, 1, 'a finished run is reset first');
  assert.deepEqual(bad.notes, [{ kind: 'error', title: 'Kontrola nastavení selhala', text: 'No input' }]);
  assert.equal(bad.ctx.pending, null);
  assert.equal(bad.cmp.meas.saved, false);
  assert.equal(bad.cmp.meas.savedId, null);
  assert.equal(bad.counts.stopLive, 1, 'the live RTA never runs beside a capture');

  const abort = harness({ engine: fakeEngine({ preflight: () => Promise.reject(
    Object.assign(new Error('stop'), { code: 'ABORTED' })) }) });
  await abort.run.runPreflight(abort.cmp);
  assert.deepEqual(abort.notes, []);
});

test('a failed measurement says so and resolves null; the definition mismatch is named',
  async () => {
    const h = harness({ engine: fakeEngine({
      measure: () => Promise.reject(new Error('Clipped')) }) });
    h.ctx.definition = { id: 'def-1' };
    assert.equal(await h.run.runMeasure(h.cmp), null);
    assert.deepEqual(h.notes.map((n) => [n.kind, n.title]), [
      ['warning', 'Neběží podle definice'], ['error', 'Měření selhalo']]);
    assert.equal(h.ctx.lastRecipe, h.recipe);
    assert.equal(h.ctx.checking, h.recipe);
    assert.equal(h.ctx.runDefinition, null);
    assert.equal(h.counts.stopPlayback, 1);

    // A Studio recipe is not the setup's, and a run from it names no definition.
    const s = harness();
    s.ctx.definition = { id: 'def-1' };
    const given = { id: 'studio' };
    await s.run.runMeasure(s.cmp, given, 2.5);
    assert.equal(s.ctx.checking, null);
    assert.deepEqual(s.notes, []);
    assert.equal(s.engine.measures[0].recipe, given);
    assert.equal(s.engine.measures[0].opts.startAt, 2.5);
  });

test('a level calibration with no known input is checked against the input first (C1)',
  async () => {
    const cal = createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
      observedDbRelative: -20, createdAt: '2026-11-18T00:00:00Z' });
    const order = [];
    const engine = fakeEngine({ preflight: async () => { order.push('preflight'); },
      measure: async () => { order.push('measure'); return null; } });
    const h = harness({ engine, cal: { useLevel: true }, inputKnown: false });
    h.ctx.levelCal = { ...cal, offsetDb: cal.offsetDb + 5 }; // not valid: no check
    assert.equal(h.run.levelNeedsInputCheck(h.cmp), false);
    h.ctx.levelCal = cal;
    assert.equal(h.run.levelNeedsInputCheck(h.cmp), true);
    await h.run.runMeasure(h.cmp);
    assert.deepEqual(order, ['preflight', 'measure']);
    // A READY setup has checked the input already; a known input or an unused level needs none.
    engine.state = S.READY;
    await h.run.runMeasure(h.cmp);
    assert.deepEqual(order.slice(2), ['measure']);
    const known = harness({ cal: { useLevel: true }, inputKnown: true });
    known.ctx.levelCal = cal;
    assert.equal(known.run.levelNeedsInputCheck(known.cmp), false);
    const unused = harness({ cal: { useLevel: false }, inputKnown: false });
    unused.ctx.levelCal = cal;
    assert.equal(unused.run.levelNeedsInputCheck(unused.cmp), false);
  });

test('applyRecipeValues is refused while a measurement runs and resets a READY check', () => {
  const h = harness({ engine: fakeEngine({ state: S.READY }) });
  h.cmp.meas.busy = true;
  assert.deepEqual(h.run.applyRecipeValues(h.cmp, { repeats: 5 }),
    { ok: false, errors: ['a measurement is running'] });
  h.cmp.meas.busy = false;
  h.ctx.refCapture = {};
  assert.equal(h.run.applyRecipeValues(h.cmp, { repeats: 5 }).ok, false);
  h.ctx.refCapture = null;
  assert.deepEqual(h.run.applyRecipeValues(h.cmp, { repeats: 5 }), { ok: true });
  assert.equal(h.cmp.meas.values.repeats, 5);
  assert.equal(h.engine.resets, 1);
});

/** A component with the flow part over the harness. */
function flow(h, extra = {}) {
  const calls = [];
  const ops = { ...h.ops, runPreflight: async () => calls.push('preflight'),
    runMeasure: async (cmp, recipe, startAt) => {
      calls.push(['measure', recipe || null, startAt ?? null]);
      return extra.result === undefined ? null : extra.result;
    },
    safely: (what, fn) => { calls.push(['safely', what]); fn(); },
    rebuildResponse: () => calls.push('rebuildResponse'),
    selectInput: (cmp, id) => `input:${id}`, refreshInputs: async () => 'inputs' };
  const c = Object.assign(Object.create(null), h.cmp, measureFlowPart(h.ctx, h.svc, ops), {
    workspace: 'playground', setWorkspace(w) { this.workspace = w; },
    measureAbort: (why) => calls.push(['abort', why]),
    measureSave: async (o) => { calls.push('save'); return extra.save ? extra.save(o) : 'exp-1'; },
    measureOwnsOutput: () => !!extra.owns, rovingKeydown: (e) => calls.push(['roving', e]),
    measureSetView: (k, v) => calls.push(['view', k, v]),
  });
  return { c, calls };
}

test('the primary action opens MEASURE and runs what it names; a disabled one does nothing',
  async () => {
    const h = harness();
    const { c, calls } = flow(h);
    await c.measureRunPrimary();
    c.meas.flow.primaryAction = { id: 'measure', enabled: false };
    await c.measureRunPrimary();
    assert.deepEqual(calls, []);
    assert.equal(c.workspace, 'playground');
    for (const id of ['preflight', 'measure', 'stop', 'save', 'repeat', 'other']) {
      c.meas.flow.primaryAction = { id, enabled: true };
      await c.measureRunPrimary();
    }
    assert.equal(c.workspace, 'measure');
    assert.deepEqual(calls, ['preflight', ['measure', null, null], ['abort', 'user'], 'save',
      ['measure', null, null]]);
    h.ctx.error = new Error('x');
    c.meas.flow.primaryAction = { id: 'acknowledge', enabled: true };
    await c.measureRunPrimary();
    assert.equal(h.ctx.error, null);
    assert.equal(h.engine.resets, 1);
  });

test('the secondary actions: stop, repeat (opening MEASURE, as a new experiment), expert',
  async () => {
    const h = harness();
    const { c, calls } = flow(h);
    await c.measureRunSecondary('stop');
    c.meas.savedId = 'exp-7';
    await c.measureRunSecondary('repeat');
    assert.equal(c.workspace, 'measure');
    assert.equal(h.ctx.repeatOf, 'exp-7');
    await c.measureRunSecondary('expert');
    assert.equal(c.meas.expert, true);
    await c.measureRunSecondary('nothing');
    c.measureStop();
    assert.deepEqual(calls, [['abort', 'user'], ['measure', null, null], ['abort', 'user']]);
    await c.measureStart();
    await c.measureCheck();
    assert.deepEqual(calls.slice(-2), [['measure', null, null], 'preflight']);
  });

test('leaving expert mode returns the quantity to magnitude and rebuilds the response', () => {
  const h = harness();
  const { c, calls } = flow(h);
  c.meas.expert = true;
  c.meas.view.quantity = 'phase';
  c.measureSetExpert(false);
  assert.equal(c.meas.view.quantity, 'magnitude');
  assert.deepEqual(calls, [['safely', 'frequency response'], 'rebuildResponse']);
  c.measureSetExpert(true);
  c.measureSetExpert(0);
  assert.equal(c.meas.expert, false);
  assert.equal(calls.length, 2, 'magnitude already: nothing rebuilt');
});

test('setup values: live RTA fields go to the view; numbers, toggles and choices to the recipe',
  () => {
    const h = harness({ engine: fakeEngine({ state: S.READY }) });
    const { c, calls } = flow(h);
    c.measureSetValue('fftSize', '16384');
    c.measureSetValue('rtaMode', 'octave');
    assert.deepEqual(calls, [['view', 'rtaFftSize', 16384], ['view', 'rtaMode', 'octave']]);
    assert.equal(h.engine.resets, 0, 'the live view is not the recipe');
    c.measureSetValue('repeats', 'abc', 'number');
    assert.equal(c.meas.values.repeats, FIELD_DEFAULTS.repeats, 'not a number: unchanged');
    c.measureSetValue('repeats', '4', 'number');
    assert.equal(c.meas.values.repeats, 4);
    assert.equal(h.engine.resets, 1, 'a READY check is reset by a recipe change');
    c.measureSetValue('flag', 1, 'toggle');
    assert.equal(c.meas.values.flag, true);
    c.measureSetLevel('loud');
    assert.equal(c.meas.values.level, FIELD_DEFAULTS.level, 'not a level: unchanged');
    c.measureSetLevel('high');
    assert.equal(c.meas.values.level, 'high');
    c.measureLevelKeydown('k');
    assert.deepEqual(calls.at(-1), ['roving', 'k']);
    assert.equal(c.measureSelectInput('dev-1'), 'input:dev-1');
  });

test('a Studio recipe run: refused when busy, failed with its reasons, saved with its decoration',
  async () => {
    const h = harness();
    const busy = flow(h, { owns: true }).c;
    assert.deepEqual(await busy.measureRunRecipe({}), { ok: false, state: S.IDLE,
      reason: 'Měření už probíhá.' });

    const throwing = flow(h).c;
    throwing.measureRunRecipe = measureFlowPart(h.ctx, h.svc, { ...h.ops,
      runMeasure: async () => { throw new Error('io gone'); } }).measureRunRecipe;
    assert.deepEqual(await throwing.measureRunRecipe({}), { ok: false, state: S.IDLE,
      reason: 'io gone' });

    const invalid = flow(h, { result: { state: S.INVALID, reasons: [
      { severity: 'ok', text: 'Level fine.' }, { severity: 'error', text: 'Clipped.' },
      { severity: 'warning', text: 'Noisy.' }, { severity: 'error', text: 'Third.' }] } }).c;
    assert.deepEqual(await invalid.measureRunRecipe({}), { ok: false, state: S.INVALID,
      reason: 'Clipped. Noisy.' });

    h.ctx.error = new Error('Engine stopped.');
    const none = flow(h).c;
    assert.deepEqual(await none.measureRunRecipe({}), { ok: false, state: S.IDLE,
      reason: 'Engine stopped.' });

    const ok = flow(h, { result: { state: S.COMPLETE },
      save: (o) => { o.decorate({ name: 'Raw' }); return 'exp-9'; } });
    const r = await ok.c.measureRunRecipe({ id: 'studio' }, { startAt: 3,
      decorate: (e) => ({ ...e, name: `${e.name} (Studio)` }) });
    assert.equal(r.ok, true);
    assert.equal(r.experimentId, 'exp-9');
    assert.equal(r.name, 'Raw (Studio)');
    assert.deepEqual(ok.calls[0], ['measure', { id: 'studio' }, 3]);

    const unsaved = flow(h, { result: { state: S.COMPLETE }, save: () => null }).c;
    assert.deepEqual(await unsaved.measureRunRecipe({}), { ok: false, state: S.COMPLETE,
      reason: 'Experiment nebyl uložen.' });
  });

/** A component with the recipe link part over the harness. */
function link(h) {
  const opened = [];
  const c = Object.assign(h.cmp, measureRecipeLinkPart(h.ctx, h.svc, {
    applyRecipeValues: (cmp, values) => h.run.applyRecipeValues(cmp, values) }), {
    openModal: (id) => opened.push(id) });
  return { c, opened };
}

test('the recipe link carries the recipe only and opens MEASURE; without a window there is none',
  () => {
    const h = harness();
    const { c } = link(h);
    assert.equal(c.measureRecipeParam(), encodeRecipeLink(recipeValues(c.meas.values)));
    delete globalThis.window;
    assert.equal(c.measureRecipeUrl(), null);
    globalThis.window = { location: { href: 'https://x.test/oscilla/#m=studio&st=a',
      hash: '#m=studio&st=a' } };
    const url = c.measureRecipeUrl();
    assert.ok(url.startsWith('https://x.test/oscilla/#'));
    const hash = url.split('#')[1];
    assert.equal(recipeParamOf(hash), c.measureRecipeParam());
    assert.equal(new URLSearchParams(hash).get('m'), 'measure');
  });

/** Replace globalThis.navigator (a getter in Node) for one test; returns the restore. */
function setNavigator(value) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
  return () => (saved ? Object.defineProperty(globalThis, 'navigator', saved)
    : delete globalThis.navigator);
}

test('copying the recipe link: the clipboard when it can, else the dialog', async (t) => {
  const h = harness();
  const { c, opened } = link(h);
  const replaced = [];
  globalThis.window = { isSecureContext: true, location: { href: 'https://x.test/#', hash: '' },
    history: { state: null, replaceState: (s, title, u) => replaced.push(u) } };
  const written = [];
  t.after(setNavigator({ clipboard: { writeText: async (u) => { written.push(u); } } }));
  const url = await c.measureCopyRecipeLink();
  assert.deepEqual(replaced, [url]);
  assert.deepEqual(written, [url]);
  assert.equal(c.meas.recipeLink, url);
  assert.equal(h.ctx.lastRecipeParam, c.measureRecipeParam(), 'our own link is not applied again');
  assert.equal(h.notes.at(-1).kind, 'success');
  assert.deepEqual(opened, []);

  globalThis.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  await c.measureCopyRecipeLink();
  assert.deepEqual(opened, ['osc-dlg-recipe-link']);
  globalThis.window.isSecureContext = false;
  await c.measureCopyRecipeLink();
  assert.equal(opened.length, 2);
  delete globalThis.window;
  assert.equal(await c.measureCopyRecipeLink(), null);
});

test('a recipe hash is applied once when valid, refused whole when not or while a run is busy',
  () => {
    const h = harness();
    const { c } = link(h);
    assert.equal(c.measureApplyRecipeHash('#m=measure'), null);
    assert.equal(h.ctx.lastRecipeParam, null);

    assert.equal(c.measureApplyRecipeHash('#mr=%21%21%21'), false);
    assert.ok(c.meas.recipeLinkErrors.length >= 1);
    assert.equal(h.notes.at(-1).title, 'Odkaz na recept nebyl použit');
    assert.equal(c.measureApplyRecipeHash('#mr=%21%21%21'), null, 'the same link is not re-read');

    const param = encodeRecipeLink({ ...recipeValues(FIELD_DEFAULTS), repeats: 6 });
    h.cmp.meas.busy = true;
    assert.equal(c.measureApplyRecipeHash(`#mr=${param}`), false);
    assert.deepEqual(c.meas.recipeLinkErrors, ['a measurement is running']);
    assert.equal(h.ctx.lastRecipeParam, null, 'a refused link may be opened again');
    h.cmp.meas.busy = false;
    h.ctx.repeatOf = 'exp-1';
    assert.equal(c.measureApplyRecipeHash(`#mr=${param}`), true);
    assert.equal(c.meas.values.repeats, 6);
    assert.deepEqual(c.meas.recipeLinkErrors, []);
    assert.equal(h.ctx.repeatOf, null);
    assert.equal(h.notes.at(-1).kind, 'info');
    assert.match(h.notes.at(-1).text, /^Log sweep 20 Hz–20 kHz, běhy: 6\./);
    assert.equal(c.measureApplyRecipeHash(`#mr=${param}`), null);
  });

// U006 (P08 of the owner's pack): a Studio filter node opens in Filter Lab. The selector
// nodeParamsOf (src/js/studio/node-params.js) and its one filter mapping, shared with the
// Playground voice; the lab link codec (src/js/core/url-state-lab.js) and its place among the
// hash domains; the bridge (src/js/ui/studio/lab-bridge.js): a stale link says so, a missing
// or non-filter node is refused and the lab keeps its own values, nothing is written to Studio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FILTER_LAB_FIELDS, filterNodeParams, labFilterOf, nodeParamsOf,
} from '../../src/js/studio/node-params.js';
import { playgroundVoiceModel, PLAYGROUND_VOICE_IDS } from '../../src/js/studio/playground-voice.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { templateModel } from '../../src/js/studio/templates/index.js';
import {
  LAB_LINK_KEYS, decodeLabLink, encodeLabLink, withoutLabParams,
} from '../../src/js/core/url-state-lab.js';
import { STUDIO_LINK_KEYS } from '../../src/js/core/url-state-studio.js';
import { RECIPE_HASH_KEY } from '../../src/js/core/url-state-measure.js';
import { RECORD_LINK_KEYS } from '../../src/js/core/url-state-records.js';
import { SYNTH_LINK_KEYS } from '../../src/js/core/url-state-synth.js';
import { KEYBOARD_LINK_KEY } from '../../src/js/midi/keyboard.js';
import {
  HASH_DOMAINS, INSTRUMENT_HASH_KEYS, ROUTE_KEY, hashAfterRefusal, hashForWorkspace, routeOfHash,
} from '../../src/js/ui/navigation.js';
import { revealDelta } from '../../src/js/ui/studio/graph-geometry.js';
import {
  FILTER_LAB_TYPES, canOpenInLab, createLabBridgeUi, limitedNotices, openInLab, resolveLabLink,
  staleNotice,
} from '../../src/js/ui/studio/lab-bridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML = readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const REF = () => templateModel('subtractive-synth');

// ------------------------------------------------------------------------------ the selector
test('nodeParamsOf fills the registry defaults the node does not set', () => {
  const m = REF();
  const raw = m.graph.nodes.find((n) => n.id === 'filter-1').params;
  const got = nodeParamsOf(m, 'filter-1', NODE_REGISTRY);
  assert.equal(got.type, 'filter');
  assert.deepEqual(Object.keys(got.params).sort(),
    NODE_REGISTRY.get('filter').params.map((p) => p.key).sort());
  for (const p of NODE_REGISTRY.get('filter').params) {
    assert.deepEqual(got.params[p.key], Object.hasOwn(raw, p.key) ? raw[p.key] : p.default,
      `${p.key}: the node's own value, else the registry default`);
  }
  assert.equal(got.params.frequency, 500, 'the template sets the cutoff');
  // A node that sets only some parameters (a plain-data model, before normalization).
  const sparse = { graph: { nodes: [{ id: 'f', type: 'filter', params: { frequency: 300,
    bogus: 1 } }] } };
  const filled = nodeParamsOf(sparse, 'f', NODE_REGISTRY).params;
  assert.equal(filled.frequency, 300);
  assert.equal(filled.Q, NODE_REGISTRY.param('filter', 'Q').default, 'Q is the default');
  assert.equal(filled.type, NODE_REGISTRY.param('filter', 'type').default);
  assert.equal(filled.enabled, true);
  assert.equal(Object.hasOwn(filled, 'bogus'), false, 'only what the registry defines');
});

test('nodeParamsOf: a missing node is null, another type keeps its own type', () => {
  const m = REF();
  assert.equal(nodeParamsOf(m, 'nope-1', NODE_REGISTRY), null);
  assert.equal(nodeParamsOf(null, 'filter-1', NODE_REGISTRY), null);
  const osc = nodeParamsOf(m, m.graph.nodes.find((n) => n.type === 'oscillator').id,
    NODE_REGISTRY);
  assert.equal(osc.type, 'oscillator');
  assert.ok(Object.hasOwn(osc.params, 'waveform'));
});

test('one filter mapping: the Playground voice builds its Filter with it, the lab reads it back',
  () => {
    const lab = { type: 'bandpass', frequency: 1234, Q: 3.5, gain: -2, enabled: true };
    const { model } = playgroundVoiceModel({ frequency: 440, lab: { filter: lab } });
    const node = model.graph.nodes.find((n) => n.id === PLAYGROUND_VOICE_IDS.filter);
    assert.deepEqual(node.params, filterNodeParams(lab), 'the voice uses filterNodeParams');
    const back = labFilterOf(nodeParamsOf(model, node.id, NODE_REGISTRY).params);
    for (const k of FILTER_LAB_FIELDS) assert.equal(back[k], lab[k], k);
    assert.deepEqual(Object.keys(back), [...FILTER_LAB_FIELDS]);
    assert.equal(filterNodeParams({ type: 'lowpass', frequency: 10, Q: 1 }).gain, 0);
  });

// ------------------------------------------------------------------------------ the link
test('the lab link: built, read back, routed to Filter Lab', () => {
  const hash = encodeLabLink({ nodeId: 'filter-1', revision: 7 });
  assert.equal(hash, 'm=filter&from=studio&node=filter-1&rev=7');
  assert.deepEqual(decodeLabLink(`#${hash}`), { ok: true,
    link: { from: 'studio', nodeId: 'filter-1', revision: 7 } });
  assert.deepEqual(routeOfHash(`#${hash}`), { workspace: 'filter', owner: 'workspace' });
  assert.equal(decodeLabLink('#m=filter'), null, 'no lab key: not a lab link');
  assert.equal(decodeLabLink('#m=filter&from=studio&node=filter-1&rev=x').link.revision, null,
    'a rev that is not a revision is no hint, not a refusal');
  assert.equal(encodeLabLink({ nodeId: 'filter-1' }), 'm=filter&from=studio&node=filter-1');
});

test('the lab link refuses a link it cannot read, whole, with a sentence', () => {
  const refused = (h) => {
    const r = decodeLabLink(h);
    return r && r.ok === false && /^Studio node link refused: .+\.$/.test(r.reason);
  };
  assert.ok(refused('#m=filter&from=studio&node=a&node=b'), 'a repeated key');
  assert.ok(refused('#m=filter&from=synth&node=filter-1'), 'another source');
  assert.ok(refused('#m=filter&node=filter-1'), 'no source');
  assert.ok(refused('#m=filter&from=studio'), 'no node');
  assert.ok(refused('#m=filter&from=studio&node=%2F..%2Fx'), 'not a node id');
  assert.ok(refused('#m=analyzer&from=studio&node=filter-1'), 'another workspace');
  assert.ok(refused('#from=studio&node=filter-1'), 'no workspace');
});

test('no hash key collides: the lab keys are its own and leave with Filter Lab', () => {
  const domains = {
    route: [ROUTE_KEY],
    instrument: [...INSTRUMENT_HASH_KEYS],
    measure: [RECIPE_HASH_KEY],
    studio: [STUDIO_LINK_KEYS.template, STUDIO_LINK_KEYS.subview],
    records: Object.values(RECORD_LINK_KEYS),
    keyboard: [KEYBOARD_LINK_KEY],
    synth: Object.values(SYNTH_LINK_KEYS),
    lab: Object.values(LAB_LINK_KEYS),
  };
  const owner = new Map();
  for (const [d, keys] of Object.entries(domains)) {
    for (const k of keys) {
      assert.ok(!owner.has(k), `"${k}" is read by both ${owner.get(k)} and ${d}`);
      owner.set(k, d);
    }
  }
  assert.deepEqual(Object.values(LAB_LINK_KEYS), ['from', 'node', 'rev']);
  assert.ok(HASH_DOMAINS.indexOf('lab') > HASH_DOMAINS.indexOf('studio'),
    'the lab reads the document a Studio link may have opened');
  const link = encodeLabLink({ nodeId: 'filter-1', revision: 3 });
  const off = new URLSearchParams(hashForWorkspace(link, 'studio'));
  for (const k of Object.values(LAB_LINK_KEYS)) assert.equal(off.get(k), null, `${k} leaves`);
  assert.equal(off.get('m'), 'studio');
  assert.equal(new URLSearchParams(hashForWorkspace(link, 'filter')).get('node'), 'filter-1');
  const refusedHash = hashAfterRefusal(`#${link}`, { lab: false }, 'filter');
  assert.equal(refusedHash, 'm=filter', 'a refused lab link is not kept');
  assert.equal(withoutLabParams(`${link}&v=1`), 'm=filter&v=1');
});

// ------------------------------------------------------------------------------ resolution
test('a link this page made at another revision shows the current values and says so', () => {
  const m = REF();
  const link = { from: 'studio', nodeId: 'filter-1', revision: 4 };
  const r = resolveLabLink(link, { model: m, revision: 9, madeHere: true });
  assert.equal(r.ok, true);
  assert.equal(r.stale, true);
  assert.equal(r.values.frequency, 500, 'the current values');
  assert.match(staleNotice(r.linkRevision, r.revision),
    /changed since this link was made \(Studio revision 4, now 9\); showing its current values/);
  assert.equal(resolveLabLink(link, { model: m, revision: 4, madeHere: true }).stale, false);
  // After a reload or from elsewhere the revision means nothing: never compared.
  assert.equal(resolveLabLink(link, { model: m, revision: 9, madeHere: false }).stale, false);
  assert.equal(resolveLabLink({ ...link, revision: null }, { model: m, revision: 9,
    madeHere: true }).stale, false);
});

test('a missing node, a node that is not a Filter and a type the lab lacks are refused', () => {
  const m = REF();
  const miss = resolveLabLink({ nodeId: 'filter-9', revision: null }, { model: m, revision: 0 });
  assert.equal(miss.ok, false);
  assert.match(miss.reason, /no node "filter-9".*Filter Lab keeps its own values/);
  const osc = m.graph.nodes.find((n) => n.type === 'oscillator');
  const wrong = resolveLabLink({ nodeId: osc.id, revision: null }, { model: m, revision: 0 });
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /is an Oscillator, not a Filter, so Filter Lab keeps its own/);
  assert.equal(canOpenInLab(m, osc.id), false);
  assert.equal(canOpenInLab(m, 'filter-1'), true);
  const shelf = { ...m, graph: { ...m.graph, nodes: m.graph.nodes.map((n) => (n.id === 'filter-1'
    ? { ...n, params: { ...n.params, type: 'lowshelf' } } : n)) } };
  const lacks = resolveLabLink({ nodeId: 'filter-1', revision: null }, { model: shelf,
    revision: 0 });
  assert.equal(lacks.ok, false);
  assert.match(lacks.reason, /Filter Lab has no Low-shelf type/);
});

test('the types the bridge accepts are the Filter Lab radios', () => {
  const radios = [...HTML.matchAll(/data-osc="filter\.type" data-value="([a-z]+)"/g)]
    .map((x) => x[1]);
  assert.deepEqual(radios, [...FILTER_LAB_TYPES]);
});

test('a value the lab limits to its range is said, never silent', () => {
  assert.deepEqual(limitedNotices({ type: 'lowpass', frequency: 500, Q: 40, gain: 0 },
    { type: 'lowpass', frequency: 500, Q: 30, gain: 0 }),
  ['Q 40 is outside Filter Lab\'s range; shown as 30.']);
  assert.deepEqual(limitedNotices({ type: 'lowpass', frequency: 500, Q: 0.7071067811865476,
    gain: 0 }, { type: 'lowpass', frequency: 500, Q: Math.SQRT1_2, gain: 0 }), []);
});

// ------------------------------------------------------------------------------ the part
function harness({ model = REF(), revision = 5 } = {}) {
  const calls = { update: [], notify: [], dispatch: 0 };
  const lab = { config: { type: 'lowpass', frequency: 2500, Q: Math.SQRT1_2, gain: 0,
    enabled: true },
  update(v) { calls.update.push(v); this.config = { ...this.config, ...v,
    Q: Math.min(30, Math.max(0.1, v.Q)) }; } };
  const win = { location: { hash: '' }, addEventListener() {} };
  const part = createLabBridgeUi({ lab: () => lab, win });
  const doc = { model, revision };
  const cmp = Object.create(null);
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(part));
  Object.assign(cmp, {
    workspace: 'studio',
    studioDocument: () => ({ ...doc }),
    notify: (level, title, msg) => calls.notify.push([level, title, msg]),
    $watch() {}, $nextTick() {},
  });
  cmp.labBridgeInit();
  return { cmp, calls, lab, win, doc };
}

test('openInLab writes the link as one address, and nothing to Studio', () => {
  const { cmp, calls, win } = harness();
  const r = openInLab('filter-1');
  assert.deepEqual(r, { ok: true, hash: 'm=filter&from=studio&node=filter-1&rev=5' });
  assert.equal(win.location.hash, r.hash);
  assert.equal(calls.update.length, 0, 'the lab applies when the dispatcher reads the link');
  const no = openInLab('osc-1');
  assert.equal(no.ok, false);
  assert.match(no.reason, /is not a Filter/);
  assert.equal(win.location.hash, r.hash, 'a refusal goes nowhere');
  assert.equal(cmp.labFrom, null);
});

test('the dispatcher applies a link: values through the lab, the context line, no notice', () => {
  const { cmp, calls } = harness();
  openInLab('filter-1');
  assert.equal(cmp.labApplyLinkHash('#m=filter&from=studio&node=filter-1&rev=5', 'link'), true);
  assert.deepEqual(calls.update, [{ type: 'lowpass', frequency: 500, Q: Math.SQRT1_2, gain: 0 }]);
  assert.equal(cmp.labFrom.kind, 'from');
  assert.match(cmp.labFrom.text, /^From Studio node Filter 1\. Its set values: /);
  assert.equal(cmp.labFrom.notice, '');
  assert.equal(cmp.labFrom.back, '#m=studio');
  assert.equal(cmp.labBridgeTestSeam().returnTo, 'filter-1');
  assert.equal(cmp.labApplyLinkHash('#m=filter', 'link'), null, 'not a lab link');
});

test('a link this page made, read at a later revision, is stale; after a reload it is not', () => {
  const h = harness();
  openInLab('filter-1');
  h.doc.revision = 8; // an edit since the link was made
  h.cmp.labApplyLinkHash('#m=filter&from=studio&node=filter-1&rev=5', 'link');
  assert.match(h.cmp.labFrom.notice, /revision 5, now 8\); showing its current values/);
  const fresh = harness({ revision: 0 }); // a reloaded page: revision 0, nothing made here
  fresh.cmp.labApplyLinkHash('#m=filter&from=studio&node=filter-1&rev=5', 'load');
  assert.equal(fresh.cmp.labFrom.kind, 'from');
  assert.equal(fresh.cmp.labFrom.notice, '', 'no revision comparison after a reload');
  const pasted = harness({ revision: 2 }); // a link made elsewhere, pasted into this page
  pasted.cmp.labApplyLinkHash('#m=filter&from=studio&node=filter-1&rev=5', 'link');
  assert.equal(pasted.cmp.labFrom.notice, '');
});

test('a refused link is said, the lab keeps its own values and Back has no node', () => {
  for (const hash of ['#m=filter&from=studio&node=filter-9', '#m=filter&from=studio&node=osc-1',
    '#m=filter&from=elsewhere&node=filter-1']) {
    const { cmp, calls } = harness();
    assert.equal(cmp.labApplyLinkHash(hash, 'load'), false, hash);
    assert.equal(calls.update.length, 0, `${hash}: nothing applied`);
    assert.equal(cmp.labFrom.kind, 'refused');
    assert.equal(calls.notify.length, 1);
    assert.equal(calls.notify[0][0], 'warning');
    assert.equal(cmp.labBridgeTestSeam().returnTo, null);
  }
});

test('a limited value is applied as the lab can and said in the context line', () => {
  const m = REF();
  const loud = { ...m, graph: { ...m.graph, nodes: m.graph.nodes.map((n) => (n.id === 'filter-1'
    ? { ...n, params: { ...n.params, Q: 40 } } : n)) } };
  const { cmp } = harness({ model: loud });
  cmp.labApplyLinkHash('#m=filter&from=studio&node=filter-1', 'load');
  assert.match(cmp.labFrom.notice, /Q 40 is outside Filter Lab's range; shown as 30\./);
});

test('a deep link read before Filter Lab mounts waits for it (labFlush)', () => {
  let lab = null;
  const updates = [];
  const part = createLabBridgeUi({ lab: () => lab, win: { location: { hash: '' },
    addEventListener() {} } });
  const cmp = Object.create(null);
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(part));
  Object.assign(cmp, { studioDocument: () => ({ model: REF(), revision: 0 }), notify() {},
    $watch() {}, $nextTick() {} });
  assert.equal(cmp.labApplyLinkHash('#m=filter&from=studio&node=filter-1', 'load'), true);
  assert.equal(cmp.labFrom, null);
  assert.equal(cmp.labBridgeTestSeam().pending, true);
  lab = { config: { Q: Math.SQRT1_2, frequency: 500, gain: 0 }, update: (v) => updates.push(v) };
  assert.equal(cmp.labFlush(), true);
  assert.equal(updates.length, 1);
  assert.equal(cmp.labFrom.kind, 'from');
  assert.equal(cmp.labFlush(), false, 'once');
});

// ------------------------------------------------------------------------------ the way back
test('revealDelta: no pan while the node is in view, else the least pan that shows it', () => {
  const port = { left: 100, top: 50, right: 700, bottom: 350 };
  const at = (left, top, w = 160, h = 80) => ({ left, top, right: left + w, bottom: top + h });
  assert.deepEqual(revealDelta(at(200, 100), port), { dx: 0, dy: 0 }, 'fully visible: kept');
  assert.deepEqual(revealDelta(at(100, 50), port), { dx: 0, dy: 0 }, 'on the edges: kept');
  assert.deepEqual(revealDelta(at(3200, 100), port), { dx: 700 - 3360, dy: 0 },
    'off to the right: its right edge meets the port\'s');
  assert.deepEqual(revealDelta(at(-500, -300), port), { dx: 600, dy: 350 },
    'off to the top left: its top left meets the port\'s');
  assert.deepEqual(revealDelta(at(650, 320), port), { dx: -110, dy: -50 }, 'partly cut off');
  // Taller than the port: no pan while it spans it, else its near edge meets the port's.
  assert.deepEqual(revealDelta(at(200, 0, 160, 400), port), { dx: 0, dy: 0 });
  assert.deepEqual(revealDelta(at(200, 100, 160, 400), port), { dx: 0, dy: -50 });
  assert.deepEqual(revealDelta(at(200, -200, 160, 400), port), { dx: 0, dy: 150 });
});

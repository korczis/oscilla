// K075: the integration map (tests/browser/integration-map.json) and the scan that holds the
// code to it (tests/browser/lib/integration-map.mjs), and the judge the browser suite applies
// to each walked row (tests/browser/lib/link-walk.cjs judgeRow).
//
// The real table passes, is not stale, and holds lane A's P07 census; mutated copies fail:
// a producer without a row, a producer or a hash-route write without the marker, a row naming
// a missing control, a target at another Studio revision, a reload that loses the target
// state. On the merge base none of these files exists, so the test fails there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkMap, rebuild, loadModel, readJs, serialize, scanMarkup, scanJs, allRows, KINDS, MAP_PATH,
} from '../browser/lib/integration-map.mjs';

const require = createRequire(import.meta.url);
const { judgeRow } = require('../browser/lib/link-walk.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML = readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const TEXT = readFileSync(MAP_PATH, 'utf8');
const MAP = JSON.parse(TEXT);
const JS = readJs(ROOT);
const MODEL = await loadModel(ROOT);

const has = (problems, part) => problems.some((p) => p.includes(part));
const clone = (o) => JSON.parse(JSON.stringify(o));

test('the real table passes the scan', () => {
  assert.deepEqual(checkMap(MAP, { html: HTML, js: JS }), []);
});

test('the derived rows are current (node tests/browser/lib/integration-map.mjs)', () => {
  assert.equal(serialize(rebuild(MAP, MODEL, HTML)), TEXT);
});

test('every row has a kind of K075; the absent kinds name the issue that adds them', () => {
  const rows = allRows(MAP);
  assert.ok(rows.length >= 80, `${rows.length} rows`);
  const kinds = new Set(rows.map((r) => r.kind));
  for (const k of KINDS) {
    const absent = MAP.absent.find((a) => a.kind === k);
    assert.ok(kinds.has(k) !== !!absent, `${k}: a row of it xor an absent entry`);
    if (absent) assert.match(absent.issue, /^K\d{3}/, `${k}: absent names its issue`);
  }
});

test('the map holds lane A\'s P07 census: every related, panel and content link', () => {
  const { shell, counterparts } = MODEL;
  const rows = allRows(MAP);
  const missing = [];
  const want = (from, href) => {
    if (!rows.some((r) => r.from === from && r.href === href)) missing.push(`${from} ${href}`);
  };
  for (const w of shell.WORKSPACE_REGISTRY) {
    for (const r of w.related || []) want(w.id, shell.relatedHref(r));
  }
  for (const l of [...counterparts.PANEL_LINKS, ...counterparts.CONTENT_LINKS]) {
    for (const f of l.from) want(f, `#m=${l.to}`);
  }
  assert.deepEqual(missing, []);
});

test('every workspace is reachable from the sidebar, About and its own rows', () => {
  const rows = allRows(MAP);
  for (const id of MODEL.shell.WORKSPACE_IDS) {
    assert.ok(rows.some((r) => r.to === id && r.control === `nav.${id}`), `nav.${id}`);
    assert.ok(rows.some((r) => r.from === id), `${id} leads somewhere`);
  }
});

test('mutation: a producer without a row fails the scan', () => {
  const html = HTML.replace('</main>', '<a href="#m=measure" data-osc="fixture.orphan" '
    + 'data-osc-link="jump">x</a></main>');
  assert.notEqual(html, HTML);
  assert.ok(has(checkMap(MAP, { html, js: JS }), 'producer fixture.orphan'));
});

test('mutation: a producer without the marker fails the scan', () => {
  const html = HTML.replace('</main>', '<a href="#m=measure" data-osc="fixture.unmarked">x</a>'
    + '<button type="button" data-osc="fixture.btn" @click="setWorkspace(\'learn\')">y</button>'
    + '</main>');
  const problems = checkMap(MAP, { html, js: JS });
  assert.ok(has(problems, 'producer fixture.unmarked (href #m=measure) has no data-osc-link'));
  assert.ok(has(problems, 'producer fixture.btn (@click setWorkspace()) has no data-osc-link'));
  // A marker taken off a real producer.
  const bare = HTML.replace('data-osc="measure.toStudio" data-osc-link="open-in"',
    'data-osc="measure.toStudio"');
  assert.notEqual(bare, HTML);
  assert.ok(has(checkMap(MAP, { html: bare, js: JS }), 'producer measure.toStudio'));
});

test('mutation: a hash-route write without the marker fails the scan', () => {
  for (const text of ['window.location.hash = "m=measure";',
    'history.pushState(null, "", "#m=learn");', 'w.history.replaceState(s, "", url);',
    'const go = () => { loc().hash = h; };']) {
    const js = [...JS, { file: 'src/js/fixture.js', text }];
    assert.ok(has(checkMap(MAP, { html: HTML, js }),
      'src/js/fixture.js:1: hash-route write without a data-osc-link marker'), text);
  }
  // Marked, but naming nothing in the table.
  const js = [...JS, { file: 'src/js/fixture.js',
    text: '// data-osc-link: fixture.nothing\nlocation.hash = "m=learn";' }];
  assert.ok(has(checkMap(MAP, { html: HTML, js }), 'marker fixture.nothing'));
  // A comparison is no write; a marked write passes.
  const ok = [...JS, { file: 'src/js/fixture.js',
    text: 'if (location.hash === h) go();\n// data-osc-link: dispatcher\n'
      + 'history.pushState(1, "", u);' }];
  assert.deepEqual(checkMap(MAP, { html: HTML, js: ok }), []);
});

test('mutation: a JS-built control or route literal without the marker fails the scan', () => {
  const js = [...JS, { file: 'src/js/fixture.js', text: [
    "const a = h('button', { 'data-osc': 'fixture.go', onClick: () => svc.expand() });",
    "const b = { href: '#m=learn', text: 'Back' };"].join('\n') }];
  const problems = checkMap(MAP, { html: HTML, js });
  assert.ok(has(problems, 'src/js/fixture.js:1: JS-built control has no data-osc-link'));
  assert.ok(has(problems, 'src/js/fixture.js:2: route literal has no data-osc-link'));
});

test('mutation: a row naming a missing control fails the scan', () => {
  const map = clone(MAP);
  map.declared.push({ ...map.declared[0], id: 'measure > fixture.missing > learn',
    control: 'fixture.missing', selector: '[data-osc="fixture.missing"]' });
  assert.ok(has(checkMap(map, { html: HTML, js: JS }),
    'row measure > fixture.missing > learn: control fixture.missing is no marked producer'));
  // A row whose kind its control's marker does not name.
  const wrong = clone(MAP);
  const r = wrong.rows.find((x) => x.control === 'measure.toStudio');
  r.kind = 'send-to';
  assert.ok(has(checkMap(wrong, { html: HTML, js: JS }), 'is marked open-in, the row is send-to'));
  // A declared row without its reason.
  const why = clone(MAP);
  delete why.declared[0].why;
  assert.ok(has(checkMap(why, { html: HTML, js: JS }), 'no why'));
});

test('the markup scan sees the marker on templated controls and the JS scan on built ones', () => {
  const nav = scanMarkup(HTML).find((p) => p.control === 'nav.*');
  assert.equal(nav.kind, 'jump');
  const built = scanJs(JS).producers.find((p) => p.control === 'studio.compact.expand');
  assert.equal(built.kind, 'open-in');
  // K222: markup built in JS that carries data-osc-link beside its data-osc, in either order.
  const drums = scanJs(JS).producers.find((p) => p.control === 'synth.drums.studio');
  assert.deepEqual([drums.kind, drums.file], ['open-in', 'src/js/synth/view/drums-tab.js']);
  const fixture = (line) => scanJs([{ file: 'f.js', text: line }]).producers[0];
  assert.deepEqual([fixture('`<a data-osc-link="jump" data-osc="x.y">`').control,
    fixture('`<a data-osc-link="jump" data-osc="x.y">`').kind], ['x.y', 'jump']);
  assert.equal(fixture('`<b data-osc="x.y">`'), undefined, 'no marker, no producer');
});

// ------------------------------------------------------------------------------ the judge
const ROW = Object.freeze({ id: 'synth > synth.studio > studio', kind: 'open-in', from: 'synth',
  control: 'synth.studio', selector: '[data-osc="synth.studio"]', role: 'button', to: 'studio',
  href: null, template: null, studio: 'same', source: 'declared' });
const state = (o) => ({ workspace: 'studio', hash: '#m=studio', ready: true, revision: 1,
  nodes: 26, template: 'subtractive-synth', audit: { ctx: 1, gum: 0 }, voice: false,
  playing: false, focus: 'osc-studio-title', focusOk: true, ...o });
const mode = (o = {}) => ({ control: { marker: 'open-in', roleOk: true, disabled: false,
  name: 'Open in Studio' }, shown: true, ms: 120,
source: state({ workspace: 'synth', hash: '#m=synth' }), target: state(), ...o });
const OBS = Object.freeze({ modes: { pointer: mode(), keyboard: mode(), touch: mode() },
  back: { workspace: 'synth' }, forward: { workspace: 'studio' },
  reload: state({ audit: { ctx: 0, gum: 0 } }) });

test('the judge passes a row walked as the map says', () => {
  assert.deepEqual(judgeRow(ROW, OBS), { failures: [], known: [] });
});

test('mutation: a target at another Studio revision fails', () => {
  const obs = clone(OBS);
  obs.modes.keyboard.target.revision = 2;
  const { failures } = judgeRow(ROW, obs);
  assert.ok(has(failures, 'keyboard: the Studio store is at revision 2, the source showed 1'));
  // Entering the Synth may add its voice (one commit), never more.
  const voice = { ...ROW, id: 'studio > page.relatedLink > synth', to: 'synth', studio: 'voice' };
  const one = clone(OBS);
  one.modes.pointer.target.revision = 2;
  assert.deepEqual(judgeRow(voice, one).failures.filter((f) => f.includes('revision')), []);
  one.modes.pointer.target.revision = 3;
  assert.ok(has(judgeRow(voice, one).failures, 'moved from revision 1 to 3'));
});

test('mutation: a reload that loses the target state fails, unless it is listed debt', () => {
  const obs = clone(OBS);
  obs.reload.nodes = 6;
  assert.ok(has(judgeRow(ROW, obs).failures, 'a reload loses the target state: Studio document'));
  const debt = [{ row: ROW.id, issue: 'V604' }];
  assert.deepEqual(judgeRow(ROW, obs, { reloadDebt: debt }).failures, []);
  assert.equal(judgeRow(ROW, obs, { reloadDebt: debt }).known.length, 1);
  // Healed debt fails until it is removed from the list.
  assert.ok(has(judgeRow(ROW, OBS, { reloadDebt: debt }).failures, 'remove the row'));
  const gone = clone(OBS);
  gone.reload.workspace = 'playground';
  assert.ok(has(judgeRow(ROW, gone).failures, 'workspace playground'));
});

test('mutation: a missing control, a late target, a wrong role or history fail', () => {
  const none = clone(OBS);
  none.modes.touch = { control: null };
  assert.ok(has(judgeRow(ROW, none).failures, 'touch: the control'));
  const late = clone(OBS);
  late.modes.pointer.shown = false;
  assert.ok(has(judgeRow(ROW, late).failures, 'target state was not shown within'));
  const role = clone(OBS);
  role.modes.pointer.control.roleOk = false;
  assert.ok(has(judgeRow(ROW, role).failures, 'not a button in the accessibility tree'));
  const unmarked = clone(OBS);
  unmarked.modes.pointer.control.marker = null;
  assert.ok(has(judgeRow(ROW, unmarked).failures, 'marked null'));
  const back = clone(OBS);
  back.back = { workspace: 'playground' };
  assert.ok(has(judgeRow(ROW, back).failures, 'Back went to playground'));
  const mic = clone(OBS);
  mic.modes.pointer.target.audit.gum = 1;
  assert.ok(has(judgeRow(ROW, mic).failures, 'microphone'));
});

test('reloadDebt and deferred rows name their issue or the suite that walks them', () => {
  const ids = new Set(allRows(MAP).map((r) => r.id));
  for (const d of MAP.reloadDebt) {
    assert.ok(ids.has(d.row), `${d.row} is a row`);
    assert.match(d.issue, /^[A-Z]\d{3}$/);
    assert.ok(d.why && d.why.length > 20, `${d.row}: why`);
  }
  for (const r of allRows(MAP).filter((x) => x.walk)) {
    assert.match(r.walk.covered, /^tests\/browser\/[\w-]+\.cjs/, r.id);
  }
});

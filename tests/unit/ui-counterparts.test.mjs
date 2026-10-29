// U005 (docs/ui-audit.md A05, A07): the Analyzer and Compare workspaces link to the workspace
// that does the same with a calibrated measurement or saved records. The pure half: the
// counterpart table of src/js/ui/counterparts.js routes to real workspaces and a real MEASURE
// result tab, and the shell carries each link, with that address, in the microphone analyzer
// panel that both workspaces show. The layout half (empty area, overflow, the click) is
// tests/browser/ui-current.cjs.
//
// The module is imported inside each test, so that the markup checks still judge (and fail on
// an assertion) where the module does not exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML = readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const EXPECTED = [
  { id: 'measure-rta', href: '#m=measure', workspace: 'measure', measureTab: 'rta' },
  { id: 'experiments', href: '#m=experiments', workspace: 'experiments', measureTab: null },
];

/** The start tag of the section with this id, and its markup up to the closing tag. */
function sectionById(id) {
  const start = HTML.indexOf(`id="${id}"`);
  assert.ok(start > 0, `src/index.html has no element with id ${id}`);
  const open = HTML.lastIndexOf('<section', start);
  const close = HTML.indexOf('</section>', start);
  return { tag: HTML.slice(open, HTML.indexOf('>', start) + 1), body: HTML.slice(open, close) };
}

/** Every <a ...> start tag of a markup fragment, with its attributes. */
function anchors(markup) {
  return [...markup.matchAll(/<a\s([^>]*)>/g)].map((m) => {
    const attrs = {};
    for (const a of m[1].matchAll(/([:@\w.-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    return attrs;
  });
}

test('the microphone analyzer panel carries a link to each counterpart, with its address', () => {
  const mic = sectionById('osc-panel-mic');
  const modes = /data-osc-modes="([^"]*)"/.exec(mic.tag)[1].split(/\s+/);
  for (const ws of ['analyzer', 'compare']) {
    assert.ok(modes.includes(ws), `the microphone analyzer panel is not shown in ${ws}`);
  }
  const links = anchors(mic.body);
  for (const c of EXPECTED) {
    const found = links.filter((a) => a['data-osc'] === `counterpart.${c.id}`);
    assert.equal(found.length, 1, `one link counterpart.${c.id} in the microphone analyzer panel`);
    assert.equal(found[0].href, c.href, `counterpart.${c.id} points at ${c.href}`);
    assert.equal(found[0]['x-bind'], `counterpartLink('${c.id}')`,
      `counterpart.${c.id} is handled by counterpartLink, which selects the tab`);
  }
  assert.equal(HTML.match(/data-osc="counterpart\./g).length, EXPECTED.length,
    'no counterpart link outside the microphone analyzer panel');
});

test('the counterpart line is shown only where a counterpart names the workspace', () => {
  const mic = sectionById('osc-panel-mic').body;
  const line = /<p data-osc="mic\.counterparts"([^>]*)>/.exec(mic);
  assert.ok(line, 'the microphone analyzer panel has the mic.counterparts line');
  assert.match(line[1], /\shidden\s/, 'hidden until the component decides');
  assert.match(line[1], /:hidden="!counterpartsShown\(\)"/);
});

test('each counterpart routes to a workspace and, for MEASURE, to a result tab that exist',
  async () => {
    const { COUNTERPARTS, counterpartHref, counterpartOf, showsCounterparts } =
      await import('../../src/js/ui/counterparts.js');
    const { WORKSPACES } = await import('../../src/js/ui/app.js');
    const { routeOfHash } = await import('../../src/js/ui/navigation.js');
    const { MEASURE_RESULT_TABS } = await import('../../src/js/ui/measure.js');
    assert.deepEqual(COUNTERPARTS.map((c) => c.id), EXPECTED.map((c) => c.id));
    for (const want of EXPECTED) {
      const c = counterpartOf(want.id);
      assert.equal(c.workspace, want.workspace);
      assert.equal(c.measureTab, want.measureTab);
      assert.ok(WORKSPACES.includes(c.workspace), `${c.workspace} is a workspace`);
      if (c.measureTab) {
        assert.ok(MEASURE_RESULT_TABS.some((t) => t.id === c.measureTab),
          `${c.measureTab} is a MEASURE result tab`);
      }
      assert.equal(counterpartHref(c.id), want.href);
      assert.deepEqual(routeOfHash(counterpartHref(c.id)),
        { workspace: c.workspace, owner: 'workspace' }, `${want.href} routes to ${c.workspace}`);
      for (const ws of c.from) assert.ok(WORKSPACES.includes(ws), `${ws} is a workspace`);
      assert.ok(c.label.length > 0);
    }
    assert.equal(counterpartOf('nope'), null);
    assert.equal(counterpartHref('nope'), null);
    for (const ws of ['analyzer', 'compare']) assert.equal(showsCounterparts(ws), true, ws);
    for (const ws of WORKSPACES.filter((w) => !['analyzer', 'compare'].includes(w))) {
      assert.equal(showsCounterparts(ws), false, ws);
    }
  });

test('the link text in the shell is the counterpart label', async () => {
  const { COUNTERPARTS } = await import('../../src/js/ui/counterparts.js');
  for (const c of COUNTERPARTS) {
    const re = new RegExp(`data-osc="counterpart\\.${c.id}"[^>]*>([^<]*)</a>`);
    const m = re.exec(HTML);
    assert.ok(m, `counterpart.${c.id} is a link with text`);
    assert.equal(m[1].trim(), c.label);
  }
});

// G013 (Q035 2, decided with oscilla-c3; visual audit finding 7): the Sequencer's onward paths
// are one Pro row under its head instead of small links squeezed into the head beside Tempo. The
// Drums tab's step sequencer and pads (seq.toDrums, T10) is the one primary button; the Step Bass
// template, this sequence in the Studio (seq.toStudio, reused), the Sweep Sequence template and
// the Synth are the items of one "Otevřít v…" Pro menu (seq.openMenu). Filter Lab's two links
// are one such menu in its head (filter.openMenu). Every Sequencer text is Czech
// (project.czech-prose), each the label its catalogue declaration gives; shown in its lab only,
// so the Playground grid keeps its layout. Fails on 04d33aaf: no row, no menu, the links sit in
// the heads with three English texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import CROSS_LINK_COMPONENTS from '../../src/js/ui/catalog/decl/cross-links.js';

const PAGE = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');

const PRIMARY = ['seq.toDrums', '#m=synth&amp;yt=drums', 'Krokový sekvencer a pady (Bicí)'];
const SEQ_MENU = [
  ['seq.toStepBass', '#m=studio&amp;st=step-bass', 'Krokový modulátor ve Studiu'],
  ['seq.toStudio', '#m=studio', 'Otevřít tuto sekvenci ve Studiu'],
  ['seq.toStudioTemplate', '#m=studio&amp;st=sweep-sequence', 'Šablona Sweep Sequence ve Studiu'],
  ['seq.toSynth', '#m=synth', 'Otevřít Synth'],
];
const FILTER_MENU = [
  ['filter.toStudio', '#m=studio&amp;st=filter-automation', 'Open Filter Automation in Studio'],
  ['filter.toSynth', '#m=synth', 'Open the Synth'],
];

/** The markup of the element whose start tag carries `attr`, up to its closing tag. */
function element(attr, tag) {
  const at = PAGE.indexOf(attr);
  assert.ok(at > 0, `src/index.html has ${attr}`);
  const start = PAGE.lastIndexOf(`<${tag}`, at);
  let depth = 0;
  const re = new RegExp(`<(/?)${tag}\\b`, 'g');
  re.lastIndex = start;
  for (let m = re.exec(PAGE); m; m = re.exec(PAGE)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return PAGE.slice(start, m.index + tag.length + 3);
  }
  throw new Error(`${attr}: unclosed <${tag}>`);
}

/** The links of `html` in order: [data-osc, href, text, start tag]. */
const links = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
  .map(([, attrs, body]) => [(attrs.match(/data-osc="([^"]+)"/) || [])[1],
    (attrs.match(/href="([^"]+)"/) || [])[1], body.replace(/\s+/g, ' ').trim(), attrs]);

/** The menu opened by the button with data-osc `osc`: { button, panel, id } markup. */
function menuOf(osc) {
  const button = element(`data-osc="${osc}"`, 'button');
  const id = button.match(/\bid="([^"]+)"/)[1];
  const panel = element(`aria-labelledby="${id}"`, 'div');
  return { button, panel, id };
}

test('G013: the Sequencer row sits between its head and the timeline, in the Sequencer only',
  () => {
    const row = element('id="osc-seq-paths"', 'div');
    assert.match(row, /^<div[^>]*role="group"[^>]*aria-label="Další cesty"/);
    assert.match(row, /^<div[^>]*hidden :hidden="workspace !== 'sequencer'"/);
    const head = element('class="osc-panel-header osc-seq-head', 'div');
    const at = PAGE.indexOf('id="osc-seq-paths"');
    assert.ok(at > PAGE.indexOf(head) + head.length
      && at < PAGE.indexOf('class="osc-seq-timeline-wrap"'), 'between the head and the timeline');
    assert.deepEqual(links(head).map(([osc]) => osc).filter((o) => o && /\.to/.test(o)), [],
      'no onward link left in the head');
    const [first] = links(row);
    assert.deepEqual(first.slice(0, 3), PRIMARY, 'Bicí first, outside the menu');
    assert.ok(first[3].includes(':class="PRO.btnPrimary"'), 'the one primary button');
    assert.ok(row.includes('data-osc="seq.openMenu"'), 'and the menu beside it');
  });

for (const [osc, items, ws] of [['seq.openMenu', SEQ_MENU, 'sequencer'],
  ['filter.openMenu', FILTER_MENU, 'filter']]) {
  test(`G013: ${osc} is one "Otevřít v…" Pro menu of its lab's onward links, in order`, () => {
    const { button, panel, id } = menuOf(osc);
    assert.match(button, /aria-haspopup="menu"/);
    assert.ok(button.includes(`aria-controls="${id}-menu"`), 'the button controls its menu');
    assert.ok(button.includes(':class="PRO.btnSecondary"'), 'a Pro secondary button');
    assert.match(button, /<span\s+class="sr-only sm:not-sr-only">Otevřít v…<\/span>/,
      'named "Otevřít v…", shown from sm (an icon alone on a phone)');
    assert.match(panel, new RegExp(`^<div id="${id}-menu" role="menu" hidden`));
    const got = links(panel);
    assert.deepEqual(got.map((l) => l.slice(0, 3)), items);
    for (const [o, , , attrs] of got) {
      assert.match(attrs, /role="menuitem"/, `${o} is a menu item`);
      assert.ok(attrs.includes(':class="PRO.menuItem"'), `${o} is a Pro menu item`);
      assert.match(attrs, new RegExp(`\\shidden\\s+:hidden="workspace !== '${ws}'"`),
        `${o} hidden outside ${ws}`);
    }
  });
}

test('G013: the moved links keep their behaviour', () => {
  const seq = links(menuOf('seq.openMenu').panel);
  const at = (o) => seq.find(([x]) => x === o)[3];
  assert.ok(at('seq.toStudio').includes('@click="studioOpenSequence($event)"'),
    'it still opens the pattern');
  assert.ok(at('seq.toSynth').includes('x-bind="counterpartLink(\'synth\')"'),
    'still the counterpart link');
});

test('G013: each catalogue label is the text the row or the menu shows', () => {
  const byId = new Map(CROSS_LINK_COMPONENTS.map((c) => [c.id, c]));
  for (const [osc, , text] of [PRIMARY, ...SEQ_MENU, ...FILTER_MENU]) {
    assert.ok(byId.has(osc), `${osc} is declared`);
    assert.equal(byId.get(osc).label, text, `${osc}'s catalogue label`);
  }
  for (const osc of ['seq.openMenu', 'filter.openMenu']) {
    assert.equal(byId.get(osc).label, 'Otevřít v…', `${osc}'s catalogue label`);
  }
});

// U122 (rule project.czech-prose, Q104): Předvolby speaks Czech: its buttons, their accessible
// names, the empty history row, its two Playground links and the notices of its own actions. The
// built-in presets were pass 8's (data/presets-display.js); this is the page around them. Each
// check reads the Czech form as a positive (a negative alone passes on an empty page), and the
// frozen V1 reset notice stays byte-exact as data and is shown through core/frozen-display.js.
//   node --test tests/unit/presets-czech.test.mjs
// Fails on the merge base: the page says Load, Reset to defaults, Clear history and Recall, and
// the reset notice has no Czech form.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { shownText } from '../../src/js/core/frozen-display.js';

const ROOT = new URL('../../', import.meta.url);
const html = readFileSync(new URL('src/index.html', ROOT), 'utf8');
const view = html.slice(html.indexOf('id="osc-view-presets"'),
  html.indexOf('<!-- SYNTH (K058-K066)'));

test('U122 the Předvolby page names its actions in Czech, and their accessible names follow',
  () => {
    assert.ok(view.length > 1000, 'the Předvolby view is found');
    for (const czech of ['aria-label="Kategorie předvoleb"', '>Obnovit výchozí</button>',
      '>Vymazat historii</button>', '>Načíst</button>', '>Vyvolat</button>',
      ">Nastavte tón v mezích v Playgroundu</a>", '>Zahrajte něco v Playgroundu</a>']) {
      assert.ok(view.includes(czech), czech);
    }
    // label in name (WCAG 2.5.3): each aria-label starts with the button's visible text
    assert.match(view, /:aria-label="'Načíst předvolbu ' \+ p\.name">Načíst<\/button>/);
    assert.match(view, /'Potvrdit smazání ' : 'Smazat '\) \+ p\.name"/);
    assert.match(view, /x-text="pendingDelete === p\.id \? 'Potvrdit smazání' : 'Smazat'"/);
    assert.match(view.replace(/\s+/g, ' '), /V tomto zobrazení stránky zatím nic nezaznělo\./);
    const OLD = new RegExp(['Reset to defaults', 'Clear history', '>Load<', 'Load preset',
      '>Recall<', 'Nothing\\s+played', 'Play something', 'Set a tone', 'Preset categories', "'Confirm'",
      "'Delete'"].join('|'));
    assert.doesNotMatch(view, OLD);
  });

test('U122 the frozen reset notice keeps its V1 text as data and is shown in Czech', () => {
  const golden = readFileSync(new URL('tests/freeze/golden-a7b7a23.json', ROOT), 'utf8');
  assert.ok(golden.includes('"Defaults restored"'), 'the V1 text stays pinned');
  assert.equal(shownText('Defaults restored'), 'Výchozí hodnoty obnoveny');
  assert.equal(shownText('All instrument parameters are back to their defaults. Custom presets '
    + 'are kept.'), 'Všechny parametry nástroje mají opět výchozí hodnoty. Vlastní předvolby '
    + 'zůstávají.');
  assert.equal(shownText('Preset saved'), 'Předvolba uložena');
});

test('U122 the notices of the page\'s own actions are Czech at their source', () => {
  const src = readFileSync(new URL('src/js/core/instrument.js', ROOT), 'utf8');
  for (const czech of ["'Předvolba není dostupná'", "'Předvolba použita jen zčásti'",
    'Načteno: „${p.name}“', "'Vyvoláno'", "'Některé hodnoty nešlo obnovit.'",
    "'Historie se neuložila'"]) {
    assert.ok(src.includes(czech), czech);
  }
  assert.doesNotMatch(src,
    /'Preset unavailable'|'Preset partly applied'|Loaded “|'Recalled'|'History not saved'/);
});

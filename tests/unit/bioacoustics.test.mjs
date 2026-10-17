// Claim bioacoustics-cited: every hearing range and call band shown comes from a cited
// publication, carries its criterion, and is shown with a disclaimer. Machine-checked here:
// every object of the data that holds a number cites a full source; a hearing range states
// its dB SPL criterion (or, where the source gives none, the levels or the absence); a call
// band says what was measured; the disclaimer is in the page and is what the controller
// renders; the sources list renders one cited item per bar. That no value is estimated is a
// reviewer's reading of the sources, not something a test can see.
//   node --test tests/unit/bioacoustics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HEARING_RANGES, CALL_EXAMPLES, DISCLAIMER, rangeToLogFraction,
} from '../../src/js/data/bioacoustics.js';
import { mount, renderSources } from '../../src/js/labs/bioacoustics.js';
import { citation } from '../../src/js/charts/bio-chart.js';

const ALL = [...HEARING_RANGES, ...CALL_EXAMPLES];
const hasLink = (s) => typeof s === 'string' && /^(https?:\/\/|10\.\d{4,}\/)/.test(s);

test('disclaimer text', () => {
  assert.equal(DISCLAIMER, 'Ranges are approximate and vary by source and individual.');
});

test('required species present', () => {
  const ids = HEARING_RANGES.map((r) => r.id);
  for (const id of ['human', 'dog', 'cat', 'bat', 'elephant', 'mouse', 'dolphin']) {
    assert.ok(ids.includes(id), id);
  }
  assert.equal(new Set(ALL.map((r) => r.id)).size, ALL.length, 'ids unique');
});

for (const e of ALL) {
  test(`entry ${e.id}: shape, source, range`, () => {
    for (const k of ['id', 'label', 'species', 'basis', 'notes']) {
      assert.ok(typeof e[k] === 'string' && e[k].length > 0, k);
    }
    assert.ok(e.minHz > 0 && e.maxHz > 0, 'positive');
    assert.ok(Number.isFinite(e.minHz) && Number.isFinite(e.maxHz));
    assert.ok(e.minHz < e.maxHz, 'min < max');
    const s = e.source;
    assert.ok(s.authors && s.title && s.venue, 'source fields');
    assert.ok(Number.isInteger(s.year) || s.year === null);
    assert.ok(hasLink(s.doi_or_url), 'source URL or DOI');
    const f = rangeToLogFraction(e.minHz, e.maxHz);
    assert.ok(f, 'fraction exists');
    assert.ok(f.start >= 0 && f.end <= 1 && f.start < f.end, 'valid axis fraction');
  });
}

test('hearing entries carry a criterion and sourced alternatives', () => {
  for (const r of HEARING_RANGES) {
    assert.ok('criterionDbSpl' in r);
    assert.ok(r.criterionDbSpl === null || r.criterionDbSpl > 0);
    assert.ok(Array.isArray(r.alternatives));
    for (const a of r.alternatives) {
      assert.ok(a.minHz > 0 && a.minHz < a.maxHz);
      assert.ok(hasLink(a.source.doi_or_url));
    }
  }
});

test('rangeToLogFraction geometry', () => {
  const full = rangeToLogFraction(10, 100000);
  assert.deepEqual([full.start, full.end, full.width], [0, 1, 1]);
  const mid = rangeToLogFraction(100, 1000);
  assert.ok(Math.abs(mid.start - 0.25) < 1e-12 && Math.abs(mid.end - 0.5) < 1e-12);
  const clamped = rangeToLogFraction(1, 1e6);
  assert.deepEqual([clamped.start, clamped.end], [0, 1]);
  assert.equal(rangeToLogFraction(0, 100), null);
  assert.equal(rangeToLogFraction(100, 100), null);
  assert.equal(rangeToLogFraction(200, 100), null);
  assert.equal(rangeToLogFraction(NaN, 100), null);
  assert.equal(rangeToLogFraction(1, 5), null, 'entirely below axis');
  assert.equal(rangeToLogFraction(2e5, 3e5), null, 'entirely above axis');
  assert.ok(rangeToLogFraction(20, 20000, 20, 20000).width === 1);
});

// ------------------------------------------------------------------ every number cites

const SOURCE_FIELDS = ['authors', 'title', 'venue'];
const fullSource = (src) => !!src && SOURCE_FIELDS.every((k) => typeof src[k] === 'string'
  && src[k].length > 0) && hasLink(src.doi_or_url) && (Number.isInteger(src.year)
  || src.year === null);

/** Each [path] of an object holding a finite number (other than a source's year) that does
 *  not carry a full `source`. */
function uncitedNumbers(value, at) {
  if (Array.isArray(value)) return value.flatMap((v, i) => uncitedNumbers(v, `${at}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  const own = Object.entries(value).filter(([k, v]) => k !== 'source' && typeof v === 'number');
  const bad = own.length && !fullSource(value.source) ? [at] : [];
  return [...bad, ...Object.entries(value).filter(([k]) => k !== 'source')
    .flatMap(([k, v]) => uncitedNumbers(v, `${at}.${k}`))];
}

test('every entry and alternative that holds a number cites a full source', () => {
  assert.deepEqual(uncitedNumbers(HEARING_RANGES, 'HEARING_RANGES'), []);
  assert.deepEqual(uncitedNumbers(CALL_EXAMPLES, 'CALL_EXAMPLES'), []);
  // The walk is proven on a value without a source, and on a nested one.
  assert.deepEqual(uncitedNumbers([{ id: 'x', minHz: 1, maxHz: 2 }], 'L'), ['L[0]']);
  assert.deepEqual(uncitedNumbers([{ ...HEARING_RANGES[0], alternatives: [{ minHz: 1,
    maxHz: 2, basis: 'b' }] }], 'L'), ['L[0].alternatives[0]']);
  for (const r of HEARING_RANGES) {
    for (const a of r.alternatives) {
      assert.ok(typeof a.basis === 'string' && a.basis.length > 0, `${r.id}: alternative basis`);
    }
  }
});

test('a hearing range states its criterion; a call band says what was measured', () => {
  for (const r of HEARING_RANGES) {
    if (r.criterionDbSpl === null) {
      // The source gives no single level: the basis gives the levels or says none is stated.
      assert.match(r.basis, /\d+ dB (SPL|re)\b|criterion not stated/, `${r.id}: basis`);
    } else {
      assert.ok(Number.isFinite(r.criterionDbSpl) && r.criterionDbSpl > 0, r.id);
      assert.ok(r.basis.startsWith(`${r.criterionDbSpl} dB SPL`),
        `${r.id}: the basis names the ${r.criterionDbSpl} dB SPL criterion`);
    }
  }
  for (const c of CALL_EXAMPLES) {
    assert.ok(['echolocation', 'vocalisation'].includes(c.kind), `${c.id}: kind ${c.kind}`);
    assert.match(c.basis, /sweep|fundamental|frequency|contour|peak/i,
      `${c.id}: the basis says which quantity the band is`);
    assert.ok(!('criterionDbSpl' in c), `${c.id}: a call band is not a hearing threshold`);
  }
});

// ------------------------------------------------------------------ the disclaimer is shown

/** A minimal element: text, children, and the calls the controller makes. */
function el() {
  return {
    textContent: '', children: [], attrs: {},
    append(...xs) { this.children.push(...xs); },
    replaceChildren() { this.children = []; },
    addEventListener() {}, removeEventListener() {},
    get text() {
      return this.children.map((c) => (typeof c === 'string' ? c : c.text || c.textContent))
        .join('');
    },
  };
}

function withDocument(fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prior = globalThis.document;
  globalThis.document = { createElement: () => el() };
  try {
    return fn();
  } finally {
    if (had) globalThis.document = prior;
    else delete globalThis.document;
  }
}

test('the page carries the disclaimer, and the controller renders it into the note', () => {
  const page = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');
  assert.ok(page.includes(`<p class="osc-bio-note">${DISCLAIMER}</p>`),
    'src/index.html shows the disclaimer in the bioacoustics note');
  const note = el();
  note.textContent = 'stale';
  const list = el();
  const root = {
    ...el(),
    querySelector: (sel) => ({ '.osc-bio-note': note, '#osc-bio-source-list': list })[sel]
      || null,
    querySelectorAll: () => [],
  };
  const lab = withDocument(() => mount(root, {}));
  assert.strictEqual(note.textContent, DISCLAIMER);
  assert.strictEqual(list.children.length, HEARING_RANGES.length, 'one source item per range');
  lab.dispose();
});

test('the sources list renders one cited item per bar, for ranges and for calls', () => {
  withDocument(() => {
    for (const [dataset, entries] of [['ranges', HEARING_RANGES], ['calls', CALL_EXAMPLES]]) {
      const list = el();
      renderSources(list, dataset);
      assert.strictEqual(list.children.length, entries.length, dataset);
      entries.forEach((e, i) => {
        const text = list.children[i].text;
        assert.ok(text.startsWith(`${e.label}: `), `${e.id}: label`);
        assert.ok(text.includes(e.basis), `${e.id}: basis`);
        assert.ok(text.includes(citation(e.source)), `${e.id}: citation`);
      });
    }
  });
});

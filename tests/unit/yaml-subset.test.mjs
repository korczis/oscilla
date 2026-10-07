// scripts/yaml-subset.mjs: the strict YAML reader behind the workflow rules and the review
// verdicts. What it returns is what YAML means; what it does not implement it refuses, so a
// file it cannot read is never half-read. (Checked once against the `yaml` package on 4 295
// YAML files of this machine: identical on every file it accepted.)
//   node --test tests/unit/yaml-subset.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../../scripts/yaml-subset.mjs';

test('block mappings, sequences and scalars', () => {
  assert.deepEqual(parseYaml(`# a workflow
name: CI
on:
  pull_request:
  workflow_dispatch:
jobs:
  unit:
    runs-on: ubuntu-latest   # the runner
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - run: npm ci
      - name: "Quoted: name"
        if: matrix.browser == 'firefox'
        run: echo ok
`), {
    name: 'CI',
    on: { pull_request: null, workflow_dispatch: null },
    jobs: { unit: { 'runs-on': 'ubuntu-latest', 'timeout-minutes': 10, steps: [
      { uses: 'actions/checkout@v7', with: { 'fetch-depth': 0 } },
      { run: 'npm ci' },
      { name: 'Quoted: name', if: "matrix.browser == 'firefox'", run: 'echo ok' },
    ] } },
  });
});

test('scalars: numbers, booleans, null, quotes, comments', () => {
  assert.deepEqual(parseYaml(`a: 10
b: -3
c: 1.5
d: true
e: false
f: null
g: ~
h:
i: '1'
j: "two\\nlines"
k: 'it''s'
l: v1.2.3
m: 0x10
m2: 010
m3: 1e3
m4: 0o17
m5: 1.2.3
n: a # comment
o: "a # not a comment"
p: a#b
q: \${{ matrix.browser }}
`), { a: 10, b: -3, c: 1.5, d: true, e: false, f: null, g: null, h: null, i: '1',
    j: 'two\nlines', k: "it's", l: 'v1.2.3', m: 16, m2: 10, m3: 1000, m4: 15, m5: '1.2.3', n: 'a', o: 'a # not a comment', p: 'a#b',
    q: '${{ matrix.browser }}' });
});

test('flow sequences and mappings on one line', () => {
  assert.deepEqual(parseYaml(`needs: [unit, knowledge, "a, b", 'c']
empty: []
nested: [[1, 2], { a: b }]
findings:
  - { id: R1, severity: P1, status: closed, title: "a: b, c" }
  - {id: R2, n: 2}
map: {}
`), {
    needs: ['unit', 'knowledge', 'a, b', 'c'],
    empty: [],
    nested: [[1, 2], { a: 'b' }],
    findings: [{ id: 'R1', severity: 'P1', status: 'closed', title: 'a: b, c' }, { id: 'R2', n: 2 }],
    map: {},
  });
});

test('block scalars: literal and folded, with chomping', () => {
  const doc = parseYaml(`steps:
  - run: |
      curl -fsSL --retry 5 \\
        -o "$a"

      echo done   # not a YAML comment
  - run: >-
      node scripts/verify-deploy.mjs
      --commit "$GITHUB_SHA"
  - run: |-
      one
  - run: >
      folded
      text

      second
`);
  assert.equal(doc.steps[0].run, 'curl -fsSL --retry 5 \\\n  -o "$a"\n\necho done   # not a YAML comment\n');
  assert.equal(doc.steps[1].run, 'node scripts/verify-deploy.mjs --commit "$GITHUB_SHA"');
  assert.equal(doc.steps[2].run, 'one');
  assert.equal(doc.steps[3].run, 'folded text\nsecond\n');
});

test('a sequence at its key\'s indentation, nested sequences of mappings, a leading ---', () => {
  assert.deepEqual(parseYaml(`---
list:
- a
- b
after: 1
matrix:
  include:
    - browser: chromium
      os: linux
    - browser: webkit
`), { list: ['a', 'b'], after: 1,
    matrix: { include: [{ browser: 'chromium', os: 'linux' }, { browser: 'webkit' }] } });
  assert.equal(parseYaml(''), null);
  assert.equal(parseYaml('# only a comment\n'), null);
  assert.deepEqual(parseYaml('- 1\n- two\n'), [1, 'two']);
});

test('what it does not implement throws, with the line', () => {
  const refused = [
    ['a: &anchor 1\n', /line 1: unsupported YAML/],
    ['a: 1\nb: *anchor\n', /line 2: unsupported YAML/],
    ['a: !!str 1\n', /unsupported YAML/],
    ['base: 1\nx:\n  <<: 1\n', /line 3: unsupported key <</],
    ['a: one\n  two\n', /line 2: a value continued on the next line/],
    ['a: [1,\n  2]\n', /line 1: a flow sequence must close on its line/],
    ['a: |2\n    x\n', /unsupported block scalar header/],
    ['a:\n\tb: 1\n', /line 2: a tab in indentation/],
    ['a: 1\na: 2\n', /line 2: duplicate key a/],
    ['a: 1\n---\nb: 2\n', /several documents/],
    ['a: b: c\n', /a plain value cannot contain ": "/],
    ['a: 1\n  b: 2\n', /line 2: a value continued on the next line/],
    ['a:\n  b: 1\n c: 2\n', /line 3: unexpected indentation/],
    ['just text\nmore\n', /expected `key: value`/],
    ['a: "unterminated\n', /unterminated double-quoted scalar/],
    ['- - nested\n', /a sequence written inside a sequence item/],
    ['a: [1, 2] trailing\n', /unexpected text after a value/],
  ];
  for (const [text, expected] of refused) {
    assert.throws(() => parseYaml(text), expected, JSON.stringify(text));
  }
});

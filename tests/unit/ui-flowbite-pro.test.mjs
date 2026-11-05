// Rule project.ui-uses-flowbite-pro (ADR 0061): the UI of OSCILLA is built on Flowbite Pro on
// Tailwind. The interface that predates the rule is recorded as debt that only shrinks.
// The measure itself is scripts/ui-flowbite-pro-measure.mjs; this header defines what it reads.
//
// tests/unit/ui-flowbite-pro-baseline.json records the legacy interface (measure MEASURE), and
// the tree must equal it exactly, so a migration lowers the record in the same change. The
// record is written from the tree by scripts/ui-flowbite-pro-record.mjs (--check compares):
//   (a) the record:
//     inputs    what the build bundles (treeInputs): every tracked file under src (src/index.html
//               read as markup, every .css file as a stylesheet, every other file as JavaScript
//               text, whatever its extension), plus every file a relative import of one of them
//               reaches, transitively, wherever it lives in the repository (JavaScript import,
//               export ... from, import(), require(), new URL(); CSS @import, quoted or url(),
//               with or without ./), a tracked file under a node_modules directory included: a
//               reached .css file is a stylesheet, any other a JavaScript text. Packages (bare
//               specifiers, untracked files under node_modules) are clause (c)'s.
//     surfaces  the UI surfaces of src/index.html (HTML comments removed):
//                 navbar   the element with role="banner"
//                 sidebar  the element with aria-label="Sidebar" (the legacy tab bar's
//                          "Workspace" too)
//                 main     the <main> element
//                 footer   the element with aria-label="Status and actions"
//                 page     every element whose id starts with "osc-view-" (a workspace)
//                 card     every other <section> element with an id
//                 modal    every <dialog> element with an id
//               A surface is migrated when its root's static class attribute holds every class
//               of one class set PRO_STRUCTURE gives its kind (the Pro admin shell's navbar,
//               sidebar drawer, #main-content, footer card, page gutter, card and modal
//               content) AND the build compiles Tailwind with the flowbite plugin
//               (buildCompilesFlowbite: the tailwindcss and flowbite packages, the plugin in
//               the Tailwind entry or config, a build script that imports Tailwind) AND every
//               class of that set is a Pro class: the committed dist/index.html defines a rule
//               for it and no legacy stylesheet has a selector naming it. Every other surface
//               is pending. Until F001 lands that build, no surface is migrated.
//     classes   every osc-* class token, each name counted apart (BEM variants, shell, view
//               and domain-view classes included; a literal 'osc-' or `osc-x--${...}` prefix
//               of a name built at run time counts as its own name): in src/index.html, the
//               osc-* tokens of every attribute but the id references (id, for, form, list,
//               headers, aria-*, x-ref, an href or xlink:href that starts with #, and the bound
//               :id, :for, :href, :name, :form, :list, :headers, :aria-*), data-* attributes
//               and Alpine expressions included; in every JavaScript text of the inputs, every
//               osc-* token of the text, comments included. A token outside a class attribute
//               is not counted when it is an element id (a static id of src/index.html, a
//               literal of :id, a literal assigned to id:, .id = or setAttribute('id', ...) in
//               JavaScript) or a Studio node id (osc- and digits only, as 'osc-1') and never
//               appears in a class position (a class attribute, :class, class: or className:
//               keys, .className =, classList.*(...), setAttribute('class', ...), class="..."
//               inside a string, or a .osc-* selector in JavaScript or the stylesheets).
//     vocabulary  every other class token in a class position (class attributes, the literals
//               of :class not compared with ===/!==, the literals of the JS class positions
//               above), counted per token and per use, unless it is a Pro class (see surfaces):
//               the legacy vocabulary. A token outside it fails, and a token in it may not be
//               used more often than recorded, so a legacy class renamed to another legacy
//               token, or a legacy token reused by new markup, raises a count. A token a legacy
//               stylesheet names stays legacy whatever dist defines, so removing its last
//               legacy rule never turns it into a new class.
//     stylesheets  per stylesheet of the inputs (TAILWIND_ENTRY and the domain views excepted):
//               its selectors (each comma-separated selector of a rule prelude that is not an
//               at-rule) and its declarations (property: value inside a block), comments
//               removed.
//     domainViews  the same counts for DOMAIN_VIEW_STYLESHEETS: the domain views' own
//               stylesheets (charts.css, studio.css, studio-timeline.css) and tokens.css, the
//               custom properties they read (ADR 0061 decision 3). They are ratcheted like the
//               stylesheets (no count rises, none is added) but are not debt.
//     inlineStyles  the style, :style and x-bind:style attributes of src/index.html.
//     debt      pending surfaces + every counted osc-* class token + every use of a legacy
//               vocabulary token + every selector of the stylesheets (not of the domain views).
//   Beside the record: TAILWIND_ENTRY defines no ad-hoc CSS (no selector rule, @layer
//   components and the like included, and no @utility: only @import, @plugin, @source, @theme
//   and similar at-rules), no tailwind.config.* and no local plugin file it or the entry loads
//   mentions addComponents, addUtilities, matchComponents, matchUtilities or addBase (a call,
//   an alias of the destructured name or a property access alike), and src/index.html holds
//   no <style> element.
//   The record only shrinks: the working tree's record is judged against every committed
//   version of it on the base branch's first-parent chain (the base is GITHUB_BASE_REF in CI,
//   main otherwise; the chain runs backwards from the fork, the newest commit of the first-
//   parent chain of origin/<base> that HEAD contains, which is git merge-base HEAD
//   origin/<base> when the branch forked from or merged that chain; git log --first-parent,
//   git show), never against a commit of the branch itself, so a branch that
//   merges its base and re-measures is judged as its pull request is. No number may be above
//   an earlier one of the same measure (debt, an osc-* class name or a vocabulary token,
//   absent counts as 0, a stylesheet's or domain view's selectors or declarations, the inline
//   styles), no vocabulary token, stylesheet or pending surface may be one an earlier version
//   did not list (of any measure that lists them; osc-* names are compared within the same
//   measure only), a surface pending in an earlier version must still be pending or migrated
//   (it never vanishes), a migrated one stays migrated, and the measure never goes back. The
//   numbers of an earlier measure are not compared. When the base's tree at the fork holds no
//   record, the change introduces it and nothing is judged. Outside CI a missing history
//   skips this check; in CI (with fetch-depth: 0) a git failure, a shallow clone, a missing
//   base or an empty history of a base that holds the record fails it.
//   (b) every surface the record lists as migrated exists and is migrated as defined above.
//   (c) no other UI kit: no dependency, JavaScript import or CSS @import of a package of
//       OTHER_UI_KITS; no CSS @import that is neither relative (./ or ../) nor a package (its
//       exact name) of ALLOWED_CSS_PACKAGES, a data: URI, a URL or an absolute path included;
//       no stylesheet beyond the recorded ones and TAILWIND_ENTRY; and no module of an ad-hoc
//       component library (an input path with a components, widgets, ui-kit or design-system
//       segment) beyond the recorded stylesheets.
//   (d) no Flowbite Pro source file is tracked: no path with a segment named like a Pro
//       package (PRO_PACKAGE_NAME) or a vendor/flowbite directory, no file whose fingerprint
//       is in tests/unit/flowbite-pro-fingerprints.json (scripts/flowbite-pro-fingerprints.mjs),
//       and no file carrying a marker of the Pro packages (PRO_MARKERS: their licence URL and
//       repository names). OSCILLA is a public repository and a public Pages site.
//   (e) one owner per element (issue F001, item (8); src/js/ui/flowbite.js): an element of
//       src/index.html (HTML comments removed) is driven either by Alpine state or by
//       flowbite's data attribute API, never both. A flowbite attribute is
//       data-<component>-(toggle|target|show|hide) for drawer, dropdown, collapse, tooltip,
//       tabs, modal, popover, accordion, dial and dismiss. An element that carries one may not
//       carry x-show, x-model, x-transition*, a binding (:name, x-bind:name) or a listener
//       (@event, x-on:event). The element a flowbite attribute names (its value, a leading #
//       dropped, as an id) is driven by flowbite too, so it may not carry x-show,
//       x-transition*, or a bound class or style (:class, x-bind:class, :style,
//       x-bind:style).
// What no check here decides (the rule's "What no check decides" lists it for the reviewer):
// a non-osc class reached in JavaScript through a variable, a helper argument or a ternary
// branch that is not a literal of a class position; an osc-* name assembled from parts none of
// which holds "osc-" (['osc', 'btn'].join('-')); styling set from JavaScript (el.style, style:
// keys, injected <style> or insertRule); an osc-* class name that is also an element id and is
// never in a class position; new markup without classes that legacy descendant selectors
// style; a legacy rule rewritten in place at the same counts; whether a surface on the Pro
// class set follows its Pro template in substance; a markup surface that is neither a
// landmark, a section nor a dialog with an id (its classes are still counted); a module the
// build reaches other than by a relative import (an alias, a plugin, a package); a Pro file
// copied with edits (it escapes the fingerprint, and only about 120 of the roughly 1,800 Pro
// files carry a marker) or inlined as a data: URI inside another file, dist/index.html
// included; which stylesheets are domain views (DOMAIN_VIEW_STYLESHEETS is a change of the
// measure); and a change of MEASURE itself, which resets the numeric comparison with earlier
// versions and is a change of the measure.
// Every clause has a fixture mutation beside the check on the real tree that makes it fail.
//   node --test tests/unit/ui-flowbite-pro.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ADR_REL, ALLOWED_CSS_PACKAGES, BASELINE_REL, DOMAIN_VIEW_STYLESHEETS, FINGERPRINTS_REL,
  MEASURE, NO_BUILD, PRO_MARKERS, PRO_PACKAGE_NAME, PRO_STRUCTURE, ROOT, RULE_REL,
  TAILWIND_ENTRY, baselineHistory, buildCompilesFlowbite, bundledInputs, definedClasses,
  fingerprint, historyGate, historyProblems, kitProblems, measure, openingTags,
  proSourceProblems, read, readBaseline, recordProblems, resolveRelative, sum, tailwindFiles,
  tracked, treeInputs, treeMeasure,
} from '../../scripts/ui-flowbite-pro-measure.mjs';

test('the rule and the ADR exist, name this test and state what no check decides', () => {
  const rule = read(RULE_REL);
  assert.match(rule, /^id: project\.ui-uses-flowbite-pro$/m);
  assert.match(rule, /^class: blocking$/m);
  assert.match(rule, /tests\/unit\/ui-flowbite-pro\.test\.mjs/);
  assert.match(rule, /What no check decides/);
  for (const limit of [/`data:` URI/, /edited/, /el\.style/, /F001/]) assert.match(rule, limit);
  const adr = read(ADR_REL);
  assert.match(adr, /^status: accepted$/m);
  assert.match(adr, /rule:project\.ui-uses-flowbite-pro/);
  assert.match(adr, /What no check decides/);
});

test('(a) the tree holds exactly the record, and (b) every migrated surface is on Pro', (t) => {
  const inputs = treeInputs();
  const measured = treeMeasure(inputs);
  assert.ok(measured.surfaces.length > 50, `surfaces found (${measured.surfaces.length})`);
  for (const kind of Object.keys(PRO_STRUCTURE)) {
    assert.ok(measured.surfaces.some((s) => s.kind === kind), `a ${kind} surface is found`);
  }
  assert.ok(inputs.js.filter((f) => f.startsWith('src/js/')).length > 50,
    'the modules of src/js are read');
  assert.ok(inputs.css.length > 5, 'the stylesheets are read');
  const tokens = sum(measured.classes);
  const words = sum(measured.vocabulary);
  t.diagnostic(`debt ${measured.debt}: ${measured.pending.length} of `
    + `${measured.surfaces.length} surfaces not on Flowbite Pro, ${tokens} osc-* class tokens `
    + `(${Object.keys(measured.classes).length} names), ${words} uses of `
    + `${Object.keys(measured.vocabulary).length} legacy vocabulary tokens, `
    + `${measured.debt - measured.pending.length - tokens - words} legacy selectors; `
    + `domain views (not debt): ${Object.entries(measured.domainViews)
      .map(([f, x]) => `${path.basename(f)} ${x.selectors}`).join(', ')} selectors; `
    + `${inputs.js.length} JavaScript and ${inputs.css.length} stylesheet inputs; build `
    + `compiles Tailwind with flowbite: ${measured.build.compiles}`);
  const problems = recordProblems(measured, readBaseline());
  assert.deepEqual(problems, [], `the Flowbite Pro record (${BASELINE_REL}):\n  `
    + problems.join('\n  '));
});

test('the record has its fields, and its note states the ratchet', () => {
  const baseline = readBaseline();
  assert.deepEqual(Object.keys(baseline).sort(), ['classes', 'debt', 'domainViews',
    'inlineStyles', 'measure', 'measured', 'note', 'rule', 'stylesheets', 'surfaces',
    'vocabulary']);
  assert.deepEqual(Object.keys(baseline.domainViews).sort(), [...DOMAIN_VIEW_STYLESHEETS].sort());
  assert.equal(baseline.rule, 'project.ui-uses-flowbite-pro');
  assert.equal(baseline.measure, MEASURE);
  assert.match(baseline.note, /only shrinks/);
  assert.match(baseline.measured.commit, /^[0-9a-f]{40}$/);
  assert.ok(Number.isInteger(baseline.measured.debt) && baseline.measured.debt > 0);
});

test('(a) the record only shrinks: it rises above no version of itself on the base', (t) => {
  const history = baselineHistory();
  const gate = historyGate(history, process.env.GITHUB_ACTIONS === 'true');
  if (gate.verdict === 'fail') assert.fail(gate.reason);
  if (gate.verdict === 'skip') { t.skip(gate.reason); return; }
  if (gate.verdict === 'introduce') { t.diagnostic(gate.reason); return; }
  const problems = historyProblems(readBaseline(), history.versions);
  t.diagnostic(`${history.versions.length} committed version(s) of the record on ${history.base}`
    + ` from the fork ${history.fork} judged`);
  assert.deepEqual(problems, [], `the record rose; it may only shrink:\n  `
    + problems.join('\n  '));
});

test('(c) no other UI kit, no foreign stylesheet import, no ad-hoc component library', () => {
  const inputs = treeInputs();
  const js = Object.fromEntries(inputs.js.map((f) => [f, read(f)]));
  const css = Object.fromEntries(inputs.css.map((f) => [f, read(f)]));
  const problems = kitProblems({ pkg: JSON.parse(read('package.json')), js, css,
    paths: [...new Set([...tracked('src'), ...inputs.js, ...inputs.css])].sort(),
    legacyStylesheets: [...Object.keys(readBaseline().stylesheets),
      ...Object.keys(readBaseline().domainViews)] });
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('(d) no licensed Flowbite Pro source file is tracked', () => {
  const record = JSON.parse(read(FINGERPRINTS_REL));
  assert.ok(record.fingerprints.length > 100, 'the fingerprints are read');
  assert.ok(record.fingerprints.every((p) => /^[0-9a-f]{16}$/.test(p)));
  const files = tracked().map((rel) => ({ path: rel, bytes: readFileSync(path.join(ROOT, rel)) }));
  assert.ok(files.length > 500, `tracked files read (${files.length})`);
  const problems = proSourceProblems(files, new Set(record.fingerprints));
  assert.deepEqual(problems, [], problems.join('\n'));
});

// Clause (e): one owner per element.
const FLOWBITE_ATTR = new RegExp(String.raw`^data-(drawer|dropdown|collapse|tooltip|tabs|modal|`
  + String.raw`popover|accordion|dial|dismiss)-(toggle|target|show|hide)$`);
const ALPINE_DRIVES = /^(x-show|x-model(\..*)?|x-transition.*|:.+|x-bind:.+|@.+|x-on:.+)$/;
const ALPINE_STYLES = /^(x-show|x-transition.*|:class|x-bind:class|:style|x-bind:style)$/;

/** Every element of `html` that both Alpine and flowbite drive, as one line each. */
function ownerProblems(html) {
  const tags = openingTags(html.replace(/<!--[\s\S]*?-->/g, ''));
  const label = ({ tag, attrs }) => (attrs.id ? `<${tag} id="${attrs.id}">` : `<${tag}>`);
  const byId = new Map(tags.filter((t) => t.attrs.id).map((t) => [t.attrs.id, t]));
  const problems = [];
  for (const el of tags) {
    const fb = Object.keys(el.attrs).filter((a) => FLOWBITE_ATTR.test(a));
    if (!fb.length) continue;
    const alpine = Object.keys(el.attrs).filter((a) => ALPINE_DRIVES.test(a));
    if (alpine.length) {
      problems.push(`${label(el)}: ${fb.join(', ')} and Alpine ${alpine.join(', ')}`);
    }
    for (const a of fb) {
      const target = byId.get(el.attrs[a].replace(/^#/, ''));
      const styled = target ? Object.keys(target.attrs).filter((x) => ALPINE_STYLES.test(x)) : [];
      if (styled.length) {
        problems.push(`${label(target)}: named by ${a} of ${label(el)} and Alpine `
          + `${styled.join(', ')}`);
      }
    }
  }
  return problems;
}

test('(e) no element of src/index.html is driven by both Alpine and flowbite', () => {
  const problems = ownerProblems(read('src/index.html'));
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('mutation (e): an element with both Alpine state and a flowbite attribute fails', () => {
  const ok = `<button data-drawer-target="osc-drawer" data-drawer-toggle="osc-drawer"
      aria-controls="osc-drawer">Menu</button>
    <aside id="osc-drawer" aria-label="Sidebar"></aside>
    <button @click="open = !open" :aria-expanded="open">Alpine</button>
    <div x-show="open" id="osc-alpine"></div>
    <!-- <button data-dropdown-toggle="osc-alpine" @click="x">commented</button> -->`;
  assert.deepEqual(ownerProblems(ok), [], 'one owner each: Alpine or flowbite');
  assert.deepEqual(ownerProblems(`
    <button data-dropdown-toggle="osc-menu" @click="open = !open">a</button>
    <div id="osc-menu"></div>
    <button data-collapse-toggle="osc-group" x-bind:aria-expanded="open">b</button>
    <ul id="osc-group" x-show="open"></ul>
    <button data-tabs-target="#osc-tab-a" :class="{ on: tab === 'a' }">c</button>
    <div id="osc-tab-a"></div>
    <span data-tooltip-target="osc-tip">d</span>
    <div id="osc-tip" :class="tip ? 'visible' : 'invisible'"></div>
    <aside x-show="drawer" data-drawer-hide="osc-drawer">e</aside>`), [
    '<button>: data-dropdown-toggle and Alpine @click',
    '<button>: data-collapse-toggle and Alpine x-bind:aria-expanded',
    '<ul id="osc-group">: named by data-collapse-toggle of <button> and Alpine x-show',
    '<button>: data-tabs-target and Alpine :class',
    '<div id="osc-tip">: named by data-tooltip-target of <span> and Alpine :class',
    '<aside>: data-drawer-hide and Alpine x-show',
  ]);
});

// ---------------------------------------------------------------- mutations (fixtures)

const PRO_CARD = 'bg-white rounded-lg shadow dark:bg-gray-800';
const SHELL = (body, { navbar = 'osc-header' } = {}) => `<body>
  <header class="${navbar}" role="banner">
    <nav class="osc-nav" aria-label="Workspace"></nav></header>
  <main class="osc-main" id="osc-main">${body}</main>
  <footer class="osc-statusbar" aria-label="Status and actions"></footer></body>`;
const FIX_HTML = SHELL(`
  <section class="osc-panel" id="osc-panel-a" x-show="a > b"><div class="osc-panel-header">
    <h2 class="osc-panel-title is-active" id="osc-panel-a-title">A</h2>
    <button class="osc-btn osc-btn-primary" :class="{ 'is-on': mode === 'linear' }"
      @click="openDialog('osc-dlg-a')" aria-controls="osc-dlg-a">Go</button></div>
  </section>
  <section class="osc-panel" id="osc-panel-b" style="width: 1px"></section>
  <!-- <section class="osc-panel" id="osc-commented"></section> -->
  <section class="osc-view" id="osc-view-x"></section>
  <dialog class="osc-dialog" id="osc-dlg-a"></dialog>`);
const FIX_JS = [
  "el.className = 'osc-btn osc-btn-secondary'; // osc-btn-secondaryx is a token of its own",
  "h('p', { class: `osc-note is-${state}`, id: 'osc-only-id' }); byId('osc-only-id');",
];
const FIX_CSS = {
  'src/styles/a.css': '/* .osc-gone { color: red } */\n.osc-panel { color: red; padding: 0 }\n'
    + '.osc-btn, .osc-btn-primary:is(.a, .b) { margin: 0;\n'
    + '  background: url("data:image/svg+xml;utf8,<svg>{;}</svg>") }\n'
    + '@media (max-width: 600px) { .osc-panel { padding: 1px; } }\n',
};
const FIX = { html: FIX_HTML, js: FIX_JS, css: FIX_CSS, build: NO_BUILD };
const record = (m) => ({ rule: 'x', note: 'x', measured: {}, measure: MEASURE, debt: m.debt,
  surfaces: { pending: m.pending, migrated: m.migrated }, classes: m.classes,
  vocabulary: m.vocabulary, stylesheets: m.stylesheets, domainViews: m.domainViews,
  inlineStyles: m.inlineStyles });
const fixRecord = () => record(measure(FIX));
const has = (problems, re) => assert.ok(problems.some((p) => re.test(p)),
  `expected ${re} in:\n  ${problems.join('\n  ')}`);

test('fixture: surfaces, class tokens, vocabulary, CSS and the debt as the header defines them',
  () => {
    const m = measure(FIX);
    assert.deepEqual(m.surfaces.map((s) => `${s.kind} ${s.key}`), [
      'navbar shell:navbar', 'sidebar shell:sidebar', 'main shell:main', 'card card#osc-panel-a',
      'card card#osc-panel-b', 'page page#osc-view-x', 'modal modal#osc-dlg-a',
      'footer shell:footer']);
    assert.deepEqual(m.migrated, []);
    assert.equal(m.pending.length, 8);
    assert.equal(m.classes['osc-'], undefined, 'only the names that occur are recorded');
    assert.equal(m.classes['osc-panel'], 2, 'a commented-out surface is not counted');
    assert.equal(m.classes['osc-btn'], 2);
    assert.equal(m.classes['osc-btn-secondary'], 1);
    assert.equal(m.classes['osc-btn-secondaryx'], 1, 'every osc-* token in JS counts');
    assert.equal(m.classes['osc-note'], 1);
    assert.equal(m.classes['osc-header'], 1, 'a BEM or shell class counts, not only primitives');
    assert.equal(m.classes['osc-only-id'], undefined, 'an id that is never a class is not one');
    assert.equal(m.classes['osc-dlg-a'], undefined, 'an id referenced from an expression');
    assert.equal(m.classes['osc-panel-a-title'], undefined);
    assert.deepEqual(m.vocabulary, { 'is-': 1, 'is-active': 1, 'is-on': 1 },
      "'linear' is compared, not a class");
    assert.deepEqual(m.stylesheets, { 'src/styles/a.css': { selectors: 4, declarations: 5 } });
    assert.equal(m.inlineStyles, 1);
    const tokens = sum(m.classes);
    assert.equal(m.debt, 8 + tokens + 3 + 4,
      'pending + osc-* tokens + vocabulary uses + selectors');
    assert.deepEqual(recordProblems(m, fixRecord()), []);
  });

test('mutation M2: a div-based surface or a new class family fails', () => {
  const b = fixRecord();
  const fancy = FIX_HTML.replace('</main>', '<div id="osc-fancy" class="my-fancy-card">'
    + '<button class="my-btn">x</button></div></main>');
  const p1 = recordProblems(measure({ ...FIX, html: fancy }), b);
  has(p1, /^my-fancy-card: a class outside the legacy vocabulary/);
  has(p1, /^my-btn: a class outside the legacy vocabulary/);
  const reused = FIX_HTML.replace('</main>', '<div class="osc-panel"></div></main>');
  has(recordProblems(measure({ ...FIX, html: reused }), b),
    /^osc-panel: 3 occurrences, above the recorded 2/);
  const styled = FIX_HTML.replace('</main>', '<div style="background: white"></div></main>');
  has(recordProblems(measure({ ...FIX, html: styled }), b),
    /^inline styles: 2 in src\/index\.html, above the recorded 1/);
  const jsFamily = [...FIX_JS, "h('div', { className: 'card-x ' + (on ? 'card-on' : '') })"];
  const p2 = recordProblems(measure({ ...FIX, js: jsFamily }), b);
  has(p2, /^card-x: a class outside the legacy vocabulary/);
  has(p2, /^card-on: a class outside the legacy vocabulary/);
  const styleEl = FIX_HTML.replace('</main>', '<style>.x { color: red }</style></main>');
  has(recordProblems(measure({ ...FIX, html: styleEl }), b),
    /^src\/index\.html: a <style> element/);
});

test('mutation M3: CSS appended to a legacy stylesheet, or rules in the Tailwind entry, fails',
  () => {
    const b = fixRecord();
    const appended = { 'src/styles/a.css':
      `${FIX_CSS['src/styles/a.css']}.my-card { padding: 4px }` };
    const p1 = recordProblems(measure({ ...FIX, css: appended }), b);
    has(p1, /^src\/styles\/a\.css: 5 selectors, above the recorded 4/);
    has(p1, /^src\/styles\/a\.css: 6 declarations, above the recorded 5/);
    const grown = { 'src/styles/a.css': FIX_CSS['src/styles/a.css']
      .replace('color: red; padding: 0', 'color: red; padding: 0; box-shadow: none') };
    has(recordProblems(measure({ ...FIX, css: grown }), b),
      /^src\/styles\/a\.css: 6 declarations, above the recorded 5/);
    const entry = { ...FIX_CSS, [TAILWIND_ENTRY]: '@import "tailwindcss";\n'
      + '@plugin "flowbite/plugin";\n@theme { --color-primary-500: #000; }\n' };
    assert.deepEqual(recordProblems(measure({ ...FIX, css: entry }), b), []);
    const adHoc = { ...FIX_CSS, [TAILWIND_ENTRY]: '@import "tailwindcss";\n'
      + '@layer components { .my-card { padding: 4px } }\n' };
    has(recordProblems(measure({ ...FIX, css: adHoc }), b),
      new RegExp(`^${TAILWIND_ENTRY}: 1 selector rule\\(s\\)`));
    const newSheet = { ...FIX_CSS, 'src/styles/cards.css': '.c { margin: 0 }' };
    has(recordProblems(measure({ ...FIX, css: newSheet }), b),
      /^src\/styles\/cards\.css: a new stylesheet/);
    const older = { ...b, stylesheets: { 'src/styles/a.css': { selectors: 3, declarations: 5 } } };
    assert.deepEqual(historyProblems(b, [{ sha: 'a1', baseline: older }]),
      ['src/styles/a.css: 4 selectors, above 3 at a1']);
  });

/** A repository of `files` ({ path: text }) of which `tracked` paths are tracked. */
const fakeRepo = (files, tracked = Object.keys(files)) => ({ paths: tracked,
  read: (p) => files[p], exists: (p) => Object.hasOwn(files, p) });

test('mutation M4/M5: a class used from .mjs or built by concatenation is counted', () => {
  const tree = fakeRepo(Object.fromEntries(['src/index.html', 'src/js/a.js', 'src/js/b.mjs',
    'src/js/c.cjs', 'src/js/d.ts', 'src/js/f.json', 'src/extra/e.jsx', 'src/styles/x.css',
    'scripts/s.mjs'].map((p) => [p, ''])));
  assert.deepEqual(bundledInputs(tree), { html: 'src/index.html', js: ['src/extra/e.jsx',
    'src/js/a.js', 'src/js/b.mjs', 'src/js/c.cjs', 'src/js/d.ts', 'src/js/f.json'],
  css: ['src/styles/x.css'] }, 'every tracked file under src, whatever its extension');
  const b = fixRecord();
  const concat = [...FIX_JS, "el.className = 'osc-' + 'btn';"];
  has(recordProblems(measure({ ...FIX, js: concat }), b),
    /^osc-: 1 occurrences, above the recorded 0/);
  const template = [...FIX_JS, 'el.className = `osc-btn--${size}`;'];
  has(recordProblems(measure({ ...FIX, js: template }), b),
    /^osc-btn--: 1 occurrences, above the recorded 0/);
});

test('mutation M7: renaming a legacy class and lowering the record fails against history', () => {
  const was = fixRecord();
  const renamed = FIX_JS.map((s) => s
    .replace("'osc-btn osc-btn-secondary'", "'osc-btn osc-btn-alt'"));
  const now = record(measure({ ...FIX, js: renamed }));
  assert.equal(now.debt, was.debt, 'a rename does not lower the debt');
  assert.deepEqual(recordProblems(measure({ ...FIX, js: renamed }), now), []);
  assert.deepEqual(historyProblems(now, [{ sha: 'a1', baseline: was }]),
    ['osc-btn-alt: 1 occurrences, above 0 at a1']);
  const fewer = { ...now, classes: { ...now.classes } };
  delete fewer.classes['osc-btn-alt'];
  fewer.debt -= 1;
  assert.deepEqual(historyProblems(fewer, [{ sha: 'a1', baseline: was }]), []);
  const vocab = { ...was, vocabulary: { ...was.vocabulary, 'is-new': 1 } };
  assert.deepEqual(historyProblems(vocab, [{ sha: 'a1', baseline: was }]),
    ['is-new: a class not in the vocabulary at a1']);
  const styles = { ...was, inlineStyles: was.inlineStyles + 1 };
  assert.deepEqual(historyProblems(styles, [{ sha: 'a1', baseline: was }]),
    [`inline styles: ${was.inlineStyles + 1}, above ${was.inlineStyles} at a1`]);
});

test('mutation M8: a pending surface that vanishes from the record fails', () => {
  const was = fixRecord();
  const gone = FIX_HTML.replace(' id="osc-panel-b"', '');
  const now = record(measure({ ...FIX, html: gone }));
  assert.ok(!now.surfaces.pending.includes('card#osc-panel-b'));
  assert.deepEqual(recordProblems(measure({ ...FIX, html: gone }), now), []);
  assert.deepEqual(historyProblems(now, [{ sha: 'a1', baseline: was }]),
    ['card#osc-panel-b: pending at a1, now neither pending nor migrated']);
});

test('mutation M9: a surface on the Pro class set counts as migrated only with the build', () => {
  const was = fixRecord();
  const proHtml = FIX_HTML.replace('class="osc-panel" id="osc-panel-b"',
    `class="p-4 ${PRO_CARD}" id="osc-panel-b"`);
  const unbuilt = measure({ ...FIX, html: proHtml });
  assert.ok(unbuilt.pending.includes('card#osc-panel-b'), 'without the build it stays pending');
  const p1 = recordProblems(unbuilt, was);
  has(p1, /^bg-white: a class outside the legacy vocabulary.*the build does not compile/);
  const claimed = { ...record(unbuilt), surfaces: { pending: unbuilt.pending
    .filter((k) => k !== 'card#osc-panel-b'), migrated: ['card#osc-panel-b'] } };
  has(recordProblems(unbuilt, claimed), /^card#osc-panel-b: listed as migrated, but the build/);
  const dist = `<style>${['p-4', ...PRO_CARD.split(' ')]
    .map((c) => `.${c.replace(/[^\w-]/g, '\\$&')}{x:y}`).join('')}</style>`;
  const built = { compiles: true, defines: definedClasses(dist) };
  const m = measure({ ...FIX, html: proHtml, build: built });
  assert.deepEqual(m.migrated, ['card#osc-panel-b']);
  const now = record(m);
  assert.deepEqual(recordProblems(m, now), []);
  assert.deepEqual(historyProblems(now, [{ sha: 'a1', baseline: was }]), []);
  const half = { compiles: true, defines: definedClasses('<style>.bg-white{x:y}</style>') };
  assert.ok(measure({ ...FIX, html: proHtml, build: half }).pending.includes('card#osc-panel-b'),
    'a Pro class the compiled CSS does not define keeps the surface pending');
});

test('fixture: the build compiles Tailwind with the flowbite plugin only when all of it is there',
  () => {
    const pkg = { devDependencies: { tailwindcss: '4', flowbite: '2' } };
    const build = "import { compile } from '@tailwindcss/node';";
    const entry = '@import "tailwindcss";\n@plugin "flowbite/plugin";\n';
    assert.equal(buildCompilesFlowbite({ pkg, files: { 'scripts/build.mjs': build,
      [TAILWIND_ENTRY]: entry } }), true);
    assert.equal(buildCompilesFlowbite({ pkg, files: { 'scripts/build.mjs': build,
      'tailwind.config.js': "module.exports = { plugins: [require('flowbite/plugin')] };" } }),
    true);
    assert.equal(buildCompilesFlowbite({ pkg: {}, files: { 'scripts/build.mjs': build,
      [TAILWIND_ENTRY]: entry } }), false, 'no tailwindcss or flowbite dependency');
    assert.equal(buildCompilesFlowbite({ pkg, files: { [TAILWIND_ENTRY]: entry } }), false,
      'no build script runs Tailwind');
    assert.equal(buildCompilesFlowbite({ pkg, files: { 'scripts/build.mjs': build,
      [TAILWIND_ENTRY]: '@import "tailwindcss";\n/* @plugin "flowbite/plugin"; */' } }), false,
    'a commented-out plugin');
    assert.equal(buildCompilesFlowbite({ pkg, files: { 'scripts/build.mjs':
      `// ${build}`, [TAILWIND_ENTRY]: entry } }), false, 'a commented-out compiler');
  });

test('mutation N4/N5: a module or a stylesheet the build reaches outside src/js or src counts',
  () => {
    const files = {
      'src/index.html': '<body></body>',
      'src/js/main.js': "import './ui/a.js';\nimport '../extra/card.js';\n"
        + "import { x } from '../../lib/card';\nimport Alpine from 'alpinejs';\n"
        + "import w from './w.worklet.js?raw';\n"
        + "const u = new URL('../../lib/u.js', import.meta.url);"
        + "\nimport('./missing.js');",
      'src/js/ui/a.js': "export const a = require('../../../lib/components/btn.js');",
      'src/js/w.worklet.js': '',
      'src/extra/card.js': "export const card = (el) => { el.className = 'osc-btn my-new-card'; };",
      'lib/card.js': "export * from '../outside/deep.mjs';",
      'lib/u.js': '',
      'lib/components/btn.js': '',
      'outside/deep.mjs': "el.className = 'osc-btn';",
      'src/styles/main.css': '@import "uplot/dist/uPlot.min.css";\n@import "./a.css";\n'
        + '@import "../../assets-ui/x.css";\n@import url(tokens2.css);\n'
        + '/* @import "./commented.css"; */',
      'src/styles/a.css': '',
      'src/styles/tokens2.css': '',
      'src/styles/commented.css': '',
      'assets-ui/x.css': '.my-card { padding: 4px; color: red }\n',
      'node_modules/alpinejs/index.js': '',
    };
    const tracked = Object.keys(files).filter((p) => p.startsWith('src/')
      && !['src/styles/tokens2.css', 'src/styles/commented.css'].includes(p));
    const inputs = bundledInputs(fakeRepo(files, tracked));
    assert.deepEqual(inputs.js, ['lib/card.js', 'lib/components/btn.js', 'lib/u.js',
      'outside/deep.mjs', 'src/extra/card.js', 'src/js/main.js', 'src/js/ui/a.js',
      'src/js/w.worklet.js']);
    assert.deepEqual(inputs.css, ['assets-ui/x.css', 'src/styles/a.css', 'src/styles/main.css',
      'src/styles/tokens2.css'], 'an untracked stylesheet the build reaches is measured too');
    const b = fixRecord();
    const reached = measure({ ...FIX, js: [...FIX_JS, ...inputs.js.map((p) => files[p])],
      css: { ...FIX_CSS, 'assets-ui/x.css': files['assets-ui/x.css'] } });
    const p = recordProblems(reached, b);
    has(p, /^osc-btn: 4 occurrences, above the recorded 2/);
    has(p, /^my-new-card: a class outside the legacy vocabulary/);
    has(p, /^assets-ui\/x\.css: a new stylesheet/);
    assert.deepEqual(kitProblems({ pkg: {}, js: {}, css: {},
      paths: [...inputs.js, ...inputs.css] }),
      ['lib/components/btn.js: an ad-hoc component library; adapt the Flowbite Pro component']);
    assert.equal(resolveRelative('src/js/a.js', '../../../etc/x.js', () => true), null,
      'a path outside the repository is not an input');
    assert.equal(resolveRelative('src/js/a.js', 'alpinejs', () => true), null, 'nor a package');
  });

test('mutation N7/N2: renaming into, or reusing, a legacy vocabulary token raises its count',
  () => {
    const was = fixRecord();
    const renamed = FIX_JS.map((s) => s
      .replace("'osc-btn osc-btn-secondary'", "'osc-btn is-active'"));
    const m = measure({ ...FIX, js: renamed });
    has(recordProblems(m, was), /^is-active: 2 uses, above the recorded 1/);
    const now = record(m);
    assert.equal(now.debt, was.debt, 'a rename into the vocabulary does not lower the debt');
    assert.deepEqual(historyProblems(now, [{ sha: 'a1', baseline: was }]),
      ['is-active: 2 uses, above 1 at a1']);
    const reused = FIX_HTML.replace('</main>',
      '<div class="is-on x"><b class="is-">y</b></div></main>');
    const p = recordProblems(measure({ ...FIX, html: reused }), was);
    has(p, /^is-on: 2 uses, above the recorded 1/);
    has(p, /^is-: 2 uses, above the recorded 1/);
    has(p, /^x: a class outside the legacy vocabulary/);
    const v2 = { ...was, measure: MEASURE - 1, vocabulary: Object.keys(was.vocabulary) };
    assert.deepEqual(historyProblems({ ...was, vocabulary: { ...was.vocabulary, y: 1 } },
      [{ sha: 'm2', baseline: v2 }]), ['y: a class not in the vocabulary at m2'],
    'a token is new against a version of an earlier measure too');
  });

const proBuild = (css) => ({ compiles: true, defines: definedClasses(`<style>${css}</style>`) });

test('mutation N10: ad-hoc CSS in the Tailwind entry, its config or a local plugin fails', () => {
  const b = fixRecord();
  const html = FIX_HTML.replace('</main>', '<div class="my-card"></div></main>');
  const utility = { ...FIX_CSS, [TAILWIND_ENTRY]: '@import "tailwindcss";\n'
    + '@plugin "flowbite/plugin";\n@utility my-card { padding: 4px; border: 1px solid red; }\n' };
  const built = proBuild('.my-card{padding:4px}');
  assert.deepEqual(recordProblems(measure({ ...FIX, html, css: utility, build: built }), b), [
    `${TAILWIND_ENTRY}: 1 selector rule(s) or @utility rule(s); the Tailwind entry holds only `
      + '@import, @plugin, @source, @theme and other at-rules: style with Tailwind and Flowbite '
      + 'Pro classes'], 'the class it defines is in dist, but the entry defines it');
  const config = { 'tailwind.config.cjs': "const plugin = require('tailwindcss/plugin');\n"
    + 'module.exports = { plugins: [plugin(({ addComponents }) => {\n'
    + "  addComponents({ '.my-card': { padding: '4px' } });\n  // addUtilities({})\n})] };" };
  has(recordProblems(measure({ ...FIX, html, build: built, tailwind: config }), b),
    /^tailwind\.config\.cjs: 2 mention\(s\) of addComponents/);
  const files = {
    [TAILWIND_ENTRY]: '@import "tailwindcss";\n@plugin "./cards.js";\n@plugin "flowbite/plugin";',
    'src/styles/cards.js': "export default ({ matchUtilities }) => matchUtilities({});",
    'tailwind.config.js': "module.exports = { plugins: [require('./tw/base.cjs')] };",
    'tw/base.cjs': 'module.exports = ({ addBase }) => addBase({ h1: {} });',
  };
  const loaded = tailwindFiles(fakeRepo(files));
  assert.deepEqual(Object.keys(loaded).sort(), ['src/styles/cards.js', 'tailwind.config.js',
    'tw/base.cjs']);
  const p = recordProblems(measure({ ...FIX, tailwind: loaded }), b);
  has(p, /^src\/styles\/cards\.js: 2 mention/);
  has(p, /^tw\/base\.cjs: 2 mention/);
  const aliased = { 'tailwind.config.js': 'module.exports = { plugins: [plugin(('
    + "{ addComponents: ac }) => ac({ '.my-card': {} }))] };",
  'src/styles/mine.js': 'export default ({ addUtilities: u }) => u({});',
  'tw/api.cjs': 'module.exports = (api) => api.matchUtilities({});' };
  const pa = recordProblems(measure({ ...FIX, tailwind: aliased }), b);
  has(pa, /^tailwind\.config\.js: 1 mention/);
  has(pa, /^src\/styles\/mine\.js: 1 mention/);
  has(pa, /^tw\/api\.cjs: 1 mention/);
});

test('mutation: after F001 a legacy class stays legacy whatever dist defines (is-active, N8)',
  () => {
    const legacy = '.osc-panel-title.is-active { color: red }\n';
    const css = { 'src/styles/a.css': FIX_CSS['src/styles/a.css'] + legacy };
    const f001 = proBuild('.osc-panel-title.is-active{color:red}');
    const atF001 = measure({ ...FIX, css, build: f001 });
    assert.equal(atF001.vocabulary['is-active'], 1, 'a legacy stylesheet names it: legacy');
    const recF001 = record(atF001);
    assert.deepEqual(recordProblems(atF001, recF001), []);
    const later = measure({ ...FIX, build: proBuild('') });
    assert.equal(later.vocabulary['is-active'], 1, 'its last legacy rule removed: still legacy');
    const recLater = record(later);
    assert.deepEqual(recordProblems(later, recLater), []);
    assert.deepEqual(historyProblems(recLater, [{ sha: 'f001', baseline: recF001 }]), [],
      'removing legacy CSS never turns a used legacy class into a new one');
    const flowbiteToo = measure({ ...FIX, build: proBuild('.is-active{color:blue}') });
    has(recordProblems(flowbiteToo, recLater),
      /^is-active: in the recorded vocabulary, but now a Pro class/);
    const renamed = FIX_JS.map((s) => s
      .replace("'osc-btn osc-btn-secondary'", "'osc-btn btn-secondary'"));
    const n8 = measure({ ...FIX, js: renamed, build: proBuild('.btn-secondary{color:red}'),
      css: { 'src/styles/a.css': `${FIX_CSS['src/styles/a.css']}.btn-secondary { color: red }` } });
    has(recordProblems(n8, fixRecord()),
      /^btn-secondary: a class outside the legacy vocabulary of the record, and it is not a Pro/);
    const proHtml = FIX_HTML.replace('class="osc-panel" id="osc-panel-b"',
      `class="p-4 ${PRO_CARD}" id="osc-panel-b"`);
    const fake = measure({ ...FIX, html: proHtml, build: proBuild('.bg-white{x:y}.rounded-lg{x:y}'
      + '.shadow{x:y}.dark\\:bg-gray-800{x:y}'), css: { 'src/styles/a.css':
      `${FIX_CSS['src/styles/a.css']}.bg-white { color: white }` } });
    assert.ok(fake.pending.includes('card#osc-panel-b'),
      'a Pro class a legacy stylesheet defines does not migrate a surface');
  });

test('fixture: a Studio node id that is never in a class position is not counted', () => {
  const js = [...FIX_JS, "node('osc-1', 'oscillator'); edge('e-1', 'osc-1', 'audio', 'env-1');",
    "el.className = 'osc-2'; const n = 'osc-3';", '.osc-3 {}'];
  const m = measure({ ...FIX, js });
  assert.equal(m.classes['osc-1'], undefined, 'a node id');
  assert.equal(m.classes['osc-2'], 1, 'in a class position');
  assert.equal(m.classes['osc-3'], 2, 'a selector names it');
});

test('fixture: the history gate fails in CI when git fails, and skips only outside CI', () => {
  assert.equal(historyGate({ error: 'git log failed' }, true).verdict, 'fail');
  assert.equal(historyGate({ versions: [] }, true).verdict, 'fail');
  assert.equal(historyGate({ error: 'git log failed' }, false).verdict, 'skip');
  assert.equal(historyGate({ versions: [{ sha: 'a1', baseline: {} }] }, true).verdict, 'judge');
});

test('fixture: the working tree is judged against each committed version, not each pair', () => {
  const was = fixRecord();
  const high = { ...was, debt: was.debt + 5 };
  const history = [{ sha: 'b2', baseline: high }, { sha: 'a1', baseline: was }];
  assert.deepEqual(historyProblems(was, history), [],
    'an earlier version above a still earlier one is not judged again');
  assert.deepEqual(historyProblems({ ...was, debt: was.debt + 1 }, history),
    [`debt ${was.debt + 1} is above ${was.debt} at a1`]);
  const v1 = { debt: 1, surfaces: { pending: was.surfaces.pending }, primitives: { 'osc-btn': 0 },
    stylesheets: ['src/styles/a.css'] };
  assert.deepEqual(historyProblems(was, [{ sha: 'v1', baseline: v1 }]), [],
    'the numbers of an earlier measure are not compared');
  const v1Sheets = { ...v1, stylesheets: [] };
  assert.deepEqual(historyProblems(was, [{ sha: 'v1', baseline: v1Sheets }]),
    ['src/styles/a.css: a legacy stylesheet not listed at v1']);
  assert.deepEqual(historyProblems({ ...was, measure: 1 }, [{ sha: 'a1', baseline: was }]),
    [`measure 1 is below ${MEASURE} at a1`]);
});

test('mutation (c): another UI kit, a foreign @import, a new stylesheet or a component library',
  () => {
    const clean = { pkg: { dependencies: { alpinejs: '3', flowbite: '2' },
      devDependencies: { tailwindcss: '3' } },
    js: { 'src/js/a.js': "import Alpine from 'alpinejs';" },
    css: { 'src/styles/main.css': '@import "uplot/dist/uPlot.min.css";\n@import "./a.css";\n'
      + '@import "flowbite";' }, paths: ['src/js/a.js', 'src/styles/a.css'] };
    assert.deepEqual(kitProblems(clean), []);
    assert.deepEqual(kitProblems({ ...clean, pkg: { dependencies: { bootstrap: '5',
      '@mui/material': '6' } } }), ['package.json dependencies: bootstrap is another UI kit',
      'package.json dependencies: @mui/material is another UI kit']);
    assert.deepEqual(kitProblems({ ...clean, js: { 'src/js/b.js':
      "import { Button } from '@chakra-ui/react';\nconst d = await import('daisyui');" } }),
    ['src/js/b.js: imports @chakra-ui/react, another UI kit',
      'src/js/b.js: imports daisyui, another UI kit']);
    assert.deepEqual(kitProblems({ ...clean, css: { 'src/styles/x.css':
      '@import url("bulma/css/bulma.css");\n@import "animate.css";\n/* @import "uikit"; */' } }),
    ['src/styles/x.css: @import bulma/css/bulma.css, another UI kit',
      `src/styles/x.css: @import animate.css, a package outside ${ALLOWED_CSS_PACKAGES}`]);
    assert.deepEqual(kitProblems({ ...clean, paths: ['src/js/ui/components/button.js',
      'src/styles/widgets.css', 'src/styles/components.css'],
    legacyStylesheets: ['src/styles/components.css'] }), [
      'src/js/ui/components/button.js: an ad-hoc component library; adapt the Flowbite Pro '
        + 'component',
      'src/styles/widgets.css: an ad-hoc component library; adapt the Flowbite Pro component']);
    assert.deepEqual(kitProblems({ ...clean, css: { 'src/styles/y.css': '@import "flowbite-x";\n'
      + '@import "tailwindcss-forms/x.css";\n@import "uplotted";\n@import "tailwindcss/base";\n'
      + '@import "flowbite/plugin";' } }), [
      `src/styles/y.css: @import flowbite-x, a package outside ${ALLOWED_CSS_PACKAGES}`,
      `src/styles/y.css: @import tailwindcss-forms/x.css, a package outside `
        + `${ALLOWED_CSS_PACKAGES}`,
      `src/styles/y.css: @import uplotted, a package outside ${ALLOWED_CSS_PACKAGES}`],
    'a package is allowed by its exact name, never by a prefix');
  });

test('mutation (d): a Pro package path, a fingerprinted file or a Pro marker fails', () => {
  const pro = Buffer.from(`${'<div class="p-4 bg-white rounded-lg shadow">x</div>\n'.repeat(20)}`);
  const prints = new Set([fingerprint('a.html', pro)]);
  const ok = Buffer.from('<p>OSCILLA</p>');
  assert.deepEqual(proSourceProblems([{ path: 'src/index.html', bytes: ok }], prints), []);
  assert.deepEqual(proSourceProblems([
    { path: 'vendor/flowbite-admin-dashboard-1.1.1/src/html/index.html', bytes: ok },
    { path: 'assets/vendor/flowbite/app.js', bytes: ok },
    { path: 'src/pages/copied.html', bytes: Buffer.from(pro.toString().replace(/\n/g, '\r\n')) },
    { path: 'docs/notes.md', bytes: Buffer.from(`see ${PRO_MARKERS[0]}/ for terms`) },
    { path: 'package.json',
      bytes: Buffer.from(`"url": "git+https://github.com/${PRO_MARKERS[1]}"`) },
  ], prints), [
    'vendor/flowbite-admin-dashboard-1.1.1/src/html/index.html: a path named like a licensed '
      + 'Flowbite Pro package',
    'assets/vendor/flowbite/app.js: a path named like a licensed Flowbite Pro package',
    `src/pages/copied.html: a licensed Flowbite Pro source file (fingerprint ${[...prints][0]})`,
    `docs/notes.md: carries ${PRO_MARKERS[0]}, a marker of the licensed Pro packages`,
    `package.json: carries ${PRO_MARKERS[1]}, a marker of the licensed Pro packages`,
  ]);
  for (const own of ['scripts/flowbite-pro-fingerprints.mjs', FINGERPRINTS_REL,
    'tests/unit/ui-flowbite-pro.test.mjs']) {
    assert.deepEqual(proSourceProblems([{ path: own, bytes: ok }], prints), [], own);
  }
  for (const pkg of ['flowbite-admin-dashboard-1.1.1', 'flowbite-pro-nextjs-admin-dashboard-1.2.2',
    'flowbite-pro-react-admin-dashboard-main', 'flowbite-react-blocks-1.5.0-beta',
    'publisher-ui-blocks-v1.0.0', 'flowbite-react-blocks-main.zip']) {
    assert.match(pkg, PRO_PACKAGE_NAME, pkg);
  }
  assert.equal(fingerprint('small.js', Buffer.from('module.exports = {};')), null,
    'a file below the minimum is not fingerprinted');
});

test('mutation: an osc-* class in a data or other attribute counts, an id reference does not',
  () => {
    const b = fixRecord();
    const data = FIX_HTML.replace('</main>', '<div data-cls="osc-btn osc-panel"></div></main>');
    const p = recordProblems(measure({ ...FIX, html: data }), b);
    has(p, /^osc-btn: 3 occurrences, above the recorded 2/);
    has(p, /^osc-panel: 3 occurrences, above the recorded 2/);
    const titled = FIX_HTML.replace('</main>', '<a href="osc-note.html" title="osc-x"></a></main>');
    const pt = recordProblems(measure({ ...FIX, html: titled }), b);
    has(pt, /^osc-note: 2 occurrences, above the recorded 1/);
    has(pt, /^osc-x: 1 occurrences, above the recorded 0/);
    const refs = FIX_HTML.replace('</main>', '<label for="osc-panel-a" aria-describedby="osc-btn">'
      + '<a href="#osc-panel" x-ref="osc-note"></a></label></main>');
    assert.deepEqual(recordProblems(measure({ ...FIX, html: refs }), b), [],
      'id references (for, aria-*, href="#...", x-ref) name ids, not classes');
  });

test('mutation: a CSS @import of a data: URI, a URL or an absolute path fails', () => {
  const clean = { pkg: {}, js: {}, paths: [] };
  assert.deepEqual(kitProblems({ ...clean, css: { 'src/styles/main.css': '@import "./a.css";\n'
    + '@import url(../b.css);\n@import "uplot/dist/uPlot.min.css";' } }), []);
  assert.deepEqual(kitProblems({ ...clean, css: { 'src/styles/main.css':
    '@import "data:text/css,main%3Ediv{color:red}";\n@import url(https://cdn.example/x.css);\n'
    + '@import "/abs/y.css";\n@import url("data:text/css;base64,LmE=");' } }).map((s) => s
    .replace(/,.*$/, '')), ['src/styles/main.css: @import data:text/css',
    'src/styles/main.css: @import https://cdn.example/x.css',
    'src/styles/main.css: @import /abs/y.css', 'src/styles/main.css: @import data:text/css']);
});

test('mutation: a tracked file under a node_modules directory is an input, an untracked one is not',
  () => {
    const files = {
      'src/index.html': '<body></body>',
      'src/styles/main.css': '@import "../../lib/node_modules/card.css";\n'
        + '@import "../../node_modules/pkg/x.css";',
      'src/js/main.js': "import '../../lib/node_modules/k.js';\n"
        + "import '../../node_modules/p/i.js';",
      'lib/node_modules/card.css': '.my-card { padding: 4px }',
      'lib/node_modules/k.js': "el.className = 'osc-btn';",
      'node_modules/pkg/x.css': '.x { color: red }',
      'node_modules/p/i.js': '',
    };
    const tracked = Object.keys(files).filter((p) => !p.startsWith('node_modules/'));
    const inputs = bundledInputs(fakeRepo(files, tracked));
    assert.deepEqual(inputs.css, ['lib/node_modules/card.css', 'src/styles/main.css']);
    assert.deepEqual(inputs.js, ['lib/node_modules/k.js', 'src/js/main.js']);
    has(recordProblems(measure({ ...FIX, css: { ...FIX_CSS,
      'lib/node_modules/card.css': files['lib/node_modules/card.css'] } }), fixRecord()),
    /^lib\/node_modules\/card\.css: a new stylesheet/);
  });

test('fixture: the domain views are recorded apart, ratcheted, and not debt', () => {
  const [studio] = DOMAIN_VIEW_STYLESHEETS.filter((f) => f.endsWith('/studio.css'));
  const css = { ...FIX_CSS, [studio]: '.osc-node { color: red }\n.osc-cable, .osc-port { x: y }' };
  const m = measure({ ...FIX, css });
  assert.deepEqual(m.domainViews, { [studio]: { selectors: 3, declarations: 2 } });
  assert.equal(m.stylesheets[studio], undefined);
  assert.equal(m.debt, measure(FIX).debt, 'domain-view selectors are not debt');
  const b = record(m);
  assert.deepEqual(recordProblems(m, b), []);
  const grown = measure({ ...FIX, css: { ...css, [studio]: `${css[studio]}\n.osc-x { a: b }` } });
  const pg = recordProblems(grown, b);
  has(pg, new RegExp(`^${studio}: 4 selectors, above the recorded 3`));
  has(pg, new RegExp(`^${studio}: 3 declarations, above the recorded 2`));
  has(recordProblems(m, fixRecord()), new RegExp(`^${studio}: a domain-view stylesheet the `
    + 'record does not list'));
  const asLegacy = { ...b, measure: MEASURE, domainViews: {}, stylesheets: { ...b.stylesheets,
    [studio]: { selectors: 2, declarations: 2 } } };
  assert.deepEqual(historyProblems(b, [{ sha: 'm3', baseline: asLegacy }]),
    [`${studio}: 3 selectors, above 2 at m3`],
    'a domain view is judged against the version that listed it as a legacy stylesheet');
  const unlisted = { ...asLegacy, stylesheets: { ...b.stylesheets } };
  assert.deepEqual(historyProblems(b, [{ sha: 'm3', baseline: unlisted }]),
    [`${studio}: a legacy stylesheet not listed at m3`]);
});

test('fixture: the history gate introduces the record when the base holds none', () => {
  assert.equal(historyGate({ versions: [], baseHolds: false, base: 'main', fork: 'f' }, true)
    .verdict, 'introduce');
  assert.equal(historyGate({ versions: [], baseHolds: true }, true).verdict, 'fail');
  assert.equal(historyGate({ versions: [], baseHolds: true }, false).verdict, 'skip');
});

/** A scratch git repository: `git(...args)` runs in it, `commit(record, message)` commits. */
function scratchRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'osc-ui-history-'));
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  const write = (rel, text) => {
    const full = path.join(dir, rel);
    spawnSync('mkdir', ['-p', path.dirname(full)]);
    writeFileSync(full, text);
  };
  const commit = (files, message) => {
    for (const [rel, text] of Object.entries(files)) write(rel, text);
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  return { dir, git, commit, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('fixture: only the base branch chain is judged, never the branch\'s own commits', (t) => {
  const repo = scratchRepo();
  t.after(repo.done);
  const was = fixRecord();
  const sheet = 'src/styles/a.css';
  const at = (selectors, declarations = 5) => ({ ...was, stylesheets: { ...was.stylesheets,
    [sheet]: { selectors, declarations } } });
  const json = (r) => ({ [BASELINE_REL]: `${JSON.stringify(r, null, 2)}\n` });
  const judge = (base = 'main') => {
    const history = baselineHistory({ root: repo.dir, base });
    const gate = historyGate(history, true);
    const current = JSON.parse(readFileSync(path.join(repo.dir, BASELINE_REL), 'utf8'));
    return { gate: gate.verdict, problems: gate.verdict === 'judge'
      ? historyProblems(current, history.versions) : [], history };
  };
  repo.commit({ 'README.md': 'base\n' }, 'base without a record');
  repo.git('checkout', '-q', '-b', 'rule');
  const own = repo.commit(json(at(4, 5)), 'the branch commits a record');
  repo.git('checkout', '-q', 'main');
  repo.commit({ 'README.md': 'the base raises a count in its tree\n' }, 'base change');
  repo.git('checkout', '-q', 'rule');
  repo.git('merge', '-q', '--no-edit', 'main');
  repo.commit(json(at(4, 6)), 'the branch re-measures after merging its base');
  const branch = judge();
  assert.equal(branch.gate, 'introduce', 'the base holds no record: the branch introduces it');
  assert.ok(!branch.history.versions.some((v) => own.startsWith(v.sha)));
  assert.deepEqual(historyProblems(at(4, 6), [{ sha: own.slice(0, 12), baseline: at(4, 5) }]),
    [`${sheet}: 6 declarations, above 5 at ${own.slice(0, 12)}`],
    'what judging the branch\'s own commit would have refused');
  repo.git('checkout', '-q', '--detach', 'main');
  repo.git('merge', '-q', '--no-ff', '--no-edit', 'rule');
  assert.equal(judge().gate, 'introduce', 'the pull request\'s merge ref passes too');
  repo.git('checkout', '-q', 'main');
  repo.git('merge', '-q', '--no-ff', '--no-edit', 'rule');
  repo.git('checkout', '-q', 'rule');
  const landed = judge();
  assert.equal(landed.gate, 'introduce', 'once the base holds the branch, the walk stays on the '
    + 'base\'s chain and never reaches the branch\'s own commits');
  repo.git('checkout', '-q', 'main');
  repo.git('checkout', '-q', '-b', 'next');
  repo.commit(json(at(4, 7)), 'a later branch raises a count against the base\'s record');
  const raised = judge();
  assert.equal(raised.gate, 'judge');
  assert.deepEqual(raised.problems.filter((p) => p.startsWith(sheet)),
    [`${sheet}: 7 declarations, above 6 at ${raised.history.versions[0].sha}`]);
  repo.commit(json(at(3, 6)), 'it lowers the count instead');
  assert.deepEqual(judge().problems, []);
  assert.match(baselineHistory({ root: repo.dir, base: 'no-such-base' }).error, /no base branch/);
});

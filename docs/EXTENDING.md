# Hack and extend OSCILLA

OSCILLA is MIT-licensed, modular source that builds into one HTML file. This guide shows where
each kind of extension plugs in, using the code that is on `main` today. Every file, export and
npm script named here is checked by `tests/unit/extending-guide.test.mjs`, so a rename that
leaves this guide behind fails `npm test`. The Studio node example below is compiled through the
real registry and compiler by the same test.

Notation: `src/js/studio/registry.js#createNodeRegistry` means the export `createNodeRegistry` of
that file. The Studio registry writes its compiler keys the same way.

Start here:

```bash
npm ci
npm test                 # every unit test, under node --test
npm run build            # src/ -> dist/index.html; commit dist/ with the source change
npm run verify           # the fast gate: unit tests, build check, artifact rules, doctor
```

The layout of `src/js/` is described in [CLAUDE.md](../CLAUDE.md) ("Architecture of `src/js/`"),
the words in the [glossary](GLOSSARY.md), and the rules every change satisfies are at the
[end of this guide](#the-rules-a-change-satisfies).

## Add a Studio node

A Studio node type is frozen plain data: ports, parameters, help text and a compiler key. It never
holds an audio node. The audio side is a separate adapter that builds the node from what the
existing engine already has. Four pieces carry it:

| Piece | Where | What it does |
| --- | --- | --- |
| Definition | `src/js/studio/nodes/common.js#defineNode` | fills the defaults (no ports, no clip kinds, only `serializable` among the capabilities) and freezes the definition |
| Ports | `src/js/studio/ports.js#definePort` | one typed port: `AUDIO`, `CONTROL`, `TRIGGER` or `ANALYSIS` (`src/js/studio/ports.js#PORT_TYPES`) with a role (`src/js/studio/ports.js#ROLES_BY_TYPE`) |
| Registry | `src/js/studio/registry.js#createNodeRegistry` | validates every definition (`src/js/studio/registry.js#validateNodeDefinition`) and throws a `TypeError` that lists each authoring error |
| Adapter | `src/js/studio/adapters/nodes.js#NODE_ADAPTERS` | builds the node's Web Audio nodes through the engine's accounting (`acct.track`) and implements the compiler key of its definition |

**Ports.** `src/js/studio/ports.js#canConnect` decides from the two port definitions alone, so a
cable joins only compatible types. Graph rules (multiplicity, duplicates, cycles) are
`src/js/studio/validate.js#validateStudioModel`. Every audio input takes one connection; the
Mixer, with one input per channel, is the only node that sums, so accidental summing cannot
happen. A modulatable parameter gets a generated
`PARAMETER` input port (`src/js/studio/ports.js#parameterPort`): you declare the parameter, not
the port.

**Parameters.** Use the helpers of `src/js/studio/nodes/common.js`:
`src/js/studio/nodes/common.js#numberParam`, `src/js/studio/nodes/common.js#integerParam`,
`src/js/studio/nodes/common.js#enumParam`, `src/js/studio/nodes/common.js#boolParam`,
`src/js/studio/nodes/common.js#frequencyParam`, `src/js/studio/nodes/common.js#levelParam` and
`src/js/studio/nodes/common.js#secondsParam`. A numeric parameter can be `automatable` (a
timeline lane drives it) or `modulatable` (a CONTROL cable drives it); only numeric parameters
can be either. Levels are relative digital levels, never SPL.

**The compiler hook.** `compiler` is a `module.js#export` key under `src/js/` naming the existing
builder the node reuses (`src/js/studio/registry.js#COMPILER_KEY_PATTERN`). The test
`tests/unit/v31-studio-model.test.mjs` imports every key and fails when the export does not
exist. `src/js/studio/compiler.js#compileStudio` refuses an invalid model before Web Audio sees
it. A node without an adapter compiles to `degraded` with the code `no-adapter`, and an adapter
whose key differs compiles to `adapter-mismatch`: it never throws. Both `compileStudio` and
`createNodeRegistry` take the registry and the adapters as arguments, so you can try a node type
without touching the shipped library, exactly as the example below does.

### A complete minimal node: Polarity

This node flips the polarity of the audio passing through it (a gain of -1). It is the example
`tests/unit/extending-guide.test.mjs` compiles. In the product it would live in
`src/js/studio/nodes/processing.js` (its definition) and `src/js/studio/adapters/nodes.js` (its
adapter); here it is one module.

<!-- extending-guide:example studio-node -->
```js
// src/js/studio/nodes/polarity.js (the path this example is written for)
import { definePort } from '../ports.js';
import { CATEGORIES, boolParam, defineNode } from './common.js';

export const polarity = defineNode({
  type: 'polarity',
  displayName: 'Polarity',
  idPrefix: 'polarity',
  category: CATEGORIES.PROCESSING,
  aliases: ['invert', 'phase flip'],
  inputs: [definePort({ id: 'audio', direction: 'in', type: 'AUDIO', label: 'Audio' })],
  outputs: [definePort({ id: 'audio', direction: 'out', type: 'AUDIO', label: 'Audio' })],
  params: [boolParam('inverted', 'Inverted', true)],
  summary: (p) => (p.inverted ? 'Inverted' : 'Unchanged'),
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/audio-engine.js#AudioEngine',
  help: {
    what: 'Multiplies the audio by -1 when inverted, by 1 otherwise.',
    inputs: 'Audio.',
    outputs: 'Audio at the same level, with its polarity flipped when inverted.',
    constraints: 'A flip alone sounds the same; it matters when the signal is summed.',
  },
});

// The adapter: `compiler` must equal the definition's key. `inverted` is structural, so a change
// builds a replacement node and the runtime crossfades to it instead of passing through zero.
export const polarityAdapter = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: ['inverted'],
  create({ ctx, acct, params }) {
    const g = acct.track(ctx.createGain());
    g.gain.setValueAtTime(params.inverted ? -1 : 1, ctx.currentTime);
    return {
      inputs: { audio: g },
      outputs: { audio: g },
      outputRange: {},
      modTarget: (key) => ({ reason: `${key} is not modulatable` }),
      applyBase() {},
      update() {},
      stop() {},
      dispose() {},
      info: {},
      status: 'ready',
      reason: null,
    };
  },
};
```

Save it at that path and add its unit test; `node --test tests/unit/my-node.test.mjs` runs it.
Give the test a row in [tests/README.md](../tests/README.md):
`tests/unit/knowledge-integrity.test.mjs` fails a unit test or browser suite that has none.
`tests/unit/extending-guide.test.mjs` runs this test, as printed, against the example above:

<!-- extending-guide:example studio-node-test -->
```js
// tests/unit/my-node.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { NODE_DEFINITIONS, createNodeRegistry } from '../../src/js/studio/registry.js';
import { NODE_ADAPTERS } from '../../src/js/studio/adapters/nodes.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
import { createStudioModel } from '../../src/js/studio/schema.js';
import { edge, node } from '../../src/js/studio/templates/data.js';
import { polarity, polarityAdapter } from '../../src/js/studio/nodes/polarity.js';

test('Polarity compiles to a ready node between an oscillator and the master', () => {
  // Before step 1 below. Once the node ships, NODE_DEFINITIONS holds it and NODE_ADAPTERS its
  // adapter: pass NODE_DEFINITIONS and NODE_ADAPTERS alone (a second polarity is refused as a
  // duplicate type).
  const registry = createNodeRegistry([...NODE_DEFINITIONS, polarity]); // throws if invalid
  const adapters = { ...NODE_ADAPTERS, polarity: polarityAdapter };
  const model = createStudioModel({ graph: {
    nodes: [node('osc-1', 'oscillator', 0, 0), node('pol-1', 'polarity', 200, 0),
      node('master-1', 'master', 400, 0)],
    edges: [edge('e1', 'osc-1', 'audio', 'pol-1', 'audio'),
      edge('e2', 'pol-1', 'audio', 'master-1', 'audio')],
  } }, { registry });
  const plan = compileStudio(model, { engine: { isSupported: () => true }, registry, adapters });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.nodes.get('pol-1').status, 'ready');
});
```

To ship the node in the library:

1. Add the definition to the category module's default export (for Polarity,
   `src/js/studio/nodes/processing.js#default`); `src/js/studio/registry.js#NODE_DEFINITIONS`
   collects the categories in library order.
2. Add the adapter to `src/js/studio/adapters/nodes.js#NODE_ADAPTERS` under the node's type.
   `tests/unit/v31-studio-compiler.test.mjs` fails while a registry type has no adapter or a
   different key.
3. Update the three lists that tests hold to the registry, each of which names every type:
   - the library list of `tests/unit/v31-studio-model.test.mjs` ("registry holds the §29
     library"), with the count of each category;
   - the "Node registry" list of [docs/v31/studio-model.md](v31/studio-model.md), held by
     `tests/unit/docs-derived.test.mjs`;
   - the node-types table of [docs/v31/studio-report.md](v31/studio-report.md), held by
     `tests/unit/v31-studio-report.test.mjs`.
4. The Library panel, search, Inspector help and port glyphs read the registry, so nothing else
   is wired by hand. Describe the node in [docs/v31/studio-model.md](v31/studio-model.md) and,
   for its audio, [docs/v31/compiler.md](v31/compiler.md). Then `npm run build` and commit
   `dist/` with the source.

Nodes are created only through `acct.track` or `acct.source` (rule
`project.audio-engine-discipline`). Studio is orchestration: an adapter reuses an existing
builder (`src/js/audio/filters.js#createFilterStage`, `src/js/audio/noise.js#createNoiseSource`)
and does not reimplement DSP. `src/js/studio/` is a guarded path, so a pull request that ships a
node needs a reviewer's verdict (see the rules below).

### Templates

A template is versioned, validated product data in `src/js/studio/templates/`, built with the
helpers of `src/js/studio/templates/data.js` (`src/js/studio/templates/data.js#node`,
`src/js/studio/templates/data.js#edge`, `src/js/studio/templates/data.js#studioDoc`). Add the
module to `src/js/studio/templates/index.js#STUDIO_TEMPLATES`. Its `studioHash`
(`src/js/studio/schema.js#studioHash`) is pinned: an executed change (a node, parameter,
connection, clip or automation point) changes the hash, and `tests/unit/v31-studio-templates.test.mjs`
fails, showing the new hash, until the hash is re-pinned. Raise the template's `version` with it:
what an experiment or a saved project records of its template carries both
(`src/js/studio/templates/index.js#templateProvenance`). Positions, names and Learn text are
presentation and change neither. A shipped template opens from a
link, `#m=studio&st=<id>&sv=graph` (`src/js/core/url-state-studio.js#decodeStudioLink`).

## Add a lab or a workspace

**A lab** is a controller mounted on the shell by `src/js/labs/index.js#mountLabs`. It receives the
engine adapter documented at the top of that file (`getContext()`, `getAnalyser()`,
`onChange(cb)` and the optional extras), binds its controls with the helpers of
`src/js/labs/dom.js` (`src/js/labs/dom.js#on`, `src/js/labs/dom.js#onUi`,
`src/js/labs/dom.js#bindSwitch`) and returns `{ update(state), dispose() }`.
`src/js/labs/filter-lab.js` is a complete example: it builds its stages with
`src/js/audio/filters.js#createFilterStage` and never plays audio itself. The browser checks of
the labs are `tests/browser/labs.cjs` (`npm run test:labs`).

**A workspace** is one id in the navigation order:

1. Add the id to `MODES` in `src/js/ui/app.js` (exported as `src/js/ui/app.js#WORKSPACES`; a
   grouped item goes in `src/js/ui/app.js#NAV_GROUPS`).
2. Add its nav item to `src/index.html` (`href="#m=<id>"`, `data-osc="nav.<id>"`,
   `x-bind="navItem('<id>')"`) and its view, a `<section>` with `id="osc-view-<id>"` and
   `:hidden="workspace !== '<id>'"`.
3. Routing is then automatic: `src/js/ui/navigation.js#routeOfHash` turns `#m=<id>` into the
   workspace, every switch is one history entry and a reload reopens it (ADR
   [0045](../.ai/repo/adrs/0045-workspace-in-history-one-hash-dispatcher-unsaved-guard.md)).
4. Tests: `tests/unit/navigation.test.mjs` round-trips every id of `WORKSPACES` through the
   router, and the `open-every-workspace` check of `tests/browser/navigation.cjs` opens each one
   from a fresh page in Chromium, Firefox and WebKit. Two checks copy the navigation and change
   with it: the `nav-links` check of the same suite counts the nav links, and the "Navigation"
   section of [README.md](../README.md) lists the header entries and groups in order, held by
   `tests/unit/docs-derived.test.mjs`.

A new workspace or panel is a new UI surface, and rule `project.ui-uses-flowbite-pro` (ADR
[0061](../.ai/repo/adrs/0061-the-ui-is-built-on-flowbite-pro.md)) requires it to be built on
Flowbite Pro on Tailwind. The interface that predates the rule is a recorded debt
(`tests/unit/ui-flowbite-pro-baseline.json`) that may only shrink, and no part of it may grow:
not a surface, not a use of an existing `osc-*` class. Until the build compiles Tailwind with the
Flowbite plugin (plan issue F001, `.ai/repo/project/issues/F001.yaml`), a change that adds a
surface or a classed element fails `tests/unit/ui-flowbite-pro.test.mjs`. Code that adds no markup
(a node type, a template, an analysis module, a chart inside an existing host) is not affected.
This is also why About does not link this guide yet: the link waits for About on Pro components
(`.ai/repo/project/issues/F009.yaml`).

## Add a chart or visualization

Live renderers do not run their own animation loop. They subscribe to the one shared loop,
`src/js/charts/frame-loop.js#onFrame`, which calls each subscriber once per frame and returns an
unsubscribe function. The loop pauses while the page is hidden or "Pause animation" is on
(`src/js/charts/frame-loop.js#setFramesPaused`), and a subscriber that throws is removed after one
reported error, so one broken chart cannot stop the others.

The existing hosts take an element and options and return a controller with `dispose()`:

| Host | Draws |
| --- | --- |
| `src/js/charts/spectrum-chart.js#createSpectrumChart` | the live FFT spectrum (uPlot) from analyser readers |
| `src/js/charts/filter-chart.js#createFilterChart` | the browser's own biquad response, with a draggable cutoff |
| `src/js/charts/envelope-graph.js#createEnvelopeGraph` | the ADSR envelope |
| `src/js/charts/additive-chart.js#createAdditiveChart` | additive harmonic levels |
| `src/js/charts/bio-chart.js#createBioChart` | the cited hearing ranges |
| `src/js/charts/measure-charts.js#createResponseChart` | the MEASURE frequency response with its valid range |
| `src/js/visualization/p5-host.js#createP5Host` | the p5 views (waveform, harmonics, phase) |

Theme colours, fonts and axes come from `src/js/charts/chart-theme.js#chartTheme` and
`src/js/charts/chart-theme.js#uplotAxis`, sizes from
`src/js/charts/chart-theme.js#observeSize`, and ticks and log mapping from `src/js/charts/axes.js`
(tested by `tests/unit/charts.test.mjs`). A chart computes nothing it does not show from its
input, and it labels what a level is: the spectrum axis says
`src/js/charts/spectrum-chart.js#SPECTRUM_Y_LABEL` ("RELATIVE LEVEL (dBFS-like, uncalibrated)").
Charts keep OSCILLA's own visual language (rule `project.visual-identity-lock`).

## Add a browser check

Every browser suite runs through `tests/browser/lib/suite.cjs` (rule `project.suite-harness`),
and every wait is a condition poll with a named wall-clock deadline from
`tests/browser/lib/wait.cjs` (rule `project.bounded-test-timing`). The harness refuses an unknown
browser list, fails a browser that ran no check, and fails a skip that `tests/README.md` does not
declare when run under CI.

<!-- extending-guide:example browser-suite -->
```js
// tests/browser/my-check.cjs (a new entry suite)
'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { until } = require('./lib/wait.cjs');

const RUN = suite.open({ name: 'my-check' });
const DIST = pathToFileURL(path.join(__dirname, '..', '..', 'dist', 'index.html')).href;

(async () => {
  await RUN.ready(); // the load gate, before any browser starts
  let failures = 0;
  for (const name of RUN.browsers) {
    const browser = await RUN.playwright[name].launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${DIST}#m=studio`, { waitUntil: 'load' });
      let ok = true;
      try {
        await until(() => page.evaluate(() => !document.getElementById('osc-view-studio').hidden),
          { ms: 10000, what: 'Studio is shown at #m=studio' });
      } catch (error) {
        ok = false;
        console.log(`  ${error.message}`);
      }
      RUN.tally(name);
      console.log(`  ${ok ? 'PASS' : 'FAIL'} [${name}] #m=studio opens Studio`);
      if (!ok) failures += 1;
    } finally {
      await browser.close();
    }
  }
  process.exitCode = failures ? 1 : 0;
})();
```

The exports it uses are `tests/browser/lib/suite.cjs#open` and `tests/browser/lib/wait.cjs#until`
(`tests/browser/lib/wait.cjs#bounded` bounds a single promise). This example takes its engines
from `OSC_BROWSERS` (all three by default); a suite that also reads `--browsers` passes it to
`open` as `browsers`, as `tests/browser/navigation.cjs` does. Build first (`npm run build`),
then run one suite, narrowed to one engine while you work:

```bash
node tests/browser/navigation.cjs --browsers chromium
OSC_BROWSERS=chromium,firefox npm run test:studio
```

Outside CI a suite first waits for the machine's load to fall (`OSC_LOAD_MAX`,
`OSC_LOAD_WAIT_MS`; see [tests/README.md](../tests/README.md)). Add the new suite to a
`package.json` script that the release gate runs and give it a row in `tests/README.md`;
`tests/unit/browser-suite-contract.test.mjs` holds every entry suite to the harness.

## The single-file build

`npm run build` (`scripts/build.mjs`) bundles `src/` with esbuild and packs it, with the pinned
vendor files, into one `dist/index.html` (`scripts/pack-single-file.mjs`). The same file opens from
`file://`, from the Pages sub-path and from GitHub Pages. That constrains every change:

- **Nothing is loaded at runtime.** `scripts/verify-dist.mjs` (`npm run verify-dist`) fails a build
  whose page references a local or remote resource, a module or external script, or whose code
  uses `fetch`, `XMLHttpRequest`, dynamic `import()`, a worker or worklet loaded from a path,
  `WebSocket`, `sendBeacon` or `localhost`. Data ships inside the bundle.
- **One live AudioContext.** `src/js/audio/audio-engine.js#AudioEngine` creates it, and Web Audio
  nodes are created only by the engine or by builders it invokes with its accounting (rule
  `project.audio-engine-discipline`): no second context, no node outside `track()`. Offline
  renders go through `src/js/audio/offline-renderer.js#render`. Requested frequencies stay below
  0.95 x Nyquist, and stop leaves zero active nodes.
- **Commit `dist/` with the source.** The page embeds a digest of its build inputs, so
  `npm run build:check` fails a stale `dist/index.html`.
- **A dependency is pinned and embedded unmodified.** `scripts/verify-dist.mjs` checks each vendor
  script byte for byte against its package and requires its licence notice; the size budget
  applies to the whole file.

The reasons are ADR [0011](../.ai/repo/adrs/0011-modular-source-one-committed-dist.md) and rule
[`project.single-file-deliverable`](../.ai/repo/rules/project/single-file-deliverable.v2.md).

## The rules a change satisfies

The project rules live in [`.ai/repo/rules/project/`](../.ai/repo/rules/project/README.md); each
names the check that enforces it. The ones an extension meets most often:

| Rule | What it asks of you |
| --- | --- |
| [`project.no-fake-science`](../.ai/repo/rules/project/no-fake-science.v2.md) | no approximation shown as measurement; relative is not calibrated; no dB SPL without a level calibration |
| [`project.audio-engine-discipline`](../.ai/repo/rules/project/audio-engine-discipline.v2.md) | nodes only through the engine's accounting, timing on the audio clock, click-free envelopes |
| [`project.typed-ports`](../.ai/repo/rules/project/typed-ports.v1.md) | every port has a type and a role; every refused connection has a readable reason |
| [`project.no-silent-feedback`](../.ai/repo/rules/project/no-silent-feedback.v1.md) | a cycle is refused with its path, never rerouted quietly |
| [`project.studio-model-is-canonical`](../.ai/repo/rules/project/studio-model-is-canonical.v1.md) | Studio state lives in the StudioModel; views only read it |
| [`project.no-inert-surfaces`](../.ai/repo/rules/project/no-inert-surfaces.v1.md) | no placeholder copy, no control without an effect |
| [`project.ui-uses-flowbite-pro`](../.ai/repo/rules/project/ui-uses-flowbite-pro.v1.md) | new UI on Flowbite Pro; the legacy interface never grows |
| [`project.visual-identity-lock`](../.ai/repo/rules/project/visual-identity-lock.v2.md) | the domain views keep OSCILLA's look |
| [`project.single-file-deliverable`](../.ai/repo/rules/project/single-file-deliverable.v2.md) | one self-contained `dist/index.html` |
| [`project.suite-harness`](../.ai/repo/rules/project/suite-harness.v1.md) and [`project.bounded-test-timing`](../.ai/repo/rules/project/bounded-test-timing.v2.md) | browser checks through the harness, with bounded waits |

Two rules judge the pull request itself:

- [`project.fail-first`](../.ai/repo/rules/project/fail-first.v1.md): a pull request titled `feat`
  or `fix` adds or changes a unit test that fails on the merge base and passes on the head, or its
  body carries `fail-first: n/a <reason>` on a line of its own. Check it locally with
  `node scripts/fail-first.mjs --title "feat(studio): ..."`.
- [`project.review-verdict`](../.ai/repo/rules/project/review-verdict.v1.md): a change under a
  guarded path (`src/js/audio/`, `src/js/analysis/`, `src/js/studio/`, `src/js/measurement/`,
  `src/js/experiments/`, `src/js/calibration/`, `.github/`, the build and release scripts and
  more; the list is `scripts/review-verdict.mjs#GUARDED`) needs a verdict in
  `.ai/repo/reviews/<pr>.yaml` written by a reviewer who did not build the change. List the
  guarded paths a branch changes with
  `node scripts/review-verdict.mjs --content --list --base origin/main`.

Claims about what OSCILLA does go in [docs/CLAIMS.yaml](CLAIMS.yaml) with the test that proves
them; a sentence in README or in the page that no test backs is the reviewer's to refuse. How work
is planned and landed (worktrees, plan issues, the release flow) is in [README.md](../README.md)
("Development", "Versioning and releases") and [docs/WORKTREES.md](WORKTREES.md).

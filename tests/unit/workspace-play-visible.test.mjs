// C030: a visible Play on every workspace that should sound, on desktop as on the phone. Every
// workspace whose Space has an owner (ui/shortcuts.js SPACE_OWNER) shows one Play control that
// no stylesheet hides at desktop width: the Source & Pattern panel's Hold to Play and Trigger
// where that panel is laid out (its data-osc-modes), the status bar's Play in the other
// instrument workspaces (Analyzer, Filter Lab, Compare, Presets), the Studio its transport's
// Play. And the prompts that name a control name one on that workspace, or name the workspace
// that has it. Fails on the merge base, where the status Play is display:none at every width
// above the phone breakpoint and those four workspaces show no Play at all.
//   node --test tests/unit/workspace-play-visible.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shortcuts from '../../src/js/ui/shortcuts.js';
import { createWorkbench } from '../../src/js/ui/workbench.js';
import { presetLoadedNotice } from '../../src/js/core/preset-notice.js';
import * as hints from '../../src/js/core/play-hints.js';
import { applyConfig } from '../../src/js/core/config.js';
import { restoreFromHash, serializeHash } from '../../src/js/core/url-state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const HTML = read('src/index.html');
const { SPACE_OWNER } = shortcuts;

/** The opening tag of the element whose attributes match `re`, and where it starts. */
function tagOf(re) {
  const m = HTML.match(new RegExp(`<[a-z]+\\b[^>]*${re.source}[^>]*>`));
  assert.ok(m, `no element matches ${re}`);
  return { tag: m[0], at: m.index };
}

/** The workspaces the Source & Pattern panel (Hold to Play, Trigger) is laid out in. */
function sourcePanel() {
  const { tag, at } = tagOf(/aria-labelledby="osc-source-title"/);
  const modes = tag.match(/data-osc-modes="([^"]+)"/)[1].split(/\s+/);
  const next = HTML.indexOf('data-osc-modes=', at + tag.length);
  const body = HTML.slice(at, next);
  return { modes, hold: body.includes('data-osc="source.hold"'),
    trigger: body.includes('data-osc="source.trigger"') };
}

/**
 * The rules outside any @media block whose selector names `cls` as a class and hide it
 * (display: none): what hides a control at desktop width. Comments are blanked first.
 */
function desktopHides(cls) {
  const out = [];
  const dir = path.join(ROOT, 'src', 'styles');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.css'))) {
    const css = readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    let start = 0;
    let media = 0; // the depth of an enclosing @media, 0 outside one
    for (let i = 0; i < css.length; i++) {
      if (css[i] === '{') {
        const head = css.slice(start, i).trim();
        depth++;
        if (/^@media\b/.test(head) && !media) media = depth;
        else if (!media && !head.startsWith('@')) {
          const end = css.indexOf('}', i);
          const body = css.slice(i + 1, end);
          const names = new RegExp(`\\.${cls}(?![\\w-])`);
          if (names.test(head) && /display\s*:\s*none/.test(body)) out.push(`${f}: ${head}`);
        }
        start = i + 1;
      } else if (css[i] === '}') {
        if (media === depth) media = 0;
        depth--;
        start = i + 1;
      }
    }
  }
  return out;
}

/** The status bar's Play button, and whether a workspace shows it at desktop width. */
function statusPlay() {
  const { tag } = tagOf(/data-osc="status\.play"/);
  const wb = createWorkbench({ engine: { analyser: { fftSize: 8192 } }, stopPlayback() {},
    sequencerPlaying: () => false });
  const get = Object.getOwnPropertyDescriptor(wb, 'statusPlayShown');
  // its class binding overrides the stylesheet's desktop display:none (Tailwind's important
  // utility), and only where the getter says so
  const bound = /:class="statusPlayShown && '!inline-flex[^']*'"/.test(tag);
  return { tag, shown: (workspace) => !!(bound && get && get.get
    && get.get.call({ workspace })) };
}

test('C030: every workspace whose Space has an owner shows one Play at desktop width', () => {
  const panel = sourcePanel();
  assert.ok(panel.hold && panel.trigger, 'the Source & Pattern panel carries Hold and Trigger');
  assert.deepEqual(desktopHides('osc-trigger'), [], 'nothing hides Trigger on a desktop');
  assert.deepEqual(desktopHides('osc-st-play'), [], 'nothing hides the Studio Play on a desktop');
  const sb = statusPlay();
  const missing = [];
  for (const [ws, owner] of Object.entries(SPACE_OWNER)) {
    if (!owner) continue;
    if (owner === 'studio') {
      const { at } = tagOf(/data-osc-modes="studio"/);
      const play = HTML.indexOf('data-osc="studio.play"', at);
      if (play < 0) missing.push(`${ws}: no Studio Play`);
      continue;
    }
    const plays = [panel.modes.includes(ws) && 'Hold/Trigger', sb.shown(ws) && 'status Play']
      .filter(Boolean);
    if (plays.length !== 1) missing.push(`${ws}: ${plays.length ? plays.join(' + ') : 'none'}`);
  }
  assert.deepEqual(missing, [], 'one visible Play per workspace (C030)');
  // the status Play's desktop display:none is the one rule it overrides
  assert.deepEqual(desktopHides('osc-sb-play'), ['instrument.css: .osc-sb-play']);
  for (const ws of Object.keys(SPACE_OWNER).filter((w) => !SPACE_OWNER[w])) {
    assert.equal(sb.shown(ws), false, `${ws}: Space starts nothing there, so no status Play`);
  }
});

test('C030: the workspaces of the two Plays are one list each, matched to the markup', () => {
  const { SOURCE_PANEL_WORKSPACES, STATUS_PLAY_WORKSPACES } = shortcuts;
  assert.deepEqual(SOURCE_PANEL_WORKSPACES, sourcePanel().modes,
    'shortcuts.js names the panel\'s data-osc-modes');
  assert.deepEqual([...STATUS_PLAY_WORKSPACES].sort(),
    ['analyzer', 'compare', 'filter', 'presets']);
  // the one list (core/play-hints.js) is the instrument's workspaces outside the panel's
  const derived = Object.keys(SPACE_OWNER).filter((w) => SPACE_OWNER[w] === 'instrument'
    && !SOURCE_PANEL_WORKSPACES.includes(w));
  assert.deepEqual([...STATUS_PLAY_WORKSPACES], derived);
  assert.equal(STATUS_PLAY_WORKSPACES, hints.STATUS_PLAY_WORKSPACES, 'shortcuts.js re-exports it');
  const sb = statusPlay();
  for (const ws of Object.keys(SPACE_OWNER)) {
    assert.equal(sb.shown(ws), STATUS_PLAY_WORKSPACES.includes(ws), ws);
  }
});

test('C030: a prompt names a control on its workspace, or the workspace that has it', () => {
  const panel = sourcePanel().modes;
  const sb = statusPlay();
  const NAMES = /TRIGGER|HOLD TO PLAY/;
  const OTHER = { playground: /in the Playground/, synthesis: /in Synthesis/ };
  // a preset loaded in each workspace that lists presets (the panel of each Load button)
  const loaders = new Set();
  for (const m of HTML.matchAll(/loadPresetFromView\(/g)) {
    const before = [...HTML.slice(0, m.index).matchAll(/data-osc-modes="([^"]+)"/g)].at(-1);
    for (const ws of before[1].split(/\s+/)) loaders.add(ws);
  }
  assert.ok(loaders.has('presets'), [...loaders].join(' '));
  for (const ws of loaders) {
    for (const programmed of [true, false]) {
      for (const coarse of [false, true]) {
        const n = presetLoadedNotice(ws, programmed, 'single', coarse);
        if (!NAMES.test(n.message)) continue;
        const named = panel.includes(ws) || Object.values(OTHER).some((re) => re.test(n.message)
          || (n.action && /^#m=(playground|synthesis)$/.test(n.action.href)));
        assert.ok(named, `${ws}: "${n.message}" names a control not on screen`);
      }
    }
    // Space is the instrument's there, and a Play is on screen beside it
    assert.ok(panel.includes(ws) || sb.shown(ws), ws);
  }
  // a Learn demo plays in the workspace it opens, which lays out Hold and Trigger
  const wbSrc = read('src/js/ui/workbench.js');
  const go = wbSrc.match(new RegExp('runLearnDemo\\(topic\\) \\{[\\s\\S]*?this\\.setWorkspace\\('
    + "this\\.source === 'dual'\\s*\\? '(\\w+)' : '(\\w+)'\\)"));
  assert.ok(go, 'runLearnDemo opens the workspace that plays the demo');
  for (const ws of [go[1], go[2]]) assert.ok(panel.includes(ws), ws);
});

// The frozen V1 prompts (tests/unit/freeze.test.mjs) name HOLD TO PLAY and TRIGGER. Where only
// the status Play is on screen each is replaced, by workspace, with a Czech sentence of its own
// (core/play-hints.js) that names the Play there; the V1 text stays everywhere else.
const STATUS_PLAY_NAMED = /Přehrát ve stavovém řádku/;

test('C030: where only the status Play is on screen, each prompt names it, in Czech', () => {
  const { statusPlayHint, STATUS_PLAY_HINTS } = hints;
  assert.ok(statusPlayHint, 'core/play-hints.js statusPlayHint');
  const panel = sourcePanel().modes;
  const sb = statusPlay();
  for (const ws of Object.keys(SPACE_OWNER)) {
    for (const kind of Object.keys(STATUS_PLAY_HINTS)) {
      const h = statusPlayHint(ws, kind);
      if (sb.shown(ws)) {
        assert.match(h, STATUS_PLAY_NAMED, `${ws}/${kind}: names the status Play`);
        assert.doesNotMatch(h, /TRIGGER|HOLD TO PLAY/, `${ws}/${kind}`);
      } else {
        assert.equal(h, null, `${ws}/${kind}: the frozen V1 text stands`);
        if (SPACE_OWNER[ws] === 'instrument') assert.ok(panel.includes(ws), ws);
      }
    }
  }
});

test('C030: a restored link says what to press in the workspace it opens', () => {
  const state = applyConfig(null, {}, { sampleRate: 48000 }).state;
  const said = (ws) => restoreFromHash(null, `#${serializeHash(state, ws)}`,
    { sampleRate: 48000 }).notices.find((n) => /restored from link|obnoveno z odkazu/
    .test(n.title));
  assert.deepEqual([said('playground').title, said('playground').message],
    ['Configuration restored from link', 'Nothing plays until you press HOLD TO PLAY or TRIGGER.'],
    'the frozen V1 text');
  for (const ws of hints.STATUS_PLAY_WORKSPACES) {
    // one language per notice (R2-C030-3): the Czech sentence under a Czech title
    assert.deepEqual([said(ws).title, said(ws).message], [hints.STATUS_PLAY_TITLES.restored,
      hints.STATUS_PLAY_HINTS.restored], ws);
  }
});

test('C030: the suspended notice and the idle scope read the hint of the workspace', () => {
  const inst = read('src/js/core/instrument.js');
  assert.match(inst, new RegExp("const hint = statusPlayHint\\(this\\.workspace, 'suspended'\\);"
    + "\\s*this\\.notify\\('warning', statusPlayTitle\\(this\\.workspace, 'suspended'\\)"
    + "\\s*\\|\\| 'Audio is suspended', hint\\s*\\|\\| 'The browser"));
  // the scope the analysis tabs show (ui/p5-views.js), drawn and described (R2-C030-1)
  assert.match(read('src/js/ui/p5-views.js'),
    /const press = st\.idleHint \|\| 'živý průběh: podržte Hold to Play';/);
  assert.match(read('src/js/ui/workbench.js'),
    /statusPlayHint\(this\.workspace, 'scope'\)[^|]*\|\| 'Živý průběh analyzátoru výstupu ukáže Hold to Play/);
  assert.match(read('src/js/main.js'),
    /bridge\.setIdleHint\(statusPlayHint\(cmp\.workspace, 'idle'\)\)/);
});

test('C030: the status Play is announced by the word the prompts name it by', () => {
  const { tag } = tagOf(/data-osc="status\.play"/);
  assert.match(tag, /\saria-label="Přehrát"/);
  assert.match(tag, /:aria-label="statusPlayName" :title="statusPlayName"/);
  const wb = createWorkbench({ engine: { analyser: { fftSize: 8192 } }, stopPlayback() {},
    sequencerPlaying: () => false });
  const get = Object.getOwnPropertyDescriptor(wb, 'statusPlayName').get;
  const name = (o) => get.call({ isSounding: false, continuousAllowed: false,
    isProgrammed: false, ...o });
  assert.equal(name({}), 'Přehrát');
  assert.equal(name({ continuousAllowed: true }), 'Přehrát nepřetržitě');
  assert.equal(name({ continuousAllowed: true, isProgrammed: true }), 'Přehrát');
  assert.equal(name({ isSounding: true }), 'Zastavit přehrávání');
  for (const kind of Object.keys(hints.STATUS_PLAY_HINTS)) {
    assert.match(hints.STATUS_PLAY_HINTS[kind], /Přehrát/, `${kind} names it as announced`);
  }
});

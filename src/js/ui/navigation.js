// Workspace navigation: the URL hash names the workspace, every workspace switch is a history
// entry, and ONE hash dispatcher hands a link to the domains that read it (ADR 0045). Composed
// into the ONE OSCILLA component by main.js (Object.defineProperties, never spread), like
// measure.js; its state lives in the closure `nav`, never in reactive state.
//
// The hash is shared by three codecs, each reading only its own keys: the instrument
// (core/url-state.js: v s p w f g d a r rm x, and V1 mode ids in `m`), the MEASURE recipe
// (core/url-state-measure.js: mr) and the Studio link (core/url-state-studio.js: m=studio, st,
// sv). `m` names the workspace: any workspace id (`m=measure`, `m=analyzer`, …) or, as V1 links
// wrote it, a V1 mode id (`sweep` → Playground, `dual` → Synthesis).
//
// Route precedence (routeOfHash, the one place a hash becomes a workspace and a V1 mode):
//   1. Studio keys: m=studio, st or sv               → STUDIO (owner: studio)
//   2. m = a workspace id or a V1 mode id            → that workspace (owner: workspace)
//   3. mr (a recipe link without m)                  → MEASURE (owner: measure)
//   4. none of these (an empty hash, bare `v=1&f=…`) → PLAYGROUND
//   An in-page anchor (`#osc-main`, no `=`) is not a route. The V1 mode follows from the
//   workspace and the source (v1ModeFor), so `mode` and `workspace` cannot disagree.
// A domain applies its own keys whatever the route: `#m=studio&mr=…` opens STUDIO and still
// loads the recipe into the MEASURE setup (and says so). A link whose route owner refuses it
// (an invalid Studio link, an invalid recipe link without m) changes no workspace.
//
// Three origins reach the dispatcher:
//   load       the page opened at a hash: every domain applies its keys, then the route.
//   link       a new hash in this page (typed, pasted, a link clicked): the same, then the
//              entry is stamped as OSCILLA's own.
//   history    Back / Forward to an entry OSCILLA stamped: the workspace only. No domain
//              re-applies its keys, so the state each workspace holds is kept, and focus moves
//              to the workspace heading (nothing else is announced).
// A same-document traversal never fires beforeunload, so Back and Forward between workspaces
// never meet the unsaved-work guard (ui/unsaved.js); only leaving the page does.
//
//   routeOfHash(hash) -> { workspace, owner } | null
//   navigationStateOf(hash, source) -> { workspace, owner, mode } | null
//   hashForWorkspace(hash, workspace) -> string        (m set; Studio keys out off STUDIO)
//   configLinkHash(hash, instrumentHash, workspace) -> string
//                                                      (Copy config URL: other keys kept)

import { APP_MODES } from '../core/constants.js';
import { STUDIO_LINK_KEYS, STUDIO_LINK_MODE } from '../core/url-state-studio.js';
import { RECIPE_HASH_KEY } from '../core/url-state-measure.js';
import { WORKSPACES } from './app.js';

export const ROUTE_KEY = 'm';
export const DEFAULT_WORKSPACE = 'playground';
/** The domains that read the hash, in the order the dispatcher applies them. */
export const HASH_DOMAINS = Object.freeze(['instrument', 'measure', 'studio']);
/** The instrument codec's own keys (core/url-state.js serializeHash), `m` excepted. */
export const INSTRUMENT_HASH_KEYS = Object.freeze(['v', 's', 'p', 'w', 'f', 'g', 'd', 'a', 'r',
  'rm', 'x']);
/** history.state of an entry OSCILLA wrote or already dispatched. */
export const HISTORY_STAMP = Object.freeze({ oscilla: 'workspace' });

const V1_MODE_IDS = APP_MODES.map((m) => m.id);
const strip = (hash) => String(hash || '').replace(/^#/, '');

function paramsOf(hash) {
  try {
    return new URLSearchParams(strip(hash));
  } catch (e) {
    return new URLSearchParams();
  }
}

/** workspace + source -> V1 mode id (URL `m`, presets, Learn/Presets panels). */
export function v1ModeFor(workspace, source) {
  if (workspace === 'presets' || workspace === 'learn') return workspace;
  if (source === 'dual') return 'dual';
  if (source === 'sweep') return 'sweep';
  return 'playground';
}

/** V1 mode id (URL `m`) -> workspace. */
export function workspaceForV1Mode(mode) {
  return { dual: 'synthesis', presets: 'presets', learn: 'learn' }[mode] || 'playground';
}

/** True for an in-page anchor (`#osc-main`): a fragment without parameters is not state. */
export function isAnchorHash(hash) {
  const h = strip(hash);
  return h !== '' && !h.includes('=');
}

/** The workspace a hash names and the domain that owns that choice (see the header). */
export function routeOfHash(hash) {
  if (isAnchorHash(hash)) return null;
  const q = paramsOf(hash);
  const K = STUDIO_LINK_KEYS;
  const modes = q.getAll(ROUTE_KEY);
  if (modes.includes(STUDIO_LINK_MODE) || q.has(K.template) || q.has(K.subview)) {
    return { workspace: 'studio', owner: 'studio' };
  }
  if (modes.length > 1) return null; // ambiguous: no workspace is named
  const m = modes[0];
  if (m !== undefined && WORKSPACES.includes(m)) return { workspace: m, owner: 'workspace' };
  if (m !== undefined && V1_MODE_IDS.includes(m)) {
    return { workspace: workspaceForV1Mode(m), owner: 'workspace' };
  }
  if (q.has(RECIPE_HASH_KEY)) return { workspace: 'measure', owner: 'measure' };
  return { workspace: DEFAULT_WORKSPACE, owner: null };
}

/** The route of a hash with the V1 mode it gives for `source` (the instrument's, after load). */
export function navigationStateOf(hash, source) {
  const r = routeOfHash(hash);
  return r ? { ...r, mode: v1ModeFor(r.workspace, source) } : null;
}

/** The hash (without '#') naming `workspace`; the Studio keys leave with STUDIO. */
export function hashForWorkspace(hash, workspace) {
  const q = isAnchorHash(hash) ? new URLSearchParams() : paramsOf(hash);
  if (workspace !== STUDIO_LINK_MODE) {
    q.delete(STUDIO_LINK_KEYS.template);
    q.delete(STUDIO_LINK_KEYS.subview);
  }
  q.set(ROUTE_KEY, workspace);
  return q.toString();
}

/**
 * Copy config URL: the instrument's keys from `instrumentHash` (url-state.js serializeHash)
 * replace the instrument keys of `hash`; every other key (mr, the Studio keys, anything else)
 * is kept, and `m` names the workspace, so the link and the address bar reopen where the user
 * is (a V1 mode id there would land MEASURE or STUDIO in the Playground).
 */
export function configLinkHash(hash, instrumentHash, workspace) {
  const out = paramsOf(instrumentHash);
  const rest = isAnchorHash(hash) ? new URLSearchParams() : paramsOf(hash);
  for (const [k, v] of rest) {
    if (k !== ROUTE_KEY && !INSTRUMENT_HASH_KEYS.includes(k)) out.append(k, v);
  }
  return hashForWorkspace(out.toString(), workspace);
}

/**
 * The component part. svc.win: the window (default: the global one). The domains register
 * their hash appliers with navRegister(name, fn(hash, origin) -> true | false | null) before
 * navStart(); false means the domain refused its keys.
 */
export function createNavigation(svc = {}) {
  const nav = {
    cmp: null,
    domains: new Map(),
    started: false,
    pendingPop: null,      // the href a popstate just handled (its hashchange is the same event)
    selfWrite: null,       // a hash assigned through location.hash when pushState threw
    routed: { href: null, workspace: null }, // what the address names, as the router left it
    lastStateHash: '',     // the last hash that was state, not an anchor
    traversals: 0,
  };
  const win = () => svc.win || window;
  const loc = () => win().location;
  const base = () => loc().href.split('#')[0];

  function write(hash, how) {
    const url = hash ? `${base()}#${hash}` : base();
    try {
      win().history[how === 'push' ? 'pushState' : 'replaceState'](HISTORY_STAMP, '', url);
    } catch (e) {
      // A browser refusing history state here (file:// in old engines): a plain fragment
      // navigation still makes the entry; the dispatcher knows it as its own write.
      if (how !== 'push') return;
      nav.selfWrite = hash;
      loc().hash = hash;
    }
    nav.routed = { href: loc().href, workspace: nav.cmp.workspace };
    nav.lastStateHash = hash;
  }

  function stamped() {
    const s = win().history.state;
    return !!s && typeof s === 'object' && s.oscilla === HISTORY_STAMP.oscilla;
  }

  function dispatch(hash, origin) {
    const results = {};
    for (const name of HASH_DOMAINS) {
      const fn = nav.domains.get(name);
      if (!fn) continue;
      try {
        results[name] = fn(hash, origin);
      } catch (e) {
        console.error(`OSCILLA: the ${name} link could not be applied:`, e);
        results[name] = false;
      }
    }
    return results;
  }

  function route(hash, origin, results) {
    const cmp = nav.cmp;
    const st = routeOfHash(hash);
    if (st && !(st.owner && results[st.owner] === false) && st.workspace !== cmp.workspace) {
      if (origin === 'load') cmp.workspace = st.workspace;
      else cmp.setWorkspace(st.workspace, { focusHeading: true });
    }
    cmp.mode = v1ModeFor(cmp.workspace, cmp.source);
    nav.routed = { href: loc().href, workspace: cmp.workspace };
    if (!isAnchorHash(hash)) nav.lastStateHash = strip(hash);
  }

  function onNavigate() {
    const hash = loc().hash;
    if (isAnchorHash(hash)) {
      // An in-page link (the skip link): the browser has moved to its target; the address
      // keeps naming the state so a reload still opens this workspace.
      write(nav.lastStateHash, 'replace');
      return;
    }
    const own = nav.selfWrite !== null && strip(hash) === nav.selfWrite;
    nav.selfWrite = null;
    if (own) {
      nav.routed = { href: loc().href, workspace: nav.cmp.workspace };
      return;
    }
    if (stamped()) {
      nav.traversals += 1;
      route(hash, 'history', {});
      return;
    }
    route(hash, 'link', dispatch(hash, 'link'));
    write(strip(hash), 'replace'); // a later Back / Forward to it is a traversal
  }

  return {
    /** Register a domain's hash applier (HASH_DOMAINS names the order they run in). */
    navRegister(name, fn) {
      if (!HASH_DOMAINS.includes(name)) throw new Error(`unknown hash domain "${name}"`);
      nav.domains.set(name, fn);
    },

    /**
     * Apply the hash the page opened at, then follow the address: Back / Forward, new links,
     * and every workspace change (one history entry each).
     */
    navStart() {
      if (nav.started) return;
      nav.started = true;
      nav.cmp = this;
      const w = win();
      const hash = loc().hash;
      if (!isAnchorHash(hash)) route(hash, 'load', dispatch(hash, 'load'));
      else route('', 'load', {});
      try {
        w.history.replaceState(HISTORY_STAMP, '', loc().href);
      } catch (e) { /* the entry stays unstamped: Back to it re-applies its link */ }
      nav.routed = { href: loc().href, workspace: this.workspace };
      w.addEventListener('popstate', () => {
        nav.pendingPop = loc().href;
        onNavigate();
      });
      w.addEventListener('hashchange', () => {
        const same = nav.pendingPop === loc().href;
        nav.pendingPop = null;
        if (!same) onNavigate();
      });
      this.$watch('workspace', (ws) => {
        if (nav.routed.href === loc().href && nav.routed.workspace === ws) return;
        write(hashForWorkspace(loc().hash, ws), 'push');
      });
    },

    /** Copy config URL's hash (instrument.js copyConfigLink): the other domains' keys kept. */
    configLinkHash() {
      return configLinkHash(loc().hash, this.serializeHash(), this.workspace);
    },

    /** Test seam (window.OSCILLA.navigation). */
    navTestSeam() {
      return {
        get domains() { return [...nav.domains.keys()]; },
        get routed() { return { ...nav.routed }; },
        get traversals() { return nav.traversals; },
        stamped,
      };
    },
  };
}

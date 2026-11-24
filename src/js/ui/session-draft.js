// The session draft (plan U138, journey J9 of docs/reconstruction/03b-journeys.md): a reload of
// the tab gives back the instrument, the lab settings, the Synth patch and the Pattern Sequencer
// document the user was working on. Each domain is kept as the string or document its own codec
// already writes, and is given back through that codec's validated apply path:
//
//   instrument  the `#v=1` hash without `m` (core/url-state.js serializeHash / restoreFromHashOn)
//   labs        the `lab=` value (core/url-state-labs.js, ui/lab-state.js applyLabRecord)
//   synth       the Synth link (core/url-state-synth.js, synth/ui.js synthApplyLinkHash)
//   sequence    the config file's `sequencer` section (sequencer/model.js serializeSequence,
//               the editor's load)
//
// Rules:
//   - Only a reload or Back / Forward into the page restores (Navigation Timing's type). A page
//     opened any other way, a deep link included, starts from its own address and forgets the
//     draft: the link's state wins.
//   - On a reload, a domain whose keys the address carries keeps the address's state unless the
//     draft was saved under that same address (then the draft is the later edit of it).
//   - A domain whose draft equals what the page already holds is not restored, and not named.
//   - Nothing plays: no codec carries a playing state, a measurement is never in the draft
//     (project.no-fake-science), and sound starts only on a gesture (project.a-phone-sounds).
//   - The draft is written debounced after an edit and at once when the page is hidden, only
//     with the domains that differ from what the page opened with, so an untouched page keeps
//     no draft. Storage: core/storage.js persistSessionDraft (sessionStorage, size-bounded).
//
//   createSessionDraftUi({ sequencer, store, win }) -> the Alpine part: draft (state),
//     draftBoot() after the labs mount, draftSave(), draftReset() ('Začít znovu'), draftClose()

import { WAVEFORM_NAMES } from '../core/constants.js';
import { formatFrequency } from '../core/frequency.js';
import { decodeHash, restoreFromHashOn } from '../core/url-state.js';
import { LAB_HASH_KEY, decodeLabParam } from '../core/url-state-labs.js';
import { SYNTH_LINK_KEYS, encodeSynthLink } from '../core/url-state-synth.js';
import {
  clearSessionDraft, loadSessionDraft, persistSessionDraft, sessionStore,
} from '../core/storage.js';
import { serializeSequence } from '../sequencer/model.js';

export const DRAFT_DOMAINS = Object.freeze(['instrument', 'labs', 'synth', 'sequence']);
/** The navigation types that give the draft back (Navigation Timing 2). */
export const RESTORING_NAVIGATIONS = Object.freeze(['reload', 'back_forward']);
/** The quiet time after an edit before the draft is written. */
export const DRAFT_SAVE_MS = 400;
/** The Synth link of an untouched panel: no patch worth keeping. */
export const PRISTINE_SYNTH = encodeSynthLink({ preset: 'init' });

const strip = (h) => String(h || '').replace(/^#/, '');

/** How the page was reached: 'reload', 'back_forward', 'navigate' or 'prerender'. */
export function navigationType(win) {
  try {
    const p = win.performance;
    const entry = p.getEntriesByType && p.getEntriesByType('navigation')[0];
    if (entry && entry.type) return entry.type;
    const legacy = p.navigation ? p.navigation.type : 0;
    return legacy === 1 ? 'reload' : legacy === 2 ? 'back_forward' : 'navigate';
  } catch (e) {
    return 'navigate';
  }
}

/** The domains whose state a hash carries (sequence: never, a link holds no sequence). */
export function hashCarries(hash) {
  let q;
  try { q = new URLSearchParams(strip(hash)); } catch (e) { return new Set(); }
  const out = new Set();
  if (q.has('v') || q.has('f')) out.add('instrument');
  if (q.has(LAB_HASH_KEY)) out.add('labs');
  if (Object.values(SYNTH_LINK_KEYS).some((k) => q.has(k))) out.add('synth');
  return out;
}

/** A domain's value as compared: the sequence without its waveform (the instrument's, C004). */
export function comparable(domain, value) {
  if (value == null) return null;
  if (domain !== 'sequence') return String(value);
  const { waveform, ...rest } = value;
  return JSON.stringify(rest);
}

/**
 * The domains of `draft` a page reached by `navType` at `hash` restores, given what it holds
 * now (`current`, one value per domain): the rules of this module's header.
 */
export function planRestore({ draft, navType, hash, current }) {
  if (!draft || !RESTORING_NAVIGATIONS.includes(navType)) return [];
  const carried = hashCarries(hash);
  const sameAddress = strip(hash) === strip(draft.hash);
  return DRAFT_DOMAINS.filter((k) => draft.domains[k] != null
    && !(carried.has(k) && !sameAddress)
    && comparable(k, draft.domains[k]) !== comparable(k, current[k]));
}

/** The domains of `now` that differ from `baseline`: what the draft keeps. */
export function draftDomains(now, baseline) {
  const out = {};
  for (const k of DRAFT_DOMAINS) {
    if (now[k] != null && comparable(k, now[k]) !== comparable(k, baseline[k])) out[k] = now[k];
  }
  return out;
}

const LAB_NAMES = Object.freeze({ filter: 'filtr', envelope: 'obálka',
  additive: 'aditivní syntéza', phaseStereo: 'fáze a stereo' });
const blocksWord = (n) => (n === 1 ? 'blok' : n >= 2 && n <= 4 ? 'bloky' : 'bloků');

/** "nástroj (Pila, 220 Hz)" and the like: one domain as the notice names it. */
export function domainText(domain, value, { presets = [], labs = [] } = {}) {
  if (domain === 'instrument') {
    const d = (() => { try { return decodeHash(value); } catch (e) { return null; } })();
    const c = d ? d.cfg : {};
    const wave = WAVEFORM_NAMES[c.waveform];
    return wave ? `nástroj (${wave}, ${formatFrequency(c.frequency)})` : 'nástroj';
  }
  if (domain === 'labs') {
    const names = labs.map((k) => LAB_NAMES[k]).filter(Boolean);
    return names.length ? `laboratoře (${names.join(', ')})` : 'laboratoře';
  }
  if (domain === 'synth') {
    const id = new URLSearchParams(strip(value)).get(SYNTH_LINK_KEYS.preset);
    const p = presets.find((x) => x.id === id);
    return p ? `Synth (předvolba ${p.title.split(':')[0]})` : 'Synth';
  }
  const n = Array.isArray(value.blocks) ? value.blocks.length : 0;
  return `sekvence (${n} ${blocksWord(n)})`;
}

/** The recovery notice's sentence for the restored parts (Czech, project.czech-prose). */
export function draftNoticeText(parts) {
  const list = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} a ${parts[parts.length - 1]}` : parts[0];
  return `Po opětovném načtení stránky je zpět vaše rozpracovaná práce: ${list}. Nic nehraje, `
    + 'dokud sami nezačnete hrát.';
}

/** The lab sections of `a` that differ from `b` (two `lab=` values). */
function labsChanged(a, b) {
  const da = decodeLabParam(`${LAB_HASH_KEY}=${a}`);
  const db = b ? decodeLabParam(`${LAB_HASH_KEY}=${b}`) : null;
  if (!da || !da.ok) return [];
  const sb = db && db.ok ? db.sections : {};
  return Object.keys(LAB_NAMES).filter((k) => da.sections[k]
    && JSON.stringify(da.sections[k]) !== JSON.stringify(sb[k]));
}

export function createSessionDraftUi({ sequencer = () => null, store = sessionStore,
  win = globalThis.window } = {}) {
  let baseline = null;
  let timer = null;
  let ready = false;

  /** What the page holds now, one codec value per domain (null: nothing to keep). */
  const read = (cmp) => {
    const seq = sequencer();
    const synth = typeof cmp.synthLinkHash === 'function' ? cmp.synthLinkHash() : null;
    const q = new URLSearchParams(cmp.serializeHash());
    q.delete('m'); // the route is the address's, not the instrument's
    return {
      instrument: q.toString(),
      labs: typeof cmp.labLinkParam === 'function' ? cmp.labLinkParam() : null,
      synth: synth && synth !== PRISTINE_SYNTH ? synth : null,
      sequence: seq ? serializeSequence(seq.editor.model) : null,
    };
  };

  /** Each domain's apply path: true when the value was applied. */
  const APPLY = {
    instrument(cmp, value) {
      const r = restoreFromHashOn(cmp, value, { sampleRate: cmp.sampleRate,
        continuousAllowed: cmp.continuousAllowed });
      if (r.pendingHashConfig) cmp.pendingHashConfig = r.pendingHashConfig;
      // What was refused or limited is said; the closing "restored from link" sentence (the
      // last notice when nothing was refused) is the recovery notice's.
      const said = r.issues || r.malformed ? r.notices : r.notices.slice(0, -1);
      for (const n of said) cmp.notify(n.level, n.title, n.message);
      return r.handled && !r.malformed;
    },
    labs(cmp, value) {
      const d = decodeLabParam(`${LAB_HASH_KEY}=${value}`);
      if (!d || !d.ok) return false;
      return cmp.applyLabSnapshot(d.sections).applied.length > 0;
    },
    synth(cmp, value) {
      return typeof cmp.synthApplyLinkHash === 'function'
        && cmp.synthApplyLinkHash(value, true) === true;
    },
    sequence(cmp, value) {
      const seq = sequencer();
      if (!seq) return false;
      seq.editor.load(value);
      seq.editor.setWaveform(cmp.waveform); // the instrument owns the waveform (C004)
      seq.render();
      return true;
    },
  };

  return {
    /** shown/text: the recovery notice; restored: its domains; savedAt/kept: the last write. */
    draft: { shown: false, text: '', restored: [], savedAt: 0, kept: [] },

    /** Once, after the labs mount: restore what the draft holds, then follow the edits. */
    draftBoot() {
      if (baseline) return [];
      const nav = navigationType(win);
      const hash = win.location.hash;
      baseline = read(this);
      const stored = loadSessionDraft(store);
      const plan = planRestore({ draft: stored, navType: nav, hash, current: baseline });
      if (!RESTORING_NAVIGATIONS.includes(nav)) clearSessionDraft(store);
      const done = plan.filter((k) => APPLY[k](this, stored.domains[k]));
      if (done.length) {
        const presets = (this.synth && this.synth.presets) || [];
        this.draft.restored = done;
        this.draft.text = draftNoticeText(done.map((k) => domainText(k, stored.domains[k],
          { presets, labs: k === 'labs' ? labsChanged(stored.domains.labs, baseline.labs) : [] })));
        this.draft.shown = true;
      }
      ready = true;
      const doc = win.document;
      const later = () => {
        if (timer) win.clearTimeout(timer);
        timer = win.setTimeout(() => this.draftSave(), DRAFT_SAVE_MS);
      };
      for (const type of ['input', 'change', 'click', 'keyup']) {
        doc.addEventListener(type, later, { capture: true, passive: true });
      }
      win.addEventListener('pagehide', () => this.draftSave());
      doc.addEventListener('visibilitychange', () => { if (doc.hidden) this.draftSave(); });
      const seq = sequencer();
      if (seq) seq.editor.onChange(later);
      return done;
    },

    /** Write the draft now: the domains that differ from what the page opened with. */
    draftSave() {
      if (!ready) return null;
      if (timer) win.clearTimeout(timer);
      timer = null;
      const r = persistSessionDraft(store, { at: Date.now(), hash: win.location.hash,
        domains: draftDomains(read(this), baseline) });
      this.draft.savedAt = Date.now();
      this.draft.kept = r.kept;
      return r;
    },

    /** 'Začít znovu': the restored domains go back to what the page opened with; no draft. */
    draftReset() {
      for (const k of this.draft.restored) {
        const v = k === 'synth' ? baseline.synth || PRISTINE_SYNTH : baseline[k];
        if (v != null) APPLY[k](this, v);
      }
      clearSessionDraft(store);
      this.draftClose();
    },

    draftClose() {
      this.draft.shown = false;
      this.draft.restored = [];
    },
  };
}

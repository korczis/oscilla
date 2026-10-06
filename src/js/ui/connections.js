// CONNECTED RECORDS (ADR 0048): the DOM/Alpine adapter over experiments/connections.js.
// Composed into the ONE OSCILLA component by main.js, next to ui/experiments.js and
// ui/findings.js, whose store it reads (experimentsStore) and never writes.
//
// What it reads, each time a view is computed (always from the store, never from the decoded
// records ui/experiments.js keeps, which another tab may have replaced):
//   - the runs' list rows (store.list), each with its `links`; a row written before links
//     existed is read once from its record (store.get) instead;
//   - every stored run a connection names, read once (store.get validates the record and
//     recomputes its result hash), so a connection is 'present' only for a record that reads
//     and verifies; one that cannot be read is 'unreadable'. A read is cached per list row (id,
//     size, creation time, recorded result hash) and forgotten when that row leaves the list;
//   - the definitions and findings (listDefinitions, listFindings: validated on read);
//   - the stored Studio projects through Studio's own library (studioLibrary, the store Studio
//     saves to), each loaded through the full import pipeline once per saved version, its
//     studioHash and measured-path hash recomputed by studio/provenance.js studioProvenance;
//   - the running build (BUILD) and the frequency profile loaded in Measure.
//
// Views (plain data, x-text only): cnx.run (the open run's detail), cnx.defs[id],
// cnx.findings[id] (a definition or finding row's "Connected records", computed when it is
// opened), cnx.studio[id] (a Studio project in the Projects and patches dialog). Each is
// { id, status, upstream, downstream, notes, more } or null.
//
// Navigation: recordsApplyHash is the `records` domain of the one hash dispatcher
// (ui/navigation.js, ADR 0045/0048): a record link opens the run (its detail), or opens the
// definition's or finding's connections, and moves focus to the record's heading unless a
// dialog is open. A Studio project is shown through Studio's Projects and patches dialog (a
// link never loads a project over the open graph).

import { connectionsOf, runLinks, runTargets } from '../experiments/connections.js';
import { defaultEvidenceHz, storedResponseFrequencies } from '../experiments/evidence.js';
import { decodeRecordLink } from '../core/url-state-records.js';
import { createStudioLibrary } from '../studio/library.js';
import { studioProvenance } from '../studio/provenance.js';

const plain = (v) => JSON.parse(JSON.stringify(v));
// A read is reused only for the same list row: id, size, creation time and the result hash the
// row records. A record deleted and stored again under its id (in this tab or another) writes a
// new row, so it is read again.
const rowKey = (r) => `${r.experimentId}|${r.sizeBytes}|${r.createdAt}|${r.links
  ? r.links.resultHash : 'no links'}`;
const CHECKING = 'Checking the records stored in this browser…';
const NOUN = { run: 'Run', definition: 'Definition', finding: 'Finding' };

export function createConnectionsUi() {
  const ctx = {
    reads: new Map(),     // rowKey -> { readable, reason, links } of a stored run, read once
    projects: new Map(),  // `${id}|${savedAt}` -> a Studio project's recomputed identity
    token: { run: 0, definition: {}, finding: {}, studio: {} },
    pending: new Set(),
  };

  const track = (p) => {
    ctx.pending.add(p);
    p.catch(() => {}).finally(() => ctx.pending.delete(p));
    return p;
  };

  async function readRun(store, row) {
    const key = rowKey(row);
    if (ctx.reads.has(key)) return ctx.reads.get(key);
    let x;
    try {
      const e = await store.get(row.experimentId);
      x = e ? { readable: true, reason: null, links: runLinks(e),
        hasResponse: defaultEvidenceHz(e) !== null, frequencies: storedResponseFrequencies(e) }
        : { readable: false, reason: 'it was not found when read', links: null };
    } catch (err) {
      x = { readable: false, reason: err.message || String(err), links: null };
    }
    ctx.reads.set(key, x);
    return x;
  }

  async function studioIndex(cmp, store) {
    let lib;
    let rows;
    try {
      lib = typeof cmp.studioLibrary === 'function' ? await cmp.studioLibrary()
        : createStudioLibrary(store);
      rows = await lib.list({ kind: 'oscilla-studio' });
    } catch (err) {
      return null;
    }
    const keys = new Set();
    const projects = [];
    const unreadable = [];
    for (const r of rows) {
      const key = `${r.id}|${r.savedAt}`;
      keys.add(key);
      if (!ctx.projects.has(key)) {
        let x;
        try {
          const loaded = await lib.loadProject(r.id);
          const p = studioProvenance(loaded.model);
          x = { id: r.id, name: r.name, studioHash: p.studioHash,
            measured: p.measured ? { v: p.measured.v, hash: p.measured.hash } : null };
        } catch (err) {
          x = { id: r.id, name: r.name, error: err.message || String(err) };
        }
        ctx.projects.set(key, x);
      }
      const x = ctx.projects.get(key);
      if (x.error) unreadable.push(x.id); else projects.push(x);
    }
    for (const k of [...ctx.projects.keys()]) if (!keys.has(k)) ctx.projects.delete(k);
    return { projects, unreadable };
  }

  /** What this browser stores, as connections.js reads it. */
  async function readIndex(cmp) {
    const s = await cmp.experimentsStore();
    const list = await s.list();
    const keys = new Set(list.map(rowKey));
    for (const k of [...ctx.reads.keys()]) if (!keys.has(k)) ctx.reads.delete(k);
    const runs = [];
    for (const r of list) {
      const x = r.links ? ctx.reads.get(rowKey(r)) : await readRun(s, r);
      runs.push({ experimentId: r.experimentId, name: r.name || null, definition: r.definition
        || null, links: r.links || (x && x.links) || null, readable: x ? x.readable : undefined,
      reason: x ? x.reason : null, hasResponse: x ? x.hasResponse : undefined,
      frequencies: x ? x.frequencies : undefined, sizeBytes: r.sizeBytes,
      createdAt: r.createdAt });
    }
    let definitions = [];
    let unreadableDefinitions = [];
    try {
      const d = await s.listDefinitions();
      definitions = d.definitions;
      unreadableDefinitions = d.unreadable.map((u) => u.id).filter(Boolean);
    } catch (err) { /* the definitions stay unknown: every authored reference reads missing */ }
    let findings = [];
    try {
      findings = (await s.listFindings()).findings;
    } catch (err) { /* no finding is listed */ }
    const b = cmp.BUILD || null;
    const prof = typeof cmp.measureCurrentProfile === 'function' ? cmp.measureCurrentProfile()
      : null;
    return { store: s, index: { runs, definitions, unreadableDefinitions, findings,
      studio: await studioIndex(cmp, s),
      build: b ? { version: b.version, sourceDigest: b.sourceDigest || null,
        artifactSha256: b.artifactSha256 || null } : null,
      profile: prof && prof.id ? { id: prof.id, name: prof.name || null } : null } };
  }

  /**
   * connectionsOf over the stored records, after every run it names was read and verified.
   * `subjectOf(index)` -> subject, or a text saying why there is none.
   */
  async function compute(cmp, subjectOf) {
    const { store, index } = await readIndex(cmp);
    const subject = await subjectOf(index, store);
    if (typeof subject === 'string') return { status: subject, upstream: [], downstream: [],
      notes: [], more: { upstream: 0, downstream: 0 } };
    let out = connectionsOf(subject, index);
    const byId = new Map(index.runs.map((r) => [r.experimentId, r]));
    let read = false;
    for (const id of runTargets(out)) {
      const r = byId.get(id);
      if (!r || r.readable !== undefined) continue;
      const x = await readRun(store, r);
      Object.assign(r, { readable: x.readable, reason: x.reason, links: r.links || x.links,
        hasResponse: x.hasResponse, frequencies: x.frequencies });
      read = true;
    }
    if (read) out = connectionsOf(subject, { ...index, runs: index.runs.slice() });
    return { status: null, ...out };
  }

  const view = (id, r) => plain({ id, ...r });
  const checking = (id) => ({ id, status: CHECKING, upstream: [], downstream: [], notes: [],
    more: { upstream: 0, downstream: 0 } });

  /** Move focus to `selector` after the next render, unless a dialog is open. */
  function focusLater(cmp, selector) {
    if (typeof document === 'undefined') return;
    const go = () => {
      if (document.querySelector('dialog[open]')) return;
      const el = document.querySelector(selector);
      if (!el) return;
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus();
    };
    if (typeof cmp.$nextTick === 'function') cmp.$nextTick(() => setTimeout(go, 0));
    else go();
  }
  const css = (id) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id);

  return {
    cnx: {
      run: null,
      defs: {},
      findings: {},
      studio: {},
      open: { definition: {}, finding: {} },
    },

    /** The connections of the open run (its detail). */
    async connectionsOfRun(id) {
      const t = ++ctx.token.run;
      if (!this.cnx.run || this.cnx.run.id !== id) this.cnx.run = checking(id);
      const r = await track(compute(this, async (ix, store) => {
        // Read from the store, never from the workspace's decoded cache: another tab may have
        // replaced the run under its id since it was cached (review 2 of #149).
        let e;
        try {
          e = await store.get(id);
        } catch (err) {
          return `Run ${id} is stored here but cannot be read (${err.message || String(err)}).`;
        }
        return e ? { kind: 'run', record: e } : `Run ${id} is not stored in this browser.`;
      }));
      if (t === ctx.token.run) this.cnx.run = view(id, r);
      return r;
    },
    async connectionsOfDefinition(id) {
      const t = (ctx.token.definition[id] || 0) + 1;
      ctx.token.definition[id] = t;
      if (!this.cnx.defs[id]) this.cnx.defs = { ...this.cnx.defs, [id]: checking(id) };
      const r = await track(compute(this, (ix) => {
        const d = ix.definitions.find((x) => x.id === id);
        return d ? { kind: 'definition', record: d } : `Definition ${id} is not stored in this `
          + 'browser, or it cannot be read.';
      }));
      if (t === ctx.token.definition[id]) this.cnx.defs = { ...this.cnx.defs, [id]: view(id, r) };
      return r;
    },
    async connectionsOfFinding(id) {
      const t = (ctx.token.finding[id] || 0) + 1;
      ctx.token.finding[id] = t;
      if (!this.cnx.findings[id]) this.cnx.findings = { ...this.cnx.findings, [id]: checking(id) };
      const r = await track(compute(this, (ix) => {
        const f = ix.findings.find((x) => x.id === id);
        return f ? { kind: 'finding', record: f } : `Finding ${id} is not stored in this browser, `
          + 'or it cannot be read.';
      }));
      if (t === ctx.token.finding[id]) {
        this.cnx.findings = { ...this.cnx.findings, [id]: view(id, r) };
      }
      return r;
    },
    /** The runs measured from stored Studio project `id` (the Projects and patches dialog). */
    async connectionsOfStudioProject(id) {
      const r = await track(compute(this, (ix) => {
        if (!ix.studio) return 'The Studio projects stored here could not be read.';
        const p = ix.studio.projects.find((x) => x.id === id);
        if (p) return { kind: 'studio', record: p };
        return ix.studio.unreadable.includes(id) ? 'This project cannot be read, so its graph '
          + 'was not compared.' : 'This project is no longer saved.';
      }));
      this.cnx.studio = { ...this.cnx.studio, [id]: view(id, r) };
      return r;
    },
    /** A definition's or finding's "Connected records" opened or closed. */
    connectionsToggle(kind, id, open) {
      this.cnx.open = { ...this.cnx.open, [kind]: { ...this.cnx.open[kind], [id]: !!open } };
      if (!open) return null;
      return kind === 'definition' ? this.connectionsOfDefinition(id)
        : this.connectionsOfFinding(id);
    },
    /** Read again whatever is shown (after a stored change). */
    connectionsRefreshOpen() {
      const jobs = [];
      if (this.cnx.run) jobs.push(this.connectionsOfRun(this.cnx.run.id));
      for (const [id, on] of Object.entries(this.cnx.open.definition)) {
        if (on) jobs.push(this.connectionsOfDefinition(id));
      }
      for (const [id, on] of Object.entries(this.cnx.open.finding)) {
        if (on) jobs.push(this.connectionsOfFinding(id));
      }
      return track(Promise.all(jobs).catch(() => null));
    },
    connectionsClearRun() {
      ctx.token.run += 1;
      this.cnx.run = null;
    },

    /**
     * A connection's link clicked. A Studio project opens Studio's Projects and patches dialog at
     * that project (Open there is explicit, so unsaved work is never replaced); a link to the
     * address already shown is applied again. Any other link is left to the browser and the
     * hash dispatcher; a modified click (new tab) is never intercepted.
     */
    connectionsFollow(c, ev) {
      if (!c || (ev && (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button > 0))) {
        return false;
      }
      if (c.open && c.open.kind === 'studio') {
        if (ev) ev.preventDefault();
        this.setWorkspace('studio');
        if (typeof this.studioShowProject === 'function') {
          const go = () => this.studioShowProject(c.open.id);
          if (typeof this.$nextTick === 'function') this.$nextTick(go); else go();
        }
        return true;
      }
      if (c.to && c.to.kind === 'run' && c.to.hash && c.href) {
        // A run shown as "stored here" is opened only while the same record is stored: it is
        // read again first, and a record that changed since the list was read is refused.
        if (ev) ev.preventDefault();
        track(this.connectionsVerifyAndGo(c));
        return true;
      }
      if (c.href && typeof location !== 'undefined' && location.hash === c.href) {
        if (ev) ev.preventDefault();
        this.recordsApplyHash(c.href, 'link');
        return true;
      }
      return false;
    },
    /**
     * Read run target `c.to` from the store again; follow `c.href` only when the record stored
     * under its id still has the result hash it was verified with. Returns true when followed.
     */
    async connectionsVerifyAndGo(c) {
      const name = c.target;
      let e = null;
      try {
        e = await (await this.experimentsStore()).get(c.to.id);
      } catch (err) {
        this.notify('warning', 'Run not opened', `${name} is stored here but cannot be read now (${
          err.message || String(err)}). Nothing was opened.`);
        this.connectionsRefreshOpen();
        return false;
      }
      const now = e ? runLinks(e).resultHash : null;
      if (!e || now !== c.to.hash) {
        this.notify('warning', 'Run not opened', `${name} changed since this list was read: ${e
          ? 'a different record is stored under its id now' : 'it is no longer stored here'}. `
          + 'Nothing was opened; the connections are read again.');
        this.connectionsRefreshOpen();
        return false;
      }
      if (typeof location !== 'undefined') {
        if (location.hash === c.href) this.recordsApplyHash(c.href, 'link');
        else location.hash = c.href;
      } else this.recordsApplyHash(c.href, 'link');
      return true;
    },

    /**
     * The `records` domain of the hash dispatcher: true (applied; the record opens when it is
     * read), false (refused, with a message) or null (no record key in the hash).
     */
    recordsApplyHash(hash) {
      const r = decodeRecordLink(hash);
      if (r === null) return null;
      if (!r.ok) {
        const why = r.errors.slice(0, 3).join('; ');
        this.notify('warning', 'Record link not applied', `${why}. Nothing was opened.`);
        return false;
      }
      track(this.recordsOpen(r.kind, r.id));
      return true;
    },
    /** Open stored record `kind` `id` where it is shown, and move focus to it. */
    async recordsOpen(kind, id) {
      const missing = () => {
        this.notify('warning', `${NOUN[kind]} not found`, `${NOUN[kind]} ${id} is not stored in `
          + 'this browser (deleted, or never stored here).');
        return false;
      };
      try {
        if (kind === 'run') {
          if (!(this.exps.detail && this.exps.detail.id === id)) {
            if (!await (await this.experimentsStore()).get(id)) return missing();
            await this.experimentsOpen(id);
          } else await this.connectionsOfRun(id);
          this.exps.panel = 'detail';
          focusLater(this, '#osc-x-detail-title');
          return true;
        }
        if (!this.exps.loaded) await this.experimentsRefresh();
        const rowsOf = kind === 'definition' ? this.exps.defs : this.fnd.rows;
        if (!rowsOf.some((x) => x.id === id)) return missing();
        await this.connectionsToggle(kind, id, true);
        focusLater(this, `[data-osc="${kind === 'definition' ? 'def' : 'fnd'}.row"][data-id="${
          css(id)}"] h4`);
        return true;
      } catch (err) {
        this.notify('error', `${NOUN[kind]} not opened`, err.message || String(err));
        return false;
      }
    },

    /** Resolves once every connection view being computed has settled (tests). */
    async cnxSettled() {
      while (ctx.pending.size) await Promise.all([...ctx.pending].map((p) => p.catch(() => {})));
    },
  };
}

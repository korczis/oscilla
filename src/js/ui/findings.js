// FINDINGS inside the Experiments workspace (ADR 0046): the DOM/Alpine adapter over
// experiments/findings.js. Composed into the ONE OSCILLA component by main.js, next to
// ui/experiments.js, whose store it uses (experimentsStore) and whose list refresh calls
// findingsRefresh, so a deleted run reads as missing in every finding that cites it.
//
// A finding is user metadata: an interpretation linked to the runs it rests on. Nothing here
// writes a run. Every text is rendered with x-text (never as markup), and the model refuses
// markup in the first place.
//
// Integrity: each reference is checked against this browser's runs (findingIssues). A run's
// identity (its stored result hash, whether it stores a response, its stored response grid) is
// read from the store itself (experimentsIdentity, never the decoded cache) and kept only while
// the run's list row is unchanged and names the same hash; every findings refresh reads the run
// list first. A record replaced under a cited id, here or in another tab, is therefore read again
// and named as different; one that cannot be read is named unreadable.
//
// Losable work (ADR 0045): a finding being written in the dialog, a draft kept after the dialog
// closed without a save, and text kept after a refused stale edit (findingsWhatWouldBeLost); the
// findings the memory fallback holds are reported by experimentsWhatWouldBeLost.

import {
  FINDING_STATUSES, STATUS_TEXT, STATUS_HINT, FINDINGS_FILE_EXTENSION, FINDING_LIMITS,
  createFinding, updateFinding, findingIssues, findingsCiting, refText, refKey, refRunIds,
  citedRunIds, exportFindings, findingsToJson, parseFindingsFile, hzText, gridHzText,
} from '../experiments/findings.js';
import { newExperimentId } from '../experiments/schema.js';
import { timestampText } from '../measurement/views/experiment-summary.js';
import { downloadBlob, readFileText } from './exporters.js';
import { randomBytes16 } from './experiments.js';

const DIALOG = 'osc-dlg-finding';
const DELETE_DIALOG = 'osc-dlg-finding-delete';
const plain = (v) => JSON.parse(JSON.stringify(v));
const formState = (f) => JSON.stringify([f.statement.trim(), f.status, f.notes.trim(),
  f.evidence.map((e) => e.key)]);
const blankForm = () => {
  const f = { open: false, mode: 'new', id: null, loadedUpdatedAt: null, statement: '',
    status: 'observation', notes: '', evidence: [], runs: [], base: '', error: '', addRun: '',
    cmpA: '', cmpB: '',
    // A save refused because the finding changed elsewhere: `conflict` until the stored version
    // is loaded; `mine` / `mineNotes` keep the text typed here, shown to copy, until a save.
    conflict: false, mine: '', mineNotes: '' };
  f.base = formState(f);
  return f;
};
const dirty = (f) => formState(f) !== f.base || !!f.mine || !!f.mineNotes;
const CONFLICT = Symbol('changed elsewhere');
const CHANGED_ELSEWHERE = 'This finding was changed in another tab or window since you opened it, '
  + 'so it was not saved. Load the stored version to continue; the text you typed stays shown '
  + 'below to copy.';

/**
 * The view row of a stored finding: its statement and status in words, each reference with its
 * state ('ok', 'missing' or 'broken') and the reason, and the status issue when none of its
 * evidence is here.
 */
export function findingRow(f, lookup, nameOf) {
  const issues = findingIssues(f, lookup);
  return {
    id: f.id, statement: f.statement, status: f.status, statusText: STATUS_TEXT[f.status],
    statusHint: STATUS_HINT[f.status], notes: f.notes,
    meta: `Recorded ${timestampText(f.createdAt)}${f.updatedAt !== f.createdAt
      ? ` · changed ${timestampText(f.updatedAt)}` : ''}`,
    evidence: f.evidence.map((ref, i) => {
      const mine = issues.filter((x) => x.index === i);
      const got = ref.kind === 'value' && !mine.length ? lookup(ref.experimentId) : null;
      return { key: refKey(ref), ref, text: refText(ref, nameOf, { storedPoint: !!(got
        && Array.isArray(got.frequencies)), frequencies: got && got.frequencies }),
        state: !mine.length ? 'ok' : mine.some((x) => x.code === 'missing-run') ? 'missing'
          : 'broken', issue: mine.length ? mine.map((x) => x.text).join('; ') : null };
    }),
    statusIssue: (issues.find((x) => x.code === 'unsupported-status') || {}).text || null,
  };
}

export function createFindingsUi() {
  const ctx = {
    // experimentId -> { readable: true, resultHash, hasResponse } of a stored run, or
    // { readable: false, reason } when its record cannot be read (a corrupt record)
    identity: new Map(),
    rowKey: new Map(),   // experimentId -> the summary row the identity was read under
    names: new Map(),    // experimentId -> name, of the runs listed
    defs: new Map(),     // definition id -> name (a reference to one is the wrong kind)
  };
  const nameOf = (id) => ctx.names.get(id) || null;
  /** The stored grid of a value reference's run (as last read), or null. */
  const gridOf = (ref) => {
    const x = ref.kind === 'value' ? ctx.identity.get(ref.experimentId) : null;
    return x && x.frequencies ? x.frequencies : null;
  };
  /** Is a value reference exactly a point of its run's stored grid (as last read)? */
  const storedPointOf = (ref) => {
    const x = ref.kind === 'value' ? ctx.identity.get(ref.experimentId) : null;
    return !!(x && x.frequencies && x.frequencies.includes(ref.at.hz));
  };

  /**
   * The identity of a stored run (cached unless `fresh`); null when it is not stored. A record
   * that cannot be read is { readable: false, reason }, never treated as present.
   */
  async function identity(cmp, id, { fresh = false } = {}) {
    if (!fresh && ctx.identity.has(id)) return ctx.identity.get(id);
    let x;
    try {
      x = await cmp.experimentsIdentity(id);
    } catch (err) {
      const v = { readable: false, reason: String(err && err.message || err).slice(0, 160) };
      ctx.identity.set(id, v);
      return v;
    }
    if (!x) {
      ctx.identity.delete(id);
      return null;
    }
    const v = { readable: true, resultHash: x.resultHash, hasResponse: x.hasResponse,
      frequencies: x.frequencies || null };
    ctx.identity.set(id, v);
    return v;
  }

  function lookup(id) {
    if (ctx.names.has(id)) {
      const x = ctx.identity.get(id);
      // Listed but not read: its identity is unknown, so findingIssues cannot call it present.
      if (!x) return { kind: 'run', name: ctx.names.get(id) };
      return { kind: 'run', name: ctx.names.get(id), readable: x.readable, reason: x.reason,
        resultHash: x.resultHash, hasResponse: x.hasResponse, frequencies: x.frequencies };
    }
    if (ctx.defs.has(id)) return { kind: 'definition', name: ctx.defs.get(id) };
    return null;
  }

  /** Add `refs` to the open form, with the identity of each run they cite. */
  async function link(cmp, refs) {
    const f = cmp.fnd.form;
    f.error = '';
    for (const ref of refs) {
      const key = refKey(ref);
      if (f.evidence.some((e) => e.key === key)) {
        f.error = `${refText(ref, nameOf)} is already linked.`;
        return false;
      }
      for (const id of refRunIds(ref)) {
        if (f.runs.some((r) => r.experimentId === id)) continue;
        const x = await identity(cmp, id, { fresh: true });
        const label = nameOf(id) ? `"${nameOf(id)}"` : id;
        if (!x) {
          f.error = `Run ${label} is not stored here; only a stored run can be linked.`;
          return false;
        }
        if (!x.readable) {
          f.error = `Run ${label} cannot be read (${x.reason}); it cannot be linked.`;
          return false;
        }
        if (!x.resultHash) {
          f.error = `Run ${label} has no result hash, so a finding could not tell it from a `
            + 'different record later; only a completed run can be linked.';
          return false;
        }
        f.runs = [...f.runs, { experimentId: id, resultHash: x.resultHash }];
      }
      f.evidence = [...f.evidence, { key, ref, text: refText(ref, nameOf,
        { storedPoint: storedPointOf(ref), frequencies: gridOf(ref) }) }];
    }
    return true;
  }

  return {
    FINDING_STATUSES,
    FINDING_STATUS_TEXT: STATUS_TEXT,
    FINDING_STATUS_HINT: STATUS_HINT,
    FINDINGS_FILE_EXTENSION,
    FINDING_LIMITS,
    fnd: {
      loaded: false,
      all: [],          // the stored findings (plain data)
      rows: [],
      note: null,       // stored findings that could not be read
      importErrors: [],
      form: blankForm(),
      // A changed form whose dialog was closed (Escape, a backdrop click, Close): it is kept,
      // reported to the unsaved-work guard and offered again; only Discard drops it.
      draftKept: false,
      deleteId: null,
      deleteText: '',
    },

    findingsInit() {
      const dlg = typeof document !== 'undefined' ? document.getElementById(DIALOG) : null;
      // Closing without a save (Cancel, Escape, a backdrop click) keeps a changed form as a draft.
      if (dlg) dlg.addEventListener('close', () => this.findingsDialogClosed());
      // Another tab may have changed the runs or findings: read them again when this tab is
      // shown, so a reference is checked against what is stored now.
      if (typeof document !== 'undefined') {
        let pending = null;
        document.addEventListener('visibilitychange', () => {
          if (document.hidden || pending || this.workspace !== 'experiments'
            || !this.exps.loaded) return;
          pending = this.experimentsRefresh().catch(() => null)
            .finally(() => { pending = null; });
        });
      }
    },

    /** What a reload would lose here: a finding being written or a kept draft (ADR 0045). */
    findingsWhatWouldBeLost() {
      const f = this.fnd.form;
      return (f.open || this.fnd.draftKept) && dirty(f)
        ? [{ domain: 'findings', label: 'A finding being written' }] : [];
    },
    /** Has the form changed since it was opened (a draft that would be lost)? */
    findingsDraftDirty() {
      return dirty(this.fnd.form);
    },
    /** The dialog closed without a save: a changed form is kept as a draft. */
    findingsDialogClosed() {
      const f = this.fnd.form;
      f.open = false;
      this.fnd.draftKept = dirty(f);
    },
    /**
     * Reopen the kept draft. A draft whose save was refused as changed elsewhere never reopens
     * stale: the stored version is loaded first, with the typed text kept beside it.
     */
    async findingsContinueDraft() {
      if (!this.fnd.draftKept) return false;
      if (this.fnd.form.conflict) await this.findingsLoadStored();
      this.fnd.form.open = true;
      this.openModal(DIALOG);
      return true;
    },
    /**
     * After a refused save: load the finding as it is stored now (its fields and its updatedAt,
     * so the next save is checked against it), keeping the text typed here in `mine` to copy.
     * Returns false when it is no longer stored.
     */
    async findingsLoadStored() {
      const f = this.fnd.form;
      const s = await this.experimentsStore();
      const now = f.id ? await s.getFinding(f.id).catch(() => null) : null;
      if (!now) {
        f.error = 'This finding is no longer stored; save it as a new finding or discard it.';
        f.mode = 'new';
        f.id = null;
        f.conflict = false;
        return false;
      }
      if (f.statement.trim() !== now.statement) f.mine = f.mine || f.statement;
      if (f.notes.trim() !== (now.notes || '')) f.mineNotes = f.mineNotes || f.notes;
      Object.assign(f, { loadedUpdatedAt: now.updatedAt, statement: now.statement,
        status: now.status, notes: now.notes || '', runs: plain(now.runs),
        evidence: now.evidence.map((ref) => ({ key: refKey(ref), ref: plain(ref),
          text: refText(ref, nameOf, { storedPoint: storedPointOf(ref), frequencies: gridOf(ref) }) })),
        conflict: false, error: '' });
      f.base = formState(f);
      return true;
    },
    /** Drop the draft (the only way a typed finding is discarded without a save). */
    findingsDiscardDraft() {
      this.fnd.form = blankForm();
      this.fnd.draftKept = false;
      this.closeModal(DIALOG);
    },

    /**
     * Read the findings again and check their references against `list` (the run rows, as
     * experimentsRefresh read them). Without a list (after a finding is saved, deleted or
     * imported) the whole Experiments list is read again first, so the runs, the decoded-record
     * cache and the findings are checked against the same, current rows.
     */
    async findingsRefresh(list = null) {
      if (!list && typeof this.experimentsRefresh === 'function') {
        await this.experimentsRefresh(); // reads the rows, then calls findingsRefresh(rows)
        return this.fnd.rows;
      }
      const s = await this.experimentsStore();
      const rows = list || await s.list();
      ctx.names = new Map(rows.map((r) => [r.experimentId, r.name || '(unnamed)']));
      ctx.defs = new Map((this.exps.defs || []).map((d) => [d.id, d.name]));
      // An identity is kept only while its list row is unchanged: a record replaced under the id
      // (here or in another tab) changes the row (its result hash, time, size), so it is read
      // again. The IndexedDB store fills a missing row hash in on first read (store.js), so only
      // a row without one (none in practice) is read on every refresh.
      const byId = new Map(rows.map((r) => [r.experimentId, r]));
      const keys = new Map(rows.map((r) => [r.experimentId, Object.prototype.hasOwnProperty
        .call(r, 'resultHash') ? JSON.stringify(r) : null]));
      for (const id of [...ctx.identity.keys()]) {
        const k = keys.get(id);
        if (!k || k !== ctx.rowKey.get(id)) {
          ctx.identity.delete(id);
          ctx.rowKey.delete(id);
        }
      }
      const { findings, unreadable } = await s.listFindings();
      for (const id of new Set(findings.flatMap(citedRunIds))) {
        if (!ctx.names.has(id)) continue;
        const x = await identity(this, id);
        // Kept under this row only when the record read is the one the row names (same hash);
        // otherwise it is read again at the next refresh.
        if (keys.get(id) && x && x.readable && x.resultHash === byId.get(id).resultHash) {
          ctx.rowKey.set(id, keys.get(id));
        } else ctx.rowKey.delete(id);
      }
      const n = unreadable.length;
      this.fnd.note = n ? `${n} stored finding${n === 1 ? '' : 's'} could not be read and ${
        n === 1 ? 'is' : 'are'} not listed (${unreadable.map((u) => u.id || 'no id').slice(0, 3)
        .join(', ')}).` : null;
      this.fnd.all = plain(findings);
      this.fnd.rows = plain(findings.map((f) => findingRow(f, lookup, nameOf)));
      this.fnd.loaded = true;
      return this.fnd.rows;
    },

    /** How many findings cite run `id` (the delete dialog says so). */
    findingsCiting(id) {
      return findingsCiting(this.fnd.all, id).length;
    },
    /** Backlinks of run `id`: the findings citing it, with how. */
    findingsBacklinks(id) {
      const grid = (ctx.identity.get(id) || {}).frequencies || null;
      return findingsCiting(this.fnd.all, id, nameOf, (hz) => gridHzText(hz, grid)).map(({ finding, how }) => ({ id: finding.id,
        statement: finding.statement, statusText: STATUS_TEXT[finding.status],
        how: how.join('; ') }));
    },

    /** Open the dialog: a new finding seeded with `refs`, or `id` to edit. */
    async findingsAskNew(refs = [], id = null) {
      if (this.fnd.draftKept && dirty(this.fnd.form)) {
        // Never replace a kept draft: reopen it, and say so.
        await this.findingsContinueDraft();
        this.notify('info', 'Finding draft reopened', 'Your unsaved finding draft was reopened: '
          + 'save it or discard it before starting another.');
        return true;
      }
      this.fnd.draftKept = false;
      // An edit starts from the stored finding (another tab may have changed it since the list).
      const old = id ? await (await this.experimentsStore()).getFinding(id)
        .catch(() => null) || this.fnd.all.find((x) => x.id === id) || null : null;
      const f = Object.assign(blankForm(), old ? { mode: 'edit', id,
        loadedUpdatedAt: old.updatedAt, statement: old.statement,
        status: old.status, notes: old.notes || '', runs: plain(old.runs),
        evidence: old.evidence.map((ref) => ({ key: refKey(ref), ref: plain(ref),
          text: refText(ref, nameOf, { storedPoint: storedPointOf(ref), frequencies: gridOf(ref) }) })) } : {});
      this.fnd.form = f;
      if (refs.length && !await link(this, refs)) {
        this.notify('error', 'Finding not started', this.fnd.form.error);
        this.fnd.form = blankForm();
        return false;
      }
      this.fnd.form.base = formState(this.fnd.form);
      this.fnd.form.open = true;
      this.openModal(DIALOG);
      return true;
    },
    findingsAskEdit(id) {
      return this.findingsAskNew([], id);
    },
    findingsAskRun(id) {
      return this.findingsAskNew([{ kind: 'run', experimentId: id }]);
    },
    /** A finding about the stored point the open run's evidence shows (ADR 0044's lineage). */
    findingsAskValue() {
      const d = this.exps.detail;
      const p = d && d.evidence && d.evidence.point;
      return p ? this.findingsAskNew([{ kind: 'value', experimentId: d.id, at: { hz: p.hz } }])
        : false;
    },
    findingsValueLabel() {
      const d = this.exps.detail;
      const p = d && d.evidence && d.evidence.point;
      return p ? `Record a finding about the value at ${hzText(p.hz)}` : '';
    },
    /** A finding about the open comparison: A compared with each other run. */
    findingsAskCompare() {
      const e = this.exps.compare ? this.exps.compare.entries : [];
      return e.length >= 2 ? this.findingsAskNew(e.slice(1).map((x) => ({ kind: 'compare',
        a: e[0].id, b: x.id }))) : false;
    },
    async findingsAddRun(id) {
      if (!id) return false;
      const ok = await link(this, [{ kind: 'run', experimentId: id }]);
      if (ok) this.fnd.form.addRun = '';
      return ok;
    },
    async findingsAddCompare(a, b) {
      if (!a || !b || a === b) {
        this.fnd.form.error = 'Choose two different runs to link a comparison.';
        return false;
      }
      return link(this, [{ kind: 'compare', a, b }]);
    },
    findingsRemoveRef(i) {
      const f = this.fnd.form;
      f.evidence = f.evidence.filter((x, j) => j !== i);
      // A run no longer cited loses its recorded identity: linking it again reads it anew.
      const cited = new Set(f.evidence.flatMap((e) => refRunIds(e.ref)));
      f.runs = f.runs.filter((r) => cited.has(r.experimentId));
      f.error = '';
    },

    /** Store the dialog's finding; returns it, or null (the reason is in the dialog). */
    async findingsSave() {
      const f = this.fnd.form;
      let saved;
      try {
        const s = await this.experimentsStore();
        const evidence = f.evidence.map((e) => e.ref);
        const cited = new Set(evidence.flatMap(refRunIds));
        const fields = { statement: f.statement, status: f.status, notes: f.notes, evidence,
          runs: f.runs.filter((r) => cited.has(r.experimentId)) };
        const now = Date.now();
        const old = f.mode === 'edit' ? await s.getFinding(f.id) : null;
        if (f.mode === 'edit' && !old) throw new Error('This finding is no longer stored.');
        if (old && old.updatedAt !== f.loadedUpdatedAt) throw CONFLICT;
        const next = old ? updateFinding(old, fields, { now })
          : createFinding({ id: newExperimentId(randomBytes16()), now, ...fields });
        // The store checks the version again inside its write, so two tabs never overwrite.
        saved = await s.putFinding(next, old ? { expectedUpdatedAt: f.loadedUpdatedAt } : {})
          .catch((err) => { throw err && err.code === 'conflict' ? CONFLICT : err; });
      } catch (err) {
        if (err === CONFLICT) {
          f.conflict = true;
          f.error = CHANGED_ELSEWHERE;
          return null;
        }
        f.error = (err.message || String(err)).replace(/^Invalid finding: /, '');
        return null;
      }
      f.open = false;
      this.fnd.form = blankForm();
      this.fnd.draftKept = false;
      this.closeModal(DIALOG);
      await this.findingsRefresh();
      return saved;
    },

    findingsAskDelete(id) {
      const x = this.fnd.all.find((r) => r.id === id);
      if (!x) return;
      this.fnd.deleteId = id;
      this.fnd.deleteText = x.statement;
      this.openModal(DELETE_DIALOG);
    },
    async findingsDelete() {
      const at = this.fnd.rows.findIndex((r) => r.id === this.fnd.deleteId);
      const ok = await this.findingsDeleteNow(this.fnd.deleteId);
      if (!ok) return ok;
      this.closeModal(DELETE_DIALOG);
      // Focus goes to the finding now in that place (its Edit), else the one before it, else
      // "New finding"; never back to the page start (the deleted row's button is gone).
      if (typeof document !== 'undefined') {
        setTimeout(() => {
          const rows = document.querySelectorAll('[data-osc="fnd.row"]');
          const row = rows[Math.min(Math.max(at, 0), rows.length - 1)];
          const target = row ? row.querySelector('[data-osc="fnd.edit"]')
            : document.querySelector('[data-osc="fnd.new"]');
          if (target) target.focus();
        }, 60);
      }
      return ok;
    },
    /** Delete finding `id` (the runs it cites are not touched). */
    async findingsDeleteNow(id) {
      try {
        await (await this.experimentsStore()).deleteFinding(id);
      } catch (err) {
        this.notify('error', 'Finding not deleted', err.message || String(err));
        return false;
      }
      this.fnd.deleteId = null;
      await this.findingsRefresh();
      return true;
    },

    /** Open what a reference names: the run, the comparison, or the run at the value. */
    async findingsOpenRef(ref) {
      if (ref.kind === 'compare') return this.experimentsCompare([ref.a, ref.b]);
      const e = await this.experimentsOpen(ref.experimentId);
      if (e && ref.kind === 'value') this.experimentsEvidenceAt(ref.at.hz);
      return e;
    },

    /**
     * Export every stored finding, each with the identity of the runs it cites. A stored finding
     * that cannot be read is left out, and the notification says so. Returns the file text.
     */
    async findingsExport({ download = downloadBlob } = {}) {
      const { findings, unreadable } = await (await this.experimentsStore()).listFindings();
      const text = findingsToJson(exportFindings(findings, { now: Date.now(),
        oscillaVersion: this.BUILD ? this.BUILD.version : null }));
      download(new Blob([`${text}\n`], { type: 'application/json' }),
        `findings${FINDINGS_FILE_EXTENSION}`);
      const n = unreadable.length;
      if (n) {
        this.notify('warning', 'Findings exported with a gap', `${findings.length} exported. ${n} `
          + `stored finding${n === 1 ? '' : 's'} could not be read and ${n === 1 ? 'was' : 'were'} `
          + `left out (${unreadable.map((u) => u.id || 'no id').slice(0, 3).join(', ')}).`);
      }
      return text;
    },
    findingsImportClick() {
      const input = document.getElementById('osc-fnd-import-file');
      if (input) { input.value = ''; input.click(); }
    },
    async findingsImportFile(ev) {
      const file = ev && ev.target && ev.target.files && ev.target.files[0];
      if (!file) return null;
      try {
        return await this.findingsImportText(await readFileText(file,
          { maxBytes: FINDING_LIMITS.fileBytes, what: `"${file.name}"` }));
      } catch (err) {
        this.notify('error', 'Findings not imported', err.message || String(err));
        return null;
      }
    },
    /**
     * Import a findings file: the whole file is validated first, a finding stored here with
     * different content refuses all of it, an identical one is skipped. Returns the number
     * stored, or null.
     */
    async findingsImportText(text) {
      const refuse = (lines) => {
        this.fnd.importErrors = lines.slice(0, 5);
        this.notify('error', 'Findings not imported', `${lines[0]}${lines.length > 1
          ? ` (and ${lines.length - 1} more)` : ''}`);
        return null;
      };
      const p = parseFindingsFile(text);
      if (!p.ok) return refuse(p.errors.map((e) => `${e.path || 'file'}: ${e.text}`));
      const s = await this.experimentsStore();
      let r;
      try {
        // The store decides the import in one transaction (findings.js importPlan): a finding
        // stored here with different content refuses all of it; an identical one is skipped.
        r = await s.putFindings(p.findings);
      } catch (err) {
        return refuse(err && err.code === 'conflict' && Array.isArray(err.fields)
          ? err.fields.map((id) => `${id} is already stored with different content; nothing `
            + 'was imported') : [err.message || String(err)]);
      }
      this.fnd.importErrors = [];
      await this.findingsRefresh();
      const absent = [...new Set(p.findings.flatMap(citedRunIds))]
        .filter((id) => !ctx.names.has(id)).length;
      this.notify(absent ? 'warning' : 'success', 'Findings imported', `${r.stored.length} `
        + `stored${r.same.length ? `, ${r.same.length} already here` : ''}.${absent ? ` ${absent} `
        + `cited run${absent === 1 ? ' is' : 's are'} not stored here; import ${absent === 1
          ? 'it' : 'them'} to check the references.` : ''}`);
      return r.stored.length;
    },
  };
}

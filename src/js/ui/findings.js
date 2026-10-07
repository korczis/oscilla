// FINDINGS inside the Experiments workspace (ADR 0046): the DOM/Alpine adapter over
// experiments/findings.js. Composed into the ONE OSCILLA component by main.js, next to
// ui/experiments.js, whose store it uses (experimentsStore) and whose list refresh calls
// findingsRefresh, so a deleted experiment reads as missing in every finding that cites it.
//
// A finding is user metadata: an interpretation linked to the experiments it rests on. Nothing here
// writes an experiment. Every text is rendered with x-text (never as markup), and the model refuses
// markup in the first place.
//
// Integrity (review 3 of #149): ONE verification point, findingsVerifyCitedExperiment(id,
// citedHash),
// reads an experiment's identity fresh from the store every time (experimentsIdentity ->
// store.get, which
// verifies the record; never the decoded cache) and says ok, different, unverifiable, unreadable or
// missing. Every claim this adapter shows about a cited experiment is derived from it at the
// moment of
// use: a row's reference states and "(a stored grid point)" (verified on every refresh), Open
// (verified again first; refused, re-checked and said otherwise), linking (verified against the
// hash of the record on screen, experimentsShownHash), and backlinks (the row's state, and the
// cited hash against the record shown). Nothing keeps an identity between refreshes.
//
// Losable work (ADR 0045): a finding being written in the dialog, a draft kept after the dialog
// closed without a save, and text kept after a refused stale edit (findingsWhatWouldBeLost); the
// findings the memory fallback holds are reported by experimentsWhatWouldBeLost.

import {
  FINDING_STATUSES, STATUS_TEXT, STATUS_HINT, FINDINGS_FILE_EXTENSION, FINDING_LIMITS,
  createFinding, updateFinding, findingIssues, findingsCiting, refText, refKey, refExperimentIds,
  citedExperimentIds, exportFindings, findingsToJson, parseFindingsFile, exactHzText,
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
    status: 'observation', notes: '', evidence: [], experiments: [], base: '', error: '',
    addRun: '', cmpA: '', cmpB: '',
    // A save refused because the finding changed or was deleted elsewhere: `conflict` until the
    // stored version is loaded; `mine*` keep what was typed here (statement, notes, status,
    // references), shown to copy, until a save.
    conflict: false, deleted: false, mine: '', mineNotes: '', mineStatus: '', mineRefs: [] };
  f.base = formState(f);
  return f;
};
const dirty = (f) => formState(f) !== f.base || !!f.mine || !!f.mineNotes || !!f.mineStatus
  || f.mineRefs.length > 0;
const CONFLICT = Symbol('changed elsewhere');
const DELETED = Symbol('deleted elsewhere');
const DELETED_ELSEWHERE = 'This finding was deleted in another tab or window since you opened it, '
  + 'so it was not saved. Load the stored version to continue: what you typed then becomes a new '
  + 'finding.';
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
        state: !mine.length ? 'ok' : mine.some((x) => x.code === 'missing-experiment') ? 'missing'
          : 'broken', issue: mine.length ? mine.map((x) => x.text).join('; ') : null };
    }),
    statusIssue: (issues.find((x) => x.code === 'unsupported-status') || {}).text || null,
  };
}

export function createFindingsUi() {
  const ctx = {
    names: new Map(),    // experimentId -> name, of the experiments listed
    defs: new Map(),     // definition id -> name (a reference to one is the wrong kind)
    // experimentId -> the verification of the last refresh (findingsVerifyCitedExperiment), used
    // only
    // to draw that refresh's rows; every new claim verifies again
    checked: new Map(),
  };
  const nameOf = (id) => ctx.names.get(id) || null;

  /** A findingIssues lookup entry from a verification (null: nothing stored under the id). */
  function entryOf(id, v) {
    if (!v || v.state === 'missing') {
      return ctx.defs.has(id) ? { kind: 'definition', name: ctx.defs.get(id) } : null;
    }
    const name = nameOf(id) || v.name || null;
    if (v.state === 'unreadable') {
      return { kind: 'experiment', name, readable: false, reason: v.reason };
    }
    return { kind: 'experiment', name, readable: true, resultHash: v.resultHash,
      hasResponse: v.hasResponse, frequencies: v.frequencies };
  }
  function lookup(id) {
    if (ctx.checked.has(id)) return entryOf(id, ctx.checked.get(id));
    if (ctx.names.has(id)) return { kind: 'experiment', name: nameOf(id) }; // listed, not verified
    return entryOf(id, null);
  }
  /** Is a value reference exactly a point of the grid `v` verified? */
  const onGrid = (ref, v) => !!(ref.kind === 'value' && v && v.state === 'ok' && v.frequencies
    && v.frequencies.includes(ref.at.hz));

  /** Why a verification does not let an experiment be linked (null when it does). */
  function linkRefusal(v, label) {
    if (v.state === 'ok') return null;
    if (v.state === 'different') {
      return `Experiment ${label} was replaced in another tab since it was shown here; reopen it.`;
    }
    if (v.state === 'missing') {
      return `Experiment ${label} is not stored here (deleted, perhaps in another tab); only a `
        + 'stored experiment can be linked.';
    }
    if (v.state === 'unreadable') {
      return `Experiment ${label} cannot be read (${v.reason}); it cannot be linked.`;
    }
    return `Experiment ${label} has no result hash, so a finding could not tell it from a `
      + 'different record later; only a completed experiment can be linked.';
  }

  /**
   * Add `refs` to the open form. Each experiment is verified against the hash of the record this
   * page
   * shows for it (`shown`, else experimentsShownHash) and cited with that hash.
   */
  async function link(cmp, refs, shown = null) {
    const f = cmp.fnd.form;
    f.error = '';
    const shownOf = (id) => (shown && Object.prototype.hasOwnProperty.call(shown, id) ? shown[id]
      : typeof cmp.experimentsShownHash === 'function' ? cmp.experimentsShownHash(id) : null);
    for (const ref of refs) {
      const key = refKey(ref);
      if (f.evidence.some((e) => e.key === key)) {
        f.error = `${refText(ref, nameOf)} is already linked.`;
        return false;
      }
      let grid = null;
      for (const id of refExperimentIds(ref)) {
        const v = await cmp.findingsVerifyCitedExperiment(id, shownOf(id));
        const why = linkRefusal(v, nameOf(id) ? `"${nameOf(id)}"` : id);
        if (why) {
          f.error = why;
          return false;
        }
        if (ref.kind === 'value') {
          if (!onGrid(ref, v)) {
            f.error = `${exactHzText(ref.at.hz)} is not a frequency the experiment stores; reopen `
              + 'the experiment.';
            return false;
          }
          grid = v;
        }
        f.experiments = [...f.experiments.filter((r) => r.experimentId !== id), { experimentId: id,
          resultHash: v.resultHash }];
      }
      f.evidence = [...f.evidence, { key, ref, text: refText(ref, nameOf,
        { storedPoint: onGrid(ref, grid) }) }];
    }
    return true;
  }

  /** The first issue of `ref` (citing `experiments`) under fresh verifications, or null. */
  function refIssue(ref, experiments, verified) {
    const probe = { status: 'observation', evidence: [ref], experiments };
    const [x] = findingIssues(probe, (id) => entryOf(id, verified.get(id)));
    return x ? x.text : null;
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
    },

    /**
     * THE verification point (review 3 of #149): experiment `id` as stored now, read fresh (never
     * from a
     * cache), against `citedHash`. { id, state: 'ok' | 'different' | 'unverifiable' |
     * 'unreadable' | 'missing', resultHash, hasResponse, frequencies, name, reason }.
     * 'unverifiable': the cited or the stored hash is missing (with no cited hash it reports the
     * stored identity only).
     */
    async findingsVerifyCitedExperiment(id, citedHash = null) {
      const none = { id, resultHash: null, hasResponse: null, frequencies: null, name: null };
      let x;
      try {
        x = await this.experimentsIdentity(id);
      } catch (err) {
        return { ...none, state: 'unreadable',
          reason: String(err && err.message || err).slice(0, 160) };
      }
      if (!x) return { ...none, state: 'missing' };
      const state = !citedHash || !x.resultHash ? 'unverifiable'
        : x.resultHash === citedHash ? 'ok' : 'different';
      return { id, state, resultHash: x.resultHash, hasResponse: x.hasResponse,
        frequencies: x.frequencies || null, name: x.name };
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
     * After a refused save: load the finding as it is stored now (its fields and updatedAt, so
     * the next save is checked against them). What was typed here and differs is kept beside it
     * to copy: the statement, notes, status and references, always the latest typed. When the
     * finding was deleted elsewhere, the form becomes a new finding holding what was typed.
     */
    async findingsLoadStored() {
      const f = this.fnd.form;
      const s = await this.experimentsStore();
      const now = f.id ? await s.getFinding(f.id).catch(() => null) : null;
      if (!now) {
        Object.assign(f, { mode: 'new', id: null, loadedUpdatedAt: null, conflict: false,
          deleted: false, error: 'This finding was deleted in another tab or window. Save stores '
            + 'what you typed as a new finding, or discard it.' });
        return true;
      }
      const typed = { statement: f.statement.trim(), notes: f.notes.trim(), status: f.status,
        keys: f.evidence.map((e) => e.key).sort().join('|'), texts: f.evidence.map((e) => e.text) };
      if (typed.statement !== now.statement) f.mine = typed.statement;
      if (typed.notes !== (now.notes || '')) f.mineNotes = typed.notes;
      if (typed.status !== now.status) f.mineStatus = STATUS_TEXT[typed.status];
      if (typed.keys !== now.evidence.map(refKey).sort().join('|')) f.mineRefs = typed.texts;
      Object.assign(f, { loadedUpdatedAt: now.updatedAt, statement: now.statement,
        status: now.status, notes: now.notes || '', experiments: plain(now.experiments),
        evidence: await this.findingsFormRefs(now), conflict: false, deleted: false, error: '' });
      f.base = formState(f);
      return true;
    },
    /** What was typed before a refused save, as one text to copy (empty when nothing). */
    findingsMineText() {
      const f = this.fnd.form;
      return [f.mine, f.mineStatus ? `Status: ${f.mineStatus} (your judgement)` : '',
        f.mineRefs.length ? `Evidence: ${f.mineRefs.join('; ')}` : '',
        f.mineNotes ? `Notes: ${f.mineNotes}` : ''].filter(Boolean).join('\n\n');
    },
    /** Drop the draft (the only way a typed finding is discarded without a save). */
    findingsDiscardDraft() {
      this.fnd.form = blankForm();
      this.fnd.draftKept = false;
      this.closeModal(DIALOG);
    },

    /**
     * Read the findings again and check their references against `list` (the experiment rows, as
     * experimentsRefresh read them). Without a list (after a finding is saved, deleted or
     * imported) the whole Experiments list is read again first, so the experiments, the
     * decoded-record
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
      const { findings, unreadable } = await s.listFindings();
      // Every cited experiment that is listed is verified now, fresh from the store.
      const checked = new Map();
      for (const id of new Set(findings.flatMap(citedExperimentIds))) {
        if (ctx.names.has(id)) checked.set(id, await this.findingsVerifyCitedExperiment(id));
      }
      ctx.checked = checked;
      const n = unreadable.length;
      this.fnd.note = n ? `${n} stored finding${n === 1 ? '' : 's'} could not be read and ${
        n === 1 ? 'is' : 'are'} not listed (${unreadable.map((u) => u.id || 'no id').slice(0, 3)
        .join(', ')}).` : null;
      this.fnd.all = plain(findings);
      this.fnd.rows = plain(findings.map((f) => findingRow(f, lookup, nameOf)));
      this.fnd.loaded = true;
      return this.fnd.rows;
    },

    /** How many findings cite experiment `id` (the delete dialog says so). */
    findingsCiting(id) {
      return findingsCiting(this.fnd.all, id).length;
    },
    /**
     * Backlinks of experiment `id`: the findings citing it, with how, and the state of those
     * references
     * as the last check found them (findingIssues). A finding whose cited hash is not the hash of
     * the record shown (`shownHash`, else experimentsShownHash) never reads ok for it.
     */
    findingsBacklinks(id, shownHash) {
      const shown = shownHash !== undefined ? shownHash
        : typeof this.experimentsShownHash === 'function' ? this.experimentsShownHash(id) : null;
      return findingsCiting(this.fnd.all, id, nameOf).map(({ finding, how }) => {
        const row = this.fnd.rows.find((r) => r.id === finding.id);
        const refs = row ? row.evidence.filter((e) => refExperimentIds(e.ref).includes(id)) : [];
        const cited = (finding.experiments.find((r) => r.experimentId === id) || {}).resultHash
          || null;
        let issue = refs.map((e) => e.issue).filter(Boolean).join('; ') || null;
        let state = refs.length && refs.every((e) => e.state === 'ok') ? 'ok' : 'broken';
        if (state === 'ok' && cited !== shown) {
          state = 'broken';
          issue = 'it cites a different record stored earlier under this id, not the one shown';
        }
        return { id: finding.id, statement: finding.statement,
          statusText: STATUS_TEXT[finding.status], how: how.join('; '), state, issue };
      });
    },

    /** Open the dialog: a new finding seeded with `refs`, or `id` to edit. */
    async findingsAskNew(refs = [], id = null, shown = null) {
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
        status: old.status, notes: old.notes || '', experiments: plain(old.experiments),
        evidence: await this.findingsFormRefs(old) } : {});
      this.fnd.form = f;
      if (refs.length && !await link(this, refs, shown)) {
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
    /**
     * A finding about experiment `id`, citing the record this page shows for it (`shownHash`, else
     * experimentsShownHash: the open detail, a compared record or the list row).
     */
    findingsAskRun(id, shownHash) {
      return this.findingsAskNew([{ kind: 'experiment', experimentId: id }], null,
        shownHash !== undefined ? { [id]: shownHash } : null);
    },
    /** The dialog's entries of a stored finding's references, value points verified now. */
    async findingsFormRefs(finding) {
      const hashOf = new Map(finding.experiments.map((r) => [r.experimentId, r.resultHash]));
      const out = [];
      for (const ref of finding.evidence) {
        const v = ref.kind === 'value' ? await this.findingsVerifyCitedExperiment(ref.experimentId,
          hashOf.get(ref.experimentId) || null) : null;
        out.push({ key: refKey(ref), ref: plain(ref), text: refText(ref, nameOf,
          { storedPoint: onGrid(ref, v) }) });
      }
      return out;
    },
    /** A finding about the stored point the open experiment's evidence shows (ADR 0044). */
    findingsAskValue() {
      const d = this.exps.detail;
      const p = d && d.evidence && d.evidence.point;
      return p ? this.findingsAskNew([{ kind: 'value', experimentId: d.id, at: { hz: p.hz } }],
        null) : false; // linked against the detail's record (experimentsShownHash)
    },
    findingsValueLabel() {
      const d = this.exps.detail;
      const p = d && d.evidence && d.evidence.point;
      return p ? `Record a finding about the value at ${exactHzText(p.hz)}` : '';
    },
    /** A finding about the open comparison: A compared with each other experiment. */
    findingsAskCompare() {
      const e = this.exps.compare ? this.exps.compare.entries : [];
      return e.length >= 2 ? this.findingsAskNew(e.slice(1).map((x) => ({ kind: 'compare',
        a: e[0].id, b: x.id }))) : false;
    },
    async findingsAddRun(id) {
      if (!id) return false;
      const ok = await link(this, [{ kind: 'experiment', experimentId: id }]);
      if (ok) this.fnd.form.addRun = '';
      return ok;
    },
    async findingsAddCompare(a, b) {
      if (!a || !b || a === b) {
        this.fnd.form.error = 'Choose two different experiments to link a comparison.';
        return false;
      }
      return link(this, [{ kind: 'compare', a, b }]);
    },
    findingsRemoveRef(i) {
      const f = this.fnd.form;
      f.evidence = f.evidence.filter((x, j) => j !== i);
      // An experiment no longer cited loses its recorded identity: linking it again reads it anew.
      const cited = new Set(f.evidence.flatMap((e) => refExperimentIds(e.ref)));
      f.experiments = f.experiments.filter((r) => cited.has(r.experimentId));
      f.error = '';
    },

    /** Store the dialog's finding; returns it, or null (the reason is in the dialog). */
    async findingsSave() {
      const f = this.fnd.form;
      let saved;
      try {
        const s = await this.experimentsStore();
        const evidence = f.evidence.map((e) => e.ref);
        const cited = new Set(evidence.flatMap(refExperimentIds));
        const fields = { statement: f.statement, status: f.status, notes: f.notes, evidence,
          experiments: f.experiments.filter((r) => cited.has(r.experimentId)) };
        const now = Date.now();
        const old = f.mode === 'edit' ? await s.getFinding(f.id) : null;
        if (f.mode === 'edit' && !old) throw DELETED;
        if (old && old.updatedAt !== f.loadedUpdatedAt) throw CONFLICT;
        const next = old ? updateFinding(old, fields, { now })
          : createFinding({ id: newExperimentId(randomBytes16()), now, ...fields });
        // The store checks the version again inside its write, so two tabs never overwrite.
        saved = await s.putFinding(next, old ? { expectedUpdatedAt: f.loadedUpdatedAt } : {})
          .catch((err) => { throw err && err.code === 'conflict' ? CONFLICT : err; });
      } catch (err) {
        if (err === CONFLICT || err === DELETED) {
          // Deleted or changed elsewhere: the conflict path (Load), never a stale retry.
          const gone = err === DELETED || !(await (await this.experimentsStore())
            .getFinding(f.id).catch(() => null));
          Object.assign(f, { conflict: true, deleted: gone,
            error: gone ? DELETED_ELSEWHERE : CHANGED_ELSEWHERE });
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
    /** Delete finding `id` (the experiments it cites are not touched). */
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

    /**
     * Open what a reference of finding `findingId` names: the experiment, the comparison, or the
     * experiment at
     * the value. Each experiment is verified first against the hash the finding cites; when that no
     * longer holds, nothing is opened, the findings are checked again and the reason is said.
     */
    async findingsOpenRef(ref, findingId = null) {
      const f = (findingId && this.fnd.all.find((x) => x.id === findingId))
        || this.fnd.all.find((x) => x.evidence.some((r) => refKey(r) === refKey(ref))) || null;
      const experiments = f ? f.experiments : [];
      const cited = new Map(experiments.map((r) => [r.experimentId, r.resultHash]));
      const verified = new Map();
      for (const id of refExperimentIds(ref)) {
        verified.set(id, await this.findingsVerifyCitedExperiment(id, cited.get(id) || null));
      }
      const why = refIssue(ref, experiments, verified);
      if (why) {
        await this.findingsRefresh();
        this.notify('warning', 'Not opened', `${why}. The finding's references were checked `
          + 'again.');
        return null;
      }
      if (ref.kind === 'compare') return this.experimentsCompare([ref.a, ref.b]);
      const e = await this.experimentsOpen(ref.experimentId);
      if (e && ref.kind === 'value') this.experimentsEvidenceAt(ref.at.hz);
      return e;
    },

    /**
     * Export every stored finding, each with the identity of the experiments it cites. A stored
     * finding
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
      const absent = [...new Set(p.findings.flatMap(citedExperimentIds))]
        .filter((id) => !ctx.names.has(id)).length;
      this.notify(absent ? 'warning' : 'success', 'Findings imported', `${r.stored.length} `
        + `stored${r.same.length ? `, ${r.same.length} already here` : ''}.${absent ? ` ${absent} `
        + `cited experiment${absent === 1 ? ' is' : 's are'} not stored here; import ${absent === 1
          ? 'it' : 'them'} to check the references.` : ''}`);
      return r.stored.length;
    },
  };
}

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
// identity (its stored result hash, whether it stores a response) is read once per id through
// the experiments store and forgotten when the id leaves the list, so a different record stored
// later under a deleted id is read again and named as different.
//
// Losable work (ADR 0045): a finding being written in the dialog (findingsWhatWouldBeLost); the
// findings the memory fallback holds are reported by experimentsWhatWouldBeLost.

import {
  FINDING_STATUSES, STATUS_TEXT, STATUS_HINT, FINDINGS_FILE_EXTENSION, FINDING_LIMITS,
  createFinding, updateFinding, findingIssues, findingsCiting, refText, refKey, refRunIds,
  citedRunIds, exportFindings, findingsToJson, parseFindingsFile, importPlan, hzText,
} from '../experiments/findings.js';
import { newExperimentId } from '../experiments/schema.js';
import { timestampText } from '../measurement/views/experiment-summary.js';
import { downloadBlob, readFileText } from './exporters.js';
import { randomBytes16 } from './experiments.js';

const DIALOG = 'osc-dlg-finding';
const DELETE_DIALOG = 'osc-dlg-finding-delete';
const plain = (v) => JSON.parse(JSON.stringify(v));
const blankForm = () => ({ open: false, mode: 'new', id: null, statement: '',
  status: 'observation', notes: '', evidence: [], runs: [], base: '', error: '', addRun: '',
  cmpA: '', cmpB: '' });
const formState = (f) => JSON.stringify([f.statement.trim(), f.status, f.notes.trim(),
  f.evidence.map((e) => e.key)]);

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
      return { key: refKey(ref), ref, text: refText(ref, nameOf),
        state: !mine.length ? 'ok' : mine.some((x) => x.code === 'missing-run') ? 'missing'
          : 'broken', issue: mine.length ? mine.map((x) => x.text).join('; ') : null };
    }),
    statusIssue: (issues.find((x) => x.code === 'unsupported-status') || {}).text || null,
  };
}

export function createFindingsUi() {
  const ctx = {
    identity: new Map(), // experimentId -> { resultHash, hasResponse } of a stored run
    names: new Map(),    // experimentId -> name, of the runs listed
    defs: new Map(),     // definition id -> name (a reference to one is the wrong kind)
  };
  const nameOf = (id) => ctx.names.get(id) || null;

  /** The identity of a stored run, read once per id; null when it is not stored. */
  async function identity(cmp, id) {
    if (ctx.identity.has(id)) return ctx.identity.get(id);
    const x = await cmp.experimentsIdentity(id);
    if (x) ctx.identity.set(id, { resultHash: x.resultHash, hasResponse: x.hasResponse });
    return x ? ctx.identity.get(id) : null;
  }

  function lookup(id) {
    if (ctx.names.has(id)) {
      const x = ctx.identity.get(id) || {};
      return { kind: 'run', name: ctx.names.get(id), resultHash: x.resultHash || null,
        hasResponse: x.hasResponse ?? null };
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
        const x = await identity(cmp, id);
        if (!x) {
          f.error = `Run ${id} is not stored here; only a stored run can be linked.`;
          return false;
        }
        f.runs = [...f.runs, { experimentId: id, resultHash: x.resultHash }];
      }
      f.evidence = [...f.evidence, { key, ref, text: refText(ref, nameOf) }];
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
      deleteId: null,
      deleteText: '',
    },

    findingsInit() {
      const dlg = typeof document !== 'undefined' ? document.getElementById(DIALOG) : null;
      // Cancel or Escape discards the draft; until then the unsaved-work guard reports it.
      if (dlg) dlg.addEventListener('close', () => { this.fnd.form.open = false; });
    },

    /** What a reload would lose here: a finding being written (ADR 0045). */
    findingsWhatWouldBeLost() {
      const f = this.fnd.form;
      return f.open && formState(f) !== f.base
        ? [{ domain: 'findings', label: 'A finding being written' }] : [];
    },

    /** Read the findings again and check their references against `list` (the run rows). */
    async findingsRefresh(list = null) {
      const s = await this.experimentsStore();
      const rows = list || await s.list();
      ctx.names = new Map(rows.map((r) => [r.experimentId, r.name || '(unnamed)']));
      ctx.defs = new Map((this.exps.defs || []).map((d) => [d.id, d.name]));
      for (const id of [...ctx.identity.keys()]) if (!ctx.names.has(id)) ctx.identity.delete(id);
      const { findings, unreadable } = await s.listFindings();
      for (const id of new Set(findings.flatMap(citedRunIds))) {
        if (ctx.names.has(id)) await identity(this, id).catch(() => null);
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
      return findingsCiting(this.fnd.all, id).map(({ finding, how }) => ({ id: finding.id,
        statement: finding.statement, statusText: STATUS_TEXT[finding.status],
        how: how.join('; ') }));
    },

    /** Open the dialog: a new finding seeded with `refs`, or `id` to edit. */
    async findingsAskNew(refs = [], id = null) {
      const old = id ? this.fnd.all.find((x) => x.id === id) : null;
      const f = Object.assign(blankForm(), old ? { mode: 'edit', id, statement: old.statement,
        status: old.status, notes: old.notes || '', runs: plain(old.runs),
        evidence: old.evidence.map((ref) => ({ key: refKey(ref), ref: plain(ref),
          text: refText(ref, nameOf) })) } : {});
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
        const next = old ? updateFinding(old, fields, { now: Math.max(now,
          Date.parse(old.updatedAt)) }) : createFinding({ id: newExperimentId(randomBytes16()),
          now, ...fields });
        saved = await s.putFinding(next);
      } catch (err) {
        f.error = (err.message || String(err)).replace(/^Invalid finding: /, '');
        return null;
      }
      f.open = false;
      this.closeModal(DIALOG);
      this.fnd.form = blankForm();
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
      const ok = await this.findingsDeleteNow(this.fnd.deleteId);
      if (ok) this.closeModal(DELETE_DIALOG);
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

    /** Export every stored finding, each with the identity of the runs it cites. */
    async findingsExport() {
      const { findings } = await (await this.experimentsStore()).listFindings();
      const text = findingsToJson(exportFindings(findings, { now: Date.now(),
        oscillaVersion: this.BUILD ? this.BUILD.version : null }));
      downloadBlob(new Blob([`${text}\n`], { type: 'application/json' }),
        `findings${FINDINGS_FILE_EXTENSION}`);
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
      const plan = importPlan(p.findings, (await s.listFindings()).findings);
      if (plan.conflicts.length) {
        return refuse(plan.conflicts.map((id) => `${id} is already stored with different `
          + 'content; nothing was imported'));
      }
      let r;
      try {
        r = await s.putFindings(p.findings);
      } catch (err) {
        return refuse([err.message || String(err)]);
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

// A minimal in-memory IndexedDB for the experiment store tests (src/js/experiments/store.js),
// shared by tests/unit/v3-experiments.test.mjs and v3-experiment-immutable.test.mjs.
// A minimal in-memory IndexedDB: open/upgrade, object stores with keyPath, readonly/readwrite
// transactions with put/get/getAll/delete, async events, rollback on abort, and switches for
// quota errors (on a request, or when the transaction commits) and open failures.
export function fakeIndexedDB() {
  const dbs = new Map();
  const state = { upgrades: [], quota: null, openError: null, throwOnOpen: null };
  const later = (fn) => setImmediate(fn);
  const quotaError = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  class Tx {
    constructor(rec, names, mode) {
      this.rec = rec;
      this.names = names;
      this.mode = mode;
      this.pending = 0;
      this.finished = false;
      this.error = null;
      this.oncomplete = this.onerror = this.onabort = null;
      this.snapshot = new Map([...rec.stores].map(([n, s]) => [n, new Map(s.data)]));
      later(() => this.settle());
    }
    objectStore(name) {
      if (!this.names.includes(name)) throw new DOMException('not in scope', 'NotFoundError');
      const s = this.rec.stores.get(name);
      return {
        put: (value) => this.op(() => {
          if (this.mode !== 'readwrite') throw new DOMException('readonly', 'ReadOnlyError');
          if (state.quota === 'request') throw quotaError();
          s.data.set(value[s.keyPath], structuredClone(value));
          return value[s.keyPath];
        }),
        get: (key) => this.op(() => (s.data.has(key) ? structuredClone(s.data.get(key))
          : undefined)),
        getAll: () => this.op(() => [...s.data.values()].map((v) => structuredClone(v))),
        delete: (key) => this.op(() => {
          if (this.mode !== 'readwrite') throw new DOMException('readonly', 'ReadOnlyError');
          s.data.delete(key);
          return undefined;
        }),
      };
    }
    op(fn) {
      if (this.finished) throw new DOMException('inactive', 'TransactionInactiveError');
      const req = { result: undefined, error: null, onsuccess: null, onerror: null };
      this.pending++;
      later(() => {
        this.pending--;
        if (this.finished) return;
        try {
          req.result = fn();
          if (req.onsuccess) req.onsuccess({ target: req });
        } catch (err) {
          req.error = err;
          const ev = { target: req, prevented: false, preventDefault() { this.prevented = true; } };
          if (req.onerror) req.onerror(ev);
          if (this.onerror) this.onerror(ev);
          if (!ev.prevented) this.abort(err);
        }
        this.settle();
      });
      return req;
    }
    settle() {
      later(() => {
        if (this.finished || this.pending) return;
        if (state.quota === 'commit' && this.mode === 'readwrite') {
          this.abort(quotaError());
          return;
        }
        this.finished = true;
        if (this.oncomplete) this.oncomplete({});
      });
    }
    abort(err = new DOMException('aborted', 'AbortError')) {
      if (this.finished) throw new DOMException('finished', 'InvalidStateError');
      this.finished = true;
      this.error = err;
      for (const [n, data] of this.snapshot) this.rec.stores.get(n).data = data;
      later(() => this.onabort && this.onabort({}));
    }
  }
  const indexedDB = {
    open(name, version) {
      if (state.throwOnOpen) throw state.throwOnOpen;
      const req = { result: null, error: null, transaction: null, onsuccess: null, onerror: null,
        onupgradeneeded: null, onblocked: null };
      later(() => {
        if (state.openError) {
          req.error = state.openError;
          if (req.onerror) req.onerror({ target: req, preventDefault() {} });
          return;
        }
        if (!dbs.has(name)) dbs.set(name, { version: 0, stores: new Map() });
        const rec = dbs.get(name);
        const db = {
          closed: false,
          objectStoreNames: { contains: (n) => rec.stores.has(n) },
          createObjectStore: (n, { keyPath }) => rec.stores.set(n, { keyPath, data: new Map() }),
          transaction: (names, mode = 'readonly') => {
            if (db.closed) throw new DOMException('closed', 'InvalidStateError');
            return new Tx(rec, [].concat(names), mode);
          },
          close: () => { db.closed = true; },
        };
        req.result = db;
        if (version > rec.version) {
          state.upgrades.push([rec.version, version]);
          const oldVersion = rec.version;
          rec.version = version;
          req.transaction = { abort() {} };
          if (req.onupgradeneeded) req.onupgradeneeded({ oldVersion, newVersion: version });
        }
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };
  return { indexedDB, dbs, state };
}

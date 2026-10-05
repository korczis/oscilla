// One bounded operation trace (ADR 0042): a fixed-capacity ring of plain, frozen steps that
// producers report through one narrow port. The trace knows the step schema and nothing about
// who reports: the Studio store, runtime and transport each receive the port at composition
// (ui/studio/workspace.js) and none of them imports another to report.
//
//   createTrace({ cap, now, onIdle }) -> trace   cap: steps kept (TRACE_CAP); the oldest is
//                             dropped and counted. now(): milliseconds for `at` (null without).
//                             onIdle(): called when an operation that recorded a step has ended
//                             (a view refreshes then, not halfway through the operation)
//   trace.run(fn) -> fn()     one operation: the outermost run assigns the correlation id
//                             op-<n> (monotonic per trace); producers called inside it (the
//                             store's commit gate -> transport -> runtime) report under the same
//                             op. A step recorded outside any run is an operation of its own.
//   trace.record(owner, kind, { revision, entity: { kind, id }, outcome, code, detail })
//     -> step
//   trace.steps() -> [step]   oldest first;  trace.stats() -> { cap, size, dropped, ops }
//   NO_TRACE                  the port that records nothing: every producer's default
//
// step = { op, seq, at, owner, kind, revision, entity, outcome, code, detail }, deep-frozen
// plain data: seq is monotonic per trace, `at` is the injected clock (never audio timing),
// revision the store revision the step belongs to (null when it has none), code a Diagnostic
// code (studio/validate.js studioDiagnostic) when the outcome is a refusal or a failure, detail
// a flat object of primitives. The trace records what a producer did or observed, never a
// cause it inferred. It is ephemeral: never persisted, never part of any hash.

/** Steps kept; recording more drops the oldest (counted in stats().dropped). */
export const TRACE_CAP = 256;

export const NO_TRACE = Object.freeze({ run: (fn) => fn(), record: () => null });

/** A frozen copy of `d` whose values are primitives: an object or array value becomes null. */
function flat(d) {
  const o = {};
  for (const k of Object.keys(d)) {
    const v = d[k];
    o[k] = v !== null && typeof v === 'object' ? null : v ?? null;
  }
  return Object.freeze(o);
}

export function createTrace({ cap = TRACE_CAP, now = null, onIdle = null } = {}) {
  const ring = new Array(cap);
  let size = 0;
  let head = 0; // the next slot written
  let seq = 0;
  let ops = 0;
  let dropped = 0;
  let depth = 0;
  let op = null;
  let dirty = false; // the open operation recorded a step

  function run(fn) {
    if (!depth++) op = `op-${++ops}`;
    try {
      return fn();
    } finally {
      if (!--depth) {
        op = null;
        if (dirty && onIdle) onIdle();
        dirty = false;
      }
    }
  }

  function record(owner, kind, f = {}) {
    if (!depth) return run(() => record(owner, kind, f));
    const e = f.entity;
    const step = Object.freeze({ op, seq: ++seq, at: now ? now() : null, owner, kind,
      revision: f.revision ?? null, entity: e ? Object.freeze({ kind: e.kind, id: e.id }) : null,
      outcome: f.outcome || null, code: f.code || null,
      detail: f.detail ? flat(f.detail) : null });
    dirty = true;
    if (size === cap) dropped++;
    else size++;
    ring[head] = step;
    head = (head + 1) % cap;
    return step;
  }

  return Object.freeze({
    run,
    record,
    steps() {
      const out = [];
      for (let i = 0; i < size; i++) out.push(ring[(head - size + i + cap) % cap]);
      return out;
    },
    stats: () => ({ cap, size, dropped, ops }),
  });
}

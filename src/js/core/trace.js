// One bounded operation trace (ADR 0042): a fixed-capacity ring of plain, frozen steps that
// producers report through one narrow port. The trace knows the step schema and nothing about
// who reports: the Studio store, runtime and transport each receive the port at composition
// (ui/studio/workspace.js) and none of them imports another to report.
//
//   createTrace({ cap, now, onIdle }) -> trace   cap: steps kept (TRACE_CAP); the oldest is
//                             dropped and counted. now(): milliseconds for `at` (null without).
//                             onIdle(): called when an operation that recorded a step has ended
//                             (a view refreshes then, not halfway through the operation)
//   trace.run(fn) -> fn()     one operation: producers called inside the outermost run (the
//                             store's commit gate -> transport -> runtime) report under one
//                             correlation id, op-<n>, assigned at its first step (gapless and
//                             monotonic per trace: a run that records nothing is no operation).
//                             A step recorded outside any run is an operation of its own.
//   trace.record(owner, kind, { revision, entity: { kind, id }, outcome, code, detail })
//     -> step
//   trace.steps(settled) -> [step]   oldest first; settled: without the operation still open
//   trace.stats() -> { cap, size, dropped, ops }   ops: operations that recorded a step
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
  let op = null; // the open operation's id, from its first step

  function run(fn) {
    depth++;
    try {
      return fn();
    } finally {
      if (!--depth && op) {
        op = null;
        if (onIdle) onIdle();
      }
    }
  }

  function record(owner, kind, f = {}) {
    if (!depth) return run(() => record(owner, kind, f));
    const e = f.entity;
    op ||= `op-${++ops}`;
    const step = Object.freeze({ op, seq: ++seq, at: now ? now() : null, owner, kind,
      revision: f.revision ?? null, entity: e ? Object.freeze({ kind: e.kind, id: e.id }) : null,
      outcome: f.outcome || null, code: f.code || null,
      detail: f.detail ? flat(f.detail) : null });
    if (size === cap) dropped++;
    else size++;
    ring[head] = step;
    head = (head + 1) % cap;
    return step;
  }

  return Object.freeze({
    run,
    record,
    steps(settled = false) {
      const out = [];
      for (let i = 0; i < size; i++) out.push(ring[(head - size + i + cap) % cap]);
      return settled && op ? out.filter((x) => x.op !== op) : out;
    },
    stats: () => ({ cap, size, dropped, ops }),
  });
}

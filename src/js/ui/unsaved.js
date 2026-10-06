// Unsaved-work guard (ADR 0045): the browser asks before a reload, a closed tab or a navigation
// away from the page would lose work. Each domain reports its own unsaved state through one
// small interface, `whatWouldBeLost() -> [{ domain, label }]`; the guard only aggregates those
// lists and decides nothing itself. A `beforeunload` listener exists ONLY while the list is
// non-empty: a clean page registers none (browsers penalise an always-on handler, and it must
// never fire on a clean page). The native prompt shows no custom text; each domain shows its
// own visible indicator (Studio "unsaved changes", MEASURE "unsaved result").
//
// Back and Forward between workspaces are same-document traversals (ui/navigation.js) and never
// fire beforeunload; only leaving the page does.
//
//   collectUnsaved(sources) -> [{ domain, label }]          (sources: functions returning lists)
//   createUnsavedGuard({ win, sources }) -> { update(), armed, lost }

/** Every entry the sources report, in source order; a source that throws reports nothing. */
export function collectUnsaved(sources) {
  const out = [];
  for (const source of sources) {
    let list = [];
    try {
      list = source() || [];
    } catch (e) {
      console.error('OSCILLA: an unsaved-work source failed:', e);
      list = [];
    }
    for (const item of list) {
      if (item && typeof item.domain === 'string' && typeof item.label === 'string') {
        out.push({ domain: item.domain, label: item.label });
      }
    }
  }
  return out;
}

/** The listener: the browser shows its own prompt (preventDefault; returnValue for WebKit). */
function onBeforeUnload(e) {
  e.preventDefault();
  e.returnValue = '';
  return '';
}

/**
 * The guard. update() re-reads the sources and adds or removes the one listener; call it from a
 * reactive effect so it follows every source. `lost` is the last list read.
 */
export function createUnsavedGuard({ win = typeof window !== 'undefined' ? window : null,
  sources = [] } = {}) {
  let armed = false;
  let lost = [];
  return {
    update() {
      lost = collectUnsaved(sources);
      const want = lost.length > 0;
      if (want !== armed && win) {
        if (want) win.addEventListener('beforeunload', onBeforeUnload);
        else win.removeEventListener('beforeunload', onBeforeUnload);
        armed = want;
      }
      return lost;
    },
    get armed() { return armed; },
    get lost() { return lost.map((x) => ({ ...x })); },
  };
}

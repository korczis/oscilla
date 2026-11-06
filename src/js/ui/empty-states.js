// The empty-state predicates (lane A wave 3): a workspace's `empty` field in the registry
// (ui/shell.js WORKSPACE_REGISTRY) names a predicate, and the adapter that owns the data the
// predicate reads registers it here under that name (presets.noCustom: ui/workbench.js). The
// page's empty-state block (src/index.html, a Flowbite Pro empty state: heading, text and one
// primary action) shows only while its predicate is true. A name nobody registered is false,
// so an unregistered `when` shows nothing; tests/unit/workspace-registry.test.mjs requires every
// `when` of the registry to be registered.

const PREDICATES = new Map();

/** Register predicate `name`: fn(component) -> boolean. A name is registered once. */
export function registerEmptyPredicate(name, fn) {
  if (typeof name !== 'string' || !/^[a-z]+\.[A-Za-z]+$/.test(name)) {
    throw new TypeError(`empty-state predicate name "${name}" is not <adapter>.<state>`);
  }
  if (typeof fn !== 'function') throw new TypeError(`empty-state predicate ${name}: no function`);
  if (PREDICATES.has(name) && PREDICATES.get(name) !== fn) {
    throw new Error(`empty-state predicate ${name} is registered twice`);
  }
  PREDICATES.set(name, fn);
}

/** The registered predicate names, sorted. */
export function emptyPredicateNames() {
  return [...PREDICATES.keys()].sort();
}

/** Whether predicate `name` holds for the component; false for an unknown name or a throw. */
export function emptyPredicateHolds(name, component) {
  const fn = PREDICATES.get(name);
  if (!fn) return false;
  try {
    return fn(component) === true;
  } catch {
    return false;
  }
}

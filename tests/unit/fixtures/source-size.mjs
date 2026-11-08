// The source-size budget's default cap: a tracked file at or below it has no entry in
// tests/unit/source-size-baseline.json. One home for the budget test and the headroom tests
// that read the same caps (R050).
export const UNCAPPED = 40_000;

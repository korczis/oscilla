// The output owner as the UI layer has always imported it: the playback bus and its one table
// live in src/js/core/output-bus.js (C037), where every layer may read them without an import
// edge into ui/. Nothing is declared here (tests/unit/output-owner-one-table.test.mjs).
export * from '../core/output-bus.js';

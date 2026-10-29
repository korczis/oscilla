#!/usr/bin/env node
// Write the Flowbite Pro record (rule project.ui-uses-flowbite-pro, ADR 0061) from the tree:
// tests/unit/ui-flowbite-pro-baseline.json, measured by treeMeasure of
// scripts/ui-flowbite-pro-measure.mjs, whose definitions the header of
// tests/unit/ui-flowbite-pro.test.mjs states. The record's rule, note and measured block are
// kept; every count is the tree's. A migration runs this and commits the lowered record; the
// test then judges it against the base branch's versions, so writing never excuses a rise.
//
//   node scripts/ui-flowbite-pro-record.mjs            write the record from the tree
//   node scripts/ui-flowbite-pro-record.mjs --check    exit 1 when the file differs
//     --record <path>     the record file (default tests/unit/ui-flowbite-pro-baseline.json)
//     --measured <sha>    a new measure is first taken: rewrite the measured block at <sha>
//     --note <text>       replace the note
// Exit 0 on success, 1 when --check finds a difference, 2 on a bad flag or a record of
// another measure without --measured.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  BASELINE_REL, MEASURE, ROOT, recordOf, recordProblems, recordText, treeMeasure,
} from './ui-flowbite-pro-measure.mjs';

const USAGE = 'usage: node scripts/ui-flowbite-pro-record.mjs [--check] [--record <path>] '
  + '[--measured <commit>] [--note <text>]';

function parse(argv) {
  const opts = { check: false, record: path.join(ROOT, BASELINE_REL) };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (['--record', '--measured', '--note'].includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      opts[a.slice(2)] = a === '--record' ? path.resolve(v) : v;
      i += 1;
    } else throw new Error(`unknown argument ${a}`);
  }
  if (opts.measured && !/^[0-9a-f]{40}$/.test(opts.measured)) {
    throw new Error('--measured takes a full 40-character commit');
  }
  return opts;
}

let opts;
try {
  opts = parse(process.argv.slice(2));
} catch (e) {
  console.error(`${e.message}\n${USAGE}`);
  process.exit(2);
}
if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}

const text = existsSync(opts.record) ? readFileSync(opts.record, 'utf8') : null;
const previous = text ? JSON.parse(text) : {};
if (!opts.measured && previous.measure !== MEASURE) {
  console.error(`the record is of measure ${previous.measure}, the measure is ${MEASURE}: pass `
    + '--measured <commit> to take the new measure');
  process.exit(2);
}
const m = treeMeasure();
const next = recordText(recordOf(m, previous, { note: opts.note, measured: opts.measured }));

if (opts.check) {
  if (next === text) {
    console.log(`the record equals the tree (measure ${MEASURE}, debt ${m.debt})`);
    process.exit(0);
  }
  const problems = text ? recordProblems(m, previous) : [`${opts.record}: no record`];
  console.error(`the record differs from the tree; run node scripts/ui-flowbite-pro-record.mjs`
    + `:\n  ${(problems.length ? problems : ['its text differs (the note, the measured block '
      + 'or the format)']).join('\n  ')}`);
  process.exit(1);
}
writeFileSync(opts.record, next);
console.log(`wrote ${path.relative(ROOT, opts.record) || opts.record}: measure ${MEASURE}, debt `
  + `${m.debt}, ${m.pending.length} pending, ${m.migrated.length} migrated`);

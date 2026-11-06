#!/usr/bin/env node
// The undeclared section of tests/unit/ui-catalog-allowance.json (plan issue G001): exactly the
// literal data-osc hooks of the census that the catalogue does not declare, sorted by id, each
// with its family's reason. An entry already in the file keeps its reason. The other sections
// (untraced, J002; unlinked, J004) are kept as they are.
//
//   node scripts/ui-catalog/allowance.mjs            print the file it would write
//   node scripts/ui-catalog/allowance.mjs --write    write it
//
// It only ever lists what is undeclared now: tests/unit/ui-catalog.test.mjs then refuses an entry
// that is new to the section or a section that grew, so a new hook is declared, never allowed.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ALLOWANCE_REL, ROOT } from './check.mjs';
import { scanHooks } from './scan.mjs';

/** The family of a hook: its first segment, or its first two for the large studio family. */
export function familyOf(hook) {
  const parts = hook.split('.');
  if (parts[0] === 'studio' && parts.length > 2) return `${parts[0]}.${parts[1]}`;
  return parts[0].split('-')[0];
}

/** One reason per family. */
export const reasonFor = (family) => `The ${family} hooks are not declared yet; a later `
  + 'catalogue slice declares them.';

/** The allowance with its undeclared section recomputed from the census and the catalogue. */
export function undeclaredAllowance({ census, catalog, previous = {} }) {
  const kept = new Map((previous.undeclared || []).map((e) => [e.id, e.reason]));
  const undeclared = [...census.literals.keys()].filter((h) => !catalog.covers(h)).sort()
    .map((id) => ({ id, reason: kept.get(id) || reasonFor(familyOf(id)) }));
  return { ...previous, undeclared };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { CATALOG } = await import(pathToFileURL(path.join(ROOT,
    'src/js/ui/catalog/registry.js')).href);
  const file = path.join(ROOT, ALLOWANCE_REL);
  const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const next = undeclaredAllowance({ census: scanHooks(ROOT), catalog: CATALOG, previous });
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (process.argv.includes('--write')) {
    writeFileSync(file, text);
    console.log(`${ALLOWANCE_REL}: ${next.undeclared.length} undeclared hooks`);
  } else process.stdout.write(text);
}

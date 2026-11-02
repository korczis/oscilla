// The shell markup the unit tests scan: src/index.html, then any build-time partials under
// src/partials/ in name order. One reader for every test that reads the assembled shell
// (E040; it was written twice, in about-origin and positioning-consistency).
//
// A stand-in for E005's assembler: E005 (M046, shell partials) concatenates partials in a
// fixed order of scripts/build.mjs, which may not be name order. When E005 lands, this module
// re-exports the build's assembler (or is deleted), so a test reads exactly what is built.

import { existsSync, readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

/** The shell markup: src/index.html, then any build-time partials (E005), in name order. */
export function shellMarkup() {
  const parts = [read('src/index.html')];
  const dir = new URL('src/partials/', root);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.html')).sort()) {
      parts.push(read(`src/partials/${f}`));
    }
  }
  return parts.join('\n');
}

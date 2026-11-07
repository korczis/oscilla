// A mutation fixture reads the workflow's own value, never a copy of it (R050). Fixtures that
// typed `timeout-minutes: 60` or the Playwright image tag beside the workflow broke on every
// bump and needed a second hand edit (da69095e after #443).
import assert from 'node:assert/strict';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The first `timeout-minutes: N` line right after `before`, searched from `from`:
 *  { at, text (before included), n }. */
export function bound(text, before, from = 0) {
  const re = new RegExp(`${esc(before)}timeout-minutes: (\\d+)\\n`, 'g');
  re.lastIndex = from;
  const m = re.exec(text);
  assert.ok(m, `the workflow has a timeout-minutes right after ${JSON.stringify(before)}`);
  return { at: m.index, text: m[0], n: Number(m[1]) };
}

/** `text` with that bound set to `to(n)`, or the line removed when `to` returns null. */
export function setBound(text, before, to, from = 0) {
  const b = bound(text, before, from);
  const v = to(b.n);
  // Removed: `before` keeps its text but not the indentation it gave the removed line.
  const line = v === null ? before.replace(/ +$/, '') : `${before}timeout-minutes: ${v}\n`;
  return text.slice(0, b.at) + line + text.slice(b.at + b.text.length);
}

/** Where job `id` starts in a workflow text. */
export function jobAt(text, id) {
  const i = text.indexOf(`\n  ${id}:\n`);
  assert.ok(i >= 0, `the workflow has job ${id}`);
  return i;
}

/** The Playwright container image the workflow pins (mcr.microsoft.com/playwright:vX-noble). */
export function playwrightImage(text) {
  const m = text.match(/playwright:v\d+\.\d+\.\d+-[a-z]+/);
  assert.ok(m, 'the workflow pins a Playwright image');
  return m[0];
}

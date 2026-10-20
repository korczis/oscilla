// The ADR index names every accepted ADR (plan issue E020, intent engineering-integrity
// criterion adr-index-complete; review verdict .ai/repo/reviews/198.yaml, R-5 and R-6).
//
// .ai/repo/adrs/README.md carries, under '## The accepted decisions by name', one table row per
// ADR whose front matter says `status: accepted`: the ADR number linked to its file, its title,
// the date of its acceptance note (the latest '### YYYY-MM-DD: accepted ...' heading under
// '## Resolution notes') and whether its '## Decision' section still opens with 'Proposed'
// (yes or no). The check fails when an accepted ADR is missing from the list, when the list
// names an ADR that is not accepted (or does not exist), when a row's link, title or date
// differs from the file, and when the 'Proposed' mark differs from the decision text.
//
// The fixture cases prove each failure on fixture ADRs; the last case runs over the real tree.
//   node --test tests/unit/adr-accepted-list.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ADR_DIR = path.join(ROOT, '.ai', 'repo', 'adrs');
const LIST_HEADING = '## The accepted decisions by name';
const ADR_FILE = /^(\d{4})-[\w.-]+\.md$/;

/** A scalar of the front matter, unquoted ('…' with '' escapes, "…" with \" escapes). */
function scalar(frontMatter, key) {
  const m = frontMatter.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  if (!m) return null;
  const v = m[1].trim();
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"');
  return v;
}

/** The lines of the section opened by `heading` (an exact line), up to the next one as deep. */
function section(lines, heading) {
  const start = lines.indexOf(heading);
  if (start < 0) return null;
  const depth = heading.match(/^#+/)[0].length;
  const out = [];
  for (const line of lines.slice(start + 1)) {
    const h = line.match(/^(#+) /);
    if (h && h[1].length <= depth) break;
    out.push(line);
  }
  return out;
}

/** What the list must say about one ADR file. */
export function readAdr(file, text) {
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  const frontMatter = fm ? fm[1] : '';
  const lines = text.split('\n');
  const decision = section(lines, '## Decision');
  const opening = decision ? decision.find((l) => l.trim() !== '') : undefined;
  const notes = section(lines, '## Resolution notes') || [];
  const accepted = notes
    .map((l) => l.match(/^### (\d{4}-\d{2}-\d{2}): accepted\b/))
    .filter(Boolean)
    .map((m) => m[1])
    .sort();
  return {
    number: file.match(ADR_FILE)[1],
    file,
    status: scalar(frontMatter, 'status'),
    title: scalar(frontMatter, 'title'),
    hasDecision: decision !== null,
    proposed: opening !== undefined && /^Proposed\b/.test(opening.trim()),
    acceptedOn: accepted.length ? accepted[accepted.length - 1] : null,
  };
}

export function readAdrs(dir) {
  return readdirSync(dir)
    .filter((f) => ADR_FILE.test(f))
    .sort()
    .map((f) => readAdr(f, readFileSync(path.join(dir, f), 'utf8')));
}

/** The rows of the README's list: | [NNNN](file) | title | YYYY-MM-DD | yes/no |. */
export function readList(readme) {
  const lines = section(readme.split('\n'), LIST_HEADING);
  if (lines === null) {
    return { rows: [], problems: [`the README has no '${LIST_HEADING}' section`] };
  }
  const rows = [];
  const problems = [];
  const table = lines.filter((l) => l.startsWith('|'));
  for (const line of table.slice(2)) { // header and separator
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const link = cells[0] && cells[0].match(/^\[(\d{4})\]\(([^)]+)\)$/);
    if (cells.length !== 4 || !link) {
      problems.push(`row is not | [NNNN](file) | title | date | yes/no |: ${line}`);
      continue;
    }
    rows.push({ number: link[1], file: link[2], title: cells[1], date: cells[2], mark: cells[3] });
  }
  return { rows, problems };
}

/** Every difference between the list and the ADR files, one message each. */
export function checkList(adrs, readme) {
  const { rows, problems } = readList(readme);
  const byNumber = new Map(adrs.map((a) => [a.number, a]));
  const listed = new Set();
  for (const row of rows) {
    const adr = byNumber.get(row.number);
    if (listed.has(row.number)) problems.push(`${row.number}: listed twice`);
    listed.add(row.number);
    if (!adr) { problems.push(`${row.number}: listed, but no such ADR file`); continue; }
    if (adr.status !== 'accepted') {
      problems.push(`${row.number}: listed, but its status is ${adr.status}, not accepted`);
      continue;
    }
    if (row.file !== adr.file) problems.push(`${row.number}: links ${row.file}, not ${adr.file}`);
    if (row.title !== adr.title) {
      problems.push(`${row.number}: title '${row.title}', not '${adr.title}'`);
    }
    if (!adr.acceptedOn) problems.push(`${row.number}: accepted, but has no dated acceptance note`);
    else if (row.date !== adr.acceptedOn) {
      problems.push(`${row.number}: dated ${row.date}, `
        + `but its acceptance note is ${adr.acceptedOn}`);
    }
    if (!adr.hasDecision) problems.push(`${row.number}: has no '## Decision' section`);
    const want = adr.proposed ? 'yes' : 'no';
    if (row.mark !== want) {
      problems.push(`${row.number}: marked '${row.mark}' for opening with 'Proposed', `
        + `but its decision ${adr.proposed ? 'does' : 'does not'} (want '${want}')`);
    }
  }
  for (const adr of adrs) {
    if (adr.status === 'accepted' && !listed.has(adr.number)) {
      problems.push(`${adr.number}: accepted, but missing from the list`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------- fixtures

function adrText({ status, title, decision, accepted = [] }) {
  const notes = accepted.map((d) => `### ${d}: accepted by the owner\n\nNote.\n`).join('\n');
  return `---\nschema: adr/v1\nid: adr-x\nkind: adr\ntitle: ${title}\nstatus: ${status}\n`
    + `date: 2026-10-01\n---\n\n# X\n\n## Context\n\nC.\n\n## Decision\n\n${decision}\n\n`
    + `- Point.\n\n## Consequences\n\nQ.\n\n## Resolution notes\n\n${notes}`;
}

const FIXTURE = {
  '0001-plain.md': adrText({ status: 'accepted', title: 'Plain decision',
    decision: 'We do it.', accepted: ['2026-10-18'] }),
  '0002-proposed.md': adrText({ status: 'accepted', title: '"Quoted: a decision"',
    decision: 'Proposed (being implemented):', accepted: ['2026-10-05', '2026-10-18'] }),
  '0003-open.md': adrText({ status: 'proposed', title: 'Still open', decision: 'Proposed:' }),
};

const README_ROWS = [
  '| [0001](0001-plain.md) | Plain decision | 2026-10-18 | no |',
  '| [0002](0002-proposed.md) | Quoted: a decision | 2026-10-18 | yes |',
];

function readmeWith(rows) {
  return `# Architecture decisions\n\nIntro.\n\n${LIST_HEADING}\n\nText.\n\n`
    + `| ADR | Decision | Accepted | Opens with 'Proposed' |\n| --- | --- | --- | --- |\n`
    + `${rows.join('\n')}\n\n## Next section\n\n| a | b |\n| --- | --- |\n| x | y |\n`;
}

function withFixture(files, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'adr-accepted-list-'));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
    return fn(readAdrs(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('fixture: a complete and correct list passes', () => {
  withFixture(FIXTURE, (adrs) => {
    assert.deepEqual(checkList(adrs, readmeWith(README_ROWS)), []);
  });
});

test('fixture: an accepted ADR missing from the list fails', () => {
  withFixture(FIXTURE, (adrs) => {
    const problems = checkList(adrs, readmeWith([README_ROWS[0]]));
    assert.deepEqual(problems, ['0002: accepted, but missing from the list']);
  });
});

test('fixture: a listed ADR that is not accepted fails', () => {
  withFixture(FIXTURE, (adrs) => {
    const rows = [...README_ROWS, '| [0003](0003-open.md) | Still open | 2026-10-18 | yes |'];
    assert.deepEqual(checkList(adrs, readmeWith(rows)),
      ['0003: listed, but its status is proposed, not accepted']);
  });
});

test('fixture: a listed ADR that does not exist fails', () => {
  withFixture(FIXTURE, (adrs) => {
    const rows = [...README_ROWS, '| [0009](0009-gone.md) | Gone | 2026-10-18 | no |'];
    assert.deepEqual(checkList(adrs, readmeWith(rows)), ['0009: listed, but no such ADR file']);
  });
});

test('fixture: a Proposed mark that differs from the decision text fails, both ways', () => {
  withFixture(FIXTURE, (adrs) => {
    const missing = [README_ROWS[0], README_ROWS[1].replace('| yes |', '| no |')];
    assert.match(checkList(adrs, readmeWith(missing)).join('\n'),
      /^0002: marked 'no' .* but its decision does \(want 'yes'\)$/);
    const extra = [README_ROWS[0].replace('| no |', '| yes |'), README_ROWS[1]];
    assert.match(checkList(adrs, readmeWith(extra)).join('\n'),
      /^0001: marked 'yes' .* but its decision does not \(want 'no'\)$/);
  });
});

test('fixture: a wrong acceptance date, title or link fails', () => {
  withFixture(FIXTURE, (adrs) => {
    const date = [README_ROWS[0], README_ROWS[1].replace('2026-10-18', '2026-10-05')];
    assert.deepEqual(checkList(adrs, readmeWith(date)),
      ['0002: dated 2026-10-05, but its acceptance note is 2026-10-18']);
    const title = [README_ROWS[0].replace('Plain decision', 'Plain'), README_ROWS[1]];
    assert.deepEqual(checkList(adrs, readmeWith(title)),
      ["0001: title 'Plain', not 'Plain decision'"]);
    const link = [README_ROWS[0].replace('(0001-plain.md)', '(0001-other.md)'), README_ROWS[1]];
    assert.deepEqual(checkList(adrs, readmeWith(link)),
      ['0001: links 0001-other.md, not 0001-plain.md']);
  });
});

test('fixture: an accepted ADR without an acceptance note, or without the list, fails', () => {
  const files = { ...FIXTURE,
    '0004-undated.md': adrText({ status: 'accepted', title: 'Undated', decision: 'Do.' }) };
  withFixture(files, (adrs) => {
    const rows = [...README_ROWS, '| [0004](0004-undated.md) | Undated | 2026-10-18 | no |'];
    assert.deepEqual(checkList(adrs, readmeWith(rows)),
      ['0004: accepted, but has no dated acceptance note']);
    assert.match(checkList(adrs, '# Architecture decisions\n')[0], /has no '## The accepted/);
  });
});

test('the README lists every accepted ADR of .ai/repo/adrs with its date and Proposed mark', () => {
  const adrs = readAdrs(ADR_DIR);
  assert.ok(adrs.some((a) => a.status === 'accepted'), 'no accepted ADR found');
  const readme = readFileSync(path.join(ADR_DIR, 'README.md'), 'utf8');
  assert.deepEqual(checkList(adrs, readme), []);
});

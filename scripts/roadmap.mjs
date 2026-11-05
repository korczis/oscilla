#!/usr/bin/env node
// node scripts/roadmap.mjs [--check] — src/data/roadmap.json, the open milestones of the plan
// that About's "What comes next" shows (U002, docs/ui-audit.md A15).
//
// The plan is .ai/repo/project, and its derived state is Majordomus's: this reads
// `majordomus plan roadmap --json` (milestones in the plan's derived order, each with its
// status and its issue counts) and keeps every milestone whose status is neither DONE nor
// CANCELLED, as { id, title, done, required, phase }: its title, how many of its required
// issues are done (the progress `majordomus plan status` prints) and its phase from its
// derived status (ACTIVE and VERIFY now, PLANNED next, BLOCKED later), and names its release:
// package.json's version, which release:prepare has bumped before it runs this (U086), so the
// page says which release the list describes. About shows now and next and folds later behind
// its count, because a list of every open milestone on the first screen shows nothing
// (Majordomus curated knowledge a-generator-that-can-list-everything-shows-everything,
// 2026-10-18).
//
// The build reads src/ and never .ai/, so the page carries the roadmap as of the last time it
// was written, and a plan-only commit changes neither this file nor dist. release:prepare runs
// this script before its build, so each release ships the plan as it stood, and its gate runs
// tests/unit/about-current.test.mjs with OSC_ROADMAP_CHECK=1, which refuses a roadmap that
// differs from the plan.
//
//   node scripts/roadmap.mjs           write src/data/roadmap.json
//   node scripts/roadmap.mjs --check   exit 1 and name each difference when it is stale
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, parseSemver, readVersion } from './release-metadata.mjs';

export const ROADMAP_REL = 'src/data/roadmap.json';
export const SCHEMA = 'oscilla-roadmap/v2';
export const CLOSED = ['DONE', 'CANCELLED'];
export const FIELDS = ['id', 'title', 'done', 'required', 'phase'];
/** The phase of an open milestone by its derived status; a status not named here is next. */
export const PHASE_OF = { ACTIVE: 'now', VERIFY: 'now', PLANNED: 'next', BLOCKED: 'later' };
export const PHASES = ['now', 'next', 'later'];
export const NOTE = 'The open milestones of the plan (.ai/repo/project) in its derived order, '
  + 'each with how many of its required issues are done and its phase (now, next, later), as '
  + '`majordomus plan roadmap --json` gave them, as of release (package.json\'s version). '
  + 'Written by scripts/roadmap.mjs, which release:prepare runs before its build; About '
  + 'renders it from the bundle. Do not edit by hand.';

/** The plan as Majordomus derives it: `majordomus plan roadmap --json` run in `root`. */
export function planRoadmap(root = ROOT) {
  const r = spawnSync('majordomus', ['plan', 'roadmap', '--json'],
    { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`majordomus plan roadmap --json: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`majordomus plan roadmap --json exited ${r.status}: `
      + `${(r.stderr || '').trim()}`);
  }
  const plan = JSON.parse(r.stdout);
  if (!plan || !Array.isArray(plan.milestones)) {
    throw new Error('majordomus plan roadmap --json gave no milestones list');
  }
  return plan;
}

const isOpen = (m) => !CLOSED.includes(m.status);
const doneOf = (m) => Number(m.issues?.by_status?.DONE ?? 0);
const requiredOf = (m) => Number(m.issues?.required ?? 0);
const phaseOf = (m) => PHASE_OF[m.status] ?? 'next';

/**
 * The roadmap of `plan` at `release`: its open milestones, in its order, with their progress.
 */
export function roadmapFromPlan(plan, release = readVersion()) {
  return {
    schema: SCHEMA,
    release,
    note: NOTE,
    milestones: plan.milestones.filter(isOpen).map((m) => ({
      id: m.id, title: m.title, done: doneOf(m), required: requiredOf(m), phase: phaseOf(m),
    })),
  };
}

/** What is wrong with the shape of `roadmap` (empty = nothing). */
export function roadmapShapeProblems(roadmap) {
  if (!roadmap || typeof roadmap !== 'object') return ['the roadmap is not an object'];
  const problems = [];
  if (roadmap.schema !== SCHEMA) problems.push(`schema is ${roadmap.schema}, not ${SCHEMA}`);
  if (!parseSemver(roadmap.release)) {
    problems.push(`release ${roadmap.release} is not a version X.Y.Z or X.Y.Z-rc.N`);
  }
  if (!Array.isArray(roadmap.milestones)) return [...problems, 'milestones is not a list'];
  roadmap.milestones.forEach((m, i) => {
    const at = `milestone ${i + 1}`;
    if (!/^M\d{3,}$/.test(m?.id ?? '')) problems.push(`${at}: id ${m?.id} is not a milestone id`);
    if (typeof m?.title !== 'string' || !m.title.trim()) problems.push(`${at}: no title`);
    for (const k of ['done', 'required']) {
      if (!Number.isInteger(m?.[k]) || m[k] < 0) problems.push(`${at}: ${k} is not a count`);
    }
    if (m?.done > m?.required) problems.push(`${at}: done ${m.done} > required ${m.required}`);
    if (!PHASES.includes(m?.phase)) problems.push(`${at}: phase ${m?.phase} is not a phase`);
    const extra = Object.keys(m || {}).filter((k) => !FIELDS.includes(k));
    if (extra.length) problems.push(`${at}: unknown field ${extra.join(', ')}`);
  });
  return problems;
}

/**
 * How `roadmap` differs from the open milestones of `plan` (empty = it is current): a
 * milestone the plan has closed or does not have, an open one it omits, a title or progress
 * that differs, the order.
 */
export function roadmapProblems(roadmap, plan) {
  const shape = roadmapShapeProblems(roadmap);
  if (shape.length) return shape;
  const want = roadmapFromPlan(plan).milestones;
  const byId = new Map(plan.milestones.map((m) => [m.id, m]));
  const problems = [];
  for (const m of roadmap.milestones) {
    const p = byId.get(m.id);
    if (!p) problems.push(`the roadmap lists ${m.id}, which the plan has not`);
    else if (!isOpen(p)) problems.push(`the roadmap lists ${m.id}, which the plan has ${p.status}`);
    else {
      if (m.title !== p.title) {
        problems.push(`${m.id}: the roadmap says "${m.title}", the plan "${p.title}"`);
      }
      if (m.done !== doneOf(p) || m.required !== requiredOf(p)) {
        problems.push(`${m.id}: the roadmap says ${m.done}/${m.required} done, the plan `
          + `${doneOf(p)}/${requiredOf(p)}`);
      }
      if (m.phase !== phaseOf(p)) {
        problems.push(`${m.id}: the roadmap says ${m.phase}, the plan ${phaseOf(p)} (${p.status})`);
      }
    }
  }
  const listed = new Set(roadmap.milestones.map((m) => m.id));
  for (const m of want) {
    if (!listed.has(m.id)) problems.push(`the roadmap omits open milestone ${m.id}`);
  }
  const order = roadmap.milestones.map((m) => m.id).filter((id) => want.some((m) => m.id === id));
  const planOrder = want.map((m) => m.id).filter((id) => order.includes(id));
  if (order.join() !== planOrder.join()) {
    problems.push(`the roadmap is not in the plan order: ${order.join(', ')}`);
  }
  return problems;
}

/** The file's bytes: two-space JSON and a final newline. */
export const serialize = (roadmap) => `${JSON.stringify(roadmap, null, 2)}\n`;

export function main(argv = process.argv.slice(2), root = ROOT) {
  const unknown = argv.filter((a) => a !== '--check');
  if (unknown.length) {
    console.error(`roadmap: unknown argument ${unknown[0]}\n`
      + 'usage: node scripts/roadmap.mjs [--check]');
    return 2;
  }
  const file = path.join(root, ROADMAP_REL);
  const plan = planRoadmap(root);
  if (argv.includes('--check')) {
    let committed;
    try {
      committed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.error(`roadmap: ${ROADMAP_REL} cannot be read: ${e.message}`);
      return 1;
    }
    const problems = roadmapProblems(committed, plan);
    for (const p of problems) console.error(`roadmap: ${p}`);
    if (problems.length) console.error('roadmap: stale; refresh it with node scripts/roadmap.mjs');
    else console.log(`roadmap: ${ROADMAP_REL} lists the plan's open milestones`);
    return problems.length ? 1 : 0;
  }
  const roadmap = roadmapFromPlan(plan, readVersion(root));
  writeFileSync(file, serialize(roadmap));
  console.log(`roadmap: wrote ${ROADMAP_REL} (${roadmap.milestones.length} open milestones, `
    + `v${roadmap.release})`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main();
}

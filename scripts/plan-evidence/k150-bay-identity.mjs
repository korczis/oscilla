#!/usr/bin/env node
// Plan evidence for K150's criterion 2 ("the Synth bay's markup is identical to before"): the
// Synth bay that synth/view/bay.js draws at two revisions, compared byte for byte over six widths
// and every jack state. Each case is one whole SVG: every jack in one state ('free',
// 'normalled', 'patched', 'mixed', 'open'), a pending connection with its verdicts, compatible
// set, cables of every port type and a selected cable, and the cables alone.
//
//   node scripts/plan-evidence/k150-bay-identity.mjs [<before-rev> [<after-rev>]]
//     defaults: d59d883b^ (before the move) and d59d883b (the move, PR K150)
//   exit 0: every case identical; 1: a case differs (named); 2: a revision cannot be read.
//
// Each revision's src/js is read with git archive into a temporary directory, so it runs on any
// checkout with history (not in fail-first's history-less tree).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WIDTHS = [320, 360, 376, 390, 768, 1280];
export const STATES = ['free', 'normalled', 'patched', 'mixed', 'open'];

/** Every case's SVG for the tree whose src/js is under `root`. */
export async function bayCases(root) {
  const imp = (rel) => import(pathToFileURL(join(root, rel)).href);
  const PANEL = (await imp('src/js/synth/panels/semi-mono.js')).default;
  const bay = await imp('src/js/synth/view/bay.js');
  const { panelTokens } = await imp('src/js/synth/view/tokens.js');
  const tokens = panelTokens(null);
  const out = new Map();
  for (const w of WIDTHS) {
    const layout = bay.bayLayout(PANEL, w);
    const jacks = [...layout.jacks.values()].map((v) => v.jack);
    const outs = jacks.filter((j) => j.direction === 'out');
    const ins = jacks.filter((j) => j.direction === 'in');
    const cables = outs.slice(0, 6).map((o, i) => {
      const t = ins.find((j) => j.type === o.type && j.module !== o.module) || ins[i % ins.length];
      return { id: `c${i}`, from: o.key.replace(/:out$/, ''), to: t.key.replace(/:in$/, ''),
        fromModule: o.module, type: o.type };
    });
    for (const st of STATES) {
      const states = new Map(jacks.map((j) => [j.key, st]));
      out.set(`${w}/${st}`, bay.baySvg({ panel: PANEL, layout, states, tokens }));
    }
    const states = new Map(jacks.map((j, i) => [j.key, STATES[i % STATES.length]]));
    const pending = outs[0].key;
    const compatible = new Set(ins.filter((j) => j.type === outs[0].type).map((j) => j.key));
    const verdicts = new Map(ins.map((j, i) => [j.key, i % 2 ? { ok: true }
      : { ok: false, reason: 'type mismatch' }]));
    out.set(`${w}/pending`, bay.baySvg({ panel: PANEL, layout, cables, states, pending,
      compatible, verdicts, tokens, selected: 'c1' }));
    out.set(`${w}/cables`, bay.baySvg({ panel: PANEL, layout, cables, states, tokens }));
  }
  return out;
}

function tree(rev, repo) {
  const dir = mkdtempSync(join(tmpdir(), 'k150-'));
  const tar = execFileSync('git', ['-C', repo, 'archive', rev, 'src/js'], { maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
  if (existsSync(join(repo, 'node_modules'))) {
    symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));
  }
  return dir;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [before = 'd59d883b^', after = 'd59d883b'] = process.argv.slice(2);
  const repo = resolve('.');
  const dirs = [];
  try {
    let a; let b;
    try {
      dirs.push(tree(before, repo), tree(after, repo));
      [a, b] = [await bayCases(dirs[0]), await bayCases(dirs[1])];
    } catch (e) {
      console.error(`k150-bay-identity: cannot read ${before} or ${after}: ${e.message}`);
      process.exit(2);
    }
    const differ = [...a.keys()].filter((k) => a.get(k) !== b.get(k));
    if (differ.length) {
      console.error(`k150-bay-identity: ${differ.length} of ${a.size} cases differ between `
        + `${before} and ${after}: ${differ.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log(`k150-bay-identity: ${a.size} of ${a.size} cases identical between ${before} `
        + `and ${after} (${WIDTHS.length} widths x ${STATES.length + 2} cases)`);
    }
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
}

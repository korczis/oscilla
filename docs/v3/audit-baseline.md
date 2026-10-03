# V3 baseline audit (V301), performed retrospectively

> **Retrospective.** This audit was performed on **2026-10-03**, after V3.0 MEASURE (v3.0.0)
> and V3.1 STUDIO (tagged on `a810b94`) had shipped, against HEAD `535af3b`. Issue V301 asked for a baseline
> audit of V2 *before V3 code* (spec `docs/specs/oscilla-v3-measure.md` §0-§1, §5-§6, §251).
> None was written then. This document reconstructs the state V3 started from out of git, the
> GitHub release, deployment and check records, and the plan evidence recorded at the time, and
> re-verifies the V2 capabilities at HEAD.
>
> **What it cannot prove.** It cannot show that a baseline audit informed the V3 design. The
> time order below shows that V3 design and code started before V2 was released. It cannot
> show what a person or agent looked at before writing V3 code, only what was committed and
> recorded. Where a fact comes from a record made at the time (plan evidence, a CI check, a
> deployment), this document names the record. Where it comes from a run today, it says so.

## 1. Time order (from git and GitHub)

All times are UTC. Commit times are committer times (`git log --format=%cI`). Tag times are tag
creator times (`git tag --format=%(creatordate)`).

| Time | Commit / record | Event |
|---|---|---|
| 2026-10-02 01:51:32 | `a7b7a23`, tag `v1.0.0` | V1 released |
| 2026-10-02 03:22:00 | `c367cdb` (#7) | main during V2 work; **the base of `feature/v3`** (`git merge-base 1c84382 v2.0.0`) |
| 2026-10-02 03:29:53 | `1c84382` on `feature/v3` | **first V3 commit**: `docs/v3/architecture.md`, the measurement architecture contract (114 lines, docs only) |
| 2026-10-02 03:32:49 | `f187f66` (#8) | main |
| 2026-10-02 03:40:52 | R001 evidence at `f187f66` | read-only release-engineering baseline audit (M011, see §3) |
| 2026-10-02 03:47:10 | `b862445` on `feature/v3` | **first V3 code**: measurement core, calibration, transfer/IR and RTA modules (21 files, 5 553 lines) |
| 2026-10-02 03:47:52 | `5780656` (#9) | V3 plan (M012-M020) lands on main |
| 2026-10-02 04:00:42 | `90061f7` (#13) | ADRs 0011-0029 (V2 and V3) |
| 2026-10-02 05:12:13 | `90de098` on `feature/v31-studio` | first V3.1 Studio code |
| 2026-10-02 13:07:54 | `66c5fac` (#21) | last V2 change before the release |
| 2026-10-02 13:28:17 | tag `v2.0.0` on `66c5fac` | **V2 released** (GitHub release 13:28:26) |
| 2026-10-03 00:11:52 | PR #29 opened | V3 MEASURE pull request |
| 2026-10-03 00:48:59 | `1283678` (#30), tag `v2.0.1` 00:50:58 | last V2 release; last main before the V3 merge |
| 2026-10-03 03:38:55 | `14c7d5f` (#29) | V3 squash-merged into main |
| 2026-10-03 04:13:18 | tag `v3.0.0` on `5d94576` | V3.0 released |
| 2026-10-03 05:49:26 | `320130f` (#33) | V3.1 Studio squash-merged into main |
| 2026-10-03 06:38:34 | V3.1 release tag on `a810b94` (#34) | V3.1 released |
| 2026-10-03 07:06:27 | `535af3b` (#37) | **HEAD audited here** |

Consequences:

- The first V3 commit precedes the v2.0.0 tag by 9 h 58 min, and the first V3 code by 9 h 41 min.
  `1c84382` is not an ancestor of `v2.0.0`; `feature/v3` forked from `c367cdb`, so V2 changes
  #8-#21 reached it only through merges of `origin/main` (seven in all, `git log --merges
  c367cdb..feature/v3`). V3 was designed against V2 as it was being finished, not against
  a released V2.
- V3 was squash-merged (`14c7d5f`), so neither `1c84382` nor `b862445` is an ancestor of main.
  They survive in the history of PR #29 on GitHub (`gh api repos/korczis/oscilla/commits/1c84382`
  resolves) and on the local `feature/v3` branch, which no remote branch contains; they are cited
  here by hash.
- The V3 plan (M012-M020) and the V3 ADRs 0017-0026 reached main after the first V3 code.

## 2. State V3 started from, reconstructed

### Release and deployment

| Fact | Evidence (recorded at the time) |
|---|---|
| v2.0.0 tagged on `66c5fac`; GitHub release "OSCILLA v2.0.0" | `gh release list`; R016 evidence (`npm run release:publish -- --yes`) |
| Pages deployed `66c5fac` | Pages workflow run 37010974633, success |
| The live page was the committed dist, stamped with `66c5fac` | R017 evidence: verify-deploy PASS attempt 1/10; live smoke 8/8 in chromium, firefox, webkit |
| v2.0.1 tagged on `1283678`; Pages deployed it | `gh release list`; Pages run 37083630650, success |

### Provenance and version authority

At `66c5fac`, `package.json` was the only source of the product version (`"version": "2.0.0"`,
ADR 0027), and the dist embedded a source digest with the deployed commit stamped by the Pages
workflow (ADR 0028). Issues R002-R005 (M011) were recorded done in `173ebcf` (#19), before the
release.

### Tests and gate

| At | Inventory | Result |
|---|---|---|
| `v2.0.0` tree | 27 unit test files, 2 freeze files, 8 browser suites (`git ls-tree -r v2.0.0 tests`) | — |
| `66c5fac` RC | R015 evidence (`npm run release:prepare`) | unit 1451; engine 83/83 ×2; dsp 75; labs; sequencer 56/56; app 28/28 ×6; layout 72/72 ×3; qa; visual; doctor 0 failures |
| PR #21 (`66c5fac`) | `gh pr view 21` checks | unit/build/artifact, V1 engine ×2, DSP/labs/sequencer ×2, browser gate chromium/firefox/webkit, visual gate, `gate`: all SUCCESS |
| PR #30 (`1283678`) | `gh pr view 30` checks | the same ten checks: all SUCCESS |

### Majordomus state

- `docs/CLAIMS.yaml` at `v2.0.0`: 34 claims, 24 of them `guaranteed` V2 claims each naming the
  test that proves it; the rest V3 claims marked planned.
- R001 (M011, "Baseline audit") recorded at `f187f66`, 2026-10-02 03:40:52, a read-only audit
  of versions, tags, deployment, build, workflows, tests, Majordomus state and licences:
  "confirmed: version drift (package.json 2.0.0-dev vs version.js 2.0.0 vs tests), no commit
  provenance, empty features/use-cases, no V2 ADRs, visual compare and dsp/labs/sequencer suites
  ungated, dist-gate stale, Pages mismatch only warns, repo description outdated, licence
  undecided; refuted: live Pages currently byte-identical to dist". It was recorded after the
  first V3 commit (a document) and 6 minutes before the first V3 code commit. It is the nearest
  thing to a pre-V3 baseline, but it was a release-engineering audit, it does not verify V2
  capabilities, and nothing links it to the V3 design.
- M007-M009 were recorded done before the release (`173ebcf` #19, 09:56:00); M010 after it
  (`60419dd` #22, 13:41:22), and M011 last (`e610908` #24, 13:56:31).

## 3. V2 capabilities (spec §1) re-verified at HEAD

Spec §1 lists the capabilities V2 was expected to provide. Each maps to a V2 product feature
(`.ai/repo/features/`, status `stable`) and to `guaranteed` claims in `docs/CLAIMS.yaml` whose
test runs in the release gate. The same 24 V2 claim ids were present at `v2.0.0` and passed its
RC gate (R015); today's run is §5.

| Spec §1 capability | Feature | Claim (test) |
|---|---|---|
| signal generator; sine/square/triangle/saw | `signal-generator` | `tone-plays-and-releases` (browser/app.cjs) |
| frequency patterns | `signal-generator` | `patterns-match-v1` (unit/freeze.test.mjs) |
| sweep | `frequency-sweep` | `sweep-rises-through-range` (browser/app.cjs) |
| dual oscillator | `dual-oscillator` | `dual-oscillator-beats` (browser/engine-v1port.cjs) |
| live waveform; FFT spectrum; spectrogram | `live-analysis` | `spectrum-peak-accuracy` (unit/analysis-peak), `spectrogram-mapping` (unit/analysis-spectrogram) |
| microphone analyzer | `microphone-analyzer` | `microphone-analysis-only` (unit/engine.test.mjs) |
| generator vs microphone compare | `microphone-analyzer` | `generator-mic-compare` (unit/analysis-misc) |
| sequencer | `pattern-sequencer` | `sequencer-safe-automation` (unit/sequencer-compiler); browser/sequencer.cjs |
| filters | `filter-lab` | `lowpass-attenuates` (browser/app.cjs) |
| ADSR | `adsr-envelope` | `adsr-envelope-semantics` (unit/audio-envelope) |
| additive synthesis | `additive-synthesis` | `additive-coefficients-play` (unit/audio-synthesis) |
| phase visualization; Lissajous; stereo | `phase-stereo-lissajous` | `phase-and-lissajous-model` (unit/charts), `stereo-correlation-meter` (unit/analysis-misc) |
| bioacoustics | `bioacoustics` | `bioacoustics-cited` (unit/bioacoustics) |
| WAV export | `export` | `wav-export-valid` (unit/audio-wav) |
| config import/export | `export` | `config-file-round-trip` (unit/integration-ui) |
| URL state; presets | `presets-and-links` | `link-restores-configuration` (unit/core), `presets-save-and-load` (browser/app.cjs) |
| direct file:// execution; single-file dist; modular source | `offline-single-file-app` | `single-file-build` (unit/pack-single-file), `dist-self-contained` (unit/verify-dist), `opens-from-file-and-subpath` (browser/app.cjs) |
| GitHub Pages deployment; build provenance | — (release engineering, M011) | `npm run release:verify-deploy` (run today, §4) |
| Majordomus governance | — | `majordomus plan validate`, `majordomus doctor` (§4) |
| automated browser tests | — | the release gate (§5) |

Verdict: every §1 capability is present at HEAD and is proved by a test the release gate runs.
This is a check of today's tree. That the same capabilities existed and passed at `v2.0.0` rests
on the R015 RC run and the PR #21 checks, recorded at the time.

## 4. HEAD now

| Item | State (observed 2026-10-03) |
|---|---|
| HEAD | `535af3b` (#37); `package.json` carries the V3.1 release version (`npm run version:check`) |
| Releases | v2.0.0, v2.0.1, v3.0.0 and the V3.1 release on `a810b94` (latest), all GitHub releases (`gh release list`) |
| Public deployment | Pages run 37105247629 deployed `535af3b`; `npm run release:verify-deploy`: PASS attempt 1/10, live page is the committed dist stamped with `535af3b`; version, digest, shape and share assets verified |
| Plan | `majordomus plan validate`: 34 milestones, 229 issues, 0 failures, 1 warning (M034 milestone evidence missing) |
| Doctor | `majordomus doctor`: 0 failures; warnings are local unpushed branches and the doctor time budget |
| ADRs | `majordomus adr check`: 38 decisions, identities unique, statuses known, references resolve; 0027-0038 still `proposed` |
| Questions | `majordomus question list`: no open questions |
| Product graph | 29 features (23 `stable`, 6 Studio `draft`), 35 use cases, 63 claims in `docs/CLAIMS.yaml` |

## 5. Test inventory at HEAD

- Unit: 59 `tests/unit/*.test.mjs` files plus the V1 freeze (`tests/freeze/`), run by `npm test`.
- Browser: 16 suites under `tests/browser/` (15 in the release gate, `live-smoke.cjs` post-deploy),
  each over chromium, firefox and webkit where the suite says so (`tests/README.md`).
- Visual: `visual-gate.mjs` (13 regions of the 1536×1024 reference), `visual-measure.mjs`
  (MEASURE desktop and phone), `visual-studio.mjs` (Studio desktop, phone, compact), with
  references per environment (darwin-arm64, linux-x64).
`npm run release-gate` at `535af3b` on 2026-10-03 (darwin-arm64, AudioContext at 48 kHz):
**exit 0**.

| Suite | Result |
|---|---|
| unit (`npm test`, incl. V1 freeze) | 2040/2040 |
| version:check, build:check, verify-dist, `majordomus doctor` | PASS; doctor 0 failures |
| engine-v1port | 87/87 chromium, 87/87 firefox |
| dsp; labs | 75/75; all pass |
| sequencer | 56/56 (chromium, firefox) |
| v3-measure; analysis-worker | 116/116; 42/42 |
| v3-ui | 14/14 in each of chromium, firefox, webkit × file://, /oscilla/ |
| v31-studio-graph | 21/21 file:// and 6/6 /oscilla/ smoke, each of chromium, firefox, webkit |
| v31-studio-timeline | 14/14 in each browser × origin |
| v31-studio-audio; transport; offline | 81/81; 69/69; 33/33 |
| app | 28/28 in each browser × origin |
| layout | 99/99 chromium, firefox, webkit |
| qa-regressions | 15/15 chromium, 14/14 firefox, 14/14 webkit |
| visual | gate 13 regions, controls and totals ok; MEASURE 2 views; STUDIO 3 views (0-0.099 % differ) |

## 6. Findings

1. **No baseline audit preceded V3 code.** The acceptance criterion's "before V3 code" is not met
   and cannot be met now. This document is a retrospective substitute, accepted as such when
   V301 was closed; it does not change the history in §1.
2. V3 was designed against an unreleased V2: its branch forked from `c367cdb` and absorbed V2's
   last fourteen pull requests by merge.
3. The pieces V301 asked for that were recorded at the time are R001 (release engineering at
   `f187f66`), R015 (V2 RC gate at `66c5fac`), R016/R017 (v2.0.0 publication and live
   verification), and the PR check rollups. None of them verifies V2 capabilities against the
   V3 specification §1 list; §3 does that today.
4. HEAD is released and deployed exactly as committed (§4), and the V2 claims still pass (§5).

## Commands run

```bash
git tag -l --format='%(refname:short) obj=%(objectname:short) target=%(*objectname:short) tagdate=%(creatordate:iso-strict)'
git log -1 --format='%H %aI %cI %s' 1c84382   # and 66c5fac, 1283678, 5d94576, a810b94, 14c7d5f, 320130f, HEAD
git merge-base --is-ancestor 1c84382 v2.0.0; git merge-base 1c84382 v2.0.0
git branch -a --contains 1c84382
git log --merges c367cdb..feature/v3; git log --first-parent c367cdb..v2.0.0
git show --stat 1c84382; git show --stat b862445
git ls-tree -r --name-only v2.0.0 tests
git show v2.0.0:docs/CLAIMS.yaml; git show v2.0.0:package.json
git log --reverse --no-merges feature/v31-studio ^feature/v3 ^origin/main
gh release list; gh api repos/korczis/oscilla/deployments
gh run list --workflow pages.yml; gh pr view 21|29|30|33|37 --json statusCheckRollup,createdAt,mergedAt
majordomus plan show R001|R015|R016|R017; majordomus plan validate; majordomus doctor
majordomus adr check; majordomus adr list; majordomus question list
npm run release:verify-deploy
npm run release-gate
```

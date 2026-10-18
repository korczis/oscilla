---
schema: adr/v1
id: adr-0057
kind: adr
title: A static Pages deployment is evidenced by its release/v1 record and Pages run, not deployment/v1
status: proposed
date: 2026-10-17
tags:
  - release
  - deployment
related:
  - rule:project.release-flow-complete
  - rule:project.deploy-often
  - rule:project.no-fake-science
  - file:scripts/release-record.mjs
  - file:scripts/release-publish.mjs
  - file:scripts/verify-deploy.mjs
  - file:scripts/stamp-build.mjs
  - file:tests/browser/live-smoke.cjs
  - file:.github/workflows/pages.yml
  - file:.ai/repo/releases/README.md
  - file:.ai/repo/deployments/README.md
  - file:docs/v31/studio-report.md
provenance:
  origin: extracted
  derived_from:
    - issue:V433
    - file:scripts/release-record.mjs
---

# 57. A static Pages deployment is evidenced by its release/v1 record and Pages run, not deployment/v1

## Context

The V3.1 Studio specification (`docs/specs/oscilla-v3.1-studio.md`) asks for deployment
evidence twice. §227 asks for a Majordomus deployment record "through the current deployment
schema: version, commit, environment, public URL, workflow, artifact identity, verification
result; no unsupported fields". §271 asks for "version, commit, public URL, Pages run,
artifact identity, Studio smoke result, date, through the current evidence/deployment model".
Plan issue V433 has recorded this gap in every evidence round since 2026-10-03:
`.ai/repo/deployments/` holds only its README, and "deployment/v1 has no object shape for a
static Pages site, so a recorded decision on where spec 227 evidence lives is still needed".

**The current deployment contract.** Majordomus 0.29.0's `deployment/v1`
(`share/schemas/majordomus/deployment/deployment.v1.schema.json`, `additionalProperties:
false`) requires `schema`, `kind`, `id`, `title`, `application`, `build`, `listen`, `health`,
`resources`, `machines` and `region`. Inside them:

- `build` requires `package` ("The Cargo package that is built"), `binary` ("The binary target
  the image runs"), `profile` (the Cargo profile) and `inputs`; validation refuses a package
  or binary the workspace does not contain;
- `listen` requires `port` (an integer from 1024 to 65535) and `interface` (`loopback` or
  `all`);
- `health` requires `liveness` and `readiness` routes, each of which "must be registered by a
  capability";
- `resources` requires `cpu_kind`, `cpus` and `memory_mb`;
- `machines` requires `count` (at least 1), `min_running`, `autostart` and `autostop`;
- `region` is "The region the machines run in".

It is the contract of a container service: `.ai/repo/deployments/README.md` says the container
image definition and its ignore file are generated from the object. It has no field for a
public URL, a commit, a version, a workflow run, a verification result or a date, and an
unknown key "is refused, never carried".

**What OSCILLA deploys.** One static file. `.github/workflows/pages.yml` stages the committed
`dist/index.html` with only its metadata region stamped (`scripts/stamp-build.mjs`: commit,
channel `production`, `sourceDate`, `artifactSha256` of the committed dist), uploads it with
two crawler-only images to GitHub Pages and deploys it to the `github-pages` environment.
There is no process, no port, no health route, no Cargo package, no machine and no region of
ours. Every required field of `deployment/v1` would have to be invented.

**What already proves a deployment.** Two things, both read off what was published:

1. The **release/v1 record** (`.ai/repo/releases/vX.Y.Z.yaml`, written by
   `scripts/release-record.mjs` only after `release:publish -- --yes` has tagged, waited for
   the Pages run of the tag commit, run `verify-deploy` and created the GitHub Release). The
   `release/v1` schema (`additionalProperties: false`) requires `schema`, `version`, `tag`,
   `channel`, `commit`, `published_at` and `artifacts`; OSCILLA's records also carry
   `notes_url` and `required_targets` (`web`). The `web` artifact's `sha256` and `size` are
   read off the downloaded Release asset, which must be byte-identical to `dist/index.html`
   at the tag; `--check` refuses a record that differs from what GitHub serves.
2. The **Pages run** of `pages.yml` for the deployed commit. Its `deploy` job logs the stamp
   (`stamped _site/index.html: v<version> production commit <sha> (<date>); artifact
   <sha256>`), and its fatal `verify-deploy` step (10 attempts, 10 s apart) proves the live
   page, normalised, is the committed dist byte for byte, that `artifactSha256` equals the
   SHA-256 of the committed dist, and that the commit, source date, version and source
   digest agree. Then three `Public smoke (<browser>)` jobs run `npm run test:live` against
   the deployed `page_url` with `--expect-version` (package.json) and `--expect-commit`
   (`GITHUB_SHA`); a failed check fails the run. The smoke includes the Studio checks of
   §269-§270: the compact Studio, the Subtractive Synth's nodes, connections and timeline,
   PLAY and STOP leaving no nodes, and the Measurement Sweep's measurement nodes.

## Decision

OSCILLA writes no `deployment/v1` object. `.ai/repo/deployments/` keeps its README and no
objects, the "empty section" that README allows. The deployment evidence of §227 and §271 is
the pair: the **release/v1 record** of a release and the **Pages run** that deployed its
commit, with that run's `verify-deploy` and `test:live` logs. They are joined by the commit:
the record's `commit` is the run's `headSha`.

| Field (§227, §271) | Carried by | Where |
| --- | --- | --- |
| version | release/v1 record | `version` and `tag`; the run checks the same value: the stamp line, `verify-deploy` (region version == package.json) and the smoke (`window.OSCILLA.version` == region version == `--expect-version`) |
| commit | release/v1 record and Pages run | the record's `commit`; the run's `headSha`, its stamp line and `verify-deploy` ("stamped with commit <sha>") |
| environment | Pages run | the `deploy` job's environment `github-pages` |
| public URL | Pages run | the `page_url` output of `actions/deploy-pages`, the environment URL, passed to `verify-deploy --url` and `test:live --url`; release/v1 has no URL field for it (`notes_url` is the Release page) |
| workflow, Pages run | Pages run | the run id, URL and conclusion (`gh run list --workflow pages.yml`, `gh run view <id>`) |
| artifact identity | release/v1 record and Pages run | the record's `artifacts[web].sha256` and `size`; the run's stamp line (`artifact <sha256>`) and `verify-deploy`'s artifact check |
| verification result | Pages run | the `verify-deploy` step: `PASS attempt n/10: live page is the committed dist ...`, fatal |
| Studio smoke result | Pages run | each `Public smoke (<browser>)` job: `PASS <browser>/live: n/n checks`, with one line per check |
| date | release/v1 record and Pages run | the record's `published_at`; the run's `createdAt` and `updatedAt`; the stamp's `sourceDate` |

Between releases, `pages.yml` deploys every push to `main` (rule `project.deploy-often`), so a
Pages run can serve a commit that no record names. Such a deployment is evidenced by its run
alone, and its stamped artifact digest differs from the newest record's. At this writing, run
38453063858 (2026-10-13, success) served `964e25d` with artifact
`6e93ae1852dac4e5fa8bfe0f2cd3852b8ed47ccf1db501363dd66f99954c3c41`, while the newest record,
`.ai/repo/releases/v3.10.3.yaml`, names `e4772ee` and
`f8d5b609d285880133cc6bee3fe3627aefb597625a6793c8acda307e334f615a`. Both statements are true:
the record says what was released, the run says what is served.

The V3.1 Studio release itself is v3.1.0: tag commit `a810b94`, GitHub Release published
2026-10-03T06:38:40Z, Pages run 37103655560 (success) at that commit. It has no release/v1
record because its Release has no asset. Records start at v3.4.0, and the releases README
keeps a release without an attached asset unrecorded. Its evidence is the run, plus the
verify-deploy and test:live results quoted in V433's plan evidence.

## Alternatives rejected

- **A deployment/v1 object with stand-in values** (a port of 8080, one machine, region
  "github-pages", package "oscilla"). Every required field would describe a container nobody
  runs. `build.package` and `build.binary` are validated against a Cargo workspace OSCILLA does
  not have, and the health routes must be registered capabilities. A record of something that
  does not exist breaks the evidence rule that `project.no-fake-science` applies to shipped
  claims, and §227 itself says "no unsupported fields".
- **deployment/v1 with the fields a static site needs** (URL, run, commit, smoke). The schema
  is closed (`additionalProperties: false`), and the README refuses an unknown key rather than
  carrying it.
- **More fields on release/v1** (public URL, Pages run, smoke). That schema is closed too, and
  it records a release, not each of the deployments between releases.
- **A repository-local deployment file of OSCILLA's own kind**, written after each Pages run. It
  would be a second contract that Majordomus does not validate, restating values the run
  already proves. It would need a commit per push to `main`, which under `project.deploy-often`
  means one per merge. It could also drift from the run it copies, and nothing would refuse it.
- **Waiting for a static-site shape in Majordomus.** That leaves §227 and §271 unanswered in
  the meantime, although the evidence exists. This decision is the interim answer and is
  superseded when such a shape exists.

## Consequences

- V433's deployment-evidence criterion is met by citing a record and a run, not by a file in
  `.ai/repo/deployments/`. The V433 plan evidence and `docs/v31/studio-report.md` cite them
  by record path, run id and commit.
- `majordomus doctor` keeps reporting the deployments section as present and empty, with
  nothing to refuse.
- GitHub keeps Actions logs only for its retention period. The durable part of the evidence is
  the release record (immutable, re-checked by `release-record.mjs --check`) and the run ids
  and results quoted in plan evidence. A past deployment whose logs have expired cannot be
  re-verified. Only the page served now can, with `npm run release:verify-deploy` and
  `npm run test:live`.
- The join between record and run is the commit, and `release:publish` enforces it: it waits
  for the Pages run of the tag commit and runs `verify-deploy` against that commit before it
  creates the GitHub Release the record is read from.
- No code changes. If a later Majordomus contract can describe a static site honestly, the
  pair moves into it and this ADR is superseded.

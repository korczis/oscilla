---
schema: context/v1
id: ai.repo.releases
kind: context
title: Published releases
description: One release/v1 record per published OSCILLA release, written by scripts/release-record.mjs from what was published.
status: active
scope: subtree
providers: ["*"]
audience: [human, agent]
composition: extend
order: 100
---

# Published releases

One file per release, `v<major>.<minor>.<patch>.yaml` (a prerelease keeps its suffix), kind
`release-record`, contract `release/v1` (Majordomus
`share/schemas/majordomus/release/release.v1.schema.json`). A record says which tag was
published, which commit it points to, the channel, when the GitHub Release was published,
where its notes are, and the artifact with its name, download URL, SHA-256 digest and size.

## Who writes these

`npm run release:record -- --version X.Y.Z` (`scripts/release-record.mjs`), after
`release:publish -- --yes` has tagged, deployed, verified and created the GitHub Release, and
nobody else. The record lands on `main` by a small pull request of its own. A record is
evidence, not a plan: every value is read from git and from the GitHub Release, and the digest
and size are read off the downloaded asset. Editing one by hand makes it describe something
that was not published; `node scripts/release-record.mjs --version X.Y.Z --check` refuses a
record that differs from what GitHub serves, naming the field.

## The artifact

OSCILLA ships one file, the committed `dist/index.html`. Its SHA-256 is what
`verify-deploy` calls the artifact digest (`artifactSha256` of the Pages stamp); the page on
Pages is those bytes with only the metadata region stamped. `release/v1` requires the
artifact URL to be a GitHub Release download, so `release:publish` attaches the committed
dist to the GitHub Release as `oscilla-vX.Y.Z.html`, target `web`, and the record script
refuses an asset that is not byte-identical to `dist/index.html` at the tag, and any other
asset.

## Invariants

- one record per tag, and the file name is the tag;
- `version` is the `package.json` version at `commit`, and `tag` is `v` followed by it;
- `channel` is `prerelease` exactly for a SemVer prerelease;
- `artifacts` holds exactly the targets of `required_targets` (`web`), and the `web`
  artifact's `sha256` equals the SHA-256 of `dist/index.html` at `commit`
  (`tests/unit/release-record.test.mjs` checks every committed record).

A release that predates the attached asset has no record until the asset is attached: a
record names bytes anyone can download, never a URL that does not exist.

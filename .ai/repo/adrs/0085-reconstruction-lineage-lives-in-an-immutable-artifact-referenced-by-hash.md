---
schema: adr/v1
id: adr-0085
kind: adr
title: "Reconstruction lineage lives in an immutable artifact the Studio document references by hash; accepting a part is presentation state changed only through undoable actions"
status: accepted
date: 2026-11-03
tags:
  - reconstruction
  - provenance
  - import
related:
  - rule:project.studio-model-is-canonical
  - rule:project.no-fake-science
  - rule:project.single-file-deliverable
  - file:.ai/repo/project/intents/song-reconstruction.yaml
  - file:.ai/repo/project/critiques/song-reconstruction.yaml
---

# 85. Reconstruction lineage lives in an immutable artifact the Studio document references by hash; accepting a part is presentation state changed only through undoable actions

## Context

The proposed intent `song-reconstruction` turns an analysed recording into ordinary, editable
Studio tracks. Every imported part carries hypotheses and lineage: which tool and version
produced it, with which parameters, from which source file, at what confidence. The user can
accept, correct or reject each part. The independent critique of the intent
(`.ai/repo/project/critiques/song-reconstruction.yaml`, finding
`lineage-and-acceptance-have-no-home`, blocking) found that the intent never says where that
information lives, and that both obvious homes collide with a rule:

- In the StudioModel, lineage for a full transcription (thousands of notes, each with a producer,
  a version, parameters and a part id) can exceed `STUDIO_IMPORT_LIMITS.maxBytes` (4 MiB,
  `src/js/studio/validate.js`), and accepting a part is a semantic user action, which
  `project.studio-model-is-canonical` requires to be one undoable dispatch. No such action type
  exists.
- A separate, editable reconstruction document keyed by element id becomes a second persisted
  record that has to stay consistent with the Studio document across undo, delete, save and
  reopen: the parallel copy that the same rule forbids.

The owner answered four questions of the proposal on 2026-11-02 (Q072-Q075). Fixtures are
synthetic or the owner's own, the companion is a separate tool in its own repository, and the
real audio and notes clip kinds of M071/M072 come first. None of the four answers decides this
point.

## Decision

1. **The artifact is immutable and lives outside the Studio document.** A reconstruction artifact
   (manifest, parts, per-part lineage and quality, source hashes) is written once by the
   companion or a fixture generator and is never edited by OSCILLA. Inside OSCILLA it is read
   through the strict untrusted-input path, with its own size and entry limits, and stored by its
   content hash.
2. **The relation is one-way.** The Studio document names the artifact by its hash and each
   imported element names its part id in that artifact. The artifact never names Studio elements.
   Deleting, undoing or editing Studio elements changes nothing in the artifact, so the two
   records cannot drift apart.
3. **Acceptance is presentation state in the StudioModel.** For each imported part, the state is
   one of hypothesis, accepted, corrected or rejected, plus the artifact hash. It is stored in
   element metadata, outside `studioHash`, the way K061's `metadata.panel` is. Accepting or
   correcting a part does not change what sounds; the edit that a correction makes is an ordinary
   Studio action and changes `studioHash` like any other edit.
4. **The acceptance state changes only through new undoable dispatch types**
   (`RECON_PART_ACCEPT`, `RECON_PART_REJECT`, `RECON_PART_RESET`). Each is one history entry, and
   each is refused, with its reason, for an unknown part or a hash that does not match.
5. **Size.** Only the hash and the per-element part id and state enter the Studio document, a
   bounded number of bytes per imported element. The artifact's own limit is set by the issue that
   adds its validator and is checked there, never inferred.
6. **Missing artifact.** A Studio document whose referenced artifact is absent still opens and
   plays. Its lineage view states that the artifact is unavailable; it never fabricates lineage.

## Consequences

- No issue of `song-reconstruction` may be filed before this ADR is accepted by the owner. The
  first issue names this ADR in its `depends_on` and adds the three dispatch types with
  fail-first tests.
- The artifact store is a new persisted record. Its path joins `review-verdict`'s guarded list in
  the same pull request that adds it (critique finding F13).
- Determinism is judged on the canonical JSON of the whole Studio document after import, not on
  `studioHash` alone (critique finding F11).

## Alternatives

- **Lineage inside the StudioModel.** Rejected: the size bound, and the hash would change with
  provenance that does not change the sound.
- **An editable side document.** Rejected: a parallel copy that must be kept in sync.
- **No lineage at all.** Rejected: `project.no-fake-science` requires that an inference say what it
  is and how far to trust it.

## Resolution notes

### 2026-11-03: accepted by the owner

Accepted by the owner on 2026-11-03, through AskUserQuestion in the oscilla-b0 coordinator
session. The owner chose "Accept (Recommended)", whose option text read: "ADR 0085 accepted;
once M071/M072 are in place, the first RECONSTRUCT issue can be filed (it names ADR 0085 in
depends_on)." The intent `song-reconstruction` stays proposed until its own acceptance. Nothing
implements this decision yet.

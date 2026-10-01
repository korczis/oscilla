---
schema: context/v1
id: ai.repo.sessions
kind: context
title: Session records
description: One immutable record per closed execution episode, derived from git and the ledger and shared with every surface.
status: active
scope: subtree
providers: ["*"]
audience: [human, agent]
composition: extend
order: 100
---

# Session records

A record here is one closed execution episode: when it opened and closed, the branch it ran
on, the commit it started from and the one it ended at, the commits between them, the paths
the working tree held changed, what it produced, and how it ended. `majordomus session
close` writes it; nothing else does, and nothing edits one afterwards.

Everything in the front matter is **derived**. The times come from the clock, the heads and
the commits from git, and every list — tasks, issues, milestones, checkpoints, handovers,
decisions, questions, evidence — from the ledger's own events for that episode. The body is
the only authored part: a summary of the work, given on standard input at close.

## What a record may not contain

No conversation. `project.never-store-transcripts` holds here as everywhere: a record states
what is true about the repository, not what was said to arrive at it. The schema has no
field for a transcript, a prompt or a turn, and an unknown key is refused rather than
carried. The prompts a person wrote have their own store, and it is checkout-local by
design.

No fact about a machine. A shared record names the repository by its remote and the working
copy by `worktree_id`, a hash that identifies it without disclosing where it lives. The
absolute path stays in the ledger, which is local. ADR 0014 records that decision.

## The contract

The front matter satisfies `share/schemas/majordomus/session-record/session-record.v1.schema.json`
— an identity fixes a schema's path, `<vendor>.<name>/v<n>` living at
`share/schemas/<vendor>/<name>/<name>.v<n>.*`; the allow-list under
`share/allow/session-record.txt` is generated from it, and an unknown key is an error.
`schema: session/v1` identifies the format, and a version this executable does not read is
refused rather than guessed at.

The file name is a convenience — the timestamp, the id, the branch, the head and a digest —
and the identity is `session_id` in the front matter, which survives a rename.

## What is derived from this directory

The source class `session` in `../knowledge/sources.yaml` discovers `*.md` here; that one
declaration is the whole registration. From it follow the index, the MCP resource
`majordomus://session/<id>`, the object routes of the API and their OpenAPI description, the
knowledge graph's `session` nodes, the site's registry pages and the cockpit. None of them
holds a list of sessions, and none needs editing when an episode closes.

```bash
majordomus session list              # closed episodes, newest first
majordomus session show <id>         # one record, whole
majordomus session latest --path     # the newest that resolves in this worktree
```

## The other half of an episode

A record here says what the episode **produced**. What it was **given** is a different object
and a local one: `session start` freezes the context the builder resolved into
`.ai/local/session-contexts/<stamp>--<session-id>.md`, over a section for the worker's own
notes, and `session close` appends the outcome and the path of the record it wrote here. The
two share a `session_id` and answer opposite questions.

That half stays local because it names one machine and because it is a snapshot of a
projection — re-resolving it later gives a different document, so no surface can reproduce it
and none publishes it. Its contract is `majordomus.session-context/v1`, and
`majordomus session context` prints its path rather than its content: local evidence is not
poured into a terminal where a context can pick it up.

Where a provider fires session events, neither half depends on a worker remembering to write
it: `majordomus capture install` wires the hooks, and the episode opens and closes with the
sitting.

## Retention

None. A record is history, it is small, and it is tracked: git keeps it, and every surface
can query it. The checkout-local half — the open session, the working contexts, the ledger —
keeps its own caps in the policy where it has them, because those grow without bound and
nothing reads them after the fact. The working contexts have no cap, for the reason the
prompt archive has none: nothing else can reconstruct one.

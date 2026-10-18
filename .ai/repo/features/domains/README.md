---
schema: context/v1
id: ai.repo.features.domains
kind: context
title: Product domains
description: The few things OSCILLA controls, one domain per file; every stable feature names exactly one, and each domain's members, interfaces and evidence are derived from the features that name it.
status: active
scope: subtree
providers: ["*"]
audience: [human, agent]
composition: extend
order: 110
---

# Product domains

A **domain** is one of the few things the product controls, stated once in one Markdown file
here:

```text
<id>.md      one product domain      schema: domain/v1
```

The contract is `share/schemas/majordomus/domain/domain.v1.schema.json` of the tool
distribution. The front matter holds the title, a one-sentence `headline` (what OSCILLA does
about it), a one-sentence `problem` (the failure it answers) and a `weight` (the order of every
list of domains). The body says what the domain covers and what it does not.

A domain never lists its features. A feature names its domain in its own `domain:` field, and
the members and everything behind them are derived (`majordomus product domains`). A stable
feature that names no domain while any is declared, or names one that does not exist, fails
`majordomus product validate`.

The domains follow the product's own divisions as the README and the glossary state them: the
V2 instrument and laboratory, the V3 Measure and Experiments workspaces, the V3.1 Studio, and
the single file that delivers them.

## Discovery

The class `domain` of `../../knowledge/sources.yaml` discovers every file here through the
version-control index (`:(glob).ai/repo/features/domains/*.md`); the class `feature` does not
reach this directory, because its `*` stays inside one path segment.

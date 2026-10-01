---
schema: context/v1
id: ai.repo.deployments
kind: context
title: Deployments
description: One canonical object per deployment of this repository's service; every container and provider artifact is generated from it and none of them is authoritative.
status: active
scope: subtree
providers: ["*"]
audience: [human, agent]
composition: extend
order: 100
---

# Deployments

A deployment object states, once, everything a deployment needs: which application it is,
which package and binary are shipped, the port the process listens on and the interface it
listens on, the routes a platform polls for liveness and readiness, the resources and the
machine count it is granted, the region it runs in, the paths its image is built from, and
the budgets it is held to. Facts that mean nothing outside one hosting provider live in the
`provider` block and nowhere else.

## What is authoritative and what is generated

**Authoritative:** the `*.yaml` files in this directory. Nothing else.

**Generated from them:** the container image definition, its ignore file and the provider
configuration. A hand-written `Dockerfile` and a hand-written provider file would restate
the port, the routes, the resources and the build inputs the repository already knows, and
every pair would drift the first time one half changed.

Regenerate with `majordomus generate`; `majordomus generate --check` is what refuses a
generated artifact that was edited by hand.

## The contract

`share/schemas/majordomus/deployment/deployment.v1.schema.json` (`deployment/v1`) is the contract, and
`share/allow/deployment.txt` — generated from it — is what keys are checked against. An
unknown key is refused, never carried.

No credential belongs here. The token that authorises a deployment comes from outside the
repository and is never written into it, into a generated file, into an image layer or
into a log.

## An empty section is not a problem

A repository that deploys nothing keeps this directory with its contract and no objects.
`majordomus doctor` reports the section and finds nothing to refuse.

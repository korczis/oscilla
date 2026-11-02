#!/usr/bin/env bash
# The pull request a CI run judges, as shell assignments for `eval` (ADR 0083):
#   PR         the pull request number: the event's own on pull_request, or the N the merge
#              queue names its ref by on merge_group (refs/heads/gh-readonly-queue/<base>/pr-N-<sha>)
#   BASE       the base branch, whose copy of a rule judges (.github/scripts/base-rule.sh)
#   DIFF_BASE  what the pull request's changes are measured against: origin/<base> on
#              pull_request (HEAD is its merge with the base), HEAD^1 on merge_group (HEAD is the
#              queue's merge of it onto main plus the pull requests ahead of it)
# Reads PR, GITHUB_BASE_REF, QUEUE_REF and QUEUE_BASE from the environment; prints only a number
# and branch names it has checked, so the eval runs nothing else. Exits 2 on a malformed ref.
set -euo pipefail

name='^[A-Za-z0-9._/-]+$'
pr="${PR:-}"
base="${GITHUB_BASE_REF:-}"
diff=''
if [ -z "$pr" ] && [ -n "${QUEUE_REF:-}" ]; then
  if [[ "$QUEUE_REF" =~ ^refs/heads/gh-readonly-queue/([A-Za-z0-9._/-]+)/pr-([0-9]+)-[0-9a-f]{7,40}$ ]]; then
    base="${BASH_REMATCH[1]}"
    pr="${BASH_REMATCH[2]}"
    diff='HEAD^1'
  else
    echo "queued-pr: not a merge-queue ref: $QUEUE_REF" >&2
    exit 2
  fi
  queue_base="${QUEUE_BASE#refs/heads/}"
  if [ -n "$queue_base" ] && [ "$queue_base" != "$base" ]; then
    echo "queued-pr: queue ref base $base differs from the event's $queue_base" >&2
    exit 2
  fi
fi
[[ -z "$pr" || "$pr" =~ ^[0-9]+$ ]] || { echo "queued-pr: PR is not a number: $pr" >&2; exit 2; }
[[ -z "$base" || "$base" =~ $name ]] || { echo "queued-pr: bad base: $base" >&2; exit 2; }
[ -n "$diff" ] || diff="origin/$base"
printf "PR=%s\nBASE=%s\nDIFF_BASE=%s\n" "$pr" "$base" "$diff"

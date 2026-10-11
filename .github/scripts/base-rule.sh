#!/usr/bin/env bash
# Run a pull-request rule with the BASE branch's copy of its program, so a pull request
# cannot change the program that judges it (rules project.fail-first, project.review-verdict).
#
#   .github/scripts/base-rule.sh <base-ref> scripts/<rule>.mjs [arguments of the program...]
#
# The program is taken from <base-ref> together with the rest of that commit's scripts/ (its
# imports), extracted outside the checkout, and run on this checkout with --repo. Which commit
# judged is printed. Only when <base-ref> has no such program (the pull request that introduces
# the rule) does the checkout's own copy run, and that is printed as a warning.
set -euo pipefail

base="${1:?usage: $0 <base-ref> scripts/<rule>.mjs [arguments...]}"
program="${2:?usage: $0 <base-ref> scripts/<rule>.mjs [arguments...]}"
shift 2
case "$program" in
  scripts/fail-first.mjs | scripts/review-verdict.mjs) ;;
  *) echo "base-rule: $program is not a pull-request rule" >&2; exit 2 ;;
esac

repo="$(git rev-parse --show-toplevel)"
sha="$(git -C "$repo" rev-parse --verify "$base^{commit}")"
if ! git -C "$repo" cat-file -e "$sha:$program" 2> /dev/null; then
  echo "::warning::base-rule: $base (${sha:0:12}) has no $program; this checkout's copy judges"
  status=0
  node "$repo/$program" --repo "$repo" "$@" || status=$?
  exit "$status"
fi

# (the physical path: a program asked through a symlinked temporary directory would not
# recognise itself as the one being run)
dir="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$dir"' EXIT
git -C "$repo" archive "$sha" -- scripts | tar -x -C "$dir"
echo "base-rule: $program of $base (${sha:0:12}) judges this pull request"
status=0
node "$dir/$program" --repo "$repo" "$@" || status=$?
exit "$status"

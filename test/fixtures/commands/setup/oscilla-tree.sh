# shellcheck shell=bash
# Setup for OSCILLA's use-case scenarios: the disposable repository becomes a copy of this
# checkout's tracked files, as they stand in the working tree, committed once.
#
# Majordomus sources this file with the scenario's repository as the working directory and
# ROOT set to the repository that invoked `majordomus usecase run`. It reads ROOT and never
# writes to it: the scenario asks `majordomus knowledge edges` about the copy, because
# `knowledge` is state-mutating from Majordomus 0.11 on (share/commands.yaml) and a live
# scenario may run only read-only commands (ADR 38 of the tool). The copy is this tree, so a
# claim whose implementation or test was renamed or deleted here fails the scenario all the
# same.
#
# The tool looks for setup scripts under test/fixtures/commands/setup/ of the repository it
# runs in; that path is fixed by the tool, not chosen here.

if [ -z "${ROOT:-}" ] || ! git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "oscilla-tree: ROOT does not name a git checkout" >&2
  return 1
fi

# Tracked paths that exist in the working tree (a deletion not yet staged is left out, as
# the index of the copy would not have it either), copied with their modes.
while IFS= read -r -d '' path; do
  [ -e "$ROOT/$path" ] || [ -L "$ROOT/$path" ] || continue
  printf '%s\0' "$path"
done < <(git -C "$ROOT" ls-files -z) \
  | (cd "$ROOT" && tar -cf - --null -T -) \
  | tar -xf - \
  && git add -A \
  && git commit -q -m 'the OSCILLA tree'

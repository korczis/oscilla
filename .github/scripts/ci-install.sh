#!/usr/bin/env bash
# Bounded, recoverable installs for the browser jobs of ci.yml.
#
#   .github/scripts/ci-install.sh browser <chromium|firefox|webkit>   # system deps, then the browser
#   .github/scripts/ci-install.sh apt <package>...                     # apt-get install
#
# Why: `npx playwright install --with-deps` ran into the 15-minute job timeout three times on
# 2026-10-06, each time in apt downloading from the runner's first mirror (azure.archive.ubuntu.com),
# not in the Playwright download: WebKit's 181 packages, 126 MB, took 13 min 16 s (158 kB/s;
# run 37532638670), Firefox's 40 packages, 49.2 MB, 11 min 44 s (69.9 kB/s; same run, attempt 2),
# and a WebKit install was cancelled after 15 min (run 37511062059). The same steps take 20-54 s
# (deps and download together) on a normal run. The ubuntu-24.04 runner image does not ship
# these packages: apt reports them as newly installed.
#
# So each install is split into the apt part and the browser download, each bounded by a wall
# timeout and retried once. A stalled transfer is cut by apt itself after 30 s and retried
# (Acquire::*), and the retry of a timed-out apt run puts the runner's first mirror last, since a
# throttled mirror stays throttled for the minutes that matter here; archives fetched by the first
# attempt are kept and reused. Two failed attempts fail the step, so the job and `gate` fail.
set -euo pipefail

DEPS_FIRST_S=240   # over 4x the slowest normal install (54 s, apt and download together)
DEPS_RETRY_S=300   # the retry, against the next mirror
DOWNLOAD_S=120     # the Playwright download of all three browsers measured 13 s

log() { echo "ci-install: $*"; }

configure_apt() {
  sudo tee /etc/apt/apt.conf.d/80-oscilla-ci > /dev/null <<'EOF'
Acquire::Retries "3";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
EOF
}

# Make the first entry of the runner's mirror list the last one (sources name it as
# mirror+file:/etc/apt/apt-mirrors.txt; apt tries its entries by their priority:N, so the
# entries are renumbered in the new order).
demote_first_mirror() {
  local list=/etc/apt/apt-mirrors.txt
  if [ -f "$list" ] && [ "$(grep -c . "$list")" -gt 1 ]; then
    log "mirror list before: $(tr '\n' ' ' < "$list")"
    { grep . "$list" | tail -n +2; grep . "$list" | head -n 1; } \
      | sed -E 's/[[:space:]]+priority:[0-9]+//' \
      | awk '{ printf "%s\tpriority:%d\n", $0, NR }' \
      | sudo tee "$list.new" > /dev/null
    sudo mv "$list.new" "$list"
    log "mirror list now: $(tr '\n' ' ' < "$list")"
  else
    log "no runner mirror list to reorder; retrying against the same sources"
  fi
  run_as_root 120 apt-get update -q || true
}

# run_as_root <seconds> <command...>: apt runs as root, so the timeout must too, or it cannot
# end the process it started.
run_as_root() {
  local s="$1"; shift
  sudo env "PATH=$PATH" timeout --kill-after=15s "$s" "$@"
}

# attempt_twice <label> <first-s> <retry-s> <on-retry-fn> <command...>
attempt_twice() {
  local label="$1" first="$2" retry="$3" before_retry="$4"; shift 4
  local n=1 limit="$first" start rc
  while :; do
    start=$SECONDS
    if "$@" "$limit"; then
      log "$label: done in $((SECONDS - start)) s (attempt $n)"
      return 0
    else
      rc=$?
    fi
    # (a leading newline: apt may leave its progress line open, and a workflow command must
    # start a line)
    printf '\n::warning::%s: attempt %d failed (exit %d, 124 = timed out) after %d s\n' \
      "$label" "$n" "$rc" "$((SECONDS - start))"
    if [ "$n" -ge 2 ]; then
      printf '\n::error::%s failed twice\n' "$label"
      return 1
    fi
    n=2 limit="$retry"
    # a run cut off while dpkg was unpacking leaves packages half-configured
    sudo dpkg --configure -a || true
    "$before_retry"
  done
}

deps() { run_as_root "$2" npx playwright install-deps "$1"; }
download() { timeout --kill-after=15s "$2" npx playwright install "$1"; }
apt_install() { run_as_root "$1" apt-get install -y --no-install-recommends "${APT_PACKAGES[@]}"; }
nothing() { :; }

case "${1:-}" in
  browser)
    b="${2:?browser name}"
    configure_apt
    attempt_twice "system dependencies for $b" "$DEPS_FIRST_S" "$DEPS_RETRY_S" demote_first_mirror \
      deps "$b"
    attempt_twice "$b download" "$DOWNLOAD_S" "$DOWNLOAD_S" nothing download "$b"
    ;;
  apt)
    shift
    APT_PACKAGES=("$@")
    configure_apt
    run_as_root 120 apt-get update -q
    attempt_twice "apt-get install ${APT_PACKAGES[*]}" "$DEPS_FIRST_S" "$DEPS_RETRY_S" \
      demote_first_mirror apt_install
    ;;
  *)
    echo "usage: $0 browser <chromium|firefox|webkit> | apt <package>..." >&2
    exit 2
    ;;
esac

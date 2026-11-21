#!/bin/sh
# Remove test accounts (and their days, sessions and share links) from the
# Railway deployment. Nothing else is deleted.
#
#   scripts/purge-test-users.sh                 # dry run: lists what would go
#   scripts/purge-test-users.sh --apply         # deletes
#   scripts/purge-test-users.sh --apply @test.example
#
# The image has no shell, so the server does the work itself at start-up when
# TTL_PURGE_EMAIL_SUFFIX is set. This script sets the variable (which
# redeploys), prints the purge lines from the new container's log, then
# removes the variables and redeploys so the purge never runs again.
# Needs: railway CLI, logged in and linked to the throughthelense service.
set -eu

apply=0
suffix=@example.org
for arg in "$@"; do
  case "$arg" in
    --apply) apply=1 ;;
    @*) suffix=$arg ;;
    *) echo "usage: $0 [--apply] [@domain]" >&2; exit 2 ;;
  esac
done

latest() {
  railway deployment list --json 2>/dev/null |
    python3 -c 'import json,sys; d=json.load(sys.stdin)[0]; print(d["id"], d["status"])'
}

# wait_new OLD_ID: wait until a deployment other than OLD_ID finishes.
wait_new() {
  i=0
  while [ $i -lt 60 ]; do
    set -- "$1" $(latest)
    if [ "$2" != "$1" ]; then
      case "$3" in
        SUCCESS) return 0 ;;
        FAILED|CRASHED|REMOVED) echo "deployment $2: $3" >&2; return 1 ;;
      esac
    fi
    i=$((i + 1)); sleep 10
  done
  echo "timed out waiting for the deployment" >&2; return 1
}

cleanup() {
  railway variable delete TTL_PURGE_EMAIL_SUFFIX >/dev/null 2>&1 || true
  railway variable delete TTL_PURGE_APPLY >/dev/null 2>&1 || true
}
trap cleanup EXIT

[ $apply = 1 ] && echo "Deleting accounts ending in $suffix" || echo "Dry run for accounts ending in $suffix"
before=$(latest | cut -d' ' -f1)
railway variable set "TTL_PURGE_EMAIL_SUFFIX=$suffix" "TTL_PURGE_APPLY=$apply" >/dev/null
wait_new "$before"
sleep 5
railway logs --deployment 2>/dev/null | grep 'purge:' || echo "no purge lines in the log yet: railway logs --deployment | grep purge:"

cleanup
trap - EXIT
before=$(latest | cut -d' ' -f1)
railway redeploy -y >/dev/null
wait_new "$before"
echo "Purge variables removed; the service runs normally again."

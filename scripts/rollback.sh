#!/bin/sh
# Put a previous Railway deployment back in a few seconds, without a build.
#
#   scripts/rollback.sh                 # list recent deployments
#   scripts/rollback.sh <deployment-id> # roll back to it
#
# Railway stops the running container before starting a new one (the volume
# can be attached to one container only), so a deployment whose server does
# not start leaves the site down with 502 until something else is deployed.
# A rollback restores that deployment's image and variable values. It does
# not change the service variables: if a variable caused the failure, fix it
# too (railway variable set NAME=value --skip-deploys) or the next deploy
# fails again.
# Needs: railway CLI, logged in and linked to the throughthelense service.
set -eu

if [ $# -eq 0 ]; then
  railway deployment list --json 2>/dev/null | python3 -c '
import json, sys
for d in json.load(sys.stdin)[:10]:
    m = d.get("meta") or {}
    note = (m.get("commitMessage") or m.get("reason") or "").splitlines()[0:1]
    print(d["id"], d["status"].ljust(9), d["createdAt"][:19], *note)'
  echo
  echo "Pick the last deployment that worked (the one before the broken one) and run:"
  echo "  $0 <deployment-id>"
  exit 0
fi

case "$1" in
  *[!0-9a-f-]*|"") echo "not a deployment id: $1" >&2; exit 2 ;;
esac
railway api "mutation { deploymentRollback(id: \"$1\") }" 2>/dev/null | grep -q '"deploymentRollback": true' ||
  { echo "rollback was refused; use the dashboard: Deployments → deployment → ⋮ → Rollback" >&2; exit 1; }
echo "Rolling back to $1. Waiting for it to start…"
i=0
while [ $i -lt 30 ]; do
  status=$(railway deployment list --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["status"])')
  case "$status" in
    SUCCESS) echo "Done: the site runs the restored deployment."; exit 0 ;;
    FAILED|CRASHED) echo "Restored deployment did not start ($status)." >&2; exit 1 ;;
  esac
  i=$((i + 1)); sleep 5
done
echo "Still not running after 150 s; check railway logs --deployment" >&2
exit 1

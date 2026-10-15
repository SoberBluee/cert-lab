#!/usr/bin/env bash
# Two working releases (OLD, UPG) and two stuck ones (STUCK, STUCK-2) in state STUCK_KIND: an install
# or upgrade killed mid --wait stays pending-install / pending-upgrade; one that times out is failed.
set -euo pipefail
export HOME=/root

kubectl delete namespace "$NS" --ignore-not-found --wait=true >/dev/null

helm repo add lab http://controlplane:8879 >/dev/null
helm repo update lab >/dev/null
runuser -u ubuntu -- env HOME=/home/ubuntu helm repo add lab http://controlplane:8879 >/dev/null
runuser -u ubuntu -- env HOME=/home/ubuntu helm repo update lab >/dev/null

helm install "$OLD" lab/webapp --version 1.0.0 -n "$NS" --create-namespace --wait --timeout 3m >/dev/null
helm install "$UPG" lab/webapp --version 1.1.0 -n "$NS" --wait --timeout 3m >/dev/null

for name in "$STUCK" "$STUCK-2"; do
  case "$STUCK_KIND" in
    pending-install)
      timeout -s KILL 15 helm install "$name" lab/webapp --version 1.0.0 -n "$NS" \
        --set image.tag=does-not-exist --wait --timeout 10m >/dev/null 2>&1 || true ;;
    pending-upgrade)
      helm install "$name" lab/webapp --version 1.0.0 -n "$NS" --wait --timeout 3m >/dev/null
      timeout -s KILL 15 helm upgrade "$name" lab/webapp --version 1.1.0 -n "$NS" \
        --set image.tag=does-not-exist --wait --timeout 10m >/dev/null 2>&1 || true ;;
    failed)
      helm install "$name" lab/webapp --version 1.0.0 -n "$NS" \
        --set image.tag=does-not-exist --wait --timeout 20s >/dev/null 2>&1 || true ;;
    *) echo "unknown STUCK_KIND $STUCK_KIND" >&2; exit 1 ;;
  esac
done

for name in "$STUCK" "$STUCK-2"; do
  status="$(helm -n "$NS" list -a -o json | jq -r --arg n "$name" '.[] | select(.name == $n) | .status')"
  [[ "$status" == "$STUCK_KIND" ]] || { echo "expected $name in $STUCK_KIND, got: ${status:-none}" >&2; exit 1; }
done

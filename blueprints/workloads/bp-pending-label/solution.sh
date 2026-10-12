#!/usr/bin/env bash
set -euo pipefail

kubectl label node "$NODE" disk="$DISK" --overwrite
kubectl -n "$NS" wait --for=condition=Ready "pod/$POD" --timeout=180s

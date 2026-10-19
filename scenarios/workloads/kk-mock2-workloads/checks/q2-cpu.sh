#!/usr/bin/env bash
set -euo pipefail
want=$(kubectl get node worker-1 -o jsonpath='{.status.capacity.cpu}')
got=$(awk -F': *' '/^cpu:/{print $2; exit}' /opt/course/worker-1-cpu.txt 2>/dev/null || true)
[[ -n "$want" && "$got" == "$want" ]] && echo ok || echo "want=$want got=$got"

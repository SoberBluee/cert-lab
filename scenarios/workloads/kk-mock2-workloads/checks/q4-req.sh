#!/usr/bin/env bash
set -euo pipefail
# Request must be ≤ limit 100Mi (104857600 bytes).
req=$(kubectl get pod "${Q4_POD}" -o jsonpath='{.spec.containers[0].resources.requests.memory}')
lim=$(kubectl get pod "${Q4_POD}" -o jsonpath='{.spec.containers[0].resources.limits.memory}')
[[ "$lim" == "100Mi" ]] || { echo "limit=$lim"; exit 0; }
to_bytes() {
  local v=$1
  case "$v" in
    *Gi) echo $((${v%Gi} * 1024 * 1024 * 1024)) ;;
    *Mi) echo $((${v%Mi} * 1024 * 1024)) ;;
    *Ki) echo $((${v%Ki} * 1024)) ;;
    *) echo "$v" ;;
  esac
}
rb=$(to_bytes "$req")
lb=$(to_bytes "100Mi")
[[ "$rb" -le "$lb" ]] && echo ok || echo "req=$req"

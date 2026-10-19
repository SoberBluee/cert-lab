#!/usr/bin/env bash
# CoreDNS starts healthy; the learner must add cka.local. No break needed beyond documenting current state.
set -euo pipefail
kubectl -n kube-system get cm coredns -o jsonpath='{.data.Corefile}' | grep -q 'cluster.local'

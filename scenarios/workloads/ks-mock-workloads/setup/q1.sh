#!/usr/bin/env bash
set -euo pipefail

kubectl delete namespace "$Q1_NS" --ignore-not-found --wait=true >/dev/null
kubectl create namespace "$Q1_NS" >/dev/null
rm -f /opt/course/q1/pending-reason.txt

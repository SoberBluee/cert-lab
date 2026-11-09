#!/usr/bin/env bash
set -euo pipefail

out=/opt/course/api-resources

# Question 1
line="$(kubectl api-resources --no-headers | awk -v kind="${Q1_KIND}" '$NF == kind')"
{
  echo "$line" | awk '{print $2}'
  echo "$line" | awk '{print $3}' | cut -d/ -f1
  echo "$line" | awk '{print $4}'
} > "$out/vendor.txt"
kubectl api-resources --api-group=networking.k8s.io -o name | sed 's/\..*//' > "$out/networking.txt"

# Question 2
for type in $(kubectl api-resources --namespaced --verbs=list -o name); do
  kubectl -n "${Q2_NS}" get "$type" -l "audit=${Q2_FLAG}" -o name 2>/dev/null || true
done | sort -u > "$out/flagged.txt"

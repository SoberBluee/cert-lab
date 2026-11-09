#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl -n "${Q1_NS}" create service externalname database --external-name "${Q1_DB}.data-tier.svc.cluster.local"

# Question 2
kubectl -n "${Q2_NS}" patch service "${Q2_SVC}" --type=merge -p '{"spec":{"type":"ExternalName","externalName":"api-v2.platform.svc.cluster.local"}}'
kubectl -n "${Q2_NS}" delete deployment "${Q2_SVC}"

#!/usr/bin/env bash
set -euo pipefail

# Question 1: one patch, so the rollout that follows already has room to move.
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" -p "$(cat <<EOF
{"spec":{"strategy":{"rollingUpdate":{"maxSurge":0,"maxUnavailable":1}},"template":{"spec":{"nodeSelector":null,"affinity":{"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"topologyKey":"kubernetes.io/hostname","labelSelector":{"matchLabels":{"app":"${Q1_APP}"}}}]}}}}}}
EOF
)"
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=180s

# Question 2
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" -p "$(cat <<EOF
{"spec":{"strategy":{"type":"Recreate","rollingUpdate":null},"template":{"spec":{"affinity":{"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":null,"preferredDuringSchedulingIgnoredDuringExecution":[{"weight":100,"podAffinityTerm":{"topologyKey":"kubernetes.io/hostname","labelSelector":{"matchLabels":{"app":"${Q2_APP}"}}}}]}}}}}}
EOF
)"
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=180s

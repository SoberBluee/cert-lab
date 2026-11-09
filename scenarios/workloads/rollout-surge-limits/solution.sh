#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" -p '{"spec":{"strategy":{"rollingUpdate":{"maxSurge":0,"maxUnavailable":1}}}}'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=180s

# Question 2
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" -p '{"spec":{"progressDeadlineSeconds":20,"minReadySeconds":3}}'
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=60s
kubectl -n "${Q2_NS}" set image "deployment/${Q2_APP}" web=nginx:0.0-missing
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=90s || true
kubectl -n "${Q2_NS}" get deployment "${Q2_APP}" -o jsonpath='{.status.conditions[?(@.type=="Progressing")].reason}' > /opt/course/rollout/reason.txt
kubectl -n "${Q2_NS}" rollout undo "deployment/${Q2_APP}"
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=90s

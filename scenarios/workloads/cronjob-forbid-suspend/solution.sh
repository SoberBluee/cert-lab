#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl -n "${Q1_NS}" patch cronjob "${Q1_CJ}" --type=merge -p '{"spec":{"jobTemplate":{"spec":{"activeDeadlineSeconds":45}}}}'
stuck="$(kubectl -n "${Q1_NS}" get cronjob "${Q1_CJ}" -o jsonpath='{.status.active[0].name}')"
kubectl -n "${Q1_NS}" delete job "$stuck"

# Question 2
kubectl -n "${Q2_NS}" patch cronjob "${Q2_CJ}" --type=merge -p '{"spec":{"suspend":true}}'
kubectl -n "${Q2_NS}" create job "${Q2_CJ}-manual" --from="cronjob/${Q2_CJ}"

#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"add","path":"/spec/template/spec/initContainers/0/securityContext/capabilities/add","value":["NET_ADMIN"]}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=180s

# Question 2
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/securityContext/capabilities/add","value":["CHOWN","SETGID","SETUID"]}]'
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=180s

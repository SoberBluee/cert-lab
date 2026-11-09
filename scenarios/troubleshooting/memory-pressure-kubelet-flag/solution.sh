#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[
  {"op":"add","path":"/spec/template/spec/initContainers/0/resources","value":{"requests":{"cpu":"20m","memory":"16Mi"},"limits":{"cpu":"20m","memory":"16Mi"}}},
  {"op":"add","path":"/spec/template/spec/containers/0/resources/limits","value":{"cpu":"100m","memory":"128Mi"}},
  {"op":"add","path":"/spec/template/spec/containers/1/resources","value":{"requests":{"cpu":"50m","memory":"32Mi"},"limits":{"cpu":"50m","memory":"32Mi"}}}
]'

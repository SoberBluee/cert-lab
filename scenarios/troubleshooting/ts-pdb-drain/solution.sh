#!/usr/bin/env bash
set -euo pipefail
kubectl -n "${NS}" patch pdb "${APP}-pdb" --type=merge -p '{"spec":{"minAvailable":0}}'
kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s
kubectl drain "${NODE}" --ignore-daemonsets --delete-emptydir-data --force --timeout=180s

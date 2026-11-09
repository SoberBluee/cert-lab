#!/usr/bin/env bash
set -euo pipefail

mv /etc/kubernetes/manifests/kube-scheduler.yaml /etc/kubernetes/kube-scheduler.yaml.maintenance
timeout 60 bash -c 'while [[ -n "$(crictl ps --name kube-scheduler -q 2>/dev/null)" ]]; do sleep 1; done'
kubectl cordon worker-1 >/dev/null

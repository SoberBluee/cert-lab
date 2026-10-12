#!/usr/bin/env bash
# Runs on controlplane.
set -euo pipefail

sed -i -E 's|^(\s*)- kube-schedular$|\1- kube-scheduler|' /etc/kubernetes/manifests/kube-scheduler.yaml

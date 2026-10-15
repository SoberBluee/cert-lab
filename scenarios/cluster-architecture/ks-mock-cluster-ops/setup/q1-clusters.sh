#!/usr/bin/env bash
# Runs after setup/q1.sh: adds two more clusters, and points some of its contexts at them.
set -euo pipefail

cfg=/home/ubuntu/.kube/config
kc() { kubectl --kubeconfig "$cfg" config "$@" >/dev/null; }
kc set-cluster staging --server=https://192.0.2.10:6443 --insecure-skip-tls-verify=true
kc set-cluster legacy --server=https://10.20.0.5:8443 --insecure-skip-tls-verify=true
kc set-context infra-stage --cluster=staging --user=kubernetes-admin --namespace=default
kc set-context legacy-admin --cluster=legacy --user=kubernetes-admin
kc set-context "staging-${Q1_USER}" --cluster=staging --user="$Q1_USER"
chown -R ubuntu:ubuntu /home/ubuntu/.kube

#!/usr/bin/env bash
# Adds the exam context (defaulting to a decoy namespace) plus noise contexts to the learner's kubeconfigs.
set -euo pipefail

kubectl create namespace "$DECOY_NS" >/dev/null 2>&1 || kubectl get namespace "$DECOY_NS" >/dev/null
kubectl delete namespace "$NS" --ignore-not-found --wait=true >/dev/null
kubectl delete pv sec-pv --ignore-not-found --wait=true >/dev/null

for cfg in /home/ubuntu/.kube/config /root/.kube/config; do
  [[ -f "$cfg" ]] || continue
  kubectl --kubeconfig "$cfg" config set-context "$CTX" --cluster=kubernetes --user=kubernetes-admin --namespace="$DECOY_NS" >/dev/null
  kubectl --kubeconfig "$cfg" config set-context dev-admin --cluster=kubernetes --user=kubernetes-admin --namespace=default >/dev/null
  kubectl --kubeconfig "$cfg" config set-context qa-readonly --cluster=kubernetes --user=kubernetes-admin --namespace=kube-public >/dev/null
  kubectl --kubeconfig "$cfg" config get-contexts -o name | grep -qx "$CTX"
done
chown -R ubuntu:ubuntu /home/ubuntu/.kube

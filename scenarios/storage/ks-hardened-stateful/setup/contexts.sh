#!/usr/bin/env bash
# Adds the exam context (defaulting to a decoy namespace) plus noise contexts to the learner's kubeconfigs.
set -euo pipefail

kubectl create namespace "$DECOY_NS" >/dev/null 2>&1 || kubectl get namespace "$DECOY_NS" >/dev/null
kubectl delete namespace "$NS" --ignore-not-found --wait=true >/dev/null
kubectl delete pv sec-pv --ignore-not-found --wait=true >/dev/null

# TRAP=default-sc: a default StorageClass fills in storageClassName on any PVC that names none,
# so the claim no longer matches a PV without a class.
case "$TRAP" in
  default-sc)
    kubectl apply -f - >/dev/null <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: standard
  annotations: { storageclass.kubernetes.io/is-default-class: "true" }
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
EOF
    ;;
  plain | stale-dir) ;;
  *) echo "unknown TRAP $TRAP" >&2; exit 1 ;;
esac

for cfg in /home/ubuntu/.kube/config /root/.kube/config; do
  [[ -f "$cfg" ]] || continue
  kubectl --kubeconfig "$cfg" config set-context "$CTX" --cluster=kubernetes --user=kubernetes-admin --namespace="$DECOY_NS" >/dev/null
  kubectl --kubeconfig "$cfg" config set-context dev-admin --cluster=kubernetes --user=kubernetes-admin --namespace=default >/dev/null
  kubectl --kubeconfig "$cfg" config set-context qa-readonly --cluster=kubernetes --user=kubernetes-admin --namespace=kube-public >/dev/null
  kubectl --kubeconfig "$cfg" config get-contexts -o name | grep -qx "$CTX"
done
chown -R ubuntu:ubuntu /home/ubuntu/.kube

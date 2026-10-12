#!/usr/bin/env bash
set -euo pipefail

kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' > /tmp/Corefile
sed -i -E 's|^(\s*)forwardd \. /etc/resolv\.conf|\1forward . /etc/resolv.conf|' /tmp/Corefile
kubectl -n kube-system create configmap coredns --from-file=Corefile=/tmp/Corefile --dry-run=client -o yaml | kubectl replace -f -
rm -f /tmp/Corefile
kubectl -n kube-system rollout restart deployment coredns
kubectl -n kube-system rollout status deployment coredns --timeout=180s

#!/usr/bin/env bash
set -euo pipefail

kubeadm certs check-expiration | awk '/<invalid>/ {print $1}' > /opt/course/certs/expired.txt
kubeadm certs renew apiserver-kubelet-client
kubeadm certs renew front-proxy-client

mv /etc/kubernetes/manifests/kube-apiserver.yaml /root/kube-apiserver.yaml
timeout 60 bash -c 'while crictl ps --name kube-apiserver -q 2>/dev/null | grep -q .; do sleep 1; done'
mv /root/kube-apiserver.yaml /etc/kubernetes/manifests/kube-apiserver.yaml
timeout 180 bash -c 'until kubectl get --raw=/readyz >/dev/null 2>&1; do sleep 2; done'

#!/usr/bin/env bash
# Adds a certificate user and several contexts to the learner's kubeconfig.
set -euo pipefail

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
openssl genrsa -out "$work/u.key" 2048 2>/dev/null
openssl req -new -key "$work/u.key" -subj "/CN=${Q1_USER}/O=ops" -out "$work/u.csr" 2>/dev/null
openssl x509 -req -in "$work/u.csr" -CA /etc/kubernetes/pki/ca.crt -CAkey /etc/kubernetes/pki/ca.key -CAcreateserial \
  -days 90 -out "$work/u.crt" 2>/dev/null

cfg=/home/ubuntu/.kube/config
kc() { kubectl --kubeconfig "$cfg" config "$@" >/dev/null; }
kc set-credentials "$Q1_USER" --client-certificate="$work/u.crt" --client-key="$work/u.key" --embed-certs=true
kc set-context "${Q1_USER}@kubernetes" --cluster=kubernetes --user="$Q1_USER"
kc set-context infra-prod --cluster=kubernetes --user=kubernetes-admin --namespace=kube-system
kc set-context infra-stage --cluster=kubernetes --user=kubernetes-admin --namespace=default
kc set-context legacy-admin --cluster=kubernetes --user=kubernetes-admin
chown -R ubuntu:ubuntu /home/ubuntu/.kube
kubectl --kubeconfig "$cfg" config view --raw -o jsonpath="{.users[?(@.name==\"${Q1_USER}\")].user.client-certificate-data}" | grep -q .

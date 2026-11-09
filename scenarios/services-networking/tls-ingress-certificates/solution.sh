#!/usr/bin/env bash
set -euo pipefail

# Question 1
host="${Q1_SUB}.${Q1_NS}.lab"
dir="/opt/course/tls/${Q1_NS}"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$dir/tls.key" -out "$dir/tls.crt" -days 90 -subj "/CN=$host" -addext "subjectAltName=DNS:$host"
kubectl -n "${Q1_NS}" create secret tls web-tls --cert="$dir/tls.crt" --key="$dir/tls.key"
kubectl -n "${Q1_NS}" patch ingress web --type=merge -p '{"spec":{"tls":[{"hosts":["'"$host"'"],"secretName":"web-tls"}]}}'

# Question 2
kubectl -n cert-store get secret site-tls -o json |
  jq --arg ns "${Q2_NS}" '{apiVersion, kind, type, data, metadata: {name: .metadata.name, namespace: $ns}}' |
  kubectl apply -f -

#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root on controlplane.
set -euo pipefail

as_ubuntu() { runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config "$@"; }

ns=$(as_ubuntu helm list -A -o json | jq -r --arg r "$REL" '.[] | select(.name == $r) | .namespace')
echo "$ns" > /opt/course/helm/namespace.txt
as_ubuntu helm -n "$ns" get values "$REL"
case "$BREAK" in
  image-tag) key=image.tag; fix=(--set image.tag=1.27-alpine) ;;
  node-selector) key=nodeSelector; fix=(--set nodeSelector.disktype=null) ;;
  cpu-request) key=resources.requests.cpu; fix=(--set resources.requests.cpu=null) ;;
esac
echo "$key" > /opt/course/helm/bad-value.txt
# --reuse-values keeps replicaCount and the owner annotation; the --set replaces or removes the bad value.
as_ubuntu helm -n "$ns" upgrade "$REL" lab/webapp --version 1.1.0 --reuse-values "${fix[@]}" --wait --timeout 3m

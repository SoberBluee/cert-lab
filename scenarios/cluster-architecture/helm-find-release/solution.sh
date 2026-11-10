#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root on controlplane.
set -euo pipefail

as_ubuntu() { runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config "$@"; }

found=''
for r in $(as_ubuntu helm list -A -o json | jq -r '.[] | select(.chart == "webapp-1.0.0") | .namespace + "/" + .name'); do
  ns=$(dirname "$r") rel=$(basename "$r")
  if as_ubuntu helm -n "$ns" get manifest "$rel" | grep -q 'nginx:1.28-alpine'; then found=$r; fi
done
[[ -n "$found" ]] || { echo "no release on chart 1.0.0 runs nginx:1.28-alpine" >&2; exit 1; }
echo "$found" > /opt/course/helm/release.txt
ns=$(dirname "$found") rel=$(basename "$found")
as_ubuntu helm -n "$ns" get values "$rel" -o yaml > /opt/course/helm/values.yaml
as_ubuntu helm -n "$ns" upgrade "$rel" lab/webapp --version 1.0.0 --reuse-values --set replicaCount="$REPLICAS" --wait --timeout 3m

#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root on controlplane.
set -euo pipefail

as_ubuntu() { runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config "$@"; }

as_ubuntu helm pull lab/webapp --version 2.0.0 --untar -d /opt/course/helm/charts
c=/opt/course/helm/charts/webapp
sed -i -E 's/^version:.*/version: 2.0.1/' "$c/Chart.yaml"
sed -i -E "s/^replicaCount:.*/replicaCount: $REPLICAS/" "$c/values.yaml"
# Only the type under service:, not any other type in values.yaml.
sed -i -E '/^service:/,/^[^ #]/ s/^(  type:) ClusterIP/\1 NodePort/' "$c/values.yaml"
as_ubuntu helm template check "$c" | grep -E '^\s+(replicas|type):'
as_ubuntu helm package "$c" -d /opt/course/helm
as_ubuntu helm install "$REL" /opt/course/helm/webapp-2.0.1.tgz -n "$NS" --create-namespace --wait --timeout 3m

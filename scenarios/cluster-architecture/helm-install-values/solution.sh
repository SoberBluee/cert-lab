#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root on controlplane.
set -euo pipefail

as_ubuntu() { runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config "$@"; }

as_ubuntu helm repo add lab http://controlplane:8879
as_ubuntu helm repo update lab
as_ubuntu helm search repo lab/webapp --versions > /opt/course/helm/versions.txt
as_ubuntu helm install "$REL" lab/webapp --version 1.1.0 -n "$NS" --create-namespace \
  --set replicaCount="$REPLICAS" --set service.type=NodePort --wait --timeout 3m

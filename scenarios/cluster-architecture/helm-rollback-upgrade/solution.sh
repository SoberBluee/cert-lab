#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root on controlplane.
set -euo pipefail

as_ubuntu() { runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config "$@"; }

as_ubuntu helm -n "$NS" history "$REL"
echo 2 > /opt/course/helm/broken-revision.txt
as_ubuntu helm -n "$NS" rollback "$REL" 1 --wait --timeout 3m
as_ubuntu helm -n "$NS" upgrade "$REL" lab/webapp --version "$TARGET" --reuse-values --wait --timeout 3m

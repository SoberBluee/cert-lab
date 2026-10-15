#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root on controlplane.
set -euo pipefail

as_ubuntu() { runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config "$@"; }

as_ubuntu helm -n "$NS" uninstall "$OLD" --wait
as_ubuntu helm -n "$NS" upgrade "$UPG" lab/webapp --wait --timeout 3m
as_ubuntu helm -n "$NS" install "$NEW" lab/webapp --version 1.0.0 --set replicaCount=2 --wait --timeout 3m
for r in $(as_ubuntu helm -n "$NS" list -a -o json | jq -r '.[] | select(.status | test("^pending|^failed$")) | .name'); do
  as_ubuntu helm -n "$NS" uninstall "$r"
done

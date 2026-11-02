#!/usr/bin/env bash
# Pins every image containerd keeps for Kubernetes, so the kubelet's image garbage collection never deletes
# a pre-pulled image and sends a lab back to the registry in the middle of a question's setup. containerd
# reads the label when it starts, as it does on every restore of the snapshot taken next. Safe to run again.
# Usage: pin-images.sh
set -euo pipefail

refs="$(ctr -n k8s.io images ls -q)"
[[ -n "$refs" ]] || { echo "containerd has no images to pin" >&2; exit 1; }
n=0
while read -r ref; do
  ctr -n k8s.io images label "$ref" io.cri-containerd.pinned=pinned >/dev/null
  n=$((n + 1))
done <<< "$refs"
echo "==> pinned $n image references"

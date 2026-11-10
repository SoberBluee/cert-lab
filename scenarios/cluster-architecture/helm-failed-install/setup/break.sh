#!/usr/bin/env bash
# Two healthy webapp releases in other namespaces, then release $REL in $NS, whose install timed out
# on one bad value chosen by BREAK: an image tag that does not exist, a nodeSelector no node matches,
# or a CPU request no node fits. Its only revision is failed, so there is nothing to roll back to.
set -euo pipefail
export HOME=/root

for ns in "$NS" web-shared docs-site; do kubectl delete namespace "$ns" --ignore-not-found --wait=true >/dev/null; done
mkdir -p /opt/course/helm
rm -f /opt/course/helm/namespace.txt /opt/course/helm/bad-value.txt
chown -R ubuntu:ubuntu /opt/course

helm repo add lab http://controlplane:8879 >/dev/null
helm repo update lab >/dev/null
runuser -u ubuntu -- env HOME=/home/ubuntu helm repo add lab http://controlplane:8879 >/dev/null
runuser -u ubuntu -- env HOME=/home/ubuntu helm repo update lab >/dev/null

# Neighbours, so that helm list -A shows more than the broken release.
helm install docs lab/webapp --version 1.0.0 -n docs-site --create-namespace >/dev/null
helm install frontend lab/webapp --version 1.1.0 -n web-shared --create-namespace >/dev/null

case "$BREAK" in
  image-tag) bad=(--set image.tag=1.27-alpinee) ;;
  node-selector) bad=(--set nodeSelector.disktype=nvme) ;;
  cpu-request) bad=(--set resources.requests.cpu=64) ;;
  *) echo "unknown BREAK $BREAK" >&2; exit 1 ;;
esac
# --wait marks the release failed when its Pods are not ready in time.
if helm install "$REL" lab/webapp --version 1.1.0 -n "$NS" --create-namespace \
  --set replicaCount=2 --set podAnnotations.owner="$OWNER" "${bad[@]}" --wait --timeout 45s >/dev/null 2>&1; then
  echo "the install of $REL did not fail" >&2
  exit 1
fi
status=$(helm -n "$NS" list -a -o json | jq -r --arg r "$REL" '.[] | select(.name == $r) | .status')
[[ "$status" == failed ]] || { echo "release $REL is $status, not failed" >&2; exit 1; }
# The checks read the hidden values from here: scenario.yaml may not name them.
mkdir -p /root/.cka
printf 'NS=%q\nBREAK=%q\n' "$NS" "$BREAK" > /root/.cka/helm-failed-install.env
chmod 600 /root/.cka/helm-failed-install.env

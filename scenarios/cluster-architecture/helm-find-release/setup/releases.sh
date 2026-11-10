#!/usr/bin/env bash
# Four webapp releases in four namespaces. The one to find, $T_REL in $T_NS, is on chart 1.0.0 with
# its image tag overridden to 1.28-alpine; frontend also runs 1.28-alpine, but from chart 2.0.0.
# The target's user values are kept in /root/.cka for the checks.
set -euo pipefail
export HOME=/root

for ns in "$T_NS" docs-site web-shared ops; do kubectl delete namespace "$ns" --ignore-not-found --wait=true >/dev/null; done
mkdir -p /opt/course/helm /root/.cka
rm -f /opt/course/helm/release.txt /opt/course/helm/values.yaml /root/.cka/helm-find-values.json
chown -R ubuntu:ubuntu /opt/course

helm repo add lab http://controlplane:8879 >/dev/null
helm repo update lab >/dev/null
runuser -u ubuntu -- env HOME=/home/ubuntu helm repo add lab http://controlplane:8879 >/dev/null
runuser -u ubuntu -- env HOME=/home/ubuntu helm repo update lab >/dev/null

helm install docs lab/webapp --version 1.0.0 -n docs-site --create-namespace >/dev/null
helm install frontend lab/webapp --version 2.0.0 -n web-shared --create-namespace >/dev/null
helm install status lab/webapp --version 1.1.0 -n ops --create-namespace --set podAnnotations.owner=sre >/dev/null

values=$(mktemp)
trap 'rm -f "$values"' EXIT
cat > "$values" <<EOF
service:
  type: NodePort
podAnnotations:
  owner: $OWNER
EOF
helm install "$T_REL" lab/webapp --version 1.0.0 -n "$T_NS" --create-namespace -f "$values" \
  --set image.tag=1.28-alpine --wait --timeout 3m >/dev/null
helm -n "$T_NS" get values "$T_REL" -o json > /root/.cka/helm-find-values.json
# The checks read the hidden values from here: scenario.yaml may not name them.
printf 'T_NS=%q\nT_REL=%q\n' "$T_NS" "$T_REL" > /root/.cka/helm-find-release.env
chmod 600 /root/.cka/helm-find-values.json /root/.cka/helm-find-release.env
grep -q '1.28-alpine' /root/.cka/helm-find-values.json || { echo "the target release has no image override" >&2; exit 1; }

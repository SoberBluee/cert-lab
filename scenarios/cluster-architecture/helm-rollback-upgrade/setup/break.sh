#!/usr/bin/env bash
# Revision 1 works (chart 1.0.0 with custom values); revision 2 sets one bad value, chosen by BREAK:
# an image tag that does not exist, a readiness path nginx answers with 404, or a CPU request no node fits.
set -euo pipefail
export HOME=/root

kubectl delete namespace "$NS" --ignore-not-found --wait=true >/dev/null
mkdir -p /opt/course/helm
rm -f /opt/course/helm/broken-revision.txt
chown -R ubuntu:ubuntu /opt/course

helm repo add lab http://controlplane:8879 >/dev/null
helm repo update lab >/dev/null
runuser -u ubuntu -- env HOME=/home/ubuntu helm repo add lab http://controlplane:8879 >/dev/null
runuser -u ubuntu -- env HOME=/home/ubuntu helm repo update lab >/dev/null

case "$BREAK" in
  image-tag) set_bad=(--set image.tag=1.26-alpinee); desc="Upgrade to the hardened image" ;;
  readiness-path) set_bad=(--set readinessProbe.httpGet.path=/healthz); desc="Use the health endpoint for readiness" ;;
  resources) set_bad=(--set resources.requests.cpu=64 --set resources.requests.memory=64Mi); desc="Reserve capacity for peak load" ;;
  *) echo "unknown BREAK $BREAK" >&2; exit 1 ;;
esac

helm install "$REL" lab/webapp --version 1.0.0 -n "$NS" --create-namespace \
  --set replicaCount=2 --set podAnnotations.team="$TEAM" --wait --timeout 3m >/dev/null
helm upgrade "$REL" lab/webapp --version 1.0.0 -n "$NS" --reuse-values \
  "${set_bad[@]}" --description "$desc" >/dev/null

broken() {
  case "$BREAK" in
    image-tag)
      kubectl -n "$NS" get pods -l "app.kubernetes.io/instance=$REL" \
        -o jsonpath='{range .items[*]}{.status.containerStatuses[0].state.waiting.reason}{"\n"}{end}' \
        | grep -qE 'ErrImagePull|ImagePullBackOff' ;;
    readiness-path) kubectl -n "$NS" get events --field-selector reason=Unhealthy -o name | grep -q . ;;
    resources) kubectl -n "$NS" get events --field-selector reason=FailedScheduling -o name | grep -q . ;;
  esac
}
for _ in $(seq 1 60); do
  broken && exit 0
  sleep 2
done
echo "the broken revision ($BREAK) did not show its symptom" >&2
exit 1

#!/usr/bin/env bash
# Takes the scheduler out ($SCHED_FAULT), then creates Pods nobody schedules.
set -euo pipefail

M=/etc/kubernetes/manifests/kube-scheduler.yaml
kubectl delete namespace "$NS" --ignore-not-found --wait=true >/dev/null
kubectl create namespace "$NS" >/dev/null

edit() { # sed -E expression, proof regex
  sed -i -E "$1" "$M"
  grep -qE -- "$2" "$M" || { echo "could not edit $M ($2)" >&2; exit 1; }
}

case "$SCHED_FAULT" in
  moved)
    mkdir -p "$HIDE_DIR"
    mv "$M" "$HIDE_DIR/kube-scheduler.yaml"
    [[ ! -e "$M" ]] || { echo "could not move the scheduler manifest" >&2; exit 1; }
    ;;
  kubeconfig-path) edit 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/scheduler)\.conf$#\1.config#' '- --kubeconfig=/etc/kubernetes/scheduler.config$' ;;
  image-tag) edit 's#^([[:space:]]*image: [^[:space:]]*kube-scheduler:[^[:space:]]+)$#\1-patched#' 'image: [^[:space:]]*kube-scheduler:[^[:space:]]+-patched$' ;;
  command) edit 's#^([[:space:]]*- kube-)scheduler$#\1schedular#' '^[[:space:]]*- kube-schedular$' ;;
  *) echo "unknown SCHED_FAULT $SCHED_FAULT" >&2; exit 1 ;;
esac

# Wait until no scheduler container runs any more.
for _ in $(seq 1 60); do
  [[ -z "$(crictl ps --name kube-scheduler -q 2>/dev/null)" ]] && break
  sleep 3
done
[[ -z "$(crictl ps --name kube-scheduler -q 2>/dev/null)" ]] || { echo "the scheduler is still running" >&2; exit 1; }
if [[ "$SCHED_FAULT" == moved ]]; then
  for _ in $(seq 1 60); do
    kubectl -n kube-system get pod kube-scheduler-controlplane >/dev/null 2>&1 || break
    sleep 3
  done
fi
# The old scheduler's leader lease must not pick up the new Pods before it expires.
sleep 20

timeout 60 bash -c "until kubectl -n '$NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata: { name: ${APP}, namespace: ${NS} }
spec:
  replicas: 3
  selector: { matchLabels: { app: ${APP} } }
  template:
    metadata: { labels: { app: ${APP} } }
    spec:
      containers:
        - name: ${APP}
          image: nginx:1.27-alpine
          resources: { requests: { cpu: 10m, memory: 16Mi } }
---
apiVersion: v1
kind: Pod
metadata: { name: manual-${APP}, namespace: ${NS}, labels: { app: manual-${APP} } }
spec:
  containers:
    - name: manual
      image: httpd:2.4-alpine
      resources: { requests: { cpu: 10m, memory: 16Mi } }
EOF

sleep 10
[[ -z "$(kubectl -n "$NS" get pod "manual-${APP}" -o jsonpath='{.spec.nodeName}')" ]] || { echo "manual-${APP} was scheduled" >&2; exit 1; }

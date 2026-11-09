#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q1_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q1_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q1_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${Q1_CJ}-flags
  namespace: ${Q1_NS}
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ${Q1_CJ}
  namespace: ${Q1_NS}
spec:
  schedule: "* * * * *"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      backoffLimit: 0
      template:
        spec:
          restartPolicy: Never
          terminationGracePeriodSeconds: 1
          containers:
            - name: run
              image: busybox:1.36
              command: ["sh", "-c", "if [ -e /flags/ready ]; then echo done; else echo waiting for the upstream system; sleep 86400; fi"]
              volumeMounts:
                - { name: flags, mountPath: /flags }
          volumes:
            - name: flags
              configMap: { name: ${Q1_CJ}-flags }
EOF
kubectl -n "${Q1_NS}" get cronjob "${Q1_CJ}" -o jsonpath='{.metadata.uid}|{.spec.schedule}|{.spec.concurrencyPolicy}' > /var/tmp/cka-q1.uid
chmod 644 /var/tmp/cka-q1.uid
# The first run hangs for good; once the flag exists, later runs would succeed if they were allowed to start.
for _ in $(seq 1 60); do
  active="$(kubectl -n "${Q1_NS}" get cronjob "${Q1_CJ}" -o jsonpath='{.status.active[0].name}' 2>/dev/null || true)"
  [[ -n "$active" ]] && break
  sleep 2
done
[[ -n "$active" ]] || { echo "the first run never started" >&2; exit 1; }
kubectl -n "${Q1_NS}" wait --for=condition=Ready pod -l "job-name=$active" --timeout=90s >/dev/null
kubectl -n "${Q1_NS}" patch configmap "${Q1_CJ}-flags" --type=merge -p '{"data":{"ready":"yes"}}' >/dev/null

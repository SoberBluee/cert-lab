#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q2_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q2_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q2_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: ${Q2_APP}
  namespace: ${Q2_NS}
spec:
  clusterIP: None
  selector: { app: ${Q2_APP} }
  ports:
    - { port: 80 }
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ${Q2_APP}
  namespace: ${Q2_NS}
spec:
  serviceName: ${Q2_APP}
  replicas: 2
  podManagementPolicy: Parallel
  selector:
    matchLabels: { app: ${Q2_APP} }
  template:
    metadata:
      labels: { app: ${Q2_APP} }
    spec:
      terminationGracePeriodSeconds: 1
      containers:
        - name: node
          image: busybox:1.36
          command: ["sleep", "infinity"]
          readinessProbe:
            exec:
              command:
                - sh
                - -c
                - nslookup ${Q2_APP}-0.${Q2_APP}.${Q2_NS}.svc.cluster.local && nslookup ${Q2_APP}-1.${Q2_APP}.${Q2_NS}.svc.cluster.local
            periodSeconds: 3
            timeoutSeconds: 3
EOF
kubectl -n "${Q2_NS}" get statefulset "${Q2_APP}" -o jsonpath='{.metadata.uid}/{.metadata.generation}' > /var/tmp/cka-q2.uid
chmod 644 /var/tmp/cka-q2.uid
for _ in $(seq 1 60); do
  running="$(kubectl -n "${Q2_NS}" get pods -l "app=${Q2_APP}" --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l | tr -d ' ')"
  [[ "$running" == 2 ]] && break
  sleep 2
done
[[ "$running" == 2 ]] || { echo "expected 2 running Pods" >&2; exit 1; }
sleep 12
ready="$(kubectl -n "${Q2_NS}" get statefulset "${Q2_APP}" -o jsonpath='{.status.readyReplicas}')"
[[ -z "$ready" || "$ready" == 0 ]] || { echo "the Pods became ready by themselves" >&2; exit 1; }

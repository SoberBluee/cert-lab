#!/usr/bin/env bash
set -euo pipefail

# q1
cat >/opt/course/${Q1_POD}.yaml <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${Q1_POD}
spec:
  containers:
    - name: probe
      image: busybox:1.36
      args:
        - -c
        - sleep 3 ; touch /healthcheck; sleep 30; sleep 30000
      command: ["/bin/sh"]
      livenessProbe:
        exec:
          command: ["cat", "/healthcheck"]
        initialDelaySeconds: 5
        periodSeconds: 5
        failureThreshold: 1
EOF
kubectl delete pod "${Q1_POD}" --ignore-not-found >/dev/null 2>&1 || true
kubectl apply -f "/opt/course/${Q1_POD}.yaml"
kubectl wait --for=condition=Ready "pod/${Q1_POD}" --timeout=120s

# q3
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=json \
  -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"'"${Q3_APP}"'-config"}]'
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=180s

# q4
kubectl -n "${Q4_NS}" delete pvc "${Q4_NAME}-pvc" --wait=true
kubectl -n "${Q4_NS}" apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${Q4_NAME}-pvc
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: manual
  volumeName: ${Q4_NAME}-pv
  resources:
    requests:
      storage: 100Mi
EOF
kubectl -n "${Q4_NS}" wait --for=jsonpath='{.status.phase}'=Bound "pvc/${Q4_NAME}-pvc" --timeout=60s

# q5
kubectl delete pod "${Q5_POD}" --ignore-not-found >/dev/null 2>&1 || true
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${Q5_POD}
spec:
  containers:
    - name: writer
      image: busybox:1.36
      command: ["/bin/sh", "-c"]
      args:
        - while true; do date >> /tmp/now.txt; sleep 2; done
EOF
kubectl wait --for=condition=Ready "pod/${Q5_POD}" --timeout=120s

# q6
kubectl -n "${Q6_NS}" delete svc "${Q6_APP}-svc" --ignore-not-found
kubectl -n "${Q6_NS}" expose pod "${Q6_APP}" --name="${Q6_APP}-svc" --port=80 --target-port=80
for _ in $(seq 1 30); do
  kubectl -n "${Q6_NS}" exec curlpod -- wget -qO- -T 3 "http://${Q6_APP}-svc" 2>/dev/null | grep -q nginx && break
  sleep 2
done

#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace data
# Pods are rejected until the controller-manager creates the namespace's default ServiceAccount.
timeout 60 bash -c 'until kubectl -n data get serviceaccount default >/dev/null 2>&1; do sleep 1; done'

kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolume
metadata:
  name: data-pv
spec:
  capacity:
    storage: 1Gi
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /srv/data
    type: Directory
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - { key: kubernetes.io/hostname, operator: In, values: [worker-1] }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: db-data
  namespace: data
spec:
  storageClassName: fast
  accessModes: [ReadWriteMany]
  resources:
    requests:
      storage: 2Gi
EOF

mkdir -p /opt/cka
cat > /opt/cka/db-pod.yaml <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: db
  namespace: data
  labels: { app: db }
spec:
  containers:
    - name: db
      image: busybox:1.36
      command: ["sh", "-c", "while true; do date > /data/heartbeat; sleep 10; done"]
      volumeMounts:
        - { name: data, mountPath: /data }
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: db-data
EOF
chmod 644 /opt/cka/db-pod.yaml
kubectl apply -f /opt/cka/db-pod.yaml

sleep 10
[[ "$(kubectl -n data get pvc db-data -o jsonpath='{.status.phase}')" == Pending ]] || { echo "PVC is not Pending" >&2; exit 1; }
[[ "$(kubectl -n data get pod db -o jsonpath='{.status.phase}')" == Pending ]] || { echo "Pod is not Pending" >&2; exit 1; }

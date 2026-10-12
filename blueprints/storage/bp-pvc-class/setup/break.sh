#!/usr/bin/env bash
# NS, CLAIM and WRONG_CLASS come from the scenario variables.
set -euo pipefail

kubectl create namespace "$NS"
timeout 60 bash -c "until kubectl -n '$NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: $CLAIM-pv
spec:
  capacity: { storage: 1Gi }
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /srv/$CLAIM
    type: DirectoryOrCreate
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: $CLAIM
  namespace: $NS
spec:
  storageClassName: $WRONG_CLASS
  accessModes: [ReadWriteOnce]
  resources:
    requests: { storage: 1Gi }
EOF

mkdir -p /opt/cka
cat > "/opt/cka/$CLAIM-app.yaml" <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: $CLAIM-app
  namespace: $NS
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "while true; do date >> /data/log; sleep 10; done"]
      volumeMounts:
        - { name: data, mountPath: /data }
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: $CLAIM
EOF
chmod 644 "/opt/cka/$CLAIM-app.yaml"
kubectl apply -f "/opt/cka/$CLAIM-app.yaml"
sleep 5
[[ "$(kubectl -n "$NS" get pvc "$CLAIM" -o jsonpath='{.status.phase}')" == Pending ]]

#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl patch pv "${Q1_PV}" --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${Q1_PVC}
  namespace: ${Q1_NS}
spec:
  storageClassName: manual
  volumeName: ${Q1_PV}
  accessModes: [ReadWriteOnce]
  resources:
    requests: { storage: 1Gi }
---
apiVersion: v1
kind: Pod
metadata:
  name: reader
  namespace: ${Q1_NS}
spec:
  containers:
    - name: reader
      image: busybox:1.36
      command: ["sleep", "1d"]
      volumeMounts:
        - { name: data, mountPath: /data }
  volumes:
    - name: data
      persistentVolumeClaim: { claimName: ${Q1_PVC} }
EOF

# Question 2
pv="$(kubectl -n "${Q2_NS}" get pvc "${Q2_PVC}" -o jsonpath='{.spec.volumeName}')"
kubectl patch pv "$pv" -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
kubectl -n "${Q2_NS}" delete pod app
kubectl -n "${Q2_NS}" delete pvc "${Q2_PVC}"

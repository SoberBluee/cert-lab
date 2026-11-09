#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${Q1_SC}
provisioner: rancher.io/local-path
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${Q1_PVC}
  namespace: ${Q1_NS}
spec:
  storageClassName: ${Q1_SC}
  accessModes: [ReadWriteOnce]
  resources:
    requests: { storage: 128Mi }
---
apiVersion: v1
kind: Pod
metadata:
  name: ${Q1_POD}
  namespace: ${Q1_NS}
spec:
  nodeSelector:
    kubernetes.io/hostname: worker-2
  containers:
    - name: main
      image: busybox:1.36
      command: ["sleep", "1d"]
      volumeMounts:
        - { name: data, mountPath: /data }
  volumes:
    - name: data
      persistentVolumeClaim: { claimName: ${Q1_PVC} }
EOF

# Question 2
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=180s

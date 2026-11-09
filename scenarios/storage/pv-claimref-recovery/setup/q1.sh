#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q1_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q1_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q1_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: ${Q1_PV}
spec:
  capacity: { storage: 1Gi }
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath: { path: /srv/${Q1_PV}, type: DirectoryOrCreate }
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - { key: kubernetes.io/hostname, operator: In, values: [worker-1] }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${Q1_PVC}
  namespace: ${Q1_NS}
spec:
  storageClassName: manual
  accessModes: [ReadWriteOnce]
  resources:
    requests: { storage: 1Gi }
---
apiVersion: v1
kind: Pod
metadata:
  name: writer
  namespace: ${Q1_NS}
spec:
  restartPolicy: Never
  containers:
    - name: writer
      image: busybox:1.36
      command: ["sh", "-c", "echo ${Q1_MARK} > /data/ledger.txt"]
      volumeMounts:
        - { name: data, mountPath: /data }
  volumes:
    - name: data
      persistentVolumeClaim: { claimName: ${Q1_PVC} }
EOF
kubectl -n "${Q1_NS}" wait --for=jsonpath='{.status.phase}'=Succeeded pod/writer --timeout=180s >/dev/null
kubectl -n "${Q1_NS}" delete pod writer >/dev/null
kubectl -n "${Q1_NS}" delete pvc "${Q1_PVC}" >/dev/null
kubectl wait --for=jsonpath='{.status.phase}'=Released "pv/${Q1_PV}" --timeout=60s >/dev/null
kubectl get pv "${Q1_PV}" -o jsonpath='{.metadata.uid}/{.spec.persistentVolumeReclaimPolicy}' > /var/tmp/cka-q1.pv
chmod 644 /var/tmp/cka-q1.pv

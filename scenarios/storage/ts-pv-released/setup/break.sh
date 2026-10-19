#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${NS}" >/dev/null 2>&1 || true
timeout 60 bash -c "until kubectl -n '${NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: ${CLAIM}-pv
spec:
  capacity: { storage: 1Gi }
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /srv/${CLAIM}
    type: DirectoryOrCreate
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${CLAIM}
  namespace: ${NS}
spec:
  storageClassName: manual
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 500Mi
---
apiVersion: v1
kind: Pod
metadata:
  name: ${CLAIM}-app
  namespace: ${NS}
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "1d"]
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: ${CLAIM}
EOF

kubectl -n "${NS}" wait --for=jsonpath='{.status.phase}'=Bound "pvc/${CLAIM}" --timeout=60s
kubectl -n "${NS}" delete pod "${CLAIM}-app" --wait=true
kubectl -n "${NS}" delete pvc "${CLAIM}" --wait=true
for _ in $(seq 1 30); do
  [[ "$(kubectl get pv "${CLAIM}-pv" -o jsonpath='{.status.phase}')" == Released ]] && break
  sleep 1
done
[[ "$(kubectl get pv "${CLAIM}-pv" -o jsonpath='{.status.phase}')" == Released ]] || { echo "PV is not Released" >&2; exit 1; }

kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${CLAIM}
  namespace: ${NS}
spec:
  storageClassName: manual
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 500Mi
---
apiVersion: v1
kind: Pod
metadata:
  name: ${CLAIM}-app
  namespace: ${NS}
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "1d"]
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: ${CLAIM}
EOF

sleep 5
[[ "$(kubectl -n "${NS}" get pvc "${CLAIM}" -o jsonpath='{.status.phase}')" == Pending ]]

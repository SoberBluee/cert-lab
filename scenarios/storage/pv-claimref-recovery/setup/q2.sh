#!/usr/bin/env bash
set -euo pipefail

if ! kubectl -n local-path-storage get deployment local-path-provisioner >/dev/null 2>&1; then
  [[ -f /opt/cka/addons/local-path-storage.yaml ]] || { echo "these lab images have no local-path provisioner: run ./cka images extras (or rebuild the images)" >&2; exit 1; }
  kubectl apply -f /opt/cka/addons/local-path-storage.yaml >/dev/null
fi
kubectl -n local-path-storage rollout status deployment/local-path-provisioner --timeout=180s >/dev/null
kubectl create namespace "${Q2_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q2_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q2_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: scratch-local
provisioner: rancher.io/local-path
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${Q2_PVC}
  namespace: ${Q2_NS}
spec:
  storageClassName: scratch-local
  accessModes: [ReadWriteOnce]
  resources:
    requests: { storage: 64Mi }
---
apiVersion: v1
kind: Pod
metadata:
  name: app
  namespace: ${Q2_NS}
spec:
  terminationGracePeriodSeconds: 1
  nodeSelector:
    kubernetes.io/hostname: worker-1
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo ${Q2_MARK} > /data/keep.txt && exec sleep infinity"]
      volumeMounts:
        - { name: data, mountPath: /data }
  volumes:
    - name: data
      persistentVolumeClaim: { claimName: ${Q2_PVC} }
EOF
kubectl -n "${Q2_NS}" wait --for=condition=Ready pod/app --timeout=180s >/dev/null
kubectl -n "${Q2_NS}" get pvc "${Q2_PVC}" -o jsonpath='{.spec.volumeName}' > /var/tmp/cka-q2.pv
chmod 644 /var/tmp/cka-q2.pv
[[ -s /var/tmp/cka-q2.pv ]] || { echo "the claim did not bind" >&2; exit 1; }

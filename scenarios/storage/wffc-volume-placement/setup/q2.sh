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
  name: notes-local
provisioner: rancher.io/local-path
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${Q2_APP}-data
  namespace: ${Q2_NS}
spec:
  storageClassName: notes-local
  accessModes: [ReadWriteOnce]
  resources:
    requests: { storage: 64Mi }
---
apiVersion: v1
kind: Pod
metadata:
  name: seed
  namespace: ${Q2_NS}
spec:
  restartPolicy: Never
  nodeSelector:
    kubernetes.io/hostname: worker-1
  containers:
    - name: seed
      image: busybox:1.36
      command: ["sh", "-c", "echo ${Q2_MARK} > /data/note.txt"]
      volumeMounts:
        - { name: data, mountPath: /data }
  volumes:
    - name: data
      persistentVolumeClaim: { claimName: ${Q2_APP}-data }
EOF
kubectl -n "${Q2_NS}" wait --for=jsonpath='{.status.phase}'=Succeeded pod/seed --timeout=180s >/dev/null
kubectl -n "${Q2_NS}" delete pod seed >/dev/null
kubectl -n "${Q2_NS}" get pvc "${Q2_APP}-data" -o jsonpath='{.metadata.uid}' > /var/tmp/cka-q2.uid
chmod 644 /var/tmp/cka-q2.uid
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q2_APP}
  namespace: ${Q2_NS}
  labels: { app: ${Q2_APP} }
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${Q2_APP} }
  template:
    metadata:
      labels: { app: ${Q2_APP} }
    spec:
      terminationGracePeriodSeconds: 1
      nodeSelector:
        kubernetes.io/hostname: worker-2
      containers:
        - name: api
          image: busybox:1.36
          command: ["sleep", "infinity"]
          volumeMounts:
            - { name: data, mountPath: /data }
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: ${Q2_APP}-data }
EOF
for _ in $(seq 1 30); do
  msg="$(kubectl -n "${Q2_NS}" get pods -l "app=${Q2_APP}" -o jsonpath='{.items[0].status.conditions[?(@.type=="PodScheduled")].message}' 2>/dev/null || true)"
  [[ "$msg" == *"didn't match PersistentVolume's node affinity"* ]] && exit 0
  sleep 2
done
echo "expected the volume to keep the Pod off worker-2, got: $msg" >&2
exit 1

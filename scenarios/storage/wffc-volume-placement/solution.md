## Solution

### Question 1: Provision a volume where ${Q1_POD} runs

With `WaitForFirstConsumer` the provisioner waits until a Pod uses the claim and the scheduler has picked a node, so the volume lands where the Pod runs. That is why the claim sits `Pending` until the Pod exists: `describe pvc` shows `waiting for first consumer to be created before binding`.

```bash
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
```

### Question 2: Pod of ${Q2_APP} stays Pending

The volume already exists on `worker-1` (`kubectl get pv -o yaml` shows its `nodeAffinity`), but the Pod template asks for `worker-2`. The scheduler reports `didn't match PersistentVolume's node affinity` for that worker. A local volume cannot move, so the Pod has to go to the data. Remove the nodeSelector, or point it at `worker-1`.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}"
```

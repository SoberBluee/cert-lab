## Solution

The claim cannot bind: it asks for class `fast`, `ReadWriteMany` and 2Gi, while the only volume offers class `manual`, `ReadWriteOnce` and 1Gi.

```bash
kubectl -n data describe pvc db-data     # no persistent volumes available for this claim
kubectl get pv data-pv -o yaml           # storageClassName: manual, accessModes: [ReadWriteOnce], 1Gi
```

Those PVC fields are immutable, so recreate the claim. Delete the Pod first so it does not hold on to the old claim:

```bash
kubectl -n data delete pod db
kubectl -n data get pvc db-data -o yaml > pvc.yaml
kubectl -n data delete pvc db-data
# edit pvc.yaml: storageClassName: manual, accessModes: [ReadWriteOnce], storage: 1Gi
#                and remove status, uid, resourceVersion, creationTimestamp
kubectl apply -f pvc.yaml
kubectl -n data get pvc db-data          # Bound   data-pv
kubectl apply -f /opt/cka/db-pod.yaml
kubectl -n data exec db -- cat /data/seed.txt
```

The Pod lands on `worker-1` because the PV has node affinity for it.

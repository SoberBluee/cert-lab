## Solution

### Question 1: Pod archive-app stuck

**The healthy setup**

- PersistentVolume `archive-pv`: StorageClass `manual`, `1Gi`, `ReadWriteOnce`, reclaim `Retain`, hostPath on `worker-1` (required node affinity), `Available` with no stale `claimRef`
- PersistentVolumeClaim `archive` requests `500Mi` with StorageClass `manual` and access mode `ReadWriteOnce`, and binds to `archive-pv`
- Pod `archive-app` (image `busybox:1.36`, command `sleep 1d`) mounts the claim at `/data`, with no nodeSelector: the scheduler follows the volume to `worker-1`

This run broke 3 things: **`${Q1_FAULT}`**, **`${Q1_FAULT_2}`**, **`${Q1_FAULT_3}`**. Fix them in the order below.

**Problem 1: the claim**

<!-- fault Q1_FAULT=storageclass-mismatch -->
#### Claim asks for another StorageClass (`storageclass-mismatch`)

The claim asks for StorageClass `fast`, which neither exists nor matches `archive-pv` (`manual`), so it stays `Pending`. Re-create it with `storageClassName: manual`.

```bash
kubectl -n "files" delete pod "archive-app" --ignore-not-found --wait=true
kubectl -n "files" delete pvc "archive" --ignore-not-found --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"archive"'","namespace":"'"files"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"archive"'-app","namespace":"'"files"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"archive"'"}}]}}]}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=access-mode-mismatch -->
#### Claim asks for ReadWriteMany (`access-mode-mismatch`)

The claim asks for `ReadWriteMany`, but `archive-pv` only offers `ReadWriteOnce`, so nothing binds. Re-create it with `ReadWriteOnce`.

```bash
kubectl -n "files" delete pod "archive-app" --ignore-not-found --wait=true
kubectl -n "files" delete pvc "archive" --ignore-not-found --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"archive"'","namespace":"'"files"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"archive"'-app","namespace":"'"files"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"archive"'"}}]}}]}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=claim-too-large -->
#### Claim larger than the volume (`claim-too-large`)

The claim requests `2Gi` and `archive-pv` holds only `1Gi`, so it can never bind. Re-create it requesting `500Mi` (or anything up to `1Gi`).

```bash
kubectl -n "files" delete pod "archive-app" --ignore-not-found --wait=true
kubectl -n "files" delete pvc "archive" --ignore-not-found --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"archive"'","namespace":"'"files"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"archive"'-app","namespace":"'"files"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"archive"'"}}]}}]}'
```
<!-- /fault -->

**Problem 2: the volume**

<!-- fault Q1_FAULT_2=pv-released-claimref -->
#### PV stuck Released with a stale claimRef (`pv-released-claimref`)

PersistentVolume `archive-pv` is `Released` with reclaim policy `Retain` and still holds a `claimRef` to a deleted PVC. The new claim matches the volume but cannot bind until that `claimRef` is removed (`kubectl patch pv archive-pv --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'`).

```bash
kubectl patch pv "archive-pv" --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'
```
<!-- /fault -->

**Problem 3: the Pod**

<!-- fault Q1_FAULT_3=pod-node-pin -->
#### Pod pinned away from the node that holds the volume (`pod-node-pin`)

The claim is `Bound`, but `archive-pv` is a local volume with required node affinity for `worker-1`, while the Pod has `nodeSelector: kubernetes.io/hostname=worker-2`. No node satisfies both, so the Pod stays `Pending` with `volume node affinity conflict` in its Events. Re-create the Pod without the nodeSelector (or pinned to `worker-1`); the volume cannot move.

```bash
kubectl -n "files" delete pod "archive-app" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"archive"'-app","namespace":"'"files"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"archive"'"}}]}}'
```
<!-- /fault -->

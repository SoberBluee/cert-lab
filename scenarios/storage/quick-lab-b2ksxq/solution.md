## Solution

### Question 1: Pod ${Q1_CLAIM}-app stuck

**The healthy setup**

- PersistentVolume `${Q1_CLAIM}-pv`: StorageClass `manual`, `1Gi`, `ReadWriteOnce`, reclaim `Retain`, hostPath `/srv/${Q1_CLAIM}` on `worker-1`, with required node affinity for the label `storage.cka.lab/${Q1_CLAIM}=data` that `worker-1` carries; `Available` with no stale `claimRef`
- PersistentVolumeClaim `${Q1_CLAIM}` requests `500Mi` with StorageClass `manual` and access mode `ReadWriteOnce`, and binds to `${Q1_CLAIM}-pv`
- Pod `${Q1_CLAIM}-app` (image `busybox:1.36`, command `sleep 1d`) mounts claim `${Q1_CLAIM}` at `/data`, with no nodeSelector: the scheduler follows the volume to `worker-1`

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=storageclass-mismatch -->
#### Claim asks for another StorageClass (`storageclass-mismatch`)

The claim asks for StorageClass `fast`, which neither exists nor matches `${Q1_CLAIM}-pv` (`manual`), so it stays `Pending`. Re-create it with `storageClassName: manual`.

```bash
kubectl -n "${Q1_NS}" delete pod "${Q1_CLAIM}-app" --ignore-not-found --wait=true
kubectl -n "${Q1_NS}" delete pvc "${Q1_CLAIM}" --ignore-not-found --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q1_CLAIM}"'","namespace":"'"${Q1_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q1_CLAIM}"'-app","namespace":"'"${Q1_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q1_CLAIM}"'"}}]}}]}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=access-mode-mismatch -->
#### Claim asks for ReadWriteMany (`access-mode-mismatch`)

The claim asks for `ReadWriteMany`, but `${Q1_CLAIM}-pv` only offers `ReadWriteOnce`, so nothing binds. Re-create it with `ReadWriteOnce`.

```bash
kubectl -n "${Q1_NS}" delete pod "${Q1_CLAIM}-app" --ignore-not-found --wait=true
kubectl -n "${Q1_NS}" delete pvc "${Q1_CLAIM}" --ignore-not-found --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q1_CLAIM}"'","namespace":"'"${Q1_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q1_CLAIM}"'-app","namespace":"'"${Q1_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q1_CLAIM}"'"}}]}}]}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=claim-too-large -->
#### Claim larger than the volume (`claim-too-large`)

The claim requests `2Gi` and `${Q1_CLAIM}-pv` holds only `1Gi`, so it can never bind. Re-create it requesting `500Mi` (or anything up to `1Gi`).

```bash
kubectl -n "${Q1_NS}" delete pod "${Q1_CLAIM}-app" --ignore-not-found --wait=true
kubectl -n "${Q1_NS}" delete pvc "${Q1_CLAIM}" --ignore-not-found --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q1_CLAIM}"'","namespace":"'"${Q1_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q1_CLAIM}"'-app","namespace":"'"${Q1_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q1_CLAIM}"'"}}]}}]}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=pv-released-claimref -->
#### PV stuck Released with a stale claimRef (`pv-released-claimref`)

PersistentVolume `${Q1_CLAIM}-pv` is `Released` with reclaim policy `Retain` and still holds a `claimRef` to a deleted PVC. The new claim matches the volume but cannot bind until that `claimRef` is removed (`kubectl patch pv ${Q1_CLAIM}-pv --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'`).

```bash
kubectl patch pv "${Q1_CLAIM}-pv" --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=pod-node-pin -->
#### Pod pinned away from the node that holds the volume (`pod-node-pin`)

The claim is `Bound`, but `${Q1_CLAIM}-pv` is a local volume whose required node affinity only `worker-1` satisfies, while the Pod has `nodeSelector: kubernetes.io/hostname=worker-2`. No node satisfies both, so the Pod stays `Pending` with `volume node affinity conflict` in its Events. Re-create the Pod without the nodeSelector (or pinned to `worker-1`); the volume cannot move.

```bash
kubectl -n "${Q1_NS}" delete pod "${Q1_CLAIM}-app" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q1_CLAIM}"'-app","namespace":"'"${Q1_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q1_CLAIM}"'"}}]}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=pv-node-label-lost -->
#### The node that holds the data lost the label the volume requires (`pv-node-label-lost`)

The claim is `Bound`, but `${Q1_CLAIM}-pv` may only be used on a node labelled `storage.cka.lab/${Q1_CLAIM}=data`, and no node carries that label any more: the Pod stays `Pending` with `volume node affinity conflict`. The volume's affinity must not change, so put the label back on the node that really holds the data. Which one is that? The volume is a hostPath, `/srv/${Q1_CLAIM}`: look for it on the workers (`ssh worker-1 ls /srv`), and you find it on `worker-1`. `kubectl label node worker-1 storage.cka.lab/${Q1_CLAIM}=data`.

```bash
kubectl label node worker-1 "storage.cka.lab/${Q1_CLAIM}=data" --overwrite
```
<!-- /fault -->

<!-- fault Q1_FAULT=pod-claim-name -->
#### The Pod mounts a claim name that does not exist (`pod-claim-name`)

The claim and the volume are fine and `Bound`, but the Pod's volume refers to claim `${Q1_CLAIM}-data`, which does not exist: the Pod stays `Pending` with "persistentvolumeclaim \"${Q1_CLAIM}-data\" not found". A Pod's volumes cannot be edited: re-create the Pod with `claimName: ${Q1_CLAIM}`.

```bash
kubectl -n "${Q1_NS}" delete pod "${Q1_CLAIM}-app" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q1_CLAIM}"'-app","namespace":"'"${Q1_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q1_CLAIM}"'"}}]}}'
```
<!-- /fault -->

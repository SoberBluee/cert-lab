## Solution

### Question 1: Pod ${Q1_CLAIM}-app never starts

**The healthy setup**

- StorageClass `${Q1_CLAIM}-local`: provisioner `rancher.io/local-path`, `WaitForFirstConsumer`, reclaim `Delete`
- PVC `${Q1_CLAIM}` in `${Q1_NS}`: `500Mi`, `ReadWriteOnce`, `storageClassName: ${Q1_CLAIM}-local`
- Pod `${Q1_CLAIM}-app` (`busybox:1.36`, `sleep 1d`) mounts only that claim, at `/data`, and no other Pod uses it

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=provisioner-typo -->
#### StorageClass names a provisioner that does not exist (`provisioner-typo`)

StorageClass `${Q1_CLAIM}-local` names provisioner `rancher.io/localpath`. Nothing serves that name, so the claim stays `Pending` with "waiting for a volume to be created either by the external provisioner 'rancher.io/localpath'". The provisioner field cannot be changed: re-create the class with `rancher.io/local-path` (the name the running provisioner and the built-in `local-path` class use), then re-create the claim and the Pod.

```bash
kubectl -n "${Q1_NS}" delete pod "${Q1_CLAIM}-app" --wait=true
kubectl -n "${Q1_NS}" delete pvc "${Q1_CLAIM}" --wait=true
kubectl delete storageclass "${Q1_CLAIM}-local"
kubectl apply -f - <<< '{"apiVersion":"storage.k8s.io/v1","kind":"StorageClass","metadata":{"name":"'"${Q1_CLAIM}-local"'"},"provisioner":"rancher.io/local-path","volumeBindingMode":"WaitForFirstConsumer","reclaimPolicy":"Delete"}'
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q1_CLAIM}"'","namespace":"'"${Q1_NS}"'"},"spec":{"storageClassName":"'"${Q1_CLAIM}"'-local","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}}'
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q1_CLAIM}-app"'","namespace":"'"${Q1_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q1_CLAIM}"'"}}]}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=no-class -->
#### Claim names no StorageClass and there is no default (`no-class`)

The claim names no `storageClassName` and the cluster has no default class, so nothing provisions it: it waits for a static PV that never comes ("no persistent volumes available for this claim and no storage class is set"). The task rules out a default class, so re-create the claim with `storageClassName: ${Q1_CLAIM}-local`, then the Pod.

```bash
kubectl -n "${Q1_NS}" delete pod "${Q1_CLAIM}-app" --wait=true
kubectl -n "${Q1_NS}" delete pvc "${Q1_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q1_CLAIM}"'","namespace":"'"${Q1_NS}"'"},"spec":{"storageClassName":"'"${Q1_CLAIM}"'-local","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}}'
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q1_CLAIM}-app"'","namespace":"'"${Q1_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q1_CLAIM}"'"}}]}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=rwop-taken -->
#### ReadWriteOncePod claim already used by another Pod (`rwop-taken`)

The claim's access mode is `ReadWriteOncePod`: only one Pod in the whole cluster may use it, and Pod `${Q1_CLAIM}-backup` already does. `${Q1_CLAIM}-app` stays `Pending`; the scheduler says "node has pod using PersistentVolumeClaim with the same name and ReadWriteOncePod access mode". Remove `${Q1_CLAIM}-backup` (a leftover), or re-create the claim with `ReadWriteOnce` if both Pods must share it on one node.

```bash
kubectl -n "${Q1_NS}" delete pod "${Q1_CLAIM}-backup" --wait=true
```
<!-- /fault -->

<!-- fault Q1_FAULT=hostpath-missing -->
#### Extra hostPath volume requires a directory that does not exist (`hostpath-missing`)

Besides its claim, the Pod mounts hostPath `/var/log/${Q1_CLAIM}-app` with `type: Directory`, which requires the directory to exist on the node. It does not, so the Pod stays in `ContainerCreating` with "hostPath type check failed: ... is not a directory" under Events, although the claim is Bound. Re-create the Pod with `type: DirectoryOrCreate` (or create the directory on the node).

```bash
kubectl -n "${Q1_NS}" delete pod "${Q1_CLAIM}-app" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q1_CLAIM}-app"'","namespace":"'"${Q1_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"},{"name":"logs","mountPath":"/logs"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q1_CLAIM}"'"}},{"name":"logs","hostPath":{"path":"/var/log/'"${Q1_CLAIM}"'-app","type":"DirectoryOrCreate"}}]}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=claim-elsewhere -->
#### The claim exists only in another namespace (`claim-elsewhere`)

Claim `${Q1_CLAIM}` was created in namespace `${Q1_NS}-shared`, not `${Q1_NS}`. A Pod can only use claims of its own namespace, so `${Q1_CLAIM}-app` stays `Pending` with "persistentvolumeclaim \"${Q1_CLAIM}\" not found". A claim cannot be moved: create `${Q1_CLAIM}` in `${Q1_NS}` (the volume behind the other claim stays there), then re-create the Pod.

```bash
kubectl -n "${Q1_NS}" delete pod "${Q1_CLAIM}-app" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q1_CLAIM}"'","namespace":"'"${Q1_NS}"'"},"spec":{"storageClassName":"'"${Q1_CLAIM}"'-local","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}}'
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q1_CLAIM}-app"'","namespace":"'"${Q1_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q1_CLAIM}"'"}}]}}'
```
<!-- /fault -->

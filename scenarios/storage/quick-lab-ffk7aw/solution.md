## Solution

### Question 1: Pod ${Q1_CLAIM}-app stuck

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=storageclass-mismatch -->
#### Claim asks for another StorageClass (`storageclass-mismatch`)

The claim asks for StorageClass `fast`, which neither exists nor matches `${Q1_CLAIM}-pv` (`manual`), so it stays `Pending`. Re-create it with `storageClassName: manual`.

```bash
kubectl -n "${Q1_NS}" delete pod "${Q1_CLAIM}-app" --wait=true
kubectl -n "${Q1_NS}" delete pvc "${Q1_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q1_CLAIM}"'","namespace":"'"${Q1_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q1_CLAIM}"'-app","namespace":"'"${Q1_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q1_CLAIM}"'"}}]}}]}'
kubectl -n "${Q1_NS}" wait --for=condition=Ready "pod/${Q1_CLAIM}-app" --timeout=180s
```
<!-- /fault -->

<!-- fault Q1_FAULT=access-mode-mismatch -->
#### Claim asks for ReadWriteMany (`access-mode-mismatch`)

The claim asks for `ReadWriteMany`, but `${Q1_CLAIM}-pv` only offers `ReadWriteOnce`, so nothing binds. Re-create it with `ReadWriteOnce`.

```bash
kubectl -n "${Q1_NS}" delete pod "${Q1_CLAIM}-app" --wait=true
kubectl -n "${Q1_NS}" delete pvc "${Q1_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q1_CLAIM}"'","namespace":"'"${Q1_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q1_CLAIM}"'-app","namespace":"'"${Q1_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q1_CLAIM}"'"}}]}}]}'
kubectl -n "${Q1_NS}" wait --for=condition=Ready "pod/${Q1_CLAIM}-app" --timeout=180s
```
<!-- /fault -->

<!-- fault Q1_FAULT=claim-too-large -->
#### Claim larger than the volume (`claim-too-large`)

The claim requests `2Gi` and `${Q1_CLAIM}-pv` holds only `1Gi`, so it can never bind. Re-create it requesting `500Mi`.

```bash
kubectl -n "${Q1_NS}" delete pod "${Q1_CLAIM}-app" --wait=true
kubectl -n "${Q1_NS}" delete pvc "${Q1_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q1_CLAIM}"'","namespace":"'"${Q1_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q1_CLAIM}"'-app","namespace":"'"${Q1_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q1_CLAIM}"'"}}]}}]}'
kubectl -n "${Q1_NS}" wait --for=condition=Ready "pod/${Q1_CLAIM}-app" --timeout=180s
```
<!-- /fault -->

### Question 2: Deployment ${Q2_APP} not running

This run's fault: **`${Q2_FAULT}`**.

<!-- fault Q2_FAULT=quota-pods -->
#### ResourceQuota allows a single Pod (`quota-pods`)

ResourceQuota `pod-quota` caps the namespace at `1` Pod, so the ReplicaSet's second create is rejected with "exceeded quota" (`kubectl -n ${Q2_NS} describe rs`). Delete the quota or raise `pods` to at least `2`.

```bash
kubectl -n "${Q2_NS}" delete resourcequota pod-quota
kubectl -n "${Q2_NS}" rollout restart "deployment/${Q2_APP}"
```
<!-- /fault -->

<!-- fault Q2_FAULT=quota-limits -->
#### ResourceQuota requires CPU limits (`quota-limits`)

ResourceQuota `compute-quota` tracks `limits.cpu`, so every Pod in the namespace must set a CPU limit. The Pods have none and are rejected with "must specify limits.cpu". The spec rules out adding limits to the Deployment: delete the quota, or add a LimitRange that gives containers a default CPU limit.

```bash
kubectl -n "${Q2_NS}" delete resourcequota compute-quota
kubectl -n "${Q2_NS}" rollout restart "deployment/${Q2_APP}"
```
<!-- /fault -->

<!-- fault Q2_FAULT=limitrange-max -->
#### LimitRange maximum below the request (`limitrange-max`)

LimitRange `container-limits` caps containers at `50m` CPU. Its max also becomes the default limit, which is below the `100m` request, so every Pod is rejected at admission. Delete the LimitRange or raise its max to at least `100m`.

```bash
kubectl -n "${Q2_NS}" delete limitrange container-limits
kubectl -n "${Q2_NS}" rollout restart "deployment/${Q2_APP}"
```
<!-- /fault -->

<!-- fault Q2_FAULT=node-affinity -->
#### Required node affinity matches no node (`node-affinity`)

The Pod template requires nodes labelled `disktype=ssd`, and no node has that label, so the Pods stay Pending with "didn't match Pod's node affinity/selector". The spec allows any node: remove the affinity.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/affinity"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=priority-class -->
#### Unknown PriorityClass (`priority-class`)

The Pod template asks for PriorityClass `critical-batch`, which does not exist, so the ReplicaSet's creates fail with "no PriorityClass with name critical-batch was found". The spec wants the default priority: remove `priorityClassName`.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/priorityClassName"}]'
```
<!-- /fault -->

### Question 3: CronJob ${Q3_APP} never succeeds

This run's fault: **`${Q3_FAULT}`**.

<!-- fault Q3_FAULT=suspended -->
#### CronJob suspended (`suspended`)

The CronJob has `suspend: true`, so it never creates a Job: `kubectl get cronjob` shows `SUSPEND True` and no `LAST SCHEDULE`. Set `suspend: false`.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=merge -p '{"spec":{"suspend":false}}'
```
<!-- /fault -->

<!-- fault Q3_FAULT=never-schedule -->
#### Schedule that never fires (`never-schedule`)

The schedule is `0 0 31 2 *`: midnight on February 31st, a date that never comes. It is valid cron syntax, so the API accepts it, but no Job is ever created. Set it back to `* * * * *`.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=merge -p '{"spec":{"schedule":"* * * * *"}}'
```
<!-- /fault -->

<!-- fault Q3_FAULT=deadline -->
#### Job time limit shorter than the work (`deadline`)

Each Job has `activeDeadlineSeconds: 3`, but the command sleeps 8 seconds, so every Job is killed and marked failed with reason `DeadlineExceeded` (`kubectl describe job`). Remove the deadline.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=json -p '[{"op":"remove","path":"/spec/jobTemplate/spec/activeDeadlineSeconds"}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=backoff-zero-command -->
#### Job command fails and is never retried (`backoff-zero-command`)

The command runs `ech` instead of `echo`, so the container exits with code 127 (`kubectl logs` shows `sh: ech: not found`), and `backoffLimit: 0` fails the Job on the first error. Fix the command and set `backoffLimit` back to `2`.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/backoffLimit","value":2},{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/command/2","value":"date; sleep 8; echo report done"}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=image-registry -->
#### Image from a registry that does not exist (`image-registry`)

The image is `registry.invalid/busybox:1.36`, a registry host that does not resolve. The Jobs are created, but their Pods sit in `ErrImagePull` / `ImagePullBackOff` and never finish. Set the image back to `busybox:1.36`; the stuck Jobs can be deleted.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/image","value":"busybox:1.36"}]'
```
<!-- /fault -->

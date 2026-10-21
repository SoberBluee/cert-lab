## Solution

### Question 1: New Pods rejected in batch

**The healthy setup**

- Deployment `worker`: `2` replicas of `nginx:1.27-alpine`, requesting `100m` CPU and `64Mi` memory, no limits, running as the image's default user
- namespace `batch` has no ResourceQuota or LimitRange that refuses those Pods, no restrictive Pod Security label, and no admission webhook applies to it

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=quota-pods -->
#### ResourceQuota allows a single Pod (`quota-pods`)

ResourceQuota `tenant-quota` caps the namespace at `1` Pod, so the ReplicaSet's second create fails with "exceeded quota: tenant-quota". Delete the quota, or raise `pods` to at least `2`.

```bash
kubectl -n "batch" delete resourcequota tenant-quota
```
<!-- /fault -->

<!-- fault Q1_FAULT=quota-limits -->
#### ResourceQuota requires CPU limits the Pods do not set (`quota-limits`)

ResourceQuota `compute-quota` tracks `limits.cpu`, so every Pod in the namespace must declare a CPU limit. The Deployment sets none and may not be changed, so its Pods fail with "must specify limits.cpu". Delete the quota, or add a LimitRange that gives containers a default CPU limit.

```bash
kubectl -n "batch" delete resourcequota compute-quota
```
<!-- /fault -->

<!-- fault Q1_FAULT=limitrange-max -->
#### LimitRange maximum below the request (`limitrange-max`)

LimitRange `container-limits` caps containers at `50m` CPU. That max also becomes the default limit, which is below the `100m` request, so every Pod is refused at admission. Delete the LimitRange or raise its max to at least `100m`.

```bash
kubectl -n "batch" delete limitrange container-limits
```
<!-- /fault -->

<!-- fault Q1_FAULT=limitrange-min -->
#### LimitRange minimum above the request (`limitrange-min`)

LimitRange `container-floor` requires every container to request at least `128Mi` of memory, and the Pods request `64Mi`, so they fail with "minimum memory usage per Container is 128Mi". Delete the LimitRange or lower its minimum to `64Mi` or less.

```bash
kubectl -n "batch" delete limitrange container-floor
```
<!-- /fault -->

<!-- fault Q1_FAULT=pod-security -->
#### Namespace enforces the restricted Pod Security standard (`pod-security`)

Namespace `batch` carries the label `pod-security.kubernetes.io/enforce=restricted`. The nginx Pods run as root, allow privilege escalation and keep their capabilities, so Pod Security admission refuses them ("violates PodSecurity restricted:latest"); `kubectl get ns batch --show-labels` shows the label. The Deployment may not change, so relax the namespace: remove the label, or enforce `baseline` instead.

```bash
kubectl label namespace "batch" pod-security.kubernetes.io/enforce-
```
<!-- /fault -->

<!-- fault Q1_FAULT=webhook -->
#### Validating webhook with a missing Service fails closed (`webhook`)

ValidatingWebhookConfiguration `batch-pod-policy` sends every Pod create in `batch` to Service `batch/pod-policy`, which does not exist. With `failurePolicy: Fail`, every create fails ("failed calling webhook ... service \"pod-policy\" not found"). Delete the webhook, or set its `failurePolicy` to `Ignore` if it must stay.

```bash
kubectl delete validatingwebhookconfiguration "batch-pod-policy"
```
<!-- /fault -->

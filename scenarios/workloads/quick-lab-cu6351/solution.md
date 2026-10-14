## Solution

### Question 1: Deployment ${Q1_APP} not running

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=quota-pods -->
#### ResourceQuota allows a single Pod (`quota-pods`)

ResourceQuota `pod-quota` caps the namespace at `1` Pod, so the ReplicaSet's second create is rejected with "exceeded quota" (`kubectl -n ${Q1_NS} describe rs`). Delete the quota or raise `pods` to at least `2`.

```bash
kubectl -n "${Q1_NS}" delete resourcequota pod-quota
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```
<!-- /fault -->

<!-- fault Q1_FAULT=quota-limits -->
#### ResourceQuota requires CPU limits (`quota-limits`)

ResourceQuota `compute-quota` tracks `limits.cpu`, so every Pod in the namespace must set a CPU limit. The Pods have none and are rejected with "must specify limits.cpu". The spec rules out adding limits to the Deployment: delete the quota, or add a LimitRange that gives containers a default CPU limit.

```bash
kubectl -n "${Q1_NS}" delete resourcequota compute-quota
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```
<!-- /fault -->

<!-- fault Q1_FAULT=limitrange-max -->
#### LimitRange maximum below the request (`limitrange-max`)

LimitRange `container-limits` caps containers at `50m` CPU. Its max also becomes the default limit, which is below the `100m` request, so every Pod is rejected at admission. Delete the LimitRange or raise its max to at least `100m`.

```bash
kubectl -n "${Q1_NS}" delete limitrange container-limits
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```
<!-- /fault -->

<!-- fault Q1_FAULT=node-affinity -->
#### Required node affinity matches no node (`node-affinity`)

The Pod template requires nodes labelled `disktype=ssd`, and no node has that label, so the Pods stay Pending with "didn't match Pod's node affinity/selector". The spec allows any node: remove the affinity.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/affinity"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=priority-class -->
#### Unknown PriorityClass (`priority-class`)

The Pod template asks for PriorityClass `critical-batch`, which does not exist, so the ReplicaSet's creates fail with "no PriorityClass with name critical-batch was found". The spec wants the default priority: remove `priorityClassName`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/priorityClassName"}]'
```
<!-- /fault -->

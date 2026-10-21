## Solution

### Question 1: One worker takes no Pods

**The healthy setup**

- both workers are labelled `tier=app`, schedulable and untainted
- the kubelet on each worker keeps the default `maxPods` (110)
- `spread` requires `tier=app` and at most one replica per node (required anti-affinity on `kubernetes.io/hostname`)

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=cordoned -->
#### Worker cordoned (`cordoned`)

The worker is `Ready` but cordoned (`SchedulingDisabled`), so the scheduler places nothing new on it. `kubectl uncordon` it.

```bash
kubectl uncordon "${Q1_NODE}"
```
<!-- /fault -->

<!-- fault Q1_FAULT=taint-noschedule -->
#### NoSchedule taint on the worker (`taint-noschedule`)

The worker carries `dedicated=gpu:NoSchedule`, and `spread` does not tolerate it (and may not be changed), so the scheduler reports `untolerated taint`. Remove the taint: `kubectl taint node <node> dedicated-`.

```bash
kubectl taint node "${Q1_NODE}" dedicated-
```
<!-- /fault -->

<!-- fault Q1_FAULT=taint-noexecute -->
#### NoExecute taint on the worker (`taint-noexecute`)

The worker carries `maintenance=true:NoExecute`: nothing without a toleration may be scheduled there, and Pods already running were evicted. `kubectl describe node` lists it under Taints. Remove it: `kubectl taint node <node> maintenance-`.

```bash
kubectl taint node "${Q1_NODE}" maintenance-
```
<!-- /fault -->

<!-- fault Q1_FAULT=label-removed -->
#### Worker lost the label the Pods require (`label-removed`)

`spread` requires nodes labelled `tier=app`, and the worker no longer carries that label, so the scheduler reports `didn't match Pod's node affinity/selector`. `kubectl get nodes -L tier` shows the gap. Label the worker again.

```bash
kubectl label node "${Q1_NODE}" tier=app --overwrite
```
<!-- /fault -->

<!-- fault Q1_FAULT=max-pods -->
#### kubelet allows only two Pods (`max-pods`)

`maxPods: 2` in `/var/lib/kubelet/config.yaml` lets the worker run only two Pods, and its DaemonSet Pods already fill them. The node is `Ready`, but `kubectl describe node` shows `pods: 2` under Allocatable and the scheduler reports `Too many pods`. Remove the line (the default is 110) and restart the kubelet.

On the broken worker:

```bash
sed -i '/^maxPods:/d' /var/lib/kubelet/config.yaml
systemctl restart kubelet
```
<!-- /fault -->

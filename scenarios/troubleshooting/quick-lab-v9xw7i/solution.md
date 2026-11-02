## Solution

### Question 1: Node drain is stuck

**The healthy setup**

- PodDisruptionBudget `${Q1_APP}-pdb` lets one of the `2` replicas be evicted at a time (`minAvailable: 1`)
- the Pod template of `${Q1_APP}` prefers the maintenance worker but does not require it, and allows two replicas on one node
- `kubectl drain` always needs `--ignore-daemonsets` (calico-node and kube-proxy run everywhere), `--delete-emptydir-data` for Pods with an `emptyDir` volume, and `--force` for Pods that no controller manages

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=pdb-min-available -->
#### PDB minAvailable equals the replica count (`pdb-min-available`)

PodDisruptionBudget `${Q1_APP}-pdb` sets `minAvailable: 2` while `${Q1_APP}` has 2 replicas, so it allows no disruption at all: `kubectl drain` retries "Cannot evict pod as it would violate the pod's disruption budget" until it gives up (`kubectl -n ${Q1_NS} get pdb` shows ALLOWED DISRUPTIONS 0). Lower `minAvailable` to `1`, then drain: `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data --force`.

```bash
kubectl -n "${Q1_NS}" patch pdb "${Q1_APP}-pdb" --type=merge -p '{"spec":{"minAvailable":1}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=pdb-max-unavailable-0 -->
#### PDB maxUnavailable is zero (`pdb-max-unavailable-0`)

PodDisruptionBudget `${Q1_APP}-pdb` sets `maxUnavailable: 0`: no Pod of `${Q1_APP}` may ever be evicted, so the drain retries until it gives up (ALLOWED DISRUPTIONS 0). Allow one: `maxUnavailable: 1` (or `minAvailable: 1`), then drain the worker.

```bash
kubectl -n "${Q1_NS}" patch pdb "${Q1_APP}-pdb" --type=merge -p '{"spec":{"maxUnavailable":1}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=pinned-node-selector -->
#### Replicas are pinned to the maintenance worker (`pinned-node-selector`)

The Pod template of `${Q1_APP}` has `nodeSelector: maintenance=due`, so both replicas run on the maintenance worker and every replacement can only go back there. Once the worker is cordoned, the first evicted Pod's replacement stays `Pending` ("didn't match Pod's node affinity/selector"), the budget then forbids evicting the second, and the drain hangs. Remove the nodeSelector (the preferred node affinity already favours that worker when it is available), then drain.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=replica-anti-affinity -->
#### Required anti-affinity keeps one replica per node (`replica-anti-affinity`)

The Pod template of `${Q1_APP}` requires that no two replicas share a node (`podAntiAffinity` on `app=${Q1_APP}`, `topologyKey: kubernetes.io/hostname`). With one worker cordoned and the control plane tainted, only one node is left, so the drain itself succeeds but the evicted replica's replacement stays `Pending` ("didn't match pod anti-affinity rules") and `${Q1_APP}` is left with 1 ready replica. The spec allows two replicas on one node: remove the anti-affinity (or make it preferred), and the replacement starts on the other worker.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/affinity/podAntiAffinity"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=bare-pod -->
#### A Pod without a controller runs on the worker (`bare-pod`)

Pod `${Q1_APP}-debug` was started by hand with `kubectl run`: no ReplicaSet, Job or other controller owns it. `kubectl drain` refuses to remove such Pods, because nothing would recreate them ("cannot delete Pods that declare no controller (use --force to override)"). Nothing needs fixing in the cluster: drain with `--force`, which deletes it (or delete it yourself first).
<!-- /fault -->

<!-- fault Q1_FAULT=emptydir-pod -->
#### The replicas keep scratch data in an emptyDir volume (`emptydir-pod`)

The `${Q1_APP}` Pods mount an `emptyDir` volume, whose data is lost when a Pod leaves its node. `kubectl drain` will not evict them unless told that is acceptable ("cannot delete Pods with local storage (use --delete-emptydir-data to override)"). Scratch data may go: drain with `--delete-emptydir-data`.
<!-- /fault -->

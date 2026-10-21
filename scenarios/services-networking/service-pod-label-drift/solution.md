## Solution

### Question 1: Service ${Q1_APP} unreachable

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=pod-label-drift -->
#### Pod labels drifted away from the Service selector (`pod-label-drift`)

The running Pods are labelled `app=${Q1_APP}-v2`, but Service `${Q1_APP}` still selects `app=${Q1_APP}`, so it has no endpoints. The Deployment is paused, which is why the controller did not recreate correctly labelled Pods. Relabel the Pods to `app=${Q1_APP}` and unpause the Deployment (`spec.paused: false`).

```bash
kubectl -n "${Q1_NS}" label pods -l "app=${Q1_APP}-v2" "app=${Q1_APP}" --overwrite
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" -p '{"spec":{"paused":false}}'
```
<!-- /fault -->

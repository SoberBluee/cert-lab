## Solution

### Question 1: Service ${Q1_APP} unreachable

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=selector-extra-label -->
#### Service selector requires an extra label (`selector-extra-label`)

The Service selects `app=${Q1_APP}` **and** `tier=web`. The Pods carry only `app=${Q1_APP}`, so nothing matches and the Service has no endpoints (`kubectl -n ${Q1_NS} get endpointslices -l kubernetes.io/service-name=${Q1_APP}`). Remove `tier` from the selector.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/selector/tier"}]'
```
<!-- /fault -->

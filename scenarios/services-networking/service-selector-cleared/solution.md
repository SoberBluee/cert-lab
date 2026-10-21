## Solution

### Question 1: Service ${Q1_APP} unreachable

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=selector-cleared -->
#### Service has no selector (`selector-cleared`)

The Service has no `selector`, so it manages no endpoints (`kubectl -n ${Q1_NS} get endpointslices -l kubernetes.io/service-name=${Q1_APP}` is empty). Restore `selector: { app: ${Q1_APP} }`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"add","path":"/spec/selector","value":{"app":"'"${Q1_APP}"'"}}]'
```
<!-- /fault -->

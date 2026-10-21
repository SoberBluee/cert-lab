## Solution

### Question 1: Service ${Q1_APP} unreachable

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=service-clusterip-none -->
#### Service was made headless (clusterIP: None) (`service-clusterip-none`)

Service `${Q1_APP}` is headless (`clusterIP: None`), so clients that expect a virtual IP no longer get a stable ClusterIP even though endpoints exist. Recreate it as a normal ClusterIP Service selecting `app=${Q1_APP}` with port `80` → `http`.

```bash
kubectl -n "${Q1_NS}" delete service "${Q1_APP}" --wait=true
kubectl -n "${Q1_NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Service","metadata":{"name":"'"${Q1_APP}"'","namespace":"'"${Q1_NS}"'"},"spec":{"selector":{"app":"'"${Q1_APP}"'"},"ports":[{"port":80,"targetPort":"http"}]}}'
```
<!-- /fault -->

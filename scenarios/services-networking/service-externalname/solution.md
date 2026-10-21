## Solution

### Question 1: Service ${Q1_APP} unreachable

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=service-externalname -->
#### Service type flipped to ExternalName (`service-externalname`)

Service `${Q1_APP}` was changed to `type: ExternalName` pointing at `nowhere.invalid`, so it no longer has a ClusterIP or selectors even though the Deployment looks fine. Recreate (or patch) it as a ClusterIP Service selecting `app=${Q1_APP}` with port `80` → named target port `http`.

```bash
kubectl -n "${Q1_NS}" delete service "${Q1_APP}" --wait=true
kubectl -n "${Q1_NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Service","metadata":{"name":"'"${Q1_APP}"'","namespace":"'"${Q1_NS}"'"},"spec":{"selector":{"app":"'"${Q1_APP}"'"},"ports":[{"port":80,"targetPort":"http"}]}}'
```
<!-- /fault -->

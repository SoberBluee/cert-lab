## Solution

### Question 1: Name resolution broken

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=client-dns-policy -->
#### Client Pod bypasses the cluster DNS (`client-dns-policy`)

Pod `client` has `dnsPolicy: Default`, so it inherits the node's resolv.conf: no cluster nameserver and no cluster search domains. The field cannot be changed on a running Pod; recreate `client` without it (the default is `ClusterFirst`).

```bash
kubectl -n "${Q1_NS}" delete pod client --ignore-not-found --wait=true >/dev/null
kubectl -n "${Q1_NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"client"},"spec":{"containers":[{"name":"shell","image":"busybox:1.36","command":["sleep","infinity"]}]}}'
if ! kubectl -n "${Q1_NS}" wait --for=condition=Ready pod/client --timeout=180s; then
  kubectl -n "${Q1_NS}" describe pod/client >&2 || true
  exit 1
fi
```
<!-- /fault -->

## Solution

### Question 1: Name resolution broken

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=cluster-domain -->
#### Wrong cluster domain in the Corefile (`cluster-domain`)

The `kubernetes` plugin serves `cluster.lab` instead of `cluster.local`. CoreDNS runs fine, but it forwards every `*.cluster.local` name upstream, which answers NXDOMAIN. Set the zone back to `cluster.local` in ConfigMap `coredns`.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#kubernetes cluster\.lab #kubernetes cluster.local #' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'kubernetes cluster\.local ' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

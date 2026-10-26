## Solution

### Question 1: Change the upstream DNS server

```bash
ip=$(kubectl -n corp-dns get service resolver -o jsonpath='{.spec.clusterIP}')
kubectl -n kube-system get configmap coredns -o yaml | sed -E "s#forward \. /etc/resolv\.conf#forward . $ip#" | kubectl replace -f -
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```

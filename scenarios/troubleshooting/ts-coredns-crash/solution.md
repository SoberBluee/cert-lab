## Solution

The CoreDNS Pods are crashing:

```bash
kubectl -n kube-system get pods -l k8s-app=kube-dns        # CrashLoopBackOff
kubectl -n kube-system logs -l k8s-app=kube-dns --tail=5
#   plugin/forwardd: ... Unknown directive 'forwardd'
```

The Corefile lives in the `coredns` ConfigMap. Fix the directive name:

```bash
kubectl -n kube-system edit configmap coredns
#   forwardd . /etc/resolv.conf   ->   forward . /etc/resolv.conf
```

Crashing Pods pick up the fix on their next restart, but restart them now rather than waiting out the back-off:

```bash
kubectl -n kube-system rollout restart deployment coredns
kubectl -n kube-system rollout status deployment coredns
kubectl exec dnsutils -- nslookup kubernetes.default.svc.cluster.local
```

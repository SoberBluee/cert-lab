Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Applications report that they can no longer reach each other by name. From the Pod `dnsutils` in namespace `default`:

```bash
kubectl exec dnsutils -- nslookup kubernetes.default.svc.cluster.local
```

fails.

Find the cause and fix it so that cluster DNS works again.

- Keep CoreDNS: do not replace it or change the number of replicas.
- Keep resolving external names through the node's resolver as before.

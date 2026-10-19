Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Update CoreDNS so DNS for `cka.local` works the same way as `cluster.local` (in addition to it).

Both of these must resolve:

```bash
nslookup kubernetes.default.svc.cluster.local
nslookup kubernetes.default.svc.cka.local
```

You can test from a throwaway Pod (for example `busybox:1.36`).

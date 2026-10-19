# Add DNS domain cka.local

Edit ConfigMap `kube-system/coredns` so the `kubernetes` plugin line includes `cka.local` before (or with) `cluster.local`. Restart CoreDNS.

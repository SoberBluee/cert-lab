Use context: `kubectl config use-context kubernetes-admin@kubernetes`

On `controlplane`:

1. Enable IPv4 forwarding persistently via `/etc/sysctl.d/k8s.conf` (`net.ipv4.ip_forward=1`) and apply it.
2. Ensure the `containerd` service is **enabled** and **active**.

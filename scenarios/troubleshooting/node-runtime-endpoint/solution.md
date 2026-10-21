## Solution

### Question 1: Worker after a configuration change

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=runtime-endpoint -->
#### kubelet points at the wrong container runtime socket (`runtime-endpoint`)

`containerRuntimeEndpoint` in `/var/lib/kubelet/config.yaml` points at the CRI-O socket `/var/run/crio/crio.sock`, but the node runs containerd. containerd itself is healthy, yet the kubelet cannot reach a runtime and fails to start. `journalctl -u kubelet` names the missing socket; `/etc/crictl.yaml` or `ls /var/run/containerd` shows the right one. Fix the endpoint and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^containerRuntimeEndpoint: unix:///var/run/crio/crio\.sock$#containerRuntimeEndpoint: unix:///var/run/containerd/containerd.sock#' /var/lib/kubelet/config.yaml
grep -qE -- '^containerRuntimeEndpoint: unix:///var/run/containerd/containerd.sock$' /var/lib/kubelet/config.yaml || { echo "could not modify /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet
```
<!-- /fault -->

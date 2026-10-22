## Solution

### Question 1: Worker after a configuration change

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-cgroup-driver -->
#### containerd cgroup driver is invalid (`kubelet-cgroup-driver`)

`SystemdCgroup` in `/etc/containerd/config.toml` is the string `"invalid"`, so containerd cannot load its config and never starts. Kubelet 1.37 asks containerd which cgroup driver to use, and exits when the runtime does not answer, so the node turns `NotReady`. `journalctl -u containerd` names the field; a healthy worker has `SystemdCgroup = true`. Set that, then restart containerd and the kubelet.

On the broken worker:

```bash
sed -i -E 's#^([[:space:]]*SystemdCgroup = )"invalid"[[:space:]]*$#\1true#' /etc/containerd/config.toml
grep -qE -- '^[[:space:]]*SystemdCgroup = true$' /etc/containerd/config.toml || { echo "could not modify /etc/containerd/config.toml" >&2; exit 1; }
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

## Solution

### Question 1: Worker after a configuration change

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-kubeconfig-server -->
#### kubelet kubeconfig points at the wrong API server port (`kubelet-kubeconfig-server`)

`server:` in `/etc/kubernetes/kubelet.conf` on the worker uses port `6444`, where nothing listens. The kubelet keeps running but cannot post its status, so the node turns `NotReady`; `journalctl -u kubelet` is full of `connection refused` for `:6444`. Set the port back to `6443` and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6444$#\1:6443#' /etc/kubernetes/kubelet.conf
grep -qE -- 'server: https://[^[:space:]]+:6443$' /etc/kubernetes/kubelet.conf || { echo "could not modify /etc/kubernetes/kubelet.conf" >&2; exit 1; }
systemctl restart kubelet
```
<!-- /fault -->

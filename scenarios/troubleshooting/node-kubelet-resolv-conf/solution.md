## Solution

### Question 1: Worker after a configuration change

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-resolv-empty -->
#### kubelet resolvConf points at a missing file (`kubelet-resolv-empty`)

`/var/lib/kubelet/config.yaml` sets `resolvConf` to a YAML list whose only entry is `/etc/resolv.conf.missing` (that path does not exist, and `resolvConf` must be a string). The kubelet cannot decode its config and exits. Remove those lines (the default `/etc/resolv.conf` is fine) and restart the kubelet.

On the broken worker:

```bash
sed -i '/^resolvConf:/d' /var/lib/kubelet/config.yaml
sed -i '/^[[:space:]]*- \/etc\/resolv\.conf\.missing$/d' /var/lib/kubelet/config.yaml || true
systemctl restart kubelet
```
<!-- /fault -->

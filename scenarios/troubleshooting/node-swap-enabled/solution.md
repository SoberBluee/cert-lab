## Solution

### Question 1: Unhealthy worker

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-swap-on -->
#### Swap is enabled so the kubelet refuses to start (`kubelet-swap-on`)

A swap file (`/root/cka-swap`) is active and the kubelet runs with `failSwapOn: true`, so it exits rather than start with swap enabled. `swapon --show` lists the file; `journalctl -u kubelet` mentions swap. `swapoff` the file, remove it, and restart the kubelet.

On the broken worker:

```bash
swapoff /root/cka-swap 2>/dev/null || true
rm -f /root/cka-swap
sed -i '/^failSwapOn:/d' /var/lib/kubelet/config.yaml || true
systemctl restart kubelet
```
<!-- /fault -->

## Solution

### Question 1: Worker after a configuration change

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-hairpin-mode -->
#### kubelet hairpinMode is invalid (`kubelet-hairpin-mode`)

`/var/lib/kubelet/config.yaml` sets `hairpinMode: bogus`, which is not a valid enum value, so the kubelet exits at startup. `journalctl -u kubelet` names the bad field. Remove the line (or set a valid value such as `promiscuous-bridge`) and restart the kubelet.

On the broken worker:

```bash
sed -i '/^hairpinMode:/d' /var/lib/kubelet/config.yaml
systemctl restart kubelet
```
<!-- /fault -->

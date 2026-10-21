## Solution

### Question 1: Worker after a configuration change

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-cgroup-driver -->
#### kubelet cgroup driver is invalid (`kubelet-cgroup-driver`)

`cgroupDriver` in `/var/lib/kubelet/config.yaml` is `invalid`, so the kubelet exits at startup. `journalctl -u kubelet` names the bad value; containerd and a healthy worker use `systemd`. Set `cgroupDriver: systemd` and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^cgroupDriver: invalid$#cgroupDriver: systemd#' /var/lib/kubelet/config.yaml
grep -qE -- '^cgroupDriver: systemd$' /var/lib/kubelet/config.yaml || { echo "could not modify /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet
```
<!-- /fault -->

## Solution

### Question 1: Unhealthy worker

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=ip-forward-and-containerd -->
#### IP forwarding off and containerd disabled (`ip-forward-and-containerd`)

`net.ipv4.ip_forward` is 0, `/etc/sysctl.d/k8s.conf` is missing, and `containerd` was stopped and disabled. The node turns `NotReady`. Put `net.ipv4.ip_forward=1` in `/etc/sysctl.d/k8s.conf`, apply with `sysctl --system`, and `systemctl enable --now containerd`.

On the broken worker:

```bash
printf 'net.ipv4.ip_forward=1\n' >/etc/sysctl.d/k8s.conf
sysctl --system >/dev/null 2>&1 || sysctl -w net.ipv4.ip_forward=1 >/dev/null
systemctl enable --now containerd
systemctl restart kubelet
```
<!-- /fault -->

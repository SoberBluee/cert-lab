## Solution

### Question 1: Unhealthy worker

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=containerd-config-invalid -->
#### containerd config does not parse (`containerd-config-invalid`)

The last line of `/etc/containerd/config.toml` is an unclosed `[plugins` table, so containerd fails to start ("failed to load TOML"). The kubelet runs but cannot reach the runtime, and the node turns `NotReady`. `systemctl status containerd` and `journalctl -u containerd -n 20` point at the line. Remove it, then restart containerd and the kubelet.

On the broken worker:

```bash
cp -a "/var/tmp/cka-q1.containerd" /etc/containerd/config.toml
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

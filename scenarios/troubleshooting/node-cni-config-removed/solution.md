## Solution

### Question 1: Unhealthy worker

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=cni-config-removed -->
#### CNI configuration removed from the node (`cni-config-removed`)

The Calico network config (`10-calico.conflist`) is gone from `/etc/cni/net.d`. containerd reports the network as not ready, so the node turns `NotReady` with "container runtime network not ready ... cni plugin not initialized" (`kubectl describe node`, `journalctl -u kubelet`). `ls /etc/cni/net.d` is empty. You do not have to recreate the file: every worker carries the same conflist, so copy it from the healthy worker — and looking around the broken node (`ls /root`) turns up a copy in `/root/cni-backup`. Put it back, then restart containerd and the kubelet.

On the broken worker:

```bash
mv /root/cni-backup/*.conflist /etc/cni/net.d/
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

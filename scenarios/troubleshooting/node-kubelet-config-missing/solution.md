## Solution

### Question 1: Unhealthy worker

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-conf-missing -->
#### kubelet kubeconfig file is missing (`kubelet-conf-missing`)

`/etc/kubernetes/kubelet.conf` was renamed, so the kubelet cannot authenticate to the API server and the node turns `NotReady`. `journalctl -u kubelet` mentions the missing kubeconfig; a backup sits at `/etc/kubernetes/kubelet.conf.cka-bak`. Move it back and restart the kubelet.

On the broken worker:

```bash
mv /etc/kubernetes/kubelet.conf.cka-bak /etc/kubernetes/kubelet.conf
systemctl restart kubelet
```
<!-- /fault -->

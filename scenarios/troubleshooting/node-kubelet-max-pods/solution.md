## Solution

### Question 1: Worker after a configuration change

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-max-pods -->
#### kubelet allows only two Pods (`kubelet-max-pods`)

`/var/lib/kubelet/config.yaml` sets `maxPods: 2`. calico-node and kube-proxy already fill those two slots, so the kubelet rejects the `node-agent` Pod with `OutOfpods` and the DaemonSet never gets ready there, although the node stays `Ready`. `kubectl describe node` shows `pods: 2` under Capacity, and `kubectl get pods -o wide` shows the rejected Pods. Remove `maxPods` (the default is 110) and restart the kubelet.

On the broken worker:

```bash
sed -i '/^maxPods:/d' /var/lib/kubelet/config.yaml
systemctl restart kubelet
```
<!-- /fault -->

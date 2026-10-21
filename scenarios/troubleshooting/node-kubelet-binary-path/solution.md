## Solution

### Question 1: Unhealthy worker

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-binary-path -->
#### kubelet unit points at the wrong binary (`kubelet-binary-path`)

The kubeadm drop-in (`10-kubeadm.conf`) starts `/usr/local/bin/kubelet`, which does not exist, so the service fails with `status=203/EXEC`. `systemctl cat kubelet` shows the path; `which kubelet` shows the real one. Fix the drop-in, then `systemctl daemon-reload` and restart the kubelet.

On the broken worker:

```bash
dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
sed -i 's#^ExecStart=/usr/local/bin/kubelet #ExecStart=/usr/bin/kubelet #' "$dropin"
systemctl daemon-reload
systemctl restart kubelet
```
<!-- /fault -->

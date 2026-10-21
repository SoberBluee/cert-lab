## Solution

### Question 1: Worker after a configuration change

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-kubeconfig-flag -->
#### kubelet unit loads a kubeconfig that does not exist (`kubelet-kubeconfig-flag`)

The kubeadm drop-in starts the kubelet with `--kubeconfig=/etc/kubernetes/kubelet.config`. That file does not exist and the bootstrap kubeconfig is long gone, so the kubelet exits right after start and the node turns `NotReady`. `systemctl cat kubelet` shows the flag; `ls /etc/kubernetes` shows the real `kubelet.conf`. Fix the drop-in, then `systemctl daemon-reload` and restart the kubelet.

On the broken worker:

```bash
dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
sed -i -E 's#--kubeconfig=/etc/kubernetes/kubelet\.config#--kubeconfig=/etc/kubernetes/kubelet.conf#' "$dropin"
grep -qE -- '--kubeconfig=/etc/kubernetes/kubelet.conf' "$dropin" || { echo "could not modify "$dropin"" >&2; exit 1; }
systemctl daemon-reload
systemctl restart kubelet
```
<!-- /fault -->

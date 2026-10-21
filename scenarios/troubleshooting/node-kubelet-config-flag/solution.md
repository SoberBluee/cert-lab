## Solution

### Question 1: Worker after a configuration change

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-config-flag -->
#### kubelet unit loads a configuration file that does not exist (`kubelet-config-flag`)

The kubeadm drop-in (`10-kubeadm.conf`) starts the kubelet with `--config=/var/lib/kubelet/kubelet-config.yaml`, which does not exist, so it exits with `failed to load Kubelet config file`. `systemctl cat kubelet` shows the flag and `ls /var/lib/kubelet` shows `config.yaml`. Fix the drop-in, then `systemctl daemon-reload` and restart the kubelet.

On the broken worker:

```bash
dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
sed -i -E 's#--config=/var/lib/kubelet/kubelet-config\.yaml#--config=/var/lib/kubelet/config.yaml#' "$dropin"
grep -qE -- '--config=/var/lib/kubelet/config.yaml' "$dropin" || { echo "could not modify "$dropin"" >&2; exit 1; }
systemctl daemon-reload
systemctl restart kubelet
```
<!-- /fault -->

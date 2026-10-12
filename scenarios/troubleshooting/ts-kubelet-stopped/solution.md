## Solution

The kubelet on `worker-1` was stopped and disabled, and its kubeadm drop-in points to a binary that does not exist.

```bash
ssh worker-1
sudo -i

systemctl status kubelet          # inactive (dead), disabled
systemctl cat kubelet             # ExecStart=/usr/local/bin/kubelet ... in 10-kubeadm.conf
which kubelet                     # /usr/bin/kubelet

vim /usr/lib/systemd/system/kubelet.service.d/10-kubeadm.conf
# ExecStart=/usr/bin/kubelet $KUBELET_KUBECONFIG_ARGS ...

systemctl daemon-reload
systemctl enable --now kubelet
journalctl -u kubelet -f          # no more "No such file or directory"
```

Back on the control plane, `kubectl get node worker-1` shows `Ready` after a few seconds.

Starting kubelet without `enable` fixes the node now but not after a reboot. `systemctl enable --now` does both.

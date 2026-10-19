# Restore CNI on a worker

On the broken worker (`kubectl get nodes`): `/etc/cni/net.d` is empty; backup is `/root/cni-backup`. Move the conflist back, `systemctl restart containerd kubelet`.

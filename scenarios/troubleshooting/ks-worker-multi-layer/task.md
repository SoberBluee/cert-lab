Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Node `${NODE}` turned `NotReady` after a late-night maintenance session on it. Pod `node-probe` in namespace `default` is bound to `${NODE}` and cannot start. The engineer left no notes, but there are three separate problems: one with the container runtime, one with the kubelet, and one that only shows after a reboot.

1. Bring `${NODE}` back to `Ready`, so that `node-probe` runs. Fix the configuration in place, and make sure your fix survives a reboot of the node.
2. Write every root cause you fixed to `/opt/course/3/causes.txt` on `controlplane`, one line per cause.

Do not reinstall packages or rejoin the node.

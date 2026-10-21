Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Node `${NODE}` turned `NotReady` after a late-night maintenance session on it. Pod `node-probe` in namespace `default` is bound to `${NODE}` and cannot start. The engineer left no notes, and more than one thing is wrong.

1. Bring `${NODE}` back to `Ready`, so that `node-probe` runs. Fix the configuration in place, and make sure your fix survives a reboot of the node.
2. Write every root cause you fixed to `/opt/course/3/causes.txt` on `controlplane`, one line per cause.

Do not reinstall packages or rejoin the node.

Use context: `kubectl config use-context kubernetes-admin@kubernetes`

During maintenance, someone tuned the kubelet configuration on one of the workers, and workloads on that node keep getting evicted. DaemonSet `node-agent` in namespace `${NS}` is meant to run a Pod on every worker.

Find the node and fix it so that:

- every node is `Ready`
- `${NODE}` is not under `MemoryPressure`
- `node-agent` runs a ready Pod on every worker
- the kubelet is running and enabled, and the fix survives a reboot of the node

Do not change the DaemonSet, and do not rejoin the node to the cluster.

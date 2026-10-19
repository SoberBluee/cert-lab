# Worker evicts Pods under MemoryPressure

`/var/lib/kubelet/config.yaml` on `${NODE}` sets `evictionHard.memory.available: "99%"`, so the kubelet constantly reports MemoryPressure and evicts workload Pods even though the node stays Ready.

Restore the previous kubelet config (or remove that `evictionHard` entry) and restart the kubelet:

```bash
# on ${NODE}
cp -a /var/lib/kubelet/config.yaml.cka-bak /var/lib/kubelet/config.yaml   # if the backup exists
# or edit the file to remove evictionHard.memory.available: "99%"
systemctl restart kubelet
```

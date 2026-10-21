## Solution

### Question 1: Worker after a configuration change

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-eviction-hard -->
#### kubelet evictionHard memory threshold is absurd (`kubelet-eviction-hard`)

`/var/lib/kubelet/config.yaml` sets `evictionHard.memory.available: "99%"`, so the kubelet constantly reports MemoryPressure and evicts workload Pods even though the node stays Ready. `kubectl describe node` shows the pressure condition and eviction events. Restore the previous kubelet config (or remove that evictionHard entry) and restart the kubelet.

On the broken worker:

```bash
if [[ -f /var/lib/kubelet/config.yaml.cka-bak ]]; then cp -a /var/lib/kubelet/config.yaml.cka-bak /var/lib/kubelet/config.yaml; else
  sed -i '/^evictionHard:/,/^[^[:space:]]/{ /^evictionHard:/d; /^[[:space:]]/d; }' /var/lib/kubelet/config.yaml || true
  sed -i '/memory.available: "99%"/d' /var/lib/kubelet/config.yaml || true
fi
systemctl restart kubelet
```
<!-- /fault -->

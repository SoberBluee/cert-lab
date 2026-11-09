## Solution

### Question 1: Make ${Q1_APP} the last to be evicted

A Pod is `Guaranteed` only when **every** container, init containers included, sets CPU and memory limits equal to its requests. `api` has requests but no limits, and `shipper` and `prepare` have neither, so the Pods are `Burstable`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[
  {"op":"add","path":"/spec/template/spec/initContainers/0/resources","value":{"requests":{"cpu":"20m","memory":"16Mi"},"limits":{"cpu":"20m","memory":"16Mi"}}},
  {"op":"add","path":"/spec/template/spec/containers/0/resources/limits","value":{"cpu":"100m","memory":"128Mi"}},
  {"op":"add","path":"/spec/template/spec/containers/1/resources","value":{"requests":{"cpu":"50m","memory":"32Mi"},"limits":{"cpu":"50m","memory":"32Mi"}}}
]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}"
kubectl -n "${Q1_NS}" get pods -o custom-columns=NAME:.metadata.name,QOS:.status.qosClass
```

### Question 2: A worker keeps evicting Pods

The node reports `MemoryPressure`, yet `free -m` shows plenty of memory, so the threshold is wrong, not the workload. `/var/lib/kubelet/config.yaml` really is correct: the setting comes from a flag, and kubelet flags override the config file.

`ps -o args= -C kubelet` on the broken worker shows `--eviction-hard=memory.available<99%`, which a healthy worker does not have. `systemctl cat kubelet` shows where extra flags come from: `KUBELET_EXTRA_ARGS` in `/etc/default/kubelet`. Evicting whenever less than `99%` of memory is free means the node is always under pressure. Remove the flag on ${Q2_NODE} and restart the kubelet.

```bash
sudo sed -i 's/^KUBELET_EXTRA_ARGS=.*/KUBELET_EXTRA_ARGS=/' /etc/default/kubelet
sudo systemctl restart kubelet
```

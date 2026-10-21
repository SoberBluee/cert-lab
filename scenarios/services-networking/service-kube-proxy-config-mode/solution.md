## Solution

### Question 1: Service ${Q1_APP} unreachable

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=kube-proxy-config-mode -->
#### kube-proxy mode is invalid (`kube-proxy-config-mode`)

ConfigMap `kube-system/kube-proxy` sets `mode: not-a-mode`, so kube-proxy Pods crash-loop and Service ClusterIPs stop working. Set `mode` back to `iptables` (or empty) in the ConfigMap and restart the `kube-proxy` DaemonSet.

```bash
kubectl -n kube-system patch configmap kube-proxy --type merge -p "$(python3 -c 'import json,pathlib; print(json.dumps({"data":{"config.conf": pathlib.Path("/tmp/cka-kube-proxy.conf.bak").read_text()}}))')"
kubectl -n kube-system rollout restart daemonset/kube-proxy
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=240s
```
<!-- /fault -->

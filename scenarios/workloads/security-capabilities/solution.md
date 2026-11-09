## Solution

### Question 1: Init container of ${Q1_APP} fails

`kubectl logs <pod> -c net-setup` shows `ip: RTNETLINK answers: Operation not permitted`. Changing network interfaces and addresses needs `NET_ADMIN`, and only the init container does that. The address stays after the init container exits because all containers of a Pod share its network namespace, so `app` needs nothing added. Capability names in `securityContext` have no `CAP_` prefix.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"add","path":"/spec/template/spec/initContainers/0/securityContext/capabilities/add","value":["NET_ADMIN"]}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}"
kubectl -n "${Q1_NS}" exec "deployment/${Q1_APP}" -c app -- ip -4 addr show lo
```

### Question 2: ${Q2_APP} stopped working after hardening

The logs reveal the needs one at a time:

- `chown("/var/cache/nginx/client_temp", 101) failed (1: Operation not permitted)`: the master process crashes, so add `CHOWN`.
- `setgid(101) failed (1: Operation not permitted)`: the Pod is now `Running` but the workers die and nothing answers, so add `SETGID`.
- `setuid(101) failed (1: Operation not permitted)`: the same again, so add `SETUID`.

`NET_BIND_SERVICE` is what you might expect for port `80`, but nginx never asks for it here: containerd sets `net.ipv4.ip_unprivileged_port_start` to `0` in the Pod, so any process may bind a low port.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/securityContext/capabilities/add","value":["CHOWN","SETGID","SETUID"]}]'
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}"
```

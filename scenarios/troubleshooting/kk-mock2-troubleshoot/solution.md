# Mock 2 practice: troubleshooting

## q1 — probe template

`kubectl apply -f /opt/course/${Q1_POD}.yaml` fails because `livenessProbe.httpGet` has `command` and no `port`. Change `httpGet` to `exec`. After apply, the Pod restarts: `initialDelaySeconds: 1` fires before `touch /healthcheck` (after 3s). Set `initialDelaySeconds` to at least `5`. Do not change `args`.

```bash
# edit /opt/course/${Q1_POD}.yaml then:
kubectl delete pod ${Q1_POD} --ignore-not-found
kubectl apply -f /opt/course/${Q1_POD}.yaml
```

## q2 — API server etcd flags

`kubectl` fails. On controlplane:

```bash
sudo crictl ps -a | grep kube-apiserver
sudo crictl logs <id>
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

Fix `--etcd-server=http://...` to `--etcd-servers=https://127.0.0.1:2379`, and `--etcd-cafile` to `/etc/kubernetes/pki/etcd/ca.crt`. Wait for the static Pod to restart.

## q3 — ConfigMap mount

`FailedMount` on the volume: Deployment references ConfigMap `${Q3_APP}-configuration`, but the real one is `${Q3_APP}-config`. Patch or edit the Deployment volume name, then `curl http://controlplane:${Q3_NODEPORT}/`.

## q4 — PVC size

`VolumeMismatch`: PV is 100Mi, claim asks 150Mi. Delete and recreate the PVC with `storage: 100Mi` (and the same `volumeName`).

## q5 — `/bin/bash`

Events show `exec: "/bin/bash": no such file`. busybox has `/bin/sh`. Recreate the Pod with `command: ["/bin/sh", "-c"]`.

## q6 — Service selector

`Endpoints: <none>`. Selector uses `run=${Q6_APP}-O1` but the Pod is `run=${Q6_APP}`. Delete and recreate the Service (or `kubectl expose pod`) with the correct selector; keep port 80.

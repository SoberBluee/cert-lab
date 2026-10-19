# kubectl fails on the control plane

`kubectl` fails. On controlplane:

```bash
sudo crictl ps -a | grep kube-apiserver
sudo crictl logs <id>
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

Fix `--etcd-server=http://...` to `--etcd-servers=https://127.0.0.1:2379`, and `--etcd-cafile` to `/etc/kubernetes/pki/etcd/ca.crt`. Wait for the static Pod to restart.

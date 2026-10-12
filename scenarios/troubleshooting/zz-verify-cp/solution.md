## Solution

### Question 1: Control plane after maintenance

This run's fault: **`${Q1_FAULT}`**.

Every fault this question can roll:

#### API server talks to the etcd peer port (`apiserver-etcd-port`)

`--etcd-servers` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at port `2380`, etcd's peer port, instead of the client port `2379`. The API server cannot reach its storage and keeps exiting, so kubectl fails. `crictl logs` of the kube-apiserver container shows the etcd connection errors; `--listen-client-urls` in `etcd.yaml` shows the right port.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-servers=https://127.0.0.1):2380$#\1:2379#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-servers=https://127.0.0.1:2379$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```

#### API server etcd client certificate path is wrong (`apiserver-etcd-certfile`)

`--etcd-certfile` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt`, which does not exist. The certificate lives one directory up, in `/etc/kubernetes/pki/`. The API server exits at startup with "no such file or directory", which `crictl logs` shows.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-certfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt$#\1/etc/kubernetes/pki/apiserver-etcd-client.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```

#### etcd server certificate path is wrong (`etcd-cert-path`)

`--cert-file` in `/etc/kubernetes/manifests/etcd.yaml` points at `server.cert` instead of `server.crt`. etcd exits at startup, and the API server loses its storage with it. kubectl fails, the kube-apiserver logs show etcd connection errors, and `crictl logs` of the etcd container shows the missing file.

```bash
sed -i -E 's#^([[:space:]]*- --cert-file=/etc/kubernetes/pki/etcd/server)\.cert$#\1.crt#' /etc/kubernetes/manifests/etcd.yaml
grep -qE -- '- --cert-file=/etc/kubernetes/pki/etcd/server.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
```

#### Typo in the scheduler command (`scheduler-command`)

The command in `/etc/kubernetes/manifests/kube-scheduler.yaml` runs `kube-schedular`, a binary that does not exist, so the scheduler never starts and new Pods stay `Pending` with no events. `kubectl -n kube-system describe pod kube-scheduler-controlplane` shows the failing command.

```bash
sed -i -E 's#^([[:space:]]*)- kube-schedular$#\1- kube-scheduler#' /etc/kubernetes/manifests/kube-scheduler.yaml
grep -qE -- '- kube-scheduler$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
```

#### Controller manager kubeconfig path is wrong (`controller-manager-kubeconfig`)

`--kubeconfig` in `/etc/kubernetes/manifests/kube-controller-manager.yaml` points at `controller-manager.config` instead of `controller-manager.conf`. The controller manager exits at startup, so the Deployment is scaled but no ReplicaSet creates Pods (`kubectl get deploy` shows 0 of 2, with no Pods at all). Its logs show the missing file.

```bash
sed -i -E 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/controller-manager)\.config$#\1.conf#' /etc/kubernetes/manifests/kube-controller-manager.yaml
grep -qE -- '- --kubeconfig=/etc/kubernetes/controller-manager.conf$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
```

#### controlplane kubelet client certificate path is wrong (`kubelet-client-cert`)

`client-certificate` in `/etc/kubernetes/kubelet.conf` points at `/var/lib/kubelet/pki/kubelet-client.pem`, which does not exist, so the kubelet on controlplane cannot authenticate and exits. The node turns `NotReady` while the static pods keep running. `journalctl -u kubelet` shows the missing file; `ls /var/lib/kubelet/pki` shows `kubelet-client-current.pem`. Fix the path and restart the kubelet.

```bash
sed -i -E 's#^([[:space:]]*client-certificate: /var/lib/kubelet/pki/)kubelet-client.pem$#\1kubelet-client-current.pem#' /etc/kubernetes/kubelet.conf
grep -qE -- 'client-certificate: /var/lib/kubelet/pki/kubelet-client-current.pem$' /etc/kubernetes/kubelet.conf || { echo "could not modify /etc/kubernetes/kubelet.conf" >&2; exit 1; }
systemctl restart kubelet
```

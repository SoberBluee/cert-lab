## Solution

`kubectl` cannot reach the API server, so inspect the static Pod on `controlplane` directly.

```bash
ssh controlplane
sudo crictl ps -a | grep kube-apiserver          # Exited, restarting
sudo crictl logs <container-id> 2>&1 | head
sudo ls /var/log/pods/ | grep apiserver           # the same output stays on disk between restarts
```

### Fault 1: the API server stops at startup

<!-- fault API_FAULT=authz-mode -->
The log says `authorization-mode "RBACC" is not a valid mode`. `/etc/kubernetes/manifests/kube-apiserver.yaml` has `--authorization-mode=Node,RBACC`; set it back to `Node,RBAC`.

```bash
sudo grep -rh RBACC /var/log/pods/kube-system_kube-apiserver-controlplane_*/ | head -1 > /opt/course/1/apiserver-error.log
```
<!-- /fault -->
<!-- fault API_FAULT=admission-plugin -->
The log says `enable-admission-plugins plugin "PodNodeSelectors" is unknown`. The plugin is called `PodNodeSelector`, and kubeadm only enables `NodeRestriction`. Set `--enable-admission-plugins=NodeRestriction` again.

```bash
sudo grep -rh PodNodeSelectors /var/log/pods/kube-system_kube-apiserver-controlplane_*/ | head -1 > /opt/course/1/apiserver-error.log
```
<!-- /fault -->
<!-- fault API_FAULT=unknown-flag -->
The log says `unknown flag: --enable-bootstrap-token-authn`. The real flag is `--enable-bootstrap-token-auth=true`; without it, new nodes could no longer join with a bootstrap token, so fix the name rather than deleting the line.

```bash
sudo grep -rh enable-bootstrap-token-authn /var/log/pods/kube-system_kube-apiserver-controlplane_*/ | head -1 > /opt/course/1/apiserver-error.log
```
<!-- /fault -->

The kubelet notices the changed manifest and restarts the Pod.

### Fault 2: the API server cannot reach etcd

Once the flags parse, the API server starts but still fails, now with etcd connection errors in `crictl logs`.

<!-- fault ETCD_FAULT=port -->
`--etcd-servers=https://127.0.0.1:2380` is etcd's **peer** port. The client port is `2379`; see `--listen-client-urls` in `etcd.yaml`.
<!-- /fault -->
<!-- fault ETCD_FAULT=certfile -->
`--etcd-certfile=/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt` does not exist. `ls /etc/kubernetes/pki` shows the file one directory up: `/etc/kubernetes/pki/apiserver-etcd-client.crt`.
<!-- /fault -->
<!-- fault ETCD_FAULT=cafile -->
`--etcd-cafile=/etc/kubernetes/pki/ca.crt` is the cluster CA, but etcd's serving certificate is signed by the separate etcd CA, so the TLS handshake fails with `x509: certificate signed by unknown authority`. Compare with `--trusted-ca-file` in `etcd.yaml`: the right file is `/etc/kubernetes/pki/etcd/ca.crt`.
<!-- /fault -->

Fix it, then wait. A container that crashed many times can sit in back-off for a few minutes.

```bash
watch sudo crictl ps
kubectl get --raw /readyz
kubectl -n kube-system get pods -l tier=control-plane
```

**Exam tip:** always save a copy before editing a static Pod manifest, and keep the copy **outside** `/etc/kubernetes/manifests`. The kubelet runs every file in that folder.

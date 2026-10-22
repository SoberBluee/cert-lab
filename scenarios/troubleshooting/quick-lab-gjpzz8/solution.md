## Solution

### Question 1: Control plane after maintenance

**The healthy setup**

- `etcd`, `kube-apiserver`, `kube-controller-manager` and `kube-scheduler` run as static Pods from `/etc/kubernetes/manifests`, with the flags, paths and images kubeadm wrote
- the kubelet on `controlplane` uses `/etc/kubernetes/kubelet.conf` and `staticPodPath: /etc/kubernetes/manifests`

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=apiserver-etcd-port -->
#### API server talks to the etcd peer port (`apiserver-etcd-port`)

`--etcd-servers` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at port `2380`, etcd's peer port, instead of the client port `2379`. The API server cannot reach its storage and keeps exiting, so kubectl fails. `crictl logs` of the kube-apiserver container shows the etcd connection errors; `--listen-client-urls` in `etcd.yaml` shows the right port.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-servers=https://127.0.0.1):2380$#\1:2379#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-servers=https://127.0.0.1:2379$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-etcd-certfile -->
#### API server etcd client certificate path is wrong (`apiserver-etcd-certfile`)

`--etcd-certfile` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt`, which does not exist. The certificate lives one directory up, in `/etc/kubernetes/pki/`. The API server exits at startup with "no such file or directory", which `crictl logs` shows.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-certfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt$#\1/etc/kubernetes/pki/apiserver-etcd-client.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-etcd-flags -->
#### API server etcd flag name, scheme and CA are wrong (`apiserver-etcd-flags`)

`--etcd-servers` was renamed to `--etcd-server` (singular), downgraded to `http://`, and `--etcd-cafile` points at the cluster CA instead of `/etc/kubernetes/pki/etcd/ca.crt`. The API server cannot talk to etcd and keeps exiting. `crictl logs` of kube-apiserver and a side-by-side with `etcd.yaml` show the correct flag name, `https`, and etcd CA path.

```bash
sed -i -E 's#^([[:space:]]*- --)etcd-server=#\1etcd-servers=#' /etc/kubernetes/manifests/kube-apiserver.yaml
sed -i -E 's#^([[:space:]]*- --etcd-servers=)http://127.0.0.1:2379$#\1https://127.0.0.1:2379#' /etc/kubernetes/manifests/kube-apiserver.yaml
sed -i -E 's#^([[:space:]]*- --etcd-cafile=)/etc/kubernetes/pki/ca.crt$#\1/etc/kubernetes/pki/etcd/ca.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-admission-plugin -->
#### API server enables an admission plugin that does not exist (`apiserver-admission-plugin`)

`--enable-admission-plugins` in `/etc/kubernetes/manifests/kube-apiserver.yaml` adds `PodSecurityPolicy`, a plugin that was removed from Kubernetes in 1.25. The API server exits at startup ("unknown admission plugins"), so kubectl gets `connection refused`. `crictl ps -a` and `crictl logs` of the last kube-apiserver container show the error. Remove the plugin from the list.

```bash
sed -i -E 's#^([[:space:]]*- --enable-admission-plugins=[^[:space:]]+),PodSecurityPolicy$#\1#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --enable-admission-plugins=[^,[:space:]]+(,[^,[:space:]]+)*$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-etcd-keyfile -->
#### API server etcd client key path is wrong (`apiserver-etcd-keyfile`)

`--etcd-keyfile` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `/etc/kubernetes/pki/etcd/apiserver-etcd-client.key`, which does not exist. The key lives with the certificate in `/etc/kubernetes/pki/`. The API server exits at startup; `crictl logs` shows the missing key.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-keyfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.key$#\1/etc/kubernetes/pki/apiserver-etcd-client.key#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-keyfile=/etc/kubernetes/pki/apiserver-etcd-client.key$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-tls-key-path -->
#### API server TLS private key path is wrong (`apiserver-tls-key-path`)

`--tls-private-key-file` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `apiserver.pem`, which does not exist, so the API server cannot load its serving key and exits; kubectl gets `connection refused`. `ls /etc/kubernetes/pki` shows `apiserver.key`.

```bash
sed -i -E 's#^([[:space:]]*- --tls-private-key-file=/etc/kubernetes/pki/apiserver)\.pem$#\1.key#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --tls-private-key-file=/etc/kubernetes/pki/apiserver.key$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-manifest-removed -->
#### API server static Pod manifest is missing (`apiserver-manifest-removed`)

`/etc/kubernetes/manifests/kube-apiserver.yaml` was moved aside, so the kubelet no longer runs the API server and nothing listens on `6443`. `ls /etc/kubernetes/manifests` is missing the file; a copy sits in `/var/tmp/cka-kube-apiserver.yaml`. Put it back.

```bash
mv /var/tmp/cka-kube-apiserver.yaml /etc/kubernetes/manifests/kube-apiserver.yaml
[[ -f /etc/kubernetes/manifests/kube-apiserver.yaml ]]
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-advertise-address -->
#### API server advertise-address is a non-routable IP (`apiserver-advertise-address`)

`--advertise-address` in `/etc/kubernetes/manifests/kube-apiserver.yaml` is `not-a-valid-ip`, so the API server exits at startup. Set it back to the control plane node's IPv4 address (`ip -4 addr` or the value that was in the manifest before).

```bash
addr=$(cat "/var/tmp/cka-q1.advertise")
sed -i -E "s#^([[:space:]]*- --advertise-address=).*$#\1${addr}#" /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- "- --advertise-address=${addr}$" /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not restore advertise-address" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-service-account-key -->
#### API server service-account-key-file path is wrong (`apiserver-service-account-key`)

`--service-account-key-file` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `sa.pem`, which does not exist. The API server exits at startup; `ls /etc/kubernetes/pki` shows `sa.pub`. Set the path back to `/etc/kubernetes/pki/sa.pub`.

```bash
sed -i -E 's#^([[:space:]]*- --service-account-key-file=/etc/kubernetes/pki/sa)\.pem$#\1.pub#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --service-account-key-file=/etc/kubernetes/pki/sa.pub$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

## Solution

### Question 1: Control plane after maintenance

**The healthy setup**

- `etcd`, `kube-apiserver`, `kube-controller-manager` and `kube-scheduler` run as static Pods from `/etc/kubernetes/manifests`, with the flags, paths and images kubeadm wrote
- the kubelet on `controlplane` uses `/etc/kubernetes/kubelet.conf` and `staticPodPath: /etc/kubernetes/manifests`

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=etcd-cert-path -->
#### etcd server certificate path is wrong (`etcd-cert-path`)

`--cert-file` in `/etc/kubernetes/manifests/etcd.yaml` points at `server.cert` instead of `server.crt`. etcd exits at startup, and the API server loses its storage with it. kubectl fails, the kube-apiserver logs show etcd connection errors, and `crictl logs` of the etcd container shows the missing file.

```bash
sed -i -E 's#^([[:space:]]*- --cert-file=/etc/kubernetes/pki/etcd/server)\.cert$#\1.crt#' /etc/kubernetes/manifests/etcd.yaml
grep -qE -- '- --cert-file=/etc/kubernetes/pki/etcd/server.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=etcd-key-path -->
#### etcd server key path is wrong (`etcd-key-path`)

`--key-file` in `/etc/kubernetes/manifests/etcd.yaml` points at `server.pem` instead of `server.key`. etcd exits at startup and the API server loses its storage. `crictl logs` of the etcd container shows the missing file.

```bash
sed -i -E 's#^([[:space:]]*- --key-file=/etc/kubernetes/pki/etcd/server)\.pem$#\1.key#' /etc/kubernetes/manifests/etcd.yaml
grep -qE -- '- --key-file=/etc/kubernetes/pki/etcd/server.key$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=etcd-trusted-ca-path -->
#### etcd trusted CA path is wrong (`etcd-trusted-ca-path`)

`--trusted-ca-file` in `/etc/kubernetes/manifests/etcd.yaml` points at `ca.pem`, which does not exist. etcd exits; the API server cannot reach storage and kubectl fails. `ls /etc/kubernetes/pki/etcd` shows `ca.crt`.

```bash
sed -i -E 's#^([[:space:]]*- --trusted-ca-file=/etc/kubernetes/pki/etcd/ca)\.pem$#\1.crt#' /etc/kubernetes/manifests/etcd.yaml
grep -qE -- '- --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=etcd-client-urls -->
#### etcd listens on the wrong client port (`etcd-client-urls`)

`--listen-client-urls` and `--advertise-client-urls` in `/etc/kubernetes/manifests/etcd.yaml` use port `2378` instead of `2379`. The API server still dials `2379` (`--etcd-servers` in `kube-apiserver.yaml`), so it cannot reach etcd and keeps exiting. Put both URLs back on `2379`.

```bash
sed -i -E '/--listen-client-urls=/s/:2378/:2379/g' /etc/kubernetes/manifests/etcd.yaml
sed -i -E '/--advertise-client-urls=/s/:2378/:2379/g' /etc/kubernetes/manifests/etcd.yaml
```
<!-- /fault -->

<!-- fault Q1_FAULT=etcd-data-dir -->
#### etcd data directory path is wrong (`etcd-data-dir`)

`--data-dir` in `/etc/kubernetes/manifests/etcd.yaml` points at `/var/lib/etcd-broken`, which is empty or missing. etcd cannot open its database and exits; the API goes down with it. Set the path back to `/var/lib/etcd`.

```bash
sed -i -E 's#^([[:space:]]*- --data-dir=)/var/lib/etcd-broken$#\1/var/lib/etcd#' /etc/kubernetes/manifests/etcd.yaml
grep -qE -- '- --data-dir=/var/lib/etcd$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=etcd-image-tag -->
#### etcd image tag does not exist (`etcd-image-tag`)

The image in `/etc/kubernetes/manifests/etcd.yaml` has tag `v0.0.0`, which does not exist. The kubelet cannot pull etcd (`ErrImagePull`), so storage never comes up and the API server fails. Use the same tag as before (`cat` a backup, or match `kubeadm config images list`).

```bash
sed -i -E "s#etcd:v0\.0\.0#$(cat "/var/tmp/cka-q1.etcd-image")#" /etc/kubernetes/manifests/etcd.yaml
grep -q 'etcd:v0\.0\.0' /etc/kubernetes/manifests/etcd.yaml && { echo "could not restore the etcd image" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=etcd-peer-urls -->
#### etcd peer URLs use the wrong port (`etcd-peer-urls`)

`--listen-peer-urls` and `--initial-advertise-peer-urls` in `/etc/kubernetes/manifests/etcd.yaml` use port `2381` instead of `2380`. etcd becomes unhealthy and the API server loses storage. Put both peer URLs back on `2380`.

```bash
sed -i -E '/--listen-peer-urls=/s/:2381/:2380/g' /etc/kubernetes/manifests/etcd.yaml
sed -i -E '/--initial-advertise-peer-urls=/s/:2381/:2380/g' /etc/kubernetes/manifests/etcd.yaml
```
<!-- /fault -->

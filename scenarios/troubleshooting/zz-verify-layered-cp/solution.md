## Solution

### Question 1: Control plane after maintenance

**The healthy setup**

- `etcd`, `kube-apiserver`, `kube-controller-manager` and `kube-scheduler` run as static Pods from `/etc/kubernetes/manifests`, with the flags, paths and images kubeadm wrote
- the kubelet on `controlplane` uses `/etc/kubernetes/kubelet.conf` and `staticPodPath: /etc/kubernetes/manifests`

This run broke 2 things: **`${Q1_FAULT}`**, **`${Q1_FAULT_2}`**. Fix them in the order below.

**Problem 1: the scheduler or the controller manager**

<!-- fault Q1_FAULT=scheduler-command -->
#### Typo in the scheduler command (`scheduler-command`)

The command in `/etc/kubernetes/manifests/kube-scheduler.yaml` runs `kube-schedular`, a binary that does not exist, so the scheduler never starts and new Pods stay `Pending` with no events. `kubectl -n kube-system describe pod kube-scheduler-controlplane` shows the failing command.

```bash
sed -i -E 's#^([[:space:]]*)- kube-schedular$#\1- kube-scheduler#' /etc/kubernetes/manifests/kube-scheduler.yaml
grep -qE -- '- kube-scheduler$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=controller-manager-kubeconfig -->
#### Controller manager kubeconfig path is wrong (`controller-manager-kubeconfig`)

`--kubeconfig` in `/etc/kubernetes/manifests/kube-controller-manager.yaml` points at `controller-manager.config` instead of `controller-manager.conf`. The controller manager exits at startup, so the Deployment is scaled but no ReplicaSet creates Pods (`kubectl get deploy` shows 0 of 2, with no Pods at all). Its logs show the missing file.

```bash
sed -i -E 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/controller-manager)\.config$#\1.conf#' /etc/kubernetes/manifests/kube-controller-manager.yaml
grep -qE -- '- --kubeconfig=/etc/kubernetes/controller-manager.conf$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=scheduler-kubeconfig-path -->
#### Scheduler kubeconfig path is wrong (`scheduler-kubeconfig-path`)

`--kubeconfig` in `/etc/kubernetes/manifests/kube-scheduler.yaml` points at `/etc/kubernetes/scheduler.config` instead of `scheduler.conf`. The scheduler exits at startup, so the new `web` Pods stay `Pending` with no scheduling events. `kubectl -n kube-system logs kube-scheduler-controlplane` (or `crictl logs`) shows the missing file; `ls /etc/kubernetes` shows the real one.

```bash
sed -i -E 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/scheduler)\.config$#\1.conf#' /etc/kubernetes/manifests/kube-scheduler.yaml
grep -qE -- '- --kubeconfig=/etc/kubernetes/scheduler.conf$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=scheduler-image-tag -->
#### Scheduler image tag does not exist (`scheduler-image-tag`)

The image in `/etc/kubernetes/manifests/kube-scheduler.yaml` has tag `v0.0.0`, which does not exist. The kubelet cannot pull it (`ErrImagePull` in `kubectl -n kube-system describe pod kube-scheduler-controlplane`, or `crictl ps -a` shows no scheduler), so new Pods stay `Pending`. Use the same tag as the other control plane images (`grep image: /etc/kubernetes/manifests/*.yaml`, or `kubeadm config images list`).

```bash
sed -i -E "s#kube-scheduler:v0\.0\.0#$(cat "/var/tmp/cka-q1.scheduler-image")#" /etc/kubernetes/manifests/kube-scheduler.yaml
grep -q 'kube-scheduler:v0\.0\.0' /etc/kubernetes/manifests/kube-scheduler.yaml && { echo "could not restore the scheduler image" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=controller-manager-sa-key -->
#### Controller manager service account key path is wrong (`controller-manager-sa-key`)

`--service-account-private-key-file` in `/etc/kubernetes/manifests/kube-controller-manager.yaml` points at `/etc/kubernetes/pki/sa.pem`, which does not exist. The controller manager exits at startup, so `web` is scaled to 2 but no ReplicaSet creates Pods. Its logs (`crictl logs`) name the missing key; `ls /etc/kubernetes/pki` shows `sa.key`.

```bash
sed -i -E 's#^([[:space:]]*- --service-account-private-key-file=/etc/kubernetes/pki/sa)\.pem$#\1.key#' /etc/kubernetes/manifests/kube-controller-manager.yaml
grep -qE -- '- --service-account-private-key-file=/etc/kubernetes/pki/sa.key$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=scheduler-manifest-removed -->
#### Scheduler static Pod manifest is missing (`scheduler-manifest-removed`)

`/etc/kubernetes/manifests/kube-scheduler.yaml` was moved aside, so the kubelet stops the scheduler and new Pods stay `Pending`. `ls /etc/kubernetes/manifests` is missing the file; restore it from `/var/tmp/cka-kube-scheduler.yaml`.

```bash
mv /var/tmp/cka-kube-scheduler.yaml /etc/kubernetes/manifests/kube-scheduler.yaml
[[ -f /etc/kubernetes/manifests/kube-scheduler.yaml ]]
```
<!-- /fault -->

<!-- fault Q1_FAULT=scheduler-manifest-yaml -->
#### Scheduler manifest is not valid YAML (`scheduler-manifest-yaml`)

The `image:` line in `/etc/kubernetes/manifests/kube-scheduler.yaml` is indented by three spaces instead of four, so the kubelet cannot parse the manifest and drops the scheduler Pod. New `web` Pods stay `Pending`. `journalctl -u kubelet` reports the bad manifest; fix the indentation.

```bash
sed -i -E 's#^   image: (registry\.k8s\.io/kube-scheduler:)#    image: \1#' /etc/kubernetes/manifests/kube-scheduler.yaml
grep -qE -- '^    image: registry.k8s.io/kube-scheduler:' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=controller-manager-command -->
#### Typo in the controller manager command (`controller-manager-command`)

The command in `/etc/kubernetes/manifests/kube-controller-manager.yaml` runs `kube-controller-managr`, which does not exist, so the controller manager never starts. The Deployment is scaled but no ReplicaSet creates Pods. Fix the binary name in the manifest.

```bash
sed -i -E 's#^([[:space:]]*)- kube-controller-managr$#\1- kube-controller-manager#' /etc/kubernetes/manifests/kube-controller-manager.yaml
grep -qE -- '- kube-controller-manager$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=scheduler-leader-elect -->
#### Scheduler --config points at a missing file (`scheduler-leader-elect`)

`/etc/kubernetes/manifests/kube-scheduler.yaml` passes `--config=/etc/kubernetes/sched-config.yaml`, which does not exist, so the scheduler exits and new Pods stay `Pending`. Remove that flag (kubeadm schedulers use `--kubeconfig` / `--authentication-kubeconfig` instead) so the scheduler starts again.

```bash
sed -i -E '/^[[:space:]]*- --config=\/etc\/kubernetes\/sched-config\.yaml$/d' /etc/kubernetes/manifests/kube-scheduler.yaml
! grep -qE -- '- --config=/etc/kubernetes/sched-config\.yaml$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not remove scheduler --config" >&2; exit 1; }
```
<!-- /fault -->

**Problem 2: the API server or etcd**

<!-- fault Q1_FAULT_2=apiserver-etcd-port -->
#### API server talks to the etcd peer port (`apiserver-etcd-port`)

`--etcd-servers` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at port `2380`, etcd's peer port, instead of the client port `2379`. The API server cannot reach its storage and keeps exiting, so kubectl fails. `crictl logs` of the kube-apiserver container shows the etcd connection errors; `--listen-client-urls` in `etcd.yaml` shows the right port.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-servers=https://127.0.0.1):2380$#\1:2379#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-servers=https://127.0.0.1:2379$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=apiserver-etcd-certfile -->
#### API server etcd client certificate path is wrong (`apiserver-etcd-certfile`)

`--etcd-certfile` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt`, which does not exist. The certificate lives one directory up, in `/etc/kubernetes/pki/`. The API server exits at startup with "no such file or directory", which `crictl logs` shows.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-certfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt$#\1/etc/kubernetes/pki/apiserver-etcd-client.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=apiserver-etcd-flags -->
#### API server etcd flag name, scheme and CA are wrong (`apiserver-etcd-flags`)

`--etcd-servers` was renamed to `--etcd-server` (singular), downgraded to `http://`, and `--etcd-cafile` points at the cluster CA instead of `/etc/kubernetes/pki/etcd/ca.crt`. The API server cannot talk to etcd and keeps exiting. `crictl logs` of kube-apiserver and a side-by-side with `etcd.yaml` show the correct flag name, `https`, and etcd CA path.

```bash
sed -i -E 's#^([[:space:]]*- --)etcd-server=#\1etcd-servers=#' /etc/kubernetes/manifests/kube-apiserver.yaml
sed -i -E 's#^([[:space:]]*- --etcd-servers=)http://127.0.0.1:2379$#\1https://127.0.0.1:2379#' /etc/kubernetes/manifests/kube-apiserver.yaml
sed -i -E 's#^([[:space:]]*- --etcd-cafile=)/etc/kubernetes/pki/ca.crt$#\1/etc/kubernetes/pki/etcd/ca.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=etcd-cert-path -->
#### etcd server certificate path is wrong (`etcd-cert-path`)

`--cert-file` in `/etc/kubernetes/manifests/etcd.yaml` points at `server.cert` instead of `server.crt`. etcd exits at startup, and the API server loses its storage with it. kubectl fails, the kube-apiserver logs show etcd connection errors, and `crictl logs` of the etcd container shows the missing file.

```bash
sed -i -E 's#^([[:space:]]*- --cert-file=/etc/kubernetes/pki/etcd/server)\.cert$#\1.crt#' /etc/kubernetes/manifests/etcd.yaml
grep -qE -- '- --cert-file=/etc/kubernetes/pki/etcd/server.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=kubelet-static-pod-path -->
#### controlplane kubelet watches the wrong static pod directory (`kubelet-static-pod-path`)

`staticPodPath` in `/var/lib/kubelet/config.yaml` is `/etc/kubernetes/manifest`, a directory that does not exist. The kubelet runs, but it finds no static pod manifests and stops etcd, the API server, the scheduler and the controller manager, so kubectl fails. `crictl ps` on controlplane shows no control plane containers, and `journalctl -u kubelet` mentions the missing path. Set it back to `/etc/kubernetes/manifests` and restart the kubelet.

```bash
sed -i -E 's#^staticPodPath: /etc/kubernetes/manifest$#staticPodPath: /etc/kubernetes/manifests#' /var/lib/kubelet/config.yaml
grep -qE -- '^staticPodPath: /etc/kubernetes/manifests$' /var/lib/kubelet/config.yaml || { echo "could not modify /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=apiserver-admission-plugin -->
#### API server enables an admission plugin that does not exist (`apiserver-admission-plugin`)

`--enable-admission-plugins` in `/etc/kubernetes/manifests/kube-apiserver.yaml` adds `PodSecurityPolicy`, a plugin that was removed from Kubernetes in 1.25. The API server exits at startup ("unknown admission plugins"), so kubectl gets `connection refused`. `crictl ps -a` and `crictl logs` of the last kube-apiserver container show the error. Remove the plugin from the list.

```bash
sed -i -E 's#^([[:space:]]*- --enable-admission-plugins=[^[:space:]]+),PodSecurityPolicy$#\1#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --enable-admission-plugins=[^,[:space:]]+(,[^,[:space:]]+)*$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=apiserver-etcd-keyfile -->
#### API server etcd client key path is wrong (`apiserver-etcd-keyfile`)

`--etcd-keyfile` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `/etc/kubernetes/pki/etcd/apiserver-etcd-client.key`, which does not exist. The key lives with the certificate in `/etc/kubernetes/pki/`. The API server exits at startup; `crictl logs` shows the missing key.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-keyfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.key$#\1/etc/kubernetes/pki/apiserver-etcd-client.key#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-keyfile=/etc/kubernetes/pki/apiserver-etcd-client.key$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=apiserver-tls-key-path -->
#### API server TLS private key path is wrong (`apiserver-tls-key-path`)

`--tls-private-key-file` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `apiserver.pem`, which does not exist, so the API server cannot load its serving key and exits; kubectl gets `connection refused`. `ls /etc/kubernetes/pki` shows `apiserver.key`.

```bash
sed -i -E 's#^([[:space:]]*- --tls-private-key-file=/etc/kubernetes/pki/apiserver)\.pem$#\1.key#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --tls-private-key-file=/etc/kubernetes/pki/apiserver.key$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=apiserver-manifest-removed -->
#### API server static Pod manifest is missing (`apiserver-manifest-removed`)

`/etc/kubernetes/manifests/kube-apiserver.yaml` was moved aside, so the kubelet no longer runs the API server and nothing listens on `6443`. `ls /etc/kubernetes/manifests` is missing the file; a copy sits in `/var/tmp/cka-kube-apiserver.yaml`. Put it back.

```bash
mv /var/tmp/cka-kube-apiserver.yaml /etc/kubernetes/manifests/kube-apiserver.yaml
[[ -f /etc/kubernetes/manifests/kube-apiserver.yaml ]]
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=etcd-key-path -->
#### etcd server key path is wrong (`etcd-key-path`)

`--key-file` in `/etc/kubernetes/manifests/etcd.yaml` points at `server.pem` instead of `server.key`. etcd exits at startup and the API server loses its storage. `crictl logs` of the etcd container shows the missing file.

```bash
sed -i -E 's#^([[:space:]]*- --key-file=/etc/kubernetes/pki/etcd/server)\.pem$#\1.key#' /etc/kubernetes/manifests/etcd.yaml
grep -qE -- '- --key-file=/etc/kubernetes/pki/etcd/server.key$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=etcd-trusted-ca-path -->
#### etcd trusted CA path is wrong (`etcd-trusted-ca-path`)

`--trusted-ca-file` in `/etc/kubernetes/manifests/etcd.yaml` points at `ca.pem`, which does not exist. etcd exits; the API server cannot reach storage and kubectl fails. `ls /etc/kubernetes/pki/etcd` shows `ca.crt`.

```bash
sed -i -E 's#^([[:space:]]*- --trusted-ca-file=/etc/kubernetes/pki/etcd/ca)\.pem$#\1.crt#' /etc/kubernetes/manifests/etcd.yaml
grep -qE -- '- --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=etcd-client-urls -->
#### etcd listens on the wrong client port (`etcd-client-urls`)

`--listen-client-urls` and `--advertise-client-urls` in `/etc/kubernetes/manifests/etcd.yaml` use port `2378` instead of `2379`. The API server still dials `2379` (`--etcd-servers` in `kube-apiserver.yaml`), so it cannot reach etcd and keeps exiting. Put both URLs back on `2379`.

```bash
sed -i -E '/--listen-client-urls=/s/:2378/:2379/g' /etc/kubernetes/manifests/etcd.yaml
sed -i -E '/--advertise-client-urls=/s/:2378/:2379/g' /etc/kubernetes/manifests/etcd.yaml
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=etcd-data-dir -->
#### etcd data directory path is wrong (`etcd-data-dir`)

`--data-dir` in `/etc/kubernetes/manifests/etcd.yaml` points at `/var/lib/etcd-broken`, which is empty or missing. etcd cannot open its database and exits; the API goes down with it. Set the path back to `/var/lib/etcd`.

```bash
sed -i -E 's#^([[:space:]]*- --data-dir=)/var/lib/etcd-broken$#\1/var/lib/etcd#' /etc/kubernetes/manifests/etcd.yaml
grep -qE -- '- --data-dir=/var/lib/etcd$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=etcd-image-tag -->
#### etcd image tag does not exist (`etcd-image-tag`)

The image in `/etc/kubernetes/manifests/etcd.yaml` has tag `v0.0.0`, which does not exist. The kubelet cannot pull etcd (`ErrImagePull`), so storage never comes up and the API server fails. Use the same tag as before (`cat` a backup, or match `kubeadm config images list`).

```bash
sed -i -E "s#etcd:v0\.0\.0#$(cat "/var/tmp/cka-q1.etcd-image")#" /etc/kubernetes/manifests/etcd.yaml
grep -q 'etcd:v0\.0\.0' /etc/kubernetes/manifests/etcd.yaml && { echo "could not restore the etcd image" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=apiserver-advertise-address -->
#### API server advertise-address is a non-routable IP (`apiserver-advertise-address`)

`--advertise-address` in `/etc/kubernetes/manifests/kube-apiserver.yaml` is `not-a-valid-ip`, so the API server exits at startup. Set it back to the control plane node's IPv4 address (`ip -4 addr` or the value that was in the manifest before).

```bash
addr=$(cat "/var/tmp/cka-q1.advertise")
sed -i -E "s#^([[:space:]]*- --advertise-address=).*$#\1${addr}#" /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- "- --advertise-address=${addr}$" /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not restore advertise-address" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=apiserver-service-account-key -->
#### API server service-account-key-file path is wrong (`apiserver-service-account-key`)

`--service-account-key-file` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `sa.pem`, which does not exist. The API server exits at startup; `ls /etc/kubernetes/pki` shows `sa.pub`. Set the path back to `/etc/kubernetes/pki/sa.pub`.

```bash
sed -i -E 's#^([[:space:]]*- --service-account-key-file=/etc/kubernetes/pki/sa)\.pem$#\1.pub#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --service-account-key-file=/etc/kubernetes/pki/sa.pub$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=etcd-peer-urls -->
#### etcd peer URLs use the wrong port (`etcd-peer-urls`)

`--listen-peer-urls` and `--initial-advertise-peer-urls` in `/etc/kubernetes/manifests/etcd.yaml` use port `2381` instead of `2380`. etcd becomes unhealthy and the API server loses storage. Put both peer URLs back on `2380`.

```bash
sed -i -E '/--listen-peer-urls=/s/:2381/:2380/g' /etc/kubernetes/manifests/etcd.yaml
sed -i -E '/--initial-advertise-peer-urls=/s/:2381/:2380/g' /etc/kubernetes/manifests/etcd.yaml
```
<!-- /fault -->

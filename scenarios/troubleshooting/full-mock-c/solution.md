## Solution

### Question 1: Control plane after maintenance

**The healthy setup**

- `etcd`, `kube-apiserver`, `kube-controller-manager` and `kube-scheduler` run as static Pods from `/etc/kubernetes/manifests`, with the flags, paths and images kubeadm wrote
- the kubelet on `controlplane` uses `/etc/kubernetes/kubelet.conf` and `staticPodPath: /etc/kubernetes/manifests`

This run broke 2 things: **`${Q1_FAULT}`**, **`${Q1_FAULT_2}`**. Fix them in the order below.

**Problem 1: the scheduler or the controller manager**

<!-- fault Q1_FAULT=scheduler-missing-file -->
#### A scheduler flag points at a file that does not exist (`scheduler-missing-file`)

In this run the scheduler's `--${Q1_SCHEDULER_FILE}` flag in `/etc/kubernetes/manifests/kube-scheduler.yaml` names a file that does not exist, so the scheduler exits at startup and the new `web` Pods stay `Pending` with no scheduling events. `kubectl -n kube-system logs kube-scheduler-controlplane` (or `crictl logs`) names the file. The two ways this fault breaks the scheduler:

- `--kubeconfig` points at `/etc/kubernetes/scheduler.config`; `ls /etc/kubernetes` shows the real `scheduler.conf`
- an added `--config=/etc/kubernetes/sched-config.yaml`, a scheduler configuration that was never written: remove the flag (kubeadm's scheduler needs no `--config`), or write the file

```bash
case "${Q1_SCHEDULER_FILE}" in
  kubeconfig)
    sed -i -E 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/scheduler)\.config$#\1.conf#' /etc/kubernetes/manifests/kube-scheduler.yaml
    grep -qE -- '- --kubeconfig=/etc/kubernetes/scheduler.conf$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
    ;;
  config)
    sed -i -E '\#^[[:space:]]*- --config=/etc/kubernetes/sched-config.yaml$#d' /etc/kubernetes/manifests/kube-scheduler.yaml
    ! grep -qE -- '- --config=' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not remove scheduler --config" >&2; exit 1; }
    ;;
esac
```
<!-- /fault -->

<!-- fault Q1_FAULT=controller-manager-missing-file -->
#### A controller manager flag points at a file that does not exist (`controller-manager-missing-file`)

In this run `--${Q1_CM_FILE}` in `/etc/kubernetes/manifests/kube-controller-manager.yaml` names a file that does not exist. The controller manager exits at startup, so `web` is scaled to 2 but no ReplicaSet creates Pods: `kubectl get deploy` shows 0 of 2 and there are no Pods at all, which tells it apart from a broken scheduler (Pods that stay `Pending`). Its logs name the missing file. Every flag this fault can break:

- `--kubeconfig`: `/etc/kubernetes/controller-manager.conf` (broken: `/etc/kubernetes/controller-manager.config`)
- `--service-account-private-key-file`: `/etc/kubernetes/pki/sa.key` (broken: `/etc/kubernetes/pki/sa.pem`)

```bash
case "${Q1_CM_FILE}" in
  kubeconfig)
    sed -i -E 's#^([[:space:]]*- --kubeconfig=)/etc/kubernetes/controller-manager.config$#\1/etc/kubernetes/controller-manager.conf#' /etc/kubernetes/manifests/kube-controller-manager.yaml
    grep -qE -- '- --kubeconfig=/etc/kubernetes/controller-manager.conf$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
    ;;
  service-account-private-key-file)
    sed -i -E 's#^([[:space:]]*- --service-account-private-key-file=)/etc/kubernetes/pki/sa.pem$#\1/etc/kubernetes/pki/sa.key#' /etc/kubernetes/manifests/kube-controller-manager.yaml
    grep -qE -- '- --service-account-private-key-file=/etc/kubernetes/pki/sa.key$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
    ;;
  *) echo "unknown flag ${Q1_CM_FILE}" >&2; exit 1 ;;
esac
```
<!-- /fault -->

<!-- fault Q1_FAULT=scheduler-command -->
#### Typo in the scheduler command (`scheduler-command`)

The command in `/etc/kubernetes/manifests/kube-scheduler.yaml` runs `kube-schedular`, a binary that does not exist, so the scheduler never starts and new Pods stay `Pending` with no events. `kubectl -n kube-system describe pod kube-scheduler-controlplane` shows the failing command.

```bash
sed -i -E 's#^([[:space:]]*)- kube-schedular$#\1- kube-scheduler#' /etc/kubernetes/manifests/kube-scheduler.yaml
grep -qE -- '- kube-scheduler$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
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

**Problem 2: the API server or etcd**

<!-- fault Q1_FAULT_2=apiserver-missing-file -->
#### An API server flag points at a file that does not exist (`apiserver-missing-file`)

In this run `--${Q1_APISERVER_FILE}` in `/etc/kubernetes/manifests/kube-apiserver.yaml` names a file that does not exist, so the API server exits at startup and kubectl gets `connection refused`. Without the API, read the container's last words on the node: `crictl ps -a | grep kube-apiserver`, then `crictl logs <id>` ends with "no such file or directory" and the path. `ls /etc/kubernetes/pki` (and `/etc/kubernetes/pki/etcd`) shows where the file really is. Every flag this fault can break, with its real file:

- `--etcd-certfile`: `/etc/kubernetes/pki/apiserver-etcd-client.crt` (broken: `/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt`)
- `--etcd-keyfile`: `/etc/kubernetes/pki/apiserver-etcd-client.key` (broken: `/etc/kubernetes/pki/etcd/apiserver-etcd-client.key`)
- `--tls-private-key-file`: `/etc/kubernetes/pki/apiserver.key` (broken: `/etc/kubernetes/pki/apiserver.pem`)
- `--service-account-key-file`: `/etc/kubernetes/pki/sa.pub` (broken: `/etc/kubernetes/pki/sa.pem`)

```bash
case "${Q1_APISERVER_FILE}" in
  etcd-certfile)
    sed -i -E 's#^([[:space:]]*- --etcd-certfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt$#\1/etc/kubernetes/pki/apiserver-etcd-client.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  etcd-keyfile)
    sed -i -E 's#^([[:space:]]*- --etcd-keyfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.key$#\1/etc/kubernetes/pki/apiserver-etcd-client.key#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --etcd-keyfile=/etc/kubernetes/pki/apiserver-etcd-client.key$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  tls-private-key-file)
    sed -i -E 's#^([[:space:]]*- --tls-private-key-file=)/etc/kubernetes/pki/apiserver.pem$#\1/etc/kubernetes/pki/apiserver.key#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --tls-private-key-file=/etc/kubernetes/pki/apiserver.key$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  service-account-key-file)
    sed -i -E 's#^([[:space:]]*- --service-account-key-file=)/etc/kubernetes/pki/sa.pem$#\1/etc/kubernetes/pki/sa.pub#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --service-account-key-file=/etc/kubernetes/pki/sa.pub$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  *) echo "unknown flag ${Q1_APISERVER_FILE}" >&2; exit 1 ;;
esac
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=etcd-missing-file -->
#### An etcd flag points at a file that does not exist (`etcd-missing-file`)

In this run `--${Q1_ETCD_FILE}` in `/etc/kubernetes/manifests/etcd.yaml` names a file that does not exist. etcd exits at startup and the API server loses its storage with it: kubectl fails, and the kube-apiserver logs only show etcd connection errors. Follow them one component further: `crictl ps -a | grep etcd` and `crictl logs <id>` of the etcd container name the missing file; `ls /etc/kubernetes/pki/etcd` shows the real one. Every flag this fault can break:

- `--cert-file`: `/etc/kubernetes/pki/etcd/server.crt` (broken: `/etc/kubernetes/pki/etcd/server.cert`)
- `--key-file`: `/etc/kubernetes/pki/etcd/server.key` (broken: `/etc/kubernetes/pki/etcd/server.pem`)
- `--trusted-ca-file`: `/etc/kubernetes/pki/etcd/ca.crt` (broken: `/etc/kubernetes/pki/etcd/ca.pem`)

```bash
case "${Q1_ETCD_FILE}" in
  cert-file)
    sed -i -E 's#^([[:space:]]*- --cert-file=)/etc/kubernetes/pki/etcd/server.cert$#\1/etc/kubernetes/pki/etcd/server.crt#' /etc/kubernetes/manifests/etcd.yaml
    grep -qE -- '- --cert-file=/etc/kubernetes/pki/etcd/server.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
    ;;
  key-file)
    sed -i -E 's#^([[:space:]]*- --key-file=)/etc/kubernetes/pki/etcd/server.pem$#\1/etc/kubernetes/pki/etcd/server.key#' /etc/kubernetes/manifests/etcd.yaml
    grep -qE -- '- --key-file=/etc/kubernetes/pki/etcd/server.key$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
    ;;
  trusted-ca-file)
    sed -i -E 's#^([[:space:]]*- --trusted-ca-file=)/etc/kubernetes/pki/etcd/ca.pem$#\1/etc/kubernetes/pki/etcd/ca.crt#' /etc/kubernetes/manifests/etcd.yaml
    grep -qE -- '- --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
    ;;
  *) echo "unknown flag ${Q1_ETCD_FILE}" >&2; exit 1 ;;
esac
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=apiserver-authz-mode -->
#### API server authorization mode is misspelled (`apiserver-authz-mode`)

`--authorization-mode` in `/etc/kubernetes/manifests/kube-apiserver.yaml` is `Node,RABC`. The API server rejects the unknown mode at startup and exits, so kubectl gets `connection refused`. `crictl logs` of the last kube-apiserver container names the bad value. Set it back to `Node,RBAC`.

```bash
sed -i -E 's#^([[:space:]]*- --authorization-mode=)Node,RABC$#\1Node,RBAC#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --authorization-mode=Node,RBAC$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=apiserver-probe-port -->
#### The API server's liveness and startup probes check the wrong port (`apiserver-probe-port`)

The `livenessProbe` and `startupProbe` of `/etc/kubernetes/manifests/kube-apiserver.yaml` check port `6444`, where nothing listens. The API server itself is fine, so kubectl works at first and the logs are clean; but the startup probe never passes, the Pod never turns Ready, and after about four minutes the kubelet kills the container and starts it again, over and over. The evidence is in the kubelet, not the component: `kubectl -n kube-system describe pod kube-apiserver-controlplane` lists `Unhealthy` events for probes to `:6444`, and `crictl ps -a` shows the restarts. Point both probes back at the port the readiness probe uses (`probe-port`, 6443).

```bash
orig="$(cat "/var/tmp/cka-q1.probe-port")"
for probe in livenessProbe startupProbe; do
  sed -i -E '/^    '"$probe"':$/,/^    [a-zA-Z]/ s/^([[:space:]]+port: )6444$/\1'"$orig"'/' /etc/kubernetes/manifests/kube-apiserver.yaml
done
! grep -qE '^[[:space:]]+port: 6444$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not restore the probes" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=apiserver-manifest-copy -->
#### A second copy of the API server manifest (`apiserver-manifest-copy`)

`/etc/kubernetes/manifests` holds `kube-apiserver-new.yaml`, an edited copy of the API server manifest with the Pod name `kube-apiserver-new`. The kubelet runs every manifest in that directory, so it starts a second API server, which cannot bind `6443` ("address already in use") and crash-loops as `kube-apiserver-new-controlplane`; kubectl still works through the first one. Static Pods are not deleted with kubectl: remove the extra file (keep backups outside `/etc/kubernetes/manifests`).

```bash
rm -f /etc/kubernetes/manifests/kube-apiserver-new.yaml
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=etcd-restore-half-done -->
#### Half-finished etcd restore: etcd starts on an empty data directory (`etcd-restore-half-done`)

Someone restored an etcd snapshot into `/var/lib/etcd-restore` and then changed only `--data-dir` in `/etc/kubernetes/manifests/etcd.yaml`. But etcd runs in a container, and `--data-dir` is a path inside it: the `etcd-data` volume still mounts the host's `/var/lib/etcd` at `/var/lib/etcd`, so `/var/lib/etcd-restore` is an empty directory in the container and etcd starts a brand-new, empty cluster. The API answers, but everything is gone: namespaces, Deployments, and the kubeadm RoleBinding that makes `admin.conf` an admin, so kubectl says `Forbidden` (`/etc/kubernetes/super-admin.conf` still works). The kubelets then stop the Pods the API no longer lists.

Finish the restore the kubeadm way: keep `--data-dir=/var/lib/etcd` and point the `etcd-data` volume's `hostPath` at `/var/lib/etcd-restore`. Once etcd has restarted on the restored data, restart the API server too (`crictl stop` its container; the kubelet starts a new one), so it does not serve what it cached from the empty etcd.

```bash
old="$(crictl ps --name '^etcd$' -q | head -1)"
sed -i -E 's#^([[:space:]]*- --data-dir=)/var/lib/etcd-restore$#\1/var/lib/etcd#' /etc/kubernetes/manifests/etcd.yaml
grep -qE -- '- --data-dir=/var/lib/etcd$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
sed -i -E 's#^([[:space:]]*path: )/var/lib/etcd$#\1/var/lib/etcd-restore#' /etc/kubernetes/manifests/etcd.yaml
grep -qE -- 'path: /var/lib/etcd-restore$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
for _ in $(seq 1 60); do
  new="$(crictl ps --name '^etcd$' -q | head -1)"
  [[ -n "$new" && "$new" != "$old" ]] && break
  sleep 2
done
crictl ps --name kube-apiserver -q | xargs -r crictl stop
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=apiserver-etcd-port -->
#### API server talks to the etcd peer port (`apiserver-etcd-port`)

`--etcd-servers` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at port `2380`, etcd's peer port, instead of the client port `2379`. The API server cannot reach its storage and keeps exiting, so kubectl fails. `crictl logs` of the kube-apiserver container shows the etcd connection errors; `--listen-client-urls` in `etcd.yaml` shows the right port.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-servers=https://127.0.0.1):2380$#\1:2379#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-servers=https://127.0.0.1:2379$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
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

<!-- fault Q1_FAULT_2=apiserver-manifest-removed -->
#### API server static Pod manifest is missing (`apiserver-manifest-removed`)

`/etc/kubernetes/manifests/kube-apiserver.yaml` was moved aside, so the kubelet no longer runs the API server and nothing listens on `6443`. `ls /etc/kubernetes/manifests` is missing the file; a copy sits in `/var/tmp/cka-kube-apiserver.yaml`. Put it back.

```bash
mv /var/tmp/cka-kube-apiserver.yaml /etc/kubernetes/manifests/kube-apiserver.yaml
[[ -f /etc/kubernetes/manifests/kube-apiserver.yaml ]]
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
sed -i -E 's#^([[:space:]]*- --advertise-address=).*$#\1'"$addr"'#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --advertise-address='"$addr"'$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not restore advertise-address" >&2; exit 1; }
```
<!-- /fault -->

### Question 2: Access for ${Q2_SA}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: ServiceAccount
metadata:
  name: "${Q2_SA}"
  namespace: "${Q2_NS}"
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: "${Q2_SA}-reader"
  namespace: "${Q2_NS}"
rules:
  - apiGroups:
      - ""
    resources:
      - "${Q2_RESOURCE}"
    verbs:
      - get
      - list
      - watch
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: "${Q2_SA}-reader"
  namespace: "${Q2_NS}"
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: "${Q2_SA}-reader"
subjects:
  - kind: ServiceAccount
    name: "${Q2_SA}"
    namespace: "${Q2_NS}"
EOF
```

### Question 3: Pods of ${Q3_APP} keep restarting

**The healthy setup**

- `2` replicas of `nginx:1.27-alpine`, container `web` on port `80`, no command override
- requests `50m` CPU and `32Mi` memory; limits `250m` CPU and `128Mi` memory
- readiness and liveness probes doing an HTTP GET of `/` on port `80`, with timing that suits how fast nginx starts

This run's fault: **`${Q3_FAULT}`**.

<!-- fault Q3_FAULT=liveness-port -->
#### Liveness probe on a port nothing listens on (`liveness-port`)

The liveness probe calls port `8080`, where nothing listens, so every probe fails and the kubelet kills a healthy container about every 10 seconds. `describe pod` shows `Liveness probe failed: ... connection refused` and `Killing`. Point the probe at port `80`.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"httpGet":{"path":"/","port":80}}}]}}}}'
```
<!-- /fault -->

<!-- fault Q3_FAULT=liveness-path -->
#### Liveness probe on a path that returns 404 (`liveness-path`)

The liveness probe requests `/healthz`, which nginx answers with 404, so the kubelet restarts the container again and again (`Liveness probe failed: HTTP probe failed with statuscode: 404`). The logs show the 404s too. Probe `/`.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"httpGet":{"path":"/","port":80}}}]}}}}'
```
<!-- /fault -->

<!-- fault Q3_FAULT=liveness-exec -->
#### Exec liveness probe checks a file that never exists (`liveness-exec`)

The liveness probe runs `cat /tmp/healthy`, but nothing in the image ever creates that file, so the probe always fails and the container is killed every few seconds (`Liveness probe failed: cat: can't open '/tmp/healthy'`). Probe something the app really provides, such as an HTTP GET of `/` on port `80`.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe","value":{"httpGet":{"path":"/","port":80},"periodSeconds":5,"failureThreshold":2}}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=liveness-early -->
#### Liveness probe gives up before a slow start finishes (`liveness-early`)

The container waits 20 seconds before nginx starts (its command is part of the app and must stay), but the liveness probe starts after 2 seconds and gives up after two failures, so the kubelet kills the container before it ever serves. The logs are empty; `describe pod` shows `Liveness probe failed ... connection refused` and `Killing`. Give it time to start: a `startupProbe` (for example HTTP GET `/`, `periodSeconds: 5`, `failureThreshold: 12`) holds the liveness probe back until the app answers, or raise `initialDelaySeconds` above 20.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","startupProbe":{"httpGet":{"path":"/","port":80},"periodSeconds":5,"failureThreshold":12}}]}}}}'
```
<!-- /fault -->

<!-- fault Q3_FAULT=nginx-config-error -->
#### nginx configuration from a ConfigMap has a syntax error (`nginx-config-error`)

This time the app itself dies, not the kubelet: the container mounts ConfigMap `${Q3_APP}-nginx` at `/etc/nginx/conf.d`, and its `default.conf` misses the `;` after `listen 80`. nginx refuses the file and exits, so the Pods go into `CrashLoopBackOff` with no probe failures in the Events. `kubectl -n ${Q3_NS} logs <pod> --previous` shows the `[emerg]` line with the file and line number. Fix the ConfigMap (`kubectl -n ${Q3_NS} edit configmap ${Q3_APP}-nginx`) and restart the Deployment so the Pods read it at once.

```bash
printf '%s\n' 'server {' '    listen 80;' '    location / {' '        root /usr/share/nginx/html;' '        index index.html;' '    }' '}' > "/var/tmp/cka-q3.default.conf"
kubectl -n "${Q3_NS}" create configmap "${Q3_APP}-nginx" --from-file=default.conf="/var/tmp/cka-q3.default.conf" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${Q3_NS}" rollout restart "deployment/${Q3_APP}"
```
<!-- /fault -->

<!-- fault Q3_FAULT=oom-limit -->
#### Memory limit too low (OOMKilled) (`oom-limit`)

The memory limit is `4Mi`, less than nginx needs to start, so the kernel kills it: `describe pod` shows `Last State: Terminated, Reason: OOMKilled` (exit code 137) and the restart count climbs. Give the container a realistic limit, such as the `128Mi` it had (request `32Mi`).

```bash
kubectl -n "${Q3_NS}" set resources "deployment/${Q3_APP}" -c web --requests=memory=32Mi --limits=memory=128Mi
```
<!-- /fault -->

### Question 4: Document and use a custom field

```bash
kubectl explain databases.spec.backup.schedule > /opt/course/crd/schedule.txt
kubectl create namespace ${Q4_NS} --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f - <<EOF
apiVersion: db.example.lab/v1
kind: Database
metadata:
  name: reports
  namespace: ${Q4_NS}
spec:
  replicas: 3
  backup:
    schedule: "0 2 * * *"
EOF
```

### Question 5: Name resolution broken

**The healthy setup**

- CoreDNS (Deployment `kube-system/coredns`) runs `2` ready replicas behind Service `kube-dns` (`10.96.0.10`), port `53` to container port `53`
- its ConfigMap `coredns` holds key `Corefile`, which serves `cluster.local` and forwards other names to `/etc/resolv.conf`
- ClusterRoleBinding `system:coredns` lets ServiceAccount `kube-system:coredns` watch Services, EndpointSlices and Namespaces
- Pod `${Q5_CLIENT}` uses the default `dnsPolicy` (`ClusterFirst`)

This run's fault: **`${Q5_FAULT}`**.

<!-- fault Q5_FAULT=corefile-typo -->
#### Corefile typo crashes CoreDNS (`corefile-typo`)

The Corefile says `forwrd` instead of `forward`. CoreDNS keeps a running config when a reload fails, but once its Pods restart they exit with "Unknown directive 'forwrd'" and crash-loop, so nothing answers DNS. Fix the word in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forwrd \. /etc/resolv\.conf#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q5_FAULT=scaled-to-zero -->
#### CoreDNS scaled to zero (`scaled-to-zero`)

Deployment `coredns` has `0` replicas, so Service `kube-dns` has no endpoints and every lookup times out. Scale it back to `2`.

```bash
kubectl -n kube-system scale deployment/coredns --replicas=2
```
<!-- /fault -->

<!-- fault Q5_FAULT=cluster-domain -->
#### Wrong cluster domain in the Corefile (`cluster-domain`)

The `kubernetes` plugin serves `cluster.lab` instead of `cluster.local`. CoreDNS runs fine, but it forwards every `*.cluster.local` name upstream, which answers NXDOMAIN. Set the zone back to `cluster.local` in ConfigMap `coredns`.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#kubernetes cluster\.lab #kubernetes cluster.local #' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'kubernetes cluster\.local ' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q5_FAULT=kube-dns-selector -->
#### kube-dns Service selects no Pod (`kube-dns-selector`)

Service `kube-dns` selects `k8s-app=kube-dns-v2`, which no Pod carries. CoreDNS is healthy, but 10.96.0.10 has no endpoints, so lookups time out. Set the selector back to `k8s-app=kube-dns`.

```bash
kubectl -n kube-system patch service kube-dns -p '{"spec":{"selector":{"k8s-app":"kube-dns"}}}'
```
<!-- /fault -->

<!-- fault Q5_FAULT=client-dns-policy -->
#### Client Pod bypasses the cluster DNS (`client-dns-policy`)

Pod `${Q5_CLIENT}` has `dnsPolicy: Default`, so it inherits the node's resolv.conf: no cluster nameserver and no cluster search domains. The field cannot be changed on a running Pod; recreate `${Q5_CLIENT}` without it (the default is `ClusterFirst`).

```bash
kubectl -n "${Q5_NS}" delete pod "${Q5_CLIENT}" --ignore-not-found --wait=true >/dev/null
kubectl -n "${Q5_NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q5_CLIENT}"'"},"spec":{"containers":[{"name":"shell","image":"busybox:1.36","command":["sleep","infinity"]}]}}'
if ! kubectl -n "${Q5_NS}" wait --for=condition=Ready "pod/${Q5_CLIENT}" --timeout=180s; then
  kubectl -n "${Q5_NS}" describe "pod/${Q5_CLIENT}" >&2 || true
  exit 1
fi
```
<!-- /fault -->

<!-- fault Q5_FAULT=corefile-loop -->
#### CoreDNS forwards to itself (`corefile-loop`)

The Corefile says `forward . 127.0.0.1`, so CoreDNS forwards unknown names to itself. The `loop` plugin spots its own probe coming back, logs "Loop (127.0.0.1:...) detected" and exits, so the Pods crash-loop. Set `forward . /etc/resolv.conf` again in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forward \. 127\.0\.0\.1#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q5_FAULT=coredns-rbac -->
#### CoreDNS lost its RBAC binding (`coredns-rbac`)

ClusterRoleBinding `system:coredns` is gone, so the CoreDNS service account may not list Services, EndpointSlices or Namespaces. New Pods log "forbidden" and "plugin/ready: Still waiting on: kubernetes", never become ready, and Service `kube-dns` has no endpoints. Bind ClusterRole `system:coredns` to service account `kube-system:coredns` again and restart the Deployment.

```bash
kubectl create clusterrolebinding system:coredns --clusterrole=system:coredns --serviceaccount=kube-system:coredns
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q5_FAULT=kube-dns-target-port -->
#### kube-dns Service targets the wrong port (`kube-dns-target-port`)

Ports `dns` and `dns-tcp` of Service `kube-dns` have `targetPort: 5353`. CoreDNS is healthy and the Service has endpoints, but nothing listens on 5353, so lookups time out. Compare `kubectl -n kube-system get endpointslices -l k8s-app=kube-dns` with the container ports, and set both target ports back to `53`.

```bash
kubectl -n kube-system get service kube-dns -o yaml | sed -E 's/targetPort: 5353$/targetPort: 53/' | kubectl replace -f - >/dev/null
[ "$(kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.ports[*].targetPort}' | tr ' ' '\n' | grep -cx 53)" = 2 ] || { echo "could not edit Service kube-dns" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q5_FAULT=corefile-key -->
#### Corefile key renamed in the ConfigMap (`corefile-key`)

ConfigMap `coredns` holds the config under key `corefile`, but the Deployment mounts key `Corefile`. New Pods stay in `ContainerCreating` and `kubectl describe` shows "configmap references non-existent config key: Corefile". Rename the key back to `Corefile` and restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's/^  corefile: /  Corefile: /' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -q kubernetes || { echo "could not rename the Corefile key" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q5_FAULT=coredns-image -->
#### CoreDNS image tag does not exist (`coredns-image`)

Deployment `coredns` runs an image tag that does not exist (`v0.0.0`), so its Pods are stuck in `ErrImagePull`/`ImagePullBackOff` and Service `kube-dns` has no ready endpoints. `kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows the failed pull. Set the image back to the tag the control plane uses (`kubeadm config images list` shows it), e.g. `kubectl -n kube-system set image deployment/coredns coredns=registry.k8s.io/coredns/coredns:<tag>`.

```bash
kubectl -n kube-system set image deployment/coredns coredns="$(cat "/var/tmp/cka-q5.image")"
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q5.strategy")}}" >/dev/null
```
<!-- /fault -->

<!-- fault Q5_FAULT=coredns-config-volume -->
#### CoreDNS mounts a ConfigMap that does not exist (`coredns-config-volume`)

Volume `config-volume` of Deployment `coredns` refers to ConfigMap `coredns-custom`, which does not exist. The new Pods stay in `ContainerCreating` with "configmap \"coredns-custom\" not found" in `kubectl describe`. Point the volume back at ConfigMap `coredns`.

```bash
kubectl -n kube-system patch deployment coredns --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"coredns"}]'
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q5.strategy")}}" >/dev/null
```
<!-- /fault -->

<!-- fault Q5_FAULT=coredns-memory-limit -->
#### CoreDNS memory limit too small (`coredns-memory-limit`)

Deployment `coredns` limits the container to `8Mi` of memory, so CoreDNS is OOMKilled as it starts and its Pods crash-loop (`kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows `OOMKilled`). Restore the kubeadm defaults: memory limit `170Mi`, request `70Mi`.

```bash
kubectl -n kube-system set resources deployment/coredns -c coredns --limits=memory=170Mi --requests=memory=70Mi
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q5.strategy")}}" >/dev/null
```
<!-- /fault -->

<!-- fault Q5_FAULT=coredns-hosts-plugin -->
#### Corefile hosts plugin maps web to loopback (`coredns-hosts-plugin`)

The Corefile injects a `hosts` block that maps `web` — and the search-expanded names the resolver actually asks for first, such as `web.<namespace>.svc.cluster.local` — to `127.0.0.1`, so name resolution returns loopback instead of the Service IP while CoreDNS stays Ready. Remove that `hosts` block from ConfigMap `coredns` and restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' > /tmp/cka-Corefile
python3 -c 'import re; from pathlib import Path; t=Path("/tmp/cka-Corefile").read_text(); t=re.sub(r"hosts \{[^}]*\}\s*", "", t, count=1); Path("/tmp/cka-Corefile").write_text(t)'
kubectl -n kube-system create configmap coredns --from-file=Corefile=/tmp/cka-Corefile -o yaml --dry-run=client | kubectl -n kube-system apply -f - >/dev/null
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q5_FAULT=coredns-ready-port -->
#### CoreDNS readiness probe hits the wrong port (`coredns-ready-port`)

The CoreDNS readiness probe targets port `8182`, but the `ready` plugin listens on `8181`, so Pods never become Ready and Service `kube-dns` has no endpoints. Point the probe back at `8181`.

```bash
kubectl -n kube-system patch deployment coredns --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":8181}]'
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q5.strategy")}}" >/dev/null
```
<!-- /fault -->

### Question 6: CronJob ${Q6_APP} never succeeds

**The healthy setup**

- schedule `* * * * *` (every minute), not suspended
- each Job retries a failed Pod up to `2` times (`backoffLimit: 2`) and has no time limit
- container `report` runs image `busybox:1.36` with the command `sh -c "date; sleep 8; echo report done"`

This run's fault: **`${Q6_FAULT}`**.

<!-- fault Q6_FAULT=suspended -->
#### CronJob suspended (`suspended`)

The CronJob has `suspend: true`, so it never creates a Job: `kubectl get cronjob` shows `SUSPEND True` and no `LAST SCHEDULE`. Set `suspend: false`.

```bash
kubectl -n "${Q6_NS}" patch cronjob "${Q6_APP}" --type=merge -p '{"spec":{"suspend":false}}'
```
<!-- /fault -->

<!-- fault Q6_FAULT=deadline -->
#### Job time limit shorter than the work (`deadline`)

Each Job has `activeDeadlineSeconds: 3`, but the command sleeps 8 seconds, so every Job is killed and marked failed with reason `DeadlineExceeded` (`kubectl describe job`). Remove the deadline.

```bash
kubectl -n "${Q6_NS}" patch cronjob "${Q6_APP}" --type=json -p '[{"op":"remove","path":"/spec/jobTemplate/spec/activeDeadlineSeconds"}]'
```
<!-- /fault -->

<!-- fault Q6_FAULT=backoff-zero-command -->
#### Job command fails and is never retried (`backoff-zero-command`)

The command runs `ech` instead of `echo`, so the container exits with code 127 (`kubectl logs` shows `sh: ech: not found`), and `backoffLimit: 0` fails the Job on the first error. Fix the command and set `backoffLimit` back to `2`.

```bash
kubectl -n "${Q6_NS}" patch cronjob "${Q6_APP}" --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/backoffLimit","value":2},{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/command/2","value":"date; sleep 8; echo report done"}]'
```
<!-- /fault -->

<!-- fault Q6_FAULT=image-registry -->
#### Image from a registry that does not exist (`image-registry`)

The image is `registry.invalid/busybox:1.36`, a registry host that does not resolve. The Jobs are created, but their Pods sit in `ErrImagePull` / `ImagePullBackOff` and never finish. Set the image back to `busybox:1.36`; the stuck Jobs can be deleted.

```bash
kubectl -n "${Q6_NS}" patch cronjob "${Q6_APP}" --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/image","value":"busybox:1.36"}]'
```
<!-- /fault -->

<!-- fault Q6_FAULT=concurrency-forbid-stuck -->
#### A hung Job blocks every run under concurrencyPolicy Forbid (`concurrency-forbid-stuck`)

The CronJob itself looks right, but `kubectl -n ${Q6_NS} get cronjob ${Q6_APP}` shows `ACTIVE 1` and a `LAST SCHEDULE` that does not move: one Job, started from an earlier version of the template, runs `sleep 100000` and never ends (`kubectl -n ${Q6_NS} get jobs` and its Pod's logs show it waiting). With `concurrencyPolicy: Forbid`, the CronJob skips every run while a Job is still active, and it has no time limit. Delete the hung Job; the next run starts within a minute. (`Replace` would also do it, by killing the old Job at the next run.)

```bash
kubectl -n "${Q6_NS}" delete job "$(kubectl -n "${Q6_NS}" get cronjob "${Q6_APP}" -o jsonpath='{.status.active[0].name}')"
```
<!-- /fault -->

### Question 7: Deployment ${Q7_APP} not running

**The healthy setup**

- `2` replicas of image `nginx:1.27-alpine`, container `web`
- requests `100m` CPU and `64Mi` memory, and no limits
- no affinity, nodeSelector or topology spread constraint, and the default priority
- nothing else in `${Q7_NS}` takes the capacity those Pods need or keeps them off the workers

This run's fault: **`${Q7_FAULT}`**.

<!-- fault Q7_FAULT=memory-hog -->
#### Other Deployments request nearly all the memory of each worker (`memory-hog`)

Deployments `warmup-1` and `warmup-2` in `${Q7_NS}` each pin a Pod to one worker and request almost all of the memory that worker has left, so neither worker can fit a `${Q7_APP}` Pod's `64Mi`. `kubectl -n ${Q7_NS} describe pod <pending-pod>` says `Insufficient memory`; `kubectl describe node` shows the memory requests near 100% under Allocated resources, and `kubectl get pods -A -o wide` shows whose Pods those are. The spec keeps `${Q7_APP}`'s requests, and the task lets you change what stands in the way: scale the `warmup` Deployments down (or lower their requests).

```bash
kubectl -n "${Q7_NS}" scale deployment -l role=cache --replicas=0
```
<!-- /fault -->

<!-- fault Q7_FAULT=agent-anti-affinity -->
#### Required anti-affinity against Pods that run on every worker (`agent-anti-affinity`)

The Pod template says `${Q7_APP}` must never share a node with a Pod labelled `tier=infra` (required `podAntiAffinity`, `topologyKey: kubernetes.io/hostname`). DaemonSet `log-agent` runs a `tier=infra` Pod on every worker, so no node qualifies and the Pods stay `Pending` with "didn't match pod anti-affinity rules". The spec wants no affinity: remove `podAntiAffinity` from the template (the agent itself is fine).

```bash
kubectl -n "${Q7_NS}" patch deployment "${Q7_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/affinity/podAntiAffinity"}]'
```
<!-- /fault -->

<!-- fault Q7_FAULT=node-affinity -->
#### Required node affinity matches no node (`node-affinity`)

The Pod template requires nodes labelled `disktype=ssd`, and no node has that label, so the Pods stay Pending with "didn't match Pod's node affinity/selector". The spec allows any node: remove the affinity.

```bash
kubectl -n "${Q7_NS}" patch deployment "${Q7_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/affinity"}]'
```
<!-- /fault -->

<!-- fault Q7_FAULT=priority-class -->
#### Unknown PriorityClass (`priority-class`)

The Pod template asks for PriorityClass `critical-batch`, which does not exist, so the ReplicaSet's creates fail with "no PriorityClass with name critical-batch was found". The spec wants the default priority: remove `priorityClassName`.

```bash
kubectl -n "${Q7_NS}" patch deployment "${Q7_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/priorityClassName"}]'
```
<!-- /fault -->

<!-- fault Q7_FAULT=topology-spread-zone -->
#### Topology spread requires a zone label no node has (`topology-spread-zone`)

The Pod template sets a topology spread constraint on `topology.kubernetes.io/zone` with `whenUnsatisfiable: DoNotSchedule`, but no node carries that label, so Pods stay Pending. The spec allows any node: remove `topologySpreadConstraints` (or switch `topologyKey` to a label that exists, such as `kubernetes.io/hostname`).

```bash
kubectl -n "${Q7_NS}" patch deployment "${Q7_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/topologySpreadConstraints"}]'
```
<!-- /fault -->

### Question 8: Node drain is stuck

**The healthy setup**

- PodDisruptionBudget `${Q8_APP}-pdb` lets one of the `2` replicas be evicted at a time (`minAvailable: 1`)
- the Pod template of `${Q8_APP}` prefers the maintenance worker but does not require it, and allows two replicas on one node
- `kubectl drain` always needs `--ignore-daemonsets` (calico-node and kube-proxy run everywhere), `--delete-emptydir-data` for Pods with an `emptyDir` volume, and `--force` for Pods that no controller manages

This run broke 2 things on `${Q8_NODE}`: **`${Q8_FAULT}`**, **`${Q8_FAULT_2}`**. Fix them in the order below.

**Problem 1: the PodDisruptionBudget**

<!-- fault Q8_FAULT=pdb-min-available -->
#### PDB minAvailable equals the replica count (`pdb-min-available`)

PodDisruptionBudget `${Q8_APP}-pdb` sets `minAvailable: 2` while `${Q8_APP}` has 2 replicas, so it allows no disruption at all: `kubectl drain` retries "Cannot evict pod as it would violate the pod's disruption budget" until it gives up (`kubectl -n ${Q8_NS} get pdb` shows ALLOWED DISRUPTIONS 0). Lower `minAvailable` to `1`, then drain: `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data --force`.

```bash
kubectl -n "${Q8_NS}" patch pdb "${Q8_APP}-pdb" --type=merge -p '{"spec":{"minAvailable":1}}'
```
<!-- /fault -->

<!-- fault Q8_FAULT=pdb-max-unavailable-0 -->
#### PDB maxUnavailable is zero (`pdb-max-unavailable-0`)

PodDisruptionBudget `${Q8_APP}-pdb` sets `maxUnavailable: 0`: no Pod of `${Q8_APP}` may ever be evicted, so the drain retries until it gives up (ALLOWED DISRUPTIONS 0). Allow one: `maxUnavailable: 1` (or `minAvailable: 1`), then drain the worker.

```bash
kubectl -n "${Q8_NS}" patch pdb "${Q8_APP}-pdb" --type=merge -p '{"spec":{"maxUnavailable":1}}'
```
<!-- /fault -->

**Problem 2: Pods drain will not remove by default**

<!-- fault Q8_FAULT_2=bare-pod -->
#### A Pod without a controller runs on the worker (`bare-pod`)

Pod `${Q8_APP}-debug` was started by hand with `kubectl run`: no ReplicaSet, Job or other controller owns it. `kubectl drain` refuses to remove such Pods, because nothing would recreate them ("cannot delete Pods that declare no controller (use --force to override)"). Nothing needs fixing in the cluster: drain with `--force`, which deletes it (or delete it yourself first).
<!-- /fault -->

<!-- fault Q8_FAULT_2=emptydir-pod -->
#### The replicas keep scratch data in an emptyDir volume (`emptydir-pod`)

The `${Q8_APP}` Pods mount an `emptyDir` volume, whose data is lost when a Pod leaves its node. `kubectl drain` will not evict them unless told that is acceptable ("cannot delete Pods with local storage (use --delete-emptydir-data to override)"). Scratch data may go: drain with `--delete-emptydir-data`.
<!-- /fault -->

### Question 9: Token for a ServiceAccount

```bash
kubectl -n ${Q9_NS} create token ci --duration=1h > /opt/course/token/ci.token
```

### Question 10: New workloads never start

**The healthy setup**

- `kube-scheduler` and `kube-controller-manager` run as static Pods from `/etc/kubernetes/manifests`, with the commands, flags, kubeconfigs, keys and images kubeadm wrote

This run's fault: **`${Q10_FAULT}`**.

<!-- fault Q10_FAULT=scheduler-missing-file -->
#### A scheduler flag points at a file that does not exist (`scheduler-missing-file`)

In this run the scheduler's `--${Q10_SCHEDULER_FILE}` flag in `/etc/kubernetes/manifests/kube-scheduler.yaml` names a file that does not exist, so the scheduler exits at startup and the new `web` Pods stay `Pending` with no scheduling events. `kubectl -n kube-system logs kube-scheduler-controlplane` (or `crictl logs`) names the file. The two ways this fault breaks the scheduler:

- `--kubeconfig` points at `/etc/kubernetes/scheduler.config`; `ls /etc/kubernetes` shows the real `scheduler.conf`
- an added `--config=/etc/kubernetes/sched-config.yaml`, a scheduler configuration that was never written: remove the flag (kubeadm's scheduler needs no `--config`), or write the file

```bash
case "${Q10_SCHEDULER_FILE}" in
  kubeconfig)
    sed -i -E 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/scheduler)\.config$#\1.conf#' /etc/kubernetes/manifests/kube-scheduler.yaml
    grep -qE -- '- --kubeconfig=/etc/kubernetes/scheduler.conf$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
    ;;
  config)
    sed -i -E '\#^[[:space:]]*- --config=/etc/kubernetes/sched-config.yaml$#d' /etc/kubernetes/manifests/kube-scheduler.yaml
    ! grep -qE -- '- --config=' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not remove scheduler --config" >&2; exit 1; }
    ;;
esac
```
<!-- /fault -->

<!-- fault Q10_FAULT=controller-manager-missing-file -->
#### A controller manager flag points at a file that does not exist (`controller-manager-missing-file`)

In this run `--${Q10_CM_FILE}` in `/etc/kubernetes/manifests/kube-controller-manager.yaml` names a file that does not exist. The controller manager exits at startup, so `web` is scaled to 2 but no ReplicaSet creates Pods: `kubectl get deploy` shows 0 of 2 and there are no Pods at all, which tells it apart from a broken scheduler (Pods that stay `Pending`). Its logs name the missing file. Every flag this fault can break:

- `--kubeconfig`: `/etc/kubernetes/controller-manager.conf` (broken: `/etc/kubernetes/controller-manager.config`)
- `--service-account-private-key-file`: `/etc/kubernetes/pki/sa.key` (broken: `/etc/kubernetes/pki/sa.pem`)

```bash
case "${Q10_CM_FILE}" in
  kubeconfig)
    sed -i -E 's#^([[:space:]]*- --kubeconfig=)/etc/kubernetes/controller-manager.config$#\1/etc/kubernetes/controller-manager.conf#' /etc/kubernetes/manifests/kube-controller-manager.yaml
    grep -qE -- '- --kubeconfig=/etc/kubernetes/controller-manager.conf$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
    ;;
  service-account-private-key-file)
    sed -i -E 's#^([[:space:]]*- --service-account-private-key-file=)/etc/kubernetes/pki/sa.pem$#\1/etc/kubernetes/pki/sa.key#' /etc/kubernetes/manifests/kube-controller-manager.yaml
    grep -qE -- '- --service-account-private-key-file=/etc/kubernetes/pki/sa.key$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
    ;;
  *) echo "unknown flag ${Q10_CM_FILE}" >&2; exit 1 ;;
esac
```
<!-- /fault -->

<!-- fault Q10_FAULT=scheduler-command -->
#### Typo in the scheduler command (`scheduler-command`)

The command in `/etc/kubernetes/manifests/kube-scheduler.yaml` runs `kube-schedular`, a binary that does not exist, so the scheduler never starts and new Pods stay `Pending` with no events. `kubectl -n kube-system describe pod kube-scheduler-controlplane` shows the failing command.

```bash
sed -i -E 's#^([[:space:]]*)- kube-schedular$#\1- kube-scheduler#' /etc/kubernetes/manifests/kube-scheduler.yaml
grep -qE -- '- kube-scheduler$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q10_FAULT=scheduler-image-tag -->
#### Scheduler image tag does not exist (`scheduler-image-tag`)

The image in `/etc/kubernetes/manifests/kube-scheduler.yaml` has tag `v0.0.0`, which does not exist. The kubelet cannot pull it (`ErrImagePull` in `kubectl -n kube-system describe pod kube-scheduler-controlplane`, or `crictl ps -a` shows no scheduler), so new Pods stay `Pending`. Use the same tag as the other control plane images (`grep image: /etc/kubernetes/manifests/*.yaml`, or `kubeadm config images list`).

```bash
sed -i -E "s#kube-scheduler:v0\.0\.0#$(cat "/var/tmp/cka-q10.scheduler-image")#" /etc/kubernetes/manifests/kube-scheduler.yaml
grep -q 'kube-scheduler:v0\.0\.0' /etc/kubernetes/manifests/kube-scheduler.yaml && { echo "could not restore the scheduler image" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q10_FAULT=scheduler-manifest-removed -->
#### Scheduler static Pod manifest is missing (`scheduler-manifest-removed`)

`/etc/kubernetes/manifests/kube-scheduler.yaml` was moved aside, so the kubelet stops the scheduler and new Pods stay `Pending`. `ls /etc/kubernetes/manifests` is missing the file; restore it from `/var/tmp/cka-kube-scheduler.yaml`.

```bash
mv /var/tmp/cka-kube-scheduler.yaml /etc/kubernetes/manifests/kube-scheduler.yaml
[[ -f /etc/kubernetes/manifests/kube-scheduler.yaml ]]
```
<!-- /fault -->

<!-- fault Q10_FAULT=scheduler-manifest-yaml -->
#### Scheduler manifest is not valid YAML (`scheduler-manifest-yaml`)

The `image:` line in `/etc/kubernetes/manifests/kube-scheduler.yaml` is indented by three spaces instead of four, so the kubelet cannot parse the manifest and drops the scheduler Pod. New `web` Pods stay `Pending`. `journalctl -u kubelet` reports the bad manifest; fix the indentation.

```bash
sed -i -E 's#^   image: (registry\.k8s\.io/kube-scheduler:)#    image: \1#' /etc/kubernetes/manifests/kube-scheduler.yaml
grep -qE -- '^    image: registry.k8s.io/kube-scheduler:' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q10_FAULT=controller-manager-command -->
#### Typo in the controller manager command (`controller-manager-command`)

The command in `/etc/kubernetes/manifests/kube-controller-manager.yaml` runs `kube-controller-managr`, which does not exist, so the controller manager never starts. The Deployment is scaled but no ReplicaSet creates Pods. Fix the binary name in the manifest.

```bash
sed -i -E 's#^([[:space:]]*)- kube-controller-managr$#\1- kube-controller-manager#' /etc/kubernetes/manifests/kube-controller-manager.yaml
grep -qE -- '- kube-controller-manager$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
```
<!-- /fault -->

### Question 11: Kernel settings on ${Q11_NODE}

```bash
runuser -u ubuntu -- ssh -o StrictHostKeyChecking=accept-new ${Q11_NODE} sudo bash -s <<'CKA_NODE_EOF'
cat > /etc/sysctl.d/k8s.conf <<'EOF'
net.bridge.bridge-nf-call-iptables = 1
net.ipv4.ip_forward = 1
net.netfilter.nf_conntrack_max = 131072
EOF
echo br_netfilter > /etc/modules-load.d/k8s.conf
modprobe br_netfilter
sysctl --system >/dev/null
CKA_NODE_EOF
```

### Question 12: ${Q12_APP} unreachable through the ingress

**The healthy setup**

- Service `${Q12_APP}`: port `80`, forwarding to the `${Q12_APP}` Pods
- Ingress `${Q12_APP}`: class `traefik`, host `www.${Q12_NS}.lab`, path `/` (`Prefix`) to Service `${Q12_APP}` on port `80`
- HTTPRoute `${Q12_APP}`: attached to the `web` listener of Gateway `traefik-gateway` in namespace `traefik`, host `api.${Q12_NS}.lab`, path `/` to Service `${Q12_APP}` on port `80`
- the controller: Deployment `traefik` in namespace `traefik`, its Service publishing the `web` port on NodePort `30080`, and IngressClass `traefik` naming controller `traefik.io/ingress-controller`

This run's fault: **`${Q12_FAULT}`**.

<!-- fault Q12_FAULT=ingress-service-name -->
#### Ingress points at a Service that does not exist (`ingress-service-name`)

The Ingress backend is Service `${Q12_APP}-svc`, which does not exist, so Traefik has nothing to send `www.${Q12_NS}.lab` to. `kubectl describe ingress` shows the missing backend. Point it back at `${Q12_APP}`.

```bash
kubectl -n "${Q12_NS}" patch ingress "${Q12_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"'"${Q12_APP}"'"}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=ingress-service-port -->
#### Ingress uses the wrong Service port (`ingress-service-port`)

The Ingress sends traffic to port `8080` of Service `${Q12_APP}`, which only has port `80`. Set the backend port back to `80`.

```bash
kubectl -n "${Q12_NS}" patch ingress "${Q12_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/port/number","value":80}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=ingress-class -->
#### Ingress asks for a class that does not exist (`ingress-class`)

`ingressClassName` is `nginx`, but the only IngressClass is `traefik` (`kubectl get ingressclass`). No controller claims the Ingress, so it has no address and nothing routes `www.${Q12_NS}.lab`. Set the class back to `traefik`.

```bash
kubectl -n "${Q12_NS}" patch ingress "${Q12_APP}" --type=json -p '[{"op":"replace","path":"/spec/ingressClassName","value":"traefik"}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=ingress-path -->
#### Ingress path matches only one exact page (`ingress-path`)

The Ingress path is `/index.html` with `pathType: Exact`, so only that one URL matches and `/` gets Traefik's 404. Set the path back to `/` with `pathType: Prefix`.

```bash
kubectl -n "${Q12_NS}" patch ingress "${Q12_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"},{"op":"replace","path":"/spec/rules/0/http/paths/0/pathType","value":"Prefix"}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=route-parent -->
#### HTTPRoute attached to a Gateway that does not exist (`route-parent`)

The HTTPRoute's `parentRefs` names Gateway `web-gateway`, which does not exist, so no Gateway accepts the route (its status lists no accepted parent). `kubectl -n traefik get gateway` shows the real name, `traefik-gateway`.

```bash
kubectl -n "${Q12_NS}" patch httproute "${Q12_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/name","value":"traefik-gateway"}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=route-section -->
#### HTTPRoute names a listener the Gateway does not have (`route-section`)

`sectionName: websecure` asks for a listener that `traefik-gateway` does not have; its only listener is `web`. The route's `Accepted` condition is `False` with reason `NoMatchingParent`. Set `sectionName` back to `web`.

```bash
kubectl -n "${Q12_NS}" patch httproute "${Q12_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/sectionName","value":"web"}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=route-backend-port -->
#### HTTPRoute uses the wrong Service port (`route-backend-port`)

The HTTPRoute sends traffic to port `8080` of Service `${Q12_APP}`, which only has port `80`. The route's `ResolvedRefs` condition is `False`. Set the backendRef port back to `80`.

```bash
kubectl -n "${Q12_NS}" patch httproute "${Q12_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=ingress-host-typo -->
#### Ingress rule has a misspelled host (`ingress-host-typo`)

The Ingress rule's host is `ww.${Q12_NS}.lab`, not `www.${Q12_NS}.lab`. Traefik routes only matching Host headers, so `www.${Q12_NS}.lab` gets a 404. `kubectl -n ${Q12_NS} get ingress` shows the host: set it back to `www.${Q12_NS}.lab`.

```bash
kubectl -n "${Q12_NS}" patch ingress "${Q12_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/host","value":"www.'"${Q12_NS}"'.lab"}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=route-parent-namespace -->
#### HTTPRoute looks for the Gateway in its own namespace (`route-parent-namespace`)

The HTTPRoute's `parentRefs` has no `namespace`, so it defaults to the route's own namespace `${Q12_NS}`, where there is no `traefik-gateway`. The route has no accepted parent. Add `namespace: traefik` to the parentRef.

```bash
kubectl -n "${Q12_NS}" patch httproute "${Q12_APP}" --type=json -p '[{"op":"add","path":"/spec/parentRefs/0/namespace","value":"traefik"}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=route-backend-name -->
#### HTTPRoute points at a Service that does not exist (`route-backend-name`)

The HTTPRoute's backendRef is Service `${Q12_APP}-svc`, which does not exist, so `ResolvedRefs` is `False` and `api.${Q12_NS}.lab` fails. Point the backendRef back at `${Q12_APP}`.

```bash
kubectl -n "${Q12_NS}" patch httproute "${Q12_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/name","value":"'"${Q12_APP}"'"}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=route-path-prefix -->
#### HTTPRoute path matches only /api (`route-path-prefix`)

The HTTPRoute only matches path prefix `/api`, so `/` gets Traefik's 404. Remove the `matches` block (or set the path to `/`) so every path on `api.${Q12_NS}.lab` is served.

```bash
kubectl -n "${Q12_NS}" patch httproute "${Q12_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/matches"}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=ingress-path-prefix -->
#### Ingress path matches only /app (`ingress-path-prefix`)

The Ingress path is `/app` with `pathType: Prefix`, so `/` does not match and Traefik returns 404 for `www.${Q12_NS}.lab`. Set the path back to `/`.

```bash
kubectl -n "${Q12_NS}" patch ingress "${Q12_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=route-weight-zero -->
#### HTTPRoute backend weight is zero (`route-weight-zero`)

The HTTPRoute backendRef has `weight: 0`, so Traefik sends it no traffic and `api.${Q12_NS}.lab` fails even though the Service is healthy. Remove the weight (or set it above 0).

```bash
kubectl -n "${Q12_NS}" patch httproute "${Q12_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/backendRefs/0/weight"}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=route-filter-redirect -->
#### HTTPRoute redirects instead of proxying (`route-filter-redirect`)

The HTTPRoute has a `RequestRedirect` filter, so requests for `api.${Q12_NS}.lab` get a 302 to `elsewhere.example` instead of the nginx welcome page. Remove the `filters` block so the route proxies to Service `${Q12_APP}`.

```bash
kubectl -n "${Q12_NS}" patch httproute "${Q12_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/filters"}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=controller-down -->
#### The Traefik controller is scaled to zero (`controller-down`)

Both hosts fail at once, and nothing in `${Q12_NS}` is wrong: Deployment `traefik` in namespace `traefik` has `0` replicas, so nothing listens behind NodePort `30080` (curl gets "connection refused"). Scale it back to `1`.

```bash
kubectl -n traefik scale deployment traefik --replicas=1
```
<!-- /fault -->

<!-- fault Q12_FAULT=controller-nodeport -->
#### The controller's Service moved to another NodePort (`controller-nodeport`)

Traefik runs and every object in `${Q12_NS}` is right, but the `web` port of Service `traefik/traefik` now uses NodePort `30081`, so nothing answers on `30080` (`kubectl -n traefik get svc traefik` shows `80:30081/TCP`). The task's URL uses `30080`: set the `web` port's `nodePort` back to `30080`.

```bash
i=$(kubectl -n traefik get service traefik -o jsonpath='{range .spec.ports[*]}{.name}{"\n"}{end}' | grep -n '^web$' | cut -d: -f1)
kubectl -n traefik patch service traefik --type=json -p '[{"op":"replace","path":"/spec/ports/'"$((i - 1))"'/nodePort","value":30080}]'
```
<!-- /fault -->

<!-- fault Q12_FAULT=ingressclass-controller -->
#### IngressClass traefik names another controller (`ingressclass-controller`)

IngressClass `traefik` now names controller `k8s.io/ingress-nginx`, which does not run here. Traefik only serves Ingresses whose class names `traefik.io/ingress-controller`, so `www.${Q12_NS}.lab` fails while `api.${Q12_NS}.lab` (Gateway API, which uses the GatewayClass) still works. `kubectl get ingressclass traefik -o yaml` shows the controller; the field cannot be edited, so delete the IngressClass and create it again with `controller: traefik.io/ingress-controller`.

```bash
kubectl delete ingressclass traefik --wait=true
kubectl create -f /var/tmp/cka-ingressclass-traefik.json
```
<!-- /fault -->

### Question 13: Canary by request header

```bash
kubectl apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web
  namespace: ${Q13_NS}
spec:
  parentRefs: [{ name: app-gw, sectionName: https }]
  hostnames: [app.${Q13_NS}.lab]
  rules:
    - matches: [{ headers: [{ name: X-Canary, value: always }] }]
      backendRefs: [{ name: web-canary, port: 80 }]
    - backendRefs: [{ name: web, port: 80 }]
EOF
```

### Question 14: Default StorageClass with local-path

```bash
kubectl annotate storageclass standard-static storageclass.kubernetes.io/is-default-class- >/dev/null
kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${Q14_SC}
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: rancher.io/local-path
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
EOF
kubectl create namespace "${Q14_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q14_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q14_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: cache
  namespace: ${Q14_NS}
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: cache-app
  namespace: ${Q14_NS}
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "1d"]
      volumeMounts: [{ name: cache, mountPath: /cache }]
  volumes:
    - name: cache
      persistentVolumeClaim: { claimName: cache }
EOF
kubectl -n ${Q14_NS} wait --for=condition=Ready pod/cache-app --timeout=180s
```

### Question 15: Back up etcd

```bash
mkdir -p "$(dirname "${Q15_BACKUP}")"
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key snapshot save "${Q15_BACKUP}"
mkdir -p "$(dirname "${Q15_STATUS_FILE}")"
ETCDCTL_API=3 etcdctl snapshot status "${Q15_BACKUP}" -w table > "${Q15_STATUS_FILE}"
```

### Question 16: Pods of ${Q16_NS} in order

```bash
kubectl -n ${Q16_NS} get pods --sort-by=.metadata.creationTimestamp --no-headers -o custom-columns=NAME:.metadata.name > /opt/course/sort/pods.txt
kubectl -n ${Q16_NS} get pods --field-selector=status.phase!=Running --no-headers -o custom-columns=NAME:.metadata.name > /opt/course/sort/not-running.txt
```

### Question 17: Pod ${Q17_CLAIM}-app stuck

**The healthy setup**

- PersistentVolume `${Q17_CLAIM}-pv`: StorageClass `manual`, `1Gi`, `ReadWriteOnce`, reclaim `Retain`, hostPath `/srv/${Q17_CLAIM}` on `worker-1`, with required node affinity for the label `storage.cka.lab/${Q17_CLAIM}=data` that `worker-1` carries; `Available` with no stale `claimRef`
- PersistentVolumeClaim `${Q17_CLAIM}` requests `500Mi` with StorageClass `manual` and access mode `ReadWriteOnce`, and binds to `${Q17_CLAIM}-pv`
- Pod `${Q17_CLAIM}-app` (image `busybox:1.36`, command `sleep 1d`) mounts claim `${Q17_CLAIM}` at `/data`, with no nodeSelector: the scheduler follows the volume to `worker-1`

This run's fault: **`${Q17_FAULT}`**.

<!-- fault Q17_FAULT=storageclass-mismatch -->
#### Claim asks for another StorageClass (`storageclass-mismatch`)

The claim asks for StorageClass `fast`, which neither exists nor matches `${Q17_CLAIM}-pv` (`manual`), so it stays `Pending`. Re-create it with `storageClassName: manual`.

```bash
kubectl -n "${Q17_NS}" delete pod "${Q17_CLAIM}-app" --ignore-not-found --wait=true
kubectl -n "${Q17_NS}" delete pvc "${Q17_CLAIM}" --ignore-not-found --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q17_CLAIM}"'","namespace":"'"${Q17_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q17_CLAIM}"'-app","namespace":"'"${Q17_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q17_CLAIM}"'"}}]}}]}'
```
<!-- /fault -->

<!-- fault Q17_FAULT=access-mode-mismatch -->
#### Claim asks for ReadWriteMany (`access-mode-mismatch`)

The claim asks for `ReadWriteMany`, but `${Q17_CLAIM}-pv` only offers `ReadWriteOnce`, so nothing binds. Re-create it with `ReadWriteOnce`.

```bash
kubectl -n "${Q17_NS}" delete pod "${Q17_CLAIM}-app" --ignore-not-found --wait=true
kubectl -n "${Q17_NS}" delete pvc "${Q17_CLAIM}" --ignore-not-found --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q17_CLAIM}"'","namespace":"'"${Q17_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q17_CLAIM}"'-app","namespace":"'"${Q17_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q17_CLAIM}"'"}}]}}]}'
```
<!-- /fault -->

<!-- fault Q17_FAULT=claim-too-large -->
#### Claim larger than the volume (`claim-too-large`)

The claim requests `2Gi` and `${Q17_CLAIM}-pv` holds only `1Gi`, so it can never bind. Re-create it requesting `500Mi` (or anything up to `1Gi`).

```bash
kubectl -n "${Q17_NS}" delete pod "${Q17_CLAIM}-app" --ignore-not-found --wait=true
kubectl -n "${Q17_NS}" delete pvc "${Q17_CLAIM}" --ignore-not-found --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q17_CLAIM}"'","namespace":"'"${Q17_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q17_CLAIM}"'-app","namespace":"'"${Q17_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q17_CLAIM}"'"}}]}}]}'
```
<!-- /fault -->

<!-- fault Q17_FAULT=pv-released-claimref -->
#### PV stuck Released with a stale claimRef (`pv-released-claimref`)

PersistentVolume `${Q17_CLAIM}-pv` is `Released` with reclaim policy `Retain` and still holds a `claimRef` to a deleted PVC. The new claim matches the volume but cannot bind until that `claimRef` is removed (`kubectl patch pv ${Q17_CLAIM}-pv --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'`).

```bash
kubectl patch pv "${Q17_CLAIM}-pv" --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=pod-node-pin -->
#### Pod pinned away from the node that holds the volume (`pod-node-pin`)

The claim is `Bound`, but `${Q17_CLAIM}-pv` is a local volume whose required node affinity only `worker-1` satisfies, while the Pod has `nodeSelector: kubernetes.io/hostname=worker-2`. No node satisfies both, so the Pod stays `Pending` with `volume node affinity conflict` in its Events. Re-create the Pod without the nodeSelector (or pinned to `worker-1`); the volume cannot move.

```bash
kubectl -n "${Q17_NS}" delete pod "${Q17_CLAIM}-app" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q17_CLAIM}"'-app","namespace":"'"${Q17_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q17_CLAIM}"'"}}]}}'
```
<!-- /fault -->

<!-- fault Q17_FAULT=pv-node-label-lost -->
#### The node that holds the data lost the label the volume requires (`pv-node-label-lost`)

The claim is `Bound`, but `${Q17_CLAIM}-pv` may only be used on a node labelled `storage.cka.lab/${Q17_CLAIM}=data`, and no node carries that label any more: the Pod stays `Pending` with `volume node affinity conflict`. The volume's affinity must not change, so put the label back on the node that really holds the data. Which one is that? The volume is a hostPath, `/srv/${Q17_CLAIM}`: look for it on the workers (`ssh worker-1 ls /srv`), and you find it on `worker-1`. `kubectl label node worker-1 storage.cka.lab/${Q17_CLAIM}=data`.

```bash
kubectl label node worker-1 "storage.cka.lab/${Q17_CLAIM}=data" --overwrite
```
<!-- /fault -->

<!-- fault Q17_FAULT=pod-claim-name -->
#### The Pod mounts a claim name that does not exist (`pod-claim-name`)

The claim and the volume are fine and `Bound`, but the Pod's volume refers to claim `${Q17_CLAIM}-data`, which does not exist: the Pod stays `Pending` with "persistentvolumeclaim \"${Q17_CLAIM}-data\" not found". A Pod's volumes cannot be edited: re-create the Pod with `claimName: ${Q17_CLAIM}`.

```bash
kubectl -n "${Q17_NS}" delete pod "${Q17_CLAIM}-app" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q17_CLAIM}"'-app","namespace":"'"${Q17_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q17_CLAIM}"'"}}]}}'
```
<!-- /fault -->

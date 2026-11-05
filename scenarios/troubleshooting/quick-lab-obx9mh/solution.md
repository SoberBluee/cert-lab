## Solution

### Question 1: Control plane after maintenance

**The healthy setup**

- `etcd`, `kube-apiserver`, `kube-controller-manager` and `kube-scheduler` run as static Pods from `/etc/kubernetes/manifests`, with the flags, paths and images kubeadm wrote
- the kubelet on `controlplane` uses `/etc/kubernetes/kubelet.conf` and `staticPodPath: /etc/kubernetes/manifests`

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=apiserver-missing-file -->
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

<!-- fault Q1_FAULT=apiserver-authz-mode -->
#### API server authorization mode is misspelled (`apiserver-authz-mode`)

`--authorization-mode` in `/etc/kubernetes/manifests/kube-apiserver.yaml` is `Node,RABC`. The API server rejects the unknown mode at startup and exits, so kubectl gets `connection refused`. `crictl logs` of the last kube-apiserver container names the bad value. Set it back to `Node,RBAC`.

```bash
sed -i -E 's#^([[:space:]]*- --authorization-mode=)Node,RABC$#\1Node,RBAC#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --authorization-mode=Node,RBAC$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-probe-port -->
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

<!-- fault Q1_FAULT=apiserver-manifest-copy -->
#### A second copy of the API server manifest (`apiserver-manifest-copy`)

`/etc/kubernetes/manifests` holds `kube-apiserver-new.yaml`, an edited copy of the API server manifest with the Pod name `kube-apiserver-new`. The kubelet runs every manifest in that directory, so it starts a second API server, which cannot bind `6443` ("address already in use") and crash-loops as `kube-apiserver-new-controlplane`; kubectl still works through the first one. Static Pods are not deleted with kubectl: remove the extra file (keep backups outside `/etc/kubernetes/manifests`).

```bash
rm -f /etc/kubernetes/manifests/kube-apiserver-new.yaml
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-etcd-port -->
#### API server talks to the etcd peer port (`apiserver-etcd-port`)

`--etcd-servers` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at port `2380`, etcd's peer port, instead of the client port `2379`. The API server cannot reach its storage and keeps exiting, so kubectl fails. `crictl logs` of the kube-apiserver container shows the etcd connection errors; `--listen-client-urls` in `etcd.yaml` shows the right port.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-servers=https://127.0.0.1):2380$#\1:2379#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-servers=https://127.0.0.1:2379$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
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
sed -i -E 's#^([[:space:]]*- --advertise-address=).*$#\1'"$addr"'#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --advertise-address='"$addr"'$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not restore advertise-address" >&2; exit 1; }
```
<!-- /fault -->

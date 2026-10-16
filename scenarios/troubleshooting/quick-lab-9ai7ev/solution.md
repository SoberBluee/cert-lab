## Solution

### Question 1: kubectl stopped working

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=kubeconfig-server-port -->
#### User kubeconfigs point at the wrong port (`kubeconfig-server-port`)

`server:` in `/root/.kube/config` and `/home/ubuntu/.kube/config` uses port `6433` instead of `6443`, so kubectl gets `connection refused` even though the API server is healthy (`curl -k https://127.0.0.1:6443/readyz` answers `ok`). Fix the port in both files, or copy `/etc/kubernetes/admin.conf` over them.

```bash
sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6433$#\1:6443#' /root/.kube/config
grep -qE -- 'server: https://[^[:space:]]+:6443$' /root/.kube/config || { echo "could not modify /root/.kube/config" >&2; exit 1; }
sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6433$#\1:6443#' /home/ubuntu/.kube/config
grep -qE -- 'server: https://[^[:space:]]+:6443$' /home/ubuntu/.kube/config || { echo "could not modify /home/ubuntu/.kube/config" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=kubeconfig-wrong-ca -->
#### User kubeconfigs trust the wrong CA (`kubeconfig-wrong-ca`)

`certificate-authority-data` in both user kubeconfigs holds the front-proxy CA (`/etc/kubernetes/pki/front-proxy-ca.crt`) instead of the cluster CA, so kubectl rejects the API server's certificate: `x509: certificate signed by unknown authority`. Put `/etc/kubernetes/pki/ca.crt` back (`kubectl config set clusters.kubernetes.certificate-authority-data $(base64 -w0 /etc/kubernetes/pki/ca.crt)`), or copy `/etc/kubernetes/admin.conf` over them.

```bash
for f in /root/.kube/config /home/ubuntu/.kube/config; do
  kubectl config --kubeconfig "$f" set clusters.kubernetes.certificate-authority-data "$(base64 -w0 /etc/kubernetes/pki/ca.crt)" >/dev/null
done
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-client-ca -->
#### API server client CA file path is wrong (`apiserver-client-ca`)

`--client-ca-file` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `/etc/kubernetes/pki/ca.cert`, which does not exist, so the API server exits at startup and kubectl gets `connection refused`. `crictl logs` of the last kube-apiserver container shows the missing file; `ls /etc/kubernetes/pki` shows `ca.crt`.

```bash
sed -i -E 's#^([[:space:]]*- --client-ca-file=/etc/kubernetes/pki/ca)\.cert$#\1.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --client-ca-file=/etc/kubernetes/pki/ca.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-secure-port -->
#### API server listens on the wrong port (`apiserver-secure-port`)

`--secure-port` in `/etc/kubernetes/manifests/kube-apiserver.yaml` is `6444`, so nothing answers on `6443`: kubectl, the kubelets and the other components get `connection refused`, and the API server's own probes (which target the `probe-port`, 6443) fail until the kubelet restarts it. `ss -ltnp` shows it listening on 6444. Set the port back to `6443`.

```bash
sed -i -E 's#^([[:space:]]*- --secure-port=)6444$#\16443#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --secure-port=6443$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-manifest-yaml -->
#### API server manifest is not valid YAML (`apiserver-manifest-yaml`)

The `image:` line in `/etc/kubernetes/manifests/kube-apiserver.yaml` is indented by three spaces instead of four, which makes the file invalid YAML. The kubelet cannot parse the manifest, so it drops the kube-apiserver static pod: no container at all in `crictl ps -a`, and `journalctl -u kubelet` reports the manifest it could not decode. Fix the indentation.

```bash
sed -i -E 's#^   image: (registry\.k8s\.io/kube-apiserver:)#    image: \1#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '^    image: registry.k8s.io/kube-apiserver:' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=kubeconfig-current-context -->
#### User kubeconfigs use a context that does not exist (`kubeconfig-current-context`)

`current-context` in both user kubeconfigs is `admin@production`, which is not defined in them, so kubectl fails with "context was not found for specified context". The API server is healthy. `kubectl config get-contexts` lists the real context: switch back with `kubectl config use-context <name>` (as root and as ubuntu).

```bash
for f in /root/.kube/config /home/ubuntu/.kube/config; do
  kubectl config --kubeconfig "$f" use-context "$(kubectl config --kubeconfig "$f" get-contexts -o name | head -1)" >/dev/null
done
```
<!-- /fault -->

<!-- fault Q1_FAULT=kubeconfig-client-key -->
#### User kubeconfigs hold a key that does not match the certificate (`kubeconfig-client-key`)

`client-key-data` of the user in both user kubeconfigs is the key of `/etc/kubernetes/pki/apiserver-kubelet-client.key`, which does not belong to the user's `client-certificate-data`. kubectl fails before it sends anything ("tls: private key does not match public key"). The admin credentials are intact in `/etc/kubernetes/admin.conf`: copy it over `/root/.kube/config` and `/home/ubuntu/.kube/config` (keeping ubuntu as the owner), or copy its `client-key-data` into them.

```bash
cp -a "/var/tmp/cka-q1.kubeconfig-0" /root/.kube/config
cp -a "/var/tmp/cka-q1.kubeconfig-1" /home/ubuntu/.kube/config
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-tls-cert-path -->
#### API server serving certificate path is wrong (`apiserver-tls-cert-path`)

`--tls-cert-file` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `/etc/kubernetes/pki/apiserver.cert`, which does not exist, so the API server cannot load its serving certificate and exits at startup; kubectl gets `connection refused`. `crictl logs` of the last kube-apiserver container names the file, and `ls /etc/kubernetes/pki` shows `apiserver.crt`.

```bash
sed -i -E 's#^([[:space:]]*- --tls-cert-file=/etc/kubernetes/pki/apiserver)\.cert$#\1.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --tls-cert-file=/etc/kubernetes/pki/apiserver.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

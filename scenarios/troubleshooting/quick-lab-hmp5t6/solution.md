## Solution

### Question 1: kubectl stopped working

**The healthy setup**

- `/etc/kubernetes/manifests/kube-apiserver.yaml` keeps the kubeadm flags: secure port `6443`, bind address `0.0.0.0`, and the CA, serving certificate and key from `/etc/kubernetes/pki`
- both user kubeconfigs match `/etc/kubernetes/admin.conf`: server `https://<controlplane-ip>:6443`, the cluster CA, a matching client certificate and key, a current context that exists, and readable file permissions

This run broke 2 things: **`${Q1_FAULT}`**, **`${Q1_FAULT_2}`**. Fix them in the order below.

**Problem 1: the user kubeconfigs**

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

<!-- fault Q1_FAULT=kubeconfig-server-host -->
#### User kubeconfigs name an API host that no longer exists (`kubeconfig-server-host`)

`server:` in both user kubeconfigs is `https://controlplane-old:6443`, a name left over from before the node was renamed. Nothing resolves it, so kubectl fails with "no such host" while the API server is healthy (`curl -k https://127.0.0.1:6443/readyz`). Restore the real `server:` from `/etc/kubernetes/admin.conf`, or copy that file over the kubeconfigs.

```bash
cp -a "/var/tmp/cka-q1.kubeconfig-0" /root/.kube/config
cp -a "/var/tmp/cka-q1.kubeconfig-1" /home/ubuntu/.kube/config
```
<!-- /fault -->

<!-- fault Q1_FAULT=kubeconfig-permissions -->
#### ubuntu's kubeconfig is owned by root and unreadable for ubuntu (`kubeconfig-permissions`)

`/home/ubuntu/.kube/config` belongs to `root` with mode `600`, as happens after `sudo cp /etc/kubernetes/admin.conf ~/.kube/config` without the `chown` kubeadm prints. kubectl as root works; as ubuntu it fails with "permission denied" (`ls -l ~/.kube/config`). Give the file back to ubuntu: `sudo chown ubuntu:ubuntu /home/ubuntu/.kube/config`.

```bash
chown ubuntu:ubuntu /home/ubuntu/.kube/config
chmod 600 /home/ubuntu/.kube/config
```
<!-- /fault -->

**Problem 2: the API server**

<!-- fault Q1_FAULT_2=apiserver-cert-file -->
#### An API server certificate flag points at a file that does not exist (`apiserver-cert-file`)

In this run `--${Q1_APISERVER_CERT}` in `/etc/kubernetes/manifests/kube-apiserver.yaml` names a file that does not exist, so the API server exits at startup and kubectl gets `connection refused`, while `curl -k https://127.0.0.1:6443/readyz` gets nothing either. `crictl logs` of the last kube-apiserver container names the missing file, and `ls /etc/kubernetes/pki` shows the real one. Every flag this fault can break:

- `--client-ca-file`: `/etc/kubernetes/pki/ca.crt` (broken: `/etc/kubernetes/pki/ca.cert`)
- `--tls-cert-file`: `/etc/kubernetes/pki/apiserver.crt` (broken: `/etc/kubernetes/pki/apiserver.cert`)

```bash
case "${Q1_APISERVER_CERT}" in
  client-ca-file)
    sed -i -E 's#^([[:space:]]*- --client-ca-file=)/etc/kubernetes/pki/ca.cert$#\1/etc/kubernetes/pki/ca.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --client-ca-file=/etc/kubernetes/pki/ca.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  tls-cert-file)
    sed -i -E 's#^([[:space:]]*- --tls-cert-file=)/etc/kubernetes/pki/apiserver.cert$#\1/etc/kubernetes/pki/apiserver.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --tls-cert-file=/etc/kubernetes/pki/apiserver.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  *) echo "unknown flag ${Q1_APISERVER_CERT}" >&2; exit 1 ;;
esac
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=apiserver-secure-port -->
#### API server listens on the wrong port (`apiserver-secure-port`)

`--secure-port` in `/etc/kubernetes/manifests/kube-apiserver.yaml` is `6444`, so nothing answers on `6443`: kubectl, the kubelets and the other components get `connection refused`, and the API server's own probes (which target the `probe-port`, 6443) fail until the kubelet restarts it. `ss -ltnp` shows it listening on 6444. Set the port back to `6443`.

```bash
sed -i -E 's#^([[:space:]]*- --secure-port=)6444$#\16443#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --secure-port=6443$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=apiserver-manifest-yaml -->
#### API server manifest is not valid YAML (`apiserver-manifest-yaml`)

The `image:` line in `/etc/kubernetes/manifests/kube-apiserver.yaml` is indented by three spaces instead of four, which makes the file invalid YAML. The kubelet cannot parse the manifest, so it drops the kube-apiserver static pod: no container at all in `crictl ps -a`, and `journalctl -u kubelet` reports the manifest it could not decode. Fix the indentation.

```bash
sed -i -E 's#^   image: (registry\.k8s\.io/kube-apiserver:)#    image: \1#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '^    image: registry.k8s.io/kube-apiserver:' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

### Question 2: Name resolution broken

**The healthy setup**

- CoreDNS (Deployment `kube-system/coredns`) runs `2` ready replicas behind Service `kube-dns` (`10.96.0.10`), port `53` to container port `53`
- its ConfigMap `coredns` holds key `Corefile`, which serves `cluster.local` and forwards other names to `/etc/resolv.conf`
- ClusterRoleBinding `system:coredns` lets ServiceAccount `kube-system:coredns` watch Services, EndpointSlices and Namespaces
- Pod `${Q2_CLIENT}` uses the default `dnsPolicy` (`ClusterFirst`)

This run's fault: **`${Q2_FAULT}`**.

<!-- fault Q2_FAULT=corefile-typo -->
#### Corefile typo crashes CoreDNS (`corefile-typo`)

The Corefile says `forwrd` instead of `forward`. CoreDNS keeps a running config when a reload fails, but once its Pods restart they exit with "Unknown directive 'forwrd'" and crash-loop, so nothing answers DNS. Fix the word in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forwrd \. /etc/resolv\.conf#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q2_FAULT=scaled-to-zero -->
#### CoreDNS scaled to zero (`scaled-to-zero`)

Deployment `coredns` has `0` replicas, so Service `kube-dns` has no endpoints and every lookup times out. Scale it back to `2`.

```bash
kubectl -n kube-system scale deployment/coredns --replicas=2
```
<!-- /fault -->

<!-- fault Q2_FAULT=cluster-domain -->
#### Wrong cluster domain in the Corefile (`cluster-domain`)

The `kubernetes` plugin serves `cluster.lab` instead of `cluster.local`. CoreDNS runs fine, but it forwards every `*.cluster.local` name upstream, which answers NXDOMAIN. Set the zone back to `cluster.local` in ConfigMap `coredns`.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#kubernetes cluster\.lab #kubernetes cluster.local #' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'kubernetes cluster\.local ' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q2_FAULT=kube-dns-selector -->
#### kube-dns Service selects no Pod (`kube-dns-selector`)

Service `kube-dns` selects `k8s-app=kube-dns-v2`, which no Pod carries. CoreDNS is healthy, but 10.96.0.10 has no endpoints, so lookups time out. Set the selector back to `k8s-app=kube-dns`.

```bash
kubectl -n kube-system patch service kube-dns -p '{"spec":{"selector":{"k8s-app":"kube-dns"}}}'
```
<!-- /fault -->

<!-- fault Q2_FAULT=client-dns-policy -->
#### Client Pod bypasses the cluster DNS (`client-dns-policy`)

Pod `${Q2_CLIENT}` has `dnsPolicy: Default`, so it inherits the node's resolv.conf: no cluster nameserver and no cluster search domains. The field cannot be changed on a running Pod; recreate `${Q2_CLIENT}` without it (the default is `ClusterFirst`).

```bash
kubectl -n "${Q2_NS}" delete pod "${Q2_CLIENT}" --ignore-not-found --wait=true >/dev/null
kubectl -n "${Q2_NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q2_CLIENT}"'"},"spec":{"containers":[{"name":"shell","image":"busybox:1.36","command":["sleep","infinity"]}]}}'
if ! kubectl -n "${Q2_NS}" wait --for=condition=Ready "pod/${Q2_CLIENT}" --timeout=180s; then
  kubectl -n "${Q2_NS}" describe "pod/${Q2_CLIENT}" >&2 || true
  exit 1
fi
```
<!-- /fault -->

<!-- fault Q2_FAULT=corefile-loop -->
#### CoreDNS forwards to itself (`corefile-loop`)

The Corefile says `forward . 127.0.0.1`, so CoreDNS forwards unknown names to itself. The `loop` plugin spots its own probe coming back, logs "Loop (127.0.0.1:...) detected" and exits, so the Pods crash-loop. Set `forward . /etc/resolv.conf` again in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forward \. 127\.0\.0\.1#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q2_FAULT=coredns-rbac -->
#### CoreDNS lost its RBAC binding (`coredns-rbac`)

ClusterRoleBinding `system:coredns` is gone, so the CoreDNS service account may not list Services, EndpointSlices or Namespaces. New Pods log "forbidden" and "plugin/ready: Still waiting on: kubernetes", never become ready, and Service `kube-dns` has no endpoints. Bind ClusterRole `system:coredns` to service account `kube-system:coredns` again and restart the Deployment.

```bash
kubectl create clusterrolebinding system:coredns --clusterrole=system:coredns --serviceaccount=kube-system:coredns
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q2_FAULT=kube-dns-target-port -->
#### kube-dns Service targets the wrong port (`kube-dns-target-port`)

Ports `dns` and `dns-tcp` of Service `kube-dns` have `targetPort: 5353`. CoreDNS is healthy and the Service has endpoints, but nothing listens on 5353, so lookups time out. Compare `kubectl -n kube-system get endpointslices -l k8s-app=kube-dns` with the container ports, and set both target ports back to `53`.

```bash
kubectl -n kube-system get service kube-dns -o yaml | sed -E 's/targetPort: 5353$/targetPort: 53/' | kubectl replace -f - >/dev/null
[ "$(kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.ports[*].targetPort}' | tr ' ' '\n' | grep -cx 53)" = 2 ] || { echo "could not edit Service kube-dns" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q2_FAULT=corefile-key -->
#### Corefile key renamed in the ConfigMap (`corefile-key`)

ConfigMap `coredns` holds the config under key `corefile`, but the Deployment mounts key `Corefile`. New Pods stay in `ContainerCreating` and `kubectl describe` shows "configmap references non-existent config key: Corefile". Rename the key back to `Corefile` and restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's/^  corefile: /  Corefile: /' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -q kubernetes || { echo "could not rename the Corefile key" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q2_FAULT=coredns-image -->
#### CoreDNS image tag does not exist (`coredns-image`)

Deployment `coredns` runs an image tag that does not exist (`v0.0.0`), so its Pods are stuck in `ErrImagePull`/`ImagePullBackOff` and Service `kube-dns` has no ready endpoints. `kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows the failed pull. Set the image back to the tag the control plane uses (`kubeadm config images list` shows it), e.g. `kubectl -n kube-system set image deployment/coredns coredns=registry.k8s.io/coredns/coredns:<tag>`.

```bash
kubectl -n kube-system set image deployment/coredns coredns="$(cat "/var/tmp/cka-q2.image")"
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q2.strategy")}}" >/dev/null
```
<!-- /fault -->

<!-- fault Q2_FAULT=coredns-config-volume -->
#### CoreDNS mounts a ConfigMap that does not exist (`coredns-config-volume`)

Volume `config-volume` of Deployment `coredns` refers to ConfigMap `coredns-custom`, which does not exist. The new Pods stay in `ContainerCreating` with "configmap \"coredns-custom\" not found" in `kubectl describe`. Point the volume back at ConfigMap `coredns`.

```bash
kubectl -n kube-system patch deployment coredns --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"coredns"}]'
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q2.strategy")}}" >/dev/null
```
<!-- /fault -->

<!-- fault Q2_FAULT=coredns-memory-limit -->
#### CoreDNS memory limit too small (`coredns-memory-limit`)

Deployment `coredns` limits the container to `8Mi` of memory, so CoreDNS is OOMKilled as it starts and its Pods crash-loop (`kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows `OOMKilled`). Restore the kubeadm defaults: memory limit `170Mi`, request `70Mi`.

```bash
kubectl -n kube-system set resources deployment/coredns -c coredns --limits=memory=170Mi --requests=memory=70Mi
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q2.strategy")}}" >/dev/null
```
<!-- /fault -->

<!-- fault Q2_FAULT=coredns-hosts-plugin -->
#### Corefile hosts plugin maps web to loopback (`coredns-hosts-plugin`)

The Corefile injects a `hosts` block that maps `web` — and the search-expanded names the resolver actually asks for first, such as `web.<namespace>.svc.cluster.local` — to `127.0.0.1`, so name resolution returns loopback instead of the Service IP while CoreDNS stays Ready. Remove that `hosts` block from ConfigMap `coredns` and restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' > /tmp/cka-Corefile
python3 -c 'import re; from pathlib import Path; t=Path("/tmp/cka-Corefile").read_text(); t=re.sub(r"hosts \{[^}]*\}\s*", "", t, count=1); Path("/tmp/cka-Corefile").write_text(t)'
kubectl -n kube-system create configmap coredns --from-file=Corefile=/tmp/cka-Corefile -o yaml --dry-run=client | kubectl -n kube-system apply -f - >/dev/null
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q2_FAULT=coredns-ready-port -->
#### CoreDNS readiness probe hits the wrong port (`coredns-ready-port`)

The CoreDNS readiness probe targets port `8182`, but the `ready` plugin listens on `8181`, so Pods never become Ready and Service `kube-dns` has no endpoints. Point the probe back at `8181`.

```bash
kubectl -n kube-system patch deployment coredns --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":8181}]'
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q2.strategy")}}" >/dev/null
```
<!-- /fault -->

### Question 3: Helm release ${Q3_REL}

```bash
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo add lab http://controlplane:8879
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo update lab
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm -n "${Q3_NS}" install "${Q3_REL}" lab/webapp --version "${Q3_VERSION}" --wait --timeout 3m
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm -n "${Q3_NS}" get manifest "${Q3_REL}" > "/opt/course/helm/${Q3_REL}-manifest.yaml"
```

### Question 4: Service ${Q4_APP} unreachable

**The healthy setup**

- Deployment `${Q4_APP}`: `2` replicas of `nginx:1.27-alpine` labelled `app=${Q4_APP}`, container port `80` named `http`, readiness probe HTTP GET `/` on that port
- Service `${Q4_APP}`: `ClusterIP`, selecting `app=${Q4_APP}`, port `80` forwarding to the target port named `http`
- no NetworkPolicy stops Pods of `${Q4_NS}` from reaching `${Q4_APP}` on port `80`, and kube-proxy runs on every node
- `${Q4_APP}-admin` (Deployment, Service and NetworkPolicy) is unrelated and healthy: it was never part of the problem

This run's fault: **`${Q4_FAULT}`**.

<!-- fault Q4_FAULT=selector-mismatch -->
#### Service selector matches no Pod (`selector-mismatch`)

The Service selects `app=${Q4_APP}-v2`, which no Pod carries, so it has no endpoints. Set the selector back to `app=${Q4_APP}`.

```bash
kubectl -n "${Q4_NS}" patch service "${Q4_APP}" -p '{"spec":{"selector":{"app":"'"${Q4_APP}"'"}}}'
```
<!-- /fault -->

<!-- fault Q4_FAULT=target-port -->
#### Service targetPort points nowhere (`target-port`)

The Service forwards to port 8080, where nginx does not listen: the endpoints exist but connections are refused. Set `targetPort` back to `http`.

```bash
kubectl -n "${Q4_NS}" patch service "${Q4_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```
<!-- /fault -->

<!-- fault Q4_FAULT=named-port -->
#### Container port renamed (`named-port`)

The container port is named `web` instead of `http`, so the Service's named `targetPort: http` resolves to nothing and the endpoint slices list no ports. Rename the port (and the probe that refers to it) back to `http`.

```bash
kubectl -n "${Q4_NS}" patch deployment "${Q4_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"http"},{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=network-policy -->
#### NetworkPolicy blocks the traffic (`network-policy`)

NetworkPolicy `${Q4_APP}-ingress` only lets in Pods labelled `role=monitoring`, so the client is dropped even though the Service and endpoints look fine. Delete it, or allow all Pods of the namespace on port 80.

```bash
kubectl -n "${Q4_NS}" delete networkpolicy "${Q4_APP}-ingress"
```
<!-- /fault -->

<!-- fault Q4_FAULT=not-ready -->
#### Readiness probe fails, so there are no ready endpoints (`not-ready`)

The readiness probe requests `/ready`, which returns 404, so the Pods never become ready and the Service has only not-ready endpoints. Point the probe back at `/`.

```bash
kubectl -n "${Q4_NS}" patch deployment "${Q4_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=selector-extra-label -->
#### Service selector requires an extra label (`selector-extra-label`)

The Service selects `app=${Q4_APP}` **and** `tier=web`. The Pods carry only `app=${Q4_APP}`, so nothing matches and the Service has no endpoints (`kubectl -n ${Q4_NS} get endpointslices -l kubernetes.io/service-name=${Q4_APP}`). Remove `tier` from the selector.

```bash
kubectl -n "${Q4_NS}" patch service "${Q4_APP}" --type=json -p '[{"op":"remove","path":"/spec/selector/tier"}]'
```
<!-- /fault -->

<!-- fault Q4_FAULT=service-port -->
#### Service listens on the wrong port (`service-port`)

The Service listens on port `8080`, so `http://${Q4_APP}` (port 80) is refused even though the endpoints are fine. `kubectl -n ${Q4_NS} get svc ${Q4_APP}` shows `8080/TCP`: set `port` back to `80`.

```bash
kubectl -n "${Q4_NS}" patch service "${Q4_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q4_FAULT=service-protocol -->
#### Service port uses UDP (`service-protocol`)

The Service port is `80/UDP`, but HTTP needs TCP, so TCP connections to the Service IP go nowhere. `kubectl -n ${Q4_NS} get svc ${Q4_APP}` shows the protocol: set it back to `TCP`.

```bash
kubectl -n "${Q4_NS}" patch service "${Q4_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/protocol","value":"TCP"}]'
```
<!-- /fault -->

<!-- fault Q4_FAULT=kube-proxy-kubeconfig -->
#### kube-proxy's kubeconfig points at the wrong API port (`kube-proxy-kubeconfig`)

Service, endpoints and Pods all look right, and the client reaches a Pod IP directly, but not the Service IP. kube-proxy Pods exist on every node, yet the `kubeconfig.conf` in ConfigMap `kube-system/kube-proxy` points it at port `6444`, so it cannot reach the API server: it keeps the rules it had, and never learns about Services or endpoints that changed since. `kubectl -n kube-system logs <kube-proxy-pod>` shows "connection refused" to `:6444`. Set `server:` back to port `6443` in the ConfigMap and restart the DaemonSet (`kubectl -n kube-system rollout restart ds kube-proxy`).

```bash
kubectl -n kube-system get configmap kube-proxy -o yaml | sed -E 's#(server: https://[^[:space:]]+):6444$#\1:6443#' | kubectl replace -f -
kubectl -n kube-system rollout restart daemonset/kube-proxy
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=selector-cleared -->
#### Service has no selector (`selector-cleared`)

The Service has no `selector`, so it manages no endpoints (`kubectl -n ${Q4_NS} get endpointslices -l kubernetes.io/service-name=${Q4_APP}` is empty). Restore `selector: { app: ${Q4_APP} }`.

```bash
kubectl -n "${Q4_NS}" patch service "${Q4_APP}" --type=json -p '[{"op":"add","path":"/spec/selector","value":{"app":"'"${Q4_APP}"'"}}]'
```
<!-- /fault -->

<!-- fault Q4_FAULT=readiness-https -->
#### Readiness probe uses HTTPS against plain HTTP (`readiness-https`)

The readiness probe uses `scheme: HTTPS`, but nginx serves plain HTTP on port 80, so every probe fails and the Service has only not-ready endpoints. The Pods stay `Running` with `RESTARTS 0` and no crash logs — readiness failures only withdraw endpoints, they never restart the container (that is liveness). `kubectl describe pod` shows the `Unhealthy` readiness events. Remove the scheme (or set it to `HTTP`) so the probe succeeds.

```bash
kubectl -n "${Q4_NS}" patch deployment "${Q4_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/scheme"}]'
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=readiness-port-number -->
#### Readiness probe hits the wrong port (`readiness-port-number`)

The readiness probe targets port `8080`, where nothing listens, so the Pods never become ready and the Service has no ready endpoints. Point the probe back at the named port `http`.

```bash
kubectl -n "${Q4_NS}" patch deployment "${Q4_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=egress-network-policy -->
#### NetworkPolicy denies all egress from the namespace (`egress-network-policy`)

NetworkPolicy `deny-egress` selects every Pod and lists `Egress` with no allow rules, so the client cannot leave the Pod network (DNS and HTTP both fail) even though the Service and endpoints look fine. Delete `deny-egress`.

```bash
kubectl -n "${Q4_NS}" delete networkpolicy deny-egress
```
<!-- /fault -->

<!-- fault Q4_FAULT=service-externalname -->
#### Service type flipped to ExternalName (`service-externalname`)

Service `${Q4_APP}` was changed to `type: ExternalName` pointing at `nowhere.invalid`, so it no longer has a ClusterIP or selectors even though the Deployment looks fine. Recreate (or patch) it as a ClusterIP Service selecting `app=${Q4_APP}` with port `80` → named target port `http`.

```bash
kubectl -n "${Q4_NS}" delete service "${Q4_APP}" --wait=true
kubectl -n "${Q4_NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Service","metadata":{"name":"'"${Q4_APP}"'","namespace":"'"${Q4_NS}"'"},"spec":{"selector":{"app":"'"${Q4_APP}"'"},"ports":[{"port":80,"targetPort":"http"}]}}'
```
<!-- /fault -->

<!-- fault Q4_FAULT=kube-proxy-config-mode -->
#### kube-proxy mode is invalid (`kube-proxy-config-mode`)

ConfigMap `kube-system/kube-proxy` sets `mode: not-a-mode`, so kube-proxy Pods crash-loop and Service ClusterIPs stop working. Set `mode` back to `iptables` (or empty) in the ConfigMap and restart the `kube-proxy` DaemonSet.

```bash
kubectl -n kube-system patch configmap kube-proxy --type merge -p "$(python3 -c 'import json,pathlib; print(json.dumps({"data":{"config.conf": pathlib.Path("/tmp/cka-kube-proxy.conf.bak").read_text()}}))')"
kubectl -n kube-system rollout restart daemonset/kube-proxy
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=240s
```
<!-- /fault -->

### Question 5: Default StorageClass with local-path

```bash
kubectl annotate storageclass standard-static storageclass.kubernetes.io/is-default-class- >/dev/null
kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${Q5_SC}
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: rancher.io/local-path
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
EOF
kubectl create namespace "${Q5_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q5_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q5_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: cache
  namespace: ${Q5_NS}
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
  namespace: ${Q5_NS}
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
kubectl -n ${Q5_NS} wait --for=condition=Ready pod/cache-app --timeout=180s
```

### Question 6: Pod ${Q6_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Secret
metadata:
  name: "${Q6_ENV_OBJ}"
  namespace: "${Q6_NS}"
stringData:
  "${Q6_ENV_KEY}": "${Q6_ENV_VALUE}"
---
apiVersion: v1
kind: Pod
metadata:
  name: "${Q6_NAME}"
  namespace: "${Q6_NS}"
spec:
  containers:
    - name: main
      image: "${Q6_IMAGE}"
      command:
        - sleep
        - 1d
      securityContext:
        runAsUser: ${Q6_SEC_USER}
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
      livenessProbe:
        exec:
          command:
            - ls
            - /
        periodSeconds: ${Q6_PROBE_PERIOD}
      env:
        - name: "${Q6_ENV_KEY}"
          valueFrom:
            secretKeyRef:
              name: "${Q6_ENV_OBJ}"
              key: "${Q6_ENV_KEY}"
EOF
kubectl -n "${Q6_NS}" wait --for=condition=Ready "pod/${Q6_NAME}" --timeout=180s
kubectl -n "${Q6_NS}" label pod "${Q6_NAME}" "${Q6_LABEL_KEY}=${Q6_LABEL_VALUE}" --overwrite
```

### Question 7: Deployment ${Q7_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: "${Q7_PRIO_CLASS}"
value: ${Q7_PRIO_VALUE}
globalDefault: false
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: "${Q7_NAME}"
  namespace: "${Q7_NS}"
  labels:
    app: "${Q7_NAME}"
spec:
  replicas: ${Q7_REPLICAS}
  selector:
    matchLabels:
      app: "${Q7_NAME}"
  template:
    metadata:
      labels:
        app: "${Q7_NAME}"
    spec:
      containers:
        - name: app
          image: "${Q7_IMAGE}"
      priorityClassName: "${Q7_PRIO_CLASS}"
EOF
kubectl -n "${Q7_NS}" rollout status "deployment/${Q7_NAME}" --timeout=240s
kubectl -n "${Q7_NS}" scale "deployment/${Q7_NAME}" --replicas="${Q7_SCALE_REPLICAS}"
kubectl -n "${Q7_NS}" rollout status "deployment/${Q7_NAME}" --timeout=240s
```

### Question 8: DaemonSet ${Q8_DS} is not running everywhere

**The healthy setup**

- container `agent`: image `nginx:1.27-alpine` on port `80`, a readiness probe doing an HTTP GET of `/` on port `80`, requests `10m` CPU and `16Mi` memory
- a toleration for the control plane's `node-role.kubernetes.io/control-plane:NoSchedule` taint, and no nodeSelector, affinity or host port
- update strategy `RollingUpdate` with `maxUnavailable: 1`
- no worker tainted, and any other DaemonSet of the namespace left as it is

This run's fault: **`${Q8_FAULT}`**.

<!-- fault Q8_FAULT=image-typo -->
#### Image tag does not exist (ImagePullBackOff) (`image-typo`)

The image is `nginx:1.27-apline`, a tag that does not exist: every Pod sits in `ErrImagePull` / `ImagePullBackOff`, and `kubectl describe pod` names the tag it failed to pull. Set the image back to `nginx:1.27-alpine`.

```bash
kubectl -n "${Q8_NS}" set image "daemonset/${Q8_DS}" agent=nginx:1.27-alpine
```
<!-- /fault -->

<!-- fault Q8_FAULT=readiness-port -->
#### Readiness probe on a port nothing listens on (`readiness-port`)

The readiness probe asks port `8080`, where nothing listens: the Pods run but are never ready (`0/1`), and their Events show `Readiness probe failed: ... connection refused`. Point the probe at port `80`, where nginx listens.

```bash
kubectl -n "${Q8_NS}" patch daemonset "${Q8_DS}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"agent","readinessProbe":{"httpGet":{"port":80}}}]}}}}'
```
<!-- /fault -->

<!-- fault Q8_FAULT=cp-toleration-typo -->
#### Toleration misses the control plane's taint (`cp-toleration-typo`)

The toleration's key is `node-role.kubernetes.io/controlplane`, but the control plane's taint is `node-role.kubernetes.io/control-plane:NoSchedule` (`kubectl describe node controlplane | grep Taints`). It tolerates nothing, so the DaemonSet targets the workers only: DESIRED is one less than the number of nodes, and no Pod runs on `controlplane`. Fix the key; removing the taint instead would open the control plane to every Pod.

```bash
kubectl -n "${Q8_NS}" patch daemonset "${Q8_DS}" --type=strategic -p '{"spec":{"template":{"spec":{"tolerations":[{"key":"node-role.kubernetes.io/control-plane","operator":"Exists","effect":"NoSchedule"}]}}}}'
```
<!-- /fault -->

<!-- fault Q8_FAULT=hostname-affinity -->
#### Node affinity pinned to a list of node names (`hostname-affinity`)

A required node affinity allows only the nodes whose `kubernetes.io/hostname` is `controlplane` or the other worker, as if the DaemonSet had been written for the nodes that existed back then: `${Q8_WORKER}` gets no Pod, and DESIRED is one less than the number of nodes. `kubectl -n ${Q8_NS} get pods -l app=${Q8_DS} -o wide` shows which node is missing. A DaemonSet that runs everywhere needs no affinity: remove it.

```bash
kubectl -n "${Q8_NS}" patch daemonset "${Q8_DS}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/affinity"}]'
```
<!-- /fault -->

<!-- fault Q8_FAULT=hostport-conflict -->
#### Host port already taken by another DaemonSet (`hostport-conflict`)

The container port asks for a host port on every node, but DaemonSet `legacy-exporter` in the same namespace already holds that port on the workers. The Pods there stay `Pending` with "didn't have free ports for the requested pod ports"; only `controlplane`, where the exporter does not run, gets one. `kubectl -n ${Q8_NS} get daemonset,pods -o wide` and `kubectl -n ${Q8_NS} get daemonset legacy-exporter -o yaml` show the clash. `${Q8_DS}` needs no host port: remove `hostPort` from its container port, and leave the exporter as it is.

```bash
kubectl -n "${Q8_NS}" patch daemonset "${Q8_DS}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/ports/0/hostPort"}]'
```
<!-- /fault -->

<!-- fault Q8_FAULT=ondelete-stale -->
#### Pods from an older template, never replaced under OnDelete (`ondelete-stale`)

The Pods crash, and `kubectl -n ${Q8_NS} logs <pod>` shows nginx failing to open `/etc/nginx/agent.conf`, yet the DaemonSet's template runs no such command. The Pods were created from an earlier template, and the update strategy is `OnDelete`, so the DaemonSet never replaces them: `kubectl -n ${Q8_NS} get daemonset ${Q8_DS}` shows UP-TO-DATE `0`, and `kubectl -n ${Q8_NS} rollout history daemonset/${Q8_DS}` lists the newer revision. Set the update strategy back to `RollingUpdate` with `maxUnavailable: 1`, and the Pods are replaced from the current template. Deleting the Pods would replace them too, but the next template change would get stuck again.

```bash
kubectl -n "${Q8_NS}" patch daemonset "${Q8_DS}" --type=strategic -p '{"spec":{"updateStrategy":{"type":"RollingUpdate","rollingUpdate":{"maxUnavailable":1}}}}'
```
<!-- /fault -->

### Question 9: Unhealthy Deployment ${Q9_APP}

**The healthy setup**

- `2` replicas of image `nginx:1.27-alpine`, container `web` listening on port `80`
- requests `50m` CPU and `32Mi` memory; limits `250m` CPU and `128Mi` memory
- a readiness probe doing an HTTP GET of `/` on port `80`, and a liveness probe opening a TCP connection to port `80`
- the environment variable `APP_MODE` taken from key `mode` of ConfigMap `${Q9_APP}-config`, whose value is `production`
- no nodeSelector or affinity, and a normal RollingUpdate strategy, not paused

This run broke 2 things: **`${Q9_FAULT}`**, **`${Q9_FAULT_2}`**. Fix them in the order below.

**Problem 1: the container**

<!-- fault Q9_FAULT=image-pull -->
#### Image tag does not exist (ImagePullBackOff) (`image-pull`)

The image was changed to `nginx:1.27-alpne`, which does not exist: the Pods sit in `ErrImagePull` / `ImagePullBackOff`. Set the image back to `nginx:1.27-alpine`.

```bash
kubectl -n "${Q9_NS}" set image "deployment/${Q9_APP}" web=nginx:1.27-alpine
```
<!-- /fault -->

<!-- fault Q9_FAULT=bad-command -->
#### Broken command (CrashLoopBackOff) (`bad-command`)

A `command` override starts nginx with an unknown directive, so it exits immediately and the Pods go into `CrashLoopBackOff`. `kubectl logs --previous` shows the nginx error. Remove the command so the image default runs.

```bash
kubectl -n "${Q9_NS}" patch deployment "${Q9_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]'
```
<!-- /fault -->

<!-- fault Q9_FAULT=no-bash -->
#### Command uses /bin/bash on an image without it (`no-bash`)

The container `command` starts with `/bin/bash`, which this alpine-based image does not ship. Events show `exec: "/bin/bash": no such file` and the Pods CrashLoop. Remove the command override (or use `/bin/sh`) so nginx starts again.

```bash
kubectl -n "${Q9_NS}" patch deployment "${Q9_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]'
```
<!-- /fault -->

<!-- fault Q9_FAULT=configmap-key -->
#### ConfigMap key missing (CreateContainerConfigError) (`configmap-key`)

ConfigMap `${Q9_APP}-config` has the key `mod` instead of `mode`, so the containers cannot be created: `CreateContainerConfigError`, with the missing key named in the Events. Rename the key in the ConfigMap; the Pods start on their next retry.

```bash
kubectl -n "${Q9_NS}" patch configmap "${Q9_APP}-config" --type=json -p '[{"op":"move","from":"/data/mod","path":"/data/mode"}]'
kubectl -n "${Q9_NS}" rollout restart "deployment/${Q9_APP}"
```
<!-- /fault -->

<!-- fault Q9_FAULT=exits-cleanly -->
#### The command finishes with exit code 0 (Completed, then CrashLoopBackOff) (`exits-cleanly`)

A `command` override tests the nginx configuration and stops there. It succeeds, so the container exits with code `0`: `kubectl get pods` flips between `Completed` and `CrashLoopBackOff`, and `describe pod` shows `Last State: Terminated, Reason: Completed, Exit Code: 0`. Nothing failed: a Deployment simply expects its containers to keep running, so its `restartPolicy: Always` starts them again. Remove the command so that nginx runs in the foreground.

```bash
kubectl -n "${Q9_NS}" patch deployment "${Q9_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]'
```
<!-- /fault -->

**Problem 2: scheduling**

<!-- fault Q9_FAULT_2=requests-too-large -->
#### Memory request just above what a worker can offer (Pending) (`requests-too-large`)

The memory request was raised to a value that looks ordinary but is a little more than any worker can allocate, so the new Pods stay `Pending` with `Insufficient memory`. Compare the request with `Allocatable` and `Allocated resources` in `kubectl describe node`. Put the requests and limits back to the spec.

```bash
kubectl -n "${Q9_NS}" set resources "deployment/${Q9_APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi
```
<!-- /fault -->

<!-- fault Q9_FAULT_2=node-selector -->
#### nodeSelector matching no node (Pending) (`node-selector`)

A `nodeSelector` of `disktype=ssd` matches no node, so the Pods stay `Pending` with `didn't match Pod's node affinity/selector` in the Events. The spec allows any worker: remove the nodeSelector.

```bash
kubectl -n "${Q9_NS}" patch deployment "${Q9_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
```
<!-- /fault -->

### Question 10: Pod ${Q10_CLAIM}-app never starts

**The healthy setup**

- StorageClass `${Q10_CLAIM}-local`: provisioner `rancher.io/local-path`, `WaitForFirstConsumer`, reclaim `Delete`
- PVC `${Q10_CLAIM}` in `${Q10_NS}`: `500Mi`, `ReadWriteOnce`, `storageClassName: ${Q10_CLAIM}-local`
- Pod `${Q10_CLAIM}-app` (`busybox:1.36`, `sleep 1d`) mounts only that claim, at `/data`, and no other Pod uses it

This run's fault: **`${Q10_FAULT}`**.

<!-- fault Q10_FAULT=provisioner-typo -->
#### StorageClass names a provisioner that does not exist (`provisioner-typo`)

StorageClass `${Q10_CLAIM}-local` names provisioner `rancher.io/localpath`. Nothing serves that name, so the claim stays `Pending` with "waiting for a volume to be created either by the external provisioner 'rancher.io/localpath'". The provisioner field cannot be changed: re-create the class with `rancher.io/local-path` (the name the running provisioner and the built-in `local-path` class use), then re-create the claim and the Pod.

```bash
kubectl -n "${Q10_NS}" delete pod --all --wait=true
kubectl -n "${Q10_NS}" delete pvc "${Q10_CLAIM}" --wait=true
kubectl delete storageclass "${Q10_CLAIM}-local"
kubectl apply -f - <<< '{"apiVersion":"storage.k8s.io/v1","kind":"StorageClass","metadata":{"name":"'"${Q10_CLAIM}-local"'"},"provisioner":"rancher.io/local-path","volumeBindingMode":"WaitForFirstConsumer","reclaimPolicy":"Delete"}'
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q10_CLAIM}"'","namespace":"'"${Q10_NS}"'"},"spec":{"storageClassName":"'"${Q10_CLAIM}"'-local","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}}'
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q10_CLAIM}-app"'","namespace":"'"${Q10_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q10_CLAIM}"'"}}]}}'
```
<!-- /fault -->

<!-- fault Q10_FAULT=provisioner-down -->
#### The local-path provisioner is scaled to zero (`provisioner-down`)

The class, the claim and the Pod are all right, but Deployment `local-path-provisioner` in `local-path-storage` has `0` replicas, so nobody creates the volume: the claim stays `Pending` with "waiting for a volume to be created either by the external provisioner 'rancher.io/local-path'", and nothing more happens. The class names who provisions; check that it runs: `kubectl -n local-path-storage get deploy,pods`. Scale it back to `1`.

```bash
kubectl scale -n local-path-storage deployment/local-path-provisioner --replicas=1
```
<!-- /fault -->

<!-- fault Q10_FAULT=no-class -->
#### Claim names no StorageClass and there is no default (`no-class`)

The claim names no `storageClassName` and the cluster has no default class, so nothing provisions it: it waits for a static PV that never comes ("no persistent volumes available for this claim and no storage class is set"). The task rules out a default class, so re-create the claim with `storageClassName: ${Q10_CLAIM}-local`, then the Pod.

```bash
kubectl -n "${Q10_NS}" delete pod "${Q10_CLAIM}-app" --wait=true
kubectl -n "${Q10_NS}" delete pvc "${Q10_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q10_CLAIM}"'","namespace":"'"${Q10_NS}"'"},"spec":{"storageClassName":"'"${Q10_CLAIM}"'-local","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}}'
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q10_CLAIM}-app"'","namespace":"'"${Q10_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q10_CLAIM}"'"}}]}}'
```
<!-- /fault -->

<!-- fault Q10_FAULT=rwop-taken -->
#### ReadWriteOncePod claim already used by another Pod (`rwop-taken`)

The claim's access mode is `ReadWriteOncePod`: only one Pod in the whole cluster may use it, and Pod `${Q10_CLAIM}-backup` already does. `${Q10_CLAIM}-app` stays `Pending`; the scheduler says "node has pod using PersistentVolumeClaim with the same name and ReadWriteOncePod access mode". Remove `${Q10_CLAIM}-backup` (a leftover), or re-create the claim with `ReadWriteOnce` if both Pods must share it on one node.

```bash
kubectl -n "${Q10_NS}" delete pod "${Q10_CLAIM}-backup" --ignore-not-found --wait=true
```
<!-- /fault -->

<!-- fault Q10_FAULT=hostpath-missing -->
#### Extra hostPath volume requires a directory that does not exist (`hostpath-missing`)

Besides its claim, the Pod mounts hostPath `/var/log/${Q10_CLAIM}-app` with `type: Directory`, which requires the directory to exist on the node. It does not, so the Pod stays in `ContainerCreating` with "hostPath type check failed: ... is not a directory" under Events, although the claim is Bound. Re-create the Pod with `type: DirectoryOrCreate` (or create the directory on the node).

```bash
kubectl -n "${Q10_NS}" delete pod "${Q10_CLAIM}-app" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q10_CLAIM}-app"'","namespace":"'"${Q10_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"},{"name":"logs","mountPath":"/logs"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q10_CLAIM}"'"}},{"name":"logs","hostPath":{"path":"/var/log/'"${Q10_CLAIM}"'-app","type":"DirectoryOrCreate"}}]}}'
```
<!-- /fault -->

<!-- fault Q10_FAULT=claim-elsewhere -->
#### The claim exists only in another namespace (`claim-elsewhere`)

Claim `${Q10_CLAIM}` was created in namespace `${Q10_NS}-shared`, not `${Q10_NS}`. A Pod can only use claims of its own namespace, so `${Q10_CLAIM}-app` stays `Pending` with "persistentvolumeclaim \"${Q10_CLAIM}\" not found". A claim cannot be moved: create `${Q10_CLAIM}` in `${Q10_NS}` (the volume behind the other claim stays there), then re-create the Pod.

```bash
kubectl -n "${Q10_NS}" delete pod "${Q10_CLAIM}-app" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q10_CLAIM}"'","namespace":"'"${Q10_NS}"'"},"spec":{"storageClassName":"'"${Q10_CLAIM}"'-local","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}}'
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q10_CLAIM}-app"'","namespace":"'"${Q10_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q10_CLAIM}"'"}}]}}'
```
<!-- /fault -->

<!-- fault Q10_FAULT=pod-unschedulable -->
#### WaitForFirstConsumer claim waits for a Pod that cannot be scheduled (`pod-unschedulable`)

The claim looks like the problem: it stays `Pending` with "waiting for first consumer to be created before binding". But that is `WaitForFirstConsumer` working as designed: the volume is created on the node where its first Pod is scheduled, and the Pod is never scheduled, because its `nodeSelector: disktype=ssd` matches no node ("didn't match Pod's node affinity/selector" in `kubectl -n ${Q10_NS} describe pod ${Q10_CLAIM}-app`). Re-create the Pod without the nodeSelector; the claim then binds.

```bash
kubectl -n "${Q10_NS}" delete pod "${Q10_CLAIM}-app" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q10_CLAIM}-app"'","namespace":"'"${Q10_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q10_CLAIM}"'"}}]}}'
```
<!-- /fault -->

### Question 11: Install an agent with Kustomize

```bash
cat >> /opt/course/kustomize/${Q11_APP}-agent/kustomization.yaml <<EOF
patches:
  - target:
      kind: DaemonSet
      name: ${Q11_APP}-agent
    patch: |-
      - op: add
        path: /spec/template/spec/tolerations
        value:
          - key: node-role.kubernetes.io/control-plane
            operator: Exists
            effect: NoSchedule
EOF
kubectl apply -k /opt/course/kustomize/${Q11_APP}-agent
kubectl -n ${Q11_APP}-agents rollout status daemonset/${Q11_APP}-agent --timeout=180s
```

### Question 12: Errors of a crashed container

```bash
kubectl -n ${Q12_NS} logs pay-0 -c api --previous | grep ERROR > /opt/course/logs/errors.txt
kubectl -n ${Q12_NS} get pod pay-0 -o jsonpath='{.status.containerStatuses[?(@.name=="api")].lastState.terminated.exitCode}' > /opt/course/logs/exit-code.txt
```

### Question 13: Install an operator without its CRDs

```bash
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo add lab http://controlplane:8879
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo update lab
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm install db-operator lab/db-operator --version 1.2.0 -n operators --create-namespace --skip-crds --wait --timeout 3m
kubectl create namespace ${Q13_NS} --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f - <<EOF
apiVersion: db.example.lab/v1
kind: Database
metadata:
  name: orders
  namespace: ${Q13_NS}
spec:
  replicas: 2
EOF
```

### Question 14: Node drain is stuck

**The healthy setup**

- PodDisruptionBudget `${Q14_APP}-pdb` lets one of the `2` replicas be evicted at a time (`minAvailable: 1`)
- the Pod template of `${Q14_APP}` prefers the maintenance worker but does not require it, and allows two replicas on one node
- `kubectl drain` always needs `--ignore-daemonsets` (calico-node and kube-proxy run everywhere), `--delete-emptydir-data` for Pods with an `emptyDir` volume, and `--force` for Pods that no controller manages

This run broke 2 things on `${Q14_NODE}`: **`${Q14_FAULT}`**, **`${Q14_FAULT_2}`**. Fix them in the order below.

**Problem 1: the PodDisruptionBudget**

<!-- fault Q14_FAULT=pdb-min-available -->
#### PDB minAvailable equals the replica count (`pdb-min-available`)

PodDisruptionBudget `${Q14_APP}-pdb` sets `minAvailable: 2` while `${Q14_APP}` has 2 replicas, so it allows no disruption at all: `kubectl drain` retries "Cannot evict pod as it would violate the pod's disruption budget" until it gives up (`kubectl -n ${Q14_NS} get pdb` shows ALLOWED DISRUPTIONS 0). Lower `minAvailable` to `1`, then drain: `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data --force`.

```bash
kubectl -n "${Q14_NS}" patch pdb "${Q14_APP}-pdb" --type=merge -p '{"spec":{"minAvailable":1}}'
```
<!-- /fault -->

<!-- fault Q14_FAULT=pdb-max-unavailable-0 -->
#### PDB maxUnavailable is zero (`pdb-max-unavailable-0`)

PodDisruptionBudget `${Q14_APP}-pdb` sets `maxUnavailable: 0`: no Pod of `${Q14_APP}` may ever be evicted, so the drain retries until it gives up (ALLOWED DISRUPTIONS 0). Allow one: `maxUnavailable: 1` (or `minAvailable: 1`), then drain the worker.

```bash
kubectl -n "${Q14_NS}" patch pdb "${Q14_APP}-pdb" --type=merge -p '{"spec":{"maxUnavailable":1}}'
```
<!-- /fault -->

**Problem 2: Pods drain will not remove by default**

<!-- fault Q14_FAULT_2=bare-pod -->
#### A Pod without a controller runs on the worker (`bare-pod`)

Pod `${Q14_APP}-debug` was started by hand with `kubectl run`: no ReplicaSet, Job or other controller owns it. `kubectl drain` refuses to remove such Pods, because nothing would recreate them ("cannot delete Pods that declare no controller (use --force to override)"). Nothing needs fixing in the cluster: drain with `--force`, which deletes it (or delete it yourself first).
<!-- /fault -->

<!-- fault Q14_FAULT_2=emptydir-pod -->
#### The replicas keep scratch data in an emptyDir volume (`emptydir-pod`)

The `${Q14_APP}` Pods mount an `emptyDir` volume, whose data is lost when a Pod leaves its node. `kubectl drain` will not evict them unless told that is acceptable ("cannot delete Pods with local storage (use --delete-emptydir-data to override)"). Scratch data may go: drain with `--delete-emptydir-data`.
<!-- /fault -->

### Question 15: Back up etcd

```bash
mkdir -p "$(dirname "${Q15_BACKUP}")"
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key snapshot save "${Q15_BACKUP}"
mkdir -p "$(dirname "${Q15_STATUS_FILE}")"
ETCDCTL_API=3 etcdctl snapshot status "${Q15_BACKUP}" -w table > "${Q15_STATUS_FILE}"
```

### Question 16: Autoscaler ${Q16_APP} not working

**The healthy setup**

- the autoscaler targets Deployment `${Q16_APP}`, between `2` and `6` replicas, at `50%` average CPU utilization
- Deployment `${Q16_APP}` runs image `nginx:1.27-alpine`, container `web`, requesting `50m` CPU and `32Mi` memory
- metrics-server runs in `kube-system`, and APIService `v1beta1.metrics.k8s.io` is available

This run's fault: **`${Q16_FAULT}`**.

<!-- fault Q16_FAULT=no-cpu-request -->
#### Deployment has no CPU request (`no-cpu-request`)

Utilization is measured against the container's CPU request, and `web` has none, so the autoscaler reports "missing request for cpu" (FailedGetResourceMetric) and its target stays `<unknown>`. Set the request back to `50m`: `kubectl -n ${Q16_NS} set resources deployment ${Q16_APP} -c web --requests=cpu=50m,memory=32Mi`.

```bash
kubectl -n "${Q16_NS}" set resources "deployment/${Q16_APP}" -c web --requests=cpu=50m,memory=32Mi
```
<!-- /fault -->

<!-- fault Q16_FAULT=target-name -->
#### Autoscaler targets a missing Deployment (`target-name`)

`scaleTargetRef.name` is `${Q16_APP}-v2`, which does not exist, so the autoscaler fails with FailedGetScale and never scales `${Q16_APP}`. Point it back at Deployment `${Q16_APP}`.

```bash
kubectl -n "${Q16_NS}" patch hpa "${Q16_APP}" --type=merge -p '{"spec":{"scaleTargetRef":{"name":"'"${Q16_APP}"'"}}}'
```
<!-- /fault -->

<!-- fault Q16_FAULT=target-kind -->
#### Autoscaler targets the wrong kind (`target-kind`)

`scaleTargetRef.kind` is `StatefulSet`, and there is no StatefulSet `${Q16_APP}`, so the autoscaler fails with FailedGetScale. Set the kind back to `Deployment`.

```bash
kubectl -n "${Q16_NS}" patch hpa "${Q16_APP}" --type=merge -p '{"spec":{"scaleTargetRef":{"kind":"Deployment"}}}'
```
<!-- /fault -->

<!-- fault Q16_FAULT=max-one -->
#### Replica range pinned to one (`max-one`)

The autoscaler's range is `1`-`1`, so it scaled `${Q16_APP}` down to a single replica and can never add more (ScalingLimited). Scaling the Deployment by hand does not help: the autoscaler overrides it. Restore `minReplicas: 2` and `maxReplicas: 6`.

```bash
kubectl -n "${Q16_NS}" patch hpa "${Q16_APP}" --type=merge -p '{"spec":{"minReplicas":2,"maxReplicas":6}}'
```
<!-- /fault -->

<!-- fault Q16_FAULT=metrics-server-down -->
#### metrics-server scaled to zero (`metrics-server-down`)

The `kube-system/metrics-server` Deployment has `0` replicas, so the `v1beta1.metrics.k8s.io` APIService is unavailable, `kubectl top` fails, and every autoscaler shows `<unknown>` targets. Scale it back to `1` replica.

```bash
kubectl -n kube-system scale deployment/metrics-server --replicas=1
kubectl -n kube-system rollout status deployment/metrics-server --timeout=180s
for _ in $(seq 1 60); do
  kubectl top nodes >/dev/null 2>&1 && break
  sleep 3
done
```
<!-- /fault -->

<!-- fault Q16_FAULT=metrics-apiservice -->
#### metrics-server Service points at the wrong port (`metrics-apiservice`)

metrics-server itself runs, but its Service sends traffic to port `8443`, where nothing listens. The `v1beta1.metrics.k8s.io` APIService behind that Service is unavailable (`kubectl get apiservice v1beta1.metrics.k8s.io` shows FailedDiscoveryCheck), so `kubectl top` and every autoscaler fail. Set the Service's `targetPort` back to the container's port (named `https`).

```bash
port="$(kubectl -n kube-system get deployment metrics-server -o jsonpath='{.spec.template.spec.containers[0].ports[0].name}')"
kubectl -n kube-system patch service metrics-server --type=json -p "[{\"op\":\"replace\",\"path\":\"/spec/ports/0/targetPort\",\"value\":\"$port\"}]"
kubectl -n kube-system rollout status deployment/metrics-server --timeout=180s
for _ in $(seq 1 60); do
  kubectl top nodes >/dev/null 2>&1 && break
  sleep 3
done
```
<!-- /fault -->

<!-- fault Q16_FAULT=metrics-kubelet-tls -->
#### metrics-server no longer accepts the kubelets' self-signed certificates (`metrics-kubelet-tls`)

metrics-server runs, but its new Pod never turns Ready: its logs say it cannot scrape any kubelet (`x509: cannot validate certificate for <node-ip> because it doesn't contain any IP SANs`). kubeadm kubelets serve self-signed certificates, which metrics-server only accepts with `--kubelet-insecure-tls`, and that flag was removed from its arguments. Without data, the `v1beta1.metrics.k8s.io` APIService is unavailable and `kubectl top` and every autoscaler fail. Add `--kubelet-insecure-tls` back to the container's `args` (`kubectl -n kube-system edit deploy metrics-server`).

```bash
kubectl -n kube-system patch deployment metrics-server --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```
<!-- /fault -->

### Question 17: Change the upstream DNS server

```bash
ip=$(kubectl -n corp-dns get service resolver -o jsonpath='{.spec.clusterIP}')
kubectl -n kube-system get configmap coredns -o yaml | sed -E "s#forward \. /etc/resolv\.conf#forward . $ip#" | kubectl replace -f -
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```

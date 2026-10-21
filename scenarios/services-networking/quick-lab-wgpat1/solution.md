## Solution

### Question 1: ${Q1_APP} unreachable through the ingress

**The healthy setup**

- Service `${Q1_APP}`: port `80`, forwarding to the `${Q1_APP}` Pods
- Ingress `${Q1_APP}`: class `traefik`, host `www.${Q1_NS}.lab`, path `/` (`Prefix`) to Service `${Q1_APP}` on port `80`
- HTTPRoute `${Q1_APP}`: attached to the `web` listener of Gateway `traefik-gateway` in namespace `traefik`, host `api.${Q1_NS}.lab`, path `/` to Service `${Q1_APP}` on port `80`

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=ingress-service-name -->
#### Ingress points at a Service that does not exist (`ingress-service-name`)

The Ingress backend is Service `${Q1_APP}-svc`, which does not exist, so Traefik has nothing to send `www.${Q1_NS}.lab` to. `kubectl describe ingress` shows the missing backend. Point it back at `${Q1_APP}`.

```bash
kubectl -n "${Q1_NS}" patch ingress "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"'"${Q1_APP}"'"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=ingress-service-port -->
#### Ingress uses the wrong Service port (`ingress-service-port`)

The Ingress sends traffic to port `8080` of Service `${Q1_APP}`, which only has port `80`. Set the backend port back to `80`.

```bash
kubectl -n "${Q1_NS}" patch ingress "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/port/number","value":80}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=ingress-class -->
#### Ingress asks for a class that does not exist (`ingress-class`)

`ingressClassName` is `nginx`, but the only IngressClass is `traefik` (`kubectl get ingressclass`). No controller claims the Ingress, so it has no address and nothing routes `www.${Q1_NS}.lab`. Set the class back to `traefik`.

```bash
kubectl -n "${Q1_NS}" patch ingress "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/ingressClassName","value":"traefik"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=ingress-path -->
#### Ingress path matches only one exact page (`ingress-path`)

The Ingress path is `/index.html` with `pathType: Exact`, so only that one URL matches and `/` gets Traefik's 404. Set the path back to `/` with `pathType: Prefix`.

```bash
kubectl -n "${Q1_NS}" patch ingress "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"},{"op":"replace","path":"/spec/rules/0/http/paths/0/pathType","value":"Prefix"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=route-parent -->
#### HTTPRoute attached to a Gateway that does not exist (`route-parent`)

The HTTPRoute's `parentRefs` names Gateway `web-gateway`, which does not exist, so no Gateway accepts the route (its status lists no accepted parent). `kubectl -n traefik get gateway` shows the real name, `traefik-gateway`.

```bash
kubectl -n "${Q1_NS}" patch httproute "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/name","value":"traefik-gateway"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=route-section -->
#### HTTPRoute names a listener the Gateway does not have (`route-section`)

`sectionName: websecure` asks for a listener that `traefik-gateway` does not have; its only listener is `web`. The route's `Accepted` condition is `False` with reason `NoMatchingParent`. Set `sectionName` back to `web`.

```bash
kubectl -n "${Q1_NS}" patch httproute "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/sectionName","value":"web"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=route-backend-port -->
#### HTTPRoute uses the wrong Service port (`route-backend-port`)

The HTTPRoute sends traffic to port `8080` of Service `${Q1_APP}`, which only has port `80`. The route's `ResolvedRefs` condition is `False`. Set the backendRef port back to `80`.

```bash
kubectl -n "${Q1_NS}" patch httproute "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=ingress-host-typo -->
#### Ingress rule has a misspelled host (`ingress-host-typo`)

The Ingress rule's host is `ww.${Q1_NS}.lab`, not `www.${Q1_NS}.lab`. Traefik routes only matching Host headers, so `www.${Q1_NS}.lab` gets a 404. `kubectl -n ${Q1_NS} get ingress` shows the host: set it back to `www.${Q1_NS}.lab`.

```bash
kubectl -n "${Q1_NS}" patch ingress "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/host","value":"www.'"${Q1_NS}"'.lab"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=route-hostname-typo -->
#### HTTPRoute has a misspelled hostname (`route-hostname-typo`)

The HTTPRoute's hostname is `apl.${Q1_NS}.lab`, not `api.${Q1_NS}.lab`, so requests for `api.${Q1_NS}.lab` match no route and get a 404. `kubectl -n ${Q1_NS} get httproute` shows the hostname: set it back to `api.${Q1_NS}.lab`.

```bash
kubectl -n "${Q1_NS}" patch httproute "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/hostnames/0","value":"api.'"${Q1_NS}"'.lab"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=route-parent-namespace -->
#### HTTPRoute looks for the Gateway in its own namespace (`route-parent-namespace`)

The HTTPRoute's `parentRefs` has no `namespace`, so it defaults to the route's own namespace `${Q1_NS}`, where there is no `traefik-gateway`. The route has no accepted parent. Add `namespace: traefik` to the parentRef.

```bash
kubectl -n "${Q1_NS}" patch httproute "${Q1_APP}" --type=json -p '[{"op":"add","path":"/spec/parentRefs/0/namespace","value":"traefik"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=route-backend-name -->
#### HTTPRoute points at a Service that does not exist (`route-backend-name`)

The HTTPRoute's backendRef is Service `${Q1_APP}-svc`, which does not exist, so `ResolvedRefs` is `False` and `api.${Q1_NS}.lab` fails. Point the backendRef back at `${Q1_APP}`.

```bash
kubectl -n "${Q1_NS}" patch httproute "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/name","value":"'"${Q1_APP}"'"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=route-path-prefix -->
#### HTTPRoute path matches only /api (`route-path-prefix`)

The HTTPRoute only matches path prefix `/api`, so `/` gets Traefik's 404. Remove the `matches` block (or set the path to `/`) so every path on `api.${Q1_NS}.lab` is served.

```bash
kubectl -n "${Q1_NS}" patch httproute "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/matches"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=ingress-path-prefix -->
#### Ingress path matches only /app (`ingress-path-prefix`)

The Ingress path is `/app` with `pathType: Prefix`, so `/` does not match and Traefik returns 404 for `www.${Q1_NS}.lab`. Set the path back to `/`.

```bash
kubectl -n "${Q1_NS}" patch ingress "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=route-weight-zero -->
#### HTTPRoute backend weight is zero (`route-weight-zero`)

The HTTPRoute backendRef has `weight: 0`, so Traefik sends it no traffic and `api.${Q1_NS}.lab` fails even though the Service is healthy. Remove the weight (or set it above 0).

```bash
kubectl -n "${Q1_NS}" patch httproute "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/backendRefs/0/weight"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=route-parent-group -->
#### HTTPRoute parentRef uses the wrong API group (`route-parent-group`)

The HTTPRoute's `parentRefs` sets `group: networking.k8s.io`, but Gateways live in `gateway.networking.k8s.io`. No parent accepts the route. Remove the `group` field (or set it to `gateway.networking.k8s.io`).

```bash
kubectl -n "${Q1_NS}" patch httproute "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/parentRefs/0/group"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=route-filter-redirect -->
#### HTTPRoute redirects instead of proxying (`route-filter-redirect`)

The HTTPRoute has a `RequestRedirect` filter, so requests for `api.${Q1_NS}.lab` get a 302 to `elsewhere.example` instead of the nginx welcome page. Remove the `filters` block so the route proxies to Service `${Q1_APP}`.

```bash
kubectl -n "${Q1_NS}" patch httproute "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/filters"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=ingress-tls-secret-missing -->
#### Ingress TLS references a Secret that does not exist (`ingress-tls-secret-missing`)

Ingress `${Q1_APP}` references TLS Secret `missing-tls` (which does not exist) and is pinned to the `websecure` entrypoint, so HTTP on `www.${Q1_NS}.lab` fails. Remove the `spec.tls` stanza (or create a valid TLS Secret) and clear the entrypoints annotation so Traefik serves the host on `web` again.

```bash
kubectl -n "${Q1_NS}" annotate ingress "${Q1_APP}" traefik.ingress.kubernetes.io/router.entrypoints-
kubectl -n "${Q1_NS}" patch ingress "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/tls"}]'
```
<!-- /fault -->

### Question 2: PersistentVolume ${Q2_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolume
metadata:
  name: "${Q2_NAME}"
  labels:
    tier: "${Q2_LABEL_TIER}"
spec:
  capacity:
    storage: "${Q2_CAPACITY}"
  accessModes:
    - "${Q2_ACCESS}"
  persistentVolumeReclaimPolicy: "${Q2_RECLAIM}"
  storageClassName: manual
  hostPath:
    path: "/srv/${Q2_NAME}"
    type: DirectoryOrCreate
EOF
```

### Question 3: Unhealthy worker

**The healthy setup**

- kubelet and containerd running and enabled on every worker, with `net.ipv4.ip_forward=1` persisted
- the kubelet's unit drop-in, `/var/lib/kubelet/config.yaml`, `/etc/kubernetes/kubelet.conf` and `/etc/default/kubelet` as kubeadm wrote them; no swap
- Calico's `10-calico.conflist` in `/etc/cni/net.d`, and a valid `/etc/containerd/config.toml`
- no worker cordoned or tainted

This run's fault: **`${Q3_FAULT}`** on `${Q3_NODE}`.

<!-- fault Q3_FAULT=kubelet-stopped -->
#### kubelet stopped and disabled (`kubelet-stopped`)

The kubelet was stopped and disabled, so the node stops sending heartbeats and turns `NotReady`. `systemctl status kubelet` shows it inactive. `systemctl enable --now kubelet` fixes it now and after a reboot.

On the broken worker:

```bash
systemctl enable --now kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=containerd-stopped -->
#### containerd stopped and disabled (`containerd-stopped`)

The container runtime was stopped and disabled. The kubelet keeps running but reports `container runtime is down` / `NotReady`, and its log is full of CRI connection errors. `systemctl enable --now containerd` fixes it.

On the broken worker:

```bash
systemctl enable --now containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=ip-forward-and-containerd -->
#### IP forwarding off and containerd disabled (`ip-forward-and-containerd`)

`net.ipv4.ip_forward` is 0, `/etc/sysctl.d/k8s.conf` is missing, and `containerd` was stopped and disabled. The node turns `NotReady`. Put `net.ipv4.ip_forward=1` in `/etc/sysctl.d/k8s.conf`, apply with `sysctl --system`, and `systemctl enable --now containerd`.

On the broken worker:

```bash
printf 'net.ipv4.ip_forward=1\n' >/etc/sysctl.d/k8s.conf
sysctl --system >/dev/null 2>&1 || sysctl -w net.ipv4.ip_forward=1 >/dev/null
systemctl enable --now containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=kubelet-binary-path -->
#### kubelet unit points at the wrong binary (`kubelet-binary-path`)

The kubeadm drop-in (`10-kubeadm.conf`) starts `/usr/local/bin/kubelet`, which does not exist, so the service fails with `status=203/EXEC`. `systemctl cat kubelet` shows the path; `which kubelet` shows the real one. Fix the drop-in, then `systemctl daemon-reload` and restart the kubelet.

On the broken worker:

```bash
dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
sed -i 's#^ExecStart=/usr/local/bin/kubelet #ExecStart=/usr/bin/kubelet #' "$dropin"
systemctl daemon-reload
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=cordoned -->
#### Node cordoned (`cordoned`)

The node is `Ready` but cordoned (`SchedulingDisabled`), so no new Pods land on it. `kubectl uncordon` it.

```bash
kubectl uncordon "${Q3_NODE}"
```
<!-- /fault -->

<!-- fault Q3_FAULT=stray-taint -->
#### Stray NoSchedule taint (`stray-taint`)

A `maintenance=true:NoSchedule` taint keeps every Pod without a matching toleration off the node, including the probe Pod. `kubectl describe node` lists it under Taints; remove it with `kubectl taint node <node> maintenance-`.

```bash
kubectl taint node "${Q3_NODE}" maintenance-
```
<!-- /fault -->

<!-- fault Q3_FAULT=kubelet-config-invalid -->
#### kubelet config has the wrong kind (`kubelet-config-invalid`)

`/var/lib/kubelet/config.yaml` says `kind: KubeletConfig`. The kubelet cannot decode its own config and exits at start (no kind "KubeletConfig" is registered), so the node turns `NotReady`. `journalctl -u kubelet` shows the error. Set `kind: KubeletConfiguration` again and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's/^kind: KubeletConfig$/kind: KubeletConfiguration/' /var/lib/kubelet/config.yaml
grep -qE -- '^kind: KubeletConfiguration$' /var/lib/kubelet/config.yaml || { echo "could not edit /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->

<!-- fault Q3_FAULT=kubelet-client-ca -->
#### kubelet client CA file missing (`kubelet-client-ca`)

`authentication.x509.clientCAFile` in `/var/lib/kubelet/config.yaml` points at `/etc/kubernetes/pki/ca.pem`, which does not exist, so the kubelet exits with "unable to load client CA file". `ls /etc/kubernetes/pki` shows the real `ca.crt`. Fix the path and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#clientCAFile: /etc/kubernetes/pki/ca\.pem$#clientCAFile: /etc/kubernetes/pki/ca.crt#' /var/lib/kubelet/config.yaml
grep -qE -- 'clientCAFile: /etc/kubernetes/pki/ca\.crt$' /var/lib/kubelet/config.yaml || { echo "could not edit /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->

<!-- fault Q3_FAULT=kubelet-api-port -->
#### kubelet kubeconfig uses the wrong API port (`kubelet-api-port`)

The kubelet runs, but `/etc/kubernetes/kubelet.conf` points it at port `6444` of the API server, so every request fails with "connection refused" and the node stops heartbeating. `journalctl -u kubelet` shows the URL; the API server listens on `6443` (compare `~/.kube/config`). Fix the port and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^([[:space:]]*server: https://.*):6444$#\1:6443#' /etc/kubernetes/kubelet.conf
grep -qE -- 'server: https://.*:6443$' /etc/kubernetes/kubelet.conf || { echo "could not edit /etc/kubernetes/kubelet.conf" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->

<!-- fault Q3_FAULT=kubelet-extra-args -->
#### kubelet started with an unknown flag (`kubelet-extra-args`)

`/etc/default/kubelet` adds `--pod-max-pids-limit=100` to `KUBELET_EXTRA_ARGS`. No such flag exists (the real one is `--pod-max-pids`), so the kubelet exits with "unknown flag" right after start. `systemctl cat kubelet` shows the drop-in reads that file. Remove the flag and restart the kubelet.

On the broken worker:

```bash
cp -a "/var/tmp/cka-q3.kubelet-default" /etc/default/kubelet
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=cni-config-removed -->
#### CNI configuration removed from the node (`cni-config-removed`)

The Calico network config (`10-calico.conflist`) is gone from `/etc/cni/net.d`. containerd reports the network as not ready, so the node turns `NotReady` with "container runtime network not ready ... cni plugin not initialized" (`kubectl describe node`, `journalctl -u kubelet`). `ls /etc/cni/net.d` is empty. Calico writes that file itself: delete the `calico-node` Pod on that worker (`kubectl -n kube-system delete pod -l k8s-app=calico-node --field-selector spec.nodeName=<node>`) and its `install-cni` init container writes it again. Copying it from the healthy worker also works if you change its `nodename`. Then restart containerd and the kubelet.

On the broken worker:

```bash
mv "/var/tmp/cka-q3.cni/"*.conflist /etc/cni/net.d/
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=containerd-config-invalid -->
#### containerd config does not parse (`containerd-config-invalid`)

The last line of `/etc/containerd/config.toml` is an unclosed `[plugins` table, so containerd fails to start ("failed to load TOML"). The kubelet runs but cannot reach the runtime, and the node turns `NotReady`. `systemctl status containerd` and `journalctl -u containerd -n 20` point at the line. Remove it, then restart containerd and the kubelet.

On the broken worker:

```bash
cp -a "/var/tmp/cka-q3.containerd" /etc/containerd/config.toml
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=kubelet-conf-missing -->
#### kubelet kubeconfig file is missing (`kubelet-conf-missing`)

`/etc/kubernetes/kubelet.conf` is gone, so the kubelet cannot authenticate to the API server and the node turns `NotReady`. `journalctl -u kubelet` mentions the missing kubeconfig. A worker's kubelet.conf only names the API server, the cluster CA and the path of the node's own client certificate (`/var/lib/kubelet/pki/kubelet-client-current.pem`), so the healthy worker's copy works unchanged: copy it across through controlplane, then restart the kubelet.

On the broken worker:

```bash
mv "/var/tmp/cka-q3.kubelet-conf" /etc/kubernetes/kubelet.conf
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=kubelet-swap-on -->
#### Swap is enabled so the kubelet refuses to start (`kubelet-swap-on`)

A swap file (`/root/cka-swap`) is active and the kubelet runs with `failSwapOn: true`, so it exits rather than start with swap enabled. `swapon --show` lists the file; `journalctl -u kubelet` mentions swap. `swapoff` the file, remove it, and restart the kubelet.

On the broken worker:

```bash
swapoff /root/cka-swap 2>/dev/null || true
rm -f /root/cka-swap
sed -i '/^failSwapOn:/d' /var/lib/kubelet/config.yaml || true
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=cni-conflist-typo -->
#### CNI conflist is present but invalid JSON (`cni-conflist-typo`)

A file still sits in `/etc/cni/net.d`, but it is not valid JSON (and names a bogus plugin): `python3 -m json.tool <file>` fails to parse it, and the runtime network never becomes ready, so the node turns `NotReady`. Calico writes that file itself: delete the broken file and the `calico-node` Pod on that worker, and its `install-cni` init container writes a good one. Then restart containerd and the kubelet.

On the broken worker:

```bash
f=$(ls /etc/cni/net.d/*.conflist 2>/dev/null | head -1)
[[ -f "/var/tmp/cka-q3.cni-conflist" ]] || { echo "missing CNI backup" >&2; exit 1; }
if [[ -n "$f" ]]; then cp -a "/var/tmp/cka-q3.cni-conflist" "$f"; else cp -a "/var/tmp/cka-q3.cni-conflist" /etc/cni/net.d/10-calico.conflist; fi
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

### Question 4: Busiest node

```bash
kubectl top node --sort-by=cpu --no-headers | head -1 | awk '{print $1}' > /opt/course/top/node.txt
echo 'kubectl top node --sort-by=cpu' > /opt/course/top/nodes.sh
chown ubuntu:ubuntu /opt/course/top/*
```

### Question 5: Node drain is stuck

**The healthy setup**

- PodDisruptionBudget `${Q5_APP}-pdb` leaves room for an eviction (`minAvailable` below the replica count)
- the Pod template of `${Q5_APP}` lets replicas run on another worker (no `drain-lab=yes` nodeSelector)

This run's fault: **`${Q5_FAULT}`** on `${Q5_NODE}`.

<!-- fault Q5_FAULT=pdb-blocks-drain -->
#### PDB minAvailable equals replica count (`pdb-blocks-drain`)

PodDisruptionBudget `${Q5_APP}-pdb` sets `minAvailable: 2` while the Deployment also has 2 replicas, so every eviction is denied and `kubectl drain` hangs. The Pods are also pinned to the maintenance worker with `nodeSelector: drain-lab=yes`. Lower `minAvailable` (or delete the PDB), remove the nodeSelector so replicas can schedule elsewhere, then drain that worker.

```bash
kubectl -n "${Q5_NS}" patch pdb "${Q5_APP}-pdb" --type=merge -p '{"spec":{"minAvailable":0}}'
kubectl -n "${Q5_NS}" patch deployment "${Q5_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
kubectl -n "${Q5_NS}" rollout status "deployment/${Q5_APP}" --timeout=240s
kubectl drain "${Q5_NODE}" --ignore-daemonsets --delete-emptydir-data --force --timeout=180s
```
<!-- /fault -->

### Question 6: Restore etcd

```bash
etcdutl snapshot restore "${Q6_SNAPSHOT}" --data-dir "${Q6_DATADIR}"
sed -i -E "s#path: /var/lib/etcd\$#path: ${Q6_DATADIR}#" /etc/kubernetes/manifests/etcd.yaml
grep -q -- "path: ${Q6_DATADIR}" /etc/kubernetes/manifests/etcd.yaml
for _ in $(seq 1 240); do
  [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
  sleep 2
done
for _ in $(seq 1 120); do
  [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
  sleep 3
done
[[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]]
```

### Question 7: New Pods rejected in ${Q7_NS}

**The healthy setup**

- Deployment `${Q7_APP}`: `2` replicas of `nginx:1.27-alpine`, requesting `100m` CPU and `64Mi` memory, no limits, running as the image's default user
- namespace `${Q7_NS}` has no ResourceQuota or LimitRange that refuses those Pods, no restrictive Pod Security label, and no admission webhook applies to it

This run's fault: **`${Q7_FAULT}`**.

<!-- fault Q7_FAULT=quota-pods -->
#### ResourceQuota allows a single Pod (`quota-pods`)

ResourceQuota `tenant-quota` caps the namespace at `1` Pod, so the ReplicaSet's second create fails with "exceeded quota: tenant-quota". Delete the quota, or raise `pods` to at least `2`.

```bash
kubectl -n "${Q7_NS}" delete resourcequota tenant-quota
```
<!-- /fault -->

<!-- fault Q7_FAULT=quota-limits -->
#### ResourceQuota requires CPU limits the Pods do not set (`quota-limits`)

ResourceQuota `compute-quota` tracks `limits.cpu`, so every Pod in the namespace must declare a CPU limit. The Deployment sets none and may not be changed, so its Pods fail with "must specify limits.cpu". Delete the quota, or add a LimitRange that gives containers a default CPU limit.

```bash
kubectl -n "${Q7_NS}" delete resourcequota compute-quota
```
<!-- /fault -->

<!-- fault Q7_FAULT=limitrange-max -->
#### LimitRange maximum below the request (`limitrange-max`)

LimitRange `container-limits` caps containers at `50m` CPU. That max also becomes the default limit, which is below the `100m` request, so every Pod is refused at admission. Delete the LimitRange or raise its max to at least `100m`.

```bash
kubectl -n "${Q7_NS}" delete limitrange container-limits
```
<!-- /fault -->

<!-- fault Q7_FAULT=limitrange-min -->
#### LimitRange minimum above the request (`limitrange-min`)

LimitRange `container-floor` requires every container to request at least `128Mi` of memory, and the Pods request `64Mi`, so they fail with "minimum memory usage per Container is 128Mi". Delete the LimitRange or lower its minimum to `64Mi` or less.

```bash
kubectl -n "${Q7_NS}" delete limitrange container-floor
```
<!-- /fault -->

<!-- fault Q7_FAULT=pod-security -->
#### Namespace enforces the restricted Pod Security standard (`pod-security`)

Namespace `${Q7_NS}` carries the label `pod-security.kubernetes.io/enforce=restricted`. The nginx Pods run as root, allow privilege escalation and keep their capabilities, so Pod Security admission refuses them ("violates PodSecurity restricted:latest"); `kubectl get ns ${Q7_NS} --show-labels` shows the label. The Deployment may not change, so relax the namespace: remove the label, or enforce `baseline` instead.

```bash
kubectl label namespace "${Q7_NS}" pod-security.kubernetes.io/enforce-
```
<!-- /fault -->

<!-- fault Q7_FAULT=webhook -->
#### Validating webhook with a missing Service fails closed (`webhook`)

ValidatingWebhookConfiguration `${Q7_NS}-pod-policy` sends every Pod create in `${Q7_NS}` to Service `${Q7_NS}/pod-policy`, which does not exist. With `failurePolicy: Fail`, every create fails ("failed calling webhook ... service \"pod-policy\" not found"). Delete the webhook, or set its `failurePolicy` to `Ignore` if it must stay.

```bash
kubectl delete validatingwebhookconfiguration "${Q7_NS}-pod-policy"
```
<!-- /fault -->

### Question 8: Token for a ServiceAccount

```bash
kubectl -n ${Q8_NS} create token ci --duration=1h > /opt/course/token/ci.token
```

### Question 9: Back up etcd

```bash
mkdir -p "$(dirname "${Q9_BACKUP}")"
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key snapshot save "${Q9_BACKUP}"
mkdir -p "$(dirname "${Q9_STATUS_FILE}")"
ETCDCTL_API=3 etcdctl snapshot status "${Q9_BACKUP}" -w table > "${Q9_STATUS_FILE}"
```

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
kubectl -n "${Q10_NS}" delete pod "${Q10_CLAIM}-app" --wait=true
kubectl -n "${Q10_NS}" delete pvc "${Q10_CLAIM}" --wait=true
kubectl delete storageclass "${Q10_CLAIM}-local"
kubectl apply -f - <<< '{"apiVersion":"storage.k8s.io/v1","kind":"StorageClass","metadata":{"name":"'"${Q10_CLAIM}-local"'"},"provisioner":"rancher.io/local-path","volumeBindingMode":"WaitForFirstConsumer","reclaimPolicy":"Delete"}'
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q10_CLAIM}"'","namespace":"'"${Q10_NS}"'"},"spec":{"storageClassName":"'"${Q10_CLAIM}"'-local","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}}'
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q10_CLAIM}-app"'","namespace":"'"${Q10_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q10_CLAIM}"'"}}]}}'
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
kubectl -n "${Q10_NS}" delete pod "${Q10_CLAIM}-backup" --wait=true
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

### Question 11: LoadBalancer Service

```bash
kubectl -n ${Q11_NS} apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: web-lb
spec:
  type: LoadBalancer
  externalTrafficPolicy: Local
  selector: { app: web }
  ports:
    - port: 80
      targetPort: 80
      nodePort: ${Q11_NODEPORT}
EOF
```

### Question 12: One worker takes no Pods

**The healthy setup**

- both workers are labelled `tier=app`, schedulable and untainted
- the kubelet on each worker keeps the default `maxPods` (110)
- `spread` requires `tier=app` and at most one replica per node (required anti-affinity on `kubernetes.io/hostname`)

This run's fault: **`${Q12_FAULT}`** on `${Q12_NODE}`.

<!-- fault Q12_FAULT=cordoned -->
#### Worker cordoned (`cordoned`)

The worker is `Ready` but cordoned (`SchedulingDisabled`), so the scheduler places nothing new on it. `kubectl uncordon` it.

```bash
kubectl uncordon "${Q12_NODE}"
```
<!-- /fault -->

<!-- fault Q12_FAULT=taint-noschedule -->
#### NoSchedule taint on the worker (`taint-noschedule`)

The worker carries `dedicated=gpu:NoSchedule`, and `spread` does not tolerate it (and may not be changed), so the scheduler reports `untolerated taint`. Remove the taint: `kubectl taint node <node> dedicated-`.

```bash
kubectl taint node "${Q12_NODE}" dedicated-
```
<!-- /fault -->

<!-- fault Q12_FAULT=taint-noexecute -->
#### NoExecute taint on the worker (`taint-noexecute`)

The worker carries `maintenance=true:NoExecute`: nothing without a toleration may be scheduled there, and Pods already running were evicted. `kubectl describe node` lists it under Taints. Remove it: `kubectl taint node <node> maintenance-`.

```bash
kubectl taint node "${Q12_NODE}" maintenance-
```
<!-- /fault -->

<!-- fault Q12_FAULT=label-removed -->
#### Worker lost the label the Pods require (`label-removed`)

`spread` requires nodes labelled `tier=app`, and the worker no longer carries that label, so the scheduler reports `didn't match Pod's node affinity/selector`. `kubectl get nodes -L tier` shows the gap. Label the worker again.

```bash
kubectl label node "${Q12_NODE}" tier=app --overwrite
```
<!-- /fault -->

<!-- fault Q12_FAULT=max-pods -->
#### kubelet allows only two Pods (`max-pods`)

`maxPods: 2` in `/var/lib/kubelet/config.yaml` lets the worker run only two Pods, and its DaemonSet Pods already fill them. The node is `Ready`, but `kubectl describe node` shows `pods: 2` under Allocatable and the scheduler reports `Too many pods`. Remove the line (the default is 110) and restart the kubelet.

On the broken worker:

```bash
sed -i '/^maxPods:/d' /var/lib/kubelet/config.yaml
systemctl restart kubelet
```
<!-- /fault -->

### Question 13: Helm release ${Q13_REL}

```bash
printf 'podAnnotations:\n  owner: %s\n' "${Q13_VALUES_OWNER}" > "/opt/course/helm/${Q13_REL}-values.yaml"
chown ubuntu:ubuntu "/opt/course/helm/${Q13_REL}-values.yaml"
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo add lab http://controlplane:8879
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo update lab
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm -n "${Q13_NS}" install "${Q13_REL}" lab/webapp --version "${Q13_VERSION}" --set replicaCount=${Q13_REPLICAS_COUNT} -f "/opt/course/helm/${Q13_REL}-values.yaml" --wait --timeout 3m
```

### Question 14: Cluster certificates

```bash
mkdir -p "$(dirname "${Q14_EXPIRY}")"
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -enddate | cut -d= -f2 > "${Q14_EXPIRY}"
kubeadm certs renew apiserver
mv /etc/kubernetes/manifests/kube-apiserver.yaml /root/kube-apiserver.yaml
for _ in $(seq 1 60); do
  [[ -z "$(crictl ps -q --name kube-apiserver 2>/dev/null)" ]] && break
  sleep 2
done
mv /root/kube-apiserver.yaml /etc/kubernetes/manifests/kube-apiserver.yaml
for _ in $(seq 1 240); do
  [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
  sleep 2
done
for _ in $(seq 1 120); do
  [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
  sleep 3
done
```

### Question 15: Name resolution broken

**The healthy setup**

- CoreDNS (Deployment `kube-system/coredns`) runs `2` ready replicas behind Service `kube-dns` (`10.96.0.10`), port `53` to container port `53`
- its ConfigMap `coredns` holds key `Corefile`, which serves `cluster.local` and forwards other names to `/etc/resolv.conf`
- ClusterRoleBinding `system:coredns` lets ServiceAccount `kube-system:coredns` watch Services, EndpointSlices and Namespaces
- Pod `${Q15_CLIENT}` uses the default `dnsPolicy` (`ClusterFirst`)

This run's fault: **`${Q15_FAULT}`**.

<!-- fault Q15_FAULT=corefile-typo -->
#### Corefile typo crashes CoreDNS (`corefile-typo`)

The Corefile says `forwrd` instead of `forward`. CoreDNS keeps a running config when a reload fails, but once its Pods restart they exit with "Unknown directive 'forwrd'" and crash-loop, so nothing answers DNS. Fix the word in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forwrd \. /etc/resolv\.conf#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q15_FAULT=scaled-to-zero -->
#### CoreDNS scaled to zero (`scaled-to-zero`)

Deployment `coredns` has `0` replicas, so Service `kube-dns` has no endpoints and every lookup times out. Scale it back to `2`.

```bash
kubectl -n kube-system scale deployment/coredns --replicas=2
```
<!-- /fault -->

<!-- fault Q15_FAULT=cluster-domain -->
#### Wrong cluster domain in the Corefile (`cluster-domain`)

The `kubernetes` plugin serves `cluster.lab` instead of `cluster.local`. CoreDNS runs fine, but it forwards every `*.cluster.local` name upstream, which answers NXDOMAIN. Set the zone back to `cluster.local` in ConfigMap `coredns`.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#kubernetes cluster\.lab #kubernetes cluster.local #' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'kubernetes cluster\.local ' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q15_FAULT=kube-dns-selector -->
#### kube-dns Service selects no Pod (`kube-dns-selector`)

Service `kube-dns` selects `k8s-app=kube-dns-v2`, which no Pod carries. CoreDNS is healthy, but 10.96.0.10 has no endpoints, so lookups time out. Set the selector back to `k8s-app=kube-dns`.

```bash
kubectl -n kube-system patch service kube-dns -p '{"spec":{"selector":{"k8s-app":"kube-dns"}}}'
```
<!-- /fault -->

<!-- fault Q15_FAULT=client-dns-policy -->
#### Client Pod bypasses the cluster DNS (`client-dns-policy`)

Pod `${Q15_CLIENT}` has `dnsPolicy: Default`, so it inherits the node's resolv.conf: no cluster nameserver and no cluster search domains. The field cannot be changed on a running Pod; recreate `${Q15_CLIENT}` without it (the default is `ClusterFirst`).

```bash
kubectl -n "${Q15_NS}" delete pod "${Q15_CLIENT}" --ignore-not-found --wait=true >/dev/null
kubectl -n "${Q15_NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q15_CLIENT}"'"},"spec":{"containers":[{"name":"shell","image":"busybox:1.36","command":["sleep","infinity"]}]}}'
if ! kubectl -n "${Q15_NS}" wait --for=condition=Ready "pod/${Q15_CLIENT}" --timeout=180s; then
  kubectl -n "${Q15_NS}" describe "pod/${Q15_CLIENT}" >&2 || true
  exit 1
fi
```
<!-- /fault -->

<!-- fault Q15_FAULT=corefile-loop -->
#### CoreDNS forwards to itself (`corefile-loop`)

The Corefile says `forward . 127.0.0.1`, so CoreDNS forwards unknown names to itself. The `loop` plugin spots its own probe coming back, logs "Loop (127.0.0.1:...) detected" and exits, so the Pods crash-loop. Set `forward . /etc/resolv.conf` again in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forward \. 127\.0\.0\.1#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q15_FAULT=coredns-rbac -->
#### CoreDNS lost its RBAC binding (`coredns-rbac`)

ClusterRoleBinding `system:coredns` is gone, so the CoreDNS service account may not list Services, EndpointSlices or Namespaces. New Pods log "forbidden" and "plugin/ready: Still waiting on: kubernetes", never become ready, and Service `kube-dns` has no endpoints. Bind ClusterRole `system:coredns` to service account `kube-system:coredns` again and restart the Deployment.

```bash
kubectl create clusterrolebinding system:coredns --clusterrole=system:coredns --serviceaccount=kube-system:coredns
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q15_FAULT=kube-dns-target-port -->
#### kube-dns Service targets the wrong port (`kube-dns-target-port`)

Ports `dns` and `dns-tcp` of Service `kube-dns` have `targetPort: 5353`. CoreDNS is healthy and the Service has endpoints, but nothing listens on 5353, so lookups time out. Compare `kubectl -n kube-system get endpointslices -l k8s-app=kube-dns` with the container ports, and set both target ports back to `53`.

```bash
kubectl -n kube-system get service kube-dns -o yaml | sed -E 's/targetPort: 5353$/targetPort: 53/' | kubectl replace -f - >/dev/null
[ "$(kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.ports[*].targetPort}' | tr ' ' '\n' | grep -cx 53)" = 2 ] || { echo "could not edit Service kube-dns" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q15_FAULT=corefile-key -->
#### Corefile key renamed in the ConfigMap (`corefile-key`)

ConfigMap `coredns` holds the config under key `corefile`, but the Deployment mounts key `Corefile`. New Pods stay in `ContainerCreating` and `kubectl describe` shows "configmap references non-existent config key: Corefile". Rename the key back to `Corefile` and restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's/^  corefile: /  Corefile: /' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -q kubernetes || { echo "could not rename the Corefile key" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q15_FAULT=coredns-image -->
#### CoreDNS image tag does not exist (`coredns-image`)

Deployment `coredns` runs an image tag that does not exist (`v0.0.0`), so its Pods are stuck in `ErrImagePull`/`ImagePullBackOff` and Service `kube-dns` has no ready endpoints. `kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows the failed pull. Set the image back to the tag the control plane uses (`kubeadm config images list` shows it), e.g. `kubectl -n kube-system set image deployment/coredns coredns=registry.k8s.io/coredns/coredns:<tag>`.

```bash
kubectl -n kube-system set image deployment/coredns coredns="$(cat "/var/tmp/cka-q15.image")"
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q15.strategy")}}" >/dev/null
```
<!-- /fault -->

<!-- fault Q15_FAULT=coredns-config-volume -->
#### CoreDNS mounts a ConfigMap that does not exist (`coredns-config-volume`)

Volume `config-volume` of Deployment `coredns` refers to ConfigMap `coredns-custom`, which does not exist. The new Pods stay in `ContainerCreating` with "configmap \"coredns-custom\" not found" in `kubectl describe`. Point the volume back at ConfigMap `coredns`.

```bash
kubectl -n kube-system patch deployment coredns --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"coredns"}]'
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q15.strategy")}}" >/dev/null
```
<!-- /fault -->

<!-- fault Q15_FAULT=coredns-memory-limit -->
#### CoreDNS memory limit too small (`coredns-memory-limit`)

Deployment `coredns` limits the container to `8Mi` of memory, so CoreDNS is OOMKilled as it starts and its Pods crash-loop (`kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows `OOMKilled`). Restore the kubeadm defaults: memory limit `170Mi`, request `70Mi`.

```bash
kubectl -n kube-system set resources deployment/coredns -c coredns --limits=memory=170Mi --requests=memory=70Mi
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q15.strategy")}}" >/dev/null
```
<!-- /fault -->

<!-- fault Q15_FAULT=coredns-hosts-plugin -->
#### Corefile hosts plugin maps web to loopback (`coredns-hosts-plugin`)

The Corefile injects a `hosts` block that maps `web` — and the search-expanded names the resolver actually asks for first, such as `web.<namespace>.svc.cluster.local` — to `127.0.0.1`, so name resolution returns loopback instead of the Service IP while CoreDNS stays Ready. Remove that `hosts` block from ConfigMap `coredns` and restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' > /tmp/cka-Corefile
python3 -c 'import re; from pathlib import Path; t=Path("/tmp/cka-Corefile").read_text(); t=re.sub(r"hosts \{[^}]*\}\s*", "", t, count=1); Path("/tmp/cka-Corefile").write_text(t)'
kubectl -n kube-system create configmap coredns --from-file=Corefile=/tmp/cka-Corefile -o yaml --dry-run=client | kubectl -n kube-system apply -f - >/dev/null
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q15_FAULT=coredns-ready-port -->
#### CoreDNS readiness probe hits the wrong port (`coredns-ready-port`)

The CoreDNS readiness probe targets port `8182`, but the `ready` plugin listens on `8181`, so Pods never become Ready and Service `kube-dns` has no endpoints. Point the probe back at `8181`.

```bash
kubectl -n kube-system patch deployment coredns --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":8181}]'
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q15.strategy")}}" >/dev/null
```
<!-- /fault -->

### Question 16: VPA for ${Q16_APP} not working

**The healthy setup**

- `${Q16_APP}-vpa` targets Deployment `${Q16_APP}` with update mode `Recreate` and manages container `web`
- the recommender, updater and admission controller run in namespace `vpa`, with their RBAC intact
- Pods the VPA changed carry its `vpaUpdates` annotation

This run's fault: **`${Q16_FAULT}`**.

<!-- fault Q16_FAULT=recommender-down -->
#### VPA recommender scaled to zero (`recommender-down`)

The `vpa/vpa-recommender` Deployment has `0` replicas, so nothing computes recommendations and `${Q16_APP}-vpa` has no Recommendation in its status. Scale the recommender back to `1`, wait for the recommendation (about a minute), then `kubectl -n ${Q16_NS} rollout restart deployment ${Q16_APP}` so new Pods get it.

```bash
kubectl -n vpa scale "deployment/vpa-recommender" --replicas=1
kubectl -n vpa rollout status "deployment/vpa-recommender" --timeout=180s
for _ in $(seq 1 120); do
  kubectl -n "${Q16_NS}" get vpa "${Q16_APP}-vpa" -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' 2>/dev/null | grep -q . && break
  sleep 2
done
kubectl -n "${Q16_NS}" rollout restart "deployment/${Q16_APP}"
```
<!-- /fault -->

<!-- fault Q16_FAULT=admission-down -->
#### VPA admission controller scaled to zero (`admission-down`)

`${Q16_APP}-vpa` has a recommendation, but the `vpa/vpa-admission-controller` Deployment has `0` replicas. Its webhook fails open (failurePolicy Ignore), so Pods are created unchanged, and the updater stops evicting while the admission controller is missing. Scale it back to `1`, then `kubectl -n ${Q16_NS} rollout restart deployment ${Q16_APP}`.

```bash
kubectl -n vpa scale "deployment/vpa-admission-controller" --replicas=1
kubectl -n vpa rollout status "deployment/vpa-admission-controller" --timeout=180s
for _ in $(seq 1 120); do
  kubectl -n "${Q16_NS}" get vpa "${Q16_APP}-vpa" -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' 2>/dev/null | grep -q . && break
  sleep 2
done
kubectl -n "${Q16_NS}" rollout restart "deployment/${Q16_APP}"
```
<!-- /fault -->

<!-- fault Q16_FAULT=target-name -->
#### VPA targets a missing Deployment (`target-name`)

`spec.targetRef.name` is `${Q16_APP}-v1`, which does not exist, so the VPA matches no Pods and never recommends anything (`kubectl describe vpa` shows a ConfigUnsupported condition). Point it at Deployment `${Q16_APP}`, wait for the recommendation, then restart the Deployment.

```bash
kubectl -n "${Q16_NS}" patch vpa "${Q16_APP}-vpa" --type=merge -p '{"spec":{"targetRef":{"name":"'"${Q16_APP}"'"}}}'
for _ in $(seq 1 120); do
  kubectl -n "${Q16_NS}" get vpa "${Q16_APP}-vpa" -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' 2>/dev/null | grep -q . && break
  sleep 2
done
kubectl -n "${Q16_NS}" rollout restart "deployment/${Q16_APP}"
```
<!-- /fault -->

<!-- fault Q16_FAULT=mode-off -->
#### Update mode is Off (`mode-off`)

`${Q16_APP}-vpa` recommends resources but its update mode is `Off`: the VPA only reports and never changes Pods. Set `updatePolicy.updateMode` to `Recreate`, then restart the Deployment so the admission controller sets the requests.

```bash
kubectl -n "${Q16_NS}" patch vpa "${Q16_APP}-vpa" --type=merge -p '{"spec":{"updatePolicy":{"updateMode":"Recreate"}}}'
for _ in $(seq 1 120); do
  kubectl -n "${Q16_NS}" get vpa "${Q16_APP}-vpa" -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' 2>/dev/null | grep -q . && break
  sleep 2
done
kubectl -n "${Q16_NS}" rollout restart "deployment/${Q16_APP}"
```
<!-- /fault -->

<!-- fault Q16_FAULT=container-off -->
#### Container policy excludes web (`container-off`)

A container policy sets `mode: "Off"` for `web`, the only container, so the VPA neither recommends nor changes anything for it. Remove the policy (or set its mode to `Auto`), then restart the Deployment.

```bash
kubectl -n "${Q16_NS}" patch vpa "${Q16_APP}-vpa" --type=json -p '[{"op":"remove","path":"/spec/resourcePolicy"}]'
for _ in $(seq 1 120); do
  kubectl -n "${Q16_NS}" get vpa "${Q16_APP}-vpa" -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' 2>/dev/null | grep -q . && break
  sleep 2
done
kubectl -n "${Q16_NS}" rollout restart "deployment/${Q16_APP}"
```
<!-- /fault -->

<!-- fault Q16_FAULT=recommender-rbac -->
#### Recommender cannot write VPA status (`recommender-rbac`)

The recommender runs and computes recommendations, but ClusterRoleBinding `vpa-status-actor` is gone, so it is forbidden to write them into VPA status (`kubectl -n vpa logs deploy/vpa-recommender` shows "forbidden ... verticalpodautoscalers/status"). Recreate the binding of ClusterRole `vpa-status-actor` to ServiceAccount `vpa:vpa-recommender`, then restart the Deployment once the recommendation appears.

```bash
kubectl create clusterrolebinding vpa-status-actor --clusterrole=vpa-status-actor --serviceaccount=vpa:vpa-recommender
kubectl -n vpa rollout restart deployment/vpa-recommender
kubectl -n vpa rollout status deployment/vpa-recommender --timeout=180s
for _ in $(seq 1 120); do
  kubectl -n "${Q16_NS}" get vpa "${Q16_APP}-vpa" -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' 2>/dev/null | grep -q . && break
  sleep 2
done
kubectl -n "${Q16_NS}" rollout restart "deployment/${Q16_APP}"
```
<!-- /fault -->

### Question 17: Pods cannot be created in ${Q17_NS}

**The healthy setup**

- no admission webhook rejects Pod creates in `${Q17_NS}`: `orphan-validate` is a leftover whose Service does not exist
- Deployment `${Q17_APP}`: `2` replicas of `nginx:1.27-alpine`

This run's fault: **`${Q17_FAULT}`**.

<!-- fault Q17_FAULT=webhook-orphan-fail -->
#### Orphan validating webhook fails closed (`webhook-orphan-fail`)

ValidatingWebhookConfiguration `orphan-validate` selects namespaces labelled `webhook-lab=true` and calls Service `${Q17_NS}/missing-webhook-svc`, which does not exist. With `failurePolicy: Fail`, every Pod create times out and the ReplicaSet stays at 0 ready Pods (`FailedCreate` / webhook errors in the Events). Delete the orphan webhook (or point it at a working endpoint).

```bash
kubectl delete validatingwebhookconfiguration orphan-validate --ignore-not-found
```
<!-- /fault -->

## Solution

### Question 1: Back up etcd

```bash
mkdir -p "$(dirname "${Q1_BACKUP}")"
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key snapshot save "${Q1_BACKUP}"
```

### Question 2: ${Q2_APP} unreachable through the ingress

This run's fault: **`${Q2_FAULT}`**.

<!-- fault Q2_FAULT=ingress-service-name -->
#### Ingress points at a Service that does not exist (`ingress-service-name`)

The Ingress backend is Service `${Q2_APP}-svc`, which does not exist, so Traefik has nothing to send `www.${Q2_NS}.lab` to. `kubectl describe ingress` shows the missing backend. Point it back at `${Q2_APP}`.

```bash
kubectl -n "${Q2_NS}" patch ingress "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"'"${Q2_APP}"'"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-service-port -->
#### Ingress uses the wrong Service port (`ingress-service-port`)

The Ingress sends traffic to port `8080` of Service `${Q2_APP}`, which only has port `80`. Set the backend port back to `80`.

```bash
kubectl -n "${Q2_NS}" patch ingress "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/port/number","value":80}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-class -->
#### Ingress asks for a class that does not exist (`ingress-class`)

`ingressClassName` is `nginx`, but the only IngressClass is `traefik` (`kubectl get ingressclass`). No controller claims the Ingress, so it has no address and nothing routes `www.${Q2_NS}.lab`. Set the class back to `traefik`.

```bash
kubectl -n "${Q2_NS}" patch ingress "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/ingressClassName","value":"traefik"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-path -->
#### Ingress path matches only one exact page (`ingress-path`)

The Ingress path is `/index.html` with `pathType: Exact`, so only that one URL matches and `/` gets Traefik's 404. Set the path back to `/` with `pathType: Prefix`.

```bash
kubectl -n "${Q2_NS}" patch ingress "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"},{"op":"replace","path":"/spec/rules/0/http/paths/0/pathType","value":"Prefix"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=route-parent -->
#### HTTPRoute attached to a Gateway that does not exist (`route-parent`)

The HTTPRoute's `parentRefs` names Gateway `web-gateway`, which does not exist, so no Gateway accepts the route (its status lists no accepted parent). `kubectl -n traefik get gateway` shows the real name, `traefik-gateway`.

```bash
kubectl -n "${Q2_NS}" patch httproute "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/name","value":"traefik-gateway"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=route-section -->
#### HTTPRoute names a listener the Gateway does not have (`route-section`)

`sectionName: websecure` asks for a listener that `traefik-gateway` does not have; its only listener is `web`. The route's `Accepted` condition is `False` with reason `NoMatchingParent`. Set `sectionName` back to `web`.

```bash
kubectl -n "${Q2_NS}" patch httproute "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/sectionName","value":"web"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=route-backend-port -->
#### HTTPRoute uses the wrong Service port (`route-backend-port`)

The HTTPRoute sends traffic to port `8080` of Service `${Q2_APP}`, which only has port `80`. The route's `ResolvedRefs` condition is `False`. Set the backendRef port back to `80`.

```bash
kubectl -n "${Q2_NS}" patch httproute "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-host-typo -->
#### Ingress rule has a misspelled host (`ingress-host-typo`)

The Ingress rule's host is `ww.${Q2_NS}.lab`, not `www.${Q2_NS}.lab`. Traefik routes only matching Host headers, so `www.${Q2_NS}.lab` gets a 404. `kubectl -n ${Q2_NS} get ingress` shows the host: set it back to `www.${Q2_NS}.lab`.

```bash
kubectl -n "${Q2_NS}" patch ingress "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/host","value":"www.'"${Q2_NS}"'.lab"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=route-hostname-typo -->
#### HTTPRoute has a misspelled hostname (`route-hostname-typo`)

The HTTPRoute's hostname is `apl.${Q2_NS}.lab`, not `api.${Q2_NS}.lab`, so requests for `api.${Q2_NS}.lab` match no route and get a 404. `kubectl -n ${Q2_NS} get httproute` shows the hostname: set it back to `api.${Q2_NS}.lab`.

```bash
kubectl -n "${Q2_NS}" patch httproute "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/hostnames/0","value":"api.'"${Q2_NS}"'.lab"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=route-parent-namespace -->
#### HTTPRoute looks for the Gateway in its own namespace (`route-parent-namespace`)

The HTTPRoute's `parentRefs` has no `namespace`, so it defaults to the route's own namespace `${Q2_NS}`, where there is no `traefik-gateway`. The route has no accepted parent. Add `namespace: traefik` to the parentRef.

```bash
kubectl -n "${Q2_NS}" patch httproute "${Q2_APP}" --type=json -p '[{"op":"add","path":"/spec/parentRefs/0/namespace","value":"traefik"}]'
```
<!-- /fault -->

### Question 3: Helm release ${Q3_REL}

```bash
printf 'podAnnotations:\n  owner: %s\n' "${Q3_VALUES_OWNER}" > "/opt/course/helm/${Q3_REL}-values.yaml"
chown ubuntu:ubuntu "/opt/course/helm/${Q3_REL}-values.yaml"
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo add lab http://controlplane:8879
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo update lab
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm -n "${Q3_NS}" install "${Q3_REL}" lab/webapp --version "${Q3_VERSION}" --set replicaCount=${Q3_REPLICAS_COUNT} --set service.type=NodePort -f "/opt/course/helm/${Q3_REL}-values.yaml" --wait --timeout 3m
```

## Solution

### Question 1: Service ${Q1_APP} unreachable

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=selector-mismatch -->
#### Service selector matches no Pod (`selector-mismatch`)

The Service selects `app=${Q1_APP}-v2`, which no Pod carries, so it has no endpoints. Set the selector back to `app=${Q1_APP}`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" -p '{"spec":{"selector":{"app":"'"${Q1_APP}"'"}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=target-port -->
#### Service targetPort points nowhere (`target-port`)

The Service forwards to port 8080, where nginx does not listen: the endpoints exist but connections are refused. Set `targetPort` back to `http`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=named-port -->
#### Container port renamed (`named-port`)

The container port is named `web` instead of `http`, so the Service's named `targetPort: http` resolves to nothing and the endpoint slices list no ports. Rename the port (and the probe that refers to it) back to `http`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"http"},{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT=network-policy -->
#### NetworkPolicy blocks the traffic (`network-policy`)

NetworkPolicy `${Q1_APP}-ingress` only lets in Pods labelled `role=monitoring`, so the client is dropped even though the Service and endpoints look fine. Delete it, or allow all Pods of the namespace on port 80.

```bash
kubectl -n "${Q1_NS}" delete networkpolicy "${Q1_APP}-ingress"
```
<!-- /fault -->

<!-- fault Q1_FAULT=not-ready -->
#### Readiness probe fails, so there are no ready endpoints (`not-ready`)

The readiness probe requests `/ready`, which returns 404, so the Pods never become ready and the Service has only not-ready endpoints. Point the probe back at `/`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->

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

### Question 3: Name resolution broken

This run's fault: **`${Q3_FAULT}`**.

<!-- fault Q3_FAULT=corefile-typo -->
#### Corefile typo crashes CoreDNS (`corefile-typo`)

The Corefile says `forwrd` instead of `forward`. CoreDNS keeps a running config when a reload fails, but once its Pods restart they exit with "Unknown directive 'forwrd'" and crash-loop, so nothing answers DNS. Fix the word in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forwrd \. /etc/resolv\.conf#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q3_FAULT=scaled-to-zero -->
#### CoreDNS scaled to zero (`scaled-to-zero`)

Deployment `coredns` has `0` replicas, so Service `kube-dns` has no endpoints and every lookup times out. Scale it back to `2`.

```bash
kubectl -n kube-system scale deployment/coredns --replicas=2
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q3_FAULT=cluster-domain -->
#### Wrong cluster domain in the Corefile (`cluster-domain`)

The `kubernetes` plugin serves `cluster.lab` instead of `cluster.local`. CoreDNS runs fine, but it forwards every `*.cluster.local` name upstream, which answers NXDOMAIN. Set the zone back to `cluster.local` in ConfigMap `coredns`.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#kubernetes cluster\.lab #kubernetes cluster.local #' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'kubernetes cluster\.local ' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q3_FAULT=kube-dns-selector -->
#### kube-dns Service selects no Pod (`kube-dns-selector`)

Service `kube-dns` selects `k8s-app=kube-dns-v2`, which no Pod carries. CoreDNS is healthy, but 10.96.0.10 has no endpoints, so lookups time out. Set the selector back to `k8s-app=kube-dns`.

```bash
kubectl -n kube-system patch service kube-dns -p '{"spec":{"selector":{"k8s-app":"kube-dns"}}}'
```
<!-- /fault -->

<!-- fault Q3_FAULT=client-dns-policy -->
#### Client Pod bypasses the cluster DNS (`client-dns-policy`)

Pod `client` has `dnsPolicy: Default`, so it inherits the node's resolv.conf: no cluster nameserver and no cluster search domains. The field cannot be changed on a running Pod; recreate `client` without it (the default is `ClusterFirst`).

```bash
kubectl -n "${Q3_NS}" delete pod client --ignore-not-found --wait=true >/dev/null
kubectl -n "${Q3_NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"client"},"spec":{"containers":[{"name":"shell","image":"busybox:1.36","command":["sleep","infinity"]}]}}'
if ! kubectl -n "${Q3_NS}" wait --for=condition=Ready pod/client --timeout=180s; then
  kubectl -n "${Q3_NS}" describe pod/client >&2 || true
  exit 1
fi
```
<!-- /fault -->

<!-- fault Q3_FAULT=corefile-loop -->
#### CoreDNS forwards to itself (`corefile-loop`)

The Corefile says `forward . 127.0.0.1`, so CoreDNS forwards unknown names to itself. The `loop` plugin spots its own probe coming back, logs "Loop (127.0.0.1:...) detected" and exits, so the Pods crash-loop. Set `forward . /etc/resolv.conf` again in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forward \. 127\.0\.0\.1#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q3_FAULT=coredns-rbac -->
#### CoreDNS lost its RBAC binding (`coredns-rbac`)

ClusterRoleBinding `system:coredns` is gone, so the CoreDNS service account may not list Services, EndpointSlices or Namespaces. New Pods log "forbidden" and "plugin/ready: Still waiting on: kubernetes", never become ready, and Service `kube-dns` has no endpoints. Bind ClusterRole `system:coredns` to service account `kube-system:coredns` again and restart the Deployment.

```bash
kubectl create clusterrolebinding system:coredns --clusterrole=system:coredns --serviceaccount=kube-system:coredns
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q3_FAULT=kube-dns-target-port -->
#### kube-dns Service targets the wrong port (`kube-dns-target-port`)

Ports `dns` and `dns-tcp` of Service `kube-dns` have `targetPort: 5353`. CoreDNS is healthy and the Service has endpoints, but nothing listens on 5353, so lookups time out. Compare `kubectl -n kube-system get endpointslices -l k8s-app=kube-dns` with the container ports, and set both target ports back to `53`.

```bash
kubectl -n kube-system get service kube-dns -o yaml | sed -E 's/targetPort: 5353$/targetPort: 53/' | kubectl replace -f - >/dev/null
[ "$(kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.ports[*].targetPort}' | tr ' ' '\n' | grep -cx 53)" = 2 ] || { echo "could not edit Service kube-dns" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q3_FAULT=corefile-key -->
#### Corefile key renamed in the ConfigMap (`corefile-key`)

ConfigMap `coredns` holds the config under key `corefile`, but the Deployment mounts key `Corefile`. New Pods stay in `ContainerCreating` and `kubectl describe` shows "configmap references non-existent config key: Corefile". Rename the key back to `Corefile` and restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's/^  corefile: /  Corefile: /' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -q kubernetes || { echo "could not rename the Corefile key" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

### Question 4: Service ${Q4_APP} unreachable

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

### Question 5: Frontend cannot reach ${Q5_APP}

This run's fault: **`${Q5_FAULT}`**.

<!-- fault Q5_FAULT=dns-egress-port -->
#### DNS egress allowed on the wrong port (`dns-egress-port`)

`allow-dns` opens egress on port 5353 instead of 53, so DNS queries are dropped: `nslookup` times out and `wget http://...` fails with `bad address`, while wget to the Service IP works. Set the ports back to 53 UDP and TCP.

```bash
kubectl -n "${Q5_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=dns-namespace-selector -->
#### DNS egress selects a namespace label that does not exist (`dns-namespace-selector`)

`allow-dns` selects namespaces labelled `name=kube-system`, but `kube-system` only carries `kubernetes.io/metadata.name=kube-system` (`kubectl get ns kube-system --show-labels`). No DNS Pod matches, so names do not resolve. Select `kubernetes.io/metadata.name: kube-system`.

```bash
kubectl -n "${Q5_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/namespaceSelector/matchLabels","value":{"kubernetes.io/metadata.name":"kube-system"}}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=ingress-port -->
#### Ingress allowed on the wrong port (`ingress-port`)

`${Q5_APP}-ingress` lets frontends in on port 8080, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the port to 80.

```bash
kubectl -n "${Q5_NS}" patch networkpolicy "${Q5_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=ingress-from-label -->
#### Ingress allows a label no Pod carries (`ingress-from-label`)

`${Q5_APP}-ingress` allows Pods labelled `role=front-end`, but the client is `role=frontend` (`kubectl get pods --show-labels`). Fix the label in the policy.

```bash
kubectl -n "${Q5_NS}" patch networkpolicy "${Q5_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0/podSelector/matchLabels","value":{"role":"frontend"}}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=egress-to-label -->
#### Frontend egress points at the wrong Pods (`egress-to-label`)

`frontend-egress` only lets frontends connect to Pods labelled `app=${Q5_APP}-v2`, which do not exist, so the client's own egress is dropped even though `${Q5_APP}-ingress` would accept it. Select `app=${Q5_APP}`.

```bash
kubectl -n "${Q5_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"app":"'"${Q5_APP}"'"}}]'
```
<!-- /fault -->

### Question 6: Name resolution broken

This run's fault: **`${Q6_FAULT}`**.

<!-- fault Q6_FAULT=corefile-typo -->
#### Corefile typo crashes CoreDNS (`corefile-typo`)

The Corefile says `forwrd` instead of `forward`. CoreDNS keeps a running config when a reload fails, but once its Pods restart they exit with "Unknown directive 'forwrd'" and crash-loop, so nothing answers DNS. Fix the word in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forwrd \. /etc/resolv\.conf#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q6_FAULT=scaled-to-zero -->
#### CoreDNS scaled to zero (`scaled-to-zero`)

Deployment `coredns` has `0` replicas, so Service `kube-dns` has no endpoints and every lookup times out. Scale it back to `2`.

```bash
kubectl -n kube-system scale deployment/coredns --replicas=2
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q6_FAULT=cluster-domain -->
#### Wrong cluster domain in the Corefile (`cluster-domain`)

The `kubernetes` plugin serves `cluster.lab` instead of `cluster.local`. CoreDNS runs fine, but it forwards every `*.cluster.local` name upstream, which answers NXDOMAIN. Set the zone back to `cluster.local` in ConfigMap `coredns`.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#kubernetes cluster\.lab #kubernetes cluster.local #' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'kubernetes cluster\.local ' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q6_FAULT=kube-dns-selector -->
#### kube-dns Service selects no Pod (`kube-dns-selector`)

Service `kube-dns` selects `k8s-app=kube-dns-v2`, which no Pod carries. CoreDNS is healthy, but 10.96.0.10 has no endpoints, so lookups time out. Set the selector back to `k8s-app=kube-dns`.

```bash
kubectl -n kube-system patch service kube-dns -p '{"spec":{"selector":{"k8s-app":"kube-dns"}}}'
```
<!-- /fault -->

<!-- fault Q6_FAULT=client-dns-policy -->
#### Client Pod bypasses the cluster DNS (`client-dns-policy`)

Pod `client` has `dnsPolicy: Default`, so it inherits the node's resolv.conf: no cluster nameserver and no cluster search domains. The field cannot be changed on a running Pod; recreate `client` without it (the default is `ClusterFirst`).

```bash
kubectl -n "${Q6_NS}" delete pod client --ignore-not-found --wait=true >/dev/null
kubectl -n "${Q6_NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"client"},"spec":{"containers":[{"name":"shell","image":"busybox:1.36","command":["sleep","infinity"]}]}}'
if ! kubectl -n "${Q6_NS}" wait --for=condition=Ready pod/client --timeout=180s; then
  kubectl -n "${Q6_NS}" describe pod/client >&2 || true
  exit 1
fi
```
<!-- /fault -->

<!-- fault Q6_FAULT=corefile-loop -->
#### CoreDNS forwards to itself (`corefile-loop`)

The Corefile says `forward . 127.0.0.1`, so CoreDNS forwards unknown names to itself. The `loop` plugin spots its own probe coming back, logs "Loop (127.0.0.1:...) detected" and exits, so the Pods crash-loop. Set `forward . /etc/resolv.conf` again in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forward \. 127\.0\.0\.1#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q6_FAULT=coredns-rbac -->
#### CoreDNS lost its RBAC binding (`coredns-rbac`)

ClusterRoleBinding `system:coredns` is gone, so the CoreDNS service account may not list Services, EndpointSlices or Namespaces. New Pods log "forbidden" and "plugin/ready: Still waiting on: kubernetes", never become ready, and Service `kube-dns` has no endpoints. Bind ClusterRole `system:coredns` to service account `kube-system:coredns` again and restart the Deployment.

```bash
kubectl create clusterrolebinding system:coredns --clusterrole=system:coredns --serviceaccount=kube-system:coredns
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q6_FAULT=kube-dns-target-port -->
#### kube-dns Service targets the wrong port (`kube-dns-target-port`)

Ports `dns` and `dns-tcp` of Service `kube-dns` have `targetPort: 5353`. CoreDNS is healthy and the Service has endpoints, but nothing listens on 5353, so lookups time out. Compare `kubectl -n kube-system get endpointslices -l k8s-app=kube-dns` with the container ports, and set both target ports back to `53`.

```bash
kubectl -n kube-system get service kube-dns -o yaml | sed -E 's/targetPort: 5353$/targetPort: 53/' | kubectl replace -f - >/dev/null
[ "$(kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.ports[*].targetPort}' | tr ' ' '\n' | grep -cx 53)" = 2 ] || { echo "could not edit Service kube-dns" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q6_FAULT=corefile-key -->
#### Corefile key renamed in the ConfigMap (`corefile-key`)

ConfigMap `coredns` holds the config under key `corefile`, but the Deployment mounts key `Corefile`. New Pods stay in `ContainerCreating` and `kubectl describe` shows "configmap references non-existent config key: Corefile". Rename the key back to `Corefile` and restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's/^  corefile: /  Corefile: /' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -q kubernetes || { echo "could not rename the Corefile key" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

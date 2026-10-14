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

<!-- fault Q1_FAULT=selector-extra-label -->
#### Service selector requires an extra label (`selector-extra-label`)

The Service selects `app=${Q1_APP}` **and** `tier=web`. The Pods carry only `app=${Q1_APP}`, so nothing matches and the Service has no endpoints (`kubectl -n ${Q1_NS} get endpointslices -l kubernetes.io/service-name=${Q1_APP}`). Remove `tier` from the selector.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/selector/tier"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=service-port -->
#### Service listens on the wrong port (`service-port`)

The Service listens on port `8080`, so `http://${Q1_APP}` (port 80) is refused even though the endpoints are fine. `kubectl -n ${Q1_NS} get svc ${Q1_APP}` shows `8080/TCP`: set `port` back to `80`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=service-protocol -->
#### Service port uses UDP (`service-protocol`)

The Service port is `80/UDP`, but HTTP needs TCP, so TCP connections to the Service IP go nowhere. `kubectl -n ${Q1_NS} get svc ${Q1_APP}` shows the protocol: set it back to `TCP`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/protocol","value":"TCP"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=kube-proxy-down -->
#### kube-proxy runs on no node (`kube-proxy-down`)

Service, endpoints and Pods all look right, and the client can reach a Pod IP directly, but not the Service IP. The `kube-system/kube-proxy` DaemonSet has a nodeSelector `kube-proxy=disabled` that no node matches, so no kube-proxy runs and the Service's new endpoints are never programmed into iptables (`kubectl -n kube-system get ds kube-proxy` shows 0 desired). Remove that nodeSelector entry.

```bash
kubectl -n kube-system patch daemonset kube-proxy --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector/kube-proxy"}]'
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=240s
```
<!-- /fault -->

### Question 2: ${Q2_APP} cannot list Pods

This run's fault: **`${Q2_FAULT}`**.

<!-- fault Q2_FAULT=role-verb -->
#### Role grants get but not list (`role-verb`)

Role `${Q2_APP}-reader` only allows `get`. Listing Pods is the `list` verb, so the API answers 403 Forbidden. Add `list` to the verbs.

```bash
kubectl -n "${Q2_NS}" patch role "${Q2_APP}-reader" --type=json -p '[{"op":"replace","path":"/rules/0/verbs","value":["get","list"]}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=role-resource -->
#### Role names the resource "pod" (`role-resource`)

Role `${Q2_APP}-reader` grants access to `pod`. RBAC resources are the plural API names, so `pod` matches nothing and the call gets 403. Use `pods`.

```bash
kubectl -n "${Q2_NS}" patch role "${Q2_APP}-reader" --type=json -p '[{"op":"replace","path":"/rules/0/resources","value":["pods"]}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=binding-subject-ns -->
#### RoleBinding subject in the wrong namespace (`binding-subject-ns`)

RoleBinding `${Q2_APP}-reader` grants the Role to ServiceAccount `${Q2_APP}-sa` in namespace `default`, a different account from the one the Pod uses. Set the subject's namespace to `${Q2_NS}`.

```bash
kubectl -n "${Q2_NS}" patch rolebinding "${Q2_APP}-reader" --type=json -p '[{"op":"replace","path":"/subjects/0/namespace","value":"'"${Q2_NS}"'"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=binding-role-ref -->
#### RoleBinding refers to a Role that does not exist (`binding-role-ref`)

RoleBinding `${Q2_APP}-reader` refers to Role `${Q2_APP}-viewer`, which does not exist, so it grants nothing. `roleRef` cannot be edited: delete the RoleBinding and create it again for Role `${Q2_APP}-reader`.

```bash
kubectl -n "${Q2_NS}" delete rolebinding "${Q2_APP}-reader"
kubectl -n "${Q2_NS}" create rolebinding "${Q2_APP}-reader" --role="${Q2_APP}-reader" --serviceaccount="${Q2_NS}:${Q2_APP}-sa"
```
<!-- /fault -->

<!-- fault Q2_FAULT=wrong-sa -->
#### Deployment runs as the default ServiceAccount (`wrong-sa`)

The Deployment runs as ServiceAccount `default`, which has no Role, so the call gets 403 for `system:serviceaccount:${Q2_NS}:default` (the logs and `kubectl get pod -o yaml` show the account). Set `serviceAccountName: ${Q2_APP}-sa`.

```bash
kubectl -n "${Q2_NS}" set serviceaccount "deployment/${Q2_APP}" "${Q2_APP}-sa"
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q2_FAULT=automount-off -->
#### ServiceAccount token not mounted (`automount-off`)

ServiceAccount `${Q2_APP}-sa` sets `automountServiceAccountToken: false`, so no token is mounted and the Pod logs `no token`. RBAC is fine. Allow the automount (on the ServiceAccount or the Pod spec) and restart the Deployment so new Pods get the token.

```bash
kubectl -n "${Q2_NS}" patch serviceaccount "${Q2_APP}-sa" -p '{"automountServiceAccountToken":true}'
kubectl -n "${Q2_NS}" rollout restart "deployment/${Q2_APP}"
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=240s
```
<!-- /fault -->

### Question 3: Frontend cannot reach ${Q3_APP}

This run's fault: **`${Q3_FAULT}`**.

<!-- fault Q3_FAULT=dns-egress-port -->
#### DNS egress allowed on the wrong port (`dns-egress-port`)

`allow-dns` opens egress on port 5353 instead of 53, so DNS queries are dropped: `nslookup` times out and `wget http://...` fails with `bad address`, while wget to the Service IP works. Set the ports back to 53 UDP and TCP.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=dns-namespace-selector -->
#### DNS egress selects a namespace label that does not exist (`dns-namespace-selector`)

`allow-dns` selects namespaces labelled `name=kube-system`, but `kube-system` only carries `kubernetes.io/metadata.name=kube-system` (`kubectl get ns kube-system --show-labels`). No DNS Pod matches, so names do not resolve. Select `kubernetes.io/metadata.name: kube-system`.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/namespaceSelector/matchLabels","value":{"kubernetes.io/metadata.name":"kube-system"}}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=ingress-port -->
#### Ingress allowed on the wrong port (`ingress-port`)

`${Q3_APP}-ingress` lets frontends in on port 8080, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the port to 80.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "${Q3_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=ingress-from-label -->
#### Ingress allows a label no Pod carries (`ingress-from-label`)

`${Q3_APP}-ingress` allows Pods labelled `role=front-end`, but the client is `role=frontend` (`kubectl get pods --show-labels`). Fix the label in the policy.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "${Q3_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0/podSelector/matchLabels","value":{"role":"frontend"}}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=egress-to-label -->
#### Frontend egress points at the wrong Pods (`egress-to-label`)

`frontend-egress` only lets frontends connect to Pods labelled `app=${Q3_APP}-v2`, which do not exist, so the client's own egress is dropped even though `${Q3_APP}-ingress` would accept it. Select `app=${Q3_APP}`.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"app":"'"${Q3_APP}"'"}}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=egress-port -->
#### Frontend egress allowed on the wrong port (`egress-port`)

`frontend-egress` lets frontends connect to the `${Q3_APP}` Pods on port 8080 only, but nginx listens on 80, so the client's connection is dropped on its own side even though `${Q3_APP}-ingress` would accept it. Set the egress port to 80.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=ingress-namespace-and -->
#### Ingress peer ANDs a namespace selector (`ingress-namespace-and`)

In `${Q3_APP}-ingress`, the `from` entry holds a `namespaceSelector` (`team=frontend`) and a `podSelector` in the **same** list item, so a peer must match both. No namespace is labelled `team=frontend`, so nothing is allowed in. `kubectl describe networkpolicy` shows it as one peer. Drop the namespaceSelector, so only Pods labelled `role=frontend` in `${Q3_NS}` are allowed.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "${Q3_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0","value":{"podSelector":{"matchLabels":{"role":"frontend"}}}}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=ingress-pod-selector -->
#### Ingress policy selects no Pod (`ingress-pod-selector`)

`${Q3_APP}-ingress` applies to Pods labelled `app=${Q3_APP}-v2`, which do not exist. Its allow rule protects nothing, and `default-deny` keeps dropping all ingress to the real `${Q3_APP}` Pods. Set its podSelector to `app=${Q3_APP}`.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "${Q3_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/podSelector/matchLabels","value":{"app":"'"${Q3_APP}"'"}}]'
```
<!-- /fault -->

### Question 4: Name resolution broken

This run's fault: **`${Q4_FAULT}`**.

<!-- fault Q4_FAULT=corefile-typo -->
#### Corefile typo crashes CoreDNS (`corefile-typo`)

The Corefile says `forwrd` instead of `forward`. CoreDNS keeps a running config when a reload fails, but once its Pods restart they exit with "Unknown directive 'forwrd'" and crash-loop, so nothing answers DNS. Fix the word in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forwrd \. /etc/resolv\.conf#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=scaled-to-zero -->
#### CoreDNS scaled to zero (`scaled-to-zero`)

Deployment `coredns` has `0` replicas, so Service `kube-dns` has no endpoints and every lookup times out. Scale it back to `2`.

```bash
kubectl -n kube-system scale deployment/coredns --replicas=2
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=cluster-domain -->
#### Wrong cluster domain in the Corefile (`cluster-domain`)

The `kubernetes` plugin serves `cluster.lab` instead of `cluster.local`. CoreDNS runs fine, but it forwards every `*.cluster.local` name upstream, which answers NXDOMAIN. Set the zone back to `cluster.local` in ConfigMap `coredns`.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#kubernetes cluster\.lab #kubernetes cluster.local #' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'kubernetes cluster\.local ' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=kube-dns-selector -->
#### kube-dns Service selects no Pod (`kube-dns-selector`)

Service `kube-dns` selects `k8s-app=kube-dns-v2`, which no Pod carries. CoreDNS is healthy, but 10.96.0.10 has no endpoints, so lookups time out. Set the selector back to `k8s-app=kube-dns`.

```bash
kubectl -n kube-system patch service kube-dns -p '{"spec":{"selector":{"k8s-app":"kube-dns"}}}'
```
<!-- /fault -->

<!-- fault Q4_FAULT=client-dns-policy -->
#### Client Pod bypasses the cluster DNS (`client-dns-policy`)

Pod `client` has `dnsPolicy: Default`, so it inherits the node's resolv.conf: no cluster nameserver and no cluster search domains. The field cannot be changed on a running Pod; recreate `client` without it (the default is `ClusterFirst`).

```bash
kubectl -n "${Q4_NS}" delete pod client --ignore-not-found --wait=true >/dev/null
kubectl -n "${Q4_NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"client"},"spec":{"containers":[{"name":"shell","image":"busybox:1.36","command":["sleep","infinity"]}]}}'
if ! kubectl -n "${Q4_NS}" wait --for=condition=Ready pod/client --timeout=180s; then
  kubectl -n "${Q4_NS}" describe pod/client >&2 || true
  exit 1
fi
```
<!-- /fault -->

<!-- fault Q4_FAULT=corefile-loop -->
#### CoreDNS forwards to itself (`corefile-loop`)

The Corefile says `forward . 127.0.0.1`, so CoreDNS forwards unknown names to itself. The `loop` plugin spots its own probe coming back, logs "Loop (127.0.0.1:...) detected" and exits, so the Pods crash-loop. Set `forward . /etc/resolv.conf` again in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forward \. 127\.0\.0\.1#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=coredns-rbac -->
#### CoreDNS lost its RBAC binding (`coredns-rbac`)

ClusterRoleBinding `system:coredns` is gone, so the CoreDNS service account may not list Services, EndpointSlices or Namespaces. New Pods log "forbidden" and "plugin/ready: Still waiting on: kubernetes", never become ready, and Service `kube-dns` has no endpoints. Bind ClusterRole `system:coredns` to service account `kube-system:coredns` again and restart the Deployment.

```bash
kubectl create clusterrolebinding system:coredns --clusterrole=system:coredns --serviceaccount=kube-system:coredns
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=kube-dns-target-port -->
#### kube-dns Service targets the wrong port (`kube-dns-target-port`)

Ports `dns` and `dns-tcp` of Service `kube-dns` have `targetPort: 5353`. CoreDNS is healthy and the Service has endpoints, but nothing listens on 5353, so lookups time out. Compare `kubectl -n kube-system get endpointslices -l k8s-app=kube-dns` with the container ports, and set both target ports back to `53`.

```bash
kubectl -n kube-system get service kube-dns -o yaml | sed -E 's/targetPort: 5353$/targetPort: 53/' | kubectl replace -f - >/dev/null
[ "$(kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.ports[*].targetPort}' | tr ' ' '\n' | grep -cx 53)" = 2 ] || { echo "could not edit Service kube-dns" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q4_FAULT=corefile-key -->
#### Corefile key renamed in the ConfigMap (`corefile-key`)

ConfigMap `coredns` holds the config under key `corefile`, but the Deployment mounts key `Corefile`. New Pods stay in `ContainerCreating` and `kubectl describe` shows "configmap references non-existent config key: Corefile". Rename the key back to `Corefile` and restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's/^  corefile: /  Corefile: /' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -q kubernetes || { echo "could not rename the Corefile key" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=coredns-image -->
#### CoreDNS image tag does not exist (`coredns-image`)

Deployment `coredns` runs an image tag that does not exist (`v0.0.0`), so its Pods are stuck in `ErrImagePull`/`ImagePullBackOff` and Service `kube-dns` has no ready endpoints. `kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows the failed pull. Set the image back to the tag the control plane uses (`kubeadm config images list` shows it), e.g. `kubectl -n kube-system set image deployment/coredns coredns=registry.k8s.io/coredns/coredns:<tag>`.

```bash
kubectl -n kube-system set image deployment/coredns coredns="$(cat "/var/tmp/cka-q4.image")"
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q4.strategy")}}" >/dev/null
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=coredns-config-volume -->
#### CoreDNS mounts a ConfigMap that does not exist (`coredns-config-volume`)

Volume `config-volume` of Deployment `coredns` refers to ConfigMap `coredns-custom`, which does not exist. The new Pods stay in `ContainerCreating` with "configmap \"coredns-custom\" not found" in `kubectl describe`. Point the volume back at ConfigMap `coredns`.

```bash
kubectl -n kube-system patch deployment coredns --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"coredns"}]'
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q4.strategy")}}" >/dev/null
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=coredns-memory-limit -->
#### CoreDNS memory limit too small (`coredns-memory-limit`)

Deployment `coredns` limits the container to `8Mi` of memory, so CoreDNS is OOMKilled as it starts and its Pods crash-loop (`kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows `OOMKilled`). Restore the kubeadm defaults: memory limit `170Mi`, request `70Mi`.

```bash
kubectl -n kube-system set resources deployment/coredns -c coredns --limits=memory=170Mi --requests=memory=70Mi
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q4.strategy")}}" >/dev/null
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

### Question 5: ${Q5_APP} unreachable through the ingress

This run's fault: **`${Q5_FAULT}`**.

<!-- fault Q5_FAULT=ingress-service-name -->
#### Ingress points at a Service that does not exist (`ingress-service-name`)

The Ingress backend is Service `${Q5_APP}-svc`, which does not exist, so Traefik has nothing to send `www.${Q5_NS}.lab` to. `kubectl describe ingress` shows the missing backend. Point it back at `${Q5_APP}`.

```bash
kubectl -n "${Q5_NS}" patch ingress "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"'"${Q5_APP}"'"}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=ingress-service-port -->
#### Ingress uses the wrong Service port (`ingress-service-port`)

The Ingress sends traffic to port `8080` of Service `${Q5_APP}`, which only has port `80`. Set the backend port back to `80`.

```bash
kubectl -n "${Q5_NS}" patch ingress "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/port/number","value":80}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=ingress-class -->
#### Ingress asks for a class that does not exist (`ingress-class`)

`ingressClassName` is `nginx`, but the only IngressClass is `traefik` (`kubectl get ingressclass`). No controller claims the Ingress, so it has no address and nothing routes `www.${Q5_NS}.lab`. Set the class back to `traefik`.

```bash
kubectl -n "${Q5_NS}" patch ingress "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/ingressClassName","value":"traefik"}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=ingress-path -->
#### Ingress path matches only one exact page (`ingress-path`)

The Ingress path is `/index.html` with `pathType: Exact`, so only that one URL matches and `/` gets Traefik's 404. Set the path back to `/` with `pathType: Prefix`.

```bash
kubectl -n "${Q5_NS}" patch ingress "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"},{"op":"replace","path":"/spec/rules/0/http/paths/0/pathType","value":"Prefix"}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=route-parent -->
#### HTTPRoute attached to a Gateway that does not exist (`route-parent`)

The HTTPRoute's `parentRefs` names Gateway `web-gateway`, which does not exist, so no Gateway accepts the route (its status lists no accepted parent). `kubectl -n traefik get gateway` shows the real name, `traefik-gateway`.

```bash
kubectl -n "${Q5_NS}" patch httproute "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/name","value":"traefik-gateway"}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=route-section -->
#### HTTPRoute names a listener the Gateway does not have (`route-section`)

`sectionName: websecure` asks for a listener that `traefik-gateway` does not have; its only listener is `web`. The route's `Accepted` condition is `False` with reason `NoMatchingParent`. Set `sectionName` back to `web`.

```bash
kubectl -n "${Q5_NS}" patch httproute "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/sectionName","value":"web"}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=route-backend-port -->
#### HTTPRoute uses the wrong Service port (`route-backend-port`)

The HTTPRoute sends traffic to port `8080` of Service `${Q5_APP}`, which only has port `80`. The route's `ResolvedRefs` condition is `False`. Set the backendRef port back to `80`.

```bash
kubectl -n "${Q5_NS}" patch httproute "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=ingress-host-typo -->
#### Ingress rule has a misspelled host (`ingress-host-typo`)

The Ingress rule's host is `ww.${Q5_NS}.lab`, not `www.${Q5_NS}.lab`. Traefik routes only matching Host headers, so `www.${Q5_NS}.lab` gets a 404. `kubectl -n ${Q5_NS} get ingress` shows the host: set it back to `www.${Q5_NS}.lab`.

```bash
kubectl -n "${Q5_NS}" patch ingress "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/host","value":"www.'"${Q5_NS}"'.lab"}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=route-hostname-typo -->
#### HTTPRoute has a misspelled hostname (`route-hostname-typo`)

The HTTPRoute's hostname is `apl.${Q5_NS}.lab`, not `api.${Q5_NS}.lab`, so requests for `api.${Q5_NS}.lab` match no route and get a 404. `kubectl -n ${Q5_NS} get httproute` shows the hostname: set it back to `api.${Q5_NS}.lab`.

```bash
kubectl -n "${Q5_NS}" patch httproute "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/hostnames/0","value":"api.'"${Q5_NS}"'.lab"}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=route-parent-namespace -->
#### HTTPRoute looks for the Gateway in its own namespace (`route-parent-namespace`)

The HTTPRoute's `parentRefs` has no `namespace`, so it defaults to the route's own namespace `${Q5_NS}`, where there is no `traefik-gateway`. The route has no accepted parent. Add `namespace: traefik` to the parentRef.

```bash
kubectl -n "${Q5_NS}" patch httproute "${Q5_APP}" --type=json -p '[{"op":"add","path":"/spec/parentRefs/0/namespace","value":"traefik"}]'
```
<!-- /fault -->

### Question 6: Unhealthy worker

This run's fault: **`${Q6_FAULT}`** on `${Q6_NODE}`.

<!-- fault Q6_FAULT=kubelet-stopped -->
#### kubelet stopped and disabled (`kubelet-stopped`)

The kubelet was stopped and disabled, so the node stops sending heartbeats and turns `NotReady`. `systemctl status kubelet` shows it inactive. `systemctl enable --now kubelet` fixes it now and after a reboot.

On the broken worker:

```bash
systemctl enable --now kubelet
```
<!-- /fault -->

<!-- fault Q6_FAULT=containerd-stopped -->
#### containerd stopped and disabled (`containerd-stopped`)

The container runtime was stopped and disabled. The kubelet keeps running but reports `container runtime is down` / `NotReady`, and its log is full of CRI connection errors. `systemctl enable --now containerd` fixes it.

On the broken worker:

```bash
systemctl enable --now containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q6_FAULT=kubelet-binary-path -->
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

<!-- fault Q6_FAULT=cordoned -->
#### Node cordoned (`cordoned`)

The node is `Ready` but cordoned (`SchedulingDisabled`), so no new Pods land on it. `kubectl uncordon` it.

```bash
kubectl uncordon "${Q6_NODE}"
```
<!-- /fault -->

<!-- fault Q6_FAULT=stray-taint -->
#### Stray NoSchedule taint (`stray-taint`)

A `maintenance=true:NoSchedule` taint keeps every Pod without a matching toleration off the node, including the probe Pod. `kubectl describe node` lists it under Taints; remove it with `kubectl taint node <node> maintenance-`.

```bash
kubectl taint node "${Q6_NODE}" maintenance-
```
<!-- /fault -->

<!-- fault Q6_FAULT=kubelet-config-invalid -->
#### kubelet config has the wrong kind (`kubelet-config-invalid`)

`/var/lib/kubelet/config.yaml` says `kind: KubeletConfig`. The kubelet cannot decode its own config and exits at start (no kind "KubeletConfig" is registered), so the node turns `NotReady`. `journalctl -u kubelet` shows the error. Set `kind: KubeletConfiguration` again and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's/^kind: KubeletConfig$/kind: KubeletConfiguration/' /var/lib/kubelet/config.yaml
grep -qE -- '^kind: KubeletConfiguration$' /var/lib/kubelet/config.yaml || { echo "could not edit /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->

<!-- fault Q6_FAULT=kubelet-client-ca -->
#### kubelet client CA file missing (`kubelet-client-ca`)

`authentication.x509.clientCAFile` in `/var/lib/kubelet/config.yaml` points at `/etc/kubernetes/pki/ca.pem`, which does not exist, so the kubelet exits with "unable to load client CA file". `ls /etc/kubernetes/pki` shows the real `ca.crt`. Fix the path and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#clientCAFile: /etc/kubernetes/pki/ca\.pem$#clientCAFile: /etc/kubernetes/pki/ca.crt#' /var/lib/kubelet/config.yaml
grep -qE -- 'clientCAFile: /etc/kubernetes/pki/ca\.crt$' /var/lib/kubelet/config.yaml || { echo "could not edit /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->

<!-- fault Q6_FAULT=kubelet-api-port -->
#### kubelet kubeconfig uses the wrong API port (`kubelet-api-port`)

The kubelet runs, but `/etc/kubernetes/kubelet.conf` points it at port `6444` of the API server, so every request fails with "connection refused" and the node stops heartbeating. `journalctl -u kubelet` shows the URL; the API server listens on `6443` (compare `~/.kube/config`). Fix the port and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^([[:space:]]*server: https://.*):6444$#\1:6443#' /etc/kubernetes/kubelet.conf
grep -qE -- 'server: https://.*:6443$' /etc/kubernetes/kubelet.conf || { echo "could not edit /etc/kubernetes/kubelet.conf" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->

<!-- fault Q6_FAULT=kubelet-extra-args -->
#### kubelet started with an unknown flag (`kubelet-extra-args`)

`/etc/default/kubelet` adds `--pod-max-pids-limit=100` to `KUBELET_EXTRA_ARGS`. No such flag exists (the real one is `--pod-max-pids`), so the kubelet exits with "unknown flag" right after start. `systemctl cat kubelet` shows the drop-in reads that file. Remove the flag and restart the kubelet.

On the broken worker:

```bash
cp -a "/var/tmp/cka-q6.kubelet-default" /etc/default/kubelet
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q6_FAULT=cni-config-removed -->
#### CNI configuration removed from the node (`cni-config-removed`)

The Calico network config (`10-calico.conflist`) is gone from `/etc/cni/net.d`. containerd reports the network as not ready, so the node turns `NotReady` with "container runtime network not ready ... cni plugin not initialized" (`kubectl describe node`, `journalctl -u kubelet`). `ls /etc/cni/net.d` is empty; a copy of the file sits in `/root/cni-backup` (or copy it from a healthy worker). Put it back, then restart containerd and the kubelet.

On the broken worker:

```bash
mv /root/cni-backup/*.conflist /etc/cni/net.d/
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q6_FAULT=containerd-config-invalid -->
#### containerd config does not parse (`containerd-config-invalid`)

The last line of `/etc/containerd/config.toml` is an unclosed `[plugins` table, so containerd fails to start ("failed to load TOML"). The kubelet runs but cannot reach the runtime, and the node turns `NotReady`. `systemctl status containerd` and `journalctl -u containerd -n 20` point at the line. Remove it, then restart containerd and the kubelet.

On the broken worker:

```bash
cp -a "/var/tmp/cka-q6.containerd" /etc/containerd/config.toml
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

### Question 7: Pod ${Q7_CLAIM}-app stuck

This run's fault: **`${Q7_FAULT}`**.

<!-- fault Q7_FAULT=storageclass-mismatch -->
#### Claim asks for another StorageClass (`storageclass-mismatch`)

The claim asks for StorageClass `fast`, which neither exists nor matches `${Q7_CLAIM}-pv` (`manual`), so it stays `Pending`. Re-create it with `storageClassName: manual`.

```bash
kubectl -n "${Q7_NS}" delete pod "${Q7_CLAIM}-app" --wait=true
kubectl -n "${Q7_NS}" delete pvc "${Q7_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q7_CLAIM}"'","namespace":"'"${Q7_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q7_CLAIM}"'-app","namespace":"'"${Q7_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q7_CLAIM}"'"}}]}}]}'
kubectl -n "${Q7_NS}" wait --for=condition=Ready "pod/${Q7_CLAIM}-app" --timeout=180s
```
<!-- /fault -->

<!-- fault Q7_FAULT=access-mode-mismatch -->
#### Claim asks for ReadWriteMany (`access-mode-mismatch`)

The claim asks for `ReadWriteMany`, but `${Q7_CLAIM}-pv` only offers `ReadWriteOnce`, so nothing binds. Re-create it with `ReadWriteOnce`.

```bash
kubectl -n "${Q7_NS}" delete pod "${Q7_CLAIM}-app" --wait=true
kubectl -n "${Q7_NS}" delete pvc "${Q7_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q7_CLAIM}"'","namespace":"'"${Q7_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q7_CLAIM}"'-app","namespace":"'"${Q7_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q7_CLAIM}"'"}}]}}]}'
kubectl -n "${Q7_NS}" wait --for=condition=Ready "pod/${Q7_CLAIM}-app" --timeout=180s
```
<!-- /fault -->

<!-- fault Q7_FAULT=claim-too-large -->
#### Claim larger than the volume (`claim-too-large`)

The claim requests `2Gi` and `${Q7_CLAIM}-pv` holds only `1Gi`, so it can never bind. Re-create it requesting `500Mi`.

```bash
kubectl -n "${Q7_NS}" delete pod "${Q7_CLAIM}-app" --wait=true
kubectl -n "${Q7_NS}" delete pvc "${Q7_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q7_CLAIM}"'","namespace":"'"${Q7_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q7_CLAIM}"'-app","namespace":"'"${Q7_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q7_CLAIM}"'"}}]}}]}'
kubectl -n "${Q7_NS}" wait --for=condition=Ready "pod/${Q7_CLAIM}-app" --timeout=180s
```
<!-- /fault -->

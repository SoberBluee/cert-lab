## Solution

### Question 1: Frontend cannot reach api

**The healthy setup**

- `default-deny` selects every Pod for ingress and egress
- `allow-dns` lets every Pod reach the `kube-dns` Pods in `kube-system` on port `53`, UDP and TCP
- `frontend-egress` lets `role=frontend` Pods reach the `app=api` Pods on TCP `80`
- `api-ingress` selects the `app=api` Pods and admits `role=frontend` Pods of the same namespace on TCP `80`

This run broke 3 things: **`${Q1_FAULT}`**, **`${Q1_FAULT_2}`**, **`${Q1_FAULT_3}`**. Fix them in the order below.

**Problem 1: DNS egress**

<!-- fault Q1_FAULT=dns-egress-port -->
#### DNS egress allowed on the wrong port (`dns-egress-port`)

`allow-dns` opens egress on port 5353 instead of 53, so DNS queries are dropped: `nslookup` times out and `wget http://...` fails with `bad address`, while wget to the Service IP works. Set the ports back to 53 UDP and TCP.

```bash
kubectl -n "secure" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=dns-namespace-selector -->
#### DNS egress selects a namespace label that does not exist (`dns-namespace-selector`)

`allow-dns` selects namespaces labelled `name=kube-system`, but `kube-system` only carries `kubernetes.io/metadata.name=kube-system` (`kubectl get ns kube-system --show-labels`). No DNS Pod matches, so names do not resolve. Select `kubernetes.io/metadata.name: kube-system`.

```bash
kubectl -n "secure" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/namespaceSelector/matchLabels","value":{"kubernetes.io/metadata.name":"kube-system"}}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=dns-policy-deleted -->
#### DNS egress NetworkPolicy was deleted (`dns-policy-deleted`)

NetworkPolicy `allow-dns` is missing, so `default-deny` drops every DNS query: `nslookup` times out and `wget http://api` fails with `bad address`. Recreate `allow-dns` so every Pod can reach `kube-dns` in `kube-system` on port 53 UDP and TCP.

```bash
kubectl -n "secure" apply -f - <<< '{"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"allow-dns"},"spec":{"podSelector":{},"policyTypes":["Egress"],"egress":[{"to":[{"namespaceSelector":{"matchLabels":{"kubernetes.io/metadata.name":"kube-system"}},"podSelector":{"matchLabels":{"k8s-app":"kube-dns"}}}],"ports":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=dns-udp-only -->
#### DNS egress allows TCP only, not UDP (`dns-udp-only`)

`allow-dns` opens only TCP/53. Cluster DNS queries use UDP first, so names do not resolve (`nslookup` hangs) while wget to a Pod IP still works. Allow both UDP and TCP on port 53.

```bash
kubectl -n "secure" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=dns-pod-selector -->
#### DNS egress selects DNS Pods by the wrong label (`dns-pod-selector`)

`allow-dns` selects Pods labelled `k8s-app=coredns`, but CoreDNS Pods carry `k8s-app=kube-dns` (`kubectl -n kube-system get pods --show-labels`). No peer matches, so DNS is dropped. Select `k8s-app: kube-dns`.

```bash
kubectl -n "secure" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"k8s-app":"kube-dns"}}]'
```
<!-- /fault -->

**Problem 2: the frontend egress**

<!-- fault Q1_FAULT_2=egress-to-label -->
#### Frontend egress points at the wrong Pods (`egress-to-label`)

`frontend-egress` only lets frontends connect to Pods labelled `app=api-v2`, which do not exist, so the client's own egress is dropped even though `api-ingress` would accept it. Select `app=api`.

```bash
kubectl -n "secure" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"app":"api"}}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=egress-port -->
#### Frontend egress allowed on the wrong port (`egress-port`)

`frontend-egress` lets frontends connect to the `api` Pods on port 8080 only, but nginx listens on 80, so the client's connection is dropped on its own side even though `api-ingress` would accept it. Set the egress port to 80.

```bash
kubectl -n "secure" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=frontend-egress-deleted -->
#### Frontend egress NetworkPolicy was deleted (`frontend-egress-deleted`)

NetworkPolicy `frontend-egress` is missing, so `default-deny` drops the client's egress to `api` even though DNS works and `api-ingress` would accept the connection. Recreate `frontend-egress` so Pods labelled `role=frontend` can reach `app=api` on TCP port 80.

```bash
kubectl -n "secure" apply -f - <<< '{"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"frontend-egress"},"spec":{"podSelector":{"matchLabels":{"role":"frontend"}},"policyTypes":["Egress"],"egress":[{"to":[{"podSelector":{"matchLabels":{"app":"'"api"'"}}}],"ports":[{"protocol":"TCP","port":80}]}]}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=frontend-egress-selector -->
#### Frontend egress policy selects no Pod (`frontend-egress-selector`)

`frontend-egress` applies to Pods labelled `role=front-end`, but `client` is `role=frontend`. The allow rule protects nobody, and `default-deny` drops the client's egress. Set its podSelector to `role=frontend`.

```bash
kubectl -n "secure" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/podSelector/matchLabels","value":{"role":"frontend"}}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=netpol-egress-ipblock-except -->
#### Egress NetworkPolicy excepts the backend CIDR (`netpol-egress-ipblock-except`)

NetworkPolicy `frontend-egress-ipblock` allows egress to `0.0.0.0/0` on port 80 but `except`s `10.0.0.0/8` and `192.168.0.0/16`, which covers Pod and Service IPs, so the client still cannot reach `api`. Delete that policy and restore `frontend-egress` (podSelector to `app=api` on TCP/80).

```bash
kubectl -n "secure" delete networkpolicy frontend-egress-ipblock --ignore-not-found >/dev/null
kubectl -n "secure" apply -f - <<< '{"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"frontend-egress"},"spec":{"podSelector":{"matchLabels":{"role":"frontend"}},"policyTypes":["Egress"],"egress":[{"to":[{"podSelector":{"matchLabels":{"app":"'"api"'"}}}],"ports":[{"protocol":"TCP","port":80}]}]}}'
```
<!-- /fault -->

**Problem 3: the API ingress**

<!-- fault Q1_FAULT_3=ingress-port -->
#### Ingress allowed on the wrong port (`ingress-port`)

`api-ingress` lets frontends in on port 8080, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the port to 80.

```bash
kubectl -n "secure" patch networkpolicy "api-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT_3=ingress-from-label -->
#### Ingress allows a label no Pod carries (`ingress-from-label`)

`api-ingress` allows Pods labelled `role=front-end`, but the client is `role=frontend` (`kubectl get pods --show-labels`). Fix the label in the policy.

```bash
kubectl -n "secure" patch networkpolicy "api-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0/podSelector/matchLabels","value":{"role":"frontend"}}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT_3=ingress-namespace-and -->
#### Ingress peer ANDs a namespace selector (`ingress-namespace-and`)

In `api-ingress`, the `from` entry holds a `namespaceSelector` (`team=frontend`) and a `podSelector` in the **same** list item, so a peer must match both. No namespace is labelled `team=frontend`, so nothing is allowed in. `kubectl describe networkpolicy` shows it as one peer. Drop the namespaceSelector, so only Pods labelled `role=frontend` in `secure` are allowed.

```bash
kubectl -n "secure" patch networkpolicy "api-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0","value":{"podSelector":{"matchLabels":{"role":"frontend"}}}}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT_3=ingress-pod-selector -->
#### Ingress policy selects no Pod (`ingress-pod-selector`)

`api-ingress` applies to Pods labelled `app=api-v2`, which do not exist. Its allow rule protects nothing, and `default-deny` keeps dropping all ingress to the real `api` Pods. Set its podSelector to `app=api`.

```bash
kubectl -n "secure" patch networkpolicy "api-ingress" --type=json -p '[{"op":"replace","path":"/spec/podSelector/matchLabels","value":{"app":"api"}}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT_3=ingress-ports-cleared -->
#### Ingress allowed on HTTPS only (`ingress-ports-cleared`)

`api-ingress` lets frontends in on port 443 only, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the ingress port back to 80.

```bash
kubectl -n "secure" patch networkpolicy "api-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports","value":[{"protocol":"TCP","port":80}]}]'
```
<!-- /fault -->

### Question 2: web unreachable through the ingress

**The healthy setup**

- Service `web`: port `80`, forwarding to the `web` Pods
- Ingress `web`: class `traefik`, host `www.shop.lab`, path `/` (`Prefix`) to Service `web` on port `80`
- HTTPRoute `web`: attached to the `web` listener of Gateway `traefik-gateway` in namespace `traefik`, host `api.shop.lab`, path `/` to Service `web` on port `80`

This run broke 2 things: **`${Q2_FAULT}`**, **`${Q2_FAULT_2}`**. Fix them in the order below.

**Problem 1: the Ingress**

<!-- fault Q2_FAULT=ingress-service-name -->
#### Ingress points at a Service that does not exist (`ingress-service-name`)

The Ingress backend is Service `web-svc`, which does not exist, so Traefik has nothing to send `www.shop.lab` to. `kubectl describe ingress` shows the missing backend. Point it back at `web`.

```bash
kubectl -n "shop" patch ingress "web" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"web"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-service-port -->
#### Ingress uses the wrong Service port (`ingress-service-port`)

The Ingress sends traffic to port `8080` of Service `web`, which only has port `80`. Set the backend port back to `80`.

```bash
kubectl -n "shop" patch ingress "web" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/port/number","value":80}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-class -->
#### Ingress asks for a class that does not exist (`ingress-class`)

`ingressClassName` is `nginx`, but the only IngressClass is `traefik` (`kubectl get ingressclass`). No controller claims the Ingress, so it has no address and nothing routes `www.shop.lab`. Set the class back to `traefik`.

```bash
kubectl -n "shop" patch ingress "web" --type=json -p '[{"op":"replace","path":"/spec/ingressClassName","value":"traefik"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-path -->
#### Ingress path matches only one exact page (`ingress-path`)

The Ingress path is `/index.html` with `pathType: Exact`, so only that one URL matches and `/` gets Traefik's 404. Set the path back to `/` with `pathType: Prefix`.

```bash
kubectl -n "shop" patch ingress "web" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"},{"op":"replace","path":"/spec/rules/0/http/paths/0/pathType","value":"Prefix"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-host-typo -->
#### Ingress rule has a misspelled host (`ingress-host-typo`)

The Ingress rule's host is `ww.shop.lab`, not `www.shop.lab`. Traefik routes only matching Host headers, so `www.shop.lab` gets a 404. `kubectl -n shop get ingress` shows the host: set it back to `www.shop.lab`.

```bash
kubectl -n "shop" patch ingress "web" --type=json -p '[{"op":"replace","path":"/spec/rules/0/host","value":"www.shop.lab"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-path-prefix -->
#### Ingress path matches only /app (`ingress-path-prefix`)

The Ingress path is `/app` with `pathType: Prefix`, so `/` does not match and Traefik returns 404 for `www.shop.lab`. Set the path back to `/`.

```bash
kubectl -n "shop" patch ingress "web" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-tls-secret-missing -->
#### Ingress TLS references a Secret that does not exist (`ingress-tls-secret-missing`)

Ingress `web` references TLS Secret `missing-tls` (which does not exist) and is pinned to the `websecure` entrypoint, so HTTP on `www.shop.lab` fails. Remove the `spec.tls` stanza (or create a valid TLS Secret) and clear the entrypoints annotation so Traefik serves the host on `web` again.

```bash
kubectl -n "shop" annotate ingress "web" traefik.ingress.kubernetes.io/router.entrypoints-
kubectl -n "shop" patch ingress "web" --type=json -p '[{"op":"remove","path":"/spec/tls"}]'
```
<!-- /fault -->

**Problem 2: the HTTPRoute**

<!-- fault Q2_FAULT_2=route-parent -->
#### HTTPRoute attached to a Gateway that does not exist (`route-parent`)

The HTTPRoute's `parentRefs` names Gateway `web-gateway`, which does not exist, so no Gateway accepts the route (its status lists no accepted parent). `kubectl -n traefik get gateway` shows the real name, `traefik-gateway`.

```bash
kubectl -n "shop" patch httproute "web" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/name","value":"traefik-gateway"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT_2=route-section -->
#### HTTPRoute names a listener the Gateway does not have (`route-section`)

`sectionName: websecure` asks for a listener that `traefik-gateway` does not have; its only listener is `web`. The route's `Accepted` condition is `False` with reason `NoMatchingParent`. Set `sectionName` back to `web`.

```bash
kubectl -n "shop" patch httproute "web" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/sectionName","value":"web"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT_2=route-backend-port -->
#### HTTPRoute uses the wrong Service port (`route-backend-port`)

The HTTPRoute sends traffic to port `8080` of Service `web`, which only has port `80`. The route's `ResolvedRefs` condition is `False`. Set the backendRef port back to `80`.

```bash
kubectl -n "shop" patch httproute "web" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT_2=route-hostname-typo -->
#### HTTPRoute has a misspelled hostname (`route-hostname-typo`)

The HTTPRoute's hostname is `apl.shop.lab`, not `api.shop.lab`, so requests for `api.shop.lab` match no route and get a 404. `kubectl -n shop get httproute` shows the hostname: set it back to `api.shop.lab`.

```bash
kubectl -n "shop" patch httproute "web" --type=json -p '[{"op":"replace","path":"/spec/hostnames/0","value":"api.shop.lab"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT_2=route-parent-namespace -->
#### HTTPRoute looks for the Gateway in its own namespace (`route-parent-namespace`)

The HTTPRoute's `parentRefs` has no `namespace`, so it defaults to the route's own namespace `shop`, where there is no `traefik-gateway`. The route has no accepted parent. Add `namespace: traefik` to the parentRef.

```bash
kubectl -n "shop" patch httproute "web" --type=json -p '[{"op":"add","path":"/spec/parentRefs/0/namespace","value":"traefik"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT_2=route-backend-name -->
#### HTTPRoute points at a Service that does not exist (`route-backend-name`)

The HTTPRoute's backendRef is Service `web-svc`, which does not exist, so `ResolvedRefs` is `False` and `api.shop.lab` fails. Point the backendRef back at `web`.

```bash
kubectl -n "shop" patch httproute "web" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/name","value":"web"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT_2=route-path-prefix -->
#### HTTPRoute path matches only /api (`route-path-prefix`)

The HTTPRoute only matches path prefix `/api`, so `/` gets Traefik's 404. Remove the `matches` block (or set the path to `/`) so every path on `api.shop.lab` is served.

```bash
kubectl -n "shop" patch httproute "web" --type=json -p '[{"op":"remove","path":"/spec/rules/0/matches"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT_2=route-weight-zero -->
#### HTTPRoute backend weight is zero (`route-weight-zero`)

The HTTPRoute backendRef has `weight: 0`, so Traefik sends it no traffic and `api.shop.lab` fails even though the Service is healthy. Remove the weight (or set it above 0).

```bash
kubectl -n "shop" patch httproute "web" --type=json -p '[{"op":"remove","path":"/spec/rules/0/backendRefs/0/weight"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT_2=route-parent-group -->
#### HTTPRoute parentRef uses the wrong API group (`route-parent-group`)

The HTTPRoute's `parentRefs` sets `group: networking.k8s.io`, but Gateways live in `gateway.networking.k8s.io`. No parent accepts the route. Remove the `group` field (or set it to `gateway.networking.k8s.io`).

```bash
kubectl -n "shop" patch httproute "web" --type=json -p '[{"op":"remove","path":"/spec/parentRefs/0/group"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT_2=route-filter-redirect -->
#### HTTPRoute redirects instead of proxying (`route-filter-redirect`)

The HTTPRoute has a `RequestRedirect` filter, so requests for `api.shop.lab` get a 302 to `elsewhere.example` instead of the nginx welcome page. Remove the `filters` block so the route proxies to Service `web`.

```bash
kubectl -n "shop" patch httproute "web" --type=json -p '[{"op":"remove","path":"/spec/rules/0/filters"}]'
```
<!-- /fault -->

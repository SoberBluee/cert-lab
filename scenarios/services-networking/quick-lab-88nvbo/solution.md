## Solution

### Question 1: Frontend cannot reach ${Q1_APP}

**The healthy setup**

- `default-deny` selects every Pod for ingress and egress
- `allow-dns` lets every Pod reach the `kube-dns` Pods in `kube-system` on port `53`, UDP and TCP
- `frontend-egress` lets `role=frontend` Pods reach the `app=${Q1_APP}` Pods on TCP `80`
- `${Q1_APP}-ingress` selects the `app=${Q1_APP}` Pods and admits `role=frontend` Pods of the same namespace on TCP `80`

This run broke 2 things: **`${Q1_FAULT}`**, **`${Q1_FAULT_2}`**. Fix them in the order below.

**Problem 1: DNS egress**

<!-- fault Q1_FAULT=dns-egress-port -->
#### DNS egress allowed on the wrong port (`dns-egress-port`)

`allow-dns` opens egress on port 5353 instead of 53, so DNS queries are dropped: `nslookup` times out and `wget http://...` fails with `bad address`, while wget to the Service IP works. Set the ports back to 53 UDP and TCP.

```bash
kubectl -n "${Q1_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=dns-namespace-selector -->
#### DNS egress selects a namespace label that does not exist (`dns-namespace-selector`)

`allow-dns` selects namespaces labelled `name=kube-system`, but `kube-system` only carries `kubernetes.io/metadata.name=kube-system` (`kubectl get ns kube-system --show-labels`). No DNS Pod matches, so names do not resolve. Select `kubernetes.io/metadata.name: kube-system`.

```bash
kubectl -n "${Q1_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/namespaceSelector/matchLabels","value":{"kubernetes.io/metadata.name":"kube-system"}}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=dns-policy-deleted -->
#### DNS egress NetworkPolicy was deleted (`dns-policy-deleted`)

NetworkPolicy `allow-dns` is missing, so `default-deny` drops every DNS query: `nslookup` times out and `wget http://${Q1_APP}` fails with `bad address`. Recreate `allow-dns` so every Pod can reach `kube-dns` in `kube-system` on port 53 UDP and TCP.

```bash
kubectl -n "${Q1_NS}" apply -f - <<< '{"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"allow-dns"},"spec":{"podSelector":{},"policyTypes":["Egress"],"egress":[{"to":[{"namespaceSelector":{"matchLabels":{"kubernetes.io/metadata.name":"kube-system"}},"podSelector":{"matchLabels":{"k8s-app":"kube-dns"}}}],"ports":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=dns-udp-only -->
#### DNS egress allows TCP only, not UDP (`dns-udp-only`)

`allow-dns` opens only TCP/53. Cluster DNS queries use UDP first, so names do not resolve (`nslookup` hangs) while wget to a Pod IP still works. Allow both UDP and TCP on port 53.

```bash
kubectl -n "${Q1_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=dns-pod-selector -->
#### DNS egress selects DNS Pods by the wrong label (`dns-pod-selector`)

`allow-dns` selects Pods labelled `k8s-app=coredns`, but CoreDNS Pods carry `k8s-app=kube-dns` (`kubectl -n kube-system get pods --show-labels`). No peer matches, so DNS is dropped. Select `k8s-app: kube-dns`.

```bash
kubectl -n "${Q1_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"k8s-app":"kube-dns"}}]'
```
<!-- /fault -->

**Problem 2: the API ingress**

<!-- fault Q1_FAULT_2=ingress-port -->
#### Ingress allowed on the wrong port (`ingress-port`)

`${Q1_APP}-ingress` lets frontends in on port 8080, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the port to 80.

```bash
kubectl -n "${Q1_NS}" patch networkpolicy "${Q1_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=ingress-from-label -->
#### Ingress allows a label no Pod carries (`ingress-from-label`)

`${Q1_APP}-ingress` allows Pods labelled `role=front-end`, but the client is `role=frontend` (`kubectl get pods --show-labels`). Fix the label in the policy.

```bash
kubectl -n "${Q1_NS}" patch networkpolicy "${Q1_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0/podSelector/matchLabels","value":{"role":"frontend"}}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=ingress-namespace-and -->
#### Ingress peer ANDs a namespace selector (`ingress-namespace-and`)

In `${Q1_APP}-ingress`, the `from` entry holds a `namespaceSelector` (`team=frontend`) and a `podSelector` in the **same** list item, so a peer must match both. No namespace is labelled `team=frontend`, so nothing is allowed in. `kubectl describe networkpolicy` shows it as one peer. Drop the namespaceSelector, so only Pods labelled `role=frontend` in `${Q1_NS}` are allowed.

```bash
kubectl -n "${Q1_NS}" patch networkpolicy "${Q1_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0","value":{"podSelector":{"matchLabels":{"role":"frontend"}}}}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=ingress-pod-selector -->
#### Ingress policy selects no Pod (`ingress-pod-selector`)

`${Q1_APP}-ingress` applies to Pods labelled `app=${Q1_APP}-v2`, which do not exist. Its allow rule protects nothing, and `default-deny` keeps dropping all ingress to the real `${Q1_APP}` Pods. Set its podSelector to `app=${Q1_APP}`.

```bash
kubectl -n "${Q1_NS}" patch networkpolicy "${Q1_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/podSelector/matchLabels","value":{"app":"'"${Q1_APP}"'"}}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=ingress-port-443 -->
#### Ingress allowed on HTTPS only (`ingress-port-443`)

`${Q1_APP}-ingress` lets frontends in on port 443 only, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the ingress port back to 80.

```bash
kubectl -n "${Q1_NS}" patch networkpolicy "${Q1_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports","value":[{"protocol":"TCP","port":80}]}]'
```
<!-- /fault -->

### Question 2: DaemonSet ${Q2_DS} on edge nodes

```bash
kubectl label node worker-2 node-type=edge
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ${Q2_DS}
  namespace: ${Q2_NS}
spec:
  selector:
    matchLabels: { app: ${Q2_DS} }
  template:
    metadata:
      labels: { app: ${Q2_DS} }
    spec:
      nodeSelector: { node-type: edge }
      containers:
        - name: ${Q2_DS}
          image: httpd:2.4-alpine
EOF
kubectl -n ${Q2_NS} rollout status daemonset/${Q2_DS} --timeout=180s
```

### Question 3: ${Q3_APP} unreachable through the ingress

**The healthy setup**

- Service `${Q3_APP}`: port `80`, forwarding to the `${Q3_APP}` Pods
- Ingress `${Q3_APP}`: class `traefik`, host `www.${Q3_NS}.lab`, path `/` (`Prefix`) to Service `${Q3_APP}` on port `80`
- HTTPRoute `${Q3_APP}`: attached to the `web` listener of Gateway `traefik-gateway` in namespace `traefik`, host `api.${Q3_NS}.lab`, path `/` to Service `${Q3_APP}` on port `80`
- the controller: Deployment `traefik` in namespace `traefik`, its Service publishing the `web` port on NodePort `30080`, and IngressClass `traefik` naming controller `traefik.io/ingress-controller`

This run broke 2 things: **`${Q3_FAULT}`**, **`${Q3_FAULT_2}`**. Fix them in the order below.

**Problem 1: the HTTPRoute**

<!-- fault Q3_FAULT=route-parent -->
#### HTTPRoute attached to a Gateway that does not exist (`route-parent`)

The HTTPRoute's `parentRefs` names Gateway `web-gateway`, which does not exist, so no Gateway accepts the route (its status lists no accepted parent). `kubectl -n traefik get gateway` shows the real name, `traefik-gateway`.

```bash
kubectl -n "${Q3_NS}" patch httproute "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/name","value":"traefik-gateway"}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=route-section -->
#### HTTPRoute names a listener the Gateway does not have (`route-section`)

`sectionName: websecure` asks for a listener that `traefik-gateway` does not have; its only listener is `web`. The route's `Accepted` condition is `False` with reason `NoMatchingParent`. Set `sectionName` back to `web`.

```bash
kubectl -n "${Q3_NS}" patch httproute "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/sectionName","value":"web"}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=route-backend-port -->
#### HTTPRoute uses the wrong Service port (`route-backend-port`)

The HTTPRoute sends traffic to port `8080` of Service `${Q3_APP}`, which only has port `80`. The route's `ResolvedRefs` condition is `False`. Set the backendRef port back to `80`.

```bash
kubectl -n "${Q3_NS}" patch httproute "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=route-parent-namespace -->
#### HTTPRoute looks for the Gateway in its own namespace (`route-parent-namespace`)

The HTTPRoute's `parentRefs` has no `namespace`, so it defaults to the route's own namespace `${Q3_NS}`, where there is no `traefik-gateway`. The route has no accepted parent. Add `namespace: traefik` to the parentRef.

```bash
kubectl -n "${Q3_NS}" patch httproute "${Q3_APP}" --type=json -p '[{"op":"add","path":"/spec/parentRefs/0/namespace","value":"traefik"}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=route-backend-name -->
#### HTTPRoute points at a Service that does not exist (`route-backend-name`)

The HTTPRoute's backendRef is Service `${Q3_APP}-svc`, which does not exist, so `ResolvedRefs` is `False` and `api.${Q3_NS}.lab` fails. Point the backendRef back at `${Q3_APP}`.

```bash
kubectl -n "${Q3_NS}" patch httproute "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/name","value":"'"${Q3_APP}"'"}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=route-path-prefix -->
#### HTTPRoute path matches only /api (`route-path-prefix`)

The HTTPRoute only matches path prefix `/api`, so `/` gets Traefik's 404. Remove the `matches` block (or set the path to `/`) so every path on `api.${Q3_NS}.lab` is served.

```bash
kubectl -n "${Q3_NS}" patch httproute "${Q3_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/matches"}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=route-weight-zero -->
#### HTTPRoute backend weight is zero (`route-weight-zero`)

The HTTPRoute backendRef has `weight: 0`, so Traefik sends it no traffic and `api.${Q3_NS}.lab` fails even though the Service is healthy. Remove the weight (or set it above 0).

```bash
kubectl -n "${Q3_NS}" patch httproute "${Q3_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/backendRefs/0/weight"}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=route-filter-redirect -->
#### HTTPRoute redirects instead of proxying (`route-filter-redirect`)

The HTTPRoute has a `RequestRedirect` filter, so requests for `api.${Q3_NS}.lab` get a 302 to `elsewhere.example` instead of the nginx welcome page. Remove the `filters` block so the route proxies to Service `${Q3_APP}`.

```bash
kubectl -n "${Q3_NS}" patch httproute "${Q3_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/filters"}]'
```
<!-- /fault -->

**Problem 2: the controller**

<!-- fault Q3_FAULT_2=controller-down -->
#### The Traefik controller is scaled to zero (`controller-down`)

Both hosts fail at once, and nothing in `${Q3_NS}` is wrong: Deployment `traefik` in namespace `traefik` has `0` replicas, so nothing listens behind NodePort `30080` (curl gets "connection refused"). Scale it back to `1`.

```bash
kubectl -n traefik scale deployment traefik --replicas=1
```
<!-- /fault -->

<!-- fault Q3_FAULT_2=controller-nodeport -->
#### The controller's Service moved to another NodePort (`controller-nodeport`)

Traefik runs and every object in `${Q3_NS}` is right, but the `web` port of Service `traefik/traefik` now uses NodePort `30081`, so nothing answers on `30080` (`kubectl -n traefik get svc traefik` shows `80:30081/TCP`). The task's URL uses `30080`: set the `web` port's `nodePort` back to `30080`.

```bash
i=$(kubectl -n traefik get service traefik -o jsonpath='{range .spec.ports[*]}{.name}{"\n"}{end}' | grep -n '^web$' | cut -d: -f1)
kubectl -n traefik patch service traefik --type=json -p '[{"op":"replace","path":"/spec/ports/'"$((i - 1))"'/nodePort","value":30080}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT_2=ingressclass-controller -->
#### IngressClass traefik names another controller (`ingressclass-controller`)

IngressClass `traefik` now names controller `k8s.io/ingress-nginx`, which does not run here. Traefik only serves Ingresses whose class names `traefik.io/ingress-controller`, so `www.${Q3_NS}.lab` fails while `api.${Q3_NS}.lab` (Gateway API, which uses the GatewayClass) still works. `kubectl get ingressclass traefik -o yaml` shows the controller; the field cannot be edited, so delete the IngressClass and create it again with `controller: traefik.io/ingress-controller`.

```bash
kubectl delete ingressclass traefik --wait=true
kubectl create -f /var/tmp/cka-ingressclass-traefik.json
```
<!-- /fault -->

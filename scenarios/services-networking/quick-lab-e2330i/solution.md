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

### Question 2: Frontend cannot reach ${Q2_APP}

This run's fault: **`${Q2_FAULT}`**.

<!-- fault Q2_FAULT=dns-egress-port -->
#### DNS egress allowed on the wrong port (`dns-egress-port`)

`allow-dns` opens egress on port 5353 instead of 53, so DNS queries are dropped: `nslookup` times out and `wget http://...` fails with `bad address`, while wget to the Service IP works. Set the ports back to 53 UDP and TCP.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=dns-namespace-selector -->
#### DNS egress selects a namespace label that does not exist (`dns-namespace-selector`)

`allow-dns` selects namespaces labelled `name=kube-system`, but `kube-system` only carries `kubernetes.io/metadata.name=kube-system` (`kubectl get ns kube-system --show-labels`). No DNS Pod matches, so names do not resolve. Select `kubernetes.io/metadata.name: kube-system`.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/namespaceSelector/matchLabels","value":{"kubernetes.io/metadata.name":"kube-system"}}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-port -->
#### Ingress allowed on the wrong port (`ingress-port`)

`${Q2_APP}-ingress` lets frontends in on port 8080, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the port to 80.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "${Q2_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-from-label -->
#### Ingress allows a label no Pod carries (`ingress-from-label`)

`${Q2_APP}-ingress` allows Pods labelled `role=front-end`, but the client is `role=frontend` (`kubectl get pods --show-labels`). Fix the label in the policy.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "${Q2_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0/podSelector/matchLabels","value":{"role":"frontend"}}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=egress-to-label -->
#### Frontend egress points at the wrong Pods (`egress-to-label`)

`frontend-egress` only lets frontends connect to Pods labelled `app=${Q2_APP}-v2`, which do not exist, so the client's own egress is dropped even though `${Q2_APP}-ingress` would accept it. Select `app=${Q2_APP}`.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"app":"'"${Q2_APP}"'"}}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=egress-port -->
#### Frontend egress allowed on the wrong port (`egress-port`)

`frontend-egress` lets frontends connect to the `${Q2_APP}` Pods on port 8080 only, but nginx listens on 80, so the client's connection is dropped on its own side even though `${Q2_APP}-ingress` would accept it. Set the egress port to 80.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-namespace-and -->
#### Ingress peer ANDs a namespace selector (`ingress-namespace-and`)

In `${Q2_APP}-ingress`, the `from` entry holds a `namespaceSelector` (`team=frontend`) and a `podSelector` in the **same** list item, so a peer must match both. No namespace is labelled `team=frontend`, so nothing is allowed in. `kubectl describe networkpolicy` shows it as one peer. Drop the namespaceSelector, so only Pods labelled `role=frontend` in `${Q2_NS}` are allowed.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "${Q2_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0","value":{"podSelector":{"matchLabels":{"role":"frontend"}}}}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-pod-selector -->
#### Ingress policy selects no Pod (`ingress-pod-selector`)

`${Q2_APP}-ingress` applies to Pods labelled `app=${Q2_APP}-v2`, which do not exist. Its allow rule protects nothing, and `default-deny` keeps dropping all ingress to the real `${Q2_APP}` Pods. Set its podSelector to `app=${Q2_APP}`.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "${Q2_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/podSelector/matchLabels","value":{"app":"'"${Q2_APP}"'"}}]'
```
<!-- /fault -->
